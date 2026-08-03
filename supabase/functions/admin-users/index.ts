const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
});

const envKey = (modern: string, legacy: string) => {
  const direct = Deno.env.get(legacy);
  if (direct) return direct;
  try {
    const keys = JSON.parse(Deno.env.get(modern) || '{}');
    return keys.default || Object.values(keys)[0] || '';
  } catch {
    return '';
  }
};

const sha256 = async (value: string) => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL') || '';
  const secret = envKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  const publishable = envKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
  if (!url || !secret || !publishable) return json({ error: 'Server configuration missing' }, 500);

  const bearer = req.headers.get('authorization');
  if (!bearer) return json({ error: 'Not authenticated' }, 401);
  const adminHeaders = {
    apikey: secret,
    authorization: `Bearer ${secret}`,
    'content-type': 'application/json',
  };
  const meRes = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: publishable, authorization: bearer },
  });
  if (!meRes.ok) return json({ error: 'Invalid session' }, 401);
  const me = await meRes.json();
  const body = await req.json().catch(() => null);
  if (!body?.action) return json({ error: 'Missing action' }, 400);

  if (body.action === 'change_own_password') {
    const oldPassword = String(body.old_password || '');
    const newPassword = String(body.new_password || '');
    if (newPassword.length < 8 || newPassword.length > 128) {
      return json({ error: 'Het nieuwe wachtwoord moet minimaal 8 tekens hebben.' }, 400);
    }
    const verify = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: publishable, 'content-type': 'application/json' },
      body: JSON.stringify({ email: me.email, password: oldPassword }),
    });
    if (!verify.ok) return json({ error: 'Het huidige wachtwoord klopt niet.' }, 400);

    const metadata = { ...(me.app_metadata || {}), must_change_password: false };
    const update = await fetch(`${url}/auth/v1/admin/users/${me.id}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ password: newPassword, app_metadata: metadata }),
    });
    if (!update.ok) return json({ error: 'Wachtwoord wijzigen is mislukt.' }, update.status);
    await fetch(`${url}/rest/v1/profiles?id=eq.${me.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ must_change_password: false }),
    });

    const freshRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: publishable, 'content-type': 'application/json' },
      body: JSON.stringify({ email: me.email, password: newPassword }),
    });
    const fresh = await freshRes.json().catch(() => null);
    if (!freshRes.ok || !fresh?.access_token || !fresh?.refresh_token) {
      return json({ error: 'Wachtwoord gewijzigd, maar de nieuwe sessie kon niet worden gestart. Log opnieuw in.' }, 409);
    }
    return json({ ok: true, access_token: fresh.access_token, refresh_token: fresh.refresh_token, expires_in: fresh.expires_in, token_type: fresh.token_type });
  }

  if (body.action === 'update_own_avatar') {
    const avatarId = Number(body.avatar_id);
    if (!Number.isInteger(avatarId) || avatarId < 1 || avatarId > 50) {
      return json({ error: 'Kies een geldige avatar.' }, 400);
    }
    const profileUpdate = await fetch(`${url}/rest/v1/profiles?id=eq.${me.id}`, {
      method: 'PATCH',
      headers: { ...adminHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({ avatar_id: avatarId }),
    });
    const updatedProfiles = await profileUpdate.json().catch(() => []);
    if (!profileUpdate.ok || Number(updatedProfiles?.[0]?.avatar_id) !== avatarId) {
      return json({ error: 'Avatar wijzigen is mislukt.' }, profileUpdate.ok ? 500 : profileUpdate.status);
    }
    const metadata = { ...(me.user_metadata || {}), avatar_id: avatarId };
    const authUpdate = await fetch(`${url}/auth/v1/admin/users/${me.id}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ user_metadata: metadata }),
    });
    if (!authUpdate.ok) return json({ error: 'Avatar is opgeslagen, maar de accountgegevens konden niet worden ververst.' }, 500);
    return json({ ok: true, avatar_id: avatarId });
  }

  if (me?.app_metadata?.role !== 'admin') return json({ error: 'Admin required' }, 403);

  if (body.action === 'update_registration_code') {
    const competitionCode = String(body.competition_code || '').trim();
    if (competitionCode.length < 6 || competitionCode.length > 80) {
      return json({ error: 'De competitiecode moet 6–80 tekens hebben.' }, 400);
    }
    const meProfileRes = await fetch(`${url}/rest/v1/profiles?id=eq.${me.id}&select=competition_id&limit=1`, { headers: adminHeaders });
    const meProfiles = await meProfileRes.json().catch(() => []);
    const competitionId = meProfiles?.[0]?.competition_id;
    if (!meProfileRes.ok || !competitionId) return json({ error: 'Competitie niet gevonden.' }, 404);
    const settingRes = await fetch(`${url}/rest/v1/registration_settings?competition_id=eq.${competitionId}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ code_hash: await sha256(competitionCode), enabled: true, updated_at: new Date().toISOString(), updated_by: me.id }),
    });
    return settingRes.ok ? json({ ok: true }) : json({ error: 'Competitiecode wijzigen is mislukt.' }, settingRes.status);
  }

  if (body.action === 'reset_statistics') {
    const rpc = await fetch(`${url}/rest/v1/rpc/reset_all_statistics`, {
      method: 'POST',
      headers: { apikey: publishable, authorization: bearer, 'content-type': 'application/json' },
      body: '{}',
    });
    const details = await rpc.json().catch(() => null);
    if (!rpc.ok) return json({ error: details?.message || details?.error || 'Statistieken resetten is mislukt.' }, rpc.status);
    return json({ ok: true });
  }

  if (body.action === 'full_reset') {
    if (String(body.confirmation || '').trim().toUpperCase() !== 'RESETTEN') {
      return json({ error: 'Typ RESETTEN om de volledige reset te bevestigen.' }, 400);
    }

    const meProfileRes = await fetch(`${url}/rest/v1/profiles?id=eq.${me.id}&select=competition_id&limit=1`, { headers: adminHeaders });
    const meProfiles = await meProfileRes.json().catch(() => []);
    const competitionId = meProfiles?.[0]?.competition_id;
    if (!meProfileRes.ok || !competitionId) return json({ error: 'Competitie niet gevonden.' }, 404);

    const playersRes = await fetch(`${url}/rest/v1/profiles?competition_id=eq.${competitionId}&id=neq.${me.id}&select=id`, { headers: adminHeaders });
    const playerRows = await playersRes.json().catch(() => []);
    if (!playersRes.ok) return json({ error: 'Testaccounts ophalen is mislukt.' }, playersRes.status);
    const playerIds = playerRows.map((row: { id?: string }) => String(row.id || '')).filter(Boolean);

    const rpc = await fetch(`${url}/rest/v1/rpc/reset_competition_completely`, {
      method: 'POST',
      headers: { apikey: publishable, authorization: bearer, 'content-type': 'application/json' },
      body: '{}',
    });
    const details = await rpc.json().catch(() => null);
    if (!rpc.ok) return json({ error: details?.message || details?.error || 'Competitie leegmaken is mislukt.' }, rpc.status);

    const failed: string[] = [];
    for (const id of playerIds) {
      const remove = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: adminHeaders });
      if (!remove.ok && remove.status !== 404) failed.push(id);
    }
    if (failed.length) return json({ error: `De competitiegegevens zijn gewist, maar ${failed.length} loginaccount(s) konden niet worden verwijderd.` }, 500);
    return json({ ok: true, removed_users: playerIds.length });
  }

  const username = String(body.username || '').trim().toLowerCase();
  const displayName = String(body.display_name || username).trim().replace(/\s+/g, ' ');
  const email = username ? `${username}@padelscore.local` : '';
  const avatarId = Number(body.avatar_id || 1);

  if (body.action === 'create') {
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) return json({ error: 'Gebruikersnaam is ongeldig.' }, 400);
    if (displayName.length < 2 || displayName.length > 100) return json({ error: 'Naam is ongeldig.' }, 400);
    if (String(body.password || '').length < 8) return json({ error: 'Wachtwoord moet minimaal 8 tekens hebben.' }, 400);
    if (!Number.isInteger(avatarId) || avatarId < 1 || avatarId > 50) return json({ error: 'Kies een geldige avatar.' }, 400);

    const create = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        email,
        password: body.password,
        email_confirm: true,
        user_metadata: { display_name: displayName, avatar_id: avatarId },
        app_metadata: { role: 'player', username, must_change_password: true, approval_status: 'approved' },
      }),
    });
    const authUser = await create.json().catch(() => null);
    if (!create.ok || !authUser?.id) return json({ error: authUser?.msg || authUser?.message || 'Speler aanmaken is mislukt.' }, create.status);

    const compRes = await fetch(`${url}/rest/v1/profiles?id=eq.${me.id}&select=competition_id&limit=1`, { headers: adminHeaders });
    const comps = await compRes.json().catch(() => []);
    const competitionId = comps?.[0]?.competition_id;
    if (!compRes.ok || !competitionId) {
      await fetch(`${url}/auth/v1/admin/users/${authUser.id}`, { method: 'DELETE', headers: adminHeaders });
      return json({ error: 'Competitie ontbreekt.' }, 500);
    }
    const profile = await fetch(`${url}/rest/v1/profiles`, {
      method: 'POST',
      headers: { ...adminHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({ id: authUser.id, competition_id: competitionId, username, display_name: displayName, role: 'player', active: true, must_change_password: true, approval_status: 'approved', requested_at: new Date().toISOString(), avatar_id: avatarId }),
    });
    if (!profile.ok) {
      await fetch(`${url}/auth/v1/admin/users/${authUser.id}`, { method: 'DELETE', headers: adminHeaders });
      return json({ error: 'Spelersprofiel aanmaken is mislukt.' }, 500);
    }
    return json({ user_id: authUser.id }, 201);
  }

  const userId = String(body.user_id || '');
  if (!userId) return json({ error: 'Speler ontbreekt.' }, 400);
  const profileRes = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}&select=*`, { headers: adminHeaders });
  const profiles = await profileRes.json().catch(() => []);
  const profile = profiles?.[0];
  if (!profileRes.ok || !profile) return json({ error: 'Speler niet gevonden.' }, 404);
  if (profile.role === 'admin') return json({ error: 'Het beheerdersaccount kan hier niet worden aangepast.' }, 400);
  const adminProfileRes = await fetch(`${url}/rest/v1/profiles?id=eq.${me.id}&select=competition_id&limit=1`, { headers: adminHeaders });
  const adminProfiles = await adminProfileRes.json().catch(() => []);
  if (!adminProfileRes.ok || !adminProfiles?.[0]?.competition_id || adminProfiles[0].competition_id !== profile.competition_id) {
    return json({ error: 'Geen toegang tot deze speler.' }, 403);
  }

  const authRes = await fetch(`${url}/auth/v1/admin/users/${userId}`, { headers: adminHeaders });
  const authUser = await authRes.json().catch(() => null);
  if (!authRes.ok || !authUser) return json({ error: 'Auth-account niet gevonden.' }, 404);

  if (body.action === 'approve' || body.action === 'reject') {
    const approved = body.action === 'approve';
    const appMetadata = { ...(authUser.app_metadata || {}), role: 'player', approval_status: approved ? 'approved' : 'rejected' };
    const updateAuth = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ app_metadata: appMetadata }),
    });
    if (!updateAuth.ok) return json({ error: 'Accountstatus bijwerken is mislukt.' }, updateAuth.status);
    const updateProfile = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ active: approved, approval_status: approved ? 'approved' : 'rejected', deleted_at: approved ? null : new Date().toISOString() }),
    });
    return updateProfile.ok ? json({ ok: true }) : json({ error: 'Profielstatus bijwerken is mislukt.' }, updateProfile.status);
  }

  if (body.action === 'update') {
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) return json({ error: 'Gebruikersnaam is ongeldig.' }, 400);
    if (!Number.isInteger(avatarId) || avatarId < 1 || avatarId > 50) return json({ error: 'Kies een geldige avatar.' }, 400);
    if (displayName.length < 2 || displayName.length > 100) return json({ error: 'Naam is ongeldig.' }, 400);
    const active = body.active !== false;
    const appMetadata = { ...(authUser.app_metadata || {}), role: 'player', username, approval_status: 'approved' };
    const updateAuth = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ email, email_confirm: true, ban_duration: active ? 'none' : '876000h', user_metadata: { ...(authUser.user_metadata || {}), display_name: displayName, avatar_id: avatarId }, app_metadata: appMetadata }),
    });
    if (!updateAuth.ok) return json({ error: 'Account bijwerken is mislukt.' }, updateAuth.status);
    const updateProfile = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ username, display_name: displayName, active, approval_status: 'approved', deleted_at: active ? null : new Date().toISOString(), avatar_id: avatarId }),
    });
    return updateProfile.ok ? json({ ok: true }) : json({ error: 'Profiel bijwerken is mislukt.' }, updateProfile.status);
  }

  if (body.action === 'reset_password') {
    const password = String(body.password || '');
    if (password.length < 8 || password.length > 128) return json({ error: 'Wachtwoord moet minimaal 8 tekens hebben.' }, 400);
    const appMetadata = { ...(authUser.app_metadata || {}), role: 'player', must_change_password: true };
    const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ password, app_metadata: appMetadata }),
    });
    if (!res.ok) return json({ error: 'Resetten is mislukt.' }, res.status);
    await fetch(`${url}/rest/v1/profiles?id=eq.${userId}`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ must_change_password: true }) });
    return json({ ok: true });
  }

  if (body.action === 'block') {
    const active = Boolean(body.active);
    const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ ban_duration: active ? 'none' : '876000h' }),
    });
    if (!res.ok) return json({ error: 'Toegang bijwerken is mislukt.' }, res.status);
    await fetch(`${url}/rest/v1/profiles?id=eq.${userId}`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ active, deleted_at: active ? null : new Date().toISOString() }) });
    return json({ ok: true });
  }

  if (body.action === 'delete') {
    if (userId === me.id) return json({ error: 'Je kunt je eigen beheerdersaccount niet verwijderen.' }, 400);
    const matchFilter = encodeURIComponent(`(blue_player_1.eq.${userId},blue_player_2.eq.${userId},red_player_1.eq.${userId},red_player_2.eq.${userId})`);
    const [hostRes, matchRes] = await Promise.all([
      fetch(`${url}/rest/v1/playdays?host_id=eq.${userId}&select=id&limit=1`, { headers: adminHeaders }),
      fetch(`${url}/rest/v1/matches?or=${matchFilter}&select=id&limit=1`, { headers: adminHeaders }),
    ]);
    const [hostRows, matchRows] = await Promise.all([
      hostRes.json().catch(() => []),
      matchRes.json().catch(() => []),
    ]);
    if (!hostRes.ok || !matchRes.ok) return json({ error: 'Accountgebruik controleren is mislukt.' }, 500);
    if (hostRows.length || matchRows.length) {
      return json({ error: 'Dit account heeft speeldagen of wedstrijdhistorie. Blokkeer het account om de uitslagen te behouden.' }, 409);
    }

    const cleanup = await Promise.all(['rsvps', 'attendance', 'session_reviews'].map((table) =>
      fetch(`${url}/rest/v1/${table}?user_id=eq.${userId}`, { method: 'DELETE', headers: adminHeaders })
    ));
    if (cleanup.some((response) => !response.ok)) return json({ error: 'Gekoppelde aanmeldingen verwijderen is mislukt.' }, 500);

    const remove = await fetch(`${url}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: adminHeaders });
    if (!remove.ok) return json({ error: 'Account verwijderen is mislukt.' }, remove.status);
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
});
