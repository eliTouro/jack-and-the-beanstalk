/* A storybook starring your child.
   Sign in with Google, make a book, and the server draws all 5 pictures. This page
   only starts the work and polls for per-picture progress, so a book survives a closed tab.
   Views: signed out, shelf (my books), one book (?book=<id>). */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const MAX_SIDE = 1024;
  const POLL_MS = 1500;        // book progress while anything is drawing
  const SHELF_POLL_MS = 3000;  // shelf refresh while any book is drawing
  const SAVE_DEBOUNCE_MS = 800;
  const SITE = 'Jack and the Beanstalk';

  const HERO_OUT = 'Sign in and upload one photo. Your child becomes Jack, trades the cow for magic beans, and ends up in an illustrated book we draw for you and save to your account.';
  const HERO_SHELF = 'Pick up where you left off, or start a new book from a photo.';

  const state = {
    me: null,            // { user, signInUrl, devLogin }
    story: null,         // /api/book: { style, pages, about, slots }
    photo: null,         // dataURL (resized JPEG) for a new book
    making: false,
    books: null,         // shelf
    seed: null,          // book returned by POST /api/books, used to skip one fetch
    bookId: null,
    book: null,
    clockOffset: 0,      // server now minus browser now, captured at each fetch
    rev: 0,              // bumps on every write so a stale poll response is dropped
    working: false,      // a POST is in flight
    pageErr: {},         // slot id (or "fix:<id>") -> message from a failed request
    about: { dirty: false, saving: false },
    prevAttention: undefined,
  };
  const rows = {};       // slot id -> progress row refs
  const cards = {};      // page id -> card refs
  let built = null;      // id of the book the view was built for
  let viewToken = 0;     // bumps on every route change; async work compares it
  let pollTimer = null, tickTimer = null, shelfTimer = null, saveTimer = null;

  const say = (msg) => { $('status').textContent = ''; setTimeout(() => { $('status').textContent = msg; }, 20); };

  // ---------- api ----------
  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
        keepalive: method === 'PATCH', // lets a last autosave finish while the page closes
      });
    } catch {
      throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
    }
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).error; } catch { /* not json */ }
      if (res.status === 429) msg = msg || 'Too many requests right now. Wait a moment, then try again.';
      if (res.status === 401) onUnauthorized();
      throw new ApiError(msg || `Something went wrong (${res.status}).`, res.status);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function onUnauthorized() {
    if (!state.me?.user) return;
    state.me.user = null;
    renderAccount();
    route();
  }

  function showErr(box, msg) {
    box.hidden = !msg;
    const p = box.tagName === 'P' ? box : box.querySelector('p');
    if (p) p.textContent = msg || '';
  }

  // ---------- small helpers ----------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function fmtDate(v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const slotOf = (id) => state.book?.slots.find((s) => s.id === id);
  const isBusy = (s) => !!s && (s.status === 'queued' || s.status === 'running');
  const anySlotBusy = () => !!state.book && state.book.slots.some(isBusy);
  const sharedBusy = () => isBusy(slotOf('reference')) || isBusy(slotOf('cast'));
  const pageLocked = (id) => state.working || isBusy(slotOf(id)) || sharedBusy();

  function setImg(img, slot) {
    const show = slot?.status === 'done' && !!slot.imageUrl;
    img.hidden = !show;
    if (show && img.getAttribute('src') !== slot.imageUrl) img.src = slot.imageUrl;
    return show;
  }

  // Same-page navigation for links that point at our own views.
  function onNav(a) {
    a.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(a.getAttribute('href'));
    });
  }

  function navigate(url, seedBook) {
    state.seed = seedBook || null;
    history.pushState(null, '', url);
    route();
    $('main').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  // ---------- account ----------
  function avatar(user) {
    const initial = (user.name || user.email || '?').trim().charAt(0).toUpperCase() || '?';
    const fallback = () => { const s = el('span', 'avatar avatar-initial', initial); s.setAttribute('aria-hidden', 'true'); return s; };
    if (!user.picture) return fallback();
    const img = el('img', 'avatar');
    img.alt = ''; img.referrerPolicy = 'no-referrer'; img.src = user.picture;
    img.addEventListener('error', () => img.replaceWith(fallback()));
    return img;
  }

  function renderAccount() {
    const host = $('account');
    host.textContent = '';
    const user = state.me?.user;
    const signInUrl = state.me?.signInUrl || '/auth/google';
    $('cta-signin').href = signInUrl;
    if (user) {
      host.append(avatar(user), el('span', 'acct-name', user.name || user.email));
      const out = el('button', 'btn btn-ghost btn-sm', 'Sign out'); out.type = 'button';
      out.addEventListener('click', signOut);
      host.append(out);
      return;
    }
    const a = el('a', 'btn btn-primary btn-sm', 'Sign in with Google'); a.href = signInUrl;
    host.append(a);
    if (state.me?.devLogin) {
      const d = el('a', 'link-btn dev-link', 'Dev sign-in'); d.href = '/auth/dev-login';
      host.append(d);
    }
  }

  async function signOut() {
    try {
      await api('POST', '/auth/logout');
      location.reload();
    } catch (e) {
      showErr($('global-err'), e.message);
    }
  }

  // ---------- views ----------
  function showView(name) {
    $('view-out').hidden = name !== 'out';
    $('view-shelf').hidden = name !== 'shelf';
    $('view-book').hidden = name !== 'book';
    $('hero').hidden = name === 'book';
    $('hero').classList.toggle('hero-short', name === 'shelf');
    $('hero-steps').hidden = name !== 'out';
    $('hero-lede').textContent = name === 'shelf' ? HERO_SHELF : HERO_OUT;
    if (name === 'out') document.title = `${SITE}: a storybook starring your child`;
    if (name === 'shelf') document.title = `My books | ${SITE}`;
  }

  function teardown() {
    clearTimeout(pollTimer); clearTimeout(shelfTimer);
    clearInterval(tickTimer); tickTimer = null;
    if (state.me?.user && state.bookId && state.about.dirty && !state.about.saving) saveAbout(); // keep the last edits
    clearTimeout(saveTimer);
    viewToken++;
    state.bookId = null; state.book = null; built = null;
  }

  function route() {
    teardown();
    showErr($('global-err'), '');
    if (!state.me?.user) { showView('out'); return; }
    const id = new URLSearchParams(location.search).get('book');
    if (id) enterBook(id); else enterShelf();
  }

  // ---------- photo ----------
  function resizeToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image. Try a JPG or PNG.')); };
      img.src = url;
    });
  }

  function showPhotoError(msg) {
    const e = $('photo-error');
    e.textContent = msg || '';
    e.hidden = !msg;
  }

  async function handleFile(file) {
    showPhotoError('');
    showErr($('make-err'), '');
    if (!file) return;
    if (!file.type.startsWith('image/')) { showPhotoError('Please choose an image file.'); return; }
    try {
      const data = await resizeToDataUrl(file);
      resetPhoto();
      state.photo = data;
      $('photo-preview').src = data;
      $('photo-preview').hidden = false;
      $('drop-empty').hidden = true;
      $('photo-clear').hidden = false;
      say('Photo added. Next, make your book.');
      renderMake();
    } catch (e) {
      showPhotoError(e.message);
    }
  }

  function resetPhoto() {
    state.photo = null;
    $('photo-preview').hidden = true;
    $('photo-preview').removeAttribute('src');
    $('drop-empty').hidden = false;
    $('photo-clear').hidden = true;
    $('photo-input').value = '';
    $('camera-input').value = '';
    renderMake();
  }

  function renderMake() {
    $('make-btn').disabled = !state.photo || state.making;
    $('make-btn').textContent = state.making ? 'Starting your book...' : 'Make my book';
  }

  async function makeBook() {
    if (!state.photo || state.making) return;
    state.making = true; renderMake();
    showErr($('make-err'), '');
    try {
      const { book } = await api('POST', '/api/books', { photo: state.photo });
      resetPhoto();
      navigate(`/?book=${encodeURIComponent(book.id)}`, book);
    } catch (e) {
      if (e.status !== 401) showErr($('make-err'), e.message);
    } finally {
      state.making = false; renderMake();
    }
  }

  function wireUpload() {
    const drop = $('drop');
    $('photo-input').addEventListener('change', (e) => handleFile(e.target.files[0]));
    $('camera-input').addEventListener('change', (e) => handleFile(e.target.files[0]));
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('photo-input').click(); } });
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
    drop.addEventListener('drop', (e) => handleFile(e.dataTransfer?.files?.[0]));
    if (window.matchMedia('(pointer: coarse)').matches) {
      $('camera-btn').hidden = false;
      $('camera-btn').addEventListener('click', () => $('camera-input').click());
    }
    $('photo-clear').addEventListener('click', () => { resetPhoto(); showPhotoError(''); $('photo-input').click(); });
    $('make-btn').addEventListener('click', makeBook);
    for (const id of ['to-new', 'to-new-empty']) {
      $(id).addEventListener('click', (e) => {
        e.preventDefault();
        const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        $('new-book').scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
        drop.focus({ preventScroll: true });
      });
    }
  }

  // ---------- shelf ----------
  function enterShelf() {
    const view = viewToken;
    showView('shelf');
    $('shelf-loading').hidden = false;
    $('shelf').hidden = true; $('shelf-empty').hidden = true;
    showErr($('shelf-err'), '');
    state.books = null;
    renderMake();
    loadShelf(view);
  }

  async function loadShelf(view) {
    try {
      const { books } = await api('GET', '/api/books');
      if (view !== viewToken) return;
      state.books = books;
      showErr($('shelf-err'), '');
      renderShelf();
    } catch (e) {
      if (view !== viewToken) return;
      $('shelf-loading').hidden = true;
      if (e.status !== 401) showErr($('shelf-err'), e.message);
    }
    if (view === viewToken && state.books?.some((b) => b.busy)) shelfTimer = setTimeout(() => loadShelf(view), SHELF_POLL_MS);
  }

  function bookCard(b) {
    const li = el('li');
    const a = el('a', 'book-card');
    a.href = `/?book=${encodeURIComponent(b.id)}`;
    onNav(a);

    const frame = el('div', 'page-frame book-thumb');
    if (b.thumbUrl) {
      const img = el('img', 'page-img'); img.src = b.thumbUrl; img.alt = ''; img.loading = 'lazy';
      frame.append(img);
    } else {
      const blank = el('div', 'page-blank');
      blank.append(el('span', 'txt', b.busy ? 'Drawing...' : 'A blank page'));
      frame.append(blank);
    }

    const ready = b.total > 0 && b.done >= b.total;
    const status = el('span', 'book-status');
    status.dataset.ready = String(ready);
    if (b.busy) status.append(el('span', 'bean-spin sm'));
    status.append(el('span', null, ready ? 'Ready' : `${b.done} of ${b.total} pictures`));
    if (b.busy) status.append(el('span', 'book-drawing', 'Drawing'));

    a.append(frame, el('span', 'book-name font-display', b.name || 'Untitled book'), el('span', 'book-date', `Created ${fmtDate(b.createdAt)}`), status);
    li.append(a);
    return li;
  }

  function renderShelf() {
    $('shelf-loading').hidden = true;
    const books = state.books || [];
    const list = $('shelf');
    list.textContent = '';
    for (const b of books) list.append(bookCard(b));
    list.hidden = !books.length;
    $('shelf-empty').hidden = books.length > 0;
  }

  // ---------- one book: load and apply ----------
  async function ensureStory() {
    if (!state.story) state.story = await api('GET', '/api/book');
  }

  async function enterBook(id) {
    const view = viewToken;
    showView('book');
    state.bookId = id; built = null; state.book = null;
    $('book-title').textContent = 'Your book'; $('book-meta').textContent = '';
    $('book-photo').hidden = true;
    $('book-body').hidden = true; $('book-loading').hidden = false;
    showErr($('book-err'), '');
    const seed = state.seed; state.seed = null;
    try {
      await ensureStory();
      const book = seed && seed.id === id ? seed : (await api('GET', `/api/books/${encodeURIComponent(id)}`)).book;
      if (view !== viewToken) return;
      $('book-loading').hidden = true; $('book-body').hidden = false;
      applyBook(book);
    } catch (e) {
      if (view !== viewToken || e.status === 401) return;
      $('book-loading').hidden = true;
      showErr($('book-err'), e.message);
    }
  }

  function applyBook(book) {
    if (book.id !== state.bookId) return;
    const prev = state.book;
    state.book = book;
    state.clockOffset = (book.now ?? Date.now()) - Date.now();
    state.rev++;
    if (built !== book.id) buildBookView(book);
    announce(prev, book);
    renderBook();
    syncTicker();
    schedulePoll();
  }

  function announce(prev, book) {
    if (!prev) return;
    for (const s of book.slots) {
      const before = prev.slots.find((p) => p.id === s.id)?.status;
      if (before === s.status) continue;
      if (s.status === 'done' && (before === 'running' || before === 'queued')) say(`${s.label} is ready.`);
      if (s.status === 'error') say(`${s.label} failed. ${s.error || ''}`);
    }
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (state.book?.busy && state.bookId) pollTimer = setTimeout(poll, POLL_MS);
  }

  async function poll() {
    const id = state.bookId, rev = state.rev, view = viewToken;
    if (!id) return;
    try {
      const { book } = await api('GET', `/api/books/${encodeURIComponent(id)}`);
      if (view !== viewToken) return;
      if (rev !== state.rev) { schedulePoll(); return; } // a write landed meanwhile; this reply may be older
      showErr($('book-err'), '');
      applyBook(book);
    } catch (e) {
      if (view !== viewToken || e.status === 401) return;
      showErr($('book-err'), `Could not refresh progress. ${e.message}`);
      if (e.status !== 404) schedulePoll();
    }
  }

  // ---------- progress ----------
  const nowMs = () => Date.now() + state.clockOffset;

  function slotFraction(s) {
    if (s.status === 'done') return 1;
    if (s.status === 'running' && s.startedAt != null) {
      return Math.min(0.95, Math.max(0, (nowMs() - s.startedAt) / Math.max(1, s.estimateMs || 40000)));
    }
    return 0;
  }

  function slotStatusText(s) {
    if (s.status === 'running') {
      if (s.startedAt == null) return 'Drawing...';
      const left = Math.ceil(((s.estimateMs || 40000) - (nowMs() - s.startedAt)) / 1000);
      if (left <= 1) return 'Drawing... almost there';
      return left >= 90 ? `Drawing... about ${Math.ceil(left / 60)} min left` : `Drawing... about ${left}s left`;
    }
    if (s.status === 'done') return 'Done';
    if (s.status === 'error') return 'Failed';
    return 'Waiting';
  }

  function paintBar(bar, fraction, status) {
    bar.firstElementChild.style.transform = `scaleX(${fraction})`;
    bar.dataset.state = status;
  }

  // Cheap and safe to run every 250ms: only touches bar fills and status text.
  function paintSlots() {
    const slots = state.book.slots;
    let sum = 0;
    for (const s of slots) {
      const f = slotFraction(s);
      sum += f;
      const text = slotStatusText(s);
      const r = rows[s.id];
      if (r) {
        paintBar(r.bar, s.status === 'error' ? 1 : f, s.status);
        r.bar.setAttribute('aria-valuenow', String(Math.round(f * 100)));
        r.bar.setAttribute('aria-valuetext', `${s.label}: ${text}`);
        r.status.textContent = text;
        r.li.dataset.status = s.status;
      }
      if (isBusy(s)) {
        if (s.id === 'reference') $('ref-busy-text').textContent = text;
        else if (s.id === 'cast') $('cast-busy-text').textContent = text;
        else if (cards[s.id]) cards[s.id].veilText.textContent = text;
      }
    }
    if (slots.length) paintBar($('prog-bar'), sum / slots.length, anySlotBusy() ? 'running' : 'idle');
  }

  function syncTicker() {
    const running = state.book.slots.some((s) => s.status === 'running');
    if (running && !tickTimer) tickTimer = setInterval(() => { if (state.book) paintSlots(); }, 250);
    if (!running && tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  function buildProgressRows(book) {
    const list = $('prog-rows');
    list.textContent = '';
    for (const k of Object.keys(rows)) delete rows[k];
    for (const s of book.slots) {
      const li = el('li', 'prog-row');
      const top = el('div', 'prog-row-top');
      const status = el('span', 'prog-status');
      top.append(el('span', 'prog-label', s.label), status);
      const bar = el('span', 'bar');
      bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', s.label);
      bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', '0');
      bar.append(el('span', 'bar-fill'));
      const fail = el('div', 'err'); fail.hidden = true;
      const failMsg = el('p');
      const retry = el('button', 'btn btn-ghost btn-sm', 'Try again'); retry.type = 'button';
      retry.addEventListener('click', () => generate([s.id]));
      fail.append(failMsg, retry);
      li.append(top, bar, fail);
      list.append(li);
      rows[s.id] = { li, bar, status, fail, failMsg, retry };
    }
  }

  function renderProgress() {
    const slots = state.book.slots;
    const total = slots.length;
    const done = slots.filter((s) => s.status === 'done').length;
    const failed = slots.filter((s) => s.status === 'error').length;
    const busy = anySlotBusy();
    const allDone = total > 0 && done === total;

    let text = `${done} of ${total} pictures ready`;
    if (allDone) text = `All ${total} pictures ready`;
    else if (failed && !busy) text = `${done} of ${total} pictures ready, ${failed} failed`;
    $('prog-count').textContent = text;
    $('prog-panel').dataset.state = allDone ? 'done' : busy ? 'busy' : failed ? 'error' : 'idle';
    const bar = $('prog-bar');
    bar.setAttribute('aria-valuemax', String(total));
    bar.setAttribute('aria-valuenow', String(done));
    bar.setAttribute('aria-valuetext', text);

    // open while there is something to watch or fix; fold up once everything is done
    const attention = busy || failed > 0;
    if (attention !== state.prevAttention) { $('prog').open = attention; state.prevAttention = attention; }

    for (const s of slots) {
      const r = rows[s.id];
      if (!r) continue;
      const failedHere = s.status === 'error';
      r.fail.hidden = !failedHere;
      r.failMsg.textContent = failedHere ? (s.error || 'This picture could not be drawn.') : '';
      r.retry.disabled = state.working;
    }
    paintSlots();
  }

  // ---------- pictures ----------
  function errFor(id) {
    const s = slotOf(id);
    return state.pageErr[id] || (s?.status === 'error' ? (s.error || 'This picture could not be drawn.') : '');
  }

  function buildCards() {
    const host = $('pages');
    host.textContent = '';
    for (const k of Object.keys(cards)) delete cards[k];
    const pages = state.story.pages;
    for (const p of pages) {
      const card = el('article', 'page-card');
      card.setAttribute('aria-labelledby', `t-${p.id}`);

      const frame = el('div', 'page-frame');
      const blank = el('div', 'page-blank');
      blank.append(el('span', 'num', `Page ${p.number}`), el('span', 'ttl', p.title), el('span', 'txt', p.text));
      const img = el('img', 'page-img'); img.hidden = true;
      img.alt = `Page ${p.number}: ${p.title}. Jack in the scene, in 3D animated style.`;
      const overlay = el('p', 'page-text', p.text);
      overlay.dataset.zone = p.zone; overlay.dataset.tone = p.tone; overlay.hidden = true;
      const veil = el('div', 'busy-veil'); veil.hidden = true;
      const spin = el('div', 'bean-spin'); spin.setAttribute('aria-hidden', 'true');
      const veilText = el('span');
      veil.append(spin, veilText);
      frame.append(blank, img, overlay, veil);

      const meta = el('div', 'page-meta');
      const h3 = el('h3', 'font-display', p.title); h3.id = `t-${p.id}`;
      meta.append(h3, el('div', 'where', `Page ${p.number} of ${pages.length}`));

      const actions = el('div', 'page-actions');
      const redo = el('button', 'btn btn-ghost btn-sm', 'Redo page'); redo.type = 'button';
      redo.addEventListener('click', () => generate([p.id]));
      actions.append(redo);

      const err = el('div', 'err'); err.setAttribute('role', 'alert'); err.hidden = true;
      const errText = el('p');
      const errBtn = el('button', 'btn btn-ghost btn-sm', 'Try again'); errBtn.type = 'button';
      errBtn.addEventListener('click', () => generate([p.id]));
      err.append(errText, errBtn);

      const fix = el('details', 'fix'); fix.hidden = true;
      const sum = el('summary', null, 'Fix something on this page');
      const body = el('div', 'fix-body');
      const ta = el('textarea'); ta.maxLength = 300; ta.rows = 3;
      ta.id = `fix-${p.id}`;
      ta.placeholder = p.number % 2 ? 'Make the beans more colorful' : "Show Jack's face more clearly";
      ta.setAttribute('aria-label', `What should change on page ${p.number}?`);
      const row = el('div', 'fix-row');
      const count = el('span', 'counter', '0/300'); count.style.margin = '0';
      const btns = el('div', 'flex gap-2 flex-wrap');
      const apply = el('button', 'btn btn-gold btn-sm', 'Apply fix'); apply.type = 'button';
      const undo = el('button', 'btn btn-ghost btn-sm', 'Undo fix'); undo.type = 'button'; undo.hidden = true;
      btns.append(apply, undo);
      row.append(count, btns);
      const fixErr = el('div', 'err'); fixErr.setAttribute('role', 'alert'); fixErr.hidden = true;
      fixErr.append(el('p'));
      body.append(ta, row, fixErr);
      fix.append(sum, body);

      ta.addEventListener('input', () => { count.textContent = `${ta.value.length}/300`; });
      apply.addEventListener('click', () => applyFix(p.id));
      undo.addEventListener('click', () => undoFix(p.id));

      card.append(frame, meta, actions, err, fix);
      host.append(card);
      cards[p.id] = { blank, img, overlay, veil, veilText, redo, err, errText, errBtn, fix, ta, count, apply, undo, fixErr };
    }
  }

  function renderPictures() {
    const ref = slotOf('reference'), cast = slotOf('cast');

    const hasRef = setImg($('ref-img'), ref);
    $('ref-empty').hidden = hasRef;
    $('ref-busy').hidden = !isBusy(ref);
    const refErr = errFor('reference');
    showErr($('ref-err'), refErr);

    const hasCast = setImg($('cast-img'), cast);
    $('cast-empty').hidden = hasCast;
    $('cast-busy').hidden = !isBusy(cast);
    showErr($('cast-err'), errFor('cast'));

    for (const p of state.story.pages) {
      const s = slotOf(p.id), c = cards[p.id];
      if (!s || !c) continue;
      const has = s.status === 'done' && !!s.imageUrl;
      c.img.hidden = !has; c.overlay.hidden = !has; c.blank.hidden = has;
      if (has && c.img.getAttribute('src') !== s.imageUrl) c.img.src = s.imageUrl;
      c.veil.hidden = !isBusy(s);
      showErr(c.err, errFor(p.id));
      c.redo.textContent = has ? 'Redo page' : 'Draw this page';
      c.fix.hidden = !has;
      c.undo.hidden = !s.canUndo;
      showErr(c.fixErr, state.pageErr[`fix:${p.id}`] || '');
    }
    renderLocks();
  }

  function renderLocks() {
    const anyBusy = anySlotBusy();
    $('ref-retry').disabled = state.working || anyBusy;
    $('ref-err-retry').disabled = state.working;
    $('cast-err-retry').disabled = state.working;
    for (const p of state.story.pages) {
      const c = cards[p.id];
      if (!c) continue;
      const locked = pageLocked(p.id);
      c.redo.disabled = locked;
      c.errBtn.disabled = locked;
      c.ta.disabled = locked;
      c.apply.disabled = locked;
      c.undo.disabled = locked;
      c.redo.setAttribute('aria-busy', String(isBusy(slotOf(p.id))));
    }
  }

  // ---------- actions ----------
  // One place for every write: shows the server's message near the control, then applies the returned book.
  async function mutate(method, path, body, errKey) {
    if (state.working || !state.book) return false;
    const id = state.bookId;
    state.working = true; state.rev++;
    delete state.pageErr[errKey];
    renderPictures(); renderProgress();
    try {
      const res = await api(method, path, body);
      if (id !== state.bookId) return false;
      if (res?.book) applyBook(res.book);
      return true;
    } catch (e) {
      if (id === state.bookId && e.status !== 401) state.pageErr[errKey] = e.message;
      return false;
    } finally {
      state.working = false;
      if (id === state.bookId && state.book) { state.rev++; renderPictures(); renderProgress(); }
    }
  }

  const bookPath = (tail = '') => `/api/books/${encodeURIComponent(state.bookId)}${tail}`;
  const generate = (slots) => mutate('POST', bookPath('/generate'), { slots }, slots[0]);

  function redoReference() {
    if (!confirm("Try a different look for Jack? This also redraws the cast sheet and all 3 pages, so the whole book stays consistent.")) return;
    generate(['reference']);
  }

  async function applyFix(pageId) {
    const c = cards[pageId];
    const instruction = c.ta.value.trim();
    if (instruction.length < 3) {
      state.pageErr[`fix:${pageId}`] = 'Say what to change on this page.';
      renderPictures();
      return;
    }
    const ok = await mutate('POST', bookPath('/fix'), { pageId, instruction: instruction.slice(0, 300) }, `fix:${pageId}`);
    if (ok) { c.ta.value = ''; c.count.textContent = '0/300'; say('Applying your fix.'); }
  }

  async function undoFix(pageId) {
    const ok = await mutate('POST', bookPath('/undo'), { pageId }, `fix:${pageId}`);
    if (ok) say(`Page restored to the version before the fix.`);
  }

  async function deleteBook() {
    if (!state.book || state.working) return;
    if (!confirm('Delete this book? The photo and all of its pictures are removed for good.')) return;
    const id = state.bookId;
    state.working = true;
    try {
      await api('DELETE', bookPath());
      state.working = false;
      navigate('/');
    } catch (e) {
      state.working = false;
      if (id === state.bookId && e.status !== 401) showErr($('book-err'), e.message);
    }
  }

  // ---------- about me (autosave) ----------
  function buildAbout(values) {
    const form = $('about-form');
    form.textContent = '';
    for (const f of state.story.about) {
      const wrap = el('div', 'field');
      const label = el('label'); label.htmlFor = `about-${f.id}`;
      label.textContent = f.label;
      if (f.required) { const r = el('span', 'req', ' *'); r.setAttribute('aria-hidden', 'true'); label.append(r); }
      const multi = f.id === 'about' || f.id === 'favorites' || f.max > 80;
      const input = multi ? el('textarea') : el('input');
      if (!multi) input.type = 'text';
      if (multi) input.rows = f.id === 'about' ? 4 : 3;
      input.id = `about-${f.id}`; input.name = f.id; input.maxLength = f.max;
      input.value = values?.[f.id] || '';
      if (f.required) input.required = true;
      if (f.id === 'name') input.autocomplete = 'off';
      const count = el('span', 'counter', `${input.value.length}/${f.max}`); count.id = `count-${f.id}`;
      input.setAttribute('aria-describedby', count.id);
      input.addEventListener('input', () => {
        count.textContent = `${input.value.length}/${f.max}`;
        state.about.dirty = true;
        setSaveStatus('');
        renderDownload();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveAbout, SAVE_DEBOUNCE_MS);
      });
      wrap.append(label, input, count);
      form.append(wrap);
    }
    form.addEventListener('submit', (e) => e.preventDefault());
  }

  function aboutValues() {
    const v = {};
    for (const f of state.story?.about || []) v[f.id] = ($(`about-${f.id}`)?.value || '').trim();
    return v;
  }

  function setSaveStatus(kind, msg) {
    const s = $('save-status');
    s.textContent = kind === 'saved' ? 'Saved' : kind === 'saving' ? 'Saving...' : kind === 'error' ? `Not saved. ${msg}` : '';
    s.dataset.show = String(!!kind);
    s.dataset.kind = kind || '';
    $('save-retry').hidden = kind !== 'error';
  }

  async function saveAbout() {
    clearTimeout(saveTimer);
    const a = state.about, id = state.bookId;
    if (!id || !a.dirty || a.saving) return;
    const values = aboutValues();
    a.dirty = false; a.saving = true;
    setSaveStatus('saving'); renderDownload();
    let failed = false;
    try {
      const { book } = await api('PATCH', bookPath(), { about: values });
      if (id === state.bookId) { setSaveStatus(a.dirty ? '' : 'saved'); applyBook(book); }
    } catch (e) {
      failed = true;
      a.dirty = true;
      if (id === state.bookId && e.status !== 401) setSaveStatus('error', e.message);
    } finally {
      a.saving = false;
      if (id === state.bookId) {
        renderDownload();
        if (a.dirty && !failed) saveAbout(); // the child kept typing during the save
      }
    }
  }

  // ---------- download ----------
  function renderDownload() {
    const pagesDone = state.story.pages.every((p) => slotOf(p.id)?.status === 'done');
    const hasName = (($('about-name')?.value) || '').trim().length > 0;
    const pending = state.about.dirty || state.about.saving;
    const ready = pagesDone && hasName && !pending;
    const link = $('pdf-btn');
    if (ready) { link.href = bookPath('/pdf'); link.removeAttribute('aria-disabled'); }
    else { link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); }

    const missing = [];
    if (!pagesDone) missing.push(`wait for all ${state.story.pages.length} pages to finish`);
    if (!hasName) missing.push("add your child's name");
    let note = 'Ready when you are.';
    if (missing.length) note = `To download: ${missing.join(' and ')}.`;
    else if (pending) note = 'Saving your changes...';
    $('need').textContent = note;
  }

  // ---------- render a whole book ----------
  function buildBookView(book) {
    built = book.id;
    state.about = { dirty: false, saving: false };
    state.pageErr = {}; state.working = false; state.prevAttention = undefined;
    clearTimeout(saveTimer);
    $('style-text').textContent = state.story.style;
    buildProgressRows(book);
    buildCards();
    buildAbout(book.about);
    setSaveStatus('');
  }

  function renderBook() {
    const b = state.book;
    const name = (b.about?.name || '').trim();
    $('book-title').textContent = name || 'Untitled book';
    $('book-meta').textContent = `Created ${fmtDate(b.createdAt)}`;
    document.title = `${name || 'Untitled book'} | ${SITE}`;
    const photo = $('book-photo');
    if (b.photoUrl) { if (photo.getAttribute('src') !== b.photoUrl) photo.src = b.photoUrl; photo.hidden = false; }
    else photo.hidden = true;
    renderProgress();
    renderPictures();
    renderDownload();
  }

  // ---------- init ----------
  async function init() {
    wireUpload();
    onNav($('brand'));
    onNav($('back-link'));
    $('ref-retry').addEventListener('click', redoReference);
    $('ref-err-retry').addEventListener('click', () => generate(['reference']));
    $('cast-err-retry').addEventListener('click', () => generate(['cast']));
    $('save-retry').addEventListener('click', saveAbout);
    $('delete-btn').addEventListener('click', deleteBook);
    $('pdf-btn').addEventListener('click', (e) => { if ($('pdf-btn').getAttribute('aria-disabled') === 'true') e.preventDefault(); });
    window.addEventListener('popstate', route);
    window.addEventListener('pagehide', () => { if (state.bookId && state.about.dirty) saveAbout(); });

    let meError = '';
    try {
      state.me = await api('GET', '/api/me');
    } catch (e) {
      state.me = { user: null, signInUrl: '/auth/google', devLogin: false };
      meError = `Could not check your sign-in. ${e.message}`;
    }
    renderAccount();
    route();
    showErr($('global-err'), meError);
  }

  init();
})();
