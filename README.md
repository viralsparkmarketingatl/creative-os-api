# Creative OS — Image API (Vercel function)

This one serverless function generates AI mattress scenes for the Creative OS app. It holds your OpenAI key **server-side** (never in the browser) and returns images as base64.

**Endpoint:** `POST /api/generate-image` with JSON `{ "prompt": "...", "size": "1536x1024" }` → `{ "b64": "...." }`

---

## Deploy it (no Node.js needed on your machine)

The easiest no-install path is GitHub → Vercel dashboard:

1. **Put this `creative-os-api` folder in a GitHub repo.**
   - Create a new repo at github.com (e.g. `creative-os-api`).
   - Upload the contents of this folder (the `api/` folder + `package.json`) using GitHub's "Add file → Upload files" (drag-and-drop in the browser — no git/Node required).
2. **Create a free account at vercel.com** and click **Add New → Project → Import** your repo.
3. **Add the environment variable** in the Vercel project:
   - Settings → Environment Variables → `OPENAI_API_KEY` = your OpenAI key.
4. **Deploy.** Vercel gives you a URL like `https://creative-os-api.vercel.app`.
5. Your endpoint is: `https://creative-os-api.vercel.app/api/generate-image`
6. **Paste that endpoint** into the Creative OS app → Settings → "Image API endpoint".

That's it. The app's "Generate scenes with AI" mode will now call this function.

> **Alternative (if you install Node.js):** `npm i -g vercel`, then run `vercel` inside this folder and follow the prompts. Set the env var with `vercel env add OPENAI_API_KEY`.

---

## Notes
- **Models:** tries `gpt-image-1` first (best), falls back to `dall-e-3`. If `gpt-image-1` errors with a verification message, your OpenAI org may need ID verification to unlock it — `dall-e-3` works without that.
- **Cost:** ~$0.02–0.19 per image depending on model/size. 30 scenes ≈ $1–$6. Billed to your OpenAI account (usage-based, separate from ChatGPT Plus).
- **Security:** the key lives only in Vercel's env vars. The browser app never sees it — it only calls this endpoint.
- **The key here is different from the app's Settings key.** The app's browser key powers *text* (headlines/captions). This Vercel key powers *images*. You can use the same OpenAI key value in both places.
