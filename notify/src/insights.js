// 독자 인사이트 — 글 아래에 구독자가 남기는 기록.
//
// 쓸 수 있는 사람은 메일을 받은 구독자뿐이다. 공개 댓글로 열지 않아 스팸이 사실상 없고,
// 한 사람이 한 편에 하나만 남길 수 있어(UNIQUE(vol, subscriber_id)) 글 아래가 대화창이 아니라
// 기록으로 쌓인다. 다시 쓰면 고쳐진다.
//
// 표시에 쓰는 것은 본인이 정한 별명이다. 실명·전화번호는 받지 않는다는 약속은 그대로다.

import { rand, makeToken, readToken, json, track } from './lib.js';

export const NICK_MIN = 2, NICK_MAX = 16;
export const BODY_MIN = 30, BODY_MAX = 400;

const WRITE_TOKEN_DAYS = 60;

// ───────────────────────────────────────────── 토큰
// 메일의 쓰기 링크에는 편과 기한이 박힌 토큰을 싣는다. 설정 토큰(만료 없음)이 공개 글쓰기까지
// 열어 주지 않도록 분리한 것이다. 설정 페이지를 거쳐 온 사람은 설정 토큰으로도 쓸 수 있다.
// 편을 묶지 않는다. 메일로 받은 편 말고 다른 편을 읽다가 쓰고 싶을 때 막히면 안 된다.
// 설정 토큰과 다른 점은 기한이 있다는 것이고, 공개 글쓰기에는 그 정도가 맞다.
export const makeWriteToken = (env, id) =>
  makeToken(env, { id, exp: Math.floor(Date.now() / 1000) + WRITE_TOKEN_DAYS * 86400 });

export async function readWriter(env, t) {
  const tok = await readToken(env, t);
  if (!tok?.id) return null;
  if (tok.exp && tok.exp < Math.floor(Date.now() / 1000)) return null;   // 기한 지난 쓰기 토큰
  if (tok.a || tok.c) return null;                                        // 관리자·CSRF 토큰은 거절
  const row = await env.DB.prepare(
    "SELECT id FROM subscribers WHERE id = ? AND email IS NOT NULL AND status <> 'pending'"
  ).bind(tok.id).first();
  return row ? { id: tok.id, vol: tok.vol ?? null } : null;
}

// ───────────────────────────────────────────── 검사
// 제어문자와 보이지 않는 문자를 턴다. 정규식 리터럴에 그 문자를 직접 쓰면 소스에 섞여 들어가므로
// 문자열로 만들어 RegExp 에 넘긴다.
const CTRL = new RegExp('[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]', 'g');
const URLISH = /(https?:\/\/|www\.|\.[a-z]{2,}\/)/i;

export function cleanNick(v) {
  const s = String(v ?? '').replace(CTRL, '').replace(/\s+/g, ' ').trim();
  if (s.length < NICK_MIN) return { err: `별명은 ${NICK_MIN}자 이상이어야 해요.` };
  if (s.length > NICK_MAX) return { err: `별명은 ${NICK_MAX}자까지 쓸 수 있어요.` };
  if (URLISH.test(s)) return { err: '별명에 주소는 넣을 수 없어요.' };
  return { v: s };
}

export function cleanBody(v) {
  const s = String(v ?? '').replace(CTRL, '').replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim();
  if (s.length < BODY_MIN) return { err: `${BODY_MIN}자 이상 적어 주세요. 지금 ${s.length}자예요.` };
  if (s.length > BODY_MAX) return { err: `${BODY_MAX}자까지 쓸 수 있어요. 지금 ${s.length}자예요.` };
  return { v: s };
}

const volOf = v => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null;
};

// ───────────────────────────────────────────── 읽기
// 정적 사이트가 부르는 유일한 공개 경로. 60초 edge 캐시로 D1 호출을 줄인다.
export async function listInsights(url, env) {
  const vol = volOf(url.searchParams.get('vol'));
  const cors = { 'access-control-allow-origin': env.SITE || '*' };
  if (!vol) return json({ ok: false, msg: 'vol 이 필요해요.' }, 400);

  const { results } = await env.DB.prepare(
    `SELECT i.id, i.body, i.created_at, i.updated_at, p.nickname
       FROM insights i LEFT JOIN subscriber_profile p ON p.subscriber_id = i.subscriber_id
      WHERE i.vol = ? AND i.status = 'public'
      ORDER BY i.created_at ASC
      LIMIT 200`
  ).bind(vol).all();

  const items = (results || []).map(r => ({
    id: r.id,
    nick: r.nickname || '독자',
    body: r.body,
    at: (r.created_at || '').slice(0, 10),
    edited: !!(r.updated_at && r.created_at && r.updated_at !== r.created_at),
  }));

  return new Response(JSON.stringify({ ok: true, vol, count: items.length, items }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60',
      ...cors,
    },
  });
}

// ───────────────────────────────────────────── 쓰기
export async function saveInsight(request, env, ctx) {
  const cors = { 'access-control-allow-origin': env.SITE || '*' };
  const reply = (ok, msg, extra = {}, status = ok ? 200 : 400) =>
    new Response(JSON.stringify({ ok, msg, ...extra }), {
      status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors },
    });

  let p; try { p = await request.json(); } catch { return reply(false, '요청을 읽지 못했어요.'); }

  const w = await readWriter(env, p.t);
  if (!w) return reply(false, '쓰기 링크가 만료됐어요. 메일의 최근 링크나 내 알림 설정에서 다시 들어와 주세요.', {}, 401);

  const vol = volOf(p.vol);
  if (!vol) return reply(false, '어느 편인지 알 수 없어요.');
  if (w.vol && w.vol !== vol) return reply(false, '이 링크로는 다른 편에 쓸 수 없어요.', {}, 403);

  const body = cleanBody(p.body);
  if (body.err) return reply(false, body.err);

  // 별명은 처음 쓸 때만 받는다. 이미 있으면 보낸 값이 있을 때만 바꾼다.
  const prof = await env.DB.prepare('SELECT nickname FROM subscriber_profile WHERE subscriber_id = ?')
    .bind(w.id).first();
  let nick = prof?.nickname || null;
  if (p.nickname != null && String(p.nickname).trim() !== '') {
    const c = cleanNick(p.nickname);
    if (c.err) return reply(false, c.err);
    nick = c.v;
  }
  if (!nick) return reply(false, '표시할 별명을 정해 주세요.', { needNick: true });

  await env.DB.prepare(
    `INSERT INTO subscriber_profile (subscriber_id, nickname) VALUES (?, ?)
     ON CONFLICT(subscriber_id) DO UPDATE SET nickname = excluded.nickname, updated_at = datetime('now')`
  ).bind(w.id, nick).run();

  await env.DB.prepare(
    `INSERT INTO insights (id, vol, subscriber_id, body) VALUES (?, ?, ?, ?)
     ON CONFLICT(vol, subscriber_id) DO UPDATE SET
       body = excluded.body, status = 'public', updated_at = datetime('now')`
  ).bind(rand(12), vol, w.id, body.v).run();

  track(env, ctx, request, 'insight_save', w.id, { vol });
  return reply(true, '기록했어요.', { nick, body: body.v });
}

// ───────────────────────────────────────────── 지우기 · 내 기록
export async function deleteInsight(request, url, env, ctx) {
  const cors = { 'access-control-allow-origin': env.SITE || '*' };
  const out = (ok, msg, status = ok ? 200 : 400) =>
    new Response(JSON.stringify({ ok, msg }), {
      status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors },
    });

  const w = await readWriter(env, url.searchParams.get('t'));
  if (!w) return out(false, '권한을 확인하지 못했어요.', 401);
  const vol = volOf(url.searchParams.get('vol'));
  if (!vol) return out(false, '어느 편인지 알 수 없어요.');

  await env.DB.prepare("UPDATE insights SET status='removed', updated_at=datetime('now') WHERE vol=? AND subscriber_id=?")
    .bind(vol, w.id).run();
  track(env, ctx, request, 'insight_delete', w.id, { vol });
  return out(true, '지웠어요.');
}

// 글 페이지가 "내가 이 편에 쓴 것"을 미리 채우려고 부른다.
export async function myInsight(url, env) {
  const cors = { 'access-control-allow-origin': env.SITE || '*' };
  const w = await readWriter(env, url.searchParams.get('t'));
  const nope = o => new Response(JSON.stringify(o), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors },
  });
  if (!w) return nope({ ok: false, signedIn: false });

  const vol = volOf(url.searchParams.get('vol'));
  const prof = await env.DB.prepare('SELECT nickname FROM subscriber_profile WHERE subscriber_id = ?')
    .bind(w.id).first();
  const mine = vol ? await env.DB.prepare(
    "SELECT body FROM insights WHERE vol=? AND subscriber_id=? AND status='public'"
  ).bind(vol, w.id).first() : null;

  return nope({ ok: true, signedIn: true, nick: prof?.nickname || null, body: mine?.body || null });
}

// 구독을 그만둘 때 함께 지운다. "그만 받기를 누르면 즉시 삭제돼요"가 기록에도 적용돼야 한다.
export async function purgeInsights(env, id) {
  await env.DB.prepare('DELETE FROM insights WHERE subscriber_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM subscriber_profile WHERE subscriber_id = ?').bind(id).run();
}

// 홈이 읽는 최근 기록. 편 제목을 함께 실어 보내 홈이 따로 찾지 않아도 되게 한다.
export async function listRecent(url, env, loadVolumes) {
  const cors = { 'access-control-allow-origin': env.SITE || '*' };
  const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 7, 1), 90);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 5, 1), 20);

  const { results } = await env.DB.prepare(
    `SELECT i.vol, i.body, i.created_at, p.nickname
       FROM insights i LEFT JOIN subscriber_profile p ON p.subscriber_id = i.subscriber_id
      WHERE i.status = 'public' AND i.created_at > datetime('now', ?)
      ORDER BY i.created_at DESC LIMIT ?`
  ).bind(`-${days} days`, limit).all();

  const rows = results || [];
  let titles = {};
  if (rows.length) {
    try { (await loadVolumes(env)).forEach(v => { titles[Number(v.vol)] = v; }); } catch {}
  }

  const items = rows.map(r => {
    const v = titles[Number(r.vol)];
    return {
      nick: r.nickname || '독자',
      body: r.body,
      at: (r.created_at || '').slice(0, 10),
      vol: r.vol,
      title: v ? v.title : null,
      file: v ? v.file : null,
    };
  });

  return new Response(JSON.stringify({ ok: true, days, count: items.length, items }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60', ...cors },
  });
}
