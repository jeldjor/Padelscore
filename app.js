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

  const state = { page:'dashboard', year:new Date().getFullYear(), month:new Date().getMonth(), playdayView:'calendar', playdayFilter:'all', playdayList:true, selectedCalendarDate:null, playdayPage:0, historyPage:0, adminPage:0, selectedPlaydayId:null, activeMatchId:null, scoreboardMatchId:null, wakeLock:null, timer:null, controlsTimer:null, recognition:null, adminTab:'requests', scoreboardReadOnly:false };

  function toast(message, error=false){ const el=$('#toast'); el.textContent=message; el.className=`toast show${error?' error':''}`; clearTimeout(el._t); el._t=setTimeout(()=>el.className='toast',2600); }
  function modal(title, body, onOpen){ $('#modalRoot').innerHTML=`<div class="modal-backdrop"><section class="modal-card"><div class="modal-head"><h2>${esc(title)}</h2><button class="close-btn" data-close-modal>✕</button></div>${body}</section></div>`; $$('[data-close-modal]').forEach(b=>b.onclick=closeModal); onOpen?.(); }
  function closeModal(){ $('#modalRoot').innerHTML=''; }
  function userMap(){ return new Map(DB.listUsers().map(u=>[u.id,u])); }
  function nameOf(id){ return userMap().get(id)?.display_name || 'Onbekend'; }
  function avatarNumber(userOrId){ const user=typeof userOrId==='string'?userMap().get(userOrId):userOrId; const value=Number(user?.avatar_id); return Number.isInteger(value)&&value>=1&&value<=50?value:1; }
  function avatarMarkup(userOrId,variant='inline'){ const n=avatarNumber(userOrId),col=(n-1)%10,row=Math.floor((n-1)/10),x=(col/9*100).toFixed(4),y=(row/4*100).toFixed(4); return `<span class="avatar-sprite ${variant}" aria-hidden="true" style="background-position:${x}% ${y}%"></span>`; }
  function playerNameMarkup(id){ return `<span class="avatar-name">${avatarMarkup(id)}${esc(nameOf(id))}</span>`; }
  function avatarPicker(value=1,name='avatar_id',label='Kies je avatar'){ const selected=Math.max(1,Math.min(50,Number(value)||1)); return `<fieldset class="avatar-fieldset"><legend>${esc(label)}</legend><input type="hidden" name="${esc(name)}" value="${selected}"><div class="avatar-picker">${Array.from({length:50},(_,i)=>{const n=i+1;return `<button type="button" class="avatar-option ${n===selected?'selected':''}" data-avatar-choice="${n}" aria-label="Avatar ${n}, ${n<=25?'held':'schurk'}">${avatarMarkup({avatar_id:n},'picker')}</button>`;}).join('')}</div></fieldset>`; }
  function bindAvatarPickers(root=document){ $('[data-avatar-choice]',root).forEach(button=>button.onclick=()=>{const field=button.closest('.avatar-fieldset');if(!field)return;field.querySelector('input[type="hidden"]').value=button.dataset.avatarChoice;$('[data-avatar-choice]',field).forEach(x=>x.classList.toggle('selected',x===button));}); }
  function playdayTimeText(p){ return p?.time_enabled===false?'':`${fmtTime(p?.start_time)} - ${fmtTime(p?.end_time)}`; }
  function playdayLocationText(p){ return p?.location_enabled===false?'':String(p?.location||'Locatie volgt'); }
  function current(){ return DB.current(); }
  function isAdmin(){ return current()?.role==='admin'; }
  function canHost(pd){ return DB.canHost(pd); }
  function statusLabel(s){ return ({absent:'Niet aanwezig',present:'Aanwezig',ready:'Ready',playing:'Speelt',done:'Klaar'})[s]||s; }
  function statusClass(s){ return ({absent:'status-absent',present:'status-present',ready:'status-ready',playing:'status-playing',done:'status-done'})[s]||'status-absent'; }
  function rsvpLabel(r){ return ({playing:'Ik speel mee',not_playing:'Ik kan niet'})[r]||'Nog niet gereageerd'; }
  function playdayById(id){ return DB.listPlaydays().find(p=>p.id===id); }
  function matches(){ return DB.listMatches(); }
  function selectedPlayday(){ if(state.selectedPlaydayId) return playdayById(state.selectedPlaydayId); const t=todayISO(); return DB.listPlaydays().find(p=>p.date===t) || DB.listPlaydays().find(p=>p.date>=t) || DB.listPlaydays().at(-1); }
  function participants(pdId){ const users=userMap(); return DB.listAttendance(pdId).map(a=>({...a,user:users.get(a.user_id)})).filter(x=>x.user); }
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

  function showApp(){ $('#postLoginSplash').classList.add('hidden'); $('#postLoginSplash').setAttribute('aria-hidden','true'); $('#loginScreen').classList.add('hidden'); $('#appShell').classList.remove('hidden'); $('#accountNavLabel').textContent=isAdmin()?'Beheer':'Account'; if(current()?.must_change_password) openPasswordModal(true); render(); }
  function showLogin(){ $('#postLoginSplash').classList.add('hidden'); $('#appShell').classList.add('hidden'); $('#loginScreen').classList.remove('hidden'); }
  async function showPostLoginSplash(){
    $('#loginScreen').classList.add('hidden');
    $('#appShell').classList.add('hidden');
    const splash=$('#postLoginSplash');
    splash.classList.remove('hidden');
    splash.setAttribute('aria-hidden','false');
    await new Promise(resolve=>setTimeout(resolve,1250));
    showApp();
  }
  function navigate(page){ state.page=page; if(page==='playday'&&!state.selectedPlaydayId) state.playdayList=true; $$('#bottomNav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page)); render(); }
  function render(){ const main=$('#mainContent'); if(!current()){showLogin();return;} const pages={dashboard:renderDashboard,playday:renderPlayday,ranking:renderRanking,history:renderHistory,account:renderAccount}; main.className=`main-content page-${state.page}${state.page==='playday'&&!state.playdayList?' page-playday-detail':''}`; main.innerHTML=(pages[state.page]||renderDashboard)(); bindPage(); }


  function uiHeader(title, subtitle, action=''){
    return `<div class="ui-header">${action?`<div class="ui-header-action">${action}</div>`:''}<div class="ui-header-main"><div><h1>${title}</h1>${subtitle?`<p>${subtitle}</p>`:""}</div></div></div>`;
  }
  function pageSize(reserved=390,rowHeight=72,min=3,max=7){ return Math.max(min,Math.min(max,Math.floor((window.innerHeight-reserved)/rowHeight))); }
  function paged(items,pageKey,size){ const pages=Math.max(1,Math.ceil(items.length/size)); state[pageKey]=Math.min(Math.max(0,state[pageKey]),pages-1); const start=state[pageKey]*size; return {rows:items.slice(start,start+size),page:state[pageKey],pages}; }
  function pager(meta,pageKey){ if(meta.pages<=1)return''; return `<nav class="pager" aria-label="Pagina's"><button data-page-step="-1" data-page-key="${pageKey}" ${meta.page===0?'disabled':''}>‹ Vorige</button><span>${meta.page+1} / ${meta.pages}</span><button data-page-step="1" data-page-key="${pageKey}" ${meta.page===meta.pages-1?'disabled':''}>Volgende ›</button></nav>`; }
  function dashboardLimit(){ return window.innerHeight>=800?3:window.innerHeight>=700?2:1; }
  function fmtDayBadge(date){ const d=new Date(date+'T12:00:00'); const wk=new Intl.DateTimeFormat('nl-NL',{weekday:'short'}).format(d); const mo=new Intl.DateTimeFormat('nl-NL',{month:'short'}).format(d); return `<span class="date-box"><b>${esc(wk).slice(0,2).toUpperCase()}</b><strong>${d.getDate()}</strong><small>${esc(mo).toLowerCase()}</small></span>`; }
  function rsvpStatus(playdayId){ const me=current(); const mine=DB.listRsvps(playdayId).find(r=>r.user_id===me.id); return mine?.response||''; }
  function playerCount(playdayId){ return DB.listRsvps(playdayId).filter(r=>r.response==='playing').length; }
  function needForNextCourt(count){ return (4-(count%4))%4; }
  function playdayStatusText(p, mode='list'){
    const n=playerCount(p.id), need=needForNextCourt(n), mine=rsvpStatus(p.id), cap=Math.max(4,p.court_count*4);
    if(mode==='calendar') return `${n}/${cap} spelers`;
    if(mode==='dashboard') return mine==='playing'?'Ingeschreven':(mine==='not_playing'?'Ik kan niet':'Nog geen reactie');
    if(mine==='playing') return 'Ingeschreven';
    if(mine==='not_playing') return 'Ik kan niet';
    if(n>0 && need===0) return 'Baan compleet';
    return `${n} spelers · nog ${need||4} nodig`;
  }
  function playdayRow(p, statusOverride=''){
    const status=statusOverride||playdayStatusText(p),time=playdayTimeText(p),place=playdayLocationText(p);
    return `<button class="event-row luxe" data-open-playday="${p.id}">${fmtDayBadge(p.date)}<span class="event-main"><b>${esc(time||'Speeldag')}</b>${place?`<strong>${esc(place)}</strong>`:''}</span><span class="event-status pill ${/compleet|ingeschreven/i.test(status)?'ok':/niet/i.test(status)?'no':'wait'}">${status}</span><span class="chev">›</span></button>`;
  }

  function renderDashboard(){
    const me=current(), pds=DB.listPlaydays().filter(p=>p.status!=='cancelled'), today=todayISO();
    const rows=S.aggregate(DB.listUsers().filter(u=>u.active),matches()), mine=statsFor(me.id);
    const rank=rows.findIndex(r=>r.id===me.id)+1;
    const myIds=new Set(DB.listRsvps().filter(r=>r.user_id===me.id&&r.response==='playing').map(r=>r.playday_id));
    const limit=dashboardLimit();
    const mineDays=pds.filter(p=>p.date>=today&&myIds.has(p.id)).slice(0,limit);
    const recent=finishedMatchesFor(me.id).sort((a,b)=>new Date(b.ended_at||b.started_at)-new Date(a.ended_at||a.started_at)).slice(0,limit);
    return `<div class="dashboard-greeting"><h1>Goedemiddag</h1><strong class="avatar-name">${avatarMarkup(me)}${esc(me.display_name)}</strong></div>
      <div class="stats-compact-grid dashboard-kpis flat-kpis">
        <section class="stat-compact icon ranking"><span>Ranking</span><strong>#${rank||'–'}</strong><small>Huidige positie</small></section>
        <section class="stat-compact icon points"><span>Punten</span><strong>${mine.points}</strong><small>Totaal verdiend</small></section>
        <section class="stat-compact icon played"><span>Gespeeld</span><strong>${mine.played}</strong><small>Wedstrijden</small></section>
        <section class="stat-compact icon win"><span>Winst %</span><strong>${mine.winPct}%</strong><small>Gewonnen wedstrijden</small></section>
      </div>
      <section class="section-block luxe-block"><div class="section-title"><h2>MIJN VOLGENDE SPEELDAGEN</h2><button data-go="playday">Bekijk allemaal</button></div>
        <div class="event-list">${mineDays.map(p=>playdayRow(p,'Ingeschreven')).join('')||'<div class="empty-state">Je bent nog niet ingeschreven voor een komende speeldag.</div>'}</div>
      </section>
      <section class="section-block luxe-block"><div class="section-title"><h2>LAATSTE UITSLAGEN</h2><button data-go="history">Historie</button></div>
        <div class="dashboard-results">${recent.map(m=>{const pd=playdayById(m.playday_id);const side=(m.blue_player_1===me.id||m.blue_player_2===me.id)?'blue':'red';return `<button class="dashboard-result-row" data-match-info="${m.id}"><span class="result-date">${esc(new Intl.DateTimeFormat('nl-NL',{weekday:'short',day:'numeric',month:'short'}).format(new Date(`${pd?.date||today}T12:00:00`)))}</span><strong>${m.blue_games} - ${m.red_games}</strong><small>${esc(pd?.location||'Locatie volgt')}</small><b>+${S.awardedPoints(m,side)} pt</b></button>`;}).join('')||'<div class="empty-state compact-empty">Nog geen uitslag.</div>'}</div>
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
    return `<section class="month single luxe-month"><div class="weekdays"><span>MA</span><span>DI</span><span>WO</span><span>DO</span><span>VR</span><span>ZA</span><span>ZO</span></div><div class="days">${cells}</div><div class="calendar-status-legend"><span><i class="open"></i>Open</span><span><i class="yes"></i>Ik speel mee</span><span><i class="no"></i>Ik kan niet</span></div></section>`;
  }
  function renderPlayday(){
    if(state.playdayList){
      const pds=DB.listPlaydays().filter(p=>p.status!=='cancelled').sort((a,b)=>a.date.localeCompare(b.date)||a.start_time.localeCompare(b.start_time));
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
    const me=current(), users=userMap(), rv=DB.listRsvps(pd.id).find(r=>r.user_id===me.id), at=DB.listAttendance(pd.id).find(a=>a.user_id===me.id), host=canHost(pd), all=DB.listRsvps(pd.id).filter(r=>r.response==='playing');
    const dayMatches=DB.listMatches(pd.id).filter(m=>!m.deleted_at), active=dayMatches.filter(m=>m.status==='active'), reviews=DB.listReviews(pd.id), myReview=reviews.find(r=>r.user_id===me.id), attendance=participants(pd.id);
    const need=needForNextCourt(all.length), complete=all.length>0&&need===0, lobbyAllowed=host||rv?.response==='playing'||at;
    const lobbyBox=lobbyAllowed?`<section class="flat-section"><div class="section-title"><div><h2>Lobby</h2><p class="muted">Eén keer READY voor de hele speeldag.</p></div>${at?`<span class="badge ${at.status==='ready'?'green':'yellow'}">${esc(statusLabel(at.status))}</span>`:''}</div>${!at?'<button class="btn primary full" data-enter-lobby>Lobby binnengaan</button>':at.status==='present'?'<button class="btn primary full" data-ready>Ik ben READY</button>':`<p class="muted">Je blijft ${esc(statusLabel(at.status))} tot de host je status verandert.</p>`}<div class="open-rows">${attendance.map(x=>`<div class="open-row"><span class="status-dot ${statusClass(x.status)}"></span><strong class="avatar-name">${avatarMarkup(x.user)}${esc(x.user.display_name)}</strong><small>${esc(statusLabel(x.status))}</small></div>`).join('')||'<div class="empty-state">Nog niemand in de lobby.</div>'}</div></section>`:'';
    const hostPanel=host&&!['review','host_review','approved'].includes(pd.session_status)?`<section class="flat-section"><div class="section-title"><div><h2>Banen beheren</h2><p class="muted">${pd.court_count} ${pd.court_count===1?'baan':'banen'} beschikbaar</p></div><button class="btn primary small" data-new-match>+ Wedstrijd</button></div><div class="grid two">${Array.from({length:pd.court_count},(_,i)=>renderCourt(pd,i+1,active.find(m=>m.court_number===i+1),users)).join('')}</div>${dayMatches.length&&!active.length?'<button class="btn danger full session-end" data-end-session>Speeldag afsluiten</button>':''}</section>`:'';
    const livePanel=!host&&active.length?`<section class="flat-section"><div class="section-title"><h2>Live op de banen</h2><span class="badge green">Live</span></div><div class="grid two">${active.map(renderSpectatorCourt).join('')}</div></section>`:'';
    return `<button class="detail-back" data-back-list>‹</button>${uiHeader(esc(fmtDate(pd.date)), '', '')}
      <div class="playday-meta-cards">${pd.time_enabled===false?'':`<div class="meta-chip">◷ ${esc(playdayTimeText(pd))}</div>`}${pd.location_enabled===false?'':`<div class="meta-chip">⌖ ${esc(playdayLocationText(pd))}</div>`}<div class="meta-chip">🏷 ${pd.cost_per_player?`Kosten € ${Number(pd.cost_per_player).toFixed(2).replace('.',',')}`:'Kosten volgen'}</div></div>
      <section class="flat-section"><h2>Jouw status</h2><div class="choice-grid luxe-choices"><button class="choice ${rv?.response==='playing'?'selected':''}" data-rsvp="playing">✓ <span>Ik speel mee</span></button><button class="choice no ${rv?.response==='not_playing'?'selected':''}" data-rsvp="not_playing">○ <span>Ik kan niet</span></button></div></section>
      <section class="flat-section"><div class="section-title"><h2>Aangemeld (${all.length})</h2><span class="host-pill">Host: ${playerNameMarkup(pd.host_id)}</span></div><div class="open-rows">${all.map(r=>`<div class="open-row"><span class="dot"></span><strong class="avatar-name">${avatarMarkup(users.get(r.user_id))}${esc(users.get(r.user_id)?.display_name||'Onbekend')}</strong>${r.user_id===pd.host_id?'<span class="mini-pill">Host</span>':''}</div>`).join('')||'<div class="empty-state">Nog niemand aangemeld.</div>'}</div></section>
      <section class="flat-section progress-panel"><div class="progress-head"><div class="progress-icon">▣</div><div><strong>${complete?'Baan compleet!':`Nog ${need||4} speler${(need||4)===1?'':'s'} nodig`}</strong><span>${complete?'De groep is compleet.':`Nog ${need||4} speler${(need||4)===1?'':'s'} nodig voor een volledige baan.`}</span></div></div><div class="bar-track"><i style="width:${Math.min(100,(all.length/(Math.max(4,pd.court_count*4)))*100)}%"></i></div>${complete&&rv?.response==='playing'&&pd.tikkie_url?`<a class="btn primary full pay-btn" href="${esc(pd.tikkie_url)}" target="_blank" rel="noopener">Open Tikkie</a>`:'<p class="muted">Tikkie wordt zichtbaar zodra een baan compleet is.</p>'}</section>
      ${lobbyBox}${hostPanel}${livePanel}${renderReviewPanel(pd,attendance,reviews,myReview,host)}
      <section class="flat-section"><h2>Wedstrijden (${dayMatches.length})</h2><div class="open-rows">${dayMatches.map(m=>renderMatchRow(m,users,host)).join('')||'<div class="empty-state">Nog geen wedstrijden op deze speeldag.</div>'}</div></section>
      ${isAdmin()?`<section class="flat-section admin-actions"><button class="btn ghost" data-edit-pd>Speeldag wijzigen</button><button class="btn danger" data-delete-pd>Speeldag verwijderen</button></section>`:''}`;
  }

  function renderCourt(pd,n,m){ if(!m)return `<div class="court-card"><div class="court-title"><strong>Baan ${n}</strong><span class="badge">Vrij</span></div><div class="empty-state">Nog geen actieve wedstrijd</div><button class="btn small primary full" data-new-match data-court="${n}">Start op baan ${n}</button></div>`; const d=S.display(m.score_state); return `<div class="court-card"><div class="court-title"><strong>Baan ${n}</strong><span class="badge green">Bezig</span></div><div class="teams"><div class="team-box blue"><strong>${playerNameMarkup(m.blue_player_1)} & ${playerNameMarkup(m.blue_player_2)}</strong><div class="score-mini">${m.score_state.blueGames} · ${d.bluePoints}</div></div><div class="versus">VS</div><div class="team-box red"><strong>${playerNameMarkup(m.red_player_1)} & ${playerNameMarkup(m.red_player_2)}</strong><div class="score-mini">${m.score_state.redGames} · ${d.redPoints}</div></div></div><button class="btn primary full" data-open-match="${m.id}">Score bedienen</button></div>`; }
  function renderSpectatorCourt(m){ const d=S.display(m.score_state); return `<div class="court-card"><div class="court-title"><strong>Baan ${m.court_number}</strong><span class="badge green">Live</span></div><div class="teams"><div class="team-box blue"><strong>${playerNameMarkup(m.blue_player_1)} & ${playerNameMarkup(m.blue_player_2)}</strong><div class="score-mini">${m.score_state.blueGames} · ${d.bluePoints}</div></div><div class="versus">VS</div><div class="team-box red"><strong>${playerNameMarkup(m.red_player_1)} & ${playerNameMarkup(m.red_player_2)}</strong><div class="score-mini">${m.score_state.redGames} · ${d.redPoints}</div></div></div><button class="btn ghost full" data-view-scoreboard="${m.id}">Groot live scorebord</button></div>`; }
  function renderMatchRow(m,users,host){ const blue=`${nameOf(m.blue_player_1)} & ${nameOf(m.blue_player_2)}`,red=`${nameOf(m.red_player_1)} & ${nameOf(m.red_player_2)}`,detail=m.status==='active'?'Bezig':m.timed_out?`Tijd voorbij · ${esc(m.point_snapshot?.blue||'0')}-${esc(m.point_snapshot?.red||'0')}`:'Set voltooid'; return `<div class="open-row match-row"><div><strong>Baan ${m.court_number}: ${esc(blue)} ${m.blue_games}-${m.red_games} ${esc(red)}</strong><small>${detail} · blauw ${S.awardedPoints(m,'blue')} pt, rood ${S.awardedPoints(m,'red')} pt</small></div><div class="list-actions">${m.status==='active'?`<button class="btn small primary" data-open-match="${m.id}">Open</button>`:`<span class="badge ${m.set_completed?'green':'yellow'}">${m.set_completed?'Set':'Tijd'}</span>`}${host&&m.status==='finished'?`<button class="btn small ghost" data-delete-match="${m.id}">Verwijder</button>`:''}</div></div>`; }
  function renderReviewPanel(pd,attendance,reviews,myReview,host){ if(!['review','host_review','approved'].includes(pd.session_status))return''; const rejectCount=reviews.filter(r=>r.decision==='reject').length; if(pd.session_status==='approved')return `<section class="flat-section"><span class="badge green">Goedgekeurd</span><h2>Speeldag definitief</h2><p class="muted">${rejectCount} afkeuring${rejectCount===1?'':'en'}.</p></section>`; if(pd.session_status==='host_review')return `<section class="flat-section review-banner"><h2>Controle door host nodig</h2><p>${rejectCount} spelers hebben de sessie afgekeurd.</p>${host?'<button class="btn primary" data-resolve-session>Gecontroleerd en definitief maken</button>':'<span class="badge yellow">Wachten op host</span>'}</section>`; const participated=attendance.some(a=>a.user_id===current().id); return `<section class="flat-section review-banner"><h2>Beoordeel de hele speeldag</h2><p>Controleer alle wedstrijden en keur de sessie in één keer goed of af.</p>${participated&&!myReview?'<div class="action-row"><button class="btn primary" data-review="approve">Alles klopt</button><button class="btn danger" data-review="reject">Er klopt iets niet</button></div>':myReview?`<span class="badge ${myReview.decision==='approve'?'green':'yellow'}">Jouw keuze: ${myReview.decision==='approve'?'goedgekeurd':'afgekeurd'}</span>`:'<p class="muted">Alleen deelnemers kunnen beoordelen.</p>'}</section>`; }
  function renderRanking(){
    const ordered=S.aggregate(DB.listUsers().filter(u=>u.active),matches()),rows=ordered.map(r=>statsFor(r.id));
    const me=current();
    return `${uiHeader('Statistieken','')}
      <section class="ranking-only"><div class="section-title"><h2>Competitieranglijst</h2><span class="muted small-note">Tik op een speler</span></div><div class="competition-list detailed-ranking">${rows.map((r,i)=>`<button class="competition-row detailed ${r.id===me.id?'me':''}" data-player="${r.id}"><span class="ranking-player-head"><span class="rank-index">${i+1}</span><span class="player-cell"><strong class="avatar-name">${avatarMarkup(r.id)}${esc(r.name)}</strong><i class="form-line">${r.recent.map(x=>`<em class="${x==='W'?'win':x==='V'?'loss':'draw'}">${x}</em>`).join('')||'<em>–</em>'}</i></span><span class="chev">›</span></span><span class="ranking-metrics"><span><b>${r.points}</b><small>Punten</small></span><span><b>${r.played}</b><small>Wed.</small></span><span><b>${r.wins}-${r.losses}</b><small>W-V</small></span><span><b>${r.winPct}%</b><small>Winst</small></span><span><b>${r.setsWon}-${r.setsLost}</b><small>Sets</small></span><span><b>${r.gamesWon}-${r.gamesLost}</b><small>Games</small></span><span><b>${r.gameDiff>0?'+':''}${r.gameDiff}</b><small>Saldo</small></span></span></button>`).join('')||'<div class="empty-state">Nog geen spelers.</div>'}</div></section>
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
      <section class="account-compact">${avatarMarkup(me,'profile')}<div><strong>${esc(me.display_name)}</strong><span>@${esc(me.username)} · speler</span></div></section>
      <div class="account-actions"><button class="open-action" data-change-avatar><span>Avatar wijzigen</span><b>›</b></button><button class="open-action" data-change-password><span>Wachtwoord wijzigen</span><b>›</b></button><button class="open-action danger-text" data-logout><span>Uitloggen</span><b>›</b></button></div>`;
  }
  function renderAdmin(){
    if(!isAdmin())return '<section class="card empty-state">Geen toegang.</section>';
    const users=DB.listUsers(),pending=users.filter(u=>u.approval_status==='pending'),players=users.filter(u=>u.approval_status!=='pending'),pds=DB.listPlaydays().sort((a,b)=>a.date.localeCompare(b.date)||a.start_time.localeCompare(b.start_time));
    const adminSize=pageSize(420,62,3,7),emptyPage={rows:[],page:0,pages:1};
    const requestsPage=state.adminTab==='requests'?paged(pending,'adminPage',adminSize):emptyPage;
    const playersPage=state.adminTab==='players'?paged(players,'adminPage',adminSize):emptyPage;
    const playdaysPage=state.adminTab==='playdays'?paged(pds,'adminPage',adminSize):emptyPage;
    const requestsPanel=`<section class="flat-section admin-panel"><div class="section-title"><h2>Nieuwe aanmeldingen</h2></div><div class="compact-admin-list">${requestsPage.rows.map(u=>`<article class="compact-admin-row">${avatarMarkup(u,'admin')}<div><strong>${esc(u.display_name)}</strong><small>@${esc(u.username)} · wacht op goedkeuring</small></div><div class="admin-item-actions"><button class="btn small primary" data-approve-user="${u.id}">Goedkeuren</button><button class="btn small danger" data-reject-user="${u.id}">Afwijzen</button></div></article>`).join('')||'<div class="empty-state">Geen openstaande aanmeldingen.</div>'}</div>${pager(requestsPage,'adminPage')}</section>`;
    const playersPanel=`<section class="flat-section admin-panel"><div class="section-title admin-title"><h2>Spelers (${players.filter(u=>u.role==='player'&&u.active).length})</h2><button class="btn primary small" data-add-user>+ Speler</button></div><div class="compact-admin-list">${playersPage.rows.map(u=>`<article class="compact-admin-row">${avatarMarkup(u,'admin')}<div><strong>${esc(u.display_name)} ${u.role==='admin'?'<span class="badge yellow">Beheerder</span>':''}</strong><small>@${esc(u.username)} · ${u.approval_status==='rejected'?'afgewezen':u.active?'actief':'geblokkeerd'}</small></div><div class="admin-item-actions">${u.role!=='admin'?`<button class="btn small ghost" data-edit-user="${u.id}">Bewerk</button><button class="btn small ghost" data-reset-user="${u.id}">Reset</button><button class="btn small ghost" data-block-user="${u.id}" data-active="${u.active?'false':'true'}">${u.active?'Blokkeer':'Activeer'}</button><button class="btn small danger" data-remove-user="${u.id}">Verwijder</button>`:''}</div></article>`).join('')}</div>${pager(playersPage,'adminPage')}</section>`;
    const playdaysPanel=`<section class="flat-section admin-panel"><div class="section-title admin-title"><h2>Speeldagen</h2><button class="btn primary small" data-add-pd>+ Speeldag</button></div><div class="compact-admin-list">${playdaysPage.rows.map(p=>`<article class="compact-admin-row playday-admin-row"><div>${fmtDayBadge(p.date)}</div><div><strong>${esc(playdayLocationText(p)||'Speeldag')}</strong><small>${esc([playdayTimeText(p),`host ${nameOf(p.host_id)}`].filter(Boolean).join(' · '))}</small></div><div class="admin-item-actions"><button class="btn small ghost" data-open-playday="${p.id}">Open</button><button class="btn small ghost" data-edit-pd-id="${p.id}">Wijzig</button><button class="btn small danger" data-delete-pd-id="${p.id}">Verwijder</button></div></article>`).join('')||'<div class="empty-state">Geen speeldagen.</div>'}</div>${pager(playdaysPage,'adminPage')}</section>`;
    const settingsPanel=`<section class="flat-section admin-panel"><section class="account-compact">${avatarMarkup(current(),'profile')}<div><strong>${esc(current().display_name)}</strong><span>@${esc(current().username)} · beheerder</span></div></section><div class="account-actions"><button class="open-action" data-change-avatar><span>Avatar wijzigen</span><b>›</b></button></div><form id="registrationCodeForm" class="inline-setting"><div><strong>Competitiecode wijzigen</strong><small>Minimaal 6 tekens. Deel deze alleen met spelers.</small></div><input name="competition_code" minlength="6" placeholder="Nieuwe competitiecode" required><button class="btn primary small">Opslaan</button></form><div class="account-actions"><button class="open-action" data-change-password><span>Wachtwoord wijzigen</span><b>›</b></button><button class="open-action danger-text" data-logout><span>Uitloggen</span><b>›</b></button></div></section>`;
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
    $$('[data-rsvp]').forEach(b=>b.onclick=()=>run(()=>DB.setRsvp(state.selectedPlaydayId,b.dataset.rsvp),'Keuze opgeslagen'));
    $('[data-back-list]')?.addEventListener('click',()=>{state.playdayList=true;render();});
    $('[data-delete-pd]')?.addEventListener('click',()=>confirmAction('Speeldag verwijderen?','Alle deelnemers, wedstrijden, uitslagen en gekoppelde informatie worden definitief verwijderd.',()=>DB.deletePlayday(state.selectedPlaydayId)));
    $$('[data-month]').forEach(b=>b.onclick=()=>{state.month+=Number(b.dataset.month);state.selectedCalendarDate=null;if(state.month<0){state.month=11;state.year--;}if(state.month>11){state.month=0;state.year++;}render();});
    $('[data-today]')?.addEventListener('click',()=>{state.year=new Date().getFullYear();state.month=new Date().getMonth();state.selectedCalendarDate=todayISO();render();});
    $('[data-enter-lobby]')?.addEventListener('click',()=>run(()=>DB.enterLobby(state.selectedPlaydayId),'Je bent in de lobby'));
    $('[data-ready]')?.addEventListener('click',()=>run(()=>DB.setReady(state.selectedPlaydayId),'Je bent READY voor de hele avond'));
    $$('[data-new-match]').forEach(b=>b.onclick=()=>openNewMatch(Number(b.dataset.court)||null));
    $$('[data-open-match]').forEach(b=>b.onclick=()=>openMatch(b.dataset.openMatch));
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
    $('[data-change-password]')?.addEventListener('click',()=>openPasswordModal(false));
    $('[data-logout]')?.addEventListener('click',async()=>{await DB.logout();showLogin();});
    $('#registrationCodeForm')?.addEventListener('submit',e=>{e.preventDefault();const code=new FormData(e.target).get('competition_code');run(()=>DB.updateRegistrationCode(code),'Competitiecode gewijzigd');});
    $('[data-reset-demo]')?.addEventListener('click',()=>confirmAction('Demo herstellen?','Alle lokale wijzigingen worden verwijderd.',()=>{DB.resetDemo();location.reload();}));
  }

  async function run(fn,success){ try{await fn();closeModal();toast(success);render();}catch(e){toast(e.message||'Er ging iets mis.',true);} }
  function confirmAction(title,text,fn){modal(title,`<p class="muted">${esc(text)}</p><div class="action-row"><button class="btn ghost" data-close-modal>Annuleren</button><button class="btn danger" id="confirmYes">Doorgaan</button></div>`,()=>{$('#confirmYes').onclick=()=>run(fn,'Opgeslagen');});}

  function openPlaydayForm(pd,date=todayISO()){
    const players=DB.listUsers().filter(u=>u.active),selected=pd?.host_id||current().id,timeEnabled=pd?.time_enabled!==false,locationEnabled=pd?.location_enabled!==false;
    modal(pd?'Speeldag wijzigen':'Speeldag aanmaken',`<form id="pdForm" class="compact-playday-form">
      <div class="compact-form-grid"><label>Datum<input name="date" type="date" value="${esc(pd?.date||date)}" required></label><label>Host<select name="host_id" required>${players.map(u=>`<option value="${u.id}" ${u.id===selected?'selected':''}>${esc(u.display_name)}</option>`).join('')}</select></label></div>
      <section class="optional-form-section"><label class="feature-toggle"><input id="timeEnabled" name="time_enabled" type="checkbox" ${timeEnabled?'checked':''}><span><b>Start- en eindtijd</b><small>Van toepassing op deze speeldag</small></span></label><div id="timeFields" class="compact-form-grid"><label>Start<input name="start_time" type="time" value="${esc(pd?.start_time||'19:00')}"></label><label>Einde<input name="end_time" type="time" value="${esc(pd?.end_time||'21:00')}"></label></div></section>
      <section class="optional-form-section"><label class="feature-toggle"><input id="locationEnabled" name="location_enabled" type="checkbox" ${locationEnabled?'checked':''}><span><b>Locatie</b><small>Van toepassing op deze speeldag</small></span></label><div id="locationFields"><label>Padelclub<input name="location" value="${esc(pd?.location||'')}" placeholder="Naam padelclub"></label></div></section>
      <div class="compact-form-grid three"><label>Banen<input name="court_count" type="number" min="1" max="20" value="${pd?.court_count||1}" required></label><label>Kosten p.p.<input name="cost_per_player" type="number" min="0" step="0.01" value="${pd?.cost_per_player??''}" placeholder="12,50"></label><label>Status<select name="status"><option value="planned" ${pd?.status==='planned'?'selected':''}>Gepland</option><option value="cancelled" ${pd?.status==='cancelled'?'selected':''}>Geannuleerd</option><option value="closed" ${pd?.status==='closed'?'selected':''}>Afgesloten</option></select></label></div>
      <label>Tikkie-link<input name="tikkie_url" type="url" value="${esc(pd?.tikkie_url||'')}" placeholder="https://tikkie.me/pay/..."></label>
      <div class="form-footer"><button class="btn primary" type="submit">Opslaan</button>${pd?'<button class="btn danger" type="button" id="deletePd">Verwijderen</button>':''}</div>
    </form>`,()=>{
      const sync=()=>{ $('#timeFields').classList.toggle('disabled',!$('#timeEnabled').checked); $('#locationFields').classList.toggle('disabled',!$('#locationEnabled').checked); }; $('#timeEnabled').onchange=sync;$('#locationEnabled').onchange=sync;sync();
      $('#pdForm').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));run(()=>DB.upsertPlayday({...f,id:pd?.id,court_count:Number(f.court_count),cost_per_player:f.cost_per_player?Number(f.cost_per_player):null,time_enabled:$('#timeEnabled').checked,location_enabled:$('#locationEnabled').checked}),'Speeldag opgeslagen');};
      $('#deletePd')?.addEventListener('click',()=>run(()=>DB.deletePlayday(pd.id),'Speeldag verwijderd'));
    });
  }

  function openAddUser(){ modal('Speler aanmaken',`<form id="userForm"><label>Naam<input name="display_name" required></label><label>Gebruikersnaam<input name="username" autocapitalize="none" required></label><label>Tijdelijk wachtwoord<input name="password" type="password" minlength="8" required></label>${avatarPicker(1,'avatar_id','Kies avatar')}<p class="muted">Bij de eerste login moet de speler zelf een nieuw wachtwoord kiezen.</p><button class="btn primary full" type="submit">Speler toevoegen</button></form>`,()=>{bindAvatarPickers($('#userForm'));$('#userForm').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));run(()=>DB.createUser(f),'Speler aangemaakt');};}); }
  function openEditUser(id){ const u=DB.listUsers().find(x=>x.id===id);modal('Speler bewerken',`<form id="editUser"><label>Naam<input name="display_name" value="${esc(u.display_name)}" required></label><label>Gebruikersnaam<input name="username" value="${esc(u.username)}" required></label><label><span>Toegang</span><select name="active"><option value="true" ${u.active?'selected':''}>Actief</option><option value="false" ${!u.active?'selected':''}>Geblokkeerd</option></select></label>${avatarPicker(u.avatar_id,'avatar_id','Avatar')}<button class="btn primary full">Opslaan</button></form>`,()=>{bindAvatarPickers($('#editUser'));$('#editUser').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));run(()=>DB.updateUser(id,{...f,active:f.active==='true',avatar_id:Number(f.avatar_id)}),'Speler bijgewerkt');};}); }

  function openResetUser(id){ const u=DB.listUsers().find(x=>x.id===id);modal(`Wachtwoord resetten`, `<form id="resetForm"><p>Nieuw tijdelijk wachtwoord voor <strong>${esc(u.display_name)}</strong>.</p><label>Tijdelijk wachtwoord<input name="password" type="password" minlength="8" required></label><p class="muted">De speler moet dit na de eerstvolgende login wijzigen.</p><button class="btn primary full">Wachtwoord instellen</button></form>`,()=>{$('#resetForm').onsubmit=e=>{e.preventDefault();run(()=>DB.adminResetPassword(id,new FormData(e.target).get('password')),'Wachtwoord gereset');};}); }
  function openAvatarForm(){ const me=current();modal('Avatar wijzigen',`<form id="avatarForm">${avatarPicker(me.avatar_id,'avatar_id','Kies je avatar')}<button class="btn primary full" type="submit">Avatar opslaan</button></form>`,()=>{bindAvatarPickers($('#avatarForm'));$('#avatarForm').onsubmit=e=>{e.preventDefault();run(()=>DB.saveAvatar(Number(new FormData(e.target).get('avatar_id'))),'Avatar gewijzigd');};}); }
  function openPasswordModal(required=false){ modal(required?'Maak je eigen wachtwoord':'Wachtwoord wijzigen',`<form id="pwForm"><label>Huidig wachtwoord<input name="old" type="password" required></label><label>Nieuw wachtwoord<input name="next" type="password" minlength="8" required></label><label>Nieuw wachtwoord herhalen<input name="repeat" type="password" minlength="8" required></label><button class="btn primary full">Wachtwoord wijzigen</button>${required?'<p class="muted">Dit is verplicht omdat je met een tijdelijk wachtwoord bent ingelogd.</p>':''}</form>`,()=>{if(required)$('[data-close-modal]')?.remove();$('#pwForm').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));if(f.next!==f.repeat){toast('De nieuwe wachtwoorden zijn niet gelijk.',true);return;}run(()=>DB.changePassword(f.old,f.next),'Wachtwoord gewijzigd');};}); }

  function openNewMatch(court){ const pd=selectedPlayday(), ready=participants(pd.id).filter(x=>x.status==='ready').map(x=>x.user); if(ready.length<4){toast('Er zijn minimaal vier READY-spelers nodig.',true);return;} const options=(slot)=>`<option value="">Kies speler</option>${ready.map(u=>`<option value="${u.id}">${esc(u.display_name)}</option>`).join('')}`; modal('Nieuwe wedstrijd',`<form id="matchForm" class="form-grid"><label>Baan<select name="court_number">${Array.from({length:pd.court_count},(_,i)=>`<option value="${i+1}" ${court===i+1?'selected':''}>Baan ${i+1}</option>`).join('')}</select></label><div></div><label>Blauw speler 1<select name="blue_player_1" required>${options()}</select></label><label>Blauw speler 2<select name="blue_player_2" required>${options()}</select></label><label>Rood speler 1<select name="red_player_1" required>${options()}</select></label><label>Rood speler 2<select name="red_player_2" required>${options()}</select></label><button class="btn primary full-span" type="submit">START WEDSTRIJD</button></form>`,()=>{$('#matchForm').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));run(()=>DB.createMatch({...f,playday_id:pd.id,court_number:Number(f.court_number)}),'Wedstrijd gestart');};}); }

  function openMatch(id){ const m=DB.listMatches().find(x=>x.id===id); if(!m)return; state.activeMatchId=id; const d=S.display(m.score_state); modal(`Baan ${m.court_number}`,`<div class="score-control"><button class="score-button blue" id="scoreBlue"><span class="score-name">${playerNameMarkup(m.blue_player_1)} & ${playerNameMarkup(m.blue_player_2)}</span><span class="score-points">${d.bluePoints}</span><span class="score-games">${m.score_state.blueGames} games</span></button><button class="score-button red" id="scoreRed"><span class="score-name">${playerNameMarkup(m.red_player_1)} & ${playerNameMarkup(m.red_player_2)}</span><span class="score-points">${d.redPoints}</span><span class="score-games">${m.score_state.redGames} games</span></button></div><div class="match-toolbar"><button class="btn ghost" id="undoScore">↶ Undo</button><button class="btn ghost" id="speakScore">🔊 Stand</button><button class="btn ghost" id="toggleServe">🎾 Service</button><button class="btn primary" id="openXL">Volledig scherm</button><button class="btn danger" id="timeOver">Tijd voorbij</button></div><p class="muted" style="margin-top:12px">${m.score_state.tiebreak?'Tiebreak actief · ':''}${m.score_state.serverTeam==='blue'?'Blauw':'Rood'} serveert</p>`,()=>{
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
    modal(u?.display_name||'Speler',`<section class="player-popup-head">${avatarMarkup(u,'profile')}<div><strong>${esc(u?.display_name||'Speler')}</strong><span>Ranking #${rank||'–'} · ${s.points} punten</span></div></section><div class="personal-detail-strip popup-stats"><span><small>Winst-verlies</small><b>${s.wins}-${s.losses}</b></span><span><small>Winst %</small><b>${s.winPct}%</b></span><span><small>Sets</small><b>${s.setsWon}-${s.setsLost}</b></span><span><small>Games</small><b>${s.gamesWon}-${s.gamesLost}</b></span></div><div class="popup-form"><span>Laatste vijf</span><i class="form-line">${s.recent.map(x=>`<em class="${x==='W'?'win':x==='V'?'loss':'draw'}">${x}</em>`).join('')||'<em>–</em>'}</i><b>Gamesaldo ${s.gameDiff>0?'+':''}${s.gameDiff}</b></div><div class="popup-actions"><button class="btn primary" id="playerHistory">Bekijk historie</button><button class="btn ghost" id="playerUpcoming">Komende speeldagen</button></div>`,()=>{$('#playerHistory').onclick=()=>openPlayerHistory(id);$('#playerUpcoming').onclick=()=>openPlayerUpcoming(id);});
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
  function openProfile(){ const me=current();modal('Mijn profiel',`<div class="list"><div class="list-row"><div class="list-main"><strong class="avatar-name">${avatarMarkup(me)}${esc(me.display_name)}</strong><span>@${esc(me.username)} · ${me.role==='admin'?'beheerder':'speler'}</span></div></div></div><div class="action-row" style="margin-top:14px"><button class="btn ghost" id="changePw">Wachtwoord wijzigen</button><button class="btn danger" id="logoutBtn">Uitloggen</button></div>`,()=>{$('#changePw').onclick=()=>openPasswordModal(false);$('#logoutBtn').onclick=async()=>{await DB.logout();closeModal();showLogin();};}); }

  function bindGlobal(){
    $('#registerAvatarPicker').innerHTML=avatarPicker(1,'avatar_id','Kies je avatar');
    bindAvatarPickers($('#registerAvatarPicker'));
    $('#loginForm').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button[type=submit]');button.disabled=true;button.textContent='Inloggen…';try{await DB.login($('#loginUsername').value,$('#loginPassword').value);await showPostLoginSplash();}catch(err){toast(err.message,true);}finally{button.disabled=false;button.textContent='Inloggen';}};
    $('#showRegister').onclick=()=>{$('#loginPanel').classList.add('hidden');$('#registerPanel').classList.remove('hidden');};
    $('#showLogin').onclick=()=>{$('#registerPanel').classList.add('hidden');$('#loginPanel').classList.remove('hidden');};
    $('#registerForm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));if(f.password!==f.password_repeat){toast('De wachtwoorden zijn niet gelijk.',true);return;}const button=e.target.querySelector('button[type=submit]');button.disabled=true;button.textContent='Versturen…';try{await DB.register(f);e.target.reset();$('#registerPanel').classList.add('hidden');$('#loginPanel').classList.remove('hidden');modal('Aanmelding ontvangen','<div class="registration-success"><span>✓</span><h3>Je account is aangemaakt</h3><p>De beheerder moet je account nog goedkeuren. Daarna kun je met je gekozen gebruikersnaam en wachtwoord inloggen.</p><button class="btn primary full" data-close-modal>Begrepen</button></div>');}catch(err){toast(err.message,true);}finally{button.disabled=false;button.textContent='Aanmelding versturen';}};
    $$('#bottomNav button').forEach(b=>b.onclick=()=>navigate(b.dataset.page));
    $('#exitScoreboard').onclick=closeScoreboard; $('#xlBlueAdd').onclick=e=>{e.stopPropagation();point(state.scoreboardMatchId,'blue',true);scheduleControlsHide();}; $('#xlRedAdd').onclick=e=>{e.stopPropagation();point(state.scoreboardMatchId,'red',true);scheduleControlsHide();}; $('#xlUndo').onclick=e=>{e.stopPropagation();updateScore(state.scoreboardMatchId,S.undo(getMatch(state.scoreboardMatchId).score_state),true);scheduleControlsHide();}; $('#xlSpeak').onclick=e=>{e.stopPropagation();speakMatch(getMatch(state.scoreboardMatchId));scheduleControlsHide();}; $('#xlVoice').onclick=e=>{e.stopPropagation();state.recognition?stopVoice():startVoice();scheduleControlsHide();}; $('#xlServeToggle').onclick=e=>{e.stopPropagation();updateScore(state.scoreboardMatchId,S.switchServer(getMatch(state.scoreboardMatchId).score_state),true);scheduleControlsHide();}; $('#xlTimeOver').onclick=e=>{e.stopPropagation();finishTimeOver(state.scoreboardMatchId);}; $('#scoreboardOverlay').onclick=()=>scheduleControlsHide();
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.scoreboardMatchId)requestWakeLock();});
    window.addEventListener('padelscore:data-changed',()=>{if(current()){render();if(state.scoreboardMatchId)updateScoreboard();}});
    let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(current()&&!state.scoreboardMatchId)render();},120);});
  }

  async function boot(){ bindGlobal(); if('serviceWorker'in navigator){try{const reg=await navigator.serviceWorker.register('./service-worker.js?v=3.4.0',{updateViaCache:'none'});await reg.update();if(reg.waiting)reg.waiting.postMessage('SKIP_WAITING');navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!sessionStorage.getItem('wepadel-sw-340')){sessionStorage.setItem('wepadel-sw-340','1');location.reload();}});}catch{}} try{await DB.init();}catch(e){toast(e.message||'Online verbinding mislukt.',true);} if(current())showApp();else showLogin(); }
  boot();
})();
