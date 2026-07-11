// Viral Spark Creative OS — HIGGSFIELD via MCP (Path B — spends the account's Plus credits)
// Refresh token (Vercel env HIGGS_REFRESH_TOKEN) -> access token -> call the Higgsfield MCP
// (JSON-RPC over HTTP) directly. Actions:
//   ping   -> verify auth + list available tools (NO credits used)
//   submit -> generate_video (text-to-video by default) -> returns { id }
//   status -> job_status -> returns { status, url }
// Env: HIGGS_REFRESH_TOKEN (required), HIGGS_CLIENT_ID (optional, defaults to our registered client).

const TOKEN_ENDPOINT = 'https://mcp.higgsfield.ai/oauth2/token';
const MCP_URL = 'https://mcp.higgsfield.ai/mcp';
const CLIENT_ID = process.env.HIGGS_CLIENT_ID || 'qmL4zyxg5skJLOml';

async function getAccessToken() {
  const rt = process.env.HIGGS_REFRESH_TOKEN;
  if (!rt) throw new Error('HIGGS_REFRESH_TOKEN is not set in Vercel.');
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: CLIENT_ID });
  const r = await fetch(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  const txt = await r.text();
  let d; try { d = JSON.parse(txt); } catch (e) { d = {}; }
  if (!r.ok || !d.access_token) throw new Error('token refresh failed (' + r.status + '): ' + txt.slice(0, 200));
  return d.access_token;
}

function parseMcp(txt) {
  txt = (txt || '').trim();
  if (txt.startsWith('{')) { try { return JSON.parse(txt); } catch (e) {} }
  const lines = txt.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (l.startsWith('data:')) { const j = l.slice(5).trim(); try { return JSON.parse(j); } catch (e) {} }
  }
  return null;
}

let _id = 0;
async function rpc(accessToken, sid, method, params) {
  const headers = { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  if (sid) headers['Mcp-Session-Id'] = sid;
  const r = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: ++_id, method, params: params || {} }) });
  const outSid = r.headers.get('mcp-session-id') || sid;
  const txt = await r.text();
  return { ok: r.ok, status: r.status, sid: outSid, data: parseMcp(txt), raw: txt };
}

async function openSession(accessToken) {
  const init = await rpc(accessToken, null, 'initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'viral-spark-creative-os', version: '1.0' }
  });
  if (!init.ok) throw new Error('MCP initialize failed (' + init.status + '): ' + init.raw.slice(0, 250));
  const sid = init.sid;
  try {
    const headers = { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
    if (sid) headers['Mcp-Session-Id'] = sid;
    await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  } catch (e) {}
  return sid;
}

function toolPayload(out) {
  const c = (out && out.result && out.result.content) || [];
  for (const item of c) {
    if (item.type === 'text' && item.text) { try { return JSON.parse(item.text); } catch (e) { return { text: item.text }; } }
    if (item.type === 'resource' && item.resource) return { resource: item.resource };
  }
  if (out && out.result && out.result.structuredContent) return out.result.structuredContent;
  return (out && out.result) || {};
}
function deepFind(o, keys) {
  if (!o || typeof o !== 'object') return '';
  for (const k of keys) if (o[k]) return o[k];
  for (const v of Object.values(o)) { if (v && typeof v === 'object') { const f = deepFind(v, keys); if (f) return f; } }
  return '';
}
function pickId(p) { return deepFind(p, ['id', 'job_id', 'jobId', 'generation_id']); }
function pickStatus(p) {
  const g = (p && (p.generation || p)) || {};
  return String(g.status || deepFind(p, ['status']) || '').toLowerCase();
}
function pickUrl(p) {
  return deepFind(p, ['rawUrl', 'raw_url', 'result_url', 'url', 'uri', 'video_url']);
}

async function callTool(at, sid, name, args) {
  const r = await rpc(at, sid, 'tools/call', { name, arguments: args || {} });
  if (!r.ok) throw new Error('tools/call ' + name + ' failed (' + r.status + '): ' + r.raw.slice(0, 300));
  if (r.data && r.data.error) throw new Error('tool ' + name + ' error: ' + JSON.stringify(r.data.error).slice(0, 300));
  return toolPayload(r.data);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = body.action || 'submit';
    const at = await getAccessToken();
    const sid = await openSession(at);

    if (action === 'ping') {
      const t = await rpc(at, sid, 'tools/list', {});
      const tools = (t.data && t.data.result && t.data.result.tools) || [];
      return res.status(200).json({ ok: true, sessionOpened: !!sid, toolCount: tools.length, tools: tools.map(x => x.name) });
    }

    if (action === 'status') {
      const id = (body.id || '').trim();
      if (!id) return res.status(400).json({ error: 'missing id' });
      const p = await callTool(at, sid, 'job_status', { jobId: id });
      return res.status(200).json({ status: pickStatus(p) || 'in_progress', url: pickUrl(p), raw: p });
    }

    // ---- submit ----
    const prompt = (body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'missing prompt' });
    const model = body.model || 'kling3_0_turbo';
    const params = { model, prompt };
    if (body.aspect_ratio) params.aspect_ratio = body.aspect_ratio;
    if (body.duration) params.duration = body.duration;
    // image-to-video: caller passes a media id (from a prior media_import_url/upload) as body.mediaId
    if (body.mediaId) params.medias = [{ role: 'start_image', value: body.mediaId }];
    if (body.extraParams && typeof body.extraParams === 'object') Object.assign(params, body.extraParams);

    const p = await callTool(at, sid, 'generate_video', { params });
    const id = pickId(p);
    if (!id) return res.status(502).json({ error: 'no job id from generate_video', raw: p });
    return res.status(200).json({ id, status: pickStatus(p) || 'queued', raw: p });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'server error' });
  }
};
