// PADOKA adapter — globaler Sweep der „Dokumente"-Suche, datums-gefiltert.
// Verwendet den YEAR=<jahr>-Filter von PADOKA, lädt alle Treffer durch
// wiederholtes Klicken von „Mehr Treffer anzeigen" und schreibt eine
// Activity je Mandatsträger-Aktivität (Anträge, Kleine/Große Anfragen
// inkl. Antworten, Gesetzentwürfe, Berichterstattungsverlangen).
//
// Aufruf:
//   pnpm run fetch:sachsen-anhalt                  → Default-Jahr = aktuelles
//   YEAR=2026 pnpm run fetch:sachsen-anhalt        → bestimmtes Jahr
//
// Idempotent + additiv: vorhandene JSONs werden bei Multi-Urheber-Items
// ergänzt, sonst nicht überschrieben.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Activity, ActivityPerson, ActivityType } from "../scripts/types.ts";

const PARLIAMENT_SLUG = "sachsen-anhalt";
const PARLIAMENT_DIR = resolve(import.meta.dirname, "../wiki", PARLIAMENT_SLUG);
const YEAR = Number(process.env.YEAR ?? new Date().getUTCFullYear());

const LISTING_URL =
  `https://padoka.landtag.sachsen-anhalt.de/portal/browse.tt.html` +
  `?type=generic2&action=link` +
  `&from=01.01.${YEAR}&to=31.12.${YEAR}` +
  `&wp=8`;

interface RawRecord {
  recId: string;
  title: string;
  meta: string;
  documentUrl: string | null;
}

const DOC_TYPE_KEEP = new Set([
  "Antrag",
  "Alternativantrag",
  "Änderungsantrag",
  "Entschließungsantrag",
  "Berichterstattungsverlangen",
  "Gesetzentwurf",
  "Kleine Anfrage ohne Antwort",
  "Kleine Anfrage und Antwort",
  "Antwort auf Kleine Anfrage",
  "Große Anfrage und Antwort",
  "Große Anfrage",
]);

const DOC_TYPE_SKIP_PREFIX = [
  "Unterrichtung",
  "Information",
  "Vorlage",
  "Selbstbefassung",
  "Beschlussempfehlung",
  "Ausschussprotokoll",
  "Einladung",
];

const FRAKTION_LABELS: Record<string, string> = {
  "CDU": "cdu",
  "AfD": "afd",
  "Die Linke": "die-linke",
  "DIE LINKE": "die-linke",
  "SPD": "spd",
  "FDP": "fdp",
  "BÜNDNIS 90/DIE GRÜNEN": "bundnis-90-die-gruenen",
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
  const jsExpr = `(() => {
    return Array.from(document.querySelectorAll('[data-efx-rec]')).map(rec => {
      const recId = rec.getAttribute('data-efx-rec') || '';
      const title = rec.querySelector('h3 span')?.textContent.trim() || '';
      const meta = rec.querySelector('.h6')?.textContent.replace(/\\s+/g, ' ').trim() || '';
      const docA = rec.querySelector('a[href*="/files/"]');
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
    console.error("[padoka] keine Treffer im initial-load");
    return [];
  }
  const { total } = readRangeFromTreffer();
  console.log(`[padoka] Treffer insgesamt: ${total}`);
  if (!clickAlleAufEinerSeite()) {
    console.error("[padoka] 'Alle auf einer Seite' Button nicht gefunden");
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
  if (docLabel.startsWith("Kleine Anfrage ohne Antwort")) return { type: "kleine_anfrage", status: "ohne_antwort", subtype: "Kleine Anfrage zur schriftlichen Beantwortung" };
  if (docLabel.startsWith("Kleine Anfrage und Antwort") || docLabel.startsWith("Antwort auf Kleine Anfrage")) return { type: "kleine_anfrage", status: "mit_antwort", subtype: "Antwort auf Kleine Anfrage" };
  if (docLabel.startsWith("Große Anfrage und Antwort")) return { type: "grosse_anfrage", status: "mit_antwort" };
  if (docLabel.startsWith("Große Anfrage")) return { type: "grosse_anfrage" };
  if (docLabel.startsWith("Gesetzentwurf")) return { type: "gesetzentwurf" };
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
  const dateMatch = meta.match(/(\d{2}\.\d{2}\.\d{4})/);
  if (!dateMatch) return null;
  const dateIso = parseGermanDate(dateMatch[1])!;
  const [prefixRaw, suffixRaw] = meta.split(dateMatch[1]).map((s) => s.trim());
  if (!prefixRaw || !suffixRaw) return null;

  if (DOC_TYPE_SKIP_PREFIX.some((p) => prefixRaw.startsWith(p))) return null;

  const suffixMatch = suffixRaw.match(
    /^(Drucksache|Kleine Anfrage|Große Anfrage|Ausschussdrucksache|Plenarprotokoll|Vorlage|Information)\s+(\d+\/[A-Za-z0-9\/]+)(?:\s*\((KA|GA)\s+(\d+\/\d+)\))?(?:\s*\((\d+)\s*S\.\))?/,
  );
  if (!suffixMatch) return null;
  const primaryDocLabel = suffixMatch[1]!;
  const drsNr = suffixMatch[2]!;
  const relatedKind = suffixMatch[3];
  const relatedNr = suffixMatch[4];
  const pages = suffixMatch[5] ? Number(suffixMatch[5]) : undefined;

  if (["Ausschussdrucksache", "Plenarprotokoll", "Vorlage", "Information"].includes(primaryDocLabel)) return null;

  const docTypeMatch = Array.from(DOC_TYPE_KEEP)
    .filter((t) => prefixRaw.startsWith(t))
    .sort((a, b) => b.length - a.length)[0];
  if (!docTypeMatch) return null;
  const urheber = prefixRaw.slice(docTypeMatch.length).trim();
  const classified = classify(docTypeMatch);
  if (!classified) return null;

  return {
    date: dateIso,
    type: classified.type,
    subtype: classified.subtype,
    status: classified.status,
    drsNr,
    pages,
    urheber,
    primaryDocLabel,
    relatedTo: relatedKind && relatedNr ? `padoka-${relatedKind.toLowerCase()}-${relatedNr.replace("/", "-")}` : undefined,
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
    id: `padoka-${idPrefix}-${drsSlug}`,
    source: "padoka",
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
        : `https://padoka.landtag.sachsen-anhalt.de${raw.documentUrl}`,
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
    `[padoka] ${records.length} Records (${YEAR}) · ${written} neu · ${skipped} schon vorhanden · ${nonMandate} keine Mandatsträger-Aktivität · ${unparsed.length} ungeparst`,
  );
  if (unparsed.length > 0 && unparsed.length <= 20) {
    console.log("Ungeparste Meta-Zeilen:");
    for (const u of unparsed) console.log("  " + u);
  }
}

main();
