# To do

What in this build still needs work, most important first. Evidence is in [TESTING.md](TESTING.md). The feedback items come from the first AI feedback round; the 10 human responses are still being collected.

## From the feedback on the sample book

- **The story stops before anything happens.** This was the most common complaint in the AI feedback. Three pages end with the beans out the window, with no beanstalk. The next page to add is the beanstalk at dawn: a new entry in `PAGES`, one more parallel picture.
- **"Jack" vs the child's name.** The text says Jack while the About Me page says Theo, which several reviewers found confusing. Possible fix: use the child's name in the story text ("Theo and his mother…"), with Jack only in the title.
- **Print quality.** The page art is 1024×1536, which is 171 dpi at 6×9 in (a printer wants 250–300), and there's no bleed. Fixes: render pages at `IMAGE_QUALITY=medium` or upscale for the PDF only, and add 0.125 in bleed.
- **Text looks "slapped on".** One review says the scrims and type look generic. Design a proper text block per page instead of a gradient band.
- **Too polished / uncanny.** Two reviews found the 3D style a bit artificial for a real child. A softer, painterly `BOOK_STYLE` is worth an A/B test against the human answers.

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
