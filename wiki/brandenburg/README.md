# Landtag Brandenburg — mandatsfeed

**Wahlperiode:** 8. WP (seit 22.10.2024)
**Quellsystem:** STARWEB (`parlamentsdokumentation.brandenburg.de`) — gleiche Plattform wie PADOKA Sachsen-Anhalt
**Adapter:** `adapters/starweb-bb.ts` (Drucksachen-Sweep). Reden + Abstimmungen offen.

## Compliance — Forschungsphase wie Sachsen-Anhalt

`parlamentsdokumentation.brandenburg.de/robots.txt` (verifiziert 2026-06-07 16:30 UTC):

```
User-agent: *
Disallow: /

User-agent: Baiduspider
Disallow: /

User-agent: SemrushBot
Disallow: /

User-agent: SemrushBot-SA
Disallow: /
```

**Konsequenz für mandatsfeed:** dieselbe Lage wie bei PADOKA Sachsen-Anhalt — strikt gelesen ist automatisierter Zugriff auf das Parlamentsdokumentations-System untersagt. Vor Produktivbetrieb wird eine formelle Erlaubnis vom Landtag Brandenburg eingeholt; bis dahin bleibt mandatsfeed-Brandenburg im **Forschungsphase**-Modus: Code im Repo, Daten lokal, `wiki/**/*.json` per `.gitignore` ausgeschlossen.

Die Haupt-Domain `www.landtag.brandenburg.de` hat `Allow: /` und wäre erlaubt — aber die Parlamentsdokumentations-Subdomain hat eine eigene, restriktive Policy.

## Technischer Stand

Brandenburg nutzt **STARWEB** — dieselbe Plattform wie PADOKA Sachsen-Anhalt. Der Adapter `starweb-bb.ts` ist eine angepasste Kopie von `padoka.ts`:

- **URL-Pattern:** `?type=generic1&action=link&db=lbb.lissh&from=01.01.<JAHR>&to=31.12.<JAHR>&wp=8` (Vorgänge, nicht Dokumente — Brandenburg liefert dort die Mandate-Aktivitäten).
- **Pagination:** „Alle auf einer Seite"-Toggle funktioniert identisch (`multiselect-option`).
- **Record-Struktur:** dieselben `[data-efx-rec]`-Container, aber Titel direkt in `<h3>` (ohne `<span>`-Wrapper wie bei PADOKA) — Selektor entsprechend angepasst.
- **PDF-URL:** unter `/starweb/LBB/ELVIS/parladoku/w8/drs/ab_<bucket>/<NR>.pdf` deterministisch konstruiert.

**Sample-Lauf (lokal, 2026):**
- 1.248 Treffer in der Vorgangsliste
- 85 davon klassifiziert als Mandatsträger-Aktivität (Anträge + Gesetzentwürfe + KAs)
- 29 Personen-Feeds
- 4 Fraktions-Feeds: AfD 43, BSW 25, SPD 14, CDU 11

Die hohe Anzahl ungeparster Items (1.041) sind überwiegend Ausschuss-Einladungen und Tagesordnungspunkte, die Brandenburg als „Vorgänge" mit-listet. Eine sauberere docart-Filterung im URL-Pattern würde das aufräumen.

## Offen für die weitere Implementation

1. Spezifischere URL-Filterung auf `docart=Drucksache` analog PADOKA, um die Ausschuss-Sitzungs-Items aus dem Sweep rauszuhalten.
2. Reden-Adapter (analog `padoka-reden.ts`): braucht den Speaker-Filter aus der Brandenburger STARWEB-Variante (vermutlich identisch zu PADOKA).
3. Namentliche Abstimmungen: prüfen, ob Brandenburg eine eigene Aggregat-Seite (`abstimmungen.tt.html`) hat oder ob das nur über Plenarprotokoll-PDF-Parsing geht.
4. `personen.registry.json` für die 8. WP Brandenburg.
