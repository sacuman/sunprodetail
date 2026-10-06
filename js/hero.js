import { FIREBASE_CONFIG } from './firebase-config.js';
import { safePhotoURL } from './quote-utils.js';

const categories = [
  ['refresh', 'REFRESH DETAILING'], ['correction', 'PAINT CORRECTION'], ['ceramic', 'CERAMIC COATING']
];
const fallbackPhotos = [
  ['hero-results', 'PAINT CORRECTION'], ['refresh-result', 'REFRESH DETAILING'],
  ['paint-result', 'PAINT CORRECTION'], ['ceramic-result', 'CERAMIC COATING']
].map(([file, label]) => ({ url:`images/real/${file}-1200.webp`, srcset:`images/real/${file}-640.webp 640w, images/real/${file}-1200.webp 1200w`, label }));

export function uploadedTime(photo) {
  const value = typeof photo.uploadedAt === 'number' ? photo.uploadedAt : photo.uploadedAt?.toMillis?.();
  return Number.isFinite(value) && value > 0 ? value : 0;
}
export function latestHeroPhotos(photos, limit = 4) {
  const seen = new Set();
  return photos.filter(photo => safePhotoURL(photo.url))
    .sort((a,b) => uploadedTime(b)-uploadedTime(a) || (a.order||0)-(b.order||0))
    .filter(photo => { if(seen.has(photo.url)) return false; seen.add(photo.url); return true; })
    .slice(0,limit);
}
export async function readHeroPhotos(readCategory) {
  const results = await Promise.allSettled(categories.map(async ([id,label]) =>
    (await readCategory(id)).map(photo => ({...photo,label}))));
  return latestHeroPhotos(results.flatMap(result => result.status==='fulfilled' ? result.value : []));
}
async function loadUploadedPhotos() {
  const [{initializeApp,getApps},{getFirestore,collection,getDocs}] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js')
  ]);
  const app=getApps()[0] || initializeApp(FIREBASE_CONFIG),db=getFirestore(app);
  return readHeroPhotos(async id => {
    const snapshot=await getDocs(collection(db,'gallery',id,'photos'));
    return snapshot.docs.map(doc => ({id:doc.id,...doc.data()}));
  });
}
export async function setupHero(loadPhotos = loadUploadedPhotos, doc = document) {
  const image=doc.getElementById('heroResultImg'),dots=doc.getElementById('heroResultDots');
  if(!image || !dots) return;
  const slider=doc.getElementById('heroResultSlider'),loading=doc.getElementById('heroResultLoading');
  let photos=[],version=0;
  async function show(index) {
    const ticket=++version,photo=photos[index];
    image.hidden=true;slider.classList.add('is-loading');if(loading)loading.hidden=false;
    if(photo.srcset)image.srcset=photo.srcset;else image.removeAttribute('srcset');
    image.src=photo.url;image.alt=`Actual SUN PRO ${photo.label.toLowerCase()} result in Wangara`;
    try { if(image.decode)await image.decode(); } catch {}
    if(ticket!==version)return;
    if(image.naturalWidth){image.width=image.naturalWidth;image.height=image.naturalHeight;}
    image.hidden=false;slider.classList.remove('is-loading');if(loading)loading.hidden=true;
    doc.getElementById('heroResultLabel').textContent=photo.label;
    dots.querySelectorAll('button').forEach((dot,i)=>{dot.classList.toggle('is-active',i===index);dot.setAttribute('aria-pressed',String(i===index));});
    slider.dataset.photoSource=photo.srcset?'fallback':'uploads';
    slider.dataset.uploadedAt=String(uploadedTime(photo));
  }
  async function render(next) {
    photos=next;dots.replaceChildren();
    photos.forEach((photo,index)=>{
      const dot=doc.createElement('button');dot.type='button';dot.className='hero-result-dot';
      dot.setAttribute('aria-label',`View ${photo.label.toLowerCase()} result ${index+1}`);
      dot.addEventListener('click',()=>show(index));dots.appendChild(dot);
    });
    await show(0);
  }
  // Preserve the existing real-photo fallback if gallery access is unavailable.
  let settled=false;
  const timer=setTimeout(()=>{if(!settled)render(fallbackPhotos);},8000);
  try { const uploaded=await loadPhotos();settled=true;clearTimeout(timer);await render(uploaded.length?uploaded:fallbackPhotos); }
  catch { settled=true;clearTimeout(timer);await render(fallbackPhotos); }
}
if(typeof document!=='undefined')setupHero();
