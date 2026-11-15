/* The storybook app. The server draws and checks every picture; this page starts the
   work, polls for progress, and shows the money. Views: signed out, shelf (my books +
   new book), one book (?book=<id>), account (?view=account). */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const MAX_SIDE = 1024;
  const POLL_MS = 1200;
  const SHELF_POLL_MS = 3000;
  const SAVE_DEBOUNCE_MS = 800;
  const SITE = 'Storybook, starring your child';

  const state = {
    me: null,          // { user: { name, email, picture, balanceCents }, priceCents, signInUrl, devLogin }
    lib: null,         // /api/stories
    photo: null, making: false,
    books: null,
    seed: null, bookId: null, book: null,
    clockOffset: 0, rev: 0, working: false,
    about: { dirty: false, saving: false },
    open: null,        // slot id shown in the dialog
    account: null,
  };
  const tiles = {};    // slot id -> tile refs
  let built = null, viewToken = 0;
  let pollTimer = null, tickTimer = null, shelfTimer = null, saveTimer = null;

  const say = (msg) => { $('status').textContent = ''; setTimeout(() => { $('status').textContent = msg; }, 20); };
  const money = (cents) => `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
  const usd = (v) => (v == null ? '–' : `$${v < 0.1 ? v.toFixed(3) : v.toFixed(2)}`);
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  // ---------- api ----------
  class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }

  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
        keepalive: method === 'PATCH',
      });
    } catch {
      throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
    }
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).error; } catch { /* not json */ }
      if (res.status === 401) onUnauthorized();
      throw new ApiError(msg || `Something went wrong (${res.status}).`, res.status);
    }
    return res.status === 204 ? null : res.json();
  }

  function onUnauthorized() {
    if (!state.me?.user) return;
    state.me.user = null;
    renderAccountBar();
    route();
  }

  function showErr(box, msg) {
    box.hidden = !msg;
    const p = box.tagName === 'P' ? box : box.querySelector('p');
    if (p) p.textContent = msg || '';
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const fmtDate = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
  const fmtWhen = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

  const storyDef = (id) => state.lib?.stories.find((s) => s.id === id);
  const slotOf = (id) => state.book?.slots.find((s) => s.id === id);
  const isBusy = (s) => !!s && (s.status === 'queued' || s.status === 'running');
  const anyBusy = () => !!state.book && state.book.slots.some(isBusy);

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

  // ---------- top bar ----------
  function setBalance(cents) {
    if (state.me?.user && typeof cents === 'number') { state.me.user.balanceCents = cents; renderAccountBar(); renderPayLine(); }
  }

  function renderAccountBar() {
    const host = $('account');
    host.textContent = '';
    const user = state.me?.user;
    const signInUrl = state.me?.signInUrl || '/auth/google';
    $('cta-signin').href = signInUrl;
    if (!user) {
      const a = el('a', 'btn btn-primary btn-sm', 'Sign in with Google'); a.href = signInUrl;
      host.append(a);
      if (state.me?.devLogin) { const d = el('a', 'link-btn', 'Dev sign-in'); d.href = '/auth/dev-login'; host.append(d); }
      return;
    }
    const chip = el('a', 'balance-chip num'); chip.href = '/?view=account';
    chip.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><ellipse cx="10" cy="11" rx="6.2" ry="7.6"/></svg>';
    chip.append(el('span', null, money(user.balanceCents ?? 0)));
    chip.setAttribute('aria-label', `Balance ${money(user.balanceCents ?? 0)}. Open account and money.`);
    chip.dataset.low = String((user.balanceCents ?? 0) < (state.me.priceCents || 99));
    onNav(chip);
    const initial = (user.name || user.email || '?').trim().charAt(0).toUpperCase() || '?';
    let av;
    if (user.picture) {
      av = el('img', 'avatar'); av.alt = ''; av.referrerPolicy = 'no-referrer'; av.src = user.picture;
      av.addEventListener('error', () => av.replaceWith(el('span', 'avatar', initial)));
    } else av = el('span', 'avatar', initial);
    const out = el('button', 'btn btn-ghost btn-sm', 'Sign out'); out.type = 'button';
    out.addEventListener('click', async () => { try { await api('POST', '/auth/logout'); location.href = '/'; } catch (e) { showErr($('global-err'), e.message); } });
    host.append(chip, av, el('span', 'acct-name', user.name || user.email), out);
  }

  // ---------- views ----------
  function showView(name) {
    for (const v of ['out', 'shelf', 'book', 'account']) $(`view-${v}`).hidden = v !== name;
    if (name === 'out') document.title = 'A storybook starring your child';
    if (name === 'shelf') document.title = `My books | ${SITE}`;
    if (name === 'account') document.title = `Account and money | ${SITE}`;
  }

  function teardown() {
    clearTimeout(pollTimer); clearTimeout(shelfTimer);
    clearInterval(tickTimer); tickTimer = null;
    if (state.me?.user && state.bookId && state.about.dirty && !state.about.saving) saveAbout();
    clearTimeout(saveTimer);
    if ($('pic-dialog').open) $('pic-dialog').close();
    viewToken++;
    state.bookId = null; state.book = null; built = null; state.open = null;
  }

  function route() {
    teardown();
    showErr($('global-err'), '');
    if (!state.me?.user) { showView('out'); renderFan(); return; }
    const q = new URLSearchParams(location.search);
    if (q.get('book')) enterBook(q.get('book'));
    else if (q.get('view') === 'account') enterAccount(q.get('funding'));
    else enterShelf();
  }

  // ---------- landing ----------
  function renderFan() {
    const fan = $('fan');
    if (fan.childElementCount || !state.lib) return;
    for (const s of state.lib.stories) {
      const b = el('div', 'fan-book');
      if (s.coverUrl) { const img = el('img'); img.src = s.coverUrl; img.alt = ''; b.append(img); }
      b.append(el('span', null, s.title));
      fan.append(b);
    }
  }

  // ---------- new book ----------
  function buildStoryPick() {
    const host = $('story-pick');
    if (host.childElementCount || !state.lib) return;
    state.lib.stories.forEach((s, i) => {
      const label = el('label', 'story-opt');
      const input = el('input'); input.type = 'radio'; input.name = 'story'; input.value = s.id; input.checked = i === 0;
      const face = el('span', 'story-face');
      if (s.coverUrl) { const img = el('img'); img.src = s.coverUrl; img.alt = ''; img.loading = 'lazy'; face.append(img); } else face.append(el('span', 'ph'));
      face.append(el('b', null, s.title));
      label.append(input, face);
      host.append(label);
    });
    buildBible();
  }

  function buildBible() {
    const host = $('bible');
    host.textContent = '';
    for (const s of state.lib.stories) {
      if (!s.characters.length) continue;
      const head = el('p', 'legend', s.title); head.style.marginTop = '16px';
      host.append(head);
      const strip = el('div', 'bible');
      for (const c of s.characters) {
        const fig = el('figure');
        const img = el('img'); img.src = c.imageUrl; img.alt = c.description; img.loading = 'lazy'; img.width = 112; img.height = 112;
        fig.append(img, el('figcaption', null, c.name));
        strip.append(fig);
      }
      host.append(strip);
    }
  }

  function resizeToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image. Try a JPG or PNG.')); };
      img.src = url;
    });
  }

  async function handleFile(file) {
    showErr($('photo-error'), ''); showErr($('make-err'), '');
    if (!file) return;
    if (!file.type.startsWith('image/')) { showErr($('photo-error'), 'Please choose an image file.'); return; }
    try {
      state.photo = await resizeToDataUrl(file);
      $('photo-preview').src = state.photo; $('photo-preview').hidden = false;
      $('drop-empty').hidden = true; $('photo-clear').hidden = false;
      say('Photo added.');
      renderPayLine();
      if (!$('new-name').value.trim()) $('new-name').focus();
    } catch (e) { showErr($('photo-error'), e.message); }
  }

  function resetPhoto() {
    state.photo = null;
    $('photo-preview').hidden = true; $('photo-preview').removeAttribute('src');
    $('drop-empty').hidden = false; $('photo-clear').hidden = true; $('photo-input').value = '';
    renderPayLine();
  }

  function renderPayLine() {
    if (!state.me?.user) return;
    const price = state.me.priceCents || 99, bal = state.me.user.balanceCents ?? 0;
    const enough = bal >= price;
    const name = $('new-name').value.trim();
    $('pay-fund').hidden = enough;
    $('pay-note').textContent = enough
      ? `A book costs ${money(price)}. Your balance is ${money(bal)}.`
      : `A book costs ${money(price)} and your balance is ${money(bal)}. Add money first.`;
    const missing = !state.photo ? 'Add a photo' : !name ? "Add the child's name" : '';
    $('make-btn').disabled = !enough || !!missing || state.making;
    $('make-btn').textContent = state.making ? 'Starting your book…' : missing && enough ? missing : `Make my book for ${money(price)}`;
  }

  async function makeBook(e) {
    e.preventDefault();
    if (!state.photo || state.making) return;
    state.making = true; renderPayLine(); showErr($('make-err'), '');
    try {
      const story = document.querySelector('input[name="story"]:checked')?.value;
      const about = { name: $('new-name').value, age: $('new-age').value, favorites: $('new-favorites').value };
      const res = await api('POST', '/api/books', { photo: state.photo, story, about });
      setBalance(res.balanceCents);
      resetPhoto(); $('new-form').reset();
      navigate(`/?book=${encodeURIComponent(res.book.id)}`, res.book);
    } catch (err) {
      if (err.status !== 401) showErr($('make-err'), err.message);
    } finally { state.making = false; renderPayLine(); }
  }

  function wireNewBook() {
    const drop = $('drop');
    $('photo-input').addEventListener('change', (e) => handleFile(e.target.files[0]));
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('photo-input').click(); } });
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
    drop.addEventListener('drop', (e) => handleFile(e.dataTransfer?.files?.[0]));
    $('photo-clear').addEventListener('click', () => { resetPhoto(); $('photo-input').click(); });
    $('new-name').addEventListener('input', renderPayLine);
    $('new-form').addEventListener('submit', makeBook);
    onNav($('pay-fund'));
  }

  // ---------- shelf ----------
  function enterShelf() {
    const view = viewToken;
    showView('shelf');
    buildStoryPick();
    renderPayLine();
    $('shelf-loading').hidden = false; $('shelf').hidden = true; $('shelf-empty').hidden = true;
    showErr($('shelf-err'), '');
    loadShelf(view);
  }

  async function loadShelf(view) {
    try {
      const { books } = await api('GET', '/api/books');
      if (view !== viewToken) return;
      state.books = books;
      renderShelf();
    } catch (e) {
      if (view !== viewToken) return;
      $('shelf-loading').hidden = true;
      if (e.status !== 401) showErr($('shelf-err'), e.message);
    }
    if (view === viewToken && state.books?.some((b) => b.busy)) shelfTimer = setTimeout(() => loadShelf(view), SHELF_POLL_MS);
  }

  function renderShelf() {
    $('shelf-loading').hidden = true;
    const list = $('shelf');
    list.textContent = '';
    for (const b of state.books || []) {
      const li = el('li', 'book-card');
      const a = el('a'); a.href = `/?book=${encodeURIComponent(b.id)}`; onNav(a);
      const cover = el('div', 'cover');
      if (b.thumbUrl) { const img = el('img'); img.src = b.thumbUrl; img.alt = ''; img.loading = 'lazy'; cover.append(img); }
      else cover.append(el('div', 'cover-blank', b.busy ? 'Drawing…' : 'No pictures yet'));
      const ready = b.total > 0 && b.done >= b.total;
      const tag = el('span', 'tag', b.busy ? `Drawing, ${b.done} of ${b.total}` : ready ? 'Ready' : `${b.done} of ${b.total} pictures`);
      tag.dataset.kind = b.busy ? 'busy' : ready ? 'ok' : 'bad';
      a.append(cover, el('span', 'book-name', b.name || 'Untitled book'), el('span', 'book-meta', `${b.storyTitle}, ${fmtDate(b.createdAt)}`), tag);
      li.append(a);
      if (b.pdfUrl) { const dl = el('a', 'link-btn', 'Download PDF'); dl.href = b.pdfUrl; dl.setAttribute('download', ''); dl.setAttribute('aria-label', `Download the PDF of ${b.name || 'this book'}`); li.append(dl); }
      list.append(li);
    }
    list.hidden = !(state.books || []).length;
    $('shelf-empty').hidden = (state.books || []).length > 0;
  }

  // ---------- picture tiles ----------
  function makeTile(slotId, { shape } = {}) {
    const btn = el('button', 'pic'); btn.type = 'button';
    const frame = el('div', 'frame'); if (shape) frame.dataset.shape = shape;
    const wait = el('div', 'wait');
    const waitTitle = el('b'); const waitText = el('span');
    wait.append(waitTitle, waitText);
    const img = el('img'); img.alt = ''; img.decoding = 'async';
    img.addEventListener('load', () => img.classList.add('is-in'));
    const plate = el('p', 'plate'); plate.hidden = true;
    frame.append(wait, img, plate);
    const cap = el('div', 'pic-cap');
    const name = el('b'); const tries = el('span', 'tries');
    cap.append(name, tries);
    btn.append(frame, cap);
    btn.addEventListener('click', () => openDialog(slotId));
    return { btn, frame, wait, waitTitle, waitText, img, plate, name, tries };
  }

  // The attempt count on every picture: three dots and the words.
  function paintTries(host, s) {
    host.textContent = '';
    const busy = isBusy(s);
    const max = s.maxAttempts || 3;
    for (let i = 1; i <= max; i++) {
      const d = el('i');
      if (busy) d.dataset.d = i < s.attempt ? 'used' : i === s.attempt ? 'now' : '';
      else if (s.attempts) d.dataset.d = i === s.chosen ? (s.passed === false ? 'kept-weak' : 'kept') : i <= s.attempts ? 'used' : '';
      host.append(d);
    }
    let text = '';
    if (busy) text = s.attempt ? `Attempt ${s.attempt} of ${max}` : 'Waiting';
    else if (s.attempts) text = `${plural(s.attempts, 'attempt')} of ${max}`;
    else if (s.status === 'error') text = 'Failed';
    host.append(el('span', null, text));
    host.title = triesTitle(s);
  }

  function triesTitle(s) {
    if (isBusy(s) || !s.attempts) return '';
    if (s.source === 'template') return 'A ready-made template scene: your hero is not on this page.';
    if (s.attempts === 1) return 'Passed the check on the first drawing.';
    return s.passed ? `Passed the check on drawing ${s.chosen}.` : `None of the ${s.attempts} drawings passed every check, so the best one (drawing ${s.chosen}) was kept.`;
  }

  function busyText(s) {
    if (s.status === 'queued') return 'Waiting its turn';
    const n = s.attempt > 1 ? ` (attempt ${s.attempt})` : '';
    return s.phase === 'checking' ? `Checking${n}` : `Drawing${n}`;
  }

  function pageLine(p) {
    const name = ($('about-name')?.value ?? state.book?.about?.name ?? '').trim();
    return p.text.replaceAll('{name}', name || storyDef(state.book.story)?.heroRole || 'Jack');
  }

  function paintTile(t, s, page) {
    const has = !!s.thumbUrl;
    const busy = isBusy(s);
    t.frame.dataset.busy = String(busy);
    t.frame.dataset.has = String(has);
    t.frame.dataset.zone = has && page ? (s.zone || page.zone) : '';
    if (has && t.img.getAttribute('src') !== s.thumbUrl) { t.img.classList.remove('is-in'); t.img.src = s.thumbUrl; }
    if (!has) { t.img.removeAttribute('src'); t.img.classList.remove('is-in'); }
    t.wait.hidden = has && !busy;
    t.waitTitle.textContent = busy ? busyText(s) : s.status === 'error' ? 'Not drawn' : page ? page.title : 'Your hero';
    t.waitText.textContent = busy ? '' : s.status === 'error' ? 'Open to try again' : '';
    if (page) {
      t.plate.hidden = !has;
      t.plate.dataset.zone = s.zone || page.zone;
      t.plate.dataset.tone = s.tone || 'light';
      t.plate.textContent = pageLine(page);
      t.name.textContent = `Page ${page.number}`;
      t.btn.setAttribute('aria-label', `Page ${page.number}, ${page.title}. ${busy ? busyText(s) : s.attempts ? `${plural(s.attempts, 'attempt')} of ${s.maxAttempts}` : s.status}. Open details.`);
    } else {
      t.name.textContent = 'Your hero';
      t.btn.setAttribute('aria-label', `Your hero. ${busy ? busyText(s) : s.attempts ? `${plural(s.attempts, 'attempt')} of ${s.maxAttempts}` : s.status}. Open details.`);
    }
    paintTries(t.tries, s);
  }

  // ---------- one book ----------
  async function enterBook(id) {
    const view = viewToken;
    showView('book');
    state.bookId = id;
    $('book-title').textContent = 'Your book'; $('book-facts').textContent = '';
    $('book-body').hidden = true; $('book-loading').hidden = false;
    showErr($('book-err'), '');
    const seed = state.seed; state.seed = null;
    try {
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
    if (prev) for (const s of book.slots) {
      const before = prev.slots.find((p) => p.id === s.id)?.status;
      if (before !== s.status && s.status === 'done' && (before === 'running' || before === 'queued')) say(`${s.label} is ready.`);
    }
    if (prev?.busy && !book.busy) refreshBalance();
    renderBook();
    clearTimeout(pollTimer);
    if (book.busy) pollTimer = setTimeout(poll, POLL_MS);
    if (book.busy && !tickTimer) tickTimer = setInterval(() => { if (state.book) paintStage(); }, 250);
    if (!book.busy && tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  async function poll() {
    const id = state.bookId, rev = state.rev, view = viewToken;
    if (!id) return;
    try {
      const { book } = await api('GET', `/api/books/${encodeURIComponent(id)}`);
      if (view !== viewToken) return;
      if (rev !== state.rev) { pollTimer = setTimeout(poll, POLL_MS); return; }
      showErr($('book-err'), '');
      applyBook(book);
    } catch (e) {
      if (view !== viewToken || e.status === 401) return;
      showErr($('book-err'), `Could not refresh progress. ${e.message}`);
      if (e.status !== 404) pollTimer = setTimeout(poll, POLL_MS * 2);
    }
  }

  async function refreshBalance() {
    try { const me = await api('GET', '/api/me'); if (me.user) setBalance(me.user.balanceCents); } catch { /* the chip just stays as it was */ }
  }

  function buildBookView(book) {
    built = book.id;
    state.about = { dirty: false, saving: false };
    state.working = false;
    clearTimeout(saveTimer);
    for (const k of Object.keys(tiles)) delete tiles[k];
    const story = storyDef(book.story);

    const steps = $('stage-steps'); steps.textContent = '';
    for (const label of book.stage.steps) { const li = el('li'); li.append(el('span', null, label)); steps.append(li); }

    const heroHost = $('hero-slot'); heroHost.textContent = '';
    tiles.reference = makeTile('reference', { shape: 'square' });
    heroHost.append(tiles.reference.btn);

    const host = $('pages'); host.textContent = '';
    for (const p of story.pages) { tiles[p.id] = makeTile(p.id); host.append(tiles[p.id].btn); }

    const form = $('about-form'); form.textContent = '';
    for (const f of state.lib.about) {
      const wrap = el('label', 'field');
      wrap.append(el('span', null, f.label));
      const multi = f.max > 80;
      const input = multi ? el('textarea') : el('input');
      if (!multi) input.type = 'text'; else input.rows = f.id === 'about' ? 3 : 2;
      input.id = `about-${f.id}`; input.maxLength = f.max; input.value = book.about?.[f.id] || '';
      if (f.id === 'name') input.autocomplete = 'off';
      const count = el('span', 'counter', `${input.value.length}/${f.max}`);
      input.addEventListener('input', () => {
        count.textContent = `${input.value.length}/${f.max}`;
        state.about.dirty = true; setSaveStatus('');
        renderDownload();
        if (f.id === 'name') renderPictures();
        clearTimeout(saveTimer); saveTimer = setTimeout(saveAbout, SAVE_DEBOUNCE_MS);
      });
      wrap.append(input, count);
      form.append(wrap);
    }
    form.addEventListener('submit', (e) => e.preventDefault());
    setSaveStatus('');
  }

  const nowMs = () => Date.now() + state.clockOffset;

  // Reference = a fifth of the bar; the 20 pages share the rest. A picture being drawn
  // creeps forward on its expected time, so the bar never stands still.
  function slotFraction(s) {
    if (s.status === 'done') return 1;
    if (s.status === 'running' && s.startedAt != null) return Math.min(0.92, Math.max(0.04, (nowMs() - s.startedAt) / Math.max(1, s.estimateMs || 25000)));
    return 0;
  }

  function paintStage() {
    const b = state.book;
    const [ref, ...pages] = b.slots;
    const frac = b.pdfReady ? 1 : 0.2 * slotFraction(ref) + 0.8 * (pages.reduce((n, s) => n + slotFraction(s), 0) / pages.length);
    $('stage-bar').firstElementChild.style.transform = `scaleX(${frac.toFixed(3)})`;
    $('stage-bar').setAttribute('aria-valuenow', String(Math.round(frac * 100)));
    $('stage-bar').setAttribute('aria-valuetext', b.stage.label);
    let clock = '';
    if (b.busy) {
      const from = b.madeInMs == null ? b.createdAt : Math.min(...b.slots.filter(isBusy).map((s) => s.startedAt || nowMs()));
      const secs = Math.max(0, Math.floor((nowMs() - from) / 1000));
      clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    } else if (b.madeInMs != null) clock = `Made in ${Math.round(b.madeInMs / 1000)} seconds`;
    $('stage-clock').textContent = clock;
  }

  function renderStage() {
    const b = state.book;
    if ($('stage-label').textContent !== b.stage.label) $('stage-label').textContent = b.stage.label;
    const failed = b.slots.some((s) => s.status === 'error');
    $('stage').dataset.state = b.pdfReady ? 'done' : !b.busy && failed ? 'error' : 'busy';
    [...$('stage-steps').children].forEach((li, i) => {
      const step = b.stage.step;
      li.dataset.s = i < step || b.pdfReady ? 'done' : i === step ? 'now' : '';
      if (i === step && !b.pdfReady) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    paintStage();
  }

  function renderPictures() {
    const story = storyDef(state.book.story);
    paintTile(tiles.reference, slotOf('reference'), null);
    for (const p of story.pages) paintTile(tiles[p.id], slotOf(p.id), p);
    const ref = slotOf('reference');
    const name = state.book.about.name || 'Your child';
    $('hero-note').textContent = ref.status === 'error'
      ? 'The hero could not be drawn, so the pages are waiting. Try again, or use a clearer photo.'
      : `${name} as ${story.heroRole}. This one drawing is the reference for every page the hero is on, which is what keeps the same face throughout the book.`;
    showErr($('ref-err'), ref.status === 'error' ? ref.error : '');
    $('ref-retry').disabled = state.working || anyBusy();
    $('ref-retry').textContent = ref.status === 'error' ? 'Try again' : 'Try a different look';
    if (state.open) paintDialog();
  }

  function renderDownload() {
    const b = state.book;
    const hasName = (($('about-name')?.value) || '').trim().length > 0;
    const pending = state.about.dirty || state.about.saving;
    const allDrawn = b.slots.every((s) => s.imageUrl) && !b.busy;
    const ready = allDrawn && hasName && !pending;
    const link = $('pdf-btn');
    if (ready) { link.href = `/api/books/${encodeURIComponent(b.id)}/pdf`; link.removeAttribute('aria-disabled'); }
    else { link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); }
    $('need').textContent = ready ? '20 pages and About Me, one file' : b.busy ? 'Ready as soon as the pictures are' : !allDrawn ? 'Some pictures are missing' : !hasName ? "Add the child's name first" : 'Saving your changes…';
  }

  function renderCost() {
    const c = state.book.cost;
    const host = $('book-cost');
    host.textContent = '';
    const total = c.totalUsd || 0;
    const p = el('p', 'sub');
    p.textContent = `You paid ${money(c.priceCents)}. The picture and checking calls for this book cost us ${usd(total)}.`;
    const key = el('ul', 'key'); key.style.marginTop = '12px'; key.style.maxWidth = '26rem';
    const row = (label, n, v) => { const li = el('li'); li.append(el('span', null, `${label} (${n})`), el('span', 'num', usd(v))); return li; };
    key.append(row('First drawings', c.drawings, c.firstDrawingsUsd), row('Redraws after a failed check', c.retries, c.retriesUsd), row('Picture checks', c.checks, c.checksUsd));
    host.append(p, key);
    if (state.book.refunded) host.append(el('p', 'note', `This book could not be made, so the ${money(c.priceCents)} went back to your balance.`));
  }

  function renderBook() {
    const b = state.book;
    const story = storyDef(b.story);
    const name = (b.about?.name || '').trim();
    $('book-title').textContent = name ? `${name} in ${story.title}` : story.title;
    document.title = `${name || story.title} | ${SITE}`;
    const drawn = b.slots.filter((s) => s.imageUrl).length;
    $('book-facts').textContent = `Created ${fmtDate(b.createdAt)}. ${drawn} of ${b.slots.length} pictures drawn.`;
    renderStage(); renderPictures(); renderDownload(); renderCost();
  }

  // ---------- picture dialog ----------
  function openDialog(slotId) {
    state.open = slotId;
    $('dlg-fix').value = '';
    showErr($('dlg-err'), '');
    paintDialog();
    if (!$('pic-dialog').open) $('pic-dialog').showModal();
  }

  function paintDialog() {
    const s = slotOf(state.open);
    if (!s) return;
    const story = storyDef(state.book.story);
    const page = story.pages.find((p) => p.id === s.id) || null;
    const frame = $('dlg-frame');
    frame.textContent = '';
    frame.dataset.shape = page ? '' : 'square';
    frame.dataset.zone = page && s.imageUrl ? (s.zone || page.zone) : '';
    frame.dataset.busy = String(isBusy(s));
    frame.dataset.has = String(!!s.imageUrl);
    if (s.imageUrl) {
      const img = el('img', 'is-in'); img.src = s.imageUrl;
      img.alt = page ? `Page ${page.number}: ${page.title}` : 'Your child drawn as the hero';
      frame.append(img);
      if (page) { const plate = el('p', 'plate', pageLine(page)); plate.dataset.zone = s.zone || page.zone; plate.dataset.tone = s.tone || 'light'; frame.append(plate); }
    }
    if (!s.imageUrl || isBusy(s)) { const w = el('div', 'wait'); w.append(el('b', null, isBusy(s) ? busyText(s) : 'Not drawn yet')); frame.append(w); }

    $('dlg-where').textContent = page ? `Page ${page.number} of ${story.pages.length}` : 'The reference for every page';
    $('dlg-title').textContent = page ? page.title : `${state.book.about.name || 'Your child'} as ${story.heroRole}`;
    $('dlg-text').hidden = !page;
    if (page) $('dlg-text').textContent = pageLine(page);

    const max = s.maxAttempts || 3;
    $('dlg-verdict').textContent = isBusy(s) ? `${busyText(s)}. Up to ${max} drawings are made; each one is checked.`
      : s.status === 'error' ? (s.error || 'This picture could not be drawn.')
      : s.source === 'template' ? `The hero is not on this page, so it uses the ready-made template scene. That scene passed the same check when it was made (${plural(s.attempts, 'attempt')} of ${max}).`
      : s.attempts ? `${plural(s.attempts, 'attempt')} of ${max}. ${triesTitle(s)}${s.score != null ? ` Score ${Math.round(s.score)} of 100.` : ''}`
      : '';
    const list = $('dlg-checks');
    list.textContent = '';
    for (const h of s.history || []) {
      const li = el('li');
      li.dataset.kept = String(h.attempt === s.chosen);
      const head = el('b');
      head.append(el('span', null, `Drawing ${h.attempt}${h.attempt === s.chosen ? ', kept' : ''}`), el('span', null, h.error ? 'Failed to draw' : `${h.ok ? 'Passed' : 'Did not pass'}, ${Math.round(h.score)} of 100`));
      li.append(head, el('span', null, h.error || (h.issues?.length ? h.issues.join('; ') : h.summary || 'Looks right.')));
      list.append(li);
    }
    $('dlg-layout').parentElement.hidden = !page;
    if (page) $('dlg-layout').textContent = s.layoutReason ? `${s.layoutReason} The template planned the ${page.zone}.` : `The template plans the ${page.zone} of this page for the words. The place is confirmed once the picture is checked.`;

    const locked = state.working || isBusy(s) || (page && isBusy(slotOf('reference')));
    $('dlg-redo').hidden = !page;
    $('dlg-redo').disabled = locked;
    $('dlg-redo').textContent = s.imageUrl ? 'Draw this page again' : 'Draw this page';
    $('dlg-undo').hidden = !s.canUndo; $('dlg-undo').disabled = locked;
    $('dlg-full').hidden = !s.imageUrl; if (s.imageUrl) $('dlg-full').href = s.imageUrl;
    const canFix = page && s.imageUrl && page.hero;
    $('dlg-fix').closest('label').hidden = !canFix; $('dlg-apply').parentElement.hidden = !canFix;
    $('dlg-fix').disabled = locked; $('dlg-apply').disabled = locked;
  }

  // One place for every write on a book.
  async function mutate(method, tail, body, errBox) {
    if (state.working || !state.book) return false;
    const id = state.bookId;
    state.working = true; state.rev++;
    if (errBox) showErr(errBox, '');
    renderPictures();
    try {
      const res = await api(method, `/api/books/${encodeURIComponent(id)}${tail}`, body);
      state.working = false;
      if (id === state.bookId && res?.book) applyBook(res.book);
      return true;
    } catch (e) {
      state.working = false;
      if (id === state.bookId && e.status !== 401) { if (errBox) showErr(errBox, e.message); renderPictures(); }
      return false;
    }
  }

  function wireBook() {
    $('ref-retry').addEventListener('click', () => {
      const failed = slotOf('reference')?.status === 'error';
      if (!failed && !confirm('Draw a new hero? Every page the hero is on is drawn again too, so the book stays consistent.')) return;
      mutate('POST', '/generate', { slots: ['reference'] }, $('ref-err'));
    });
    $('dlg-close').addEventListener('click', () => $('pic-dialog').close());
    $('pic-dialog').addEventListener('close', () => { state.open = null; });
    $('pic-dialog').addEventListener('click', (e) => { if (e.target === $('pic-dialog')) $('pic-dialog').close(); });
    $('dlg-redo').addEventListener('click', () => mutate('POST', '/generate', { slots: [state.open] }, $('dlg-err')));
    $('dlg-undo').addEventListener('click', () => mutate('POST', '/undo', { pageId: state.open }, $('dlg-err')));
    $('dlg-apply').addEventListener('click', async () => {
      const instruction = $('dlg-fix').value.trim();
      if (instruction.length < 3) { showErr($('dlg-err'), 'Say what to change on this page.'); return; }
      if (await mutate('POST', '/fix', { pageId: state.open, instruction }, $('dlg-err'))) $('dlg-fix').value = '';
    });
    $('save-retry').addEventListener('click', saveAbout);
    $('delete-btn').addEventListener('click', async () => {
      if (!state.book || state.working) return;
      if (!confirm('Delete this book? The photo, the pictures and the PDF are removed for good. The $0.99 is not returned.')) return;
      try { await api('DELETE', `/api/books/${encodeURIComponent(state.bookId)}`); navigate('/'); } catch (e) { if (e.status !== 401) showErr($('book-err'), e.message); }
    });
    $('pdf-btn').addEventListener('click', (e) => { if ($('pdf-btn').getAttribute('aria-disabled') === 'true') e.preventDefault(); });
  }

  // ---------- about me (autosave) ----------
  function setSaveStatus(kind, msg) {
    $('save-status').textContent = kind === 'saved' ? 'Saved.' : kind === 'saving' ? 'Saving…' : kind === 'error' ? `Not saved. ${msg}` : '';
    $('save-retry').hidden = kind !== 'error';
  }

  async function saveAbout() {
    clearTimeout(saveTimer);
    const a = state.about, id = state.bookId;
    if (!id || !a.dirty || a.saving) return;
    const values = {};
    for (const f of state.lib.about) values[f.id] = ($(`about-${f.id}`)?.value || '').trim();
    a.dirty = false; a.saving = true;
    setSaveStatus('saving'); renderDownload();
    let failed = false;
    try {
      const { book } = await api('PATCH', `/api/books/${encodeURIComponent(id)}`, { about: values });
      if (id === state.bookId) { setSaveStatus(a.dirty ? '' : 'saved'); applyBook(book); }
    } catch (e) {
      failed = true; a.dirty = true;
      if (id === state.bookId && e.status !== 401) setSaveStatus('error', e.message);
    } finally {
      a.saving = false;
      if (id === state.bookId && state.book) { renderDownload(); if (a.dirty && !failed) saveAbout(); }
    }
  }

  // ---------- account and money ----------
  const FUNDING_NOTE = {
    paid: 'Payment received. The money is in your balance.',
    pending: 'Stripe has not confirmed that payment yet. It will show here once it does.',
    cancelled: 'Payment cancelled. Nothing was charged.',
    expired: 'That payment page expired. Nothing was charged.',
    unknown: 'We could not match that payment. Nothing was added.',
  };

  async function enterAccount(funding) {
    const view = viewToken;
    showView('account');
    $('acct-body').hidden = true; $('acct-loading').hidden = false;
    showErr($('acct-err'), '');
    $('acct-note').hidden = !funding; $('acct-note').textContent = FUNDING_NOTE[funding] || '';
    if (funding) history.replaceState(null, '', '/?view=account');
    await loadAccount(view);
  }

  async function loadAccount(view = viewToken) {
    try {
      const acct = await api('GET', '/api/account');
      if (view !== viewToken) return;
      state.account = acct;
      setBalance(acct.balanceCents);
      $('acct-loading').hidden = true; $('acct-body').hidden = false;
      renderAccount();
    } catch (e) {
      if (view !== viewToken || e.status === 401) return;
      $('acct-loading').hidden = true;
      showErr($('acct-err'), e.message);
    }
  }

  async function act(btn, work) {
    if (btn.disabled) return;
    btn.disabled = true; showErr($('acct-err'), '');
    try { await work(); } catch (e) { if (e.status !== 401) { showErr($('acct-err'), e.message); $('acct-err').scrollIntoView({ block: 'center' }); } }
    btn.disabled = false;
  }

  function renderAccount() {
    const a = state.account;
    $('bal-big').textContent = money(a.balanceCents);
    const books = Math.floor(a.balanceCents / a.priceCents);
    $('bal-sub').textContent = books > 0 ? `Enough for ${plural(books, 'book')} at ${money(a.priceCents)} each.` : `A book costs ${money(a.priceCents)}. Add money to make one.`;

    const fund = $('fund-row'); fund.textContent = '';
    if (a.stripeMode === 'off') fund.append(el('p', 'small', 'Payments are not set up on this server yet.'));
    else for (const cents of a.fundOptions) {
      const b = el('button', 'btn btn-primary', `Add ${money(cents)}`); b.type = 'button';
      b.addEventListener('click', () => act(b, async () => { const { url } = await api('POST', '/api/billing/checkout', { amountCents: cents }); location.href = url; }));
      fund.append(b);
    }
    $('fund-hint').textContent = a.stripeMode === 'off' ? '' : 'You pay by card on Stripe’s secure page, then come straight back here.';

    // what a book costs us, next to what we charge
    const c = a.costs, host = $('costs'); host.textContent = '';
    const s = c.site;
    const vs = el('div', 'vs');
    const left = el('div'); left.append(el('b', 'num', s.averageUsd == null ? '–' : usd(s.averageUsd)), el('span', null, s.books ? `average cost to make, over ${plural(s.books, 'book')}` : 'average cost to make (no books yet)'));
    const right = el('div'); right.append(el('b', 'num', money(c.priceCents)), el('span', null, 'what a book costs you'));
    vs.append(left, el('i', null, 'vs'), right);
    host.append(vs);
    if (s.books) {
      const total = s.totalUsd || 1;
      const split = el('div', 'split'); split.setAttribute('role', 'img');
      split.setAttribute('aria-label', `First drawings ${usd(s.firstDrawingsUsd)}, redraws ${usd(s.retriesUsd)}, checks ${usd(s.checksUsd)}`);
      for (const v of [s.firstDrawingsUsd, s.retriesUsd, s.checksUsd]) { const i = el('i'); i.style.width = `${(v / total) * 100}%`; split.append(i); }
      const key = el('ul', 'key');
      const row = (label, n, v) => { const li = el('li'); li.append(el('span', null, `${label}, ${(n / s.books).toFixed(1)} a book`), el('span', 'num', `${usd(v / s.books)}`)); return li; };
      key.append(row('First drawings', s.drawings, s.firstDrawingsUsd), row('Redraws after a failed check', s.retries, s.retriesUsd), row('Picture checks', s.checks, s.checksUsd));
      const margin = c.priceCents / 100 - s.averageUsd;
      host.append(split, key, el('p', 'small', `That leaves ${usd(Math.abs(margin))} ${margin >= 0 ? 'per book after API costs' : 'lost per book'}. Every image call, retry and check is logged with its token count; these are sums of that log.`));
      if (c.mine.books) host.append(el('p', 'small', `Your ${plural(c.mine.books, 'book')} cost ${usd(c.mine.totalUsd)} to make in total.`));
    }
    if (c.setupUsd) host.append(el('p', 'small', `Drawing the character bible and the 40 template scenes cost ${usd(c.setupUsd)} once, and is not counted per book.`));

    // refunds
    const pays = $('pay-list'); pays.textContent = '';
    for (const p of a.payments) {
      const li = el('li');
      const info = el('div');
      info.append(el('b', null, `${money(p.amountCents)} added ${fmtDate(p.paidAt)}`), el('div', 'small', p.refundableCents > 0 ? `${money(p.refundableCents)} is unspent and can be refunded.` : p.refundedCents >= p.amountCents ? 'Fully refunded.' : 'Nothing left to refund: it was spent on books or already refunded.'));
      li.append(info);
      if (p.refundableCents > 0) {
        const row = el('div', 'row');
        const why = el('input'); why.type = 'text'; why.maxLength = 200; why.placeholder = 'Reason (optional)'; why.style.width = '13rem'; why.setAttribute('aria-label', 'Reason for the refund');
        const b = el('button', 'btn btn-ghost btn-sm', `Request ${money(p.refundableCents)} refund`); b.type = 'button';
        b.addEventListener('click', () => act(b, async () => { await api('POST', '/api/billing/refunds', { paymentId: p.id, reason: why.value }); say('Refund requested.'); await loadAccount(); }));
        row.append(why, b); li.append(row);
      }
      pays.append(li);
    }
    if (!a.payments.length) pays.append(el('li', 'small', 'No payments yet, so nothing to refund.'));

    const refunds = $('refund-list'); refunds.textContent = '';
    for (const r of a.refunds) {
      const li = el('li');
      const info = el('div');
      const label = { requested: 'Requested, waiting to be processed', processing: 'Being processed', processed: 'Processed', failed: 'Failed' }[r.status] || r.status;
      const tag = el('span', 'tag', label); tag.dataset.kind = r.status === 'processed' ? 'ok' : r.status === 'failed' ? 'bad' : 'busy';
      const head = el('b', null, `Refund of ${money(r.amountCents)} `); head.append(tag);
      const bits = [`Requested ${fmtWhen(r.requestedAt)}`];
      if (r.email) bits.push(`by ${r.email}`);
      if (r.reason) bits.push(`“${r.reason}”`);
      if (r.processedAt && r.status === 'processed') bits.push(`sent back to the card ${fmtWhen(r.processedAt)}`);
      if (r.stripeRefundId) bits.push(`Stripe refund ${r.stripeRefundId}`);
      if (r.error) bits.push(r.error);
      info.append(head, el('div', 'small', bits.join('. ') + '.'));
      li.append(info);
      if (r.canProcess) {
        const b = el('button', 'btn btn-egg btn-sm', 'Process refund'); b.type = 'button';
        b.title = 'Sends the money back to the card it came from.';
        b.addEventListener('click', () => act(b, async () => { try { await api('POST', `/api/billing/refunds/${r.id}/process`); say('Refund processed.'); } finally { await loadAccount(); } }));
        li.append(b);
      }
      refunds.append(li);
    }

    // history
    const body = $('tx-body'); body.textContent = '';
    for (const t of a.transactions) {
      const tr = el('tr');
      const what = el('td', null, t.description);
      const cause = { fund: 'Credit: you added money', book: 'Debit: one book generated', book_refund: 'Credit: a book failed', refund: 'Debit: refund to your card', refund_reversal: 'Credit: a refund failed' }[t.kind] || t.kind;
      const detail = el('small', null, cause + (t.kind === 'refund' && t.refundStatus ? ` (${t.refundStatus})` : ''));
      what.append(detail);
      if (t.bookId && t.kind === 'book') { const a2 = el('a', 'link-btn', 'Open the book'); a2.href = `/?book=${encodeURIComponent(t.bookId)}`; a2.style.fontSize = '.85rem'; onNav(a2); what.append(a2); }
      const amt = el('td', 'amt', `${t.amountCents >= 0 ? '+' : ''}${money(t.amountCents)}`); amt.dataset.sign = t.amountCents >= 0 ? '+' : '-';
      tr.append(el('td', null, fmtWhen(t.at)), what, amt, el('td', 'amt', money(t.balanceAfterCents)));
      body.append(tr);
    }
    $('tx-empty').hidden = a.transactions.length > 0;
    body.closest('.table-wrap').hidden = !a.transactions.length;
  }

  // ---------- init ----------
  async function init() {
    wireNewBook(); wireBook();
    onNav($('brand')); onNav($('back-link')); onNav($('acct-back'));
    window.addEventListener('popstate', route);
    window.addEventListener('pagehide', () => { if (state.bookId && state.about.dirty) saveAbout(); });

    let meError = '';
    const [me, lib] = await Promise.allSettled([api('GET', '/api/me'), api('GET', '/api/stories')]);
    state.me = me.status === 'fulfilled' ? me.value : { user: null, signInUrl: '/auth/google', devLogin: false };
    if (me.status === 'rejected') meError = `Could not check your sign-in. ${me.reason.message}`;
    state.lib = lib.status === 'fulfilled' ? lib.value : null;
    if (!state.lib) meError = meError || 'Could not load the stories. Refresh the page to try again.';
    renderAccountBar();
    route();
    showErr($('global-err'), meError);
  }

  init();
})();
