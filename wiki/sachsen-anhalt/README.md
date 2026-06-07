# Landtag Sachsen-Anhalt — mandatsfeed

**Wahlperiode:** 8. WP (seit 06.07.2021, Neuwahl 06.09.2026)
**Letzte Plenarsitzungen:** 114. am 21.05.2026, 113. am 20.05.2026
**Quellsystem:** PADOKA (STARWEB-Variante) — https://padoka.landtag.sachsen-anhalt.de

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

- Listing-Seite ist JS-gerendert (browse.tt.html), aber die Suchparameter sind URL-encoded und reproduzierbar
- „AKTUELLE Dokumente (letzter Monat)" als Watermark-Quelle nutzbar:
  ```
  https://padoka.landtag.sachsen-anhalt.de/portal/browse.tt.html?type=generic2&action=link&slab-period.1=WEEK&sprompt-period.1=MONTH%3D%2F%2F&sop.1=AND&wp=8
  ```
- Einzelne Plenarprotokolle direkt deeplinkbar:
  ```
  https://padoka.landtag.sachsen-anhalt.de/portal/browse.tt.html?type=generic1&action=link&db=lsa.lissh&docart=Plenarprotokoll&docnumber=114&wp=8
  ```

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

### Referenztag für Implementation

**04.06.2026** — ein typischer Arbeitstag mit:
- 5 Drucksachen (Antrag, Beschlussempfehlung, 2 Unterrichtungen, Tätigkeitsbericht)
- 3 Kleine Anfragen (1× Grüne, 1× Linke, 1× AfD)
- mehrere Ausschussdrucksachen + Vorlagen

Gute Mischung der Item-Typen, mehrere Fraktionen → guter Test für Routing.

### Offene Fragen für nächsten Schritt

1. Vollständiges Mapping der 3-Buchstaben-Suffixe (`dan/lun/vbe/eun/gkl/…`)
2. Sind die Listing-Suchergebnisse als JSON-Endpoint abfragbar (Network-Tab sniffen), oder nur HTML-extracten aus `browse.tt.html`?
3. Wie verlinkt eine Antwort auf eine Kleine Anfrage zurück? (`Kleine Anfrage ohne Antwort` ist Status — wenn Antwort vorliegt, eigene Drucksache?)
4. Personen-Registry: Abgeordnetenliste der 8. WP per `Abgeordneten- und Ausschussverzeichnis`-Link greifbar
