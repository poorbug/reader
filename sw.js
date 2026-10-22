const NAME='zhijian-reader-v27';
const VERSION='1.0.27';
const CORE=['./','./index.html','./style.css','./app.js','./icon.svg','./manifest.webmanifest','./mobi-reader.html','./selection.js','./version.json'];
const EXTERNAL=['https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js','https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js'];
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(NAME);
  // Force a fresh copy of the deployed assets instead of an old HTTP-cache response.
  await cache.addAll(CORE.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})));
  await Promise.allSettled(EXTERNAL.map(url=>cache.add(url)));
  await self.skipWaiting();
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>name.startsWith('zhijian-reader-')&&name!==NAME).map(name=>caches.delete(name)));
  await self.clients.claim();
 })());
});
self.addEventListener('message',event=>{
 if(event.data?.type==='ZHJ_GET_VERSION')event.ports?.[0]?.postMessage({version:VERSION});
});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 // The version check must always reach the published site, not our offline cache.
 if(url.origin===self.location.origin&&url.pathname.endsWith('/version.json')){
  event.respondWith(fetch(event.request,{cache:'no-store'}));
  return;
 }
 event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{
  if(response.ok&&url.origin===self.location.origin){
   const copy=response.clone();
   event.waitUntil(caches.open(NAME).then(cache=>cache.put(event.request,copy)));
  }
  return response;
 })));
});
