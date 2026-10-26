/* A storybook starring your child.
   Flow: photo -> reference (1 call) -> pages (1 call each, user triggered) -> fixes -> PDF.
   There is NO automatic retry anywhere: every model call comes from one click. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const MAX_SIDE = 1024;

  const state = {
    book: null,          // { style, pages, about }
    photo: null,         // dataURL (resized JPEG)
    reference: null,     // dataURL
    pages: {},           // id -> { image, prev, text, busy, label, error, fixText, fixOpen }
    refBusy: false,
    refError: '',
    pdfBusy: false,
    epoch: 0,            // bumps when photo/reference change so stale responses are ignored
  };
  const cards = {};      // id -> element refs

  const say = (msg) => { $('status').textContent = ''; setTimeout(() => { $('status').textContent = msg; }, 20); };
  const anyBusy = () => state.refBusy || Object.values(state.pages).some((p) => p.busy);

  // ---------- api ----------
  async function api(path, body) {
    let res;
    try {
      res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      throw new Error('Could not reach the server. Check your connection and try again.');
    }
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).error; } catch { /* not json */ }
      if (res.status === 429) msg = msg || 'Too many requests right now. Wait a moment, then try again.';
      throw new Error(msg || `Something went wrong (${res.status}).`);
    }
    return res;
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
    const el = $('photo-error');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  async function handleFile(file) {
    showPhotoError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) { showPhotoError('Please choose an image file.'); return; }
    try {
      const data = await resizeToDataUrl(file);
      resetAll();
      state.photo = data;
      $('photo-preview').src = data;
      $('photo-preview').hidden = false;
      $('drop-empty').hidden = true;
      $('photo-clear').hidden = false;
      say('Photo added. Next, create your Jack.');
      renderAll();
    } catch (e) {
      showPhotoError(e.message);
    }
  }

  function resetAll() {
    state.epoch++;
    state.reference = null;
    state.refBusy = false;
    state.refError = '';
    state.photo = null;
    resetPages();
    $('photo-preview').hidden = true;
    $('photo-preview').removeAttribute('src');
    $('drop-empty').hidden = false;
    $('photo-clear').hidden = true;
    $('photo-input').value = '';
    $('camera-input').value = '';
  }

  function resetPages() {
    state.epoch++;
    for (const p of state.book?.pages || []) {
      state.pages[p.id] = { image: null, prev: null, text: p.text, busy: false, label: '', error: '', fixText: '', fixOpen: false };
    }
  }

  // ---------- reference ----------
  async function makeReference() {
    if (!state.photo || anyBusy()) return;
    const epoch = ++state.epoch;
    const hadOne = !!state.reference;
    state.refBusy = true; state.refError = '';
    $('ref-busy-text').textContent = hadOne
      ? 'Drawing a new look. About 30 seconds.'
      : 'Drawing your Jack. About 30 seconds, or up to a minute if the server is waking up.';
    renderAll();
    say('Creating your Jack.');
    let stale = false;
    try {
      const res = await api('/api/book/reference', { photo: state.photo });
      const { image } = await res.json();
      if (epoch !== state.epoch) { stale = true; return; }
      state.reference = image;
      state.refBusy = false;
      resetPages(); // pages must match the reference they were made from
      say('Your Jack is ready.');
    } catch (e) {
      if (epoch !== state.epoch) { stale = true; return; }
      state.refError = e.message;
      say('Could not create your Jack. ' + e.message);
    } finally {
      if (!stale) { state.refBusy = false; renderAll(); }
    }
  }

  // ---------- pages ----------
  // Each page is an edit built on the reference, the photo AND every earlier page,
  // so the mother, the cow, the cottage and Jack carry over from page to page.
  function earlierIds(pageId) {
    const ids = state.book.pages.map((p) => p.id);
    return ids.slice(0, ids.indexOf(pageId));
  }
  const missingEarlier = (pageId) => earlierIds(pageId).find((id) => !state.pages[id]?.image);

  async function makePage(pageId) {
    const st = state.pages[pageId];
    if (!st || st.busy || !state.reference || !state.photo) return false;
    const missing = missingEarlier(pageId);
    if (missing) { st.error = `Make page ${pageNumber(missing)} first: each page builds on the pages before it.`; renderCard(pageId); return false; }
    const previous = earlierIds(pageId).map((id) => state.pages[id].image);
    const epoch = state.epoch;
    st.busy = true; st.label = 'Painting this page. About 30 to 45 seconds.'; st.error = '';
    renderCard(pageId);
    renderStep3Controls();
    try {
      const res = await api('/api/book/page', { pageId, reference: state.reference, photo: state.photo, previous });
      const data = await res.json();
      if (epoch !== state.epoch) return;
      st.image = data.image; st.prev = null; st.text = data.text || st.text;
      say(`Page ${pageNumber(pageId)} is ready.`);
      return true;
    } catch (e) {
      if (epoch !== state.epoch) return false;
      st.error = e.message;
      say(`Page ${pageNumber(pageId)} failed. ${e.message}`);
      return false;
    } finally {
      if (epoch === state.epoch) { st.busy = false; renderAll(); }
    }
  }

  // Pages in order, one call each (each needs the pages before it). Stops at the
  // first failure; no automatic retries anywhere.
  async function makeAll() {
    for (const { id } of state.book.pages) {
      if (state.pages[id]?.image) continue;
      if (!(await makePage(id))) return;
    }
  }

  async function applyFix(pageId) {
    const st = state.pages[pageId];
    const instruction = (st.fixText || '').trim();
    if (!st || st.busy || !st.image) return;
    if (instruction.length < 3) { st.error = 'Say what to change on this page.'; renderCard(pageId); return; }
    const epoch = state.epoch;
    st.busy = true; st.label = 'Applying your fix. About 30 to 45 seconds.'; st.error = '';
    renderCard(pageId); renderStep3Controls();
    try {
      const res = await api('/api/book/fix', { pageId, page: st.image, reference: state.reference, instruction: instruction.slice(0, 300) });
      const data = await res.json();
      if (epoch !== state.epoch) return;
      st.prev = st.image; st.image = data.image; st.text = data.text || st.text; st.fixText = '';
      say(`Page ${pageNumber(pageId)} updated.`);
    } catch (e) {
      if (epoch !== state.epoch) return;
      st.error = e.message;
      say(`The fix failed. ${e.message}`);
    } finally {
      if (epoch === state.epoch) { st.busy = false; renderAll(); }
    }
  }

  function undoFix(pageId) {
    const st = state.pages[pageId];
    if (!st || st.busy || !st.prev) return;
    st.image = st.prev; st.prev = null; st.error = '';
    renderCard(pageId); renderStep3Controls();
    say(`Page ${pageNumber(pageId)} restored to the version before the fix.`);
  }

  const pageNumber = (id) => state.book.pages.find((p) => p.id === id)?.number;

  // ---------- rendering ----------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function buildCards() {
    const host = $('pages');
    host.textContent = '';
    for (const p of state.book.pages) {
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
      meta.append(h3, el('div', 'where', `Page ${p.number} of ${state.book.pages.length}`));

      const actions = el('div', 'page-actions');
      const make = el('button', 'btn btn-primary btn-sm', `Make page ${p.number}`); make.type = 'button';
      const redo = el('button', 'btn btn-ghost btn-sm', 'Redo page'); redo.type = 'button';
      make.addEventListener('click', () => makePage(p.id));
      redo.addEventListener('click', () => makePage(p.id));
      actions.append(make, redo);

      const err = el('div', 'err'); err.setAttribute('role', 'alert'); err.hidden = true;
      const errText = el('p');
      const errBtn = el('button', 'btn btn-ghost btn-sm', 'Try again'); errBtn.type = 'button';
      errBtn.addEventListener('click', () => (state.pages[p.id].image && state.pages[p.id].fixText.trim().length >= 3 && state.pages[p.id].lastAction === 'fix' ? applyFix(p.id) : makePage(p.id)));
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
      body.append(ta, row);
      fix.append(sum, body);

      ta.addEventListener('input', () => { state.pages[p.id].fixText = ta.value; count.textContent = `${ta.value.length}/300`; });
      fix.addEventListener('toggle', () => { state.pages[p.id].fixOpen = fix.open; });
      apply.addEventListener('click', () => { state.pages[p.id].lastAction = 'fix'; applyFix(p.id); });
      make.addEventListener('click', () => { state.pages[p.id].lastAction = 'page'; });
      redo.addEventListener('click', () => { state.pages[p.id].lastAction = 'page'; });
      undo.addEventListener('click', () => undoFix(p.id));

      card.append(frame, meta, actions, err, fix);
      host.append(card);
      cards[p.id] = { blank, img, overlay, veil, veilText, make, redo, err, errText, errBtn, fix, ta, count, apply, undo };
    }
  }

  function renderCard(id) {
    const st = state.pages[id], c = cards[id];
    if (!st || !c) return;
    const has = !!st.image;
    c.img.hidden = !has; c.overlay.hidden = !has; c.blank.hidden = has;
    if (has) { if (c.img.getAttribute('src') !== st.image) c.img.src = st.image; c.overlay.textContent = st.text; }
    c.veil.hidden = !st.busy; c.veilText.textContent = st.label;
    c.make.hidden = has; c.redo.hidden = !has;
    const lock = st.busy || state.refBusy || !state.reference || anyBusy();
    const blockedBy = state.book ? missingEarlier(id) : null;
    c.make.disabled = lock || !!blockedBy; c.redo.disabled = lock;
    c.make.title = blockedBy ? `Make page ${pageNumber(blockedBy)} first` : '';
    c.make.setAttribute('aria-busy', String(st.busy));
    c.err.hidden = !st.error; c.errText.textContent = st.error || '';
    c.errBtn.disabled = st.busy;
    c.fix.hidden = !has;
    if (c.fix.open !== st.fixOpen) c.fix.open = st.fixOpen;
    if (c.ta.value !== st.fixText) { c.ta.value = st.fixText; c.count.textContent = `${st.fixText.length}/300`; }
    c.ta.disabled = st.busy; c.apply.disabled = st.busy;
    c.undo.hidden = !st.prev; c.undo.disabled = st.busy;
  }

  function renderStep3Controls() {
    const ready = !!state.reference;
    $('step-story').dataset.locked = String(!ready);
    $('make-all').disabled = !ready || anyBusy();
    const allDone = state.book && state.book.pages.every((p) => state.pages[p.id]?.image);
    $('make-all').hidden = !!allDone;
  }

  function renderRef() {
    const hasPhoto = !!state.photo;
    $('step-ref').dataset.locked = String(!hasPhoto);
    const has = !!state.reference;
    $('ref-img').hidden = !has;
    if (has && $('ref-img').getAttribute('src') !== state.reference) $('ref-img').src = state.reference;
    $('ref-empty').hidden = has;
    $('ref-busy').hidden = !state.refBusy;
    $('ref-btn').hidden = has;
    $('ref-btn').disabled = !hasPhoto || anyBusy();
    $('ref-retry').hidden = !has;
    $('ref-retry').disabled = anyBusy();
    $('ref-note').hidden = !has;
    const e = $('ref-err');
    e.hidden = !state.refError;
    e.querySelector('p').textContent = state.refError;
    $('ref-err-retry').disabled = anyBusy();
  }

  function aboutValues() {
    const v = {};
    for (const f of state.book?.about || []) v[f.id] = ($(`about-${f.id}`)?.value || '').trim();
    return v;
  }

  function renderDownload() {
    const allPages = state.book && state.book.pages.every((p) => state.pages[p.id]?.image);
    const name = (aboutValues().name || '').length > 0;
    const missing = [];
    if (!allPages) missing.push('make all 3 pages');
    if (!name) missing.push("add your child's name");
    $('pdf-btn').disabled = !(allPages && name) || state.pdfBusy || anyBusy();
    $('pdf-btn').textContent = state.pdfBusy ? 'Building your PDF...' : 'Download the book (PDF)';
    $('need').textContent = missing.length ? `To download: ${missing.join(' and ')}.` : 'Ready when you are.';
  }

  function renderAll() {
    renderRef();
    for (const id of Object.keys(cards)) renderCard(id);
    renderStep3Controls();
    renderDownload();
  }

  // ---------- about form ----------
  function buildAbout() {
    const form = $('about-form');
    form.textContent = '';
    for (const f of state.book.about) {
      const wrap = el('div', 'field');
      const label = el('label'); label.htmlFor = `about-${f.id}`;
      label.textContent = f.label;
      if (f.required) { const r = el('span', 'req', ' *'); r.setAttribute('aria-hidden', 'true'); label.append(r); }
      const multi = f.id === 'about' || f.id === 'favorites' || f.max > 80;
      const input = multi ? el('textarea') : el('input');
      if (!multi) { input.type = f.id === 'age' ? 'text' : 'text'; }
      if (multi) input.rows = f.id === 'about' ? 4 : 3;
      input.id = `about-${f.id}`; input.name = f.id; input.maxLength = f.max;
      if (f.required) input.required = true;
      if (f.id === 'name') input.autocomplete = 'off';
      const count = el('span', 'counter', `0/${f.max}`); count.id = `count-${f.id}`;
      input.setAttribute('aria-describedby', count.id);
      input.addEventListener('input', () => { count.textContent = `${input.value.length}/${f.max}`; renderDownload(); });
      wrap.append(label, input, count);
      form.append(wrap);
    }
    form.addEventListener('submit', (e) => e.preventDefault());
  }

  // ---------- pdf ----------
  async function downloadPdf() {
    if (state.pdfBusy) return;
    const err = $('pdf-err');
    err.hidden = true;
    state.pdfBusy = true; renderDownload();
    say('Building your PDF.');
    try {
      const res = await api('/api/book/pdf', {
        reference: state.reference,
        pages: state.book.pages.map((p) => ({ pageId: p.id, image: state.pages[p.id].image })),
        about: aboutValues(),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'JackAndTheBeanstalk.pdf';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      say('Your book was downloaded.');
    } catch (e) {
      err.querySelector('p').textContent = e.message;
      err.hidden = false;
      say('The PDF could not be built. ' + e.message);
    } finally {
      state.pdfBusy = false; renderDownload();
    }
  }

  // ---------- init ----------
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
    $('photo-clear').addEventListener('click', () => { resetAll(); showPhotoError(''); renderAll(); $('photo-input').click(); });
  }

  async function init() {
    wireUpload();
    $('ref-btn').addEventListener('click', makeReference);
    $('ref-retry').addEventListener('click', makeReference);
    $('ref-err-retry').addEventListener('click', makeReference);
    $('make-all').addEventListener('click', () => { makeAll(); });
    $('pdf-btn').addEventListener('click', downloadPdf);
    try {
      const res = await fetch('/api/book');
      if (!res.ok) throw new Error();
      state.book = await res.json();
    } catch {
      $('style-text').textContent = 'The story could not be loaded. Refresh the page to try again.';
      return;
    }
    $('style-text').textContent = state.book.style;
    resetPages();
    buildCards();
    buildAbout();
    renderAll();
  }

  init();
})();
