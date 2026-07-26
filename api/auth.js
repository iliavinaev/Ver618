// Vercel Serverless Function: server-side access-code check.
//
// The real code lives ONLY in the Vercel environment variable ACCESS_CODE and is
// never sent to the browser, so it cannot be read from the client bundle. The
// browser posts a candidate code here; on success we return a signed token the
// client stores. The token is an HMAC over an expiry timestamp, so it cannot be
// forged without the server secret and it expires on its own.
//
// Required Vercel environment variables (Project -> Settings -> Environment
// Variables):
//   ACCESS_CODE   the shared access code you hand out (a long random string)
//   AUTH_SECRET   a long random secret used to sign session tokens
//
// If AUTH_SECRET is not set, ACCESS_CODE is reused as the signing secret so the
// gate still works with a single variable, but setting both is recommended.

import crypto from 'crypto';

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) { crypto.timingSafeEqual(ba, ba); return false; }
  return crypto.timingSafeEqual(ba, bb);
}

function sign(expiry, secret) {
  return crypto.createHmac('sha256', secret).update(String(expiry)).digest('hex');
}

export default async function handler(req, res) {
  const ACCESS_CODE = process.env.ACCESS_CODE || '';
  const AUTH_SECRET = process.env.AUTH_SECRET || ACCESS_CODE;

  res.setHeader('Cache-Control', 'no-store');

  // token verification: GET /api/auth?token=...  -> { ok: true|false }
  if (req.method === 'GET') {
    const token = (req.query && req.query.token) || '';
    const parts = String(token).split('.');
    if (parts.length !== 2) return res.status(200).json({ ok: false });
    const exp = parseInt(parts[0], 10);
    if (!exp || Date.now() > exp) return res.status(200).json({ ok: false });
    return res.status(200).json({ ok: safeEqual(parts[1], sign(exp, AUTH_SECRET)) });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  if (!ACCESS_CODE) return res.status(500).json({ ok: false, error: 'server_not_configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const candidate = (body && body.code ? String(body.code) : '').trim();

  if (!candidate) return res.status(400).json({ ok: false, error: 'no_code' });
  if (!safeEqual(candidate, ACCESS_CODE)) return res.status(401).json({ ok: false, error: 'bad_code' });

  const expiry = Date.now() + TOKEN_TTL_MS;
  return res.status(200).json({ ok: true, token: expiry + '.' + sign(expiry, AUTH_SECRET), expires: expiry });
}
