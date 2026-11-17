# Print it and ship it: what I did

**Live site:** https://beanstalk.eliweiss.me · **Sample book the app produced:** [samples/Maya-LittleRedRidingHood.pdf](samples/Maya-LittleRedRidingHood.pdf) · **To do:** [to-do.md](to-do.md) · **Review log:** [review-log.md](review-log.md)

A family makes a 20-page picture book starring their child (Jack and the Beanstalk or Little Red Riding Hood), reads the PDF, approves it, types a delivery address, pays, and the app sends the book to a print-on-demand printer that prints a hardcover and posts it to their door.

## 1. The printer: Lulu Print API

I picked [Lulu's Print API](https://api.lulu.com/docs/) because it takes two PDFs by URL (interior and cover), prints a single copy on demand, ships it, reports the job's status, and has a **sandbox** (`api.sandbox.lulu.com`) where jobs are never printed and are paid with test cards. The app only ever talks to the sandbox; the production URL is not in the code.

- **Product:** 6 × 9 in hardcover (case wrap), premium full colour, 80# coated paper, gloss cover, 24 interior pages. Lulu SKU `0600X0900FCPRECW080CW444GXX`.
- **Files:** the app builds them from the stored pictures when the order is paid.
  - Interior: 24 pages of 6.25 × 9.25 in (0.125 in bleed on every side): copyright page, the 20 story pages, The End, two end pages. All text sits at least 0.5 in inside the trim.
  - Cover: one wide page with the back cover (About Me), the spine and the front cover, sized from Lulu's cover-dimensions endpoint (14.0 × 10.75 in for this book).
- **Hand-off:** Lulu downloads the files from a secret link on the site (`/print-files/<order>/<random token>/…`). The order page asks Lulu for the job status at most once a minute; a job Lulu rejects or cancels is refunded to the card automatically.
- Until the Lulu sandbox keys are set, a simulated printer moves orders through the same stages, so the flow can be tried end to end.

## 2. Nothing is sent before the family approves it

1. **Open the proof.** The button opens the exact book as a PDF in a new tab. The approval box can't be ticked until the proof has been opened.
2. **Approve for printing.** The approval is stored with a fingerprint of everything that ends up on paper: every picture's version, where its text sits, the name and the About Me details. Redrawing a page, fixing a picture or editing a detail voids the approval, and the page asks for a new one.
3. **Address and shipping.** US only. Every field is checked (full name, street, city, state, 5-digit ZIP, a phone number for the carrier, an email). Four shipping speeds.
4. **Pay.** Stripe Checkout, test mode, for the exact total. Only when Stripe confirms the payment does the app build the print files and place the Lulu order. The history page shows the card payment in and the order out, with the order number.

## 3. It looks like a real book

| Page | What is on it |
|---|---|
| Front cover | Its own picture of the child (drawn from a pre-made cover scene, like every page), the title, "starring" the child's name, the publisher's imprint. The title is sized to fit above the highest face on the cover. |
| Inside, first page | Copyright notice and the publisher: "Text and illustrations copyright © 2026 Beanstalk Books. All rights reserved…", "Published by Beanstalk Books, beanstalk.eliweiss.me", first edition, book number. |
| Pages 1–20 | The story, starting on the first page after the copyright page. |
| The End | |
| Back cover | About Me: the child's portrait, name, age, favourite things and the parent's note, with the title and publisher at the foot. |

## 4. What the child types is checked

`src/moderation.js` checks the About Me details when the book is started, every time they are saved, when the proof is approved, and when the order is placed:

1. **Rules in code:** no links, emails or phone numbers; letters, spaces, hyphens and apostrophes only in a name; no keyboard mashing; and word lists of insults, slurs and swear words, caught even when disguised ("1d10t", "s.t.u.p.i.d"). Insults like "pig" are refused as a name but allowed in "favourite things" ("our pet pig").
2. **OpenAI's moderation endpoint** (free): hate, harassment, sexual and violent content.
3. **A small model (`gpt-4.1-mini`)** for what a list can't judge: is this a plausible first name or nickname for a child from any culture, or an insult, joke or object; is each detail fit to print in a children's book. It costs about $0.0003 a check and is cached.

A refused name returns a kind, specific message next to the field, and nothing is charged.

## 5. Price, cost and margin

**Price:** the book is $0.99 (as before). A printed hardcover, shipped by standard mail in the US, is **$28.99**. Faster shipping is extra: Priority +$9.99, Expedited +$15.99, Express +$30.99, which is Lulu's shipping difference rounded up to cover the card fee.

**Cost of one printed book, shipped standard to a US address:**

| Item | Cost | Source |
|---|---|---|
| Book art: about 21 image calls and 21 checks | $0.40 | Average of the app's API cost log (real runs: $0.33 to $0.59 a book) |
| About Me check | $0.00 | Under a tenth of a cent |
| Printing: 6 × 9 premium colour hardcover, 24 pages | $14.01 | Lulu price API, Nov 2026 |
| Lulu fulfilment fee | $0.75 | Lulu price API |
| Shipping, standard mail (11 to 13 days) | $5.69 | Lulu shipping API, New York address |
| Card fees: two payments ($0.99 and $28.99) at 2.9% + $0.30 | $1.47 | Stripe standard rate |
| **Total cost** | **$22.32** | |

**Revenue $29.98 − cost $22.32 = $7.66 margin per printed book, 26%.** With faster shipping the margin in dollars stays about the same and the percentage falls (Priority 21%, Express 13%), because shipping is passed through close to cost.

Not in the numbers: US sales tax (Lulu charges tax on the print job in many states; a real shop would collect it from the customer), returns and reprints, and the one-time $1.19 spent drawing the character bible and the template scenes. The cost report page (`/?view=costs`, signed in) shows the same table, using the live average from the cost log.

**Why this price:** the print and post alone cost $20.45, so under about $25 there is no business. $28.99 keeps the whole purchase, book and print, just under $30, and leaves a margin that covers a reprint for every three or four books if something goes wrong in the post.

## 6. What changed in the code

| File | What |
|---|---|
| `src/print.js` | Lulu sandbox client (OAuth, cover dimensions, cost calculation, print jobs, status), the simulated printer, prices, address checks, the order lifecycle |
| `src/pdf.js` | Rewritten: front cover, copyright page, story pages, The End, About Me back cover; reading PDF, print interior with bleed, case-wrap cover |
| `src/moderation.js` | The About Me and name checks |
| `src/billing.js` | Stripe Checkout for print orders, ledger lines for them, automatic refund when the printer fails |
| `src/template.js`, `src/stories/*.js` | The cover as a template row; one cover scene per story |
| `server.js`, `public/` | Approve, order, orders and print-file routes; the "Order a printed copy" steps on the book page; "Printed books" on the account page |
| `test/book.test.js` | 47 offline tests, including the print flow, approval voiding, address checks, refunds and name checks |

## 7. What I could not finish

- **Lulu sandbox keys.** Creating the Lulu sandbox account is a sign-up I had to leave to the site owner. Until `LULU_CLIENT_KEY` and `LULU_CLIENT_SECRET` are set, orders go to the simulated printer. The Lulu client code follows Lulu's published API and was checked against its OpenAPI file, but it has not yet placed a sandbox job.
- **The Jack and the Beanstalk sample** with the new cover: the OpenAI account ran out of credit during the run. The Little Red Riding Hood sample was made by the app end to end.
- **The `storybook-review` rerun:** see review-log.md.
