(function(){
  'use strict';

  const cfg = window.PADEL_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabasePublishableKey) {
    throw new Error('De online Supabase-configuratie ontbreekt.');
  }
  if (!window.supabase?.createClient) {
    throw new Error('Supabase kon niet worden geladen. Controleer de internetverbinding.');
  }

  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  let session = null;
  let channel = null;
  let refreshTimer = null;
  let loadSequence = 0;
  const scoreQueues = new Map();
  const cache = {
    competition: null,
    users: [],
    playdays: [],
    rsvps: [],
    slots: [],
    attendance: [],
    matches: [],
    reviews: [],
    swaps: []
  };

  const clone = value => JSON.parse(JSON.stringify(value));
  const localDateISO = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const fail = error => {
    const message = error?.message || error?.error_description || error?.error || String(error || 'Er ging iets mis.');
    throw new Error(message === 'undefined' ? 'De sessie kon niet worden geopend. Log opnieuw in.' : message);
  };
  const emit = () => window.dispatchEvent(new CustomEvent('padelscore:data-changed'));
  const authStorageKey = (() => {
    try { return `sb-${new URL(cfg.supabaseUrl).hostname.split('.')[0]}-auth-token`; }
    catch { return ''; }
  })();
  function removeStoredSession() {
    if (!authStorageKey) return;
    try { localStorage.removeItem(authStorageKey); } catch {}
    try { sessionStorage.removeItem(authStorageKey); } catch {}
  }
  async function clearLocalSession() {
    if (channel) {
      try { await client.removeChannel(channel); } catch {}
      channel = null;
    }
    try { await client.auth.signOut({ scope: 'local' }); } catch {}
    removeStoredSession();
    session = null;
    clearCache();
  }
  const normalizePlayday = row => ({ ...row, date: row.play_date });
  const denormalizePlayday = input => ({
    ...(input.id ? { id: input.id } : {}),
    competition_id: current()?.competition_id,
    play_date: input.date,
    start_time: input.start_time || '19:00',
    end_time: input.end_time || '21:00',
    location: input.location || '',
    time_enabled: input.time_enabled !== false,
    location_enabled: input.location_enabled !== false,
    host_id: input.host_id,
    court_count: Math.max(1, Number(input.court_count) || 1),
    status: input.status || 'planned',
    duration_minutes: input.duration_minutes ? Math.max(1, Number(input.duration_minutes)) : null,
    cost_per_player: input.cost_per_player ?? null,
    tikkie_url: input.tikkie_url || '',
    tikkie_created_at: input.tikkie_created_at || null,
    live_scoring_enabled: input.live_scoring_enabled !== false
  });

  async function callFunction(name, body, authenticated = true) {
    const headers = {
      apikey: cfg.supabasePublishableKey,
      'content-type': 'application/json'
    };
    if (authenticated) {
      const active = session || (await client.auth.getSession()).data.session;
      if (!active?.access_token) throw new Error('Je sessie is verlopen. Log opnieuw in.');
      headers.authorization = `Bearer ${active.access_token}`;
    }
    const response = await fetch(`${cfg.supabaseUrl}/functions/v1/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || data?.message || `De serveractie is mislukt (${response.status}).`);
    return data || {};
  }

  async function loadAll() {
    if (!session?.user?.id) return clearCache();
    const requestSequence = ++loadSequence;
    const requests = await Promise.all([
      client.from('competition').select('*').limit(1).maybeSingle(),
      client.from('profiles').select('*').order('display_name'),
      client.from('playdays').select('*').order('play_date'),
      client.from('rsvps').select('*'),
      client.from('playday_slots').select('*').order('court_number').order('slot_number'),
      client.from('attendance').select('*'),
      client.from('matches').select('*').order('started_at', { ascending: false }),
      client.from('session_reviews').select('*'),
      client.from('swap_requests').select('*').order('created_at', { ascending: false })
    ]);
    const firstError = requests.find(r => r.error)?.error;
    if (firstError) fail(firstError);
    // A slower, older refresh may never overwrite data returned by a newer one.
    if (requestSequence !== loadSequence) return current();
    cache.competition = requests[0].data || null;
    cache.users = requests[1].data || [];
    cache.playdays = (requests[2].data || []).map(normalizePlayday);
    cache.rsvps = requests[3].data || [];
    cache.slots = requests[4].data || [];
    cache.attendance = requests[5].data || [];
    cache.matches = (requests[6].data || []).map(m => ({
      ...m,
      score_state: m.score_state && Object.keys(m.score_state).length ? m.score_state : PadelScoring.freshScore()
    }));
    cache.reviews = requests[7].data || [];
    cache.swaps = requests[8].data || [];
    emit();
    return current();
  }

  function clearCache() {
    loadSequence += 1;
    cache.competition = null;
    cache.users = [];
    cache.playdays = [];
    cache.rsvps = [];
    cache.slots = [];
    cache.attendance = [];
    cache.matches = [];
    cache.reviews = [];
    cache.swaps = [];
    emit();
    return null;
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => loadAll().catch(console.error), 180);
  }

  function subscribe() {
    if (channel) client.removeChannel(channel);
    channel = client.channel('padelscore-live');
    ['profiles','playdays','rsvps','playday_slots','attendance','matches','session_reviews','swap_requests'].forEach(table => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRefresh);
    });
    channel.subscribe();
  }

  async function init() {
    client.auth.onAuthStateChange((event, nextSession) => {
      session = nextSession || null;
      if (event === 'SIGNED_OUT') clearCache();
    });
    let result;
    try { result = await client.auth.getSession(); }
    catch { await clearLocalSession(); return null; }
    if (result?.error) { await clearLocalSession(); return null; }
    session = result?.data?.session || null;
    if (session) {
      try {
        await loadAll();
        subscribe();
      } catch (error) {
        const message = String(error?.message || error || '').toLowerCase();
        if (message.includes('refresh token') || message.includes('jwt') || message.includes('session')) {
          await clearLocalSession();
          return null;
        }
        throw error;
      }
    }
    return current();
  }

  async function login(username, password) {
    // Een eerder gereset wachtwoord kan een oude refresh-token achterlaten.
    // Ruim die lokaal op voordat een nieuwe login wordt opgeslagen.
    await clearLocalSession();
    const result = await callFunction(cfg.loginFunctionName || 'username-login', {
      username: String(username || '').trim().toLowerCase(),
      password: String(password || '')
    }, false);
    if (!result?.access_token || !result?.refresh_token) {
      throw new Error('De server gaf geen geldige sessie terug. Probeer opnieuw.');
    }
    const set = await client.auth.setSession({
      access_token: result.access_token,
      refresh_token: result.refresh_token
    });
    if (set?.error) {
      await clearLocalSession();
      fail(set.error);
    }
    session = set?.data?.session || null;
    if (!session) throw new Error('De login kon niet worden opgeslagen. Probeer opnieuw.');
    await loadAll();
    subscribe();
    const me = current();
    if (!me?.active) {
      await logout();
      throw new Error('Dit account is geblokkeerd.');
    }
    return me;
  }

  async function register(input) {
    const result = await callFunction(cfg.registerFunctionName || 'self-register', {
      first_name: String(input.first_name || '').trim(),
      last_name: String(input.last_name || '').trim(),
      username: String(input.username || '').trim().toLowerCase(),
      password: String(input.password || ''),
      competition_code: String(input.competition_code || '').trim(),
      avatar_id: Math.max(1, Math.min(50, Number(input.avatar_id) || 1))
    }, false);
    return result;
  }

  async function logout() {
    try { await client.auth.signOut(); } catch {}
    await clearLocalSession();
  }

  function current() {
    return cache.users.find(u => u.id === session?.user?.id) || null;
  }
  function isAdmin() { return current()?.role === 'admin'; }
  function requireUser() {
    const me = current();
    if (!me) throw new Error('Je sessie is verlopen. Log opnieuw in.');
    return me;
  }
  function requireAdmin() {
    const me = requireUser();
    if (me.role !== 'admin') throw new Error('Alleen de beheerder mag dit doen.');
    return me;
  }
  function canHost(playday) {
    const me = current();
    return Boolean(me && (me.role === 'admin' || playday?.host_id === me.id));
  }

  const listUsers = () => clone(cache.users).sort((a,b) => a.display_name.localeCompare(b.display_name, 'nl'));
  const listPlaydays = () => clone(cache.playdays).sort((a,b) => a.date.localeCompare(b.date));
  const getPlayday = id => clone(cache.playdays.find(p => p.id === id) || null);
  const listRsvps = playdayId => clone(cache.rsvps.filter(r => !playdayId || r.playday_id === playdayId));
  const listSlots = playdayId => clone(cache.slots.filter(s => !playdayId || s.playday_id === playdayId));
  const listAttendance = playdayId => clone(cache.attendance.filter(a => a.playday_id === playdayId));
  const listMatches = playdayId => clone(cache.matches.filter(m => !playdayId || m.playday_id === playdayId));
  const listReviews = playdayId => clone(cache.reviews.filter(r => r.playday_id === playdayId));
  const listSwapRequests = () => clone(cache.swaps);

  async function createUser(input) {
    requireAdmin();
    await callFunction(cfg.adminFunctionName || 'admin-users', { action: 'create', ...input });
    return loadAll();
  }

  async function approveUser(id) {
    requireAdmin();
    await callFunction(cfg.adminFunctionName || 'admin-users', { action: 'approve', user_id: id });
    return loadAll();
  }

  async function rejectUser(id) {
    requireAdmin();
    await callFunction(cfg.adminFunctionName || 'admin-users', { action: 'reject', user_id: id });
    return loadAll();
  }

  async function updateRegistrationCode(code) {
    requireAdmin();
    await callFunction(cfg.adminFunctionName || 'admin-users', {
      action: 'update_registration_code',
      competition_code: String(code || '').trim()
    });
    return true;
  }

  async function updateUser(id, patch) {
    requireAdmin();
    const existing = cache.users.find(u => u.id === id);
    if (!existing) throw new Error('Speler niet gevonden.');
    await callFunction(cfg.adminFunctionName || 'admin-users', {
      action: 'update',
      user_id: id,
      username: patch.username ?? existing.username,
      display_name: patch.display_name ?? existing.display_name,
      active: patch.active ?? existing.active,
      avatar_id: Math.max(1, Math.min(50, Number(patch.avatar_id ?? existing.avatar_id) || 1))
    });
    return loadAll();
  }

  async function saveAvatar(avatarId) {
    requireUser();
    const value = Number(avatarId);
    if (!Number.isInteger(value) || value < 1 || value > 50) throw new Error('Kies een geldige avatar.');
    const result = await callFunction(cfg.adminFunctionName || 'admin-users', { action: 'update_own_avatar', avatar_id: value });
    await loadAll();
    if (Number(current()?.avatar_id) !== value || Number(result?.avatar_id) !== value) {
      throw new Error('De avatar kon niet worden opgeslagen. Probeer opnieuw.');
    }
    return current();
  }

  async function changePassword(oldPassword, newPassword) {
    requireUser();
    const result = await callFunction(cfg.adminFunctionName || 'admin-users', {
      action: 'change_own_password',
      old_password: oldPassword,
      new_password: newPassword
    });
    if (!result?.access_token || !result?.refresh_token) {
      await clearLocalSession();
      throw new Error('Het wachtwoord is gewijzigd. Log opnieuw in met je nieuwe wachtwoord.');
    }
    removeStoredSession();
    const set = await client.auth.setSession({
      access_token: result.access_token,
      refresh_token: result.refresh_token
    });
    if (set?.error || !set?.data?.session) {
      await clearLocalSession();
      throw new Error('Het wachtwoord is gewijzigd. Log opnieuw in met je nieuwe wachtwoord.');
    }
    session = set.data.session;
    return loadAll();
  }

  async function adminResetPassword(id, password) {
    requireAdmin();
    await callFunction(cfg.adminFunctionName || 'admin-users', {
      action: 'reset_password', user_id: id, password
    });
    return loadAll();
  }

  async function blockUser(id, active) {
    requireAdmin();
    await callFunction(cfg.adminFunctionName || 'admin-users', {
      action: 'block', user_id: id, active: Boolean(active)
    });
    return loadAll();
  }

  async function deleteUser(id) {
    requireAdmin();
    await callFunction(cfg.adminFunctionName || 'admin-users', {
      action: 'delete', user_id: id
    });
    return loadAll();
  }

  async function upsertPlayday(input) {
    requireAdmin();
    const row = denormalizePlayday(input);
    const query = input.id
      ? client.from('playdays').update(row).eq('id', input.id).select().single()
      : client.from('playdays').upsert(row, { onConflict: 'play_date' }).select().single();
    const { data, error } = await query;
    if (error) fail(error);
    if (!data?.id) throw new Error('De speeldag kon niet worden opgeslagen.');
    return loadAll();
  }

  async function deletePlayday(id) {
    requireAdmin();
    const { error } = await client.from('playdays').delete().eq('id', id);
    if (error) fail(error);
    return loadAll();
  }

  async function setRsvp(playdayId, response) {
    const me = requireUser();
    if (!['playing','not_playing'].includes(response)) throw new Error('Ongeldige keuze.');
    const attendance = cache.attendance.find(a => a.playday_id === playdayId && a.user_id === me.id);
    if (attendance && response !== 'playing') {
      throw new Error('Je bent al in de lobby. Je aanmelding kan voor deze speeldag niet meer worden gewijzigd.');
    }
    const { data, error } = await client.from('rsvps').upsert({
      playday_id: playdayId,
      user_id: me.id,
      response
    }, { onConflict: 'playday_id,user_id' }).select('*').single();
    if (error) fail(error);
    if (!data || data.user_id !== me.id || data.playday_id !== playdayId || data.response !== response) {
      throw new Error('Je keuze kon niet worden bevestigd. Probeer opnieuw.');
    }
    // The row returned by Supabase is the confirmed status. Keep it visible
    // immediately; realtime refreshes may update the rest of the screen later.
    loadSequence += 1;
    cache.rsvps = cache.rsvps.filter(r => !(r.playday_id === playdayId && r.user_id === me.id));
    cache.rsvps.push(data);
    emit();
    if (response !== 'playing') {
      const del = await client.from('attendance').delete().eq('playday_id', playdayId).eq('user_id', me.id);
      if (del.error) fail(del.error);
    }
    scheduleRefresh();
    return clone(data);
  }

  async function adminAssignPlaydayPlayer(playdayId, userId, placement, courtNumber=null) {
    requireAdmin();
    const { error } = await client.rpc('admin_assign_playday_player', { p_playday_id: playdayId, p_user_id: userId, p_placement: placement, p_court_number: courtNumber });
    if (error) fail(error);
    return loadAll();
  }

  async function adminRemovePlaydayPlayer(playdayId, userId) {
    requireAdmin();
    const { error } = await client.rpc('admin_remove_playday_player', { p_playday_id: playdayId, p_user_id: userId });
    if (error) fail(error);
    return loadAll();
  }

  async function setSlotPaid(slotId, paid) {
    requireAdmin();
    const slot = cache.slots.find(s => s.id === slotId);
    if (!slot) throw new Error('Baanplek niet gevonden.');
    const expected = Boolean(paid);
    const { data, error } = await client.from('playday_slots').update({ paid: expected }).eq('id', slotId).select('id,paid').single();
    if (error) fail(error);
    if (!data || data.id !== slotId || Boolean(data.paid) !== expected) throw new Error('De betaalstatus kon niet worden bevestigd.');
    await loadAll();
    const saved = cache.slots.find(s => s.id === slotId);
    if (!saved || Boolean(saved.paid) !== expected) throw new Error('De betaalstatus is niet bijgewerkt. Probeer opnieuw.');
    return saved;
  }

  async function enterLobby(playdayId) {
    const me = requireUser();
    const playday = cache.playdays.find(p => p.id === playdayId);
    if (!playday) throw new Error('Speeldag niet gevonden.');
    if (playday.date !== localDateISO()) throw new Error('De lobby is alleen op de speeldag geopend van 00:00 tot 23:59.');
    const rsvp = cache.rsvps.find(r => r.playday_id === playdayId && r.user_id === me.id);
    if (!canHost(playday) && rsvp?.response !== 'playing') throw new Error('Alleen aangemelde spelers kunnen de lobby in.');
    const { error } = await client.from('attendance').upsert({
      playday_id: playdayId,
      user_id: me.id,
      status: 'present'
    }, { onConflict: 'playday_id,user_id' });
    if (error) fail(error);
    return loadAll();
  }

  async function setReady(playdayId) {
    const me = requireUser();
    const attendance = cache.attendance.find(a => a.playday_id === playdayId && a.user_id === me.id);
    if (!attendance) throw new Error('Ga eerst de lobby in.');
    if (['ready','playing','done'].includes(attendance.status)) return attendance;
    const { error } = await client.from('attendance').update({
      status: 'ready', ready_at: new Date().toISOString()
    }).eq('playday_id', playdayId).eq('user_id', me.id);
    if (error) fail(error);
    return loadAll();
  }

  async function setAttendance(playdayId, userId, status) {
    const playday = cache.playdays.find(p => p.id === playdayId);
    if (!canHost(playday)) throw new Error('Alleen de host kan statussen beheren.');
    const { error } = await client.from('attendance').upsert({
      playday_id: playdayId, user_id: userId, status
    }, { onConflict: 'playday_id,user_id' });
    if (error) fail(error);
    return loadAll();
  }

  async function createMatch(input) {
    const playday = cache.playdays.find(p => p.id === input.playday_id);
    if (!canHost(playday)) throw new Error('Alleen de host of beheerder kan wedstrijden maken.');
    if (playday.date !== localDateISO()) throw new Error('Wedstrijden kunnen pas op de speeldag worden gemaakt.');
    const ids = [input.blue_player_1,input.blue_player_2,input.red_player_1,input.red_player_2];
    if (new Set(ids).size !== 4 || ids.some(x => !x)) throw new Error('Kies vier verschillende spelers.');
    if (cache.matches.some(m => m.playday_id === playday.id && m.court_number === Number(input.court_number) && m.status === 'active' && m.started_at && !m.deleted_at)) {
      throw new Error('Op deze baan is al een wedstrijd bezig.');
    }
    const row = {
      playday_id: playday.id,
      court_number: Number(input.court_number),
      blue_player_1: ids[0], blue_player_2: ids[1],
      red_player_1: ids[2], red_player_2: ids[3],
      status: 'active',
      started_at: null,
      score_state: PadelScoring.freshScore(),
      blue_games: 0, red_games: 0,
      set_completed: false, timed_out: false, winner_team: null
    };
    const inserted = await client.from('matches').insert(row).select().single();
    if (inserted.error) fail(inserted.error);
    await client.from('playdays').update({ session_status: 'open' }).eq('id', playday.id);
    return loadAll();
  }

  function enqueueMatch(id, task) {
    const previous = scoreQueues.get(id) || Promise.resolve();
    const next = previous.then(task, task).finally(() => {
      if (scoreQueues.get(id) === next) scoreQueues.delete(id);
    });
    scoreQueues.set(id, next);
    return next;
  }

  async function updateMatchScore(id, score) {
    const match = cache.matches.find(m => m.id === id);
    const playday = match && cache.playdays.find(p => p.id === match.playday_id);
    if (!match || !canHost(playday)) throw new Error('Geen toegang tot deze wedstrijd.');
    match.score_state = clone(score);
    match.blue_games = score.blueGames;
    match.red_games = score.redGames;
    emit();
    return enqueueMatch(id, async () => {
      const { error } = await client.from('matches').update({
        score_state: score,
        blue_games: score.blueGames,
        red_games: score.redGames
      }).eq('id', id).eq('status', 'active');
      if (error) {
        await loadAll();
        fail(error);
      }
      return true;
    });
  }

  async function finishMatch(id, payload) {
    const match = cache.matches.find(m => m.id === id);
    const playday = match && cache.playdays.find(p => p.id === match.playday_id);
    if (!match || !canHost(playday)) throw new Error('Geen toegang tot deze wedstrijd.');
    Object.assign(match, payload, { status: 'finished', ended_at: new Date().toISOString() });
    emit();
    return enqueueMatch(id, async () => {
      const matchUpdate = await client.from('matches').update({
        status: 'finished',
        blue_games: payload.blue_games,
        red_games: payload.red_games,
        point_snapshot: payload.point_snapshot,
        set_completed: payload.set_completed,
        timed_out: payload.timed_out,
        winner_team: payload.winner_team,
        ended_at: new Date().toISOString()
      }).eq('id', id);
      if (matchUpdate.error) fail(matchUpdate.error);
      return loadAll();
    });
  }

  async function setLiveScoring(playdayId, enabled) {
    const playday = cache.playdays.find(p => p.id === playdayId);
    if (!playday || !canHost(playday)) throw new Error('Alleen de host of beheerder kan live score wijzigen.');
    if (playday.date !== localDateISO()) throw new Error('Live score kan alleen op de speeldag worden gewijzigd.');
    const value = Boolean(enabled);
    const activeIds = cache.matches.filter(m => m.playday_id === playdayId && m.status === 'active' && m.started_at && !m.deleted_at).map(m => m.id);
    if (activeIds.length) {
      const reset = PadelScoring.freshScore();
      const resetResult = await client.from('matches').update({ score_state: reset, blue_games: 0, red_games: 0 }).in('id', activeIds);
      if (resetResult.error) fail(resetResult.error);
    }
    const { error } = await client.from('playdays').update({ live_scoring_enabled: value }).eq('id', playdayId);
    if (error) fail(error);
    return loadAll();
  }

  async function finishMatchManual(id, blueGames, redGames) {
    const blue = Math.max(0, Number(blueGames) || 0);
    const red = Math.max(0, Number(redGames) || 0);
    if (blue === red) throw new Error('De einduitslag kan niet gelijk zijn.');
    return finishMatch(id, {
      blue_games: blue,
      red_games: red,
      point_snapshot: null,
      set_completed: true,
      timed_out: false,
      winner_team: blue > red ? 'blue' : 'red'
    });
  }

  async function requestSwap(playdayId, toUserId) {
    requireUser();
    const { error } = await client.rpc('request_playday_swap', { p_playday_id: playdayId, p_to_user_id: toUserId });
    if (error) fail(error);
    return loadAll();
  }

  async function respondSwap(requestId, accept) {
    requireUser();
    const { error } = await client.rpc('respond_playday_swap', { p_request_id: requestId, p_accept: Boolean(accept) });
    if (error) fail(error);
    return loadAll();
  }

  async function createRoundRobinMatches(playdayId, courtNumber, ids) {
    const playday = cache.playdays.find(p => p.id === playdayId);
    if (!canHost(playday)) throw new Error('Alleen de host of beheerder kan wedstrijden maken.');
    if (playday.date !== localDateISO()) throw new Error('Wedstrijden kunnen pas op de speeldag worden gemaakt.');
    if (!Array.isArray(ids) || ids.length !== 4 || new Set(ids).size !== 4) throw new Error('Er zijn precies vier verschillende spelers nodig.');
    const [a,b,c,d]=ids;
    const rows=[[a,b,c,d],[a,c,b,d],[a,d,b,c]].map(x=>({playday_id:playdayId,court_number:Number(courtNumber),blue_player_1:x[0],blue_player_2:x[1],red_player_1:x[2],red_player_2:x[3],status:'active',started_at:null,score_state:PadelScoring.freshScore(),blue_games:0,red_games:0,set_completed:false,timed_out:false,winner_team:null}));
    const { error } = await client.from('matches').insert(rows);
    if (error) fail(error);
    return loadAll();
  }

  async function startMatch(id) {
    const match=cache.matches.find(m=>m.id===id),playday=match&&cache.playdays.find(p=>p.id===match.playday_id);
    if(!match||!canHost(playday)) throw new Error('Geen toegang tot deze wedstrijd.');
    if(playday.date !== localDateISO()) throw new Error('Een wedstrijd kan alleen op de speeldag worden gestart.');
    if(match.status === 'finished' || match.started_at) throw new Error('Deze wedstrijd staat niet meer klaar om te starten.');
    if(cache.matches.some(m=>m.playday_id===match.playday_id&&m.court_number===match.court_number&&m.status==='active'&&m.started_at&&!m.deleted_at)) throw new Error('Rond eerst de actieve wedstrijd op deze baan af.');
    const {error}=await client.from('matches').update({status:'active',started_at:new Date().toISOString(),score_state:PadelScoring.freshScore(),blue_games:0,red_games:0}).eq('id',id);
    if(error) fail(error);return loadAll();
  }

  async function resetStatistics() {
    requireAdmin();
    await callFunction(cfg.adminFunctionName || 'admin-users', { action: 'reset_statistics' });
    return loadAll();
  }

  async function fullReset() {
    requireAdmin();
    await callFunction(cfg.adminFunctionName || 'admin-users', { action: 'full_reset', confirmation: 'RESETTEN' });
    return loadAll();
  }

  async function deleteMatch(id) {
    const me = requireUser();
    const match = cache.matches.find(m => m.id === id);
    const playday = match && cache.playdays.find(p => p.id === match.playday_id);
    if (!match || !playday) throw new Error('Wedstrijd niet gevonden.');
    const allowed = me.role === 'admin' || (playday.host_id === me.id && playday.date === localDateISO());
    if (!allowed) throw new Error('Na de speeldag kan alleen de beheerder een wedstrijd verwijderen.');
    const { error } = await client.from('matches').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) fail(error);
    return loadAll();
  }

  async function endSession(playdayId) {
    const playday = cache.playdays.find(p => p.id === playdayId);
    if (!canHost(playday)) throw new Error('Alleen de host kan afsluiten.');
    if (cache.matches.some(m => m.playday_id === playdayId && m.status === 'active' && m.started_at && !m.deleted_at)) {
      throw new Error('Rond eerst alle actieve wedstrijden af.');
    }
    const reviewDelete = await client.from('session_reviews').delete().eq('playday_id', playdayId);
    if (reviewDelete.error) fail(reviewDelete.error);
    const attendanceUpdate = await client.from('attendance').update({ status: 'done' }).eq('playday_id', playdayId);
    if (attendanceUpdate.error) fail(attendanceUpdate.error);
    const playdayUpdate = await client.from('playdays').update({
      session_status: 'review', review_started_at: new Date().toISOString()
    }).eq('id', playdayId);
    if (playdayUpdate.error) fail(playdayUpdate.error);
    return loadAll();
  }

  async function reviewSession(playdayId, decision, note = '') {
    const me = requireUser();
    const playday = cache.playdays.find(p => p.id === playdayId);
    if (playday?.session_status !== 'review') throw new Error('Deze sessie staat niet ter beoordeling.');
    if (!cache.attendance.some(a => a.playday_id === playdayId && a.user_id === me.id)) {
      throw new Error('Je hebt niet meegedaan aan deze speeldag.');
    }
    const { error } = await client.from('session_reviews').upsert({
      playday_id: playdayId, user_id: me.id, decision, note
    }, { onConflict: 'playday_id,user_id' });
    if (error) fail(error);
    return loadAll();
  }

  async function resolveSession(playdayId) {
    const playday = cache.playdays.find(p => p.id === playdayId);
    if (!canHost(playday) || playday.session_status !== 'host_review') throw new Error('Geen openstaande hostcontrole.');
    const { error } = await client.from('playdays').update({
      session_status: 'approved', status: 'closed', approved_at: new Date().toISOString()
    }).eq('id', playdayId);
    if (error) fail(error);
    return loadAll();
  }

  window.PadelDB = {
    mode: 'online', client, init, login, register, logout, current, isAdmin, canHost,
    listUsers, createUser, approveUser, rejectUser, updateUser, saveAvatar, updateRegistrationCode, changePassword, adminResetPassword, blockUser, deleteUser,
    listPlaydays, getPlayday, upsertPlayday, deletePlayday,
    setRsvp, listRsvps, listSlots, setSlotPaid, adminAssignPlaydayPlayer, adminRemovePlaydayPlayer, enterLobby, setReady, listAttendance, setAttendance,
    listMatches, createMatch, createRoundRobinMatches, startMatch, updateMatchScore, finishMatch, finishMatchManual, setLiveScoring, deleteMatch,
    listSwapRequests, requestSwap, respondSwap, resetStatistics, fullReset,
    endSession, reviewSession, resolveSession, listReviews,
    refresh: loadAll
  };
})();
