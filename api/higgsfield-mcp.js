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

// ---- KV (Vercel KV / Upstash Redis REST) — stores the ROTATING refresh token + a cached access token ----
function kvCfg() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return (url && token) ? { url: url.replace(/\/$/, ''), token } : null;
}
async function kvGet(key) {
  const c = kvCfg(); if (!c) return null;
  try {
    const r = await fetch(c.url + '/get/' + encodeURIComponent(key), { headers: { Authorization: 'Bearer ' + c.token } });
    if (!r.ok) return null;
    const d = await r.json();
    return (d && d.result != null) ? d.result : null;
  } catch (e) { return null; }
}
async function kvSet(key, val) {
  const c = kvCfg(); if (!c) return false;
  try {
    const r = await fetch(c.url + '/set/' + encodeURIComponent(key), { method: 'POST', headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'text/plain' }, body: String(val) });
    return r.ok;
  } catch (e) { return false; }
}

async function getAccessToken() {
  const now = Date.now();
  // reuse a still-valid cached access token so we don't rotate the refresh token on every poll
  const cached = await kvGet('higgs_access_token');
  const exp = parseInt(await kvGet('higgs_access_expiry') || '0', 10);
  if (cached && exp > now + 60000) return cached;

  const rt = (await kvGet('higgs_refresh_token')) || process.env.HIGGS_REFRESH_TOKEN;
  if (!rt) throw new Error('No refresh token available (KV empty and HIGGS_REFRESH_TOKEN unset). Re-run /api/higgs-auth.');
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rt, client_id: CLIENT_ID });
  const r = await fetch(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  const txt = await r.text();
  let d; try { d = JSON.parse(txt); } catch (e) { d = {}; }
  if (!r.ok || !d.access_token) throw new Error('token refresh failed (' + r.status + '): ' + txt.slice(0, 200));
  // persist the ROTATED refresh token immediately, plus cache the access token
  if (d.refresh_token) await kvSet('higgs_refresh_token', d.refresh_token);
  await kvSet('higgs_access_token', d.access_token);
  await kvSet('higgs_access_expiry', String(now + ((d.expires_in || 3600) * 1000)));
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
// The MCP often returns the job id / status / media URL as plain TEXT, not structured fields — grab them by regex too.
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
const MEDIA_URL_RE = /https?:\/\/[^\s"'\\)]+\.(?:mp4|mov|webm|m4v|jpg|jpeg|png|webp)/i;
const STATUS_RE = /\b(queued|in_progress|processing|completed|succeeded|failed|nsfw|error)\b/i;

async function callTool(at, sid, name, args) {
  const r = await rpc(at, sid, 'tools/call', { name, arguments: args || {} });
  if (!r.ok) throw new Error('tools/call ' + name + ' failed (' + r.status + '): ' + r.raw.slice(0, 300));
  if (r.data && r.data.error) throw new Error('tool ' + name + ' error: ' + JSON.stringify(r.data.error).slice(0, 300));
  return { p: toolPayload(r.data), raw: r.raw || '' };
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
      const { p, raw } = await callTool(at, sid, 'job_status', { jobId: id });
      const hay = (p && p.text ? p.text : '') + ' ' + JSON.stringify(p) + ' ' + raw;
      let status = (hay.match(STATUS_RE) || [])[1] || pickStatus(p) || 'in_progress';
      status = String(status).toLowerCase(); if (status === 'succeeded') status = 'completed';
      const url = pickUrl(p) || (hay.match(MEDIA_URL_RE) || [])[0] || '';
      return res.status(200).json({ status, url, raw: p });
    }

    // ---- motion (Kling 3.0 Motion Control) ----  character still + driving video -> animated clip
    if (action === 'motion') {
      // Resolve a character image and a motion video, each from a passed media id or a public URL.
      async function toMediaId(id, url, type) {
        id = (id || '').trim();
        if (id) return id;
        if (url && /^https?:\/\//i.test(url)) {
          const imp = await callTool(at, sid, 'media_import_url', { url, type });
          const hy = (imp.p && imp.p.text ? imp.p.text : '') + ' ' + JSON.stringify(imp.p) + ' ' + imp.raw;
          return deepFind(imp.p, ['media_id', 'id']) || (hy.match(UUID_RE) || [])[0] || '';
        }
        return '';
      }
      const imageId = await toMediaId(body.imageId, body.imageUrl, 'image');
      const motionVideoId = await toMediaId(body.motionVideoId, body.motionVideoUrl, 'video');
      if (!imageId) return res.status(400).json({ error: 'motion needs a character image (imageUrl or imageId)' });
      if (!motionVideoId) return res.status(400).json({ error: 'motion needs a driving video (motionVideoUrl or motionVideoId)' });
      const mparams = {
        image_id: imageId,
        motion_video_id: motionVideoId,
        resolution: body.resolution === '1080p' ? '1080p' : '720p',
        scene_control: body.scene_control === 'video' ? 'video' : 'image'
      };
      const { p, raw } = await callTool(at, sid, 'motion_control', { params: mparams });
      const hay = (p && p.text ? p.text : '') + ' ' + JSON.stringify(p) + ' ' + raw;
      const id = pickId(p) || (hay.match(UUID_RE) || [])[0] || '';
      if (!id) return res.status(502).json({ error: 'no job id from motion_control', raw: p });
      return res.status(200).json({ id, status: 'queued', raw: p });
    }

    // ---- avatar_train (Soul) ----  train a reusable identity from 5-20 photo URLs
    if (action === 'avatar_train') {
      const name = (body.name || '').trim();
      let urls = Array.isArray(body.imageUrls) ? body.imageUrls.filter(u => /^https?:\/\//i.test(u)) : [];
      if (!name) return res.status(400).json({ error: 'avatar needs a name' });
      if (urls.length < 5) return res.status(400).json({ error: 'need at least 5 photos to train an avatar (5-20)' });
      if (urls.length > 20) urls = urls.slice(0, 20);
      const type = body.avatarType === 'soul_cinematic' ? 'soul_cinematic' : 'soul_2';
      const { p, raw } = await callTool(at, sid, 'show_characters', { action: 'train', name, images: urls, type });
      const hay = (p && p.text ? p.text : '') + ' ' + JSON.stringify(p) + ' ' + raw;
      const soulId = deepFind(p, ['soul_id', 'character_id', 'id']) || (hay.match(UUID_RE) || [])[0] || '';
      if (!soulId) return res.status(502).json({ error: 'no soul_id returned from training', raw: p });
      return res.status(200).json({ soul_id: soulId, status: 'training' });
    }

    // ---- avatar_status ----  poll a Soul's training status
    if (action === 'avatar_status') {
      const soulId = (body.soul_id || '').trim();
      if (!soulId) return res.status(400).json({ error: 'missing soul_id' });
      const { p, raw } = await callTool(at, sid, 'show_characters', { action: 'status', soul_id: soulId });
      const hay = (p && p.text ? p.text : '') + ' ' + JSON.stringify(p) + ' ' + raw;
      let status = (hay.match(/\b(ready|training|failed|in_progress|processing|queued|completed|pending)\b/i) || [])[1] || 'training';
      status = status.toLowerCase();
      if (status === 'completed') status = 'ready';
      return res.status(200).json({ status, soul_id: soulId, raw: p });
    }

    // ---- avatar_image ----  generate a still USING a trained Soul avatar
    if (action === 'avatar_image') {
      const soulId = (body.soul_id || '').trim();
      const prompt = (body.prompt || '').trim();
      if (!soulId) return res.status(400).json({ error: 'missing soul_id' });
      if (!prompt) return res.status(400).json({ error: 'missing prompt' });
      const model = body.model === 'soul_cinema_studio' ? 'soul_cinema_studio' : 'soul_2';
      const iparams = { model, soul_id: soulId, prompt };
      if (body.aspect_ratio) iparams.aspect_ratio = body.aspect_ratio;
      const { p, raw } = await callTool(at, sid, 'generate_image', { params: iparams });
      const hay = (p && p.text ? p.text : '') + ' ' + JSON.stringify(p) + ' ' + raw;
      const url = pickUrl(p) || (hay.match(MEDIA_URL_RE) || [])[0] || '';
      const id = pickId(p) || (hay.match(UUID_RE) || [])[0] || '';
      if (url) return res.status(200).json({ id: id || '', status: 'completed', url });
      if (!id) return res.status(502).json({ error: 'no job id from generate_image', raw: p });
      return res.status(200).json({ id, status: 'queued', raw: p });
    }

    // ---- voices_list ----  preset + cloned voices for the talking spokesperson
    if (action === 'voices_list') {
      const { p, raw } = await callTool(at, sid, 'list_voices', { size: 100 });
      const out = []; const seen = new Set();
      const walk = (o) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(walk); return; }
        const id = o.voice_id || o.id; const name = o.name || o.display_name;
        if (id && name && !seen.has(id)) { seen.add(id); out.push({ voice_id: id, name: String(name), voice_type: o.voice_type || 'preset' }); }
        Object.values(o).forEach(walk);
      };
      walk(p);
      if (p && p.text) { try { walk(JSON.parse(p.text)); } catch (e) {} }
      return res.status(200).json({ voices: out });
    }

    // ---- voice_clone ----  clone a voice from a public audio URL (10s-3min)
    if (action === 'voice_clone') {
      const name = (body.name || '').trim();
      const audioUrl = (body.audioUrl || '').trim();
      if (!name) return res.status(400).json({ error: 'voice needs a name' });
      if (!/^https?:\/\//i.test(audioUrl)) return res.status(400).json({ error: 'voice_clone needs a public audio URL' });
      const imp = await callTool(at, sid, 'media_import_url', { url: audioUrl, type: 'audio' });
      const impHay = (imp.p && imp.p.text ? imp.p.text : '') + ' ' + JSON.stringify(imp.p) + ' ' + imp.raw;
      const audioId = deepFind(imp.p, ['media_id', 'id']) || (impHay.match(UUID_RE) || [])[0] || '';
      if (!audioId) return res.status(502).json({ error: 'could not import that audio', raw: imp.p });
      const { p, raw } = await callTool(at, sid, 'create_voice_from_confirmed_audio', { audio_media_id: audioId, name });
      const hay = (p && p.text ? p.text : '') + ' ' + JSON.stringify(p) + ' ' + raw;
      const voiceId = deepFind(p, ['voice_id', 'id']) || (hay.match(UUID_RE) || [])[0] || '';
      if (!voiceId) return res.status(502).json({ error: 'no voice_id returned from clone', raw: p });
      let status = (hay.match(/\b(completed|processing|ready|failed|voice_clone_failed)\b/i) || [])[1] || 'processing';
      return res.status(200).json({ voice_id: voiceId, voice_type: 'element', status: status.toLowerCase() });
    }

    // ---- talk_audio ----  text-to-speech from a script -> audio job (feeds talk_video)
    if (action === 'talk_audio') {
      const script = (body.script || '').trim();
      const voiceId = (body.voice_id || '').trim();
      const voiceType = body.voice_type === 'element' ? 'element' : 'preset';
      if (!script) return res.status(400).json({ error: 'missing script' });
      if (!voiceId) return res.status(400).json({ error: 'missing voice_id' });
      const aparams = { model: 'seed_audio', prompt: script, voice_type: voiceType, voice_id: voiceId };
      const { p, raw } = await callTool(at, sid, 'generate_audio', { params: aparams });
      const hay = (p && p.text ? p.text : '') + ' ' + JSON.stringify(p) + ' ' + raw;
      const id = pickId(p) || (hay.match(UUID_RE) || [])[0] || '';
      if (!id) return res.status(502).json({ error: 'no job id from generate_audio', raw: p });
      return res.status(200).json({ id, status: 'queued' });
    }

    // ---- talk_video ----  spokesperson image + generated audio -> lip-synced talking video (Wan 2.7)
    if (action === 'talk_video') {
      const audioId = (body.audioId || '').trim();
      if (!audioId) return res.status(400).json({ error: 'missing audioId (from talk_audio)' });
      let imageId = (body.imageId || '').trim();
      if (!imageId && body.imageUrl && /^https?:\/\//i.test(body.imageUrl)) {
        const imp = await callTool(at, sid, 'media_import_url', { url: body.imageUrl, type: 'image' });
        const impHay = (imp.p && imp.p.text ? imp.p.text : '') + ' ' + JSON.stringify(imp.p) + ' ' + imp.raw;
        imageId = deepFind(imp.p, ['media_id', 'id']) || (impHay.match(UUID_RE) || [])[0] || '';
      }
      if (!imageId) return res.status(400).json({ error: 'talk_video needs a spokesperson image (imageUrl or imageId)' });
      const model = body.model || 'wan2_7';
      const vparams = { model, medias: [{ role: 'start_image', value: imageId }, { role: 'audio_references', value: audioId }] };
      if (body.aspect_ratio) vparams.aspect_ratio = body.aspect_ratio;
      if (body.prompt) vparams.prompt = body.prompt;
      const { p, raw } = await callTool(at, sid, 'generate_video', { params: vparams });
      const hay = (p && p.text ? p.text : '') + ' ' + JSON.stringify(p) + ' ' + raw;
      const id = pickId(p) || (hay.match(UUID_RE) || [])[0] || '';
      if (!id) return res.status(502).json({ error: 'no job id from talk_video', raw: p });
      return res.status(200).json({ id, status: 'queued', raw: p });
    }

    // ---- submit ----  (text-to-video, or image-to-video when an image URL / media id is given)
    let prompt = (body.prompt || '').trim();
    const hasImage = !!((body.mediaId || '').trim() || (body.imageUrl && /^https?:\/\//i.test(body.imageUrl)));
    if (!prompt && !hasImage) return res.status(400).json({ error: 'missing prompt' });
    if (!prompt) prompt = 'Subtle, natural motion with a gentle cinematic camera move; keep it premium and on-brand.';
    const model = body.model || 'kling3_0_turbo';
    const params = { model, prompt };
    if (body.aspect_ratio) params.aspect_ratio = body.aspect_ratio;
    if (body.duration) params.duration = body.duration;
    // image-to-video: use a passed media id, or import a PUBLIC image URL -> media_id (Cloudinary etc.)
    let mediaId = (body.mediaId || '').trim();
    if (!mediaId && body.imageUrl && /^https?:\/\//i.test(body.imageUrl)) {
      const imp = await callTool(at, sid, 'media_import_url', { url: body.imageUrl, type: 'image' });
      const impHay = (imp.p && imp.p.text ? imp.p.text : '') + ' ' + JSON.stringify(imp.p) + ' ' + imp.raw;
      mediaId = deepFind(imp.p, ['media_id', 'id']) || (impHay.match(UUID_RE) || [])[0] || '';
    }
    if (mediaId) params.medias = [{ role: 'start_image', value: mediaId }];
    if (body.extraParams && typeof body.extraParams === 'object') Object.assign(params, body.extraParams);

    const { p, raw } = await callTool(at, sid, 'generate_video', { params });
    const hay = (p && p.text ? p.text : '') + ' ' + JSON.stringify(p) + ' ' + raw;
    const id = pickId(p) || (hay.match(UUID_RE) || [])[0] || '';
    if (!id) return res.status(502).json({ error: 'no job id from generate_video', raw: p });
    return res.status(200).json({ id, status: 'queued', raw: p });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'server error' });
  }
};
