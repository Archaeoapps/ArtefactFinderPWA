const CACHE='rf-shell-2026-11-v1';
const ROOT=new URL('./',self.registration.scope);
const FILES=[
 './','./index.html','./styles.css','./app.js',
 './crypto.js','./vault.js','./scanner.js','./vendor/jsQR.js',
 './manifest.webmanifest','./icon.svg','./icon-180.png','./icon-192.png'
];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))
    .then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(names=>Promise.all(
    names.filter(name=>name.startsWith('rf-shell-')&&name!==CACHE)
      .map(name=>caches.delete(name))
  )).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==ROOT.origin||
     !url.pathname.startsWith(ROOT.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const saved=await cache.match(event.request,{ignoreSearch:true});
    if(saved)return saved;
    try {
      const fresh=await fetch(event.request);
      if(fresh.ok)await cache.put(event.request,fresh.clone());
      return fresh;
    }catch(e){
      if(event.request.mode==='navigate'){
        const fallback=await cache.match('./index.html');
        if(fallback)return fallback;
      }
      throw e;
    }
  })());
});
