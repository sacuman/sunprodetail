import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { latestHeroPhotos, readHeroPhotos, setupHero } from '../js/hero.js';
const url=id=>'https://firebasestorage.googleapis.com/v0/b/sunpro-detailing.firebasestorage.app/o/gallery%2F'+id+'.png?alt=media';
test('latest uploads use timestamps across categories, not filenames or manual order',()=>{
 const photos=[{id:'a',url:url('zzz'),uploadedAt:100,order:0},{id:'b',url:url('aaa'),uploadedAt:{toMillis:()=>300},order:99},{id:'c',url:url('ccc'),uploadedAt:200,order:1},{url:url('aaa'),uploadedAt:50},{url:'javascript:alert(1)',uploadedAt:9999}];
 assert.deepEqual(latestHeroPhotos(photos).map(p=>p.id),['b','c','a']);assert.equal(photos[0].id,'a');
});
test('read-only category loading selects the global latest and tolerates unavailable categories',async()=>{
 const calls=[];const result=await readHeroPhotos(async id=>{calls.push(id);if(id==='correction')throw Error('offline');return [{url:url(id),uploadedAt:id==='ceramic'?500:100,order:0}];});
 assert.deepEqual(calls,['refresh','correction','ceramic']);assert.equal(result[0].label,'CERAMIC COATING');
});
test('home waits for uploads, removes stale srcset, and retains working manual slider',async()=>{
 const dom=new JSDOM(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'));const d=dom.window.document;let resolve;
 const loading=new Promise(r=>resolve=r);const task=setupHero(()=>loading,d);
 assert.equal(d.getElementById('heroResultImg').hasAttribute('src'),false);assert.equal(d.getElementById('heroResultImg').hidden,true);
 resolve([{url:url('latest'),label:'REFRESH DETAILING',uploadedAt:500},{url:url('second'),label:'CERAMIC COATING',uploadedAt:400}]);await task;
 const img=d.getElementById('heroResultImg');assert.equal(img.getAttribute('src'),url('latest'));assert.equal(img.hasAttribute('srcset'),false);assert.equal(img.hidden,false);assert.equal(d.getElementById('heroResultSlider').dataset.uploadedAt,'500');
 d.querySelectorAll('.hero-result-dot')[1].click();await new Promise(r=>setImmediate(r));assert.equal(img.getAttribute('src'),url('second'));assert.equal(d.getElementById('heroResultLabel').textContent,'CERAMIC COATING');
 assert.equal(d.querySelector('.paper-work'),null);dom.window.close();
});
test('gallery read failure retains the original real-photo fallback',async()=>{
 const dom=new JSDOM(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'));await setupHero(async()=>{throw Error('offline')},dom.window.document);
 const d=dom.window.document;assert.match(d.getElementById('heroResultImg').getAttribute('src'),/images\/real\/hero-results-1200.webp/);assert.equal(d.getElementById('heroResultSlider').dataset.photoSource,'fallback');assert.equal(d.querySelectorAll('.hero-result-dot').length,4);dom.window.close();
});
