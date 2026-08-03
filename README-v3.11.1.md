# WEPADEL v3.11.1

Bugfix voor het vooraf indelen van spelers door de beheerder.

## Aangepast
- De vierde speler kan nu correct aan een baan met drie spelers worden toegevoegd.
- Alleen werkelijk bezette plekken met een speler tellen mee voor 4/4.
- De automatische herschikking kan de gekozen speler niet meer voortijdig in de laatste plek zetten.
- In Beheer > Speeldagen staat nu per speeldag direct een zichtbare knop **+ Speler**.
- De knop **+ Speler** blijft ook beschikbaar in de geopende speeldag.

## Eenmalig uitvoeren
Voer `supabase-migration-v11-admin-fourth-player-fix.sql` uit in de Supabase SQL Editor.
