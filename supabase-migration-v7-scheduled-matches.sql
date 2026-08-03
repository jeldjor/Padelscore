-- WEPADEL v3.9.0
-- Voegt de geplande wedstrijdstatus toe. Alle vooraf aangemaakte wedstrijden
-- blijven in deze status staan totdat de host op 'Start wedstrijd' drukt.

alter type public.match_status add value if not exists 'scheduled';
