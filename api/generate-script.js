// Viral Spark Creative OS — script generation proxy (Vercel serverless function)
// Calls Claude (Anthropic Messages API) with the Viral Hook Library framework as
// the system prompt. Holds ANTHROPIC_API_KEY server-side (never in the browser).
// Set ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables.

const FRAMEWORK = require('./viral-framework.js');
const ENTRIES   = require('./viral-entries.js'); // all 959 dissected videos, distilled

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in Vercel project settings.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const client   = (body.client   || '').trim();
    const brandInfo= (body.brandInfo || '').trim();
    const topic    = (body.topic    || '').trim();
    const platform = (body.platform || 'Instagram Reels / TikTok').trim();
    const length   = (body.length   || '30 seconds').trim();
    const goal     = (body.goal     || 'Free lead magnet via comment keyword').trim();
    const hookStyle= (body.hookStyle || 'auto').trim();
    const extra    = (body.extra    || '').trim();
    let   count    = parseInt(body.count, 10); if (!count || count < 1) count = 1; if (count > 6) count = 6;

    if (!topic) return res.status(400).json({ error: 'missing topic/angle' });

    const userMsg =
`Write ${count} distinct short-form video script${count > 1 ? 's' : ''} for this client. Each must follow the Viral Spark Script Architecture and the OUTPUT FORMAT exactly.

CLIENT: ${client || '(unspecified)'}
BUSINESS CONTEXT: ${brandInfo || '(none provided — infer sensibly from the client name and topic)'}
TOPIC / ANGLE: ${topic}
PLATFORM: ${platform}
TARGET LENGTH: ${length}
GOAL / OFF-RAMP (CTA): ${goal}
HOOK STYLE: ${hookStyle === 'auto' ? 'Auto — pick the strongest hook category for this topic (and vary it across variations)' : hookStyle}
${extra ? 'EXTRA DIRECTION: ' + extra + '\n' : ''}
${count > 1 ? 'Make each variation a genuinely DIFFERENT hook category/angle — not the same script reworded.' : ''}
FIRST silently scan the 959-entry pattern library in your system context, pick the proven hook formulas whose structure best fits this topic/niche/goal, then adapt their STRUCTURE (never their words) into the script. When a beat is modeled on a specific entry, you may note it inline like [modeled on V214]. Return only the script(s) in the required Markdown format — no preamble.`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: 8000,
        // Framework + all 959 entries as ONE cached prefix (identical every call).
        // First call writes the cache (~1.25x); calls within 5 min read it at ~0.1x.
        system: [
          { type: 'text', text: FRAMEWORK },
          { type: 'text', text: ENTRIES, cache_control: { type: 'ephemeral' } }
        ],
        messages: [{ role: 'user', content: userMsg }]
      })
    });

    if (!r.ok) {
      const t = await r.text();
      return res.status(502).json({
        error: 'Claude request failed. Most common causes: ANTHROPIC_API_KEY missing/invalid, or no API credit on the Anthropic account (console.anthropic.com → Billing).',
        detail: t.slice(0, 500)
      });
    }

    const data = await r.json();
    const md = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim();

    if (!md) return res.status(502).json({ error: 'No script returned.', detail: JSON.stringify(data).slice(0, 400) });
    return res.status(200).json({ markdown: md });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'server error' });
  }
};
