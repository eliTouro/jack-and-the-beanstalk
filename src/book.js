// The picture book: storyboard, the one style string, and the prompts for the
// reference image, the cast sheet, each page, and one-thing-changed page edits.
//
// Consistency rules (the child must be the same child on every page):
//   - ONE style string, BOOK_STYLE, sent word for word in every call.
//   - ONE reference image per book (made once from the photo by referencePrompt),
//     passed as image 1 on every page call. Only the reference sees the photo.
//   - ONE cast sheet per book (castPrompt): the mother, the cow, the old man and the
//     cottage, passed as image 2 on every page call. Because no page depends on
//     another page, all pages can be drawn at the same time.
//   - Fixed descriptions for Jack's outfit, the mother, the old man and the cow,
//     so recurring characters don't drift between pages.
//   - The model never draws text. Page text is printed by the PDF layer (src/pdf.js).

export const BOOK_STYLE =
  'Art style: modern 3D animated feature film — rounded forms, large expressive eyes, soft rim light. ' +
  'Polished, cinematic, warm and family-friendly, like a frame from an animated movie.';

const NO_TEXT =
  'Do not draw any text anywhere: no letters, words, numbers, signs, labels, captions, speech bubbles, logos or watermark.';

// Identity rules for the child. Unlike the scene prompts in prompts.js, eye size is
// left to the style ("large expressive eyes"); everything else is copied.
const CHILD_IDENTITY = [
  'Jack is this exact child. The face must stay recognizably the same child as in the photo:',
  'same face shape, eye shape and eye color, eyebrows, nose, mouth, ears, skin tone, freckles or moles,',
  'hairline, hairstyle, hair length, hair texture and hair color, glasses (only if the child wears them), and age.',
  '"Jack" is only the name of the role: keep the child\'s own gender presentation, and never make them older or younger.',
  'Do not beautify, change ethnicity, or swap in a generic cartoon child.',
].join(' ');

const JACK_OUTFIT =
  'Jack wears the same outfit on every page: a patched oatmeal-colored linen tunic, a short moss-green wool vest, ' +
  'a brown leather belt, rolled-up brown trousers and scuffed brown leather boots.';

const MOTHER =
  "Jack's mother: a thin, kind, tired-looking woman in her late thirties with the same skin tone and hair color as Jack, " +
  'hair tied back in a loose bun, wearing a faded blue dress and a cream apron.';

const OLD_MAN =
  'a small, wrinkled old man with a long white beard, bushy eyebrows, a battered green felt hat and a crooked walking stick';

const COW = 'Milky-White, a gentle, thin white cow with a few pale brown patches and a small brass bell on a rope collar';

// Magic, but not candy: one bright colour per bean read as jelly beans to reviewers.
const BEANS =
  'five large speckled beans, mottled cream and deep plum-brown, with a faint golden shimmer';

// Story text: {name} becomes the child's name from the About Me page ("Jack" until
// it's filled in). The text never uses he/she for the child, so it fits any child.
// Text zones tell the PDF layer where to print and in which tone:
//   zone: 'top' | 'bottom'   tone: 'light' (white text, dark scrim) | 'dark' (dark text, pale scrim)
export const PAGES = [
  {
    id: 'cupboard',
    number: 1,
    title: 'The empty cupboard',
    text: 'The cupboard was bare. “{name},” said Mother, “take our cow, Milky-White, to market and sell her for a good price.”',
    zone: 'bottom',
    tone: 'light',
    scene:
      `Inside a bare, poor cottage kitchen. Cupboard doors hang open on empty shelves; one empty bowl and a stub of candle sit on a rough wooden table. ` +
      `Jack stands facing the viewer and looks at his mother with a worried face. ${MOTHER} She stands beside the table. ` +
      `Through the open cottage door behind them, ${COW} is clearly visible outside in the yard.`,
    composition:
      "Jack's full face is clearly visible, front-lit by warm light from a window, eyes turned toward his mother. Jack and his mother stand in the middle of the picture, seen from a slightly raised camera, so their feet are about two-thirds of the way down the picture.",
    textSpace:
      'The bottom third of the picture is only plain floorboards in soft shadow: no faces, hands, feet or important objects there. The story text will be printed there.',
  },
  {
    id: 'trade',
    number: 2,
    title: 'The trade',
    text: 'On the road, an old man held out five speckled beans. “Magic beans, for your cow?” And {name} said yes.',
    zone: 'top',
    tone: 'dark',
    scene:
      `A winding dirt road to market between green fields and hedgerows. Jack holds ${COW} by her rope. ` +
      `Facing Jack stands ${OLD_MAN}. The old man holds out his open palm with exactly ${BEANS} in it, no more and no fewer, large enough to count.`,
    composition:
      'Jack is in three-quarter view, face clearly visible, looking at the beans with wonder. Jack wears exactly the same clothes as on page 1. The old man is fully inside the picture, his whole face visible. All characters stand in the lower two-thirds of the picture: every head, including the top of the old man’s hat, stays below the top third.',
    textSpace:
      'Leave the top third of the picture as open, plain, pale sky with only a few soft clouds: the story text will be printed there.',
  },
  {
    id: 'window',
    number: 3,
    title: 'Out the window',
    text: '“You sold our only cow for five beans?” cried Mother. “Now we have nothing!” And out the window the beans flew.',
    zone: 'bottom',
    tone: 'light',
    scene:
      `The outside of the cottage at dusk. ${MOTHER} She leans out of a lit cottage window with a cross, disappointed frown, tossing the beans out; ` +
      `the same ${BEANS} from page 2 scatter through the air and fall into the garden below. Jack stands in the open cottage doorway, watching, face lit by warm light from inside.`,
    composition:
      "A darker palette than the earlier pages: deep blue and violet dusk sky, warm orange window and door light. Jack's face is visible, in three-quarter or front view. The doorway, the window and the characters are in the upper two-thirds of the picture.",
    textSpace:
      'The bottom third of the picture is only dark, quiet grass: no faces, feet or important objects there. The story text will be printed there.',
  },
  {
    id: 'beanstalk',
    number: 4,
    title: 'The beanstalk',
    text: '{name} went to bed hungry. But in the morning, where the beans had landed, a beanstalk had grown up and up, right into the clouds.',
    zone: 'bottom',
    tone: 'light',
    scene:
      'The cottage garden at sunrise, the morning after. Where the beans fell, an enormous beanstalk has grown overnight: a thick, twisting green stem with huge leaves, ' +
      'rising past the cottage roof and out of the top of the picture into pink and gold morning clouds. ' +
      'Jack stands at the foot of the beanstalk, head tilted back, looking up at it in amazement, one hand resting on the stalk. The cottage, with the window from page 3, is beside the beanstalk.',
    composition:
      "Low camera angle looking up, so the beanstalk towers over everything. Jack's face is clearly visible in three-quarter view, lit by golden sunrise light. Jack and the foot of the beanstalk are in the middle third of the picture.",
    textSpace:
      'The bottom third of the picture is only plain garden grass and soil in soft shadow: no faces, feet or important objects there. The story text will be printed there.',
  },
];

// The page text for one book.
export function pageText(page, name) {
  return page.text.replaceAll('{name}', (name || '').trim() || 'Jack');
}

export const PAGE_BY_ID = Object.fromEntries(PAGES.map((p) => [p.id, p]));

// Every picture in a book, in the order they're drawn: the reference and the cast sheet
// first (at the same time), then every page (at the same time).
export const SLOTS = [
  { id: 'reference', label: 'Your Jack', kind: 'reference' },
  { id: 'cast', label: 'The cast', kind: 'cast' },
  ...PAGES.map((p) => ({ id: p.id, label: `Page ${p.number}`, kind: 'page' })),
];
export const SLOT_BY_ID = Object.fromEntries(SLOTS.map((s) => [s.id, s]));

export function referencePrompt() {
  return [
    'Create the character design for the hero of a children\'s picture book of "Jack and the Beanstalk", based on the child in this photo.',
    CHILD_IDENTITY,
    JACK_OUTFIT,
    BOOK_STYLE,
    'Show Jack from the waist up, facing the viewer, with a gentle smile and a clear, evenly lit face, on a plain soft cream background.',
    'Exactly one person.',
    NO_TEXT,
  ].join('\n');
}

// The supporting cast, drawn once per book so every page shows the same people,
// cow and cottage. The photo is only used to match the mother's coloring to the child.
export function castPrompt() {
  return [
    'Create a character model sheet for the supporting cast of a children\'s picture book of "Jack and the Beanstalk".',
    'The photo shows the child who plays Jack. Do NOT draw the child. Use the photo only to give the mother the same skin tone and hair color as the child.',
    'Draw these four side by side, each full body and fully inside the picture, evenly spaced on a plain soft cream background:',
    `1. ${MOTHER}`,
    `2. ${COW}`,
    `3. ${OLD_MAN[0].toUpperCase()}${OLD_MAN.slice(1)}, holding ${BEANS} in his open palm.`,
    '4. Their small, poor thatched cottage with a wooden door and one window with a flower box.',
    'Each in a neutral standing pose, facing three-quarters toward the viewer, evenly lit.',
    BOOK_STYLE,
    NO_TEXT,
  ].join('\n');
}

// Images: 1 = reference (Jack), 2 = cast sheet. The child's photo is not sent: Jack's
// likeness comes from the reference, and the safety filter blocked some page scenes
// when a real child's photo was attached to them.
export function pagePrompt(pageId) {
  const page = PAGE_BY_ID[pageId];
  return [
    `Illustrate page ${page.number} of a children's picture book of "Jack and the Beanstalk" as one full-page picture.`,
    'Image 1 is the character reference for Jack, the hero. Image 2 is the cast sheet for this book: Jack\'s mother, Milky-White the cow, the old man and the cottage.',
    'Jack must look exactly like the character in image 1: same face, hair, skin tone and clothes.',
    'Any of the mother, the cow, the old man or the cottage that appear on this page must look exactly like they do in image 2. Do not copy the layout of image 2: this page is a full scene.',
    CHILD_IDENTITY,
    JACK_OUTFIT,
    BOOK_STYLE,
    `Scene: ${page.scene}`,
    `Composition: ${page.composition}`,
    `Text space: ${page.textSpace}`,
    'Jack appears exactly once.',
    NO_TEXT,
  ].join('\n');
}

// Edit endpoint prompt: same page, one thing changed.
export function fixPrompt(pageId, instruction) {
  const page = PAGE_BY_ID[pageId];
  return [
    `Image 1 is a finished page (page ${page.number}) of a children's picture book of "Jack and the Beanstalk". Image 2 is the character reference for Jack.`,
    `Make only this change to image 1: ${instruction}`,
    'Keep everything else exactly the same: the composition, camera angle, lighting, colors, the other characters, and Jack\'s face, hair and clothes (which must match image 2).',
    `Keep the text space clear: ${page.textSpace}`,
    BOOK_STYLE,
    NO_TEXT,
  ].join('\n');
}

// What the uploader can type for the About Me page, with length caps.
export const ABOUT_FIELDS = [
  { id: 'name', label: "Child's name", max: 40, required: true },
  { id: 'age', label: 'Age', max: 20 },
  { id: 'favorites', label: 'Favorite things', max: 160 },
  { id: 'about', label: 'More about me', max: 400 },
];

export function normalizeAbout(input = {}) {
  const out = {};
  for (const f of ABOUT_FIELDS) {
    const v = typeof input[f.id] === 'string' ? input[f.id].replace(/\s+/g, ' ').trim().slice(0, f.max) : '';
    out[f.id] = v;
  }
  return out;
}
