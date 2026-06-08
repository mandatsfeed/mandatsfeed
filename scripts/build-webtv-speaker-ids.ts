// Build des Webtv-SpeakerId-Mappings für Bundestag-Personen.
//
// Quelle: https://www.bundestag.de/static/appdata/filter/rednerNamen.json
// (CC0 / öffentliche Mediathek-Filterliste, ~3200 Politiker:innen).
// Pro Person sind 1–7 speakerIds gelistet — die ergeben in Kombination einen
// vollständigen Reden-Video-Feed über alle Rollen / WPs hinweg.
//
// Wir matchen die Listen-Einträge per Nachname+Vorname-Slug an unsere
// vorhandenen `wiki/bundestag/wp-<N>/personen/<slug>/` Verzeichnisse und
// schreiben pro WP eine Datei `webtv-speaker-ids.json` mit dem Mapping
// slug → speakerIds[]. Diese wird von generate-metadata.ts gelesen und in
// das per-Person `externalFeeds`-Feld eingefügt.
//
// Aufruf:
//   pnpm run build-webtv-speaker-ids
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const WIKI = resolve(import.meta.dirname, "../wiki");
const SOURCE = "https://www.bundestag.de/static/appdata/filter/rednerNamen.json";

interface RednerRecord {
  value: string;            // "21276 OR 12380" oder "12135"
  label: string;            // "Klöckner, Julia "
  dep?: Array<{ party?: (string | null)[]; wahlperiode?: (number | null)[] }>;
}

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function labelToSlug(label: string): string | null {
  const trimmed = label.trim().replace(/,\s*$/, "");
  const parts = trimmed.split(",").map((p) => p.trim());
  if (parts.length < 2) return null;
  const nachname = parts[0]!;
  const vornameRaw = parts[1]!;
  // Akademische Titel entfernen ("Dr. ", "Prof. Dr. " etc.)
  const vorname = vornameRaw.replace(/^(Dr\.|Prof\.(\s+Dr\.)?)\s+/, "").trim();
  return slugify(`${vorname} ${nachname}`);
}

function listSlugs(parliamentSlug: string, wpDir: string): Set<string> {
  const base = join(WIKI, parliamentSlug, wpDir, "personen");
  if (!existsSync(base)) return new Set();
  return new Set(readdirSync(base));
}

async function main(): Promise<void> {
  console.log(`[webtv-ids] Lade rednerNamen.json von ${SOURCE}`);
  const res = await fetch(SOURCE, {
    headers: { "User-Agent": "mandatsfeed/0.1 (Forschungsprojekt)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as RednerRecord[];
  console.log(`[webtv-ids] ${data.length} Politiker:innen in der Quelle`);

  const slugToIds = new Map<string, Set<string>>();
  for (const r of data) {
    const slug = labelToSlug(r.label);
    if (!slug) continue;
    const sids = r.value.split("OR").map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
    if (sids.length === 0) continue;
    const set = slugToIds.get(slug) ?? new Set<string>();
    for (const sid of sids) set.add(sid);
    slugToIds.set(slug, set);
  }
  console.log(`[webtv-ids] ${slugToIds.size} eindeutige Slugs in der Quelle`);

  const parliamentSlug = "bundestag";
  for (const wpDir of readdirSync(join(WIKI, parliamentSlug)).filter((n) => /^wp-\d+$/.test(n))) {
    const ours = listSlugs(parliamentSlug, wpDir);
    const out: Record<string, string[]> = {};
    for (const slug of ours) {
      const ids = slugToIds.get(slug);
      if (!ids) continue;
      out[slug] = Array.from(ids).sort((a, b) => Number(b) - Number(a));
    }
    const sortedOut: Record<string, string[]> = {};
    for (const k of Object.keys(out).sort()) sortedOut[k] = out[k]!;
    const path = join(WIKI, parliamentSlug, wpDir, "webtv-speaker-ids.json");
    writeFileSync(path, JSON.stringify(sortedOut, null, 2) + "\n");
    const coverage = ours.size > 0 ? Math.round((100 * Object.keys(out).length) / ours.size) : 0;
    console.log(`[webtv-ids] ${wpDir}: ${Object.keys(out).length}/${ours.size} mapped (${coverage}%)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
