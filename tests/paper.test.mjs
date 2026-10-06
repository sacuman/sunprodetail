import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { missingSlots, pencilPicks, fillWorkGrid, pencilPools } from '../js/pencil-gallery.js';
import { safePhotoURL, escapeHTML } from '../js/quote-utils.js';
const pages=['index.html','services.html','gallery.html','contact.html','locations.html','about.html','faq.html'];
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const before=file=>execFileSync('git',['show','HEAD:'+file],{encoding:'utf8',cwd:new URL('..',import.meta.url)});
test('paper redesign preserves SEO, booking fields, prices, backend and admin code',()=>{
 for(const file of pages){
  const old=new JSDOM(before(file)),current=new JSDOM(read(file)),a=old.window.document,b=current.window.document;
  for(const selector of ['title','meta[name=description]','link[rel=canonical]','script[type="application/ld+json"]'])assert.equal(b.querySelector(selector).outerHTML,a.querySelector(selector).outerHTML,file+' '+selector);
  for(const el of a.querySelectorAll('[id]'))assert.ok(b.getElementById(el.id),file+' lost '+el.id);
  const money=doc=>[...doc.querySelector('main').textContent.matchAll(/\$\d+/g)].map(x=>x[0]);assert.deepEqual(money(b),money(a),file+' changed prices');
  assert.ok(b.querySelector('link[href^="css/paper.css"]'));
  old.window.close();current.window.close();
 }
 const old=new JSDOM(before('contact.html')),current=new JSDOM(read('contact.html'));
 assert.equal(current.window.document.querySelector('#contactForm').outerHTML,old.window.document.querySelector('#contactForm').outerHTML);
 old.window.close();current.window.close();
 for(const file of ['admin.html','js/contact.js','js/quote-utils.js','js/firebase-config.js','js/site.js','js/hero.js'])assert.equal(read(file),before(file),file);
});
test('gallery decorations fill only incomplete rows with stable choices and never count as photos',()=>{
 const dom=new JSDOM('<div class="work-grid"></div>');const grid=dom.window.document.querySelector('div');
 for(const count of [0,1,2,3,4,5,6,11,12,13])for(const columns of [1,2,3]){
  grid.innerHTML=Array.from({length:count},()=>'<button class="work-card"></button>').join('');delete grid.dataset.pencilSignature;
  const picks=pencilPicks(count,columns,54321,'correction');
  assert.deepEqual(picks,pencilPicks(count,columns,54321,'correction'));
  assert.equal(new Set(picks).size,picks.length);
  fillWorkGrid(grid,{columns,seed:54321,key:'correction'});
  assert.equal(grid.querySelectorAll('.work-card').length,count);
  assert.equal(grid.querySelectorAll('.care-scene').length,missingSlots(count,columns));
  const first=grid.querySelector('.care-scene');fillWorkGrid(grid,{columns,seed:54321,key:'correction'});assert.equal(grid.querySelector('.care-scene'),first);
 }
 grid.innerHTML='<button class="work-card"></button><button class="work-card" hidden></button>';delete grid.dataset.pencilSignature;
 fillWorkGrid(grid,{columns:3,seed:1});assert.equal(grid.querySelectorAll('.care-scene').length,2);
 fillWorkGrid(grid,{columns:1,seed:1});assert.equal(grid.querySelectorAll('.care-scene').length,0);
 dom.window.close();
});
test('real gallery filters, pagination and lightbox retain photo-only indexes alongside decorations',async()=>{
 const dom=new JSDOM(read('gallery.html'),{url:'https://sunprodetail.com/gallery.html',runScripts:'outside-only'}),w=dom.window;
 const url=i=>'https://firebasestorage.googleapis.com/v0/b/sunpro-detailing.firebasestorage.app/o/gallery%2F'+i+'.jpg?alt=media';
 const fixtures={refresh:Array.from({length:7},(_,i)=>({url:url(i),uploadedAt:i})),correction:Array.from({length:6},(_,i)=>({url:url(10+i),uploadedAt:10+i})),ceramic:[{url:url(20),uploadedAt:20}]};
 Object.assign(w,{safePhotoURL,escapeHTML,FIREBASE_CONFIG:{},initializeApp:()=>({}),getFirestore:()=>({}),collection:(_db,_gallery,cat)=>cat,getDocs:async cat=>({docs:fixtures[cat].map((data,i)=>({id:String(i),data:()=>data}))})});
 const html=read('gallery.html'),source=html.slice(html.indexOf("const root = document.getElementById('galleryRoot');"),html.lastIndexOf('</script>'));
 w.eval(source+'\nwindow.galleryTest={renderGallery,openLb,closeLb,nextLb,prevLb};');
 await new Promise(resolve=>setImmediate(resolve));
 const doc=w.document;assert.equal(doc.querySelectorAll('.work-card').length,12);assert.equal(doc.getElementById('count-all').textContent,'14');
 doc.getElementById('galleryMore').click();assert.equal(doc.querySelectorAll('.work-card').length,14);
 fillWorkGrid(doc.querySelector('.work-grid'),{columns:3,seed:123});assert.equal(doc.querySelectorAll('.care-scene').length,1);
 doc.querySelector('[data-filter=ceramic]').click();assert.equal(doc.querySelectorAll('.work-card').length,1);assert.equal(doc.querySelector('[data-filter=ceramic]').getAttribute('aria-pressed'),'true');
 fillWorkGrid(doc.querySelector('.work-grid'),{columns:3,seed:123});assert.equal(doc.querySelectorAll('.care-scene').length,2);
 doc.querySelector('.work-card').click();assert.equal(doc.getElementById('lb-count').textContent,'1 / 1');assert.equal(doc.getElementById('lightbox').classList.contains('open'),true);
 w.galleryTest.nextLb();assert.equal(doc.getElementById('lb-count').textContent,'1 / 1');w.galleryTest.closeLb();assert.equal(doc.body.style.overflow,'');
 doc.querySelector('[data-filter=refresh]').click();assert.equal(doc.querySelectorAll('.work-card').length,7);doc.querySelector('.work-card').click();w.galleryTest.nextLb();assert.equal(doc.getElementById('lb-count').textContent,'2 / 7');
 dom.window.close();
});
test('offline fallback remains filterable and adds no false result counts',async()=>{
 const dom=new JSDOM(read('gallery.html'),{url:'https://sunprodetail.com/gallery.html',runScripts:'outside-only'}),w=dom.window;
 Object.assign(w,{safePhotoURL,escapeHTML,FIREBASE_CONFIG:{},initializeApp:()=>({}),getFirestore:()=>({}),collection:()=>null,getDocs:async()=>({docs:[]})});
 const html=read('gallery.html');w.eval(html.slice(html.indexOf("const root = document.getElementById('galleryRoot');"),html.lastIndexOf('</script>')));
 await new Promise(resolve=>setImmediate(resolve));const doc=w.document;
 doc.querySelector('[data-filter=refresh]').click();assert.equal(doc.querySelectorAll('.work-card:not([hidden])').length,1);
 fillWorkGrid(doc.querySelector('.work-grid'),{columns:2,seed:100});assert.equal(doc.querySelectorAll('.care-scene').length,1);assert.equal(doc.querySelector('#count-all').textContent,'3');
 doc.querySelector('[data-filter=all]').click();assert.equal(doc.querySelectorAll('.work-card:not([hidden])').length,3);dom.window.close();
});

test('every active artwork is unique across page positions and home/gallery pools',()=>{
 const staticSources=[];
 for(const page of pages){const dom=new JSDOM(read(page));
  for(const image of dom.window.document.querySelectorAll('img[src^="images/pencil/"]'))staticSources.push(image.getAttribute('src'));
  for(const figure of dom.window.document.querySelectorAll('.paper-illustration')){assert.equal(figure.parentElement.className,'paper-heading');assert.equal(figure.closest('.work-card'),null);}
  dom.window.close();
 }
 assert.equal(staticSources.length,10);
 const sources=[...staticSources,...Object.values(pencilPools).flat()];assert.equal(sources.length,14);assert.equal(new Set(sources).size,14);
 const bytes=sources.map(source=>fs.readFileSync(new URL('../'+source,import.meta.url)).toString('base64'));assert.equal(new Set(bytes).size,14,'Artwork file contents must also differ');
 for(const key of ['home','gallery'])for(const columns of [1,2,3])for(const count of [0,1,2,3,4,5,13]){
  const picks=pencilPicks(count,columns,31415,key,pencilPools[key].length);
  assert.equal(new Set(picks).size,picks.length);assert.deepEqual(picks,pencilPicks(count,columns,31415,key,pencilPools[key].length));
 }
 assert.deepEqual(pencilPools.home.filter(source=>pencilPools.gallery.includes(source)),[]);
 assert.match(read('services.html'),/pencil-tool buffing[^>]*><img src="images\/pencil\/paint-buffing-action.png"/);
});

test("home tools persist independently of responsive photo grid decorations",()=>{
 const dom=new JSDOM(read("index.html"));const doc=dom.window.document,tools=doc.querySelector(".home-tools"),grid=doc.querySelector(".work-grid");
 assert.ok(tools);assert.equal(tools.closest(".work-grid"),null);
 for(const columns of [1,2,3]){fillWorkGrid(grid,{columns,seed:3,key:"home"});assert.equal(doc.querySelector(".home-tools"),tools);assert.equal(tools.querySelector("img").getAttribute("src"),"images/pencil/home-spray-tools.png");}
 dom.window.close();
});
