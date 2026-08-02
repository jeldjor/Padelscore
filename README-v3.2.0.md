# WEPADEL 3.2.0

Deze versie bevat de complete compacte interface en gecontroleerde zelfregistratie.

## Wat is aangepast

- Nieuw vlak inlogscherm met het definitieve WEPADEL-logo en het originele GJ MOTION-logo.
- Centraal WEPADEL-logo op alle hoofdschermen, met veilige ruimte voor de iPhone-statusbalk en Dynamic Island.
- Vaste navigatievolgorde: Overzicht, Speeldagen, Historie, Statistieken, Account/Beheer.
- Overzicht met compacte persoonlijke statistieken en open secties.
- Speeldagen met de weergaven Maandkalender en Alle speeldagen, inclusief Alle, Aankomende en Afgelopen.
- Historie toont alleen de eigen gespeelde speeldagen en wedstrijden.
- Uitgebreide competitiestatistieken met spelerpopup, historie en komende deelnames.
- Compact Account/Beheer met aanmeldingen, spelers, speeldagen en accountinstellingen.
- Zelfregistratie met competitiecode en verplichte goedkeuring door de beheerder.
- Bestaande lobby-, READY-, host-, live-score-, spraak-, volledig-scherm- en beoordelingsfuncties zijn behouden.

## Eerste competitiecode

De initiële code is `WEPADEL-2026`. Wijzig deze na de eerste beheerderslogin via **Beheer → Account**.

## Plaatsen van de versie

Upload de inhoud van deze map naar dezelfde hostinglocatie als de huidige app. De bestanden verwijzen al naar de bestaande online database. Door de vernieuwde service-worker wordt versie 3.2.0 na publicatie actief geladen.

## Supabase

De productieomgeving gebruikt:

- `supabase-migration-v4-self-registration.sql`
- Edge Function `self-register` zonder JWT, met eigen invoer- en competitiecodecontrole
- Edge Function `username-login` zonder JWT, met wachtwoordcontrole vóór een accountstatus wordt gemeld
- Edge Function `admin-users` met JWT en verplichte beheerdercontrole voor goedkeuren, afwijzen en codebeheer

De registratiecode wordt alleen als SHA-256-hash opgeslagen. Een zelfgemaakt account krijgt `approval_status = pending` en `active = false` totdat een beheerder het goedkeurt.
