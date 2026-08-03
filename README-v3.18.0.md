# WEPADEL v3.18.0

## Wedstrijden
- Nieuwe handmatige wedstrijden worden nu als **gepland** aangemaakt.
- De automatische 3 wedstrijden worden ook als **gepland** aangemaakt.
- Pas wanneer de host op **Start wedstrijd** drukt, wordt de gekozen wedstrijd actief.
- Daardoor verdwijnt de fout:
  - `null value in column started_at`
  - `duplicate key value violates unique constraint one active match per court`

## Duelkaarten
- In de lobby/Ready to play worden wedstrijden nu getoond als nette duelkaarten.
- Links staat **Team Blauw**, rechts **Team Rood**.
- In het midden staat **VS** of, na afloop, de eindscore.
- De kaarten zijn responsive en blijven passend op smalle telefoons.

## Eenmalig in Supabase uitvoeren
Voer `supabase-migration-v16-match-scheduled.sql` uit in de SQL Editor als je dat nog niet eerder hebt gedaan.
