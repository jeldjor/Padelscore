# WEPADEL 3.9.0

## Nieuw

Onder **Beheer → Account** staat nu **Testgegevens wissen / Opnieuw beginnen**.

Deze actie verwijdert definitief:

- alle spelers behalve het ingelogde beheerdersaccount;
- alle speeldagen;
- alle wedstrijden, uitslagen en statistieken;
- alle inschrijvingen, reservelijsten en baanplekken;
- alle betaalstatussen;
- alle ruilverzoeken;
- alle beoordelingen en lobbygegevens.

De beheerder moet eerst exact **RESETTEN** typen. De bestaande knop **Alle statistieken resetten** is ook hersteld en wist alleen wedstrijden en uitslagen.

## Eenmalig uitvoeren

1. Voer `supabase-migration-v8-full-reset.sql` uit in de Supabase SQL Editor.
2. Deploy de bijgewerkte Edge Function `supabase/functions/admin-users/index.ts`.
3. Upload daarna de webappbestanden.

De Edge Function is nodig om ook de loginaccounts van testspelers veilig uit Supabase Auth te verwijderen. Alleen het ingelogde beheerdersaccount blijft bestaan.
