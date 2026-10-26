// Book helper for prompt iteration and for making the sample PDF.
// Each model mode makes exactly ONE image call per run (no loops); run it once per page.
//
//   node --env-file-if-exists=.env scripts/book.mjs ref    test-faces/child-1.jpg
//   node --env-file-if-exists=.env scripts/book.mjs page   test-faces/child-1.jpg cupboard|trade|window
//   node --env-file-if-exists=.env scripts/book.mjs fix    test-faces/child-1.jpg <pageId> "make the beans bigger"
//   node scripts/book.mjs pdf test-faces/child-1.jpg out.pdf "Name" "Age" "Favorite things" "More about me"   (no model call)
//
// Files go to test-results/book/<face>[-TAG]-{reference,<pageId>}.jpg (set TRY_TAG to keep versions apart).

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { generateImage, MODEL } from '../src/image.js';
import { PAGE_BY_ID, PAGES, referencePrompt, pagePrompt, fixPrompt, normalizeAbout } from '../src/book.js';
import { buildBookPdf } from '../src/pdf.js';

const [mode, photoPath, ...rest] = process.argv.slice(2);
const usage = () => {
  console.error('usage: book.mjs ref|page|fix|pdf <photo> ... (see the header of scripts/book.mjs)');
  process.exit(1);
};
if (!mode || !photoPath) usage();

const mimeOf = (p) => ({ '.png': 'image/png', '.webp': 'image/webp' })[extname(p).toLowerCase()] || 'image/jpeg';
const load = async (p) => ({ data: (await readFile(p)).toString('base64'), mimeType: mimeOf(p) });
const face = basename(photoPath, extname(photoPath));
const stem = `test-results/book/${face}${process.env.TRY_TAG ? `-${process.env.TRY_TAG}` : ''}`;
await mkdir('test-results/book', { recursive: true });

async function save(name, image, started) {
  const out = `${stem}-${name}.jpg`;
  await writeFile(out, Buffer.from(image.data, 'base64'));
  console.log(`${MODEL} ${name} -> ${out} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

const started = Date.now();
if (mode === 'ref') {
  await save('reference', await generateImage({ prompt: referencePrompt(), images: [await load(photoPath)], size: '1024x1024' }), started);
} else if (mode === 'page' || mode === 'fix') {
  const pageId = rest[0];
  if (!PAGE_BY_ID[pageId]) usage();
  const reference = await load(`${stem}-reference.jpg`);
  if (mode === 'page') {
    await save(pageId, await generateImage({ prompt: pagePrompt(pageId), images: [reference, await load(photoPath)], size: '1024x1536' }), started);
  } else {
    const instruction = rest[1];
    if (!instruction) usage();
    await copyFile(`${stem}-${pageId}.jpg`, `${stem}-${pageId}-before-fix.jpg`);
    const page = await load(`${stem}-${pageId}.jpg`);
    await save(pageId, await generateImage({ prompt: fixPrompt(pageId, instruction), images: [page, reference], size: '1024x1536' }), started);
  }
} else if (mode === 'pdf') {
  const [out, name, age, favorites, about] = rest;
  if (!out || !name) usage();
  const pages = await Promise.all(PAGES.map(async (p) => ({ ...p, image: await load(`${stem}-${p.id}.jpg`) })));
  const pdf = await buildBookPdf({ pages, reference: await load(`${stem}-reference.jpg`), about: normalizeAbout({ name, age, favorites, about }) });
  await writeFile(out, pdf);
  console.log(`pdf -> ${out} (${(pdf.length / 1024).toFixed(0)} KB, ${PAGES.length + 1} pages)`);
} else {
  usage();
}

await new Promise((r) => setTimeout(r, 250)); // let sockets close before exit (Windows libuv assertion otherwise)
