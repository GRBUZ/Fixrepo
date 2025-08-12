/* DEBUG VERSION - finalize.js with extensive logging */
import { getStore } from '@netlify/blobs';

const STORE = 'reservations';
const STATE_KEY = 'state';

function now() { return Date.now(); }

function headers(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Content-Type': 'application/json; charset=utf-8',
    ...extra
  };
}

function res(statusCode, obj) {
  console.log(`RESPONSE [${statusCode}]:`, JSON.stringify(obj));
  return new Response(JSON.stringify(obj), {
    status: statusCode,
    headers: headers()
  });
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

export default async function handler(request) {
  console.log('=== FINALIZE FUNCTION START ===');
  console.log('Request method:', request.method);
  console.log('Request URL:', request.url);
  console.log('Request headers:', Object.fromEntries(request.headers.entries()));

  try {
    const method = request.method?.toUpperCase();
    
    if (method === 'OPTIONS') {
      console.log('OPTIONS request - returning CORS headers');
      return res(204, {});
    }
    
    if (method !== 'POST') {
      console.log('Invalid method:', method);
      return res(405, { ok:false, error:'METHOD_NOT_ALLOWED' });
    }

    // Parse body
    console.log('Reading request body...');
    const rawBody = await request.text();
    console.log('Raw body length:', rawBody.length);
    console.log('Raw body preview:', rawBody.substring(0, 200) + '...');

    let body = {};
    const contentType = request.headers.get('content-type') || '';
    console.log('Content-Type:', contentType);
    
    if (contentType.includes('application/json')) {
      try { 
        body = JSON.parse(rawBody); 
        console.log('Parsed JSON body successfully');
      } catch (e) { 
        console.error('JSON parse failed:', e.message);
        return res(400, { ok:false, error:'INVALID_JSON' });
      }
    } else {
      try { 
        body = JSON.parse(rawBody); 
        console.log('Parsed as JSON fallback');
      } catch {
        console.log('Parsing as URLSearchParams...');
        const params = new URLSearchParams(rawBody);
        body = Object.fromEntries(params.entries());
        console.log('Parsed URLSearchParams successfully');
      }
    }

    console.log('Parsed body keys:', Object.keys(body));
    console.log('Body preview:', JSON.stringify(body).substring(0, 300) + '...');

    const reservationId = (body.reservationId || '').toString();
    const imageUrl = (body.imageUrl || '').toString();
    const linkUrl = (body.linkUrl || '').toString();
    const name = (body.name || '').toString();
    const blocksFromClient = uniqInts(body.blocks || []);
    const blocksFromHidden = parseBlockIndexString(body.blockIndex || body.blocksCsv || '');

    console.log('Extracted data:', {
      reservationId: reservationId.substring(0, 8) + '...',
      imageUrlLength: imageUrl.length,
      linkUrl,
      name,
      blocksFromClient: blocksFromClient.slice(0, 10),
      blocksFromHidden: blocksFromHidden.slice(0, 10)
    });

    if (!imageUrl) {
      console.log('ERROR: Missing image URL');
      return res(400, { ok:false, error:'MISSING_IMAGE' });
    }

    console.log('Getting store...');
    const store = getStore(STORE, { consistency: 'strong' });
    console.log('Store obtained, fetching state...');
    
    const state = await store.get(STATE_KEY, { type: 'json' }).catch(e => {
      console.error('Store.get failed:', e);
      return null;
    }) || { sold: {}, locks: {} };
    
    console.log('Current state loaded:', { 
      soldCount: Object.keys(state.sold || {}).length, 
      locksCount: Object.keys(state.locks || {}).length 
    });

    // Determine blocks to finalize
    let blocks = [];
    const lock = reservationId ? (state.locks && state.locks[reservationId]) : null;
    
    console.log('Looking for reservation:', reservationId);
    console.log('Found lock:', lock ? 'YES' : 'NO');
    
    if (lock && Array.isArray(lock.blocks) && lock.blocks.length) {
      blocks = lock.blocks.map(Number).filter(Number.isInteger);
      console.log('Using blocks from reservation:', blocks);
    } else {
      console.log('No valid reservation found, using fallback blocks...');
      const candidates = blocksFromClient.length ? blocksFromClient : blocksFromHidden;
      console.log('Candidates:', candidates);
      
      if (candidates.length) {
        // Filter out already sold or locked by others
        const lockedAll = new Set();
        for (const rid of Object.keys(state.locks || {})) {
          const l = state.locks[rid];
          if (l && Array.isArray(l.blocks)) {
            l.blocks.forEach(b => lockedAll.add(Number(b)));
          }
        }
        console.log('Already locked blocks:', Array.from(lockedAll));
        console.log('Already sold blocks:', Object.keys(state.sold || {}));
        
        candidates.forEach(b => {
          if (!state.sold[b] && !lockedAll.has(b)) {
            blocks.push(b);
          }
        });
        console.log('Final blocks after filtering:', blocks);
      }
    }

    if (!blocks.length) {
      console.log('ERROR: No blocks found to finalize');
      return res(404, { ok:false, error:'LOCK_NOT_FOUND_OR_EMPTY' });
    }

    console.log('Finalizing', blocks.length, 'blocks:', blocks);

    // Mark sold
    state.sold = state.sold || {};
    const soldData = { imageUrl, linkUrl, name, soldAt: now() };
    blocks.forEach(b => {
      state.sold[b] = soldData;
      console.log('Marked block', b, 'as sold');
    });

    // Clean lock
    if (reservationId && state.locks && state.locks[reservationId]) {
      delete state.locks[reservationId];
      console.log('Cleaned reservation:', reservationId);
    }

    console.log('Saving state...');
    await store.setJSON(STATE_KEY, state);
    console.log('State saved successfully!');

    const response = { ok: true, soldBlocks: blocks, artCells: state.sold };
    console.log('SUCCESS: Returning response with', blocks.length, 'sold blocks');
    
    return res(200, response);
    
  } catch (error) {
    console.error('=== FINALIZE FUNCTION ERROR ===');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    return res(500, { 
      ok: false, 
      error: 'SERVER_ERROR', 
      message: error.message,
      type: error.constructor.name
    });
  }
}