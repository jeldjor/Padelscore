# WEPADEL v3.13.0

## Nieuw
- Installatie-uitleg voor iPhone en Android wanneer WEPADEL nog in de browser wordt geopend.
- Na installatie vraagt de app bij de eerste opening om meldingen aan te zetten.
- Pushmelding zodra de eigen baan compleet is.
- Pushmelding bij een nieuw ruilverzoek.
- Zolang een complete speeldag niet betaald is: maximaal één herinnering per 48 uur met de titel **Speeldag behoeft actie**.
- Meerdere openstaande betalingen worden samengevoegd.
- Badge op het app-icoon en bij Overzicht met het aantal openstaande acties.
- Het officiële WEPADEL-logo wordt gebruikt voor gewone en maskable app-iconen.
- Meldingen kunnen later via Account/Beheer → Meldingen worden aan- of uitgezet.

## Eenmalige installatie in Supabase
1. Voer `supabase-migration-v12-push-notifications.sql` uit in de SQL Editor.
2. Deploy de Edge Function zonder automatische JWT-controle:
   `supabase functions deploy push-notifications --no-verify-jwt`
3. Stel de volgende Edge Function secrets in:
   - `VAPID_PUBLIC_KEY=BD-iUfWDgbszfJVSqaOiAWu4PvepCCBehn5TWjluAju9Rk8FQ-EmROnq9vWHsfMxz_C9KwQlkTODZ1bkt5F--sc`
   - `VAPID_PRIVATE_KEY=Hn42_oX2-sIeMJHparvygFBAPuF_CQ9gISg5i4aYB1o`
   - `VAPID_SUBJECT=mailto:jouw-emailadres@example.com`
   - `PUSH_CRON_SECRET=xGA_WLGGtx6zaCNh3O3M6CvcIHlxj-Ji35wmgHJHx-I`
4. `SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY` worden normaal automatisch door Supabase beschikbaar gesteld.

## Belangrijk voor iPhone
Webpush en icoonbadges werken alleen wanneer WEPADEL via Safari met **Zet op beginscherm** is geïnstalleerd en daarna via het app-icoon wordt geopend. De gebruiker moet meldingen toestaan.

## Geen nieuwe handmatige app-instellingen
De publieke VAPID-sleutel staat al in `config.js`. De privésleutel staat alleen hierboven voor het instellen als beveiligde Supabase-secret en wordt niet door de browser gebruikt.
