# To do

What in this build still needs work, most important first. Evidence is in [TESTING.md](TESTING.md).

## Likeness and consistency

- **When the reference drifts from the photo, every page drifts with it.** For one test child (`face-2`, a low-contrast photo) the reference came out younger and lighter-skinned, with blue-green eyes instead of grey-brown. All three pages copied the reference faithfully, so the book is consistent but not quite that child. Fix ideas:
  - Show the reference to the parent before any pages are made, with "Try a different look" (the button exists, but the UI doesn't stress this step yet).
  - Add skin tone and eye colour to the reference prompt as explicit "copy from the photo" items.
- **Page 3 doesn't always show all five beans.** In the live run only four were visible in flight. The brief doesn't count them on page 3, but they should match page 2.
- **Jack is small on page 3.** In the doorway at dusk his face is only about 60 px tall on a 1024×1536 page. It's still recognizable for all three test children, but that's where likeness will fail first. The page-3 composition could bring the doorway closer.
- **Continuity relies on passing earlier pages in.** Page 3 receives pages 1 and 2. A 20-page book can't pass 19 earlier pages, so it will need a fixed "cast sheet" image (mother, cow, old man, cottage), made once and passed instead.
- **Story text is gendered.** "Jack and his mother" stays as written in the brief even for a girl's book. The pictures keep the child's own gender, but the text doesn't adapt. Possible fix: let the uploader pick a name and pronouns for the hero.

## Process gaps

- **No Playground pass.** The brief asks for style words to be tried by hand in the OpenAI Playground first. I iterated with scripts (`scripts/book.mjs`) and reviewed every image visually, but I didn't compare alternative style wordings side by side in the Playground.
- **Only three synthetic test children,** and no real children's photos (deliberately, for privacy). Untested: a child with a hat or headscarf, twins or siblings in one photo, a blurry phone photo, or a side-on face.

## Product gaps

- **No cover or title page.** The book opens straight on page 1. A cover with the child's name would make it feel finished.
- **Nothing is saved.** A full book takes about 1 minute (4 calls at about 10–20 s each), and reloading the page loses it. Pages could be kept in IndexedDB.
- **Redoing an early page doesn't refresh later ones.** If page 1 is redone, pages 2 and 3 were built on the old page 1 and may no longer match. The UI should mark them as out of date.
- **"Fix something" edits can't be masked.** In the one test it changed only what was asked (the beans), but nothing limits an edit to a region, so a vague request could redraw more.
- **Page numbers are tiny and land on the art.** They're readable in the PDF, but they're placed by zone rather than designed.
- **Free Render instance cold start** of about 30–50 s after idling. The per-IP rate limit is in memory and resets on restart.
- **Page 4 onward** (the beanstalk at dawn, then the homework-1 plant and climb scenes as pages) aren't built. Each is a new entry in `PAGES` in `src/book.js`; the UI, API and PDF already work from that list.
