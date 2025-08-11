// JS patch: robust finalize (auto re-lock if LOCK_NOT_FOUND)
// Drop-in replacement for js/app.optimized.js (same public API + drag select etc.)

const grid = document.getElementById('pixelGrid');
const regionsLayer = document.getElementById('regionsLayer');
const buyButton = document.getElementById('buyButton');
const contactButton = document.getElementById('contactButton');
const buyModal = document.getElementById('buyModal');
const form = document.getElementById('influencerForm');
const cancelForm = document.getElementById('cancelForm');
const priceLine = document.getElementById('priceLine');
const pixelsLeftEl = document.getElementById('pixelsLeft');

// Modal fields (reduced)
const fldLink = document.getElementById('fldLink');
const fldImageFile = document.getElementById('fldImageFile');
const imgPreview = document.getElementById('imgPreview');
const sumBlocks = document.getElementById('sumBlocks');
const sumPixels = document.getElementById('sumPixels');
const sumTotal = document.getElementById('sumTotal');

const TOTAL_PIXELS = 1_000_000;
const GRID_SIZE = 100;
const STATUS_POLL_MS = 1200;
const DATA_VERSION = 13;

let cellsMap = {};
let regions = [];
let dynCells = {};
let pendingSet = new Set();
let myReservedSet = new Set();
let activeReservationId = localStorage.getItem('iw_reservation_id') || null;

const cells = new Array(GRID_SIZE * GRID_SIZE);

/* Pricing */
function committedSoldSet() {
  const set = new Set();
  for (const k of Object.keys(cellsMap)) set.add(+k);
  for (const r of regions) {
    const start = (r.start|0), w = Math.max(1, r.w|0), h = Math.max(1, r.h|0);
    const sr = Math.floor(start / GRID_SIZE), sc = start % GRID_SIZE;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) set.add((sr+dy)*GRID_SIZE+(sc+dx));
  }
  for (const k of Object.keys(dynCells)) set.add(+k);
  return set;
}
function getBlocksSold() { return committedSoldSet().size; }
function getCurrentPixelPrice() { const steps = Math.floor(getBlocksSold() / 10); return Math.round((1 + steps * 0.01) * 100) / 100; }
function getCurrentBlockPrice() { return Math.round(getCurrentPixelPrice() * 100 * 100) / 100; }
function formatUSD(n) { return '$' + n.toFixed(2); }
function refreshHeader() {
  priceLine.textContent = `1 Pixel = ${formatUSD(getCurrentPixelPrice())}`;
  const left = TOTAL_PIXELS - getBlocksSold() * 100;
  pixelsLeftEl.textContent = `${left.toLocaleString()} pixels left`;
}
function updateBuyLabel() {
  const c = myReservedSet.size;
  buyButton.textContent = c === 0 ? 'Buy Pixels' : `Buy ${c} block${c>1?'s':''} (${c*100} px) – ${formatUSD(getCurrentBlockPrice()*c)}`;
}

/* Data */
async function loadStatus() {
  try {
    const r = await fetch('/.netlify/functions/status', { cache: 'no-store' });
    const s = await r.json();
    const old = pendingSet;
    const next = new Set(s.pending || []);
    for (const b of next) if (!old.has(b) && !myReservedSet.has(b)) setCellState(b, 'pending');
    for (const b of old) if (!next.has(b) && !myReservedSet.has(b)) setCellState(b, 'free');
    pendingSet = next;
    dynCells = s.artCells || {};
    paintRegions();
    const sold = committedSoldSet();
    for (let i = 0; i < cells.length; i++) if (sold.has(i)) setCellState(i, 'sold');
    refreshHeader();
  } catch {}
}
async function loadData() {
  const r = await fetch(`data/purchasedBlocks.json?v=${DATA_VERSION}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status} fetching purchasedBlocks.json`);
  const data = await r.json();
  if (data && (data.cells || data.regions)) { cellsMap = data.cells || {}; regions = data.regions || []; }
  else { cellsMap = data || {}; regions = []; }
}

/* Grid */
function buildGridOnce() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    const el = document.createElement('div');
    el.className = 'block'; el.dataset.index = i;
    el.addEventListener('click', onCellClick, { passive: true });
    cells[i] = el;
    frag.appendChild(el);
  }
  pixelGrid.innerHTML = '';
  pixelGrid.appendChild(frag);
  const sold = committedSoldSet();
  for (let i = 0; i < cells.length; i++) setCellState(i, sold.has(i) ? 'sold' : 'free');
  paintRegions();

  // Drag-select handlers
  grid.addEventListener('pointerdown', onPointerDown);
}

function paintRegions() {
  const CELL = 10;
  regionsLayer.innerHTML = '';
  for (const [k, info] of Object.entries(cellsMap)) {
    const idx = +k; const row = Math.floor(idx / GRID_SIZE), col = idx % GRID_SIZE;
    const a = document.createElement('a'); a.href = info.linkUrl || '#'; a.target = '_blank'; a.className = 'region';
    a.style.left = (col * CELL) + 'px'; a.style.top = (row * CELL) + 'px';
    a.style.width = CELL + 'px'; a.style.height = CELL + 'px'; a.style.backgroundImage = `url(${info.imageUrl})`;
    regionsLayer.appendChild(a);
  }
  for (const r of regions) {
    const start = (r.start|0), w = Math.max(1, r.w|0), h = Math.max(1, r.h|0);
    const row = Math.floor(start / GRID_SIZE), col = start % GRID_SIZE;
    const a = document.createElement('a'); a.href = r.linkUrl || '#'; a.target = '_blank'; a.className = 'region';
    a.style.left = (col * CELL) + 'px'; a.style.top = (row * CELL) + 'px';
    a.style.width = (w * CELL) + 'px'; a.style.height = (h * CELL) + 'px'; a.style.backgroundImage = `url(${r.imageUrl})`;
    regionsLayer.appendChild(a);
  }
  for (const [k, info] of Object.entries(dynCells)) {
    const idx = +k; const row = Math.floor(idx / GRID_SIZE), col = idx % GRID_SIZE;
    const a = document.createElement('a'); a.href = (info && info.linkUrl) || '#'; a.target = '_blank'; a.className = 'region';
    a.style.left = (col * CELL) + 'px'; a.style.top = (row * CELL) + 'px';
    a.style.width = CELL + 'px'; a.style.height = CELL + 'px'; a.style.backgroundImage = `url(${info && info.imageUrl})`;
    regionsLayer.appendChild(a);
  }
}

function setCellState(idx, state) {
  const el = cells[idx]; if (!el) return;
  el.className = 'block';
  if (state === 'sold') { el.classList.add('sold'); return; }
  if (state === 'pending') { el.classList.add('pending'); return; }
  if (state === 'mine') { el.classList.add('pending','selected'); return; }
  if (state === 'preview') { el.classList.add('preview'); return; }
}

/* Click selection */
async function onCellClick(e) {
  const idx = parseInt(e.currentTarget.dataset.index);
  if (myReservedSet.has(idx)) {
    setCellState(idx, 'free'); myReservedSet.delete(idx); updateBuyLabel();
    try {
      const r = await fetch('/.netlify/functions/lock', {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ op:'remove', blocks:[idx], reservationId: activeReservationId })
      });
      const res = await r.json();
      if (!r.ok) throw new Error(res.error || ('HTTP '+r.status));
      if (!res.reservationId) { activeReservationId = null; localStorage.removeItem('iw_reservation_id'); myReservedSet.clear(); }
      else { activeReservationId = res.reservationId; localStorage.setItem('iw_reservation_id', activeReservationId); myReservedSet = new Set(res.blocks || Array.from(myReservedSet)); }
    } catch {
      myReservedSet.add(idx); setCellState(idx, 'mine'); updateBuyLabel();
    }
    return;
  }
  const sold = committedSoldSet();
  if (pendingSet.has(idx) || sold.has(idx)) return;
  setCellState(idx, 'mine'); myReservedSet.add(idx); updateBuyLabel();
  try {
    const r = await fetch('/.netlify/functions/lock', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ op:'add', blocks:[idx], reservationId: activeReservationId || undefined })
    });
    const res = await r.json();
    if (!r.ok) {
      if (r.status === 409) { myReservedSet.delete(idx); setCellState(idx, 'pending'); updateBuyLabel(); return; }
      throw new Error(res.error || ('HTTP '+r.status));
    }
    activeReservationId = res.reservationId || activeReservationId;
    localStorage.setItem('iw_reservation_id', activeReservationId);
    myReservedSet = new Set(res.blocks || Array.from(myReservedSet));
    for (const b of myReservedSet) setCellState(b, 'mine');
  } catch {
    myReservedSet.delete(idx); setCellState(idx, 'free'); updateBuyLabel();
  }
}

/* DRAG selection */
let isDragging = false;
let dragStart = null;
let previewSet = new Set();
let rafPending = false;
let lastPoint = null;

function idxFromXY(clientX, clientY) {
  const rect = grid.getBoundingClientRect();
  const x = Math.floor((clientX - rect.left) / 10);
  const y = Math.floor((clientY - rect.top) / 10);
  if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return -1;
  return y * GRID_SIZE + x;
}
function applyPreview(toIdx) {
  for (const i of previewSet) {
    if (!myReservedSet.has(i)) setCellState(i, 'free');
  }
  previewSet.clear();
  if (toIdx < 0 || dragStart === null) return;
  const a = dragStart;
  const aRow = Math.floor(a / GRID_SIZE), aCol = a % GRID_SIZE;
  const bRow = Math.floor(toIdx / GRID_SIZE), bCol = toIdx % GRID_SIZE;
  const r0 = Math.min(aRow, bRow), r1 = Math.max(aRow, bRow);
  const c0 = Math.min(aCol, bCol), c1 = Math.max(aCol, bCol);
  const sold = committedSoldSet();
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const idx = r * GRID_SIZE + c;
      if (sold.has(idx) || pendingSet.has(idx)) continue;
      if (myReservedSet.has(idx)) { setCellState(idx, 'mine'); continue; }
      previewSet.add(idx);
      setCellState(idx, 'preview');
    }
  }
}
function onPointerDown(e) {
  if (!(e.target && e.target.classList.contains('block'))) return;
  const idx = parseInt(e.target.dataset.index);
  if (Number.isNaN(idx)) return;
  isDragging = true;
  dragStart = idx;
  lastPoint = { x: e.clientX, y: e.clientY };
  applyPreview(idx);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
  e.preventDefault();
}
function onPointerMove(e) {
  lastPoint = { x: e.clientX, y: e.clientY };
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    if (!isDragging) return;
    const idx = idxFromXY(lastPoint.x, lastPoint.y);
    applyPreview(idx);
  });
}
async function onPointerUp(e) {
  window.removeEventListener('pointermove', onPointerMove);
  isDragging = false;
  const additions = Array.from(previewSet).filter(i => !myReservedSet.has(i));
  for (const i of previewSet) setCellState(i, 'free');
  previewSet.clear();
  if (additions.length === 0) return;
  for (const i of additions) { setCellState(i, 'mine'); myReservedSet.add(i); }
  updateBuyLabel();
  try {
    const r = await fetch('/.netlify/functions/lock', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ op:'add', blocks: additions, reservationId: activeReservationId || undefined })
    });
    const res = await r.json();
    if (!r.ok) {
      for (const i of additions) if (myReservedSet.has(i)) { myReservedSet.delete(i); setCellState(i, 'free'); }
      updateBuyLabel();
      return;
    }
    activeReservationId = res.reservationId || activeReservationId;
    localStorage.setItem('iw_reservation_id', activeReservationId);
    myReservedSet = new Set(res.blocks || Array.from(myReservedSet));
    for (const b of myReservedSet) setCellState(b, 'mine');
  } catch {
    for (const i of additions) if (myReservedSet.has(i)) { myReservedSet.delete(i); setCellState(i, 'free'); }
    updateBuyLabel();
  }
}

// Modal
function openModal(){
  buyModal.classList.remove('hidden');
  const c = myReservedSet.size;
  sumBlocks.textContent = c;
  sumPixels.textContent = c * 100;
  const total = Math.round(getCurrentBlockPrice() * c * 100) / 100;
  sumTotal.textContent = formatUSD(total);
}
function closeModal(){ buyModal.classList.add('hidden'); }
buyButton.addEventListener('click', () => {
  if (myReservedSet.size === 0) { alert('Please select blocks first.'); return; }
  document.getElementById('blockIndex').value = Array.from(myReservedSet).join(',');
  openModal();
});

// Cancel -> unlock
async function cancelAndUnlock() {
  closeModal();
  if (!activeReservationId && myReservedSet.size === 0) return;
  for (const b of Array.from(myReservedSet)) setCellState(b, 'free');
  myReservedSet.clear();
  updateBuyLabel();
  if (activeReservationId) {
    try {
      await fetch('/.netlify/functions/unlock', {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ reservationId: activeReservationId })
      });
    } catch {}
    activeReservationId = null;
    localStorage.removeItem('iw_reservation_id');
    localStorage.removeItem('iw_my_blocks');
  }
  await loadStatus();
}
cancelForm.addEventListener('click', (e) => { e.preventDefault(); cancelAndUnlock(); });
buyModal.addEventListener('click', (e) => { if (e.target.matches('[data-close]')) { e.preventDefault(); cancelAndUnlock(); }});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !buyModal.classList.contains('hidden')) { e.preventDefault(); cancelAndUnlock(); }});

// Upload preview (file required)
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
fldImageFile.addEventListener('change', async () => {
  const f = fldImageFile.files && fldImageFile.files[0];
  if (f) {
    const url = await fileToDataURL(f);
    imgPreview.src = url;
  } else {
    imgPreview.src = '';
  }
});

// Helper: ensure we have a live reservation with current blocks
async function ensureReservationId() {
  let rid = activeReservationId || localStorage.getItem('iw_reservation_id') || null;
  if (myReservedSet.size === 0) return null;
  const blocks = Array.from(myReservedSet);
  // If not rid, or to refresh/repair expired, try (re)locking everything
  try {
    const r = await fetch('/.netlify/functions/lock', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ op:'add', blocks, reservationId: rid || undefined })
    });
    const res = await r.json();
    if (!r.ok) throw new Error(res.error || ('HTTP '+r.status));
    rid = res.reservationId || rid;
    if (rid) { activeReservationId = rid; localStorage.setItem('iw_reservation_id', rid); }
    myReservedSet = new Set(res.blocks || blocks);
    return rid;
  } catch (e) {
    console.warn('ensureReservationId failed', e);
    return null;
  }
}

// Submit -> finalize (robust with retry)
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = fldImageFile.files && fldImageFile.files[0];
  if (!file) { alert('Please upload a profile image.'); return; }
  const image = await fileToDataURL(file);
  const data = new FormData(form);
  try { await fetch(form.action || '/', { method: 'POST', body: data }); } catch {}

  // 1) Make sure we have a reservation id
  let rid = activeReservationId || localStorage.getItem('iw_reservation_id') || null;
  if (!rid) {
    rid = await ensureReservationId();
    if (!rid) { alert('Your selection expired. Please reselect your blocks.'); return; }
  }

  // 2) Try finalize
  async function doFinalize(ridToUse) {
    const payload = { reservationId: ridToUse, imageUrl: image, linkUrl: data.get('linkUrl') };
    const r = await fetch('/.netlify/functions/finalize', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify(payload)
    });
    const res = await r.json();
    return { r, res };
  }

  try {
    let { r, res } = await doFinalize(rid);
    if (r.status === 404 || (res && res.error === 'LOCK_NOT_FOUND_OR_EMPTY')) {
      // Maybe expired or lost -> relock then retry once
      const repaired = await ensureReservationId();
      if (!repaired) throw new Error('Reservation lost. Please reselect your blocks.');
      ({ r, res } = await doFinalize(repaired));
    }
    if (!r.ok || !res.ok) throw new Error(res.error || ('HTTP '+r.status));

    // success
    activeReservationId = null; localStorage.removeItem('iw_reservation_id');
    myReservedSet = new Set(); localStorage.removeItem('iw_my_blocks');
    closeModal();
    await loadStatus();
    updateBuyLabel();
  } catch (e2) {
    alert('Could not finalize: ' + (e2?.message || e2));
  }
});

// Init
(async () => {
  await loadData();
  buildGridOnce();
  await loadStatus();
  refreshHeader(); updateBuyLabel();
  setInterval(loadStatus, STATUS_POLL_MS);
})();

// Unlock on exit (only if reservation exists)
window.addEventListener('pagehide', () => {
  if (!activeReservationId) return;
  try {
    const payload = JSON.stringify({ reservationId: activeReservationId });
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon('/.netlify/functions/unlock', blob);
  } catch {}
});
