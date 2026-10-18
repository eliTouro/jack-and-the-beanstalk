# Jack and the Beanstalk: Star in the Story

**Live:** https://beanstalk.eliweiss.me

Upload a photo of yourself. The app cartoonifies it in a style you choose, then casts you as Jack in two scenes from *Jack and the Beanstalk*:

1. **Jack plants the magic beans**
2. **Jack climbs the beanstalk**

Every scene picture is captioned with the exact scene specification sent to the image model, and the downloaded PNG has the caption drawn onto it.

## How it works

```
browser                                server (Express, Render)                 OpenAI API
───────                                ────────────────────────                 ──────────
photo ─resize to ≤1024px JPEG─▶ POST /api/cartoon {photo, settings} ─1 call─▶ gpt-image-1-mini
                                ◀──────────── cartoon portrait ◀───────────────
cartoon + photo ──────────────▶ POST /api/scene {sceneId:"plant", ...} ─1 call─▶
cartoon + photo ──────────────▶ POST /api/scene {sceneId:"climb", ...} ─1 call─▶
                                ◀──── image + caption (= the exact scene spec) ◀
```

- **One request = one model call.** There are no retry loops and no loops over scenes. If a call fails, the user sees the error and decides whether to click "Try again".
- **Likeness:** each scene call gets **both** the original photo (as the identity reference) and the cartoon (as the style reference). A shared identity block in `src/prompts.js` lists the features to keep: face shape, eyes, brows, nose, mouth, skin tone, hair, facial hair, glasses and age.
- **Scene fidelity:** the scene specs are concrete and checkable (kneeling, beans, pouch, cottage, cow / both hands on the stalk, foot on a leaf, castle in the clouds, cottage tiny below). The caption *is* the spec, so it's easy to check that the picture matches it.
- **Settings:** style (storybook watercolor, 3D animated film, comic book, anime, claymation), exaggeration (subtle / medium / bold), palette (vivid / pastel / earthy) and line weight (none / fine / bold). The server only accepts values from these fixed menus.
- **Privacy and cost guards:** photos are handled in memory only and never written to disk or logged by this app (OpenAI's API may keep requests briefly for abuse monitoring, under its own policy). Uploads are capped at 8 MB (JPEG, PNG or WebP). Each IP gets 15 images per hour (`IMAGES_PER_HOUR`). The key never reaches the browser.

## Project layout

| Path | What it is |
|---|---|
| `server.js` | Express app: static `public/`, `GET /api/options`, `POST /api/cartoon`, `POST /api/scene`, `GET /healthz` |
| `src/image.js` | The one function that calls the image model (OpenAI `images.edit` via the `openai` SDK) |
| `src/prompts.js` | All prompts: settings menus, identity block, cartoon prompt, the two scene specs |
| `public/` | The single-page UI (Tailwind via CDN) |
| `scripts/try.mjs` | Makes exactly one model call per run, used to iterate on the prompts |
| `test/` | Offline tests: input validation, settings sanitizing, caption = spec (`npm test`) |
| `test-faces/` | Diverse AI-generated faces of people who don't exist, used for the likeness tests |
| `TESTING.md` | The production checks (likeness and scene fidelity): method, results and prompt history |
| `render.yaml` | Render Blueprint (the key is declared with `sync: false`, so it never lives in the repo) |

## Model and API key

- Model: **`gpt-image-1-mini`** (OpenAI's cheap image editing model) at `medium` quality, roughly 1-3 cents per image, so a full run (cartoon + 2 scenes) is well under 10 cents. Change `IMAGE_MODEL` / `IMAGE_QUALITY` without touching code. If faces don't match well enough, try `gpt-image-1` (the app then sets `input_fidelity: high`) or `gpt-image-2`.
- OpenAI's image models are paid-only: add prepaid credit under Billing (the Billing page lets you cap spending). They may require a one-time Organization Verification.
- The key is read only from the `OPENAI_API_KEY` environment variable.

## Run locally

```bash
npm install
cp .env.example .env      # then paste your key after OPENAI_API_KEY=  (.env is git-ignored)
npm run dev               # http://localhost:3000
npm test                  # offline tests, no key needed
npm run try -- cartoon test-faces/face-1.jpg storybook    # one model call
npm run try -- plant   test-faces/face-1.jpg storybook    # one model call (reuses that cartoon)
```

Instead of a `.env` file, you can set the key as a Windows user environment variable with `setx OPENAI_API_KEY "your-key"`, then open a new terminal.

## Deploy (Render)

1. Render → **New → Blueprint** → choose `eliTouro/jack-and-the-beanstalk`. Render reads `render.yaml`.
2. When Render asks for `OPENAI_API_KEY`, paste the key. It's stored only in Render's environment settings.
3. Custom domain `beanstalk.eliweiss.me`: Render → service → Settings → Custom Domains. DNS for `eliweiss.me` is at GoDaddy, so add a `CNAME` record there with host `beanstalk` pointing to `<service>.onrender.com`. Render issues the HTTPS certificate on its own.
4. Free instances sleep when idle, so the first request after a while takes about 30–50 s. The UI says so.
