import { getStore } from '@netlify/blobs';
import { json } from './_common.js';

const STORE = 'reservations';
const STATE_KEY = 'state';
const now = () => Date.now();

export default async (req) => {
  try {
    if (req.method === 'OPTIONS') return json({}, 204);
    if (req.method !== 'POST') return json({ ok:false, error:'METHOD_NOT_ALLOWED' }, 405);

    const body = await req.json().catch(() => ({}));
    const reservationId = (body.reservationId || '').toString();
    const imageUrl = (body.imageUrl || '').toString();
    const linkUrl = (body.linkUrl || '').toString();
    const name = (body.name || '').toString();

    if (!reservationId) return json({ ok:false, error:'MISSING_ID' }, 400);
    if (!imageUrl) return json({ ok:false, error:'MISSING_IMAGE' }, 400);

    const store = getStore(STORE, { consistency: 'strong' });
    const state = (await store.get(STATE_KEY, { type: 'json' })) || { sold: {}, locks: {} };

    const lock = state.locks?.[reservationId];
    if (!lock || !Array.isArray(lock.blocks) || lock.blocks.length === 0) {
      return json({ ok:false, error:'LOCK_NOT_FOUND_OR_EMPTY' }, 404);
    }

    // Move blocks from lock -> sold (per-block artwork for simplicity)
    state.sold = state.sold || {};
    for (const b of lock.blocks) {
      state.sold[b] = { imageUrl, linkUrl, name, soldAt: now() };
    }
    delete state.locks[reservationId];

    await store.setJSON(STATE_KEY, state);
    return json({ ok:true, soldBlocks: lock.blocks, artCells: state.sold });
  } catch (e) {
    console.error('finalize error', e);
    return json({ ok:false, error:'SERVER_ERROR', message: e?.message || String(e) }, 500);
  }
};
