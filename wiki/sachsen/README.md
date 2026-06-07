# Sächsischer Landtag — mandatsfeed

**Wahlperiode:** 8. WP (seit 01.10.2024)
**Quellsystem:** EDAS / REDAS — https://redas.landtag.sachsen.de/redas/
**Adapter:** `adapters/edas-sn.ts` (Drucksachen via JSON-API). Reden + Abstimmungen offen.

## Compliance — keine Sperre

- `redas.landtag.sachsen.de/robots.txt` → HTTP 404, keine Policy publiziert → per RFC 9309 ist Crawling per Default erlaubt
- `www.landtag.sachsen.de/robots.txt` sperrt nur einzelne Pfade (Videos, Sitzungskalender, Kontakt) — Drucksachen erlaubt

Im Gegensatz zu PADOKA Sachsen-Anhalt und der Parlamentsdokumentation Brandenburg keine Hürde.

## Technischer Stand — sauberes REST-Backend

EDAS/REDAS ist die **am sauberste API-Quelle** aller bisherigen Landtage. Die SPA (`redas/#/`) ruft direkt strukturierte JSON-Endpunkte ab:

```
GET https://redas.landtag.sachsen.de/redas/query
    ?pageNumber=0
    &pageSize=10000
    &sortId=4
    &wahlperiode=8
    &dokArt=Drs
    &anfangsDatum=2026-01-01
    &endeDatum=2026-12-31
    &nurErstinitiative=false
    &nurBasisdokument=true
```

Antwort: JSON-Array von Items mit `{id, dokumentenart, dokumententyp, titel, fundstelleAutor, dateien:[{id, format, name, filename, url}], anzeigeId}`. Kein agent-browser nötig.

**Server-Bug-Workaround:** Die Antwort hängt nach dem Array fälschlich noch ein zweites JSON-Objekt an (`...]{"timestamp":"...","status":200,"path":"/redas/query"}`). Der Adapter slict am letzten `]` und ignoriert den Trailer.

**Sample-Lauf 2026:**
- 2.011 Items geliefert
- 1.864 als Mandatsträger-Aktivität (KAs, Anträge, Gesetzentwürfe)
- 134 silent skips (Unterrichtungen, Berichte)
- 13 ungeparst (parsing-Lücken in `fundstelleAutor`)
- 68 Personen-Feeds
- 6 Fraktions-Feeds: AfD 883, Die Linke 538, BÜNDNISGRÜNE 268, BSW 169, CDU 12, SPD 11

Auffällig: die Regierungs-Parteien CDU/SPD sind sehr aktivitäts-arm in den Mandatsträger-Anfragen — typisch für Koalitions-MdL, die statt Anfragen lieber direkt mit der Staatsregierung kommunizieren. Die Opposition (AfD, Linke, Grüne, BSW) dominiert die Anfrage-Aktivität.

## Format „fundstelleAutor"

```
<TypAbk> <Urheber-Sequenz> <DD.MM.YYYY> Drs <WP>/<NR>
```

Drei Urheber-Varianten:

- **Einzelperson mit Fraktion** (häufigster Fall): `"KlAnfr Bernd Rudolph BSW 05.06.2026 Drs 8/7222"`
  Token-basiert: das/die letzten Token vor dem Datum sind die Fraktion, davor die Person. Adelsprefix (`von/zu/de/van`) bei der Personen-Slug-Bildung berücksichtigt.
- **Fraktions-Liste, keine Person**: `"Antr CDU, SPD, BÜNDNISGRÜNE 04.06.2026 Drs 8/7210"` — Komma-separierte Fraktionen.
- **Einzel-Fraktion, keine Person**: `"Antr Die Linke 04.06.2026 Drs 8/7220"`.

## Dokumententyp-Mapping

| REDAS-Typ      | mandatsfeed-Typ          |
|----------------|--------------------------|
| `KlAnfr`       | `kleine_anfrage` (ohne Antwort) |
| `KlAnfrAntw`   | `kleine_anfrage` (mit Antwort) |
| `GrAnfr`       | `grosse_anfrage`         |
| `Antr`         | `antrag`                 |
| `ÄndAntr`      | `antrag` (Subtyp Änderungsantrag) |
| `EntschlAntr`  | `antrag` (Subtyp Entschließungsantrag) |
| `GE` / `Gesetzentw` | `gesetzentwurf`     |
| `BeschlEmpf`   | `beschlussempfehlung`    |
| `Unterrichtg` u.ä. | silent skip          |

## Offene Punkte

1. **Reden**: REDAS hat `dokArt=PlPr` (Plenarprotokoll) — eigene API-Query, Roll-Call und Reden müssten aus dem PDF extrahiert werden, analog `padoka-abstimmungen.ts`.
2. **Personen-Registry**: kann aus den `fundstelleAutor`-Strings aller Items abgeleitet werden, sobald wir einen ersten vollständigen WP-Lauf haben.
3. **Antwort-auf-KA-Verkettung**: REDAS markiert KAs als Erstinitiative; die Antwort kommt als separate Drs mit Verweis im Titel auf die Original-KA — Verkettung wäre über Title-Parsing möglich.
