// STARWEB-Adapter Hessischer Landtag.
// Klon des Brandenburg-Adapters. Hessen nutzt die starweb.hessen.de-Instanz
// mit STAR-Query-Syntax (z. B. `(WP=21 AND DREIN1=// OR …) NOT NOWEB=X`).
//
// Aufruf:
//   pnpm run fetch:hessen
//   WP=21 pnpm run fetch:hessen
//
// Idempotent + additiv.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Activity, ActivityPerson, ActivityType } from "../scripts/types.ts";

const PARLIAMENT_SLUG = "hessen";
const PARLIAMENT_DIR = resolve(import.meta.dirname, "../wiki", PARLIAMENT_SLUG);
const WP = Number(process.env.WP ?? "21");

// STAR-Query: Drucksachen aller Mandatsträger-Arten. Filter aus der
// Hessen-Suchoberflaeche uebernommen.
const STAR_QUERY = `(WP=${WP} AND DREIN1=// OR (FIRST1=// AND DART=DRS) OR (LAST1=// AND ANTWEIN NOT "")) NOT NOWEB=X`;
const LISTING_URL =
  `https://starweb.hessen.de/portal/browse.tt.html` +
  `?type=generic1&action=link&searchgeneric1-parsed=${encodeURIComponent(STAR_QUERY)}`;

interface RawRecord {
  recId: string;
  title: string;
  meta: string;
  documentUrl: string | null;
  docType?: string;
  drsNr?: string;
  date?: string;
  urheber?: string;
}

const DOC_TYPE_KEEP = new Set([
  "Antrag",
  "Alternativantrag",
  "Änderungsantrag",
  "Entschließungsantrag",
  "Dringlicher Antrag",
  "Dringlicher Entschließungsantrag",
  "Dringlicher Alternativantrag",
  "Dringlicher Änderungsantrag",
  "Berichtsantrag",
  "Berichterstattungsverlangen",
  "Gesetzentwurf",
  "Kleine Anfrage",
  "Kleine Anfrage ohne Antwort",
  "Kleine Anfrage und Antwort",
  "Antwort auf Kleine Anfrage",
  "Große Anfrage",
  "Große Anfrage und Antwort",
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

// Hessen WP21 (seit 2024): CDU, SPD, AfD, BÜNDNIS 90/DIE GRÜNEN, FDP.
// FDP ist nach Wahl 2023 raus, taucht in Altbestand WP20 aber noch auf.
const FRAKTION_LABELS: Record<string, string> = {
  "CDU": "cdu",
  "SPD": "spd",
  "AfD": "afd",
  "BÜNDNIS 90/DIE GRÜNEN": "bundnis-90-die-gruenen",
  "GRÜNE": "bundnis-90-die-gruenen",
  "FDP": "fdp",
  "Die Linke": "die-linke",
  "DIE LINKE": "die-linke",
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
  // Hessen-Struktur in der STARWEB-Kurzansicht:
  //   • Doc-Type in <span.font-weight-semibold>: "Kleine Anfrage" / "Antrag" / …
  //   • Titel in <h3.h5>
  //   • Drucksache-Button <a href=".../DRS/<wp>/.../<n>.pdf"> mit
  //     <span.font-weight-bold> "21/4608" und " vom <Datum>" daneben
  //   • Urheber-Zeile mit <span.h6>"Initiator:" + <.col-sm-10> Klartext
  //     "Kinkel, Kaya, BÜNDNIS 90/DIE GRÜNEN; Walther, Katy, ..."
  const jsExpr = `(() => {
    return Array.from(document.querySelectorAll('[data-efx-rec]')).map(rec => {
      const recId = rec.getAttribute('data-efx-rec') || '';
      const docType = rec.querySelector('.font-weight-semibold')?.textContent.trim() || '';
      const title = rec.querySelector('h3')?.textContent.trim() || '';
      const drsA = rec.querySelector('a[href*=".pdf"]');
      const documentUrl = drsA ? drsA.getAttribute('href') : null;
      const drsNr = drsA?.querySelector('.font-weight-bold')?.textContent.trim() || '';
      // "vom <Datum>" — wir suchen im selben Wrapper
      const datumMatch = drsA?.parentElement?.textContent.match(/vom\\s+(\\d{2}\\.\\d{2}\\.\\d{4})/);
      const date = datumMatch ? datumMatch[1] : '';
      // Urheber — die Zeile mit Initiator:
      let urheber = '';
      const labels = Array.from(rec.querySelectorAll('.col-sm-2, .col-sm-3'));
      for (const lbl of labels) {
        const t = lbl.textContent.replace(/\\s+/g, ' ').trim();
        if (/^Initiator/.test(t)) {
          const sib = lbl.nextElementSibling;
          if (sib) urheber = sib.textContent.replace(/\\s+/g, ' ').trim();
          break;
        }
      }
      // Fallback: 'Antragsteller', 'Verfasser'
      if (!urheber) {
        for (const lbl of labels) {
          const t = lbl.textContent.replace(/\\s+/g, ' ').trim();
          if (/^(Antragsteller|Verfasser|Fragesteller)/.test(t)) {
            const sib = lbl.nextElementSibling;
            if (sib) urheber = sib.textContent.replace(/\\s+/g, ' ').trim();
            break;
          }
        }
      }
      // Combined meta für Brandenburg-style parseMeta (Fallback)
      const meta = (docType + ' ' + urheber + ' ' + date + ' Drucksache ' + drsNr).trim();
      return { recId, title, meta, documentUrl, docType, drsNr, date, urheber };
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
    console.error("[starweb-he] keine Treffer im initial-load");
    return [];
  }
  const { total } = readRangeFromTreffer();
  console.log(`[starweb-he] Treffer insgesamt: ${total}`);
  if (!clickAlleAufEinerSeite()) {
    console.error("[starweb-he] 'Alle auf einer Seite' Button nicht gefunden");
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
  if (docLabel === "Kleine Anfrage") return { type: "kleine_anfrage" };
  if (docLabel.startsWith("Große Anfrage und Antwort")) return { type: "grosse_anfrage", status: "mit_antwort" };
  if (docLabel.startsWith("Große Anfrage")) return { type: "grosse_anfrage" };
  if (docLabel.startsWith("Gesetzentwurf")) return { type: "gesetzentwurf" };
  if (docLabel.startsWith("Berichterstattungsverlangen") || docLabel.startsWith("Berichtsantrag")) return { type: "antrag", subtype: docLabel };
  if (/^(Dringlicher\s+)?(Antrag|Alternativantrag|Änderungsantrag|Entschließungsantrag)/.test(docLabel)) {
    return { type: "antrag", subtype: docLabel === "Antrag" ? undefined : docLabel };
  }
  return null;
}

function parseMeta(meta: string): ParsedMeta | null {
  // Wird in Hessen nicht mehr genutzt — siehe parseRecord. Fallback auf
  // null sorgt dafuer, dass kein Datensatz fehl-parsed wird.
  void meta;
  return null;
}

function parseRecord(raw: RawRecord): ParsedMeta | null {
  if (!raw.docType || !raw.drsNr || !raw.date) return null;
  const dateIso = parseGermanDate(raw.date);
  if (!dateIso) return null;
  if (DOC_TYPE_SKIP_PREFIX.some((p) => raw.docType!.startsWith(p))) return null;
  const docTypeMatch = Array.from(DOC_TYPE_KEEP)
    .filter((t) => raw.docType!.startsWith(t))
    .sort((a, b) => b.length - a.length)[0];
  if (!docTypeMatch) return null;
  const classified = classify(docTypeMatch);
  if (!classified) return null;
  return {
    date: dateIso,
    type: classified.type,
    subtype: classified.subtype,
    status: classified.status,
    drsNr: raw.drsNr,
    urheber: raw.urheber ?? "",
    primaryDocLabel: raw.docType,
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
  // Hessen-Urheber-Format: "Nachname, Vorname, Fraktion; Nachname, Vorname, Fraktion; ..."
  // (Multi-Person, Semikolon-getrennt). Auch reine Fraktions-Urheber existieren
  // (z.B. "Fraktion der CDU") — die fangen wir separat ab.
  const persons: ActivityPerson[] = [];
  const fraktionenSet = new Set<string>();
  for (const segRaw of urheber.split(/;/)) {
    const seg = segRaw.trim();
    if (!seg) continue;
    const parts = seg.split(/,\s*/).map((p) => p.trim());
    // Erkennen: ist letzter Token eine Fraktion?
    const lastFr = slugifyFraktion(parts[parts.length - 1] ?? "");
    if (!lastFr || parts.length < 3) continue;
    const fraktionLabel = parts[parts.length - 1]!;
    const nachname = parts[0]!;
    const vornameRaw = parts.slice(1, -1).join(" ");
    // Akademische Titel entfernen
    const vorname = vornameRaw.replace(/^(Dr\.|Prof\.\s*Dr\.|Prof\.)\s+/, "").trim();
    if (!vorname || !nachname) continue;
    persons.push({
      slug: slugifyPerson(nachname, vorname),
      name: `${vorname} ${nachname}`,
      name_padoka: `${nachname}, ${vorname}`,
      role: "fragesteller",
      fraktion: fraktionLabel,
    });
    fraktionenSet.add(lastFr);
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
    id: `starweb-he-${idPrefix}-${drsSlug}`,
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
        : `https://starweb.hessen.de${raw.documentUrl}`,
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
    const parsed = parseRecord(raw);
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
    `[starweb-he] ${records.length} Records (WP ${WP}) · ${written} neu · ${skipped} schon vorhanden · ${nonMandate} keine Mandatsträger-Aktivität · ${unparsed.length} ungeparst`,
  );
  if (unparsed.length > 0 && unparsed.length <= 20) {
    console.log("Ungeparste Meta-Zeilen:");
    for (const u of unparsed) console.log("  " + u);
  }
}

main();
