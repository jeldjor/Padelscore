# WEPADEL v3.14.0

## Wijzigingen
- Het officiële WEPADEL-logo is opnieuw opgebouwd als app-icoon.
- Nieuwe, cachevrije icon-bestandsnamen voor iPhone, Android en manifest.
- Op Overzicht staan datum, duur, locatie, baanstatus en betaalstatus exact op dezelfde verticale middenlijn.
- Automatisch aangemaakte wedstrijden mogen als gepland worden opgeslagen zonder starttijd.
- `started_at` wordt pas gevuld wanneer de host op **Start wedstrijd** drukt.

## Eenmalig uitvoeren
Voer `supabase-migration-v13-planned-match-start-time.sql` uit in de Supabase SQL Editor.

Er hoeft geen Edge Function opnieuw gedeployed te worden.
