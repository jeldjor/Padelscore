const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, content-type, x-client-info',
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
  if (!url || !secret) return json({ error: 'Server configuration missing' }, 500);

  const body = await req.json().catch(() => null);
  const firstName = String(body?.first_name || '').trim().replace(/\s+/g, ' ');
  const lastName = String(body?.last_name || '').trim().replace(/\s+/g, ' ');
  const username = String(body?.username || '').trim().toLowerCase();
  const password = String(body?.password || '');
  const competitionCode = String(body?.competition_code || '').trim();
  const avatarId = Number(body?.avatar_id);

  if (firstName.length < 2 || firstName.length > 40 || lastName.length < 2 || lastName.length > 60) {
    return json({ error: 'Vul een geldige voor- en achternaam in.' }, 400);
  }
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
    return json({ error: 'Gebruik 3–30 kleine letters, cijfers, punten, streepjes of underscores voor je gebruikersnaam.' }, 400);
  }
  if (password.length < 8 || password.length > 128) {
    return json({ error: 'Het wachtwoord moet minimaal 8 tekens hebben.' }, 400);
  }
  if (competitionCode.length < 6 || competitionCode.length > 80) {
    return json({ error: 'De competitiecode is onjuist.' }, 400);
  }
  if (!Number.isInteger(avatarId) || avatarId < 1 || avatarId > 50) {
    return json({ error: 'Kies een geldige avatar.' }, 400);
  }

  const adminHeaders = {
    apikey: secret,
    authorization: `Bearer ${secret}`,
    'content-type': 'application/json',
  };
  const settingsRes = await fetch(`${url}/rest/v1/registration_settings?select=competition_id,code_hash,enabled&limit=1`, {
    headers: adminHeaders,
  });
  const settings = await settingsRes.json().catch(() => []);
  const setting = settings?.[0];
  if (!settingsRes.ok || !setting?.competition_id || !setting.enabled) {
    return json({ error: 'Zelfregistratie is momenteel niet beschikbaar.' }, 503);
  }
  if (await sha256(competitionCode) !== setting.code_hash) {
    return json({ error: 'De competitiecode is onjuist.' }, 400);
  }

  const existsRes = await fetch(`${url}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id&limit=1`, {
    headers: adminHeaders,
  });
  const existing = await existsRes.json().catch(() => []);
  if (!existsRes.ok) return json({ error: 'De registratie kon niet worden gecontroleerd.' }, 500);
  if (existing?.length) return json({ error: 'Deze gebruikersnaam is al in gebruik.' }, 409);

  const displayName = `${firstName} ${lastName}`;
  const email = `${username}@padelscore.local`;
  const createRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName, display_name: displayName, avatar_id: avatarId },
      app_metadata: { role: 'player', username, must_change_password: false, approval_status: 'pending' },
    }),
  });
  const authUser = await createRes.json().catch(() => null);
  if (!createRes.ok || !authUser?.id) {
    const message = String(authUser?.msg || authUser?.message || '');
    return json({ error: /already|registered|exists/i.test(message) ? 'Deze gebruikersnaam is al in gebruik.' : 'Account aanmaken is mislukt.' }, createRes.status || 500);
  }

  const profileRes = await fetch(`${url}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...adminHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({
      id: authUser.id,
      competition_id: setting.competition_id,
      username,
      display_name: displayName,
      role: 'player',
      active: false,
      must_change_password: false,
      approval_status: 'pending',
      requested_at: new Date().toISOString(),
      avatar_id: avatarId,
    }),
  });
  if (!profileRes.ok) {
    await fetch(`${url}/auth/v1/admin/users/${authUser.id}`, { method: 'DELETE', headers: adminHeaders });
    return json({ error: 'Spelersprofiel aanmaken is mislukt.' }, 500);
  }

  return json({ ok: true, status: 'pending' }, 201);
});
