const CACHE='padelscore-league-v2.0.3-valid-supabase-cdn';
const CORE=['./','index.html','styles.css?v=2.0.3','config.js?v=2.0.3','scoring.js?v=2.0.3','db.js?v=2.0.3','app.js?v=2.0.3','manifest.json','icons/icon-192.png','icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())
));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  const isAppFile=url.origin===self.location.origin && (event.request.mode==='navigate' || /\.(?:html|js|css)$/.test(url.pathname));
  if(isAppFile){
    event.respondWith(fetch(event.request).then(response=>{
      const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;
    }).catch(()=>caches.match(event.request).then(hit=>hit||caches.match('index.html'))));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{
    const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;
  })));
});
