// 한 번 누르면 끝나는 피드백.
//
// 독자 기록은 메일 토큰이 있어야 남길 수 있어서, 처음 들른 사람은 아무 신호도 보낼 수 없었다.
// 이 모듈은 그 앞단이다. 이름도 이메일도 받지 않고, 기기 하나가 편 하나에 한 번 센다.
import { sha256Hex } from './lib.js';

const VERDICTS = ['helpful', 'meh'];

const cors = env => ({ 'access-control-allow-origin': env.SITE || '*' });

const json = (env, body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors(env), ...extra },
  });

// 같은 기기를 알아보되 누구인지는 모르게 한다. 원본 IP 는 저장하지 않는다.
async function deviceHash(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (!ip) return null;
  return (await sha256Hex(`${ip}:${env.SIGNING_KEY}`)).slice(0, 16);
}

async function tally(env, vol) {
  const { results } = await env.DB.prepare(
    'SELECT verdict, COUNT(*) n FROM feedback WHERE vol = ? GROUP BY verdict'
  ).bind(vol).all();
  const out = { helpful: 0, meh: 0 };
  for (const r of results || []) out[r.verdict] = r.n;
  return out;
}

// GET /feedback?vol=N — 집계만 돌려준다. 60초 캐시.
export async function getFeedback(url, env) {
  const vol = Number(url.searchParams.get('vol'));
  if (!Number.isInteger(vol) || vol < 1) return json(env, { ok: false, msg: '편 번호가 없어요' }, 400);
  const counts = await tally(env, vol);
  return json(env, { ok: true, vol, ...counts }, 200, { 'cache-control': 'public, max-age=60' });
}

// POST /feedback {vol, verdict} — 같은 기기가 다시 누르면 바꿔 준다.
export async function postFeedback(request, env) {
  let b;
  try { b = await request.json(); } catch { return json(env, { ok: false, msg: '요청을 읽지 못했어요' }, 400); }

  const vol = Number(b?.vol);
  const verdict = String(b?.verdict || '');
  if (!Number.isInteger(vol) || vol < 1) return json(env, { ok: false, msg: '편 번호가 없어요' }, 400);
  if (!VERDICTS.includes(verdict)) return json(env, { ok: false, msg: '알 수 없는 값이에요' }, 400);

  const who = await deviceHash(request, env);
  if (!who) return json(env, { ok: false, msg: '기기를 확인하지 못했어요' }, 400);

  const ua = (request.headers.get('user-agent') || '').slice(0, 120);
  await env.DB.prepare(
    `INSERT INTO feedback (vol, verdict, ip_hash, ua) VALUES (?, ?, ?, ?)
     ON CONFLICT(vol, ip_hash) DO UPDATE SET verdict = excluded.verdict, created_at = datetime('now')`
  ).bind(vol, verdict, who, ua).run();

  return json(env, { ok: true, vol, mine: verdict, ...(await tally(env, vol)) });
}

// GET /feedback/all — 관리자 화면과 발행 스크립트가 한 번에 받아 간다.
export async function allFeedback(env) {
  const { results } = await env.DB.prepare(
    `SELECT vol,
            SUM(verdict = 'helpful') helpful,
            SUM(verdict = 'meh')     meh,
            COUNT(*)                 total
       FROM feedback GROUP BY vol ORDER BY vol`
  ).all();
  const total = (results || []).reduce((n, r) => n + r.total, 0);
  return json(env, { ok: true, total, vols: results || [] }, 200, { 'cache-control': 'public, max-age=60' });
}
