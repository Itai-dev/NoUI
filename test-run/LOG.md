# Test run · 2026-10-26 · real models through the key proxy

Keys in `atelier/.env`, dev server restarted, table reset.

| Step | What I did | What happened | Screenshot |
|---|---|---|---|
| 1 | Typed: *a poster for a late-night jazz club called Blue Orbit, with the name readable on it. one strong draft* | Claude chose **nano-banana** ("best at rendering the club name legibly"). fal.ai refused: the balance top-up had not propagated yet. The card showed the reason. | 01 |
| 2 | Typed: *that failed because my balance was empty, it's topped up now. make the poster again, remove the failed one* | Claude removed the failed card and remade the poster with nano-banana. ~20 s. | 02, 03 |
| 3 | Clicked the poster to select it, typed: *animate it with a slow push-in and drifting smoke, and also make a 3D model of it* | Claude chose **kling-2.5** (image → video) and **trellis** (image → 3D), both fed with the selected poster. Video ~2 min, 3D ~40 s. | 04, 05 |

Results: `blue-orbit-poster.png`, `blue-orbit-clip.mp4`, `blue-orbit-model.glb`.

Fixed during the run: Claude's structured-output schema rejected `minimum`/`maximum` on the variation count; errors now stay in the conversation and fal.ai errors show their real reason.

Spend: 1 image + 1 five-second clip + 1 mesh, roughly $1 on fal.ai; a few cents on Claude.

## Pipeline test · "I want a 3D cat"

| Step | What I did | What happened | Screenshot |
|---|---|---|---|
| 4 | Fresh table. Typed: *I want a 3D cat* | Claude planned two steps on its own: a 3D-ready image with **nano-banana** (single cat, centered, three-quarter view, plain gray studio background), then **trellis** fed with that image. The mesh card showed "Waiting for step 1" until the image was done. Image ~15 s, mesh ~40 s. | 06, 07 |

Results: `cat.png`, `cat-model.glb` (a proper rotating cat, not a flat relief).
