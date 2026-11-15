// The character bible and the pre-made scenes. They are drawn once by
// scripts/pregen.mjs, committed under assets/library/, and copied into the database
// when the server starts (only what changed). The app reads them from the database.
//
//   assets/library/<story>/bible/<characterId>.jpg     ('hero' is the stand-in hero)
//   assets/library/<story>/scenes/<pageId>.jpg
//   assets/library/<story>/meta.json                    attempts, scores, boxes, cost
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { query, toBuffer } from './db.js';
import { STORIES } from './book.js';
import { log } from './log.js';

export const LIBRARY_DIR = fileURLToPath(new URL('../assets/library/', import.meta.url));
export const makeThumb = (buffer, width = 400) => sharp(buffer).resize({ width, withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();

const sha = (buf) => createHash('sha1').update(buf).digest('hex');
const list = async (dir) => { try { return await readdir(dir); } catch { return []; } };

async function readMeta(story) {
  try { return JSON.parse(await readFile(`${LIBRARY_DIR}${story}/meta.json`, 'utf8')); } catch { return { characters: {}, scenes: {} }; }
}

// Copies new or changed library pictures into the database.
export async function seedLibrary() {
  let changed = 0;
  for (const story of Object.values(STORIES)) {
    const meta = await readMeta(story.id);
    const have = {
      characters: Object.fromEntries((await query('select id, hash from characters where story = $1', [story.id])).map((r) => [r.id, r.hash])),
      scenes: Object.fromEntries((await query('select page, hash from scenes where story = $1', [story.id])).map((r) => [r.page, r.hash])),
    };
    for (const file of await list(`${LIBRARY_DIR}${story.id}/bible`)) {
      const id = file.replace(/\.jpg$/, '');
      const c = id === 'hero' ? { name: `${story.heroRole} (stand-in)`, description: `The stand-in hero. Every book replaces this child with the child in the photo. ${story.heroOutfit}` } : story.characterById[id];
      if (!c || !file.endsWith('.jpg')) continue;
      const data = await readFile(`${LIBRARY_DIR}${story.id}/bible/${file}`);
      const hash = sha(data);
      if (have.characters[id] === hash) continue;
      await query(
        `insert into characters (story, id, name, description, data, mime, thumb, hash, meta) values ($1,$2,$3,$4,$5,'image/jpeg',$6,$7,$8)
         on conflict (story, id) do update set name = $3, description = $4, data = $5, thumb = $6, hash = $7, meta = $8, updated_at = now()`,
        [story.id, id, c.name, c.description, data, await makeThumb(data, 320), hash, JSON.stringify(meta.characters?.[id] || null)],
      );
      changed++;
    }
    for (const file of await list(`${LIBRARY_DIR}${story.id}/scenes`)) {
      const page = file.replace(/\.jpg$/, '');
      if (!story.pageById[page] || !file.endsWith('.jpg')) continue;
      const data = await readFile(`${LIBRARY_DIR}${story.id}/scenes/${file}`);
      const hash = sha(data) + sha(JSON.stringify(meta.scenes?.[page] || null)).slice(0, 8);
      if (have.scenes[page] === hash) continue;
      await query(
        `insert into scenes (story, page, data, mime, thumb, hash, meta) values ($1,$2,$3,'image/jpeg',$4,$5,$6)
         on conflict (story, page) do update set data = $3, thumb = $4, hash = $5, meta = $6, updated_at = now()`,
        [story.id, page, data, await makeThumb(data), hash, JSON.stringify(meta.scenes?.[page] || null)],
      );
      changed++;
    }
  }
  cache.clear();
  if (changed) log.info({ changed }, 'library: copied new pictures into the database');
  return changed;
}

// Scenes and bible pictures are read on every book, so they are kept in memory after the first read.
const cache = new Map();
async function cached(key, load) {
  if (!cache.has(key)) cache.set(key, await load());
  return cache.get(key);
}

// { buffer, mimeType, thumb, meta } or null if the scene has not been pre-made.
export const getScene = (story, page) => cached(`s:${story}:${page}`, async () => {
  const [r] = await query('select data, mime, thumb, meta from scenes where story = $1 and page = $2', [story, page]);
  return r ? { buffer: toBuffer(r.data), mimeType: r.mime, thumb: toBuffer(r.thumb), meta: r.meta || {} } : null;
});

export const getCharacter = (story, id) => cached(`c:${story}:${id}`, async () => {
  const [r] = await query('select data, mime, thumb, meta from characters where story = $1 and id = $2', [story, id]);
  return r ? { buffer: toBuffer(r.data), mimeType: r.mime, thumb: toBuffer(r.thumb), meta: r.meta || {} } : null;
});

// What exists, for the story picker and the character bible page (no image bytes).
export async function libraryIndex() {
  const [chars, scenes] = await Promise.all([
    query('select story, id, name, description, hash, meta from characters order by story, id'),
    query('select story, page, hash, meta from scenes order by story, page'),
  ]);
  return { chars, scenes };
}

// What the one-time pre-generation cost, read from the meta files.
export async function libraryCost() {
  let total = 0;
  for (const id of Object.keys(STORIES)) {
    const meta = await readMeta(id);
    for (const group of [meta.characters, meta.scenes]) for (const m of Object.values(group || {})) total += Number(m?.costUsd || 0);
  }
  return Math.round(total * 1e4) / 1e4;
}
