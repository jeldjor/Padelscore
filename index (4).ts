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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL') || '';
  const secret = envKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  const publishable = envKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
  if (!url || !secret || !publishable) return json({ error: 'Server configuration missing' }, 500);

  const body = await req.json().catch(() => null);
  const username = String(body?.username || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!/^[a-z0-9._-]{3,30}$/.test(username) || !password) {
    return json({ error: 'Gebruikersnaam of wachtwoord is onjuist.' }, 401);
  }

  const adminHeaders = { apikey: secret, authorization: `Bearer ${secret}` };
  const profileRes = await fetch(`${url}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id,active,approval_status&limit=1`, {
    headers: adminHeaders,
  });
  const profiles = await profileRes.json().catch(() => []);
  const profile = profiles?.[0];
  if (!profileRes.ok || !profile?.id) return json({ error: 'Gebruikersnaam of wachtwoord is onjuist.' }, 401);

  const userRes = await fetch(`${url}/auth/v1/admin/users/${profile.id}`, { headers: adminHeaders });
  const user = await userRes.json().catch(() => null);
  if (!userRes.ok || !user?.email) return json({ error: 'Gebruikersnaam of wachtwoord is onjuist.' }, 401);

  const tokenRes = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: publishable, 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password }),
  });
  const session = await tokenRes.json().catch(() => null);
  if (!tokenRes.ok || !session?.access_token || !session?.refresh_token) {
    return json({ error: 'Gebruikersnaam of wachtwoord is onjuist.' }, 401);
  }

  if (profile.approval_status === 'pending') {
    return json({ error: 'Je account wacht nog op goedkeuring van de beheerder.' }, 403);
  }
  if (profile.approval_status === 'rejected') {
    return json({ error: 'Je aanmelding is niet goedgekeurd. Neem contact op met de beheerder.' }, 403);
  }
  if (!profile.active) return json({ error: 'Dit account is geblokkeerd.' }, 403);

  return json({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    token_type: session.token_type,
  });
});
