// Makes one real book end to end, the way the site does, and saves the PDF: a timed
// test of the whole pipeline with a photo of your choice. Uses real image calls (about
// 21 pictures), an in-memory database and the simulated checkout, so nothing on the
// live site or in Stripe is touched.
//
//   node --env-file-if-exists=.env scripts/make-book.mjs test-faces/child-1.jpg jack "Theo" samples/Theo-Jack.pdf
//   node --env-file-if-exists=.env scripts/make-book.mjs test-faces/child-2.jpg red  "Maya" samples/Maya-Red.pdf
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import sharp from 'sharp';

const [photoPath, story = 'jack', name = 'Theo', out = `test-results/${name}-${story}.pdf`] = process.argv.slice(2);
if (!photoPath) { console.error('usage: make-book.mjs <photo> [jack|red] [name] [out.pdf]'); process.exit(1); }

process.env.DATABASE_URL = '';
process.env.STRIPE_SECRET_KEY = '';
process.env.DEV_LOGIN = '1';
process.env.LOG_LEVEL ??= 'warn';
delete process.env.IMAGE_PROVIDER;

const { default: app } = await import('../server.js');
const { seedLibrary } = await import('../src/library.js');
await seedLibrary();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://localhost:${server.address().port}`;

let cookie = '';
const call = (method, path, body) => fetch(base + path, { method, redirect: 'manual', headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
cookie = (await call('GET', '/auth/dev-login')).headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const { url } = await (await call('POST', '/api/billing/checkout', { amountCents: 500 })).json();
await call('GET', url);

const jpeg = await sharp(await readFile(photoPath)).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
const t0 = Date.now();
const res = await call('POST', '/api/books', { photo: `data:image/jpeg;base64,${jpeg.toString('base64')}`, story, about: { name, age: '6', favorites: 'Climbing trees, pancakes and bedtime stories' } });
if (res.status !== 201) { console.error('could not start:', await res.text()); process.exit(1); }
let { book } = await res.json();
let lastStage = '';
const firstThumb = {};
while (book.busy) {
  await new Promise((r) => setTimeout(r, 1000));
  ({ book } = await (await call('GET', `/api/books/${book.id}`)).json());
  const t = ((Date.now() - t0) / 1000).toFixed(0);
  for (const s of book.slots) if (s.thumbUrl && !firstThumb[s.id]) firstThumb[s.id] = t;
  if (book.stage.label !== lastStage) { lastStage = book.stage.label; console.log(`${t.padStart(3)}s  ${lastStage}`); }
}
const pdfRes = await call('GET', `/api/books/${book.id}/pdf`);
const total = ((Date.now() - t0) / 1000).toFixed(1);
if (pdfRes.status !== 200) { console.error('no pdf:', await pdfRes.text()); }
else { await mkdir(dirname(out), { recursive: true }); await writeFile(out, Buffer.from(await pdfRes.arrayBuffer())); }

console.log(`\nphoto to PDF in ${total}s (server says ${(book.madeInMs / 1000).toFixed(1)}s)  ->  ${out}`);
for (const s of book.slots) {
  const last = s.history.at(-1) || {};
  console.log(`${s.id.padEnd(9)} ${s.status.padEnd(5)} thumb at ${String(firstThumb[s.id] ?? '-').padStart(3)}s  ${s.attempts} of ${s.maxAttempts} attempts, kept ${s.chosen}, score ${s.score ?? '-'}, ${s.passed ? 'passed' : 'BEST-OF'}  text: ${s.zone ?? '-'}/${s.tone ?? '-'}  ${s.source === 'template' ? '(template)' : ''}${s.passed ? '' : ' ' + (s.error || (last.issues || []).join('; '))}`);
}
const c = book.cost;
console.log(`\ncost $${c.totalUsd.toFixed(4)}: ${c.drawings} first drawings $${c.firstDrawingsUsd.toFixed(4)}, ${c.retries} redraws $${c.retriesUsd.toFixed(4)}, ${c.checks} checks $${c.checksUsd.toFixed(4)}  (price $0.99)`);

// A contact sheet of the finished pages, to look the book over in one picture.
const dir = out.replace(extname(out), '');
await mkdir(dir, { recursive: true });
const tiles = [];
for (const s of book.slots) {
  if (!s.imageUrl) continue;
  const buf = Buffer.from(await (await call('GET', s.imageUrl)).arrayBuffer());
  await writeFile(`${dir}/${s.id}.jpg`, buf);
  if (s.id !== 'reference') tiles.push(await sharp(buf).resize(256, 384).toBuffer());
}
if (tiles.length) {
  const cols = 5, rows = Math.ceil(tiles.length / cols);
  await sharp({ create: { width: cols * 256, height: rows * 384, channels: 3, background: '#fff' } })
    .composite(tiles.map((input, i) => ({ input, left: (i % cols) * 256, top: Math.floor(i / cols) * 384 })))
    .jpeg({ quality: 80 }).toFile(`${dir}/sheet.jpg`);
  console.log(`contact sheet -> ${dir}/sheet.jpg`);
}
server.close();
await new Promise((r) => setTimeout(r, 300));
process.exit(0);
