import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY=Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY=Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT=Deno.env.get('VAPID_SUBJECT')||'mailto:beheer@wepadel.app';
const CRON_SECRET=Deno.env.get('PUSH_CRON_SECRET')!;
const admin=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false}});
webpush.setVapidDetails(VAPID_SUBJECT,VAPID_PUBLIC_KEY,VAPID_PRIVATE_KEY);
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'authorization, apikey, content-type, x-cron-secret'}});

async function authenticatedUser(req:Request){
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,''); if(!token)return null;
  const {data}=await admin.auth.getUser(token); return data.user||null;
}
async function badgeCount(userId:string){
  const today=new Date().toISOString().slice(0,10);
  const {data:slots}=await admin.from('playday_slots').select('playday_id,court_number,paid,user_id').eq('user_id',userId);
  const ids=[...new Set((slots||[]).map(s=>s.playday_id))]; if(!ids.length){const {count}=await admin.from('swap_requests').select('*',{count:'exact',head:true}).eq('target_user_id',userId).eq('status','pending');return count||0;}
  const {data:days}=await admin.from('playdays').select('id,play_date,status').in('id',ids).gte('play_date',today).neq('status','cancelled');
  const valid=new Set((days||[]).map(d=>d.id)); let unpaid=0;
  for(const slot of slots||[]){if(slot.paid||!valid.has(slot.playday_id))continue;const {count}=await admin.from('playday_slots').select('*',{count:'exact',head:true}).eq('playday_id',slot.playday_id).eq('court_number',slot.court_number).not('user_id','is',null);if(count===4)unpaid++;}
  const {count:swaps}=await admin.from('swap_requests').select('*',{count:'exact',head:true}).eq('target_user_id',userId).eq('status','pending');return unpaid+(swaps||0);
}
async function send(userId:string,payload:Record<string,unknown>){
  const {data:subs}=await admin.from('push_subscriptions').select('*').eq('user_id',userId); if(!subs?.length)return 0;
  let sent=0; for(const sub of subs){try{await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},JSON.stringify(payload),{TTL:86400});sent++;}catch(e:any){if(e?.statusCode===404||e?.statusCode===410)await admin.from('push_subscriptions').delete().eq('id',sub.id);else console.error(e);}}return sent;
}
async function logOnce(userId:string,type:string,key:string,payload:Record<string,unknown>){
  const {error}=await admin.from('notification_log').insert({user_id:userId,notification_type:type,dedupe_key:key,payload}); if(error?.code==='23505')return false;if(error)throw error;return true;
}
async function scanCompleteAndSwaps(competitionId:string){
  const today=new Date().toISOString().slice(0,10);
  const {data:days}=await admin.from('playdays').select('id,play_date,location,court_count').eq('competition_id',competitionId).gte('play_date',today).neq('status','cancelled');
  for(const day of days||[]){const {data:slots}=await admin.from('playday_slots').select('user_id,court_number').eq('playday_id',day.id).not('user_id','is',null);for(let court=1;court<=Number(day.court_count||1);court++){const players=(slots||[]).filter(s=>s.court_number===court).map(s=>s.user_id);if(players.length!==4)continue;for(const uid of players){const key=`court-complete:${day.id}:${court}`;const badge=await badgeCount(uid);const payload={title:'Baan compleet!',body:`Baan ${court} voor ${new Date(day.play_date+'T12:00:00').toLocaleDateString('nl-NL',{day:'numeric',month:'long'})} is compleet.`,tag:key,url:'./',badge};if(await logOnce(uid,'court_complete',key,payload))await send(uid,payload);}}}
  const {data:swaps}=await admin.from('swap_requests').select('id,target_user_id,playday_id,status').eq('status','pending');
  for(const swap of swaps||[]){const key=`swap:${swap.id}`;const badge=await badgeCount(swap.target_user_id);const payload={title:'Ruilverzoek ontvangen',body:'Een speler vraagt of jij een plek op een speeldag wilt overnemen.',tag:key,url:'./',badge};if(await logOnce(swap.target_user_id,'swap_request',key,payload))await send(swap.target_user_id,payload);}
}
async function paymentReminders(){
  const today=new Date().toISOString().slice(0,10);const cutoff=new Date(Date.now()-48*3600*1000).toISOString();
  const {data:days}=await admin.from('playdays').select('id,play_date,status').gte('play_date',today).neq('status','cancelled');const valid=new Map((days||[]).map(d=>[d.id,d]));
  const {data:slots}=await admin.from('playday_slots').select('user_id,playday_id,court_number,paid').eq('paid',false).not('user_id','is',null);const perUser=new Map<string,any[]>();
  for(const slot of slots||[]){if(!valid.has(slot.playday_id))continue;const {count}=await admin.from('playday_slots').select('*',{count:'exact',head:true}).eq('playday_id',slot.playday_id).eq('court_number',slot.court_number).not('user_id','is',null);if(count!==4)continue;const arr=perUser.get(slot.user_id)||[];arr.push(valid.get(slot.playday_id));perUser.set(slot.user_id,arr);}
  for(const [uid,open] of perUser){const {data:last}=await admin.from('notification_log').select('sent_at').eq('user_id',uid).eq('notification_type','payment_reminder').gte('sent_at',cutoff).limit(1);if(last?.length)continue;const badge=await badgeCount(uid);const body=open.length===1?`Je betaling voor ${new Date(open[0].play_date+'T12:00:00').toLocaleDateString('nl-NL',{day:'numeric',month:'long'})} staat nog open.`:`Je hebt nog ${open.length} speeldagen waarvoor betaling nodig is.`;const key=`payment:${uid}:${Math.floor(Date.now()/(48*3600*1000))}`;const payload={title:'Speeldag behoeft actie',body,tag:'payment-reminder',url:'./',badge,renotify:true};if(await logOnce(uid,'payment_reminder',key,payload))await send(uid,payload);}
}
Deno.serve(async(req)=>{if(req.method==='OPTIONS')return json({ok:true});try{const body=await req.json().catch(()=>({}));if(body.action==='reminders'){if(req.headers.get('x-cron-secret')!==CRON_SECRET)return json({error:'Niet toegestaan'},401);await paymentReminders();return json({ok:true});}const user=await authenticatedUser(req);if(!user)return json({error:'Ongeldige sessie'},401);const {data:profile}=await admin.from('profiles').select('competition_id').eq('id',user.id).single();if(!profile?.competition_id)return json({error:'Profiel niet gevonden'},404);await scanCompleteAndSwaps(profile.competition_id);return json({ok:true,badge:await badgeCount(user.id)});}catch(e){console.error(e);return json({error:e instanceof Error?e.message:String(e)},500);}});
