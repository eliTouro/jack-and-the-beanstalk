# Jack and the Beanstalk: Star in the Story

**Live:** https://beanstalk.eliweiss.me

Upload a photo of yourself. The app cartoonifies it in a style you choose, then casts you as Jack in two scenes from *Jack and the Beanstalk*:

1. **Jack plants the magic beans**
2. **Jack climbs the beanstalk**

Every scene picture is captioned with the exact scene specification sent to the image model, and the downloaded PNG has the caption drawn onto it.

## How it works

```
browser                                server (Express, Render)                 Gemini API
───────                                ────────────────────────                 ──────────
photo ─resize to ≤1024px JPEG─▶ POST /api/cartoon {photo, settings} ─1 call─▶ gemini-nano-banana-2.1
                                ◀──────────── cartoon portrait ◀───────────────
cartoon + photo ──────────────▶ POST /api/scene {sceneId:"plant", ...} ─1 call─▶
cartoon + photo ──────────────▶ POST /api/scene {sceneId:"climb", ...} ─1 call─▶
                                ◀──── image + caption (= the exact scene spec) ◀
```

- **One request = one model call.** There are no retry loops and no loops over scenes. If a call fails, the user sees the error and decides whether to click "Try again".
- **Likeness:** each scene call gets **both** the original photo (as the identity reference) and the cartoon (as the style reference). A shared identity block in `src/prompts.js` lists the features to keep: face shape, eyes, brows, nose, mouth, skin tone, hair, facial hair, glasses and age.
- **Scene fidelity:** the scene specs are concrete and checkable (kneeling, beans, pouch, cottage, cow / both hands on the stalk, foot on a leaf, castle in the clouds, cottage tiny below). The caption *is* the spec, so it's easy to check that the picture matches it.
- **Settings:** style (storybook watercolor, 3D animated film, comic book, anime, claymation), exaggeration (subtle / medium / bold), palette (vivid / pastel / earthy) and line weight (none / fine / bold). The server only accepts values from these fixed menus.
- **Privacy and cost guards:** photos are handled in memory only and sent with `store: false`, so Google doesn't keep them. Uploads are capped at 8 MB (JPEG, PNG or WebP). Each IP gets 15 images per hour (`IMAGES_PER_HOUR`). The key never reaches the browser.

## Project layout

| Path | What it is |
|---|---|
| `server.js` | Express app: static `public/`, `GET /api/options`, `POST /api/cartoon`, `POST /api/scene`, `GET /healthz` |
| `src/gemini.js` | The one function that calls the image model (`@google/genai` Interactions API) |
| `src/prompts.js` | All prompts: settings menus, identity block, cartoon prompt, the two scene specs |
| `public/` | The single-page UI (Tailwind via CDN) |
| `scripts/try.mjs` | Makes exactly one model call per run, used to iterate on the prompts |
| `test/` | Offline tests: input validation, settings sanitizing, caption = spec (`npm test`) |
| `test-faces/` | Diverse AI-generated faces of people who don't exist, used for the likeness tests |
| `TESTING.md` | The production checks (likeness and scene fidelity): method, results and prompt history |
| `render.yaml` | Render Blueprint (the key is declared with `sync: false`, so it never lives in the repo) |

## Model and API key

- Model: **`gemini-nano-banana-2.1`** (Google's default image editing model), at about **$0.034 per 1K image**. A full run (cartoon + 2 scenes) costs about $0.10. You can change it with `GEMINI_IMAGE_MODEL`; `gemini-3.1-flash-lite-image` is the same price and faster but weaker at likeness.
- The Gemini API **free tier does not include image models**, so the key's Google Cloud project needs billing turned on. Set a budget alert.
- The key is read only from the `GEMINI_API_KEY` environment variable.

## Run locally

```bash
npm install
cp .env.example .env      # then paste your key after GEMINI_API_KEY=  (.env is git-ignored)
npm run dev               # http://localhost:3000
npm test                  # offline tests, no key needed
npm run try -- cartoon test-faces/face-1.jpg storybook    # one model call
npm run try -- plant   test-faces/face-1.jpg storybook    # one model call (reuses that cartoon)
```

Instead of a `.env` file, you can set the key as a Windows user environment variable with `setx GEMINI_API_KEY "your-key"`, then open a new terminal.

## Deploy (Render)

1. Render → **New → Blueprint** → choose `eliTouro/jack-and-the-beanstalk`. Render reads `render.yaml`.
2. When Render asks for `GEMINI_API_KEY`, paste the key. It's stored only in Render's environment settings.
3. Custom domain `beanstalk.eliweiss.me`: Render → service → Settings → Custom Domains. DNS for `eliweiss.me` is at GoDaddy, so add a `CNAME` record there with host `beanstalk` pointing to `<service>.onrender.com`. Render issues the HTTPS certificate on its own.
4. Free instances sleep when idle, so the first request after a while takes about 30–50 s. The UI says so.
