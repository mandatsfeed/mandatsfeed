# mandatsfeed

mandatsfeed sammelt parlamentarische Aktivitäten von Mandatsträgern in Bundestag und Landtagen und stellt sie als RSS-Feeds pro Person und pro Fraktion zur Verfügung.

**Schwesterprojekt zu [amtsfeed](https://github.com/amtsfeed/amtsfeed):** amtsfeed bildet die Verwaltungs-/Exekutivseite ab (Gemeinden, Behörden, Amtsblätter, Bekanntmachungen). mandatsfeed bildet die gewählte Vertretungsseite ab — was Abgeordnete *im Protokoll* tun, nicht was sie freiwillig kommunizieren.

## Status

mandatsfeed läuft als **selektives Public-Angebot**: Für Parlamente, deren Quellsystem-`robots.txt` automatisierten Zugriff nicht ausschließt, werden Aktivitäts-JSONs und RSS-Feeds eingecheckt und über [mandatsfeed.github.io](https://mandatsfeed.github.io/) bzw. den `mandatsfeed`-Repo-Pfad veröffentlicht. Für Parlamente mit Komplettverbot in robots.txt bleibt der Bestand **Forschungsphase** (Adapter im Repo, Daten nur lokal, kein Push).

| Parlament | robots.txt | Status |
|-----------|-----------|--------|
| Bundestag (DIP-API) | n/a (offizielle API mit Key) | 🟢 Public |
| Sächsischer Landtag (REDAS) | keine robots.txt | 🟢 Public |
| Landtag Mecklenburg-Vorpommern (Parldok) | keine robots.txt | 🟢 Public |
| Thüringer Landtag (Parldok) | keine robots.txt | 🟢 Public |
| Hessischer Landtag (STARWEB) | keine robots.txt | 🟢 Public |
| Abgeordnetenhaus Berlin (STARWEB) | keine robots.txt | 🟢 Public |
| Landtag Sachsen-Anhalt (PADOKA) | `Disallow: /` + `/files/` | 🟥 Forschungsphase |
| Landtag Brandenburg (STARWEB) | `Disallow: /` | 🟥 Forschungsphase |

Konfiguriert wird der Status pro Parlament über das `published`-Flag in `scripts/parliaments.ts`. Das wirkt auf zwei Ebenen:
- **`.gitignore`-Whitelist**: `wiki/<parlament>/**` wird nur für `published: true` ausgenommen vom generellen Daten-Ignore.
- **`metadata.json`**: enthält nur die published-Parlamente, damit die in [mandatsfeed.github.io](https://mandatsfeed.github.io/) sichtbare Feed-Liste mit dem öffentlich verfügbaren Datenbestand konsistent bleibt.

Für die Forschungsphase-Parlamente halten wir die Adapter weiter aktuell und sammeln den Befund in `wiki/<parlament>/README.md` (im Repo) und `wiki/<parlament>/robots.json` (nur lokal). Sobald eine formelle Erlaubnis der jeweiligen Parlamentsdokumentation vorliegt — analog zum personalisierten API-Key, den der Bundestag für DIP vergibt — wird das Flag umgestellt und der Bestand veröffentlicht.

## Was mandatsfeed ist

mandatsfeed erzeugt pro **Abgeordneter** und pro **Fraktion** einen chronologischen RSS-Feed über deren *verhaltensbasierte* parlamentarische Aktivität — was Abgeordnete im Protokoll tun, nicht was sie freiwillig kommunizieren.

**Aktuell implementiert** (Coverage je nach Parlament unterschiedlich — siehe Tabelle unten):

- Kleine und Große Anfragen (ohne Antwort und mit Antwort, mit Verkettung zwischen Original-KA und Antwort über `relatedTo`)
- Anträge, Alternativ-, Änderungs-, Entschließungsanträge, Berichterstattungsverlangen
- Gesetzentwürfe
- Reden im Plenum (Titel/TOP, Plenarprotokoll-Nummer und Seite, PDF-Deeplink, Redner mit Funktionsbezeichnung wenn als Minister:in/Präsident:in gesprochen wird; Brandenburg-Adapter erkennt Regierungsmitglieder, die in fremde Drucksachen-Debatten antworten, und attribuiert die Rede dann zur Pseudo-Fraktion „Landesregierung")
- Namentliche Abstimmungen (Aggregate ja/nein/enth/abw plus Per-MdL-Stimmen aus dem Plenarprotokoll-PDF bzw. aus XLSX-Listen beim Bundestag)

**Bewusst NICHT abgedeckt:** Social-Media-Aktivität, persönliche Webseiten-RSS, freiwillige Q&A-Inhalte (z. B. abgeordnetenwatch-Bürgerfragen). Wir bilden ab, was eine Person *tut* (im Protokoll erfasst), nicht was sie *freiwillig kommuniziert*.

## Abgedeckte Parlamente

| Parlament                       | System                          | Status                             |
|---------------------------------|---------------------------------|------------------------------------|
| Landtag Sachsen-Anhalt          | PADOKA (STARWEB-Variante)       | 🟢 Drucksachen + Reden + Abstimmungen (Forschungsphase wegen robots.txt) |
| Landtag Brandenburg             | STARWEB + abgeordnetenwatch     | 🟢 Drucksachen + Reden (mit Regierungsmitglied-Erkennung) + namentliche Abstimmungen via abgeordnetenwatch (Forschungsphase wegen robots.txt) |
| Landtag Mecklenburg-Vorpommern  | Parldok + abgeordnetenwatch     | 🟢 Drucksachen + Reden (PlPr-PDF-Parser) + namentliche Abstimmungen via abgeordnetenwatch |
| Thüringer Landtag               | Parldok + abgeordnetenwatch     | 🟢 Drucksachen + Reden (PlPr-PDF-Parser mit MdL-Nachname-Registry) + namentliche Abstimmungen via abgeordnetenwatch |
| Sächsischer Landtag             | EDAS / REDAS + abgeordnetenwatch | 🟢 Drucksachen + Reden + namentliche Abstimmungen via abgeordnetenwatch |
| Deutscher Bundestag             | DIP + Mediathek                 | 🟢 Drucksachen + Reden (DIP-XML, TOP-Titel + Druckseite) + Namentliche Abstimmungen (XLSX) + Video-RSS pro MdB via Mediathek-Plenar-Podcast — `DIP_API_KEY` in `.env` setzen |
| Hessischer Landtag              | STARWEB + abgeordnetenwatch     | 🟢 Drucksachen + namentliche Abstimmungen via abgeordnetenwatch |
| Abgeordnetenhaus Berlin         | STARWEB + abgeordnetenwatch     | 🟢 Drucksachen + namentliche Abstimmungen via abgeordnetenwatch |

Den DIP-Key bekommt man formlos per E-Mail an `parlamentsdokumentation@bundestag.de` — siehe [DIP-Hilfe-Seite](https://dip.bundestag.de/über-dip/hilfe/api). Eintrag in `.env` (Vorlage: `.env.example`).

### Namentliche Abstimmungen aus [abgeordnetenwatch.de](https://www.abgeordnetenwatch.de/)

Brandenburg, Mecklenburg-Vorpommern, Thüringen, Sachsen, Hessen und Berlin veröffentlichen ihre namentlichen Abstimmungen nicht in einem maschinenlesbaren Format (anders als der Bundestag mit XLSX-Listen oder Sachsen-Anhalt mit Roll-Call-Anlagen im Plenarprotokoll-PDF). [abgeordnetenwatch.de](https://www.abgeordnetenwatch.de/) erfasst diese Daten redaktionell und stellt sie über die [öffentliche API](https://www.abgeordnetenwatch.de/api) (`api.abgeordnetenwatch.de/v2`, **CC0**, 30 Anfragen/Minute) als Polls + Votes bereit. mandatsfeed nutzt diese Quelle als Brücke, bis die Landtage selbst strukturierte Abstimmungsdaten exportieren. Pro Abstimmung entsteht eine Activity vom Typ `abstimmung` mit Per-MdL-Stimmen — identisches Schema wie bei XLSX/PADOKA-Abstimmungen, sodass Personen- und Fraktions-Feeds dieselben Felder bekommen.

```bash
PARLIAMENT=brandenburg pnpm run fetch-abstimmungen:abgeordnetenwatch
PARLIAMENT=thueringen MIN_DATE=2024-09-26 pnpm run fetch-abstimmungen:abgeordnetenwatch
```

### Externe RSS-Feeds pro Person (Bundestag-Mediathek)

Die Mediathek des Bundestages bietet pro MdB einen Podcast-RSS mit allen Plenar-Video-Beiträgen (`webtv.bundestag.de/.../plenar.xml?speakerIds=<id>`, CORS `*`). Die offizielle Mediathek-Filterliste ([`/static/appdata/filter/rednerNamen.json`](https://www.bundestag.de/static/appdata/filter/rednerNamen.json)) listet pro Person die internen Mediathek-IDs (1–7 IDs je nach Anzahl der Rollen / Wahlperioden).

`scripts/build-webtv-speaker-ids.ts` lädt diese Quelle und mappt sie über Slug-Übereinstimmung auf unsere bestehenden Bundestag-Personen — Coverage WP20 99 %, WP21 97 %. `generate-metadata` fügt das Ergebnis als `externalFeeds: [{type: "bundestag-mediathek", url}]` pro Person in `metadata.json` ein. Die Web-UI rendert daraus einen zusätzlichen „📺 Videos im Plenum"-Button. Wir mirroren die Mediathek-Inhalte nicht selbst — der Link zeigt direkt auf den offiziellen Bundestags-Feed.

```bash
pnpm run build-webtv-speaker-ids   # einmal pro Wahl / nach Rollenwechseln
```

## Datenstruktur

```
wiki/
  <parlament>/
    robots.json                            ← gecachte robots.txt der Quelle(n)
    README.md                              ← parlament-spezifische Doku
    wp-<N>/                                ← alles, was zu *einer* Wahlperiode gehört
      personen.registry.json               ← getrackte Personen + Quell-IDs + Fraktion + Wechselhistorie
      aktivitaet/
        YYYY-MM-DD/
          YYYY-MM-DD-<typ>-<wp>-<nr>.json  ← kanonisches Item, eine Datei pro Aktivität
      personen/
        <slug>/
          rss.xml                          ← generiert aus den Aktivitäten dieser Person
      fraktion/
        <slug>/
          rss.xml                          ← generiert aus den Aktivitäten dieser Fraktion
  metadata.json                            ← Index aller abonnierbaren Feeds, gruppiert nach Parlament + Wahlperiode
```

Die Wahlperiode steckt explizit im Pfad, weil sich Personenkreis, Fraktionsstärke und Sitzverteilung pro Wahlperiode ändern. Mit der WP-Trennung können Bestände parallel existieren (z. B. WP 8 abgeschlossen + WP 9 im Aufbau nach der Sachsen-Anhalt-Wahl am 06.09.2026), ohne dass alte Feeds beim neuen Lauf überschrieben werden. Adapter routen jedes Item anhand seines `wp`-Felds automatisch in den passenden Unterordner.

## Datenschema einer Aktivität

Jede Aktivität wird als eigenständige JSON-Datei abgelegt. Das Schema ist **quell-agnostisch**: derselbe Record-Aufbau, egal ob die Aktivität aus DIP, PADOKA, STARWEB, Parldok oder EDAS kommt. Die `source`-Eigenschaft hält fest, woher das Item stammt. Quell-Metadaten (Lizenz, Pflicht-Zitation) leben außerhalb des Items in `scripts/parliaments.ts` und werden beim RSS-Build injiziert — so erzeugen Quell-Wechsel keine Diff-Bloat in den Aktivitäts-JSONs.

Beispiel: ein Antrag der Linke-Fraktion im Landtag Sachsen-Anhalt (`wiki/sachsen-anhalt/wp-8/aktivitaet/2026-06-04/2026-06-04-antrag-8-7079.json`):

```json
{
  "id": "padoka-drs-8-7079",
  "source": "padoka",
  "parliament": "sachsen-anhalt",
  "wp": 8,
  "type": "antrag",
  "title": "BAföG-Reform jetzt verlässlich umsetzen. Bildungsaufstieg sichern.",
  "date": "2026-06-04",
  "drsNr": "8/7079",
  "persons": [],
  "fraktionen": ["die-linke"],
  "urheber": "Die Linke",
  "document": {
    "url": "https://padoka.landtag.sachsen-anhalt.de/files/drs/wp8/drs/d7079dan.pdf",
    "filename": "d7079dan.pdf",
    "pages": 2
  }
}
```

**Feldbedeutung:**

- `id` — global eindeutig, quell-präfixiert. Wird zum RSS-`<guid>` und zum Dedupe-Schlüssel.
- `source` — `padoka` | `dip` | `starweb` | `parldok` | `edas`
- `type` — normalisierter Enum: `kleine_anfrage`, `grosse_anfrage`, `antrag`, `gesetzentwurf`, `beschlussempfehlung`, `rede`, `abstimmung`
- `subtype` / `status` — quell-spezifische Verfeinerung (z. B. `"Antwort auf Kleine Anfrage"` / `"mit_antwort"`)
- `persons[]` — Mandatsträger als Urheber/Redner/Abstimmende mit `slug`, `name`, `fraktion`, `role`
- `fraktionen[]` — Fraktions-Slugs, die diese Aktivität ihrem Feed zuordnen
- `urheber` — Klartext-Urheber, wenn die Quelle nur eine Fraktion nennt (kein einzelner MdL)
- `relatedTo` — verlinkt Folge-Items (z. B. Antwort auf Kleine Anfrage → Original-KA) zur Quell-ID
- `document.url` — direkter Link zum Original-PDF beim Quellsystem
- `wp` — Wahlperiode als Integer (für Backfill- und Sortier-Logik)

## Daraus resultierende RSS-Items

Der Build (`pnpm run generate-rss`) projiziert dieselbe Aktivität in **alle Feeds, in die sie gehört**. Der obige Antrag landet in `wiki/sachsen-anhalt/wp-8/fraktion/die-linke/rss.xml`:

```xml
<item>
  <guid isPermaLink="false">padoka-drs-8-7079</guid>
  <title>BAföG-Reform jetzt verlässlich umsetzen. Bildungsaufstieg sichern.</title>
  <pubDate>Thu, 04 Jun 2026 00:00:00 GMT</pubDate>
  <link>https://padoka.landtag.sachsen-anhalt.de/files/drs/wp8/drs/d7079dan.pdf</link>
  <description>Antrag · 8/7079 · Urheber: Die Linke · 2 S.</description>
</item>
```

Eine Kleine Anfrage mit benannten MdL erscheint analog in deren Personen-Feeds **und** im Fraktions-Feed. Mehrere Urheber (z. B. zwei AfD-MdL als Co-Fragesteller) erzeugen kein Duplikat: die Aktivität existiert als einzige JSON-Datei und wird beim Build mehrfach projiziert.

## Kernprinzipien

1. **Quellen-freundlich.** Quellen werden global nach Datum gesweept (ein Sweep pro Quelle/Tag), nicht pro Person abgefragt. Last ist O(Änderungen/Tag), nicht O(Personen).
2. **Inkrementell.** Täglicher Lauf mit Watermark, Backfill nur einmalig pro Wahlperiode. Quellsysteme löschen nicht — keine Delete-Reconciliation nötig.
3. **JSON ist Source of Truth, RSS ist generiert.** Adapter schreiben pro Aktivität eine JSON-Datei. RSS-Build ist deterministisch und idempotent.
4. **Quellen-Gate.** Eine Quelle geht nur produktiv, wenn sie ToS-konform ist oder eine Erlaubnis vorliegt. robots.txt wird vor Adapter-Start geprüft.
5. **LLM nur in der Entwicklung, Runtime ist deterministisches TypeScript.** Keine Modell-Aufrufe im Datenpfad.

## Lokale Nutzung

Voraussetzungen: [Node.js](https://nodejs.org/) ≥ 20, [pnpm](https://pnpm.io/), [agent-browser](https://github.com/vercel-labs/agent-browser) für JS-SPA-Quellen, sowie das npm-Paket [`pdf-parse`](https://www.npmjs.com/package/pdf-parse) (kommt automatisch via `pnpm install`) für die Roll-Call-Extraktion aus Plenarprotokoll-PDFs.

```bash
pnpm install

# Drucksachen-Adapter pro Parlament (Anträge, KAs, Anfragen, Gesetzentwürfe, Antworten).
# Default-Zeitraum: aktuelles Kalenderjahr; Sprung in eine andere WP über WP=N, anderes Jahr über YEAR=YYYY.
YEAR=2026 pnpm run fetch:sachsen-anhalt
YEAR=2026 pnpm run fetch:brandenburg
pnpm run fetch:mecklenburg-vorpommern
pnpm run fetch:thueringen
YEAR=2026 pnpm run fetch:sachsen
pnpm run fetch:bundestag                 # nutzt DIP_API_KEY aus .env

# Reden-Adapter (Plenardebatten, eine Activity je Redner:in × Plenarprotokoll-Seite)
YEAR=2026 pnpm run fetch-reden:sachsen-anhalt
YEAR=2026 pnpm run fetch-reden:brandenburg
YEAR=2026 pnpm run fetch-reden:sachsen
YEAR=2026 pnpm run fetch-reden:bundestag

# Namentliche-Abstimmungen-Adapter (Aggregate + Per-MdL-Stimmen)
MIN_DATE=2026-01-01 pnpm run fetch-abstimmungen:sachsen-anhalt
YEAR=2026 pnpm run fetch-abstimmungen:bundestag

# RSS-Feeds pro Person und Fraktion generieren
pnpm run generate-rss

# Index aller abonnierbaren Feeds aktualisieren (wiki/metadata.json)
pnpm run generate-metadata

# Änderungs-Log für den nächsten Commit oben in UPDATES.md eintragen
pnpm run append-update-log
```

Reihenfolge nach einem Fetch-Lauf: `generate-rss` → `generate-metadata` → `append-update-log`.

Während der Adapter-Läufe werden Rohdokumente (Plenarprotokoll-PDFs, DIP-XMLs, Bundestags-XLSXs) unter `.cache/<adapter>/` zwischengespeichert, damit Re-Runs nicht jedes Mal beim Quellsystem neu ziehen. `.cache/` ist gitignored und kann jederzeit gelöscht werden — der nächste Lauf füllt sie wieder.

## Datenquellen und Urheberrecht

Die indexierten Inhalte (Drucksachen, Anträge, Kleine und Große Anfragen, Gesetzentwürfe, Reden, Abstimmungen) stammen von den öffentlichen Parlamentsdokumentations-Systemen der jeweiligen Parlamente und werden dort von den Parlamentsverwaltungen oder von diesen beauftragten Dienstleistern veröffentlicht. Die `README.md`-Dateien in den einzelnen `wiki/<parlament>/`-Unterordnern dokumentieren jeweils die genaue Quelle, die URL-Struktur des Quellsystems und Compliance-Besonderheiten.

mandatsfeed:

- speichert keine Volltext-Inhalte der Drucksachen, sondern nur Titel, Datum, Drucksachen-Nummer, Urheber (MdL / Fraktion) und die URL zum Original-Dokument beim Quellsystem
- beachtet die `robots.txt`-Vorgaben der jeweiligen Portale (jede Quelle wird vor Adapter-Start verifiziert, der Stand wird in `wiki/<parlament>/robots.json` gecacht)
- verwendet einen eigenen User-Agent (`mandatsfeed/...`) zur Identifikation
- spiegelt keine personenbezogenen Drittinhalte (z. B. keine Antwortschreiben in Volltext, keine MdL-Fotos)
- folgt den Pflicht-Zitations-Vorgaben der jeweiligen Quelle: die Quellenangabe (z. B. „Deutscher Bundestag/Bundesrat – DIP" für DIP, „Landtag Sachsen-Anhalt – PADOKA" für PADOKA) wird im Channel-`<description>` jedes erzeugten RSS-Feeds gesetzt
- ist kein kommerzielles Angebot

**Urheberrechtliche Einordnung:** Die einzelnen Drucksachen, Protokolle und Anfragen sind in der Regel amtliche Werke nach § 5 UrhG und damit gemeinfrei. Bei systematischer Indexierung greift zusätzlich der Datenbankschutz nach §§ 87a ff. UrhG des jeweiligen Quellsystems — wir respektieren ihn, indem wir nur das Mindeste (Metadaten + Link aufs Original) übernehmen und keine wiederverwendbare Spiegelkopie aufbauen.

Bei Fragen zu den Quellinhalten wenden Sie sich bitte an die Parlamentsdokumentation des jeweiligen Parlaments. Bei Fragen zu mandatsfeed öffnen Sie ein [Issue](https://github.com/mandatsfeed/mandatsfeed/issues).

## Verwandte Projekte

mandatsfeed gehört zu einem international etablierten Genre — **Parliamentary Monitoring Organizations (PMOs)**: Projekte, die offizielle Parlamentsquellen scrapen und pro Abgeordneter zugänglich aufbereiten. Die folgenden Projekte sind die wichtigsten Bezugspunkte:

### Schwesterprojekt

- **[amtsfeed](https://github.com/amtsfeed/amtsfeed)** — Feeds für Gemeinden und Verwaltungen (Veranstaltungen, Amtsblätter, Bekanntmachungen). Gleiches Repo-Schema, gleiche Tooling-Familie.

### Quellen und Ökosystem-Nachbarn (deutschsprachiger Raum)

- **[abgeordnetenwatch.de](https://www.abgeordnetenwatch.de/)** — Bürgerportal mit Profilen, Abstimmungen, Bürger-Q&A und Nebeneinkünften. Liefert Stammdaten und namentliche Abstimmungen als **CC0-API** (30 Anfragen/Minute). mandatsfeed nutzt abgeordnetenwatch direkt als **Datenquelle für namentliche Abstimmungen in Brandenburg, MV, Thüringen, Sachsen, Hessen und Berlin** — überall dort, wo die Landtage selbst kein maschinenlesbares Roll-Call-Format publizieren. Bürgerfragen (Q&A) bleiben bewusst außen vor, weil mandatsfeed sich auf Mandatsträger-*Aktivität* im Protokoll fokussiert, nicht auf freiwillige Kommunikation.
- **[ParlamentAI](https://parlament.ai/)** — KI-gestützte Recherche in Bundestagsdokumenten (Debattenprotokolle, Pressemitteilungen, Kleine Anfragen und Antworten) per Chat-Interface, plus tägliche E-Mail-Briefings; Freemium-Modell. Anderer Layer als mandatsfeed (KI-Chat statt RSS), aber ähnliche Datendomäne — gut für recherche-orientierte Nutzer, mandatsfeed ergänzt mit chronologischen Feeds pro Person/Fraktion.
- **[Open Discourse](https://opendiscourse.de/)** — strukturierte Datenbank aller Bundestags-Reden seit 1949 (~900k Reden), MIT-Lizenz. Für mandatsfeed ein Backfill- und Forschungs-Bezugspunkt: basiert auf denselben Plenarprotokollen wie DIP, ist aber stärker normalisiert.
- **[meineabgeordneten.at](https://www.meineabgeordneten.at/)** — österreichisches Transparenzportal seit 2011 mit Profilen, Mandaten und Nebenbeschäftigungen. Etablierte Inspiration auf der Profil-Ebene, fokussiert auf Österreich.
- **[parlament.fyi](https://www.parlament.fyi/)** (poldi.ai) — KI-basierte Aufbereitung der Open Data des Österreichischen Parlaments inklusive Personen-Tracking und Smart Notifications per E-Mail. Überlappt thematisch am stärksten mit dem mandatsfeed-Modell „Person folgen", allerdings KI-getrieben statt rein deterministisch.
- **[DIP / Bundestag Open Data](https://dip.bundestag.de/)** — offizielle Roh-Schnittstellen des Bundestags (API, XML/JSON, Stammdaten). Direkte Input-Quelle für den Bundestag-Adapter, kein konkurrierendes Produkt.
- **[bundesAPI / bund.dev](https://bund.dev/)** — zivilgesellschaftliche Doku und Clients für Bundes-APIs. Hilfreich als Tooling- und Endpunkt-Referenz.
- **[OpenSanctions: German Legislators](https://www.opensanctions.org/datasets/de_abgeordnetenwatch/)** — täglicher Re-Publish der abgeordnetenwatch-Daten als CC0-Datensatz. Beispiel eines Downstream-Nutzers derselben Quellen.
- **[Parlamentsspiegel](https://www.parlamentsspiegel.de/)** — gemeinsames Recherche-Portal der **Präsidentinnen und Präsidenten aller 16 deutschen Landesparlamente**, operativ vom Landtag NRW betrieben. Indexiert Beratungsvorgänge, Gesetzes-Initiativen, Regierungserklärungen, Debatten, Anträge, Anfragen und Untersuchungsausschuss-Dokumente aller Länder; Stand Juni 2026: ~984.000 Vorgänge / 2,3 Millionen Dokumente, **tägliche Aktualisierung**. Speichert die Dokumente nicht selbst, sondern verlinkt jeweils auf die Originaldatei beim Landesparlament. Hat **keine öffentliche API / Schnittstelle** (Help-Seite verweist auf den Redaktionskontakt). Für mandatsfeed daher eher Discovery-Tool für die Recherchierenden als Daten-Quelle — wir greifen die Quellsysteme der Länder (PADOKA, STARWEB, Parldok, EDAS) direkt ab und brauchen die strukturierten Personen-/Datums-Filter, die der Parlamentsspiegel-Frontend nicht maschinell exponiert.
- **[OffenesParlament.de](https://offenesparlament.de/)** — geistiger Vorläufer von mandatsfeed: durchsuchbare Plenarprotokolle pro MdB. Datenbestand umfasst die 18. Wahlperiode (2013–2017); seither nicht weitergeführt. Dass diese Lücke offen ist, motiviert mandatsfeed wesentlich.
- **kleineanfragen.de** — bündelte Kleine Anfragen aus Bund und Ländern. Der Datenbestand ist nicht aktuell gepflegt; Bundes-Anfragen werden inzwischen über DIP, Länder-Anfragen über die jeweiligen Landtags-Systeme (PADOKA, STARWEB, Parldok, EDAS) wieder primär erreichbar.

### Internationale Inspiration

Diese Projekte sind die Nordsterne für das Genre — wir lernen von ihrem Design, ihrer Datenmodellierung und ihrer Tonlage, ohne uns als Ersatz zu positionieren:

- **[TheyWorkForYou](https://www.theyworkforyou.com/)** (UK, von mySociety, seit 2004) — die wichtigste Referenz. Scrapt das offizielle Hansard und liefert pro MP Abstimmungen + Reden, mit **E-Mail-Alerts und RSS-Feeds pro Abgeordneter und pro Thema**. Genau das Feature-Muster, das mandatsfeed für Deutschland adaptiert. Beleg dafür, dass saubere Re-Präsentation einer offiziellen Quelle deren Reichweite vervielfachen kann.
- **[Pombola](https://github.com/mysociety/pombola)** — mySocietys Open-Source-Codebasis für PMOs in anderen Ländern. Strukturelle Referenz für unsere Datenmodellierung.
- **[GovTrack.us](https://www.govtrack.us/)** (USA) — Per-Legislator- und Per-Bill-Tracking inklusive E-Mail/RSS-Alerts, Daten zurück bis 1789. Solides Beispiel für stabile Permalinks und Tracker-Listen.
- **[NosDéputés.fr](https://www.nosdeputes.fr/)** (Frankreich, von Regards Citoyens) — französisches Pendant für die Nationalversammlung. Lange Tradition im Genre.
- **[EveryPolitician](http://everypolitician.org/)** — historisches Mapping von Politikern weltweit nach dem Popolo-Standard. Aktiv gepflegt wurde der Datenbestand bis Mitte der 2010er; das Datenmodell bleibt eine Referenz für strukturierte Mandatsträger-Daten.

### Verwandt im weiteren Sinn

- **[OParl](https://oparl.org/)** — standardisiertes API-Format für **kommunale** Ratsinformationssysteme. Adressiert die Ratsmitglied-Ebene, also unterhalb der Landtage. Ähnliche Idee, andere Ebene.
- **[Politik bei uns](https://politik-bei-uns.de/)** — Bürgerportal auf OParl-Basis. Zeigt, wie strukturierte Daten dieser Art für Nutzer:innen aufbereitet werden können.

## Lizenz

Der Code (Scraper, Hilfsskripte) steht unter der [MIT-Lizenz](https://opensource.org/licenses/MIT).

Der Datenbestand (Aktivitäts-JSONs, RSS-Feeds, Metadaten) steht unter der [Creative Commons Namensnennung – Weitergabe unter gleichen Bedingungen 4.0 International (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/deed.de).

Die indexierten Einzeldokumente unterliegen den Nutzungsbedingungen und dem Urheberrecht der jeweiligen Parlamente (in der Regel § 5 UrhG amtliche Werke).
