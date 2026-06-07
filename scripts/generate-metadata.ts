#!/usr/bin/env tsx
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FeedEntry, Metadata } from "./types.ts";
import { PARLIAMENTS } from "./parliaments.ts";

const WIKI = resolve(import.meta.dirname, "../wiki");

function listSubdirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort();
}

function countItems(rssPath: string): number {
  if (!existsSync(rssPath)) return 0;
  const xml = readFileSync(rssPath, "utf-8");
  return (xml.match(/<item>/g) ?? []).length;
}

function latestPubDate(rssPath: string): string | null {
  if (!existsSync(rssPath)) return null;
  const xml = readFileSync(rssPath, "utf-8");
  const match = xml.match(/<pubDate>([^<]+)<\/pubDate>/);
  if (!match || !match[1]) return null;
  const d = new Date(match[1]);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function readChannelTitle(rssPath: string): string | null {
  if (!existsSync(rssPath)) return null;
  const xml = readFileSync(rssPath, "utf-8");
  const m = xml.match(/<channel>[\s\S]*?<title>([^<]+)<\/title>/);
  return m?.[1] ?? null;
}

function buildEntries(parliamentSlug: string, kind: "person" | "fraktion"): FeedEntry[] {
  const subdir = kind === "person" ? "personen" : "fraktion";
  const base = join(WIKI, parliamentSlug, subdir);
  const entries: FeedEntry[] = [];
  for (const slug of listSubdirs(base)) {
    const rssPath = join(base, slug, "rss.xml");
    if (!existsSync(rssPath)) continue;
    const label = readChannelTitle(rssPath)?.replace(/^mandatsfeed · /, "").replace(/ \(.*\)$/, "") ?? slug;
    entries.push({
      kind,
      parliament: parliamentSlug,
      slug,
      label,
      count: countItems(rssPath),
      updatedAt: latestPubDate(rssPath),
      rssUrl: `wiki/${parliamentSlug}/${subdir}/${slug}/rss.xml`,
    });
  }
  return entries;
}

function main(): void {
  const meta: Metadata = {
    generatedAt: new Date().toISOString(),
    parliaments: PARLIAMENTS.map((p) => ({
      slug: p.slug,
      label: p.label,
      homepage: p.homepage,
      personen: buildEntries(p.slug, "person"),
      fraktionen: buildEntries(p.slug, "fraktion"),
    })),
  };
  const out = join(WIKI, "metadata.json");
  writeFileSync(out, JSON.stringify(meta, null, 2) + "\n");
  for (const p of meta.parliaments) {
    console.log(
      `[${p.slug}] ${p.personen.length} Personen-Feeds, ${p.fraktionen.length} Fraktions-Feeds abonnierbar`,
    );
  }
  console.log(`→ wiki/metadata.json`);
}

main();
