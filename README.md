# Studio

A personal AI creative production studio: one brief becomes creative directions, an art-directed production plan, images, film shots and a delivered campaign. Claude is the creative director and producer; fal.ai generates the media; you approve every decision that costs money.

Open **http://localhost:5173/studio/** after `npm run dev`.

**Brief → Concepts → Direction → Plan → Budget approval → Generation → Review → Delivery**

- **Brief.** Write the brief; brand, audience, deliverables, aspect ratios, a maximum budget and reference images are optional.
- **Concepts.** Claude proposes three different creative directions. Choose one, combine several, refine with a note, edit by hand, or ask for three more. Nothing is generated or charged here.
- **Plan.** Claude turns the direction into a production board: for each asset its purpose, shot description, prompt, model (with the reason), aspect, resolution, dependencies and estimated cost. Everything is editable. The hero image comes first; other assets are generated from the approved hero as a reference so the product, character and light stay the same. Film shots always start from an approved still.
- **Budget approval.** Every spend goes through one dialog that shows each job's estimate, the total, what is already committed and the cap you are approving. You choose which items run.
- **Production.** Jobs queue on fal, wait for the approvals they depend on, and can be paused or cancelled. Results are downloaded into the project folder.
- **Review.** Approve, reject, prefer, compare, regenerate with a revised prompt, make variations, animate a still. Approved work is never discarded.
- **Delivery.** Approved assets by group, ZIP export with a manifest, an optional assembled film (local ffmpeg), a case-study draft and a cost report.

## Cost safety

These hold on the server, whatever the browser does (`studio/server/production.ts`, covered by `npm test`):

- A new project is a **dry run**: jobs produce labelled placeholders and never call fal. Switching a project to **LIVE** needs `FAL_KEY` and an explicit confirmation.
- No job is created without a budget you approved. Reserved plus spent estimates can never exceed the cap; the check and the reservation are one step, so concurrent requests cannot both slip through. A refused request reserves nothing.
- Prices come from fal's pricing API (`GET api.fal.ai/v1/models/pricing`) with your key, in the billing unit fal reports (image, megapixel, second, video). If a price is missing or the unit cannot be predicted, the estimate is **unknown** and the job needs explicit acceptance. Estimates that may shift with resolution or length are marked ≈.
- The model on a job is the one you saw. Nothing is substituted or upgraded.
- Each job is submitted to fal once. Nothing is retried automatically; a double click is ignored (idempotency key); after a crash, a job whose submission is uncertain is marked failed instead of resubmitted.
- Actual charges are read from fal's billing events when the key may read them, and shown separately from estimates. Claude usage is reported separately (tokens × list price) and is not part of the media budget.

## Models

Adapters in `studio/server/models.ts`, each built from fal's published input schema for that endpoint (snapshot in `studio/test/fal-schemas.json`, checked by the tests):

| | Economy | Balanced | Premium |
|---|---|---|---|
| Image | FLUX.3 Klein, Nano Banana Lite | Nano Banana 2.1, Seedream 5.5 | Nano Banana Pro |
| Video (from a still) | Kling 4 Flash | Seedance 2.0 Fast, Hailuo 3 | Kling 4, Seedance 2.5 |

The quality mode (Economy / Balanced / Premium) tells Claude how to choose; you can override the model on any card, and the board shows what the plan would cost in each mode.

## Setup

```bash
npm install
cp .env.example .env   # ANTHROPIC_API_KEY and FAL_KEY
npm run dev            # http://localhost:5173/studio/
npm test               # budget gate, estimates, adapters vs fal schemas, live path against a fake fal
```

- Without `ANTHROPIC_API_KEY` a built-in **sample director** returns generic placeholder concepts and plans, labelled as samples. Without `FAL_KEY` only dry runs are possible and all prices are unknown.
- Optional: `STUDIO_CLAUDE_MODEL` (default `claude-opus-5-5`), `STUDIO_CLAUDE_EFFORT` (default `high`), `STUDIO_MAX_CONCURRENCY` (default 3 fal jobs at once), `STUDIO_DATA_DIR` (default `.data/studio`).
- Projects live in `.data/studio/projects/<id>/` (`project.json` plus the media files). Refreshing or restarting loses nothing; running fal jobs are picked up again by request id.
- The server listens on 127.0.0.1 only, because it holds keys and can spend money.
- For billing-confirmed costs, the fal key needs billing read permission; otherwise costs stay estimates.

### Your first live production

1. Start in dry run. Write the brief, pick a direction, review the board, run it dry once to see the flow.
2. Switch the project to LIVE and confirm.
3. Open "Approve & produce", tick only the hero visual, set a small cap (a few dollars), check the estimate, approve.
4. Approve the hero you like. Then approve the dependent stills, and film shots last: they are the expensive part.

### Not in this version

- The Studio backend needs a long-running Node process and a local disk, so it runs locally. On Vercel the Studio page loads but has no backend; hosting it needs a database and blob storage first.
- Text-to-video (every shot starts from a still), audio, upscaling, and editing beyond a straight silent assembly of approved shots.

---

# Atelier

The original canvas app in this repo, still at http://localhost:5173/.

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

- `ANTHROPIC_API_KEY`: the agent (and the Studio's creative director)
- `FAL_KEY`: images, video, sound, 3D, and also the microphone (Whisper) and the spoken voice (ElevenLabs) where the browser has none of its own

If you prefer, ⚙ Settings still accepts keys typed into the browser. Without any keys the agent runs a simple demo and images are placeholders; spoken replies fall back to the browser's built-in voice.

## Deploy

Live at https://noui-nu.vercel.app (Vercel project `noui`, connected to this repo, so every push to `main` deploys).

The repo deploys to Vercel as is: `vercel.json` builds with `npm run build` and serves `www`, and the three files in `api/` are the same key proxy as serverless functions (`/api/anthropic/*` is one function behind a rewrite). Set `ANTHROPIC_API_KEY` and `FAL_KEY` in the Vercel project's environment variables, or run `node scripts/vercel-env.mjs` after `vercel link` to copy them from the local `.env`; the app detects them through `/api/config` and shows no demo badge.

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
