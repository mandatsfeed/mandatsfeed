#!/usr/bin/env tsx
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FeedEntry } from "./types.ts";
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

function listWPDirs(parliamentSlug: string): string[] {
  const dir = join(WIKI, parliamentSlug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /^wp-\d+$/.test(n))
    .filter((n) => statSync(join(dir, n)).isDirectory())
    .sort();
}

// Pro Parlament + WP eventuell vorhandene Webtv-SpeakerId-Mapping einlesen.
// Datei: wiki/<parlament>/<wp>/webtv-speaker-ids.json — Map slug → speakerId[].
// Wird beim Build-Script `tsx scripts/build-webtv-speaker-ids.ts` aus der
// Bundestag-rednerNamen.json gefüttert.
function loadWebtvSpeakerIds(parliamentSlug: string, wpDir: string): Record<string, string[]> {
  const path = join(WIKI, parliamentSlug, wpDir, "webtv-speaker-ids.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function buildEntries(parliamentSlug: string, wpDir: string, kind: "person" | "fraktion"): FeedEntry[] {
  const subdir = kind === "person" ? "personen" : "fraktion";
  const base = join(WIKI, parliamentSlug, wpDir, subdir);
  const entries: FeedEntry[] = [];
  const webtvIds = kind === "person" && parliamentSlug === "bundestag"
    ? loadWebtvSpeakerIds(parliamentSlug, wpDir)
    : {};
  for (const slug of listSubdirs(base)) {
    const rssPath = join(base, slug, "rss.xml");
    if (!existsSync(rssPath)) continue;
    const label = readChannelTitle(rssPath)?.replace(/^mandatsfeed · /, "").replace(/ \(.*\)$/, "") ?? slug;
    const entry: FeedEntry = {
      kind,
      parliament: parliamentSlug,
      slug,
      label,
      count: countItems(rssPath),
      updatedAt: latestPubDate(rssPath),
      rssUrl: `wiki/${parliamentSlug}/${wpDir}/${subdir}/${slug}/rss.xml`,
    };
    const ids = webtvIds[slug];
    if (ids && ids.length > 0) {
      entry.externalFeeds = [{
        type: "bundestag-mediathek",
        label: "Videos im Plenum",
        url: `https://webtv.bundestag.de/player/macros/bttv/podcast/video/plenar.xml?speakerIds=${ids.join(",")}`,
      }];
    }
    entries.push(entry);
  }
  return entries;
}

interface WPBlock {
  wp: number;
  label: string;
  personen: FeedEntry[];
  fraktionen: FeedEntry[];
}

function main(): void {
  const meta = {
    generatedAt: new Date().toISOString(),
    parliaments: PARLIAMENTS.filter((p) => p.published).map((p) => {
      const wahlperioden: WPBlock[] = [];
      for (const wpDir of listWPDirs(p.slug)) {
        const wpNum = Number(wpDir.replace("wp-", ""));
        wahlperioden.push({
          wp: wpNum,
          label: `${wpNum}. Wahlperiode`,
          personen: buildEntries(p.slug, wpDir, "person"),
          fraktionen: buildEntries(p.slug, wpDir, "fraktion"),
        });
      }
      return {
        slug: p.slug,
        label: p.label,
        homepage: p.homepage,
        wahlperioden,
      };
    }),
  };
  const out = join(WIKI, "metadata.json");
  writeFileSync(out, JSON.stringify(meta, null, 2) + "\n");
  for (const p of meta.parliaments) {
    for (const wp of p.wahlperioden) {
      console.log(
        `[${p.slug}/wp-${wp.wp}] ${wp.personen.length} Personen-Feeds, ${wp.fraktionen.length} Fraktions-Feeds abonnierbar`,
      );
    }
  }
  console.log(`→ wiki/metadata.json`);
}

main();
