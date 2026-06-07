// PADOKA-Adapter — Reden im Plenum, pro Abgeordnetem.
// Iteriert über personen.registry.json, lädt für jeden MdL die deeplinkbare
// Redenliste (browse.tt.html?type=generic4&speaker=…&wp=8) und schreibt eine
// Activity je gefundener Rede.
// Idempotent + additiv: vorhandene JSONs werden nicht überschrieben.
//
// Aufruf:
//   pnpm run fetch-reden:sachsen-anhalt                 → alle MdL
//   pnpm run fetch-reden:sachsen-anhalt -- <slug>       → nur ein MdL (für Tests)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Activity, ActivityPerson } from "../scripts/types.ts";

const PARLIAMENT_SLUG = "sachsen-anhalt";
const WIKI = resolve(import.meta.dirname, "../wiki", PARLIAMENT_SLUG);
const REGISTRY_PATH = join(WIKI, "personen.registry.json");

interface RegistryEntry {
  name: string;
  name_padoka: string;
  fraktion: string | null;
  note?: string;
  urls: { initiativen?: string; reden?: string };
}

interface SpeechRecord {
  topic: string;
  contextMeta: string;
  plpr: { nr: string; pdfUrl: string; page: number | undefined; date: string };
}

function ab(...args: string[]): string {
  return execFileSync("agent-browser", args, { encoding: "utf-8" });
}

function loadRegistry(): Record<string, RegistryEntry> {
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as Record<string, RegistryEntry>;
}

function waitForResults(): number {
  for (let i = 0; i < 20; i++) {
    const out = ab("eval", "(() => document.getElementById('results-container')?.children.length || 0)()");
    const n = Number((out.match(/^\d+/m) ?? ["0"])[0]);
    if (n > 0) return n;
    ab("wait", "500");
  }
  return 0;
}

function fetchReden(redenUrl: string): SpeechRecord[] {
  ab("open", redenUrl);
  const n = waitForResults();
  if (n === 0) return [];
  const jsExpr = `(() => {
    const c = document.getElementById('results-container');
    if (!c) return [];
    return Array.from(c.children).map(rec => {
      const inner = rec.querySelector('.efxZoomGeneric4');
      if (!inner) return null;
      const topic = inner.querySelector('.font-weight-bold')?.textContent.trim() || '';
      const metas = Array.from(inner.querySelectorAll('.h6')).map(s => s.textContent.replace(/\\s+/g, ' ').trim());
      const contextMeta = metas[0] || '';
      const pdfLink = inner.querySelector('a[href*="/files/plenum/"]');
      const pdfHref = pdfLink ? pdfLink.getAttribute('href') : null;
      const pageLink = Array.from(inner.querySelectorAll('a[href*="#page="]')).pop();
      const pageHref = pageLink ? pageLink.getAttribute('href') : null;
      // Date often sits in plain text near "S." marker; pull from full inner text.
      const text = inner.textContent.replace(/\\s+/g, ' ').trim();
      const dateMatch = text.match(/Plenarprotokoll[^]*?(\\d{2}\\.\\d{2}\\.\\d{4})/);
      const nrMatch = text.match(/Plenarprotokoll\\s*([\\d\\/]+)/);
      const pageMatch = pageHref ? pageHref.match(/#page=(\\d+)/) : null;
      return {
        topic,
        contextMeta,
        plpr: {
          nr: nrMatch ? nrMatch[1] : '',
          pdfUrl: pdfHref || '',
          page: pageMatch ? Number(pageMatch[1]) : undefined,
          date: dateMatch ? dateMatch[1] : ''
        }
      };
    }).filter(x => x && x.plpr.nr && x.plpr.date);
  })()`;
  const raw = ab("eval", jsExpr);
  const m = raw.match(/^\[[\s\S]*\]/m);
  if (!m) return [];
  return JSON.parse(m[0]) as SpeechRecord[];
}

function parseGermanDate(s: string): string {
  const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

function buildActivity(slug: string, entry: RegistryEntry, sp: SpeechRecord): Activity | null {
  if (!entry.fraktion) return null;
  const date = parseGermanDate(sp.plpr.date);
  if (!date) return null;
  const plprSlug = sp.plpr.nr.replace("/", "-");
  const pageSuffix = sp.plpr.page !== undefined ? `-p${sp.plpr.page}` : "";
  const id = `padoka-rede-${plprSlug}${pageSuffix}-${slug}`;
  const person: ActivityPerson = {
    slug,
    name: entry.name,
    name_padoka: entry.name_padoka,
    role: "redner",
    fraktion: entry.fraktion,
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
    fraktionen: [slugifyFraktion(entry.fraktion)],
    plenarprotokoll: {
      nr: sp.plpr.nr,
      date,
      ...(sp.plpr.page !== undefined ? { page: sp.plpr.page } : {}),
    },
    document: {
      url: sp.plpr.page !== undefined ? `${sp.plpr.pdfUrl}#page=${sp.plpr.page}` : sp.plpr.pdfUrl,
    },
  };
  if (sp.contextMeta) a.summary = sp.contextMeta;
  return a;
}

const FRAKTION_SLUGS: Record<string, string> = {
  CDU: "cdu",
  AfD: "afd",
  "Die Linke": "die-linke",
  "DIE LINKE": "die-linke",
  SPD: "spd",
  FDP: "fdp",
  "BÜNDNIS 90/DIE GRÜNEN": "bundnis-90-die-gruenen",
};

function slugifyFraktion(label: string): string {
  return FRAKTION_SLUGS[label] ?? label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
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
  const onlySlug = process.argv[2];
  const registry = loadRegistry();
  const targets = onlySlug
    ? Object.entries(registry).filter(([s]) => s === onlySlug)
    : Object.entries(registry);
  if (onlySlug && targets.length === 0) {
    console.error(`Slug "${onlySlug}" nicht in personen.registry.json`);
    process.exit(1);
  }
  let totalWritten = 0;
  let totalSkipped = 0;
  let totalSpeeches = 0;
  let mdlsSeen = 0;
  for (const [slug, entry] of targets) {
    if (!entry.urls.reden) continue;
    mdlsSeen++;
    const speeches = fetchReden(entry.urls.reden);
    totalSpeeches += speeches.length;
    let written = 0;
    let skipped = 0;
    for (const sp of speeches) {
      const a = buildActivity(slug, entry, sp);
      if (!a) continue;
      if (writeIfMissing(a) === "written") written++;
      else skipped++;
    }
    console.log(`[${slug}] ${speeches.length} Reden · ${written} neu · ${skipped} schon vorhanden`);
    totalWritten += written;
    totalSkipped += skipped;
  }
  console.log(
    `[padoka-reden] ${mdlsSeen} MdL · ${totalSpeeches} Reden insgesamt · ${totalWritten} neu · ${totalSkipped} schon vorhanden`,
  );
}

main();
