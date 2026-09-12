/**
 * pli-notify — 매주 리더십 인사이트 알림 (카카오톡 '나에게 보내기')
 *
 * Routes
 *   GET  /kakao/start            → Kakao consent (scope: talk_message)
 *   GET  /kakao/callback         → code → tokens → subscriber upsert → /settings
 *   GET  /settings?t=            → preferences page (also the manage page; no login)
 *   POST /settings               → save; first save activates + sends a welcome message
 *   POST /pause  /resume  /unsubscribe  /reset   (form posts from the settings page)
 *   POST /cron/run               → Bearer CRON_SECRET · manual tick (?id=…&force=1 to test one subscriber)
 *   GET  /health
* Cron (every 5 minutes) → tick(): for each active subscriber whose day+slot matches KST now and who
 *   hasn't been sent today, refresh the Kakao token, pick an unsent issue (random or latest,
 *   optional category filter), send a feed message with the issue's OG card, record it.
 *
 * Patterns borrowed from 99wisdombook/functions/api/[[path]].js (token exchange, refresh
 * rotation, feed template, CRON_SECRET trigger); differences: no user accounts, encrypted
 * refresh tokens, per-subscriber no-repeat selection, native Cron Trigger.
 */

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const CATS = ['전략', '사람', '판단', '책임', '성장', '성찰', '역사'];
const SLOTS = (() => { const a = []; for (let h = 7; h <= 22; h++) for (const m of ['00', '30']) if (!(h === 22 && m === '30')) a.push(`${String(h).padStart(2, '0')}:${m}`); return a; })();

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

  if (p === '/health') return json({ ok: true, time: new Date().toISOString() });
  if (p === '/' ) return Response.redirect(`${env.SITE}/#subscribe`, 302);

  if (p === '/kakao/start' && m === 'GET') return kakaoStart(env);
  if (p === '/kakao/callback' && m === 'GET') return kakaoCallback(url, env, ctx);

  if (p === '/settings' && m === 'GET') return settingsPage(url, env);
  if (p === '/settings' && m === 'POST') return settingsSave(request, env, ctx);
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
    await env.DB.prepare('INSERT INTO subscribers (id, kakao_uid, refresh_token_enc) VALUES (?, ?, ?)').bind(sub.id, uid, enc).run();
  }
  const t = await makeToken(env, { id: sub.id });
  return Response.redirect(`${env.SELF}/settings?t=${t}`, 302);
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
  const flash = url.searchParams.get('saved') ? '설정을 저장했어요. 카카오톡 <b>나와의 채팅</b>을 확인해 보세요.' :
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
  return `
  ${flash ? `<div class="flash">${flash}</div>` : ''}
  <h1>${isNew ? '언제 받을까요?' : '알림 설정'}</h1>
  <p class="lead">${isNew ? '원하는 요일·시간에, 아직 읽지 않은 편을 한 편씩 <b>나와의 채팅</b>으로 보내드려요.' :
      `${paused ? '지금은 <b>일시정지</b> 상태예요. ' : ''}지금까지 <b>${sent}편</b>을 받으셨어요.`}</p>
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
    ${isNew ? `<label class="consent"><input type="checkbox" name="consent" required> 위 시간에 카카오톡 '나와의 채팅'으로 인사이트를 받는 데 동의해요. 언제든 그만 받을 수 있어요.</label>` : ''}
    <button class="btn" type="submit">${isNew ? '알림 시작하기' : '저장'}</button>
  </form>
  ${isNew ? '' : `
  <div class="row">
    <form method="post" action="${paused ? '/resume' : '/pause'}"><input type="hidden" name="t" value="${esc(t)}"><button class="btn ghost">${paused ? '다시 받기' : '일시정지'}</button></form>
    <form method="post" action="/reset"><input type="hidden" name="t" value="${esc(t)}"><button class="btn ghost">받은 편 기록 지우기</button></form>
    <form method="post" action="/unsubscribe" onsubmit="return confirm('정말 그만 받을까요? 설정과 연결 정보가 모두 삭제돼요.')"><input type="hidden" name="t" value="${esc(t)}"><button class="btn danger">그만 받기</button></form>
  </div>`}
  <p class="fine">저장하는 정보는 카카오 회원번호, 암호화된 발송 토큰, 위 설정뿐이에요. 이름·전화번호·이메일은 받지 않아요. 그만 받기를 누르면 즉시 삭제돼요. · <a href="${env.SITE}/">projectleadership.cc</a></p>`;
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

  if (first) ctx.waitUntil(sendWelcome(env, { ...sub, days: days.join(','), slot }, form.get('t')).catch(() => {}));
  return Response.redirect(`${env.SELF}/settings?t=${form.get('t')}&saved=1`, 302);
}

async function settingsAction(action, request, env) {
  const form = await request.formData();
  const tok = await readToken(env, form.get('t'));
  if (!tok?.id) return html(page('링크 만료', '<p>이 링크는 더 이상 유효하지 않아요.</p>' + backLink(env)), 401);
  const t = form.get('t');
  if (action === 'unsubscribe') {
    await env.DB.prepare('DELETE FROM subscribers WHERE id = ?').bind(tok.id).run();
    await env.DB.prepare('DELETE FROM sends WHERE subscriber_id = ?').bind(tok.id).run();
    return html(page('그만 받기 완료', '<p>알림을 해지하고 저장된 정보를 모두 지웠어요. 언제든 다시 신청할 수 있어요.</p>' + backLink(env)));
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
    try {
      const at = await freshAccessToken(env, sub);
      const v = pick(vols, sub);
      const manage = `${env.SELF}/settings?t=${await makeToken(env, { id: sub.id })}`;
      if (!v) {
        await sendToMe(at, textTemplate(`지금까지 고른 편을 모두 받으셨어요 🦉 (${vols.length}편)\n설정에서 '받은 편 기록 지우기'를 누르면 처음부터 다시 골라 보내드릴게요.`, manage, '설정 열기'));
        await env.DB.prepare("UPDATE subscribers SET status='exhausted', last_sent_date=?, updated_at=datetime('now') WHERE id=?").bind(today, sub.id).run();
        await log(env, sub.id, null, 'exhausted', true);
        out.exhausted++;
        continue;
      }
      await sendToMe(at, issueTemplate(env, v, manage));
      const sent = (sub.sent_vols || '').split(',').filter(Boolean);
      sent.push(String(v.vol));
      await env.DB.prepare("UPDATE subscribers SET sent_vols=?, last_sent_date=?, fail_count=0, updated_at=datetime('now') WHERE id=?")
        .bind(sent.join(','), today, sub.id).run();
      await log(env, sub.id, v.vol, 'issue', true);
      out.sent++;
    } catch (e) {
      const msg = e.message || String(e);
      out.errors.push({ id: sub.id, error: msg });
      await log(env, sub.id, null, 'issue', false, msg);
      if (e.code === 'invalid_grant' || e.code === -401) {
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
  const at = await freshAccessToken(env, sub);
  const days = (sub.days || '').split(',').filter(Boolean).map(d => DAYS[Number(d)]).join('·');
  const manage = `${env.SELF}/settings?t=${t}`;
  await sendToMe(at, textTemplate(`설정이 끝났어요 🦉\n매주 ${days}요일 ${sub.slot}에 리더십 인사이트를 한 편씩 보내드릴게요.\n\n이 채팅방(나와의 채팅)을 위로 고정해 두면 놓치지 않아요.`, manage, '설정 변경 · 그만 받기'));
  await log(env, sub.id, null, 'welcome', true);
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
