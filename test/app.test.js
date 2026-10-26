// Offline tests: no API key, no network calls to the image model.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cartoonPrompt, scenePrompt, normalizeSettings, SCENES, DEFAULT_SETTINGS } from '../src/prompts.js';

delete process.env.OPENAI_API_KEY;
const { default: app } = await import('../server.js');

let server, base;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const post = (path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('unknown settings fall back to defaults', () => {
  assert.deepEqual(normalizeSettings({ style: '<script>', palette: 'nope' }), DEFAULT_SETTINGS);
  assert.equal(normalizeSettings({ style: 'comic' }).style, 'comic');
});

test('each scene prompt contains its caption word for word', () => {
  for (const id of Object.keys(SCENES)) {
    assert.ok(scenePrompt(id, {}).includes(SCENES[id].spec), id);
  }
});

test('prompts carry the identity instructions and chosen style', () => {
  const p = cartoonPrompt({ style: 'clay' });
  assert.match(p, /recognizably the same individual/);
  assert.match(p, /claymation/);
});

test('GET /api/options lists both scenes', async () => {
  const body = await (await fetch(base + '/api/options')).json();
  assert.deepEqual(body.scenes.map((s) => s.id), ['plant', 'climb']);
  assert.ok(body.styles.length >= 3);
});

test('rejects a missing photo with 400', async () => {
  const res = await post('/api/cartoon', {});
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /photo/);
});

test('rejects a non-image data URL', async () => {
  const res = await post('/api/cartoon', { photo: 'data:text/html;base64,PGgxPg==' });
  assert.equal(res.status, 400);
});

test('rejects an unknown scene', async () => {
  const res = await post('/api/scene', { sceneId: 'giant', photo: tinyPng, cartoon: tinyPng });
  assert.equal(res.status, 400);
});

test('without a key the server says so instead of crashing', async () => {
  const res = await post('/api/cartoon', { photo: tinyPng });
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /OPENAI_API_KEY/);
});

test('healthz reports the key is missing, never its value', async () => {
  const body = await (await fetch(base + '/healthz')).json();
  assert.equal(body.keyConfigured, false);
});

// --- Picture book ---------------------------------------------------------------
import { PAGES, BOOK_STYLE, pagePrompt, referencePrompt, fixPrompt, normalizeAbout } from '../src/book.js';

test('every book call uses the one style string, word for word', () => {
  for (const p of PAGES) assert.ok(pagePrompt(p.id).includes(BOOK_STYLE), p.id);
  assert.ok(referencePrompt().includes(BOOK_STYLE));
  assert.ok(fixPrompt('trade', 'x').includes(BOOK_STYLE));
});

test('page prompts never ask the model to draw the story text', () => {
  for (const p of PAGES) {
    const prompt = pagePrompt(p.id);
    assert.ok(!prompt.includes(p.text), `${p.id} leaks its text into the prompt`);
    assert.match(prompt, /Do not draw any text/);
  }
});

test('About Me input is trimmed and capped', () => {
  const a = normalizeAbout({ name: '  Maya  ', about: 'x'.repeat(999), extra: 'ignored' });
  assert.equal(a.name, 'Maya');
  assert.equal(a.about.length, 400);
  assert.equal('extra' in a, false);
});

test('GET /api/book lists pages 1-3 with text zones', async () => {
  const body = await (await fetch(base + '/api/book')).json();
  assert.deepEqual(body.pages.map((p) => p.number), [1, 2, 3]);
  assert.ok(body.pages.every((p) => ['top', 'bottom'].includes(p.zone)));
  assert.equal(body.style, BOOK_STYLE);
});

test('POST /api/book/pdf builds a PDF without any model call', async () => {
  const pages = PAGES.map((p) => ({ pageId: p.id, image: tinyPng }));
  const res = await post('/api/book/pdf', { reference: tinyPng, pages, about: { name: 'Maya', age: '9' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
});

test('PDF needs a name and every page', async () => {
  const one = [{ pageId: 'cupboard', image: tinyPng }];
  assert.equal((await post('/api/book/pdf', { reference: tinyPng, pages: one, about: { name: 'Maya' } })).status, 400);
  const all = PAGES.map((p) => ({ pageId: p.id, image: tinyPng }));
  assert.equal((await post('/api/book/pdf', { reference: tinyPng, pages: all, about: {} })).status, 400);
});

test('fix needs an instruction', async () => {
  const res = await post('/api/book/fix', { pageId: 'trade', page: tinyPng, reference: tinyPng, instruction: '' });
  assert.equal(res.status, 400);
});
