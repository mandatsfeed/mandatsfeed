// Parldok-TH-Reden-Adapter.
//
// Quelle: Plenarprotokoll-PDFs des Landtags Mecklenburg-Vorpommern.
//   1. Liste der PlPr-Drucksachen über parldok-Facet 7_1_2 (Dokumentart: PlPr)
//   2. Pro Sitzung: GET /parldok/dokument/<docid> liefert die PDF direkt
//   3. Speaker-Header im Volltext per Regex extrahieren:
//        "<Name>, <Fraktion>:" am Anfang einer Sektion (nach Paragraph oder
//        nach ")"-Close von Beifall/Zwischenruf-Klammer).
//
// Aufruf:
//   pnpm run fetch-reden:thueringen
//   YEAR=2026 pnpm run fetch-reden:thueringen
//
// Idempotent + additiv.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PDFParse } from "pdf-parse";
import type { Activity, ActivityPerson } from "../scripts/types.ts";

const PARLIAMENT_SLUG = "thueringen";
const PARLIAMENT_DIR = resolve(import.meta.dirname, "../wiki", PARLIAMENT_SLUG);
const WP = Number(process.env.WP ?? "8");
const YEAR = process.env.YEAR ? Number(process.env.YEAR) : undefined;
const MIN_DATE = process.env.MIN_DATE ?? (YEAR ? `${YEAR}-01-01` : "2026-01-01");
const PDF_CACHE = resolve(import.meta.dirname, "../.cache/thueringen-plpr");

const LISTING_URL = "https://parldok.thueringer-landtag.de/parldok/neu/10_1_8___8.%20Wahlperiode%20(ab%2026.09.2024)/7_1_3___Dokumentart%3A%20Plenarprotokoll";

const FRAKTION_LABELS: Record<string, string> = {
  "CDU": "cdu",
  "AfD": "afd",
  "BSW": "bsw",
  "Die Linke": "die-linke",
  "DIE LINKE": "die-linke",
  "SPD": "spd",
  "fraktionslos": "fraktionslos",
};

interface PlPrEntry {
  docid: string;
  plprNr: string; // z.B. "8/130"
  date: string;   // YYYY-MM-DD
  title: string;
}

interface SpeakerHit {
  name: string;
  fraktion: string;
  count: number;
}

function ab(...args: string[]): string {
  return execFileSync("agent-browser", args, { encoding: "utf-8" });
}

function fetchPlPrList(): PlPrEntry[] {
  ab("open", LISTING_URL);
  ab("wait", "3000");
  // Auf 100 pro Seite umschalten — Parldok hat max 1000 pro Suche.
  ab("eval", "(()=>{const s=Array.from(document.querySelectorAll('select')).find(x=>x.options[0]?.value==='10');if(s){s.value='100';s.dispatchEvent(new Event('change',{bubbles:true}))}})()");
  ab("wait", "3000");
  // agent-browser JSON-stringifyt das Eval-Resultat selbst — wir geben
  // direkt das Array zurück, nicht erneut JSON.stringify aufrufen.
  const out = ab("eval", `(()=>Array.from(document.querySelectorAll('li.docrow')).map(li=>{
    const meta=li.querySelector('p')?.textContent.replace(/\\s+/g,' ').trim()||'';
    const m=meta.match(/^(\\d+\\/[\\dA-Za-z]+)\\s+°?\\s*(?:Plenar)?(?:Sitzung|sitzung)\\s+vom\\s+(\\d{2}\\.\\d{2}\\.\\d{4})/);
    return {
      docid:li.getAttribute('data-docid')||'',
      title:li.querySelector('h2')?.textContent.trim()||'',
      plprNr:m?m[1]:'',
      dateGer:m?m[2]:'',
    };
  }))()`);
  const json = out.match(/^\[[\s\S]*\]/m)?.[0] ?? "[]";
  type Raw = { docid: string; title: string; plprNr: string; dateGer: string };
  const raws = JSON.parse(json) as Raw[];
  return raws
    .filter((r) => r.docid && r.plprNr && r.dateGer)
    .map((r) => {
      const m = r.dateGer.match(/(\d{2})\.(\d{2})\.(\d{4})/)!;
      return {
        docid: r.docid,
        plprNr: r.plprNr,
        date: `${m[3]}-${m[2]}-${m[1]}`,
        title: r.title,
      };
    });
}

function downloadPdf(docid: string): Buffer {
  const cachePath = join(PDF_CACHE, `mv-plpr-${docid}.pdf`);
  if (existsSync(cachePath)) return readFileSync(cachePath);
  mkdirSync(PDF_CACHE, { recursive: true });
  execFileSync("curl", [
    "-sSL", "-A", "mandatsfeed/0.1 (Forschungsprojekt)",
    "-o", cachePath,
    `https://parldok.thueringer-landtag.de/parldok/dokument/${docid}`,
  ]);
  return readFileSync(cachePath);
}

// Rollen-/Anrede-Präfixe, die im Thüringer PlPr-PDF gelegentlich vor dem
// eigentlichen Namen stehen ("Abgeordnete Merz, SPD:"). Werden vor dem
// Slug-Build entfernt; bei reinem "Abgeordnete <Nachname>" mappen wir
// anhand der zuvor im selben PlPr aufgetauchten "Vorname Nachname"-Form
// auf den vollen Namen.
const ROLE_PREFIXES = /^(Abgeordnete[rn]?|Vizepräsident(?:in)?|Ministerpräsident(?:in)?|Minister(?:in)?|Staatssekretär(?:in)?|Präsident(?:in)?)\s+/;

// MdL-Registry für Nachname → Vollname-Lookup. Wird einmal beim Adapter-Start
// geladen. Quelle: scripts/build-thueringen-mdl-registry.ts.
const MDL_REGISTRY_PATH = resolve(import.meta.dirname, "../wiki/thueringen", `wp-${WP}`, "mdl-name-registry.json");
let MDL_REGISTRY: Record<string, { name: string; vorname: string; nachname: string }> = {};
if (existsSync(MDL_REGISTRY_PATH)) {
  MDL_REGISTRY = JSON.parse(readFileSync(MDL_REGISTRY_PATH, "utf-8"));
}

async function extractSpeakers(buf: Buffer): Promise<Map<string, number>> {
  const t = await new PDFParse({ data: buf }).getText();
  const text = t.text;
  const fraktionAlt = Object.keys(FRAKTION_LABELS)
    .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length)
    .join("|");
  const re = new RegExp(
    `([A-ZÄÖÜ][\\wäöüß-]+(?:[ -](?:[a-zäöü]+ )?[A-ZÄÖÜ][\\wäöüß-]+){1,4}), (${fraktionAlt}):`,
    "g",
  );
  const counts = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    if (!/\)\s*$|\n\s*$/.test(before)) continue;
    let name = m[1]!.replace(ROLE_PREFIXES, "").trim();
    if (!/\s/.test(name)) {
      // Reine "<Nachname>"-Form nach Prefix-Strip: über MdL-Registry auf
      // vollen Namen mappen. Wenn nicht gefunden, Speaker überspringen
      // (keine bogus "Abgeordnete X"-Slugs erzeugen).
      const entry = MDL_REGISTRY[name.toLowerCase()];
      if (!entry) continue;
      name = entry.name;
    }
    counts.set(`${name}|${m[2]!}`, (counts.get(`${name}|${m[2]!}`) ?? 0) + 1);
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
  const nachname = parts.slice(-1)[0]!;
  const adlig = parts.length >= 3 && /^(von|zu|de|van)$/i.test(parts[parts.length - 2]!)
    ? parts[parts.length - 2] + " "
    : "";
  const trueNachname = adlig + nachname;
  const vorname = parts.slice(0, parts.length - (adlig ? 2 : 1)).join(" ");
  return { vorname, nachname: trueNachname };
}

function buildActivity(plpr: PlPrEntry, hit: SpeakerHit): Activity | null {
  const name = splitName(hit.name);
  if (!name) return null;
  const fraktionSlug = FRAKTION_LABELS[hit.fraktion];
  if (!fraktionSlug) return null;
  const personSlug = slugifyPerson(name.nachname, name.vorname);
  const plprSlug = plpr.plprNr.replace("/", "-");
  return {
    id: `parldok-rede-${PARLIAMENT_SLUG}-${plprSlug}-${personSlug}`,
    source: "parldok",
    parliament: PARLIAMENT_SLUG,
    wp: Number(plpr.plprNr.split("/")[0]),
    type: "rede",
    title: `${hit.count} Redebeitr${hit.count === 1 ? "ag" : "äge"} in PlPr ${plpr.plprNr}`,
    date: plpr.date,
    persons: [{
      slug: personSlug,
      name: hit.name,
      name_padoka: `${name.nachname}, ${name.vorname}`,
      role: "redner",
      fraktion: hit.fraktion,
    }],
    fraktionen: [fraktionSlug],
    plenarprotokoll: { nr: plpr.plprNr, date: plpr.date },
    document: { url: `https://parldok.thueringer-landtag.de/parldok/dokument/${plpr.docid}` },
  };
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
  const entries = fetchPlPrList()
    .filter((e) => e.date >= MIN_DATE)
    .sort((a, b) => b.date.localeCompare(a.date));
  console.log(`[parldok-th-reden] ${entries.length} Plenarprotokolle seit ${MIN_DATE}`);
  let written = 0, skipped = 0, totalSpeakers = 0;
  for (const plpr of entries) {
    try {
      const buf = downloadPdf(plpr.docid);
      const speakers = await extractSpeakers(buf);
      let plprWritten = 0;
      for (const [key, count] of speakers) {
        const [name, fraktion] = key.split("|") as [string, string];
        const a = buildActivity(plpr, { name, fraktion, count });
        if (!a) continue;
        if (writeIfMissing(a) === "written") { written++; plprWritten++; }
        else skipped++;
      }
      totalSpeakers += speakers.size;
      console.log(`  PlPr ${plpr.plprNr} (${plpr.date}) · ${speakers.size} Redner:innen · ${plprWritten} neu`);
    } catch (e) {
      console.error(`  Fehler PlPr ${plpr.plprNr}:`, (e as Error).message);
    }
  }
  console.log(`[parldok-th-reden] ${totalSpeakers} Speaker-Auftritte gesamt · ${written} neu · ${skipped} vorhanden`);
}

main().catch((e) => { console.error(e); process.exit(1); });
