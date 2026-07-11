// Viral Spark Creative OS — HIGGSFIELD OAUTH: start login (Path B, uses Plus credits)
// Generates a PKCE challenge + state, stashes the verifier in a short-lived httpOnly cookie,
// then redirects the user to Higgsfield to log in and approve.
// After approval, Higgsfield redirects to /api/higgs-callback with a code.

const crypto = require('crypto');

const CLIENT_ID = process.env.HIGGS_CLIENT_ID || 'qmL4zyxg5skJLOml';
const REDIRECT_URI = process.env.HIGGS_REDIRECT_URI || 'https://creative-os-api.vercel.app/api/higgs-callback';
const AUTH_ENDPOINT = 'https://mcp.higgsfield.ai/oauth2/authorize';
const SCOPE = 'openid email offline_access';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

module.exports = async function handler(req, res) {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const cookieOpts = 'Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600';
  res.setHeader('Set-Cookie', [
    'hf_verifier=' + verifier + '; ' + cookieOpts,
    'hf_state=' + state + '; ' + cookieOpts
  ]);

  const url = AUTH_ENDPOINT +
    '?response_type=code' +
    '&client_id=' + encodeURIComponent(CLIENT_ID) +
    '&redirect_uri=' + encodeURIComponent(REDIRECT_URI) +
    '&scope=' + encodeURIComponent(SCOPE) +
    '&code_challenge=' + challenge +
    '&code_challenge_method=S256' +
    '&state=' + state;

  res.statusCode = 302;
  res.setHeader('Location', url);
  res.end();
};
