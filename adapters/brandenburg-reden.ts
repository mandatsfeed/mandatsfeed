// STARWEB-Adapter Brandenburg — Reden im Plenum.
// Brandenburg unterstützt anders als PADOKA Sachsen-Anhalt keine globale
// Reden-Liste, sondern nur per-Redner-Suche. Wir iterieren daher über die
// 88 Einträge der personen.registry.json (eine pro MdL) und holen jeweils
// die Vorgänge, in denen die Person geredet hat.
//
// Aufruf:
//   pnpm run fetch-reden:brandenburg
//   YEAR=2026 pnpm run fetch-reden:brandenburg
//   pnpm run fetch-reden:brandenburg -- <slug>
//
// Idempotent + additiv.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Activity, ActivityPerson } from "../scripts/types.ts";

const PARLIAMENT_SLUG = "brandenburg";
const PARLIAMENT_DIR = resolve(import.meta.dirname, "../wiki", PARLIAMENT_SLUG);
const WP = Number(process.env.WP ?? "8");
const WP_DIR = join(PARLIAMENT_DIR, `wp-${WP}`);
const REGISTRY_PATH = join(WP_DIR, "personen.registry.json");
const YEAR = Number(process.env.YEAR ?? new Date().getUTCFullYear());

interface RegistryEntry {
  name: string;
  name_padoka: string;
  fraktion: string | null;
  title?: string;
  regierungsmitglied?: string; // Ressort-Label, wenn MdL Regierungsmitglied ist
  urls: { initiativen?: string | null; reden?: string | null };
}

interface RawRecord {
  recId: string;
  title: string;
  meta: string;
  documentUrl: string | null;
}

const FRAKTION_SLUGS: Record<string, string> = {
  SPD: "spd", AfD: "afd", CDU: "cdu", BSW: "bsw",
  "Die Linke": "die-linke", FDP: "fdp",
  "BÜNDNIS 90/DIE GRÜNEN": "bundnis-90-die-gruenen",
  fraktionslos: "fraktionslos",
};

function ab(...args: string[]): string {
  return execFileSync("agent-browser", args, { encoding: "utf-8" });
}

function loadRegistry(): Record<string, RegistryEntry> {
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as Record<string, RegistryEntry>;
}

function waitForResults(): number {
  for (let i = 0; i < 30; i++) {
    const out = ab("eval", "(()=>document.querySelectorAll('[data-efx-rec]').length)()");
    const n = Number((out.match(/^\d+/m) ?? ["0"])[0]);
    if (n > 0) return n;
    ab("wait", "500");
  }
  return 0;
}

function clickAlleAufEinerSeite(): boolean {
  const out = ab("eval", "(()=>{const opt=Array.from(document.querySelectorAll('.multiselect-option')).find(x=>/Alle auf einer Seite/.test(x.textContent));if(opt){opt.click();return true}return false})()");
  return /true/.test(out);
}

function extractRecordsOnPage(): RawRecord[] {
  const jsExpr = `(() => {
    return Array.from(document.querySelectorAll('[data-efx-rec]')).map(rec => {
      const recId = rec.getAttribute('data-efx-rec') || '';
      const short = rec.querySelector('.efxUnzoomGeneric1') || rec;
      const title = short.querySelector('h3')?.textContent.trim() || '';
      const meta = short.querySelector('.h6')?.textContent.replace(/\\s+/g, ' ').trim() || '';
      const docA = rec.querySelector('a[href*="/files/"], a[href*="/starweb/"], a[href*="/parladoku/"]');
      const documentUrl = docA ? docA.getAttribute('href') : null;
      return { recId, title, meta, documentUrl };
    }).filter(r => r.recId && r.title);
  })()`;
  const raw = ab("eval", jsExpr);
  const m = raw.match(/^\[[\s\S]*\]/m);
  if (!m) return [];
  return JSON.parse(m[0]) as RawRecord[];
}

function fetchForRedner(redenUrl: string): RawRecord[] {
  // Datums-Filter dranhängen
  const url = redenUrl.includes("from=") ? redenUrl : `${redenUrl}&from=01.01.${YEAR}&to=31.12.${YEAR}`;
  ab("open", url);
  const n = waitForResults();
  if (n === 0) return [];
  // Bei >50 Treffern „Alle auf einer Seite" — bei wenigen Treffern reicht die erste Seite.
  clickAlleAufEinerSeite();
  for (let i = 0; i < 15; i++) ab("wait", "500");
  return extractRecordsOnPage();
}

function parseGermanDate(s: string): string | null {
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

interface ParsedMeta {
  date: string;
  drsNr: string | undefined;
  authorFraktionen: string[]; // Fraktionen, die als Antragsteller/Frager in der meta auftauchen
  authorIsLandesregierung: boolean;
  askerName?: string;
}

function parseMeta(meta: string): ParsedMeta {
  const dateMatch = meta.match(/(\d{2}\.\d{2}\.\d{4})/);
  const date = dateMatch ? parseGermanDate(dateMatch[1])! : "";
  const drsMatch = meta.match(/Drucksache\s+(\d+\/[A-Za-z0-9]+)/);
  // Antragsteller-Heuristik aus dem führenden Meta-Pattern:
  //   "Mündliche Anfrage 422 Dr. Daniela Oeynhausen (AfD) 22.04.2026 ..."
  //   "Antrag (BSW, CDU) 10.03.2026 ..."
  //   "Gesetzentwurf (Landesregierung) 10.04.2026 ..."
  //   "Dringliche Anfrage 11 Andreas Kutsche (BSW) 20.02.2026 ..."
  const authorFraktionen: string[] = [];
  let authorIsLandesregierung = false;
  let askerName: string | undefined;
  // Anfragen tauchen oft mit "Fragestunde …" als Prefix auf — daher ohne ^-Anker.
  const askerRe = /(?:Mündliche|Dringliche|Schriftliche|Kleine|Große)\s+Anfrage\s+\d+\s+([^()]+?)\s*\(([^)]+)\)/;
  const authorRe = /^(?:Antrag|Alternativantrag|Entschließungsantrag|Gesetzentwurf|Beschlussempfehlung|Bericht|Verordnung|Wahlvorschlag)\s+\(([^)]+)\)/;
  const am = meta.match(askerRe);
  const am2 = meta.match(authorRe);
  if (am) {
    askerName = am[1]!.trim();
    for (const f of am[2]!.split(/[,/]/).map((s) => s.trim())) {
      if (/Landesregierung/i.test(f)) authorIsLandesregierung = true;
      else authorFraktionen.push(f);
    }
  } else if (am2) {
    for (const f of am2[1]!.split(/[,/]/).map((s) => s.trim())) {
      if (/Landesregierung/i.test(f)) authorIsLandesregierung = true;
      else authorFraktionen.push(f);
    }
  }
  return { date, drsNr: drsMatch?.[1], authorFraktionen, authorIsLandesregierung, askerName };
}

function slugifyFraktion(fr: string | null): string {
  if (!fr) return "fraktionslos";
  return FRAKTION_SLUGS[fr] ?? fr.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function buildActivity(slug: string, entry: RegistryEntry, raw: RawRecord, parsed: ParsedMeta): Activity | null {
  if (!parsed.date) return null;
  const drsNr = parsed.drsNr;
  const drsSlug = drsNr ? drsNr.replace(/\//g, "-") : `vorgang-${raw.recId.slice(-8)}`;
  const id = `starweb-bb-rede-${drsSlug}-${slug}`;

  // Wenn der MdL Regierungsmitglied ist UND der Beitrag erkennbar zu einem fremden
  // Vorgang gesprochen wurde (Anfrage anderer MdL, Antrag/Gesetzentwurf anderer
  // Fraktion oder der Landesregierung selbst), wird die Rede als
  // Regierungsbeitrag attribuiert — die normale Heim-Fraktion bleibt im
  // persons[].fraktion erhalten, aber die top-level fraktionen[] zeigen auf
  // "landesregierung", damit die Aggregation korrekt landet.
  const ownFraktion = entry.fraktion;
  const isMinister = !!entry.regierungsmitglied;
  const askerIsSelf = parsed.askerName ? parsed.askerName.includes(entry.name.split(" ").slice(-1)[0]!) : false;
  const authorMatchesOwn = ownFraktion && parsed.authorFraktionen.includes(ownFraktion);
  const fremderVorgang =
    (parsed.askerName !== undefined && !askerIsSelf) ||
    (parsed.authorFraktionen.length > 0 && !authorMatchesOwn) ||
    parsed.authorIsLandesregierung;
  // Minister ohne eigene Fraktion (externe Kabinettsmitglieder) sprechen
  // grundsätzlich für die Landesregierung.
  const attributeAsRegierung = isMinister && (fremderVorgang || !ownFraktion);

  const person: ActivityPerson = {
    slug,
    name: entry.name,
    name_padoka: entry.name_padoka,
    role: attributeAsRegierung ? "antwortend" : "redner",
    fraktion: attributeAsRegierung
      ? (entry.regierungsmitglied ?? "Landesregierung")
      : (ownFraktion ?? "fraktionslos"),
  };
  const a: Activity = {
    id,
    source: "starweb",
    parliament: PARLIAMENT_SLUG,
    wp: WP,
    type: "rede",
    title: raw.title,
    date: parsed.date,
    persons: [person],
    fraktionen: [attributeAsRegierung ? "landesregierung" : slugifyFraktion(ownFraktion)],
  };
  if (drsNr) a.drsNr = drsNr;
  if (raw.documentUrl) {
    a.document = {
      url: raw.documentUrl.startsWith("http") ? raw.documentUrl : `https://www.parlamentsdokumentation.brandenburg.de${raw.documentUrl}`,
    };
  }
  if (raw.meta) a.summary = raw.meta;
  return a;
}

function filenameFor(a: Activity): string {
  const drsSlug = (a.drsNr ?? a.id.split("-").slice(-2, -1)[0])!.replace(/\//g, "-");
  const speakerSlug = a.persons[0]!.slug;
  return `${a.date}-rede-${drsSlug}-${speakerSlug}.json`;
}

function writeIfMissing(a: Activity): "written" | "skipped" {
  const dir = join(PARLIAMENT_DIR, `wp-${a.wp}`, "aktivitaet", a.date);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filenameFor(a));
  if (existsSync(path)) return "skipped";
  writeFileSync(path, JSON.stringify(a, null, 2) + "\n");
  return "written";
}

function main(): void {
  const onlySlug = process.argv[2];
  const registry = loadRegistry();
  const targets = onlySlug
    ? Object.entries(registry).filter(([s]) => s === onlySlug)
    : Object.entries(registry);
  if (onlySlug && targets.length === 0) {
    console.error(`Slug "${onlySlug}" nicht in personen.registry.json`);
    process.exit(1);
  }
  let totalWritten = 0, totalSkipped = 0, totalRecords = 0;
  let mdlsSeen = 0;
  for (const [slug, entry] of targets) {
    if (!entry.urls.reden) continue;
    mdlsSeen++;
    const records = fetchForRedner(entry.urls.reden);
    totalRecords += records.length;
    let written = 0, skipped = 0;
    for (const r of records) {
      const parsed = parseMeta(r.meta);
      const a = buildActivity(slug, entry, r, parsed);
      if (!a) continue;
      if (writeIfMissing(a) === "written") written++;
      else skipped++;
    }
    if (records.length > 0) console.log(`  [${slug}] ${records.length} Records · ${written} neu · ${skipped} vorhanden`);
    totalWritten += written; totalSkipped += skipped;
  }
  console.log(`[brandenburg-reden] ${mdlsSeen} MdL durchsucht · ${totalRecords} Records gesamt · ${totalWritten} neu · ${totalSkipped} vorhanden`);
}

main();
