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
      return res.status(200).json({ id });
    }

    if (action === 'status') {
      const id = (body.id || '').trim();
      if (!id) return res.status(400).json({ error: 'missing id' });
      const r = await fetch(base + '/v2/jobs/' + encodeURIComponent(id), { method: 'GET', headers });
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
