// Safety: enforce overlay stacking at runtime
(function(){
  const rl=document.getElementById('regionsLayer');
  const pg=document.getElementById('pixelGrid');
  if(rl){rl.style.position='absolute';rl.style.left='0';rl.style.top='0';rl.style.width='1000px';rl.style.height='1000px';rl.style.zIndex='20';}
  if(pg){pg.style.position='relative';pg.style.zIndex='10';}
})();