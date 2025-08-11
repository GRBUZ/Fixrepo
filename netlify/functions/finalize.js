import { getStore } from '@netlify/blobs';
import { json } from './_common.js';

const STORE = 'reservations';
const STATE_KEY = 'state';
const now = () => Date.now();

function parseMaybeJSON(body) {
  try { return typeof body === 'object' ? body : JSON.parse(body); } catch { return {}; }
}
function parseBlockIndexString(s) {
  if (!s) return [];
  const out = [];
  const seen = new Set();
  for (const part of String(s).split(/[\s,;]+/)) {
    const n = Number(part);
    if (Number.isInteger(n) && n >= 0 && n < 10000 && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}
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

    // Robust body parse (JSON or form-encoded)
    let body = {};
    const ct = (req.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      body = await req.json().catch(() => ({}));
    } else {
      const txt = await req.text();
      // Try as JSON first, else parse querystring-like
      body = parseMaybeJSON(txt);
      if (!Object.keys(body).length) {
        const params = new URLSearchParams(txt);
        body = Object.fromEntries(params.entries());
      }
    }

    const reservationId = (body.reservationId || '').toString();
    const imageUrl = (body.imageUrl || '').toString();
    const linkUrl = (body.linkUrl || '').toString();
    const name = (body.name || '').toString();
    const blocksFromClient = uniqInts(body.blocks || []);
    const blocksFromHidden = parseBlockIndexString(body.blockIndex || body.blocksCsv || '');

    if (!imageUrl) return json({ ok:false, error:'MISSING_IMAGE' }, 400);

    const store = getStore(STORE, { consistency: 'strong' });
    const state = (await store.get(STATE_KEY, { type: 'json' })) || { sold: {}, locks: {} };

    // Determine blocks to finalize
    let blocks = [];
    const lock = reservationId ? state.locks?.[reservationId] : null;
    if (lock && Array.isArray(lock.blocks) && lock.blocks.length) {
      blocks = lock.blocks.map(Number).filter(Number.isInteger);
    } else {
      // Fallback: from client (explicit array) or hidden field
      const candidates = blocksFromClient.length ? blocksFromClient : blocksFromHidden;
      if (candidates.length) {
        // filter out sold or locked by others
        const lockedAll = new Set();
        for (const [rid, l] of Object.entries(state.locks || {})) {
          for (const b of (l.blocks || [])) lockedAll.add(Number(b));
        }
        for (const b of candidates) {
          if (!state.sold[b] && !lockedAll.has(b)) blocks.push(b);
        }
      }
    }

    if (!blocks.length) {
      return json({ ok:false, error:'LOCK_NOT_FOUND_OR_EMPTY' }, 404);
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
