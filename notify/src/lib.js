// shared helpers for index.js (public routes) and admin.js (dashboard)

export const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const CATS = ['전략', '사람', '판단', '책임', '성장', '성찰', '역사'];
export const SLOTS = (() => { const a = []; for (let h = 7; h <= 22; h++) for (const m of ['00', '30']) if (!(h === 22 && m === '30')) a.push(`${String(h).padStart(2, '0')}:${m}`); return a; })();

// ───────────────────────────────────────────── crypto (Web Crypto only)
export const te = new TextEncoder(), td = new TextDecoder();
export const b64u = b => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const ub64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
export const rand = n => b64u(crypto.getRandomValues(new Uint8Array(n)));
async function hmacKey(env) { return crypto.subtle.importKey('raw', te.encode(env.SIGNING_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); }
export async function sign(env, s) { return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env), te.encode(s)))); }
export async function makeToken(env, payload) { const p = b64u(te.encode(JSON.stringify(payload))); return `${p}.${await sign(env, p)}`; }
export async function readToken(env, t) {
  if (!t || !t.includes('.')) return null;
  const [p, s] = t.split('.');
  if ((await sign(env, p)) !== s) return null;
  try { return JSON.parse(td.decode(ub64u(p))); } catch { return null; }
}
async function aesKey(env) { const raw = await crypto.subtle.digest('SHA-256', te.encode('aes:' + env.SIGNING_KEY)); return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); }
export async function encrypt(env, text) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), te.encode(text))); return `${b64u(iv)}.${b64u(ct)}`; }
export async function decrypt(env, s) { const [iv, ct] = s.split('.'); return td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ub64u(iv) }, await aesKey(env), ub64u(ct))); }
export async function sha256Hex(s) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(s)))].map(b => b.toString(16).padStart(2, '0')).join(''); }

// password hashes: "pbkdf2$<iterations>$<salt b64>$<hash b64>" (created by scripts/hash-password.js or the settings page)
const b64 = b => btoa(String.fromCharCode(...b));
const ub64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export async function pbkdf2Hash(password, iterations = 100000, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(bits)}`;
}
export async function pbkdf2Verify(password, stored) {
  const [algo, iter, salt, hash] = String(stored || '').split('$');
  if (algo !== 'pbkdf2' || !iter || !salt || !hash) return false;
  const again = await pbkdf2Hash(password, Number(iter), ub64(salt));
  const a = te.encode(again.split('$')[3]), b = te.encode(hash);
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

// ───────────────────────────────────────────── http / html
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
export const html = (s, status = 200, extra = {}) => new Response(s, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extra } });

// KST helpers: D1 timestamps are UTC 'YYYY-MM-DD HH:MM:SS'
export const kstNow = () => new Date(Date.now() + 9 * 3600e3);
export const kstDate = (d = kstNow()) => d.toISOString().slice(0, 10);
export function kst(ts, withYear = false) {
  if (!ts) return '';
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return ts;
  const k = new Date(d.getTime() + 9 * 3600e3), p = n => String(n).padStart(2, '0');
  return `${withYear ? k.getUTCFullYear() + '-' : ''}${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

// ───────────────────────────────────────────── logging
export async function log(env, sid, vol, kind, ok, error) {
  await env.DB.prepare('INSERT INTO sends (subscriber_id, vol, kind, ok, error) VALUES (?, ?, ?, ?, ?)').bind(sid, vol, kind, ok ? 1 : 0, error || null).run();
}
// access/behaviour log — fire and forget; never blocks a response, never throws (table may not exist before migrate-002)
export function track(env, ctx, request, event, sid, meta) {
  const job = (async () => {
    const ip = request.headers.get('cf-connecting-ip') || '';
    const ipHash = ip ? (await sha256Hex(`${ip}:${env.SIGNING_KEY}`)).slice(0, 16) : null;
    const ua = (request.headers.get('user-agent') || '').slice(0, 120);
    const country = request.cf?.country || null;
    await env.DB.prepare('INSERT INTO access_log (event, subscriber_id, path, ip_hash, country, ua, meta) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(event, sid || null, new URL(request.url).pathname, ipHash, country, ua, meta ? JSON.stringify(meta) : null).run();
  })().catch(() => {});
  if (ctx?.waitUntil) ctx.waitUntil(job);
  return job;
}
