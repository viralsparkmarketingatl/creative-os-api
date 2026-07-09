// Viral Spark Creative OS — image generation proxy (Vercel serverless function)
// Holds the OpenAI key server-side (env var), generates a scene, returns base64.
// Front-end composites the branded frame on top, so this only makes the raw picture.

module.exports = async function handler(req, res) {
  // CORS — allow the zero-install app (file:// or hosted) to call this
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
    if (!prompt) return res.status(400).json({ error: 'missing prompt' });

    // 1) Try gpt-image-1 (best quality/text handling; returns b64 by default)
    let r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, size, n: 1 })
    });

    // 2) Fallback to dall-e-3 (widely available; ask for b64 explicitly)
    if (!r.ok) {
      const firstErr = await r.text();
      r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt,
          size: '1792x1024',
          n: 1,
          response_format: 'b64_json'
        })
      });
      if (!r.ok) {
        const secondErr = await r.text();
        return res.status(502).json({
          error: 'Both image models failed.',
          gpt_image_1: firstErr.slice(0, 300),
          dall_e_3: secondErr.slice(0, 300)
        });
      }
    }

    const data = await r.json();
    const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) return res.status(502).json({ error: 'No image returned.' });
    return res.status(200).json({ b64 });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'server error' });
  }
}
