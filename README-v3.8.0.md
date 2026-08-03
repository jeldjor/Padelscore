# WEPADEL 3.9.0

## Wijzigingen
- Handmatig en automatisch aangemaakte wedstrijden starten altijd als **Gepland**.
- De host start een gekozen wedstrijd pas op de speeldag via **Start wedstrijd**.
- Automatisch drie wedstrijden aanmaken zet alle drie klaar zonder een wedstrijd actief te maken.
- De host kan op de speeldag verkeerde wedstrijden verwijderen.
- De beheerder kan afgeronde uitslagen altijd achteraf wijzigen of wedstrijden verwijderen.
- Ranglijst, punten, sets en games gebruiken direct de gewijzigde uitslag.

## Eenmalig uitvoeren
Voer `supabase-migration-v7-scheduled-matches.sql` uit in de Supabase SQL Editor voordat deze versie wordt gebruikt.
