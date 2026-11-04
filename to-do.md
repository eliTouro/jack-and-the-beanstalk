# To do

What in this build still needs work, most important first. Evidence is in [TESTING.md](TESTING.md). The feedback items come from 10 human responses (friends and family, Google Form, Nov 3–4) and 10 AI reviews of the same sample book.

## From the feedback on the sample book

Ratings out of 5: humans gave likeness 3.8, story 3.8 and professional 3.4. Plain AI calls rated "professional" 4.9, so humans were much harsher on the look.

- ~~**The pages don't connect, and the story stops early.**~~ Done: the text now explains why, and page 4 is the beanstalk. This is the top human complaint (6 of 10). Four said "too short". Two were more specific: "add a page explaining why Mum throws out the beans" and "context is missing between pages". Fix: say why (the cow was all they had, Jack traded her for five beans) and add the beanstalk at dawn as the ending beat, as a new entry in `PAGES` with one more parallel picture.
- ~~**"Is his name Jack or Theo?"**~~ Done: the text uses the child's name and never says he or she. (1 human, 2 AI). Use the child's name in the story text, with Jack only in the title.
- ~~**"Milky-White" isn't clear**~~ Done. (1 human). Say "their cow, Milky-White" the first time.
- ~~**The beans look like candy**~~ Done: speckled beans. (1 human, 1 AI). Draw speckled, earthy beans with a faint glow instead of five bright colours.
- **"Looks AI"** (1 human, 3 AI). A softer, painterly `BOOK_STYLE` is worth an A/B test.
- **Print quality** (AI only; no human checked it). The page art is 1024×1536, which is 171 dpi at 6×9 in (a printer wants 250–300), and there's no bleed. Fixes: render at `IMAGE_QUALITY=medium` or upscale for the PDF only, and add 0.125 in bleed.
- **Text looks "slapped on"** (AI only). Design a proper text block per page instead of a gradient band.

## Likeness and consistency

- **Likeness now comes only from the reference.** Page calls no longer get the photo (it triggered the safety filter on page 3; see TESTING.md), so if the reference drifts from the photo, every page drifts with it. The "Try a different look" button redraws the reference and all pages, but the UI could still stress checking Jack before reading on.
- **A failed reference fails the book.** If Jack or the cast sheet is blocked, the pages are marked "draw Jack first" and the user has to retry. That's correct, but blunt.
- **Story text is gendered.** "Jack and his mother" stays as written even for a girl's book. The pictures keep the child's own gender, but the text doesn't adapt.

## Product and operations

- **Generation runs inside the web process.** If Render restarts mid-book (a deploy or a crash), the unfinished pictures are marked "interrupted, try again". A real job queue would resume them.
- **Images are stored in Postgres as bytes.** That's simple, but Neon's free plan is 0.5 GB, which is roughly 400 books. Move the images to object storage (S3 or R2) if it grows.
- **The photo is now stored** (so pages can be redone later), and deleting a book deletes it. There's no "delete my account" yet, and no automatic expiry.
- **No cover or title page.** The book opens straight on page 1.
- **"Fix something" edits can't be masked.** Nothing limits an edit to one region of the page.
- **Free Render instance cold start** of about 30–50 s after idling.
- **Real per-image progress.** The bars are time-based estimates (from the average of recent real durations), not true progress. OpenAI's streaming partial images could show the picture forming instead.

## Process gaps

- **No Playground pass.** Prompts were iterated by script and visual review.
- **Only synthetic test children,** no real children's photos (deliberately, for privacy).
