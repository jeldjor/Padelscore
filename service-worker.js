const CACHE='wepadel-v3.15.0-no-api-cache';
const CORE=['./','index.html','styles.css?v=3.15.0','config.js?v=3.15.0','scoring.js?v=3.15.0','db.js?v=3.15.0','app.js?v=3.15.0','manifest.json','icons/wepadel-icon-192-v314.png','icons/wepadel-icon-512-v314.png','icons/wepadel-maskable-192-v314.png','icons/wepadel-maskable-512-v314.png','icons/wepadel-apple-touch-v314.png','logo-wepadel-transparent.png','logo-gjmotion-white.png','wepadel-avatar-sprite.png','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-192.png','icons/icon-maskable-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{ if(event.data==='SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin) return;
  const isAppFile=event.request.mode==='navigate' || /\.(?:html|js|css)$/.test(url.pathname);
  if(isAppFile){event.respondWith(fetch(event.request,{cache:'no-store'}).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;}).catch(()=>caches.match(event.request).then(hit=>hit||caches.match('index.html'))));return;}
  const isStaticAsset=/\.(?:png|jpg|jpeg|gif|webp|svg|ico|json)$/.test(url.pathname);
  if(!isStaticAsset) return;
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;})));
});
self.addEventListener('push',event=>{
  let data={}; try{data=event.data?.json()||{};}catch{data={body:event.data?.text()||''};}
  const title=data.title||'WEPADEL';
  const options={body:data.body||'',icon:'icons/icon-192.png',badge:'icons/icon-192.png',tag:data.tag||'wepadel-update',renotify:Boolean(data.renotify),data:{url:data.url||'./'},vibrate:[180,80,180]};
  event.waitUntil(Promise.all([self.registration.showNotification(title,options), typeof self.registration.setAppBadge==='function'&&Number(data.badge)>0?self.registration.setAppBadge(Number(data.badge)):Promise.resolve()]));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close(); const target=new URL(event.notification.data?.url||'./',self.location.origin).href;
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{const existing=list.find(c=>c.url.startsWith(self.location.origin));if(existing){existing.focus();existing.navigate(target);return;}return clients.openWindow(target);}));
});
