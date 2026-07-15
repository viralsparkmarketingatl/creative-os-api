// Viral Spark Creative OS — MUSIC DIRECTOR (Vercel serverless function)
// Claude turns a scene / clip / vibe description into a world-class Suno music prompt
// (style descriptor + optional lyrics), engineered to match the emotion and hold attention.
// Reuses ANTHROPIC_API_KEY. Pairs with a Suno generation endpoint (added once a provider is chosen).
//
// POST { scene, extra?, wantVocals? } -> { title, instrumental, style, lyrics, notes }

const MUSIC_SYSTEM =
`You are a world-class film composer, music producer, and MASTER Suno prompt engineer. You know Suno's real mechanics cold and apply them every time. The user describes a scene, clip, or vibe (and maybe a project type or a reference sound). You translate intent into a pro-grade Suno prompt engineered to (1) match the exact emotion and (2) capture and HOLD attention.

THE TWO-FIELD LAW (never violate):
- STYLE field = the SOUND only (genre, tempo, instrumentation, vocal quality, production, mood). NO structural directives here.
- LYRICS field = the STRUCTURE (metatags in [brackets]) + any words. This is where the song is architected.

STYLE field formula — 4 to 7 comma-separated descriptors, in this order:
[primary genre + sub-genre], [tempo/BPM feel], [key instrumentation], [vocal quality OR 'instrumental'], [production character], [mood/emotion]
- Fewer than 4 = generic pop. More than 7 = muddy. Stay 4–7. Comma-separated, NOT prose. Keep under ~200 chars.

LYRICS field metatags:
- Structure tags: [Intro] [Verse] [Pre-Chorus] [Chorus] [Bridge] [Breakdown] [Outro] and ALWAYS finish with [End] (prevents trailing-audio artifacts).
- Per-section overrides (DAW-level control): e.g. [Chorus: full band, soaring vocals, heavy drums], [Bridge: stripped down, piano only]. Use these to shape dynamics section by section.
- Vocal tags where useful: [Male Vocal] [Female Vocal] [Duet] [Choir] [Whisper] [Rap] [Spoken Word] [Harmony].
- Instrumental songs: still give a [Intro]/[Build]/[Instrumental]/named-solo (e.g. [Piano Solo], [Strings Rise])/[Outro][End] structure with NO words — describe the section behavior in the brackets.
- Repeating the SAME [Chorus] text signals Suno to reuse that melody; different [Verse] text = different melodies.

Return ONLY a JSON object (no markdown fences, no preamble), of this exact shape:
{
 "title": "<short, evocative track title>",
 "instrumental": <true or false — true for scene/film scoring unless the user clearly wants vocals/lyrics>,
 "style": "<the STYLE field per the formula above — 4-7 comma descriptors, sound only, end with 'instrumental' when instrumental is true>",
 "lyrics": "<the LYRICS field: full metatag structure with [End]. If vocals: real lyrics inside the sections + vocal tags. If instrumental: the section skeleton with per-section behavior in brackets and NO words.>",
 "exclude": "<0-2 elements to put in Suno's Exclude field to keep OUT (e.g. 'drums, reverb'); empty string if none. Never write 'no vocals' here — that's handled by the instrumental flag.>",
 "notes": "<one sentence: the creative choice + one pro tip for THIS track (e.g. push Audio Influence high, or set Weirdness low)>"
}

Rules:
- Nail the EMOTION precisely. Engineer for attention: a strong central motif/hook and a clear tension→release arc.
- Be specific about instrumentation and a concrete BPM feel — specificity is what makes Suno deliver.
- Default to instrumental for film/scene scoring unless vocals are requested.
- NEVER name real living artists, bands, songs, or copyrighted scores — evoke the SOUND instead (Suno ignores artist names anyway, and it's safer).`;

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
    const scene = (body.scene || '').trim();
    const extra = (body.extra || '').trim();
    const reference = (body.reference || '').trim();
    const projectType = (body.projectType || '').trim();
    if (!scene) return res.status(400).json({ error: 'describe the scene / clip / vibe' });
    const wantVocals = body.wantVocals === true;

    const userText =
      (projectType ? ('PROJECT TYPE: ' + projectType + ' — tailor genre, length feel, and structure to this.\n\n') : '') +
      'SCENE / CLIP / VIBE:\n' + scene +
      (extra ? ('\n\nEXTRA DIRECTION:\n' + extra) : '') +
      (reference ? ('\n\nREFERENCE SOUND (align the style toward this described sonic character):\n' + reference) : '') +
      '\n\nVOCALS: ' + (wantVocals ? 'The user wants VOCALS/lyrics — write real lyrics and set instrumental=false.' : 'Default to INSTRUMENTAL unless the scene clearly needs vocals.') +
      '\n\nReturn ONLY the JSON object.';

    const cr = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': aKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 4000, system: MUSIC_SYSTEM, messages: [{ role: 'user', content: userText }] })
    });
    if (!cr.ok) { const t = await cr.text(); return res.status(502).json({ error: 'Claude (music director) failed.', detail: t.slice(0, 400) }); }
    const cdata = await cr.json();
    let raw = (cdata.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    raw = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    // 1) try strict JSON. 2) if that fails (e.g. truncated lyrics), pull fields directly so we never hard-fail.
    let out = null;
    try { const s = raw.indexOf('{'), e = raw.lastIndexOf('}'); if (s >= 0 && e > s) out = JSON.parse(raw.slice(s, e + 1)); } catch (e) {}
    if (!out || !out.style) {
      const f = (k) => { const m = new RegExp('"' + k + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(raw); return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\') : ''; };
      const style = f('style');
      if (style) out = { title: f('title') || 'Untitled', instrumental: !/"instrumental"\s*:\s*false/.test(raw), style, lyrics: f('lyrics'), exclude: f('exclude'), notes: f('notes') };
    }
    if (!out || !out.style) return res.status(502).json({ error: 'Could not parse the music prompt — hit Craft again.', detail: raw.slice(0, 300) });

    return res.status(200).json({
      title: out.title || 'Untitled',
      instrumental: out.instrumental !== false,
      style: out.style || '',
      lyrics: out.lyrics || '',
      exclude: out.exclude || '',
      notes: out.notes || ''
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'server error' });
  }
};
