// The picture book: storyboard, the one style string, and the prompts for the
// reference image, each page, and one-thing-changed page edits.
//
// Consistency rules (the child must be the same child on every page):
//   - ONE style string, BOOK_STYLE, sent word for word in every call.
//   - ONE reference image per book (made once from the photo by referencePrompt),
//     passed as image 1 on every page call, with the photo as image 2.
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

// Text zones tell the PDF layer where to print and in which tone:
//   zone: 'top' | 'bottom'   tone: 'light' (white text, dark scrim) | 'dark' (dark text, pale scrim)
export const PAGES = [
  {
    id: 'cupboard',
    number: 1,
    title: 'The empty cupboard',
    text: 'Jack and his mother had nothing left to sell but Milky-White.',
    zone: 'bottom',
    tone: 'light',
    scene:
      `Inside a bare, poor cottage kitchen. Cupboard doors hang open on empty shelves; one empty bowl and a stub of candle sit on a rough wooden table. ` +
      `Jack stands facing the viewer and looks at his mother with a worried face. ${MOTHER} She stands beside the table. ` +
      `Through the open cottage door behind them, ${COW} is clearly visible outside in the yard.`,
    composition:
      "Jack's full face is clearly visible, front-lit by warm light from a window, eyes turned toward his mother. Medium shot: Jack and his mother fill the middle of the picture.",
    textSpace:
      'Keep the bottom third of the picture calm and simple (plain floorboards in soft shadow, no faces or important objects): the story text will be printed there.',
  },
  {
    id: 'trade',
    number: 2,
    title: 'The trade',
    text: '“Five magic beans,” said the old man. “For one cow.”',
    zone: 'top',
    tone: 'dark',
    scene:
      `A winding dirt road to market between green fields and hedgerows. Jack holds ${COW} by her rope. ` +
      `Facing Jack stands ${OLD_MAN}. The old man holds out his open palm with exactly five beans in it, each a different bright color: red, blue, yellow, purple and green.`,
    composition:
      'Jack is in three-quarter view, face clearly visible, looking at the beans with wonder. Jack wears exactly the same clothes as on page 1. All characters stand in the lower two-thirds of the picture.',
    textSpace:
      'Leave the top third of the picture as open, plain, pale sky with only a few soft clouds: the story text will be printed there.',
  },
  {
    id: 'window',
    number: 3,
    title: 'Out the window',
    text: '“Beans!” she cried. And out the window they went.',
    zone: 'bottom',
    tone: 'light',
    scene:
      `The outside of the cottage at dusk. ${MOTHER} She leans out of a lit cottage window, angrily flinging the beans away; ` +
      'the five colorful beans scatter through the air and fall into the garden below. Jack stands in the open cottage doorway, watching, face lit by warm light from inside.',
    composition:
      "A darker palette than the earlier pages: deep blue and violet dusk sky, warm orange window and door light. Jack's face is visible, in three-quarter or front view.",
    textSpace:
      'The bottom third of the picture is dark, quiet grass with no important detail: the story text will be printed there.',
  },
  // Page 4 (the beanstalk at dawn) and the earlier "plant" / "climb" scenes slot in
  // here as more entries with the same shape; nothing else needs to change.
];

export const PAGE_BY_ID = Object.fromEntries(PAGES.map((p) => [p.id, p]));

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

export function pagePrompt(pageId) {
  const page = PAGE_BY_ID[pageId];
  return [
    `Illustrate page ${page.number} of a children's picture book of "Jack and the Beanstalk" as one full-page picture.`,
    'Image 1 is the character reference for Jack, the hero. Image 2 is the real photo of the child Jack is based on.',
    'Jack must look exactly like the character in image 1 on every page: same face, hair, skin tone and clothes. Image 2 wins any disagreement about the face, skin tone, hair or eye color.',
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
