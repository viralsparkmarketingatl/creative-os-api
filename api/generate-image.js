// Viral Spark Creative OS — image generation proxy (Vercel serverless function)
// Holds the OpenAI key server-side (env var).
// - If a reference image is provided -> uses the IMAGE EDITS endpoint (reference-guided,
//   reproduces the reference's style/layout). Needs gpt-image-1.
// - If no reference -> plain text-to-image generation (gpt-image-1, falls back to dall-e-3).

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).json({ error: 'OPENAI_API_KEY is not set in Vercel project settings.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const prompt = (body.prompt || '').trim();
    const size = body.size || '1536x1024';
    const refImage = body.refImage || null; // data URL or raw base64
    if (!prompt) return res.status(400).json({ error: 'missing prompt' });

    // ---------- REFERENCE-GUIDED (image edits) ----------
    if (refImage) {
      let raw = refImage, mime = 'image/png';
      const m = /^data:(image\/[a-zA-Z]+);base64,(.*)$/s.exec(refImage);
      if (m) { mime = m[1]; raw = m[2]; }
      const buf = Buffer.from(raw, 'base64');
      const ext = mime.includes('jpeg') ? 'jpg' : (mime.includes('webp') ? 'webp' : 'png');

      const form = new FormData();
      form.append('model', 'gpt-image-1');
      form.append('prompt', prompt);
      form.append('size', size);
      form.append('image', new Blob([buf], { type: mime }), 'reference.' + ext);

      const r = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key }, // do NOT set Content-Type; fetch sets the multipart boundary
        body: form
      });
      if (!r.ok) {
        const t = await r.text();
        return res.status(502).json({
          error: 'Reference-guided generation failed. This needs gpt-image-1 (your OpenAI org may need one-time ID verification at platform.openai.com → Settings → Organization).',
          detail: t.slice(0, 400)
        });
      }
      const data = await r.json();
      const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
      if (!b64) return res.status(502).json({ error: 'No image returned from edits.' });
      return res.status(200).json({ b64 });
    }

    // ---------- PLAIN GENERATION (no reference) ----------
    let r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, size, n: 1 })
    });
    if (!r.ok) {
      const firstErr = await r.text();
      r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: 'dall-e-3', prompt, size: '1792x1024', n: 1, response_format: 'b64_json' })
      });
      if (!r.ok) {
        const secondErr = await r.text();
        return res.status(502).json({ error: 'Both image models failed.', gpt_image_1: firstErr.slice(0, 300), dall_e_3: secondErr.slice(0, 300) });
      }
    }
    const data = await r.json();
    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) return res.status(502).json({ error: 'No image returned.' });
    return res.status(200).json({ b64 });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'server error' });
  }
};
