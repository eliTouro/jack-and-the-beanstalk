// The check every generated picture goes through: one call to a small vision model
// that scores the picture and reports where the faces and story-critical objects are.
// The scores decide pass / regenerate (src/quality.js); the boxes feed the text layout
// (src/layout.js).
import sharp from 'sharp';
import { getClient, isMock, HttpError } from './image.js';
import { chatCost } from './cost.js';
import { log } from './log.js';

export const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || 'gpt-4.1-mini';
export const PASS = { likeness: 6, scene: 6 };

const box = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'x0', 'y0', 'x1', 'y1'],
  properties: {
    label: { type: 'string' },
    x0: { type: 'integer' }, y0: { type: 'integer' }, x1: { type: 'integer' }, y1: { type: 'integer' },
  },
};
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hero_count', 'hero_face_visible', 'likeness', 'scene_match', 'has_text', 'defects', 'faces', 'objects', 'top_clear', 'middle_clear', 'bottom_clear', 'summary'],
  properties: {
    hero_count: { type: 'integer', description: 'How many times the hero child appears in the picture.' },
    hero_face_visible: { type: 'boolean', description: "True if the hero's face is clearly visible (front or three-quarter view, not hidden, not tiny)." },
    likeness: { type: 'integer', description: '0-10: how well the hero matches the reference child (face, hair, skin tone, age). 10 if no reference was given.' },
    scene_match: { type: 'integer', description: '0-10: how completely the picture shows the described scene.' },
    has_text: { type: 'boolean', description: 'True if any letters, words, numbers or signs are drawn in the picture.' },
    defects: { type: 'array', items: { type: 'string' }, description: 'Serious drawing defects only: extra or missing limbs, melted or distorted faces, duplicated characters, cut-off heads. Empty if none.' },
    faces: { type: 'array', items: box, description: 'One TIGHT box per face of a person or animal character: from the top of the forehead to the chin, ear to ear. Never the hair above the forehead, a hat, the neck or the body. Coordinates are percent of the picture, 0-100, x from the left, y from the top.' },
    objects: { type: 'array', items: box, description: 'One tight box per small story-critical prop the reader must see to follow the story (for example magic beans, a basket, a hen, a harp, an axe, a bag of gold, a bowl). Not clothing, hats, boots, walking sticks, ropes, furniture, plants, scenery or whole bodies. Usually 0 to 3 boxes.' },
    top_clear: { type: 'boolean', description: 'True if the top 28% of the picture has no face and nothing the story needs the reader to see.' },
    middle_clear: { type: 'boolean', description: 'True if the middle band (36% to 64% from the top) has no face and nothing the story needs the reader to see.' },
    bottom_clear: { type: 'boolean', description: 'True if the bottom 28% of the picture has no face and nothing the story needs the reader to see.' },
    summary: { type: 'string', description: 'One short sentence: what is wrong, or "Looks right."' },
  },
};

const small = async (buffer, width) => {
  const out = await sharp(buffer).resize({ width, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString('base64')}`;
};

// kind: 'reference' (hero portrait vs. the photo) | 'page' (book page vs. the hero
// reference) | 'scene' | 'character' (pre-made pictures, nothing to compare with).
// image, compare: Buffers. Returns { ok, score, issues, faces, objects, clear, summary, model, usage, costUsd, ms }.
export async function analyzeImage({ image, compare = null, kind, description, hasHero = true, slot = '', attempt = 1 }) {
  const t0 = Date.now();
  if (isMock()) return mockAnalysis({ slot, attempt, t0 });

  const content = [
    { type: 'text', text: instructions({ kind, description, hasHero, compare: Boolean(compare) }) },
    { type: 'image_url', image_url: { url: await small(image, 768), detail: 'high' } },
  ];
  if (compare) content.push({ type: 'image_url', image_url: { url: await small(compare, 384), detail: 'low' } });

  let res;
  try {
    res = await getClient().chat.completions.create({
      model: ANALYSIS_MODEL,
      temperature: 0,
      max_tokens: 700,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_schema', json_schema: { name: 'picture_check', strict: true, schema: SCHEMA } },
    });
  } catch (err) {
    log.error({ status: err?.status, message: err?.message }, 'analysis API error');
    throw new HttpError(502, 'The picture check had a problem.');
  }
  let raw;
  try { raw = JSON.parse(res.choices[0].message.content); } catch { throw new HttpError(502, 'The picture check returned something unreadable.'); }
  return { ...grade(raw, { kind, hasHero }), model: ANALYSIS_MODEL, usage: res.usage || null, costUsd: chatCost(ANALYSIS_MODEL, res.usage), ms: Date.now() - t0 };
}

function instructions({ kind, description, hasHero, compare }) {
  const lines = ['You are the quality checker for a children\'s picture book. Check the FIRST image.'];
  if (kind === 'reference') {
    lines.push('It should be a 3D-animated character portrait of exactly one child: the hero of the book.',
      'The SECOND image is the real photo of that child. Score `likeness` by comparing them: face shape, hair, skin tone, age, glasses.',
      `It should show: ${description}`);
  } else if (kind === 'character') {
    lines.push(`It should be a character design picture showing exactly: ${description}`, 'There is no hero child here: set hero_count to 0, hero_face_visible to true and likeness to 10.');
  } else {
    lines.push(`It should be a full-page illustration of this scene: ${description}`);
    if (!hasHero) lines.push('The hero child is not meant to be in this picture: set hero_face_visible to true and likeness to 10.');
    else if (compare) lines.push('The SECOND image is the character reference for the hero child. Score `likeness` by comparing the hero in the first image with it: face, hair, skin tone, age.');
    else lines.push('There is no reference for the hero: set likeness to 10.');
  }
  lines.push('Be strict but fair: score what you actually see. Report a tight box for every face (forehead to chin only) and for every small story-critical prop, in percent of the picture. Measure carefully: the boxes decide where text may be printed.',
    'For top_clear / middle_clear / bottom_clear, ask: could a block of story text be printed across that band without covering a face or something the reader needs to see? Plain sky, wall, floor, grass or shadow is clear.');
  return lines.join('\n');
}

const pct = (v) => Math.min(1, Math.max(0, Number(v) / 100));
const toBox = (b) => ({ label: String(b.label || '').slice(0, 40), x0: pct(Math.min(b.x0, b.x1)), y0: pct(Math.min(b.y0, b.y1)), x1: pct(Math.max(b.x0, b.x1)), y1: pct(Math.max(b.y0, b.y1)) });

// Turns the model's answers into a pass/fail, a 0-100 score and a list of issues.
export function grade(raw, { kind, hasHero }) {
  const issues = [];
  const needsHero = kind === 'reference' || (kind !== 'character' && hasHero);
  if (needsHero && raw.hero_count !== 1) issues.push(raw.hero_count === 0 ? 'the hero is missing' : `the hero appears ${raw.hero_count} times instead of once`);
  if (needsHero && !raw.hero_face_visible) issues.push("the hero's face is not clearly visible");
  if (needsHero && raw.likeness < PASS.likeness) issues.push(`the hero does not look enough like the reference child (${raw.likeness}/10)`);
  if (raw.scene_match < PASS.scene) issues.push(`the picture does not show the whole scene (${raw.scene_match}/10)`);
  if (raw.has_text) issues.push('there is text drawn in the picture');
  for (const d of raw.defects || []) issues.push(String(d).slice(0, 120));
  const clear = { top: Boolean(raw.top_clear), middle: Boolean(raw.middle_clear), bottom: Boolean(raw.bottom_clear) };
  const isPage = kind === 'page' || kind === 'scene';
  if (isPage && !clear.top && !clear.middle && !clear.bottom) issues.push('there is no clear space for the story text');

  let score = 0;
  score += (needsHero ? raw.likeness : 10) * 4;          // 40
  score += raw.scene_match * 3;                            // 30
  score += needsHero ? (raw.hero_count === 1 ? 6 : 0) + (raw.hero_face_visible ? 6 : 0) : 12; // 12
  score += raw.has_text ? 0 : 6;                           // 6
  score += Math.max(0, 6 - 3 * (raw.defects?.length || 0)); // 6
  score += isPage ? (clear.top || clear.bottom ? 6 : clear.middle ? 3 : 0) : 6; // 6
  return {
    ok: issues.length === 0,
    score: Math.round(score),
    issues,
    likeness: raw.likeness,
    sceneMatch: raw.scene_match,
    faces: (raw.faces || []).slice(0, 12).map(toBox),
    objects: (raw.objects || []).slice(0, 12).map(toBox),
    clear,
    summary: String(raw.summary || '').slice(0, 200),
  };
}

// Mock mode: passes, unless MOCK_FAIL says a slot should fail its first N checks
// ("p03=1,p07=3") or MOCK_FAIL_RATE (0-1) makes a random share of checks fail.
async function mockAnalysis({ slot, attempt, t0 }) {
  await new Promise((r) => setTimeout(r, Number(process.env.MOCK_CHECK_MS ?? 400)));
  const planned = Object.fromEntries((process.env.MOCK_FAIL || '').split(',').filter(Boolean).map((s) => s.split('=')));
  const fail = attempt <= Number(planned[slot] || 0) || Math.random() < Number(process.env.MOCK_FAIL_RATE || 0);
  const raw = {
    hero_count: 1, hero_face_visible: true, likeness: fail ? 4 : 8, scene_match: 8, has_text: false, defects: [],
    faces: [{ label: 'hero', x0: 38, y0: 30, x1: 62, y1: 52 }], objects: [],
    top_clear: true, middle_clear: false, bottom_clear: true, summary: fail ? 'Mock check failed.' : 'Looks right.',
  };
  const usage = { prompt_tokens: 420, completion_tokens: 130 };
  // A later attempt scores a little higher, so "best of three" has something to pick.
  const g = grade(raw, { kind: 'page', hasHero: true });
  return { ...g, score: g.score + attempt, model: 'mock', usage, costUsd: chatCost(ANALYSIS_MODEL, usage), ms: Date.now() - t0 };
}
