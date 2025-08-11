// Optimized front + finalize + cancel unlock + prettier modal with image upload
const grid = document.getElementById('pixelGrid');
const regionsLayer = document.getElementById('regionsLayer');
const buyButton = document.getElementById('buyButton');
const contactButton = document.getElementById('contactButton');
const buyModal = document.getElementById('buyModal');
const form = document.getElementById('influencerForm');
const cancelForm = document.getElementById('cancelForm');
const priceLine = document.getElementById('priceLine');
const pixelsLeftEl = document.getElementById('pixelsLeft');

// Modal fields
const fldName = document.getElementById('fldName');
const fldLink = document.getElementById('fldLink');
const fldImageUrl = document.getElementById('fldImageUrl');
const fldImageFile = document.getElementById('fldImageFile');
const imgPreview = document.getElementById('imgPreview');
const sumBlocks = document.getElementById('sumBlocks');
const sumPixels = document.getElementById('sumPixels');
const sumTotal = document.getElementById('sumTotal');

const TOTAL_PIXELS = 1_000_000;
const GRID_SIZE = 100;
const STATUS_POLL_MS = 1500;
const DATA_VERSION = 13;

let cellsMap = {};          // static
let regions = [];           // static
let dynCells = {};          // dynamic (sold at runtime)
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
}

/* Reserve-on-click */
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

/* Modal helpers */
function openModal(){
  buyModal.classList.remove('hidden');
  // fill summary
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

/* Cancel -> unlock */
async function cancelAndUnlock() {
  closeModal();
  if (!activeReservationId && myReservedSet.size === 0) return;
  for (const b of Array.from(myReservedSet)) setCellState(b, 'free');
  myReservedSet.clear();
  updateBuyLabel();
  if (activeReservationId) {
    try {
      await fetch('/.netlify/functions/unlock', {
        method:'POST',
        headers:{'content-type':'application/json'},
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

/* Upload preview & data URL */
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
  }
});
fldImageUrl.addEventListener('input', () => {
  const url = fldImageUrl.value.trim();
  if (url) imgPreview.src = url;
});

/* Submit -> finalize (URL or uploaded file as dataURL) */
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(form);
  try { await fetch(form.action || '/', { method: 'POST', body: data }); } catch {}
  try {
    let image = (data.get('imageUrl') || '').toString().trim();
    const file = fldImageFile.files && fldImageFile.files[0];
    if (!image && file) image = await fileToDataURL(file);
    if (!image) { alert('Please provide an image URL or upload a file.'); return; }

    const payload = {
      reservationId: activeReservationId,
      imageUrl: image,                   // can be https:// or data:image/...
      linkUrl: data.get('linkUrl'),
      name: data.get('name')
    };
    const r = await fetch('/.netlify/functions/finalize', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify(payload)
    });
    const res = await r.json();
    if (!r.ok || !res.ok) throw new Error(res.error || ('HTTP '+r.status));

    // clear selection
    activeReservationId = null; localStorage.removeItem('iw_reservation_id');
    myReservedSet = new Set(); localStorage.removeItem('iw_my_blocks');
    closeModal();
    await loadStatus();
    updateBuyLabel();
  } catch (e2) {
    alert('Could not finalize: ' + (e2?.message || e2));
  }
});

/* Init */
(async () => {
  await loadData();
  // restore saved selection, best effort
  try { const saved = JSON.parse(localStorage.getItem('iw_my_blocks')||'[]'); if (Array.isArray(saved)) myReservedSet = new Set(saved.map(n=>+n).filter(Number.isInteger)); } catch {}
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
