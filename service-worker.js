const CACHE='wepadel-v3.10.0-no-api-cache';
const CORE=['./','index.html','styles.css?v=3.10.0','config.js?v=3.10.0','scoring.js?v=3.10.0','db.js?v=3.10.0','app.js?v=3.10.0','manifest.json','logo-wepadel-transparent.png','logo-gjmotion-white.png','wepadel-avatar-sprite.png','icons/icon-192.png','icons/icon-512.png'];
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
  // Alleen vaste bestanden van WEPADEL mogen offline worden bewaard. Externe
  // verzoeken (waaronder Supabase REST en Realtime) moeten altijd rechtstreeks
  // naar het netwerk, anders kan een oude status de zojuist opgeslagen keuze
  // opnieuw overschrijven.
  if(url.origin!==self.location.origin) return;
  const isAppFile=event.request.mode==='navigate' || /\.(?:html|js|css)$/.test(url.pathname);
  if(isAppFile){
    event.respondWith(fetch(event.request,{cache:'no-store'}).then(response=>{
      const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;
    }).catch(()=>caches.match(event.request).then(hit=>hit||caches.match('index.html'))));
    return;
  }
  const isStaticAsset=/\.(?:png|jpg|jpeg|gif|webp|svg|ico|json)$/.test(url.pathname);
  if(!isStaticAsset) return;
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{
    const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;
  })));
});
