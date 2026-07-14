// Viral Spark Creative OS — MUSIC generation via Apiframe v2 unified API
// One endpoint, six engines: suno, udio, mureka, producer, lyria, elevenlabs-music.
//   generate: POST {base}/v2/music/generate  { model, prompt, ... } -> { jobId }
//   status:   GET  {base}/v2/jobs/{jobId}     -> { status, result:{ tracks:[{audioUrl,...}] } }
// Auth: Apiframe accepts the key directly; we send both Authorization and X-API-Key to be safe.
//
// Env (creative-os-api): SUNO_API_KEY  (+ optional SUNO_API_BASE, default https://api.apiframe.pro)
//
// POST { action, ... }:
//   action:'generate' { engine, style, lyrics?, title?, instrumental? } -> { id }
//   action:'status'   { id } -> { status, tracks:[{url,title,image,duration}] }

const DEFAULT_BASE = 'https://api.apiframe.pro';
const MODELS = { suno: 'suno', udio: 'udio', mureka: 'mureka', producer: 'producer', lyria: 'lyria', elevenlabs: 'elevenlabs-music', 'elevenlabs-music': 'elevenlabs-music' };

function pick(o, keys) {
  if (!o || typeof o !== 'object') return '';
  for (const k of keys) if (o[k] != null && o[k] !== '') return o[k];
  return '';
}
// Walk a varying response for finished tracks (audio url + meta).
function collectTracks(d) {
  const out = []; const seen = new Set();
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const url = pick(o, ['audioUrl', 'audio_url', 'audio']) ||
      (typeof o.url === 'string' && /\.(mp3|wav|m4a|ogg)/i.test(o.url) ? o.url : '');
    if (typeof url === 'string' && /^https?:\/\//i.test(url) && !seen.has(url)) {
      seen.add(url);
      out.push({ url, title: pick(o, ['title']) || '', image: pick(o, ['imageUrl', 'image_url', 'image', 'cover']) || '', duration: pick(o, ['duration']) || '' });
    }
    Object.values(o).forEach(walk);
  };
  walk(d);
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = process.env.SUNO_API_KEY;
  if (!key) return res.status(500).json({ error: 'SUNO_API_KEY is not set in Vercel (creative-os-api). Get one from apiframe.ai.' });
  const base = (process.env.SUNO_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
  const headers = { Authorization: key, 'X-API-Key': key, 'Content-Type': 'application/json' };

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = body.action || 'generate';

    if (action === 'generate') {
      const model = MODELS[(body.engine || 'suno').toLowerCase()] || 'suno';
      const style = (body.style || '').trim();
      const lyrics = (body.lyrics || '').trim();
      const title = (body.title || '').trim();
      const instrumental = body.instrumental !== false && !lyrics;
      if (!style && !lyrics) return res.status(400).json({ error: 'need a style or lyrics' });

      // ---- Suno reference audio: upload the clip -> extend it (Suno's "Upload Audio" flow) ----
      if (model === 'suno' && body.refAudio) {
        const m = /^data:([^;]+);base64,(.*)$/s.exec(body.refAudio);
        const mime = m ? m[1] : 'audio/mpeg';
        const b64 = m ? m[2] : String(body.refAudio).replace(/^data:[^,]*,/, '');
        const buf = Buffer.from(b64, 'base64');
        if (!buf.length) return res.status(400).json({ error: 'reference audio decoded to 0 bytes' });
        if (buf.length > 10 * 1024 * 1024) return res.status(413).json({ error: 'reference audio must be ≤10MB for Suno upload' });
        // 1) upload (multipart) -> parent task
        const form = new FormData();
        const ext = mime.includes('wav') ? 'wav' : (mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : 'mp3');
        form.append('audio', new Blob([buf], { type: mime }), 'reference.' + ext);
        const upR = await fetch(base + '/suno-upload', { method: 'POST', headers: { Authorization: key }, body: form });
        const upTxt = await upR.text(); let upD; try { upD = JSON.parse(upTxt); } catch (e) { upD = {}; }
        if (!upR.ok) return res.status(502).json({ error: 'Suno upload failed (' + upR.status + '): ' + upTxt.slice(0, 300) });
        const parent = pick(upD, ['task_id', 'taskId', 'id']);
        if (!parent) return res.status(502).json({ error: 'no task id from suno-upload', raw: upD });
        // 2) extend it with the crafted prompt/style
        const exPayload = { parent_task_id: parent, model: body.sunoModel || 'V4_5', prompt: style || title || 'continue this' };
        if (title) exPayload.title = title;
        if (style) exPayload.tags = style;
        if (lyrics) exPayload.lyrics = lyrics;
        if (typeof body.continue_at === 'number') exPayload.continue_at = body.continue_at;
        const exR = await fetch(base + '/suno-extend', { method: 'POST', headers: { Authorization: key, 'Content-Type': 'application/json' }, body: JSON.stringify(exPayload) });
        const exTxt = await exR.text(); let exD; try { exD = JSON.parse(exTxt); } catch (e) { exD = {}; }
        if (!exR.ok) return res.status(502).json({ error: 'Suno extend failed (' + exR.status + '): ' + exTxt.slice(0, 300) });
        const exId = pick(exD, ['task_id', 'taskId', 'id']);
        if (!exId) return res.status(502).json({ error: 'no task id from suno-extend', raw: exD });
        return res.status(200).json({ id: exId, poll: 'v1' });
      }

      // Unified v2 takes a single prompt (1–5000 chars). Fold intent into it, plus best-effort fields.
      let prompt = style || title || 'a song';
      if (instrumental && !/instrumental/i.test(prompt)) prompt += ', instrumental, no vocals';
      const payload = { model, prompt };
      if (title) payload.title = title;
      if (lyrics) payload.lyrics = lyrics; // best-effort; ignored by models that don't take it

      const r = await fetch(base + '/v2/music/generate', { method: 'POST', headers, body: JSON.stringify(payload) });
      const txt = await r.text(); let d; try { d = JSON.parse(txt); } catch (e) { d = {}; }
      if (!(r.status === 200 || r.status === 201 || r.status === 202)) {
        return res.status(502).json({ error: 'Apiframe ' + model + ' generate failed (' + r.status + '): ' + txt.slice(0, 300) });
      }
      const id = pick(d, ['jobId', 'job_id', 'task_id', 'taskId', 'id']);
      if (!id) return res.status(502).json({ error: 'no job id from Apiframe', raw: d });
      return res.status(200).json({ id, poll: 'v2' });
    }

    if (action === 'status') {
      const id = (body.id || '').trim();
      if (!id) return res.status(400).json({ error: 'missing id' });
      let r;
      if (body.poll === 'v1') {
        // Suno extend/upload flow uses the v1 poll endpoint
        r = await fetch(base + '/fetch', { method: 'POST', headers, body: JSON.stringify({ task_id: id }) });
      } else {
        r = await fetch(base + '/v2/jobs/' + encodeURIComponent(id), { method: 'GET', headers });
      }
      const txt = await r.text(); let d; try { d = JSON.parse(txt); } catch (e) { d = {}; }
      if (!r.ok) return res.status(502).json({ error: 'Apiframe job fetch failed (' + r.status + '): ' + txt.slice(0, 300) });
      const tracks = collectTracks(d);
      let status = String(pick(d, ['status']) || '').toLowerCase();
      if (tracks.length) status = 'finished';
      else if (/fail|error|cancel/i.test(status)) status = 'failed';
      else status = 'processing';
      return res.status(200).json({ status, tracks });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'server error' });
  }
};
