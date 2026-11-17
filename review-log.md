# Review log

Every run of the `storybook-review` skill appends an entry here. Entries are never edited or removed: the point is the trajectory.

---

## Entry 0 · 2026-11-15 · self-check before the first skill run (no score)

This entry is **not** a `storybook-review` run. The skill had not been set up yet, so there is no rubric score. It records what was checked by hand on the build that became commit "Homework 4", so the first real run has a baseline to compare with.

**Build:** branch `homework-4`, local server, real image calls, in-memory database, Stripe sandbox.

| Area | What was checked | Result |
|---|---|---|
| Fund an account | Paid $5.00 on Stripe's sandbox page with card 4242 4242 4242 4242 | Balance $5.00, one credit in the history |
| $0.99 per book | Made a book | Balance $4.01, debit names the book |
| Refund | Requested the unspent $4.01, then processed it | Stripe refund id stored (`re_…`), status Processed, balance $0.00 |
| History | Read the page | 3 rows, each with cause, amount and balance after |
| Cost per book | Two real books | $0.59 (Jack, 21 drawings) and $0.33 (Red, 18 drawings, smaller inputs); shown next to $0.99 |
| 20 pages + About Me | Counted PDF pages | 21 in both PDFs |
| One template, two stories | Both stories built from `src/template.js` | Text zone matches the template on 37 of 40 scenes; the layout step moved the other 3 |
| Under 60 seconds | Timed photo to PDF | 29.3 s (Jack), 55.5 s (Red: one image call hung for 45 s) |
| Thumbnails as they finish | Watched the book page | Appear one by one from 26 s; template pages at 2 s |
| Still there tomorrow | Signed out and in again (offline test) | PDF downloads, same bytes |
| Quality loop | Offline tests and mock mode | Redraw on failure, 3 at most, best kept, count shown. **No real picture has failed the check yet** |
| Text never on a face | Looked at 11 PDF pages | No text on a face; 3 Red pages used the framed layout |

**Fix first**

1. Find out whether the picture check is too lenient: 92 of 92 real pictures passed first time.
2. The Red run was 4.5 s from the limit. A backup call for stragglers was added after this run; it needs a real run to confirm.
3. Run the real `storybook-review` skill against the live site with a photo that was not used in development.

---

## Entry 0b · 2026-11-15 · bug found on the live site (no score)

Not a skill run. On the live site every "Add money" button returned "Stripe could not start the payment". Cause: after the sandbox test in Entry 0, a `payment_method_types: ['card']` option was added to the checkout request and never re-tested against Stripe, which now rejects that parameter. Removed; `scripts/check-stripe.mjs` and a call through the app's own route (1, 3 and 10 books) now both return a Stripe checkout page. Lesson: re-run the real Stripe check after any change to the payment request, not only the offline tests (the simulated checkout can't catch this).

---

## Entry 1 · 2026-11-17 · self-check for "Print it and ship it" (no score)

Not a `storybook-review` run: the skill is not installed here (its text is on a Canvas page behind the student's login). Checked by hand on a local build with real image calls, the in-memory database and the simulated printer.

| Area | What was checked | Result |
|---|---|---|
| Real book layout | Rendered the real Little Red Riding Hood book | Cover with the child, title and "starring Maya"; copyright page; story from the next page; The End; About Me back cover. 24 pages |
| Title clear of faces | Cover title sized to fit above the highest face | Clear on both cover scenes |
| Print files | Interior and cover built | Interior 24 pages at 450 × 666 pt (bleed); cover 1008 × 774 pt wrap |
| Approval | Approve, edit the age, try to order | Approval voided, order refused until approved again |
| Address checks | Bad ZIP, state, phone | Each field gets its own message |
| Order | Simulated payment, priority shipping | Order BB-00001 "Sent to the printer", history shows card payment in and order out |
| Printer failure | Pictures removed before printing | Order marked failed, refunded, history shows it |
| Name checks | "Poopy Head", "1d10t", "Fatso", real names from several cultures | Insults refused before charging; real names pass |
| Cost and margin | Cost report page | $29.98 revenue, $22.32 cost, $7.66 margin at standard shipping |

**Found and fixed during this check**

- Two books at once hit the OpenAI image rate limit and four pages failed. The image call now waits out a rate limit and tries again instead of failing the page.
- The OpenAI account then ran out of credit, so the Jack and the Beanstalk sample with the new cover could not be made.

**Fix first**

1. Add OpenAI credit, then remake the Jack and the Beanstalk sample.
2. Create the Lulu sandbox account and place one real sandbox print job.
3. Install `storybook-review` and run it against the live site with an unused photo.
