# A storybook starring your child

**Live:** https://beanstalk.eliweiss.me · **Write-up (print and ship, pricing):** [WRITEUP.md](WRITEUP.md) · **What still needs work:** [to-do.md](to-do.md) · **Self-review log:** [review-log.md](review-log.md) · **Testing:** [TESTING.md](TESTING.md)

Sign in with Google, add money to your account, upload one photo of a child and pick a story: *Jack and the Beanstalk* or *Little Red Riding Hood*. About 30 seconds later you have a 20-page illustrated book with that child as the hero on every page, as a PDF: a front cover with the title "starring" the child, a copyright page, the story, and an About Me back cover. A book costs $0.99. Approve the proof, enter an address and pay $28.99, and the book is sent to a print-on-demand printer (Lulu, sandbox) as a hardcover.

Sample book made by this build (synthetic test child): [Little Red Riding Hood, starring Maya](samples/Maya-LittleRedRidingHood.pdf)

## What it does

| | |
|---|---|
| **Money** | Fund the account through Stripe Checkout (sandbox), buying credit for any number of books from 1 to 50. See the balance. $0.99 leaves the balance for every book. Ask for a refund of unspent money, then process it at Stripe. A history page lists every credit and debit, what caused it and the balance after it. |
| **Cost** | Every image call, every retry and every picture check is logged with its token counts and cost. The cost report (https://beanstalk.eliweiss.me/?view=costs, signed in; not linked from the shop) shows the average cost of a book next to the $0.99 price, and the cost of each of your books. It is kept off the shop pages on purpose. |
| **The book** | Front cover, copyright page, 20 story pages, The End, About Me back cover. One 20-page template (plus a cover row) serves both stories. A character bible and all 42 scenes (40 pages, 2 covers) are drawn ahead of time and stored in the database. |
| **Print and ship** | Open the proof, approve it (any later change voids the approval), enter a US address, pick a shipping speed, pay with Stripe. Only then are the print files built (interior with bleed, case-wrap cover) and sent to the Lulu Print API sandbox. Orders are tracked on the book and account pages; a failed print job is refunded automatically. Details in [WRITEUP.md](WRITEUP.md). |
| **Checking what is typed** | The child's name must be a real-sounding name, and the About Me details must be fit for a children's book: rules and word lists in code, OpenAI's moderation endpoint, and a small model for names. Checked before the book is charged, on every save, at approval and at ordering. |
| **Speed** | The page is static HTML with one small stylesheet and one script. A book takes about 30 seconds from photo to PDF. A progress bar names the stage, and each thumbnail appears as its picture finishes. |
| **Storage** | Photos, pictures, thumbnails and the finished PDF are stored in Postgres. Sign in again tomorrow and the PDF still downloads. |
| **Quality loop** | Every generated picture is checked by a vision model. A failure is drawn again with the reason, at most 3 drawings. If none passes, the best-scoring one is kept. The attempt count is shown on every picture. |
| **Text layout** | Code decides where the words go on every page: top, bottom or middle, wherever that picture is clear of faces and story details. If nowhere is clear, the art is framed and the text goes on paper under it. |

## How a book is made

```
ONCE, AHEAD OF TIME (scripts/pregen.mjs, 55 pictures, $1.19 in total)
  character bible   one picture per character, plus a stand-in hero         assets/library/<story>/bible/
  42 scenes         20 pages and a cover per story, from the bible pictures  assets/library/<story>/scenes/
  every picture goes through the quality loop; results are in meta.json
  the server copies bible and scenes into Postgres when it starts           tables: characters, scenes

PER BOOK (src/jobs.js)
  $0.99 leaves the balance
  0 s    pages the hero is not on are copied from the template (instant)
  0 s    reference: the child drawn as the hero, from the photo             1 image call + 1 check
  13 s   the cover and every other page at the same time: the template      18-21 image calls + checks
         so its stand-in hero becomes this child
  each picture: draw -> check -> redraw on failure (3 drawings at most) -> keep the best
  each finished picture: thumbnail made, text position chosen, saved to Postgres
  30 s   PDF built and stored: cover, copyright, 20 pages, The End, About Me back cover
```

## Print and ship (`src/print.js`)

```
book page ── Open the proof ── tick "I have looked through every page" ── Approve for printing
              (approval = fingerprint of every picture version, text position, name and details)
          ── address (US) + shipping speed ── POST /api/books/:id/print-order ── Stripe Checkout
Stripe ── /billing/return ── payment confirmed with Stripe ── ledger: card payment in, order out
       ── build print files: interior 24 pages at 6.25 x 9.25 in (bleed), case-wrap cover
          sized by Lulu's /cover-dimensions/ ── stored with the order
       ── POST /print-jobs/ to api.sandbox.lulu.com (files fetched from /print-files/<id>/<token>/)
order pages ── GET /print-jobs/<id>/ at most once a minute ── Sent to the printer · Being printed · Shipped
            ── REJECTED or CANCELED ── refunded to the card automatically
```

- **Sandbox only.** The Lulu client has the sandbox URL and nothing else. Without `LULU_CLIENT_KEY` / `LULU_CLIENT_SECRET`, a simulated printer moves the order through the same stages on a timer.
- **Price:** $28.99 with standard shipping, faster shipping extra. Cost and margin: [WRITEUP.md](WRITEUP.md#5-price-cost-and-margin), and live on the cost report page.
- **Product:** Lulu `0600X0900FCPRECW080CW444GXX`: 6 x 9 in hardcover case wrap, premium colour, 24 pages.

## What the family types is checked (`src/moderation.js`)

1. Rules: length, characters, no links, emails or phone numbers; word lists of insults (refused as a name), and swear words, slurs and sexual words (refused anywhere), also when disguised with digits or dots.
2. OpenAI's moderation endpoint.
3. `gpt-4.1-mini` with a strict JSON schema: is the name a plausible child's name from any culture; is each detail printable in a children's book.

Layers 2 and 3 are skipped in mock mode and in the tests. If they fail, the rules alone decide and the failure is logged.

Measured on two real runs (see TESTING.md): 30 s and 55 s from photo to PDF, at $0.33 to $0.59 of API cost per book. The 55 s run had one image call that hung; a call that runs longer than 21 s now gets a backup call.

### The template (`src/template.js`)

Twenty rows. Each row fixes the camera framing of that page and which third of the picture must stay empty for the words. A story (`src/stories/jack.js`, `src/stories/red.js`) supplies only what happens on the page: text, scene, composition and which characters appear. Both stories are poured into the same twenty rows, so page 7 of either book is a wide shot from a low camera with the top kept clear.

### The character bible (`characters` table)

One picture per character per story, drawn once: Jack's mother, Milky-White, the old man, the giant, the giant's wife, the hen and the harp; Red's mother, Grandmother, the wolf and the woodcutter; and a stand-in hero for each story. Each scene is drawn from the bible pictures of the characters on that page, which is why the giant on page 12 is the giant on page 18. In a book, the child's reference picture replaces the stand-in hero on every page.

### The quality loop (`src/quality.js`, `src/analyze.js`)

Each drawing is sent to `gpt-4.1-mini` with the scene description and the reference. It returns:

- how many times the hero appears and whether the face is visible
- likeness to the reference, 0 to 10, and how completely the scene is shown, 0 to 10
- whether any text was drawn, and any serious defects
- a box around every face and every small story-critical prop
- whether the top, middle and bottom bands are clear

The picture fails if the hero is missing or doubled, the face is hidden, likeness or scene is under 6, text was drawn, there is a defect, or no band is clear. A failed picture is drawn again with the list of problems added to the prompt. After 3 drawings the highest score wins. In a new book no fresh drawing starts after 40 seconds, so the book stays under a minute; redoing a single page later has no time limit.

### Text never hides the story (`src/layout.js`)

1. The text block is measured with the PDF engine's own font metrics, so its exact height is known.
2. For each of top, bottom and middle, the block's rectangle is tested against every face box (with a margin) and every prop box. The band must also have been called clear by the checker.
3. The template's zone is used if it passes. Otherwise the calmest passing band, measured from the pixels.
4. If no band passes, the page switches to a framed layout: the art sits in a frame and the text is printed on paper below it. Nothing is covered.
5. The brightness of the chosen band picks white text on a dark plate or dark text on a pale plate.

The image model never draws text; a test checks that no story text appears in any prompt.

## Money (`src/billing.js`)

- **Ledger.** The balance is never stored. It is the sum of the user's rows in `transactions`, so the balance and the history can't disagree. Each row keeps the balance after it.
- **Funding.** Stripe Checkout in test mode. After payment Stripe sends the browser to `/billing/return`; the server looks the session up at Stripe and checks the amount and the owner before crediting. A unique index makes a second credit for the same payment impossible. Payments whose redirect never arrived are picked up the next time the account page loads.
- **$0.99 per book.** Taken when the book starts. If the book can't be made at all, it comes back automatically.
- **Refunds.** The user picks a top-up and asks for the unspent part back. The money leaves the balance at once so it can't be spent. Processing calls Stripe's refund API and stores the refund id. In the sandbox the person who asked can also press "Process refund", so the whole flow can be seen from one account; `ADMIN_EMAILS` can process anyone's.
- **Test mode only.** A key that doesn't start with `sk_test_` is ignored.

## API cost (`src/cost.js`, `api_calls` table)

Every call writes a row: user, book, picture, kind (image or analysis), attempt number, model, tokens in and out, dollars and milliseconds. Dollars come from the token counts the API returns and the price table in `src/cost.js` (`gpt-image-2.5-flare`: $5 text in, $8 image in, $30 image out per million tokens; `gpt-4.1-mini`: $0.40 in, $1.60 out). The cost report page sums the log: average per book, split into first drawings, redraws and checks.

To keep the cost down: `low` image quality, input pictures sent at 640 px and 384 px (a test showed the same page quality for a third less), pages without the hero reuse the template scene, and redraws only happen on a failed check.

## Project layout

| Path | What it is |
|---|---|
| `server.js` | Express app: book API, story and library API, account and billing routes, `/healthz` |
| `src/template.js` | The 20-page template: framing and clear zone per page |
| `src/stories/jack.js`, `red.js` | The two storyboards: characters, text, scene and composition for 20 pages |
| `src/book.js` | Joins stories to the template; every prompt; About Me fields |
| `src/jobs.js` | Makes a book on the server: template pages, reference, parallel pages, PDF |
| `src/quality.js` | Draw, check, redraw: 3 drawings at most, best kept, deadline |
| `src/analyze.js` | The picture check (vision model) and its pass rules and score |
| `src/layout.js` | Where the text goes on each finished picture |
| `src/pdf.js`, `src/bookpdf.js` | The book's PDFs: front cover, copyright page, story, The End, About Me back cover; the reading copy (stored with the book) and the printer's interior and cover files |
| `src/print.js` | Lulu Print API sandbox client, simulated printer, print prices, address checks, order lifecycle |
| `src/moderation.js` | Checks the name and the About Me details before anything is printed |
| `src/library.js` | Character bible and scenes: files to database, cached reads |
| `src/billing.js` | Ledger, Stripe Checkout, refunds, the account page data |
| `src/cost.js` | Price table and cost maths |
| `src/image.js` | The one function that calls the image model, plus mock mode |
| `src/auth.js`, `src/db.js`, `src/store.js`, `src/log.js` | Google sign-in, Postgres/PGlite and schema, queries, logging |
| `public/index.html`, `js/app.js`, `css/app.css` | The app: landing, new book, book with live progress, account and money |
| `assets/library/` | The pre-made bible pictures, scenes and their check results |
| `scripts/pregen.mjs` | Draws the bible and the scenes (`bible`, `scenes`, `recheck`) |
| `scripts/make-book.mjs` | Makes one real book from a photo, timed, without touching the live site |
| `scripts/check-stripe.mjs`, `check-live.mjs` | Ask Stripe to start a test checkout the way the site does; wait for a deploy and print the live health check |
| `test/` | Offline tests (`npm test`): no key, no database, no network |
| `public/scenes.html`, `public/sample.html` | Earlier homework pages, kept as they were |

## Run locally

```bash
npm install
cp .env.example .env      # fill in the values
npm run dev:mock          # free: mock images, in-memory database, simulated checkout, "Dev sign-in" link
npm run dev:sandbox       # mock images, but the real Stripe sandbox
npm run dev               # everything real (image calls cost money; uses DATABASE_URL)
npm test                  # 47 offline tests
npm run book -- test-faces/child-1.jpg jack "Theo" out.pdf   # one real timed book
```

In mock mode a fifth of picture checks fail on purpose, so the redraw loop and the attempt counts can be seen without spending anything.

## Deploy (Render)

1. Render → **New → Blueprint** → this repo. Every push to `main` redeploys.
2. Environment: `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `DATABASE_URL` (Neon), `STRIPE_SECRET_KEY` (the `sk_test_` key), `SESSION_SECRET`, `PUBLIC_URL` (Lulu fetches the print files from it), `LULU_CLIENT_KEY` and `LULU_CLIENT_SECRET` (a Lulu **sandbox** account), optional `LULU_CONTACT_EMAIL`, `ADMIN_EMAILS`, `PRINT_PRICE_CENTS`, `PUBLISHER_NAME`.
3. Google OAuth redirect URI: `https://beanstalk.eliweiss.me/auth/google/callback`.
4. The tables and new columns are created at start. The bible and scenes are copied from `assets/library/` into the database at start.
5. The free instance sleeps when idle. `.github/workflows/keep-warm.yml` pings it every 10 minutes.

**Secrets** live only in environment variables: `.env` locally (git-ignored), the Render dashboard in production. The Stripe key in particular must never be committed: GitHub scans pushes for Stripe keys and Stripe revokes them.
