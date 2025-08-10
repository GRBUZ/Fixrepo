import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';
import { json } from './_common.js';

const STORE = 'reservations';
const STATE_KEY = 'state';
const HOLD_MS = 3 * 60 * 1000; // 3 minutes

const now = () => Date.now();

function normalizeBlocks(list) {
  return Array.from(new Set((list || []).map(n => parseInt(n)).filter(n => Number.isInteger(n) && n >= 0 && n < 10000)));
}

async function readStateStrong() {
  const store = getStore(STORE, { consistency: 'strong' });
  const state = (await store.get(STATE_KEY, { type: 'json' })) || { sold: {}, locks: {} };
  // prune expired
  const t = now();
  let mutated = false;
  for (const [rid, lock] of Object.entries(state.locks)) {
    if (!lock?.expireAt || lock.expireAt <= t) {
      delete state.locks[rid];
      mutated = true;
    }
  }
  if (mutated) await store.setJSON(STATE_KEY, state);
  return { store, state };
}

function takenSet(state, excludeRid = null) {
  const set = new Set(Object.keys(state.sold || {}).map(n => +n));
  const t = now();
  for (const [rid, lock] of Object.entries(state.locks || {})) {
    if (excludeRid && rid === excludeRid) continue;
    if (lock?.expireAt > t) for (const b of (lock.blocks || [])) set.add(+b);
  }
  return set;
}

export default async (req) => {
  try {
    if (req.method === 'OPTIONS') return json({}, 204);
    if (req.method !== 'POST') return json({ ok:false, error:'METHOD_NOT_ALLOWED' }, 405);

    const body = await req.json().catch(() => ({}));
    const op = (body.op || 'add').toLowerCase(); // 'add' | 'remove' | 'set'
    const incoming = normalizeBlocks(body.blocks);
    const reservationId = (body.reservationId || '').toString() || null;
    const email = (body.email || '').toString().slice(0, 200);

    if (!incoming.length && op !== 'set') return json({ ok:false, error:'NO_BLOCKS' }, 400);

    const { store, state } = await readStateStrong();

    let rid = reservationId;
    let lock = rid ? (state.locks[rid] || null) : null;
    if (!lock) {
      if (op === 'remove') return json({ ok:false, error:'RESERVATION_NOT_FOUND' }, 404);
      rid = randomUUID();
      lock = state.locks[rid] = { blocks: [], email, createdAt: now(), expireAt: now() + HOLD_MS };
    }

    const current = new Set(lock.blocks || []);
    let next;
    if (op === 'add') next = new Set([...current, ...incoming]);
    else if (op === 'remove') { next = new Set(current); for (const b of incoming) next.delete(b); }
    else if (op === 'set') next = new Set(incoming);
    else return json({ ok:false, error:'BAD_OP' }, 400);

    const newOnes = [...next].filter(b => !current.has(b));
    const taken = takenSet(state, rid);
    const conflicts = newOnes.filter(b => taken.has(b));
    if (conflicts.length) return json({ ok:false, error:'CONFLICT', conflicts }, 409);

    lock.blocks = Array.from(next).sort((a,b)=>a-b);
    lock.expireAt = now() + HOLD_MS; // refresh TTL
    state.locks[rid] = lock;

    if (!lock.blocks.length) {
      delete state.locks[rid];
      await store.setJSON(STATE_KEY, state);
      return json({ ok:true, reservationId: null, blocks: [] });
    }

    await store.setJSON(STATE_KEY, state);

    return json({ ok:true, reservationId: rid, blocks: lock.blocks, expireAt: lock.expireAt });
  } catch (e) {
    console.error('lock error', e);
    return json({ ok:false, error:'SERVER_ERROR', message: e?.message || String(e) }, 500);
  }
};
