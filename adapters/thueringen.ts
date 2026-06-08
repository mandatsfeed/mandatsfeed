// Parldok-Thüringen-Adapter — Drucksachen (Anträge, Kleine/Große Anfragen,
// Gesetzentwürfe, Beschlussempfehlungen) im Thüringer Landtag.
//
// Selbe Parldok-Engine wie Mecklenburg-Vorpommern (J3S ParlDok 8.3.6) —
// Pagination per `pd.resultpage(N)`, Pagesize konfigurierbar, Hardlimit
// 1000 Items pro Suche. Unterschied zu MV: andere Host-URL und andere
// WP-Filter-Bezeichnung (8. Wahlperiode ab 26.09.2024).
//
// Aufruf:
//   pnpm run fetch:thueringen
//   WP=8 pnpm run fetch:thueringen
//
// Idempotent + additiv.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Activity, ActivityPerson, ActivityType } from "../scripts/types.ts";

const PARLIAMENT_SLUG = "thueringen";
const PARLIAMENT_DIR = resolve(import.meta.dirname, "../wiki", PARLIAMENT_SLUG);
const WP = Number(process.env.WP ?? "8");
const MIN_DATE = process.env.MIN_DATE ?? "2026-01-01";

const LISTING_URL_BASE = "https://parldok.thueringer-landtag.de/parldok/neu/10_1_8___8.%20Wahlperiode%20(ab%2026.09.2024)/7_1_1___Dokumentart%3A%20Drucksache";

const FRAKTION_LABELS: Record<string, string> = {
  "CDU": "cdu",
  "AfD": "afd",
  "BSW": "bsw",
  "Die Linke": "die-linke",
  "DIE LINKE": "die-linke",
  "SPD": "spd",
};

interface RawRecord {
  docid: string;
  title: string;
  meta: string; // "8/6651 Kleine Anfrage vom 05.06.2026Michael Noetzel (Die Linke)"
}

function ab(...args: string[]): string {
  return execFileSync("agent-browser", args, { encoding: "utf-8" });
}

function readStateNumber(field: string): number {
  const out = ab("eval", `(()=>String(window.pd?.${field}??0))()`);
  return Number((out.match(/"(\d+)"/) ?? out.match(/(\d+)/) ?? ["", "0"])[1]);
}

function waitForResults(): number {
  // Wait for both: docrow items + window.pd state ready
  for (let i = 0; i < 60; i++) {
    const out = ab("eval", "(()=>{const n=document.querySelectorAll('li.docrow').length;const mh=window.pd?.maxhits||0;return n+','+mh})()");
    const m = out.match(/(\d+),(\d+)/);
    if (m && Number(m[1]) > 0 && Number(m[2]) > 0) return Number(m[1]);
    ab("wait", "500");
  }
  return 0;
}

function setPageSize100(): void {
  ab(
    "eval",
    "(()=>{const s=Array.from(document.querySelectorAll('select')).find(x=>x.options[0]?.value==='10');if(s){s.value='100';s.dispatchEvent(new Event('change',{bubbles:true}))}})()",
  );
  ab("wait", "3000");
}

function gotoPage(page: number): void {
  ab("eval", `(()=>{pd.resultpage(${page})})()`);
  ab("wait", "2500");
}

function firstDocId(): string {
  const out = ab("eval", "(()=>document.querySelector('li.docrow')?.getAttribute('data-docid')||'')()");
  return (out.match(/"(\d+)"/) ?? out.match(/(\d+)/) ?? ["", ""])[1] ?? "";
}

function extractRecordsOnPage(): RawRecord[] {
  const jsExpr = `(() => {
    return Array.from(document.querySelectorAll('li.docrow')).map(li => {
      // The <p> tag contains "Drs-Nr Typ vom Datum<br>Urheber (Fraktion)".
      // Replace <br> with a marker so the text extractor preserves the line break.
      const p = li.querySelector('p');
      let metaHtml = p ? p.innerHTML : '';
      metaHtml = metaHtml.replace(/<br\\s*\\/?\\s*>/gi, ' | ');
      const tmp = document.createElement('div');
      tmp.innerHTML = metaHtml;
      const meta = tmp.textContent.replace(/\\s+/g, ' ').trim();
      return {
        docid: li.getAttribute('data-docid') || '',
        title: li.querySelector('h2')?.textContent.trim() || '',
        meta
      };
    }).filter(r => r.docid && r.title);
  })()`;
  const raw = ab("eval", jsExpr);
  const m = raw.match(/^\[[\s\S]*\]/m);
  if (!m) return [];
  return JSON.parse(m[0]) as RawRecord[];
}

function fetchAllRecords(): RawRecord[] {
  ab("open", LISTING_URL_BASE);
  if (waitForResults() === 0) {
    console.error("[parldok-th] keine Treffer im initial-load");
    return [];
  }
  setPageSize100();
  const maxhits = readStateNumber("maxhits");
  const maxpages = readStateNumber("maxpages");
  console.log(`[parldok-th] maxhits=${maxhits}, maxpages=${maxpages}`);

  const collected = new Map<string, RawRecord>();
  for (let page = 1; page <= maxpages; page++) {
    if (page > 1) {
      const prevFirst = firstDocId();
      gotoPage(page);
      let updated = false;
      for (let i = 0; i < 30; i++) {
        ab("wait", "400");
        const cur = firstDocId();
        if (cur && cur !== prevFirst) { updated = true; break; }
      }
      if (!updated) {
        console.log(`  Seite ${page} · kein Reload erkannt, breche ab`);
        break;
      }
    }
    const before = collected.size;
    for (const r of extractRecordsOnPage()) collected.set(r.docid, r);
    const delta = collected.size - before;
    process.stdout.write(`  Seite ${page} · gesammelt: ${collected.size}/${maxhits} (+${delta})\n`);
    if (delta === 0) break;
  }
  return Array.from(collected.values());
}

interface ParsedMeta {
  drsNr: string;
  type: ActivityType;
  subtype?: string;
  status?: string;
  date: string;
  urheber: string;
}

const DOC_TYPE_KEEP = [
  "Antrag",
  "Alternativantrag",
  "Änderungsantrag",
  "Entschließungsantrag",
  "Kleine Anfrage",
  "Antwort auf Kleine Anfrage",
  "Antwort der Landesregierung auf eine Kleine Anfrage",
  "Antwort der Landesregierung auf eine Große Anfrage",
  "Große Anfrage",
  "Gesetzentwurf",
];

const DOC_TYPE_SKIP_PREFIX = [
  "Unterrichtung",
  "Beschlussempfehlung",
  "Beschluss",
  "Stellungnahme",
  "Bericht",
  "Mitteilung",
  "Information",
  "Vorlage",
];

function parseGermanDate(s: string): string | null {
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function classify(typLabel: string): { type: ActivityType; subtype?: string; status?: string } | null {
  if (/^Antwort.*Kleine Anfrage/.test(typLabel) || /Kleine Anfrage und Antwort/.test(typLabel)) {
    return { type: "kleine_anfrage", status: "mit_antwort", subtype: "Antwort auf Kleine Anfrage" };
  }
  if (/^Kleine Anfrage/.test(typLabel)) return { type: "kleine_anfrage", status: "ohne_antwort", subtype: "Kleine Anfrage" };
  if (/^Antwort.*Große Anfrage/.test(typLabel)) return { type: "grosse_anfrage", status: "mit_antwort" };
  if (/^Große Anfrage/.test(typLabel)) return { type: "grosse_anfrage" };
  if (/^Gesetzentwurf/.test(typLabel)) return { type: "gesetzentwurf" };
  if (/^Antrag/.test(typLabel)) return { type: "antrag" };
  if (/^Alternativantrag/.test(typLabel)) return { type: "antrag", subtype: "Alternativantrag" };
  if (/^Änderungsantrag/.test(typLabel)) return { type: "antrag", subtype: "Änderungsantrag" };
  if (/^Entschließungsantrag/.test(typLabel)) return { type: "antrag", subtype: "Entschließungsantrag" };
  return null;
}

function parseMeta(meta: string): ParsedMeta | null {
  // Pattern: "8/6651 Kleine Anfrage vom 05.06.2026 | Michael Noetzel (Die Linke)"
  // Or:      "8/6605 Beschlussempfehlung und Bericht vom 26.05.2026"  (no Urheber line)
  const re = /^(\d+\/[\dA-Za-z]+)\s+(.+?)\s+vom\s+(\d{2}\.\d{2}\.\d{4})(?:\s*\|\s*(.+))?$/;
  const m = meta.match(re);
  if (!m) return null;
  const drsNr = m[1]!;
  const typLabel = m[2]!.trim();
  const dateGer = m[3]!;
  const urheber = (m[4] || "").trim();

  if (DOC_TYPE_SKIP_PREFIX.some((p) => typLabel.startsWith(p))) return null;

  const classified = classify(typLabel);
  if (!classified) return null;

  return {
    drsNr,
    type: classified.type,
    subtype: classified.subtype,
    status: classified.status,
    date: parseGermanDate(dateGer) ?? "",
    urheber,
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
  // Patterns:
  //   "Michael Noetzel (Die Linke)" — one person
  //   "Person A (FDP), Person B (FDP)" — multi
  //   "Fraktion der SPD" — fraction-only
  //   "" — empty (Regierungsvorlage etc.)
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
  return { persons, fraktionen: Array.from(fraktionenSet), raw: urheber };
}

function buildActivity(raw: RawRecord, parsed: ParsedMeta): Activity | null {
  const { persons, fraktionen, raw: rawUrheber } = parsePersons(parsed.urheber);
  if (persons.length === 0 && fraktionen.length === 0) return null;

  const role: ActivityPerson["role"] =
    parsed.type === "kleine_anfrage" || parsed.type === "grosse_anfrage" ? "fragesteller" : "antragsteller";
  persons.forEach((p) => { p.role = role; });

  const idPrefix = parsed.type === "kleine_anfrage" || parsed.type === "grosse_anfrage" ? "ka"
    : parsed.type === "gesetzentwurf" ? "ges" : "drs";
  const drsSlug = parsed.drsNr.replace(/\//g, "-");
  const wp = Number(parsed.drsNr.split("/")[0]);

  const a: Activity = {
    id: `parldok-${idPrefix}-${drsSlug}`,
    source: "parldok",
    parliament: PARLIAMENT_SLUG,
    wp,
    type: parsed.type,
    title: raw.title,
    date: parsed.date,
    drsNr: parsed.drsNr,
    persons,
    fraktionen,
    document: {
      url: `https://parldok.thueringer-landtag.de/parldok/dokument/${raw.docid}`,
    },
  };
  if (parsed.subtype) a.subtype = parsed.subtype;
  if (parsed.status) a.status = parsed.status;
  if (persons.length === 0 && rawUrheber) a.urheber = rawUrheber;
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

function main(): void {
  const records = fetchAllRecords();
  let written = 0, skipped = 0, nonMandate = 0, unparsed = 0, filteredByDate = 0;
  for (const raw of records) {
    const parsed = parseMeta(raw.meta);
    if (!parsed) {
      if (DOC_TYPE_SKIP_PREFIX.some((p) => raw.meta.includes(p))) nonMandate++;
      else unparsed++;
      continue;
    }
    if (parsed.date < MIN_DATE) { filteredByDate++; continue; }
    const a = buildActivity(raw, parsed);
    if (!a) { nonMandate++; continue; }
    if (writeIfMissing(a) === "written") written++;
    else skipped++;
  }
  console.log(`[parldok-th] ${records.length} Records · ${written} neu · ${skipped} schon vorhanden · ${nonMandate} keine Mandatsträger-Aktivität · ${unparsed} ungeparst · ${filteredByDate} vor ${MIN_DATE}`);
}

main();
