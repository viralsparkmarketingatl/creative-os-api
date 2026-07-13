// Viral Spark Creative OS — BRAND KIT STYLE-REFERENCE GENERATOR
// Input: a brand-kit PDF (base64) + inspiration images + a count N.
// Step 1: Claude reads the PDF + images (vision) and writes N DISTINCT world-class poster prompts.
// Step 2: GPT Image 2 renders each (edits, using the inspiration images as references), rate-limit-safe.
// Output: { images: [{prompt, b64}, ...] } — download these and load them as a client's style references.
// Needs BOTH env vars: ANTHROPIC_API_KEY and OPENAI_API_KEY.

// The user's creative direction — baked into every generation.
const CREATIVE_DIRECTION =
`Create a creative poster design as an Instagram carousel slide, 1080x1350 (portrait 4:5). Use the brand's own system (exact hex colors, fonts, logo, voice, identity from the brand kit). Make it about a relevant topic for their business. Use blending and gradients to make it stand out. Make it a WORLD-CLASS design — as if by someone doing graphics for 20+ years — using little-known techniques: combine elements in ways that are subconsciously favorable and draw the eye so the viewer finds it attractive without knowing why. Use expressions to draw attention, and blend/feather like an expert. Draw inspiration from the attached images; you may mask or reuse any elements of them however works best. Be maximally creative — this becomes a reusable template for future Instagram carousels.`;

const PLAN_SYSTEM =
`You are a world-class Instagram poster designer with 20+ years of experience AND an expert GPT Image 2 prompt engineer. You are given a brand's FULL brand kit (as a PDF) and several inspiration images. Design N DISTINCT style-reference posters — each a complete, standalone 1080x1350 portrait 4:5 Instagram slide that showcases the brand's visual system beautifully and could serve as a reusable template.

CREATIVE DIRECTION (apply to every poster):
${CREATIVE_DIRECTION}

COLOR PAIRING SYSTEM (this is how the set stays cohesive — follow it exactly when N is 8):
- Identify the brand's ~4 primary colors plus its white/light neutral from the kit.
- For EACH of the 4 primary colors, produce TWO posters:
  (A) COLOR-DOMINANT — that color fills the full background, with generous white space and a SECOND brand color as the accent.
  (B) WHITE-FLIP — a white/light background with that same color featured prominently (as the big headline color, a color block, and/or the subject treatment) plus a brand accent.
- That yields 8 references covering the whole palette BOTH ways (color-on-white and white-on-color) — the exact "4 colors flipped to white" system.
- Obey the kit's pairing rules precisely (e.g. if "Accent Red background → use ONLY white as the secondary color").
- If N is not 8, cover as many distinct brand pairings as N allows, still balancing color-dominant and white-flip.

Rules:
- Pull the EXACT hex colors, fonts, logo, voice, and identity from the brand kit PDF and use them precisely.
- Each poster is a DIFFERENT relevant topic for the brand's business — vary topics so the set is a versatile template library.
- Across the 8, vary composition, layout, and featured subject — but keep each one locked to its assigned color pairing above.
- Expert use of blending, gradients, feathering, masking, negative space and attention-guiding composition.
- Spell every word correctly. Keep any headline short and punchy.
- IMAGERY SAFETY: never depict blood, stool, vomit, wounds, or graphic/medical content — keep imagery clean and brand-safe.

For EACH poster, write ONE complete, standalone GPT Image 2 prompt (plain text) that will produce that exact design, and state "1080x1350 portrait 4:5 Instagram poster" in it.

Return ONLY a JSON array of exactly N strings (the prompts) — no markdown fences, no preamble.`;

function parseDataUrl(u) {
  const m = /^data:([a-zA-Z/+.-]+);base64,(.*)$/s.exec(u || '');
  if (m) return { media: m[1], b64: m[2] };
  return { media: 'image/png', b64: (u || '').replace(/^data:[^,]*,/, '') };
}
function buildEditForm(prompt, refImages, size, quality) {
  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('quality', quality);
  refImages.slice(0, 16).forEach((ref, idx) => {
    const p = parseDataUrl(ref);
    const buf = Buffer.from(p.b64, 'base64');
    const ext = p.media.includes('jpeg') ? 'jpg' : (p.media.includes('webp') ? 'webp' : 'png');
    form.append('image[]', new Blob([buf], { type: p.media }), 'ref' + idx + '.' + ext);
  });
  return form;
}
async function genImage(prompt, refImages, size, quality, oKey) {
  const deadline = Date.now() + 90000;
  let lastErr = '';
  for (let attempt = 0; ; attempt++) {
    const r = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST', headers: { Authorization: 'Bearer ' + oKey }, body: buildEditForm(prompt, refImages, size, quality)
    });
    if (r.ok) {
      const d = await r.json();
      const b64 = d && d.data && d.data[0] && d.data[0].b64_json;
      if (!b64) throw new Error('no image returned');
      return b64;
    }
    const t = await r.text(); lastErr = t.slice(0, 300);
    if (r.status !== 429) {
      if (/moderation_blocked|safety system|content_policy/i.test(lastErr)) throw new Error('MODERATION_BLOCKED');
      throw new Error('gpt-image-2 render failed: ' + lastErr);
    }
    if (Date.now() + 12000 + 25000 > deadline) throw new Error('RATE_LIMIT');
    await new Promise(res => setTimeout(res, 12000));
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const aKey = process.env.ANTHROPIC_API_KEY;
  const oKey = process.env.OPENAI_API_KEY;
  if (!aKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in Vercel.' });
  if (!oKey) return res.status(500).json({ error: 'OPENAI_API_KEY is not set in Vercel.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const pdfB64 = (body.pdf || '').replace(/^data:[^,]*,/, '');
    const brandText = (body.brandText || '').trim(); // optional pasted hex/identity if no PDF
    const extra = (body.extra || '').trim();
    const size = body.size || '1024x1536';
    const quality = body.quality || 'high';
    let count = parseInt(body.count, 10); if (!count || count < 1) count = 8; if (count > 8) count = 8;
    const refImages = (Array.isArray(body.refImages) ? body.refImages : []).filter(Boolean);
    if (!pdfB64 && !brandText && !refImages.length) return res.status(400).json({ error: 'Provide a brand-kit PDF, and/or pasted brand details, and/or reference images.' });

    // ---------- STEP 1: Claude reads the PDF + inspiration images, writes N prompts ----------
    const content = [];
    if (pdfB64) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } });
    refImages.slice(0, 8).forEach(u => {
      const p = parseDataUrl(u);
      content.push({ type: 'image', source: { type: 'base64', media_type: p.media, data: p.b64 } });
    });
    content.push({ type: 'text', text:
      (brandText ? ('BRAND DETAILS (hex codes / identity / voice):\n' + brandText + '\n\n') : '') +
      (extra ? ('EXTRA DIRECTION: ' + extra + '\n\n') : '') +
      'Design ' + count + ' DISTINCT world-class style-reference posters for this brand. Return the JSON array of exactly ' + count + ' GPT Image 2 prompts.'
    });

    const cr = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': aKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 5000, system: PLAN_SYSTEM, messages: [{ role: 'user', content }] })
    });
    if (!cr.ok) { const t = await cr.text(); return res.status(502).json({ error: 'Claude (style planner) failed.', detail: t.slice(0, 400) }); }
    const cdata = await cr.json();
    const raw = (cdata.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    let prompts;
    try { const s = raw.indexOf('['), e = raw.lastIndexOf(']'); prompts = JSON.parse(raw.slice(s, e + 1)); }
    catch (err) { return res.status(502).json({ error: 'Could not parse the style plan.', detail: raw.slice(0, 400) }); }
    if (!Array.isArray(prompts) || !prompts.length) return res.status(502).json({ error: 'Empty style plan.' });

    // ---------- STEP 2: render each poster (parallel, keep every success) ----------
    const settled = await Promise.allSettled(prompts.slice(0, count).map(p =>
      genImage(String(p), refImages, size, quality, oKey).then(b64 => ({ prompt: String(p), b64 }))
    ));
    const images = settled.filter(s => s.status === 'fulfilled').map(s => s.value);
    const failures = settled.filter(s => s.status === 'rejected').map(s => (s.reason && s.reason.message) || 'render failed');
    if (!images.length) return res.status(502).json({ error: failures[0] || 'no posters rendered' });
    return res.status(200).json({ images, partial: images.length < prompts.slice(0, count).length, pageError: failures[0] || '' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'server error' });
  }
};
