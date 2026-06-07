# Landtag Sachsen-Anhalt — mandatsfeed

**Wahlperiode:** 8. WP (seit 06.07.2021, Neuwahl 06.09.2026)
**Quellsystem:** PADOKA (STARWEB-Variante) — https://padoka.landtag.sachsen-anhalt.de
**Adapter:** `adapters/padoka.ts`, `adapters/padoka-reden.ts`, `adapters/padoka-abstimmungen.ts`

## Erkenntnisse erster Zugriff (2026-06-07)

### Datenstruktur

PADOKA bietet auf der Listing-Seite bereits **strukturierte Metadaten pro Item**:

```
Titel
Dokumenttyp Urheber Datum Drs-/KA-Nummer (Seitenzahl)
[Dokument-Link] [Vorgang-Link]
```

Beispiele vom 04.06.2026:
- `Habitatschutz und Forstwirtschaft` — Kleine Anfrage ohne Antwort, Wolfgang Aldag (BÜNDNIS 90/DIE GRÜNEN), 04.06.2026, Kleine Anfrage 8/3789 (4 S.)
- `BAföG-Reform jetzt verlässlich umsetzen. Bildungsaufstieg sichern.` — Antrag, Die Linke, 04.06.2026, Drucksache 8/7079 (2 S.)

### URL-Pattern (deterministisch, ohne Session-Token)

PDFs liegen unter berechenbaren Pfaden:

- **Drucksachen:** `https://padoka.landtag.sachsen-anhalt.de/files/drs/wp<WP>/drs/d<NR><SUFFIX>.pdf`
  - `d7079dan.pdf` → Drs 8/7079, Antrag
  - `d7083lun.pdf` → Drs 8/7083, Unterrichtung (Landesregierung?)
  - `d7081vbe.pdf` → Drs 8/7081, Beschlussempfehlung
  - `d7080eun.pdf` → Drs 8/7080, externe Unterrichtung?
- **Kleine Anfragen:** `https://padoka.landtag.sachsen-anhalt.de/files/drs/wp<WP>/dkl_anfr/k<NR>gkl.pdf`
  - `k3789gkl.pdf` → KA 8/3789
- **Ausschussdrucksachen:** `https://padoka.landtag.sachsen-anhalt.de/files/aussch/wp<WP>/<GREMIUM>/adrs/<NR>.pdf`
  - `8bil0106.pdf` → Ausschuss Bildung 8/106

→ Das 3-Buchstaben-Suffix der Drucksachen-Dateinamen kodiert den Subtyp. Mapping muss noch ermittelt werden.

### Such-/Listing-Zugriff

Listing-Seite ist JS-gerendert (`browse.tt.html`), aber die Suchparameter sind URL-encoded und reproduzierbar. Pagination erfolgt nicht über URL-Params (keine `firstitem`/`pageSize`-Unterstützung), sondern über DOM-Buttons. Workaround: Per-`Click()` die Multiselect-Option **„Alle auf einer Seite"** auswählen — dann wird der gesamte Treffer-Satz in den DOM gerendert und kann am Stück ausgewertet werden.

**Tatsächlich verwendete URL-Muster:**

- **Drucksachen/Anfragen/Anträge global pro Jahr** (`adapters/padoka.ts`):
  ```
  https://padoka.landtag.sachsen-anhalt.de/portal/browse.tt.html
    ?type=generic2&action=link
    &from=01.01.<JAHR>&to=31.12.<JAHR>
    &wp=8
  ```
- **Reden global pro Jahr** (`adapters/padoka-reden.ts`):
  ```
  https://padoka.landtag.sachsen-anhalt.de/portal/browse.tt.html
    ?type=generic4&action=link&db=lsa.lissh&docart=Plenarprotokoll
    &from=01.01.<JAHR>&to=31.12.<JAHR>
    &wp=8
  ```
- **Namentliche Abstimmungen global** (`adapters/padoka-abstimmungen.ts`):
  ```
  https://padoka.landtag.sachsen-anhalt.de/portal/abstimmungen.tt.html
  ```
  Liefert sämtliche namentlichen Abstimmungen der WP 8 als strukturierte Wrapper-Divs (`[id^=wrapper-ABSTIMM_]`) mit `data-political-field`, `data-date`, Aggregat-Counts und Plenarprotokoll-Referenz.
- **Einzelnes Plenarprotokoll deeplinkbar:**
  ```
  https://padoka.landtag.sachsen-anhalt.de/portal/browse.tt.html
    ?type=generic1&action=link&db=lsa.lissh&docart=Plenarprotokoll
    &docnumber=<NR>&wp=8
  ```

Der `from`-Param erwartet deutsches Datumsformat `DD.MM.YYYY`. Der „Alle auf einer Seite"-Toggle ist über `document.querySelectorAll('.multiselect-option')` ansprechbar.

### PDF-Parsing

- PDFs sind PDF 1.6, durchsuchbarer Text (kein Scan)
- Erste Seite hat strukturierten Header:
  ```
  (Eingang bei der Landesregierung am DD.MM.YYYY)
  DD.MM.YYYY
  <Dokumenttyp>
  <WP>/<NR>
  <Sichtbarkeit>
  <Subtyp>
  –
  <Urheber>
  <Titel>
  ```
- Extraktion in Node mit `pdf-parse` (neue `PDFParse`-Klasse) funktioniert sauber.

### Compliance

**🚨 Wichtige Korrektur, Stand 2026-06-07:** PADOKA als **Subdomain** (`padoka.landtag.sachsen-anhalt.de`) hat eine **eigene robots.txt**, die deutlich restriktiver ist als die der Haupt-Domain.

PADOKA-`robots.txt` (verifiziert 2026-06-07 09:09 UTC):

```
User-agent: *
Disallow: /files/

User-agent: SemrushBot
Disallow: /

User-agent: SemrushBot-SA
Disallow: /

User-agent: *
Disallow: /
```

Auslegung:

- Der erste `User-agent: *`-Block sperrt explizit `/files/` — genau dort liegen alle PDFs (Drucksachen, Kleine Anfragen, Plenarprotokolle), die mandatsfeed verlinken bzw. parsen würde.
- Der zweite `User-agent: *`-Block sperrt darüber hinaus die gesamte Domain.
- Strikt gelesen: **automatisierter Zugriff (Crawling, Scraping) ist nicht erlaubt.**

**Konsequenz für mandatsfeed:** Vor produktivem Betrieb ist eine **formelle Erlaubnis der Parlamentsdokumentation Sachsen-Anhalt** einzuholen — analog zum DIP-API-Key des Bundestags. Bis dahin ist mandatsfeed für PADOKA ein Forschungsprojekt: die in diesem Verzeichnis dokumentierten technischen Befunde (URL-Pattern, PDF-Format, JSON-Schema-Mapping) sind Vorarbeit, **keine Grundlage für einen automatisierten Dauerbetrieb**.

Zur Erinnerung: die Haupt-Domain `www.landtag.sachsen-anhalt.de` (Webseite des Landtags) erlaubt Crawling weitgehend — gesperrt ist dort nur eine einzelne Geschäftsordnungs-PDF. Die robots.txt-Konfiguration unterscheidet sich also explizit zwischen Webseite und Dokumentationssystem.

### Technisch verifiziert (nicht produktiv eingesetzt)

- Listing-Seite verwendet JS — agent-browser für Listing-Render, danach direkt curl auf PDFs
- PDF-Zugriff funktioniert ohne Session-Token (mit `curl -A "mandatsfeed/0.1"` getestet)

### Reden-Extraktion

PADOKA-Reden sind auf der Listing-Seite alphabetisch gruppiert: die erste Card eines Sprechers trägt im Header Name + Fraktion (z. B. „Wolfgang Aldag (BÜNDNIS 90/DIE GRÜNEN)"), die folgenden Cards desselben Sprechers haben keinen Header und vererben ihn. Der Adapter hält den letzten gesehenen Speaker vor und ordnet jede headerlose Card dem aktuellen Sprecher zu.

Spricht ein:e MdL in einer Regierungs- oder Sitzungsfunktion, taucht der Header in der Form „Lydia Hüskens (Ministerin für Infrastruktur und Digitales)" auf. Die Funktion ist keine Fraktion — der Adapter erkennt Funktions-Präfixe (`Minister*`, `Präsident*`, `Vizepräsident*`, `Staatssekretär*`, `Schriftführer*`, `Beauftragte*`, `Alterspräsident*`) und ersetzt die Klammer durch die Stamm-Fraktion aus `personen.registry.json`. Die Funktion wird als zusätzliches `funktion`-Feld auf der `ActivityPerson` gespeichert.

### Roll-Call-Extraktion aus Plenarprotokollen

Per-MdL-Stimmen einer namentlichen Abstimmung liegen im Plenarprotokoll-PDF (URL-Muster `/files/plenum/wp8/<NR>stzg.pdf`). Das PDF ist mit Layout-Daten parsbar (siehe `pdf-parse`-Aufruf in `adapters/padoka-abstimmungen.ts`); der Roll-Call ist ein alphabetisch sortierter Block mit pro Zeile `<Name> Ja|Nein|enthalten|-` (Bindestrich = abwesend). Der Adapter findet den richtigen Block durch Tally-Match gegen die aggregierten ja/nein/enth/abw-Counts der `abstimmungen.tt.html`-Übersicht. Über Seitenumbrüche verteilte Blöcke werden kombiniert.

Namen mit Adelsprefix („von Angern") und Stadt-Disambiguator („Büttner (Stendal)") werden über Normalisierungs-Varianten in der Registry-Index-Suche abgefangen.

### Bestand der Personen-Registry

`personen.registry.json` führt alle MdL der 8. WP mit Slug, kanonischem Namen, PADOKA-Schreibweise und Fraktionskontext. Slugs sind ASCII-only (ß → `ss`, Umlaute → Basis-Vokal, Sonderzeichen → `-`). Stand der Liste: 99 Einträge inkl. Nachrücker:innen und fraktionslos gewordenen Abgeordneten.

### Referenztag für Implementations-Tests

**04.06.2026** — ein typischer Arbeitstag mit Antrag + Kleinen Anfragen mehrerer Fraktionen plus KA-Antworten. Eignet sich als Smoke-Test für Drucksachen-Adapter und für die Verkettung über `relatedTo`.
