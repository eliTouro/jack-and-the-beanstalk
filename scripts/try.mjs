// Prompt-iteration helper: makes exactly ONE image-model call per run.
// There is intentionally no loop over faces or scenes — run it once per case.
//
//   node --env-file-if-exists=.env scripts/try.mjs cartoon test-faces/face-1.jpg [style] [exaggeration]
//   node --env-file-if-exists=.env scripts/try.mjs plant   test-faces/face-1.jpg [style] [exaggeration]
//   node --env-file-if-exists=.env scripts/try.mjs climb   test-faces/face-1.jpg [style] [exaggeration]
//
// Scenes reuse the cartoon saved by an earlier `cartoon` run for the same face
// and style (test-results/<face>-<style>-cartoon.jpg), just like the web app does.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { generateImage, MODEL } from '../src/image.js';
import { cartoonPrompt, scenePrompt, normalizeSettings, SCENES } from '../src/prompts.js';

const [what, photoPath, style, exaggeration] = process.argv.slice(2);

// Test-set helper: generate a photoreal portrait of a person who does not exist
// (used to fill gaps in the test faces).  try.mjs face <out.jpg> "<description>"
if (what === 'face' && photoPath && style) {
  const prompt = `A realistic, natural head-and-shoulders portrait photo of a fictional person who does not exist: ${style}. Facing the camera, even soft light, plain background, sharp focus on the face. No text or watermark.`;
  const image = await generateImage({ prompt, images: [], size: '1024x1024' });
  await writeFile(photoPath, Buffer.from(image.data, 'base64'));
  console.log(`${MODEL} face -> ${photoPath}`);
  process.exit(0);
}

if (!['cartoon', ...Object.keys(SCENES)].includes(what) || !photoPath) {
  console.error('usage: try.mjs cartoon|plant|climb <photo> [style] [exaggeration]  |  try.mjs face <out.jpg> "<description>"');
  process.exit(1);
}

const settings = normalizeSettings({ style, exaggeration });
const mimeOf = (p) => ({ '.png': 'image/png', '.webp': 'image/webp' })[extname(p).toLowerCase()] || 'image/jpeg';
const load = async (p) => ({ data: (await readFile(p)).toString('base64'), mimeType: mimeOf(p) });

const face = basename(photoPath, extname(photoPath));
const stem = `test-results/${face}-${settings.style}`;
await mkdir('test-results', { recursive: true });

const photo = await load(photoPath);
let request;
if (what === 'cartoon') {
  request = { prompt: cartoonPrompt(settings), images: [photo], size: '1024x1024' };
} else {
  const cartoon = await load(`${stem}-cartoon.jpg`).catch(() => {
    console.error(`No cartoon at ${stem}-cartoon.jpg — run the cartoon step for this face first.`);
    process.exit(1);
  });
  request = { prompt: scenePrompt(what, settings), images: [photo, cartoon], size: '1536x1024' };
}

const started = Date.now();
const image = await generateImage(request);
const out = `${stem}-${what}.jpg`;
await writeFile(out, Buffer.from(image.data, 'base64'));
console.log(`${MODEL} ${what} ${JSON.stringify(settings)} -> ${out} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
if (what !== 'cartoon') console.log(`caption: ${SCENES[what].spec}`);
