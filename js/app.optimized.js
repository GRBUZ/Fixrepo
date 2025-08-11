// Remplacer la section du submit handler dans js/app.optimized.js
// FIXED: Single unified submit handler avec meilleure gestion d'erreur
let submitting = false;
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (submitting) {
      console.log('Already submitting, ignoring duplicate submission');
      return;
    }
    
    submitting = true;
    const prevLabel = submitBtn?.textContent || 'Confirm';
    
    if (submitBtn) { 
      submitBtn.disabled = true; 
      submitBtn.textContent = 'Processing…'; 
    }

    try {
      console.log('Starting submission process...');
      
      // Validate required fields
      const file = fldImageFile?.files?.[0];
      const linkUrl = fldLink?.value?.trim();
      
      if (!file) {
        throw new Error('Please upload a profile image.');
      }
      if (!linkUrl) {
        throw new Error('Please enter your Instagram/TikTok/YouTube link.');
      }
      
      console.log('Converting file to data URL...');
      let image;
      try {
        image = await fileToDataURL(file);
        console.log('Image converted successfully, size:', image.length);
      } catch (error) {
        console.error('Image conversion failed:', error);
        throw new Error('Failed to process image file.');
      }
      
      // Prepare form data for Netlify Forms (best effort, non-blocking)
      try {
        const data = new FormData(form);
        const blocks = Array.from(myReservedSet);
        data.set('blockIndex', blocks.join(','));
        
        console.log('Submitting to Netlify Forms...');
        await fetch(form.action || '/', { 
          method: 'POST', 
          body: data,
          signal: AbortSignal.timeout(5000) // 5 second timeout
        });
      } catch (e) {
        console.warn('Netlify Forms submission failed (non-critical):', e);
      }

      // Prepare payload for finalize function
      const blocks = Array.from(myReservedSet);
      const payload = {
        reservationId: activeReservationId || localStorage.getItem('iw_reservation_id') || '',
        imageUrl: image,
        linkUrl: linkUrl,
        name: '', // Add name field if needed
        blocks: blocks
      };
      
      console.log('Calling finalize function with payload keys:', Object.keys(payload));
      console.log('Blocks count:', blocks.length);
      console.log('Image data length:', image ? image.length : 0);
      
      // Call finalize function with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch('/.netlify/functions/finalize', {
        method: 'POST', 
        headers: { 
          'content-type': 'application/json',
          'accept': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      let result;
      try {
        result = await response.json();
        console.log('Finalize response:', result);
      } catch (jsonError) {
        console.error('Failed to parse response JSON:', jsonError);
        const text = await response.text();
        console.error('Response text:', text);
        throw new Error('Invalid response from server: ' + (response.status || 'unknown status'));
      }
      
      if (!response.ok || !result.ok) {
        console.warn('Finalize failed, response status:', response.status);
        console.warn('Result:', result);
        
        // Force-refresh status; maybe finalize actually succeeded server-side
        await loadStatus();
        if (areMyBlocksSoldWithArt()) {
          console.log('Blocks appear to have been sold successfully despite error');
          purchaseCommitted = true;
        } else {
          const errorMsg = result.error || result.message || ('HTTP ' + response.status);
          throw new Error(`Purchase failed: ${errorMsg}`);
        }
      } else {
        console.log('Purchase finalized successfully!');
        purchaseCommitted = true;
      }

      // Success path (normal or rescued)
      activeReservationId = null; 
      localStorage.removeItem('iw_reservation_id');
      myReservedSet = new Set(); 
      localStorage.removeItem('iw_my_blocks');
      
      closeModal();
      await loadStatus();
      updateBuyLabel();
      
      // Update global references
      window.myReservedSet = myReservedSet;
      window.activeReservationId = activeReservationId;
      
      alert('🎉 Purchase completed successfully! Your pixels are now live on the wall.');
      
    } catch (error) {
      console.error('Purchase error:', error);
      
      // More specific error messages
      let errorMessage = 'Could not complete purchase';
      if (error.name === 'AbortError') {
        errorMessage += ': Request timeout - please try again';
      } else if (error.message) {
        errorMessage += ': ' + error.message;
      } else {
        errorMessage += ': Unknown error occurred';
      }
      
      alert(errorMessage);
    } finally {
      submitting = false;
      if (submitBtn) { 
        submitBtn.disabled = false; 
        submitBtn.textContent = prevLabel; 
      }
    }
  });
}