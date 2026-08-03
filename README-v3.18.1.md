# WEPADEL v3.18.1

## Pushmelding-link gecorrigeerd
- Een tik op een pushmelding opende ten onrechte `https://jeldjor.github.io/`.
- Daardoor verscheen een pagina-niet-gevondenmelding.
- Pushmeldingen openen nu altijd binnen de juiste app-map:
  `https://jeldjor.github.io/wepadel/`
- Een reeds geopende WEPADEL-app wordt naar de juiste app-pagina gebracht.
- Geen nieuwe Supabase-migratie nodig.
- De Edge Function hoeft niet opnieuw gedeployed te worden.
