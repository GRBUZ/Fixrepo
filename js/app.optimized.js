// Optimized front: instant selection + minimal DOM updates + modal popup
// + Finalize (no payment) + Cancel unlock integrated
const grid = document.getElementById('pixelGrid');
const regionsLayer = document.getElementById('regionsLayer');
const buyButton = document.getElementById('buyButton');
const contactButton = document.getElementById('contactButton');
const buyModal = document.getElementById('buyModal');
const form = document.getElementById('influencerForm');
const cancelForm = document.getElementById('cancelForm');
const priceLine = document.getElementById('priceLine');
const pixelsLeftEl = document.getElementById('pixelsLeft');

const TOTAL_PIXELS = 1_000_000;
const GRID_SIZE = 100;
const CELL_PX = 10;
const STATUS_POLL_MS = 1500;
const DATA_VERSION = 13;

let cellsMap = {};          // static cells from data/purchasedBlocks.json
let regions = [];           // static regions
let dynCells = {};          // dynamic sold art from server (status.artCells)
let pendingSet = new Set(); // all pending
let myReservedSet = new Set();  // mine only
let activeReservationId = localStorage.getItem('iw_reservation_id') || null;
let purchaseComplete = localStorage.getItem('iw_purchase_complete') === '1';

const cells = new Array(GRID_SIZE * GRID_SIZE);

// ---- Pricing ----
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

// ---- Data loading ----
async function loadStatus() {
  try {
    const r = await fetch('/.netlify/functions/status', { cache: 'no-store' });
    const s = await r.json();
    // pending diff (keep mine intact)
    const old = pendingSet;
    const next = new Set(s.pending || []);
    for (const b of next) if (!old.has(b) && !myReservedSet.has(b)) setCellState(b, 'pending');
    for (const b of old) if (!next.has(b) && !myReservedSet.has(b)) setCellState(b, 'free');
    pendingSet = next;
    // dynamic sold art
    dynCells = s.artCells || {};
    // repaint overlay + solidify sold cells
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

// ---- Grid build once ----
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
  // static cells
  for (const [k, info] of Object.entries(cellsMap)) {
    const idx = +k; const row = Math.floor(idx / GRID_SIZE), col = idx % GRID_SIZE;
    const a = document.createElement('a'); a.href = info.linkUrl || '#'; a.target = '_blank'; a.className = 'region';
    a.style.left = (col * CELL) + 'px'; a.style.top = (row * CELL) + 'px';
    a.style.width = CELL + 'px'; a.style.height = CELL + 'px'; a.style.backgroundImage = `url(${info.imageUrl})`;
    regionsLayer.appendChild(a);
  }
  // static regions
  for (const r of regions) {
    const start = (r.start|0), w = Math.max(1, r.w|0), h = Math.max(1, r.h|0);
    const row = Math.floor(start / GRID_SIZE), col = start % GRID_SIZE;
    const a = document.createElement('a'); a.href = r.linkUrl || '#'; a.target = '_blank'; a.className = 'region';
    a.style.left = (col * CELL) + 'px'; a.style.top = (row * CELL) + 'px';
    a.style.width = (w * CELL) + 'px'; a.style.height = (h * CELL) + 'px'; a.style.backgroundImage = `url(${r.imageUrl})`;
    regionsLayer.appendChild(a);
  }
  // dynamic sold cells
  for (const [k, info] of Object.entries(dynCells)) {
    const idx = +k; const row = Math.floor(idx / GRID_SIZE), col = idx % GRID_SIZE;
    const a = document.createElement('a'); a.href = (info && info.linkUrl) || '#'; a.target = '_blank'; a.className = 'region';
    a.style.left = (col * CELL) + 'px'; a.style.top = (row * CELL) + 'px';
    a.style.width = CELL + 'px'; a.style.height = CELL + 'px'; a.style.backgroundImage = `url(${info && info.imageUrl})`;
    regionsLayer.appendChild(a);
  }
}

// State: 'free' | 'mine' | 'pending' | 'sold'
function setCellState(idx, state) {
  const el = cells[idx]; if (!el) return;
  el.className = 'block';
  if (state === 'sold') { el.classList.add('sold'); return; }
  if (state === 'pending') { el.classList.add('pending'); return; }
  if (state === 'mine') { el.classList.add('pending','selected'); return; }
}

// ---- Reserve-on-click (optimistic) ----
async function onCellClick(e) {
  const idx = parseInt(e.currentTarget.dataset.index);
  // remove mine
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
  // ignore taken
  const sold = committedSoldSet();
  if (pendingSet.has(idx) || sold.has(idx)) return;
  // optimistic add
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

// ---- Modal helpers ----
function openModal(){ buyModal.classList.remove('hidden'); }
function closeModal(){ buyModal.classList.add('hidden'); }

buyButton.addEventListener('click', () => {
  if (myReservedSet.size === 0) { alert('Please select blocks first.'); return; }
  document.getElementById('blockIndex').value = Array.from(myReservedSet).join(',');
  openModal();
});

// ==== CANCEL -> UNLOCK (integrated) ====
async function cancelAndUnlock() {
  closeModal();
  if (!activeReservationId && myReservedSet.size === 0) return;

  // UI: free immediately
  for (const b of Array.from(myReservedSet)) setCellState(b, 'free');
  myReservedSet.clear();
  updateBuyLabel();

  // Server: unlock
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
  // Refresh pending so all tabs see it
  await loadStatus();
}

// Bind cancel to all close actions
if (cancelForm) cancelForm.addEventListener('click', (e) => { e.preventDefault(); cancelAndUnlock(); });
if (buyModal) buyModal.addEventListener('click', (e) => { if (e.target.matches('[data-close]')) { e.preventDefault(); cancelAndUnlock(); } });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !buyModal.classList.contains('hidden')) { e.preventDefault(); cancelAndUnlock(); } });

contactButton.addEventListener('click', () => location.href='mailto:you@domain.com');

// ---- Submit -> finalize (no payment) ----
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = new FormData(form);
  try { await fetch(form.action || '/', { method: 'POST', body: data }); } catch {}
  try {
    const payload = {
      reservationId: activeReservationId,
      imageUrl: data.get('imageUrl'),
      linkUrl: data.get('linkUrl'),
      name: data.get('name')
    };
    const r = await fetch('/.netlify/functions/finalize', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify(payload)
    });
    const res = await r.json();
    if (!r.ok || !res.ok) throw new Error(res.error || ('HTTP '+r.status));
    // purchase complete -> don't unlock on exit
    localStorage.setItem('iw_purchase_complete', '1');
    activeReservationId = null; localStorage.removeItem('iw_reservation_id');
    myReservedSet = new Set(); localStorage.removeItem('iw_my_blocks');
    closeModal();
    await loadStatus();
    updateBuyLabel();
  } catch (e2) {
    alert('Could not finalize: ' + (e2?.message || e2));
  }
});

// ---- Init ----
(async () => {
  await loadData();
  buildGridOnce();
  await loadStatus();
  refreshHeader(); updateBuyLabel();
  setInterval(loadStatus, STATUS_POLL_MS);
})();

// Unlock on exit only if reservation active and not finalized
window.addEventListener('pagehide', () => {
  if (!activeReservationId) return;
  if (localStorage.getItem('iw_purchase_complete') === '1') return;
  try {
    const payload = JSON.stringify({ reservationId: activeReservationId });
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon('/.netlify/functions/unlock', blob);
  } catch {}
});
