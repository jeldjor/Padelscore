# WEPADEL v3.16.0

## Aangepast
- Het gekozen padelbeeld wordt uitsluitend bovenaan het Overzicht gebruikt.
- De baan, het net en de bal vormen een donkere sfeerachtergrond.
- Het echte WEPADEL-logo blijft als los app-element zichtbaar.
- De achtergrond vervaagt naar de bestaande rustige zwarte/groene appachtergrond.
- De onderste navigatieknoppen zijn groter en duidelijker gemaakt.
- Beheer > Spelers toont bij iedere gebruiker de datum en tijd van de laatste succesvolle login.
- Bestaande functionaliteit uit v3.15.0, waaronder gebruikersnaam wijzigen per zes maanden, blijft behouden.

## Eenmalig uitvoeren in Supabase
Voer `supabase-migration-v15-last-login.sql` uit in de SQL Editor.

Daarna wordt de laatste login bijgewerkt vanaf de eerstvolgende succesvolle login van iedere gebruiker.
Er hoeft voor deze versie geen Edge Function opnieuw gedeployed te worden.
