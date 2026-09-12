/**
 * pli-notify — 매주 리더십 인사이트 알림 (카카오톡 '나에게 보내기' · 이메일)
 *
 * Routes
 *   GET  /kakao/start            → Kakao consent (scope: talk_message)
 *   GET  /kakao/callback         → code → tokens → subscriber upsert → /settings
 *   POST /email/start            → email address → pending subscriber → "설정 링크" mail (Resend)
 *   GET  /email/preview?vol=&kind= → render an email template (issue | welcome | link | exhausted) for design checks
 *   GET  /settings?t=            → preferences page (also the manage page; no login) — same for both channels
 *   POST /settings               → save; first save activates + sends a welcome message/mail
 *   POST /pause  /resume  /unsubscribe  /reset   (form posts from the settings page)
 *   GET  /unsubscribe?t=         → confirm page (linked from mails; one-click POST also accepted)
 *   POST /cron/run               → Bearer CRON_SECRET · manual tick (?id=…&force=1 to test one subscriber)
 *   GET  /health                 → {ok, ready, email}  (?deep=1 also probes the Kakao client secret)
 * Cron (every 5 minutes) → tick(): for each active subscriber whose day+slot matches KST now and who
 *   hasn't been sent today, pick an unsent issue (random or latest, optional category filter) and
 *   deliver it — Kakao feed card (OG image) or an HTML mail with cover, dek, term box and the opening
 *   paragraphs pulled live from the published page — then record it.
 *
 * Patterns borrowed from 99wisdombook/functions/api/[[path]].js (token exchange, refresh
 * rotation, feed template, CRON_SECRET trigger, Resend); differences: no user accounts, encrypted
 * refresh tokens, per-subscriber no-repeat selection, native Cron Trigger.
 */

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const CATS = ['전략', '사람', '판단', '책임', '성장', '성찰', '역사'];
const SLOTS = (() => { const a = []; for (let h = 7; h <= 22; h++) for (const m of ['00', '30']) if (!(h === 22 && m === '30')) a.push(`${String(h).padStart(2, '0')}:${m}`); return a; })();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default {
  async fetch(request, env, ctx) {
    try { return await route(request, env, ctx); }
    catch (e) { return html(page('오류', `<p class="err">${esc(e.message || String(e))}</p>`), 500); }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(tick(env, {})); },
};

// ───────────────────────────────────────────── routing
async function route(request, env, ctx) {
  const url = new URL(request.url);
  const p = url.pathname, m = request.method;

  // the site probes this before showing the "카카오톡으로 받기" button, so allow cross-origin reads
  if (p === '/health') {
    const body = { ok: true, ready: !!(env.KAKAO_REST_API_KEY && env.KAKAO_CLIENT_SECRET), email: !!env.RESEND_API_KEY, time: new Date().toISOString() };
    // ?deep=1 → ask kauth with a bogus code; the error code tells whether the app key + client secret are accepted
    // (KOE320 = credentials fine, code rejected · KOE010 = client secret mismatch · KOE101 = unknown app key)
    if (url.searchParams.get('deep') === '1' && body.ready) {
      const r = await fetch('https://kauth.kakao.com/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: env.KAKAO_REST_API_KEY, client_secret: env.KAKAO_CLIENT_SECRET,
          redirect_uri: env.KAKAO_REDIRECT_URI, code: 'probe' }),
      });
      const d = await r.json().catch(() => ({}));
      body.probe = d.error_code || d.error || 'ok';
      body.secret = d.error_code === 'KOE320' ? 'ok' : d.error_code === 'KOE010' ? 'mismatch' : 'unknown';
    }
    // ?deep=1 with the email key set → which sender domains Resend has, and whether MAIL_FROM's domain is verified
    if (url.searchParams.get('deep') === '1' && env.RESEND_API_KEY) {
      const k = env.RESEND_API_KEY;
      body.resend_key = { len: k.length, prefix: k.slice(0, 3) };   // shape only — never the value
      // empty POST: a valid key gets a 422 validation error, an invalid one 401/400
      const p = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' }, body: '{}' });
      const pd = await p.json().catch(() => ({}));
      body.resend = /api key/i.test(pd.message || '') ? `invalid (${pd.message})`
                  : p.status === 422 || /missing|required/i.test(pd.message || '') ? 'ok' : `unknown (${p.status} ${pd.message || ''})`.trim();
      const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${k}` } });
      const d = await r.json().catch(() => ({}));
      body.email_domains = r.ok ? (d.data || []).map(x => ({ name: x.name, status: x.status, region: x.region })) : `resend ${r.status} ${d.message || ''}`.trim();
      const dom = (env.MAIL_FROM.match(/@([^>\s]+)/) || [])[1];
      body.mail_from = env.MAIL_FROM;
      body.mail_from_verified = r.ok ? (d.data || []).some(x => x.name === dom && x.status === 'verified') : null;
    }
    return new Response(JSON.stringify(body),
      { headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': env.SITE, 'cache-control': 'no-store' } });
  }
  if (p === '/' ) return Response.redirect(`${env.SITE}/#subscribe`, 302);

  if (p === '/kakao/start' && m === 'GET') return kakaoStart(env);
  if (p === '/kakao/callback' && m === 'GET') return kakaoCallback(url, env, ctx);

  if (p === '/email/start' && m === 'POST') return emailStart(request, env, ctx);
  if (p === '/email/preview' && m === 'GET') return emailPreview(url, env);

  if (p === '/settings' && m === 'GET') return settingsPage(url, env);
  if (p === '/settings' && m === 'POST') return settingsSave(request, env, ctx);
  if (p === '/unsubscribe' && m === 'GET') return unsubscribePage(url, env);
  if (['/pause', '/resume', '/unsubscribe', '/reset'].includes(p) && m === 'POST') return settingsAction(p.slice(1), request, env);

  if (p === '/cron/run' && m === 'POST') {
    const auth = request.headers.get('Authorization') || '';
    if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) return json({ error: 'unauthorized' }, 401);
    const r = await tick(env, { id: url.searchParams.get('id'), force: url.searchParams.get('force') === '1' });
    return json(r);
  }
  return html(page('없는 페이지', '<p>주소를 확인해 주세요.</p>'), 404);
}

// ───────────────────────────────────────────── kakao oauth
async function kakaoStart(env) {
  if (!env.KAKAO_REST_API_KEY || !env.KAKAO_CLIENT_SECRET)
    return html(page('준비 중', '<p>카카오톡 알림 신청은 잠시 뒤에 열려요. 조금만 기다려 주세요.</p>' + backLink(env)), 503);
  const state = await makeToken(env, { n: rand(12), t: Date.now() });
  const q = new URLSearchParams({
    client_id: env.KAKAO_REST_API_KEY, redirect_uri: env.KAKAO_REDIRECT_URI,
    response_type: 'code', scope: 'talk_message', state,
  });
  return Response.redirect('https://kauth.kakao.com/oauth/authorize?' + q, 302);
}

async function kakaoCallback(url, env, ctx) {
  const code = url.searchParams.get('code'), state = url.searchParams.get('state');
  if (!code) return html(page('취소됨', '<p>카카오 동의가 취소되었어요.</p>' + backLink(env)));
  const st = await readToken(env, state);
  if (!st || Date.now() - st.t > 15 * 60e3) return html(page('만료됨', '<p>인증 요청이 만료되었어요. 다시 시도해 주세요.</p>' + backLink(env)), 400);

  const tok = await kakaoToken(env, { grant_type: 'authorization_code', redirect_uri: env.KAKAO_REDIRECT_URI, code });
  if (!tok.refresh_token) return html(page('권한 필요', '<p>카카오톡 메시지 전송 권한이 없어요. 동의 화면에서 <b>카카오톡 메시지 전송</b>을 허용해 주세요.</p>' + backLink(env)), 400);
  const me = await kakaoMe(tok.access_token);
  const uid = String(me.id);

  let sub = await env.DB.prepare('SELECT * FROM subscribers WHERE kakao_uid = ?').bind(uid).first();
  const enc = await encrypt(env, tok.refresh_token);
  if (sub) {
    await env.DB.prepare("UPDATE subscribers SET refresh_token_enc = ?, fail_count = 0, updated_at = datetime('now') WHERE id = ?").bind(enc, sub.id).run();
  } else {
    sub = { id: rand(16), kakao_uid: uid };
    await env.DB.prepare("INSERT INTO subscribers (id, channel, kakao_uid, refresh_token_enc) VALUES (?, 'kakao', ?, ?)").bind(sub.id, uid, enc).run();
  }
  const t = await makeToken(env, { id: sub.id });
  return Response.redirect(`${env.SELF}/settings?t=${t}`, 302);
}

// ───────────────────────────────────────────── email sign-up
async function emailStart(request, env, ctx) {
  const ct = request.headers.get('content-type') || '';
  let email = '';
  if (ct.includes('application/json')) email = (await request.json().catch(() => ({}))).email;
  else email = (await request.formData().catch(() => new FormData())).get('email');
  email = String(email || '').trim().toLowerCase();

  const wantsJson = (request.headers.get('accept') || '').includes('application/json');
  const cors = { 'access-control-allow-origin': env.SITE };
  const reply = (ok, msg, status = 200) => wantsJson
    ? new Response(JSON.stringify({ ok, msg }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors } })
    : html(page(ok ? '메일을 확인해 주세요' : '다시 시도해 주세요', `<h1>${ok ? '메일을 보냈어요' : '앗'}</h1><p class="lead">${esc(msg)}</p>` + backLink(env)), status);

  if (!EMAIL_RE.test(email) || email.length > 254) return reply(false, '이메일 주소를 다시 확인해 주세요.', 400);
  if (!env.RESEND_API_KEY) return reply(false, '이메일 알림은 잠시 뒤에 열려요. 지금은 카카오톡으로 받기를 이용해 주세요.', 503);

  let sub = await env.DB.prepare('SELECT * FROM subscribers WHERE email = ?').bind(email).first();
  if (!sub) {
    sub = { id: rand(16), channel: 'email', email, status: 'pending', days: '1', slot: '08:00' };
    await env.DB.prepare("INSERT INTO subscribers (id, channel, email) VALUES (?, 'email', ?)").bind(sub.id, email).run();
  }
  const t = await makeToken(env, { id: sub.id });
  ctx.waitUntil(sendEmail(env, linkEmail(env, sub, t))
    .then(r => log(env, sub.id, null, 'link', true, via(env, r)), e => log(env, sub.id, null, 'link', false, e.message || String(e))));
  return reply(true, `${email} 로 설정 링크를 보냈어요. 메일의 버튼을 누르면 요일·시간·주제를 고를 수 있어요. 안 보이면 스팸함도 확인해 주세요.`);
}

async function emailPreview(url, env) {
  const vols = await loadVolumes(env);
  const n = Number(url.searchParams.get('vol')) || vols[vols.length - 1].vol;
  const v = vols.find(x => x.vol === n) || vols[vols.length - 1];
  const sub = { id: 'preview', channel: 'email', email: 'you@example.com', days: url.searchParams.get('days') || '1,5', slot: url.searchParams.get('slot') || '08:00', status: 'active' };
  const kind = url.searchParams.get('kind') || 'issue';
  const t = 'preview';
  const m = kind === 'welcome' ? welcomeEmail(env, sub, t)
          : kind === 'link' ? linkEmail(env, sub, t)
          : kind === 'exhausted' ? exhaustedEmail(env, sub, t, vols.length)
          : await issueEmail(env, sub, v, t);
  return url.searchParams.get('text') ? new Response(m.text, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
       : new Response(m.html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-subject': encodeURIComponent(m.subject) } });
}

// ───────────────────────────────────────────── settings / manage
async function subFromToken(url_or_req, env) {
  const t = url_or_req instanceof URL ? url_or_req.searchParams.get('t') : null;
  const tok = await readToken(env, t);
  if (!tok?.id) return null;
  return env.DB.prepare('SELECT * FROM subscribers WHERE id = ?').bind(tok.id).first();
}

async function settingsPage(url, env) {
  const sub = await subFromToken(url, env);
  if (!sub) return html(page('링크 만료', '<p>이 링크는 더 이상 유효하지 않아요. 홈에서 다시 신청해 주세요.</p>' + backLink(env)), 401);
  const t = url.searchParams.get('t');
  const isEmail = sub.channel === 'email';
  const flash = url.searchParams.get('saved') ? (isEmail ? '설정을 저장했어요. 메일함에서 환영 메일을 확인해 보세요.' : '설정을 저장했어요. 카카오톡 <b>나와의 채팅</b>을 확인해 보세요.') :
                url.searchParams.get('resumed') ? '알림을 다시 켰어요.' :
                url.searchParams.get('reset') ? '받은 편 기록을 지웠어요. 다시 처음부터 골라 보내드릴게요.' : '';
  return html(page('알림 설정', settingsForm(sub, t, flash, env)));
}

function settingsForm(sub, t, flash, env) {
  const days = new Set((sub.days || '').split(',').filter(Boolean).map(Number));
  const cats = new Set((sub.cats || '').split(',').filter(Boolean));
  const sent = (sub.sent_vols || '').split(',').filter(Boolean).length;
  const isNew = sub.status === 'pending';
  const paused = sub.status === 'paused';
  const isEmail = sub.channel === 'email';
  const dest = isEmail ? `이메일 <b>${esc(sub.email)}</b>로` : '카카오톡 <b>나와의 채팅</b>으로';
  return `
  ${flash ? `<div class="flash">${flash}</div>` : ''}
  <h1>${isNew ? '언제 받을까요?' : '알림 설정'}</h1>
  <p class="lead">${isNew ? `원하는 요일·시간에, 아직 읽지 않은 편을 한 편씩 ${dest} 보내드려요.` :
      `${paused ? '지금은 <b>일시정지</b> 상태예요. ' : ''}${dest} 지금까지 <b>${sent}편</b>을 받으셨어요.`}</p>
  <form method="post" action="/settings">
    <input type="hidden" name="t" value="${esc(t)}">
    <fieldset><legend>요일</legend><div class="chips">
      ${DAYS.map((d, i) => `<label class="chip"><input type="checkbox" name="days" value="${i}" ${days.has(i) ? 'checked' : ''}><span>${d}</span></label>`).join('')}
    </div></fieldset>
    <fieldset><legend>시간 <small>(07:00–22:00, 30분 단위)</small></legend>
      <select name="slot">${SLOTS.map(s => `<option ${s === sub.slot ? 'selected' : ''}>${s}</option>`).join('')}</select>
    </fieldset>
    <fieldset><legend>주제 <small>(비우면 전체)</small></legend><div class="chips">
      ${CATS.map(c => `<label class="chip"><input type="checkbox" name="cats" value="${c}" ${cats.has(c) ? 'checked' : ''}><span>${c}</span></label>`).join('')}
    </div></fieldset>
    <fieldset><legend>순서</legend><div class="chips">
      <label class="chip"><input type="radio" name="mode" value="random" ${sub.mode !== 'latest' ? 'checked' : ''}><span>무작위</span></label>
      <label class="chip"><input type="radio" name="mode" value="latest" ${sub.mode === 'latest' ? 'checked' : ''}><span>최신 편부터</span></label>
    </div></fieldset>
    ${isNew ? `<label class="consent"><input type="checkbox" name="consent" required> 위 시간에 ${isEmail ? '이메일로' : "카카오톡 '나와의 채팅'으로"} 인사이트를 받는 데 동의해요. 언제든 그만 받을 수 있어요.</label>` : ''}
    <button class="btn" type="submit">${isNew ? '알림 시작하기' : '저장'}</button>
  </form>
  ${isNew ? '' : `
  <div class="row">
    <form method="post" action="${paused ? '/resume' : '/pause'}"><input type="hidden" name="t" value="${esc(t)}"><button class="btn ghost">${paused ? '다시 받기' : '일시정지'}</button></form>
    <form method="post" action="/reset"><input type="hidden" name="t" value="${esc(t)}"><button class="btn ghost">받은 편 기록 지우기</button></form>
    <form method="post" action="/unsubscribe" onsubmit="return confirm('정말 그만 받을까요? 설정과 연결 정보가 모두 삭제돼요.')"><input type="hidden" name="t" value="${esc(t)}"><button class="btn danger">그만 받기</button></form>
  </div>`}
  <p class="fine">저장하는 정보는 ${isEmail ? '이메일 주소와 위 설정뿐이에요. 이름·전화번호는 받지 않아요.' : '카카오 회원번호, 암호화된 발송 토큰, 위 설정뿐이에요. 이름·전화번호·이메일은 받지 않아요.'} 그만 받기를 누르면 즉시 삭제돼요. · <a href="${env.SITE}/">projectleadership.cc</a></p>`;
}

async function settingsSave(request, env, ctx) {
  const form = await request.formData();
  const tok = await readToken(env, form.get('t'));
  if (!tok?.id) return html(page('링크 만료', '<p>이 링크는 더 이상 유효하지 않아요.</p>' + backLink(env)), 401);
  const sub = await env.DB.prepare('SELECT * FROM subscribers WHERE id = ?').bind(tok.id).first();
  if (!sub) return html(page('없음', '<p>구독 정보를 찾을 수 없어요.</p>' + backLink(env)), 404);

  const days = form.getAll('days').map(Number).filter(d => d >= 0 && d <= 6).sort();
  const slot = SLOTS.includes(form.get('slot')) ? form.get('slot') : '08:00';
  const cats = form.getAll('cats').filter(c => CATS.includes(c));
  const mode = form.get('mode') === 'latest' ? 'latest' : 'random';
  if (!days.length) return html(page('요일 필요', '<p>요일을 하나 이상 골라 주세요.</p><p><a href="/settings?t=' + esc(form.get('t')) + '">돌아가기</a></p>'), 400);
  const first = sub.status === 'pending';
  const status = first || sub.status === 'exhausted' ? 'active' : sub.status;
  await env.DB.prepare("UPDATE subscribers SET days=?, slot=?, cats=?, mode=?, status=?, updated_at=datetime('now') WHERE id=?")
    .bind(days.join(','), slot, cats.join(','), mode, status, sub.id).run();

  if (first) ctx.waitUntil(sendWelcome(env, { ...sub, days: days.join(','), slot, cats: cats.join(','), mode }, form.get('t'))
    .then(r => log(env, sub.id, null, 'welcome', true, via(env, r)), e => log(env, sub.id, null, 'welcome', false, e.message || String(e))));
  return Response.redirect(`${env.SELF}/settings?t=${form.get('t')}&saved=1`, 302);
}

async function unsubscribePage(url, env) {
  const sub = await subFromToken(url, env);
  if (!sub) return html(page('링크 만료', '<p>이 링크는 더 이상 유효하지 않아요.</p>' + backLink(env)), 401);
  const t = url.searchParams.get('t');
  return html(page('그만 받기', `<h1>그만 받을까요?</h1>
  <p class="lead">${sub.channel === 'email' ? `<b>${esc(sub.email)}</b>로 보내던` : '카카오톡으로 보내던'} 리더십 인사이트 알림을 해지하고, 저장된 정보를 모두 지워요.</p>
  <div class="row" style="border:0;padding:0;margin-top:6px">
    <form method="post" action="/unsubscribe"><input type="hidden" name="t" value="${esc(t)}"><button class="btn danger">그만 받기</button></form>
    <a class="btn ghost" href="/settings?t=${esc(t)}">설정만 바꾸기</a>
  </div>`));
}

async function settingsAction(action, request, env) {
  const form = await request.formData().catch(() => new FormData());
  const t = form.get('t') || new URL(request.url).searchParams.get('t');   // query fallback: RFC 8058 one-click unsubscribe
  const tok = await readToken(env, t);
  if (!tok?.id) return html(page('링크 만료', '<p>이 링크는 더 이상 유효하지 않아요.</p>' + backLink(env)), 401);
  if (action === 'unsubscribe') {
    await env.DB.prepare('DELETE FROM subscribers WHERE id = ?').bind(tok.id).run();
    await env.DB.prepare('DELETE FROM sends WHERE subscriber_id = ?').bind(tok.id).run();
    return html(page('그만 받기 완료', '<h1>해지했어요</h1><p class="lead">알림을 해지하고 저장된 정보를 모두 지웠어요. 언제든 다시 신청할 수 있어요.</p>' + backLink(env)));
  }
  if (action === 'pause') { await env.DB.prepare("UPDATE subscribers SET status='paused', updated_at=datetime('now') WHERE id=?").bind(tok.id).run(); return Response.redirect(`${env.SELF}/settings?t=${t}`, 302); }
  if (action === 'resume') { await env.DB.prepare("UPDATE subscribers SET status='active', fail_count=0, updated_at=datetime('now') WHERE id=?").bind(tok.id).run(); return Response.redirect(`${env.SELF}/settings?t=${t}&resumed=1`, 302); }
  if (action === 'reset') { await env.DB.prepare("UPDATE subscribers SET sent_vols='', status=CASE WHEN status='exhausted' THEN 'active' ELSE status END, updated_at=datetime('now') WHERE id=?").bind(tok.id).run(); return Response.redirect(`${env.SELF}/settings?t=${t}&reset=1`, 302); }
  return json({ error: 'bad action' }, 400);
}

// ───────────────────────────────────────────── the tick
async function tick(env, opt) {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600e3);
  const dow = kst.getUTCDay();
  const today = kst.toISOString().slice(0, 10);
  const slot = `${String(kst.getUTCHours()).padStart(2, '0')}:${kst.getUTCMinutes() < 30 ? '00' : '30'}`;

  let subs;
  if (opt.id) {
    subs = [await env.DB.prepare('SELECT * FROM subscribers WHERE id = ?').bind(opt.id).first()].filter(Boolean);
  } else {
    // any run inside the half-hour window delivers; last_sent_date makes it once per day
    const r = await env.DB.prepare(
      "SELECT * FROM subscribers WHERE status='active' AND slot=? AND (','||days||',') LIKE ? AND (last_sent_date IS NULL OR last_sent_date<>?)"
    ).bind(slot, `%,${dow},%`, today).all();
    subs = r.results || [];
  }
  if (!subs.length) return { slot, dow, today, due: 0 };

  const vols = await loadVolumes(env);
  const out = { slot, dow, today, due: subs.length, sent: 0, exhausted: 0, errors: [] };

  for (const sub of subs) {
    const isEmail = sub.channel === 'email';
    try {
      const v = pick(vols, sub);
      const t = await makeToken(env, { id: sub.id });
      const manage = `${env.SELF}/settings?t=${t}`;
      let r = null;
      if (isEmail) {
        r = await sendEmail(env, v ? await issueEmail(env, sub, v, t) : exhaustedEmail(env, sub, t, vols.length));
      } else {
        const at = await freshAccessToken(env, sub);
        await sendToMe(at, v ? issueTemplate(env, v, manage)
          : textTemplate(`지금까지 고른 편을 모두 받으셨어요 🦉 (${vols.length}편)\n설정에서 '받은 편 기록 지우기'를 누르면 처음부터 다시 골라 보내드릴게요.`, manage, '설정 열기'));
      }
      if (!v) {
        await env.DB.prepare("UPDATE subscribers SET status='exhausted', last_sent_date=?, updated_at=datetime('now') WHERE id=?").bind(today, sub.id).run();
        await log(env, sub.id, null, 'exhausted', true);
        out.exhausted++;
        continue;
      }
      const sent = (sub.sent_vols || '').split(',').filter(Boolean);
      sent.push(String(v.vol));
      await env.DB.prepare("UPDATE subscribers SET sent_vols=?, last_sent_date=?, fail_count=0, updated_at=datetime('now') WHERE id=?")
        .bind(sent.join(','), today, sub.id).run();
      await log(env, sub.id, v.vol, 'issue', true, via(env, r));
      out.sent++;
    } catch (e) {
      const msg = e.message || String(e);
      out.errors.push({ id: sub.id, error: msg });
      await log(env, sub.id, null, 'issue', false, msg);
      if (!isEmail && (e.code === 'invalid_grant' || e.code === -401)) {
        // user revoked the app / token dead → stop quietly; they can re-subscribe from the site
        await env.DB.prepare('DELETE FROM subscribers WHERE id = ?').bind(sub.id).run();
      } else {
        await env.DB.prepare("UPDATE subscribers SET fail_count=fail_count+1, status=CASE WHEN fail_count+1>=3 THEN 'paused' ELSE status END, updated_at=datetime('now') WHERE id=?").bind(sub.id).run();
      }
    }
  }
  return out;
}

function pick(vols, sub) {
  const sent = new Set((sub.sent_vols || '').split(',').filter(Boolean).map(Number));
  const cats = (sub.cats || '').split(',').filter(Boolean);
  const c = vols.filter(v => !sent.has(v.vol) && (!cats.length || cats.includes(v.cat)));
  if (!c.length) return null;
  if (sub.mode === 'latest') return c.slice().sort((a, b) => b.vol - a.vol)[0];
  return c[Math.floor(Math.random() * c.length)];
}

async function loadVolumes(env) {
  const r = await fetch(`${env.SITE}/data/volumes.json?cb=${Date.now()}`, { cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error('volumes.json unavailable');
  return (await r.json()).volumes;
}

async function freshAccessToken(env, sub) {
  const rt = await decrypt(env, sub.refresh_token_enc);
  const d = await kakaoToken(env, { grant_type: 'refresh_token', refresh_token: rt });
  if (d.refresh_token) {   // Kakao rotates it when < 1 month remains
    await env.DB.prepare('UPDATE subscribers SET refresh_token_enc = ? WHERE id = ?').bind(await encrypt(env, d.refresh_token), sub.id).run();
  }
  return d.access_token;
}

async function sendWelcome(env, sub, t) {
  if (sub.channel === 'email') return sendEmail(env, welcomeEmail(env, sub, t));
  const at = await freshAccessToken(env, sub);
  const manage = `${env.SELF}/settings?t=${t}`;
  await sendToMe(at, textTemplate(`설정이 끝났어요 🦉\n${schedule(sub)}에 리더십 인사이트를 한 편씩 보내드릴게요.\n\n이 채팅방(나와의 채팅)을 위로 고정해 두면 놓치지 않아요.`, manage, '설정 변경 · 그만 받기'));
}

// ───────────────────────────────────────────── schedule helpers
function schedule(sub) {
  const d = (sub.days || '').split(',').filter(Boolean).map(Number);
  const days = d.length === 7 ? '매일' : `매주 ${d.map(x => DAYS[x]).join('·')}요일`;
  return `${days} ${sub.slot}`;
}
function nextRun(sub) {   // first delivery after now, in KST — for the welcome mail
  const d = new Set((sub.days || '').split(',').filter(Boolean).map(Number));
  if (!d.size) return '';
  const kst = new Date(Date.now() + 9 * 3600e3);
  const [hh, mm] = (sub.slot || '08:00').split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const c = new Date(kst.getTime() + i * 86400e3);
    if (!d.has(c.getUTCDay())) continue;
    if (i === 0 && (kst.getUTCHours() > hh || (kst.getUTCHours() === hh && kst.getUTCMinutes() >= mm))) continue;
    return `${c.getUTCMonth() + 1}월 ${c.getUTCDate()}일 (${DAYS[c.getUTCDay()]}) ${sub.slot}`;
  }
  return '';
}

// ───────────────────────────────────────────── kakao api
async function kakaoToken(env, params) {
  const r = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.KAKAO_REST_API_KEY, client_secret: env.KAKAO_CLIENT_SECRET || '', ...params }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) { const e = new Error(d.error_description || d.error || 'kakao token error'); e.code = d.error; throw e; }
  return d;
}
async function kakaoMe(at) {
  const r = await fetch('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: `Bearer ${at}` } });
  if (!r.ok) throw new Error('kakao me failed');
  return r.json();
}
async function sendToMe(at, template) {
  const r = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ template_object: JSON.stringify(template) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.msg || 'kakao send failed'); e.code = d.code; throw e; }
  return d;
}
function issueTemplate(env, v, manageUrl) {
  const nn = String(v.vol).padStart(2, '0');
  const url = `${env.SITE}/${v.file}?utm_source=kakao&utm_medium=notify`;
  const link = { web_url: url, mobile_web_url: url };
  const mlink = { web_url: manageUrl, mobile_web_url: manageUrl };
  return {
    object_type: 'feed',
    content: { title: `Vol. ${nn} · ${v.title}`, description: (v.desc || v.sub || '').slice(0, 180),
               image_url: `${env.SITE}/assets/og/vol-${nn}.jpg`, image_width: 1200, image_height: 630, link },
    buttons: [{ title: '지금 읽기', link }, { title: '설정 · 그만 받기', link: mlink }],
  };
}
function textTemplate(text, url, buttonTitle) {
  return { object_type: 'text', text, link: { web_url: url, mobile_web_url: url }, button_title: buttonTitle };
}
async function log(env, sid, vol, kind, ok, error) {
  await env.DB.prepare('INSERT INTO sends (subscriber_id, vol, kind, ok, error) VALUES (?, ?, ?, ?, ?)').bind(sid, vol, kind, ok ? 1 : 0, error || null).run();
}

// ───────────────────────────────────────────── email (Resend)
async function sendEmail(env, m, from = env.MAIL_FROM) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY missing');
  const headers = {};
  if (m.unsub) { headers['List-Unsubscribe'] = `<${m.unsub}>`; headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'; }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text, headers }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    // sender domain not verified yet → retry once with the fallback sender (already-verified domain), if configured
    if (/not verified/i.test(d.message || '') && env.MAIL_FROM_FALLBACK && from !== env.MAIL_FROM_FALLBACK) return sendEmail(env, m, env.MAIL_FROM_FALLBACK);
    const e = new Error(d.message || `resend ${r.status}`); e.code = d.name || r.status; throw e;
  }
  return { ...d, from };
}
// note in the send log when a mail went out through the fallback sender instead of MAIL_FROM
const via = (env, r) => r && r.from && r.from !== env.MAIL_FROM ? `via ${r.from}` : null;

const F = "'Inter Tight','Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',Helvetica,Arial,sans-serif";
const SERIF = "'Gowun Batang','Noto Serif KR','Apple Myungjo','Nanum Myeongjo',Batang,Georgia,serif";
const MONO = "'JetBrains Mono',Menlo,Consolas,monospace";
const C = { ink: '#1c1a17', ink2: '#3b3833', body: '#2b2926', muted: '#8a857f', mute2: '#7a7570', line: '#ebe7e0', soft: '#f6f4ef', bg: '#f3f1ec' };

function emailLayout(env, { preheader, rows, footer }) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Leadership Insight</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg};"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;">
<tr><td style="padding:22px 28px 16px;font-family:${MONO};font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${C.mute2};">PLI · Leadership Insight</td></tr>
${rows}
<tr><td style="padding:20px 28px 26px;border-top:1px solid ${C.line};font-family:${F};font-size:12.5px;line-height:1.75;color:${C.muted};word-break:keep-all;">${footer}</td></tr>
</table>
<div style="font-family:${F};font-size:11px;line-height:1.6;color:#a5a09a;padding:16px 8px 0;">PLI · Project Leadership Insight · <a href="${env.SITE}" style="color:#a5a09a;">projectleadership.cc</a></div>
</td></tr></table></body></html>`;
}
const row = (style, inner) => `<tr><td style="${style}">${inner}</td></tr>`;
const h1Row = t => row(`padding:0 28px;font-family:${SERIF};font-size:26px;line-height:1.3;font-weight:700;color:${C.ink};letter-spacing:-.01em;word-break:keep-all;`, esc(t));
const pRow = (t, top = 14) => row(`padding:${top}px 28px 0;font-family:${SERIF};font-size:16.5px;line-height:1.8;color:${C.ink2};word-break:keep-all;`, t);
const btnRow = (href, label, extra = '') => row('padding:26px 28px 30px;',
  `<a href="${href}" style="display:inline-block;background:${C.ink};color:#ffffff;font-family:${F};font-size:15px;font-weight:600;text-decoration:none;padding:13px 24px;border-radius:999px;">${label}</a>${extra}`);
const manageFooter = (env, sub, t) => {
  const manage = `${env.SELF}/settings?t=${t}`, unsub = `${env.SELF}/unsubscribe?t=${t}`;
  return { manage, unsub, html: `${esc(schedule(sub))}에 아직 받지 않은 편을 한 편씩 <b style="color:${C.ink2};font-weight:600;">${esc(sub.email)}</b>로 보내드려요.<br>
<a href="${manage}" style="color:#5a554f;">설정 변경</a> · <a href="${unsub}" style="color:#5a554f;">그만 받기</a>`,
    text: `설정 변경: ${manage}\n그만 받기: ${unsub}` };
};

async function issueEmail(env, sub, v, t) {
  const nn = String(v.vol).padStart(2, '0');
  const url = `${env.SITE}/${v.file}?utm_source=email&utm_medium=notify`;
  const f = manageFooter(env, sub, t);
  const ex = await fetchExcerpt(env, v).catch(() => null);
  const meta = [v.cat, v.source, v.readTime ? `${v.readTime} 분량` : ''].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');
  const rows = [
    row('padding:0 28px;', `<a href="${url}" style="display:block;"><img src="${env.SITE}/assets/og/vol-${nn}.jpg" width="544" alt="${esc(v.title)}" style="width:100%;max-width:544px;height:auto;display:block;border-radius:12px;border:0;"></a>`),
    row(`padding:22px 28px 0;font-family:${MONO};font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:${C.mute2};`, esc(v.eyebrow || `Vol. ${nn}`)),
    row(`padding:8px 28px 0;font-family:${SERIF};font-size:27px;line-height:1.3;font-weight:700;letter-spacing:-.01em;word-break:keep-all;`, `<a href="${url}" style="color:${C.ink};text-decoration:none;">${esc(v.title)}</a>`),
    row(`padding:12px 28px 0;font-family:${SERIF};font-size:17px;line-height:1.65;color:${C.ink2};word-break:keep-all;`, esc(v.sub || v.desc || '')),
    row(`padding:12px 28px 0;font-family:${F};font-size:12.5px;line-height:1.6;color:${C.muted};`, meta),
    ex?.term ? row('padding:22px 28px 0;', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${C.soft};border-radius:12px;padding:16px 18px;">
<div style="font-family:${MONO};font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:${C.mute2};margin-bottom:6px;">이 글의 용어</div>
<div style="font-family:${SERIF};font-size:16px;font-weight:700;color:${C.ink};margin-bottom:6px;word-break:keep-all;">${esc(ex.term)}</div>
<div style="font-family:${F};font-size:14px;line-height:1.7;color:${C.ink2};word-break:keep-all;">${esc(ex.termBody)}</div></td></tr></table>`) : '',
    ...(ex?.paras || []).map((p, i) => row(`padding:${i ? 14 : 22}px 28px 0;font-family:${SERIF};font-size:16px;line-height:1.85;color:${C.body};word-break:keep-all;`, esc(p))),
    ex?.paras?.length ? row(`padding:10px 28px 0;font-family:${SERIF};font-size:16px;color:${C.muted};`, '…') : '',
    btnRow(url, '이어서 읽기 →'),
  ].join('');
  const text = `${v.eyebrow || `Vol. ${nn}`}\n${v.title}\n\n${v.sub || v.desc || ''}\n${[v.cat, v.source, v.readTime].filter(Boolean).join(' · ')}\n\n${(ex?.paras || []).join('\n\n')}\n\n이어서 읽기: ${url}\n\n${f.text}`;
  return { to: sub.email, subject: `[리더십 인사이트] Vol.${nn} ${v.title}`, html: emailLayout(env, { preheader: v.sub || v.desc, rows, footer: f.html }), text, unsub: f.unsub };
}

function linkEmail(env, sub, t) {
  const manage = `${env.SELF}/settings?t=${t}`;
  const rows = [
    h1Row('한 단계만 더 남았어요'),
    pRow('아래 버튼을 눌러 <b>요일·시간·주제</b>를 고르면 신청이 끝나요. 그 시간에 아직 읽지 않은 리더십 인사이트를 한 편씩 이 주소로 보내드릴게요.'),
    btnRow(manage, '요일·시간 고르기 →'),
    row(`padding:0 28px 8px;font-family:${F};font-size:13px;line-height:1.7;color:${C.muted};word-break:keep-all;`, '이 메일을 요청하지 않으셨다면 그냥 무시하세요. 설정을 마치기 전에는 아무것도 발송되지 않아요.'),
  ].join('');
  const text = `한 단계만 더 남았어요\n\n아래 링크에서 요일·시간·주제를 고르면 신청이 끝나요.\n${manage}\n\n이 메일을 요청하지 않으셨다면 무시하세요. 설정을 마치기 전에는 아무것도 발송되지 않아요.`;
  return { to: sub.email, subject: '[리더십 인사이트] 알림 설정을 마쳐 주세요', html: emailLayout(env, { preheader: '요일·시간·주제만 고르면 끝나요.', rows, footer: `<a href="${env.SITE}/#subscribe" style="color:#5a554f;">projectleadership.cc</a>에서 신청한 이메일 알림이에요.` }), text };
}

function welcomeEmail(env, sub, t) {
  const f = manageFooter(env, sub, t);
  const nx = nextRun(sub);
  const rows = [
    h1Row('설정이 끝났어요 🦉'),
    pRow(`<b>${esc(schedule(sub))}</b>에 아직 읽지 않은 편을 골라 이 주소로 보내드려요.${nx ? ` 첫 편은 <b>${esc(nx)}</b>에 도착해요.` : ''}`),
    pRow('메일에는 표지, 핵심 문장, 이 글의 용어, 도입부 두 문단이 담기고, 나머지는 사이트에서 이어서 읽는 방식이에요.'),
    row(`padding:18px 28px 0;font-family:${F};font-size:13.5px;line-height:1.7;color:${C.muted};word-break:keep-all;`, '메일이 스팸함으로 들어가면 <b>스팸 아님</b>을 한 번 눌러 주세요. 그 뒤로는 받은편지함으로 와요.'),
    btnRow(`${env.SITE}/`, '지금 나온 편 둘러보기 →', `<a href="${f.manage}" style="font-family:${F};font-size:14px;color:#5a554f;margin-left:16px;">설정 변경</a>`),
  ].join('');
  const text = `설정이 끝났어요\n\n${schedule(sub)}에 아직 읽지 않은 편을 골라 이 주소로 보내드려요.${nx ? ` 첫 편은 ${nx}에 도착해요.` : ''}\n\n${env.SITE}/\n\n${f.text}`;
  return { to: sub.email, subject: '[리더십 인사이트] 설정이 끝났어요 🦉', html: emailLayout(env, { preheader: `${schedule(sub)}에 한 편씩 보내드려요.`, rows, footer: f.html }), text, unsub: f.unsub };
}

function exhaustedEmail(env, sub, t, total) {
  const f = manageFooter(env, sub, t);
  const rows = [
    h1Row('지금까지 나온 편을 모두 받으셨어요'),
    pRow(`고르신 주제의 <b>${total}편</b>을 전부 보내드렸어요. 새 편이 나오면 다시 이어서 보내드릴게요.`),
    pRow('처음부터 다시 받고 싶다면 설정에서 <b>받은 편 기록 지우기</b>를 눌러 주세요.'),
    btnRow(f.manage, '설정 열기 →'),
  ].join('');
  const text = `지금까지 나온 편을 모두 받으셨어요 (${total}편)\n\n처음부터 다시 받고 싶다면 설정에서 '받은 편 기록 지우기'를 눌러 주세요.\n${f.manage}\n\n${f.text}`;
  return { to: sub.email, subject: '[리더십 인사이트] 지금까지 나온 편을 모두 받으셨어요', html: emailLayout(env, { preheader: '새 편이 나오면 이어서 보내드릴게요.', rows, footer: f.html }), text, unsub: f.unsub };
}

// opening of the published page: term box (.termdef) + first two paragraphs of the first .prose block
async function fetchExcerpt(env, v) {
  const r = await fetch(`${env.SITE}/${v.file}`, { cf: { cacheTtl: 1800 } });
  if (!r.ok) return null;
  const h = await r.text();
  const a = h.indexOf('<article'); if (a < 0) return null;
  const seg = h.slice(a);
  const strip = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
  const out = { paras: [] };
  const tw = seg.match(/class="td-word"[^>]*>([\s\S]*?)<\/div>/), tb = seg.match(/class="td-body"[^>]*>([\s\S]*?)<\/p>/);
  if (tw && tb) { out.term = strip(tw[1]); out.termBody = strip(tb[1]); }
  const from = Math.max(0, seg.indexOf('class="prose"'));
  const re = /<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g; re.lastIndex = from;
  let m; while ((m = re.exec(seg)) && out.paras.length < 2) { const t = strip(m[1]); if (t.length > 40) out.paras.push(t); }
  return out;
}

// ───────────────────────────────────────────── crypto (Web Crypto only)
const te = new TextEncoder(), td = new TextDecoder();
const b64u = b => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ub64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const rand = n => b64u(crypto.getRandomValues(new Uint8Array(n)));
async function hmacKey(env) { return crypto.subtle.importKey('raw', te.encode(env.SIGNING_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); }
async function sign(env, s) { return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env), te.encode(s)))); }
async function makeToken(env, payload) { const p = b64u(te.encode(JSON.stringify(payload))); return `${p}.${await sign(env, p)}`; }
async function readToken(env, t) {
  if (!t || !t.includes('.')) return null;
  const [p, s] = t.split('.');
  if ((await sign(env, p)) !== s) return null;
  try { return JSON.parse(td.decode(ub64u(p))); } catch { return null; }
}
async function aesKey(env) { const raw = await crypto.subtle.digest('SHA-256', te.encode('aes:' + env.SIGNING_KEY)); return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function encrypt(env, text) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), te.encode(text))); return `${b64u(iv)}.${b64u(ct)}`; }
async function decrypt(env, s) { const [iv, ct] = s.split('.'); return td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ub64u(iv) }, await aesKey(env), ub64u(ct))); }

// ───────────────────────────────────────────── html
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
const backLink = env => `<p><a class="btn ghost" href="${env.SITE}/#subscribe">홈으로</a></p>`;

function page(title, body) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>${esc(title)} · Leadership Insight</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=Gowun+Batang:wght@400;700&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
<style>
:root{--bg:#fff;--surface:#f6f6f6;--ink:#0a0a0a;--ink-2:#2b2b2b;--muted:#707070;--line:rgba(0,0,0,.14);--accent:#0a0a0a}
@media(prefers-color-scheme:dark){:root{--bg:#0f0f0f;--surface:#171717;--ink:#f2f2f2;--ink-2:#d6d6d6;--muted:#9a9a9a;--line:rgba(255,255,255,.16);--accent:#f2f2f2}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:'Inter Tight','Noto Sans KR',sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:560px;margin:0 auto;padding:40px 22px 60px}
.brand{font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);margin-bottom:28px}
h1{font-family:'Gowun Batang',serif;font-weight:700;font-size:30px;letter-spacing:-.02em;margin:0 0 10px;word-break:keep-all}
.lead{font-family:'Gowun Batang',serif;font-size:16.5px;line-height:1.65;color:var(--ink-2);margin:0 0 26px;word-break:keep-all}
fieldset{border:0;padding:0;margin:0 0 22px}legend{font-family:'JetBrains Mono',monospace;font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}legend small{letter-spacing:.02em;text-transform:none}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{position:relative}.chip input{position:absolute;opacity:0;inset:0;cursor:pointer}
.chip span{display:inline-block;padding:8px 14px;border:1px solid var(--line);border-radius:999px;font-size:14px;font-weight:500;color:var(--ink-2);transition:.14s}
.chip input:checked+span{background:var(--accent);color:var(--bg);border-color:var(--accent)}.chip:hover span{border-color:var(--ink)}
select{font:inherit;font-size:15px;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);min-width:140px}
.consent{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.55;color:var(--ink-2);margin:6px 0 20px;word-break:keep-all}.consent input{margin-top:3px}
.btn{display:inline-flex;align-items:center;gap:8px;font:inherit;font-weight:600;font-size:15px;background:var(--accent);color:var(--bg);border:1px solid var(--accent);border-radius:999px;padding:12px 22px;cursor:pointer;text-decoration:none}
.btn.ghost{background:transparent;color:var(--ink);border-color:var(--line)}.btn.ghost:hover{border-color:var(--ink)}.btn.danger{background:transparent;color:#c62828;border-color:#c62828}
.row{display:flex;flex-wrap:wrap;gap:10px;margin-top:26px;padding-top:22px;border-top:1px solid var(--line)}
.flash{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px 16px;font-size:14.5px;margin-bottom:22px}
.fine{font-size:12.5px;line-height:1.6;color:var(--muted);margin-top:28px;word-break:keep-all}.fine a{color:inherit}.err{color:#c62828}
</style></head><body><div class="wrap"><div class="brand">PLI · Weekly Insight 알림</div>${body}</div></body></html>`;
}
