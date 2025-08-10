import { getStore } from '@netlify/blobs';
import { json } from './_common.js';

const STORE = 'reservations';
const STATE_KEY = 'state';

export default async (req) => {
  try {
    if (req.method === 'OPTIONS') return json({}, 204);
    if (req.method !== 'POST') return json({ ok:false, error:'METHOD_NOT_ALLOWED' }, 405);

    const body = await req.json().catch(() => ({}));
    const rid = (body.reservationId || '').toString();
    if (!rid) return json({ ok:false, error:'MISSING_ID' }, 400);

    const store = getStore(STORE, { consistency: 'strong' });
    const state = (await store.get(STATE_KEY, { type: 'json' })) || { sold: {}, locks: {} };

    if (state.locks && state.locks[rid]) {
      delete state.locks[rid];
      await store.setJSON(STATE_KEY, state);
      return json({ ok:true });
    }
    return json({ ok:false, error:'NOT_FOUND' }, 404);
  } catch (e) {
    console.error('unlock error', e);
    return json({ ok:false, error:'SERVER_ERROR', message: e?.message || String(e) }, 500);
  }
};
