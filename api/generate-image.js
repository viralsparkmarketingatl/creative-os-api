// Viral Spark Creative OS — image generation proxy (Vercel serverless function)
// Uses OpenAI gpt-image-2 (best text accuracy, ~$0.03-0.06/img). Requires the OpenAI
// organization to be ID-verified (platform.openai.com -> Settings -> Organization).
// - With a reference image -> IMAGE EDITS (reference-guided full poster).
// - Without -> plain generation (gpt-image-2, falls back to dall-e-3).

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
    const size = body.size || '1536x1152';   // 4:3 keeps the whole template in frame
    const quality = body.quality || 'high';
    // Accept an array of references (refImages) OR a single one (refImage, back-compat)
    const refImages = (Array.isArray(body.refImages) && body.refImages.length)
      ? body.refImages.filter(Boolean)
      : (body.refImage ? [body.refImage] : []);
    if (!prompt) return res.status(400).json({ error: 'missing prompt' });

    // ---------- REFERENCE-GUIDED (image edits, gpt-image-2) ----------
    if (refImages.length) {
      const form = new FormData();
      form.append('model', 'gpt-image-2');
      form.append('prompt', prompt);
      form.append('size', size);
      form.append('quality', quality);
      // gpt-image-2 edits accepts multiple reference images via image[] (up to ~16)
      refImages.slice(0, 16).forEach((ref, idx) => {
        let raw = ref, mime = 'image/png';
        const m = /^data:(image\/[a-zA-Z]+);base64,(.*)$/s.exec(ref);
        if (m) { mime = m[1]; raw = m[2]; }
        const buf = Buffer.from(raw, 'base64');
        const ext = mime.includes('jpeg') ? 'jpg' : (mime.includes('webp') ? 'webp' : 'png');
        form.append('image[]', new Blob([buf], { type: mime }), 'reference' + idx + '.' + ext);
      });

      const r = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key }, // no Content-Type — fetch sets the multipart boundary
        body: form
      });
      if (!r.ok) {
        const t = await r.text();
        return res.status(502).json({
          error: 'gpt-image-2 edit failed. Most common cause: your OpenAI organization is not ID-verified yet (platform.openai.com -> Settings -> Organization -> Verify). It can also be a billing/credit issue.',
          detail: t.slice(0, 400)
        });
      }
      const data = await r.json();
      const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
      if (!b64) return res.status(502).json({ error: 'No image returned from edits.' });
      return res.status(200).json({ b64 });
    }

    // ---------- PLAIN GENERATION (gpt-image-2, fallback dall-e-3) ----------
    let r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: 'gpt-image-2', prompt, size, quality, n: 1 })
    });
    if (!r.ok) {
      const firstErr = await r.text();
      r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: 'dall-e-3', prompt, size: '1024x1024', n: 1, response_format: 'b64_json' })
      });
      if (!r.ok) {
        const secondErr = await r.text();
        return res.status(502).json({ error: 'Image generation failed.', gpt_image_2: firstErr.slice(0, 300), dall_e_3: secondErr.slice(0, 300) });
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
