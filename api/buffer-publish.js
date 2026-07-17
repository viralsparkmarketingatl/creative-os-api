// Viral Spark Creative OS — BUFFER publishing proxy (Vercel serverless function)
// Buffer's new GraphQL API (personal key). Lets the app push a generated graphic/video
// (hosted on Bunny CDN -> public permanent URL) to any connected social channel.
//
// Buffer API: POST https://api.buffer.com  with  Authorization: Bearer <token>
//   - media is NOT uploaded to Buffer; you pass a public https URL in assets[]
//   - createPost is ONE channel per call, so we loop selected channels here
//
// Env (creative-os-api Vercel project): BUFFER_TOKEN = personal API key from
//   publish.buffer.com/settings/api
//
// POST { action, ... }:
//   action:'orgs'                                   -> { orgs:[{id,name}] }
//   action:'channels' (organizationId?)             -> { channels:[{id,service,name}] }
//   action:'post' { channelIds[], text, mediaUrl?, mediaType?, mode?, dueAt?, schedulingType? }
//                                                   -> { results:[{channelId,ok,id?,error?}] }

const BUFFER_API = 'https://api.buffer.com';

async function gql(token, query, variables) {
  const r = await fetch(BUFFER_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ query, variables: variables || {} })
  });
  let d; try { d = await r.json(); } catch (e) { d = {}; }
  return { ok: r.ok, status: r.status, data: d };
}
function gqlErr(d) {
  if (d && Array.isArray(d.errors) && d.errors.length) return d.errors.map(e => e.message).join('; ');
  return '';
}
async function firstOrgId(token) {
  const q = 'query{ account { organizations { id } } }';
  const { data } = await gql(token, q);
  return data && data.data && data.data.account && data.data.account.organizations && data.data.account.organizations[0] && data.data.account.organizations[0].id;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    // Per-client token (sent from the selected client's Brand Kit) takes priority; global env is the fallback.
    const token = (body.token && String(body.token).trim()) || process.env.BUFFER_TOKEN;
    if (!token) return res.status(400).json({ error: "No Buffer token for this client. Add this client's Buffer key in its Brand Kit (Publishing routes per client), or set a global BUFFER_TOKEN in Vercel." });
    const action = body.action || 'channels';

    if (action === 'orgs') {
      const { data } = await gql(token, 'query{ account { organizations { id name } } }');
      const err = gqlErr(data);
      if (err) return res.status(502).json({ error: 'Buffer: ' + err });
      const orgs = (data.data && data.data.account && data.data.account.organizations) || [];
      return res.status(200).json({ orgs });
    }

    if (action === 'channels') {
      const orgId = (body.organizationId || '').trim() || await firstOrgId(token);
      if (!orgId) return res.status(502).json({ error: 'No Buffer organization found for this token.' });
      const q = 'query{ channels(input:{organizationId:"' + orgId + '"}){ id service name } }';
      const { data } = await gql(token, q);
      const err = gqlErr(data);
      if (err) return res.status(502).json({ error: 'Buffer: ' + err });
      const channels = (data.data && data.data.channels) || [];
      return res.status(200).json({ channels, organizationId: orgId });
    }

    if (action === 'post') {
      const channelIds = Array.isArray(body.channelIds) ? body.channelIds.filter(Boolean) : [];
      const text = (body.text || '').trim();
      // Accept a media array (carousel) or a single mediaUrl (back-compat).
      const mediaList = Array.isArray(body.media) ? body.media
        : (body.mediaUrl ? [{ url: body.mediaUrl, type: body.mediaType }] : []);
      if (!channelIds.length) return res.status(400).json({ error: 'pick at least one channel' });
      if (!text && !mediaList.length) return res.status(400).json({ error: 'add a caption or media' });

      // Build the assets array from public media URLs (Bunny CDN). Empty = text-only.
      const assets = [];
      mediaList.forEach(m => {
        if (m && m.url && /^https?:\/\//i.test(m.url)) {
          const isVideo = m.type === 'video' || /\.(mp4|mov|webm|m4v)(\?|$)/i.test(m.url);
          assets.push(isVideo ? { video: { url: m.url } } : { image: { url: m.url } });
        }
      });

      const scheduled = body.mode === 'customScheduled' && body.dueAt;
      const mode = scheduled ? 'customScheduled' : 'addToQueue';
      const schedulingType = body.schedulingType || 'automatic';

      const mutation = 'mutation($input: CreatePostInput!){ createPost(input:$input){ __typename ... on PostActionSuccess { post { id } } ... on MutationError { message } } }';

      const results = [];
      for (const channelId of channelIds) {
        const input = { channelId, text, assets, mode, schedulingType };
        if (scheduled) input.dueAt = body.dueAt;
        try {
          const { data } = await gql(token, mutation, { input });
          const err = gqlErr(data);
          const cp = data && data.data && data.data.createPost;
          if (err) { results.push({ channelId, ok: false, error: err }); continue; }
          if (cp && cp.__typename === 'PostActionSuccess') { results.push({ channelId, ok: true, id: cp.post && cp.post.id }); }
          else if (cp && cp.message) { results.push({ channelId, ok: false, error: cp.message }); }
          else { results.push({ channelId, ok: false, error: 'unexpected response' }); }
        } catch (e) { results.push({ channelId, ok: false, error: e.message || 'failed' }); }
      }
      return res.status(200).json({ results });
    }

    return res.status(400).json({ error: 'unknown action' });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'server error' });
  }
};
