# Jack and the Beanstalk: a storybook starring your child

**Live:** https://beanstalk.eliweiss.me · **What still needs work:** [to-do.md](to-do.md) · **Testing:** [TESTING.md](TESTING.md)

Upload a photo of a child. The app draws them once as Jack, keeping the child's own look and gender (a boy's photo gives a boy Jack, a girl's photo gives a girl), in a fixed 3D animated style, then illustrates the first pages of *Jack and the Beanstalk* with that same child on every page. The story text is printed on top of each picture, and the last page is an About Me page with the details you type in. Everything downloads as one PDF.

The finished book is meant to be 20 pages. This build makes pages 1–3 plus About Me:

| Page | Picture | Text (printed by the PDF layer, never by the image model) |
|---|---|---|
| 1 | The empty cupboard: Jack and his mother in a bare kitchen, Milky-White through the door | Jack and his mother had nothing left to sell but Milky-White. |
| 2 | The trade: the road to market, an old man holding out five coloured beans | "Five magic beans," said the old man. "For one cow." |
| 3 | Out the window: the cottage at dusk, beans flung into the garden | "Beans!" she cried. And out the window they went. |
| Last | About Me: the child's portrait, name and the details the uploader typed | |

The first homework (cartoonify with settings, plus two captioned scenes) still lives at [/scenes.html](https://beanstalk.eliweiss.me/scenes.html).

## How it works

```
photo ──▶ POST /api/book/reference ─1 call─▶ the ONE reference image of the child as Jack
reference + photo + earlier pages ──▶ POST /api/book/page {cupboard|trade|window} ─1 edit call each─▶ page art (1024x1536)
page + reference + "change X" ──▶ POST /api/book/fix ─1 call─▶ same page, one thing changed (image edit)
pages + reference + About Me ──▶ POST /api/book/pdf ─no model call─▶ JackAndTheBeanstalk.pdf
```

How the child stays the same child on every page:

- **One reference image.** It's made once per book from the photo, then passed as image 1 on every page call, with the photo as image 2.
- **Earlier pages as references.** Pages are made in order, and each page is an image edit that also receives every earlier page (images 3+). The mother, Milky-White, the cottage and Jack's clothes therefore carry over instead of being redrawn.
- **One style string.** `BOOK_STYLE` in `src/book.js` is sent word for word in every call: "modern 3D animated feature film — rounded forms, large expressive eyes, soft rim light". A test checks this.
- **Fixed descriptions** for Jack's outfit, the mother, the old man and Milky-White, so recurring characters don't drift.
- **`gpt-image-2.5-flare` at low quality**: cheap and fast, and in testing it held the child consistently across pages (see TESTING.md).

How the text stays readable:

- **The model never draws text.** Every image prompt says so, and a test checks that the story text never appears in a prompt.
- **The PDF layer prints the text.** `src/pdf.js` (pdfkit) prints it in the zone each storyboard entry keeps clear (top sky or bottom third), using the embedded Andika font over a soft gradient scrim.

**Editing beats regenerating.** "Fix something on this page" sends the existing page to the image edit endpoint with one change, such as "make the beans more colourful", instead of drawing a new picture.

Adding page 4 (the beanstalk at dawn) and the rest means adding entries to `PAGES` in `src/book.js`. The UI, the API and the PDF all work from that list.

## Project layout

| Path | What it is |
|---|---|
| `server.js` | Express app: static `public/`, book API (`/api/book*`), homework-1 API (`/api/cartoon`, `/api/scene`), `/healthz` |
| `src/book.js` | Storyboard, `BOOK_STYLE`, character constants, reference / page / fix prompts, About Me fields |
| `src/pdf.js` | Builds the PDF: full-bleed art, story text in its zone, About Me page |
| `src/image.js` | The one function that calls the image model (OpenAI `images.edit`) |
| `src/prompts.js` | Homework-1 prompts (cartoon settings, the plant and climb scenes) |
| `public/index.html`, `js/book.js`, `css/book.css` | The book maker UI |
| `public/scenes.html`, `js/scenes.js` | The homework-1 UI |
| `assets/fonts/` | Andika (SIL OFL) and Chewy (Apache 2.0), embedded in the PDF |
| `scripts/book.mjs` | One model call per run (reference, page or fix), plus `pdf` to assemble a book |
| `scripts/try.mjs` | Homework-1 prompt iteration (one call per run) |
| `samples/JackAndTheBeanstalk.pdf` | A sample book made on the live site (synthetic boy, "Theo") |
| `test/` | Offline tests (`npm test`, no key needed) |
| `TESTING.md`, `TESTING-homework1.md`, `to-do.md` | Book test results, homework-1 test results, and what still needs work |

## Model, key and cost

- Model `gpt-image-2.5-flare` at `low` quality. A book is 4 image calls (reference + 3 pages), about 10–20 s each. Change the model with `IMAGE_MODEL` / `IMAGE_QUALITY`, no code change needed. (`gpt-image-1`, the homework-1 model, has been retired.)
- OpenAI image models are paid-only: keep prepaid credit on the account. If it runs out, every call fails with "out of credit".
- **The key** is read only from `OPENAI_API_KEY`: locally from `.env` (git-ignored), on Render from Environment settings. It's never in the code or the repo, and never sent to the browser.
- **Cost guard:** each IP gets `IMAGES_PER_HOUR` images (default 25). Photos are handled in memory only and never stored by this app.

## Run locally

```bash
npm install
cp .env.example .env                                   # paste your key after OPENAI_API_KEY=
npm run dev                                            # http://localhost:3000
npm test                                               # offline tests, no key needed
node --env-file=.env scripts/book.mjs ref  test-faces/child-1.jpg            # 1 call
node --env-file=.env scripts/book.mjs page test-faces/child-1.jpg cupboard   # 1 call per page
node scripts/book.mjs pdf test-faces/child-1.jpg out.pdf "Name" "6" "Trucks" "Loves the park"
```

## Deploy (Render)

1. Render → **New → Blueprint** → `eliTouro/jack-and-the-beanstalk`. Render reads `render.yaml`. Every push to `main` redeploys.
2. Set `OPENAI_API_KEY` in Render's Environment settings (`render.yaml` declares it with `sync: false`, so the value never lives in the repo).
3. Custom domain `beanstalk.eliweiss.me` is a GoDaddy `CNAME` → `<service>.onrender.com`. Render issues the HTTPS certificate.
4. Free instances sleep when idle, so the first request after a while takes about 30–50 s.
