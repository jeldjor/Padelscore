# WEPADEL 3.6.0

## Nieuwe speeldagwerking

- De knop **Ready to play!** is altijd zichtbaar, maar pas actief op de datum van de speeldag.
- De tekst **Op de speeldag staan hier de wedstrijden.** staat boven Lobby.
- De knop opent een popup met banen, wedstrijden en uitslagen.
- Spelers hoeven niet meer in te checken of op READY te drukken.
- Alleen de beheerder bepaalt het aantal banen via Speeldag wijzigen.
- Host en beheerder kunnen vanaf het begin van de speeldag wedstrijden maken en uitslagen invoeren.
- De host kan live score op de dag zelf aan- of uitzetten.
- Bij uitschakelen tijdens een actieve wedstrijd wordt de huidige liveset gewist. De volledige uitslag kan daarna handmatig worden ingevoerd.
- Bij opnieuw inschakelen begint de livescore van actieve wedstrijden opnieuw op 0-0.

## Verplichte Supabase-migratie

Voer vóór ingebruikname één keer `supabase-migration-v5-live-score.sql` uit in de Supabase SQL Editor. Deze voegt de instelling `live_scoring_enabled` toe aan speeldagen.
