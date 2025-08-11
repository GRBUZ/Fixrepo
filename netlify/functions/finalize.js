import { getStore } from '@netlify/blobs';
import { json } from './_common.js';

const STORE = 'reservations';
const STATE_KEY = 'state';
const now = () => Date.now();

function uniqInts(list) {
  const out = [];
  const seen = new Set();
  for (const v of list || []) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n < 10000 && !seen.has(n)) {
      seen.add(n); out.push(n);
    }
  }
  return out;
}

export default async (req) => {
  try {
    if (req.method === 'OPTIONS') return json({}, 204);
    if (req.method !== 'POST') return json({ ok:false, error:'METHOD_NOT_ALLOWED' }, 405);

    const body = await req.json().catch(() => ({}));
    const reservationId = (body.reservationId || '').toString();
    const imageUrl = (body.imageUrl || '').toString();
    const linkUrl = (body.linkUrl || '').toString();
    const name = (body.name || '').toString();
    const blocksFromClient = uniqInts(body.blocks || []);

    if (!imageUrl) return json({ ok:false, error:'MISSING_IMAGE' }, 400);

    const store = getStore(STORE, { consistency: 'strong' });
    const state = (await store.get(STATE_KEY, { type: 'json' })) || { sold: {}, locks: {} };

    // Determine blocks to finalize
    let blocks = [];
    const lock = reservationId ? state.locks?.[reservationId] : null;
    if (lock && Array.isArray(lock.blocks) && lock.blocks.length) {
      blocks = lock.blocks.map(Number).filter(Number.isInteger);
    } else if (blocksFromClient.length) {
      // Fallback: take client blocks that are not sold and not locked by others
      const lockedAll = new Set();
      for (const [rid, l] of Object.entries(state.locks || {})) {
        for (const b of (l.blocks || [])) lockedAll.add(Number(b));
      }
      for (const b of blocksFromClient) {
        if (!state.sold[b] && !lockedAll.has(b)) blocks.push(b);
      }
    } else {
      return json({ ok:false, error:'LOCK_NOT_FOUND_OR_EMPTY' }, 404);
    }

    if (blocks.length === 0) {
      return json({ ok:false, error:'NO_BLOCKS_AVAILABLE' }, 409);
    }

    // Mark sold
    state.sold = state.sold || {};
    for (const b of blocks) {
      state.sold[b] = { imageUrl, linkUrl, name, soldAt: now() };
    }

    // Clean up lock if present
    if (reservationId && state.locks && state.locks[reservationId]) {
      delete state.locks[reservationId];
    }

    await store.setJSON(STATE_KEY, state);
    return json({ ok:true, soldBlocks: blocks, artCells: state.sold });
  } catch (e) {
    console.error('finalize error', e);
    return json({ ok:false, error:'SERVER_ERROR', message: e?.message || String(e) }, 500);
  }
};
