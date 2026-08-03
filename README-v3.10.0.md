# WEPADEL 3.10.0

## Nieuw
- In **Beheer → Speeldagen** staat compact per regel hoeveel dagen de opgeslagen Tikkie-link nog geldig is.
- De invoerdag van een nieuwe of gewijzigde link wordt automatisch als aanmaakdag opgeslagen. Er is geen extra datumveld.
- Statuskleuren: groen bij voldoende tijd, oranje bij 1–3 dagen, rood bij verlopen en grijs zonder link.
- Alle beheeronderdelen kunnen verticaal scrollen wanneer de inhoud niet op het scherm past.
- Het GJ Motion-logo gebruikt weer transparante openingen in beide O's.

## Eenmalig uitvoeren
Voer `supabase-migration-v9-tikkie-validity.sql` uit in de Supabase SQL Editor.

Bestaande Tikkie-links krijgen bij de migratie de migratiedatum als startdatum, omdat hun oorspronkelijke invoerdatum niet meer te achterhalen is. Zodra je een link vervangt, wordt automatisch die nieuwe invoerdag gebruikt.
