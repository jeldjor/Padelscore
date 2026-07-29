const CACHE='wepadel-v3.1.1-full-redesign';
const CORE=['./','index.html','styles.css?v=3.1.1','config.js?v=3.1.1','scoring.js?v=3.1.1','db.js?v=3.1.1','app.js?v=3.1.1','manifest.json','logo-wepadel.svg','logo-gjmotion.svg','icons/icon-192.png','icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())
));
self.addEventListener('message',event=>{ if(event.data==='SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  const isAppFile=url.origin===self.location.origin && (event.request.mode==='navigate' || /\.(?:html|js|css)$/.test(url.pathname));
  if(isAppFile){
    event.respondWith(fetch(event.request,{cache:'no-store'}).then(response=>{
      const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;
    }).catch(()=>caches.match(event.request).then(hit=>hit||caches.match('index.html'))));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{
    const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;
  })));
});
