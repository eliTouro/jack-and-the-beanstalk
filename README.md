# Jack and the Beanstalk: a storybook starring your child

**Live:** https://beanstalk.eliweiss.me · **What still needs work:** [to-do.md](to-do.md) · **Testing:** [TESTING.md](TESTING.md) · **Sample book:** [/sample.html](https://beanstalk.eliweiss.me/sample.html)

Sign in with Google and upload a photo of a child. The app draws them once as Jack, keeping the child's own look and gender (a boy's photo gives a boy Jack, a girl's photo gives a girl), in a fixed 3D animated style. Then it illustrates the first pages of *Jack and the Beanstalk* with that same child on every page.

- **The story text** is printed on top of each picture, and the last page is an About Me page with the details you type in. Everything downloads as one PDF.
- **Every book is saved to your account:** the photo, every picture and the About Me text. You can close the tab while it draws, come back later, and find it under "My books".

The finished book is meant to be 20 pages. This build makes pages 1–3 plus About Me:

| Page | Picture | Text (printed by the PDF layer, never by the image model) |
|---|---|---|
| 1 | The empty cupboard: Jack and his mother in a bare kitchen, Milky-White through the door | Jack and his mother had nothing left to sell but Milky-White. |
| 2 | The trade: the road to market, an old man holding out five coloured beans | "Five magic beans," said the old man. "For one cow." |
| 3 | Out the window: the cottage at dusk, beans tossed into the garden | "Beans!" she cried. And out the window they went. |
| Last | About Me: the child's portrait, name and the details the uploader typed | |

The first homework (cartoonify with settings, plus two captioned scenes) still lives at [/scenes.html](https://beanstalk.eliweiss.me/scenes.html).

## How it works

```
sign in with Google ──▶ cookie session (signed, 30 days)
photo ──▶ POST /api/books ──▶ saved in Postgres, then drawn on the server:
            round 1, in parallel:  reference (Jack, from the photo)  +  cast sheet (mother, cow, old man, cottage)
            round 2, in parallel:  pages 1 to 4                     (each = reference + cast sheet)
          each picture is saved the moment it's ready
browser ──▶ GET /api/books/:id every 1.5 s ──▶ per-picture status, start time and expected duration ──▶ one progress bar per picture
page + reference + "change X" ──▶ POST /api/books/:id/fix ──▶ same page, one thing changed (old version kept for Undo)
GET /api/books/:id/pdf ──▶ pages + reference + About Me ──▶ PDF (no model call)
```

A book is 6 pictures in 2 parallel rounds, about 30 s in total. Before, the pages were chained one after another and took about 60 s.

How the child stays the same child on every page:

- **One reference image** per book, made from the photo. It's image 1 on every page call. Only the reference call sees the photo. When the real photo was also attached to page calls, the safety filter sometimes blocked a page (see TESTING.md).
- **One cast sheet** per book: the mother (matching the child's skin tone and hair colour), Milky-White, the old man with the five speckled beans, and the cottage. It's image 2 on every page call, so recurring characters match across pages even though no page waits for another.
- **One style string.** `BOOK_STYLE` in `src/book.js` is sent word for word in every call: "modern 3D animated feature film — rounded forms, large expressive eyes, soft rim light". A test checks this.
- **Fixed descriptions** for Jack's outfit, the mother, the old man and Milky-White.

**The story** is four pages: the empty cupboard, the trade, the beans out the window, and the beanstalk the next morning. The text uses the child's name from the About Me page ("Jack" until it's filled in) and never says he or she, so it fits any child. It was rewritten after the first feedback round (see to-do.md).

How the text stays readable:

- **The model never draws text.** Every image prompt says so, and a test checks that the story text never appears in a prompt.
- **The PDF layer prints it.** `src/pdf.js` (pdfkit) prints it in the zone each storyboard entry keeps clear, in the embedded Andika font over a soft gradient scrim.

Adding page 4 (the beanstalk at dawn) and the rest means adding entries to `PAGES` in `src/book.js`. The slots, the UI, the API and the PDF all work from that list.

## Accounts, storage and logging

- **Google sign-in** (`src/auth.js`): OAuth 2.0 authorization-code flow with a `state` check; the ID token is verified with `google-auth-library`. The session is a signed `cookie-session` cookie holding only the user id. All book routes need sign-in, and pictures are only ever served to their owner.
- **Database** (`src/db.js`, `src/store.js`): Postgres via `DATABASE_URL`, in production a free [Neon](https://neon.tech) database. It has four tables:
  - `users`
  - `books`: the photo and About Me
  - `book_images`: one row per picture, with its status, the bytes and the previous version for Undo
  - `events`
- **Local storage:** without `DATABASE_URL`, the app uses an in-memory [PGlite](https://pglite.dev) (real Postgres in WebAssembly), so the same SQL runs locally and in the tests.
- **Logging** (`src/log.js`): structured JSON logs with `pino` and `pino-http`, which Render shows as the service log. Photos, cookies and tokens are never logged.
  - Every sign-in, new book, PDF, deletion and image call (with its model and duration) is also written to the `events` table.
  - The progress bars' time estimates are the average of the last 20 real durations from that table.
- **Cost guards:**
  - `IMAGES_PER_HOUR` per user (default 30)
  - `IMAGES_PER_DAY` for the whole site (default 300)
  - `MAX_BOOKS_PER_USER` (default 30)
  - one API call per picture, with no automatic retries

## Project layout

| Path | What it is |
|---|---|
| `server.js` | Express app: static `public/`, book API (`/api/books*`), homework-1 API (`/api/cartoon`, `/api/scene`), `/healthz` |
| `src/auth.js` | Google sign-in, sign-out, `/api/me`, `requireUser`, local-only dev sign-in |
| `src/db.js`, `src/store.js` | Postgres/PGlite connection and schema; all queries |
| `src/jobs.js` | Draws a book's pictures on the server in two parallel rounds; budget checks; fix and undo |
| `src/log.js` | The pino logger |
| `src/book.js` | Storyboard, `BOOK_STYLE`, character constants, the 5 picture slots, reference / cast / page / fix prompts, About Me fields |
| `src/pdf.js` | Builds the PDF: full-bleed art, story text in its zone, About Me page |
| `src/image.js` | The one function that calls the image model (OpenAI `images.edit`), plus mock mode |
| `src/prompts.js` | Homework-1 prompts (cartoon settings, the plant and climb scenes) |
| `public/index.html`, `js/book.js`, `css/book.css` | The app: sign-in, My books, the per-picture progress panel, the book editor |
| `public/sample.html`, `public/sample/` | The sample book shown to survey participants |
| `public/scenes.html`, `js/scenes.js` | The homework-1 UI |
| `scripts/book.mjs` | One model call per run (reference, cast, page or fix), plus `pdf` to assemble a book |
| `samples/JackAndTheBeanstalk.pdf` | The sample book (synthetic boy, "Theo") |
| `test/` | Offline tests (`npm test`, no key or database needed) |
| `TESTING.md`, `TESTING-homework1.md`, `to-do.md` | Test results and what still needs work |

## Model, key and cost

- Model `gpt-image-2.5-flare` at `low` quality: 5 image calls per book, about 10–15 s each. Change it with `IMAGE_MODEL` / `IMAGE_QUALITY`.
- **Free test mode:** `IMAGE_PROVIDER=mock` (`npm run dev:mock`) skips the API and returns the input picture after a few seconds. That's enough to test sign-in, storage and the progress bars without spending anything.
- **Secrets** come only from environment variables: `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL` and `SESSION_SECRET`. Locally they're in `.env` (git-ignored); on Render, in Environment settings. They're never in the code or the repo, and never sent to the browser.

## Run locally

```bash
npm install
cp .env.example .env      # fill in the values
npm run dev:mock          # free: mock images, in-memory database, "Dev sign-in" link
npm run dev               # real images (uses credit)
npm test                  # offline tests
```

For Google sign-in locally, add `http://localhost:3000/auth/google/callback` as a redirect URI on the OAuth client.

## Deploy (Render)

1. Render → **New → Blueprint** → `eliTouro/jack-and-the-beanstalk`. Render reads `render.yaml`, and every push to `main` redeploys.
2. In Render's Environment settings, set:
   - `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL`
   - `SESSION_SECRET`: `render.yaml` generates one if the service comes from the Blueprint
3. Google Cloud OAuth client (Web application):
   - Redirect URI `https://beanstalk.eliweiss.me/auth/google/callback`.
   - The consent screen's audience is **External** and published (**In production**), so any Gmail account can sign in.
4. Custom domain `beanstalk.eliweiss.me` is a GoDaddy `CNAME` → `<service>.onrender.com`.
5. Free instances sleep when idle, so the first request after a while takes about 30–50 s.
