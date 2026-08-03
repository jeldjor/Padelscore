(() => {
  'use strict';
  const DB = window.PadelDB;
  const S = window.PadelScoring;
  if (!DB) {
    document.addEventListener('DOMContentLoaded', () => {
      const toast = document.querySelector('#toast');
      if (toast) { toast.textContent = 'Online database kon niet worden geladen. Vernieuw de pagina.'; toast.className = 'toast show error'; }
    });
    return;
  }
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const dateISO = d => { const x=new Date(d); const off=x.getTimezoneOffset(); return new Date(x.getTime()-off*60000).toISOString().slice(0,10); };
  const todayISO = () => dateISO(new Date());
  const fmtDate = value => new Intl.DateTimeFormat('nl-NL',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(`${value}T12:00:00`));
  const fmtShort = value => new Intl.DateTimeFormat('nl-NL',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(`${value}T12:00:00`));
  const fmtTime = value => value ? String(value).slice(0,5) : '--:--';
  const nowMs = () => Date.now();

  let deferredInstallPrompt=null; let notificationSyncTimer=null;
  const state = { swapPopupShown:false, dashboardPaidPage:0, dashboardActionPage:0, page:'dashboard', year:new Date().getFullYear(), month:new Date().getMonth(), playdayView:'calendar', playdayFilter:'all', playdayList:true, selectedCalendarDate:null, playdayPage:0, historyPage:0, adminPage:0, selectedPlaydayId:null, pendingRsvp:null, rsvpOverrides:{}, activeMatchId:null, scoreboardMatchId:null, wakeLock:null, timer:null, controlsTimer:null, recognition:null, adminTab:'requests', scoreboardReadOnly:false };

  function toast(message, error=false){ const el=$('#toast'); el.textContent=message; el.className=`toast show${error?' error':''}`; clearTimeout(el._t); el._t=setTimeout(()=>el.className='toast',2600); }
  function modal(title, body, onOpen){ $('#modalRoot').innerHTML=`<div class="modal-backdrop"><section class="modal-card"><div class="modal-head"><h2>${esc(title)}</h2><button class="close-btn" data-close-modal>✕</button></div>${body}</section></div>`; $$('[data-close-modal]').forEach(b=>b.onclick=closeModal); onOpen?.(); }
  function closeModal(){ $('#modalRoot').innerHTML=''; }
  function userMap(){ return new Map(DB.listUsers().map(u=>[u.id,u])); }
  function nameOf(id){ return userMap().get(id)?.display_name || 'Onbekend'; }
  function avatarNumber(userOrId){ const user=typeof userOrId==='string'?userMap().get(userOrId):userOrId; const value=Number(user?.avatar_id); return Number.isInteger(value)&&value>=1&&value<=50?value:1; }
  function avatarMarkup(userOrId,variant='inline'){ const n=avatarNumber(userOrId),col=(n-1)%10,row=Math.floor((n-1)/10),x=(col/9*100).toFixed(4),y=(row/4*100).toFixed(4); return `<span class="avatar-sprite ${variant}" aria-hidden="true" style="background-position:${x}% ${y}%"></span>`; }
  function playerNameMarkup(id){ return `<span class="avatar-name">${esc(nameOf(id))}${avatarMarkup(id)}</span>`; }
  function avatarPicker(value=1,name='avatar_id',label='Kies je avatar'){ const selected=Math.max(1,Math.min(50,Number(value)||1)); return `<fieldset class="avatar-fieldset"><legend>${esc(label)}</legend><input type="hidden" name="${esc(name)}" value="${selected}"><div class="avatar-picker">${Array.from({length:50},(_,i)=>{const n=i+1;return `<button type="button" class="avatar-option ${n===selected?'selected':''}" data-avatar-choice="${n}" aria-label="Avatar ${n}, ${n<=25?'held':'schurk'}">${avatarMarkup({avatar_id:n},'picker')}</button>`;}).join('')}</div></fieldset>`; }
  function bindAvatarPickers(root=document){ $$('[data-avatar-choice]',root).forEach(button=>button.onclick=()=>{const field=button.closest('.avatar-fieldset');if(!field)return;field.querySelector('input[type="hidden"]').value=button.dataset.avatarChoice;$$('[data-avatar-choice]',field).forEach(x=>x.classList.toggle('selected',x===button));}); }
  function playdayTimeText(p){
    const time=p?.time_enabled===false||!p?.start_time||!p?.end_time?'':`${fmtTime(p.start_time)} - ${fmtTime(p.end_time)}`;
    const duration=Number(p?.duration_minutes)>0?`${Number(p.duration_minutes)} min`:'';
    return time&&duration?`${time} (${duration})`:time||duration;
  }
  function playdayLocationText(p){ return p?.location_enabled===false?'':String(p?.location||'Locatie volgt'); }
  function playdayCostText(p){ return Number(p?.cost_per_player)>0?`€ ${Number(p.cost_per_player).toFixed(2).replace('.',',')} · `:''; }
  function tikkieMeta(p){ return `<span class="tikkie-mark" aria-label="Tikkie">€</span><span>${esc(playdayCostText(p))}bij complete baan</span>`; }
  function tikkieStatus(p){
    if(!p?.tikkie_url)return {label:'Geen Tikkie',className:'none',days:null};
    if(!p?.tikkie_created_at)return {label:'Datum ontbreekt',className:'warning',days:null};
    const start=new Date(`${String(p.tikkie_created_at).slice(0,10)}T12:00:00`);
    const today=new Date(`${todayISO()}T12:00:00`);
    const used=Math.max(0,Math.floor((today-start)/86400000));
    const days=13-used;
    if(days<=0)return {label:'Tikkie verlopen',className:'expired',days:0};
    return {label:`Tikkie · ${days} dag${days===1?'':'en'}`,className:days<=3?'warning':'active',days};
  }
  function tikkieAdminBadge(p){const st=tikkieStatus(p);return `<span class="tikkie-admin-status ${st.className}">${esc(st.label)}</span>`;}
  function current(){ return DB.current(); }
  function firstName(user=current()){ return String(user?.display_name||'').trim().split(/\s+/)[0]||'speler'; }
  function isAdmin(){ return current()?.role==='admin'; }
  function courtOccupancy(p){
    const slots=playdaySlots(p.id), counts=[];
    const max=Math.max(1,p.court_count,...slots.map(s=>Number(s.court_number)||1));
    for(let n=1;n<=max;n++) counts.push({court:n,count:slots.filter(s=>s.court_number===n&&s.user_id).length});
    const active=counts.filter(x=>x.count>0);
    return active.length?active:[{court:1,count:0}];
  }
  function occupancyMarkup(p){ return courtOccupancy(p).map(x=>`<span class=\"court-occupancy ${x.count===4?'complete':'open'}\">Baan ${x.court} · ${x.count}/4</span>`).join(''); }
  function pendingSwapForMe(){ return (DB.listSwapRequests?.()||[]).find(r=>r.to_user_id===current()?.id&&r.status==='pending'); }
  function outgoingSwapFor(playdayId){ return (DB.listSwapRequests?.()||[]).find(r=>r.playday_id===playdayId&&r.from_user_id===current()?.id&&r.status==='pending'); }
  function inheritedFromName(slot,playdayId){
    const request=(DB.listSwapRequests?.()||[]).filter(r=>r.playday_id===playdayId&&r.to_user_id===slot.user_id&&r.court_number===slot.court_number&&r.slot_number===slot.slot_number&&r.status==='accepted').sort((a,b)=>String(b.responded_at||b.created_at||'').localeCompare(String(a.responded_at||a.created_at||'')))[0];
    return request?nameOf(request.from_user_id):(slot.payment_inherited_from?nameOf(slot.payment_inherited_from):'');
  }
  function canHost(pd){ return DB.canHost(pd); }
  function isPlaydayToday(pd){ return pd?.date===todayISO(); }
  function liveScoringEnabled(pd){ return pd?.live_scoring_enabled!==false; }
  function statusLabel(s){ return ({absent:'Niet aanwezig',present:'Aanwezig',ready:'Ready',playing:'Speelt',done:'Klaar'})[s]||s; }
  function statusClass(s){ return ({absent:'status-absent',present:'status-present',ready:'status-ready',playing:'status-playing',done:'status-done'})[s]||'status-absent'; }
  function rsvpLabel(r){ return ({playing:'Ik speel mee',not_playing:'Ik kan niet'})[r]||'Nog niet gereageerd'; }
  function playdayById(id){ return DB.listPlaydays().find(p=>p.id===id); }
  function matches(){ return DB.listMatches(); }
  function selectedPlayday(){ if(state.selectedPlaydayId) return playdayById(state.selectedPlaydayId); const t=todayISO(); return DB.listPlaydays().find(p=>p.date===t) || DB.listPlaydays().find(p=>p.date>=t) || DB.listPlaydays().at(-1); }
  function participants(pdId){ const users=userMap(); return DB.listAttendance(pdId).map(a=>({...a,user:users.get(a.user_id)})).filter(x=>x.user); }
  function playdaySlots(pdId){ return (DB.listSlots?.(pdId)||[]).sort((a,b)=>a.court_number-b.court_number||a.slot_number-b.slot_number); }
  function reserveRsvps(pdId){
    const assigned=new Set(playdaySlots(pdId).filter(s=>s.user_id).map(s=>s.user_id));
    return DB.listRsvps(pdId).filter(r=>r.response==='playing'&&!assigned.has(r.user_id)).sort((a,b)=>String(a.playing_since||a.updated_at||'').localeCompare(String(b.playing_since||b.updated_at||''))||String(a.id||'').localeCompare(String(b.id||'')));
  }
  function courtIsComplete(slots,courtNumber){ return slots.filter(s=>s.court_number===courtNumber&&s.user_id).length===4; }
  function isPlayerInMatch(m,id){ return [m.blue_player_1,m.blue_player_2,m.red_player_1,m.red_player_2].includes(id); }
  function finishedMatchesFor(id){ return matches().filter(m=>m.status==='finished'&&!m.deleted_at&&isPlayerInMatch(m,id)); }
  function statsFor(id){
    const rows=S.aggregate(DB.listUsers().filter(u=>u.active),matches());
    const row=rows.find(r=>r.id===id)||{id,name:nameOf(id),points:0,played:0,wins:0,setsWon:0,setsLost:0,gamesWon:0,gamesLost:0,gameDiff:0,winPct:0};
    const recent=finishedMatchesFor(id).sort((a,b)=>new Date(b.ended_at||b.started_at)-new Date(a.ended_at||a.started_at)).slice(0,5).map(m=>{
      const blue=m.blue_player_1===id||m.blue_player_2===id;
      const won=m.set_completed&&m.winner_team===(blue?'blue':'red');
      return m.set_completed?(won?'W':'V'):'G';
    });
    return {...row,losses:Math.max(0,row.played-row.wins),recent};
  }

  function isStandalone(){ return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone===true; }
  function isIOS(){ return /iphone|ipad|ipod/i.test(navigator.userAgent); }
  function isAndroid(){ return /android/i.test(navigator.userAgent); }
  function actionCount(){
    const me=current(); if(!me)return 0; const today=todayISO();
    const unpaid=DB.listPlaydays().filter(p=>p.date>=today&&p.status!=='cancelled').filter(p=>{
      const slot=playdaySlots(p.id).find(s=>s.user_id===me.id); if(!slot||slot.paid)return false;
      return playdaySlots(p.id).filter(s=>s.court_number===slot.court_number&&s.user_id).length===4;
    }).length;
    return unpaid+(pendingSwapForMe()?1:0);
  }
  async function updateActionBadges(){
    const count=actionCount(), badge=$('#notificationNavBadge');
    if(badge){badge.textContent=String(count);badge.classList.toggle('hidden',count<1);}
    try{if('setAppBadge'in navigator){if(count>0)await navigator.setAppBadge(count);else await navigator.clearAppBadge();}}catch{}
  }
  function urlBase64ToUint8Array(value){const padding='='.repeat((4-value.length%4)%4),base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/'),raw=atob(base64);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));}
  async function enableNotifications(){
    if(!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window))throw new Error('Pushmeldingen worden op dit apparaat niet ondersteund.');
    if(isIOS()&&!isStandalone())throw new Error('Zet WEPADEL eerst op je beginscherm en open daarna de app via het icoon.');
    const permission=await Notification.requestPermission(); if(permission!=='granted')throw new Error('Meldingen zijn niet toegestaan. Je kunt dit wijzigen in de instellingen van je telefoon.');
    const reg=await navigator.serviceWorker.ready;
    let sub=await reg.pushManager.getSubscription();
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(window.PADEL_CONFIG.vapidPublicKey)});
    await DB.savePushSubscription(sub); localStorage.setItem('wepadel-notifications-enabled','1'); localStorage.removeItem('wepadel-notification-later');
    await DB.syncNotifications(); await updateActionBadges(); return true;
  }
  async function disableNotifications(){
    const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();
    if(sub){await DB.removePushSubscription(sub.endpoint);await sub.unsubscribe();}
    localStorage.removeItem('wepadel-notifications-enabled'); return true;
  }
  function openNotificationSettings(){
    const permission=('Notification'in window)?Notification.permission:'unsupported';
    modal('Meldingen',`<div class="onboarding-card"><div class="onboarding-icon">🔔</div><h3>${permission==='granted'?'Meldingen staan aan':'Blijf op de hoogte'}</h3><p>${permission==='granted'?'Je krijgt meldingen over complete banen, openstaande betalingen en ruilverzoeken.':'Zet meldingen aan zodat je altijd op de hoogte bent en blijft van je speeldagen.'}</p>${permission==='granted'?'<button class="btn danger full" id="disableNotifications">Meldingen uitzetten</button>':'<button class="btn primary full" id="enableNotifications">Meldingen aanzetten</button>'}</div>`,()=>{
      $('#enableNotifications')?.addEventListener('click',async()=>{try{await enableNotifications();closeModal();toast('Meldingen staan aan');render();}catch(e){toast(e.message,true);}});
      $('#disableNotifications')?.addEventListener('click',async()=>{try{await disableNotifications();closeModal();toast('Meldingen zijn uitgezet');render();}catch(e){toast(e.message,true);}});
    });
  }
  function showInstallOnboarding(){
    if(isStandalone()||localStorage.getItem('wepadel-install-dismissed')==='1'||sessionStorage.getItem('wepadel-install-shown-session')==='1')return false;
    sessionStorage.setItem('wepadel-install-shown-session','1');
    if(isIOS()){
      modal('Installeer WEPADEL als app','<div class="onboarding-card"><div class="onboarding-icon">📲</div><h3>Zet WEPADEL op je beginscherm</h3><ol><li>Tik onderin Safari op <b>Deel</b>.</li><li>Kies <b>Zet op beginscherm</b>.</li><li>Tik op <b>Voeg toe</b>.</li></ol><p class="muted">Open WEPADEL daarna via het app-icoon om meldingen te kunnen ontvangen.</p><button class="btn primary full" data-close-modal>Begrepen</button><button class="text-button" id="dismissInstall">Niet meer tonen</button></div>',()=>{$('#dismissInstall').onclick=()=>{localStorage.setItem('wepadel-install-dismissed','1');closeModal();};});return true;
    }
    if(isAndroid()){
      modal('Installeer WEPADEL als app',`<div class="onboarding-card"><div class="onboarding-icon">📲</div><h3>WEPADEL op je beginscherm</h3><p>Installeer de app voor volledig scherm, meldingen en een badge op het icoon.</p>${deferredInstallPrompt?'<button class="btn primary full" id="installAppNow">WEPADEL installeren</button>':'<ol><li>Tik rechtsboven op <b>⋮</b>.</li><li>Kies <b>App installeren</b> of <b>Toevoegen aan startscherm</b>.</li><li>Bevestig.</li></ol><button class="btn primary full" data-close-modal>Begrepen</button>'}<button class="text-button" id="dismissInstall">Niet meer tonen</button></div>`,()=>{$('#installAppNow')?.addEventListener('click',async()=>{deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;closeModal();});$('#dismissInstall').onclick=()=>{localStorage.setItem('wepadel-install-dismissed','1');closeModal();};});return true;
    }
    return false;
  }
  function maybeShowNotificationOnboarding(){
    if(!isStandalone()||!('Notification'in window)||Notification.permission==='granted'||Notification.permission==='denied')return;
    const later=Number(localStorage.getItem('wepadel-notification-later')||0); if(later&&Date.now()-later<3*86400000)return;
    modal('Blijf op de hoogte van je speeldagen','<div class="onboarding-card"><div class="onboarding-icon">🔔</div><h3>Zet meldingen aan</h3><p>Zet meldingen aan zodat je altijd op de hoogte bent en blijft van de speeldagen.</p><ul><li>Je baan is compleet</li><li>Een betaling staat nog open</li><li>Je ontvangt een ruilverzoek</li></ul><button class="btn primary full" id="onboardingEnableNotifications">Meldingen aanzetten</button><button class="btn ghost full" id="onboardingLater">Later</button></div>',()=>{$('#onboardingEnableNotifications').onclick=async()=>{try{await enableNotifications();closeModal();toast('Meldingen staan aan');render();}catch(e){toast(e.message,true);}};$('#onboardingLater').onclick=()=>{localStorage.setItem('wepadel-notification-later',String(Date.now()));closeModal();};});
  }
  function scheduleNotificationSync(){clearTimeout(notificationSyncTimer);notificationSyncTimer=setTimeout(()=>DB.syncNotifications?.(),700);}
  function runOnboarding(){setTimeout(()=>{if(!showInstallOnboarding())maybeShowNotificationOnboarding();},350);}
  function showApp(){ $('#postLoginSplash').classList.add('hidden'); $('#postLoginSplash').setAttribute('aria-hidden','true'); $('#loginScreen').classList.add('hidden'); $('#appShell').classList.remove('hidden'); $('#accountNavLabel').textContent=isAdmin()?'Beheer':'Account'; if(current()?.must_change_password) openPasswordModal(true); render(); updateActionBadges(); scheduleNotificationSync(); runOnboarding(); setTimeout(()=>{if(pendingSwapForMe()&&!state.swapPopupShown){state.swapPopupShown=true;openPendingSwap();}},250); }
  function showLogin(){
    $('#postLoginSplash').classList.add('hidden');
    $('#appShell').classList.add('hidden');
    $('#loginScreen').classList.remove('hidden');
    setTimeout(()=>showInstallOnboarding(),180);
  }
  async function showPostLoginSplash(){
    $('#loginScreen').classList.add('hidden');
    $('#appShell').classList.add('hidden');
    const splash=$('#postLoginSplash');
    splash.classList.remove('hidden');
    splash.setAttribute('aria-hidden','false');
    await new Promise(resolve=>setTimeout(resolve,1250));
    showApp();
  }
  function navigate(page){
    if(!['dashboard','playday','ranking','history','account'].includes(page)) return;
    closeModal();
    if(state.scoreboardMatchId) closeScoreboard();
    state.page=page;
    if(page==='playday') state.playdayList=true;
    else state.playdayList=true;
    $$('#bottomNav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
    render();
  }
  function render(){
    const main=$('#mainContent');
    if(!current()){showLogin();return;}
    const pages={dashboard:renderDashboard,playday:renderPlayday,ranking:renderRanking,history:renderHistory,account:renderAccount};
    main.className=`main-content page-${state.page}${state.page==='playday'&&!state.playdayList?' page-playday-detail':''}`;
    try{
      main.innerHTML=(pages[state.page]||renderDashboard)();
      bindPage();
    }catch(error){
      console.error('Scherm kon niet worden opgebouwd:',state.page,error);
      main.innerHTML=`<section class="flat-section"><h2>Scherm opnieuw laden</h2><p class="muted">Dit scherm kon niet direct worden opgebouwd.</p><button class="btn primary full" data-retry-page>Opnieuw proberen</button></section>`;
      $('[data-retry-page]')?.addEventListener('click',render);
    }
  }


  function uiHeader(title, subtitle, action=''){
    return `<div class="ui-header">${action?`<div class="ui-header-action">${action}</div>`:''}<div class="ui-header-main"><div><h1>${title}</h1>${subtitle?`<p>${subtitle}</p>`:""}</div></div></div>`;
  }
  function pageSize(reserved=390,rowHeight=72,min=3,max=7){ return Math.max(min,Math.min(max,Math.floor((window.innerHeight-reserved)/rowHeight))); }
  function paged(items,pageKey,size){ const pages=Math.max(1,Math.ceil(items.length/size)); state[pageKey]=Math.min(Math.max(0,state[pageKey]),pages-1); const start=state[pageKey]*size; return {rows:items.slice(start,start+size),page:state[pageKey],pages}; }
  function pager(meta,pageKey){ if(meta.pages<=1)return''; return `<nav class="pager" aria-label="Pagina's"><button data-page-step="-1" data-page-key="${pageKey}" ${meta.page===0?'disabled':''}>‹ Vorige</button><span>${meta.page+1} / ${meta.pages}</span><button data-page-step="1" data-page-key="${pageKey}" ${meta.page===meta.pages-1?'disabled':''}>Volgende ›</button></nav>`; }
  function dashboardLimit(){ return window.innerHeight>=800?3:window.innerHeight>=700?2:1; }
  function fmtDayBadge(date){ const d=new Date(date+'T12:00:00'); const wk=new Intl.DateTimeFormat('nl-NL',{weekday:'short'}).format(d); const mo=new Intl.DateTimeFormat('nl-NL',{month:'short'}).format(d); return `<span class="date-box"><b>${esc(wk).slice(0,2).toUpperCase()}</b><strong>${d.getDate()}</strong><small>${esc(mo).toLowerCase()}</small></span>`; }
  function rsvpStatus(playdayId){
    const me=current();
    if(state.pendingRsvp?.playdayId===playdayId) return state.pendingRsvp.response;
    const mine=DB.listRsvps(playdayId).find(r=>r.user_id===me.id);
    const override=state.rsvpOverrides[playdayId];
    if(override){
      if(mine?.response===override) delete state.rsvpOverrides[playdayId];
      else return override;
    }
    return mine?.response||'';
  }
  function playdayStatusText(p, mode='list'){
    const assigned=playdaySlots(p.id).filter(s=>s.user_id).length,reserves=reserveRsvps(p.id),mine=rsvpStatus(p.id),mineReserve=reserves.findIndex(r=>r.user_id===current().id),cap=Math.max(4,p.court_count*4),free=Math.max(0,cap-assigned);
    if(mode==='calendar') return `${assigned}/${cap} spelers${reserves.length?` · ${reserves.length} reserve${reserves.length===1?'':'s'}`:''}`;
    if(mode==='dashboard') return mine==='playing'?(mineReserve>=0?`Reserve · plek ${mineReserve+1}`:'Ingeschreven'):(mine==='not_playing'?'Ik kan niet':'Nog geen reactie');
    if(mine==='playing') return mineReserve>=0?`Reserve · plek ${mineReserve+1}`:'Ingeschreven';
    if(mine==='not_playing') return 'Ik kan niet';
    if(free===0) return reserves.length?`${reserves.length} op reserve`:'Baan compleet';
    return `${assigned} spelers · nog ${free} plek${free===1?'':'ken'}`;
  }
  function playdayRow(p, statusOverride=''){
    const time=playdayTimeText(p),place=playdayLocationText(p),mine=playdaySlots(p.id).find(s=>s.user_id===current()?.id),complete=mine&&playdaySlots(p.id).filter(s=>s.court_number===mine.court_number&&s.user_id).length===4;
    const payment=complete?`<span class="payment-summary ${mine.paid?'paid':'unpaid'}">${mine.paid?'✓ Betaald':'Nog niet betaald'}</span>${!mine.paid&&p.tikkie_url?`<a class="mini-tikkie" href="${esc(p.tikkie_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Open Tikkie</a>`:''}`:'';
    return `<div class="event-row luxe occupancy-row"><button class="event-open" data-open-playday="${p.id}">${fmtDayBadge(p.date)}<span class="event-main"><b>${esc(time||'Speeldag')}</b>${place?`<strong>${esc(place)}</strong>`:''}</span></button><div class="event-side"><div class="event-status-line">${occupancyMarkup(p)}${payment}</div></div><button class="chev event-chevron" data-open-playday="${p.id}" aria-label="Open speeldag">›</button></div>`;
  }

  function renderDashboard(){
    const me=current(), pds=DB.listPlaydays().filter(p=>p.status!=='cancelled'), today=todayISO();
    const rows=S.aggregate(DB.listUsers().filter(u=>u.active),matches()), mine=statsFor(me.id);
    const rank=rows.findIndex(r=>r.id===me.id)+1;
    const myIds=new Set(DB.listRsvps().filter(r=>r.user_id===me.id&&r.response==='playing').map(r=>r.playday_id));
    const completeDays=pds.filter(p=>p.date>=today&&myIds.has(p.id)).map(p=>({p,slot:playdaySlots(p.id).find(s=>s.user_id===me.id)})).filter(x=>x.slot&&playdaySlots(x.p.id).filter(s=>s.court_number===x.slot.court_number&&s.user_id).length===4);
    const paidPage=paged(completeDays.filter(x=>x.slot.paid).map(x=>x.p),'dashboardPaidPage',4);
    const actionPage=paged(completeDays.filter(x=>!x.slot.paid).map(x=>x.p),'dashboardActionPage',4);
    return `<div class="dashboard-greeting"><h1>Welkom, ${esc(firstName(me))}</h1>${avatarMarkup(me)}</div>${('Notification'in window&&Notification.permission!=='granted')?'<button class="notification-off-banner" data-notification-settings><span>🔔</span><strong>Meldingen staan uit</strong><small>Zet ze aan om niets te missen</small></button>':''}${pendingSwapForMe()?`<button class="swap-alert" data-open-swap-request><strong>Ruilverzoek ontvangen</strong><span>Bekijk en reageer</span></button>`:''}
      <div class="stats-compact-grid dashboard-kpis flat-kpis">
        <section class="stat-compact icon ranking"><span>Ranking</span><strong>#${rank||'–'}</strong></section>
        <section class="stat-compact icon points"><span>Punten</span><strong>${mine.points}</strong></section>
        <section class="stat-compact icon played"><span>Gespeeld</span><strong>${mine.played}</strong></section>
        <section class="stat-compact icon win"><span>Winst %</span><strong>${mine.winPct}%</strong></section>
      </div>
      <section class="section-block luxe-block dashboard-playdays"><div class="section-title"><h2>MIJN SPEELDAGEN</h2><button data-go="playday">Bekijk allemaal</button></div>
        <div class="event-list">${paidPage.rows.map(p=>playdayRow(p)).join('')||'<div class="empty-state compact-empty">Nog geen complete en betaalde speeldagen.</div>'}</div>${pager(paidPage,'dashboardPaidPage')}
      </section>
      <section class="section-block luxe-block dashboard-playdays action-needed"><div class="section-title"><h2>SPEELDAG BEHOEFT ACTIE</h2></div>
        <div class="event-list">${actionPage.rows.map(p=>playdayRow(p)).join('')||'<div class="empty-state compact-empty">Geen openstaande betalingen.</div>'}</div>${pager(actionPage,'dashboardActionPage')}
      </section>`;
  }

  function renderMonth(year,month,byDate){
    const start=new Date(year,month,1); const offset=(start.getDay()+6)%7; const days=new Date(year,month+1,0).getDate(); let cells='';
    const prevLast=new Date(year,month,0).getDate();
    for(let i=0;i<offset;i++){ const n=prevLast-offset+i+1; cells+=`<button class="day other" disabled><span>${n}</span></button>`; }
    for(let d=1;d<=days;d++){
      const date=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`,arr=byDate.get(date)||[],response=arr[0]?rsvpStatus(arr[0].id):'';
      const participation=arr.length?(response==='playing'?'rsvp-playing':response==='not_playing'?'rsvp-not-playing':'rsvp-open'):'';
      const cls=['day',date===todayISO()?'today':'',date===state.selectedCalendarDate?'selected':'',arr.length?'playday':'',participation].filter(Boolean).join(' ');
      const label=arr.length?(response==='playing'?'Speeldag, je doet mee':response==='not_playing'?'Speeldag, je kunt niet':'Open speeldag, nog niet gereageerd'):'Geen speeldag';
      cells+=`<button class="${cls}" data-date="${date}" ${arr[0]?`data-pd="${arr[0].id}"`:''} aria-label="${d} ${esc(label)}"><span>${d}</span></button>`;
    }
    const total=Math.ceil((offset+days)/7)*7;
    for(let i=offset+days;i<total;i++){ cells+=`<button class="day other" disabled><span>${i-(offset+days)+1}</span></button>`; }
    return `<section class="month single luxe-month"><div class="weekdays"><span>MA</span><span>DI</span><span>WO</span><span>DO</span><span>VR</span><span>ZA</span><span>ZO</span></div><div class="days">${cells}</div><div class="calendar-status-legend"><span><i class="open"></i>Open</span><span><i class="yes"></i>Ik speel mee</span><span><i class="no">×</i>Ik kan niet</span></div></section>`;
  }
  function slotPaymentMarkup(slot,editable){
    const inherited=slot.paid&&slot.payment_inherited_from?`<small>overgenomen van ${esc(nameOf(slot.payment_inherited_from))}</small>`:'';
    const status=editable?`<button class="payment-toggle ${slot.paid?'paid':'unpaid'}" data-slot-paid="${slot.id}" data-paid="${slot.paid?'false':'true'}">${slot.paid?'✓ Betaald':'Niet betaald'}</button>`:`<span class="payment-state ${slot.paid?'paid':'unpaid'}">${slot.paid?'✓ Betaald':'Niet betaald'}</span>`;
    return `<span class="payment-cell">${status}${inherited}</span>`;
  }
  function renderSignupCourt(pd,courtNumber,slots,users,admin){
    const courtSlots=slots.filter(s=>s.court_number===courtNumber), occupied=courtSlots.filter(s=>s.user_id), complete=occupied.length===4;
    const rows=occupied.map((slot,index)=>{
      const user=users.get(slot.user_id);
      const trailing=complete?slotPaymentMarkup(slot,admin):`<span class="court-position">Baan ${courtNumber} · ${index+1}/4</span>`;
      const adminActions=admin?`<span class="signup-admin-actions"><button class="mini-admin-btn" data-manage-playday-player="${slot.user_id}" data-slot-court="${courtNumber}">Verplaats</button><button class="mini-admin-btn danger" data-remove-playday-player="${slot.user_id}">Verwijder</button></span>`:'';
      return `<div class="signup-player-row aligned-player-row"><strong class="avatar-name player-row-name">${esc(user?.display_name||'Onbekend')}${avatarMarkup(user)}</strong><span class="player-row-role">${slot.user_id===pd.host_id?'<span class="mini-pill">Host</span>':''}</span><span class="player-row-payment">${trailing}</span>${adminActions}</div>`;
    });
    courtSlots.filter(s=>!s.user_id&&s.paid).forEach(slot=>rows.push(`<div class="signup-player-row empty-paid"><strong>Open plek</strong><span class="mini-pill">Betaald bewaard</span>${admin?slotPaymentMarkup(slot,true):''}</div>`));
    return `<section class="signup-court ${complete?'complete-court':'incomplete-court'}" aria-label="Baan ${courtNumber}${complete?', compleet':''}"><div>${rows.join('')||'<div class="empty-state compact-empty">Nog geen spelers op deze baan.</div>'}</div></section>`;
  }
  function renderReserveList(reserves,users,admin=false){
    if(!reserves.length)return'';
    return `<section class="reserve-list"><header><h3>Reservelijst</h3><span>${reserves.length} reserve${reserves.length===1?'':'s'}</span></header><div>${reserves.map((r,i)=>`<div class="signup-player-row"><b class="reserve-position">${i+1}</b><strong class="avatar-name">${esc(users.get(r.user_id)?.display_name||'Onbekend')}${avatarMarkup(users.get(r.user_id))}</strong><span class="mini-pill reserve">Plek ${i+1}</span>${admin?`<span class="signup-admin-actions"><button class="mini-admin-btn" data-manage-playday-player="${r.user_id}" data-slot-court="reserve">Verplaats</button><button class="mini-admin-btn danger" data-remove-playday-player="${r.user_id}">Verwijder</button></span>`:''}</div>`).join('')}</div></section>`;
  }

  function renderPlayday(){
    if(state.playdayList){
      const pds=DB.listPlaydays().filter(p=>p.status!=='cancelled').sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.start_time||'').localeCompare(String(b.start_time||'')));
      const byDate=new Map(); pds.forEach(p=>{if(!byDate.has(p.date))byDate.set(p.date,[]);byDate.get(p.date).push(p);});
      const monthName=new Intl.DateTimeFormat('nl-NL',{month:'long',year:'numeric'}).format(new Date(state.year,state.month,1));
      const filtered=pds.filter(p=>state.playdayFilter==='upcoming'?p.date>=todayISO():state.playdayFilter==='past'?p.date<todayISO():true);
      const selectedRows=state.selectedCalendarDate?(byDate.get(state.selectedCalendarDate)||[]):[];
      const listPage=paged(filtered,'playdayPage',pageSize(400,74,3,7));
      return `${uiHeader('Speeldagen','',isAdmin()?'<button class="btn primary small" data-add-pd>+ Speeldag</button>':'')}
        <div class="view-switch"><button class="${state.playdayView==='calendar'?'active':''}" data-playday-view="calendar">Maandkalender</button><button class="${state.playdayView==='all'?'active':''}" data-playday-view="all">Alle speeldagen</button></div>
        ${state.playdayView==='calendar'?`<section class="flat-section calendar-wrap"><div class="calendar-head luxe"><button data-month="-1">‹</button><h2>${esc(monthName.charAt(0).toUpperCase()+monthName.slice(1))}</h2><button data-month="1">›</button><button class="today-btn" data-today>Vandaag</button></div>${renderMonth(state.year,state.month,byDate)}</section>${state.selectedCalendarDate?`<section class="selected-date-result"><div class="event-list open-list">${selectedRows.map(p=>playdayRow(p,playdayStatusText(p,'calendar'))).join('')||'<div class="empty-state compact-empty">Geen speeldag op deze datum.</div>'}</div></section>`:''}`:`<div class="filter-tabs"><button class="${state.playdayFilter==='all'?'active':''}" data-playday-filter="all">Alle</button><button class="${state.playdayFilter==='upcoming'?'active':''}" data-playday-filter="upcoming">Aankomende</button><button class="${state.playdayFilter==='past'?'active':''}" data-playday-filter="past">Afgelopen</button></div><div class="event-list open-list all-days">${listPage.rows.map(p=>playdayRow(p)).join('')||'<div class="empty-state">Geen speeldagen in dit overzicht.</div>'}</div>${pager(listPage,'playdayPage')}`}`;
    }
    const pd=selectedPlayday(); if(!pd){state.playdayList=true;return renderPlayday();}
    state.selectedPlaydayId=pd.id;
    const me=current(), users=userMap(), selectedResponse=rsvpStatus(pd.id), at=DB.listAttendance(pd.id).find(a=>a.user_id===me.id), host=canHost(pd), admin=isAdmin(), all=DB.listRsvps(pd.id).filter(r=>r.response==='playing');
    const slots=playdaySlots(pd.id), reserves=reserveRsvps(pd.id), mineSlot=slots.find(s=>s.user_id===me.id), mineReserveIndex=reserves.findIndex(r=>r.user_id===me.id);
    const dayMatches=DB.listMatches(pd.id).filter(m=>!m.deleted_at), active=dayMatches.filter(m=>m.status==='active'&&m.started_at), reviews=DB.listReviews(pd.id), myReview=reviews.find(r=>r.user_id===me.id), attendance=participants(pd.id);
    const nextCourtNeed=Math.max(0,4-reserves.length), today=isPlaydayToday(pd);
    const courtGroups=Array.from({length:pd.court_count},(_,i)=>renderSignupCourt(pd,i+1,slots,users,admin)).join('');
    const mineCourtSlots=mineSlot?slots.filter(s=>s.court_number===mineSlot.court_number):[], mineCourtComplete=Boolean(mineSlot)&&mineCourtSlots.filter(s=>s.user_id).length===4;
    const matchesAccessible=today||admin;
    const readyButton=`<section class="flat-section match-lobby-card"><p class="lobby-intro">Op de speeldag staan hier de wedstrijden.</p>${today&&active.length?'<span class="badge green ready-live-badge">Live</span>':''}<button class="btn primary full ready-play-button" data-open-day-matches ${matchesAccessible?'':'disabled'}>Ready to play!</button>${!matchesAccessible?'<small class="lobby-disabled-note">Beschikbaar op de dag van de speeldag.</small>':admin&&!today?'<small class="lobby-disabled-note">Beheerweergave voor uitslagen en correcties.</small>':''}</section>`;
    let progressTitle='',progressText='',progressWidth=0,paymentAction='';
    if(mineSlot){
      const filled=mineCourtSlots.filter(s=>s.user_id).length,missing=4-filled;
      progressTitle=mineCourtComplete?`Baan ${mineSlot.court_number} compleet`:`Nog ${missing} speler${missing===1?'':'s'} nodig op baan ${mineSlot.court_number}`;
      progressText=mineCourtComplete?(mineSlot.paid?'Jouw plek staat als betaald.':'Jouw baan is compleet; de betaling kan nu worden geregeld.'):'Je plek staat vast.';
      progressWidth=Math.min(100,(filled/4)*100);
      if(mineCourtComplete&&mineSlot.paid){
        const inheritedName=inheritedFromName(mineSlot,pd.id);
        paymentAction=`<p class="paid-confirm">✓ Betaald${inheritedName?` · overgenomen van ${esc(inheritedName)}`:''}</p>`;
      }else if(mineCourtComplete&&pd.tikkie_url){
        paymentAction=`<a class="btn primary full pay-btn" href="${esc(pd.tikkie_url)}" target="_blank" rel="noopener"><span class="tikkie-mark">€</span> Open Tikkie</a><small class="payment-delay">Na betaling kan het tot 24 uur duren voordat je status is aangepast.</small>`;
      }else if(mineCourtComplete){
        paymentAction='<p class="muted">De Tikkie-link is nog niet ingesteld.</p>';
      }
    }else if(mineReserveIndex>=0){
      progressTitle=`Je staat reserve · plek ${mineReserveIndex+1}`;
      progressText=`Nog ${nextCourtNeed||4} reserve${(nextCourtNeed||4)===1?'':'s'} nodig voor baan ${pd.court_count+1}. Je betaalt pas nadat je een vaste baanplek krijgt.`;
      progressWidth=Math.min(100,(reserves.length/4)*100);
      paymentAction='<p class="muted">Op de reservelijst wordt nog geen Tikkie gevraagd.</p>';
    }
    return `<button class="detail-back" data-back-list>‹</button>${uiHeader(esc(fmtDate(pd.date)), '', '')}
      <div class="playday-meta-cards">${playdayTimeText(pd)?`<div class="meta-chip">◷ ${esc(playdayTimeText(pd))}</div>`:''}${pd.location_enabled===false?'':`<div class="meta-chip">⌖ ${esc(playdayLocationText(pd))}</div>`}<div class="meta-chip tikkie-meta">${tikkieMeta(pd)}</div></div>
      <section class="flat-section rsvp-section"><h2>Jouw status</h2><div class="choice-grid luxe-choices"><button class="choice ${selectedResponse==='playing'?'selected':''}" data-rsvp="playing" ${state.pendingRsvp?'disabled':''}><b class="choice-mark">✓</b><span>Ik speel mee</span></button>${mineCourtComplete?(outgoingSwapFor(pd.id)?`<button class="choice swap requested" disabled><b class="choice-mark">⇄</b><span>Ruilverzoek gedaan</span></button>`:`<button class="choice swap" data-request-swap><b class="choice-mark">⇄</b><span>Ruilen</span></button>`):`<button class="choice no ${selectedResponse==='not_playing'?'selected':''}" data-rsvp="not_playing" ${state.pendingRsvp?'disabled':''}><b class="choice-mark">✕</b><span>Ik kan niet</span></button>`}</div>${selectedResponse?`<p class="rsvp-current ${selectedResponse==='playing'?'yes':'no'}">${selectedResponse==='playing'?'✓ Je speelt mee':'✕ Je speelt niet mee'}</p>`:'<p class="rsvp-current open">Nog niet gekozen</p>'}</section>
      <section class="flat-section signup-overview"><div class="section-title signup-title"><h2>Spelers (${all.length})</h2><div class="signup-title-actions"><span class="host-pill">Host: ${playerNameMarkup(pd.host_id)}</span>${admin?'<button class="btn primary small" data-admin-add-playday-player>+ Speler</button>':''}</div></div><div class="signup-courts">${courtGroups}</div>${renderReserveList(reserves,users,admin)}</section>
      ${progressTitle?`<section class="flat-section progress-panel"><div class="progress-head"><div class="progress-icon">▣</div><div><strong>${progressTitle}</strong><span>${progressText}</span></div></div><div class="bar-track"><i style="width:${progressWidth}%"></i></div>${paymentAction}</section>`:''}
      ${readyButton}${renderReviewPanel(pd,attendance,reviews,myReview,host)}
      ${isAdmin()?`<section class="flat-section admin-actions"><button class="btn ghost" data-edit-pd>Speeldag wijzigen</button><button class="btn danger" data-delete-pd>Speeldag verwijderen</button></section>`:''}`;
  }

  function renderCourt(pd,n,m){
    if(!m)return `<div class="court-card"><div class="court-title"><strong>Baan ${n}</strong><span class="badge">Vrij</span></div><div class="empty-state">Nog geen actieve wedstrijd</div><button class="btn small primary full" data-new-match data-court="${n}">Wedstrijd maken</button></div>`;
    const d=S.display(m.score_state),live=liveScoringEnabled(pd);
    return `<div class="court-card"><div class="court-title"><strong>Baan ${n}</strong><span class="badge ${live?'green':'yellow'}">${live?'Live':'Handmatig'}</span></div><div class="teams"><div class="team-box blue"><strong>${playerNameMarkup(m.blue_player_1)} & ${playerNameMarkup(m.blue_player_2)}</strong><div class="score-mini">${live?`${m.score_state.blueGames} · ${d.bluePoints}`:'–'}</div></div><div class="versus">VS</div><div class="team-box red"><strong>${playerNameMarkup(m.red_player_1)} & ${playerNameMarkup(m.red_player_2)}</strong><div class="score-mini">${live?`${m.score_state.redGames} · ${d.redPoints}`:'–'}</div></div></div><button class="btn primary full" ${live?`data-open-match="${m.id}"`:`data-manual-result="${m.id}"`}>${live?'Score bedienen':'Uitslag invullen'}</button></div>`;
  }
  function renderSpectatorCourt(m){ const d=S.display(m.score_state); return `<div class="court-card"><div class="court-title"><strong>Baan ${m.court_number}</strong><span class="badge green">Live</span></div><div class="teams"><div class="team-box blue"><strong>${playerNameMarkup(m.blue_player_1)} & ${playerNameMarkup(m.blue_player_2)}</strong><div class="score-mini">${m.score_state.blueGames} · ${d.bluePoints}</div></div><div class="versus">VS</div><div class="team-box red"><strong>${playerNameMarkup(m.red_player_1)} & ${playerNameMarkup(m.red_player_2)}</strong><div class="score-mini">${m.score_state.redGames} · ${d.redPoints}</div></div></div><button class="btn ghost full" data-view-scoreboard="${m.id}">Groot live scorebord</button></div>`; }
  function renderMatchRow(m,users,host,pd){
    const blue=`${nameOf(m.blue_player_1)} & ${nameOf(m.blue_player_2)}`,red=`${nameOf(m.red_player_1)} & ${nameOf(m.red_player_2)}`;
    const finished=m.status==='finished',scheduled=m.status==='scheduled'||(m.status==='active'&&!m.started_at),score=finished?`${m.blue_games}-${m.red_games}`:'tegen';
    const canDelete=isAdmin()||(host&&isPlaydayToday(pd));
    const editResult=finished&&isAdmin()?`<button class="btn small primary" data-manual-result="${m.id}">Uitslag wijzigen</button>`:'';
    return `<div class="open-row match-row"><div><strong>Baan ${m.court_number}: ${esc(blue)} ${score} ${esc(red)}</strong><small>${finished?'Wedstrijd afgerond':scheduled?'Gepland · nog niet gestart':liveScoringEnabled(pd)?'Live score actief':'Uitslag na afloop invullen'}</small></div><div class="list-actions">${scheduled&&host?`<button class="btn small primary" data-start-match="${m.id}">Start wedstrijd</button>`:!finished&&host?`<button class="btn small primary" ${liveScoringEnabled(pd)?`data-open-match="${m.id}"`:`data-manual-result="${m.id}"`}>${liveScoringEnabled(pd)?'Open':'Uitslag'}</button>`:''}${finished?'<span class="badge green">Klaar</span>':''}${editResult}${canDelete?`<button class="btn small ghost" data-delete-match="${m.id}">Verwijder</button>`:''}</div></div>`;
  }
  function renderReviewPanel(pd,attendance,reviews,myReview,host){ if(!['review','host_review','approved'].includes(pd.session_status))return''; const rejectCount=reviews.filter(r=>r.decision==='reject').length; if(pd.session_status==='approved')return `<section class="flat-section"><span class="badge green">Goedgekeurd</span><h2>Speeldag definitief</h2><p class="muted">${rejectCount} afkeuring${rejectCount===1?'':'en'}.</p></section>`; if(pd.session_status==='host_review')return `<section class="flat-section review-banner"><h2>Controle door host nodig</h2><p>${rejectCount} spelers hebben de sessie afgekeurd.</p>${host?'<button class="btn primary" data-resolve-session>Gecontroleerd en definitief maken</button>':'<span class="badge yellow">Wachten op host</span>'}</section>`; const participated=attendance.some(a=>a.user_id===current().id); return `<section class="flat-section review-banner"><h2>Beoordeel de hele speeldag</h2><p>Controleer alle wedstrijden en keur de sessie in één keer goed of af.</p>${participated&&!myReview?'<div class="action-row"><button class="btn primary" data-review="approve">Alles klopt</button><button class="btn danger" data-review="reject">Er klopt iets niet</button></div>':myReview?`<span class="badge ${myReview.decision==='approve'?'green':'yellow'}">Jouw keuze: ${myReview.decision==='approve'?'goedgekeurd':'afgekeurd'}</span>`:'<p class="muted">Alleen deelnemers kunnen beoordelen.</p>'}</section>`; }
  function renderRanking(){
    const ordered=S.aggregate(DB.listUsers().filter(u=>u.active),matches()),rows=ordered.map(r=>statsFor(r.id));
    const me=current();
    return `${uiHeader('Statistieken','')}
      <section class="ranking-only"><div class="section-title"><h2>Competitieranglijst</h2><span class="muted small-note">Tik op een speler</span></div><div class="competition-list detailed-ranking">${rows.map((r,i)=>`<button class="competition-row detailed ${r.id===me.id?'me':''}" data-player="${r.id}"><span class="ranking-player-head"><span class="rank-index">${i+1}</span><span class="player-cell"><strong class="avatar-name">${esc(r.name)}${avatarMarkup(r.id)}</strong><i class="form-line">${r.recent.map(x=>`<em class="${x==='W'?'win':x==='V'?'loss':'draw'}">${x}</em>`).join('')||'<em>–</em>'}</i></span><span class="chev">›</span></span><span class="ranking-metrics"><span><b>${r.points}</b><small>Punten</small></span><span><b>${r.played}</b><small>Wed.</small></span><span><b>${r.wins}-${r.losses}</b><small>W-V</small></span><span><b>${r.winPct}%</b><small>Winst</small></span><span><b>${r.setsWon}-${r.setsLost}</b><small>Sets</small></span><span><b>${r.gamesWon}-${r.gamesLost}</b><small>Games</small></span><span><b>${r.gameDiff>0?'+':''}${r.gameDiff}</b><small>Saldo</small></span></span></button>`).join('')||'<div class="empty-state">Nog geen spelers.</div>'}</div></section>
      <section class="flat-section scoring-note"><h2>Puntentelling</h2><p class="muted">Elke gewonnen game is 1 punt. De winnaar van een volledig uitgespeelde wedstrijd krijgt 3 bonuspunten.</p></section>`;
  }
  function renderHistory(){
    const me=current(),mine=statsFor(me.id),pds=new Map(DB.listPlaydays().map(p=>[p.id,p])),grouped=new Map();
    finishedMatchesFor(me.id).forEach(m=>{if(!grouped.has(m.playday_id))grouped.set(m.playday_id,[]);grouped.get(m.playday_id).push(m);});
    const days=[...grouped.entries()].map(([id,ms])=>({pd:pds.get(id),ms})).filter(x=>x.pd).sort((a,b)=>b.pd.date.localeCompare(a.pd.date));
    const historyPage=paged(days,'historyPage',pageSize(340,76,3,7));
    return `${uiHeader('Historie','')}
      <div class="personal-detail-strip history-totals"><span><small>Speeldagen</small><b>${days.length}</b></span><span><small>Wedstrijden</small><b>${mine.played}</b></span><span><small>Gewonnen</small><b>${mine.wins}</b></span><span><small>Punten</small><b>${mine.points}</b></span></div>
      <div class="personal-history-list">${historyPage.rows.map(({pd,ms})=>{let wins=0,pts=0;ms.forEach(m=>{const blue=m.blue_player_1===me.id||m.blue_player_2===me.id;pts+=S.awardedPoints(m,blue?'blue':'red');if(m.set_completed&&m.winner_team===(blue?'blue':'red'))wins++;});return `<button class="personal-day-row" data-history-playday="${pd.id}">${fmtDayBadge(pd.date)}<span class="personal-day-main"><strong>${esc(playdayLocationText(pd)||'Speeldag')}</strong><small>${esc([playdayTimeText(pd),`${ms.length} wedstrijd${ms.length===1?'':'en'}`].filter(Boolean).join(' · '))}</small><span>${wins} gewonnen · ${ms.length-wins} niet gewonnen</span></span><span class="personal-day-points"><b>+${pts}</b><small>punten</small></span><span class="chev">›</span></button>`}).join('')||'<div class="empty-state">Je hebt nog geen afgeronde wedstrijden gespeeld.</div>'}</div>${pager(historyPage,'historyPage')}`;
  }
  function renderAccount(){
    if(isAdmin())return renderAdmin();
    const me=current();
    return `${uiHeader('Account','')}
      <section class="account-compact"><div><strong class="avatar-name">${esc(me.display_name)}${avatarMarkup(me)}</strong><span>@${esc(me.username)} · speler</span></div></section>
      <div class="account-actions"><button class="open-action" data-notification-settings><span>Meldingen</span><b>›</b></button><button class="open-action" data-change-avatar><span>Avatar wijzigen</span><b>›</b></button><button class="open-action" data-change-password><span>Wachtwoord wijzigen</span><b>›</b></button><button class="open-action danger-text" data-logout><span>Uitloggen</span><b>›</b></button></div>`;
  }
  function renderAdmin(){
    if(!isAdmin())return '<section class="card empty-state">Geen toegang.</section>';
    const users=DB.listUsers(),pending=users.filter(u=>u.approval_status==='pending'),players=users.filter(u=>u.approval_status!=='pending'),pds=DB.listPlaydays().sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||String(a.start_time||'').localeCompare(String(b.start_time||'')));
    const adminSize=pageSize(420,62,3,7),emptyPage={rows:[],page:0,pages:1};
    const requestsPage=state.adminTab==='requests'?paged(pending,'adminPage',adminSize):emptyPage;
    const playersPage=state.adminTab==='players'?paged(players,'adminPage',adminSize):emptyPage;
    const playdaysPage=state.adminTab==='playdays'?paged(pds,'adminPage',adminSize):emptyPage;
    const requestsPanel=`<section class="flat-section admin-panel"><div class="section-title"><h2>Nieuwe aanmeldingen</h2></div><div class="compact-admin-list">${requestsPage.rows.map(u=>`<article class="compact-admin-row"><div><strong class="avatar-name">${esc(u.display_name)}${avatarMarkup(u)}</strong><small>@${esc(u.username)} · wacht op goedkeuring</small></div><div class="admin-item-actions"><button class="btn small primary" data-approve-user="${u.id}">Goedkeuren</button><button class="btn small danger" data-reject-user="${u.id}">Afwijzen</button></div></article>`).join('')||'<div class="empty-state">Geen openstaande aanmeldingen.</div>'}</div>${pager(requestsPage,'adminPage')}</section>`;
    const playersPanel=`<section class="flat-section admin-panel"><div class="section-title admin-title"><h2>Spelers (${players.filter(u=>u.role==='player'&&u.active).length})</h2><button class="btn primary small" data-add-user>+ Speler</button></div><div class="compact-admin-list">${playersPage.rows.map(u=>`<article class="compact-admin-row player-admin-row"><div><strong class="avatar-name">${esc(u.display_name)}${avatarMarkup(u)} ${u.role==='admin'?'<span class="badge yellow">Beheerder</span>':''}</strong><small>@${esc(u.username)} · ${u.approval_status==='rejected'?'afgewezen':u.active?'actief':'geblokkeerd'}</small></div><div class="admin-item-actions">${u.role!=='admin'?`<button class="btn small ghost" data-edit-user="${u.id}">Bewerk</button><button class="btn small ghost" data-reset-user="${u.id}">Reset</button><button class="btn small ghost" data-block-user="${u.id}" data-active="${u.active?'false':'true'}">${u.active?'Blokkeer':'Activeer'}</button><button class="btn small danger" data-remove-user="${u.id}">Verwijder</button>`:''}</div></article>`).join('')}</div>${pager(playersPage,'adminPage')}</section>`;
    const playdaysPanel=`<section class="flat-section admin-panel"><div class="section-title admin-title"><h2>Speeldagen</h2><button class="btn primary small" data-add-pd>+ Speeldag</button></div><div class="compact-admin-list">${playdaysPage.rows.map(p=>`<article class="compact-admin-row playday-admin-row"><div>${fmtDayBadge(p.date)}</div><div class="playday-admin-main"><strong>${esc(playdayLocationText(p)||'Speeldag')}</strong><small>${esc([playdayTimeText(p),`host ${nameOf(p.host_id)}`].filter(Boolean).join(' · '))}</small></div>${tikkieAdminBadge(p)}<div class="admin-item-actions"><button class="btn small primary" data-admin-add-player-id="${p.id}">+ Speler</button><button class="btn small ghost" data-open-playday="${p.id}">Open</button><button class="btn small ghost" data-edit-pd-id="${p.id}">Wijzig</button><button class="btn small danger" data-delete-pd-id="${p.id}">Verwijder</button></div></article>`).join('')||'<div class="empty-state">Geen speeldagen.</div>'}</div>${pager(playdaysPage,'adminPage')}</section>`;
    const settingsPanel=`<section class="flat-section admin-panel"><section class="account-compact"><div><strong class="avatar-name">${esc(current().display_name)}${avatarMarkup(current())}</strong><span>@${esc(current().username)} · beheerder</span></div></section><div class="account-actions"><button class="open-action" data-change-avatar><span>Avatar wijzigen</span><b>›</b></button></div><form id="registrationCodeForm" class="inline-setting"><div><strong>Competitiecode wijzigen</strong><small>Minimaal 6 tekens. Deel deze alleen met spelers.</small></div><input name="competition_code" minlength="6" placeholder="Nieuwe competitiecode" required><button class="btn primary small">Opslaan</button></form><div class="account-actions"><button class="open-action" data-notification-settings><span>Meldingen</span><b>›</b></button><button class="open-action danger-text" data-reset-statistics><span>Alle statistieken resetten</span><b>›</b></button><button class="open-action danger-text" data-full-reset><span>Testgegevens wissen / Opnieuw beginnen</span><b>›</b></button><button class="open-action" data-change-password><span>Wachtwoord wijzigen</span><b>›</b></button><button class="open-action danger-text" data-logout><span>Uitloggen</span><b>›</b></button></div></section>`;
    return `${uiHeader('Beheer','')}
      <div class="tabs admin-tabs luxe four-tabs"><button class="${state.adminTab==='requests'?'active':''}" data-admin-tab="requests">Aanmeldingen${pending.length?` <b>${pending.length}</b>`:''}</button><button class="${state.adminTab==='players'?'active':''}" data-admin-tab="players">Spelers</button><button class="${state.adminTab==='playdays'?'active':''}" data-admin-tab="playdays">Speeldagen</button><button class="${state.adminTab==='settings'?'active':''}" data-admin-tab="settings">Account</button></div>
      ${state.adminTab==='requests'?requestsPanel:state.adminTab==='players'?playersPanel:state.adminTab==='playdays'?playdaysPanel:settingsPanel}`;
  }
  function bindPage(){
    $$('[data-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.go));
    $$('[data-open-playday]').forEach(b=>b.onclick=()=>{state.selectedPlaydayId=b.dataset.openPlayday;state.playdayList=false;state.page='playday';render();});
    $$('[data-playday-view]').forEach(b=>b.onclick=()=>{state.playdayView=b.dataset.playdayView;state.playdayPage=0;render();});
    $$('[data-playday-filter]').forEach(b=>b.onclick=()=>{state.playdayFilter=b.dataset.playdayFilter;state.playdayPage=0;render();});
    $$('[data-page-step]').forEach(b=>b.onclick=()=>{const key=b.dataset.pageKey;if(!(key in state))return;state[key]+=Number(b.dataset.pageStep);render();});
    $$('[data-player]').forEach(b=>b.onclick=()=>openPlayer(b.dataset.player));
    $$('[data-history-playday]').forEach(b=>b.onclick=()=>openPersonalHistory(b.dataset.historyPlayday,current().id));
    $$('[data-year]').forEach(b=>b.onclick=()=>{state.year+=Number(b.dataset.year);render();});
    $$('.day[data-date]').forEach(b=>b.onclick=()=>{const pd=b.dataset.pd?playdayById(b.dataset.pd):null;state.selectedCalendarDate=b.dataset.date;if(pd){render();}else if(isAdmin())openPlaydayForm(null,b.dataset.date);else render();});
    $$('[data-rsvp]').forEach(b=>b.onclick=()=>updateRsvp(b.dataset.rsvp));
    $('[data-request-swap]')?.addEventListener('click',openSwapRequest);
    $('[data-open-swap-request]')?.addEventListener('click',openPendingSwap);
    $$('[data-slot-paid]').forEach(b=>b.onclick=()=>run(()=>DB.setSlotPaid(b.dataset.slotPaid,b.dataset.paid==='true'),b.dataset.paid==='true'?'Betaling als betaald gemarkeerd':'Betaling teruggezet naar niet betaald'));
    $('[data-admin-add-playday-player]')?.addEventListener('click',()=>openManagePlaydayPlayer());
    $$('[data-admin-add-player-id]').forEach(b=>b.onclick=()=>{state.selectedPlaydayId=b.dataset.adminAddPlayerId;openManagePlaydayPlayer();});
    $$('[data-manage-playday-player]').forEach(b=>b.onclick=()=>openManagePlaydayPlayer(b.dataset.managePlaydayPlayer,b.dataset.slotCourt));
    $$('[data-remove-playday-player]').forEach(b=>b.onclick=()=>confirmAction('Speler van speeldag verwijderen?','De speler verdwijnt van de baan of reservelijst en krijgt de status Ik kan niet.',()=>DB.adminRemovePlaydayPlayer(state.selectedPlaydayId,b.dataset.removePlaydayPlayer)));
    $('[data-back-list]')?.addEventListener('click',()=>{state.playdayList=true;render();});
    $('[data-delete-pd]')?.addEventListener('click',()=>confirmAction('Speeldag verwijderen?','Alle deelnemers, wedstrijden, uitslagen en gekoppelde informatie worden definitief verwijderd.',()=>DB.deletePlayday(state.selectedPlaydayId)));
    $$('[data-month]').forEach(b=>b.onclick=()=>{state.month+=Number(b.dataset.month);state.selectedCalendarDate=null;if(state.month<0){state.month=11;state.year--;}if(state.month>11){state.month=0;state.year++;}render();});
    $('[data-today]')?.addEventListener('click',()=>{state.year=new Date().getFullYear();state.month=new Date().getMonth();state.selectedCalendarDate=todayISO();render();});
    $('[data-open-day-matches]')?.addEventListener('click',openDayMatches);
    $$('[data-new-match]').forEach(b=>b.onclick=()=>openNewMatch(Number(b.dataset.court)||null));
    $$('[data-open-match]').forEach(b=>b.onclick=()=>openMatch(b.dataset.openMatch));
    $$('[data-start-match]').forEach(b=>b.onclick=()=>run(()=>DB.startMatch(b.dataset.startMatch),'Wedstrijd gestart'));
    $$('[data-manual-result]').forEach(b=>b.onclick=()=>openManualResult(b.dataset.manualResult));
    $('[data-live-toggle]')?.addEventListener('change',e=>changeLiveScoring(e.target.checked));
    $$('[data-view-scoreboard]').forEach(b=>b.onclick=()=>openScoreboard(b.dataset.viewScoreboard,true));
    $$('[data-delete-match]').forEach(b=>b.onclick=()=>confirmAction('Wedstrijd verwijderen?','De uitslag verdwijnt uit de ranglijst.',()=>DB.deleteMatch(b.dataset.deleteMatch)));
    $('[data-end-session]')?.addEventListener('click',()=>confirmAction('Speeldag afsluiten?','Daarna beoordelen alle deelnemers alle wedstrijden in één keer.',()=>DB.endSession(state.selectedPlaydayId)));
    $$('[data-review]').forEach(b=>b.onclick=()=>reviewSession(b.dataset.review));
    $('[data-resolve-session]')?.addEventListener('click',()=>confirmAction('Definitief goedkeuren?','Je bevestigt als host dat alle correcties zijn verwerkt.',()=>DB.resolveSession(state.selectedPlaydayId)));
    $('[data-edit-pd]')?.addEventListener('click',()=>openPlaydayForm(selectedPlayday()));
    $$('[data-match-info]').forEach(b=>b.onclick=()=>openMatchInfo(b.dataset.matchInfo));
    $$('[data-admin-tab]').forEach(b=>b.onclick=()=>{state.adminTab=b.dataset.adminTab;state.adminPage=0;render();});
    $$('[data-approve-user]').forEach(b=>b.onclick=()=>run(()=>DB.approveUser(b.dataset.approveUser),'Account goedgekeurd'));
    $$('[data-reject-user]').forEach(b=>b.onclick=()=>confirmAction('Aanmelding afwijzen?','Deze speler krijgt geen toegang tot de competitie.',()=>DB.rejectUser(b.dataset.rejectUser)));
    $('[data-add-user]')?.addEventListener('click',openAddUser);
    $$('[data-edit-user]').forEach(b=>b.onclick=()=>openEditUser(b.dataset.editUser));
    $$('[data-reset-user]').forEach(b=>b.onclick=()=>openResetUser(b.dataset.resetUser));
    $$('[data-block-user]').forEach(b=>b.onclick=()=>{const active=b.dataset.active==='true';confirmAction(active?'Speler activeren?':'Speler blokkeren?',active?'De speler kan daarna weer inloggen.':'De speler kan niet meer inloggen. Historische uitslagen blijven behouden.',()=>DB.blockUser(b.dataset.blockUser,active));});
    $$('[data-remove-user]').forEach(b=>b.onclick=()=>confirmAction('Account definitief verwijderen?','Het loginaccount en profiel worden definitief verwijderd. Dit kan alleen wanneer de speler geen wedstrijdhistorie heeft en geen speeldag host.',()=>DB.deleteUser(b.dataset.removeUser)));
    $('[data-add-pd]')?.addEventListener('click',()=>openPlaydayForm(null,todayISO()));
    $$('[data-edit-pd-id]').forEach(b=>b.onclick=()=>openPlaydayForm(playdayById(b.dataset.editPdId)));
    $$('[data-delete-pd-id]').forEach(b=>b.onclick=()=>confirmAction('Speeldag verwijderen?','Alle deelnemers, wedstrijden, uitslagen en gekoppelde informatie worden definitief verwijderd.',()=>DB.deletePlayday(b.dataset.deletePdId)));
    $('[data-change-avatar]')?.addEventListener('click',()=>openAvatarForm());
    $$('[data-notification-settings]').forEach(b=>b.addEventListener('click',openNotificationSettings));
    $('[data-reset-statistics]')?.addEventListener('click',()=>confirmAction('Alle statistieken resetten?','Alle wedstrijden en uitslagen worden definitief verwijderd. Iedereen staat daarna weer op 0.',()=>DB.resetStatistics()));
    $('[data-full-reset]')?.addEventListener('click',openFullReset);
    $('[data-change-password]')?.addEventListener('click',()=>openPasswordModal(false));
    $('[data-logout]')?.addEventListener('click',async()=>{await DB.logout();showLogin();});
    $('#registrationCodeForm')?.addEventListener('submit',e=>{e.preventDefault();const code=new FormData(e.target).get('competition_code');run(()=>DB.updateRegistrationCode(code),'Competitiecode gewijzigd');});
    $('[data-reset-demo]')?.addEventListener('click',()=>confirmAction('Demo herstellen?','Alle lokale wijzigingen worden verwijderd.',()=>{DB.resetDemo();location.reload();}));
  }

  async function run(fn,success){ try{await fn();closeModal();toast(success);render();}catch(e){toast(e.message||'Er ging iets mis.',true);} }
  async function updateRsvp(response){
    const playdayId=state.selectedPlaydayId;
    if(!playdayId||state.pendingRsvp)return;
    state.rsvpOverrides[playdayId]=response;
    state.pendingRsvp={playdayId,response};
    render();
    try{
      const saved=await DB.setRsvp(playdayId,response);
      if(saved?.response!==response) throw new Error('Je keuze kon niet worden bevestigd. Probeer opnieuw.');
      state.pendingRsvp=null;
      toast(response==='playing'?'Status bijgewerkt: je speelt mee':'Status bijgewerkt: je speelt niet mee');
      render();
    }catch(e){
      state.pendingRsvp=null;
      delete state.rsvpOverrides[playdayId];
      toast(e.message||'Je keuze kon niet worden opgeslagen.',true);
      render();
    }
  }
  function confirmAction(title,text,fn){modal(title,`<p class="muted">${esc(text)}</p><div class="action-row"><button class="btn ghost" data-close-modal>Annuleren</button><button class="btn danger" id="confirmYes">Doorgaan</button></div>`,()=>{$('#confirmYes').onclick=()=>run(fn,'Opgeslagen');});}

  function openPlaydayForm(pd,date=todayISO()){
    pd=pd||DB.listPlaydays().find(item=>item.date===date)||null;
    const players=DB.listUsers().filter(u=>u.active),selected=pd?.host_id||current().id,timeEnabled=pd?.time_enabled!==false,locationEnabled=pd?.location_enabled!==false;
    modal(pd?'Speeldag wijzigen':'Speeldag aanmaken',`<form id="pdForm" class="compact-playday-form">
      <div class="compact-form-grid playday-top-grid"><label>Datum<input name="date" type="date" value="${esc(pd?.date||date)}" required></label><label>Host<select name="host_id" required>${players.map(u=>`<option value="${u.id}" ${u.id===selected?'selected':''}>${esc(u.display_name)}</option>`).join('')}</select></label></div>
      <section class="playday-form-section"><h3>Tijd en duur</h3><label class="feature-toggle"><input id="timeEnabled" name="time_enabled" type="checkbox" ${timeEnabled?'checked':''}><i aria-hidden="true"></i><span><b>Begin- en eindtijd gebruiken</b><small>Zet uit wanneer alleen de duur bekend is</small></span></label><div id="timeFields" class="compact-form-grid time-grid"><label class="time-only">Begin<input name="start_time" type="time" value="${esc(pd?.start_time||'19:00')}"></label><label class="time-only">Einde<input name="end_time" type="time" value="${esc(pd?.end_time||'21:00')}"></label></div><label class="duration-field">Duur in minuten <small>Mag ook zonder begin- en eindtijd</small><input name="duration_minutes" type="number" inputmode="numeric" min="1" max="1440" step="1" value="${esc(pd?.duration_minutes||'')}" placeholder="Bijvoorbeeld 90"></label></section>
      <section class="playday-form-section"><h3>Locatie</h3><label class="feature-toggle"><input id="locationEnabled" name="location_enabled" type="checkbox" ${locationEnabled?'checked':''}><i aria-hidden="true"></i><span><b>Locatie gebruiken</b><small>Zet uit wanneer de locatie niet van toepassing is</small></span></label><div id="locationFields"><label>Padelclub<input name="location" value="${esc(pd?.location||'')}" placeholder="Naam padelclub"></label></div></section>
      <section class="playday-form-section playday-settings-section"><div class="compact-form-grid playday-settings-grid"><label>Banen<input name="court_count" type="number" inputmode="numeric" min="1" max="20" value="${pd?.court_count||1}" required></label><label>Status<select name="status"><option value="planned" ${pd?.status==='planned'?'selected':''}>Gepland</option><option value="cancelled" ${pd?.status==='cancelled'?'selected':''}>Geannuleerd</option><option value="closed" ${pd?.status==='closed'?'selected':''}>Afgesloten</option></select></label></div><label>Tikkie-link <small>Optioneel</small><input name="tikkie_url" type="url" value="${esc(pd?.tikkie_url||'')}" placeholder="https://tikkie.me/pay/..."></label></section>
      <div class="form-footer"><button class="btn primary" type="submit">Opslaan</button>${pd?'<button class="btn danger" type="button" id="deletePd">Verwijderen</button>':''}</div>
    </form>`,()=>{
      $('.modal-card')?.classList.add('playday-form-modal');
      const sync=()=>{ $('#timeFields').classList.toggle('disabled',!$('#timeEnabled').checked); $('#locationFields').classList.toggle('disabled',!$('#locationEnabled').checked); }; $('#timeEnabled').onchange=sync;$('#locationEnabled').onchange=sync;sync();
      $('#pdForm [name="date"]').onchange=e=>{const existing=DB.listPlaydays().find(item=>item.date===e.target.value);if(existing&&existing.id!==pd?.id){toast('Bestaande speeldag geopend');openPlaydayForm(existing);}};
      const tikkieInput=$('#pdForm [name="tikkie_url"]');
      const extractUrl=value=>{const match=String(value||'').match(/https?:\/\/[^\s<>"']+/i);return match?match[0].replace(/[),.;!?]+$/,''):String(value||'').trim();};
      tikkieInput?.addEventListener('paste',event=>{const text=event.clipboardData?.getData('text')||'';const url=extractUrl(text);if(url&&url!==text.trim()){event.preventDefault();tikkieInput.value=url;toast('Alleen de Tikkie-link is geplakt');}});
      tikkieInput?.addEventListener('change',()=>{tikkieInput.value=extractUrl(tikkieInput.value);});
      $('#pdForm').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));const nextLink=String(f.tikkie_url||'').trim();const previousLink=String(pd?.tikkie_url||'').trim();const tikkieCreatedAt=!nextLink?null:(nextLink!==previousLink?todayISO():(pd?.tikkie_created_at||todayISO()));run(()=>DB.upsertPlayday({...f,tikkie_url:nextLink,tikkie_created_at:tikkieCreatedAt,id:pd?.id,court_count:Number(f.court_count),duration_minutes:f.duration_minutes?Number(f.duration_minutes):null,cost_per_player:pd?.cost_per_player??null,time_enabled:$('#timeEnabled').checked,location_enabled:$('#locationEnabled').checked}),'Speeldag opgeslagen');};
      $('#deletePd')?.addEventListener('click',()=>run(()=>DB.deletePlayday(pd.id),'Speeldag verwijderd'));
    });
  }

  function openManagePlaydayPlayer(userId='',currentPlacement=''){
    const pd=selectedPlayday();
    if(!pd||!isAdmin())return;
    const assigned=new Set(playdaySlots(pd.id).filter(s=>s.user_id).map(s=>s.user_id));
    const rsvpPlayers=new Set(DB.listRsvps(pd.id).filter(r=>r.response==='playing').map(r=>r.user_id));
    const editing=Boolean(userId);
    const candidates=DB.listUsers().filter(u=>u.active&&u.role!=='admin'&&(editing?u.id===userId:!assigned.has(u.id)&&!rsvpPlayers.has(u.id)));
    if(!candidates.length){toast(editing?'Speler niet gevonden.':'Alle actieve spelers staan al op deze speeldag.',true);return;}
    const selectedUser=userId||candidates[0].id;
    const placementOptions=Array.from({length:pd.court_count},(_,i)=>`<option value="court:${i+1}" ${String(currentPlacement)===String(i+1)?'selected':''}>Vaste plek · Baan ${i+1}</option>`).join('')+`<option value="reserve" ${currentPlacement==='reserve'?'selected':''}>Reservelijst</option>`;
    modal(editing?'Speler verplaatsen':'Speler toevoegen',`<form id="managePlaydayPlayerForm"><label>Speler<select name="user_id" ${editing?'disabled':''}>${candidates.map(u=>`<option value="${u.id}" ${u.id===selectedUser?'selected':''}>${esc(u.display_name)}</option>`).join('')}</select>${editing?`<input type="hidden" name="user_id" value="${selectedUser}">`:''}</label><label>Plaatsing<select name="placement">${placementOptions}</select></label><p class="muted">De speler krijgt automatisch de status Ik speel mee. Een vaste plek begint als Niet betaald.</p><button class="btn primary full" type="submit">${editing?'Verplaats speler':'Speler toevoegen'}</button></form>`,()=>{$('#managePlaydayPlayerForm').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));const reserve=f.placement==='reserve';const court=reserve?null:Number(String(f.placement).split(':')[1]);run(()=>DB.adminAssignPlaydayPlayer(pd.id,f.user_id,reserve?'reserve':'court',court),editing?'Speler verplaatst':'Speler toegevoegd');};});
  }

  function openAddUser(){ modal('Speler aanmaken',`<form id="userForm"><label>Naam<input name="display_name" required></label><label>Gebruikersnaam<input name="username" autocapitalize="none" required></label><label>Tijdelijk wachtwoord<input name="password" type="password" minlength="8" required></label>${avatarPicker(1,'avatar_id','Kies avatar')}<p class="muted">Bij de eerste login moet de speler zelf een nieuw wachtwoord kiezen.</p><button class="btn primary full" type="submit">Speler toevoegen</button></form>`,()=>{bindAvatarPickers($('#userForm'));$('#userForm').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));run(()=>DB.createUser(f),'Speler aangemaakt');};}); }
  function openEditUser(id){ const u=DB.listUsers().find(x=>x.id===id);modal('Speler bewerken',`<form id="editUser"><label>Naam<input name="display_name" value="${esc(u.display_name)}" required></label><label>Gebruikersnaam<input name="username" value="${esc(u.username)}" required></label><label><span>Toegang</span><select name="active"><option value="true" ${u.active?'selected':''}>Actief</option><option value="false" ${!u.active?'selected':''}>Geblokkeerd</option></select></label>${avatarPicker(u.avatar_id,'avatar_id','Avatar')}<button class="btn primary full">Opslaan</button></form>`,()=>{bindAvatarPickers($('#editUser'));$('#editUser').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));run(()=>DB.updateUser(id,{...f,active:f.active==='true',avatar_id:Number(f.avatar_id)}),'Speler bijgewerkt');};}); }


  function openFullReset(){
    modal('Testgegevens wissen / Opnieuw beginnen', `<form id="fullResetForm" class="form-grid destructive-reset-form"><div class="danger-panel full-span"><strong>Alles behalve jouw beheerderaccount wordt verwijderd</strong><p>Alle spelers, speeldagen, wedstrijden, uitslagen, statistieken, inschrijvingen, betaalstatussen, ruilverzoeken en beoordelingen verdwijnen definitief.</p></div><label class="full-span">Typ <b>RESETTEN</b> om door te gaan<input name="confirmation" autocomplete="off" spellcheck="false" placeholder="RESETTEN" required></label><button class="btn danger full-span" type="submit" disabled>Alles definitief wissen</button></form>`,()=>{
      const form=$('#fullResetForm'),input=form.elements.confirmation,button=form.querySelector('button[type="submit"]');
      const sync=()=>{button.disabled=String(input.value||'').trim().toUpperCase()!=='RESETTEN';};
      input.addEventListener('input',sync);sync();
      form.onsubmit=async e=>{e.preventDefault();if(button.disabled)return;button.disabled=true;button.textContent='Bezig met wissen…';try{await DB.fullReset();closeModal();toast('De app is volledig leeggemaakt');state.page='dashboard';state.playdayList=true;state.selectedPlaydayId=null;render();}catch(err){button.disabled=false;button.textContent='Alles definitief wissen';toast(err.message||'Volledige reset is mislukt.',true);}};
    });
  }

  function openResetUser(id){ const u=DB.listUsers().find(x=>x.id===id);modal(`Wachtwoord resetten`, `<form id="resetForm"><p>Nieuw tijdelijk wachtwoord voor <strong>${esc(u.display_name)}</strong>.</p><label>Tijdelijk wachtwoord<input name="password" type="password" minlength="8" required></label><p class="muted">De speler moet dit na de eerstvolgende login wijzigen.</p><button class="btn primary full">Wachtwoord instellen</button></form>`,()=>{$('#resetForm').onsubmit=e=>{e.preventDefault();run(()=>DB.adminResetPassword(id,new FormData(e.target).get('password')),'Wachtwoord gereset');};}); }
  function openAvatarForm(){ const me=current();modal('Avatar wijzigen',`<form id="avatarForm">${avatarPicker(me.avatar_id,'avatar_id','Kies je avatar')}<button class="btn primary full" type="submit">Avatar opslaan</button></form>`,()=>{bindAvatarPickers($('#avatarForm'));$('#avatarForm').onsubmit=e=>{e.preventDefault();run(()=>DB.saveAvatar(Number(new FormData(e.target).get('avatar_id'))),'Avatar gewijzigd');};}); }
  function openPasswordModal(required=false){ modal(required?'Maak je eigen wachtwoord':'Wachtwoord wijzigen',`<form id="pwForm"><label>Huidig wachtwoord<input name="old" type="password" required></label><label>Nieuw wachtwoord<input name="next" type="password" minlength="8" required></label><label>Nieuw wachtwoord herhalen<input name="repeat" type="password" minlength="8" required></label><button class="btn primary full">Wachtwoord wijzigen</button>${required?'<p class="muted">Dit is verplicht omdat je met een tijdelijk wachtwoord bent ingelogd.</p>':''}</form>`,()=>{if(required)$('[data-close-modal]')?.remove();$('#pwForm').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));if(f.next!==f.repeat){toast('De nieuwe wachtwoorden zijn niet gelijk.',true);return;}run(()=>DB.changePassword(f.old,f.next),'Wachtwoord gewijzigd');};}); }

  function openSwapRequest(){
    const pd=selectedPlayday(),mine=playdaySlots(pd.id).find(s=>s.user_id===current().id);if(!mine)return;
    const assigned=new Set(playdaySlots(pd.id).filter(s=>s.user_id).map(s=>s.user_id));
    const candidates=DB.listUsers().filter(u=>u.active&&u.id!==current().id&&!assigned.has(u.id));
    if(!candidates.length){toast('Er zijn geen beschikbare spelers om mee te ruilen.',true);return;}
    const reserves=new Set(reserveRsvps(pd.id).map(r=>r.user_id));
    modal('Ruilen',`<form id="swapForm"><p>Kies wie jouw plek op <strong>${esc(fmtDate(pd.date))}</strong> kan overnemen. De speler moet dit eerst bevestigen.</p><label>Vervanger<select name="to_user_id" required><option value="">Kies speler</option>${candidates.map(u=>`<option value="${u.id}">${esc(u.display_name)} · ${reserves.has(u.id)?'Reserve':'Doet nog niet mee'}</option>`).join('')}</select></label><button class="btn primary full">Ruilverzoek sturen</button></form>`,()=>{$('#swapForm').onsubmit=e=>{e.preventDefault();run(()=>DB.requestSwap(pd.id,new FormData(e.target).get('to_user_id')),'Ruilverzoek verstuurd');};});
  }
  function openPendingSwap(){
    const req=pendingSwapForMe();if(!req)return;const pd=playdayById(req.playday_id);
    modal('Ruilverzoek',`<div class="swap-request-detail"><p><strong>${esc(nameOf(req.from_user_id))}</strong> vraagt of jij de plek wilt overnemen.</p><dl><div><dt>Wanneer</dt><dd>${esc(fmtDate(pd.date))}${playdayTimeText(pd)?` · ${esc(playdayTimeText(pd))}`:''}</dd></div><div><dt>Locatie</dt><dd>${esc(playdayLocationText(pd))}</dd></div><div><dt>Baan</dt><dd>Baan ${req.court_number}</dd></div></dl><div class="action-row"><button class="btn danger" id="rejectSwap">Weigeren</button><button class="btn primary" id="acceptSwap">Accepteren</button></div></div>`,()=>{$('#rejectSwap').onclick=()=>run(()=>DB.respondSwap(req.id,false),'Ruilverzoek geweigerd');$('#acceptSwap').onclick=()=>run(()=>DB.respondSwap(req.id,true),'Ruil bevestigd');});
  }

  function openNewMatch(court){
    const pd=selectedPlayday();
    if(!isPlaydayToday(pd)){toast('Wedstrijden kunnen pas op de speeldag worden gemaakt.',true);return;}
    const selectedCourt=Number(court)||1;
    const courtPlayers=playdaySlots(pd.id).filter(s=>s.court_number===selectedCourt&&s.user_id).map(s=>userMap().get(s.user_id)).filter(Boolean);
    const allPlayers=[...new Map(playdaySlots(pd.id).filter(s=>s.user_id).map(s=>[s.user_id,userMap().get(s.user_id)])).values()].filter(Boolean);
    const players=courtPlayers.length>=4?courtPlayers:allPlayers;
    if(players.length<4){toast('Er zijn minimaal vier spelers nodig.',true);return;}
    const baseOptions=`<option value="">Kies speler</option>${players.map(u=>`<option value="${u.id}">${esc(u.display_name)}</option>`).join('')}`;
    const canAuto=courtPlayers.length===4;
    modal('Nieuwe wedstrijd',`<form id="matchForm" class="form-grid"><label>Baan<select name="court_number">${Array.from({length:pd.court_count},(_,i)=>`<option value="${i+1}" ${selectedCourt===i+1?'selected':''}>Baan ${i+1}</option>`).join('')}</select></label><button class="btn ghost" type="button" id="resetMatchPlayers">Spelers resetten</button><label>Blauw speler 1<select name="blue_player_1" required>${baseOptions}</select></label><label>Blauw speler 2<select name="blue_player_2" required>${baseOptions}</select></label><label>Rood speler 1<select name="red_player_1" required>${baseOptions}</select></label><label>Rood speler 2<select name="red_player_2" required>${baseOptions}</select></label><button class="btn primary full-span" type="submit">WEDSTRIJD MAKEN</button>${canAuto?'<button class="btn ghost full-span" type="button" id="createThreeMatches">Maak automatisch 3 wedstrijden</button>':''}</form>`,()=>{
      const form=$('#matchForm'),selects=$$('select[name*="player_"]',form);
      const sync=()=>{const chosen=new Set(selects.map(x=>x.value).filter(Boolean));selects.forEach(sel=>[...sel.options].forEach(o=>{o.disabled=Boolean(o.value&&o.value!==sel.value&&chosen.has(o.value));}));};
      selects.forEach(sel=>sel.onchange=sync); sync();
      $('#resetMatchPlayers').onclick=()=>{selects.forEach(x=>x.value='');sync();};
      form.onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(form));run(()=>DB.createMatch({...f,playday_id:pd.id,court_number:Number(f.court_number)}),'Wedstrijd aangemaakt');};
      $('#createThreeMatches')?.addEventListener('click',()=>confirmAction('Drie wedstrijden aanmaken?','Iedere speler speelt één keer samen met iedere andere speler.',()=>DB.createRoundRobinMatches(pd.id,selectedCourt,courtPlayers.map(x=>x.id))));
    });
  }

  function bindMatchPopup(){
    $$('[data-new-match]').forEach(b=>b.onclick=()=>openNewMatch(Number(b.dataset.court)||null));
    $$('[data-open-match]').forEach(b=>b.onclick=()=>openMatch(b.dataset.openMatch));
    $$('[data-start-match]').forEach(b=>b.onclick=()=>run(()=>DB.startMatch(b.dataset.startMatch),'Wedstrijd gestart'));
    $$('[data-manual-result]').forEach(b=>b.onclick=()=>openManualResult(b.dataset.manualResult));
    $$('[data-delete-match]').forEach(b=>b.onclick=()=>confirmAction('Wedstrijd verwijderen?','De uitslag verdwijnt uit de ranglijst.',()=>DB.deleteMatch(b.dataset.deleteMatch)));
    $('[data-live-toggle]')?.addEventListener('change',e=>changeLiveScoring(e.target.checked));
  }

  function openDayMatches(){
    const pd=selectedPlayday(); if(!pd||!isPlaydayToday(pd))return;
    const host=canHost(pd),users=userMap(),dayMatches=DB.listMatches(pd.id).filter(m=>!m.deleted_at),active=dayMatches.filter(m=>m.status==='active'&&m.started_at);
    const hostControls=host?`<section class="live-mode-panel"><div><strong>Live score</strong><small>${liveScoringEnabled(pd)?'Punt voor punt en commando’s':'Alleen einduitslag invullen'}</small></div><label class="inline-switch"><input type="checkbox" data-live-toggle ${liveScoringEnabled(pd)?'checked':''}><i></i></label></section><div class="section-title popup-match-title"><h3>Banen</h3><button class="btn primary small" data-new-match>+ Wedstrijd</button></div><div class="grid two">${Array.from({length:pd.court_count},(_,i)=>renderCourt(pd,i+1,active.find(m=>m.court_number===i+1))).join('')}</div>`:'';
    modal('Ready to play!',`${hostControls}<section class="popup-match-list"><div class="section-title"><h3>Wedstrijden (${dayMatches.length})</h3></div><div class="open-rows">${dayMatches.map(m=>renderMatchRow(m,users,host,pd)).join('')||'<div class="empty-state">Nog geen wedstrijden aangemaakt.</div>'}</div></section>`,bindMatchPopup);
  }

  function changeLiveScoring(enabled){
    const pd=selectedPlayday(),active=DB.listMatches(pd.id).some(m=>m.status==='active'&&m.started_at&&!m.deleted_at);
    const save=async()=>{try{await DB.setLiveScoring(pd.id,enabled);toast(enabled?'Live score ingeschakeld':'Live score uitgeschakeld');openDayMatches();}catch(e){toast(e.message||'Er ging iets mis.',true);openDayMatches();}};
    if(active){
      const text=enabled?'Live score wordt opnieuw gestart vanaf 0-0 voor actieve wedstrijden.':'De huidige live set wordt afgebroken. Na de wedstrijd vul je de volledige uitslag handmatig in.';
      confirmAction(enabled?'Live score inschakelen?':'Live score stoppen?',text,save);
    }else save();
  }

  function openManualResult(id){
    const m=getMatch(id);if(!m)return;
    modal(m.status==='finished'?'Uitslag wijzigen':'Uitslag invullen',`<form id="manualResultForm" class="manual-result-form"><div class="manual-team blue"><strong>${playerNameMarkup(m.blue_player_1)} & ${playerNameMarkup(m.blue_player_2)}</strong><input name="blue_games" type="number" inputmode="numeric" min="0" max="99" required placeholder="Games" value="${m.status==='finished'?Number(m.blue_games)||0:''}"></div><div class="manual-versus">—</div><div class="manual-team red"><strong>${playerNameMarkup(m.red_player_1)} & ${playerNameMarkup(m.red_player_2)}</strong><input name="red_games" type="number" inputmode="numeric" min="0" max="99" required placeholder="Games" value="${m.status==='finished'?Number(m.red_games)||0:''}"></div><button class="btn primary full">${m.status==='finished'?'Gewijzigde uitslag opslaan':'Uitslag opslaan'}</button></form>`,()=>{$('#manualResultForm').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));run(()=>DB.finishMatchManual(id,f.blue_games,f.red_games),m.status==='finished'?'Uitslag aangepast':'Uitslag opgeslagen');};});
  }

  function openMatch(id){ const m=DB.listMatches().find(x=>x.id===id); if(!m)return; const pd=playdayById(m.playday_id); if(!liveScoringEnabled(pd)){openManualResult(id);return;} state.activeMatchId=id; const d=S.display(m.score_state); modal(`Baan ${m.court_number}`,`<div class="score-control"><button class="score-button blue" id="scoreBlue"><span class="score-name">${playerNameMarkup(m.blue_player_1)} & ${playerNameMarkup(m.blue_player_2)}</span><span class="score-points">${d.bluePoints}</span><span class="score-games">${m.score_state.blueGames} games</span></button><button class="score-button red" id="scoreRed"><span class="score-name">${playerNameMarkup(m.red_player_1)} & ${playerNameMarkup(m.red_player_2)}</span><span class="score-points">${d.redPoints}</span><span class="score-games">${m.score_state.redGames} games</span></button></div><div class="match-toolbar"><button class="btn ghost" id="undoScore">↶ Undo</button><button class="btn ghost" id="speakScore">🔊 Stand</button><button class="btn ghost" id="toggleServe">🎾 Service</button><button class="btn primary" id="openXL">Volledig scherm</button><button class="btn danger" id="timeOver">Tijd voorbij</button></div><p class="muted" style="margin-top:12px">${m.score_state.tiebreak?'Tiebreak actief · ':''}${m.score_state.serverTeam==='blue'?'Blauw':'Rood'} serveert</p>`,()=>{
      $('#scoreBlue').onclick=()=>point(id,'blue',false); $('#scoreRed').onclick=()=>point(id,'red',false); $('#undoScore').onclick=()=>updateScore(id,S.undo(getMatch(id).score_state),false); $('#speakScore').onclick=()=>speakMatch(getMatch(id)); $('#toggleServe').onclick=()=>updateScore(id,S.switchServer(getMatch(id).score_state),false); $('#openXL').onclick=()=>{closeModal();openScoreboard(id);}; $('#timeOver').onclick=()=>finishTimeOver(id);
    }); }
  function getMatch(id){ return DB.listMatches().find(x=>x.id===id); }
  function point(id,team,xl){ const m=getMatch(id); if(!m||m.status!=='active')return; const score=S.addPoint(m.score_state,team); DB.updateMatchScore(id,score).catch(e=>toast(e.message,true)); beep(); if(score.complete){speak(`${team==='blue'?'Blauw':'Rood'} wint de set. ${score.blueGames} tegen ${score.redGames}.`); finishComplete(id,score); return;} speakMatch(getMatch(id)); if(xl)updateScoreboard(); else openMatch(id); }
  function updateScore(id,score,xl){ try{DB.updateMatchScore(id,score).catch(e=>toast(e.message,true));if(xl)updateScoreboard();else openMatch(id);}catch(e){toast(e.message,true);} }
  async function finishComplete(id,score){ try{const p=S.completedPayload(score);await DB.finishMatch(id,p);closeScoreboard();closeModal();toast(`Set klaar: ${score.blueGames}-${score.redGames}`);render();}catch(e){toast(e.message,true);} }
  function finishTimeOver(id){ const m=getMatch(id);if(!m)return;confirmAction('Tijd voorbij?','Alleen afgeronde games tellen. De huidige puntenstand wordt alleen in de historie bewaard.',()=>{DB.finishMatch(id,S.timeOverPayload(m.score_state));closeScoreboard();}); }

  function openScoreboard(id,readOnly=false){ state.scoreboardMatchId=id;state.scoreboardReadOnly=readOnly; const ov=$('#scoreboardOverlay');ov.classList.remove('hidden');ov.classList.toggle('spectator',readOnly);ov.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';requestFullscreen();requestWakeLock();updateScoreboard();startTimer();if(!readOnly)scheduleControlsHide(); }
  function closeScoreboard(){ const ov=$('#scoreboardOverlay');ov.classList.add('hidden');ov.setAttribute('aria-hidden','true');document.body.style.overflow='';clearInterval(state.timer);state.timer=null;state.wakeLock?.release?.().catch(()=>{});state.wakeLock=null;if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});state.scoreboardMatchId=null;state.scoreboardReadOnly=false;ov.classList.remove('spectator');stopVoice();render(); }
  function updateScoreboard(){ const m=getMatch(state.scoreboardMatchId);if(!m)return;const d=S.display(m.score_state);$('#xlBlueNames').textContent=`${nameOf(m.blue_player_1)} / ${nameOf(m.blue_player_2)}`;$('#xlRedNames').textContent=`${nameOf(m.red_player_1)} / ${nameOf(m.red_player_2)}`;$('#xlBluePoints').textContent=d.bluePoints;$('#xlRedPoints').textContent=d.redPoints;$('#xlBlueGames').textContent=m.score_state.blueGames;$('#xlRedGames').textContent=m.score_state.redGames;$('#xlServe').textContent=`🎾 ${m.score_state.serverTeam==='blue'?'Blauw':'Rood'} serveert`; }
  function startTimer(){ clearInterval(state.timer); const tick=()=>{const m=getMatch(state.scoreboardMatchId);if(!m)return;const sec=Math.max(0,Math.floor((nowMs()-new Date(m.started_at).getTime())/1000));$('#xlTimer').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;};tick();state.timer=setInterval(tick,1000); }
  async function requestFullscreen(){ try{await document.documentElement.requestFullscreen?.(); await screen.orientation?.lock?.('landscape');}catch{} }
  async function requestWakeLock(){ try{state.wakeLock=await navigator.wakeLock?.request?.('screen');}catch{} }
  function scheduleControlsHide(){ clearTimeout(state.controlsTimer);$('#scoreboardOverlay').classList.remove('controls-hidden');state.controlsTimer=setTimeout(()=>$('#scoreboardOverlay').classList.add('controls-hidden'),4500); }

  function beep(){ try{const A=window.AudioContext||window.webkitAudioContext;const c=new A(),o=c.createOscillator(),g=c.createGain();o.frequency.value=880;g.gain.setValueAtTime(.18,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.11);o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.12);}catch{} }
  function speak(text){ if(!('speechSynthesis'in window))return; speechSynthesis.cancel(); const utter=new SpeechSynthesisUtterance(text);utter.lang='nl-NL';utter.volume=1;utter.rate=.82;utter.pitch=1; speechSynthesis.speak(utter); }
  function speakMatch(m){ const d=S.display(m.score_state); const server=m.score_state.serverTeam==='blue'?'blauw':'rood'; const phrase=`De stand is ${m.score_state.blueGames} tegen ${m.score_state.redGames} in games. ${d.bluePoints} tegen ${d.redPoints}. ${server} serveert.`; beep();setTimeout(()=>speak(`${phrase} ${phrase}`),130); }
  function startVoice(){ const R=window.SpeechRecognition||window.webkitSpeechRecognition;if(!R){toast('Spraakherkenning wordt hier niet ondersteund.',true);return;}stopVoice();const r=new R();r.lang='nl-NL';r.continuous=true;r.interimResults=false;r.onresult=e=>{const text=e.results[e.results.length-1][0].transcript.toLowerCase();handleVoice(text);};r.onerror=e=>{if(e.error!=='no-speech')toast(`Spraak: ${e.error}`,true);};r.onend=()=>{if(state.scoreboardMatchId&&state.recognition===r)try{r.start();}catch{}};state.recognition=r;try{r.start();toast('Spraakbediening staat aan');}catch{} }
  function stopVoice(){try{state.recognition?.stop();}catch{}state.recognition=null;}
  function handleVoice(text){ if(/punt (voor )?blauw|blauwe punt/.test(text))point(state.scoreboardMatchId,'blue',true);else if(/punt (voor )?rood|rode punt/.test(text))point(state.scoreboardMatchId,'red',true);else if(/stand|score/.test(text))speakMatch(getMatch(state.scoreboardMatchId));else if(/undo|ongedaan|terug/.test(text))updateScore(state.scoreboardMatchId,S.undo(getMatch(state.scoreboardMatchId).score_state),true);else if(/service|serveer/.test(text))updateScore(state.scoreboardMatchId,S.switchServer(getMatch(state.scoreboardMatchId).score_state),true); }

  function reviewSession(decision){ if(decision==='approve')run(()=>DB.reviewSession(state.selectedPlaydayId,'approve'),'Sessie goedgekeurd'); else modal('Sessie afkeuren',`<form id="rejectForm"><p>Je keurt de volledige speeldag af. Schrijf kort wat niet klopt.</p><label>Toelichting<textarea name="note" rows="4" required></textarea></label><button class="btn danger full">Afkeuren</button></form>`,()=>{$('#rejectForm').onsubmit=e=>{e.preventDefault();run(()=>DB.reviewSession(state.selectedPlaydayId,'reject',new FormData(e.target).get('note')),'Afkeuring opgeslagen');};}); }
  function openPlayer(id){
    const u=DB.listUsers().find(x=>x.id===id),s=statsFor(id),ordered=S.aggregate(DB.listUsers().filter(x=>x.active),matches()),rank=ordered.findIndex(x=>x.id===id)+1;
    modal(u?.display_name||'Speler',`<section class="player-popup-head"><div><strong class="avatar-name">${esc(u?.display_name||'Speler')}${avatarMarkup(u)}</strong><span>Ranking #${rank||'–'} · ${s.points} punten</span></div></section><div class="personal-detail-strip popup-stats"><span><small>Winst-verlies</small><b>${s.wins}-${s.losses}</b></span><span><small>Winst %</small><b>${s.winPct}%</b></span><span><small>Sets</small><b>${s.setsWon}-${s.setsLost}</b></span><span><small>Games</small><b>${s.gamesWon}-${s.gamesLost}</b></span></div><div class="popup-form"><span>Laatste vijf</span><i class="form-line">${s.recent.map(x=>`<em class="${x==='W'?'win':x==='V'?'loss':'draw'}">${x}</em>`).join('')||'<em>–</em>'}</i><b>Gamesaldo ${s.gameDiff>0?'+':''}${s.gameDiff}</b></div><div class="popup-actions"><button class="btn primary" id="playerHistory">Bekijk historie</button><button class="btn ghost" id="playerUpcoming">Komende speeldagen</button></div>`,()=>{$('#playerHistory').onclick=()=>openPlayerHistory(id);$('#playerUpcoming').onclick=()=>openPlayerUpcoming(id);});
  }
  function openPlayerHistory(id){
    const pds=new Map(DB.listPlaydays().map(p=>[p.id,p])),grouped=new Map();
    finishedMatchesFor(id).forEach(m=>{if(!grouped.has(m.playday_id))grouped.set(m.playday_id,[]);grouped.get(m.playday_id).push(m);});
    const days=[...grouped.entries()].map(([pdId,ms])=>({pd:pds.get(pdId),ms})).filter(x=>x.pd).sort((a,b)=>b.pd.date.localeCompare(a.pd.date));
    modal(`Historie van ${nameOf(id)}`,`<div class="modal-open-list">${days.map(({pd,ms})=>`<button class="open-action" data-modal-history="${pd.id}"><span><strong>${esc(fmtDate(pd.date))}</strong><small>${playdayLocationText(pd)?`${esc(playdayLocationText(pd))} · `:''}${ms.length} wedstrijd${ms.length===1?'':'en'}</small></span><b>›</b></button>`).join('')||'<div class="empty-state">Nog geen historie.</div>'}</div>`,()=>{$$('[data-modal-history]').forEach(b=>b.onclick=()=>openPersonalHistory(b.dataset.modalHistory,id));});
  }
  function openPlayerUpcoming(id){
    const ids=new Set(DB.listRsvps().filter(r=>r.user_id===id&&r.response==='playing').map(r=>r.playday_id));
    const days=DB.listPlaydays().filter(p=>p.date>=todayISO()&&p.status!=='cancelled'&&ids.has(p.id)).sort((a,b)=>a.date.localeCompare(b.date));
    modal(`Komende speeldagen van ${nameOf(id)}`,`<div class="modal-open-list">${days.map(p=>`<div class="open-action static">${fmtDayBadge(p.date)}<span><strong>${esc(playdayLocationText(p)||'Speeldag')}</strong>${playdayTimeText(p)?`<small>${esc(playdayTimeText(p))}</small>`:''}</span></div>`).join('')||'<div class="empty-state">Niet aangemeld voor komende speeldagen.</div>'}</div>`);
  }
  function openPersonalHistory(playdayId,userId){
    const pd=playdayById(playdayId),ms=finishedMatchesFor(userId).filter(m=>m.playday_id===playdayId).sort((a,b)=>Number(a.court_number)-Number(b.court_number));
    modal(`${nameOf(userId)} · ${pd?fmtShort(pd.date):'Historie'}`,`${playdayLocationText(pd)?`<p class="muted">${esc(playdayLocationText(pd))}</p>`:''}<div class="personal-match-list">${ms.map(m=>{const blue=m.blue_player_1===userId||m.blue_player_2===userId,team=blue?'blue':'red',partner=nameOf((blue?[m.blue_player_1,m.blue_player_2]:[m.red_player_1,m.red_player_2]).find(x=>x!==userId)),opponents=(blue?[m.red_player_1,m.red_player_2]:[m.blue_player_1,m.blue_player_2]).map(nameOf).join(' & '),won=m.set_completed&&m.winner_team===team,pts=S.awardedPoints(m,team);return `<article class="personal-match-row"><div><span class="result-mark ${won?'win':'loss'}">${won?'W':'—'}</span><strong>Met ${esc(partner)}</strong><small>Tegen ${esc(opponents)} · baan ${m.court_number}</small></div><div><b>${blue?m.blue_games:m.red_games}-${blue?m.red_games:m.blue_games}</b><small>+${pts} pt</small></div></article>`}).join('')||'<div class="empty-state">Geen wedstrijden gevonden.</div>'}</div>`);
  }
  function openMatchInfo(id){ const m=getMatch(id), pd=playdayById(m.playday_id);modal('Wedstrijddetails',`<p><strong>${playerNameMarkup(m.blue_player_1)} & ${playerNameMarkup(m.blue_player_2)}</strong></p><h2>${m.blue_games} — ${m.red_games}</h2><p><strong>${playerNameMarkup(m.red_player_1)} & ${playerNameMarkup(m.red_player_2)}</strong></p><p class="muted">${pd?fmtDate(pd.date):''} · baan ${m.court_number}<br>${m.set_completed?'Volledige set':'Tijd voorbij'}${m.timed_out?` · onafgemaakte game: ${esc(m.point_snapshot?.blue)}-${esc(m.point_snapshot?.red)}`:''}<br>Punten: blauw ${S.awardedPoints(m,'blue')}, rood ${S.awardedPoints(m,'red')}</p>`); }
  function openProfile(){ const me=current();modal('Mijn profiel',`<div class="list"><div class="list-row"><div class="list-main"><strong class="avatar-name">${esc(me.display_name)}${avatarMarkup(me)}</strong><span>@${esc(me.username)} · ${me.role==='admin'?'beheerder':'speler'}</span></div></div></div><div class="action-row" style="margin-top:14px"><button class="btn ghost" id="changePw">Wachtwoord wijzigen</button><button class="btn danger" id="logoutBtn">Uitloggen</button></div>`,()=>{$('#changePw').onclick=()=>openPasswordModal(false);$('#logoutBtn').onclick=async()=>{await DB.logout();closeModal();showLogin();};}); }

  function bindGlobal(){
    window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;});
    window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;localStorage.setItem('wepadel-install-dismissed','1');setTimeout(maybeShowNotificationOnboarding,500);});
    $('#registerAvatarPicker').innerHTML=avatarPicker(1,'avatar_id','Kies je avatar');
    bindAvatarPickers($('#registerAvatarPicker'));
    $('#loginForm').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button[type=submit]');button.disabled=true;button.textContent='Inloggen…';try{await DB.login($('#loginUsername').value,$('#loginPassword').value);await showPostLoginSplash();}catch(err){toast(err.message,true);}finally{button.disabled=false;button.textContent='Inloggen';}};
    $('#showRegister').onclick=()=>{$('#loginPanel').classList.add('hidden');$('#registerPanel').classList.remove('hidden');};
    $('#showLogin').onclick=()=>{$('#registerPanel').classList.add('hidden');$('#loginPanel').classList.remove('hidden');};
    $('#registerForm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));if(f.password!==f.password_repeat){toast('De wachtwoorden zijn niet gelijk.',true);return;}const button=e.target.querySelector('button[type=submit]');button.disabled=true;button.textContent='Versturen…';try{await DB.register(f);e.target.reset();$('#registerPanel').classList.add('hidden');$('#loginPanel').classList.remove('hidden');modal('Aanmelding ontvangen','<div class="registration-success"><span>✓</span><h3>Je account is aangemaakt</h3><p>De beheerder moet je account nog goedkeuren. Daarna kun je met je gekozen gebruikersnaam en wachtwoord inloggen.</p><button class="btn primary full" data-close-modal>Begrepen</button></div>');}catch(err){toast(err.message,true);}finally{button.disabled=false;button.textContent='Aanmelding versturen';}};
    const bottomNav=$('#bottomNav');
    bottomNav.addEventListener('click',event=>{
      const button=event.target.closest('button[data-page]');
      if(!button||!bottomNav.contains(button))return;
      event.preventDefault();
      event.stopPropagation();
      navigate(button.dataset.page);
    },true);
    $('#exitScoreboard').onclick=closeScoreboard; $('#xlBlueAdd').onclick=e=>{e.stopPropagation();point(state.scoreboardMatchId,'blue',true);scheduleControlsHide();}; $('#xlRedAdd').onclick=e=>{e.stopPropagation();point(state.scoreboardMatchId,'red',true);scheduleControlsHide();}; $('#xlUndo').onclick=e=>{e.stopPropagation();updateScore(state.scoreboardMatchId,S.undo(getMatch(state.scoreboardMatchId).score_state),true);scheduleControlsHide();}; $('#xlSpeak').onclick=e=>{e.stopPropagation();speakMatch(getMatch(state.scoreboardMatchId));scheduleControlsHide();}; $('#xlVoice').onclick=e=>{e.stopPropagation();state.recognition?stopVoice():startVoice();scheduleControlsHide();}; $('#xlServeToggle').onclick=e=>{e.stopPropagation();updateScore(state.scoreboardMatchId,S.switchServer(getMatch(state.scoreboardMatchId).score_state),true);scheduleControlsHide();}; $('#xlTimeOver').onclick=e=>{e.stopPropagation();finishTimeOver(state.scoreboardMatchId);}; $('#scoreboardOverlay').onclick=()=>scheduleControlsHide();
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.scoreboardMatchId)requestWakeLock();});
    window.addEventListener('padelscore:data-changed',()=>{if(current()){render();updateActionBadges();scheduleNotificationSync();if(state.scoreboardMatchId)updateScoreboard();}});
    let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(current()&&!state.scoreboardMatchId)render();},120);});
  }

  async function boot(){ bindGlobal(); if('serviceWorker'in navigator){try{const reg=await navigator.serviceWorker.register('./service-worker.js?v=3.14.0',{updateViaCache:'none'});await reg.update();if(reg.waiting)reg.waiting.postMessage('SKIP_WAITING');navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!sessionStorage.getItem('wepadel-sw-3140')){sessionStorage.setItem('wepadel-sw-3140','1');location.reload();}});}catch{}} try{await DB.init();}catch(e){toast(e.message||'Online verbinding mislukt.',true);} if(current())showApp();else showLogin(); }
  boot();
})();
