# WEPADEL 3.7.0

## Eerst uitvoeren in Supabase
Voer eenmalig `supabase-migration-v6-swaps-and-stat-reset.sql` uit in de Supabase SQL Editor. De eerdere v5-migratie moet ook al uitgevoerd zijn.

## Wijzigingen
- Overzicht begroet met `Welkom, [voornaam]`.
- Volledige namen blijven zichtbaar bij Statistieken.
- Bezetting per baan als Baan 1 · 1/4 t/m 4/4; onvolledig oranje en compleet groen.
- Op Overzicht verschijnt bij een complete baan de betaalstatus en, wanneer nodig, de Tikkie-knop.
- De 24-uursmelding verdwijnt zodra de speler als betaald staat.
- Kop Lobby verwijderd.
- Bij een complete baan wordt `Ik kan niet` vervangen door `Ruilen`.
- De vervanger moet het ruilverzoek accepteren via Overzicht en een popup bij openen van de app.
- Betaalstatus, baanplek en bestaande wedstrijdindelingen gaan mee naar de vervanger.
- Wedstrijdkeuzes blokkeren dubbele spelers en bevatten een resetknop.
- Bij vier spelers op één baan kunnen automatisch drie unieke partnercombinaties worden aangemaakt.
- Beheerder kan alle wedstrijdstatistieken en uitslagen resetten zodat iedereen weer op 0 staat.
