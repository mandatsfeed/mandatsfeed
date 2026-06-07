// DIP-Adapter Deutscher Bundestag.
// Verwendet die offizielle JSON-API von dip.bundestag.de (Endpunkt
// /api/v1/aktivitaet) mit Cursor-Pagination. Beobachtet wird `f.zuordnung=BT`
// (nur Bundestag, nicht Bundesrat) und ein Datumsbereich.
//
// Voraussetzung: DIP_API_KEY in .env oder als Env-Var. Anfrage formlos per
// E-Mail an parlamentsdokumentation@bundestag.de — siehe
// https://dip.bundestag.de/über-dip/hilfe/api
//
// Aufruf:
//   pnpm run fetch:bundestag
//   YEAR=2026 pnpm run fetch:bundestag
//
// Idempotent + additiv.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Activity, ActivityPerson, ActivityType } from "../scripts/types.ts";

const PARLIAMENT_SLUG = "bundestag";
const PARLIAMENT_DIR = resolve(import.meta.dirname, "../wiki", PARLIAMENT_SLUG);
const YEAR = Number(process.env.YEAR ?? new Date().getUTCFullYear());

// Lightweight .env-Loader — Node 22 hat zwar --env-file, das aber wirft
// einen Fehler, wenn die Datei fehlt. Wir lesen still ein, falls vorhanden.
function loadDotenv(): void {
  const envPath = resolve(import.meta.dirname, "../.env");
  if (!existsSync(envPath)) return;
  for (const ln of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = ln.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k!]) continue;
    const v = vRaw!.replace(/^['"](.*)['"]$/, "$1");
    process.env[k!] = v;
  }
}
loadDotenv();

const DIP_API_KEY = process.env.DIP_API_KEY;
if (!DIP_API_KEY) {
  console.error(
    "DIP_API_KEY fehlt. In .env eintragen (siehe .env.example) oder als Env-Var setzen.\n" +
    "Key formlos per E-Mail anfordern: parlamentsdokumentation@bundestag.de",
  );
  process.exit(1);
}

const BASE = "https://search.dip.bundestag.de/api/v1";

const FRAKTION_LABELS: Record<string, string> = {
  "CDU/CSU": "cdu-csu",
  "CDU": "cdu-csu",
  "CSU": "cdu-csu",
  "SPD": "spd",
  "AfD": "afd",
  "BÜNDNIS 90/DIE GRÜNEN": "bundnis-90-die-gruenen",
  "GRÜNE": "bundnis-90-die-gruenen",
  "DIE LINKE": "die-linke",
  "Die Linke": "die-linke",
  "BSW": "bsw",
  "FDP": "fdp",
  "Fraktionslos": "fraktionslos",
  "fraktionslos": "fraktionslos",
  "Bundesregierung": "bundesregierung",
};

interface DipFundstelle {
  herausgeber?: string;
  dokumentnummer?: string;
  dokumentart?: string;
  pdf_url?: string;
  datum?: string;
}

interface DipUrheber {
  einzelperson?: { vorname?: string; nachname?: string; titel?: string; fraktion?: string };
  fraktion?: string;
  rolle?: string;
  bezeichnung?: string;
}

interface DipAktivitaet {
  id: number;
  aktivitaetsart?: string;
  titel?: string;
  datum?: string;
  aktualisiert?: string;
  wahlperiode?: number;
  fundstelle?: DipFundstelle;
  urheber?: DipUrheber[];
  vorgangsbezug?: Array<{ id: number; titel?: string; vorgangstyp?: string }>;
}

interface DipPage {
  numFound?: number;
  cursor?: string;
  documents?: DipAktivitaet[];
}

async function fetchPage(cursor?: string): Promise<DipPage> {
  const params = new URLSearchParams({
    apikey: DIP_API_KEY!,
    "f.zuordnung": "BT",
    "f.datum.start": `${YEAR}-01-01`,
    "f.datum.end": `${YEAR}-12-31`,
    format: "json",
  });
  if (cursor) params.set("cursor", cursor);
  const url = `${BASE}/aktivitaet?${params.toString()}`;
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "mandatsfeed/0.1" } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DIP HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as DipPage;
}

async function fetchAllItems(): Promise<DipAktivitaet[]> {
  const all: DipAktivitaet[] = [];
  let cursor: string | undefined;
  let pageIdx = 0;
  let total = 0;
  while (true) {
    const page = await fetchPage(cursor);
    if (!page.documents || page.documents.length === 0) break;
    all.push(...page.documents);
    total = page.numFound ?? total;
    pageIdx++;
    process.stdout.write(`  Seite ${pageIdx} · gesammelt: ${all.length}/${total}\n`);
    if (!page.cursor || page.cursor === cursor) break;
    cursor = page.cursor;
    if (all.length >= total) break;
  }
  return all;
}

function classify(aktArt: string | undefined): { type: ActivityType; subtype?: string; status?: string } | null {
  if (!aktArt) return null;
  const a = aktArt.toLowerCase();
  if (a.includes("kleine anfrage") && a.includes("antwort")) return { type: "kleine_anfrage", status: "mit_antwort", subtype: aktArt };
  if (a.includes("kleine anfrage")) return { type: "kleine_anfrage", status: "ohne_antwort", subtype: aktArt };
  if (a.includes("große anfrage") && a.includes("antwort")) return { type: "grosse_anfrage", status: "mit_antwort" };
  if (a.includes("große anfrage")) return { type: "grosse_anfrage" };
  if (a.includes("gesetzentwurf") || a.includes("gesetz-")) return { type: "gesetzentwurf" };
  if (a.includes("antrag") && a.includes("entschließ")) return { type: "antrag", subtype: "Entschließungsantrag" };
  if (a.includes("antrag") && a.includes("änderungs")) return { type: "antrag", subtype: "Änderungsantrag" };
  if (a.includes("antrag")) return { type: "antrag" };
  if (a.includes("rede") || a.includes("debattenbeitrag")) return { type: "rede" };
  if (a.includes("namentliche abstimmung") || a.includes("abstimmung")) return { type: "abstimmung" };
  if (a.includes("beschlussempfehlung")) return { type: "beschlussempfehlung" };
  return null;
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

function extractPersonsFromUrheber(urheber: DipUrheber[] | undefined): { persons: ActivityPerson[]; fraktionen: string[] } {
  const persons: ActivityPerson[] = [];
  const fraktionenSet = new Set<string>();
  for (const u of urheber ?? []) {
    if (u.einzelperson) {
      const ep = u.einzelperson;
      const nachname = ep.nachname?.trim();
      const vorname = ep.vorname?.trim();
      const fr = ep.fraktion?.trim();
      if (nachname && vorname) {
        persons.push({
          slug: slugifyPerson(nachname, vorname),
          name: `${vorname} ${nachname}`,
          name_padoka: `${nachname}, ${vorname}`,
          role: "antragsteller",
          fraktion: fr ?? "unbekannt",
        });
        const frSlug = slugifyFraktion(fr);
        if (frSlug) fraktionenSet.add(frSlug);
      }
    } else if (u.fraktion) {
      const frSlug = slugifyFraktion(u.fraktion);
      if (frSlug) fraktionenSet.add(frSlug);
    } else if (u.bezeichnung) {
      const frSlug = slugifyFraktion(u.bezeichnung);
      if (frSlug) fraktionenSet.add(frSlug);
    }
  }
  return { persons, fraktionen: Array.from(fraktionenSet) };
}

function buildActivity(item: DipAktivitaet, classified: { type: ActivityType; subtype?: string; status?: string }): Activity | null {
  const date = item.datum ?? item.fundstelle?.datum;
  if (!date) return null;
  const wp = item.wahlperiode ?? 0;
  if (!wp) return null;

  const drsNr = item.fundstelle?.dokumentnummer;
  const { persons, fraktionen } = extractPersonsFromUrheber(item.urheber);
  if (persons.length === 0 && fraktionen.length === 0) return null;

  const role: ActivityPerson["role"] =
    classified.type === "kleine_anfrage" || classified.type === "grosse_anfrage" ? "fragesteller" :
    classified.type === "rede" ? "redner" :
    classified.type === "abstimmung" ? "abstimmend" : "antragsteller";
  persons.forEach((p) => { p.role = role; });

  const idPrefix = classified.type === "kleine_anfrage" || classified.type === "grosse_anfrage" ? "ka"
    : classified.type === "gesetzentwurf" ? "ges"
    : classified.type === "rede" ? "rede"
    : classified.type === "abstimmung" ? "abst" : "drs";
  const drsSlug = drsNr ? drsNr.replace(/\//g, "-") : `aktivitaet-${item.id}`;

  const a: Activity = {
    id: `dip-${idPrefix}-${drsSlug}`,
    source: "dip",
    parliament: PARLIAMENT_SLUG,
    wp,
    type: classified.type,
    title: item.titel?.trim() ?? "(ohne Titel)",
    date,
    persons,
    fraktionen,
  };
  if (drsNr) a.drsNr = drsNr;
  if (classified.subtype) a.subtype = classified.subtype;
  if (classified.status) a.status = classified.status;
  if (item.fundstelle?.pdf_url) {
    a.document = {
      url: item.fundstelle.pdf_url,
      filename: item.fundstelle.pdf_url.split("/").pop() ?? undefined,
    };
  }
  return a;
}

function filenameFor(a: Activity): string {
  const typeSlug = a.type.replace(/_/g, "-");
  const slug = (a.drsNr ?? a.id).replace(/\//g, "-").replace(/^dip-[a-z]+-/, "");
  return `${a.date}-${typeSlug}-${slug}.json`;
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
  console.log(`[dip] ${items.length} Items geliefert (Jahr ${YEAR})`);

  let written = 0, skipped = 0, nonMandate = 0, unparsed = 0;
  for (const item of items) {
    const classified = classify(item.aktivitaetsart);
    if (!classified) { nonMandate++; continue; }
    const a = buildActivity(item, classified);
    if (!a) { unparsed++; continue; }
    if (writeIfMissing(a) === "written") written++;
    else skipped++;
  }
  console.log(`[dip] ${written} neu · ${skipped} schon vorhanden · ${nonMandate} keine Mandatsträger-Aktivität · ${unparsed} ungeparst`);
}

main().catch((e) => { console.error(e); process.exit(1); });
