# Testing the storybook (pages 1–3 + About Me)

The homework-1 checks (likeness and scene fidelity on seven adult and child faces) are in [TESTING-homework1.md](TESTING-homework1.md).

For the book, three things have to hold:

1. **Same child on every page.** Jack's face, hair, glasses and clothes match across pages 1–3 and match the uploaded child.
2. **Faithful to the storyboard.** Each page shows what the brief describes, and its text zone stays empty so the printed text can be read.
3. **No text drawn by the model.** All text comes from the PDF layer.

## Method

- **Children.** Three synthetic children (no real kids): `child-1` (boy about 6, dark skin, curly hair, missing front tooth), `child-2` (girl about 7, East Asian, black bob, red glasses), and `face-2` (girl about 9, StyleGAN photo, light-brown hair). See `test-faces/`.
- **Pipeline.** Exactly what the app does: 1 reference call, then pages 1, 2, 3 in order, one call each.
- **Inputs per page.** Every page call is an **image edit** with the reference (image 1), the photo (image 2) and every earlier page (images 3+), so the mother, the cow, the cottage and Jack carry over. The style string `BOOK_STYLE` is identical in every call; `npm test` checks this.
- **Judging.** I viewed each book as one sheet (photo | reference | page 1 | page 2 | page 3) with the text zone outlined in red, and zoomed in on the page-2 beans. These are my own visual judgments, not a face-recognition score.
- **Offline tests.** `npm test` (17 tests, no key) covers the API rules, the same style string in every call, story text never sent to the model, earlier pages required, and the PDF building.

## Results: final setup (`gpt-image-2.5-flare`, low quality, earlier pages as references)

| Child | Same child on all pages | Matches the photo | Storyboard | Text zones clear | Notes |
|---|---|---|---|---|---|
| child-1 | yes | yes (curly hair, missing tooth) | yes | yes | Jack is small in the page-3 doorway, but still recognizable |
| child-2 | yes | yes (red glasses and bob on every page) | yes | yes | Best result; used for the sample PDF |
| face-2 | yes | **partly** | yes | yes | The reference came out younger and lighter, with blue-green eyes, and every page inherits that. The pages match each other, not quite the photo |

Storyboard details checked:

- **Page 1:** bare kitchen, empty shelves, the mother, Milky-White through the open door, Jack looking at his mother.
- **Page 2:** dirt road, Jack holding the cow's rope, the old man fully in frame with **exactly five beans**, one of each colour. Zoomed in on all three books: 5, 5, 5.
- **Page 3:** dusk, darker palette, the mother throwing beans from the window, Jack watching from the doorway.
- **Continuity:** the mother (bun, blue dress, apron) and the cow look the same on pages 1–3 in all three books.

Sheets: [child-1](test-results/thumbs/book-child-1.jpg), [child-2](test-results/thumbs/book-child-2.jpg), [face-2](test-results/thumbs/book-face-2.jpg), [beans close-up](test-results/thumbs/book-beans-f2.jpg), [sample PDF pages](test-results/thumbs/book-sample-pdf.jpg).

## The edit endpoint ("same scene, one thing changed")

On child-2's page 3 I asked for one change: "make the five falling beans glow softly so they stand out against the dusk". The edit changed only the beans. The mother, Jack, the doorway, the lighting and the empty grass zone stayed the same. [Before and after](test-results/thumbs/book-fix-test.jpg).

## Iteration log

| Round | Setup | What I saw | Change made |
|---|---|---|---|
| 1 | `gpt-image-1.5`, medium; each page made from reference + photo only | Jack was consistent, but page 2 had about 8 beans and the old man was cut off at the edge. Jack's legs ran into the bottom text zone on pages 1 and 3. Nothing tied the mother or cow on one page to the next. [Round 1 sheet](test-results/thumbs/book-child-1-round1.jpg) | Said "exactly FIVE beans, no more and no fewer, one of each colour" and "the old man is fully inside the picture". Gave exact framing: feet two-thirds down, and nothing but floor or grass in the bottom third. |
| 2 | Same prompts, plus every earlier page passed into the edit call for continuity | Not run on 1.5: switched to a cheaper model before any round-2 page was made | Model changed to `gpt-image-2.5-flare`, low quality |
| final | `gpt-image-2.5-flare`, low, chained pages | Results in the table above: all three pass consistency and storyboard, face-2 only partly matches the photo | None yet. See to-do.md |

Two other findings:

- **`gpt-image-1` was retired.** It returns "model does not exist", even though it's still listed for the key. The previous default stopped working on its own.
- **Flare at low quality is about 2x faster** (10–20 s per image) and cheaper. At this quality it looked as good as or better than 1.5 at medium for this style.

## Not tested

- **Playground.** Prompts were iterated by script and visual review, not in the OpenAI Playground.
- **Real children's photos.** Only synthetic faces were used.
- **Phones.** The UI and the PDF download were checked in desktop and mobile-width browsers only, not on real phones.
- **Live site.** I didn't do a full book run on the live site, because Render still points at the retired model until its environment variable is updated.
