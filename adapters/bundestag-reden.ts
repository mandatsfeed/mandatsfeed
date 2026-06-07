// DIP-Reden-Adapter Deutscher Bundestag.
// DIP listet einzelne Reden nicht als Aktivitäten (in /aktivitaet gibt es nur
// Frage/Antwort). Sie sind aber in den Plenarprotokoll-XMLs sauber strukturiert
// (jede <rede id="..."> mit <redner id="..."> + <vorname>/<nachname>/<fraktion>).
//
// Workflow:
// 1. Plenarprotokoll-Liste aus DIP holen (eine Anfrage, ~30 Sitzungen pro Jahr).
// 2. Pro Sitzung das XML laden (~600 KB), cachen unter /tmp/mandatsfeed-bundestag-plpr/.
// 3. Reden + Redner per Regex extrahieren (keine ausgewachsene XML-Lib nötig).
// 4. Eine Activity pro Rede schreiben.
//
// Aufruf:
//   pnpm run fetch-reden:bundestag
//   YEAR=2026 pnpm run fetch-reden:bundestag
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Activity, ActivityPerson } from "../scripts/types.ts";

const PARLIAMENT_SLUG = "bundestag";
const PARLIAMENT_DIR = resolve(import.meta.dirname, "../wiki", PARLIAMENT_SLUG);
const YEAR = Number(process.env.YEAR ?? new Date().getUTCFullYear());
const PDF_CACHE = "/tmp/mandatsfeed-bundestag-plpr";

// Read .env directly (Node --env-file ist strikt)
function loadDotenv(): void {
  const envPath = resolve(import.meta.dirname, "../.env");
  if (!existsSync(envPath)) return;
  for (const ln of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = ln.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k!]) continue;
    process.env[k!] = vRaw!.replace(/^['"](.*)['"]$/, "$1");
  }
}
loadDotenv();
const DIP_API_KEY = process.env.DIP_API_KEY;
if (!DIP_API_KEY) {
  console.error("DIP_API_KEY fehlt. In .env eintragen.");
  process.exit(1);
}

const BASE = "https://search.dip.bundestag.de/api/v1";

const FRAKTION_LABELS: Record<string, string> = {
  "CDU/CSU": "cdu-csu", "CDU": "cdu-csu", "CSU": "cdu-csu",
  "SPD": "spd", "AfD": "afd",
  "BÜNDNIS 90/DIE GRÜNEN": "bundnis-90-die-gruenen", "GRÜNE": "bundnis-90-die-gruenen",
  "DIE LINKE": "die-linke", "Die Linke": "die-linke",
  "BSW": "bsw", "FDP": "fdp",
  "Fraktionslos": "fraktionslos", "fraktionslos": "fraktionslos",
};

interface PlPrEntry {
  id: string;
  dokumentnummer: string;
  datum: string;
  wahlperiode: number;
  fundstelle: { xml_url?: string; pdf_url?: string };
}

interface RedeRecord {
  redeId: string;
  rednerId: string;
  vorname: string;
  nachname: string;
  titel: string;
  fraktion: string;
  rolleLang: string;
}

async function fetchPlenarprotokolle(): Promise<PlPrEntry[]> {
  const params = new URLSearchParams({
    apikey: DIP_API_KEY!,
    "f.zuordnung": "BT",
    "f.datum.start": `${YEAR}-01-01`,
    "f.datum.end": `${YEAR}-12-31`,
    format: "json",
  });
  const res = await fetch(`${BASE}/plenarprotokoll?${params.toString()}`, {
    headers: { Accept: "application/json", "User-Agent": "mandatsfeed/0.1" },
  });
  if (!res.ok) throw new Error(`PlPr-Liste HTTP ${res.status}`);
  const data = (await res.json()) as { documents?: any[] };
  return (data.documents ?? []).map((d) => ({
    id: d.id,
    dokumentnummer: d.dokumentnummer,
    datum: d.datum,
    wahlperiode: d.wahlperiode,
    fundstelle: d.fundstelle ?? {},
  }));
}

function downloadXml(url: string): string {
  const fname = url.split("/").pop() ?? "plpr.xml";
  const cachePath = join(PDF_CACHE, fname);
  if (existsSync(cachePath)) return readFileSync(cachePath, "utf-8");
  mkdirSync(PDF_CACHE, { recursive: true });
  execFileSync("curl", ["-sSL", "-A", "mandatsfeed/0.1 (Forschungsprojekt)", "-o", cachePath, url]);
  return readFileSync(cachePath, "utf-8");
}

// Sehr defensive Regex-Parser für die zwei Patterns, die im Plenarprotokoll-XML
// existieren: <rede id="..."> ... <redner id="..."> ... <name>...<vorname>...
// </name></redner> ... </rede>
// Pro <rede> nehmen wir den ERSTEN <redner> als Hauptredner.
function extractRedenFromXml(xml: string): RedeRecord[] {
  const records: RedeRecord[] = [];
  const seen = new Set<string>();
  // Match each <rede id="..."> opening, dann den ersten <redner>-Block bis </redner>
  const redeIter = xml.matchAll(/<rede[^>]*\bid="([^"]+)"[^>]*>[\s\S]*?<redner[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/redner>/g);
  for (const m of redeIter) {
    const redeId = m[1]!;
    if (seen.has(redeId)) continue;
    seen.add(redeId);
    const rednerId = m[2]!;
    const innerName = m[3]!;
    const vorname = (innerName.match(/<vorname>([^<]+)<\/vorname>/)?.[1] ?? "").trim();
    const nachname = (innerName.match(/<nachname>([^<]+)<\/nachname>/)?.[1] ?? "").trim();
    const titel = (innerName.match(/<titel>([^<]+)<\/titel>/)?.[1] ?? "").trim();
    const fraktion = (innerName.match(/<fraktion>([^<]+)<\/fraktion>/)?.[1] ?? "").trim();
    const rolleLang = (innerName.match(/<rolle_lang>([^<]+)<\/rolle_lang>/)?.[1] ?? "").trim();
    if (!vorname || !nachname) continue;
    records.push({ redeId, rednerId, vorname, nachname, titel, fraktion, rolleLang });
  }
  return records;
}

function slugifyPerson(nachname: string, vorname: string): string {
  return (`${vorname} ${nachname}`)
    .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function slugifyFraktion(label: string | undefined): string | null {
  if (!label) return null;
  return FRAKTION_LABELS[label] ?? null;
}

function buildActivity(plpr: PlPrEntry, rede: RedeRecord): Activity | null {
  const fraktionSlug = slugifyFraktion(rede.fraktion);
  if (!fraktionSlug && !rede.rolleLang) return null;
  const person: ActivityPerson = {
    slug: slugifyPerson(rede.nachname, rede.vorname),
    name: `${rede.vorname} ${rede.nachname}`,
    name_padoka: `${rede.nachname}, ${rede.vorname}`,
    role: "redner",
    fraktion: rede.fraktion || "Bundesregierung",
  };
  if (rede.titel) (person as ActivityPerson & { titel?: string }).titel = rede.titel;
  if (rede.rolleLang) (person as ActivityPerson & { funktion?: string }).funktion = rede.rolleLang;
  const a: Activity = {
    id: `dip-rede-${rede.redeId}`,
    source: "dip",
    parliament: PARLIAMENT_SLUG,
    wp: plpr.wahlperiode,
    type: "rede",
    title: `Rede im ${plpr.dokumentnummer}`,
    date: plpr.datum,
    persons: [person],
    fraktionen: fraktionSlug ? [fraktionSlug] : (rede.rolleLang ? ["bundesregierung"] : []),
    plenarprotokoll: { nr: plpr.dokumentnummer, date: plpr.datum },
  };
  if (plpr.fundstelle.pdf_url) a.document = { url: plpr.fundstelle.pdf_url };
  return a;
}

function filenameFor(a: Activity): string {
  const speakerSlug = a.persons[0]!.slug;
  return `${a.date}-rede-${a.id.replace("dip-rede-", "")}-${speakerSlug}.json`;
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
  const plprs = await fetchPlenarprotokolle();
  console.log(`[bundestag-reden] ${plprs.length} Plenarprotokolle gelistet (Jahr ${YEAR})`);
  let totalReden = 0, written = 0, skipped = 0, dropped = 0;
  for (const plpr of plprs) {
    if (!plpr.fundstelle.xml_url) continue;
    const xml = downloadXml(plpr.fundstelle.xml_url);
    const records = extractRedenFromXml(xml);
    totalReden += records.length;
    for (const rec of records) {
      const a = buildActivity(plpr, rec);
      if (!a) { dropped++; continue; }
      if (writeIfMissing(a) === "written") written++;
      else skipped++;
    }
    console.log(`  PlPr ${plpr.dokumentnummer} (${plpr.datum}) · ${records.length} Reden`);
  }
  console.log(`[bundestag-reden] ${totalReden} Reden gesamt · ${written} neu · ${skipped} vorhanden · ${dropped} verworfen`);
}

main().catch((e) => { console.error(e); process.exit(1); });
