/**
 * pli-notify — 매주 리더십 인사이트 알림 (이메일)
 *
 * Routes
 *   POST /email/start            → email address → pending subscriber → "설정 링크" mail (Resend)
 *   GET  /email/preview?vol=&kind= → render an email template (issue | welcome | link | exhausted) for design checks
 *   GET  /settings?t=            → preferences page (also the manage page; no login)
 *   POST /settings               → save; first save activates + sends a welcome message/mail
 *   POST /pause  /resume  /unsubscribe  /reset   (form posts from the settings page)
 *   GET  /unsubscribe?t=         → confirm page (linked from mails; one-click POST also accepted)
 *   POST /cron/run               → Bearer CRON_SECRET · manual tick (?id=…&force=1 to test one subscriber)
 *   GET  /health                 → {ok, ready, email}  (?deep=1 also probes Resend: key shape + sender domains)
 * Cron (every 5 minutes) → tick(): for each active subscriber whose day+slot matches KST now and who
 *   hasn't been sent today, pick an unsent issue (random or latest, optional category filter) and
 *   deliver it as an HTML mail with cover, dek, term box and the opening paragraphs pulled live from
 *   the published page — then record it.
 *
 * The Kakao channel was removed on 2026-09-27 (email only). Legacy rows with channel='kakao' have no
 * address, so every query that sends or lists "deliverable" subscribers requires email IS NOT NULL;
 * the admin can give such a row an address (which converts it) or delete it.
 *
 * Patterns borrowed from 99wisdombook/functions/api/[[path]].js (CRON_SECRET trigger, Resend);
 * differences: no user accounts, per-subscriber no-repeat selection, native Cron Trigger.
 */

import { DAYS, CATS, SLOTS, rand, makeToken, readToken, encrypt, decrypt, esc, json, html, log, track } from './lib.js';
import { adminRoute, recordCron, maybePrune } from './admin.js';
import { listInsights, saveInsight, deleteInsight, myInsight, purgeInsights, makeWriteToken, listRecent, listAll } from './insights.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default {
  async fetch(request, env, ctx) {
    try { return await route(request, env, ctx); }
    catch (e) { return html(page('오류', `<p class="err">${esc(e.message || String(e))}</p>`), 500); }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const t0 = Date.now();
      const r = await tick(env, {});
      await recordCron(env, r, Date.now() - t0);   // /admin/access shows these
      await maybePrune(env);                        // daily log retention (after 04:00 KST)
    })());
  },
};

// ───────────────────────────────────────────── routing
async function route(request, env, ctx) {
  const url = new URL(request.url);
  const p = url.pathname, m = request.method;

  // 정적 사이트가 /insights 로 JSON POST 를 보내므로 사전요청을 받아 준다
  if (m === 'OPTIONS' && p.startsWith('/insights')) return new Response(null, { status: 204, headers: {
    'access-control-allow-origin': env.SITE || '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  } });

  if (p === '/insights' && m === 'GET') return listInsights(url, env);
  if (p === '/insights' && m === 'POST') return saveInsight(request, env, ctx);
  if (p === '/insights' && m === 'DELETE') return deleteInsight(request, url, env, ctx);
  if (p === '/insights/mine' && m === 'GET') return myInsight(url, env);
  if (p === '/insights/recent' && m === 'GET') return listRecent(url, env, loadVolumes);
  if (p === '/insights/all' && m === 'GET') return listAll(url, env);
  if (p === '/insights/link' && m === 'POST') return insightLink(request, env, ctx);

  // the site probes this before showing the "카카오톡으로 받기" button, so allow cross-origin reads
  if (p === '/health') {
    const body = { ok: true, ready: !!env.RESEND_API_KEY, email: !!env.RESEND_API_KEY, time: new Date().toISOString() };
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
    ctx.waitUntil(fallbackTick(env));
    return new Response(JSON.stringify(body),
      { headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': env.SITE, 'cache-control': 'no-store' } });
  }
  if (p === '/' ) return Response.redirect(`${env.SITE}/#subscribe`, 302);

  if (p === '/admin' || p.startsWith('/admin/'))
    return adminRoute(request, env, ctx, url, { tick, loadVolumes, sendEmail, welcomeEmail, log });

  if (p === '/me' && m === 'GET') return mePage(request, env, ctx);
  if (p === '/me' && m === 'POST') return meEmail(request, env, ctx);

  if (p === '/email/start' && m === 'POST') return emailStart(request, env, ctx);
  if (p === '/email/preview' && m === 'GET') return emailPreview(url, env);

  if (p === '/settings' && m === 'GET') return settingsPage(request, url, env, ctx);
  if (p === '/settings' && m === 'POST') return settingsSave(request, env, ctx);
  if (p === '/unsubscribe' && m === 'GET') return unsubscribePage(url, env);
  if (['/pause', '/resume', '/unsubscribe', '/reset', '/test', '/insight-del'].includes(p) && m === 'POST') return settingsAction(p.slice(1), request, env, ctx);

  if (p === '/cron/diag' && m === 'GET') {   // Bearer CRON_SECRET · recent cron runs, Resend delivery events, one subscriber's sends (?id=)
    const auth = request.headers.get('Authorization') || '';
    if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) return json({ error: 'unauthorized' }, 401);
    return json(await diag(env, url.searchParams.get('id')));
  }
  if (p === '/cron/run' && m === 'POST') {
    const auth = request.headers.get('Authorization') || '';
    if (!env.CRON_SECRET || auth !== `Bearer ${env.CRON_SECRET}`) return json({ error: 'unauthorized' }, 401);
    const r = await tick(env, { id: url.searchParams.get('id'), force: url.searchParams.get('force') === '1' });
    return json(r);
  }
  return html(page('없는 페이지', '<p>주소를 확인해 주세요.</p>'), 404);
}

// ───────────────────────────────────────────── 내 알림 설정 (come back without signing up again)
const SUB_COOKIE = 'pli_sub';
const subCookie = t => `${SUB_COOKIE}=${t}; Max-Age=34560000; Path=/; Secure; HttpOnly; SameSite=Lax`;
function readCookie(request, name) {
  const c = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  return c ? c.slice(name.length + 1) : null;
}
async function mePage(request, env, ctx) {
  const c = readCookie(request, SUB_COOKIE);
  const tok = await readToken(env, c);
  if (tok?.id && await env.DB.prepare('SELECT 1 AS x FROM subscribers WHERE id = ?').bind(tok.id).first()) return Response.redirect(`${env.SELF}/settings?t=${c}`, 302);
  return html(page('내 알림 설정', `<h1>내 알림 설정</h1>
  <p class="lead">신청하신 이메일 주소를 넣어 주세요. 새로 가입하는 게 아니라, 그 주소로 설정 화면을 여는 링크를 보내드려요.</p>
  <fieldset><legend>신청한 이메일 주소</legend>
    <form method="post" action="/me" class="inline"><input type="email" name="email" placeholder="이메일 주소" required><button class="btn" type="submit">설정 링크 받기</button></form>
  </fieldset>` + backLink(env)));
}
async function meEmail(request, env, ctx) {
  const form = await request.formData().catch(() => new FormData());
  const email = String(form.get('email') || '').trim().toLowerCase();
  const sub = EMAIL_RE.test(email) ? await env.DB.prepare('SELECT * FROM subscribers WHERE email = ?').bind(email).first() : null;
  if (sub && env.RESEND_API_KEY) {
    const t = await makeToken(env, { id: sub.id });
    ctx.waitUntil(sendEmail(env, linkEmail(env, sub, t))
      .then(r => log(env, sub.id, null, 'link', true, via(env, r)), e => log(env, sub.id, null, 'link', false, e.message || String(e))));
  }
  track(env, ctx, request, 'me_email', sub?.id || null, { found: !!sub });
  // same answer either way, so the page doesn't reveal who is subscribed
  return html(page('메일을 확인해 주세요', `<h1>메일을 확인해 주세요</h1><p class="lead">신청된 주소라면 <b>${esc(email)}</b>로 설정 링크를 보냈어요. 1~2분 안에 안 보이면 스팸함도 확인해 주세요.</p>` + backLink(env)));
}

async function diag(env, id) {
  const out = { now: new Date().toISOString() };
  out.cron = await env.DB.prepare('SELECT ts, slot, due, sent, errors FROM cron_runs ORDER BY id DESC LIMIT 5').all().then(r => r.results).catch(e => String(e));
  if (env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails?limit=30', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
    const d = await r.json().catch(() => ({}));
    out.resend = r.ok ? (d.data || []).map(x => ({ to: x.to, subject: x.subject, last_event: x.last_event, created_at: x.created_at })) : `resend ${r.status} ${d.message || ''}`.trim();
  }
  if (id) {
    out.subscriber = await env.DB.prepare('SELECT id, email, status, days, slot, last_sent_date, fail_count FROM subscribers WHERE id = ?').bind(id).first();
    out.sends = await env.DB.prepare('SELECT sent_at, kind, vol, ok, error FROM sends WHERE subscriber_id = ? ORDER BY id DESC LIMIT 10').bind(id).all().then(r => r.results).catch(e => String(e));
  }
  return out;
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
  if (!env.RESEND_API_KEY) return reply(false, '이메일 알림은 잠시 뒤에 열려요. 조금만 기다려 주세요.', 503);

  let sub = await env.DB.prepare('SELECT * FROM subscribers WHERE email = ?').bind(email).first();
  if (!sub) {
    sub = { id: rand(16), channel: 'email', email, status: 'pending', days: '1', slot: '08:00' };
    await env.DB.prepare("INSERT INTO subscribers (id, channel, email) VALUES (?, 'email', ?)").bind(sub.id, email).run();
  }
  const t = await makeToken(env, { id: sub.id });
  track(env, ctx, request, 'email_start', sub.id, { existing: sub.status !== 'pending' });

  // already set up → don't hand the manage page to whoever typed the address; mail the link to the mailbox owner instead
  if (sub.status !== 'pending') {
    ctx.waitUntil(sendEmail(env, linkEmail(env, sub, t))
      .then(r => log(env, sub.id, null, 'link', true, via(env, r)), e => log(env, sub.id, null, 'link', false, e.message || String(e))));
    return reply(true, `${email} 은 이미 신청된 주소예요. 설정을 바꿀 수 있는 링크를 그 주소로 보냈어요.`);
  }
  // new address → straight to the settings page; saving there sends the confirmation mail and the first issue
  const settings = `${env.SELF}/settings?t=${t}`;
  if (wantsJson) return new Response(JSON.stringify({ ok: true, url: settings }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors } });
  return Response.redirect(settings, 302);
}

async function insightLink(request, env, ctx) {
  const cors = { 'access-control-allow-origin': env.SITE || '*' };
  const reply = (ok, msg, status = ok ? 200 : 400) => new Response(JSON.stringify({ ok, msg }), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors },
  });

  let b; try { b = await request.json(); } catch { return reply(false, '요청을 읽지 못했어요.'); }
  const email = String(b.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return reply(false, '메일 주소를 다시 확인해 주세요.');
  const vol = Number(b.vol);

  // 구독 여부와 무관하게 같은 답을 돌려준다. 이 창구로 가입 여부를 알아낼 수 없어야 한다.
  const same = () => reply(true, '보냈어요. 구독 중인 주소라면 곧 메일이 도착해요.');

  const sub = await env.DB.prepare(
    "SELECT * FROM subscribers WHERE email = ? AND status <> 'pending'").bind(email).first();
  if (!sub) { track(env, ctx, request, 'insight_link_miss', null, { vol }); return same(); }

  // 같은 사람에게 10분에 한 번
  const recent = await env.DB.prepare(
    "SELECT 1 AS x FROM sends WHERE subscriber_id = ? AND kind = 'writelink' AND sent_at > datetime('now','-10 minutes')"
  ).bind(sub.id).first();
  if (recent) return same();

  let v = null;
  try { const vols = await loadVolumes(env); v = vols.find(x => Number(x.vol) === vol) || null; } catch {}

  const t = await makeWriteToken(env, sub.id);
  // 기록을 보내기 전에 남긴다. 발송 결과를 기다려 남기면 연달아 누를 때 제한이 통과된다.
  const ins = await env.DB.prepare(
    "INSERT INTO sends (subscriber_id, vol, kind, ok) VALUES (?, ?, 'writelink', 1)"
  ).bind(sub.id, vol || null).run();
  const rid = ins?.meta?.last_row_id || null;
  const mark = (ok, err) => rid
    ? env.DB.prepare('UPDATE sends SET ok = ?, error = ? WHERE id = ?').bind(ok, err, rid).run()
    : Promise.resolve();
  ctx.waitUntil(sendEmail(env, writeLinkEmail(env, sub, v, t))
    .then(r => mark(1, via(env, r)), e => mark(0, (e && e.message) || String(e))));
  track(env, ctx, request, 'insight_link', sub.id, { vol });
  return same();
}

function writeLinkEmail(env, sub, v, t) {
  const target = v ? `${env.SITE}/${v.file}?t=${t}#insight` : `${env.SITE}/?t=${t}`;
  const what = v ? `Vol. ${String(v.vol).padStart(2, '0')} ${v.title}` : '리더십 인사이트';
  const f = manageFooter(env, sub, t);
  const rows = [
    h1Row('인사이트 남기기'),
    pRow(`<b>${esc(what)}</b> 아래에 생각을 남길 수 있는 링크예요. 눌러서 글 끝으로 가면 입력란이 열려요.`),
    btnRow(target, '남기러 가기 →'),
    pRow('이 링크는 60일 동안 쓸 수 있고, 다른 편에서도 그대로 열려요. 한 편에 하나씩 남길 수 있고 언제든 고치거나 지울 수 있어요.', 0),
  ].join('');
  const text = `인사이트 남기기\n\n${what} 아래에 생각을 남길 수 있는 링크예요.\n${target}\n\n${f.text}`;
  return { to: sub.email, subject: `[리더십 인사이트] 인사이트 남기기 링크`,
           html: emailLayout(env, { preheader: `${what} 아래에 생각을 남겨 보세요`, rows, footer: f.html }),
           text, unsub: f.unsub };
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

// 내 알림 설정에 붙는 '내가 남긴 기록'. 기록이 없으면 아무것도 그리지 않는다.
async function myInsightsBlock(env, sub, t) {
  const { results } = await env.DB.prepare(
    "SELECT vol, body, status, created_at, updated_at FROM insights " +
    "WHERE subscriber_id = ? AND status <> 'removed' ORDER BY vol DESC LIMIT 100"
  ).bind(sub.id).all();
  if (!results || !results.length) return '';

  const titles = {};
  try { (await loadVolumes(env)).forEach(v => { titles[Number(v.vol)] = v; }); } catch {}
  const wt = await makeWriteToken(env, sub.id);

  const rows = results.map(r => {
    const v = titles[Number(r.vol)];
    const nn = String(r.vol).padStart(2, '0');
    const href = v ? `${env.SITE}/${v.file}?t=${wt}#insight` : `${env.SITE}/`;
    const edited = r.updated_at && r.created_at && r.updated_at !== r.created_at;
    return `<div class="mine-row">
      <div class="mine-head">
        <a href="${href}">Vol. ${nn}${v ? ` · ${esc(v.title)}` : ''}</a>
        <span class="mine-when">${esc((r.created_at || '').slice(0, 10))}${edited ? ' · 고침' : ''}${
          r.status === 'hidden' ? ' · <b>내려짐</b>' : ''}</span>
      </div>
      <p class="mine-body">${esc(r.body)}</p>
      <form method="post" action="/insight-del" onsubmit="return confirm('이 기록을 지울까요?')">
        <input type="hidden" name="t" value="${esc(t)}"><input type="hidden" name="vol" value="${r.vol}">
        <button class="lnk">지우기</button>
      </form>
    </div>`;
  }).join('');

  return `<h2 class="mine-h">내가 남긴 기록 <span>${results.length}건</span></h2>
  <p class="fine" style="margin:0 0 10px">편 제목을 누르면 그 자리로 가서 고칠 수 있어요.${
    results.some(r => r.status === 'hidden')
      ? ' 내려진 기록은 글 아래에 보이지 않아요.' : ''}</p>
  <div class="mine">${rows}</div>`;
}

async function settingsPage(request, url, env, ctx) {
  const sub = await subFromToken(url, env);
  if (!sub) return html(page('링크 만료', `<p>이 링크는 더 이상 유효하지 않아요. <a href="/me">내 알림 설정</a>에서 다시 확인해 주세요.</p>` + backLink(env)), 401);
  const t = url.searchParams.get('t');
  if (![...url.searchParams.keys()].some(k => ['saved', 'resumed', 'reset', 'test', 'mailerr', 'back', 'updated'].includes(k))) track(env, ctx, request, 'settings_view', sub.id);
  const q = k => url.searchParams.get(k);
  const flash =
    q('mailerr') ? `<span class="err">설정은 저장됐지만 확인 메일을 보내지 못했어요: ${esc(q('mailerr'))}</span>` :
    q('saved') ? `설정을 저장했어요. 확인 메일과 첫 편을 <b>${esc(sub.email)}</b>로 보냈어요. 1~2분 안에 안 보이면 스팸함을 확인하거나 아래 <b>테스트 메일 다시 보내기</b>를 눌러 주세요.` :
    q('updated') ? `설정을 저장했어요. ${q('updated') === '1' ? `변경 확인 메일을 <b>${esc(sub.email)}</b>로 보냈어요. ` : ''}${sub.status === 'paused' ? '지금은 <b>일시정지</b> 상태라 발송되지 않아요.' : nextRun(sub) ? `다음 발송은 <b>${esc(nextRun(sub))}</b>예요.` : ''}` :
    q('back') ? '이미 신청돼 있어요. 지금 설정은 아래와 같아요. 다음부터는 사이트의 <b>내 알림 설정</b>에서 바로 열 수 있어요.' :
    q('test') === '1' ? `테스트 메일을 <b>${esc(sub.email)}</b>로 다시 보냈어요.` :
    q('test') === 'wait' ? '방금 보냈어요. 1분 뒤에 다시 시도해 주세요.' :
    q('test') ? `<span class="err">테스트를 보내지 못했어요: ${esc(q('test'))}</span>` :
    q('resumed') ? '알림을 다시 켰어요.' :
    q('reset') ? '받은 편 기록을 지웠어요. 다시 처음부터 골라 보내드릴게요.' : '';
  // remember this browser so "내 알림 설정" opens the page directly next time
  const mine = await myInsightsBlock(env, sub, t).catch(() => '');
  return html(page('알림 설정', settingsForm(sub, t, flash, env, mine)), 200, { 'set-cookie': subCookie(t) });
}

function settingsForm(sub, t, flash, env, mine = '') {
  const days = new Set((sub.days || '').split(',').filter(Boolean).map(Number));
  const cats = new Set((sub.cats || '').split(',').filter(Boolean));
  const sent = (sub.sent_vols || '').split(',').filter(Boolean).length;
  const isNew = sub.status === 'pending';
  const paused = sub.status === 'paused';
  const dest = `이메일 <b>${esc(sub.email)}</b>로`;
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
    ${isNew ? `<label class="consent"><input type="checkbox" name="consent" required> 위 시간에 이메일로 인사이트를 받는 데 동의해요. 언제든 그만 받을 수 있어요.</label>` : ''}
    <button class="btn" type="submit">${isNew ? '알림 시작하기' : '저장'}</button>
  </form>
  ${isNew ? '' : `
  <div class="row">
    <form method="post" action="${paused ? '/resume' : '/pause'}"><input type="hidden" name="t" value="${esc(t)}"><button class="btn ghost">${paused ? '다시 받기' : '일시정지'}</button></form>
    <form method="post" action="/reset"><input type="hidden" name="t" value="${esc(t)}"><button class="btn ghost">받은 편 기록 지우기</button></form>
    <form method="post" action="/test"><input type="hidden" name="t" value="${esc(t)}"><button class="btn ghost">테스트 메일 다시 보내기</button></form>
    <form method="post" action="/unsubscribe" onsubmit="return confirm('정말 그만 받을까요? 설정과 연결 정보가 모두 삭제돼요.')"><input type="hidden" name="t" value="${esc(t)}"><button class="btn danger">그만 받기</button></form>
  </div>`}
  ${mine}
  <p class="fine">저장하는 정보는 이메일 주소와 위 설정이에요. 이름·전화번호는 받지 않아요. 글에 인사이트를 남기면 표시에 쓸 별명이 더해지고, 그만 받기를 누르면 남긴 기록까지 즉시 삭제돼요. · <a href="${env.SITE}/">projectleadership.cc</a></p>`;
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

  const saved = { ...sub, days: days.join(','), slot, cats: cats.join(','), mode, status };
  const t = form.get('t');
  track(env, ctx, request, 'settings_save', sub.id, { first, days: days.join(','), slot, cats: cats.join(','), mode });
  if (first) {
    // the welcome mail doubles as the address check, so send it before answering and surface a failure on the page;
    // the first issue follows right away instead of waiting for the slot
    try {
      const r = await sendWelcome(env, saved, t);
      await log(env, sub.id, null, 'welcome', true, via(env, r));
    } catch (e) {
      const msg = e.message || String(e);
      await log(env, sub.id, null, 'welcome', false, msg);
      return Response.redirect(`${env.SELF}/settings?t=${t}&mailerr=${encodeURIComponent(msg)}`, 302);
    }
    ctx.waitUntil(tick(env, { id: sub.id, force: true }).catch(() => {}));
    return Response.redirect(`${env.SELF}/settings?t=${t}&saved=1`, 302);
  }
  // update: a short confirmation so people can see the change landed (at most once a minute, nothing while paused)
  const recent = await env.DB.prepare("SELECT 1 AS x FROM sends WHERE subscriber_id=? AND kind IN ('welcome','test','update') AND ok=1 AND sent_at > datetime('now','-60 seconds') LIMIT 1").bind(sub.id).first();
  if (recent || status === 'paused') return Response.redirect(`${env.SELF}/settings?t=${t}&updated=quiet`, 302);
  try {
    const r = await sendEmail(env, welcomeEmail(env, saved, t, 'update'));
    await log(env, sub.id, null, 'update', true, via(env, r));
  } catch (e) {
    const msg = e.message || String(e);
    await log(env, sub.id, null, 'update', false, msg);
    return Response.redirect(`${env.SELF}/settings?t=${t}&mailerr=${encodeURIComponent(msg)}`, 302);
  }
  return Response.redirect(`${env.SELF}/settings?t=${t}&updated=1`, 302);
}

async function unsubscribePage(url, env) {
  const sub = await subFromToken(url, env);
  if (!sub) return html(page('링크 만료', '<p>이 링크는 더 이상 유효하지 않아요.</p>' + backLink(env)), 401);
  const t = url.searchParams.get('t');
  return html(page('그만 받기', `<h1>그만 받을까요?</h1>
  <p class="lead"><b>${esc(sub.email)}</b>로 보내던 리더십 인사이트 알림을 해지하고, 저장된 정보를 모두 지워요.</p>
  <div class="row" style="border:0;padding:0;margin-top:6px">
    <form method="post" action="/unsubscribe"><input type="hidden" name="t" value="${esc(t)}"><button class="btn danger">그만 받기</button></form>
    <a class="btn ghost" href="/settings?t=${esc(t)}">설정만 바꾸기</a>
  </div>`));
}

async function settingsAction(action, request, env, ctx) {
  const form = await request.formData().catch(() => new FormData());
  const t = form.get('t') || new URL(request.url).searchParams.get('t');   // query fallback: RFC 8058 one-click unsubscribe
  const tok = await readToken(env, t);
  if (!tok?.id) return html(page('링크 만료', '<p>이 링크는 더 이상 유효하지 않아요.</p>' + backLink(env)), 401);
  track(env, ctx, request, action, tok.id);
  if (action === 'unsubscribe') {
    await purgeInsights(env, tok.id);   // "즉시 삭제" 약속은 남긴 기록에도 적용된다
    await env.DB.prepare('DELETE FROM subscribers WHERE id = ?').bind(tok.id).run();
    await env.DB.prepare('DELETE FROM sends WHERE subscriber_id = ?').bind(tok.id).run();
    return html(page('그만 받기 완료', '<h1>해지했어요</h1><p class="lead">알림을 해지하고 저장된 정보를 모두 지웠어요. 언제든 다시 신청할 수 있어요.</p>' + backLink(env)), 200,
      { 'set-cookie': `${SUB_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax` });
  }
  if (action === 'pause') { await env.DB.prepare("UPDATE subscribers SET status='paused', updated_at=datetime('now') WHERE id=?").bind(tok.id).run(); return Response.redirect(`${env.SELF}/settings?t=${t}`, 302); }
  if (action === 'resume') { await env.DB.prepare("UPDATE subscribers SET status='active', fail_count=0, updated_at=datetime('now') WHERE id=?").bind(tok.id).run(); return Response.redirect(`${env.SELF}/settings?t=${t}&resumed=1`, 302); }
  if (action === 'insight-del') {
    const vol = Number(form.get('vol'));
    if (Number.isInteger(vol)) {
      await env.DB.prepare("UPDATE insights SET status='removed', updated_at=datetime('now') WHERE vol=? AND subscriber_id=?")
        .bind(vol, tok.id).run();
      track(env, ctx, request, 'insight_delete', tok.id, { vol, from: 'settings' });
    }
    return Response.redirect(`${env.SELF}/settings?t=${t}&back=1`, 302);
  }
  if (action === 'reset') { await env.DB.prepare("UPDATE subscribers SET sent_vols='', status=CASE WHEN status='exhausted' THEN 'active' ELSE status END, updated_at=datetime('now') WHERE id=?").bind(tok.id).run(); return Response.redirect(`${env.SELF}/settings?t=${t}&reset=1`, 302); }
  if (action === 'test') {   // a test mail, at most once a minute
    const sub = await env.DB.prepare('SELECT * FROM subscribers WHERE id = ?').bind(tok.id).first();
    if (!sub) return json({ error: 'bad action' }, 400);
    const recent = await env.DB.prepare("SELECT 1 AS x FROM sends WHERE subscriber_id=? AND kind IN ('welcome','test') AND ok=1 AND sent_at > datetime('now','-60 seconds') LIMIT 1").bind(sub.id).first();
    if (recent) return Response.redirect(`${env.SELF}/settings?t=${t}&test=wait`, 302);
    try {
      const r = await sendEmail(env, welcomeEmail(env, sub, t, true));
      await log(env, sub.id, null, 'test', true, via(env, r));
      return Response.redirect(`${env.SELF}/settings?t=${t}&test=1`, 302);
    } catch (e) {
      const msg = e.message || String(e);
      await log(env, sub.id, null, 'test', false, msg);
      return Response.redirect(`${env.SELF}/settings?t=${t}&test=${encodeURIComponent(msg)}`, 302);
    }
  }
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
    // due = today's slot arrived within the last CATCHUP_H hours and nothing went out today. A late or missed cron run
    // (or the fallback tick from /health) still delivers today's issue; the claim below keeps it to once a day.
    const r = await env.DB.prepare(
      "SELECT * FROM subscribers WHERE status='active' AND email IS NOT NULL AND slot<=? AND slot>=? AND (','||days||',') LIKE ? AND (last_sent_date IS NULL OR last_sent_date<>?)"
    ).bind(slot, catchupFrom(kst), `%,${dow},%`, today).all();
    subs = r.results || [];
  }
  if (!subs.length) return { slot, dow, today, due: 0 };

  const vols = await loadVolumes(env);
  const out = { slot, dow, today, due: subs.length, sent: 0, exhausted: 0, errors: [] };

  for (const sub of subs) {
    if (!sub.email) { out.due--; out.skipped = (out.skipped || 0) + 1; continue; }   // legacy row with no address
    if (!opt.force) {   // atomic claim: overlapping ticks (cron + fallback) can't both send to the same person
      const c = await env.DB.prepare("UPDATE subscribers SET last_sent_date=? WHERE id=? AND (last_sent_date IS NULL OR last_sent_date<>?)").bind(today, sub.id, today).run();
      if (!c.meta?.changes) { out.due--; continue; }
    }
    try {
      const v = pick(vols, sub);
      const t = await makeToken(env, { id: sub.id });
      const r = await sendEmail(env, v ? await issueEmail(env, sub, v, t) : exhaustedEmail(env, sub, t, vols.length));
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
      // release the claim so the next tick retries; three failures in a row pause the subscriber
      await env.DB.prepare("UPDATE subscribers SET fail_count=fail_count+1, status=CASE WHEN fail_count+1>=3 THEN 'paused' ELSE status END, last_sent_date=?, updated_at=datetime('now') WHERE id=?").bind(sub.last_sent_date ?? null, sub.id).run();
    }
  }
  return out;
}

const CATCHUP_H = 3;
function catchupFrom(kst) {
  const m = kst.getUTCHours() * 60 + kst.getUTCMinutes() - CATCHUP_H * 60;
  if (m <= 0) return '00:00';
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${m % 60 < 30 ? '00' : '30'}`;
}

// Cron Triggers once stopped firing for days (2026-09-13 → 09-15) with no error anywhere. Every /health hit (each home
// page view) checks the last real cron run and, when it is stale, runs the tick itself — at most once per 4 minutes.
async function fallbackTick(env) {
  try {
    const last = await env.DB.prepare("SELECT MAX(ts) ts FROM cron_runs WHERE COALESCE(slot,'') NOT LIKE '%fallback%'").first();
    if (last?.ts && Date.parse(last.ts.replace(' ', 'T') + 'Z') > Date.now() - 12 * 60e3) return;
    const c = await env.DB.prepare("INSERT INTO admin_state (key, value, updated_at) VALUES ('fallback_tick', '1', datetime('now')) ON CONFLICT(key) DO UPDATE SET updated_at = datetime('now') WHERE admin_state.updated_at < datetime('now', '-4 minutes')").run();
    if (!c.meta?.changes) return;
    const t0 = Date.now();
    const r = await tick(env, {});
    await recordCron(env, { ...r, slot: `${r.slot || ''} fallback` }, Date.now() - t0);
  } catch {}
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

const sendWelcome = (env, sub, t) => sendEmail(env, welcomeEmail(env, sub, t));

// ───────────────────────────────────────────── schedule helpers
function schedule(sub) {
  const d = (sub.days || '').split(',').filter(Boolean).map(Number);
  const days = d.length === 7 ? '매일' : `매주 ${d.map(x => DAYS[x]).join('·')}요일`;
  return `${days} ${sub.slot}`;
}
function nextRun(sub, skipToday = false) {   // next delivery after now, in KST (welcome/update messages, settings page)
  const d = new Set((sub.days || '').split(',').filter(Boolean).map(Number));
  if (!d.size) return '';
  const kst = new Date(Date.now() + 9 * 3600e3);
  const [hh, mm] = (sub.slot || '08:00').split(':').map(Number);
  for (let i = 0; i < 8; i++) {
    const c = new Date(kst.getTime() + i * 86400e3);
    if (!d.has(c.getUTCDay())) continue;
    if (i === 0) {
      if (skipToday || sub.last_sent_date === kst.toISOString().slice(0, 10)) continue;
      const now = kst.getUTCHours() * 60 + kst.getUTCMinutes(), at = hh * 60 + mm;
      if (now >= at) { if (now - at < CATCHUP_H * 60) return '오늘 곧 (5분 안에)'; continue; }   // tick catches up within the window
    }
    return `${c.getUTCMonth() + 1}월 ${c.getUTCDate()}일 (${DAYS[c.getUTCDay()]}) ${sub.slot}`;
  }
  return '';
}

// ───────────────────────────────────────────── email (Resend)
async function sendEmail(env, m, from = env.MAIL_FROM) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY missing');
  const headers = {};
  if (m.unsub) { headers['List-Unsubscribe'] = `<${m.unsub}>`; headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'; }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text, headers, ...(env.MAIL_REPLY_TO ? { reply_to: env.MAIL_REPLY_TO } : {}) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    // sender domain not verified yet → walk the fallback chain: MAIL_FROM_FALLBACK, then Resend's own test sender
    // (onboarding@resend.dev — Resend delivers it only to the account owner's address, which is fine for a first test)
    if (/not verified/i.test(d.message || '')) {
      const chain = [env.MAIL_FROM_FALLBACK, 'PLI 리더십 인사이트 <onboarding@resend.dev>'].filter(Boolean);
      const next = chain[chain.indexOf(from) + 1];
      if (next) return sendEmail(env, m, next);
    }
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
  const wurl = `${env.SITE}/${v.file}?t=${await makeWriteToken(env, sub.id)}#insight`;
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
    row(`padding:18px 28px 0;font-family:${F};font-size:13.5px;line-height:1.7;color:${C.muted};word-break:keep-all;`,
        `다 읽고 나면 <a href="${wurl}" style="color:${C.ink};">이 편에서 얻은 생각을 한 줄 남겨</a> 보세요. 글 아래에 별명으로 쌓입니다.`),
  ].join('');
  const text = `${v.eyebrow || `Vol. ${nn}`}\n${v.title}\n\n${v.sub || v.desc || ''}\n${[v.cat, v.source, v.readTime].filter(Boolean).join(' · ')}\n\n${(ex?.paras || []).join('\n\n')}\n\n이어서 읽기: ${url}\n인사이트 남기기: ${wurl}\n\n${f.text}`;
  return { to: sub.email, subject: `[리더십 인사이트] Vol.${nn} ${v.title}`, html: emailLayout(env, { preheader: v.sub || v.desc, rows, footer: f.html }), text, unsub: f.unsub };
}

function linkEmail(env, sub, t) {
  if (sub.status && sub.status !== 'pending') return manageLinkEmail(env, sub, t);
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

function manageLinkEmail(env, sub, t) {   // already subscribed: "open my settings" link
  const f = manageFooter(env, sub, t);
  const rows = [
    h1Row('내 알림 설정 링크예요'),
    pRow(`지금은 <b>${esc(schedule(sub))}</b>에 받도록 설정돼 있어요. 아래 버튼으로 요일·시간·주제를 바꾸거나 잠시 멈출 수 있어요.`),
    btnRow(f.manage, '설정 열기 →'),
    row(`padding:0 28px 8px;font-family:${F};font-size:13px;line-height:1.7;color:${C.muted};word-break:keep-all;`, '이 메일을 요청하지 않으셨다면 그냥 무시하세요. 설정은 바뀌지 않아요.'),
  ].join('');
  const text = `내 알림 설정 링크예요\n\n지금은 ${schedule(sub)}에 받도록 설정돼 있어요.\n${f.manage}\n\n${f.text}`;
  return { to: sub.email, subject: '[리더십 인사이트] 내 알림 설정 링크', html: emailLayout(env, { preheader: '요일·시간·주제를 바꾸거나 잠시 멈출 수 있어요.', rows, footer: f.html }), text, unsub: f.unsub };
}

function welcomeEmail(env, sub, t, test = false) {   // test: false = welcome · true = test · 'update' = settings changed
  const f = manageFooter(env, sub, t);
  const nx = nextRun(sub, !test);   // welcome: the first issue goes out right now, so the next one is not today
  const head = test === 'update' ? '설정을 바꿨어요 🦉' : test ? '테스트 메일이에요 🦉' : '설정이 끝났어요 🦉';
  const lead = test === 'update' ? '바뀐 설정으로 보내드릴게요.' : test ? '이 메일이 도착했다면 주소와 설정 모두 정상이에요.' : '이 메일이 도착했다면 주소 확인도 끝난 거예요. 첫 편은 지금 바로 이어서 보내드려요.';
  const rows = [
    h1Row(head),
    pRow(lead),
    pRow(`다음 편부터는 <b>${esc(schedule(sub))}</b>에 아직 읽지 않은 편을 골라 보내드려요.${nx ? ` 다음 도착은 <b>${esc(nx)}</b>예요.` : ''}`),
    pRow('메일에는 표지, 핵심 문장, 이 글의 용어, 도입부 두 문단이 담기고, 나머지는 사이트에서 이어서 읽는 방식이에요.'),
    row(`padding:18px 28px 0;font-family:${F};font-size:13.5px;line-height:1.7;color:${C.muted};word-break:keep-all;`,
      `메일이 스팸함으로 들어가면 <b>스팸 아님</b>을 한 번 눌러 주세요. 이 알림을 신청한 적이 없다면 <a href="${f.unsub}" style="color:#5a554f;">여기서 바로 그만 받기</a>를 누르면 돼요.`),
    btnRow(`${env.SITE}/`, '지금 나온 편 둘러보기 →', `<a href="${f.manage}" style="font-family:${F};font-size:14px;color:#5a554f;margin-left:16px;">설정 변경</a>`),
  ].join('');
  const text = `${head}\n\n${lead}\n다음 편부터는 ${schedule(sub)}에 아직 읽지 않은 편을 골라 보내드려요.${nx ? ` 다음 도착은 ${nx}예요.` : ''}\n\n${env.SITE}/\n\n${f.text}`;
  return { to: sub.email, subject: `[리더십 인사이트] ${head}`, html: emailLayout(env, { preheader: `${schedule(sub)}에 한 편씩 보내드려요.`, rows, footer: f.html }), text, unsub: f.unsub };
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

// ───────────────────────────────────────────── html (crypto + esc/json/html live in lib.js)
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
.btn.small{padding:9px 16px;font-size:14px}
.inline{display:flex;flex-wrap:wrap;gap:8px}.inline input{font:inherit;font-size:15px;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);min-width:220px;flex:1}
.row{display:flex;flex-wrap:wrap;gap:10px;margin-top:26px;padding-top:22px;border-top:1px solid var(--line)}
.flash{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px 16px;font-size:14.5px;margin-bottom:22px}
.fine{font-size:12.5px;line-height:1.6;color:var(--muted);margin-top:28px;word-break:keep-all}.fine a{color:inherit}.err{color:#c62828}
.mine-h{font-size:18px;margin:30px 0 4px;padding-top:24px;border-top:1px solid var(--line)}.mine-h span{font-size:13px;color:var(--muted);font-weight:400;margin-left:6px}
.mine-row{padding:14px 0;border-top:1px solid var(--line)}.mine-row:first-child{border-top:0}
.mine-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}.mine-head a{color:var(--ink);font-weight:600;font-size:15px;text-decoration:none}.mine-head a:hover{text-decoration:underline}
.mine-when{font-size:12.5px;color:var(--muted)}
.mine-body{font-size:15px;line-height:1.75;margin:6px 0 8px;word-break:keep-all;white-space:pre-wrap}
.lnk{background:none;border:0;padding:0;font:inherit;font-size:12.5px;color:var(--muted);text-decoration:underline;cursor:pointer}.lnk:hover{color:var(--ink)}
</style></head><body><div class="wrap"><div class="brand">PLI · Weekly Insight 알림</div>${body}</div></body></html>`;
}
