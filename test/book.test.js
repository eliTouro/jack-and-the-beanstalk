// Offline tests for the 20-page book, the quality loop, the text layout and the money.
// No API key, no Stripe key, no network: mock images, mock checks, mock checkout.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.OPENAI_API_KEY;
delete process.env.DATABASE_URL; // in-memory PGlite
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.STRIPE_SECRET_KEY; // mock checkout
Object.assign(process.env, { NODE_ENV: 'test', DEV_LOGIN: '1', IMAGE_PROVIDER: 'mock', MOCK_MIN_MS: '20', MOCK_MAX_MS: '60', MOCK_CHECK_MS: '5', MOCK_FAIL: 'p03=1,p05=3' });

const { default: app } = await import('../server.js');
const { STORIES, BOOK_STYLE, SLOTS, pagePrompt, scenePrompt, referencePrompt, characterPrompt, fixPrompt, normalizeAbout, pageText } = await import('../src/book.js');
const { TEMPLATE } = await import('../src/template.js');
const { expandSlots } = await import('../src/jobs.js');
const { drawWithQuality } = await import('../src/quality.js');
const { chooseLayout, zoneIsClear, textFraction, bandRect } = await import('../src/layout.js');
const { grade } = await import('../src/analyze.js');
const { imageCost, chatCost } = await import('../src/cost.js');

let server, base;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// --- The template and the two stories ------------------------------------------------
test('one 20-page template serves both stories', () => {
  assert.equal(TEMPLATE.length, 20);
  for (const story of Object.values(STORIES)) {
    assert.equal(story.pages.length, 20, story.id);
    story.pages.forEach((p, i) => {
      assert.equal(p.zone, TEMPLATE[i].zone, `${story.id} ${p.id} takes its text zone from the template`);
      assert.equal(p.id, TEMPLATE[i].id);
    });
  }
  assert.deepEqual(Object.keys(STORIES), ['jack', 'red']);
  assert.equal(SLOTS.length, 21);
});

test('story text is short enough to fit, names the child, and never genders the hero', () => {
  for (const story of Object.values(STORIES)) {
    for (const p of story.pages) {
      assert.ok(p.text.length <= 165, `${story.id} ${p.id} is ${p.text.length} characters`);
      assert.doesNotMatch(pageText(p, 'Ari', story), /\{name\}/);
      assert.ok(textFraction(pageText(p, 'Maximilian', story)) <= 0.34);
    }
    assert.ok(story.pages.filter((p) => p.text.includes('{name}')).length >= 14, story.id);
    assert.ok(story.pages.filter((p) => p.hero).length >= 17, story.id);
  }
});

test('every prompt uses the one style string and forbids drawn text', () => {
  for (const story of Object.values(STORIES)) {
    for (const p of story.pages) {
      for (const prompt of [pagePrompt(story, p), scenePrompt(story, p), fixPrompt(story, p, 'x')]) {
        assert.ok(prompt.includes(BOOK_STYLE), `${story.id} ${p.id}`);
        assert.match(prompt, /Do not draw any text/);
        assert.ok(!prompt.includes(p.text), `${story.id} ${p.id} leaks its text into the prompt`);
        assert.ok(prompt.includes(p.keepClear), 'the template clear zone is in the prompt');
      }
    }
    assert.ok(referencePrompt(story).includes(BOOK_STYLE));
    for (const c of story.characters) assert.ok(characterPrompt(story, c).includes(c.description));
  }
});

test('redrawing the hero redraws the pages the hero is on', () => {
  const red = STORIES.red;
  const heroPages = red.pages.filter((p) => p.hero).map((p) => p.id);
  assert.deepEqual(expandSlots(['reference'], red), ['reference', ...heroPages]);
  assert.deepEqual(expandSlots(['p02', 'nope'], red), ['p02']);
});

test('About Me input is trimmed and capped', () => {
  const a = normalizeAbout({ name: '  Maya  ', about: 'x'.repeat(999), extra: 'ignored' });
  assert.equal(a.name, 'Maya');
  assert.equal(a.about.length, 400);
  assert.equal('extra' in a, false);
});

// --- The quality loop ------------------------------------------------------------------
const fakeImage = (n) => ({ data: `img${n}`, mimeType: 'image/jpeg', model: 'm', usage: null, costUsd: 0.01, ms: 1 });
const fakeCheck = (scores) => async (_img, attempt) => ({ ok: scores[attempt - 1] >= 70, score: scores[attempt - 1], issues: ['too dark'], costUsd: 0.001, ms: 1 });

test('quality loop: a picture that passes is drawn once', async () => {
  const r = await drawWithQuality({ make: async (n) => fakeImage(n), check: fakeCheck([90]) });
  assert.equal(r.attempts, 1);
  assert.equal(r.passed, true);
});

test('quality loop: a failure is redrawn with the reason, and stops as soon as one passes', async () => {
  const feedback = [];
  const r = await drawWithQuality({ make: async (n, fb) => { feedback.push(fb); return fakeImage(n); }, check: fakeCheck([40, 85, 99]) });
  assert.equal(r.attempts, 2);
  assert.equal(r.chosen, 2);
  assert.deepEqual(feedback, ['', 'too dark']);
});

test('quality loop: never more than 3 drawings, and the best of the three is kept', async () => {
  const calls = [];
  const r = await drawWithQuality({ make: async (n) => fakeImage(n), check: fakeCheck([55, 62, 48]), onCall: (c) => calls.push(c.kind) });
  assert.equal(r.attempts, 3);
  assert.equal(r.chosen, 2, 'attempt 2 scored highest');
  assert.equal(r.image.data, 'img2');
  assert.equal(r.passed, false);
  assert.equal(r.history.length, 3);
  assert.deepEqual(calls, ['image', 'analysis', 'image', 'analysis', 'image', 'analysis'], 'every drawing and every check is reported for the cost log');
});

test('quality loop: after the deadline no new drawing starts', async () => {
  const r = await drawWithQuality({ make: async (n) => fakeImage(n), check: fakeCheck([10, 90]), deadlineAt: Date.now() - 1 });
  assert.equal(r.attempts, 1);
  assert.equal(r.passed, false);
});

test('the picture check fails a page for the wrong child, drawn text, or no room for text', () => {
  const good = { hero_count: 1, hero_face_visible: true, likeness: 8, scene_match: 8, has_text: false, defects: [], faces: [], objects: [], top_clear: true, middle_clear: false, bottom_clear: true, summary: '' };
  assert.equal(grade(good, { kind: 'page', hasHero: true }).ok, true);
  assert.equal(grade({ ...good, likeness: 3 }, { kind: 'page', hasHero: true }).ok, false);
  assert.equal(grade({ ...good, has_text: true }, { kind: 'page', hasHero: true }).ok, false);
  assert.equal(grade({ ...good, hero_count: 2 }, { kind: 'page', hasHero: true }).ok, false);
  assert.equal(grade({ ...good, top_clear: false, bottom_clear: false }, { kind: 'page', hasHero: true }).ok, false);
  assert.equal(grade({ ...good, hero_count: 0, likeness: 0 }, { kind: 'scene', hasHero: false }).ok, true, 'a page without the hero is not failed for it');
  assert.ok(grade(good, { kind: 'page', hasHero: true }).score > grade({ ...good, likeness: 5 }, { kind: 'page', hasHero: true }).score);
});

// --- Text never hides the story ----------------------------------------------------------
const face = (y0, y1) => ({ label: 'face', x0: 0.4, y0, x1: 0.6, y1 });
const allClear = { top: true, middle: true, bottom: true };

test('layout: the text never goes over a face', () => {
  const frac = 0.25;
  const analysis = { clear: allClear, faces: [face(0.05, 0.2)], objects: [] };
  assert.equal(zoneIsClear('top', frac, analysis), false);
  assert.equal(zoneIsClear('bottom', frac, analysis), true);
  // The template wanted the top, but a face is there: the text moves.
  const moved = chooseLayout({ analysis, preferred: 'top', frac, stats: { bottom: { busy: 0.1, brightness: 0.2 }, middle: { busy: 0.3, brightness: 0.5 } } });
  assert.equal(moved.zone, 'bottom');
  assert.equal(moved.moved, true);
});

test('layout: it uses the middle when top and bottom are both taken', () => {
  const analysis = { clear: allClear, faces: [face(0.04, 0.18), face(0.8, 0.95)], objects: [] };
  assert.equal(chooseLayout({ analysis, preferred: 'bottom', frac: 0.22, stats: {} }).zone, 'middle');
});

test('layout: with no clear band the text goes under the art, not on it', () => {
  const analysis = { clear: allClear, faces: [face(0.05, 0.2), face(0.42, 0.58), face(0.8, 0.95)], objects: [] };
  const l = chooseLayout({ analysis, preferred: 'bottom', frac: 0.22, stats: {} });
  assert.equal(l.zone, 'below');
});

test('layout: an important object blocks a band, and so does the checker saying "not clear"', () => {
  const beans = { label: 'beans', x0: 0.3, y0: 0.82, x1: 0.5, y1: 0.92 };
  assert.equal(zoneIsClear('bottom', 0.25, { clear: allClear, faces: [], objects: [beans] }), false);
  assert.equal(zoneIsClear('bottom', 0.25, { clear: { ...allClear, bottom: false }, faces: [], objects: [] }), false);
});

test('layout: the text colour follows the picture (dark text on a bright band, white on a dark one)', () => {
  const analysis = { clear: allClear, faces: [], objects: [] };
  assert.equal(chooseLayout({ analysis, preferred: 'top', frac: 0.2, stats: { top: { brightness: 0.85, busy: 0.1 } } }).tone, 'dark');
  assert.equal(chooseLayout({ analysis, preferred: 'top', frac: 0.2, stats: { top: { brightness: 0.2, busy: 0.1 } } }).tone, 'light');
  const band = bandRect('bottom', 0.2);
  assert.ok(band.y1 < 1 && band.y0 > 0.7);
});

// --- Cost maths ------------------------------------------------------------------------
test('cost comes from the token counts the API reports', () => {
  const usage = { input_tokens: 1300, output_tokens: 400, input_tokens_details: { text_tokens: 300, image_tokens: 1000 } };
  // gpt-image-2.5-flare: $5 text in, $8 image in, $30 image out, per million tokens.
  assert.equal(imageCost('gpt-image-2.5-flare', usage), (300 * 5 + 1000 * 8 + 400 * 30) / 1e6);
  assert.equal(chatCost('gpt-4.1-mini', { prompt_tokens: 1000, completion_tokens: 100 }), (1000 * 0.4 + 100 * 1.6) / 1e6);
  assert.equal(imageCost('gpt-image-2.5-flare', null), 0);
});

// --- Signed-in flow --------------------------------------------------------------------
let cookie = '';
const call = (method, path, body) =>
  fetch(base + path, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
const json = async (method, path, body) => (await call(method, path, body)).json();
async function settle(id) {
  for (let i = 0; i < 200; i++) {
    const { book } = await json('GET', `/api/books/${id}`);
    if (!book.busy) return book;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('book never finished');
}

test('book and account endpoints need sign-in', async () => {
  assert.equal((await fetch(base + '/api/books')).status, 401);
  assert.equal((await fetch(base + '/api/account')).status, 401);
  assert.equal((await fetch(base + '/api/billing/checkout', { method: 'POST' })).status, 401);
});

test('dev sign-in sets a session cookie; a new account has a zero balance', async () => {
  const res = await call('GET', '/auth/dev-login');
  assert.equal(res.status, 302);
  cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const me = await json('GET', '/api/me');
  assert.equal(me.user.name, 'Dev Tester');
  assert.equal(me.user.balanceCents, 0);
  assert.equal(me.priceCents, 99);
});

test('GET /api/stories lists both stories on the same 20 template pages', async () => {
  const body = await (await fetch(base + '/api/stories')).json();
  assert.deepEqual(body.stories.map((s) => s.id), ['jack', 'red']);
  for (const s of body.stories) assert.deepEqual(s.pages.map((p) => p.zone), TEMPLATE.map((t) => t.zone));
  assert.equal(body.maxAttempts, 3);
});

test('a book cannot be made without money', async () => {
  const res = await call('POST', '/api/books', { photo: tinyPng, story: 'jack', about: { name: 'Maya' } });
  assert.equal(res.status, 402);
  assert.match((await res.json()).error, /\$0\.99/);
});

let paymentId;
test('funding: checkout credits the account exactly once', async () => {
  assert.equal((await call('POST', '/api/billing/checkout', { amountCents: 5 })).status, 400);
  assert.equal((await call('POST', '/api/billing/checkout', { amountCents: 99 * 51 })).status, 400);
  assert.equal((await call('POST', '/api/billing/checkout', { amountCents: 99 })).status, 200, 'one book can be bought on its own');
  const { url } = await json('POST', '/api/billing/checkout', { amountCents: 500 });
  assert.match(url, /mock-pay/);
  const back = await call('GET', url);
  assert.equal(back.status, 302);
  assert.match(back.headers.get('location'), /funding=paid/);
  await call('GET', url); // a replayed redirect must not credit twice
  const acct = await json('GET', '/api/account');
  assert.equal(acct.balanceCents, 500);
  assert.equal(acct.transactions.length, 1);
  assert.equal(acct.transactions[0].kind, 'fund');
  paymentId = acct.payments[0].id;
});

let bookId;
test('a new book costs $0.99, needs a name and a story, and draws 21 pictures', async () => {
  assert.equal((await call('POST', '/api/books', { photo: tinyPng, story: 'jack', about: {} })).status, 400);
  assert.equal((await call('POST', '/api/books', { photo: tinyPng, story: 'nope', about: { name: 'Maya' } })).status, 400);
  const res = await call('POST', '/api/books', { photo: tinyPng, story: 'red', about: { name: 'Maya', age: '6' } });
  assert.equal(res.status, 201);
  const body = await res.json();
  bookId = body.book.id;
  assert.equal(body.balanceCents, 401);
  assert.equal(body.book.busy, true);
  assert.equal(body.book.slots.length, 21);
  assert.match(body.book.stage.label, /Drawing Maya as Little Red/);

  const done = await settle(bookId);
  assert.ok(done.slots.every((s) => s.status === 'done' && s.imageUrl && s.thumbUrl), JSON.stringify(done.slots.filter((s) => s.status !== 'done')));
  assert.equal(done.pdfReady, true);
  assert.match(done.stage.label, /Book ready/);
  assert.ok(done.madeInMs > 0);
});

test('every picture shows its attempt count; failures were redrawn, at most 3 times', async () => {
  const { book } = await json('GET', `/api/books/${bookId}`);
  const at = Object.fromEntries(book.slots.map((s) => [s.id, s]));
  assert.ok(book.slots.every((s) => s.attempts >= 1 && s.attempts <= 3 && s.maxAttempts === 3));
  assert.equal(at.p01.attempts, 1);
  assert.equal(at.p03.attempts, 2, 'failed once, passed on the second drawing');
  assert.equal(at.p03.passed, true);
  assert.equal(at.p05.attempts, 3, 'failed three times');
  assert.equal(at.p05.passed, false);
  assert.equal(at.p05.chosen, 3, 'the best-scoring drawing was kept');
  assert.equal(at.p05.history.length, 3);
  assert.ok(book.slots.slice(1).every((s) => ['top', 'bottom', 'middle', 'below'].includes(s.zone)), 'every page has a text placement');
});

test('every API call of the book is in the cost log', async () => {
  const { book } = await json('GET', `/api/books/${bookId}`);
  // 21 pictures + 1 retry (p03) + 2 retries (p05) = 24 drawings and 24 checks.
  assert.equal(book.cost.drawings + book.cost.retries, 24);
  assert.equal(book.cost.retries, 3);
  assert.equal(book.cost.checks, 24);
  assert.ok(book.cost.totalUsd > 0);
  const costs = await json('GET', '/api/costs');
  assert.equal(costs.site.books, 1);
  assert.ok(Math.abs(costs.site.averageUsd - book.cost.totalUsd) < 1e-9);
  assert.equal(costs.priceCents, 99);
  assert.equal(costs.books[0].id, bookId);
  assert.equal(costs.books[0].retries, 3);
  assert.equal('costs' in (await json('GET', '/api/account')), false, 'the account page carries no cost figures');
});

test('pictures and thumbnails are served to the owner only', async () => {
  const { books } = await json('GET', '/api/books');
  assert.equal(books[0].id, bookId);
  assert.equal(books[0].done, 21);
  assert.equal((await call('GET', books[0].thumbUrl)).status, 200);
  assert.equal((await fetch(base + books[0].thumbUrl)).status, 401);
  assert.equal((await call('GET', '/api/books/00000000-0000-0000-0000-000000000000')).status, 404);
});

test('the PDF is stored with the book and still downloads after signing in again', async () => {
  const first = await call('GET', `/api/books/${bookId}/pdf`);
  assert.equal(first.headers.get('content-type'), 'application/pdf');
  assert.match(first.headers.get('content-disposition'), /Maya-LittleRedRidingHood\.pdf/);
  const bytes = Buffer.from(await first.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.equal((bytes.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 21, '20 story pages plus About Me');

  await call('POST', '/auth/logout');
  cookie = '';
  assert.equal((await call('GET', `/api/books/${bookId}/pdf`)).status, 401);
  const res = await call('GET', '/auth/dev-login');
  cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const again = await call('GET', `/api/books/${bookId}/pdf`);
  assert.equal(again.status, 200);
  assert.equal(Buffer.from(await again.arrayBuffer()).length, bytes.length);
});

test('fix keeps the old page for undo', async () => {
  assert.equal((await call('POST', `/api/books/${bookId}/fix`, { pageId: 'p02', instruction: '' })).status, 400);
  assert.equal((await call('POST', `/api/books/${bookId}/fix`, { pageId: 'p02', instruction: 'brighter basket' })).status, 202);
  const book = await settle(bookId);
  assert.equal(book.slots.find((s) => s.id === 'p02').canUndo, true);
  const after = (await json('POST', `/api/books/${bookId}/undo`, { pageId: 'p02' })).book;
  assert.equal(after.slots.find((s) => s.id === 'p02').canUndo, false);
});

test('the history lists every credit and debit with its cause and the running balance', async () => {
  const acct = await json('GET', '/api/account');
  const [debit, credit] = acct.transactions;
  assert.equal(debit.amountCents, -99);
  assert.match(debit.description, /Little Red Riding Hood, starring Maya/);
  assert.equal(debit.bookId, bookId);
  assert.equal(debit.balanceAfterCents, 401);
  assert.equal(credit.amountCents, 500);
  assert.equal(credit.balanceAfterCents, 500);
});

test('refund: requested, then processed; only the unspent money comes back', async () => {
  const req = await call('POST', '/api/billing/refunds', { paymentId, reason: 'Testing refunds' });
  assert.equal(req.status, 201);
  const { refundId } = await req.json();
  let acct = await json('GET', '/api/account');
  assert.equal(acct.balanceCents, 0, 'the refund leaves the balance as soon as it is requested');
  assert.equal(acct.refunds[0].status, 'requested');
  assert.equal(acct.refunds[0].amountCents, 401);
  assert.equal(acct.transactions[0].kind, 'refund');
  assert.equal(acct.transactions[0].refundStatus, 'requested');

  assert.equal((await call('POST', `/api/billing/refunds/${refundId}/process`)).status, 200);
  assert.equal((await call('POST', `/api/billing/refunds/${refundId}/process`)).status, 409, 'a refund is processed once');
  acct = await json('GET', '/api/account');
  assert.equal(acct.refunds[0].status, 'processed');
  assert.ok(acct.refunds[0].stripeRefundId);
  assert.equal((await call('POST', '/api/billing/refunds', { paymentId })).status, 400, 'nothing left to refund');
});

test('deleting a book removes it but keeps its cost in the log', async () => {
  assert.equal((await call('DELETE', `/api/books/${bookId}`)).status, 204);
  assert.equal((await call('GET', `/api/books/${bookId}`)).status, 404);
  assert.equal((await json('GET', '/api/costs')).site.books, 1);
});
