import { getStore } from '@netlify/blobs';
import { json } from './_common.js';

const STORE = 'reservations';
const STATE_KEY = 'state';

const now = () => Date.now();

function parseBlockIndexString(s) {
  if (!s) return [];
  const out = [];
  const seen = new Set();
  String(s).split(/[,\s;]+/).forEach(part => {
    const n = Number(part);
    if (Number.isInteger(n) && n >= 0 && n < 10000 && !seen.has(n)) { 
      seen.add(n); 
      out.push(n); 
    }
  });
  return out;
}

function uniqInts(list) {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach(v => {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n < 10000 && !seen.has(n)) { 
      seen.add(n); 
      out.push(n); 
    }
  });
  return out;
}

export default async function handler(req) {
  try {
    console.log('Finalize function called with method:', req.method);
    
    if (req.method === 'OPTIONS') {
      return json({}, 204);
    }
    
    if (req.method !== 'POST') {
      console.log('Method not allowed:', req.method);
      return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
    }

    // Parse request body
    let body = {};
    try {
      body = await req.json();
      console.log('Parsed JSON body successfully');
    } catch (error) {
      console.error('Failed to parse JSON body:', error);
      
      // Try to parse as form data
      try {
        const text = await req.text();
        const params = new URLSearchParams(text);
        body = Object.fromEntries(params.entries());
        console.log('Parsed as form data successfully');
      } catch (formError) {
        console.error('Failed to parse as form data:', formError);
        return json({ ok: false, error: 'INVALID_REQUEST_BODY' }, 400);
      }
    }

    console.log('Request body keys:', Object.keys(body));

    // Extract and validate required fields
    const reservationId = (body.reservationId || '').toString().trim();
    const imageUrl = (body.imageUrl || '').toString().trim();
    const linkUrl = (body.linkUrl || '').toString().trim();
    const name = (body.name || '').toString().trim();
    const blocksFromClient = uniqInts(body.blocks || []);
    const blocksFromHidden = parseBlockIndexString(body.blockIndex || body.blocksCsv || '');

    console.log('Extracted fields:', {
      hasReservationId: !!reservationId,
      hasImageUrl: !!imageUrl,
      hasLinkUrl: !!linkUrl,
      blocksFromClient: blocksFromClient.length,
      blocksFromHidden: blocksFromHidden.length
    });

    if (!imageUrl) {
      console.log('Missing image URL');
      return json({ ok: false, error: 'MISSING_IMAGE' }, 400);
    }

    if (!linkUrl) {
      console.log('Missing link URL');
      return json({ ok: false, error: 'MISSING_LINK' }, 400);
    }

    // Initialize store and get current state
    console.log('Initializing store...');
    const store = getStore(STORE, { consistency: 'strong' });
    
    let state;
    try {
      state = (await store.get(STATE_KEY, { type: 'json' })) || { sold: {}, locks: {} };
      console.log('Retrieved state successfully');
    } catch (error) {
      console.error('Failed to retrieve state:', error);
      return json({ ok: false, error: 'STORE_ACCESS_ERROR' }, 500);
    }

    // Determine blocks to finalize
    let blocks = [];
    const lock = reservationId && state.locks ? state.locks[reservationId] : null;
    
    if (lock && Array.isArray(lock.blocks) && lock.blocks.length) {
      blocks = lock.blocks.map(Number).filter(Number.isInteger);
      console.log('Using blocks from reservation:', blocks.length);
    } else {
      console.log('No valid reservation found, using client blocks');
      const candidates = blocksFromClient.length ? blocksFromClient : blocksFromHidden;
      
      if (candidates.length) {
        // Filter out already sold or locked by others
        const lockedAll = new Set();
        for (const [rid, lockData] of Object.entries(state.locks || {})) {
          if (lockData && Array.isArray(lockData.blocks)) {
            lockData.blocks.forEach(b => lockedAll.add(Number(b)));
          }
        }
        
        candidates.forEach(b => {
          if (!state.sold[b] && !lockedAll.has(b)) {
            blocks.push(b);
          }
        });
        console.log('Filtered available blocks:', blocks.length, 'from', candidates.length, 'candidates');
      }
    }

    if (!blocks.length) {
      console.log('No blocks to finalize');
      return json({ ok: false, error: 'NO_BLOCKS_TO_FINALIZE' }, 404);
    }

    console.log('Finalizing blocks:', blocks);

    // Mark blocks as sold
    state.sold = state.sold || {};
    const soldData = { 
      imageUrl, 
      linkUrl, 
      name: name || '', 
      soldAt: now() 
    };

    blocks.forEach(b => {
      state.sold[b] = soldData;
    });

    // Clean up the reservation
    if (reservationId && state.locks && state.locks[reservationId]) {
      delete state.locks[reservationId];
      console.log('Cleaned up reservation:', reservationId);
    }

    // Save updated state
    try {
      await store.setJSON(STATE_KEY, state);
      console.log('State saved successfully');
    } catch (error) {
      console.error('Failed to save state:', error);
      return json({ ok: false, error: 'STORE_SAVE_ERROR' }, 500);
    }

    console.log('Purchase finalized successfully for', blocks.length, 'blocks');
    return json({ 
      ok: true, 
      soldBlocks: blocks, 
      artCells: state.sold 
    });

  } catch (error) {
    console.error('Finalize function error:', error);
    return json({ 
      ok: false, 
      error: 'SERVER_ERROR', 
      message: error && error.message ? error.message : String(error) 
    }, 500);
  }
}