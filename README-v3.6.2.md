# WEPADEL 3.6.2

Herstel voor navigatie tussen Speeldagen en Overzicht.

- Onderste navigatie gebruikt nu één vaste event-handler en blijft werken na ieder opnieuw opgebouwd scherm.
- Bij verlaten van een speeldag wordt de detailweergave altijd afgesloten.
- Schermopbouw is beschermd tegen één foutieve datarij, zodat de rest van de navigatie niet meer vastloopt.
- Sortering van speeldagen werkt ook wanneer een begintijd ontbreekt.
- Het cijfer van vandaag blijft wit in de maandkalender.

De Supabase-migratie van versie 3.6.0 hoeft niet opnieuw te worden uitgevoerd.
