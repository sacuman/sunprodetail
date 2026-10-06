// Decorative ImageGen artwork fills actual incomplete gallery rows only.
// Artwork never enters photo data, totals, lightbox navigation or enquiry uploads.
export const pencilPools = {
  home:['images/pencil/home-interior-vacuum.png','images/pencil/home-roof-mitt.png'],
  gallery:['images/pencil/gallery-wheel-dry.png','images/pencil/gallery-seat-care.png']
};
export const pencilPool = pencilPools.gallery;
export function missingSlots(count, columns) { return count > 0 && columns > 1 ? (columns - count % columns) % columns : 0; }
export function pencilPicks(count, columns, seed, key, size = pencilPool.length) {
  let hash = seed >>> 0; for (const char of key) hash = (Math.imul(hash,31) + char.charCodeAt(0)) >>> 0;
  return Array.from({length:missingSlots(count,columns)},(_,index)=>(hash+index)%size);
}
export function fillWorkGrid(grid,{columns,seed,key=grid.dataset.pencilKey||'all'}={}) {
  const count = [...grid.querySelectorAll('.work-card')].filter(card=>!card.hidden).length;
  const pool=key==='home'?pencilPools.home:pencilPools.gallery;
  const picks = pencilPicks(count,columns,seed,key,pool.length);
  const signature = `${count}:${columns}:${key}:${picks.join(',')}`;
  if (grid.dataset.pencilSignature === signature) return;
  grid.dataset.pencilSignature = signature;
  grid.querySelectorAll('.care-scene').forEach(figure=>figure.remove());
  for(const index of picks) {
    const doc=grid.ownerDocument,figure=doc.createElement('figure'),img=doc.createElement('img');
    figure.className='care-scene';img.src=pool[index];img.alt='Decorative pencil illustration of car detailing';img.width=1536;img.height=1024;
    figure.append(img);grid.append(figure);
  }
}
if(typeof document!=='undefined') {
  let seed;try {seed=Number(sessionStorage.getItem('sunpro-pencil-seed'));if(!seed){seed=crypto.getRandomValues(new Uint32Array(1))[0]||1;sessionStorage.setItem('sunpro-pencil-seed',String(seed));}}catch{seed=Math.floor(Math.random()*4294967295)||1;}
  const watched=new WeakSet();
  const update=grid=>fillWorkGrid(grid,{seed,columns:getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length});
  const resize=typeof ResizeObserver!=='undefined'?new ResizeObserver(entries=>entries.forEach(entry=>update(entry.target))):null;
  const refresh=()=>document.querySelectorAll('.work-grid').forEach(grid=>{update(grid);if(!watched.has(grid)){watched.add(grid);resize?.observe(grid);}});
  Object.values(pencilPools).flat().forEach(source=>{const img=new Image();img.src=source;});
  refresh();const root=document.getElementById('galleryRoot');
  if(root)new MutationObserver(refresh).observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','data-pencil-key']});
  if(!resize)window.addEventListener('resize',refresh);
}
