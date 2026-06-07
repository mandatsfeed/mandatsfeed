# Landtag Mecklenburg-Vorpommern — mandatsfeed

**Wahlperiode:** 8. WP (26.10.2021 – 25.10.2026)
**Quellsystem:** Parldok — https://www.dokumentation.landtag-mv.de/parldok
**Adapter:** _noch nicht implementiert_ (Scaffolding vorhanden, siehe „Status" unten)

## Status

Konfigurations-Scaffolding ist da: das Parlament ist in `scripts/parliaments.ts` registriert, `robots.json` ist gecacht, die WP-Subdir-Konventionen aus dem Hauptprojekt gelten auch hier. **Was noch fehlt:** ein laufender Quell-Adapter (`adapters/parldok-mv.ts`), der die Drucksachen-, Reden- und Abstimmungs-Listen aus Parldok holt und ins kanonische Activity-Schema mappt.

## Compliance

robots.txt für `www.landtag-mv.de` und `www.dokumentation.landtag-mv.de` beide HTTP 404 — **keine veröffentlichte robots-Policy**. Per RFC 9309 ist Crawling damit per Default erlaubt. Im Gegensatz zur PADOKA-Subdomain in Sachsen-Anhalt (mit explizitem `Disallow: /`) ist die robots-Lage hier also unkritisch.

Zwei Hinweise trotzdem:

1. **§ 87a UrhG (Datenbankschutz):** bei systematischer Entnahme greift unabhängig von robots.txt der Schutz der Datenbank-Hersteller-Rechte. Vor einem produktiven, dauerhaften Sweep ist eine kurze schriftliche Anfrage an die Parlamentsdokumentation MV sinnvoll — analog DIP-Key-Modell.
2. **Wahlperiode endet 25.10.2026:** der nächste Sweep-Zeitraum sollte die WP-Grenze sauber abbilden (`wp-8/` schließt Items bis 25.10.2026, neue Items danach unter `wp-9/`).

## Was Parldok bietet

Die Startseite (`/parldok/`) ist eine JavaScript-getriebene Such-Oberfläche mit folgenden Dokumentarten in einem Direktauswahl-Menü:

- **Drucksache** — Anträge, Gesetzentwürfe, Kleine/Große Anfragen, Antworten
- **Plenarprotokoll** — die stenografischen Berichte einer Sitzung
- **Amtliche Mitteilung**
- **Beschlussprotokoll**

Zusätzliche Einstiegspunkte:

- „Alle neuen Dokumente" — chronologisch absteigende Vorgangs-Liste, gefiltert auf die aktuelle Wahlperiode. URL-Muster:
  ```
  https://www.dokumentation.landtag-mv.de/parldok/neu/10_1_8___8.%20Wahlperiode%20(26.10.2021%20-%2025.10.2026)
  ```
  Items kommen serverseitig gerendert (kein SPA-Container wie bei PADOKA), Pagination über einen `>>`-Button.
- Direkte Drucksachen-Suche via `z.B.: 8/187`-Textfeld.
- „Ausschussvorgänge" als separater Einstieg.

## Bekannte Listing-Struktur

Pro Item (aus dem „Alle neuen Dokumente"-Listing):

```
<Titel>
Dokument | PDF öffnen
<Drs-Nr> <Typ> vom <Datum>
<Vorgangs-/Ausschuss-Bezeichnung>
```

Beispiel:

> ANTRAG des Kommissionsvorsitzenden Delegierung zum Jugendforum 2024 …
> 8/98 Antrag (Kommission) vom 03.06.2024
> Enquete-Kommission „Jung sein in Mecklenburg-Vorpommern"

## Offen für die Adapter-Implementation

1. **URL-Pattern mit Datumsfilter:** gibt es ein `?from=DD.MM.YYYY`-äquivalent? Im Sachsen-Anhalt-Adapter haben wir das in `from=01.01.2026` umgesetzt — analoges Pattern in Parldok ermitteln.
2. **Pagination-Mechanik:** `>>`-Button klicken oder URL-Param? Ggf. „Alle auf einer Seite"-Option suchen.
3. **Reden-Extraktion:** Parldok hat keine eigene Reden-Liste. Die Per-MdL-Reden müssten aus den Plenarprotokoll-PDFs extrahiert werden — analog dem Roll-Call-Extractor in `adapters/padoka-abstimmungen.ts`.
4. **Personen-Registry:** Quelle für die MdL-Stammliste der 8. WP. Parldok zeigt eine „Urheber"-Such-Funktion (laut Briefing nativ vorhanden) — die Einstiegs-Akkordeon-Suche muss noch reverse-engineered werden.
5. **Namentliche Abstimmungen:** vermutlich in den Plenarprotokollen, kein eigener Aggregat-Browser wie PADOKA-`abstimmungen.tt.html`.
