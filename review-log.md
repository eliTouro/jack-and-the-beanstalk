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
