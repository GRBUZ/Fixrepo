// Client patch: send blocks with finalize so server can fallback even if reservationId is lost
// Keep existing features (drag select, cancel->unlock, upload-only modal)

/* expects rest of your current app.optimized.js above this line;
   we override only the submit handler to include blocks in payload */

(function(){
  const form = document.getElementById('influencerForm');
  const fldImageFile = document.getElementById('fldImageFile');
  const buyModal = document.getElementById('buyModal');

  // helpers we rely on from your main file:
  // - myReservedSet (Set of indices)
  // - activeReservationId
  // - loadStatus(), updateBuyLabel(), closeModal()

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const file = fldImageFile.files && fldImageFile.files[0];
    if (!file) { alert('Please upload a profile image.'); return; }
    const image = await fileToDataURL(file);

    const blocks = Array.from(window.myReservedSet ? window.myReservedSet : new Set());
    try { await fetch(form.action || '/', { method: 'POST', body: data }); } catch {}

    try {
      const payload = {
        reservationId: window.activeReservationId || localStorage.getItem('iw_reservation_id') || '',
        imageUrl: image,
        linkUrl: data.get('linkUrl'),
        name: data.get('name') || '',
        blocks
      };
      const r = await fetch('/.netlify/functions/finalize', {
        method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify(payload)
      });
      const res = await r.json();
      if (!r.ok || !res.ok) throw new Error(res.error || ('HTTP '+r.status));

      window.activeReservationId = null; localStorage.removeItem('iw_reservation_id');
      window.myReservedSet = new Set(); localStorage.removeItem('iw_my_blocks');
      if (typeof closeModal === 'function') closeModal();
      await (window.loadStatus && window.loadStatus());
      if (window.updateBuyLabel) window.updateBuyLabel();
    } catch (e2) {
      alert('Could not finalize: ' + (e2?.message || e2));
    }
  }, { capture: true });
})();