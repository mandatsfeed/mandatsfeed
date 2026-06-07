# Deutscher Bundestag — mandatsfeed

**Wahlperiode:** 21. WP (seit 25.03.2025)
**Quellsystem:** DIP — https://dip.bundestag.de/
**Adapter:** `adapters/bundestag.ts` (Aktivitäten-Endpunkt der DIP-API). Reden + Abstimmungen würden über separate DIP-Endpunkte (Plenarprotokoll, Vorgangsbezug) nachgezogen.

## API-Key einrichten

1. E-Mail an `parlamentsdokumentation@bundestag.de` mit Bitte um einen DIP-API-Key (formlos, kostenfrei für nicht-kommerzielle Nutzung).
2. Antwort enthält einen personalisierten Schlüssel.
3. `.env.example` als `.env` kopieren und `DIP_API_KEY=<schlüssel>` eintragen.
4. `.env` ist via `.gitignore` ausgeschlossen.
5. `pnpm run fetch:bundestag` lädt `.env` automatisch via `tsx --env-file=.env`.

## Compliance

- DIP-Zugriff ist über einen API-Key formell autorisiert — keine robots-Hürden.
- Pflicht-Zitation im RSS-Channel ist in `scripts/parliaments.ts` hinterlegt: Quellenangabe „Deutscher Bundestag/Bundesrat – DIP", Veränderungs-Hinweis, kostenloser DIP-Link.
- Drucksachen-Nummern (`BT-Drs.`) und Plenarprotokoll-Nummern (`BT-PlPr.`) werden im Item-Schema (`drsNr`) korrekt mitgeführt.

## Verwendeter Endpunkt

```
GET https://search.dip.bundestag.de/api/v1/aktivitaet
    ?apikey=<KEY>
    &f.zuordnung=BT
    &f.datum.start=<YYYY-MM-DD>
    &f.datum.end=<YYYY-MM-DD>
    &cursor=<…>      ← Cursor-Pagination
    &format=json
```

Cursor wird aus jeder Antwort übernommen, bis der Server entweder keinen neuen Cursor mehr meldet oder die Treffermenge erreicht ist. Standard-Page-Size ist 100; höher zu setzen lohnt sich laut DIP-Doku nicht.

## Aktivitäts-Schema-Mapping

DIP liefert pro Aktivität: `aktivitaetsart`, `titel`, `datum`, `aktualisiert`, `wahlperiode`, `fundstelle{dokumentnummer, pdf_url, dokumentart}`, `urheber[]` und `vorgangsbezug[]`.

| DIP-`aktivitaetsart`              | mandatsfeed-Typ |
|-----------------------------------|-----------------|
| Kleine Anfrage                     | `kleine_anfrage` (ohne Antwort) |
| Antwort auf Kleine Anfrage         | `kleine_anfrage` (mit Antwort) |
| Große Anfrage                      | `grosse_anfrage` |
| Gesetzentwurf                      | `gesetzentwurf` |
| Antrag                             | `antrag`        |
| Entschließungsantrag               | `antrag` (Subtyp Entschließungsantrag) |
| Änderungsantrag                    | `antrag` (Subtyp Änderungsantrag) |
| Rede / Debattenbeitrag             | `rede`          |
| Namentliche Abstimmung             | `abstimmung`    |
| Beschlussempfehlung                | `beschlussempfehlung` |
| Unterrichtung, Bericht, …          | silent skip     |

## Personen-Routing

DIP liefert `urheber[]` mit `einzelperson{vorname, nachname, fraktion}` UND `fraktion`-only-Einträgen. Im Gegensatz zu den Landtagen brauchen wir bei DIP **keine separate Personen-Registry** zur Disambiguierung — `vorname`/`nachname`/`fraktion` kommen direkt aus dem API-Item.

Empfohlene Folgearbeiten: Wikidata-Verifikation der DIP-MdB-IDs (sobald wir eine Registry aufbauen wollen, für stabile Wikidata-Links pro Person).

## Offen

1. Reden + Abstimmungen — separater Endpunkt `vorgang` / `plenarprotokoll` mit Plenarprotokoll-Roll-Call-Extraktion (analog `sachsen-anhalt-abstimmungen.ts`).
2. WP-19/20-Backfill: aktueller Adapter zieht das aktuelle Jahr; ein Backfill der vorherigen WPs braucht Datums-Chunking + WP-Filter.
