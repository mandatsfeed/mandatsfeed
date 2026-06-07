// PADOKA-Adapter — Reden im Plenum, globaler Sweep mit Datumsfilter.
// Verwendet die generische Reden-Suche ohne Speaker-Filter und paginiert
// über alle Treffer der gewählten Jahres-Periode. Speaker werden aus
// dem ersten Card-Header gelesen und auf nachfolgende Cards vererbt
// (PADOKA gruppiert Reden alphabetisch pro Redner:in).
//
// Aufruf:
//   pnpm run fetch-reden:sachsen-anhalt              → Default-Jahr
//   YEAR=2026 pnpm run fetch-reden:sachsen-anhalt    → bestimmtes Jahr
//
// Idempotent + additiv.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Activity, ActivityPerson } from "../scripts/types.ts";

const PARLIAMENT_SLUG = "sachsen-anhalt";
const WIKI = resolve(import.meta.dirname, "../wiki", PARLIAMENT_SLUG);
const REGISTRY_PATH = join(WIKI, "personen.registry.json");
const YEAR = Number(process.env.YEAR ?? new Date().getUTCFullYear());

const LISTING_URL =
  `https://padoka.landtag.sachsen-anhalt.de/portal/browse.tt.html` +
  `?type=generic4&action=link&db=lsa.lissh&docart=Plenarprotokoll` +
  `&from=01.01.${YEAR}&to=31.12.${YEAR}` +
  `&wp=8`;

interface RegistryEntry {
  name: string;
  name_padoka: string;
  fraktion: string | null;
  urls: { initiativen?: string; reden?: string };
}

interface RawSpeechRecord {
  recId: string;
  speakerHead: string; // "Cornelia Lüddemann (BÜNDNIS 90/DIE GRÜNEN)" oder leer
  topic: string;
  contextMeta: string;
  plprNr: string;
  plprDate: string;
  plprPdfUrl: string;
  plprPage: number | undefined;
}

const FRAKTION_SLUGS: Record<string, string> = {
  CDU: "cdu", AfD: "afd", "Die Linke": "die-linke", "DIE LINKE": "die-linke",
  SPD: "spd", FDP: "fdp", "BÜNDNIS 90/DIE GRÜNEN": "bundnis-90-die-gruenen",
  fraktionslos: "fraktionslos",
  Landesregierung: "landesregierung",
};

function ab(...args: string[]): string {
  return execFileSync("agent-browser", args, { encoding: "utf-8" });
}

function loadRegistry(): Record<string, RegistryEntry> {
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as Record<string, RegistryEntry>;
}

function waitForResults(): number {
  // PADOKA-Reden brauchen länger als Drucksachen — bis 20s
  for (let i = 0; i < 40; i++) {
    const out = ab("eval", "(() => document.querySelectorAll('[data-efx-rec]').length)()");
    const n = Number((out.match(/^\d+/m) ?? ["0"])[0]);
    if (n > 0) return n;
    ab("wait", "500");
  }
  return 0;
}

function readTotal(): number {
  const out = ab("eval", "(()=>{const m=document.body.textContent.match(/Treffer:\\s*\\d+\\s*bis\\s*\\d+\\s*von\\s*(\\d+)/);return m?Number(m[1]):0})()");
  return Number((out.match(/^\d+/m) ?? ["0"])[0]);
}

function readRange(): { from: number; to: number; total: number } {
  const out = ab("eval", "(()=>{const m=document.body.textContent.match(/Treffer:\\s*(\\d+)\\s*bis\\s*(\\d+)\\s*von\\s*(\\d+)/);return m?[Number(m[1]),Number(m[2]),Number(m[3])].join(','):'0,0,0'})()");
  const [from, to, total] = (out.match(/(\d+),(\d+),(\d+)/) ?? ["", "0", "0", "0"]).slice(1).map(Number);
  return { from: from!, to: to!, total: total! };
}

function clickNext(): boolean {
  const out = ab("eval", "(()=>{const n=Array.from(document.querySelectorAll('a.page-link')).find(x=>x.textContent.trim()==='Next');if(n&&!n.closest('.disabled')){n.click();return true}return false})()");
  return /true/.test(out);
}

function firstRecId(): string {
  const out = ab("eval", "(()=>document.querySelector('[data-efx-rec]')?.getAttribute('data-efx-rec')||'')()");
  return (out.match(/"([0-9a-f]+)"/) ?? ["", ""])[1] ?? "";
}

function extractRecordsOnPage(): RawSpeechRecord[] {
  const jsExpr = `(() => {
    return Array.from(document.querySelectorAll('[data-efx-rec]')).map(rec => {
      const recId = rec.getAttribute('data-efx-rec') || '';
      // Speaker header is in the outer card (h3.h5.font-weight-semibold), only on the first
      // card of a speaker block.
      const speakerHead = rec.querySelector('.media-body h3')?.textContent.trim() || '';
      const inner = rec.querySelector('.efxZoomGeneric4');
      if (!inner) return null;
      const topic = inner.querySelector('.font-weight-bold')?.textContent.trim() || '';
      const metas = Array.from(inner.querySelectorAll('.h6')).map(s => s.textContent.replace(/\\s+/g, ' ').trim());
      const contextMeta = metas[0] || '';
      const pdfLink = inner.querySelector('a[href*="/files/plenum/"]');
      const pdfHref = pdfLink ? pdfLink.getAttribute('href') : null;
      const pageLink = Array.from(inner.querySelectorAll('a[href*="#page="]')).pop();
      const pageHref = pageLink ? pageLink.getAttribute('href') : null;
      const text = inner.textContent.replace(/\\s+/g, ' ').trim();
      const dateMatch = text.match(/Plenarprotokoll[^]*?(\\d{2}\\.\\d{2}\\.\\d{4})/);
      const nrMatch = text.match(/Plenarprotokoll\\s*([\\d\\/]+)/);
      const pageMatch = pageHref ? pageHref.match(/#page=(\\d+)/) : null;
      return {
        recId,
        speakerHead,
        topic,
        contextMeta,
        plprNr: nrMatch ? nrMatch[1] : '',
        plprDate: dateMatch ? dateMatch[1] : '',
        plprPdfUrl: pdfHref || '',
        plprPage: pageMatch ? Number(pageMatch[1]) : undefined
      };
    }).filter(x => x && x.plprNr && x.plprDate);
  })()`;
  const raw = ab("eval", jsExpr);
  const m = raw.match(/^\[[\s\S]*\]/m);
  if (!m) return [];
  return JSON.parse(m[0]) as RawSpeechRecord[];
}

function clickAlleAufEinerSeite(): boolean {
  const out = ab("eval", "(()=>{const opt=Array.from(document.querySelectorAll('.multiselect-option')).find(x=>/Alle auf einer Seite/.test(x.textContent));if(opt){opt.click();return true}return false})()");
  return /true/.test(out);
}

function recordCount(): number {
  return Number((ab("eval", "(()=>document.querySelectorAll('[data-efx-rec]').length)()").match(/^\d+/m) ?? ["0"])[0]);
}

function fetchAllSpeeches(): RawSpeechRecord[] {
  ab("open", LISTING_URL);
  const n = waitForResults();
  if (n === 0) { console.error("[padoka-reden] keine Treffer im initial-load"); return []; }
  const total = readTotal();
  console.log(`[padoka-reden] Treffer insgesamt: ${total}`);
  if (!clickAlleAufEinerSeite()) {
    console.error("[padoka-reden] 'Alle auf einer Seite' nicht gefunden");
    return extractRecordsOnPage();
  }
  let last = 0;
  for (let i = 0; i < 180; i++) {
    ab("wait", "1000");
    const cur = recordCount();
    process.stdout.write(`  laden: ${cur}/${total}\r`);
    if (cur >= total) { last = cur; break; }
    if (cur === last && cur > 0 && i > 15) { last = cur; break; }
    last = cur;
  }
  console.log(`  laden: ${last}/${total}`);
  return extractRecordsOnPage();
}

function parseGermanDate(s: string): string {
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

// Words that indicate a parlamentary/government role rather than a party affiliation
// in the speaker-card header parenthesis.
const ROLE_TOKEN_RE = /\b(Minister|Ministerin|Ministerpräsident|Ministerpräsidentin|Staatsminister|Staatsministerin|Staatssekretär|Staatssekretärin|Präsident|Präsidentin|Vizepräsident|Vizepräsidentin|Alterspräsident|Alterspräsidentin|Schriftführer|Schriftführerin|Beauftragte|Beauftragter|Bürgerbeauftragte|Datenschutzbeauftragte|Rundfunkdatenschutzbeauftragte|Kulturminister|Kulturministerin|Justizminister|Justizministerin|Finanzminister|Finanzministerin|Wirtschaftsminister|Wirtschaftsministerin)\b/i;

function parseSpeaker(head: string): { name: string; fraktion: string | null; role: string | null } | null {
  // Typical: "Wolfgang Aldag (BÜNDNIS 90/DIE GRÜNEN)"
  // Role:    "Lydia Hüskens (Ministerin für Infrastruktur und Digitales)"
  // Role:    "Rainer Robra (Staats- und Kulturminister)"
  // Both:    rarely combined — usually just one parens
  const m = head.match(/^(.+?)\s+\(([^)]+)\)\s*$/);
  if (!m) return null;
  const name = m[1].trim();
  const inner = m[2].trim();
  const isRole = ROLE_TOKEN_RE.test(inner);
  if (isRole) return { name, fraktion: null, role: inner };
  return { name, fraktion: inner, role: null };
}

function buildRegistryNameIndex(reg: Record<string, RegistryEntry>): Map<string, { slug: string; entry: RegistryEntry }> {
  const idx = new Map<string, { slug: string; entry: RegistryEntry }>();
  for (const [slug, e] of Object.entries(reg)) {
    idx.set(e.name, { slug, entry: e });
    const stripped = e.name.replace(/^(Dr\.|Prof\.\s*Dr\.|Prof\.)\s+/, "").trim();
    if (stripped !== e.name) idx.set(stripped, { slug, entry: e });
    const noCity = e.name.replace(/\s*\([^)]+\)\s*$/, "").trim();
    if (noCity !== e.name) idx.set(noCity, { slug, entry: e });
  }
  return idx;
}

function slugifyFraktion(label: string): string {
  return FRAKTION_SLUGS[label] ?? label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function buildActivity(speakerName: string, speakerFraktion: string, slug: string, entry: RegistryEntry, sp: RawSpeechRecord): Activity | null {
  if (!speakerFraktion) return null;
  const date = parseGermanDate(sp.plprDate);
  if (!date) return null;
  const plprSlug = sp.plprNr.replace("/", "-");
  const pageSuffix = sp.plprPage !== undefined ? `-p${sp.plprPage}` : "";
  const id = `padoka-rede-${plprSlug}${pageSuffix}-${slug}`;
  const person: ActivityPerson = {
    slug,
    name: entry.name,
    name_padoka: entry.name_padoka,
    role: "redner",
    fraktion: speakerFraktion,
  };
  const a: Activity = {
    id,
    source: "padoka",
    parliament: PARLIAMENT_SLUG,
    wp: 8,
    type: "rede",
    title: sp.topic || "(ohne Titel)",
    date,
    persons: [person],
    fraktionen: [slugifyFraktion(speakerFraktion)],
    plenarprotokoll: { nr: sp.plprNr, date, ...(sp.plprPage !== undefined ? { page: sp.plprPage } : {}) },
    document: { url: sp.plprPage !== undefined ? `${sp.plprPdfUrl}#page=${sp.plprPage}` : sp.plprPdfUrl },
  };
  if (sp.contextMeta) a.summary = sp.contextMeta;
  return a;
}

function filenameFor(a: Activity): string {
  const speakerSlug = a.persons[0]?.slug ?? "unknown";
  const plprSlug = a.plenarprotokoll!.nr.replace("/", "-");
  const pageSuffix = a.plenarprotokoll!.page !== undefined ? `-p${a.plenarprotokoll!.page}` : "";
  return `${a.date}-rede-${plprSlug}${pageSuffix}-${speakerSlug}.json`;
}

function writeIfMissing(a: Activity): "written" | "skipped" {
  const dir = join(WIKI, "aktivitaet", a.date);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filenameFor(a));
  if (existsSync(path)) return "skipped";
  writeFileSync(path, JSON.stringify(a, null, 2) + "\n");
  return "written";
}

function main(): void {
  const registry = loadRegistry();
  const nameIdx = buildRegistryNameIndex(registry);
  const speeches = fetchAllSpeeches();
  let written = 0, skipped = 0, noSpeaker = 0, unknownSpeaker = 0;
  let currentSpeakerName = "";
  let currentSpeakerFraktion: string | null = null;
  let currentSpeakerRole: string | null = null;
  for (const sp of speeches) {
    if (sp.speakerHead) {
      const parsed = parseSpeaker(sp.speakerHead);
      if (parsed) {
        currentSpeakerName = parsed.name;
        currentSpeakerFraktion = parsed.fraktion;
        currentSpeakerRole = parsed.role;
      }
    }
    if (!currentSpeakerName) { noSpeaker++; continue; }
    const hit = nameIdx.get(currentSpeakerName) ??
      nameIdx.get(currentSpeakerName.replace(/^(Dr\.|Prof\.\s*Dr\.|Prof\.)\s+/, "").trim()) ??
      nameIdx.get(currentSpeakerName.replace(/\s*\([^)]+\)\s*$/, "").trim());
    if (!hit) { unknownSpeaker++; continue; }
    // If the header indicated a role (Ministerin, Präsident*, ...), use the MdL's
    // registered fraction instead. Fraktionslose MdL keep their registry value.
    const effectiveFraktion = currentSpeakerFraktion ?? hit.entry.fraktion ?? "fraktionslos";
    const a = buildActivity(currentSpeakerName, effectiveFraktion, hit.slug, hit.entry, sp);
    if (!a) continue;
    if (currentSpeakerRole) (a.persons[0] as ActivityPerson & { funktion?: string }).funktion = currentSpeakerRole;
    if (writeIfMissing(a) === "written") written++;
    else skipped++;
  }
  console.log(`[padoka-reden] ${speeches.length} Speeches (${YEAR}) · ${written} neu · ${skipped} schon vorhanden · ${noSpeaker} ohne Speaker-Kontext · ${unknownSpeaker} Speaker nicht in Registry`);
}

main();
