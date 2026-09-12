/**
 * /admin — single-operator dashboard for the notify worker.
 *   /admin/login            ID/PW (ADMIN_USER var + ADMIN_PASS_HASH secret, PBKDF2) · 5 failures → 15-minute lock
 *   /admin                  overview: counts by channel/status, today's due/sent/failed, last cron run, 30-day chart, recent sends
 *   /admin/subscribers      list + filters + search + CSV
 *   /admin/subscribers/:id  detail, received issues, send/access history, actions (pause/resume/reset/send now/test/delete)
 *   /admin/sends            send log + filters, retry
 *   /admin/access           access/behaviour log + cron runs
 *   /admin/settings         password change (stored in admin_state, overrides the secret), integration status, retention
 * Session: HMAC-signed cookie (SIGNING_KEY), 12h, HttpOnly/Secure/SameSite=Strict, Path=/admin. CSRF: signed token bound to the session nonce.
 * Every admin action is written to access_log (event admin_action).
 */
import { DAYS, CATS, esc, json, html, rand, makeToken, readToken, pbkdf2Hash, pbkdf2Verify, kst, kstNow, kstDate, track } from './lib.js';

const SESSION_HOURS = 12, LOCK_MAX = 5, LOCK_MIN = 15, PAGE = 50, PAGE_LOG = 100;
const COOKIE = 'pli_admin';
const KINDS = ['issue', 'welcome', 'test', 'exhausted', 'link'];
const EVENTS = ['kakao_start', 'kakao_callback', 'email_start', 'settings_view', 'settings_save', 'pause', 'resume', 'reset', 'unsubscribe', 'test', 'admin_login_ok', 'admin_login_fail', 'admin_action'];
const NOINDEX = { 'x-robots-tag': 'noindex, nofollow' };

export async function adminRoute(request, env, ctx, url, api) {
  const p = url.pathname.replace(/\/+$/, '') || '/admin';
  const m = request.method;
  const ip = request.headers.get('cf-connecting-ip') || '';
  const allow = (env.ADMIN_ALLOW_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allow.length && !allow.includes(ip)) return page('접근 불가', '<p class="err">허용되지 않은 IP예요.</p>', null, 403);
  if (!env.ADMIN_USER || !env.ADMIN_PASS_HASH) return page('설정 필요', '<h1>관리자 설정이 아직 없어요</h1><p class="lead"><code>ADMIN_USER</code> 변수와 <code>ADMIN_PASS_HASH</code> 시크릿을 등록한 뒤 다시 열어 주세요. (notify/SETUP.md 7단계)</p>', null, 503);

  if (p === '/admin/login') return m === 'POST' ? loginPost(request, env, ctx) : page('로그인', loginForm(url.searchParams.get('e')), null);

  const s = await session(request, env);
  if (!s) return redirect(`${env.SELF}/admin/login`);
  const A = { env, ctx, request, url, s, api, csrf: await makeToken(env, { c: s.n }) };

  if (m === 'POST') {
    A.form = await request.formData().catch(() => new FormData());
    const c = await readToken(env, A.form.get('_csrf'));
    if (!c || c.c !== s.n) return page('요청 만료', '<p class="err">페이지를 새로 고친 뒤 다시 시도해 주세요.</p>', A, 400);
  }

  if (p === '/admin/logout' && m === 'POST') return redirect(`${env.SELF}/admin/login`, `${COOKIE}=; Max-Age=0; Path=/admin; Secure; HttpOnly; SameSite=Strict`);
  if (p === '/admin') return overview(A);
  if (p === '/admin/subscribers') return url.searchParams.get('format') === 'csv' ? subscribersCsv(A) : subscribers(A);
  let mm;
  if ((mm = p.match(/^\/admin\/subscribers\/([A-Za-z0-9_-]+)\/action$/)) && m === 'POST') return subscriberAction(A, mm[1]);
  if ((mm = p.match(/^\/admin\/subscribers\/([A-Za-z0-9_-]+)$/))) return subscriber(A, mm[1]);
  if (p === '/admin/sends') return sends(A);
  if ((mm = p.match(/^\/admin\/sends\/(\d+)\/retry$/)) && m === 'POST') return sendRetry(A, Number(mm[1]));
  if (p === '/admin/access') return access(A);
  if (p === '/admin/settings' && m === 'GET') return settings(A);
  if (p === '/admin/settings/password' && m === 'POST') return settingsPassword(A);
  if (p === '/admin/settings/retention' && m === 'POST') return settingsRetention(A);
  return page('없는 페이지', '<p>주소를 확인해 주세요.</p>', A, 404);
}

// ───────────────────────────────────────────── auth
async function session(request, env) {
  const c = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='));
  if (!c) return null;
  const t = await readToken(env, c.slice(COOKIE.length + 1));
  if (!t || t.a !== 1 || !t.exp || t.exp < Date.now()) return null;
  return t;
}
function loginForm(err) {
  const msg = err === 'lock' ? '로그인 실패가 잦아 15분 동안 잠겼어요.' : err === '1' ? '아이디 또는 비밀번호가 맞지 않아요.' : '';
  return `<h1>관리자 로그인</h1>
  ${msg ? `<div class="flash err">${esc(msg)}</div>` : ''}
  <form method="post" action="/admin/login" class="stack">
    <label>아이디<input name="user" autocomplete="username" required></label>
    <label>비밀번호<input name="pass" type="password" autocomplete="current-password" required></label>
    <button class="btn" type="submit">로그인</button>
  </form>`;
}
async function loginPost(request, env, ctx) {
  const form = await request.formData().catch(() => new FormData());
  const user = String(form.get('user') || ''), pass = String(form.get('pass') || '');
  const st = (await getState(env, 'login_fail')) || { n: 0, until: 0 };
  if (st.until > Date.now()) { track(env, ctx, request, 'admin_login_fail', null, { locked: true }); return redirect(`${env.SELF}/admin/login?e=lock`); }
  const stored = (await getState(env, 'pass_hash')) || env.ADMIN_PASS_HASH;
  const ok = user === env.ADMIN_USER && await pbkdf2Verify(pass, stored);
  if (!ok) {
    st.n = (st.n || 0) + 1;
    if (st.n >= LOCK_MAX) { st.until = Date.now() + LOCK_MIN * 60e3; st.n = 0; }
    await setState(env, 'login_fail', st);
    track(env, ctx, request, 'admin_login_fail', null, { user: user.slice(0, 40) });
    return redirect(`${env.SELF}/admin/login?e=${st.until > Date.now() ? 'lock' : '1'}`);
  }
  await setState(env, 'login_fail', { n: 0, until: 0 });
  const exp = Date.now() + SESSION_HOURS * 3600e3;
  const tok = await makeToken(env, { a: 1, exp, n: rand(9) });
  track(env, ctx, request, 'admin_login_ok', null, null);
  return redirect(`${env.SELF}/admin`, `${COOKIE}=${tok}; Max-Age=${SESSION_HOURS * 3600}; Path=/admin; Secure; HttpOnly; SameSite=Strict`);
}
const redirect = (loc, cookie) => new Response(null, { status: 302, headers: { location: loc, ...(cookie ? { 'set-cookie': cookie } : {}), ...NOINDEX } });
async function getState(env, key) { const r = await env.DB.prepare('SELECT value FROM admin_state WHERE key = ?').bind(key).first().catch(() => null); if (!r) return null; try { return JSON.parse(r.value); } catch { return r.value; } }
async function setState(env, key, value) { await env.DB.prepare("INSERT INTO admin_state (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(key, JSON.stringify(value)).run(); }
const audit = (A, act, target, result) => track(A.env, A.ctx, A.request, 'admin_action', target || null, { act, ...(result ? { result } : {}) });

// ───────────────────────────────────────────── overview
async function overview(A) {
  const { env } = A;
  const k = kstNow(), today = kstDate(k), dow = k.getUTCDay();
  const [byStatus, due, todaySends, lastCron, recent, daily] = await Promise.all([
    env.DB.prepare('SELECT channel, status, COUNT(*) n FROM subscribers GROUP BY channel, status').all().then(r => r.results),
    env.DB.prepare("SELECT COUNT(*) n FROM subscribers WHERE status='active' AND (','||days||',') LIKE ? AND (last_sent_date IS NULL OR last_sent_date<>?)").bind(`%,${dow},%`, today).first(),
    env.DB.prepare("SELECT COALESCE(SUM(ok),0) ok, COUNT(*)-COALESCE(SUM(ok),0) fail FROM sends WHERE kind='issue' AND date(sent_at,'+9 hours')=?").bind(today).first(),
    env.DB.prepare('SELECT * FROM cron_runs ORDER BY id DESC LIMIT 1').first().catch(() => null),
    env.DB.prepare('SELECT s.*, u.channel, u.email, u.kakao_uid FROM sends s LEFT JOIN subscribers u ON u.id=s.subscriber_id ORDER BY s.id DESC LIMIT 10').all().then(r => r.results),
    env.DB.prepare("SELECT date(sent_at,'+9 hours') d, COALESCE(SUM(ok),0) ok, COUNT(*)-COALESCE(SUM(ok),0) fail FROM sends WHERE sent_at > datetime('now','-30 days') GROUP BY d ORDER BY d").all().then(r => r.results),
  ]);
  const cnt = (ch, st) => byStatus.filter(r => (!ch || r.channel === ch) && (!st || r.status === st)).reduce((a, r) => a + r.n, 0);
  const cards = [
    ['전체 신청', cnt(), `카카오 ${cnt('kakao')} · 이메일 ${cnt('email')}`],
    ['활성', cnt(null, 'active'), `일시정지 ${cnt(null, 'paused')} · 대기 ${cnt(null, 'pending')} · 완독 ${cnt(null, 'exhausted')}`],
    ['오늘 발송', `${todaySends.ok}`, `실패 ${todaySends.fail} · 남은 예정 ${due.n}`],
    ['마지막 크론', lastCron ? kst(lastCron.ts) : '기록 없음', lastCron ? `슬롯 ${lastCron.slot} · 대상 ${lastCron.due} · 발송 ${lastCron.sent} · 오류 ${lastCron.errors}` : '마이그레이션 후 첫 실행을 기다리는 중'],
  ];
  const body = `<h1>개요</h1>
  <div class="cards">${cards.map(([t, v, sub]) => `<div class="card"><div class="k">${esc(t)}</div><div class="v">${esc(v)}</div><div class="s">${esc(sub)}</div></div>`).join('')}</div>
  <h2>최근 30일 발송</h2>${chart(daily)}
  <h2>최근 발송 10건</h2>${sendsTable(A, recent, false)}`;
  return page('개요', body, A);
}
function chart(daily) {
  const days = []; const k = kstNow();
  for (let i = 29; i >= 0; i--) { const d = new Date(k.getTime() - i * 86400e3).toISOString().slice(0, 10); const r = daily.find(x => x.d === d); days.push({ d, ok: r?.ok || 0, fail: r?.fail || 0 }); }
  const max = Math.max(1, ...days.map(x => x.ok + x.fail));
  const W = 600, H = 120, bw = W / 30;
  const bars = days.map((x, i) => {
    const h1 = (x.ok / max) * 100, h2 = (x.fail / max) * 100;
    return `<g><title>${x.d} · 성공 ${x.ok} · 실패 ${x.fail}</title>
      <rect x="${(i * bw + 2).toFixed(1)}" y="${(100 - h1 - h2 + 10).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${h2.toFixed(1)}" fill="#c62828"/>
      <rect x="${(i * bw + 2).toFixed(1)}" y="${(100 - h1 + 10).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${h1.toFixed(1)}" fill="currentColor" opacity=".75"/></g>`;
  }).join('');
  const labels = [0, 10, 20, 29].map(i => `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 2}" text-anchor="middle" font-size="9" fill="currentColor" opacity=".6">${days[i].d.slice(5)}</text>`).join('');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="최근 30일 발송">${bars}${labels}</svg><div class="legend">■ 성공 <span class="fail">■</span> 실패 · 최대 ${max}건/일</div></div>`;
}

// ───────────────────────────────────────────── subscribers
function subFilters(url) {
  const q = k => url.searchParams.get(k) || '';
  const where = [], binds = [];
  if (q('channel')) { where.push('channel = ?'); binds.push(q('channel')); }
  if (q('status')) { where.push('status = ?'); binds.push(q('status')); }
  if (q('q')) { where.push('(email LIKE ? OR kakao_uid LIKE ? OR id LIKE ?)'); const like = `%${q('q')}%`; binds.push(like, like, like); }
  return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', binds, q };
}
async function subscribers(A) {
  const { env, url } = A;
  const f = subFilters(url), pg = Math.max(1, Number(f.q('page')) || 1);
  const total = (await env.DB.prepare(`SELECT COUNT(*) n FROM subscribers ${f.where}`).bind(...f.binds).first()).n;
  const rows = (await env.DB.prepare(`SELECT * FROM subscribers ${f.where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...f.binds, PAGE, (pg - 1) * PAGE).all()).results;
  const sel = (name, opts, cur) => `<select name="${name}"><option value="">${name === 'channel' ? '채널 전체' : '상태 전체'}</option>${opts.map(o => `<option ${o === cur ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  const body = `<h1>신청자 <small>${total}명</small></h1>
  <form class="filters" method="get" action="/admin/subscribers">
    ${sel('channel', ['kakao', 'email'], f.q('channel'))} ${sel('status', ['active', 'paused', 'pending', 'exhausted'], f.q('status'))}
    <input name="q" placeholder="이메일 · 회원번호 · ID" value="${esc(f.q('q'))}">
    <button class="btn small" type="submit">검색</button>
    <a class="btn small ghost" href="/admin/subscribers?${new URLSearchParams({ channel: f.q('channel'), status: f.q('status'), q: f.q('q'), format: 'csv' })}">CSV 내보내기</a>
  </form>
  <div class="tbl"><table><thead><tr><th>채널</th><th>연락처</th><th>요일 · 시간</th><th>주제</th><th>순서</th><th>상태</th><th>받은 편</th><th>마지막 발송</th><th>실패</th><th>신청일</th></tr></thead><tbody>
  ${rows.map(u => `<tr><td>${chan(u.channel)}</td><td><a href="/admin/subscribers/${u.id}">${esc(contact(u))}</a></td><td>${esc(daysText(u.days))} ${esc(u.slot)}</td><td>${esc(u.cats || '전체')}</td><td>${u.mode === 'latest' ? '최신순' : '무작위'}</td><td>${badge(u.status)}</td><td class="num">${cntVols(u.sent_vols)}</td><td>${esc(u.last_sent_date || '')}</td><td class="num">${u.fail_count || 0}</td><td>${kst(u.created_at)}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">신청자가 없어요.</td></tr>'}
  </tbody></table></div>
  ${pager(url, pg, total, PAGE)}`;
  return page('신청자', body, A);
}
async function subscribersCsv(A) {
  const f = subFilters(A.url);
  const rows = (await A.env.DB.prepare(`SELECT * FROM subscribers ${f.where} ORDER BY created_at DESC`).bind(...f.binds).all()).results;
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['id', 'channel', 'email', 'kakao_uid', 'days', 'slot', 'cats', 'mode', 'status', 'sent_count', 'sent_vols', 'last_sent_date', 'fail_count', 'created_at'];
  const lines = [head.join(','), ...rows.map(u => [u.id, u.channel, u.email, u.kakao_uid, daysText(u.days), u.slot, u.cats, u.mode, u.status, cntVols(u.sent_vols), u.sent_vols, u.last_sent_date, u.fail_count, kst(u.created_at, true)].map(cell).join(','))];
  audit(A, 'export_csv', null, { rows: rows.length });
  return new Response('﻿' + lines.join('\r\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="subscribers-${kstDate()}.csv"`, ...NOINDEX } });
}
async function subscriber(A, id) {
  const { env, url, api } = A;
  const u = await env.DB.prepare('SELECT * FROM subscribers WHERE id = ?').bind(id).first();
  if (!u) return page('없음', '<p class="err">신청자를 찾을 수 없어요.</p>', A, 404);
  const [sends, acc, vols] = await Promise.all([
    env.DB.prepare('SELECT * FROM sends WHERE subscriber_id = ? ORDER BY id DESC LIMIT 100').bind(id).all().then(r => r.results),
    env.DB.prepare('SELECT * FROM access_log WHERE subscriber_id = ? ORDER BY id DESC LIMIT 100').bind(id).all().then(r => r.results).catch(() => []),
    api.loadVolumes(env).catch(() => []),
  ]);
  const got = (u.sent_vols || '').split(',').filter(Boolean).map(Number);
  const flash = url.searchParams.get('msg') ? `<div class="flash">${esc(url.searchParams.get('msg'))}</div>` : '';
  const act = (a, label, cls = 'ghost', confirm = '') => `<form method="post" action="/admin/subscribers/${u.id}/action" ${confirm ? `onsubmit="return confirm('${esc(confirm)}')"` : ''}><input type="hidden" name="_csrf" value="${A.csrf}"><input type="hidden" name="act" value="${a}"><button class="btn small ${cls}">${label}</button></form>`;
  const body = `${flash}<p class="crumb"><a href="/admin/subscribers">← 신청자</a></p>
  <h1>${esc(contact(u))} <small>${chan(u.channel)} ${badge(u.status)}</small></h1>
  <div class="grid2">
    <div class="box"><h3>설정</h3><dl>
      <dt>ID</dt><dd><code>${esc(u.id)}</code></dd>
      ${u.channel === 'kakao' ? `<dt>카카오 회원번호</dt><dd><code>${esc(u.kakao_uid)}</code></dd>` : `<dt>이메일</dt><dd>${esc(u.email)}</dd>`}
      <dt>요일 · 시간</dt><dd>${esc(daysText(u.days))} ${esc(u.slot)}</dd>
      <dt>주제</dt><dd>${esc(u.cats || '전체')}</dd><dt>순서</dt><dd>${u.mode === 'latest' ? '최신 편부터' : '무작위'}</dd>
      <dt>받은 편</dt><dd>${got.length}편 · 마지막 ${esc(u.last_sent_date || '없음')}</dd>
      <dt>실패 횟수</dt><dd>${u.fail_count || 0}</dd>
      <dt>신청 · 수정</dt><dd>${kst(u.created_at, true)} · ${kst(u.updated_at, true)}</dd>
    </dl></div>
    <div class="box"><h3>조치</h3><div class="actions">
      ${u.status === 'paused' ? act('resume', '다시 받기') : u.status === 'active' ? act('pause', '일시정지') : ''}
      ${act('send_now', '지금 1편 보내기', 'ghost', '지금 바로 한 편을 보낼까요? (받은 편 기록에 남습니다)')}
      ${act('test', u.channel === 'email' ? '테스트 메일' : '테스트 메시지')}
      ${act('reset', '받은 편 기록 지우기', 'ghost', '받은 편 기록을 지울까요?')}
      ${act('delete', '해지 · 삭제', 'danger', '이 신청자와 모든 기록을 삭제할까요? 되돌릴 수 없어요.')}
    </div></div>
  </div>
  <h2>받은 편 <small>${got.length}</small></h2>
  <div class="tbl"><table><thead><tr><th>Vol</th><th>제목</th><th>분류</th></tr></thead><tbody>
  ${got.map(n => { const v = vols.find(x => x.vol === n); return `<tr><td>${n}</td><td>${v ? `<a href="${esc(env.SITE)}/${esc(v.file)}" target="_blank" rel="noopener">${esc(v.title)}</a>` : '-'}</td><td>${esc(v?.cat || '')}</td></tr>`; }).join('') || '<tr><td colspan="3" class="empty">아직 없어요.</td></tr>'}
  </tbody></table></div>
  <h2>발송 기록 <small>${sends.length}</small></h2>${sendsTable(A, sends.map(s => ({ ...s, channel: u.channel, email: u.email, kakao_uid: u.kakao_uid })), true, false)}
  <h2>접속 기록 <small>${acc.length}</small></h2>${accessTable(acc, false)}`;
  return page(contact(u), body, A);
}
async function subscriberAction(A, id) {
  const { env, api, form } = A;
  const u = await env.DB.prepare('SELECT * FROM subscribers WHERE id = ?').bind(id).first();
  if (!u) return page('없음', '<p class="err">신청자를 찾을 수 없어요.</p>', A, 404);
  const act = String(form.get('act') || '');
  let msg = '';
  try {
    if (act === 'pause') { await env.DB.prepare("UPDATE subscribers SET status='paused', updated_at=datetime('now') WHERE id=?").bind(id).run(); msg = '일시정지했어요.'; }
    else if (act === 'resume') { await env.DB.prepare("UPDATE subscribers SET status='active', fail_count=0, updated_at=datetime('now') WHERE id=?").bind(id).run(); msg = '다시 받기로 바꿨어요.'; }
    else if (act === 'reset') { await env.DB.prepare("UPDATE subscribers SET sent_vols='', status=CASE WHEN status='exhausted' THEN 'active' ELSE status END, updated_at=datetime('now') WHERE id=?").bind(id).run(); msg = '받은 편 기록을 지웠어요.'; }
    else if (act === 'send_now') { const r = await api.tick(env, { id, force: true }); msg = r.sent ? '한 편을 보냈어요.' : r.exhausted ? '보낼 편이 없어 완독 안내를 보냈어요.' : `실패: ${r.errors?.[0]?.error || '알 수 없음'}`; }
    else if (act === 'test') {
      const t = await makeToken(env, { id });
      if (u.channel === 'email') { const r = await api.sendEmail(env, api.welcomeEmail(env, u, t, true)); await api.log(env, id, null, 'test', true, r.from !== env.MAIL_FROM ? `via ${r.from}` : null); }
      else { const at = await api.freshAccessToken(env, u); await api.sendToMe(at, api.textTemplate('테스트 메시지예요 🦉 알림 연결이 정상이에요.', `${env.SELF}/settings?t=${t}`, '설정 열기')); await api.log(env, id, null, 'test', true); }
      msg = '테스트를 보냈어요.';
    }
    else if (act === 'delete') {
      await env.DB.batch([env.DB.prepare('DELETE FROM subscribers WHERE id = ?').bind(id), env.DB.prepare('DELETE FROM sends WHERE subscriber_id = ?').bind(id), env.DB.prepare('DELETE FROM access_log WHERE subscriber_id = ?').bind(id)]);
      audit(A, act, id, 'ok');
      return redirect(`${env.SELF}/admin/subscribers`);
    }
    else return page('잘못된 요청', '<p class="err">알 수 없는 조치예요.</p>', A, 400);
  } catch (e) { msg = `실패: ${e.message || e}`; if (act === 'test') await api.log(env, id, null, 'test', false, e.message || String(e)); }
  audit(A, act, id, msg);
  return redirect(`${env.SELF}/admin/subscribers/${id}?msg=${encodeURIComponent(msg)}`);
}

// ───────────────────────────────────────────── sends
async function sends(A) {
  const { env, url } = A;
  const q = k => url.searchParams.get(k) || '';
  const where = [], binds = [];
  if (KINDS.includes(q('kind'))) { where.push('s.kind = ?'); binds.push(q('kind')); }
  if (q('ok') === '1' || q('ok') === '0') { where.push('s.ok = ?'); binds.push(Number(q('ok'))); }
  if (q('channel')) { where.push('u.channel = ?'); binds.push(q('channel')); }
  if (q('from')) { where.push("s.sent_at >= datetime(?, '-9 hours')"); binds.push(q('from') + ' 00:00:00'); }
  if (q('to')) { where.push("s.sent_at <= datetime(?, '-9 hours')"); binds.push(q('to') + ' 23:59:59'); }
  const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const pg = Math.max(1, Number(q('page')) || 1);
  const total = (await env.DB.prepare(`SELECT COUNT(*) n FROM sends s LEFT JOIN subscribers u ON u.id=s.subscriber_id ${W}`).bind(...binds).first()).n;
  const rows = (await env.DB.prepare(`SELECT s.*, u.channel, u.email, u.kakao_uid FROM sends s LEFT JOIN subscribers u ON u.id=s.subscriber_id ${W} ORDER BY s.id DESC LIMIT ? OFFSET ?`).bind(...binds, PAGE_LOG, (pg - 1) * PAGE_LOG).all()).results;
  const flash = q('msg') ? `<div class="flash">${esc(q('msg'))}</div>` : '';
  const body = `${flash}<h1>발송 기록 <small>${total}건</small></h1>
  <form class="filters" method="get" action="/admin/sends">
    <select name="kind"><option value="">종류 전체</option>${KINDS.map(k => `<option ${k === q('kind') ? 'selected' : ''}>${k}</option>`).join('')}</select>
    <select name="ok"><option value="">결과 전체</option><option value="1" ${q('ok') === '1' ? 'selected' : ''}>성공</option><option value="0" ${q('ok') === '0' ? 'selected' : ''}>실패</option></select>
    <select name="channel"><option value="">채널 전체</option><option ${q('channel') === 'kakao' ? 'selected' : ''}>kakao</option><option ${q('channel') === 'email' ? 'selected' : ''}>email</option></select>
    <input type="date" name="from" value="${esc(q('from'))}"> ~ <input type="date" name="to" value="${esc(q('to'))}">
    <button class="btn small" type="submit">적용</button>
  </form>
  ${sendsTable(A, rows, true, true)}
  ${pager(url, pg, total, PAGE_LOG)}`;
  return page('발송 기록', body, A);
}
async function sendRetry(A, sid) {
  const { env, api } = A;
  const s = await env.DB.prepare('SELECT * FROM sends WHERE id = ?').bind(sid).first();
  if (!s) return page('없음', '<p class="err">기록을 찾을 수 없어요.</p>', A, 404);
  const r = await api.tick(env, { id: s.subscriber_id, force: true });
  const msg = r.sent ? '다시 보냈어요.' : r.exhausted ? '보낼 편이 없어 완독 안내를 보냈어요.' : `실패: ${r.errors?.[0]?.error || (r.due === 0 ? '신청자가 없어요' : '알 수 없음')}`;
  audit(A, 'retry', s.subscriber_id, msg);
  return redirect(`${env.SELF}/admin/sends?msg=${encodeURIComponent(msg)}`);
}
function sendsTable(A, rows, withSub = true, withRetry = false) {
  return `<div class="tbl"><table><thead><tr><th>일시</th>${withSub ? '<th>신청자</th>' : '<th>신청자</th>'}<th>종류</th><th>Vol</th><th>결과</th><th>메모 · 오류</th>${withRetry ? '<th></th>' : ''}</tr></thead><tbody>
  ${rows.map(s => `<tr><td>${kst(s.sent_at)}</td><td>${s.subscriber_id ? `<a href="/admin/subscribers/${esc(s.subscriber_id)}">${esc(contact(s))}</a>` : '-'}</td><td>${esc(s.kind)}</td><td class="num">${s.vol ?? ''}</td><td>${s.ok ? '<span class="ok">성공</span>' : '<span class="fail">실패</span>'}</td><td class="err-cell">${esc(s.error || '')}</td>${withRetry ? `<td>${!s.ok && s.subscriber_id && s.channel ? `<form method="post" action="/admin/sends/${s.id}/retry"><input type="hidden" name="_csrf" value="${A.csrf}"><button class="btn small ghost">재시도</button></form>` : ''}</td>` : ''}</tr>`).join('') || `<tr><td colspan="7" class="empty">기록이 없어요.</td></tr>`}
  </tbody></table></div>`;
}

// ───────────────────────────────────────────── access log + cron runs
async function access(A) {
  const { env, url } = A;
  const q = k => url.searchParams.get(k) || '';
  const where = [], binds = [];
  if (EVENTS.includes(q('event'))) { where.push('event = ?'); binds.push(q('event')); }
  if (q('from')) { where.push("ts >= datetime(?, '-9 hours')"); binds.push(q('from') + ' 00:00:00'); }
  if (q('to')) { where.push("ts <= datetime(?, '-9 hours')"); binds.push(q('to') + ' 23:59:59'); }
  const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const pg = Math.max(1, Number(q('page')) || 1);
  let total = 0, rows = [], crons = [];
  try {
    total = (await env.DB.prepare(`SELECT COUNT(*) n FROM access_log ${W}`).bind(...binds).first()).n;
    rows = (await env.DB.prepare(`SELECT * FROM access_log ${W} ORDER BY id DESC LIMIT ? OFFSET ?`).bind(...binds, PAGE_LOG, (pg - 1) * PAGE_LOG).all()).results;
    crons = (await env.DB.prepare('SELECT * FROM cron_runs ORDER BY id DESC LIMIT 30').all()).results;
  } catch { return page('접속 기록', '<h1>접속 기록</h1><p class="err">access_log 테이블이 없어요. migrate-002-admin.sql을 적용해 주세요.</p>', A); }
  const body = `<h1>접속 기록 <small>${total}건</small></h1>
  <form class="filters" method="get" action="/admin/access">
    <select name="event"><option value="">이벤트 전체</option>${EVENTS.map(e => `<option ${e === q('event') ? 'selected' : ''}>${e}</option>`).join('')}</select>
    <input type="date" name="from" value="${esc(q('from'))}"> ~ <input type="date" name="to" value="${esc(q('to'))}">
    <button class="btn small" type="submit">적용</button>
  </form>
  ${accessTable(rows, true)}
  ${pager(url, pg, total, PAGE_LOG)}
  <h2>크론 실행 <small>최근 30회</small></h2>
  <div class="tbl"><table><thead><tr><th>일시</th><th>슬롯</th><th>대상</th><th>발송</th><th>완독</th><th>오류</th><th>소요</th></tr></thead><tbody>
  ${crons.map(c => `<tr><td>${kst(c.ts)}</td><td>${esc(c.slot || '')}</td><td class="num">${c.due}</td><td class="num">${c.sent}</td><td class="num">${c.exhausted}</td><td class="num">${c.errors ? `<span class="fail">${c.errors}</span>` : 0}</td><td class="num">${c.duration_ms ?? ''}ms</td></tr>`).join('') || '<tr><td colspan="7" class="empty">아직 실행 기록이 없어요.</td></tr>'}
  </tbody></table></div>`;
  return page('접속 기록', body, A);
}
function accessTable(rows, withSub) {
  return `<div class="tbl"><table><thead><tr><th>일시</th><th>이벤트</th>${withSub ? '<th>신청자</th>' : ''}<th>경로</th><th>국가</th><th>IP(해시)</th><th>기기</th><th>메모</th></tr></thead><tbody>
  ${rows.map(r => `<tr><td>${kst(r.ts)}</td><td>${esc(r.event)}</td>${withSub ? `<td>${r.subscriber_id ? `<a href="/admin/subscribers/${esc(r.subscriber_id)}">${esc(r.subscriber_id.slice(0, 8))}…</a>` : ''}</td>` : ''}<td>${esc(r.path || '')}</td><td>${esc(r.country || '')}</td><td><code>${esc(r.ip_hash || '')}</code></td><td class="ua">${esc(uaShort(r.ua))}</td><td class="err-cell">${esc(r.meta || '')}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">기록이 없어요.</td></tr>'}
  </tbody></table></div>`;
}

// ───────────────────────────────────────────── settings
async function settings(A) {
  const { env, url } = A;
  const q = k => url.searchParams.get(k) || '';
  let status = null;
  try { status = await (await fetch(`${env.SELF}/health?deep=1`)).json(); } catch {}
  const ret = (await getState(env, 'retention')) || { access: 90, sends: 365 };
  const custom = !!(await getState(env, 'pass_hash'));
  const flash = q('msg') ? `<div class="flash ${q('err') ? 'err' : ''}">${esc(q('msg'))}</div>` : '';
  const li = (k, v, ok) => `<li><span class="${ok === true ? 'ok' : ok === false ? 'fail' : ''}">●</span> ${esc(k)}: ${esc(v)}</li>`;
  const body = `${flash}<h1>설정</h1>
  <div class="grid2">
    <div class="box"><h3>관리자 비밀번호</h3>
      <p class="fine">아이디 <code>${esc(env.ADMIN_USER)}</code> · 현재 비밀번호는 ${custom ? '이 화면에서 바꾼 값' : '시크릿(ADMIN_PASS_HASH)의 값'}이에요.</p>
      <form method="post" action="/admin/settings/password" class="stack">
        <input type="hidden" name="_csrf" value="${A.csrf}">
        <label>현재 비밀번호<input name="cur" type="password" autocomplete="current-password" required></label>
        <label>새 비밀번호 <small>(8자 이상)</small><input name="new" type="password" autocomplete="new-password" minlength="8" required></label>
        <label>새 비밀번호 확인<input name="new2" type="password" autocomplete="new-password" minlength="8" required></label>
        <button class="btn small" type="submit">바꾸기</button>
      </form></div>
    <div class="box"><h3>연동 상태</h3>
      ${status ? `<ul class="status">
        ${li('카카오 키·시크릿', status.ready ? (status.secret === 'ok' ? '정상' : `확인 필요 (${status.secret})`) : '미설정', status.ready && status.secret === 'ok')}
        ${li('Resend 키', status.email ? (status.resend === 'ok' ? '정상' : String(status.resend)) : '미설정', status.email && status.resend === 'ok')}
        ${li('발신 주소', status.mail_from || env.MAIL_FROM || '-', null)}
        ${li('회신 주소', env.MAIL_REPLY_TO || '-', null)}
        ${li('발신 도메인 검증', status.mail_from_verified === true ? '검증됨' : status.mail_from_verified === false ? '미검증 (키가 도메인 조회 권한이 없으면 실제 발송 기록의 via 표시로 판단)' : '알 수 없음', status.mail_from_verified === true ? true : null)}
      </ul>` : '<p class="err">상태를 불러오지 못했어요.</p>'}
      <h3>로그 보존</h3>
      <form method="post" action="/admin/settings/retention" class="inline">
        <input type="hidden" name="_csrf" value="${A.csrf}">
        접속 기록 <input name="access" type="number" min="7" max="3650" value="${ret.access}" class="w4">일 ·
        발송 기록 <input name="sends" type="number" min="30" max="3650" value="${ret.sends}" class="w4">일
        <button class="btn small" type="submit">저장</button>
      </form>
      <p class="fine">매일 04:00(KST) 이후 첫 크론에서 기한이 지난 기록을 지워요.</p>
    </div>
  </div>`;
  return page('설정', body, A);
}
async function settingsPassword(A) {
  const { env, form } = A;
  const cur = String(form.get('cur') || ''), nw = String(form.get('new') || ''), nw2 = String(form.get('new2') || '');
  const stored = (await getState(env, 'pass_hash')) || env.ADMIN_PASS_HASH;
  if (!(await pbkdf2Verify(cur, stored))) return redirect(`${env.SELF}/admin/settings?err=1&msg=${encodeURIComponent('현재 비밀번호가 맞지 않아요.')}`);
  if (nw.length < 8 || nw !== nw2) return redirect(`${env.SELF}/admin/settings?err=1&msg=${encodeURIComponent('새 비밀번호가 8자 미만이거나 확인이 다릅니다.')}`);
  await setState(env, 'pass_hash', await pbkdf2Hash(nw));
  audit(A, 'password_change', null, 'ok');
  return redirect(`${env.SELF}/admin/settings?msg=${encodeURIComponent('비밀번호를 바꿨어요. 다음 로그인부터 적용돼요.')}`);
}
async function settingsRetention(A) {
  const { env, form } = A;
  const access = Math.min(3650, Math.max(7, Number(form.get('access')) || 90)), sends = Math.min(3650, Math.max(30, Number(form.get('sends')) || 365));
  await setState(env, 'retention', { access, sends });
  audit(A, 'retention', null, { access, sends });
  return redirect(`${env.SELF}/admin/settings?msg=${encodeURIComponent(`보존 기간을 접속 ${access}일 · 발송 ${sends}일로 저장했어요.`)}`);
}

// ───────────────────────────────────────────── cron hooks (called from index.js scheduled())
export async function recordCron(env, r, ms) {
  await env.DB.prepare('INSERT INTO cron_runs (slot, due, sent, exhausted, errors, duration_ms) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(r.slot || null, r.due || 0, r.sent || 0, r.exhausted || 0, (r.errors || []).length, ms).run().catch(() => {});
}
export async function maybePrune(env) {
  try {
    const k = kstNow(); if (k.getUTCHours() < 4) return;
    const today = kstDate(k);
    if ((await getState(env, 'last_prune_date')) === today) return;
    const ret = (await getState(env, 'retention')) || { access: 90, sends: 365 };
    await env.DB.batch([
      env.DB.prepare("DELETE FROM access_log WHERE ts < datetime('now', ?)").bind(`-${ret.access} days`),
      env.DB.prepare("DELETE FROM cron_runs WHERE ts < datetime('now', ?)").bind(`-${ret.access} days`),
      env.DB.prepare("DELETE FROM sends WHERE sent_at < datetime('now', ?)").bind(`-${ret.sends} days`),
    ]);
    await setState(env, 'last_prune_date', today);
  } catch {}
}

// ───────────────────────────────────────────── small helpers
const chan = c => c === 'kakao' ? '<span class="pill k">카카오</span>' : '<span class="pill e">이메일</span>';
const badge = st => `<span class="pill s-${esc(st)}">${{ active: '활성', paused: '일시정지', pending: '대기', exhausted: '완독' }[st] || esc(st)}</span>`;
const contact = u => u.channel === 'kakao' || (!u.email && u.kakao_uid) ? `카카오 ${String(u.kakao_uid || '').slice(0, 4)}…` : (u.email || '-');
const daysText = d => { const a = String(d || '').split(',').filter(Boolean).map(Number); return a.length === 7 ? '매일' : a.map(x => DAYS[x]).join('·'); };
const cntVols = s => String(s || '').split(',').filter(Boolean).length;
const uaShort = ua => { ua = ua || ''; const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''; const br = /KAKAOTALK/i.test(ua) ? '카카오톡' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : /curl/i.test(ua) ? 'curl' : ''; return [os, br].filter(Boolean).join(' · ') || ua.slice(0, 24); };
function pager(url, pg, total, size) {
  const pages = Math.max(1, Math.ceil(total / size)); if (pages <= 1) return '';
  const link = n => { const u = new URL(url); u.searchParams.set('page', n); return u.pathname + u.search; };
  return `<div class="pager">${pg > 1 ? `<a href="${link(pg - 1)}">← 이전</a>` : ''}<span>${pg} / ${pages}</span>${pg < pages ? `<a href="${link(pg + 1)}">다음 →</a>` : ''}</div>`;
}

function page(title, body, A, status = 200) {
  const nav = A ? `<nav class="top"><a class="brand" href="/admin">PLI · 알림 관리</a>
    ${[['/admin', '개요'], ['/admin/subscribers', '신청자'], ['/admin/sends', '발송'], ['/admin/access', '접속'], ['/admin/settings', '설정']].map(([h, t]) => `<a href="${h}" class="${A.url.pathname === h || (h !== '/admin' && A.url.pathname.startsWith(h)) ? 'on' : ''}">${t}</a>`).join('')}
    <form method="post" action="/admin/logout" class="logout"><input type="hidden" name="_csrf" value="${A.csrf}"><button class="lnk">로그아웃</button></form></nav>` : '<div class="brand solo">PLI · 알림 관리</div>';
  return html(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="light dark"><title>${esc(title)} · PLI 알림 관리</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=Gowun+Batang:wght@700&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
<style>
:root{--bg:#fff;--surface:#f6f6f6;--ink:#0a0a0a;--ink-2:#2b2b2b;--muted:#707070;--line:rgba(0,0,0,.12);--accent:#0a0a0a;--ok:#2e7d32;--fail:#c62828}
@media(prefers-color-scheme:dark){:root{--bg:#0f0f0f;--surface:#171717;--ink:#f2f2f2;--ink-2:#d6d6d6;--muted:#9a9a9a;--line:rgba(255,255,255,.14);--accent:#f2f2f2;--ok:#66bb6a;--fail:#ef5350}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:'Inter Tight','Noto Sans KR',sans-serif;-webkit-font-smoothing:antialiased;font-size:14.5px}
a{color:inherit}.wrap{max-width:1100px;margin:0 auto;padding:22px 20px 60px}
.top{display:flex;align-items:center;gap:18px;padding:12px 0 16px;border-bottom:1px solid var(--line);margin-bottom:22px;flex-wrap:wrap}
.brand{font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);text-decoration:none;margin-right:6px}.brand.solo{margin:0 0 24px}
.top a:not(.brand){text-decoration:none;font-weight:500;color:var(--ink-2);padding:6px 2px;border-bottom:2px solid transparent}.top a.on{border-color:var(--accent);color:var(--ink)}
.logout{margin-left:auto}.lnk{background:none;border:0;font:inherit;color:var(--muted);cursor:pointer;text-decoration:underline}
h1{font-family:'Gowun Batang',serif;font-size:26px;margin:0 0 16px;letter-spacing:-.01em}h1 small,h2 small{font-family:'Inter Tight',sans-serif;font-size:14px;color:var(--muted);font-weight:400;margin-left:6px}
h2{font-size:15px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:30px 0 10px}h3{font-size:14px;margin:0 0 10px;color:var(--muted);letter-spacing:.04em}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.card .k{font-size:12px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase}.card .v{font-family:'Gowun Batang',serif;font-size:30px;margin:6px 0 4px}.card .s{font-size:12.5px;color:var(--muted)}
.chart{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 16px 8px;color:var(--ink)}.legend{font-size:12px;color:var(--muted);margin-top:4px}.legend .fail{color:var(--fail)}
.tbl{overflow-x:auto;border:1px solid var(--line);border-radius:12px}table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap;vertical-align:top}
th{font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);background:var(--surface)}tr:last-child td{border-bottom:0}td.num{text-align:right;font-variant-numeric:tabular-nums}td.empty{color:var(--muted);text-align:center;padding:22px}
td.err-cell{white-space:normal;max-width:420px;color:var(--ink-2);font-size:12.5px}td.ua{color:var(--muted)}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid var(--line);background:var(--surface)}.pill.k{background:#FEE500;color:#191919;border-color:#FEE500}.pill.e{background:#e8f0fe;color:#1a3e6b;border-color:#e8f0fe}
.s-active{color:var(--ok)}.s-paused{color:#b26a00}.s-pending{color:var(--muted)}.s-exhausted{color:#1a3e6b}.ok{color:var(--ok)}.fail{color:var(--fail)}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}.filters input,.filters select,.stack input,.inline input{font:inherit;padding:8px 11px;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--ink)}
.btn{display:inline-flex;align-items:center;font:inherit;font-weight:600;font-size:14px;background:var(--accent);color:var(--bg);border:1px solid var(--accent);border-radius:999px;padding:10px 18px;cursor:pointer;text-decoration:none}
.btn.small{padding:7px 14px;font-size:13px}.btn.ghost{background:transparent;color:var(--ink);border-color:var(--line)}.btn.ghost:hover{border-color:var(--ink)}.btn.danger{background:transparent;color:var(--fail);border-color:var(--fail)}
.flash{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:11px 15px;margin-bottom:16px}.flash.err,.err{color:var(--fail)}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}.box{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
dl{display:grid;grid-template-columns:110px 1fr;gap:6px 12px;margin:0;font-size:13.5px}dt{color:var(--muted)}dd{margin:0;word-break:break-all}
.actions{display:flex;flex-wrap:wrap;gap:8px}.actions form{margin:0}.stack{display:flex;flex-direction:column;gap:10px;max-width:360px}.stack label{display:flex;flex-direction:column;gap:5px;font-size:13px;color:var(--muted)}
.inline{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13.5px}.w4{width:80px}.status{list-style:none;padding:0;margin:0 0 18px;font-size:13.5px;line-height:1.9}
.pager{display:flex;gap:14px;align-items:center;justify-content:center;margin-top:14px;color:var(--muted)}.crumb{margin:0 0 8px;font-size:13px}.crumb a{color:var(--muted);text-decoration:none}
.fine{font-size:12.5px;color:var(--muted);line-height:1.6}code{font-family:'JetBrains Mono',monospace;font-size:12px}
</style></head><body><div class="wrap">${nav}${body}</div></body></html>`, status, NOINDEX);
}
