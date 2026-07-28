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
  const scoreQueues = new Map();
  const cache = {
    competition: null,
    users: [],
    playdays: [],
    rsvps: [],
    attendance: [],
    matches: [],
    reviews: []
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
    host_id: input.host_id,
    court_count: Math.max(1, Number(input.court_count) || 1),
    status: input.status || 'planned',
    cost_per_player: input.cost_per_player ?? null,
    tikkie_url: input.tikkie_url || ''
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
    const requests = await Promise.all([
      client.from('competition').select('*').limit(1).maybeSingle(),
      client.from('profiles').select('*').order('display_name'),
      client.from('playdays').select('*').order('play_date'),
      client.from('rsvps').select('*'),
      client.from('attendance').select('*'),
      client.from('matches').select('*').order('started_at', { ascending: false }),
      client.from('session_reviews').select('*')
    ]);
    const firstError = requests.find(r => r.error)?.error;
    if (firstError) fail(firstError);
    cache.competition = requests[0].data || null;
    cache.users = requests[1].data || [];
    cache.playdays = (requests[2].data || []).map(normalizePlayday);
    cache.rsvps = requests[3].data || [];
    cache.attendance = requests[4].data || [];
    cache.matches = (requests[5].data || []).map(m => ({
      ...m,
      score_state: m.score_state && Object.keys(m.score_state).length ? m.score_state : PadelScoring.freshScore()
    }));
    cache.reviews = requests[6].data || [];
    emit();
    return current();
  }

  function clearCache() {
    cache.competition = null;
    cache.users = [];
    cache.playdays = [];
    cache.rsvps = [];
    cache.attendance = [];
    cache.matches = [];
    cache.reviews = [];
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
    ['profiles','playdays','rsvps','attendance','matches','session_reviews'].forEach(table => {
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
  const listAttendance = playdayId => clone(cache.attendance.filter(a => a.playday_id === playdayId));
  const listMatches = playdayId => clone(cache.matches.filter(m => !playdayId || m.playday_id === playdayId));
  const listReviews = playdayId => clone(cache.reviews.filter(r => r.playday_id === playdayId));

  async function createUser(input) {
    requireAdmin();
    await callFunction(cfg.adminFunctionName || 'admin-users', { action: 'create', ...input });
    return loadAll();
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
      active: patch.active ?? existing.active
    });
    return loadAll();
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

  async function deleteUser(id) {
    requireAdmin();
    await callFunction(cfg.adminFunctionName || 'admin-users', {
      action: 'block', user_id: id, active: false
    });
    return loadAll();
  }

  async function upsertPlayday(input) {
    requireAdmin();
    const row = denormalizePlayday(input);
    const query = input.id
      ? client.from('playdays').update(row).eq('id', input.id).select().single()
      : client.from('playdays').insert(row).select().single();
    const { error } = await query;
    if (error) fail(error);
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
    const { error } = await client.from('rsvps').upsert({
      playday_id: playdayId,
      user_id: me.id,
      response
    }, { onConflict: 'playday_id,user_id' });
    if (error) fail(error);
    if (response !== 'playing') {
      const del = await client.from('attendance').delete().eq('playday_id', playdayId).eq('user_id', me.id);
      if (del.error) fail(del.error);
    }
    return loadAll();
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
    if (!canHost(playday)) throw new Error('Alleen de host kan wedstrijden maken.');
    const ids = [input.blue_player_1,input.blue_player_2,input.red_player_1,input.red_player_2];
    if (new Set(ids).size !== 4 || ids.some(x => !x)) throw new Error('Kies vier verschillende spelers.');
    if (cache.matches.some(m => m.playday_id === playday.id && m.court_number === Number(input.court_number) && m.status === 'active' && !m.deleted_at)) {
      throw new Error('Op deze baan is al een wedstrijd bezig.');
    }
    for (const id of ids) {
      const a = cache.attendance.find(x => x.playday_id === playday.id && x.user_id === id);
      if (!a || a.status !== 'ready') throw new Error('Alle gekozen spelers moeten READY zijn.');
    }
    const row = {
      playday_id: playday.id,
      court_number: Number(input.court_number),
      blue_player_1: ids[0], blue_player_2: ids[1],
      red_player_1: ids[2], red_player_2: ids[3],
      status: 'active',
      score_state: PadelScoring.freshScore(),
      blue_games: 0, red_games: 0,
      set_completed: false, timed_out: false, winner_team: null
    };
    const inserted = await client.from('matches').insert(row).select().single();
    if (inserted.error) fail(inserted.error);
    const attendanceUpdate = await client.from('attendance').update({ status: 'playing' })
      .eq('playday_id', playday.id).in('user_id', ids);
    if (attendanceUpdate.error) {
      await client.from('matches').delete().eq('id', inserted.data.id);
      fail(attendanceUpdate.error);
    }
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
    const ids = [match.blue_player_1,match.blue_player_2,match.red_player_1,match.red_player_2];
    cache.attendance.filter(a => a.playday_id === match.playday_id && ids.includes(a.user_id)).forEach(a => a.status = 'ready');
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
      const attendanceUpdate = await client.from('attendance').update({ status: 'ready' })
        .eq('playday_id', match.playday_id).in('user_id', ids);
      if (attendanceUpdate.error) fail(attendanceUpdate.error);
      return loadAll();
    });
  }

  async function deleteMatch(id) {
    const match = cache.matches.find(m => m.id === id);
    const playday = match && cache.playdays.find(p => p.id === match.playday_id);
    if (!match || !canHost(playday)) throw new Error('Geen toegang.');
    const { error } = await client.from('matches').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    if (error) fail(error);
    return loadAll();
  }

  async function endSession(playdayId) {
    const playday = cache.playdays.find(p => p.id === playdayId);
    if (!canHost(playday)) throw new Error('Alleen de host kan afsluiten.');
    if (cache.matches.some(m => m.playday_id === playdayId && m.status === 'active' && !m.deleted_at)) {
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
    mode: 'online', client, init, login, logout, current, isAdmin, canHost,
    listUsers, createUser, updateUser, changePassword, adminResetPassword, deleteUser,
    listPlaydays, getPlayday, upsertPlayday, deletePlayday,
    setRsvp, listRsvps, enterLobby, setReady, listAttendance, setAttendance,
    listMatches, createMatch, updateMatchScore, finishMatch, deleteMatch,
    endSession, reviewSession, resolveSession, listReviews,
    refresh: loadAll
  };
})();
