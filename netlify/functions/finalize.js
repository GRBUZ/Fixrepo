/* Netlify Functions – universal finalize (v1/v2 compatible, ES Modules)
 * - Accepts POST (JSON or form-urlencoded) and OPTIONS
 * - Falls back to client-sent `blocks` or `blockIndex` if reservationId is missing
 * - Uses @netlify/blobs store "reservations" (state.sold + state.locks)
 */
import { getStore } from '@netlify/blobs';
import { json } from './_common.js';

const STORE = 'reservations';
const STATE_KEY = 'state';

function now(){ return Date.now(); }

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

function isJsonCT(headers) {
  const ct = headers && (headers['content-type'] || headers['Content-Type'] || '');
  return /application\/json/i.test(ct);
}

export default async function handler(request) {
  try {
    const method = request.method?.toUpperCase();
    if (method === 'OPTIONS') return json({}, 204);
    if (method !== 'POST') return json({ ok:false, error:'METHOD_NOT_ALLOWED' }, 405);

    // Parse body (JSON or form)
    let body = {};
    const rawBody = await request.text().catch(() => '');
    
    if (isJsonCT(request.headers)) {
      try { 
        body = JSON.parse(rawBody || '{}'); 
      } catch { 
        body = {}; 
      }
    } else {
      try { 
        body = JSON.parse(rawBody); 
      } catch {
        const params = new URLSearchParams(rawBody);
        body = Object.fromEntries(params.entries());
      }
    }

    const reservationId = (body.reservationId || '').toString();
    const imageUrl = (body.imageUrl || '').toString();
    const linkUrl = (body.linkUrl || '').toString();
    const name = (body.name || '').toString();
    const blocksFromClient = uniqInts(body.blocks || []);
    const blocksFromHidden = parseBlockIndexString(body.blockIndex || body.blocksCsv || '');

    if (!imageUrl) {
      return json({ ok:false, error:'MISSING_IMAGE' }, 400);
    }

    console.log('Finalize request:', { reservationId, linkUrl, name, blocksFromClient, blocksFromHidden });

    const store = getStore(STORE, { consistency: 'strong' });
    const state = (await store.get(STATE_KEY, { type: 'json' })) || { sold: {}, locks: {} };

    console.log('Current state:', { soldCount: Object.keys(state.sold).length, locksCount: Object.keys(state.locks).length });

    // Determine blocks to finalize
    let blocks = [];
    const lock = reservationId ? (state.locks && state.locks[reservationId]) : null;
    
    if (lock && Array.isArray(lock.blocks) && lock.blocks.length) {
      blocks = lock.blocks.map(Number).filter(Number.isInteger);
      console.log('Using blocks from reservation:', blocks);
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
        console.log('Using fallback blocks:', blocks, 'from candidates:', candidates);
      }
    }

    if (!blocks.length) {
      console.log('No blocks found to finalize');
      return json({ ok:false, error:'LOCK_NOT_FOUND_OR_EMPTY' }, 404);
    }

    console.log('Finalizing blocks:', blocks);

    // Mark sold
    state.sold = state.sold || {};
    blocks.forEach(b => {
      state.sold[b] = { imageUrl, linkUrl, name, soldAt: now() };
    });

    // Clean lock
    if (reservationId && state.locks && state.locks[reservationId]) {
      delete state.locks[reservationId];
      console.log('Cleaned reservation:', reservationId);
    }

    await store.setJSON(STATE_KEY, state);
    console.log('State saved successfully. New sold count:', Object.keys(state.sold).length);

    return json({ ok:true, soldBlocks: blocks, artCells: state.sold });
  } catch (error) {
    console.error('finalize error:', error);
    return json({ 
      ok:false, 
      error:'SERVER_ERROR', 
      message: error && error.message ? error.message : String(error),
      stack: error.stack
    }, 500);
  }
}