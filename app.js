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

  const state = { page:'dashboard', year:new Date().getFullYear(), month:new Date().getMonth(), playdayList:true, selectedPlaydayId:null, activeMatchId:null, scoreboardMatchId:null, wakeLock:null, timer:null, controlsTimer:null, recognition:null, adminTab:'players', scoreboardReadOnly:false };

  function toast(message, error=false){ const el=$('#toast'); el.textContent=message; el.className=`toast show${error?' error':''}`; clearTimeout(el._t); el._t=setTimeout(()=>el.className='toast',2600); }
  function modal(title, body, onOpen){ $('#modalRoot').innerHTML=`<div class="modal-backdrop"><section class="modal-card"><div class="modal-head"><h2>${esc(title)}</h2><button class="close-btn" data-close-modal>✕</button></div>${body}</section></div>`; $$('[data-close-modal]').forEach(b=>b.onclick=closeModal); onOpen?.(); }
  function closeModal(){ $('#modalRoot').innerHTML=''; }
  function userMap(){ return new Map(DB.listUsers().map(u=>[u.id,u])); }
  function nameOf(id){ return userMap().get(id)?.display_name || 'Onbekend'; }
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

  function showApp(){ $('#loginScreen').classList.add('hidden'); $('#appShell').classList.remove('hidden'); const me=current(); $('#profileButton').textContent=(me?.display_name||'?').slice(0,1).toUpperCase(); $$('[data-admin-only]').forEach(el=>el.classList.toggle('hidden',!isAdmin())); $('#syncBadge').textContent=DB.mode==='demo'?'Demo':'Online'; $('#syncBadge').classList.toggle('online',DB.mode!=='demo'); if(me?.must_change_password) openPasswordModal(true); render(); }
  function showLogin(){ $('#appShell').classList.add('hidden'); $('#loginScreen').classList.remove('hidden'); }
  function navigate(page){ state.page=page; if(page==='playday') state.playdayList=true; $$('#bottomNav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page)); render(); }
  function render(){ const main=$('#mainContent'); if(!current()){showLogin();return;} const pages={dashboard:renderDashboard,calendar:renderCalendar,playday:renderPlayday,ranking:renderRanking,history:renderHistory,admin:renderAdmin}; main.innerHTML=(pages[state.page]||renderDashboard)(); bindPage(); }


  function uiHeader(title, subtitle, action=''){
    return `<div class="ui-header">${action?`<div class="ui-header-action">${action}</div>`:''}<div class="ui-header-main"><span class="ui-header-stick"></span><div><h1>${title}</h1>${subtitle?`<p>${subtitle}</p>`:""}</div></div></div>`;
  }
  function poweredFooter(){ return `<div class="page-powered">Powered by <strong>GJ Motion</strong></div>`; }
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
    const status=statusOverride||playdayStatusText(p);
    return `<button class="event-row luxe" data-open-playday="${p.id}">${fmtDayBadge(p.date)}<span class="event-main"><b>${fmtTime(p.start_time)} - ${fmtTime(p.end_time)}</b><strong>${esc(p.location||'Locatie volgt')}</strong></span><span class="event-status pill ${/compleet|ingeschreven/i.test(status)?'ok':/niet/i.test(status)?'no':'wait'}">${status}</span><span class="chev">›</span></button>`;
  }

  function renderDashboard(){
    const me=current(), pds=DB.listPlaydays().filter(p=>p.status!=='cancelled'), today=todayISO();
    const rows=S.aggregate(DB.listUsers().filter(u=>u.active),matches());
    const mine=rows.find(r=>r.id===me.id)||{points:0,played:0,setsWon:0,setsLost:0,gamesWon:0,gamesLost:0};
    const rank=rows.findIndex(r=>r.id===me.id)+1;
    const winPct=mine.played?Math.round((mine.setsWon/mine.played)*100):0;
    const myIds=new Set(DB.listRsvps().filter(r=>r.user_id===me.id&&r.response==='playing').map(r=>r.playday_id));
    const mineDays=pds.filter(p=>p.date>=today&&myIds.has(p.id)).slice(0,3);
    const last=matches().filter(m=>m.status==='finished'&&[m.blue_player_1,m.blue_player_2,m.red_player_1,m.red_player_2].includes(me.id)).sort((a,b)=>new Date(b.ended_at||b.started_at)-new Date(a.ended_at||a.started_at))[0];
    return `${uiHeader('Goedemiddag','Jouw persoonlijke competitie-overzicht van vandaag.')}
      <section class="dashboard-hero">
        <div class="dashboard-hero-name"><h2>${esc(me.display_name)}</h2></div>
        <div class="hero-circle">${esc(me.display_name.slice(0,1).toUpperCase())}</div>
      </section>
      <div class="stats-compact-grid dashboard-kpis">
        <section class="stat-compact icon ranking"><span>Ranking</span><strong>#${rank||'–'}</strong><small>Huidige positie</small></section>
        <section class="stat-compact icon points"><span>Punten</span><strong>${mine.points}</strong><small>Totaal verdiend</small></section>
        <section class="stat-compact icon played"><span>Gespeeld</span><strong>${mine.played}</strong><small>Wedstrijden</small></section>
        <section class="stat-compact icon win"><span>Winst %</span><strong>${winPct}%</strong><small>Op basis van sets</small></section>
      </div>
      <section class="section-block luxe-block"><div class="section-title"><h2>MIJN VOLGENDE SPEELDAGEN</h2><button data-go="playday">Bekijk allemaal</button></div>
        <div class="event-list">${mineDays.map(p=>playdayRow(p,'Ingeschreven')).join('')||'<div class="empty-state">Je bent nog niet ingeschreven voor een komende speeldag.</div>'}</div>
      </section>
      <section class="section-block luxe-block"><div class="section-title"><h2>LAATSTE UITSLAG</h2><button data-go="history">Historie</button></div>
        ${last?`<button class="history-card single" data-match-info="${last.id}"><div class="history-main"><strong>${esc(nameOf(last.blue_player_1))} & ${esc(nameOf(last.blue_player_2))}</strong><div class="history-score">${last.blue_games} <span>-</span> ${last.red_games}</div><strong>${esc(nameOf(last.red_player_1))} & ${esc(nameOf(last.red_player_2))}</strong><span>${fmtShort(playdayById(last.playday_id)?.date||today)} · ${esc(playdayById(last.playday_id)?.location||'')}</span></div><div class="history-points"><small>Punten verdiend</small><b>${S.awardedPoints(last,(last.blue_player_1===me.id||last.blue_player_2===me.id)?'blue':'red')}</b></div></button>`:'<div class="empty-state">Nog geen uitslag.</div>'}
      </section>
      ${poweredFooter()}`;
  }

  function renderCalendar(){
    const pds=DB.listPlaydays().filter(p=>p.status!=='cancelled').sort((a,b)=>a.date.localeCompare(b.date)||a.start_time.localeCompare(b.start_time));
    const byDate=new Map(); pds.forEach(p=>{if(!byDate.has(p.date))byDate.set(p.date,[]);byDate.get(p.date).push(p);});
    const monthName=new Intl.DateTimeFormat('nl-NL',{month:'long',year:'numeric'}).format(new Date(state.year,state.month,1));
    const monthList=pds.filter(p=>{const d=new Date(p.date+'T12:00:00');return d.getFullYear()===state.year&&d.getMonth()===state.month;});
    return `${uiHeader('Kalender','Bekijk alle speeldagen per maand.')}
      <section class="section-block luxe-block calendar-wrap"><div class="calendar-head luxe"><button data-month="-1">‹</button><h2>${esc(monthName.charAt(0).toUpperCase()+monthName.slice(1))}</h2><button data-month="1">›</button><button class="today-btn" data-today>Vandaag</button></div>${renderMonth(state.year,state.month,byDate)}</section>
      <section class="section-block luxe-block"><div class="section-title"><h2>SPEELDAGEN DEZE MAAND</h2>${isAdmin()?'<button class="btn primary small" data-add-pd>+ Speeldag</button>':''}</div><div class="event-list">${monthList.map(p=>playdayRow(p,playdayStatusText(p,'calendar'))).join('')||'<div class="empty-state">Geen speeldagen in deze maand.</div>'}</div></section>`;
  }
  function renderMonth(year,month,byDate){
    const start=new Date(year,month,1); const offset=(start.getDay()+6)%7; const days=new Date(year,month+1,0).getDate(); let cells='';
    const prevLast=new Date(year,month,0).getDate();
    for(let i=0;i<offset;i++){ const n=prevLast-offset+i+1; cells+=`<button class="day other" disabled><span>${n}</span></button>`; }
    for(let d=1;d<=days;d++){
      const date=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`,arr=byDate.get(date)||[];
      const cls=['day',date===todayISO()?'today':'',arr.length?'playday':''].filter(Boolean).join(' ');
      cells+=`<button class="${cls}" data-date="${date}" ${arr[0]?`data-pd="${arr[0].id}"`:''}><span>${d}</span>${arr.length?'<i></i>':''}</button>`;
    }
    const total=Math.ceil((offset+days)/7)*7;
    for(let i=offset+days;i<total;i++){ cells+=`<button class="day other" disabled><span>${i-(offset+days)+1}</span></button>`; }
    return `<section class="month single luxe-month"><div class="weekdays"><span>MA</span><span>DI</span><span>WO</span><span>DO</span><span>VR</span><span>ZA</span><span>ZO</span></div><div class="days">${cells}</div></section>`;
  }
  function renderPlayday(){
    if(state.playdayList){
      const pds=DB.listPlaydays().filter(p=>p.status!=='cancelled').sort((a,b)=>a.date.localeCompare(b.date)||a.start_time.localeCompare(b.start_time));
      return `${uiHeader('Speeldagen','Alle door de beheerder aangemaakte speeldagen.',isAdmin()?'<button class="btn primary" data-add-pd>+ Toevoegen</button>':'')}
        <div class="event-list all-days">${pds.map(p=>playdayRow(p)).join('')||'<div class="empty-state">Nog geen speeldagen.</div>'}</div>`;
    }
    const pd=selectedPlayday(); if(!pd){state.playdayList=true;return renderPlayday();}
    state.selectedPlaydayId=pd.id;
    const me=current(), rv=DB.listRsvps(pd.id).find(r=>r.user_id===me.id), all=DB.listRsvps(pd.id).filter(r=>r.response==='playing');
    const users=userMap(); const need=needForNextCourt(all.length); const complete=all.length>0&&need===0;
    return `<button class="detail-back" data-back-list>‹</button>${uiHeader(esc(fmtDate(pd.date)), '', '')}
      <div class="playday-meta-cards"><div class="meta-chip">◷ ${fmtTime(pd.start_time)} - ${fmtTime(pd.end_time)}</div><div class="meta-chip">⌖ ${esc(pd.location||'Locatie volgt')}</div><div class="meta-chip">🏷 ${pd.cost_per_player?`Kosten € ${Number(pd.cost_per_player).toFixed(2).replace('.',',')}`:'Kosten volgen'}</div></div>
      <section class="section-block luxe-block"><h2>Jouw status</h2><div class="choice-grid luxe-choices"><button class="choice ${rv?.response==='playing'?'selected':''}" data-rsvp="playing">✓ <span>Ik speel mee</span></button><button class="choice no ${rv?.response==='not_playing'?'selected':''}" data-rsvp="not_playing">○ <span>Ik kan niet</span></button></div></section>
      <section class="section-block luxe-block"><div class="section-title"><h2>Aanwezig (${all.length})</h2><span class="host-pill">Host: ${esc(nameOf(pd.host_id))}</span></div><div class="presence-list">${all.map(r=>`<div class="presence-row"><span class="dot"></span><strong>${esc(users.get(r.user_id)?.display_name||'Onbekend')}</strong>${r.user_id===pd.host_id?'<span class="mini-pill">Host</span>':''}</div>`).join('')||'<div class="empty-state">Nog niemand aangemeld.</div>'}</div></section>
      <section class="section-block luxe-block progress-panel"><div class="progress-head"><div class="progress-icon">▣</div><div><strong>${complete?'Baan compleet!':`Nog ${need||4} speler${(need||4)===1?'':'s'} nodig`}</strong><span>${complete?'Tikkie wordt nu zichtbaar voor de complete groep.':`Nog ${need||4} speler${(need||4)===1?'':'s'} nodig voor een volledige baan.`}</span></div></div><div class="bar-track"><i style="width:${Math.min(100,(all.length/(Math.max(4,pd.court_count*4)))*100)}%"></i></div>${complete&&rv?.response==='playing'&&pd.tikkie_url?`<a class="btn primary full pay-btn" href="${esc(pd.tikkie_url)}" target="_blank" rel="noopener">Open Tikkie</a>`:'<p class="muted">Tikkie wordt pas zichtbaar zodra een baan compleet is.</p>'}</section>
      ${isAdmin()?`<section class="section-block luxe-block admin-actions"><button class="btn ghost" data-edit-pd>Speeldag wijzigen</button><button class="btn danger" data-delete-pd>Speeldag verwijderen</button></section>`:''}`;
  }
  function renderRanking(){
    const rows=S.aggregate(DB.listUsers().filter(u=>u.active),matches());
    const me=current(); const mine=rows.find(r=>r.id===me.id)||{points:0,played:0,setsWon:0,setsLost:0,gamesWon:0,gamesLost:0,winPct:0}; const rank=rows.findIndex(r=>r.id===me.id)+1;
    return `${uiHeader('Statistieken','Individuele ranglijst met punten, sets en games.')}
      <div class="stats-compact-grid ranking-summary four"><section class="stat-compact"><span>Mijn ranking</span><strong>#${rank||'–'}</strong></section><section class="stat-compact"><span>Punten</span><strong>${mine.points}</strong></section><section class="stat-compact"><span>Sets</span><strong>${mine.setsWon}-${mine.setsLost}</strong></section><section class="stat-compact"><span>Games</span><strong>${mine.gamesWon}-${mine.gamesLost}</strong></section></div>
      <section class="section-block luxe-block"><div class="section-title"><h2>Ranglijst</h2><span class="muted small-note">Tik op een speler voor details</span></div><div class="stats-table">${rows.map((r,i)=>`<button class="stats-row ${r.id===me.id?'me':''}" data-player="${r.id}"><span class="rank-index">${i+1}</span><span class="player-name">${esc(r.name)}</span><span><b>${r.points}</b><small>Punten</small></span><span><b>${r.played}</b><small>Wedstrijden</small></span><span><b>${r.winPct}%</b><small>Winst %</small></span><span><b>${r.setsWon}-${r.setsLost}</b><small>Sets</small></span><span><b>${r.gamesWon}-${r.gamesLost}</b><small>Games</small></span></button>`).join('')||'<div class="empty-state">Nog geen spelers.</div>'}</div></section>
      <section class="section-block luxe-block"><h2>Puntentelling</h2><p class="muted">Je verdient punten door games en sets te winnen. Elke gewonnen game telt als 1 punt. Een volledig gewonnen set geeft 3 extra punten. De ranglijst wordt berekend op basis van je prestaties.</p></section>`;
  }
  function renderHistory(){
    const ms=matches().filter(m=>m.status==='finished'&&!m.deleted_at).sort((a,b)=>new Date(b.ended_at||b.started_at)-new Date(a.ended_at||a.started_at)); const pds=new Map(DB.listPlaydays().map(p=>[p.id,p]));
    return `${uiHeader('Historie','Alle uitslagen, partners, tegenstanders en verdiende punten.')}
      <div class="history-list rich">${ms.map(m=>{const pd=pds.get(m.playday_id); const bluePts=S.awardedPoints(m,'blue'); const redPts=S.awardedPoints(m,'red'); return `<button class="history-card rich" data-match-info="${m.id}"><div class="history-scorecard"><div class="side blue"><strong>${esc(nameOf(m.blue_player_1))} & ${esc(nameOf(m.blue_player_2))}</strong></div><div class="center"><div class="history-score">${m.blue_games} <span>-</span> ${m.red_games}</div><small>${pd?fmtShort(pd.date):''} · Baan ${m.court_number}</small></div><div class="side red"><strong>${esc(nameOf(m.red_player_1))} & ${esc(nameOf(m.red_player_2))}</strong></div></div><div class="history-footer"><div class="meta">${m.set_completed?'Volledige set':'Tijd voorbij'}</div><div class="earned">Punten verdiend <b>${bluePts} - ${redPts}</b></div></div></button>`}).join('')||'<section class="card empty-state">Nog geen afgeronde wedstrijden.</section>'}</div>
      ${poweredFooter()}`;
  }
  function renderAdmin(){
    if(!isAdmin())return '<section class="card empty-state">Geen toegang.</section>';
    const users=DB.listUsers(),pds=DB.listPlaydays().sort((a,b)=>a.date.localeCompare(b.date)||a.start_time.localeCompare(b.start_time));
    return `${uiHeader('Beheer','Beheer spelers, speeldagen en instellingen overzichtelijk op één plek.')}
      <div class="tabs admin-tabs luxe"><button class="${state.adminTab==='players'?'active':''}" data-admin-tab="players">Spelers</button><button class="${state.adminTab==='playdays'?'active':''}" data-admin-tab="playdays">Speeldagen</button><button class="${state.adminTab==='settings'?'active':''}" data-admin-tab="settings">Instellingen</button></div>
      ${state.adminTab==='players'?`<section class="section-block luxe-block admin-panel"><div class="section-title admin-title"><div><h2>Spelers (${users.filter(u=>u.role==='player'&&u.active).length})</h2><p class="muted">Maak accounts, reset wachtwoorden of blokkeer toegang.</p></div><button class="btn primary" data-add-user>+ Speler</button></div><div class="admin-card-list">${users.map(u=>`<article class="admin-item rich"><div class="admin-avatar">◌</div><div class="admin-item-main"><strong>${esc(u.display_name)} ${u.role==='admin'?'<span class="badge yellow">Beheerder</span>':''}</strong><span>@${esc(u.username)} · ${u.active?'actief':'geblokkeerd'}${u.must_change_password?' · wachtwoord wijzigen verplicht':''}</span></div>${u.role!=='admin'?`<div class="admin-item-actions"><button class="btn small ghost" data-edit-user="${u.id}">Bewerk</button><button class="btn small ghost" data-reset-user="${u.id}">Reset</button><button class="btn small danger" data-delete-user="${u.id}">${u.active?'Blokkeer':'Geblokkeerd'}</button></div>`:`<div class="admin-item-actions single"><button class="btn small ghost" data-edit-user="${u.id}">Profiel</button></div>`}</article>`).join('')}</div></section>`:state.adminTab==='playdays'?`<section class="section-block luxe-block admin-panel"><div class="section-title admin-title"><div><h2>Speeldagen</h2><p class="muted">Toevoegen, wijzigen of volledig verwijderen.</p></div><button class="btn primary" data-add-pd>+ Speeldag</button></div><div class="admin-card-list">${pds.map(p=>`<article class="admin-item rich vertical"><div class="admin-item-main"><strong>${esc(fmtDate(p.date))}</strong><span>${fmtTime(p.start_time)} – ${fmtTime(p.end_time)} · ${esc(p.location||'Locatie volgt')} · host ${esc(nameOf(p.host_id))}</span></div><div class="admin-item-actions"><button class="btn small ghost" data-open-playday="${p.id}">Open</button><button class="btn small ghost" data-edit-pd-id="${p.id}">Wijzig</button><button class="btn small danger" data-delete-pd-id="${p.id}">Verwijder</button></div></article>`).join('')||'<div class="empty-state">Geen speeldagen.</div>'}</div></section>`:`<section class="section-block luxe-block admin-panel"><h2>Competitie</h2><div class="settings-stack"><div class="setting-row"><span>Naam competitie</span><strong>${esc(window.PADEL_CONFIG?.competitionName||'WEPADEL')}</strong></div><div class="setting-row"><span>Omgeving</span><strong>${DB.mode==='demo'?'Demo':'Online'}</strong></div><div class="setting-row"><span>Accounts</span><strong>Alleen door beheerder aan te maken</strong></div></div><p class="muted" style="margin-top:12px">Deze versie ondersteunt bewust één competitie. Alle actieve accounts mogen alleen deelnemen nadat jij ze hebt aangemaakt.</p>${DB.mode==='demo'?'<button class="btn ghost" data-reset-demo>Demo herstellen</button>':''}</section>`}`;
  }
  function bindPage(){
    $$('[data-go]').forEach(b=>b.onclick=()=>navigate(b.dataset.go));
    $$('[data-open-playday]').forEach(b=>b.onclick=()=>{state.selectedPlaydayId=b.dataset.openPlayday;state.playdayList=false;state.page='playday';render();});
    $$('[data-player]').forEach(b=>b.onclick=()=>openPlayer(b.dataset.player));
    $$('[data-year]').forEach(b=>b.onclick=()=>{state.year+=Number(b.dataset.year);render();});
    $$('.day[data-date]').forEach(b=>b.onclick=()=>{const pd=b.dataset.pd?playdayById(b.dataset.pd):null;if(pd){state.selectedPlaydayId=pd.id;state.playdayList=false;state.page='playday';render();}else if(isAdmin())openPlaydayForm(null,b.dataset.date);});
    $$('[data-rsvp]').forEach(b=>b.onclick=()=>run(()=>DB.setRsvp(state.selectedPlaydayId,b.dataset.rsvp),'Keuze opgeslagen'));
    $('[data-back-list]')?.addEventListener('click',()=>{state.playdayList=true;render();});
    $('[data-delete-pd]')?.addEventListener('click',()=>confirmAction('Speeldag verwijderen?','Alle deelnemers, wedstrijden, uitslagen en gekoppelde informatie worden definitief verwijderd.',()=>DB.deletePlayday(state.selectedPlaydayId)));
    $$('[data-month]').forEach(b=>b.onclick=()=>{state.month+=Number(b.dataset.month);if(state.month<0){state.month=11;state.year--;}if(state.month>11){state.month=0;state.year++;}render();});
    $('[data-today]')?.addEventListener('click',()=>{state.year=new Date().getFullYear();state.month=new Date().getMonth();render();});
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
    $$('[data-admin-tab]').forEach(b=>b.onclick=()=>{state.adminTab=b.dataset.adminTab;render();});
    $('[data-add-user]')?.addEventListener('click',openAddUser);
    $$('[data-edit-user]').forEach(b=>b.onclick=()=>openEditUser(b.dataset.editUser));
    $$('[data-reset-user]').forEach(b=>b.onclick=()=>openResetUser(b.dataset.resetUser));
    $$('[data-delete-user]').forEach(b=>b.onclick=()=>confirmAction('Speler blokkeren?','De speler kan niet meer inloggen. Historische uitslagen blijven behouden.',()=>DB.deleteUser(b.dataset.deleteUser)));
    $('[data-add-pd]')?.addEventListener('click',()=>openPlaydayForm(null,todayISO()));
    $$('[data-edit-pd-id]').forEach(b=>b.onclick=()=>openPlaydayForm(playdayById(b.dataset.editPdId)));
    $$('[data-delete-pd-id]').forEach(b=>b.onclick=()=>confirmAction('Speeldag verwijderen?','Alle deelnemers, wedstrijden, uitslagen en gekoppelde informatie worden definitief verwijderd.',()=>DB.deletePlayday(b.dataset.deletePdId)));
    $('[data-reset-demo]')?.addEventListener('click',()=>confirmAction('Demo herstellen?','Alle lokale wijzigingen worden verwijderd.',()=>{DB.resetDemo();location.reload();}));
  }

  async function run(fn,success){ try{await fn();closeModal();toast(success);render();}catch(e){toast(e.message||'Er ging iets mis.',true);} }
  function confirmAction(title,text,fn){modal(title,`<p class="muted">${esc(text)}</p><div class="action-row"><button class="btn ghost" data-close-modal>Annuleren</button><button class="btn danger" id="confirmYes">Doorgaan</button></div>`,()=>{$('#confirmYes').onclick=()=>run(fn,'Opgeslagen');});}

  function openPlaydayForm(pd,date=todayISO()){
    const players=DB.listUsers().filter(u=>u.active); const selected=pd?.host_id||current().id;
    modal(pd?'Speeldag wijzigen':'Speeldag aanmaken',`<form id="pdForm" class="form-grid"><label>Datum<input name="date" type="date" value="${esc(pd?.date||date)}" required></label><label>Host<select name="host_id" required>${players.map(u=>`<option value="${u.id}" ${u.id===selected?'selected':''}>${esc(u.display_name)}</option>`).join('')}</select></label><label>Starttijd<input name="start_time" type="time" value="${esc(pd?.start_time||'19:00')}" required></label><label>Eindtijd<input name="end_time" type="time" value="${esc(pd?.end_time||'21:00')}" required></label><label>Locatie<input name="location" value="${esc(pd?.location||'')}" placeholder="Naam padelclub"></label><label>Aantal banen<input name="court_count" type="number" min="1" max="20" value="${pd?.court_count||1}" required></label><label>Kosten per persoon<input name="cost_per_player" type="number" min="0" step="0.01" value="${pd?.cost_per_player||''}" placeholder="12,50"></label><label class="full-span">Tikkie-link<input name="tikkie_url" type="url" value="${esc(pd?.tikkie_url||'')}" placeholder="https://tikkie.me/pay/..."></label><label>Status<select name="status"><option value="planned" ${pd?.status==='planned'?'selected':''}>Gepland</option><option value="cancelled" ${pd?.status==='cancelled'?'selected':''}>Geannuleerd</option><option value="closed" ${pd?.status==='closed'?'selected':''}>Afgesloten</option></select></label><div class="full-span action-row"><button class="btn primary" type="submit">Opslaan</button>${pd?'<button class="btn danger" type="button" id="deletePd">Verwijderen</button>':''}</div></form>`,()=>{
      $('#pdForm').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));run(()=>DB.upsertPlayday({...f,id:pd?.id,court_count:Number(f.court_count),cost_per_player:f.cost_per_player?Number(f.cost_per_player):null}),'Speeldag opgeslagen');};
      $('#deletePd')?.addEventListener('click',()=>run(()=>DB.deletePlayday(pd.id),'Speeldag verwijderd'));
    });
  }

  function openAddUser(){ modal('Speler aanmaken',`<form id="userForm"><label>Naam<input name="display_name" required></label><label>Gebruikersnaam<input name="username" autocapitalize="none" required></label><label>Tijdelijk wachtwoord<input name="password" type="password" minlength="8" required></label><p class="muted">Bij de eerste login moet de speler zelf een nieuw wachtwoord kiezen.</p><button class="btn primary full" type="submit">Speler toevoegen</button></form>`,()=>{$('#userForm').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));run(()=>DB.createUser(f),'Speler aangemaakt');};}); }
  function openEditUser(id){ const u=DB.listUsers().find(x=>x.id===id);modal('Speler bewerken',`<form id="editUser"><label>Naam<input name="display_name" value="${esc(u.display_name)}" required></label><label>Gebruikersnaam<input name="username" value="${esc(u.username)}" required></label><label><span>Toegang</span><select name="active"><option value="true" ${u.active?'selected':''}>Actief</option><option value="false" ${!u.active?'selected':''}>Geblokkeerd</option></select></label><button class="btn primary full">Opslaan</button></form>`,()=>{$('#editUser').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));run(()=>DB.updateUser(id,{...f,active:f.active==='true'}),'Speler bijgewerkt');};}); }
  function openResetUser(id){ const u=DB.listUsers().find(x=>x.id===id);modal(`Wachtwoord resetten`, `<form id="resetForm"><p>Nieuw tijdelijk wachtwoord voor <strong>${esc(u.display_name)}</strong>.</p><label>Tijdelijk wachtwoord<input name="password" type="password" minlength="8" required></label><p class="muted">De speler moet dit na de eerstvolgende login wijzigen.</p><button class="btn primary full">Wachtwoord instellen</button></form>`,()=>{$('#resetForm').onsubmit=e=>{e.preventDefault();run(()=>DB.adminResetPassword(id,new FormData(e.target).get('password')),'Wachtwoord gereset');};}); }
  function openPasswordModal(required=false){ modal(required?'Maak je eigen wachtwoord':'Wachtwoord wijzigen',`<form id="pwForm"><label>Huidig wachtwoord<input name="old" type="password" required></label><label>Nieuw wachtwoord<input name="next" type="password" minlength="8" required></label><label>Nieuw wachtwoord herhalen<input name="repeat" type="password" minlength="8" required></label><button class="btn primary full">Wachtwoord wijzigen</button>${required?'<p class="muted">Dit is verplicht omdat je met een tijdelijk wachtwoord bent ingelogd.</p>':''}</form>`,()=>{if(required)$('[data-close-modal]')?.remove();$('#pwForm').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));if(f.next!==f.repeat){toast('De nieuwe wachtwoorden zijn niet gelijk.',true);return;}run(()=>DB.changePassword(f.old,f.next),'Wachtwoord gewijzigd');};}); }

  function openNewMatch(court){ const pd=selectedPlayday(), ready=participants(pd.id).filter(x=>x.status==='ready').map(x=>x.user); if(ready.length<4){toast('Er zijn minimaal vier READY-spelers nodig.',true);return;} const options=(slot)=>`<option value="">Kies speler</option>${ready.map(u=>`<option value="${u.id}">${esc(u.display_name)}</option>`).join('')}`; modal('Nieuwe wedstrijd',`<form id="matchForm" class="form-grid"><label>Baan<select name="court_number">${Array.from({length:pd.court_count},(_,i)=>`<option value="${i+1}" ${court===i+1?'selected':''}>Baan ${i+1}</option>`).join('')}</select></label><div></div><label>Blauw speler 1<select name="blue_player_1" required>${options()}</select></label><label>Blauw speler 2<select name="blue_player_2" required>${options()}</select></label><label>Rood speler 1<select name="red_player_1" required>${options()}</select></label><label>Rood speler 2<select name="red_player_2" required>${options()}</select></label><button class="btn primary full-span" type="submit">START WEDSTRIJD</button></form>`,()=>{$('#matchForm').onsubmit=e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));run(()=>DB.createMatch({...f,playday_id:pd.id,court_number:Number(f.court_number)}),'Wedstrijd gestart');};}); }

  function openMatch(id){ const m=DB.listMatches().find(x=>x.id===id); if(!m)return; state.activeMatchId=id; const d=S.display(m.score_state); modal(`Baan ${m.court_number}`,`<div class="score-control"><button class="score-button blue" id="scoreBlue"><span class="score-name">${esc(nameOf(m.blue_player_1))} & ${esc(nameOf(m.blue_player_2))}</span><span class="score-points">${d.bluePoints}</span><span class="score-games">${m.score_state.blueGames} games</span></button><button class="score-button red" id="scoreRed"><span class="score-name">${esc(nameOf(m.red_player_1))} & ${esc(nameOf(m.red_player_2))}</span><span class="score-points">${d.redPoints}</span><span class="score-games">${m.score_state.redGames} games</span></button></div><div class="match-toolbar"><button class="btn ghost" id="undoScore">↶ Undo</button><button class="btn ghost" id="speakScore">🔊 Stand</button><button class="btn ghost" id="toggleServe">🎾 Service</button><button class="btn primary" id="openXL">Volledig scherm</button><button class="btn danger" id="timeOver">Tijd voorbij</button></div><p class="muted" style="margin-top:12px">${m.score_state.tiebreak?'Tiebreak actief · ':''}${m.score_state.serverTeam==='blue'?'Blauw':'Rood'} serveert</p>`,()=>{
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
  function openPlayer(id){ const u=DB.listUsers().find(x=>x.id===id), ms=matches().filter(m=>m.status==='finished'&&!m.deleted_at&&[m.blue_player_1,m.blue_player_2,m.red_player_1,m.red_player_2].includes(id)), rank=S.aggregate(DB.listUsers(),matches()).find(r=>r.id===id); modal(u?.display_name||'Speler',`<div class="grid three"><section class="card kpi"><div><span>Punten</span><strong>${rank?.points||0}</strong></div></section><section class="card kpi"><div><span>Sets W-V</span><strong>${rank?.setsWon||0}-${rank?.setsLost||0}</strong></div></section><section class="card kpi"><div><span>Games W-V</span><strong>${rank?.gamesWon||0}-${rank?.gamesLost||0}</strong></div></section></div><h3 style="margin-top:18px">Wedstrijden</h3><div class="list">${ms.map(m=>{const blue=[m.blue_player_1,m.blue_player_2],onBlue=blue.includes(id),partner=nameOf((onBlue?blue:[m.red_player_1,m.red_player_2]).find(x=>x!==id)),opp=(onBlue?[m.red_player_1,m.red_player_2]:blue).map(nameOf).join(' & '),pts=S.awardedPoints(m,onBlue?'blue':'red');return `<div class="list-row"><div class="list-main"><strong>Met ${esc(partner)} tegen ${esc(opp)}</strong><span>${m.blue_games}-${m.red_games} · ${m.timed_out?'tijd voorbij':'set voltooid'}</span></div><strong>${pts} pt</strong></div>`}).join('')||'<div class="empty-state">Nog geen wedstrijden.</div>'}</div>`); }
  function openMatchInfo(id){ const m=getMatch(id), pd=playdayById(m.playday_id);modal('Wedstrijddetails',`<p><strong>${esc(nameOf(m.blue_player_1))} & ${esc(nameOf(m.blue_player_2))}</strong></p><h2>${m.blue_games} — ${m.red_games}</h2><p><strong>${esc(nameOf(m.red_player_1))} & ${esc(nameOf(m.red_player_2))}</strong></p><p class="muted">${pd?fmtDate(pd.date):''} · baan ${m.court_number}<br>${m.set_completed?'Volledige set':'Tijd voorbij'}${m.timed_out?` · onafgemaakte game: ${esc(m.point_snapshot?.blue)}-${esc(m.point_snapshot?.red)}`:''}<br>Punten: blauw ${S.awardedPoints(m,'blue')}, rood ${S.awardedPoints(m,'red')}</p>`); }
  function openProfile(){ const me=current();modal('Mijn profiel',`<div class="list"><div class="list-row"><div class="list-main"><strong>${esc(me.display_name)}</strong><span>@${esc(me.username)} · ${me.role==='admin'?'beheerder':'speler'}</span></div></div></div><div class="action-row" style="margin-top:14px"><button class="btn ghost" id="changePw">Wachtwoord wijzigen</button><button class="btn danger" id="logoutBtn">Uitloggen</button></div>`,()=>{$('#changePw').onclick=()=>openPasswordModal(false);$('#logoutBtn').onclick=async()=>{await DB.logout();closeModal();showLogin();};}); }

  function bindGlobal(){
    $('#loginForm').onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('button[type=submit]');button.disabled=true;button.textContent='Inloggen…';try{await DB.login($('#loginUsername').value,$('#loginPassword').value);showApp();}catch(err){toast(err.message,true);}finally{button.disabled=false;button.textContent='Inloggen';}};
    $$('#bottomNav button').forEach(b=>b.onclick=()=>navigate(b.dataset.page)); $('#profileButton').onclick=openProfile;
    $('#exitScoreboard').onclick=closeScoreboard; $('#xlBlueAdd').onclick=e=>{e.stopPropagation();point(state.scoreboardMatchId,'blue',true);scheduleControlsHide();}; $('#xlRedAdd').onclick=e=>{e.stopPropagation();point(state.scoreboardMatchId,'red',true);scheduleControlsHide();}; $('#xlUndo').onclick=e=>{e.stopPropagation();updateScore(state.scoreboardMatchId,S.undo(getMatch(state.scoreboardMatchId).score_state),true);scheduleControlsHide();}; $('#xlSpeak').onclick=e=>{e.stopPropagation();speakMatch(getMatch(state.scoreboardMatchId));scheduleControlsHide();}; $('#xlVoice').onclick=e=>{e.stopPropagation();state.recognition?stopVoice():startVoice();scheduleControlsHide();}; $('#xlServeToggle').onclick=e=>{e.stopPropagation();updateScore(state.scoreboardMatchId,S.switchServer(getMatch(state.scoreboardMatchId).score_state),true);scheduleControlsHide();}; $('#xlTimeOver').onclick=e=>{e.stopPropagation();finishTimeOver(state.scoreboardMatchId);}; $('#scoreboardOverlay').onclick=()=>scheduleControlsHide();
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.scoreboardMatchId)requestWakeLock();});
    window.addEventListener('padelscore:data-changed',()=>{if(current()){render();if(state.scoreboardMatchId)updateScoreboard();}});
  }

  async function boot(){ bindGlobal(); if('serviceWorker'in navigator){try{const reg=await navigator.serviceWorker.register('./service-worker.js?v=3.1.1',{updateViaCache:'none'});await reg.update();if(reg.waiting)reg.waiting.postMessage('SKIP_WAITING');navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!sessionStorage.getItem('wepadel-sw-311')){sessionStorage.setItem('wepadel-sw-311','1');location.reload();}});}catch{}} try{await DB.init();}catch(e){toast(e.message||'Online verbinding mislukt.',true);} if(current())showApp();else showLogin(); }
  boot();
})();
