import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { attribution, nextIdentity, SESSION_MS, VISITOR_MS, STORAGE_KEY, EXCLUDE_KEY, dateRange, perthDay, summarise, trackingURL, EVENTS } from '../js/analytics-core.js';
import { initAnalytics } from '../js/analytics.js';
import { createAnalyticsDashboard, loadAnalyticsEvents } from '../js/admin-analytics.js';

const now = Date.parse('2026-10-15T00:10:00+08:00');
const visitorId = randomUUID(), sessionId = randomUUID();
const event = (overrides={}) => ({ version:1, event:'page_view', page:'/', visitorId, sessionId, source:'instagram', medium:'social', campaign:'refresh_october', device:'mobile', service:'', createdAt:now, ...overrides });
const html = fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
const tick = () => new Promise(resolve=>setImmediate(resolve));

test('UTM overrides referrer; redirected social hosts classify without false domain matches',()=>{
 assert.equal(attribution('https://sunprodetail.com/?utm_source=instagram&utm_medium=social&utm_campaign=refresh_october','https://google.com/').source,'instagram');
 for(const [url,source] of [['https://l.instagram.com/?private=1','instagram'],['https://m.facebook.com/group','facebook'],['https://www.google.com.au/search?q=private','google'],['https://www.bing.com/search','bing'],['https://facebook.com.evil.example/','referral']])assert.equal(attribution('https://sunprodetail.com',url).source,source);
 assert.equal(attribution('https://sunprodetail.com/services.html','https://sunprodetail.com/').source,'direct');
 assert.equal(attribution('https://sunprodetail.com/?fbclid=opaque').source,'facebook');
 assert.equal(attribution('https://sunprodetail.com/?utm_source=unknown&utm_campaign=person@example.com').campaign,'');
 assert.equal(attribution('https://sunprodetail.com/?utm_source=unknown').source,'other');
});
test('same visit survives internal navigation; expiry and a new explicit campaign start a visit',()=>{
 const incoming=attribution('https://sunprodetail.com/?utm_source=facebook&utm_campaign=work1');
 const a=nextIdentity(null,incoming,now,randomUUID);
 const b=nextIdentity(a,attribution('https://sunprodetail.com/services.html','https://sunprodetail.com/'),now+1000,randomUUID);
 assert.equal(a.visitorId,b.visitorId);assert.equal(a.sessionId,b.sessionId);assert.equal(b.source,'facebook');
 const c=nextIdentity(b,incoming,now+SESSION_MS+1001,randomUUID);assert.notEqual(c.sessionId,b.sessionId);assert.equal(c.visitorId,b.visitorId);
 const d=nextIdentity(c,attribution('https://sunprodetail.com/?utm_source=instagram'),now+SESSION_MS+2000,randomUUID);assert.notEqual(d.sessionId,c.sessionId);assert.equal(d.source,'instagram');
 const e=nextIdentity(a,incoming,now+VISITOR_MS,randomUUID);assert.notEqual(e.visitorId,a.visitorId);
});
test('Perth calendar day and ranges are independent of host timezone',()=>{
 assert.equal(perthDay(Date.parse('2026-10-14T16:00:00Z')),'2026-10-15');
 assert.equal(new Date(dateRange(1,now).start).toISOString(),'2026-10-14T16:00:00.000Z');
 assert.equal(perthDay(dateRange(7,now).start),'2026-10-09');
});
test('summary deduplicates visitors/sessions but keeps clicks distinct from saved quotes',()=>{
 const otherSession=randomUUID();
 const data=summarise([event(),event({page:'/services.html'}),event({event:'text_quote_click'}),event({event:'email_quote_click'}),event({event:'quote_saved'}),event({sessionId:otherSession,source:'facebook'}),event({page:'/admin.html'}),event({createdAt:now-10*86400000}),event({visitorId:'invalid'})],dateRange(7,now));
 assert.deepEqual(data.totals,{visitors:1,sessions:2,pageViews:3,sms:1,email:1,call:0,quoteClicks:0,quoteStarts:0,quotes:1});
 assert.equal(data.channels.find(c=>c.key==='facebook').sessions,1);
 assert.equal(data.channels.find(c=>c.key==='instagram').quotes,1);
 assert.equal(data.pages[0].key,'/');
});

function client({url='https://sunprodetail.com/?utm_source=instagram&utm_campaign=work',referrer='',setup=()=>{},fetchImpl}={}) {
 const dom=new JSDOM('<footer></footer>',{url,...(referrer?{referrer}:{}),pretendToBeVisual:true}); const calls=[];
 setup(dom.window);
 const api=initAnalytics(dom.window,fetchImpl|| (async (url,options)=>{calls.push({url,options});return {ok:true};}));
 return {dom,api,calls};
}
test('collector sends only bounded allowlisted fields and uses keepalive server timestamps',async()=>{
 const f=client();try{
  await tick();await f.api.track('quote_saved',{service:'refresh',email:'private@example.com',name:'secret',message:'private message'});
  assert.equal(f.calls.length,2);
  const request=f.calls[1].options,write=JSON.parse(request.body).writes[0];
  assert.equal(request.keepalive,true);assert.equal(request.credentials,'omit');assert.equal(request.referrerPolicy,'no-referrer');
  assert.equal(write.currentDocument.exists,false);assert.equal(write.updateTransforms[0].setToServerValue,'REQUEST_TIME');
  assert.equal(write.update.fields.source.stringValue,'instagram');assert.equal(write.update.fields.service.stringValue,'refresh');
  assert.doesNotMatch(request.body,/private|secret|message|query|referrer|utm_/);
  assert.equal(write.update.fields.page.stringValue,'/');
  await f.api.track('unapproved_event');assert.equal(f.calls.length,2);
 }finally{f.dom.window.close();}
});
test('no tracking for admin/preview, opt-out, privacy signals, bots or blocked storage',async()=>{
 const cases=[{url:'http://localhost:4385/'},{url:'https://sunprodetail.com/admin.html'},{setup:w=>w.localStorage.setItem(EXCLUDE_KEY,'1')},{setup:w=>Object.defineProperty(w.navigator,'doNotTrack',{value:'1'})},{setup:w=>Object.defineProperty(w.navigator,'globalPrivacyControl',{value:true})},{setup:w=>Object.defineProperty(w.navigator,'userAgent',{value:'Googlebot'})},{setup:w=>Object.defineProperty(w,'localStorage',{get(){throw Error('blocked');}})}];
 for(const options of cases){const f=client(options);try{await tick();await f.api.track('text_quote_click');assert.equal(f.calls.length,0);}finally{f.dom.window.close();}}
});
test('corrupt storage recovers; double clicks and opted-out future events are not sent',async()=>{
 const f=client({setup:w=>w.localStorage.setItem(STORAGE_KEY,'broken-json')});
 try{await tick();assert.equal(f.calls.length,1);await f.api.track('text_quote_click');await f.api.track('text_quote_click');assert.equal(f.calls.length,2);f.api.setExcluded(true);await f.api.track('email_quote_click');assert.equal(f.calls.length,2);assert.equal(f.dom.window.localStorage.getItem(STORAGE_KEY),null);}finally{f.dom.window.close();}
});
test('tracking failures stay isolated from quote form and visible page controls',async()=>{
 const f=client({fetchImpl:async()=>{throw Error('network offline');}});try{await tick();assert.equal(f.api.status,'unavailable');assert.ok(f.dom.window.document.querySelector('footer'));assert.equal(f.dom.window.document.querySelector('.site-statistics-notice').textContent.includes('Disable statistics'),true);}finally{f.dom.window.close();}
});
test('dashboard reads only after admin authorisation; failed reads are unavailable, never zero',async()=>{
 const dom=new JSDOM(html,{url:'https://sunprodetail.com/admin.html'});let calls=0;
 const dashboard=createAnalyticsDashboard({document:dom.window.document,now:()=>now,loadEvents:async()=>{calls++;throw Object.assign(Error('no access'),{code:'permission-denied'});}});
 try{await dashboard.load();assert.equal(calls,0);dashboard.authorise(true);assert.equal(dom.window.localStorage.getItem(EXCLUDE_KEY),'1');await dashboard.load();assert.equal(calls,1);assert.match(dom.window.document.getElementById('analyticsStatus').textContent,/권한/);assert.equal(dom.window.document.getElementById('analyticsResults').hidden,true);assert.equal(dom.window.document.getElementById('analyticsMetrics').children.length,0);}finally{dom.window.close();}
});
test('dashboard counts, tagged links and empty state render; logout discards a pending response',async()=>{
 const dom=new JSDOM(html,{url:'https://sunprodetail.com/admin.html'});let resolvePending;let pending=false;
 const dashboard=createAnalyticsDashboard({document:dom.window.document,now:()=>now,loadEvents:async()=>pending?new Promise(r=>{resolvePending=r;}):{events:[event(),event({event:'text_quote_click'})],truncated:false}});
 try{dashboard.authorise(true);await dashboard.load();const d=dom.window.document;assert.equal(d.getElementById('analyticsResults').hidden,false);assert.match(d.getElementById('analyticsChannels').textContent,/Instagram/);assert.match(d.getElementById('analyticsClicks').textContent,/문자 버튼 1/);assert.equal(d.getElementById('analyticsDays').children.length,7);assert.match(d.getElementById('trackingLink').value,/utm_source=instagram/);
  d.getElementById('analyticsCampaign').value='<img src=x>';d.getElementById('analyticsCampaign').dispatchEvent(new dom.window.Event('input'));assert.equal(d.getElementById('copyTrackingLink').disabled,true);assert.equal(d.getElementById('trackingLinkStatus').querySelector('img'),null);
  pending=true;const loading=dashboard.load();dashboard.authorise(false);resolvePending({events:[event()],truncated:false});await loading;assert.equal(d.getElementById('analyticsResults').hidden,true);
 }finally{dom.window.close();}
});
test('query pagination is bounded to avoid unbounded dashboard reads',async()=>{
 let calls=0;const sdk={where:()=>null,orderBy:()=>null,limit:()=>null,startAfter:()=>null,collection:()=>null,query:()=>null,getDocs:async()=>{calls++;return {docs:Array.from({length:500},()=>({data:()=>event()}))};}};
 const data=await loadAnalyticsEvents({},sdk,dateRange(90,now));assert.equal(calls,10);assert.equal(data.events.length,5000);assert.equal(data.truncated,true);
});
test('links keep destination anchors and rules have an owner read guard and create-only schema',()=>{
 const link=new URL(trackingURL('google','october','/contact.html'));assert.equal(link.hostname,'sunprodetail.com');assert.equal(link.hash,'#book');assert.equal(link.searchParams.get('utm_medium'),'business_profile');assert.throws(()=>trackingURL('instagram','hello','https://evil.example'));
 const rules=fs.readFileSync(new URL('../firebase/website-analytics.rules.fragment',import.meta.url),'utf8');assert.match(rules,/allow read: if request.auth != null/);assert.match(rules,/email_verified == true/);assert.match(rules,/allow update, delete: if false/);assert.match(rules,/createdAt == request.time/);for(const event of EVENTS)assert.ok(rules.includes("'"+event+"'"));
 for(const name of ['index','services','gallery','contact','locations','about','faq']) {const dom=new JSDOM(fs.readFileSync(new URL('../'+name+'.html',import.meta.url),'utf8'));assert.equal(dom.window.document.querySelectorAll('script[src^="js/analytics.js"]').length,1);dom.window.close();}
 assert.doesNotMatch(html,/<script[^>]*src="js\/analytics.js/);
});
