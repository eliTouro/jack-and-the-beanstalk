// Every prompt the app sends to the image model lives here.
// The prompts are generic on purpose: they describe how to treat *any* uploaded
// face, never a particular person.

export const STYLES = {
  storybook: {
    label: 'Storybook watercolor',
    text: 'a classic illustrated fairy-tale storybook painting: soft watercolor washes, gentle ink outlines, warm paper texture',
  },
  animated: {
    label: '3D animated film',
    text: 'a modern 3D animated feature-film character: soft global illumination, rounded appealing forms, expressive eyes, subtle subsurface skin shading',
  },
  comic: {
    label: 'Comic book',
    text: 'a bold comic-book illustration: confident ink lines, flat cel shading, halftone texture in the shadows',
  },
  anime: {
    label: 'Anime',
    text: 'a hand-drawn anime illustration: clean line art, cel shading, luminous painted backgrounds',
  },
  clay: {
    label: 'Claymation',
    text: 'a stop-motion claymation figure: sculpted plasticine with visible fingerprints and tool marks, miniature set lighting',
  },
};

export const EXAGGERATION = {
  subtle: 'Keep proportions close to real life; stylize the rendering, not the anatomy.',
  medium: 'Use gentle cartoon proportions: a slightly larger head and eyes, simplified shapes.',
  bold: 'Use playful caricature proportions: a big head and expressive eyes, but every distinctive facial feature must stay recognizable.',
};

export const PALETTES = {
  vivid: 'saturated, cheerful colors',
  pastel: 'soft pastel colors',
  earthy: 'warm earthy colors: ochre, moss green, rust, cream',
};

export const LINES = {
  none: 'no outlines',
  fine: 'thin, delicate outlines',
  bold: 'thick, confident outlines',
};

export const DEFAULT_SETTINGS = {
  style: 'storybook',
  exaggeration: 'medium',
  palette: 'vivid',
  lines: 'fine',
};

// Fall back to the default for anything unknown, so a tampered request can
// only ever pick from the fixed menus above.
export function normalizeSettings(input = {}) {
  const pick = (table, key) => (Object.hasOwn(table, input[key]) ? input[key] : DEFAULT_SETTINGS[key]);
  return {
    style: pick(STYLES, 'style'),
    exaggeration: pick(EXAGGERATION, 'exaggeration'),
    palette: pick(PALETTES, 'palette'),
    lines: pick(LINES, 'lines'),
  };
}

function styleSentence(s) {
  return `Art style: ${STYLES[s.style].text}, ${PALETTES[s.palette].text}, ${LINES[s.lines].text}. ${EXAGGERATION[s.exaggeration]}`;
}

// The single most important block for the "looks like the person" check.
const IDENTITY = [
  'The face must stay recognizably the same individual as in the photo.',
  'Keep, exactly: face shape and jawline, eye shape, eye spacing and eye color, eyebrow shape, nose shape and size, mouth and lip shape, ears,',
  'skin tone, any freckles, moles or dimples, hairline, hairstyle, hair length, hair texture and hair color, facial hair, glasses, and apparent age.',
  'Do not beautify, de-age, slim, change ethnicity or swap in a generic cartoon face. Stylize the rendering, not the identity.',
].join(' ');

export function cartoonPrompt(settings) {
  const s = normalizeSettings(settings);
  return [
    'Turn the person in this photo into a cartoon character portrait.',
    IDENTITY,
    styleSentence(s),
    'Show head and shoulders, facing the viewer, with a friendly expression, on a plain soft cream background.',
    'Dress them in simple medieval peasant clothes: a rough linen tunic with a leather cord at the collar.',
    'Exactly one person. No text, no captions, no watermark, no frame.',
  ].join('\n');
}

// The scene specifications. Each `spec` is sent to the model word for word AND
// shown as the caption under the generated picture, so the caption is always
// exactly what was asked for. Keep them concrete and checkable.
export const SCENES = {
  plant: {
    title: 'Jack plants the magic beans',
    spec:
      'Jack kneels in the dark soil of a small vegetable patch beside a thatched-roof cottage, ' +
      'pressing a handful of glowing magic beans into a freshly dug hole with one hand. ' +
      'A small cloth pouch of beans lies open beside the hole. ' +
      'A brown and white cow watches from behind a low wooden fence. Golden early-evening light.',
  },
  climb: {
    title: 'Jack climbs the beanstalk',
    spec:
      'Jack climbs a gigantic twisting green beanstalk with leaves bigger than Jack, ' +
      'gripping the stalk with both hands, one foot braced on a leaf, looking up toward a castle in the clouds above. ' +
      'Far below, the thatched-roof cottage looks tiny. Bright blue sky with drifting clouds.',
  },
};

export function scenePrompt(sceneId, settings) {
  const s = normalizeSettings(settings);
  const scene = SCENES[sceneId];
  return [
    'Create one illustration for the fairy tale "Jack and the Beanstalk".',
    'Image 1 is a real photo of a person. Image 2 is that same person already drawn as a cartoon character.',
    'Cast this person as Jack: the character in the scene is this exact person, keeping their own face, gender presentation, skin tone, hair and glasses (if any), drawn exactly like image 2.',
    IDENTITY,
    'Make the face large enough to be clearly visible and recognizable, turned at least three-quarters toward the viewer.',
    styleSentence(s),
    'Jack wears simple medieval peasant clothes: a rough linen tunic, a rope belt and leather boots.',
    `Scene: ${scene.spec}`,
    'Show every element of the scene description. Jack appears exactly once. No text, no captions, no speech bubbles, no watermark.',
  ].join('\n');
}
