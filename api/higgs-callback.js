// Viral Spark Creative OS — HIGGSFIELD OAUTH: callback (Path B)
// Higgsfield redirects here with ?code=... after the user approves.
// We exchange the code (+ PKCE verifier from the cookie) for tokens and show the
// refresh token so it can be pasted into a Vercel env var (HIGGS_REFRESH_TOKEN).
// The refresh token is a secret — paste it into Vercel only, never into chat.

const CLIENT_ID = process.env.HIGGS_CLIENT_ID || 'qmL4zyxg5skJLOml';
const REDIRECT_URI = process.env.HIGGS_REDIRECT_URI || 'https://creative-os-api.vercel.app/api/higgs-callback';
const TOKEN_ENDPOINT = 'https://mcp.higgsfield.ai/oauth2/token';

function parseCookies(h) {
  const o = {};
  (h || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return o;
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function kvCfg() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return (url && token) ? { url: url.replace(/\/$/, ''), token } : null;
}
async function kvSet(key, val) {
  const c = kvCfg(); if (!c) return false;
  try {
    const r = await fetch(c.url + '/set/' + encodeURIComponent(key), { method: 'POST', headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'text/plain' }, body: String(val) });
    return r.ok;
  } catch (e) { return false; }
}
function page(res, html) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<html><body style="font-family:system-ui,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;line-height:1.5">' + html + '</body></html>');
}

module.exports = async function handler(req, res) {
  try {
    const u = new URL(req.url, 'https://creative-os-api.vercel.app');
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    const err = u.searchParams.get('error');
    if (err) return page(res, '<h2>❌ Authorization failed</h2><pre>' + esc(err + ' ' + (u.searchParams.get('error_description') || '')) + '</pre>');

    const cookies = parseCookies(req.headers.cookie);
    const verifier = cookies.hf_verifier;
    if (!code) return page(res, '<h2>Missing authorization code.</h2><p>Start again: <a href="/api/higgs-auth">/api/higgs-auth</a></p>');
    if (!verifier) return page(res, '<h2>Missing PKCE verifier cookie.</h2><p>Cookies may be blocked. Start again: <a href="/api/higgs-auth">/api/higgs-auth</a></p>');
    if (cookies.hf_state && state && cookies.hf_state !== state) return page(res, '<h2>State mismatch — possible CSRF. Start again.</h2>');

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier
    });
    const r = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const txt = await r.text();
    let d; try { d = JSON.parse(txt); } catch (e) { d = {}; }

    // clear the temporary cookies
    res.setHeader('Set-Cookie', ['hf_verifier=; Path=/; Max-Age=0', 'hf_state=; Path=/; Max-Age=0']);

    if (!r.ok || !d.refresh_token) {
      return page(res, '<h2>Token exchange did not return a refresh token</h2><p>Raw response (share this with Claude — it is NOT a secret if there is no token):</p><pre style="white-space:pre-wrap">' + esc(txt.slice(0, 1800)) + '</pre>');
    }

    // store the refresh token straight into KV (handles rotation automatically); wipe any stale cached access token
    const saved = await kvSet('higgs_refresh_token', d.refresh_token);
    await kvSet('higgs_access_expiry', '0');

    if (saved) {
      return page(res,
        '<h2>✅ Connected to Higgsfield</h2>' +
        '<p>Your login was saved securely to the backend (KV). <b>Nothing to copy.</b></p>' +
        '<p>Go tell Claude <b>"connected"</b> and it will generate a video on your existing credits.</p>'
      );
    }
    // KV not configured yet — fall back to manual env var
    return page(res,
      '<h2>✅ Connected — one more setup step</h2>' +
      '<p>KV storage isn\'t set up yet, so save this <b>refresh token</b> into Vercel env var <code>HIGGS_REFRESH_TOKEN</code> (creative-os-api). <b>Do NOT paste it into chat.</b></p>' +
      '<textarea readonly style="width:100%;height:130px;font-family:monospace;font-size:12px" onclick="this.select()">' + esc(d.refresh_token) + '</textarea>' +
      '<p style="color:#888;font-size:13px">Note: without KV, it will stop working after the first use (token rotation). Setting up KV is strongly recommended.</p>'
    );
  } catch (e) {
    return page(res, '<h2>Error</h2><pre>' + esc(e.message) + '</pre>');
  }
};
