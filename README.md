# mandatsfeed

mandatsfeed sammelt parlamentarische Aktivitäten von Mandatsträgern in Bundestag und Landtagen und stellt sie als RSS-Feeds pro Person und pro Fraktion zur Verfügung.

**Schwesterprojekt zu [amtsfeed](https://github.com/amtsfeed/amtsfeed):** amtsfeed bildet die Verwaltungs-/Exekutivseite ab (Gemeinden, Behörden, Amtsblätter, Bekanntmachungen). mandatsfeed bildet die gewählte Vertretungsseite ab — was Abgeordnete *im Protokoll* tun, nicht was sie freiwillig kommunizieren.

## Status: Forschungsprojekt

mandatsfeed ist derzeit **kein produktives Datenangebot**, sondern ein **Forschungsprojekt** zur Machbarkeit von Per-Person- und Per-Fraktions-Feeds aus deutschen Parlamentsdokumentations-Systemen. Das Repository enthält die **Code-Basis** (Adapter, Build-Tooling, Schema-Definitionen) und Dokumentation der jeweiligen Quellsysteme — aber **keine extrahierten Datenartefakte**. Aktivitäts-JSONs und generierte RSS-Feeds werden bewusst nicht eingecheckt (siehe `.gitignore`).

Hintergrund: Eine erste technische Vorstudie am Landtag Sachsen-Anhalt (PADOKA-System) zeigte, dass das Auskunftsportal über `padoka.landtag.sachsen-anhalt.de/robots.txt` ein **Komplettverbot für automatisierte Zugriffe** ausspricht (`Disallow: /` plus expliziter Block auf `/files/`). Vor einem produktiven Betrieb muss daher eine formelle Erlaubnis der Parlamentsdokumentation eingeholt werden — analog zum personalisierten API-Key, den der Bundestag für DIP-Nutzung vergibt. Sobald die Erlaubnis vorliegt, wird mandatsfeed in einem **frischen Repository mit neuer Git-History** als produktives Angebot relaunched. Die in diesem Repo dokumentierten Adapter und das Datenschema bleiben dabei die Vorlage.

Den Befund zur robots.txt halten wir in `wiki/sachsen-anhalt/robots.json` (nur lokal, nicht im Repo) und `wiki/sachsen-anhalt/README.md` (im Repo) fest, damit nachvollziehbar bleibt, was uns wann bekannt war.

## Was mandatsfeed ist

mandatsfeed erzeugt pro **Abgeordneter** und pro **Fraktion** einen chronologischen RSS-Feed über deren *verhaltensbasierte* parlamentarische Aktivität — was Abgeordnete im Protokoll tun, nicht was sie freiwillig kommunizieren.

**Aktuell implementiert** (Landtag Sachsen-Anhalt, PADOKA-Adapter, durch echte Daten verifiziert):

- Kleine und Große Anfragen (ohne Antwort und mit Antwort, mit Verkettung zwischen Original-KA und Antwort über `relatedTo`)
- Anträge, Alternativ-, Änderungs-, Entschließungsanträge, Berichterstattungsverlangen
- Gesetzentwürfe
- Reden im Plenum (Titel, Plenarprotokoll-Nummer und Seite, PDF-Deeplink, Redner mit Funktionsbezeichnung wenn als Minister:in/Präsident:in gesprochen wird)
- Namentliche Abstimmungen (Aggregate ja/nein/enth/abw plus Per-MdL-Stimmen aus dem Plenarprotokoll-PDF)

**Bewusst NICHT abgedeckt:** Social-Media-Aktivität, persönliche Webseiten-RSS, freiwillige Q&A-Inhalte (z. B. abgeordnetenwatch-Bürgerfragen). Wir bilden ab, was eine Person *tut* (im Protokoll erfasst), nicht was sie *freiwillig kommuniziert*.

## Abgedeckte Parlamente

| Parlament                | System                    | Status              |
|--------------------------|---------------------------|---------------------|
| Landtag Sachsen-Anhalt   | PADOKA (STARWEB-Variante) | 🟢 Adapter aktiv     |

Weitere Parlamente (Bundestag via DIP, Landtage in Sachsen, Brandenburg, Mecklenburg-Vorpommern) sind technisch vorbereitet — der Adapter-Code ist quell-agnostisch genug, dass sie nachgezogen werden können. Aktuell ist nur Sachsen-Anhalt im Live-Betrieb.

## Datenstruktur

```
wiki/
  <parlament>/
    aktivitaet/
      YYYY-MM-DD/
        YYYY-MM-DD-<typ>-<wp>-<nr>.json  ← kanonisches Item, eine Datei pro Aktivität
    personen/
      <slug>/
        rss.xml                          ← generiert aus den Aktivitäten dieser Person
    fraktion/
      <slug>/
        rss.xml                          ← generiert aus den Aktivitäten dieser Fraktion
    personen.registry.json               ← getrackte Personen + Quell-IDs + Fraktion + Wechselhistorie
    robots.json                          ← gecachte robots.txt der Quelle(n)
    README.md                            ← parlament-spezifische Doku
  metadata.json                          ← Index aller abonnierbaren Feeds (für Weboberfläche)
```

## Datenschema einer Aktivität

Jede Aktivität wird als eigenständige JSON-Datei abgelegt. Das Schema ist **quell-agnostisch**: derselbe Record-Aufbau, egal ob die Aktivität aus DIP, PADOKA, STARWEB, Parldok oder EDAS kommt. Die `source`-Eigenschaft hält fest, woher das Item stammt. Quell-Metadaten (Lizenz, Pflicht-Zitation) leben außerhalb des Items in `scripts/parliaments.ts` und werden beim RSS-Build injiziert — so erzeugen Quell-Wechsel keine Diff-Bloat in den Aktivitäts-JSONs.

Beispiel: ein Antrag der Linke-Fraktion im Landtag Sachsen-Anhalt (`wiki/sachsen-anhalt/aktivitaet/2026-06-04/2026-06-04-antrag-8-7079.json`):

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

Der Build (`pnpm run generate-rss`) projiziert dieselbe Aktivität in **alle Feeds, in die sie gehört**. Der obige Antrag landet in `wiki/sachsen-anhalt/fraktion/die-linke/rss.xml`:

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

# Drucksachen-Adapter (Anträge, KAs, Anfragen, Gesetzentwürfe, Antworten):
#   Default-Zeitraum: aktuelles Kalenderjahr (PADOKA-Filter ?from=01.01.<JAHR>)
YEAR=2026 pnpm run fetch:sachsen-anhalt

# Reden-Adapter (Plenardebatten, eine Activity je Redner:in × Plenarprotokoll-Seite)
YEAR=2026 pnpm run fetch-reden:sachsen-anhalt

# Namentliche-Abstimmungen-Adapter (Aggregate + Per-MdL-Stimmen aus Plenarprotokoll-PDF)
MIN_DATE=2026-01-01 pnpm run fetch-abstimmungen:sachsen-anhalt

# RSS-Feeds pro Person und Fraktion generieren
pnpm run generate-rss

# Index aller abonnierbaren Feeds aktualisieren (wiki/metadata.json)
pnpm run generate-metadata

# Änderungs-Log für den nächsten Commit oben in UPDATES.md eintragen
pnpm run append-update-log
```

Reihenfolge nach einem Fetch-Lauf: `generate-rss` → `generate-metadata` → `append-update-log`.

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

- **[abgeordnetenwatch.de](https://www.abgeordnetenwatch.de/)** — Bürgerportal mit Profilen, Abstimmungen, Bürger-Q&A und Nebeneinkünften. Liefert die Stammdaten als **CC0-API**. mandatsfeed lässt Bürgerfragen bewusst aus (Mandatsträger-*Aktivität* statt freiwillige Kommunikation), nutzt aber die Personen-Stammdaten potenziell als Ergänzung zu den Parlamentsquellen.
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
