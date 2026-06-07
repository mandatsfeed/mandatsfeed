// PADOKA-Adapter — Namentliche Abstimmungen, mit Per-MdL-Stimmen.
// Liest die Aggregat-Übersicht abstimmungen.tt.html und extrahiert pro Abstimmung
// das Plenarprotokoll-PDF, in dem der Name-pro-Vote-Block steht.
// Idempotent + additiv: vorhandene JSONs werden nicht überschrieben.
//
// Aufruf:
//   pnpm run fetch-abstimmungen:sachsen-anhalt
//   pnpm run fetch-abstimmungen:sachsen-anhalt -- --limit 1   (nur erste Abstimmung)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PDFParse } from "pdf-parse";
import type { Activity, ActivityPerson, VoteResult } from "../scripts/types.ts";

const PARLIAMENT_SLUG = "sachsen-anhalt";
const WIKI = resolve(import.meta.dirname, "../wiki", PARLIAMENT_SLUG);
const REGISTRY_PATH = join(WIKI, "personen.registry.json");
const LISTING_URL = "https://padoka.landtag.sachsen-anhalt.de/portal/abstimmungen.tt.html";
const PDF_CACHE = "/tmp/mandatsfeed-padoka-plpr";
const MIN_DATE = process.env.MIN_DATE ?? "2026-01-01";

interface RegistryEntry {
  name: string;
  name_padoka: string;
  fraktion: string | null;
  urls: { initiativen?: string; reden?: string };
}

interface AggregateAbst {
  id: string;
  politicalField: string;
  date: string;
  title: string;
  drsReference: string;
  meta: string;
  ja: number;
  nein: number;
  enthalten: number;
  abwesend: number;
  stimmberechtigt: number;
  plprNr: string | null;
  plprPdfUrl: string | null;
  plprPage: number | null;
  relatedDrs: string | null;
}

function ab(...args: string[]): string {
  return execFileSync("agent-browser", args, { encoding: "utf-8" });
}

function loadRegistry(): Record<string, RegistryEntry> {
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as Record<string, RegistryEntry>;
}

function waitForAbstimmungen(): number {
  for (let i = 0; i < 20; i++) {
    const out = ab("eval", "(() => document.querySelectorAll('[id^=wrapper-ABSTIMM_]').length || 0)()");
    const n = Number((out.match(/^\d+/m) ?? ["0"])[0]);
    if (n > 0) return n;
    ab("wait", "500");
  }
  return 0;
}

function fetchAggregates(): AggregateAbst[] {
  ab("open", LISTING_URL);
  const n = waitForAbstimmungen();
  if (n === 0) return [];
  const jsExpr = `(() => {
    return Array.from(document.querySelectorAll('[id^=wrapper-ABSTIMM_]')).map(w => {
      const id = w.id.replace('wrapper-', '');
      const politicalField = w.getAttribute('data-political-field') || '';
      const date = w.getAttribute('data-date') || '';
      const title = w.querySelector('.h5')?.textContent.trim() || '';
      const smalls = Array.from(w.querySelectorAll('small')).map(s => s.textContent.replace(/\\s+/g, ' ').trim());
      const drsReference = smalls[0] || '';
      const meta = smalls[1] || '';
      const counts = Array.from(w.querySelectorAll('.chart-wrapper span.font-weight-bold')).map(s => Number(s.textContent.trim()));
      const stimmberech = smalls.map(s => s.match(/stimmberechtigte Abgeordnete:\\s*(\\d+)/)).find(Boolean);
      return {
        id, politicalField, date, title, drsReference, meta,
        ja: counts[0] || 0, nein: counts[1] || 0, enthalten: counts[2] || 0, abwesend: counts[3] || 0,
        stimmberechtigt: stimmberech ? Number(stimmberech[1]) : 0
      };
    });
  })()`;
  const raw = ab("eval", jsExpr);
  const m = raw.match(/^\[[\s\S]*\]/m);
  if (!m) return [];
  const aggregates = JSON.parse(m[0]) as Omit<AggregateAbst, "plprNr" | "plprPdfUrl" | "plprPage" | "relatedDrs">[];
  return aggregates.map(a => {
    const plprMatch = a.meta.match(/Plenarprotokoll\s+(\d+\/\d+)/);
    const pageMatch = a.meta.match(/Abstimmung:\s*S\.\s*(\d+)/);
    const drsMatch = a.meta.match(/(?:Annahme|Ablehnung)\s+Drucksache\s+(\d+\/\d+)/);
    return {
      ...a,
      plprNr: plprMatch ? plprMatch[1] : null,
      plprPdfUrl: plprMatch ? `https://padoka.landtag.sachsen-anhalt.de/files/plenum/wp${a.meta.match(/Plenarprotokoll\s+(\d+)/)?.[1] ?? "8"}/${plprMatch[1].split("/")[1]}stzg.pdf` : null,
      plprPage: pageMatch ? Number(pageMatch[1]) : null,
      relatedDrs: drsMatch ? drsMatch[1] : null,
    };
  });
}

function downloadPdf(url: string, cachePath: string): Buffer {
  if (existsSync(cachePath)) return readFileSync(cachePath);
  mkdirSync(PDF_CACHE, { recursive: true });
  execFileSync("curl", ["-sSL", "-A", "mandatsfeed/0.1 (Forschungsprojekt)", "-o", cachePath, url]);
  return readFileSync(cachePath);
}

interface VoteLine { name: string; vote: "ja" | "nein" | "enthalten" | "abwesend" }

function parseVoteBlocks(text: string): VoteLine[][] {
  // Find consecutive lines matching <name> <vote-token>.
  // Vote token: Ja | Nein | enthalten | -
  const lines = text.split(/\r?\n/);
  const blocks: VoteLine[][] = [];
  let cur: VoteLine[] = [];
  const VOTE_RE = /^(.+?)\s+(Ja|Nein|enthalten|Enthalten|-)\s*$/;
  for (const ln of lines) {
    const m = VOTE_RE.exec(ln.trim());
    if (m && m[1].length > 2 && /[A-ZÄÖÜ]/.test(m[1][0])) {
      const voteToken = m[2];
      const vote: VoteLine["vote"] =
        voteToken === "Ja" ? "ja" :
        voteToken === "Nein" ? "nein" :
        voteToken === "-" ? "abwesend" : "enthalten";
      cur.push({ name: m[1].trim(), vote });
    } else if (cur.length > 0) {
      if (cur.length >= 10) blocks.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 30) blocks.push(cur);
  return blocks;
}

function tallyBlock(block: VoteLine[]): { ja: number; nein: number; enthalten: number; abwesend: number } {
  const t = { ja: 0, nein: 0, enthalten: 0, abwesend: 0 };
  for (const l of block) t[l.vote]++;
  return t;
}

function matchBlock(blocks: VoteLine[][], target: AggregateAbst): VoteLine[] | null {
  // Exact match on a single block first.
  for (const b of blocks) {
    const t = tallyBlock(b);
    if (t.ja === target.ja && t.nein === target.nein && t.enthalten === target.enthalten && t.abwesend === target.abwesend) {
      return b;
    }
  }
  // Combine consecutive blocks (page breaks split the roll call). Allow a tiny tolerance
  // because page-break headers can swallow up to 2 names; we re-derive missing entries
  // by name-set diff against the registry later if needed.
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j <= blocks.length; j++) {
      const merged = blocks.slice(i, j).flat();
      const t = tallyBlock(merged);
      const off =
        Math.abs(t.ja - target.ja) +
        Math.abs(t.nein - target.nein) +
        Math.abs(t.enthalten - target.enthalten) +
        Math.abs(t.abwesend - target.abwesend);
      if (off <= 3 && merged.length >= target.stimmberechtigt - 4) {
        return merged;
      }
    }
  }
  return null;
}

function buildNameIndex(registry: Record<string, RegistryEntry>): Map<string, { slug: string; entry: RegistryEntry }> {
  const idx = new Map<string, { slug: string; entry: RegistryEntry }>();
  for (const [slug, e] of Object.entries(registry)) {
    idx.set(e.name, { slug, entry: e });
    // Strip titles "Dr." etc.
    const stripped = e.name.replace(/^(Dr\.|Prof\.\s*Dr\.|Prof\.)\s+/, "").trim();
    if (stripped !== e.name) idx.set(stripped, { slug, entry: e });
    // Padoka registry sometimes carries city suffix like " (Staßfurt)" in the source
    // Normalise both directions.
    const noCitysuffix = e.name.replace(/\s*\([^)]+\)\s*$/, "").trim();
    if (noCitysuffix !== e.name) idx.set(noCitysuffix, { slug, entry: e });
  }
  return idx;
}

function lookupName(idx: Map<string, { slug: string; entry: RegistryEntry }>, raw: string): { slug: string; entry: RegistryEntry } | null {
  const candidates = [
    raw,
    raw.replace(/^(Dr\.|Prof\.\s*Dr\.|Prof\.)\s+/, "").trim(),
    raw.replace(/\s*\([^)]+\)\s*$/, "").trim(),
    raw.replace(/^(Dr\.|Prof\.\s*Dr\.|Prof\.)\s+/, "").replace(/\s*\([^)]+\)\s*$/, "").trim(),
  ];
  for (const c of candidates) {
    const hit = idx.get(c);
    if (hit) return hit;
  }
  return null;
}

function buildActivity(agg: AggregateAbst, block: VoteLine[], registry: Map<string, { slug: string; entry: RegistryEntry }>): Activity {
  const persons: ActivityPerson[] = [];
  const fraktionenSet = new Set<string>();
  for (const v of block) {
    const hit = lookupName(registry, v.name);
    if (!hit) continue;
    if (!hit.entry.fraktion) continue;
    persons.push({
      slug: hit.slug,
      name: hit.entry.name,
      name_padoka: hit.entry.name_padoka,
      role: "abstimmend",
      fraktion: hit.entry.fraktion,
      vote: v.vote,
    });
    fraktionenSet.add(slugifyFraktion(hit.entry.fraktion));
  }
  // Result derives from the vote counts, not from agg.meta — the meta string can
  // mix outcomes (e.g. „Ablehnung Drs. X in namentlicher Abstimmung" plus
  // „Beschluss: Annahme der Beschlussempfehlung"). Counts are authoritative.
  const result: VoteResult["result"] =
    agg.ja > agg.nein ? "annahme" :
    agg.nein > agg.ja ? "ablehnung" : "sonstig";
  const a: Activity = {
    id: `padoka-abst-${agg.id.replace("ABSTIMM_", "")}`,
    source: "padoka",
    parliament: PARLIAMENT_SLUG,
    wp: 8,
    type: "abstimmung",
    title: agg.title,
    date: agg.date,
    persons,
    fraktionen: Array.from(fraktionenSet),
    vote: {
      result,
      ja: agg.ja,
      nein: agg.nein,
      enthalten: agg.enthalten,
      abwesend: agg.abwesend,
      stimmberechtigt: agg.stimmberechtigt,
    },
  };
  if (agg.plprNr) {
    a.plenarprotokoll = { nr: agg.plprNr, date: agg.date, ...(agg.plprPage ? { page: agg.plprPage } : {}) };
    if (agg.plprPdfUrl) {
      a.document = { url: agg.plprPage ? `${agg.plprPdfUrl}#page=${agg.plprPage}` : agg.plprPdfUrl };
    }
  }
  if (agg.relatedDrs) a.relatedTo = `padoka-drs-${agg.relatedDrs.replace("/", "-")}`;
  if (agg.politicalField) a.note = `Themenbereich: ${agg.politicalField}`;
  return a;
}

const FRAKTION_SLUGS: Record<string, string> = {
  CDU: "cdu", AfD: "afd", "Die Linke": "die-linke", "DIE LINKE": "die-linke",
  SPD: "spd", FDP: "fdp", "BÜNDNIS 90/DIE GRÜNEN": "bundnis-90-die-gruenen",
};

function slugifyFraktion(label: string): string {
  return FRAKTION_SLUGS[label] ?? label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function filenameFor(a: Activity): string {
  return `${a.date}-abstimmung-${a.id.replace("padoka-abst-", "")}.json`;
}

function writeIfMissing(a: Activity): "written" | "skipped" {
  const dir = join(WIKI, "aktivitaet", a.date);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filenameFor(a));
  if (existsSync(path)) return "skipped";
  writeFileSync(path, JSON.stringify(a, null, 2) + "\n");
  return "written";
}

async function main(): Promise<void> {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;
  const registry = loadRegistry();
  const nameIndex = buildNameIndex(registry);
  const aggregates = fetchAggregates();
  console.log(`[padoka-abstimmungen] ${aggregates.length} Aggregate gefunden`);
  // PDF cache per PlPr to avoid re-downloads.
  const pdfTextCache = new Map<string, string>();
  let written = 0, skipped = 0, unmatched = 0, filteredByDate = 0;
  let processed = 0;
  for (const agg of aggregates) {
    if (processed >= limit) break;
    if (agg.date < MIN_DATE) { filteredByDate++; continue; }
    processed++;
    if (!agg.plprPdfUrl) { unmatched++; continue; }
    let text = pdfTextCache.get(agg.plprPdfUrl);
    if (!text) {
      const cachePath = join(PDF_CACHE, `plpr-${agg.plprPdfUrl.split("/").pop()}`);
      const buf = downloadPdf(agg.plprPdfUrl, cachePath);
      const t = await new PDFParse({ data: buf }).getText();
      text = t.text;
      pdfTextCache.set(agg.plprPdfUrl, text);
    }
    const blocks = parseVoteBlocks(text);
    const block = matchBlock(blocks, agg);
    if (!block) {
      console.log(`  [${agg.id}] no matching block (blocks=${blocks.length}, target=${agg.ja}/${agg.nein}/${agg.enthalten}/${agg.abwesend})`);
      unmatched++;
      continue;
    }
    const a = buildActivity(agg, block, nameIndex);
    if (writeIfMissing(a) === "written") written++;
    else skipped++;
  }
  console.log(`[padoka-abstimmungen] aggregates=${aggregates.length} · processed=${processed} · neu=${written} · vorhanden=${skipped} · ungematched=${unmatched} · vor ${MIN_DATE}=${filteredByDate}`);
}

main().catch(e => { console.error(e); process.exit(1); });
