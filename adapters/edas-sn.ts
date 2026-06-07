// EDAS/REDAS-Adapter Landtag Sachsen.
// Im Gegensatz zu PADOKA, Parldok und Brandenburg/STARWEB bietet Sachsen
// eine saubere REST-JSON-API unter https://redas.landtag.sachsen.de/redas.
// Die SPA selbst nutzt diesen Endpunkt — entsprechend können wir die Daten
// per node/fetch ziehen, ohne agent-browser zu involvieren.
//
// Aufruf:
//   pnpm run fetch:sachsen
//   YEAR=2026 pnpm run fetch:sachsen
//
// Idempotent + additiv.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Activity, ActivityPerson, ActivityType } from "../scripts/types.ts";

const PARLIAMENT_SLUG = "sachsen";
const PARLIAMENT_DIR = resolve(import.meta.dirname, "../wiki", PARLIAMENT_SLUG);
const WP = Number(process.env.WP ?? "8");
const YEAR = Number(process.env.YEAR ?? new Date().getUTCFullYear());

const BASE = "https://redas.landtag.sachsen.de/redas";

const FRAKTION_LABELS: Record<string, string> = {
  "CDU": "cdu",
  "AfD": "afd",
  "BSW": "bsw",
  "SPD": "spd",
  "Die Linke": "die-linke",
  "BÜNDNISGRÜNE": "bundnisgruene",
  "BÜNDNIS 90/DIE GRÜNEN": "bundnisgruene",
  "FDP": "fdp",
  "GRÜNE": "bundnisgruene",
};

interface RedasItem {
  id: number;
  dokumentenart: string;
  dokumententyp: string;
  titel: string;
  fundstelleAutor: string;
  dateien: Array<{ id: number; format: string; name: string; filename: string; url: string }>;
  anzeigeId: string;
  sRegAntworttermin?: string;
}

async function fetchAllItems(): Promise<RedasItem[]> {
  const params = new URLSearchParams({
    pageNumber: "0",
    pageSize: "10000",
    sortId: "4",
    wahlperiode: String(WP),
    dokArt: "Drs",
    anfangsDatum: `${YEAR}-01-01`,
    endeDatum: `${YEAR}-12-31`,
    nurErstinitiative: "false",
    nurBasisdokument: "true",
  });
  const url = `${BASE}/query?${params.toString()}`;
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "mandatsfeed/0.1" } });
  if (!res.ok) throw new Error(`REDAS query failed: HTTP ${res.status}`);
  // REDAS hängt nach dem JSON-Array fehlerhaft ein zweites JSON-Objekt an
  // (z. B. `[{...},{...}]{"timestamp":...,"status":200}`). Wir slicen am
  // letzten passenden „]" und ignorieren den Trailer.
  const raw = await res.text();
  const last = raw.lastIndexOf("]");
  const arr = raw.slice(0, last + 1);
  return JSON.parse(arr) as RedasItem[];
}

// Mapping REDAS-Dokumententyp → unsere Activity-Types
function classify(typ: string): { type: ActivityType; subtype?: string; status?: string } | null {
  switch (typ) {
    case "KlAnfr": return { type: "kleine_anfrage", status: "ohne_antwort", subtype: "Kleine Anfrage" };
    case "KlAnfrAntw": case "AntwKlAnfr":
      return { type: "kleine_anfrage", status: "mit_antwort", subtype: "Antwort auf Kleine Anfrage" };
    case "GrAnfr": return { type: "grosse_anfrage" };
    case "GrAnfrAntw": case "AntwGrAnfr":
      return { type: "grosse_anfrage", status: "mit_antwort" };
    case "Antr": return { type: "antrag" };
    case "ÄndAntr": case "AendAntr": return { type: "antrag", subtype: "Änderungsantrag" };
    case "EntschlAntr": return { type: "antrag", subtype: "Entschließungsantrag" };
    case "GE": case "Gesetzentw": case "GesEntw": return { type: "gesetzentwurf" };
    case "BeschlEmpf": return { type: "beschlussempfehlung" };
    default: return null; // skip Unterrichtg, Bericht etc.
  }
}

function parseGermanDate(s: string): string | null {
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

interface ParsedFundstelle {
  typAbk: string;
  urheber: string;
  date: string;
  drsNr: string;
}

function parseFundstelle(s: string): ParsedFundstelle | null {
  // Beispiele:
  //   "KlAnfr Bernd Rudolph BSW 05.06.2026 Drs 8/7222"
  //   "Antr CDU, SPD, BÜNDNISGRÜNE 04.06.2026 Drs 8/7210"
  //   "Antr Die Linke 04.06.2026 Drs 8/7220"
  //   "Unterrichtg SDB 24.03.2026 Drs 8/6474"
  const m = s.match(/^(\S+)\s+(.+?)\s+(\d{2}\.\d{2}\.\d{4})\s+Drs\s+(\d+\/[A-Za-z0-9]+)\s*$/);
  if (!m) return null;
  return {
    typAbk: m[1],
    urheber: m[2].trim(),
    date: parseGermanDate(m[3])!,
    drsNr: m[4],
  };
}

function slugifyPerson(nachname: string, vorname: string): string {
  return (`${vorname} ${nachname}`)
    .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function slugifyFraktion(label: string): string | null {
  return FRAKTION_LABELS[label] ?? null;
}

function parsePersons(urheber: string): { persons: ActivityPerson[]; fraktionen: string[]; raw: string } {
  // Heuristik:
  //   "Bernd Rudolph BSW" → Person "Bernd Rudolph", Fraktion BSW (letztes Token).
  //   "CDU, SPD, BÜNDNISGRÜNE" → drei Fraktionen, keine Person.
  //   "Die Linke" → eine Fraktion, keine Person.
  //   "LTPräs" → Landtagspräsident, keine Fraktion bekannt → fallthrough.
  const persons: ActivityPerson[] = [];
  const fraktionenSet = new Set<string>();

  // Comma-separated → liste von Fraktionen
  if (urheber.includes(",")) {
    for (const tok of urheber.split(",").map((s) => s.trim())) {
      const slug = slugifyFraktion(tok);
      if (slug) fraktionenSet.add(slug);
    }
    if (fraktionenSet.size > 0) return { persons, fraktionen: Array.from(fraktionenSet), raw: urheber };
  }

  // Sonst: das letzte Token ist (potenziell) die Fraktion
  const tokens = urheber.split(/\s+/);
  if (tokens.length >= 2) {
    // Versuche, multi-word Fraktion zu erkennen (z. B. "Die Linke")
    for (let split = tokens.length - 1; split >= 1; split--) {
      const candFr = tokens.slice(split).join(" ");
      const slug = slugifyFraktion(candFr);
      if (slug) {
        const nameTokens = tokens.slice(0, split);
        if (nameTokens.length >= 2) {
          const nachname = nameTokens.slice(-1)[0]!;
          const adligPrefix = nameTokens.length >= 3 && /^(von|zu|de|van)$/i.test(nameTokens[nameTokens.length - 2]!)
            ? nameTokens[nameTokens.length - 2] + " "
            : "";
          const trueNachname = adligPrefix + nachname;
          const vorname = nameTokens.slice(0, nameTokens.length - (adligPrefix ? 2 : 1)).join(" ");
          persons.push({
            slug: slugifyPerson(trueNachname, vorname),
            name: `${vorname} ${trueNachname}`,
            name_padoka: `${trueNachname}, ${vorname}`,
            role: "fragesteller",
            fraktion: candFr,
          });
          fraktionenSet.add(slug);
          return { persons, fraktionen: Array.from(fraktionenSet), raw: urheber };
        }
        // Nur Fraktion ohne Person (z. B. "Die Linke")
        fraktionenSet.add(slug);
        return { persons, fraktionen: Array.from(fraktionenSet), raw: urheber };
      }
    }
  }
  // Single token, in den Fraktion-Labels? — z. B. "AfD"
  const lone = slugifyFraktion(urheber);
  if (lone) fraktionenSet.add(lone);
  return { persons, fraktionen: Array.from(fraktionenSet), raw: urheber };
}

function buildActivity(item: RedasItem, parsed: ParsedFundstelle, classified: { type: ActivityType; subtype?: string; status?: string }): Activity | null {
  const { persons, fraktionen, raw } = parsePersons(parsed.urheber);
  if (persons.length === 0 && fraktionen.length === 0) return null;

  const role: ActivityPerson["role"] =
    classified.type === "kleine_anfrage" || classified.type === "grosse_anfrage" ? "fragesteller" : "antragsteller";
  persons.forEach((p) => { p.role = role; });

  const idPrefix = classified.type === "kleine_anfrage" || classified.type === "grosse_anfrage" ? "ka"
    : classified.type === "gesetzentwurf" ? "ges" : "drs";
  const drsSlug = parsed.drsNr.replace(/\//g, "-");
  const wp = Number(parsed.drsNr.split("/")[0]);

  const file = item.dateien?.[0];
  const docUrl = file ? `${BASE}/${file.url}` : "";

  const a: Activity = {
    id: `edas-${idPrefix}-${drsSlug}`,
    source: "edas",
    parliament: PARLIAMENT_SLUG,
    wp,
    type: classified.type,
    title: item.titel.trim(),
    date: parsed.date,
    drsNr: parsed.drsNr,
    persons,
    fraktionen,
    document: {
      url: docUrl,
      filename: file?.filename ?? undefined,
    },
  };
  if (classified.subtype) a.subtype = classified.subtype;
  if (classified.status) a.status = classified.status;
  if (persons.length === 0 && raw) a.urheber = raw;
  return a;
}

function filenameFor(a: Activity): string {
  const typeSlug = a.type.replace(/_/g, "-");
  const drsSlug = a.drsNr!.replace(/\//g, "-");
  return `${a.date}-${typeSlug}-${drsSlug}.json`;
}

function writeIfMissing(a: Activity): "written" | "skipped" {
  const dir = join(PARLIAMENT_DIR, `wp-${a.wp}`, "aktivitaet", a.date);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filenameFor(a));
  if (existsSync(path)) return "skipped";
  writeFileSync(path, JSON.stringify(a, null, 2) + "\n");
  return "written";
}

async function main(): Promise<void> {
  const items = await fetchAllItems();
  console.log(`[edas-sn] ${items.length} Items geliefert (WP ${WP}, Jahr ${YEAR})`);

  let written = 0, skipped = 0, nonMandate = 0, unparsed = 0;
  for (const item of items) {
    const classified = classify(item.dokumententyp);
    if (!classified) { nonMandate++; continue; }
    const parsed = parseFundstelle(item.fundstelleAutor);
    if (!parsed) { unparsed++; continue; }
    const a = buildActivity(item, parsed, classified);
    if (!a) { nonMandate++; continue; }
    if (writeIfMissing(a) === "written") written++;
    else skipped++;
  }
  console.log(`[edas-sn] ${written} neu · ${skipped} schon vorhanden · ${nonMandate} keine Mandatsträger-Aktivität · ${unparsed} ungeparst`);
}

main().catch((e) => { console.error(e); process.exit(1); });
