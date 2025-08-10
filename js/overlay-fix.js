(function(){
  const rl = document.getElementById('regionsLayer');
  const pg = document.getElementById('pixelGrid');
  if (rl) {
    rl.style.position='absolute';
    rl.style.left='0'; rl.style.top='0'; rl.style.right='0'; rl.style.bottom='0';
    rl.style.zIndex='20';
    rl.style.pointerEvents='none';
  }
  if (pg) { pg.style.position='relative'; pg.style.zIndex='10'; }
})();