// Jack and the Beanstalk: front end.
// Rules this file follows on purpose:
//  - one click = exactly one request; there is NO automatic retry anywhere;
//  - the scene caption is shown (and downloaded) exactly as the server sent it.

const MAX_SIDE = 1024;
const JPEG_QUALITY = 0.9;

const SCENE_BUTTONS = {
  plant: { make: 'Plant the beans', again: 'Plant them again' },
  climb: { make: 'Climb the beanstalk', again: 'Climb again' },
};

const PALETTE_DOTS = { vivid: '#D9442B', pastel: '#F3C6D3', earthy: '#8A6B2E' };

const $ = (sel, root = document) => root.querySelector(sel);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const state = {
  options: null,
  photo: null, // data URL (resized JPEG)
  settings: {},
  cartoon: { status: 'idle', image: null, settings: null, error: null },
  scenes: {}, // id -> { status, result, error }
  epoch: 0, // bumped whenever the photo changes, so stale responses are ignored
};

const el = {
  status: $('#status'),
  steps: [...document.querySelectorAll('#steps .step')],
  dropzone: $('#dropzone'),
  fileInput: $('#file-input'),
  cameraInput: $('#camera-input'),
  dropEmpty: $('#drop-empty'),
  preview: $('#photo-preview'),
  clear: $('#photo-clear'),
  photoError: $('#photo-error'),
  optionsError: $('#options-error'),
  optionsRetry: $('#options-retry'),
  cartoonBtn: $('#cartoon-btn'),
  cartoonHint: $('#cartoon-hint'),
  cartoonStage: $('#cartoon-stage'),
  cartoonError: $('#cartoon-stage').parentElement.querySelector('[data-part="error"]'),
  cartoonDownload: $('#cartoon-download'),
  cartoonRetry: $('#cartoon-retry'),
  bothBtn: $('#both-btn'),
  scenesHint: $('#scenes-hint'),
  sceneGrid: $('#scene-grid'),
};

const part = (root, name) => root.querySelector(`[data-part="${name}"]`);
const announce = (msg) => { el.status.textContent = ''; setTimeout(() => { el.status.textContent = msg; }, 30); };

/* ------------------------------------------------------------------ */
/* Network                                                              */
/* ------------------------------------------------------------------ */

async function api(url, body) {
  let res;
  try {
    res = await fetch(url, body === undefined ? undefined : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection, then try again.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    throw new Error((data && data.error) || `The server answered with an error (${res.status}). Try again in a moment.`);
  }
  if (!data) throw new Error('The server sent back something unexpected. Try again.');
  return data;
}

/* ------------------------------------------------------------------ */
/* Options -> controls                                                  */
/* ------------------------------------------------------------------ */

async function loadOptions() {
  el.optionsError.hidden = true;
  try {
    state.options = await api('/api/options');
  } catch (err) {
    part(el.optionsError, 'msg').textContent = `Could not load the settings. ${err.message}`;
    el.optionsError.hidden = false;
    return;
  }
  const o = state.options;
  state.settings = { ...o.defaults };
  renderGroup('opt-style', 'style', o.styles, 'card');
  renderGroup('opt-exaggeration', 'exaggeration', o.exaggeration);
  renderGroup('opt-palettes', 'palette', o.palettes, 'dots');
  renderGroup('opt-lines', 'lines', o.lines);
  buildSceneCards(o.scenes);
  render();
}

function renderGroup(containerId, key, items, mode) {
  const box = document.getElementById(containerId);
  box.textContent = '';
  for (const item of items) {
    const label = document.createElement('label');
    label.className = 'opt';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = key;
    input.value = item.id;
    input.checked = state.settings[key] === item.id;
    input.addEventListener('change', () => { state.settings[key] = item.id; render(); });
    const face = document.createElement('span');
    face.className = 'opt-face';
    if (mode === 'dots' && PALETTE_DOTS[item.id]) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = PALETTE_DOTS[item.id];
      dot.setAttribute('aria-hidden', 'true');
      face.append(dot);
    }
    face.append(document.createTextNode(mode === 'card' ? item.label : cap(item.label)));
    label.append(input, face);
    box.append(label);
  }
}

function buildSceneCards(scenes) {
  el.sceneGrid.textContent = '';
  for (const s of scenes) {
    state.scenes[s.id] = { status: 'idle', result: null, error: null, meta: s };
    const card = document.createElement('article');
    card.className = 'scene-card';
    card.dataset.scene = s.id;
    card.setAttribute('aria-labelledby', `scene-title-${s.id}`);
    card.innerHTML = `
      <h3 class="scene-title font-display" id="scene-title-${s.id}"></h3>
      <div class="scene-body" aria-live="polite">
        <div data-part="idle">
          <p class="spec-label">What the picture will show</p>
          <blockquote class="spec" data-part="spec"></blockquote>
        </div>
        <div class="loader-block" data-part="loading" hidden>
          <div class="sprout" aria-hidden="true">
            <svg viewBox="0 0 80 100" width="76" height="96"><g class="sprout-stem"><path d="M40 90 C 30 70, 52 58, 40 36" fill="none" stroke="#2D5B35" stroke-width="5" stroke-linecap="round"/><path class="sprout-leaf a" d="M40 56 C 24 46, 12 50, 8 58 C 20 68, 34 66, 40 56Z" fill="#5C8A3E"/><path class="sprout-leaf b" d="M42 42 C 56 30, 70 32, 74 40 C 62 52, 48 52, 42 42Z" fill="#2D5B35"/></g><ellipse class="sprout-bean" cx="40" cy="92" rx="14" ry="8" fill="#D9A21B"/></svg>
          </div>
          <p class="loader-title font-display">Painting the scene&hellip;</p>
          <p class="loader-note">About 10 to 30 seconds. If the server has been asleep, the first picture can take up to a minute.</p>
        </div>
        <figure class="plate" data-part="done" hidden>
          <div class="plate-frame"><img data-part="img" alt=""></div>
          <figcaption data-part="caption"></figcaption>
        </figure>
      </div>
      <p class="inline-error" data-part="error" role="alert" hidden></p>
      <div class="scene-actions">
        <button type="button" class="btn btn-primary" data-act="make"></button>
        <button type="button" class="btn btn-ghost" data-act="download" hidden>Download</button>
        <button type="button" class="btn btn-ghost" data-act="retry" hidden>Try again</button>
      </div>`;
    $('.scene-title', card).textContent = s.title;
    part(card, 'spec').textContent = s.spec;
    $('[data-act="make"]', card).addEventListener('click', () => makeScene(s.id));
    $('[data-act="download"]', card).addEventListener('click', () => downloadScene(s.id));
    $('[data-act="retry"]', card).addEventListener('click', () => makeScene(s.id));
    el.sceneGrid.append(card);
  }
}

/* ------------------------------------------------------------------ */
/* Photo handling                                                       */
/* ------------------------------------------------------------------ */

function showPhotoError(msg) {
  el.photoError.textContent = msg || '';
  el.photoError.hidden = !msg;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = src;
  });
}

async function fileToResizedDataUrl(file) {
  let source;
  let w;
  let h;
  if ('createImageBitmap' in window) {
    try {
      source = await createImageBitmap(file, { imageOrientation: 'from-image' });
      w = source.width; h = source.height;
    } catch { source = null; }
  }
  if (!source) {
    const url = URL.createObjectURL(file);
    try {
      source = await loadImage(url);
      w = source.naturalWidth; h = source.naturalHeight;
    } finally { URL.revokeObjectURL(url); }
  }
  if (!w || !h) throw new Error('empty image');
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // flatten transparency before JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (source.close) source.close();
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

async function handleFile(file) {
  if (!file) return;
  showPhotoError('');
  const looksLikeImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
  if (!looksLikeImage) {
    showPhotoError('That file is not an image. Choose a JPEG, PNG or WebP photo.');
    return;
  }
  try {
    const dataUrl = await fileToResizedDataUrl(file);
    resetAll(dataUrl);
    announce('Photo added. You can cartoonify it now.');
  } catch {
    const heic = /heic|heif/i.test(file.type + file.name);
    showPhotoError(heic
      ? 'This browser cannot read HEIC photos. Save or export it as a JPEG and add it again. On iPhone, Settings, Camera, Formats, Most Compatible.'
      : 'That image could not be read. Try a different JPEG, PNG or WebP photo.');
  }
}

// Changing the photo starts the story over.
function resetAll(newPhoto) {
  state.epoch += 1;
  state.photo = newPhoto;
  state.cartoon = { status: 'idle', image: null, settings: null, error: null };
  for (const s of Object.values(state.scenes)) { s.status = 'idle'; s.result = null; s.error = null; }
  render();
}

function wirePhotoInputs() {
  for (const input of [el.fileInput, el.cameraInput]) {
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      input.value = ''; // allow choosing the same file again
      handleFile(file);
    });
  }
  const dz = el.dropzone;
  ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('is-over'); }));
  ['dragleave', 'dragend'].forEach((t) => dz.addEventListener(t, () => dz.classList.remove('is-over')));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('is-over');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(file);
  });
  el.clear.addEventListener('click', () => {
    showPhotoError('');
    resetAll(null);
    announce('Photo removed.');
    el.fileInput.focus();
  });
}

/* ------------------------------------------------------------------ */
/* Cartoon                                                              */
/* ------------------------------------------------------------------ */

async function cartoonify() {
  if (!state.photo || state.cartoon.status === 'loading') return;
  const epoch = state.epoch;
  const settings = { ...state.settings };
  state.cartoon.status = 'loading';
  state.cartoon.error = null;
  render();
  announce('Drawing your cartoon. This can take up to a minute.');
  try {
    const data = await api('/api/cartoon', { photo: state.photo, settings });
    if (epoch !== state.epoch) return;
    // A new cartoon makes the old scenes stale, so they start fresh.
    for (const s of Object.values(state.scenes)) { s.status = 'idle'; s.result = null; s.error = null; }
    state.cartoon = { status: 'done', image: data.image, settings: data.settings || settings, error: null };
    announce('Your cartoon is ready.');
  } catch (err) {
    if (epoch !== state.epoch) return;
    state.cartoon.status = 'error';
    state.cartoon.error = err.message;
    announce(`Could not make the cartoon. ${err.message}`);
  }
  render();
}

function cartoonCaption() {
  const s = state.cartoon.settings;
  const o = state.options;
  if (!s || !o) return '';
  const label = (list, id) => (list.find((x) => x.id === id) || {}).label || id;
  return [label(o.styles, s.style), `${cap(s.exaggeration)} exaggeration`, `${cap(s.palette)} colors`, `${cap(s.lines)} lines`].join(' · ');
}

/* ------------------------------------------------------------------ */
/* Scenes                                                               */
/* ------------------------------------------------------------------ */

async function makeScene(id) {
  const sc = state.scenes[id];
  if (!sc || sc.status === 'loading' || state.cartoon.status !== 'done') return;
  const epoch = state.epoch;
  sc.status = 'loading';
  sc.error = null;
  render();
  announce(`Painting: ${sc.meta.title}.`);
  try {
    const data = await api('/api/scene', {
      sceneId: id,
      photo: state.photo,
      cartoon: state.cartoon.image,
      settings: state.cartoon.settings,
    });
    if (epoch !== state.epoch) return;
    sc.result = { image: data.image, title: data.title, caption: data.caption };
    sc.status = 'done';
    announce(`${sc.meta.title} is ready.`);
  } catch (err) {
    if (epoch !== state.epoch) return;
    sc.status = 'error';
    sc.error = err.message;
    announce(`Could not paint ${sc.meta.title}. ${err.message}`);
  }
  render();
}

// Two explicit calls, one per scene. No loop, no retry.
function makeBothScenes() {
  return Promise.allSettled([makeScene('plant'), makeScene('climb')]);
}

/* ------------------------------------------------------------------ */
/* Rendering                                                            */
/* ------------------------------------------------------------------ */

function render() {
  const hasPhoto = Boolean(state.photo);
  const c = state.cartoon;
  const cartoonBusy = c.status === 'loading';
  const sceneList = Object.values(state.scenes);
  const anySceneBusy = sceneList.some((s) => s.status === 'loading');
  const optionsReady = Boolean(state.options);

  // steps
  const current = !hasPhoto ? 1 : c.status !== 'done' ? 2 : 3;
  el.steps.forEach((li, i) => {
    const n = i + 1;
    const st = n < current ? 'done' : n === current ? 'current' : 'upcoming';
    li.dataset.state = st;
    if (st === 'current') li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });

  // photo
  el.preview.hidden = !hasPhoto;
  el.dropEmpty.hidden = hasPhoto;
  el.dropzone.classList.toggle('has-photo', hasPhoto);
  if (hasPhoto) { if (el.preview.src !== state.photo) el.preview.src = state.photo; } else { el.preview.removeAttribute('src'); }
  el.clear.hidden = !hasPhoto;

  // settings
  document.querySelectorAll('#settings-form input[type="radio"]').forEach((r) => { r.disabled = cartoonBusy; });
  el.cartoonBtn.disabled = !hasPhoto || cartoonBusy || !optionsReady;
  el.cartoonBtn.textContent = cartoonBusy ? 'Drawing…' : c.status === 'done' ? 'Cartoonify again' : 'Cartoonify me';
  el.cartoonHint.textContent = !hasPhoto ? 'Add a photo first.'
    : c.status === 'done' ? 'Changed your mind? Pick new settings and cartoonify again.'
    : 'One click makes one picture.';

  // cartoon stage
  const stage = el.cartoonStage;
  part(stage, 'empty').hidden = c.status !== 'idle' && c.status !== 'error' || Boolean(c.image);
  part(stage, 'loading').hidden = !cartoonBusy;
  const showFig = Boolean(c.image) && !cartoonBusy;
  part(stage, 'done').hidden = !showFig;
  if (c.image) {
    const img = part(stage, 'img');
    if (img.src !== c.image) img.src = c.image;
    part(stage, 'caption').textContent = cartoonCaption();
    part(stage, 'caption').classList.add('small');
  }
  if (cartoonBusy) part(stage, 'empty').hidden = true;
  el.cartoonError.textContent = c.error || '';
  el.cartoonError.hidden = !(c.status === 'error' && c.error);
  el.cartoonRetry.hidden = c.status !== 'error';
  el.cartoonDownload.hidden = !showFig;

  // scenes
  const ready = c.status === 'done';
  el.bothBtn.disabled = !ready || anySceneBusy;
  el.bothBtn.textContent = anySceneBusy ? 'Painting…' : 'Make both scenes';
  el.scenesHint.textContent = ready ? 'Or use the button on each card to make one at a time.' : 'Make your cartoon first.';

  for (const [id, sc] of Object.entries(state.scenes)) {
    const card = el.sceneGrid.querySelector(`[data-scene="${id}"]`);
    if (!card) continue;
    const busy = sc.status === 'loading';
    const hasResult = Boolean(sc.result);
    part(card, 'idle').hidden = busy || hasResult;
    part(card, 'loading').hidden = !busy;
    part(card, 'done').hidden = busy || !hasResult;
    if (hasResult) {
      const img = part(card, 'img');
      if (img.src !== sc.result.image) img.src = sc.result.image;
      img.alt = `Illustration: ${sc.result.title}`;
      part(card, 'caption').textContent = sc.result.caption; // verbatim from the server
    }
    const err = part(card, 'error');
    err.textContent = sc.error || '';
    err.hidden = !(sc.status === 'error' && sc.error);

    const make = $('[data-act="make"]', card);
    const labels = SCENE_BUTTONS[id] || { make: sc.meta.title, again: 'Paint it again' };
    make.textContent = busy ? 'Painting…' : hasResult ? labels.again : labels.make;
    make.disabled = !ready || busy;
    make.hidden = sc.status === 'error';
    $('[data-act="retry"]', card).hidden = sc.status !== 'error';
    $('[data-act="download"]', card).hidden = !hasResult || busy;
  }
}

/* ------------------------------------------------------------------ */
/* Downloads                                                            */
/* ------------------------------------------------------------------ */

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const canvasToBlob = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/png'));

async function downloadCartoon() {
  if (!state.cartoon.image) return;
  try {
    const img = await loadImage(state.cartoon.image);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    saveBlob(await canvasToBlob(canvas), 'jack-cartoon.png');
  } catch {
    announce('The download could not be made. Try again.');
  }
}

function wrapLines(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = word; } else { line = test; }
  }
  if (line) lines.push(line);
  return lines;
}

// Composites title + picture + the exact caption onto one storybook page and saves it as a PNG,
// so the caption travels with the file.
async function downloadScene(id) {
  const sc = state.scenes[id];
  if (!sc || !sc.result) return;
  const { image, title, caption } = sc.result;
  const SERIF = 'Fraunces, Georgia, serif';
  const SANS = '"DM Sans", system-ui, sans-serif';
  try {
    await Promise.all([
      document.fonts.load(`600 46px ${SERIF}`),
      document.fonts.load(`italic 400 28px ${SERIF}`),
      document.fonts.load(`500 18px ${SANS}`),
    ]).catch(() => {});
    const img = await loadImage(image);

    const W = 1200;
    const pad = 64;
    const mat = 14;
    const frameW = W - pad * 2;
    const imgW = frameW - mat * 2;
    const imgH = Math.round(imgW * img.naturalHeight / img.naturalWidth);
    const textW = frameW - 48;

    const measure = document.createElement('canvas').getContext('2d');
    measure.font = `600 46px ${SERIF}`;
    const titleLines = wrapLines(measure, title, textW);
    measure.font = `italic 400 28px ${SERIF}`;
    const captionLines = wrapLines(measure, caption, textW);

    const titleLH = 56;
    const captionLH = 42;
    const topPad = 56;
    const titleH = titleLines.length * titleLH;
    const gap = 30;
    const frameH = imgH + mat * 2;
    const captionH = captionLines.length * captionLH;
    const footerH = 74;
    const H = topPad + titleH + 28 + frameH + gap + captionH + footerH;

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // parchment page with soft colour washes
    ctx.fillStyle = '#F2E6C8';
    ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(W * 0.9, 0, 0, W * 0.9, 0, W * 0.8);
    g.addColorStop(0, 'rgba(168,208,230,0.55)'); g.addColorStop(1, 'rgba(168,208,230,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createRadialGradient(0, H, 0, 0, H, W * 0.7);
    g.addColorStop(0, 'rgba(92,138,62,0.28)'); g.addColorStop(1, 'rgba(92,138,62,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // double border
    ctx.strokeStyle = '#2D5B35'; ctx.lineWidth = 4;
    ctx.strokeRect(20, 20, W - 40, H - 40);
    ctx.strokeStyle = '#D9A21B'; ctx.lineWidth = 2;
    ctx.strokeRect(30, 30, W - 60, H - 60);

    // title
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#1D3F26'; ctx.font = `600 46px ${SERIF}`;
    let y = topPad + 40;
    for (const line of titleLines) { ctx.fillText(line, W / 2, y); y += titleLH; }

    // picture in a gold-to-green mat
    const fx = pad;
    const fy = topPad + titleH + 28 - 8;
    const fg = ctx.createLinearGradient(fx, fy, fx + frameW, fy + frameH);
    fg.addColorStop(0, '#D9A21B'); fg.addColorStop(0.4, '#A9780C'); fg.addColorStop(1, '#2D5B35');
    ctx.fillStyle = fg;
    ctx.fillRect(fx, fy, frameW, frameH);
    ctx.drawImage(img, fx + mat, fy + mat, imgW, imgH);

    // caption, wrapped, verbatim
    ctx.fillStyle = '#2B2316'; ctx.font = `italic 400 28px ${SERIF}`;
    let cy = fy + frameH + gap + 28;
    for (const line of captionLines) { ctx.fillText(line, W / 2, cy); cy += captionLH; }

    // footer
    ctx.fillStyle = '#A9780C'; ctx.font = `500 18px ${SANS}`;
    ctx.fillText('JACK AND THE BEANSTALK  ·  STARRING YOU', W / 2, H - 52);

    saveBlob(await canvasToBlob(canvas), `jack-${id}.png`);
    announce('Scene saved with its caption.');
  } catch {
    announce('The download could not be made. Try again.');
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                 */
/* ------------------------------------------------------------------ */

el.cartoonBtn.addEventListener('click', cartoonify);
el.cartoonRetry.addEventListener('click', cartoonify);
el.cartoonDownload.addEventListener('click', downloadCartoon);
el.bothBtn.addEventListener('click', makeBothScenes);
el.optionsRetry.addEventListener('click', loadOptions);
document.getElementById('settings-form').addEventListener('submit', (e) => e.preventDefault());

wirePhotoInputs();
render();
loadOptions();
