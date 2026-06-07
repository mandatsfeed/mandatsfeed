// REDAS-Reden-Adapter Sächsischer Landtag.
// REDAS liefert Plenarprotokolle als JSON-Liste, der Volltext ist in PDFs
// (oft in mehreren Teildateien pro Sitzung). Wir nehmen pro PlPr-Nummer
// die erste Datei (Hauptprotokoll), parsen die Reden-Wechselsignale
// "<Name>, <Fraktion>:" und schreiben pro Speaker × PlPr eine Activity.
//
// Aufruf:
//   pnpm run fetch-reden:sachsen
//   YEAR=2026 pnpm run fetch-reden:sachsen
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PDFParse } from "pdf-parse";
import type { Activity, ActivityPerson } from "../scripts/types.ts";

const PARLIAMENT_SLUG = "sachsen";
const PARLIAMENT_DIR = resolve(import.meta.dirname, "../wiki", PARLIAMENT_SLUG);
const WP = Number(process.env.WP ?? "8");
const YEAR = Number(process.env.YEAR ?? new Date().getUTCFullYear());
const PDF_CACHE = "/tmp/mandatsfeed-sachsen-plpr";

const BASE = "https://redas.landtag.sachsen.de/redas";

const FRAKTION_LABELS: Record<string, string> = {
  "CDU": "cdu", "AfD": "afd", "BSW": "bsw", "SPD": "spd",
  "Die Linke": "die-linke", "DIE LINKE": "die-linke",
  "BÜNDNISGRÜNE": "bundnisgruene", "BÜNDNIS 90/DIE GRÜNEN": "bundnisgruene",
  "GRÜNE": "bundnisgruene", "FDP": "fdp",
};

interface RedasFile { id: number; filename: string; url: string }
interface RedasItem {
  id: number;
  dokumentenart: string;
  titel: string;
  fundstelleAutor: string;
  anzeigeId: string;
  dateien: RedasFile[];
}

async function fetchPlPrs(): Promise<RedasItem[]> {
  const params = new URLSearchParams({
    pageNumber: "0",
    pageSize: "10000",
    sortId: "4",
    wahlperiode: String(WP),
    dokArt: "PlPr",
    anfangsDatum: `${YEAR}-01-01`,
    endeDatum: `${YEAR}-12-31`,
  });
  const res = await fetch(`${BASE}/query?${params.toString()}`, {
    headers: { Accept: "application/json", "User-Agent": "mandatsfeed/0.1" },
  });
  const txt = await res.text();
  const last = txt.lastIndexOf("]");
  return JSON.parse(txt.slice(0, last + 1)) as RedasItem[];
}

function downloadPdf(dateiId: number, filename: string): Buffer {
  const cachePath = join(PDF_CACHE, filename);
  if (existsSync(cachePath)) return readFileSync(cachePath);
  mkdirSync(PDF_CACHE, { recursive: true });
  execFileSync("curl", [
    "-sSL", "-A", "mandatsfeed/0.1 (Forschungsprojekt)",
    "-o", cachePath,
    `${BASE}/download/file?datei_id=${dateiId}`,
  ]);
  return readFileSync(cachePath);
}

interface RednerHit { name: string; fraktion: string }

function extractSpeakers(text: string): Map<string, number> {
  // "Susanne Schaper, Die Linke:" — Name, Fraktion : (Doppelpunkt am Zeilenende).
  // Wir zählen pro Auftritt.
  const counts = new Map<string, number>();
  const fraktionAlt = Object.keys(FRAKTION_LABELS)
    .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length)
    .join("|");
  const re = new RegExp(`\\b([A-ZÄÖÜ][\\wäöüß-]+(?:\\s+[A-ZÄÖÜ][\\wäöüß-]+)+)\\s*,\\s*(${fraktionAlt})\\s*:`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1]!.trim();
    const fraktion = m[2]!;
    const key = `${name}|${fraktion}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function slugifyPerson(nachname: string, vorname: string): string {
  return (`${vorname} ${nachname}`)
    .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function splitName(full: string): { vorname: string; nachname: string } | null {
  const parts = full.split(/\s+/);
  if (parts.length < 2) return null;
  const nachname = parts[parts.length - 1]!;
  const vorname = parts.slice(0, -1).join(" ");
  return { vorname, nachname };
}

function buildActivity(plpr: RedasItem, hit: RednerHit, count: number): Activity | null {
  const name = splitName(hit.name);
  if (!name) return null;
  const dateMatch = plpr.fundstelleAutor.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!dateMatch) return null;
  const date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  const plprNr = plpr.anzeigeId.replace("PlPr ", "");
  const plprSlug = plprNr.replace("/", "-");
  const personSlug = slugifyPerson(name.nachname, name.vorname);
  const fraktionSlug = FRAKTION_LABELS[hit.fraktion]!;
  const a: Activity = {
    id: `edas-rede-${plprSlug}-${personSlug}`,
    source: "edas",
    parliament: PARLIAMENT_SLUG,
    wp: Number(plprNr.split("/")[0]),
    type: "rede",
    title: `${count} Redebeitr${count === 1 ? "ag" : "äge"} in ${plpr.titel}`,
    date,
    persons: [{
      slug: personSlug,
      name: hit.name,
      name_padoka: `${name.nachname}, ${name.vorname}`,
      role: "redner",
      fraktion: hit.fraktion,
    }],
    fraktionen: [fraktionSlug],
    plenarprotokoll: { nr: plprNr, date },
    document: {
      url: `${BASE}/download/file?datei_id=${plpr.dateien[0]?.id}`,
    },
  };
  return a;
}

function filenameFor(a: Activity): string {
  const plprSlug = a.plenarprotokoll!.nr.replace("/", "-");
  const speakerSlug = a.persons[0]!.slug;
  return `${a.date}-rede-${plprSlug}-${speakerSlug}.json`;
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
  const items = await fetchPlPrs();
  // Eine PlPr-Sitzung hat oft mehrere Teildateien. Wir nehmen die erste je
  // anzeigeId (Hauptprotokoll).
  const byPlPr = new Map<string, RedasItem>();
  for (const it of items) {
    if (!byPlPr.has(it.anzeigeId)) byPlPr.set(it.anzeigeId, it);
  }
  console.log(`[sachsen-reden] ${byPlPr.size} Plenarprotokolle in ${YEAR}`);

  let totalRednerInstanzen = 0, written = 0, skipped = 0;
  for (const plpr of byPlPr.values()) {
    if (!plpr.dateien?.[0]) continue;
    const buf = downloadPdf(plpr.dateien[0].id, plpr.dateien[0].filename);
    const t = await new PDFParse({ data: buf }).getText();
    const speakers = extractSpeakers(t.text);
    let plprWritten = 0;
    for (const [key, count] of speakers) {
      const [name, fraktion] = key.split("|") as [string, string];
      const a = buildActivity(plpr, { name, fraktion }, count);
      if (!a) continue;
      if (writeIfMissing(a) === "written") { written++; plprWritten++; }
      else skipped++;
    }
    totalRednerInstanzen += speakers.size;
    console.log(`  ${plpr.anzeigeId} · ${speakers.size} Redner:innen · ${plprWritten} neu`);
  }
  console.log(`[sachsen-reden] ${totalRednerInstanzen} Redner-Auftritte gesamt · ${written} neu · ${skipped} vorhanden`);
}

main().catch((e) => { console.error(e); process.exit(1); });
