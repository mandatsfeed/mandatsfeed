#!/usr/bin/env tsx
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Activity, ParliamentConfig } from "./types.ts";
import { PARLIAMENTS, TYPE_LABELS } from "./parliaments.ts";

const WIKI = resolve(import.meta.dirname, "../wiki");
const FEED_LIMIT = 50;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rfc822(date: string): string {
  return new Date(date + "T00:00:00Z").toUTCString();
}

function loadActivities(parliamentSlug: string): Activity[] {
  const dir = join(WIKI, parliamentSlug, "aktivitaet");
  if (!existsSync(dir)) return [];
  const items: Activity[] = [];
  for (const day of readdirSync(dir)) {
    const dayDir = join(dir, day);
    if (!statSync(dayDir).isDirectory()) continue;
    for (const f of readdirSync(dayDir)) {
      if (!f.endsWith(".json")) continue;
      items.push(JSON.parse(readFileSync(join(dayDir, f), "utf-8")) as Activity);
    }
  }
  return items;
}

function synthDescription(a: Activity): string {
  const parts: string[] = [];
  const typeLabel = TYPE_LABELS[a.type] ?? a.type;
  parts.push(a.subtype ? `${typeLabel} (${a.subtype})` : typeLabel);
  if (a.drsNr) parts.push(a.drsNr);
  if (a.persons.length > 0) {
    parts.push("Urheber: " + a.persons.map((p) => `${p.name} (${p.fraktion})`).join(", "));
  } else if (a.urheber) {
    parts.push("Urheber: " + a.urheber);
  }
  if (a.document?.pages) parts.push(`${a.document.pages} S.`);
  if (a.summary) parts.push(a.summary);
  return parts.join(" · ");
}

function renderItem(a: Activity): string {
  const link = a.document?.url ?? "";
  return `    <item>
      <guid isPermaLink="false">${escapeXml(a.id)}</guid>
      <title>${escapeXml(a.title)}</title>
      <pubDate>${rfc822(a.date)}</pubDate>
      <link>${escapeXml(link)}</link>
      <description>${escapeXml(synthDescription(a))}</description>
    </item>`;
}

function renderChannel(opts: {
  title: string;
  link: string;
  description: string;
  items: Activity[];
}): string {
  const sorted = opts.items.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, FEED_LIMIT);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(opts.title)}</title>
    <link>${escapeXml(opts.link)}</link>
    <description>${escapeXml(opts.description)}</description>
    <language>de</language>
${sorted.map(renderItem).join("\n")}
  </channel>
</rss>
`;
}

function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}

function writeIfChanged(path: string, content: string): boolean {
  if (existsSync(path) && readFileSync(path, "utf-8") === content) return false;
  writeFileSync(path, content);
  return true;
}

interface PersonAggregate {
  slug: string;
  name: string;
  fraktion: string;
  items: Activity[];
}

function pruneStale(baseDir: string, currentSlugs: Set<string>): number {
  if (!existsSync(baseDir)) return 0;
  let pruned = 0;
  for (const slug of readdirSync(baseDir)) {
    const sub = join(baseDir, slug);
    if (!statSync(sub).isDirectory()) continue;
    if (!currentSlugs.has(slug)) {
      rmSync(sub, { recursive: true, force: true });
      pruned++;
    }
  }
  return pruned;
}

function buildPersonFeeds(
  parliament: ParliamentConfig,
  activities: Activity[],
): { written: number; pruned: number } {
  const byPerson = new Map<string, PersonAggregate>();
  for (const a of activities) {
    for (const p of a.persons) {
      let agg = byPerson.get(p.slug);
      if (!agg) {
        agg = { slug: p.slug, name: p.name, fraktion: p.fraktion, items: [] };
        byPerson.set(p.slug, agg);
      }
      agg.items.push(a);
    }
  }
  let written = 0;
  for (const agg of byPerson.values()) {
    const dir = join(WIKI, parliament.slug, "personen", agg.slug);
    ensureDir(dir);
    const xml = renderChannel({
      title: `mandatsfeed · ${agg.name} (${parliament.label})`,
      link: parliament.homepage,
      description: parliament.sourceNotice,
      items: agg.items,
    });
    if (writeIfChanged(join(dir, "rss.xml"), xml)) written++;
  }
  const pruned = pruneStale(
    join(WIKI, parliament.slug, "personen"),
    new Set(byPerson.keys()),
  );
  return { written, pruned };
}

function buildFraktionFeeds(
  parliament: ParliamentConfig,
  activities: Activity[],
): { written: number; pruned: number } {
  const byFraktion = new Map<string, Activity[]>();
  for (const a of activities) {
    for (const f of a.fraktionen) {
      if (!byFraktion.has(f)) byFraktion.set(f, []);
      byFraktion.get(f)!.push(a);
    }
  }
  let written = 0;
  for (const [slug, items] of byFraktion) {
    const label = parliament.fraktionLabels[slug] ?? slug;
    const dir = join(WIKI, parliament.slug, "fraktion", slug);
    ensureDir(dir);
    const xml = renderChannel({
      title: `mandatsfeed · Fraktion ${label} (${parliament.label})`,
      link: parliament.homepage,
      description: parliament.sourceNotice,
      items,
    });
    if (writeIfChanged(join(dir, "rss.xml"), xml)) written++;
  }
  const pruned = pruneStale(
    join(WIKI, parliament.slug, "fraktion"),
    new Set(byFraktion.keys()),
  );
  return { written, pruned };
}

function main(): void {
  for (const parliament of PARLIAMENTS) {
    const activities = loadActivities(parliament.slug);
    if (activities.length === 0) {
      console.log(`[${parliament.slug}] keine Aktivitäten`);
      continue;
    }
    const persons = buildPersonFeeds(parliament, activities);
    const fraktionen = buildFraktionFeeds(parliament, activities);
    console.log(
      `[${parliament.slug}] ${activities.length} Aktivitäten → Personen: ${persons.written} geschrieben, ${persons.pruned} entfernt · Fraktionen: ${fraktionen.written} geschrieben, ${fraktionen.pruned} entfernt`,
    );
  }
}

main();
