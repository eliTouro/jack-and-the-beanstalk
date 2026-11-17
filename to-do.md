# To do

What in this build still needs work, most important first. Evidence is in [TESTING.md](TESTING.md) and [review-log.md](review-log.md).

## Print and ship (homework 5)

- **The Lulu sandbox has not placed a job yet.** Creating the Lulu sandbox account (developers.sandbox.lulu.com) is a sign-up the site owner has to do; until `LULU_CLIENT_KEY` / `LULU_CLIENT_SECRET` are on Render, orders go to the simulated printer. The client follows Lulu's OpenAPI file (auth, cover dimensions, cost calculation, print jobs, status) but has only been exercised by the offline tests. The sandbox account also needs a test card on file, or jobs wait as UNPAID.
- **Prices are fixed in code.** $28.99 and the shipping add-ons come from Lulu's price API on Nov 17, 2026. `printCost()` can ask Lulu per address, but the price shown to the customer does not follow it yet. Lulu adds sales tax in many states, which is not collected from the customer.
- **US addresses only.** Lulu ships worldwide; international shipping needs its own prices and a country field.
- **The proof is the reading PDF, not the printer's files.** Same pages and pictures, but the print interior has bleed, two blank end pages, and the cover is a single wrap. A "see the print files" view would let a parent check the trim.
- **Print resolution.** The art is 1024 × 1536 px, about 166 dpi at 6.25 × 9.25 in. Lulu accepts it, but 300 dpi is the print standard (`IMAGE_QUALITY=medium` or upscaling for print only).
- **No spine text.** Lulu allows spine lettering only above 80 pages; this book has 24.
- **Order changes.** Once paid, an order can't be cancelled or its address changed from the site.
- **The account's image rate limit.** The OpenAI account allows roughly 20 to 30 image calls a minute. One book uses about 20, so two families making books at the same moment queue for each other (a rate limit is now waited out instead of failing). A higher usage tier fixes it.
- **The About Me model check is lenient by design.** It accepts rare and invented-sounding names. A determined parent could still type something unkind that reads like a name.

## Quality of the book

- **The picture check passes almost everything.** In two real books (39 generated pictures) and 53 pre-made pictures, every one passed on the first drawing. Either the pictures really are that reliable, or `gpt-4.1-mini` at these thresholds (likeness and scene 6 of 10) is too easy to please. Next step: feed it known-bad pictures (wrong child, hidden face, drawn text) and see what it catches; raise the thresholds if it misses them. Until then the redraw loop is proven by the offline tests and mock mode, not by a real failure.
- **The checker's boxes are approximate.** Face boxes from the vision model can be a few percent off. The layout keeps a margin and also needs the checker's own "this band is clear" answer, but a dedicated face detector would be more exact.
- **The framed fallback wastes space.** When no band is clear the art is framed with the text below. On pages where the template kept the bottom empty, that empty area is still inside the frame. Cropping the art to its busy part would look better.
- **Young children can come out toddler-like.** The reference sometimes makes a four-year-old look two. The check compares likeness but not apparent age on its own.
- **Likeness comes only from the reference.** Page calls never see the photo (it tripped the safety filter earlier), so a weak reference weakens all 20 pages. "Try a different look" redraws it and every hero page.
- **Low image quality.** Pictures are 1024×1536 at `low` quality: fine on screen, 171 dpi in print with no bleed. `IMAGE_QUALITY=medium` costs about four times as much.
- **Hero-less pages are identical in every book.** Little Red Riding Hood pages 8 to 10 (the wolf alone) come straight from the template. That is the cheap and fast choice, and they are still checked, but they are not personal.

## Speed

- **One slow image call can still push a book close to a minute.** Typical is 30 s; one run took 55 s because a single call hung for 45 s. A backup call now starts after 21 s, but that has not yet been seen to fire in a real run.
- **The 40-second cutoff trades retries for speed.** In a new book no fresh drawing starts after 40 s, so a page that fails late gets fewer than 3 drawings (the best so far is kept, and the count on the picture shows it). Redoing the page afterwards has no time limit.
- **Free Render instance sleeps.** A GitHub Actions ping every 10 minutes keeps it warm, but GitHub runs scheduled jobs late at busy times. An uptime monitor or a paid instance would make the first page load reliably fast.
- **Progress is polled** every 1.2 s rather than pushed.

## Money

- **Refunds are self-service in the sandbox.** The person who asks can also press "Process refund" so the flow is visible from one account. With real money only an admin should (`ADMIN_EMAILS` already supports that).
- **No Stripe webhook.** Payments are confirmed when the browser returns, and again whenever the account page loads. A webhook would also catch a payment made by someone who never comes back to the site. The shared class key can't have a webhook endpoint registered just for this app.
- **Redoing a page is free.** Each redo costs about 2 cents of API and nothing to the user. There is an hourly cap, but a real product would charge or limit per book.
- **Deleting a book does not return the $0.99.** The delete dialog says so.
- **Prices are a table in code.** `src/cost.js` holds the per-token prices; if OpenAI changes them the table has to be edited.

## Product and operations

- **Old 4-page books are hidden.** Books made before this version used a different set of pictures and are no longer listed (they are still in the database).
- **Generation runs inside the web process.** A deploy or crash mid-book marks unfinished pictures "interrupted, try again". A job queue would resume them.
- **Images live in Postgres.** A book is about 6 MB with its PDF, so Neon's free 0.5 GB holds roughly 80 books. Object storage is the next step.
- **No "delete my account".** Deleting a book deletes its photo; there is no one-click removal of everything.
- **`/api/cartoon` and `/api/scene`** (homework 1) are still open without sign-in, limited per IP only.

## Process gaps

- **Only synthetic test children** so far, for privacy. The grader will use a real photo.
- **The storybook-review skill has not been run yet.** It isn't installed on this machine, and the Canvas page that holds it needs the student's login. `review-log.md` has hand-made entries; the first real run goes in as soon as the skill is set up.
