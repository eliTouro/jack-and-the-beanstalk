# To do

What in this build still needs work, most important first.

## Not done yet in this iteration

- **The book prompts haven't been tested on real images.** The OpenAI account ran out of credit just as book testing started, so the reference, page and fix prompts in `src/book.js` have been written but not yet run on any test child. Until that's done I don't know whether Jack's face holds from page 1 to page 3, whether page 2 really shows exactly five coloured beans, or whether the text zones (bottom third on pages 1 and 3, top sky on page 2) actually stay empty.
- **No sample PDF yet.** `samples/JackAndTheBeanstalk.pdf` needs one real run on a synthetic child once there is credit again.
- **Playground pass not done.** The brief asks for the style words to be tried by hand in the OpenAI Playground first. So far the style string was written from the brief and not compared against alternatives there.
- **Only one child test face so far** (`test-faces/face-2.jpg`). The plan is three synthetic children: a boy about 6 with dark skin, a girl about 7 with glasses, and the existing girl about 9.

## Known weaknesses carried over from homework 1

- **Adults and teens can drift towards "a boy".** "Jack" pulls the model towards drawing a young boy. In homework 1 a woman in her 40s came out boyish in both scenes (TESTING.md, face 7). For the book the subject is a child, which makes this less of a problem, but it's still a risk for girls. The prompt says "Jack is only the role name", which wasn't enough for adults.
- **Story text is still gendered.** The storyboard uses "his mother" because that's the assigned text. A girl's book still says "Jack and his mother". Possible fix: let the uploader choose he/she/they and a name for the hero.
- **Small faces lose detail.** On page 2 (three-quarter view on a road) and page 3 (Jack small in a doorway at dusk), the face is small, and in homework 1 small faces are where likeness slipped first.

## Product gaps

- **No cover or title page.** The book jumps straight into page 1. A cover with the child's name would make it feel finished.
- **Making all three pages takes about 1–2 minutes**, with no saving: a reload loses everything. Pages could be kept in IndexedDB.
- **The "Fix something" edit sometimes redraws more than the one thing asked for.** That's a model behaviour; there's no mask yet to limit the edit to a region.
- **Free Render instance cold start** of about 30–50 s on the first request after idling.
- **Page 4 and on** (the beanstalk at dawn, the giant's castle, and the two homework-1 scenes as pages) are planned. They are new entries in `PAGES` in `src/book.js`; the plant and climb scene specs in `src/prompts.js` need rewriting in the book style first.
- **The rate limit is per IP and in memory.** It resets when Render restarts and isn't shared if Render ever runs more than one instance.
