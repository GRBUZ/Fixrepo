// Patch: unlock reservation on Cancel/Close (modal)
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

let cellsMap = {};
let regions = [];
let dynCells = {};
let pendingSet = new Set();
let myReservedSet = new Set();
let activeReservationId = localStorage.getItem('iw_reservation_id') || null;

const cells = new Array(GRID_SIZE * GRID_SIZE);

/* ---- Helpers copied from your current build ---- */
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
function setCellState(idx, state) {
  const el = cells[idx]; if (!el) return;
  el.className = 'block';
  if (state === 'sold') { el.classList.add('sold'); return; }
  if (state === 'pending') { el.classList.add('pending'); return; }
  if (state === 'mine') { el.classList.add('pending','selected'); return; }
}

/* ---- Networking ---- */
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
    dynCells = s.artCells || {};
  } catch {}
}

/* ---- NEW: cancel & unlock ---- */
async function cancelAndUnlock() {
  // Close modal now for instant UX
  buyModal.classList.add('hidden');
  if (!activeReservationId && myReservedSet.size === 0) return;

  // Free the cells visually
  const mine = Array.from(myReservedSet);
  for (const b of mine) setCellState(b, 'free');

  // Clear local state
  myReservedSet.clear();
  updateBuyLabel();

  // Ask server to unlock
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

  // Refresh pending so others voient les blocs libres de suite
  await loadStatus();
}

/* ---- Wire it everywhere the user can cancel ---- */
// 1) Click on Cancel button
if (cancelForm) cancelForm.addEventListener('click', (e) => { e.preventDefault(); cancelAndUnlock(); });
// 2) Click on × or backdrop (both have [data-close])
if (buyModal) buyModal.addEventListener('click', (e) => {
  if (e.target.matches('[data-close]')) { e.preventDefault(); cancelAndUnlock(); }
});
// 3) Press Escape when modal is open
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !buyModal.classList.contains('hidden')) { e.preventDefault(); cancelAndUnlock(); }
});

// Note: keep your existing code as-is; include this file AFTER js/app.optimized.js
// or merge these functions into it. This file only adds the cancel->unlock behavior.
