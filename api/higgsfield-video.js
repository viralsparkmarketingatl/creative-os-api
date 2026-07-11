// Viral Spark Creative OS — HIGGSFIELD VIDEO (Cloud API, Path A)
// Turns a prompt (text-to-video) or a starting image (image-to-video) into a short social video.
// Auth: Higgsfield Cloud API key pair, stored in ONE Vercel env var HIGGSFIELD_KEY = "KEY_ID:KEY_SECRET".
// Flow (async): {action:'submit'} -> returns {id};  {action:'status', id} -> {status, url} until completed.
//
// Confirmed from the official SDK (github.com/higgsfield-ai/higgsfield-js):
//   Base:   https://platform.higgsfield.ai
//   Auth:   Authorization: Key KEY_ID:KEY_SECRET
//   I2V:    POST /v1/image2video/dop   body { input:{ model:'dop-turbo', prompt, input_images:[{type:'image_url', image_url}] } }
//   Poll:   GET  /requests/{id}/status  -> queued|in_progress|completed|failed|nsfw ; url at jobs[0].results.raw.url

const BASE = 'https://platform.higgsfield.ai';

function pickId(d) {
  if (!d || typeof d !== 'object') return '';
  return d.id || d.request_id || d.requestId || d.generation_id || d.generationId
    || (d.jobs && d.jobs[0] && (d.jobs[0].id || d.jobs[0].request_id))
    || (d.job_set && d.job_set.id) || '';
}
function pickStatus(d) {
  const s = (d && (d.status || (d.jobs && d.jobs[0] && d.jobs[0].status))) || '';
  return String(s).toLowerCase();
}
function pickUrl(d) {
  if (!d || typeof d !== 'object') return '';
  const j = d.jobs && d.jobs[0];
  return (j && j.results && j.results.raw && j.results.raw.url)
    || (d.results && d.results.raw && d.results.raw.url)
    || (j && j.result_url) || d.result_url || d.url
    || (d.results && d.results.url) || '';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = process.env.HIGGSFIELD_KEY;
  if (!key) return res.status(500).json({ error: 'HIGGSFIELD_KEY is not set in Vercel (format: KEY_ID:KEY_SECRET).' });
  const authHeaders = { 'Authorization': 'Key ' + key, 'content-type': 'application/json' };

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = body.action || 'submit';

    // ---------- POLL ----------
    if (action === 'status') {
      const id = (body.id || '').trim();
      if (!id) return res.status(400).json({ error: 'missing id' });
      const r = await fetch(BASE + '/requests/' + encodeURIComponent(id) + '/status', { headers: authHeaders });
      const txt = await r.text();
      let d; try { d = JSON.parse(txt); } catch (e) { d = {}; }
      if (!r.ok) return res.status(502).json({ error: 'status check failed', detail: txt.slice(0, 300) });
      return res.status(200).json({ status: pickStatus(d) || 'in_progress', url: pickUrl(d), raw: d });
    }

    // ---------- SUBMIT ----------
    const mode = body.mode === 'text' ? 'text' : 'image';
    const prompt = (body.prompt || '').trim();
    const imageUrl = (body.imageUrl || '').trim();
    const model = body.model || 'dop-turbo';
    if (!prompt) return res.status(400).json({ error: 'missing prompt' });

    let endpoint, input;
    if (mode === 'image') {
      if (!imageUrl) return res.status(400).json({ error: 'image mode needs a public imageUrl' });
      endpoint = '/v1/image2video/dop';
      input = { model, prompt, input_images: [{ type: 'image_url', image_url: imageUrl }] };
    } else {
      // text-to-video — endpoint to be verified on first live run; best-effort per SDK naming.
      endpoint = '/v1/text2video/dop';
      input = { model, prompt };
    }
    if (body.duration) input.duration = body.duration;
    if (body.aspect_ratio) input.aspect_ratio = body.aspect_ratio;

    const r = await fetch(BASE + endpoint, { method: 'POST', headers: authHeaders, body: JSON.stringify({ input }) });
    const txt = await r.text();
    let d; try { d = JSON.parse(txt); } catch (e) { d = {}; }
    if (!r.ok) return res.status(502).json({ error: 'submit failed', endpoint, detail: txt.slice(0, 400) });
    const id = pickId(d);
    if (!id) return res.status(502).json({ error: 'no job id in response', detail: txt.slice(0, 400) });
    return res.status(200).json({ id, status: pickStatus(d) || 'queued', raw: d });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'server error' });
  }
};
