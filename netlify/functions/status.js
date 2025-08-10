import { getStore } from '@netlify/blobs';
import { json } from './_common.js';

const STORE = 'reservations';
const STATE_KEY = 'state';
const now = () => Date.now();

export default async () => {
  try {
    const store = getStore(STORE, { consistency: 'strong' });
    const state = (await store.get(STATE_KEY, { type: 'json' })) || { sold: {}, locks: {} };

    // prune expired
    let mutated = false;
    const t = now();
    for (const [rid, lock] of Object.entries(state.locks || {})) {
      if (!lock?.expireAt || lock.expireAt <= t) { delete state.locks[rid]; mutated = true; }
    }
    if (mutated) await store.setJSON(STATE_KEY, state);

    const pending = new Set();
    for (const lock of Object.values(state.locks || {})) {
      if (lock?.expireAt > t) for (const b of (lock.blocks || [])) pending.add(+b);
    }
    const sold = Object.keys(state.sold || {}).map(n => +n);

    return json({ ok:true, now:t, pending:Array.from(pending), sold });
  } catch (e) {
    console.error('status error', e);
    return json({ ok:false, error:'SERVER_ERROR', message:e?.message || String(e) }, 500);
  }
};
