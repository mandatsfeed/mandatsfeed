// Bundestag-Adapter — Namentliche Abstimmungen.
// Diese werden NICHT in DIP geliefert, sondern als XLSX-Listen auf
// bundestag.de/parlament/plenum/abstimmung/liste publiziert. Pro
// Abstimmung eine XLSX mit den Stimmen aller MdB (Name, Vorname,
// Fraktion, ja/nein/Enthaltung/ungültig/nichtabgegeben).
//
// Workflow:
// 1. Liste der Abstimmungen per agent-browser laden (HTML-SPA).
// 2. Pro Abstimmungsblock: Titel + Datum + XLSX-URL extrahieren.
// 3. XLSX herunterladen, parsen, eine Activity (type=abstimmung) mit
//    allen MdB-Stimmen schreiben.
//
// Aufruf:
//   pnpm run fetch-abstimmungen:bundestag
//   YEAR=2026 pnpm run fetch-abstimmungen:bundestag
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as XLSX from "xlsx";
import type { Activity, ActivityPerson, VoteResult } from "../scripts/types.ts";

const PARLIAMENT_SLUG = "bundestag";
const PARLIAMENT_DIR = resolve(import.meta.dirname, "../wiki", PARLIAMENT_SLUG);
const YEAR = Number(process.env.YEAR ?? new Date().getUTCFullYear());
const XLSX_CACHE = resolve(import.meta.dirname, "../.cache/bundestag-abst");

const LISTING_URL = "https://www.bundestag.de/parlament/plenum/abstimmung/liste";

const FRAKTION_LABELS: Record<string, string> = {
  "CDU/CSU": "cdu-csu", "CDU": "cdu-csu", "CSU": "cdu-csu",
  "SPD": "spd", "AfD": "afd",
  "BÜNDNIS 90/DIE GRÜNEN": "bundnis-90-die-gruenen", "GRÜNE": "bundnis-90-die-gruenen",
  "DIE LINKE": "die-linke", "Die Linke": "die-linke",
  "BSW": "bsw", "FDP": "fdp",
  "Fraktionslos": "fraktionslos", "fraktionslos": "fraktionslos",
};

interface AbstAbst {
  date: string; // YYYY-MM-DD
  title: string;
  xlsxUrl: string;
  blobId: string;
  sitzungIdx?: number;
}

function ab(...args: string[]): string {
  return execFileSync("agent-browser", args, { encoding: "utf-8" });
}

function fetchAbstimmungsListe(): AbstAbst[] {
  ab("open", LISTING_URL);
  ab("wait", "6000");
  const out = ab("eval", `(() => {
    const result = [];
    const links = document.querySelectorAll('a[href*=xlsx]');
    for (const a of links) {
      let p = a;
      for (let i = 0; i < 8; i++) {
        p = p.parentElement;
        if (!p) break;
        const t = p.textContent.replace(/\\s+/g, ' ').trim();
        if (t.length > 60 && t.length < 500) {
          const dateMatch = t.match(/(\\d{2}\\.\\d{2}\\.\\d{4})/);
          const titleMatch = t.match(/\\d{2}\\.\\d{2}\\.\\d{4}:\\s*(.+?)\\s*(PDF|XLSX|Download)/);
          if (dateMatch && titleMatch) {
            result.push({
              date: dateMatch[1],
              title: titleMatch[1].trim(),
              xlsxUrl: a.href,
            });
            break;
          }
        }
      }
    }
    return result;
  })()`);
  const m = out.match(/^\[[\s\S]*\]/m);
  if (!m) return [];
  return JSON.parse(m[0]) as AbstAbst[];
}

function parseGermanDate(s: string): string {
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

// XLSX-URL endet auf "...YYYYMMDD_N_xls.xlsx" oder "...YYYYMMDD_xls.xlsx".
// Das Datum dort ist verlässlicher als der textContent-Scrape des Listings
// (der bei Titeln wie "Haushalt 2026" leicht falsche Jahre matcht).
function dateFromXlsxUrl(url: string): string {
  const m = url.match(/(\d{4})(\d{2})(\d{2})_[^/]*\.xlsx$/i);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function downloadXlsx(url: string): Buffer {
  const id = url.split("/").slice(-2)[0]; // blob id
  const fname = `${id}-${url.split("/").pop()}`;
  const cachePath = join(XLSX_CACHE, fname);
  if (existsSync(cachePath)) return readFileSync(cachePath);
  mkdirSync(XLSX_CACHE, { recursive: true });
  execFileSync("curl", ["-sSL", "-A", "mandatsfeed/0.1 (Forschungsprojekt)", "-o", cachePath, url]);
  return readFileSync(cachePath);
}

interface VoteRow {
  Wahlperiode: number;
  Sitzungnr: number;
  Abstimmnr: number;
  "Fraktion/Gruppe": string;
  Name: string;
  Vorname: string;
  ja?: number;
  nein?: number;
  Enthaltung?: number;
  "ungültig"?: number;
  nichtabgegeben?: number;
  Bezeichnung?: string;
}

function parseXlsx(buf: Buffer): VoteRow[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]!];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<VoteRow>(sheet);
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

function buildActivity(abst: AbstAbst, rows: VoteRow[]): Activity | null {
  if (rows.length === 0) return null;
  const first = rows[0]!;
  const wp = first.Wahlperiode;
  const sitzung = first.Sitzungnr;
  const abstNr = first.Abstimmnr;
  const date = dateFromXlsxUrl(abst.xlsxUrl) || parseGermanDate(abst.date);
  if (!date) return null;
  const id = `dip-abst-${wp}-${sitzung}-${abstNr}`;

  const persons: ActivityPerson[] = [];
  const fraktionenSet = new Set<string>();
  let ja = 0, nein = 0, enthalten = 0, abwesend = 0;
  for (const r of rows) {
    const v: ActivityPerson["vote"] =
      r.ja ? "ja" :
      r.nein ? "nein" :
      r.Enthaltung ? "enthalten" :
      "abwesend";
    if (v === "ja") ja++;
    else if (v === "nein") nein++;
    else if (v === "enthalten") enthalten++;
    else abwesend++;
    const frSlug = slugifyFraktion(r["Fraktion/Gruppe"]);
    if (frSlug) fraktionenSet.add(frSlug);
    persons.push({
      slug: slugifyPerson(r.Name, r.Vorname),
      name: `${r.Vorname} ${r.Name}`,
      name_padoka: `${r.Name}, ${r.Vorname}`,
      role: "abstimmend",
      fraktion: r["Fraktion/Gruppe"],
      vote: v,
    });
  }
  const stimmberechtigt = persons.length;
  const result: VoteResult["result"] =
    ja > nein ? "annahme" : nein > ja ? "ablehnung" : "sonstig";

  const a: Activity = {
    id,
    source: "dip",
    parliament: PARLIAMENT_SLUG,
    wp,
    type: "abstimmung",
    title: abst.title,
    date,
    persons,
    fraktionen: Array.from(fraktionenSet),
    vote: { result, ja, nein, enthalten, abwesend, stimmberechtigt },
    plenarprotokoll: { nr: `${wp}/${sitzung}`, date },
    document: { url: abst.xlsxUrl },
  };
  return a;
}

function filenameFor(a: Activity): string {
  return `${a.date}-abstimmung-${a.id.replace("dip-abst-", "")}.json`;
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
  const all = fetchAbstimmungsListe();
  // Filter to YEAR
  const inYear = all.filter((a) => (dateFromXlsxUrl(a.xlsxUrl) || parseGermanDate(a.date)).startsWith(String(YEAR)));
  console.log(`[bundestag-abstimmungen] ${all.length} Abstimmungen gelistet, davon ${inYear.length} in ${YEAR}`);
  let written = 0, skipped = 0, errors = 0;
  for (const abst of inYear) {
    try {
      const buf = downloadXlsx(abst.xlsxUrl);
      const rows = parseXlsx(buf);
      const activity = buildActivity(abst, rows);
      if (!activity) { errors++; continue; }
      if (writeIfMissing(activity) === "written") written++;
      else skipped++;
      console.log(`  ${abst.date} · ${rows.length} Stimmen · ${activity.title.slice(0, 70)}`);
    } catch (e) {
      console.error(`  Fehler ${abst.date}:`, (e as Error).message);
      errors++;
    }
  }
  console.log(`[bundestag-abstimmungen] ${written} neu · ${skipped} vorhanden · ${errors} Fehler`);
}

main().catch((e) => { console.error(e); process.exit(1); });
