/* Netlify Functions – universal finalize (v1/v2 compatible, CJS)
 * - Accepts POST (JSON or form-urlencoded) and OPTIONS
 * - Falls back to client-sent `blocks` or `blockIndex` if reservationId is missing
 * - Uses @netlify/blobs store "reservations" (state.sold + state.locks)
 */
const { getStore } = require('@netlify/blobs');

const STORE = 'reservations';
const STATE_KEY = 'state';

function now(){ return Date.now(); }
function headers(extra = {}) {
  return Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Content-Type': 'application/json; charset=utf-8',
  }, extra);
}
function res(statusCode, obj) {
  return { statusCode, headers: headers(), body: JSON.stringify(obj) };
}
function isJsonCT(h) {
  const ct = h && (h['content-type'] || h['Content-Type'] || '');
  return /application\/json/i.test(ct);
}
function parseBlockIndexString(s) {
  if (!s) return [];
  const out = [];
  const seen = new Set();
  String(s).split(/[,\s;]+/).forEach(part => {
    const n = Number(part);
    if (Number.isInteger(n) && n >= 0 && n < 10000 && !seen.has(n)) { seen.add(n); out.push(n); }
  });
  return out;
}
function uniqInts(list) {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach(v => {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n < 10000 && !seen.has(n)) { seen.add(n); out.push(n); }
  });
  return out;
}

exports.handler = async function(event, context) {
  try {
    const method = String(event.httpMethod || (event.requestContext && event.requestContext.http && event.requestContext.http.method) || '').toUpperCase();
    if (method === 'OPTIONS') return res(204, {});
    if (method !== 'POST') return res(405, { ok:false, error:'METHOD_NOT_ALLOWED' });

    // Parse body (JSON or form)
    let body = {};
    if (isJsonCT(event.headers)) {
      try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
    } else {
      const txt = event.body || '';
      try { body = JSON.parse(txt); } catch {
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

    if (!imageUrl) return res(400, { ok:false, error:'MISSING_IMAGE' });

    const store = getStore(STORE, { consistency: 'strong' });
    const state = (await store.get(STATE_KEY, { type: 'json' })) || { sold: {}, locks: {} };

    // Determine blocks to finalize
    let blocks = [];
    const lock = reservationId ? (state.locks && state.locks[reservationId]) : null;
    if (lock && Array.isArray(lock.blocks) && lock.blocks.length) {
      blocks = lock.blocks.map(Number).filter(Number.isInteger);
    } else {
      const candidates = blocksFromClient.length ? blocksFromClient : blocksFromHidden;
      if (candidates.length) {
        // Filter out already sold or locked by others
        const lockedAll = new Set();
        for (const rid of Object.keys(state.locks || {})) {
          const l = state.locks[rid];
          (l && Array.isArray(l.blocks) ? l.blocks : []).forEach(b => lockedAll.add(Number(b)));
        }
        candidates.forEach(b => {
          if (!state.sold[b] && !lockedAll.has(b)) blocks.push(b);
        });
      }
    }

    if (!blocks.length) return res(404, { ok:false, error:'LOCK_NOT_FOUND_OR_EMPTY' });

    // Mark sold
    state.sold = state.sold || {};
    blocks.forEach(b => {
      state.sold[b] = { imageUrl, linkUrl, name, soldAt: now() };
    });

    // Clean lock
    if (reservationId && state.locks && state.locks[reservationId]) {
      delete state.locks[reservationId];
    }

    await store.setJSON(STATE_KEY, state);
    return res(200, { ok:true, soldBlocks: blocks, artCells: state.sold });
  } catch (e) {
    console.error('finalize error', e);
    return res(500, { ok:false, error:'SERVER_ERROR', message: e && e.message ? e.message : String(e) });
  }
};
