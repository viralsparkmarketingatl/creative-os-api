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

    return page(res,
      '<h2>✅ Connected to Higgsfield</h2>' +
      '<p><b>Copy the refresh token below</b> and paste it into Vercel as an environment variable named <code>HIGGS_REFRESH_TOKEN</code> on the <b>creative-os-api</b> project.</p>' +
      '<p style="color:#b00"><b>Do NOT paste this token into the chat.</b> It is a password to your Higgsfield credits — Vercel env var only.</p>' +
      '<textarea readonly style="width:100%;height:130px;font-family:monospace;font-size:12px" onclick="this.select()">' + esc(d.refresh_token) + '</textarea>' +
      '<p style="color:#888;font-size:13px">Scope: ' + esc(d.scope || '(none returned)') + ' · expires_in: ' + esc(String(d.expires_in || '?')) + 's</p>' +
      '<p>Once it is saved in Vercel, tell Claude "token is saved" and it will test video generation on your existing credits.</p>'
    );
  } catch (e) {
    return page(res, '<h2>Error</h2><pre>' + esc(e.message) + '</pre>');
  }
};
