# Feedback on the sample storybook

Everyone looked at the same thing: the photo of the child and the whole 4-page sample PDF ([survey page](https://beanstalk.eliweiss.me/sample.html)). Everyone answered the same questions:

1. Does Jack look like the child?
2. Does the story ring true?
3. Does it look professional?
4. What isn't good?

The first three are rated 1–5.

- [Human responses](#human-responses-10)
- [AI responses](#ai-responses-10)
- [Comparison](#comparison)

## Human responses (10)

Ten friends and family answered a Google Form, sent on WhatsApp, between November 3 and 4, 2026. The form showed the photo and all 4 pages. None of the ten is a parent or caregiver of a child under 12. Names are left out; respondents are numbered in the order they answered.

**Averages:** Likeness 3.8 · Story 3.8 · Professional 3.4 (out of 5)

| # | Likeness | What makes him look (or not look) like the photo | Story | Pro | What isn't good (first thing to fix) |
|---|---|---|---|---|---|
| H1 | 4 | The real forehead is bigger than in the AI version. Otherwise, the facial features and skin colour are correct. | 3 | 4 | It's very short, not the whole story. Also, it isn't clear what "milky white" refers to; I assumed the cow. |
| H2 | 4 | Same features | 4 | 3 | Make it longer. |
| H3 | 3 | He looks like a little kid in that age range | 5 | 2 | The hair, maybe |
| H4 | 4 | Not all features exactly, but pretty good. | 3 | 3 | It's short. |
| H5 | 4 | Hair and eyes and missing tooth are the same | 4 | 3 | Is his name Jack or Theo? |
| H6 | 4 | _(blank)_ | 5 | 5 | Don't make the beans colourful |
| H7 | 4 | Most of the features look exactly the same. The only real difference is that the book makes a cartoon version rather than a hyper-realistic one, which has a different effect. | 4 | 4 | It's short, so just hard to tell. I'm also not so familiar with the story of Jack and the Beanstalk. |
| H8 | 3 | His skin complexion | 4 | 4 | Looks AI |
| H9 | 4 | Jack's eyes and eyebrows are a little different in the book, but otherwise very similar | 4 | 5 | I would add a page before Jack's mom throws out the beans, explaining why she would do that. |
| H10 | 4 | _(blank)_ | 2 | 1 | The transitions are not smooth. Context is missing in each page and in connecting one page to the next. |

The raw export is kept private because some respondents gave their first names.


## AI responses (10)

### How the 10 reviewers were made different

Each of the 10 is a different persona, and every call is independent: no reviewer sees another's answers. The full method will be added here after the class discussion on November 9, as the professor asked.

### Did it work? Personas vs. ten plain calls

As a control, I also asked the same survey 10 times with no persona (gpt-4.1-mini, temperature 1.0).

| | 10 personas | 10 plain calls |
|---|---|---|
| Similarity between answers (mean pairwise cosine of embeddings; lower = more different) | **0.769** | 0.855 |
| Spread of likeness ratings (SD) | **0.78** | 0.3 |
| Spread of story ratings (SD) | **0.92** | 0.49 |
| Spread of "professional" ratings (SD) | **0.75** | 0.3 |
| Different rating combinations | **8 of 10** | 4 of 10 |

The plain calls mostly repeated one complaint: the story is too short. The personas raised problems the plain calls never mentioned:

- print resolution (171 dpi) and the missing bleed (the printer)
- the art going soft on an iPad (the grandmother)
- AI-render staging and text "slapped on" the art (the illustrator)
- the uncanny feeling of a real child turned into a character (the lawyer)
- a too-polished, digital look (the father)

### Averages

Likeness 3.7 · Story 3.6 · Professional 3.8 (out of 5)

| Reviewer | Likeness | Story | Pro | What isn't good (first thing to fix) |
|---|---|---|---|---|
| grandma-ipad | 5 | 4 | 4 | The print is a tiny bit fuzzy and the story stops before the beanstalk grows. I’d like one page of the beanstalk going up to finish it for bedtime. |
| k-teacher | 4 | 2 | 4 | First thing I’d fix is the story text and consistency: either make the character fully Theo or explain Jack clearly, and give the book a real middle and ending instead of just two beats plus an About Me page. The art is good; the writing is what needs work. |
| dad-of-child | 4 | 5 | 4 | The one thing to fix would be the slightly digital/artificial look of the illustrations, make it feel more organic and realistic. |
| theo-age-6 | 3 | 4 | 5 | I think they should show more of the beanstalk and the giant, not just the start part. Also, saying Jack but the picture shows Theo is kinda confusing. |
| pro-illustrator | 3 | 2 | 2 | First thing I’d fix is the story consistency and pagination — it needs an actual narrative arc and cleaner visual continuity. The biggest tell is page 3: the mother’s hand, the beans, and the staging all feel awkwardly arranged, and Theo’s design drifts a bit from page to page. Also the text is just dropped on top of the images with no real scrim or considered layout. |
| print-shop | 3 | 4 | 3 | Biggest issue is the low image resolution on pages 1-3. They won’t look sharp printed at 6x9. If you’re charging money, you need at least 250dpi. Second, you need a bleed if the art goes to the edge, or you risk ugly white edges after trimming. |
| colorblind-dad | 3 | 4 | 4 | The expressions in the illustrations could be more lively. First thing I'd tweak. |
| busy-mom-skim | 3 | 4 | 4 | I’d fix the likeness to the photo first. It threw me off a bit that the kid in the story seemed different from the photo they used. |
| folklore-librarian | 5 | 4 | 4 | The biggest issue is that the story is cut off before the beanstalk even grows. It needs at least one page of the beanstalk sprouting, or a hint of the adventure to come, to feel like a satisfying storybook rather than an unfinished introduction. |
| privacy-lawyer | 4 | 3 | 4 | The first thing I would fix is the story itself: it is too thin and a bit nonsensical, especially that opening line and the abrupt ending. Also, the book feels slightly odd because the child is transformed into a fantasy character but still very obviously the same real kid, which is a little uncanny. |

### Full answers

<details><summary><b>grandma-ipad</b></summary>

- **Likeness 5/5:** Jack looks just like the little boy in the photo—the same smile and missing tooth, even the hair looks the same. The costume is different but the face is right.
- **Story 4/5:** The story is Jack and the Beanstalk, just shortened for a few pages. The pictures fit what’s happening—Milky-White, the beans, the mother at the window. Wish there was a beanstalk though.
- **Professional 4/5:** It looks very nice, like a real picture book. The words are big and clear, good for reading aloud. Pages are a little soft/blurry on my iPad but I can still tell what’s going on.
- **What isn't good:** The print is a tiny bit fuzzy and the story stops before the beanstalk grows. I’d like one page of the beanstalk going up to finish it for bedtime.

</details>

<details><summary><b>k-teacher</b></summary>

- **Likeness 4/5:** The boy in the book looks a lot like the photo: same face shape, big smile, short curly hair, and the overall sweet expression. It is still an illustrated version of him, so it is not exact, but I’d clearly recognize him as Theo.
- **Story 2/5:** It has the Jack and the Beanstalk pieces, but it feels very rushed and a little off. The pictures are nice, but the story text is thin and page 3 just says the beans went out the window, which doesn’t really move the story along. Also it keeps saying Jack even though the child is Theo, so it doesn’t feel fully made for him.
- **Professional 4/5:** The artwork looks polished and the pages are laid out cleanly. It looks like something a website generated well. The main thing that keeps it from feeling fully professional is the weak storytelling and the mismatch in naming.
- **What isn't good:** First thing I’d fix is the story text and consistency: either make the character fully Theo or explain Jack clearly, and give the book a real middle and ending instead of just two beats plus an About Me page. The art is good; the writing is what needs work.

</details>

<details><summary><b>dad-of-child</b></summary>

- **Likeness 4/5:** It looks a lot like the photo, especially the hair and smile, but something about the skin tone and expression seems off, like it’s a bit too polished.
- **Story 5/5:** It sticks to the Jack and the Beanstalk theme really well. The pictures fit the text, and it feels like a familiar tale.
- **Professional 4/5:** The book looks quite polished and I'd feel okay about paying to print it, but there’s a slight digital feel that makes it seem less authentic.
- **What isn't good:** The one thing to fix would be the slightly digital/artificial look of the illustrations, make it feel more organic and realistic.

</details>

<details><summary><b>theo-age-6</b></summary>

- **Likeness 3/5:** The story Theo looks kinda like the photo with the same brown skin and curly hair, but the story person is wearing old-looking clothes and it’s more like a cartoon. It looks like someone made him smaller and gave him a costume, not exactly him.
- **Story 4/5:** The story sounds like Jack and the Beanstalk but shorter. The pictures go with the words mostly, and the bean thing is funny 'cause they go out the window. But I want to see the giant and the beanstalk too!
- **Professional 5/5:** The pictures look super colorful and nice, like a movie or a really good cartoon storybook you can buy. The text is easy to read and the pages look clean.
- **What isn't good:** I think they should show more of the beanstalk and the giant, not just the start part. Also, saying Jack but the picture shows Theo is kinda confusing.

</details>

<details><summary><b>pro-illustrator</b></summary>

- **Likeness 3/5:** The little face is recognizably the same kid in broad strokes — same curly hair, same smiley cheeks, same big ears, same general head shape. But the character art smooths him out a lot and changes the exact facial structure, so it reads more like a loose inspired version than a true portrait of Theo.
- **Story 2/5:** It only half tracks as Jack and the Beanstalk. The cow-and-beans setup is there, but the text and visuals are muddy: page 1 calls the cow Milky-White, page 2 says the old man trades beans for one cow, and page 3 shows a bunch of beans flying out the window without much story logic. It feels abbreviated and a bit random rather than like a clean retelling.
- **Professional 2/5:** It’s polished in the shallow AI way — warm lighting, soft textures, and decent composition at a glance — but it doesn’t hold up as a professional picture book. The page pacing is thin, the typography is generic, the story pages are basically full-bleed render dumps with caption text slapped on, and the whole thing feels generated rather than art-directed.
- **What isn't good:** First thing I’d fix is the story consistency and pagination — it needs an actual narrative arc and cleaner visual continuity. The biggest tell is page 3: the mother’s hand, the beans, and the staging all feel awkwardly arranged, and Theo’s design drifts a bit from page to page. Also the text is just dropped on top of the images with no real scrim or considered layout.

</details>

<details><summary><b>print-shop</b></summary>

- **Likeness 3/5:** The Jack character in the story does have the right skin tone and hair type to resemble the kid in the photo, but the facial features are more generic and cartoonish. You can tell it's based on him, but it’s not an exact likeness. Feels like a decent AI attempt, not a true portrait.
- **Story 4/5:** It’s definitely Jack and the Beanstalk, and the pictures match the words well. The story is super short, but the key events are there. The images are cute and tell the story, even if it's only three pages of story before the 'About Me.'
- **Professional 3/5:** It looks decent at a glance, but I’d be embarrassed to hand this to a customer because the images on the story pages are only 171dpi at print size—soft and fuzzy on paper. There’s no bleed, but the art runs right to the trim. That’s risky for cutting—might get white slivers. The fonts are clear and the layout is clean, but this is more like a quick online gift than a real, professional children’s book.
- **What isn't good:** Biggest issue is the low image resolution on pages 1-3. They won’t look sharp printed at 6x9. If you’re charging money, you need at least 250dpi. Second, you need a bleed if the art goes to the edge, or you risk ugly white edges after trimming.

</details>

<details><summary><b>colorblind-dad</b></summary>

- **Likeness 3/5:** The kid in the book doesn't really match exactly, but it's close enough to pass.
- **Story 4/5:** Pretty good. Classic 'Jack and the Beanstalk' feel, and the pictures go with the story.
- **Professional 4/5:** Looks well made, like something you'd find in a store. The colors and layout are clean.
- **What isn't good:** The expressions in the illustrations could be more lively. First thing I'd tweak.

</details>

<details><summary><b>busy-mom-skim</b></summary>

- **Likeness 3/5:** The boy in the story illustrations has some similar features but looks a bit older and dressed differently than the photo, so it doesn’t feel exactly him.
- **Story 4/5:** It’s definitely Jack and the Beanstalk and the pictures go well with the text. It seemed pretty classic and easy to follow.
- **Professional 4/5:** The pictures and layout look well done, like a real kids’ book you might buy, but nothing super fancy or extra polished.
- **What isn't good:** I’d fix the likeness to the photo first. It threw me off a bit that the kid in the story seemed different from the photo they used.

</details>

<details><summary><b>folklore-librarian</b></summary>

- **Likeness 5/5:** The character of Jack (Theo) in the story looks remarkably like the child in the original photo, right down to the same smile and missing front tooth. His hair, skin tone, and general cheerful expression all match the original photo very well.
- **Story 4/5:** The story feels true to the classic Jack and the Beanstalk tale, especially in the opening scenes: the poverty, Milky-White the cow, the magic beans, and the mother’s frustration are all present. The illustrations do match the story, and they include nice period-appropriate details. However, it’s really just the opening of the fairy tale, and abruptly stops before any beanstalk or adventure, which makes it feel incomplete.
- **Professional 4/5:** The images look sharp, well-composed, and colorful, and the book uses a clear, readable font. The costume and setting details feel authentic to a fairy tale village. The 'About Me' page is a cute touch and looks polished, but the fact that the story stops so early makes it feel a little thin for a professional picture book.
- **What isn't good:** The biggest issue is that the story is cut off before the beanstalk even grows. It needs at least one page of the beanstalk sprouting, or a hint of the adventure to come, to feel like a satisfying storybook rather than an unfinished introduction.

</details>

<details><summary><b>privacy-lawyer</b></summary>

- **Likeness 4/5:** It definitely reads as the same child: the face shape, big eyes, short curly hair, and the bright smile are all there. The illustrated Theo is a stylized version, so it is not a literal match, but it still feels recognizably like the boy in the photo.
- **Story 3/5:** It has the right ingredients for Jack and the Beanstalk - the cow, the beans, the mother, the trade - but it feels more like a loose remix than the actual story. The text on page 1 is awkward, and page 3 stops before anything really happens, so it does not fully land as a complete retelling.
- **Professional 4/5:** It looks polished and clearly made by a decent template or image pipeline. The pages are clean, the illustrations are consistent, and the About Me page is nicely laid out. It is not perfect, but it would pass as a printed custom book without embarrassment.
- **What isn't good:** The first thing I would fix is the story itself: it is too thin and a bit nonsensical, especially that opening line and the abrupt ending. Also, the book feels slightly odd because the child is transformed into a fantasy character but still very obviously the same real kid, which is a little uncanny.

</details>

## Comparison

### The numbers

| | Humans (10) | AI personas (10) | Plain AI calls (10, control) |
|---|---|---|---|
| Likeness: mean (SD, range) | 3.8 (0.42, 3–4) | 3.7 (0.82, 3–5) | 3.9 (0.32, 3–4) |
| Story: mean (SD, range) | 3.8 (0.92, 2–5) | 3.6 (0.97, 2–5) | 3.6 (0.52, 3–4) |
| Professional: mean (SD, range) | **3.4 (1.26, 1–5)** | 3.8 (0.79, 2–5) | **4.9 (0.32, 4–5)** |
| Different rating combinations | 9 of 10 | 8 of 10 | 4 of 10 |

- **Plain calls flatter, and the flattery is in "professional".** Ten plain calls gave the book 4.9/5 for looking professional. The humans gave 3.4, and one gave it a 1. A product team using plain calls would have shipped thinking the look was done.
- **The personas got much closer.** They averaged 3.8, with a spread and range almost as wide as the humans'. Their story spread (SD 0.97) nearly matches the humans' (0.92).
- **Likeness is the one place everyone agreed.** All three groups averaged about 3.8: "clearly him, not exact". The personas were the only group to give 5s (the grandmother and the librarian), so on likeness they were more spread out than real people.

### What each group complained about

| Complaint | Humans | Personas | Plain calls |
|---|---|---|---|
| Too short or stops early; no beanstalk or ending | 4 (H1, H2, H4, H7) | 5 | 7 |
| Pages don't connect; missing *why* (why does Mum throw the beans?) | **2 (H9, H10)** | 1 (the teacher, "no real middle") | 0 |
| Jack or Theo? | 1 (H5) | 2 | 1 |
| Looks AI, too polished, uncanny | 1 (H8) | 3 (the father, the illustrator, the lawyer) | 0 |
| Beans too colourful, like jelly beans | 1 (H6) | 0 | 1 |
| "Milky-White" isn't clear | 1 (H1) | 0 | 1 |
| Hair | 1 (H3) | 0 | 0 |
| Print resolution, bleed, fuzzy on a tablet | 0 | 2 (the printer, the grandmother) | 0 |
| Text dropped on top of the art | 0 | 1 (the illustrator) | 0 |
| Likeness is the first thing to fix | 0 | 1 (the busy mum) | 0 |

### What I take from it

1. **"It's too short" is real, but the humans meant something more specific: it doesn't make sense page to page.** Two of ten said so outright (H9: explain why the mother throws the beans out; H10: context is missing between pages). Only one AI reviewer came near it. AI reviewers judged the story against the fairy tale they know. Humans judged whether *this* book explains itself, and one of them (H7) didn't know the fairy tale at all, which no AI reviewer could simulate.
2. **Personas found things humans can't, and humans found things AI didn't think to.** Print dpi, bleed and text layout came only from the expert personas. No friend or relative is a printer, but a customer holding a blurry printed book would notice. The missing motivation and the unclear "Milky-White" came from humans.
3. **Plain calls are an echo chamber.** Seven of ten said the same sentence about length, and they rated the look almost perfect. The persona design is what made the AI set disagree with itself the way people do. It still didn't reproduce the humans' main point.
4. **Bias in the human sample:** they're all friends or family and none is a parent of a young child, the actual buyer. The personas covered parents, a teacher and a child, so the two sets complement each other rather than one replacing the other.

### What changed in the book because of this

Items 1–4 are done (commit 65148fa: four pages, the child's name in the text, speckled beans; tested on a real book in TESTING.md). Item 5 is still in to-do.md.

1. **Make the pages connect.** Add the "why": the cow was all they had, Jack traded her for five beans, and Mum is furious. Add the beanstalk the next morning, so the story has an ending beat. *(Humans H1, H2, H4, H7, H9, H10; personas: the grandmother, teacher, child, librarian and lawyer.)*
2. **One name.** Use the child's name in the text, and keep "Jack and the Beanstalk" only as the title. *(H5; the teacher and the child.)*
3. **Say "their cow, Milky-White"** the first time. *(H1.)*
4. **Beans that look magic but not like candy:** speckled, earthy beans with a faint glow. *(H6; one plain call.)*
5. **Later:** a less glossy, painterly style to test against "looks AI", and print resolution and bleed for paid printing. *(H8; the father, illustrator and printer.)*

