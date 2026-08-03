# WEPADEL v3.15.0

## Nieuw
- Onderste navigatie heeft ontwerpoptie 2: een subtiel padelnet in de bestaande groene themakleuren.
- Iedere speler én beheerder kan in Account zijn gebruikersnaam wijzigen.
- Na een wijziging geldt een blokkade van exact 6 kalendermaanden.
- De app toont vanaf welke datum opnieuw wijzigen mogelijk is.
- Gebruikersnamen blijven uniek en mogen 3–30 letters, cijfers, punten, streepjes of underscores bevatten.

## Eenmalig uitvoeren
1. Voer `supabase-migration-v14-username-change.sql` uit in de Supabase SQL Editor.
2. Deploy daarna de bijgewerkte Edge Function `supabase/functions/admin-users/index.ts` opnieuw onder de bestaande functienaam `admin-users`.

De eerdere migratie voor `started_at` blijft vereist wanneer die nog niet is uitgevoerd.
