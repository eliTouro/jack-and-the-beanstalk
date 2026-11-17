// The one 20-page template both stories are poured into. For every page number it
// fixes the camera framing and the part of the picture that must stay empty, because
// that is where the story text is allowed to go. A story (src/stories/*.js) only
// supplies what happens; the template decides how the page is built.
//
// The art is always a 2:3 portrait picture (1024x1536) on a 6x9 in page.
//   zone: where the text goes if the finished picture really is clear there
//         (src/layout.js checks every picture and moves the text if it isn't).

export const PAGE = { width: 432, height: 648, art: '1024x1536' };

const CLEAR = {
  top: 'Keep the top 30% of the picture visually empty: only open sky, soft clouds, a plain wall, ceiling or quiet foliage. Every face, head, hat, hand and important object stays below it. The story text will be printed there.',
  bottom: 'Keep the bottom 30% of the picture visually empty: only plain ground, floor, grass, path or soft shadow. Every face, hand, foot and important object stays above it. The story text will be printed there.',
};

const rows = [
  // [zone, shot]
  ['bottom', 'wide establishing shot'],
  ['bottom', 'medium two-shot'],
  ['top', 'wide outdoor shot'],
  ['top', 'medium two-shot'],
  ['bottom', 'medium shot'],
  ['bottom', 'wide shot'],
  ['top', 'wide shot from a low camera'],
  ['top', 'wide shot'],
  ['bottom', 'wide establishing shot'],
  ['bottom', 'medium two-shot'],
  ['top', 'medium interior shot'],
  ['bottom', 'medium close shot'],
  ['bottom', 'wide shot'],
  ['top', 'medium shot'],
  ['bottom', 'medium action shot'],
  ['top', 'wide action shot'],
  ['bottom', 'medium action shot'],
  ['top', 'wide shot, the climax'],
  ['bottom', 'medium shot'],
  ['bottom', 'wide shot, the happy ending'],
];

export const TEMPLATE = rows.map(([zone, shot], i) => ({
  number: i + 1,
  id: `p${String(i + 1).padStart(2, '0')}`,
  zone,
  shot,
  keepClear: CLEAR[zone],
}));

export const PAGE_COUNT = TEMPLATE.length;

// The front cover follows the same rules: one framing, one clear zone for the title.
export const COVER = {
  number: 0,
  id: 'cover',
  zone: 'top',
  shot: 'front cover, medium-wide shot',
  keepClear: 'Keep the top 38% of the picture visually empty: only open sky, soft clouds or quiet treetops. Every face, head, hand and important object stays below it. The book title will be printed there.',
};

// The printed book: interior pages are the copyright page, the 20 story pages, a closing
// page and blank end pages, padded to a page count the binding accepts.
export const PRINT = {
  interiorPages: 24,
  // 6 x 9 in, premium full colour, hardcover case wrap, 80# coated white paper, gloss.
  podPackageId: process.env.LULU_POD_PACKAGE_ID || '0600X0900FCPRECW080CW444GXX',
};
