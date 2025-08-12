// Complete app.optimized.js with extensive debugging
const grid = document.getElementById('pixelGrid');
const regionsLayer = document.getElementById('regionsLayer');
const buyButton = document.getElementById('buyButton');
const contactButton = document.getElementById('contactButton');
const buyModal = document.getElementById('buyModal');
const form = document.getElementById('influencerForm');
const cancelForm = document.getElementById('cancelForm');
const priceLine = document.getElementById('priceLine');
const pixelsLeftEl = document.getElementById('pixelsLeft');
const submitBtn = document.getElementById('submitPurchase');

// Modal fields (lean)
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
let purchaseCommitted = false;

// Debug function
function debugState() {
  console.log('=== DEBUG STATE ===');
  console.log('myReservedSet size:', myReservedSet.size);
  console.log('myReservedSet contents:', Array.from(myReservedSet));
  console.log('activeReservationId:', activeReservationId);
  console.log('pendingSet size:', pendingSet.size);
  console.log('purchaseCommitted:', purchaseCommitted);
  console.log('localStorage reservation:', localStorage.getItem('iw_reservation_id'));
  console.log('localStorage blocks:', localStorage.getItem('iw_my_blocks'));
  console.log('===================');
}

// Expose to global for compatibility
window.myReservedSet = myReservedSet;
window.activeReservationId = activeReservationId;
window.loadStatus = loadStatus;
window.updateBuyLabel = updateBuyLabel;
window.closeModal = closeModal;
window.debugState = debugState;

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
  console.log('🔄 Buy button updated:', buyButton.textContent);
}

/* Data */
async function loadStatus() {
  try {
    console.log('📡 Loading status...');
    const r = await fetch('/.netlify/functions/status', { cache: 'no-store' });
    const s = await r.json();
    console.log('📡 Status response:', s);
    
    const old = pendingSet;
    const next = new Set(s.pending || []);
    
    // Add our reserved blocks to the pending set
    for (const b of myReservedSet) {
      next.add(b);
    }
    
    // Update visual state for other users' pending blocks
    for (const b of next) {
      if (!old.has(b) && !myReservedSet.has(b)) {
        setCellState(b, 'pending');
      }
    }
    
    // Clear blocks that are no longer pending (but not ours)
    for (const b of old) {
      if (!next.has(b) && !myReservedSet.has(b)) {
        setCellState(b, 'free');
      }
    }
    
    pendingSet = next;
    dynCells = s.artCells || {};
    paintRegions();
    
    // Update sold blocks
    const sold = committedSoldSet();
    for (let i = 0; i < cells.length; i++) {
      if (sold.has(i)) {
        setCellState(i, 'sold');
      }
    }
    
    // CRITICAL: Always re-apply our reserved blocks LAST
    for (const b of myReservedSet) {
      setCellState(b, 'mine');
    }
    
    refreshHeader();
    
    console.log('✅ Status loaded, preserved', myReservedSet.size, 'reserved blocks');
  } catch (e) {
    console.warn('❌ loadStatus failed:', e);
  }
}

async function loadData() {
  try {
    console.log('📄 Loading data...');
    const r = await fetch(`data/purchasedBlocks.json?v=${DATA_VERSION}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status} fetching purchasedBlocks.json`);
    const data = await r.json();
    if (data && (data.cells || data.regions)) { cellsMap = data.cells || {}; regions = data.regions || []; }
    else { cellsMap = data || {}; regions = []; }
    console.log('✅ Data loaded successfully');
  } catch (e) {
    console.error('❌ loadData failed:', e);
    throw e;
  }
}

/* Grid */
function buildGridOnce() {
  console.log('🏗️ Building grid...');
  const frag = document.createDocumentFragment();
  for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    const el = document.createElement('div');
    el.className = 'block'; 
    el.dataset.index = i;
    el.addEventListener('click', onCellClick, { passive: true });
    cells[i] = el;
    frag.appendChild(el);
  }
  grid.innerHTML = '';
  grid.appendChild(frag);
  
  const sold = committedSoldSet();
  for (let i = 0; i < cells.length; i++) setCellState(i, sold.has(i) ? 'sold' : 'free');
  paintRegions();
  grid.addEventListener('pointerdown', onPointerDown);
  console.log('✅ Grid built with', cells.length, 'cells');
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

/* Click selection with DEBUG */
async function onCellClick(e) {
  const idx = parseInt(e.currentTarget.dataset.index);
  console.log('🖱️ Cell clicked:', idx);
  
  if (myReservedSet.has(idx)) {
    console.log('➖ Removing block:', idx);
    setCellState(idx, 'free'); 
    myReservedSet.delete(idx); 
    localStorage.setItem('iw_my_blocks', JSON.stringify(Array.from(myReservedSet)));
    updateBuyLabel();
    debugState();
    
    try {
      const r = await fetch('/.netlify/functions/lock', {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ op:'remove', blocks:[idx], reservationId: activeReservationId })
      });
      const res = await r.json();
      console.log('🔓 Remove response:', res);
      
      if (!r.ok) throw new Error(res.error || ('HTTP '+r.status));
      
      if (!res.reservationId) { 
        console.log('🗑️ No reservation left, clearing everything');
        activeReservationId = null; 
        localStorage.removeItem('iw_reservation_id'); 
        myReservedSet.clear();
        localStorage.removeItem('iw_my_blocks');
      } else { 
        console.log('✅ Updated reservation:', res.reservationId);
        activeReservationId = res.reservationId; 
        localStorage.setItem('iw_reservation_id', activeReservationId); 
        myReservedSet = new Set(res.blocks || Array.from(myReservedSet)); 
        localStorage.setItem('iw_my_blocks', JSON.stringify(Array.from(myReservedSet)));
      }
    } catch (e) {
      console.error('❌ Remove failed:', e);
      myReservedSet.add(idx); 
      setCellState(idx, 'mine'); 
      localStorage.setItem('iw_my_blocks', JSON.stringify(Array.from(myReservedSet)));
      updateBuyLabel();
    }
    
    window.myReservedSet = myReservedSet;
    window.activeReservationId = activeReservationId;
    debugState();
    return;
  }
  
  const sold = committedSoldSet();
  if (pendingSet.has(idx) || sold.has(idx)) {
    console.log('❌ Block unavailable:', idx, { pending: pendingSet.has(idx), sold: sold.has(idx) });
    return;
  }
  
  console.log('➕ Adding block:', idx);
  setCellState(idx, 'mine'); 
  myReservedSet.add(idx); 
  localStorage.setItem('iw_my_blocks', JSON.stringify(Array.from(myReservedSet)));
  updateBuyLabel();
  debugState();
  
  try {
    console.log('🔒 Sending lock request...');
    const r = await fetch('/.netlify/functions/lock', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ op:'add', blocks:[idx], reservationId: activeReservationId || undefined })
    });
    const res = await r.json();
    console.log('🔒 Lock response:', res);
    
    if (!r.ok) {
      if (r.status === 409) { 
        console.log('⚠️ Conflict, block taken by someone else');
        myReservedSet.delete(idx); 
        setCellState(idx, 'pending'); 
        localStorage.setItem('iw_my_blocks', JSON.stringify(Array.from(myReservedSet)));
        updateBuyLabel(); 
        return; 
      }
      throw new Error(res.error || ('HTTP '+r.status));
    }
    
    console.log('✅ Lock successful');
    activeReservationId = res.reservationId || activeReservationId;
    localStorage.setItem('iw_reservation_id', activeReservationId);
    myReservedSet = new Set(res.blocks || Array.from(myReservedSet));
    localStorage.setItem('iw_my_blocks', JSON.stringify(Array.from(myReservedSet)));
    
    console.log('🔄 Updating visual state...');
    for (const b of myReservedSet) setCellState(b, 'mine');
    
  } catch (e) {
    console.error('❌ Add failed:', e);
    myReservedSet.delete(idx); 
    setCellState(idx, 'free'); 
    localStorage.setItem('iw_my_blocks', JSON.stringify(Array.from(myReservedSet)));
    updateBuyLabel();
  }
  
  window.myReservedSet = myReservedSet;
  window.activeReservationId = activeReservationId;
  debugState();
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
  console.log('🖱️ Drag start:', idx);
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
  
  console.log('🖱️ Drag end, adding blocks:', additions);
  
  if (additions.length === 0) return;
  for (const i of additions) { setCellState(i, 'mine'); myReservedSet.add(i); }
  localStorage.setItem('iw_my_blocks', JSON.stringify(Array.from(myReservedSet)));
  updateBuyLabel();
  debugState();
  
  try {
    const r = await fetch('/.netlify/functions/lock', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ op:'add', blocks: additions, reservationId: activeReservationId || undefined })
    });
    const res = await r.json();
    console.log('🔒 Drag lock response:', res);
    
    if (!r.ok) {
      for (const i of additions) if (myReservedSet.has(i)) { myReservedSet.delete(i); setCellState(i, 'free'); }
      localStorage.setItem('iw_my_blocks', JSON.stringify(Array.from(myReservedSet)));
      updateBuyLabel();
      return;
    }
    activeReservationId = res.reservationId || activeReservationId;
    localStorage.setItem('iw_reservation_id', activeReservationId);
    myReservedSet = new Set(res.blocks || Array.from(myReservedSet));
    localStorage.setItem('iw_my_blocks', JSON.stringify(Array.from(myReservedSet)));
    for (const b of myReservedSet) setCellState(b, 'mine');
  } catch (e) {
    for (const i of additions) if (myReservedSet.has(i)) { myReservedSet.delete(i); setCellState(i, 'free'); }
    localStorage.setItem('iw_my_blocks', JSON.stringify(Array.from(myReservedSet)));
    updateBuyLabel();
    console.warn('❌ Drag add failed:', e);
  }
  window.myReservedSet = myReservedSet;
  window.activeReservationId = activeReservationId;
  debugState();
}

/* Modal */
function openModal(){
  console.log('📱 Opening modal...');
  debugState();
  
  // Verify we have blocks reserved
  if (myReservedSet.size === 0) {
    console.log('❌ No blocks selected when opening modal');
    alert('Please select blocks first.');
    return;
  }
  
  // Verify we have a reservation ID
  if (!activeReservationId) {
    console.log('⚠️ No reservation ID found, this is unexpected');
    // Don't block the modal, the blocks might still be valid
  }
  
  buyModal.classList.remove('hidden');
  const c = myReservedSet.size;
  
  console.log('📊 Modal data:', {
    blocks: c,
    pixels: c * 100,
    price: getCurrentBlockPrice() * c,
    reservationId: activeReservationId,
    blocksArray: Array.from(myReservedSet)
  });
  
  sumBlocks.textContent = c;
  sumPixels.textContent = c * 100;
  const total = Math.round(getCurrentBlockPrice() * c * 100) / 100;
  sumTotal.textContent = formatUSD(total);
  
  // Set the hidden field with blocks
  const blockIndexField = document.getElementById('blockIndex');
  if (blockIndexField) {
    blockIndexField.value = Array.from(myReservedSet).join(',');
    console.log('✅ Set blockIndex field:', blockIndexField.value);
  }
  
  console.log('✅ Modal opened successfully');
}

function closeModal(){ 
  console.log('🔒 Closing modal (NOT unlocking blocks)');
  buyModal.classList.add('hidden'); 
  // Reset form to clean state
  if (form) form.reset();
  if (imgPreview) imgPreview.src = '';
  // NOTE: We do NOT clear the blocks here - they stay reserved
}

// Buy button with DEBUG
buyButton.addEventListener('click', () => {
  console.log('🛒 Buy button clicked');
  debugState();
  
  if (myReservedSet.size === 0) { 
    alert('Please select blocks first.'); 
    console.log('❌ No blocks selected');
    return; 
  }
  
  console.log('✅ Opening modal with', myReservedSet.size, 'blocks');
  openModal();
});

// Cancel -> unlock (skip if purchase committed)
async function cancelAndUnlock() {
  console.log('❌ Canceling and unlocking...');
  closeModal();
  if (purchaseCommitted) {
    console.log('✅ Purchase committed, keeping blocks');
    return;
  }
  if (!activeReservationId && myReservedSet.size === 0) {
    console.log('⚠️ Nothing to unlock');
    return;
  }
  
  console.log('🔓 Unlocking', myReservedSet.size, 'blocks');
  for (const b of Array.from(myReservedSet)) setCellState(b, 'free');
  myReservedSet.clear();
  updateBuyLabel();
  
  if (activeReservationId) {
    try {
      await fetch('/.netlify/functions/unlock', {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ reservationId: activeReservationId })
      });
      console.log('✅ Unlock request sent');
    } catch (e) {
      console.warn('❌ Unlock failed:', e);
    }
    activeReservationId = null;
    localStorage.removeItem('iw_reservation_id');
    localStorage.removeItem('iw_my_blocks');
  }
  
  await loadStatus();
  window.myReservedSet = myReservedSet;
  window.activeReservationId = activeReservationId;
  debugState();
}

cancelForm?.addEventListener('click', (e) => { e.preventDefault(); cancelAndUnlock(); });
buyModal?.addEventListener('click', (e) => { if (e.target.matches('[data-close]')) { e.preventDefault(); cancelAndUnlock(); }});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !buyModal.classList.contains('hidden')) { e.preventDefault(); cancelAndUnlock(); }});

// Upload preview
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
fldImageFile?.addEventListener('change', async () => {
  const f = fldImageFile.files && fldImageFile.files[0];
  if (imgPreview) {
    imgPreview.src = f ? await fileToDataURL(f) : '';
  }
});

// Utility: after an error, check if the intended blocks are now SOLD with art
function areMyBlocksSoldWithArt() {
  const soldKeys = new Set(Object.keys(dynCells).map(k => +k));
  const wanted = Array.from(myReservedSet);
  let soldCount = 0;
  for (const b of wanted) if (soldKeys.has(b)) soldCount++;
  return wanted.length > 0 && soldCount / wanted.length >= 0.8;
}

// FORM SUBMISSION with extensive DEBUG
let submitting = false;
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    console.log('=== FORM SUBMISSION START ===');
    debugState();
    
    if (submitting) {
      console.log('❌ Already submitting, ignoring');
      return;
    }
    
    submitting = true;
    const prevLabel = submitBtn?.textContent || 'Confirm';
    
    if (submitBtn) { 
      submitBtn.disabled = true; 
      submitBtn.textContent = 'Processing…'; 
    }

    try {
      // Check blocks FIRST
      console.log('🔍 Checking blocks before validation...');
      debugState();
      
      if (myReservedSet.size === 0) {
        throw new Error('No blocks selected.');
      }
      
      // Validate required fields
      const file = fldImageFile?.files?.[0];
      const linkUrl = fldLink?.value?.trim();
      
      console.log('📋 Validation:', { 
        hasFile: !!file, 
        linkUrl, 
        selectedBlocks: myReservedSet.size
      });
      
      if (!file) {
        throw new Error('Please upload a profile image.');
      }
      if (!linkUrl) {
        throw new Error('Please enter your Instagram/TikTok/YouTube link.');
      }
      
      console.log('✅ All validation passed');
      console.log('📄 Converting file...');
      const image = await fileToDataURL(file);
      
      const blocks = Array.from(myReservedSet);
      console.log('📦 Final blocks array:', blocks);
      
      const payload = {
        reservationId: activeReservationId || localStorage.getItem('iw_reservation_id') || '',
        imageUrl: image,
        linkUrl: linkUrl,
        name: '',
        blocks: blocks,
        blockIndex: blocks.join(',')  // Add this for backwards compatibility
      };
      
      console.log('🚀 Sending payload with', blocks.length, 'blocks');
      
      const response = await fetch('/.netlify/functions/finalize', {
        method: 'POST', 
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const result = await response.json();
      console.log('📨 Response:', result);
      
      if (!response.ok || !result.ok) {
        console.warn('⚠️ Finalize failed, checking if blocks sold anyway...');
        await loadStatus();
        if (areMyBlocksSoldWithArt()) {
          console.log('✅ Blocks appear sold despite error');
          purchaseCommitted = true;
        } else {
          throw new Error(result.error || result.message || ('HTTP ' + response.status));
        }
      } else {
        console.log('✅ Finalize successful');
        purchaseCommitted = true;
      }

      console.log('🎉 Success!');
      
      activeReservationId = null; 
      localStorage.removeItem('iw_reservation_id');
      myReservedSet = new Set(); 
      localStorage.removeItem('iw_my_blocks');
      
      closeModal();
      await loadStatus();
      updateBuyLabel();
      
      window.myReservedSet = myReservedSet;
      window.activeReservationId = activeReservationId;
      
      alert('🎉 Purchase completed successfully!');
      
    } catch (error) {
      console.error('❌ PURCHASE FAILED:', error);
      alert('Could not complete purchase: ' + (error?.message || error));
    } finally {
      submitting = false;
      if (submitBtn) { 
        submitBtn.disabled = false; 
        submitBtn.textContent = prevLabel; 
      }
      console.log('=== FORM SUBMISSION END ===');
    }
  });
}

// Test functions for debugging
window.testSelection = function() {
  console.log('🧪 Testing selection of block 0...');
  myReservedSet.add(0);
  setCellState(0, 'mine');
  updateBuyLabel();
  debugState();
};

// Init
(async () => {
  console.log('🚀 Initializing app...');
  
  // Restore saved state first
  try {
    const savedBlocks = localStorage.getItem('iw_my_blocks');
    const savedReservation = localStorage.getItem('iw_reservation_id');
    
    if (savedBlocks) {
      const parsed = JSON.parse(savedBlocks);
      if (Array.isArray(parsed)) {
        myReservedSet = new Set(parsed.map(n => +n).filter(Number.isInteger));
        console.log('📦 Restored', myReservedSet.size, 'blocks from localStorage');
      }
    }
    
    if (savedReservation) {
      activeReservationId = savedReservation;
      console.log('🔑 Restored reservation ID:', activeReservationId.substring(0, 8) + '...');
    }
    
    window.myReservedSet = myReservedSet;
    window.activeReservationId = activeReservationId;
  } catch (e) {
    console.warn('⚠️ Failed to restore saved state:', e);
  }
  
  try {
    await loadData();
    buildGridOnce();
    await loadStatus();
    
    // Display restored blocks
    for (const b of myReservedSet) setCellState(b, 'mine');
    
    refreshHeader(); 
    updateBuyLabel();
    setInterval(loadStatus, STATUS_POLL_MS);
    console.log('✅ App initialized successfully');
    debugState();
  } catch (e) {
    console.error('❌ Init failed:', e);
    alert('Failed to initialize app: ' + e.message);
  }
})();

// Unlock on exit (only if reservation exists and not purchased)
window.addEventListener('pagehide', () => {
  if (!activeReservationId || purchaseCommitted) return;
  try {
    const payload = JSON.stringify({ reservationId: activeReservationId });
    const blob = new Blob([payload], { type: 'application/json' });
    navigator.sendBeacon('/.netlify/functions/unlock', blob);
  } catch (e) {
    console.warn('❌ Beacon unlock failed:', e);
  }
});