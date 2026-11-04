// Offline tests: no API key, no network calls to the image model.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cartoonPrompt, scenePrompt, normalizeSettings, SCENES, DEFAULT_SETTINGS } from '../src/prompts.js';

delete process.env.OPENAI_API_KEY;
delete process.env.DATABASE_URL; // in-memory PGlite
delete process.env.GOOGLE_CLIENT_ID;
Object.assign(process.env, { NODE_ENV: 'test', DEV_LOGIN: '1', MOCK_MIN_MS: '40', MOCK_MAX_MS: '120' });
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

// --- Picture book: prompts ----------------------------------------------------------
import { PAGES, BOOK_STYLE, SLOTS, pagePrompt, referencePrompt, castPrompt, fixPrompt, normalizeAbout, pageText } from '../src/book.js';
import { expandSlots } from '../src/jobs.js';

test('every book call uses the one style string, word for word', () => {
  for (const p of PAGES) assert.ok(pagePrompt(p.id).includes(BOOK_STYLE), p.id);
  assert.ok(referencePrompt().includes(BOOK_STYLE));
  assert.ok(castPrompt().includes(BOOK_STYLE));
  assert.ok(fixPrompt('trade', 'x').includes(BOOK_STYLE));
});

test('page prompts never ask the model to draw the story text', () => {
  for (const p of PAGES) {
    const prompt = pagePrompt(p.id);
    assert.ok(!prompt.includes(p.text), `${p.id} leaks its text into the prompt`);
    assert.match(prompt, /Do not draw any text/);
  }
});

test('pages are built on the reference and the cast sheet, not on each other', () => {
  for (const p of PAGES) assert.match(pagePrompt(p.id), /Image 1 is the character reference.*Image 2 is the cast sheet/s);
  assert.match(castPrompt(), /Do NOT draw the child/);
});

test('redrawing Jack or the cast redraws every page too', () => {
  assert.deepEqual(expandSlots(['reference']), ['reference', ...PAGES.map((p) => p.id)]);
  assert.deepEqual(expandSlots(['trade', 'nope']), ['trade']);
});

test('About Me input is trimmed and capped', () => {
  const a = normalizeAbout({ name: '  Maya  ', about: 'x'.repeat(999), extra: 'ignored' });
  assert.equal(a.name, 'Maya');
  assert.equal(a.about.length, 400);
  assert.equal('extra' in a, false);
});

test('page text uses the child\'s name, and Jack until there is one', () => {
  assert.match(pageText(PAGES[0], 'Theo'), /Theo/);
  assert.match(pageText(PAGES[0], '  '), /Jack/);
  for (const p of PAGES) assert.doesNotMatch(pageText(p, 'Ari'), /\{name\}/, p.id);
});

test('GET /api/book lists pages 1-4 with text zones and every picture', async () => {
  const body = await (await fetch(base + '/api/book')).json();
  assert.deepEqual(body.pages.map((p) => p.number), [1, 2, 3, 4]);
  assert.ok(body.pages.every((p) => ['top', 'bottom'].includes(p.zone)));
  assert.equal(body.style, BOOK_STYLE);
  assert.deepEqual(body.slots.map((s) => s.id), SLOTS.map((s) => s.id));
});

// --- Picture book: signed-in flow (mock images, in-memory database) ----------------
let cookie = '';
const call = (method, path, body) =>
  fetch(base + path, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
async function settle(id) {
  for (let i = 0; i < 100; i++) {
    const { book } = await (await call('GET', `/api/books/${id}`)).json();
    if (!book.busy) return book;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('book never finished');
}

test('book endpoints need sign-in', async () => {
  assert.equal((await fetch(base + '/api/books')).status, 401);
  assert.equal((await post('/api/books', { photo: tinyPng })).status, 401);
  const me = await (await fetch(base + '/api/me')).json();
  assert.equal(me.user, null);
});

test('dev sign-in sets a session cookie', async () => {
  const res = await call('GET', '/auth/dev-login');
  assert.equal(res.status, 302);
  cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const me = await (await call('GET', '/api/me')).json();
  assert.equal(me.user.name, 'Dev Tester');
});

let bookId;
test('a new book draws Jack and the cast together, then all pages together', async () => {
  process.env.IMAGE_PROVIDER = 'mock';
  try {
    const res = await call('POST', '/api/books', { photo: tinyPng });
    assert.equal(res.status, 201);
    const { book } = await res.json();
    bookId = book.id;
    assert.equal(book.busy, true);
    assert.equal(book.slots.length, SLOTS.length);

    const done = await settle(bookId);
    const at = Object.fromEntries(done.slots.map((s) => [s.id, s]));
    assert.ok(done.slots.every((s) => s.status === 'done' && s.imageUrl), JSON.stringify(done.slots));
    const firstDone = Math.max(at.reference.finishedAt, at.cast.finishedAt);
    const pages = PAGES.map((p) => at[p.id]);
    assert.ok(pages.every((p) => p.startedAt >= firstDone - 5), 'pages start after Jack and the cast');
    assert.ok(Math.max(...pages.map((p) => p.startedAt)) < Math.min(...pages.map((p) => p.finishedAt)), 'pages run at the same time');
    assert.ok(Math.abs(at.reference.startedAt - at.cast.startedAt) < 40, 'Jack and the cast start together');
  } finally {
    delete process.env.IMAGE_PROVIDER;
  }
});

test('the book is listed and its pictures are served to the owner only', async () => {
  const { books } = await (await call('GET', '/api/books')).json();
  assert.equal(books[0].id, bookId);
  assert.equal(books[0].done, SLOTS.length);
  const img = await call('GET', books[0].thumbUrl);
  assert.equal(img.status, 200);
  assert.equal((await fetch(base + books[0].thumbUrl)).status, 401);
  assert.equal((await call('GET', '/api/books/00000000-0000-0000-0000-000000000000')).status, 404);
});

test('the PDF needs a name, then builds without any model call', async () => {
  assert.equal((await call('GET', `/api/books/${bookId}/pdf`)).status, 400);
  const { book } = await (await call('PATCH', `/api/books/${bookId}`, { about: { name: 'Maya', age: '9' } })).json();
  assert.equal(book.pdfReady, true);
  const res = await call('GET', `/api/books/${bookId}/pdf`);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /Maya-JackAndTheBeanstalk\.pdf/);
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
});

test('fix keeps the old page for undo', async () => {
  assert.equal((await call('POST', `/api/books/${bookId}/fix`, { pageId: 'trade', instruction: '' })).status, 400);
  process.env.IMAGE_PROVIDER = 'mock';
  try {
    assert.equal((await call('POST', `/api/books/${bookId}/fix`, { pageId: 'trade', instruction: 'brighter beans' })).status, 202);
    const book = await settle(bookId);
    assert.equal(book.slots.find((s) => s.id === 'trade').canUndo, true);
    const after = (await (await call('POST', `/api/books/${bookId}/undo`, { pageId: 'trade' })).json()).book;
    assert.equal(after.slots.find((s) => s.id === 'trade').canUndo, false);
  } finally {
    delete process.env.IMAGE_PROVIDER;
  }
});

test('a failed picture is marked failed with the reason, not retried', async () => {
  // No key and no mock: the call fails, and the page shows why.
  assert.equal((await call('POST', `/api/books/${bookId}/generate`, { slots: ['window'] })).status, 202);
  const book = await settle(bookId);
  const page = book.slots.find((s) => s.id === 'window');
  assert.equal(page.status, 'done', 'the old picture stays');
  assert.match(page.error, /OPENAI_API_KEY/);
});

test('deleting a book removes it', async () => {
  assert.equal((await call('DELETE', `/api/books/${bookId}`)).status, 204);
  assert.equal((await call('GET', `/api/books/${bookId}`)).status, 404);
});
