// PADOKA adapter (Landtag Sachsen-Anhalt).
// Fetches the "AKTUELLE Dokumente" listing via agent-browser (JS-SPA),
// parses each record's meta line into a canonical Activity, writes JSON
// files into wiki/sachsen-anhalt/aktivitaet/YYYY-MM-DD/.
// Idempotent + additive: existing JSON files are never modified or deleted.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Activity, ActivityPerson, ActivityType } from "../scripts/types.ts";

const PARLIAMENT_SLUG = "sachsen-anhalt";
const WIKI = resolve(import.meta.dirname, "../wiki", PARLIAMENT_SLUG);

// "AKTUELLE Dokumente (Eingang innerhalb des letzten Monats)" deeplink, WP=8.
const LISTING_URL =
  "https://padoka.landtag.sachsen-anhalt.de/portal/browse.tt.html?type=generic2&action=link&lawSheetYear=&lawSheetIssueNr=&title=&slab-period.1=WEEK&sprompt-period.1=MONTH%3D%2F%2F&sop.1=AND&slab.2=alWEBBI&sprompt.2=&sop.2=AND&slab.3=alWEBBI&sprompt.3=&sop.3=AND&wp=8&generic2-fulltext=";

interface RawRecord {
  recId: string;
  title: string;
  meta: string;
  documentUrl: string | null;
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

// Explicit non-mandate doc types — silent skip, don't count as "ungeparst".
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

function fetchRecords(): RawRecord[] {
  ab("open", LISTING_URL);
  // Page loads async; poll for results-container to populate.
  for (let i = 0; i < 20; i++) {
    const out = ab("eval", "(() => document.getElementById('results-container')?.children.length || 0)()");
    const n = Number((out.match(/^\d+/m) ?? ["0"])[0]);
    if (n > 0) break;
    ab("wait", "500");
  }
  const jsExpr = `(() => {
    const c = document.getElementById('results-container');
    if (!c) return [];
    return Array.from(c.children).map(rec => {
      const recId = rec.getAttribute('data-efx-rec') || '';
      const title = rec.querySelector('h3 span')?.textContent.trim() || '';
      const meta = rec.querySelector('.h6')?.textContent.replace(/\\s+/g, ' ').trim() || '';
      const docA = rec.querySelector('a[href*="/files/"]');
      const documentUrl = docA ? docA.getAttribute('href') : null;
      return { recId, title, meta, documentUrl };
    }).filter(r => r.recId && r.title);
  })()`;
  const raw = ab("eval", jsExpr);
  // agent-browser prints JSON-as-string followed by status lines we ignore.
  const m = raw.match(/^\[[\s\S]*\]/m);
  if (!m) throw new Error("PADOKA listing: no JSON in agent-browser output");
  return JSON.parse(m[0]) as RawRecord[];
}

function parseGermanDate(s: string): string | null {
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function classify(docLabel: string): { type: ActivityType; subtype?: string; status?: string } | null {
  if (docLabel.startsWith("Kleine Anfrage ohne Antwort")) {
    return { type: "kleine_anfrage", status: "ohne_antwort", subtype: "Kleine Anfrage zur schriftlichen Beantwortung" };
  }
  if (docLabel.startsWith("Kleine Anfrage und Antwort") || docLabel.startsWith("Antwort auf Kleine Anfrage")) {
    return { type: "kleine_anfrage", status: "mit_antwort", subtype: "Antwort auf Kleine Anfrage" };
  }
  if (docLabel.startsWith("Große Anfrage und Antwort")) return { type: "grosse_anfrage", status: "mit_antwort" };
  if (docLabel.startsWith("Große Anfrage")) return { type: "grosse_anfrage" };
  if (docLabel.startsWith("Gesetzentwurf")) return { type: "gesetzentwurf" };
  if (docLabel.startsWith("Berichterstattungsverlangen")) {
    return { type: "antrag", subtype: "Berichterstattungsverlangen" };
  }
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
  // Anchor on the date.
  const dateMatch = meta.match(/(\d{2}\.\d{2}\.\d{4})/);
  if (!dateMatch) return null;
  const dateIso = parseGermanDate(dateMatch[1])!;
  const [prefixRaw, suffixRaw] = meta.split(dateMatch[1]).map((s) => s.trim());
  if (!prefixRaw || !suffixRaw) return null;

  // Skip non-mandate document types early (prefix-based)
  if (DOC_TYPE_SKIP_PREFIX.some((p) => prefixRaw.startsWith(p))) return null;

  // Suffix: "<PrimaryType> <WP>/<NR> [(KA <WP>/<NR>)] [(N S.)]"
  // Allow an optional "(KA X/Y)" between drsNr and the page count (answer-to-KA case).
  const suffixMatch = suffixRaw.match(
    /^(Drucksache|Kleine Anfrage|Große Anfrage|Ausschussdrucksache|Plenarprotokoll|Vorlage|Information)\s+(\d+\/[A-Za-z0-9\/]+)(?:\s*\((KA|GA)\s+(\d+\/\d+)\))?(?:\s*\((\d+)\s*S\.\))?/,
  );
  if (!suffixMatch) return null;
  const primaryDocLabel = suffixMatch[1]!;
  const drsNr = suffixMatch[2]!;
  const relatedKind = suffixMatch[3];
  const relatedNr = suffixMatch[4];
  const pages = suffixMatch[5] ? Number(suffixMatch[5]) : undefined;

  // Skip non-mandate primary types
  if (
    primaryDocLabel === "Ausschussdrucksache" ||
    primaryDocLabel === "Plenarprotokoll" ||
    primaryDocLabel === "Vorlage" ||
    primaryDocLabel === "Information"
  ) {
    return null;
  }

  // Prefix: "<DocType> <Urheber>"
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
  const base = `${vorname} ${nachname}`.toLowerCase();
  return base
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
  // Patterns we recognise:
  //   "Wolfgang Aldag (BÜNDNIS 90/DIE GRÜNEN)"  → one person
  //   "Tobias Rausch (AfD), Ulrich Siegmund (AfD)" → two persons
  //   "Fraktion Die Linke" / "Die Linke" → fraction only, no person
  const personRegex = /([\wÄÖÜäöüß\-\.]+(?:\s+[\wÄÖÜäöüß\-\.]+)*?)\s+\(([^)]+)\)/g;
  const persons: ActivityPerson[] = [];
  const fraktionenSet = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = personRegex.exec(urheber)) !== null) {
    const fullName = m[1].trim();
    const fraktionLabel = m[2].trim();
    const fraktionSlug = slugifyFraktion(fraktionLabel);
    if (!fraktionSlug) continue; // not a recognised fraction → likely Ministerium etc.
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
    // Fraction-only authorship — e.g. "Fraktion Die Linke" or just "Die Linke"
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
  if (persons.length === 0 && fraktionen.length === 0) return null; // not a mandate activity

  // Adjust role per type
  const role: ActivityPerson["role"] =
    parsed.type === "kleine_anfrage" || parsed.type === "grosse_anfrage" ? "fragesteller" : "antragsteller";
  persons.forEach((p) => {
    p.role = role;
  });

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
  const dir = join(WIKI, "aktivitaet", a.date);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filenameFor(a));
  if (existsSync(path)) return "skipped";
  writeFileSync(path, JSON.stringify(a, null, 2) + "\n");
  return "written";
}

function main(): void {
  const records = fetchRecords();
  let written = 0;
  let skipped = 0;
  let nonMandate = 0;
  const unparsed: string[] = [];
  for (const raw of records) {
    const parsed = parseMeta(raw.meta);
    if (!parsed) {
      // parseMeta returned null. Distinguish:
      //  - explicit skip-prefix (Unterrichtung/Information/Vorlage/Beschlussempfehlung/Selbstbefassung/Ausschussprotokoll/Einladung) → silent skip
      //  - everything else → log as unparsed for inspection
      if (DOC_TYPE_SKIP_PREFIX.some((p) => raw.meta.startsWith(p))) {
        nonMandate++;
      } else {
        unparsed.push(raw.meta);
      }
      continue;
    }
    const activity = buildActivity(raw, parsed);
    if (!activity) {
      nonMandate++;
      continue;
    }
    if (writeIfMissing(activity) === "written") written++;
    else skipped++;
  }
  console.log(
    `[padoka] ${records.length} Records · ${written} neu · ${skipped} schon vorhanden · ${nonMandate} keine Mandatsträger-Aktivität · ${unparsed.length} ungeparst`,
  );
  if (unparsed.length > 0) {
    console.log("Ungeparste Meta-Zeilen:");
    for (const u of unparsed) console.log("  " + u);
  }
}

main();
