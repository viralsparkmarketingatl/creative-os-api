// Viral Spark Creative OS — BUNNY.NET upload proxy (Vercel serverless function)
// Takes a base64 (data URL or raw) image/video/audio, PUTs it to a Bunny Edge Storage
// zone, and returns the PUBLIC CDN URL (served from viralspark-media.b-cdn.net).
// This is the bridge that lets Higgsfield "pull" our generated media by a public URL
// (media_import_url) — needed for #2 image->video, #3 motion control, #4/#5 avatar+voice.
//
// Env (creative-os-api Vercel project):
//   BUNNY_STORAGE_ZONE = viral-spark-storage
//   BUNNY_STORAGE_KEY  = (Storage -> FTP & API Access -> Password)
//   BUNNY_STORAGE_HOST = storage.bunnycdn.com   (regional host if Main isn't Frankfurt)
//   BUNNY_CDN_HOST     = viralspark-media.b-cdn.net
//
// POST { data, ext?, folder?, filename? } -> { url, path }
//   data     : "data:<mime>;base64,...."  OR raw base64  (required)
//   ext      : file extension override (png/jpg/webp/mp4/mov/webm/mp3/wav)
//   folder   : optional path prefix (e.g. "carousels", "video-src", "avatars", "voice")
//   filename : optional explicit name (without folder); otherwise auto-timestamped

const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/mp4': 'm4a', 'audio/webm': 'webm'
};

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const zone = process.env.BUNNY_STORAGE_ZONE;
  const key = process.env.BUNNY_STORAGE_KEY;
  const sHost = (process.env.BUNNY_STORAGE_HOST || 'storage.bunnycdn.com').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const cdnHost = (process.env.BUNNY_CDN_HOST || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!zone || !key) return res.status(500).json({ error: 'Bunny not configured: set BUNNY_STORAGE_ZONE + BUNNY_STORAGE_KEY in Vercel.' });
  if (!cdnHost) return res.status(500).json({ error: 'Bunny not configured: set BUNNY_CDN_HOST (e.g. viralspark-media.b-cdn.net) in Vercel.' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const data = body.data || '';
    if (!data) return res.status(400).json({ error: 'missing data (base64 image/video/audio)' });

    // Split off a data-URL prefix if present -> mime + raw base64
    let raw = data, mime = '';
    const m = /^data:([^;]+);base64,(.*)$/s.exec(data);
    if (m) { mime = m[1].toLowerCase(); raw = m[2]; }
    const buf = Buffer.from(raw, 'base64');
    if (!buf.length) return res.status(400).json({ error: 'data decoded to 0 bytes — is it valid base64?' });

    // Bunny Storage accepts up to 50MB per single PUT comfortably; guard well under.
    if (buf.length > 48 * 1024 * 1024) return res.status(413).json({ error: 'file too large (>48MB) for a single upload' });

    const ext = slugify(body.ext) || MIME_EXT[mime] || 'png';
    const folder = body.folder ? slugify(body.folder) + '/' : '';
    // Timestamp + short random keep names unique without a DB (fine in a serverless fn).
    const stamp = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    const base = body.filename ? slugify(body.filename) : ('vs-' + stamp);
    const path = folder + base + '.' + ext;

    const putUrl = 'https://' + sHost + '/' + zone + '/' + path;
    const up = await fetch(putUrl, {
      method: 'PUT',
      headers: { AccessKey: key, 'Content-Type': 'application/octet-stream' },
      body: buf
    });
    if (!(up.status === 200 || up.status === 201)) {
      const t = await up.text().catch(() => '');
      return res.status(502).json({
        error: 'Bunny upload failed (' + up.status + '). Check BUNNY_STORAGE_KEY (the zone Password) and BUNNY_STORAGE_HOST region.',
        detail: t.slice(0, 300)
      });
    }

    const url = 'https://' + cdnHost + '/' + path;
    return res.status(200).json({ url, path });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'server error' });
  }
};
