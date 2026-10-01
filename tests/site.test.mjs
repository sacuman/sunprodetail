import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { validateQuote, photoProblem, safePhotoURL, escapeHTML, sendNotification, contactNumber } from '../js/quote-utils.js';
import { initContact } from '../js/contact.js';

const full = { name: 'Test User', phone: '0412345678', email: '', vehicle: '', preferredDate: '', service: '', message: '' };
const fixture = fs.readFileSync(new URL('../contact.html', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let i=0;i<40;i++) { if(predicate()) return; await tick(); } assert.fail('UI did not settle'); }
function setup(options = {}, search='') {
  const dom = new JSDOM(fixture, { url: 'https://sunprodetail.com/contact.html'+search, runScripts:'outside-only' });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.location = dom.window.location;
  const get = id => document.getElementById(id);
  const saved = []; const notices = [];
  initContact({ backendLoader: async () => ({ upload:async()=> 'https://example.invalid/photo', save:async data=>{saved.push(data);return 'test-reference';} }), notify:async (...args)=>{notices.push(args);return 'accepted';}, ...options });
  for (const key of ['name','phone']) get(key).value=full[key];
  return { dom,get,saved,notices,submit:()=>get('contactForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})), close:()=>{dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.location;} };
}

test('minimal advertised fields and email-only are valid; malformed contact is rejected',()=>{
 assert.deepEqual(validateQuote(full),{});
 assert.deepEqual(validateQuote({...full,phone:'',email:'test@example.com'}),{});
 assert.ok(validateQuote({...full,phone:'',email:''}).phone);
 assert.ok(validateQuote({...full,phone:'abc'}).phone);
 assert.ok(validateQuote({...full,phone:'123'}).phone);
 assert.ok(validateQuote({...full,email:'wrong@'}).email);
});
test('photo validation rejects executable types, oversized and empty files',()=>{
 assert.match(photoProblem({name:'photo.svg',type:'image/svg+xml',size:500}),/Please use/);
 assert.match(photoProblem({name:'photo.jpg',type:'text/html',size:500}),/Please use/);
 assert.match(photoProblem({name:'photo.jpg',type:'image/jpeg',size:21*1024*1024}),/20 MB/);
 assert.match(photoProblem({name:'photo.jpg',type:'image/jpeg',size:0}),/empty/);
 assert.equal(photoProblem({name:'photo.HEIC',type:'',size:1000}),'');
});
test('untrusted text and URLs cannot become HTML or executable links',()=>{
 assert.equal(escapeHTML('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
 assert.equal(safePhotoURL('javascript:alert(1)'),'');
 assert.equal(safePhotoURL('https://evil.example/photo'),'');
 assert.ok(safePhotoURL('https://firebasestorage.googleapis.com/v0/b/sunpro-detailing.firebasestorage.app/o/enquiries%2Fphoto.jpg?alt=media'));
 assert.equal(contactNumber("0412345678';alert(1)//"),'');
});
test('notification HTTP and timeout failures are reported, not treated as accepted',async()=>{
 assert.equal(await sendNotification(full,0,'test',{fetchImpl:async()=>({ok:false}),timeoutMs:50}),'failed');
 assert.equal(await sendNotification(full,0,'test',{fetchImpl:async()=>({ok:true}),timeoutMs:50}),'accepted');
 assert.equal(await sendNotification(full,0,'test',{fetchImpl:async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')))),timeoutMs:5}),'failed');
});
test('minimal enquiry saves once and displays reference with service preselection',async()=>{
 const f=setup({},'?service=ceramic#book');
 try { assert.equal(f.get('service').value,'Ceramic Coating');f.submit();f.submit();await until(()=>!f.get('submitBtn').disabled);assert.equal(f.saved.length,1);assert.equal(f.notices.length,1);assert.equal(f.saved[0].service,'Ceramic Coating');assert.match(f.get('successText').textContent,/test-reference/);assert.equal(f.get('successModal').hidden,false);assert.equal(f.saved[0].photos.length,0); }
 finally{f.close();}
});
test('validation focuses the missing field and never reaches backend',async()=>{
 const f=setup();try{f.get('phone').value='';f.submit();await tick();assert.equal(f.saved.length,0);assert.equal(document.activeElement.id,'phone');assert.match(f.get('phoneError').textContent,/mobile number or email/);}finally{f.close();}
});
test('saved enquiry remains successful if notification fails; no repeat save',async()=>{
 const f=setup({notify:async()=>{throw Error('email offline');}});try{f.submit();await until(()=>!f.get('submitBtn').disabled);assert.equal(f.saved.length,1);assert.equal(f.get('successModal').hidden,false);assert.match(f.get('formStatus').textContent,/saved/);}finally{f.close();}
});
test('save failure preserves input and supports a retry',async()=>{
 let calls=0;const f=setup({backendLoader:async()=>({save:async()=>{calls++;if(calls===1)throw Error('offline');return 'retry-reference';}})});
 try{f.submit();await until(()=>!f.get('submitBtn').disabled);assert.equal(f.get('name').value,full.name);assert.equal(f.get('successModal').hidden,true);f.submit();await until(()=>!f.get('submitBtn').disabled);assert.equal(calls,2);assert.match(f.get('successText').textContent,/retry-reference/);}finally{f.close();}
});
test('photo removal never submits; unsupported photo shows useful error',async()=>{
 const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;URL.createObjectURL=()=> 'blob:test';URL.revokeObjectURL=()=>{};
 const f=setup({prepare:async file=>{if(file.name.endsWith('.heic'))throw Error('Choose a JPG');return file;}});
 try{
  Object.defineProperty(f.get('photoInput'),'files',{configurable:true,value:[new f.dom.window.File(['photo'],'car.jpg',{type:'image/jpeg'})]});
  f.get('photoInput').dispatchEvent(new f.dom.window.Event('change'));await until(()=>!f.get('submitBtn').disabled);
  const remove=document.querySelector('.photo-preview-remove');assert.equal(remove.type,'button');remove.click();await tick();assert.equal(f.saved.length,0);assert.equal(document.querySelectorAll('.photo-preview-item').length,0);
  Object.defineProperty(f.get('photoInput'),'files',{configurable:true,value:[new f.dom.window.File(['photo'],'car.heic')]});f.get('photoInput').dispatchEvent(new f.dom.window.Event('change'));await until(()=>!f.get('submitBtn').disabled);assert.match(f.get('photoStatus').textContent,/Choose a JPG/);
 }finally{URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;f.close();}
});
test('admin treats customer HTML as text and shows persistence errors',async()=>{
 const source=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
 const dom=new JSDOM(source,{url:'https://sunprodetail.com/admin.html',runScripts:'outside-only'});
 const w=dom.window;let toasts=[];
 Object.assign(w,{escapeHTML,safePhotoURL,contactNumber,showToast:(message)=>toasts.push(message),db:{},query:(...x)=>x,collection:(...x)=>x,orderBy:()=>null,doc:(...x)=>x,updateDoc:async()=>{throw Error('denied')},deleteDoc:async()=>{throw Error('denied')},confirm:()=>true,getDocs:async()=>({docs:[{id:'safe-id',data:()=>({name:'<img src=x onerror=alert(1)>',message:'<b>not HTML</b>',phone:"0412');alert(1)//",email:'test@example.com',preferredDate:'Next week',status:'new',submittedAt:Date.now()})}]})});
 try{
  const part=source.slice(source.indexOf('let loadingEnquiries = false;'),source.indexOf('// ── UPLOAD ──'));
  w.eval(part+'\nwindow.testLoad = loadEnquiries;');await w.testLoad();
  assert.equal(w.document.querySelector('.enquiry-name img'),null);assert.equal(w.document.querySelector('.enquiry-name').textContent,'<img src=x onerror=alert(1)>');assert.equal(w.document.querySelector('.enquiry-message b'),null);assert.match(w.document.querySelector('.enquiry-body').textContent,/Next week/);
  w.document.querySelector('.btn-done').click();await tick();assert.match(toasts.at(-1),/Could not save/);assert.equal(w.document.querySelector('.enquiry-badge').textContent,'New');
 }finally{dom.window.close();}
});
test('all public pages have consistent canonical, local business data and valid local links',()=>{
 const pages=['index.html','services.html','gallery.html','contact.html','locations.html','about.html','faq.html'];
 for(const file of pages){
  const html=fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');const dom=new JSDOM(html);const doc=dom.window.document;
  assert.equal(doc.querySelector('link[rel=canonical]').getAttribute('href'),'https://sunprodetail.com/'+(file==='index.html'?'':file));
  const data=JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);const business=data['@graph'].find(item=>item['@type']==='AutoWash');assert.equal(business.address.postalCode,'6065');assert.equal(business.telephone,'+61416795345');assert.equal(business.aggregateRating,undefined);assert.equal(business.openingHours,undefined);
  for(const link of doc.querySelectorAll('a[href],img[src],script[src],link[href]')){
   const ref=link.getAttribute('href')||link.getAttribute('src');if(!ref||/^(?:https?:|sms:|mailto:|tel:|\/\/)/.test(ref))continue;
   const [path]=ref.split(/[?#]/);if(path)assert.ok(fs.existsSync(new URL('../'+path,import.meta.url)),file+' missing '+path);
  }
  dom.window.close();
 }
 assert.match(fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8'),/name="robots" content="noindex, nofollow"/);
 assert.doesNotMatch(fs.readFileSync(new URL('../sitemap.xml',import.meta.url),'utf8'),/admin.html/);
});
