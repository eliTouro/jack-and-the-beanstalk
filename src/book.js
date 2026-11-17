// The picture book: the two stories poured into the one 20-page template, the one
// style string, and every prompt the book sends to the image model.
//
// How a book is made:
//   - Once, ahead of time (scripts/pregen.mjs): a character bible picture for every
//     supporting character and a stand-in hero, then all 20 scenes of each story drawn
//     from those bible pictures. Bible and scenes are stored in the database.
//   - Per book: ONE reference picture of the child as the hero (from the photo), then
//     each pre-made scene is edited so the stand-in hero becomes that child. The
//     composition, and so the clear space for the text, comes from the template.
//   - The model never draws text. Page text is printed by the PDF layer (src/pdf.js)
//     where src/layout.js found the picture to be clear.
import { TEMPLATE, COVER } from './template.js';
import jack from './stories/jack.js';
import red from './stories/red.js';

export const BOOK_STYLE =
  'Art style: modern 3D animated feature film — rounded forms, large expressive eyes, soft rim light. ' +
  'Polished, cinematic, warm and family-friendly, like a frame from an animated movie.';

const NO_TEXT =
  'Do not draw any text anywhere: no letters, words, numbers, signs, labels, captions, speech bubbles, logos or watermark.';

const CHILD_IDENTITY = [
  'The hero is this exact child. The face must stay recognizably the same child:',
  'same face shape, eye shape and eye color, eyebrows, nose, mouth, ears, skin tone, freckles or moles,',
  'hairline, hairstyle, hair length, hair texture and hair color, glasses (only if the child wears them), and age.',
  "The hero's name is only a role: keep the child's own gender presentation, and never make them older or younger.",
  'Do not beautify, change ethnicity, or swap in a generic cartoon child.',
].join(' ');

// The stand-in hero used in the pre-made scenes. Every book replaces this child.
const STAND_IN = 'a seven-year-old child with short, tousled chestnut-brown hair, light olive skin and brown eyes';

function buildStory(src) {
  if (src.pages.length !== TEMPLATE.length) throw new Error(`${src.id}: a story needs exactly ${TEMPLATE.length} pages`);
  const characters = Object.fromEntries(src.characters.map((c) => [c.id, c]));
  const pages = src.pages.map((p, i) => {
    for (const id of p.cast) if (!characters[id]) throw new Error(`${src.id} page ${i + 1}: unknown character "${id}"`);
    return { ...TEMPLATE[i], ...p, hero: p.hero !== false };
  });
  if (!src.cover) throw new Error(`${src.id}: a story needs a cover`);
  for (const id of src.cover.cast) if (!characters[id]) throw new Error(`${src.id} cover: unknown character "${id}"`);
  const cover = { ...COVER, ...src.cover, hero: true, text: `${src.title}, starring {name}` };
  const pageById = Object.fromEntries([cover, ...pages].map((p) => [p.id, p]));
  return { ...src, characters: src.characters, characterById: characters, pages, cover, pageById };
}

export const STORIES = { jack: buildStory(jack), red: buildStory(red) };
export const STORY_IDS = Object.keys(STORIES);
export const DEFAULT_STORY = 'jack';
export const storyOf = (id) => STORIES[id] || STORIES[DEFAULT_STORY];

// Every picture in a book: the child's reference first, then the front cover and the 20
// pages. The slot ids are the same for both stories because both use the same template.
export const PAGE_IDS = TEMPLATE.map((t) => t.id);
// Everything drawn from a template scene: the cover and the pages.
export const SCENE_IDS = [COVER.id, ...PAGE_IDS];
export const SLOTS = [
  { id: 'reference', label: 'Your hero', kind: 'reference' },
  { id: COVER.id, label: 'Front cover', kind: 'page' },
  ...TEMPLATE.map((t) => ({ id: t.id, label: `Page ${t.number}`, kind: 'page' })),
];
export const SLOT_BY_ID = Object.fromEntries(SLOTS.map((s) => [s.id, s]));

// The page text for one book: {name} becomes the child's name.
const where = (page) => (page.number === 0 ? 'the front cover' : `page ${page.number}`);

export function pageText(page, name, story) {
  return page.text.replaceAll('{name}', (name || '').trim() || story?.heroRole || 'Jack');
}

// ---- prompts: the character bible (made once) ------------------------------------
export function characterPrompt(story, character) {
  return [
    `Create a character design sheet picture for a children's picture book of "${story.title}".`,
    `The character: ${character.name}. ${character.description}`,
    'Show the whole character, full body, in a neutral standing pose, turned three-quarters toward the viewer, evenly lit, on a plain soft cream background.',
    'Exactly one character and nothing else in the picture.',
    BOOK_STYLE,
    NO_TEXT,
  ].join('\n');
}

export function standInPrompt(story) {
  return [
    `Create the character design for the hero of a children's picture book of "${story.title}".`,
    `The hero is ${STAND_IN}. ${story.heroOutfit}`,
    'Show the hero from the knees up, facing the viewer, with a gentle smile and a clear, evenly lit face, on a plain soft cream background.',
    'Exactly one person.',
    BOOK_STYLE,
    NO_TEXT,
  ].join('\n');
}

// A pre-made scene. Images: 1 = the stand-in hero (when the hero is on the page), then
// one bible picture per supporting character on the page, in `page.cast` order.
export function scenePrompt(story, page, feedback) {
  const names = [];
  if (page.hero) names.push('the hero');
  for (const id of page.cast) names.push(story.characterById[id].name);
  const key = names.map((n, i) => `Image ${i + 1} is the character design for ${n}.`).join(' ');
  return [
    `Illustrate ${where(page)} of a children's picture book of "${story.title}" as one full-page portrait picture.`,
    key,
    names.length ? 'Every character from those images must look exactly like their design: same face, hair, colours and clothes. Do not copy the plain backgrounds or poses of the designs: this page is a full scene.' : '',
    page.hero ? `The hero wears the same outfit on every page. ${story.heroOutfit}` : 'The hero of the book is not in this picture.',
    BOOK_STYLE,
    `Framing: ${page.shot}.`,
    `Scene: ${page.scene}`,
    `Composition: ${page.composition}`,
    `Text space: ${page.keepClear}`,
    page.hero ? 'The hero appears exactly once, with the face clearly visible.' : '',
    feedback ? `An earlier attempt at this picture was rejected. Fix these problems: ${feedback}` : '',
    NO_TEXT,
  ].filter(Boolean).join('\n');
}

// ---- prompts: one book -------------------------------------------------------------
export function referencePrompt(story, feedback) {
  return [
    `Create the character design for the hero of a children's picture book of "${story.title}", based on the child in this photo.`,
    CHILD_IDENTITY,
    story.heroOutfit,
    BOOK_STYLE,
    'Show the hero from the waist up, facing the viewer, with a gentle smile and a clear, evenly lit face, on a plain soft cream background.',
    'Exactly one person.',
    feedback ? `An earlier attempt was rejected. Fix these problems: ${feedback}` : '',
    NO_TEXT,
  ].filter(Boolean).join('\n');
}

// Images: 1 = the pre-made scene from the template, 2 = this book's hero reference.
export function pagePrompt(story, page, feedback) {
  return [
    `Image 1 is ${where(page)} of a children's picture book of "${story.title}". Image 2 is the character reference for the hero of this copy of the book.`,
    'Redraw image 1 with one change: the child hero in image 1 becomes the child in image 2.',
    'The hero keeps the pose, position, size and outfit from image 1, but takes the face, hair, skin tone, age and gender presentation from image 2.',
    CHILD_IDENTITY,
    'Keep everything else exactly as in image 1: the composition, camera angle, lighting, colours, background and every other character.',
    `Keep the text space clear. ${page.keepClear}`,
    BOOK_STYLE,
    'The hero appears exactly once, with the face clearly visible.',
    feedback ? `An earlier attempt was rejected. Fix these problems: ${feedback}` : '',
    NO_TEXT,
  ].filter(Boolean).join('\n');
}

// Used when a scene has not been pre-made yet: draw the page straight from the
// reference and the bible pictures. Images: 1 = hero reference, then the cast.
export function pageFromScratchPrompt(story, page, feedback) {
  return [scenePrompt(story, page, feedback), CHILD_IDENTITY].join('\n');
}

// Edit prompt: same page, one thing changed. Images: 1 = the page, 2 = hero reference.
export function fixPrompt(story, page, instruction) {
  return [
    `Image 1 is a finished picture (${where(page)}) of a children's picture book of "${story.title}". Image 2 is the character reference for the hero.`,
    `Make only this change to image 1: ${instruction}`,
    "Keep everything else exactly the same: the composition, camera angle, lighting, colors, the other characters, and the hero's face, hair and clothes (which must match image 2).",
    `Keep the text space clear. ${page.keepClear}`,
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
    const v = typeof input?.[f.id] === 'string' ? input[f.id].replace(/\s+/g, ' ').trim().slice(0, f.max) : '';
    out[f.id] = v;
  }
  return out;
}
