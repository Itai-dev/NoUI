# Atelier

A chat on the left, an isometric 3D table on the right. Laid out like ChatGPT: your lines in bubbles, the agent's replies as plain text with a small block saying what it put on the table and with which model, and one pill at the bottom with +, a microphone and a voice button.

You say or type what you want. The agent (Claude) answers in a sentence, picks the right model for the job, and puts the results on the table: notes lie flat, images, video, sound and 3D stand up as cards. Select things on the table and they become what "this" and "it" mean in your next line.

- **The line.** Enter sends. The microphone listens for one thought. The voice button turns on conversation mode: the agent speaks its reply and keeps listening, so you can talk back and forth. `/` focuses the line, Space starts listening when you're not typing.
- **The table.** Drag the floor to pan, Ctrl+scroll or pinch to zoom, scroll to pan. Click to select, Shift+click for more, drag items to move them, double-click an image or video to see it large, double-click a note to edit it, Delete removes the selection. Paste or drop an image to put it on the table.
- **The agent chooses models.** It reads a short guide of what each model is good at (fast drafts vs. hero quality, text in images, vector art, edits of a reference, clips with sound, image to video, image to 3D) and says which it chose and why. Name a model or a quality level and it follows you.

## Run

```bash
npm install
cp .env.example .env   # then put your keys in .env
npm run dev
```

Open http://localhost:5173. The dev server reads `.env` and keeps the keys to itself: the browser calls `/api/anthropic` and `/api/fal`, which forward each request with the key attached. Nothing to set up in the app.

- `ANTHROPIC_API_KEY`: the agent
- `FAL_KEY`: images, video, sound, 3D, and also the microphone (Whisper) and the spoken voice (ElevenLabs) where the browser has none of its own

If you prefer, ⚙ Settings still accepts keys typed into the browser. Without any keys the agent runs a simple demo and images are placeholders; spoken replies fall back to the browser's built-in voice.

## Deploy

The repo deploys to Vercel as is: `vercel.json` builds with `npm run build` and serves `www`, and the three files in `api/` are the same key proxy as serverless functions. Set `ANTHROPIC_API_KEY` and `FAL_KEY` in the Vercel project's environment variables; the app detects them through `/api/config` and shows no demo badge.

## Code

- `src/App.tsx`: state, the conversation loop, placing results, generation, autosave
- `src/Thread.tsx`: the conversation, with what each reply put on the table
- `src/Composer.tsx`: the pill: text, add image, microphone (browser recognizer, then Whisper), conversation mode
- `src/Iso.tsx`: the window and the isometric scene (CSS 3D, orthographic), items, pan, zoom, drag
- `src/geometry.ts`: projection math and screen-space placement without overlaps
- `src/ai.ts`: Claude agent (structured JSON reply + actions), fal.ai media, speech to text, text to speech
- `src/models.ts`: the fal.ai models with the guidance the agent uses to choose between them

`dev.mjs` is the esbuild dev server plus the key proxy; `api/` is the same proxy for Vercel. Esbuild is used directly because this machine's security policy blocks Vite's native bundler.

## Prototype limits

- The key proxy is for local use. A real product needs a backend with accounts, usage limits and media storage.
- One person, one browser: no accounts or sharing yet.
- Inside the Claude desktop app's browser pane the microphone is blocked; open the app in a normal browser to use voice.
