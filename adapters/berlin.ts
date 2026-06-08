// STARWEB-Adapter Abgeordnetenhaus Berlin.
// Klon des Brandenburg-Adapters. Berlin nutzt pardok.parlament-berlin.de
// (STARWEB) mit STAR-Query-Syntax `((/WP <N>))` und Slash-prefixed Feldern.
//
// Aufruf:
//   pnpm run fetch:berlin
//   WP=19 pnpm run fetch:berlin
//
// Idempotent + additiv.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Activity, ActivityPerson, ActivityType } from "../scripts/types.ts";

const PARLIAMENT_SLUG = "berlin";
const PARLIAMENT_DIR = resolve(import.meta.dirname, "../wiki", PARLIAMENT_SLUG);
const WP = Number(process.env.WP ?? "19");

// STAR-Query Berlin: WP-Filter + TYP=DOKDBE (Dokumentenbestand).
const STAR_QUERY = `((/WP ${WP})) AND TYP=DOKDBE`;
const LISTING_URL =
  `https://pardok.parlament-berlin.de/portala/browse.tt.html` +
  `?type=generic1&action=link&searchgeneric1-wp=${WP}&searchgeneric1-parsed=${encodeURIComponent(STAR_QUERY)}`;

interface RawRecord {
  recId: string;
  title: string;
  meta: string;
  documentUrl: string | null;
}

const DOC_TYPE_KEEP = new Set([
  "Antrag",
  "Antrag (Gesetzentwurf)",
  "Antrag (Verfassungsänderung)",
  "Alternativantrag",
  "Änderungsantrag",
  "Entschließungsantrag",
  "Beschlussempfehlung",
  "Berichterstattungsverlangen",
  "Gesetzentwurf",
  "Kleine Anfrage",
  "Schriftliche Anfrage",
  "Mündliche Anfrage",
  "Große Anfrage",
]);

const DOC_TYPE_SKIP_PREFIX = [
  "Unterrichtung",
  "Information",
  "Vorlage",
  "Mitteilung",
  "Bericht",
  "Antwort",
  "Selbstbefassung",
  "Aktuelle Stunde",
  "Ausschussprotokoll",
  "Plenarprotokoll",
  "Einladung",
  "Sammlung",
];

// Berlin WP19 (seit 2023): CDU, SPD, AfD, Linke, BÜNDNIS 90/DIE GRÜNEN, FDP
// (FDP aus dem Plenum raus, aber Altbestand WP18 hat sie noch).
const FRAKTION_LABELS: Record<string, string> = {
  "SPD": "spd",
  "CDU": "cdu",
  "AfD": "afd",
  "Die Linke": "die-linke",
  "DIE LINKE": "die-linke",
  "BÜNDNIS 90/DIE GRÜNEN": "bundnis-90-die-gruenen",
  "GRÜNE": "bundnis-90-die-gruenen",
  "FDP": "fdp",
};

function ab(...args: string[]): string {
  return execFileSync("agent-browser", args, { encoding: "utf-8" });
}

function waitForResults(): number {
  for (let i = 0; i < 30; i++) {
    const out = ab("eval", "(() => document.querySelectorAll('[data-efx-rec]').length)()");
    const n = Number((out.match(/^\d+/m) ?? ["0"])[0]);
    if (n > 0) return n;
    ab("wait", "500");
  }
  return 0;
}

function readTotal(): number {
  const out = ab("eval", "(()=>{const m=document.body.textContent.match(/Treffer:\\s*\\d+\\s*bis\\s*\\d+\\s*von\\s*(\\d+)/);return m?Number(m[1]):0})()");
  const n = Number((out.match(/^\d+/m) ?? ["0"])[0]);
  return n;
}

function clickNextPage(): boolean {
  const out = ab(
    "eval",
    "(()=>{const n=Array.from(document.querySelectorAll('a.page-link')).find(x=>x.textContent.trim()==='Next');if(n&&!n.closest('.disabled')){n.click();return true}return false})()",
  );
  return /true/.test(out);
}

function readRangeFromTreffer(): { from: number; to: number; total: number } {
  const out = ab(
    "eval",
    "(()=>{const m=document.body.textContent.match(/Treffer:\\s*(\\d+)\\s*bis\\s*(\\d+)\\s*von\\s*(\\d+)/);return m?[Number(m[1]),Number(m[2]),Number(m[3])].join(','):'0,0,0'})()",
  );
  const [from, to, total] = (out.match(/(\d+),(\d+),(\d+)/) ?? ["", "0", "0", "0"]).slice(1).map(Number);
  return { from: from!, to: to!, total: total! };
}

function extractRecordsOnPage(): RawRecord[] {
  // Brandenburg "Vorgaenge" (generic1) zeigt die Kurzanzeige .efxUnzoomGeneric1
  // mit h3-Titel + .h6-Meta. Meta enthaelt oft mehrere Drs-Nr/Datum-Paare,
  // weil ein Vorgang KA+Antwort buendelt — parseMeta nimmt das erste Paar.
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

function clickAlleAufEinerSeite(): boolean {
  const out = ab("eval", "(()=>{const opt=Array.from(document.querySelectorAll('.multiselect-option')).find(x=>/Alle auf einer Seite/.test(x.textContent));if(opt){opt.click();return true}return false})()");
  return /true/.test(out);
}

function fetchAllRecords(): RawRecord[] {
  ab("open", LISTING_URL);
  const n = waitForResults();
  if (n === 0) {
    console.error("[starweb-be] keine Treffer im initial-load");
    return [];
  }
  const { total } = readRangeFromTreffer();
  console.log(`[starweb-be] Treffer insgesamt: ${total}`);
  if (!clickAlleAufEinerSeite()) {
    console.error("[starweb-be] 'Alle auf einer Seite' Button nicht gefunden");
    return extractRecordsOnPage();
  }
  // Wait for full population
  let last = 0;
  for (let i = 0; i < 90; i++) {
    ab("wait", "1000");
    const cur = Number((ab("eval", "(()=>document.querySelectorAll('[data-efx-rec]').length)()").match(/^\d+/m) ?? ["0"])[0]);
    process.stdout.write(`  laden: ${cur}/${total}\r`);
    if (cur >= total) { last = cur; break; }
    if (cur === last && cur > 0 && i > 10) { last = cur; break; }
    last = cur;
  }
  console.log(`  laden: ${last}/${total}`);
  return extractRecordsOnPage();
}

interface ParsedMeta {
  date: string;
  type: ActivityType;
  subtype?: string;
  status?: string;
  drsNr: string;
  pages?: number;
  urheber: string;
  primaryDocLabel: string;
  relatedTo?: string;
}

function parseGermanDate(s: string): string | null {
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function classify(docLabel: string): { type: ActivityType; subtype?: string; status?: string } | null {
  if (docLabel.startsWith("Kleine Anfrage")) return { type: "kleine_anfrage" };
  if (docLabel.startsWith("Schriftliche Anfrage")) return { type: "kleine_anfrage", subtype: "Schriftliche Anfrage" };
  if (docLabel.startsWith("Mündliche Anfrage")) return { type: "kleine_anfrage", subtype: "Mündliche Anfrage" };
  if (docLabel.startsWith("Große Anfrage")) return { type: "grosse_anfrage" };
  if (docLabel.startsWith("Antrag (Gesetzentwurf)")) return { type: "gesetzentwurf", subtype: "Antrag (Gesetzentwurf)" };
  if (docLabel.startsWith("Antrag (Verfassungsänderung)")) return { type: "gesetzentwurf", subtype: "Verfassungsänderung" };
  if (docLabel.startsWith("Gesetzentwurf")) return { type: "gesetzentwurf" };
  if (docLabel.startsWith("Beschlussempfehlung")) return { type: "beschlussempfehlung" };
  if (docLabel.startsWith("Berichterstattungsverlangen")) return { type: "antrag", subtype: "Berichterstattungsverlangen" };
  if (
    docLabel === "Antrag" ||
    docLabel.startsWith("Alternativantrag") ||
    docLabel.startsWith("Änderungsantrag") ||
    docLabel.startsWith("Entschließungsantrag")
  ) {
    return { type: "antrag", subtype: docLabel === "Antrag" ? undefined : docLabel };
  }
  return null;
}

function parseMeta(meta: string): ParsedMeta | null {
  // Berlin-Format Beispiele:
  //   "Antrag SPD, Grüne, Die Linke Drucksache 19/0296 vom 07.04.2022"
  //   "Antrag (Gesetzentwurf) SPD, Grüne, CDU, Die Linke Drucksache 19/0293 vom 07.04.2022"
  //   "Kleine Anfrage Klaus Lederer (Die Linke) Drucksache 19/13412 vom 05.06.2026"
  //   "Vorlage zur Kenntnisnahme Drucksache 19/0301 vom 12.04.2022"   ← skip
  //
  // Datum steht am Ende, Drucksache davor.
  const allDates = Array.from(meta.matchAll(/(\d{2}\.\d{2}\.\d{4})/g));
  if (allDates.length === 0) return null;
  const lastDateMatch = allDates[allDates.length - 1]!;
  const dateIso = parseGermanDate(lastDateMatch[1]!);
  if (!dateIso) return null;

  // Drucksache-Nummer
  const drsM = meta.match(/Drucksache\s+(\d+\/[A-Za-z0-9]+)/);
  if (!drsM) return null;
  const drsNr = drsM[1]!;

  // DocType ist alles vor der Urheberangabe — wir greifen den ersten
  // bekannten Typ aus DOC_TYPE_KEEP, der am Anfang steht.
  if (DOC_TYPE_SKIP_PREFIX.some((p) => meta.startsWith(p))) return null;
  const docTypeMatch = Array.from(DOC_TYPE_KEEP)
    .filter((t) => meta.startsWith(t))
    .sort((a, b) => b.length - a.length)[0];
  if (!docTypeMatch) return null;
  const classified = classify(docTypeMatch);
  if (!classified) return null;

  // Urheber = Text zwischen docType und "Drucksache"
  const drsStart = meta.indexOf("Drucksache");
  const urheber = meta.slice(docTypeMatch.length, drsStart).trim().replace(/^\([^)]+\)\s*/, "");

  return {
    date: dateIso,
    type: classified.type,
    subtype: classified.subtype,
    status: classified.status,
    drsNr,
    urheber,
    primaryDocLabel: docTypeMatch,
  };
}

function slugifyPerson(nachname: string, vorname: string): string {
  return (`${vorname} ${nachname}`)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugifyFraktion(label: string): string | null {
  return FRAKTION_LABELS[label] ?? null;
}

function parsePersons(urheber: string): { persons: ActivityPerson[]; fraktionen: string[]; rawUrheber: string } {
  const personRegex = /([\wÄÖÜäöüß\-\.]+(?:\s+[\wÄÖÜäöüß\-\.]+)*?)\s+\(([^)]+)\)/g;
  const persons: ActivityPerson[] = [];
  const fraktionenSet = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = personRegex.exec(urheber)) !== null) {
    const fullName = m[1].trim();
    const fraktionLabel = m[2].trim();
    const fraktionSlug = slugifyFraktion(fraktionLabel);
    if (!fraktionSlug) continue;
    const parts = fullName.split(/\s+/);
    if (parts.length < 2) continue;
    const nachname = parts.slice(-1)[0]!;
    const adligPrefix = parts.length >= 3 && /^(von|zu|de|van)$/i.test(parts[parts.length - 2]!)
      ? parts[parts.length - 2] + " "
      : "";
    const trueNachname = adligPrefix + nachname;
    const vorname = parts.slice(0, parts.length - (adligPrefix ? 2 : 1)).join(" ");
    persons.push({
      slug: slugifyPerson(trueNachname, vorname),
      name: `${vorname} ${trueNachname}`,
      name_padoka: `${trueNachname}, ${vorname}`,
      role: "fragesteller",
      fraktion: fraktionLabel,
    });
    fraktionenSet.add(fraktionSlug);
  }
  if (persons.length === 0) {
    for (const [label, slug] of Object.entries(FRAKTION_LABELS)) {
      if (new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(urheber)) {
        fraktionenSet.add(slug);
      }
    }
  }
  return { persons, fraktionen: Array.from(fraktionenSet), rawUrheber: urheber };
}

function buildActivity(raw: RawRecord, parsed: ParsedMeta): Activity | null {
  const { persons, fraktionen, rawUrheber } = parsePersons(parsed.urheber);
  if (persons.length === 0 && fraktionen.length === 0) return null;

  const role: ActivityPerson["role"] =
    parsed.type === "kleine_anfrage" || parsed.type === "grosse_anfrage" ? "fragesteller" : "antragsteller";
  persons.forEach((p) => { p.role = role; });

  const idPrefix = parsed.type === "kleine_anfrage" || parsed.type === "grosse_anfrage" ? "ka" :
    parsed.type === "gesetzentwurf" ? "ges" : "drs";
  const drsSlug = parsed.drsNr.replace(/\//g, "-");

  const activity: Activity = {
    id: `starweb-be-${idPrefix}-${drsSlug}`,
    source: "starweb",
    parliament: PARLIAMENT_SLUG,
    wp: Number(parsed.drsNr.split("/")[0]),
    type: parsed.type,
    title: raw.title,
    date: parsed.date,
    drsNr: parsed.drsNr,
    persons,
    fraktionen,
  };
  if (parsed.subtype) activity.subtype = parsed.subtype;
  if (parsed.status) activity.status = parsed.status;
  if (parsed.relatedTo) activity.relatedTo = parsed.relatedTo;
  if (raw.documentUrl) {
    activity.document = {
      url: raw.documentUrl.startsWith("http")
        ? raw.documentUrl
        : `https://pardok.parlament-berlin.de${raw.documentUrl}`,
      filename: raw.documentUrl.split("/").pop() ?? undefined,
      ...(parsed.pages ? { pages: parsed.pages } : {}),
    };
  }
  if (persons.length === 0 && rawUrheber) activity.urheber = rawUrheber;
  return activity;
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

function main(): void {
  const records = fetchAllRecords();
  let written = 0;
  let skipped = 0;
  let nonMandate = 0;
  const unparsed: string[] = [];
  for (const raw of records) {
    const parsed = parseMeta(raw.meta);
    if (!parsed) {
      if (DOC_TYPE_SKIP_PREFIX.some((p) => raw.meta.startsWith(p))) nonMandate++;
      else unparsed.push(raw.meta);
      continue;
    }
    const activity = buildActivity(raw, parsed);
    if (!activity) { nonMandate++; continue; }
    if (writeIfMissing(activity) === "written") written++;
    else skipped++;
  }
  console.log(
    `[starweb-be] ${records.length} Records (${WP}) · ${written} neu · ${skipped} schon vorhanden · ${nonMandate} keine Mandatsträger-Aktivität · ${unparsed.length} ungeparst`,
  );
  if (unparsed.length > 0 && unparsed.length <= 20) {
    console.log("Ungeparste Meta-Zeilen:");
    for (const u of unparsed) console.log("  " + u);
  }
}

main();
