// Draws the character bible and the 20 template scenes of each story, once, and saves
// them under assets/library/. The server copies them into the database when it starts.
// Every picture goes through the same quality loop as a book page: draw, check, redraw
// on failure (3 drawings at most), keep the best.
//
//   node --env-file-if-exists=.env scripts/pregen.mjs bible            both stories' characters
//   node --env-file-if-exists=.env scripts/pregen.mjs scenes jack      one story's 20 scenes
//   node --env-file-if-exists=.env scripts/pregen.mjs scenes red p03 p07   only those pages
//   add --force to redraw pictures that already exist, --dry to list what would be drawn
//
// Costs real API money (about 1-2 cents a picture at low quality). Existing files are skipped.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import sharp from 'sharp';
import { generateImage, MODEL } from '../src/image.js';
import { analyzeImage } from '../src/analyze.js';
import { drawWithQuality } from '../src/quality.js';
import { layoutFor } from '../src/layout.js';
import { STORIES, characterPrompt, standInPrompt, scenePrompt, pageText } from '../src/book.js';
import { LIBRARY_DIR } from '../src/library.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [mode, ...rest] = args.filter((a) => !a.startsWith('--'));
const storyIds = rest.filter((a) => STORIES[a]);
const only = rest.filter((a) => /^p\d\d$/.test(a) || !STORIES[a]);
const stories = (storyIds.length ? storyIds : Object.keys(STORIES)).map((id) => STORIES[id]);
const PARALLEL = 5;
if (!['bible', 'scenes', 'recheck'].includes(mode)) {
  console.error('usage: pregen.mjs bible|scenes [jack|red] [p01 ...] [--force] [--dry]');
  process.exit(1);
}

const exists = (p) => access(p).then(() => true, () => false);
const b64 = (buffer) => ({ data: buffer.toString('base64'), mimeType: 'image/jpeg' });
// Bible pictures are sent to the model at 768 px: enough to copy a character, fewer input tokens.
const small = async (path) => b64(await sharp(await readFile(path)).resize({ width: 768 }).jpeg({ quality: 88 }).toBuffer());

async function loadMeta(story) {
  try { return JSON.parse(await readFile(`${LIBRARY_DIR}${story.id}/meta.json`, 'utf8')); } catch { return { characters: {}, scenes: {} }; }
}
// One write at a time: pictures finish in parallel and would otherwise overwrite each other's bytes.
let writing = Promise.resolve();
const saveMeta = (story, meta) => (writing = writing.then(() => writeFile(`${LIBRARY_DIR}${story.id}/meta.json`, JSON.stringify(meta, null, 1))));

let spent = 0;
async function draw({ label, out, make, check }) {
  let cost = 0;
  const t0 = Date.now();
  const r = await drawWithQuality({ make, check, onCall: (c) => { cost += c.costUsd || 0; } });
  await writeFile(out, Buffer.from(r.image.data, 'base64'));
  spent += cost;
  console.log(`${label}: ${r.passed ? 'passed' : 'BEST OF ' + r.attempts} on drawing ${r.chosen} of ${r.attempts}, score ${r.analysis.score}, $${cost.toFixed(4)}, ${((Date.now() - t0) / 1000).toFixed(0)}s${r.passed ? '' : ' — ' + r.analysis.issues.join('; ')}`);
  return { attempts: r.attempts, chosen: r.chosen, score: r.analysis.score, passed: r.passed, summary: r.analysis.summary, history: r.history, costUsd: Math.round(cost * 1e6) / 1e6, model: MODEL, r };
}

async function inBatches(jobs) {
  for (let i = 0; i < jobs.length; i += PARALLEL) {
    const results = await Promise.allSettled(jobs.slice(i, i + PARALLEL).map((j) => j()));
    for (const res of results) if (res.status === 'rejected') console.error('FAILED:', res.reason?.message || res.reason);
  }
}

for (const story of stories) {
  const dir = `${LIBRARY_DIR}${story.id}`;
  await mkdir(`${dir}/bible`, { recursive: true });
  await mkdir(`${dir}/scenes`, { recursive: true });
  const meta = await loadMeta(story);
  meta.characters ??= {}; meta.scenes ??= {};
  const jobs = [];

  if (mode === 'bible') {
    const all = [{ id: 'hero', name: `${story.heroRole} (stand-in)`, description: `the stand-in hero child. ${story.heroOutfit}`, prompt: standInPrompt(story) },
      ...story.characters.map((c) => ({ ...c, prompt: characterPrompt(story, c) }))];
    for (const c of all) {
      const out = `${dir}/bible/${c.id}.jpg`;
      if (only.length && !only.includes(c.id)) continue;
      if (!flags.has('--force') && (await exists(out))) continue;
      if (flags.has('--dry')) { console.log('would draw', story.id, c.id); continue; }
      jobs.push(async () => {
        const { r, ...m } = await draw({
          label: `${story.id} bible ${c.id}`, out,
          make: (_n, feedback) => generateImage({ prompt: c.prompt + (feedback ? `\nAn earlier attempt was rejected. Fix these problems: ${feedback}` : ''), size: '1024x1024' }),
          check: (img, attempt) => analyzeImage({ image: Buffer.from(img.data, 'base64'), kind: c.id === 'hero' ? 'reference' : 'character', description: `${c.name}: ${c.description}`, attempt }),
        });
        meta.characters[c.id] = m;
        await saveMeta(story, meta);
      });
    }
  } else if (mode === 'recheck') {
    // Runs only the picture check and the text layout again on scenes that already exist (no drawing).
    for (const page of [story.cover, ...story.pages]) {
      const out = `${dir}/scenes/${page.id}.jpg`;
      if ((only.length && !only.includes(page.id)) || !(await exists(out)) || !meta.scenes[page.id]) continue;
      jobs.push(async () => {
        const buffer = await readFile(out);
        const a = await analyzeImage({ image: buffer, kind: 'scene', description: page.scene, hasHero: page.hero });
        spent += a.costUsd;
        const layout = await layoutFor({ buffer, analysis: a, preferred: page.zone, text: pageText(page, 'Maximilian', story) });
        const m = meta.scenes[page.id];
        Object.assign(m, { score: a.score, passed: a.ok, summary: a.summary, zone: layout.zone, costUsd: Math.round((m.costUsd + a.costUsd) * 1e6) / 1e6,
          analysis: { faces: a.faces, objects: a.objects, clear: a.clear, summary: a.summary, likeness: a.likeness, sceneMatch: a.sceneMatch } });
        console.log(`${story.id} ${page.id}: ${a.ok ? 'passes' : 'FAILS: ' + a.issues.join('; ')}, score ${a.score}, text ${layout.zone} (template: ${page.zone})`);
        await saveMeta(story, meta);
      });
    }
  } else {
    for (const page of [story.cover, ...story.pages]) {
      const out = `${dir}/scenes/${page.id}.jpg`;
      if (only.length && !only.includes(page.id)) continue;
      if (!flags.has('--force') && (await exists(out))) continue;
      if (flags.has('--dry')) { console.log('would draw', story.id, page.id, page.title); continue; }
      jobs.push(async () => {
        const inputs = [...(page.hero ? ['hero'] : []), ...page.cast];
        const images = await Promise.all(inputs.map((id) => small(`${dir}/bible/${id}.jpg`)));
        const { r, ...m } = await draw({
          label: `${story.id} ${page.id} ${page.title}`, out,
          make: (_n, feedback) => generateImage({ prompt: scenePrompt(story, page, feedback), images, size: '1024x1536' }),
          check: (img, attempt) => analyzeImage({ image: Buffer.from(img.data, 'base64'), kind: 'scene', description: page.scene, hasHero: page.hero, attempt }),
        });
        const a = r.analysis;
        const layout = await layoutFor({ buffer: Buffer.from(r.image.data, 'base64'), analysis: a, preferred: page.zone, text: pageText(page, 'Maximilian', story) });
        meta.scenes[page.id] = { ...m, zone: layout.zone, analysis: { faces: a.faces, objects: a.objects, clear: a.clear, summary: a.summary, likeness: a.likeness, sceneMatch: a.sceneMatch } };
        await saveMeta(story, meta);
      });
    }
  }
  await inBatches(jobs);
}
console.log(`done. spent $${spent.toFixed(4)} on ${MODEL}`);
await new Promise((r) => setTimeout(r, 250)); // let sockets close before exit (Windows libuv assertion otherwise)
