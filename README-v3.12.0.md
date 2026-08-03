# WEPADEL v3.12.0

## Wijzigingen

- Automatisch drie wedstrijden aanmaken werkt zonder de database-enum `scheduled`.
- Alle aangemaakte wedstrijden staan eerst klaar als **Gepland** en worden pas actief na **Start wedstrijd**.
- Geen extra Supabase-migratie nodig voor deze wijziging.
- GJ Motion-logo op login- en splashscherm gebruikt een gesloten O met transparante binnenkant.
- Spelers in de speeldag staan in vaste, uitgelijnde kolommen: naam, hoststatus, betaling en beheerknoppen.
- Overzicht is opgesplitst in:
  - **Mijn speeldagen**: complete én betaalde speeldagen.
  - **Speeldag behoeft actie**: complete speeldagen die nog betaald moeten worden.
- Beide overzichten tonen maximaal vier regels per pagina met vorige/volgende navigatie.

## Installatie

Upload alle bestanden uit deze map. Vernieuw daarna de webapp volledig zodat service-worker cache v3.12.0 wordt gebruikt.
