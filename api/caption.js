// Viral Spark Creative OS — CAPTION generator (Vercel serverless function)
// Claude LOOKS at the selected media (public Bunny URLs) + the active brand kit and writes
// ONE ready-to-post social caption (hook + value + the brand's OWN CTA + hashtags).
// Used by the Publishing screen so a generated graphic/carousel gets a matching caption that
// feeds straight into Buffer. Needs ANTHROPIC_API_KEY.
//
// POST { imageUrls?[], brand?, context?, platform? } -> { caption }

const CAPTION_SYSTEM =
`You are a world-class social media copywriter. Write ONE ready-to-post caption for the image(s) shown, on behalf of the brand described. Follow every rule:

- OPEN WITH A HOOK: the first line must stop the scroll. No "Check out", "Excited to announce", "We are thrilled". Lead with the reader's problem, a surprising truth, or a bold promise.
- VALUE: 2–5 short lines that sell the OUTCOME/benefit — not a literal description of the image. Use line breaks for easy reading.
- VOICE: warm, friendly-expert, clear, light and optimistic, around a 4th-grade reading level. Sound like a helpful friend, not a brochure.
- CTA: end the body with the brand's OWN call to action EXACTLY as provided in the brand kit (its real booking link / phone / address / tagline). NEVER invent a generic CTA and NEVER borrow one from anywhere else. If no CTA is provided, close with a simple, natural invitation to reach out.
- HASHTAGS: last line only — 8–15 relevant hashtags, a mix of niche + local + broad. No banned, spammy, or irrelevant tags.
- MATCH THE IMAGE + TOPIC, but never say "in this image" or describe it literally.
- OUTPUT ONLY the caption text — no markdown, no surrounding quotes, no preamble or explanation.`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const aKey = process.env.ANTHROPIC_API_KEY;
  if (!aKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in Vercel project settings.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const platform = (body.platform || 'Instagram').trim();
    const context = (body.context || '').trim();
    const brand = body.brand || {};
    // Only image URLs are useful for vision; ignore videos/non-http.
    const imageUrls = (Array.isArray(body.imageUrls) ? body.imageUrls : [])
      .filter(u => /^https?:\/\//i.test(u) && !/\.(mp4|mov|webm|m4v)(\?|$)/i.test(u))
      .slice(0, 8);

    const colorsLine = (brand.colors || []).map(c => c.name + ' ' + c.hex).join(', ');
    const brandBlock = (brand.name ? ('BRAND: ' + brand.name + '\n') : '')
      + (colorsLine ? ('PALETTE: ' + colorsLine + '\n') : '')
      + (brand.guidelines ? ('BRAND VOICE & GUIDELINES:\n' + brand.guidelines + '\n') : '')
      + (brand.cta ? ('\nBRAND CALL-TO-ACTION (use EXACTLY, verbatim, as the caption CTA):\n' + brand.cta + '\n') : '');

    const content = [];
    imageUrls.forEach(u => content.push({ type: 'image', source: { type: 'url', url: u } }));
    content.push({ type: 'text', text:
      'Write ONE ' + platform + ' caption' + (imageUrls.length ? ' for the image(s) above' : '') + '.' +
      (context ? ('\n\nTOPIC / NOTES (what this post is about):\n' + context) : '') +
      (brandBlock ? ('\n\nBRAND KIT — write in this brand\'s voice and use its exact CTA:\n' + brandBlock) : '\n\n(No brand kit provided — keep it clean, generic, and professional; do not invent a specific business CTA.)') +
      '\n\nReturn ONLY the caption text.'
    });

    const cr = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': aKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 1200, system: CAPTION_SYSTEM, messages: [{ role: 'user', content }] })
    });
    if (!cr.ok) { const t = await cr.text(); return res.status(502).json({ error: 'Claude (caption) failed.', detail: t.slice(0, 400) }); }
    const cdata = await cr.json();
    let caption = (cdata.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    caption = caption.replace(/^["'`]+|["'`]+$/g, '').trim();
    if (!caption) return res.status(502).json({ error: 'Empty caption returned.' });
    return res.status(200).json({ caption });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'server error' });
  }
};
