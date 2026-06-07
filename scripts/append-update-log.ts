#!/usr/bin/env tsx
/**
 * Schreibt einen Änderungsblock in UPDATES.md basierend auf dem aktuellen Working-Tree
 * gegenüber `git HEAD`. Soll nach einem Adapter-Lauf aufgerufen werden, bevor committed wird.
 *
 * Pro Parlament + Fraktion + Aktivitätstyp werden gezählt:
 *   - neu        (Activity-File im Working Tree, nicht in HEAD)
 *   - aktualisiert (in beiden, Item-Inhalt ohne fetchedAt/updatedAt geändert)
 *   - entfernt   (in HEAD, im Working Tree weg) — sollte bei Append-only-Quellen
 *                 nie vorkommen, wird aber dennoch berichtet.
 *
 * Wenn nichts geändert ist, wird UPDATES.md NICHT angefasst.
 *
 * Hinweis: während der Forschungsphase ist `wiki/**​/*.json` per .gitignore aus dem
 * Repo ausgeschlossen — der Vergleich gegen HEAD ergibt dann ausschließlich „neue"
 * Items, was korrekt ist und zeigt, was beim ersten Commit reinkäme.
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Activity } from "./types.ts";
import { PARLIAMENTS, TYPE_LABELS } from "./parliaments.ts";

const ROOT = resolve(import.meta.dirname, "..");
const WIKI = resolve(ROOT, "wiki");
const TYPES_ORDER = ["rede", "antrag", "kleine_anfrage", "grosse_anfrage", "gesetzentwurf", "abstimmung", "beschlussempfehlung"] as const;

interface Diff { added: number; updated: number; removed: number }

function isEmpty(d: Diff): boolean { return d.added === 0 && d.updated === 0 && d.removed === 0; }
function fmtDiff(d: Diff): string {
  const parts: string[] = [];
  if (d.added) parts.push(`+${d.added}`);
  if (d.updated) parts.push(`~${d.updated}`);
  if (d.removed) parts.push(`-${d.removed}`);
  return parts.length ? parts.join(" / ") : "—";
}

function contentKey(a: Activity): string {
  const filtered: Record<string, unknown> = {};
  for (const k of Object.keys(a).filter((k) => k !== "fetchedAt" && k !== "updatedAt").sort()) {
    filtered[k] = (a as unknown as Record<string, unknown>)[k];
  }
  return JSON.stringify(filtered);
}

function* walkActivityFiles(parliamentSlug: string): Iterable<string> {
  const parliamentDir = join(WIKI, parliamentSlug);
  if (!existsSync(parliamentDir)) return;
  for (const wpDir of readdirSync(parliamentDir)) {
    if (!/^wp-\d+$/.test(wpDir)) continue;
    const aktivitaetDir = join(parliamentDir, wpDir, "aktivitaet");
    if (!existsSync(aktivitaetDir)) continue;
    for (const day of readdirSync(aktivitaetDir)) {
      const dayDir = join(aktivitaetDir, day);
      if (!statSync(dayDir).isDirectory()) continue;
      for (const f of readdirSync(dayDir)) {
        if (!f.endsWith(".json")) continue;
        yield join(dayDir, f);
      }
    }
  }
}

function gitHeadActivity(repoRelPath: string): Activity | null {
  try {
    const txt = execSync(`git show HEAD:"${repoRelPath}"`, { encoding: "utf-8", cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(txt) as Activity;
  } catch { return null; }
}

function gitHeadFilesUnder(prefix: string): Set<string> {
  try {
    const out = execSync(`git ls-tree -r --name-only HEAD -- "${prefix}"`, { encoding: "utf-8", cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] });
    return new Set(out.split("\n").filter((s) => s.endsWith(".json") && /\/wp-\d+\/aktivitaet\//.test(s)));
  } catch { return new Set(); }
}

interface Bucket { [fraktionSlug: string]: { [type: string]: Diff } }
interface ParliamentBucket { fraktionen: Bucket; total: Diff }

function emptyDiff(): Diff { return { added: 0, updated: 0, removed: 0 }; }
function addDiff(into: Diff, kind: keyof Diff): void { into[kind]++; }

function aggregate(): Map<string, ParliamentBucket> {
  const result = new Map<string, ParliamentBucket>();
  for (const parliament of PARLIAMENTS) {
    const treeFiles = new Set<string>();
    for (const abs of walkActivityFiles(parliament.slug)) {
      treeFiles.add(relative(ROOT, abs));
    }
    const headFiles = gitHeadFilesUnder(`wiki/${parliament.slug}/`);
    const bucket: ParliamentBucket = { fraktionen: {}, total: emptyDiff() };

    const ensure = (fr: string, type: string): Diff => {
      if (!bucket.fraktionen[fr]) bucket.fraktionen[fr] = {};
      if (!bucket.fraktionen[fr]![type]) bucket.fraktionen[fr]![type] = emptyDiff();
      return bucket.fraktionen[fr]![type]!;
    };

    for (const treePath of treeFiles) {
      const current = JSON.parse(readFileSync(join(ROOT, treePath), "utf-8")) as Activity;
      const inHead = headFiles.has(treePath);
      let kind: keyof Diff;
      if (!inHead) kind = "added";
      else {
        const old = gitHeadActivity(treePath);
        if (!old) kind = "added";
        else if (contentKey(current) === contentKey(old)) continue;
        else kind = "updated";
      }
      const fraktionen = current.fraktionen.length > 0 ? current.fraktionen : ["unbekannt"];
      for (const fr of fraktionen) {
        addDiff(ensure(fr, current.type), kind);
      }
      addDiff(bucket.total, kind);
    }

    for (const headPath of headFiles) {
      if (treeFiles.has(headPath)) continue;
      const old = gitHeadActivity(headPath);
      if (!old) continue;
      const fraktionen = old.fraktionen.length > 0 ? old.fraktionen : ["unbekannt"];
      for (const fr of fraktionen) addDiff(ensure(fr, old.type), "removed");
      addDiff(bucket.total, "removed");
    }

    if (!isEmpty(bucket.total)) result.set(parliament.slug, bucket);
  }
  return result;
}

function fraktionLabel(parliamentSlug: string, fr: string): string {
  const p = PARLIAMENTS.find((x) => x.slug === parliamentSlug);
  return p?.fraktionLabels[fr] ?? fr;
}

function typeLabel(t: string): string { return TYPE_LABELS[t] ?? t; }

function renderTable(parliamentSlug: string, bucket: ParliamentBucket): string {
  const fraktionen = Object.keys(bucket.fraktionen).sort((a, b) => fraktionLabel(parliamentSlug, a).localeCompare(fraktionLabel(parliamentSlug, b)));
  const usedTypes = TYPES_ORDER.filter((t) =>
    fraktionen.some((fr) => bucket.fraktionen[fr]![t] && !isEmpty(bucket.fraktionen[fr]![t]!)),
  );
  if (usedTypes.length === 0) return "";
  const header = ["Fraktion", ...usedTypes.map(typeLabel)];
  const lines = [
    `| ${header.join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
  ];
  for (const fr of fraktionen) {
    const cells = [fraktionLabel(parliamentSlug, fr), ...usedTypes.map((t) => {
      const d = bucket.fraktionen[fr]![t];
      return d && !isEmpty(d) ? fmtDiff(d) : "—";
    })];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

function main(): void {
  const agg = aggregate();
  if (agg.size === 0) {
    console.log("Keine inhaltlichen Änderungen — UPDATES.md nicht angepasst.");
    return;
  }
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  let totalA = 0, totalU = 0, totalR = 0;
  for (const bucket of agg.values()) {
    totalA += bucket.total.added;
    totalU += bucket.total.updated;
    totalR += bucket.total.removed;
  }

  const parts: string[] = [];
  parts.push(`## ${stamp}`);
  parts.push("");
  parts.push(`Insgesamt **${totalA} neu**, **${totalU} aktualisiert**, **${totalR} entfernt** in ${agg.size} Parlament${agg.size === 1 ? "" : "en"}.`);
  parts.push("");
  for (const [slug, bucket] of agg) {
    const parliament = PARLIAMENTS.find((p) => p.slug === slug);
    parts.push(`### ${parliament?.label ?? slug}`);
    parts.push("");
    parts.push(`+${bucket.total.added} neu · ~${bucket.total.updated} aktualisiert · -${bucket.total.removed} entfernt`);
    parts.push("");
    const table = renderTable(slug, bucket);
    if (table) parts.push(table);
    parts.push("");
  }
  const block = parts.join("\n") + "\n";

  const updatesPath = join(ROOT, "UPDATES.md");
  let existing = "";
  if (existsSync(updatesPath)) existing = readFileSync(updatesPath, "utf-8");
  let next: string;
  if (existing.startsWith("# Updates")) {
    const headerEnd = existing.indexOf("\n\n");
    if (headerEnd === -1) next = `${existing}\n\n${block}\n`;
    else next = `${existing.slice(0, headerEnd + 2)}${block}\n${existing.slice(headerEnd + 2)}`;
  } else {
    const header = "# Updates\n\nÄnderungslog der Adapter-Läufe. Automatisch befüllt von `scripts/append-update-log.ts` vor dem nächsten Commit.\n\n";
    next = `${header}${block}\n${existing}`;
  }
  writeFileSync(updatesPath, next);
  console.log(`UPDATES.md erweitert: ${stamp} — ${agg.size} Parlament(e), +${totalA} ~${totalU} -${totalR}`);
}

main();
