// Abgeordnetenwatch-Abstimmungen-Adapter (generisch).
//
// Quelle: https://www.abgeordnetenwatch.de/api/v2/ (CC0). Endpunkte:
//   /api/v2/polls?field_legislature=<period-id>   → Liste namentlicher Abstimmungen
//   /api/v2/votes?poll=<poll-id>                  → Stimme pro MdL für eine Abstimmung
//
// Rate-Limit: 30 Anfragen pro Minute (Vorgabe). Wir warten konservativ 2,1 s
// zwischen jedem API-Call (≈28 req/min).
//
// Aufruf:
//   PARLIAMENT=brandenburg pnpm run fetch-abstimmungen:abgeordnetenwatch
//   PARLIAMENT=thueringen YEAR=2026 pnpm run fetch-abstimmungen:abgeordnetenwatch
//
// Idempotent + additiv. JSON-Dateien werden quell-präfixiert mit `aw-abst-...`
// und parallel zu eventuell vorhandenen DIP-/PADOKA-Pendants abgelegt.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Activity, ActivityPerson, VoteResult } from "../scripts/types.ts";

const PARLIAMENT_SLUG = process.env.PARLIAMENT ?? "";
const YEAR = process.env.YEAR ? Number(process.env.YEAR) : undefined;
const MIN_DATE = process.env.MIN_DATE ?? (YEAR ? `${YEAR}-01-01` : "2026-01-01");
const MAX_DATE = process.env.MAX_DATE ?? (YEAR ? `${YEAR}-12-31` : "2099-12-31");
const REQUEST_DELAY_MS = 2100; // 30 req/min Rate-Limit, 2,1 s = ≈28 req/min Puffer

// Slug → AbgeordnetenWatch parliament_period id (aktuelle Wahlperiode).
// Quelle: GET /api/v2/parliaments — `current_project.id`.
// Stand 2026-06.
const PERIOD_BY_PARLIAMENT: Record<string, { wp: number; periodId: number }> = {
  brandenburg: { wp: 8, periodId: 158 },              // 2024–2029
  thueringen: { wp: 8, periodId: 156 },               // 2024–2029
  sachsen: { wp: 8, periodId: 157 },                  // 2024–2029
  "mecklenburg-vorpommern": { wp: 8, periodId: 134 }, // 2021–2026
  "sachsen-anhalt": { wp: 8, periodId: 131 },         // 2021–2026
  bundestag: { wp: 21, periodId: 161 },               // 2025–2029
};

// Fraktions-Slug pro Parlament. AbgeordnetenWatch liefert das nackte Label
// (z. B. "AfD") in fraction_membership[0].label oder als "AfD (Brandenburg
// 2024 - 2029)" in vote.fraction.label — wir nehmen das nackte Label und
// mappen pro Parlament.
const FRAKTION_SLUGS: Record<string, Record<string, string>> = {
  brandenburg: { "SPD": "spd", "AfD": "afd", "CDU": "cdu", "BSW": "bsw", "Die Linke": "die-linke", "fraktionslos": "fraktionslos" },
  thueringen: { "CDU": "cdu", "AfD": "afd", "BSW": "bsw", "Die Linke": "die-linke", "SPD": "spd", "fraktionslos": "fraktionslos" },
  sachsen: { "CDU": "cdu", "AfD": "afd", "BSW": "bsw", "SPD": "spd", "Bündnisgrüne": "bundnisgruene", "BÜNDNISGRÜNE": "bundnisgruene", "Die Linke": "die-linke", "fraktionslos": "fraktionslos" },
  "mecklenburg-vorpommern": { "SPD": "spd", "AfD": "afd", "CDU": "cdu", "Die Linke": "die-linke", "FDP": "fdp", "fraktionslos": "fraktionslos" },
  "sachsen-anhalt": { "CDU": "cdu", "AfD": "afd", "Die Linke": "die-linke", "SPD": "spd", "FDP": "fdp", "BÜNDNIS 90/DIE GRÜNEN": "bundnis-90-die-gruenen", "fraktionslos": "fraktionslos" },
  bundestag: { "CDU/CSU": "cdu-csu", "SPD": "spd", "AfD": "afd", "BÜNDNIS 90/DIE GRÜNEN": "bundnis-90-die-gruenen", "Die Linke": "die-linke", "BSW": "bsw", "FDP": "fdp", "fraktionslos": "fraktionslos" },
};

const VOTE_MAP: Record<string, ActivityPerson["vote"]> = {
  "yes": "ja",
  "no": "nein",
  "abstain": "enthalten",
  "no_show": "abwesend",
  "not_voted": "abwesend",
};

interface AwPoll {
  id: number;
  label: string;
  field_poll_date: string;
  field_accepted: boolean | null;
  abgeordnetenwatch_url: string;
  field_intro?: string;
  field_related_links?: { uri: string; title: string }[];
  field_committees?: { abgeordnetenwatch_url?: string }[] | null;
}

interface AwVote {
  id: number;
  vote: string;
  mandate: { id: number; label: string };
  fraction?: { id: number; label: string } | null;
  reason_no_show?: string | null;
}

let lastRequestAt = 0;
async function rateLimitedFetch(url: string): Promise<unknown> {
  const wait = Math.max(0, lastRequestAt + REQUEST_DELAY_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  const res = await fetch(url, {
    headers: { "User-Agent": "mandatsfeed/0.1 (Forschungsprojekt)", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchAllPolls(periodId: number): Promise<AwPoll[]> {
  // Pagination: API hat range_end=Default 10, max 100.
  const polls: AwPoll[] = [];
  let start = 0;
  while (true) {
    const url = `https://www.abgeordnetenwatch.de/api/v2/polls?field_legislature=${periodId}&range_start=${start}&range_end=${start + 100}`;
    const r = (await rateLimitedFetch(url)) as { data: AwPoll[]; meta: { result: { total: number } } };
    polls.push(...r.data);
    const total = r.meta.result.total;
    if (polls.length >= total) break;
    start += 100;
  }
  return polls;
}

async function fetchAllVotes(pollId: number): Promise<AwVote[]> {
  const votes: AwVote[] = [];
  let start = 0;
  while (true) {
    const url = `https://www.abgeordnetenwatch.de/api/v2/votes?poll=${pollId}&range_start=${start}&range_end=${start + 200}`;
    const r = (await rateLimitedFetch(url)) as { data: AwVote[]; meta: { result: { total: number } } };
    votes.push(...r.data);
    const total = r.meta.result.total;
    if (votes.length >= total) break;
    start += 200;
  }
  return votes;
}

function slugifyPerson(nachname: string, vorname: string): string {
  return (`${vorname} ${nachname}`)
    .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// "Tim Zimmermann (Brandenburg 2024 - 2029)" → ["Tim","Zimmermann"]
function splitMandateLabel(label: string): { vorname: string; nachname: string } | null {
  const namePart = label.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const parts = namePart.split(/\s+/);
  if (parts.length < 2) return null;
  const nachname = parts.slice(-1)[0]!;
  const adlig = parts.length >= 3 && /^(von|zu|de|van)$/i.test(parts[parts.length - 2]!)
    ? parts[parts.length - 2] + " "
    : "";
  const trueNachname = adlig + nachname;
  const vorname = parts.slice(0, parts.length - (adlig ? 2 : 1)).join(" ");
  return { vorname, nachname: trueNachname };
}

// "AfD (Brandenburg 2024 - 2029)" → "AfD"
function stripFractionContext(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function buildActivity(slug: string, periodId: number, wp: number, poll: AwPoll, votes: AwVote[]): Activity | null {
  if (votes.length === 0) return null;
  const fraktionMap = FRAKTION_SLUGS[slug] ?? {};
  const persons: ActivityPerson[] = [];
  const fraktionenSet = new Set<string>();
  let ja = 0, nein = 0, enthalten = 0, abwesend = 0;
  for (const v of votes) {
    const name = splitMandateLabel(v.mandate.label);
    if (!name) continue;
    const fractionLabel = v.fraction?.label ? stripFractionContext(v.fraction.label) : "fraktionslos";
    const fractionSlug = fraktionMap[fractionLabel] ?? "fraktionslos";
    fraktionenSet.add(fractionSlug);
    const mapped = VOTE_MAP[v.vote] ?? "abwesend";
    if (mapped === "ja") ja++;
    else if (mapped === "nein") nein++;
    else if (mapped === "enthalten") enthalten++;
    else abwesend++;
    persons.push({
      slug: slugifyPerson(name.nachname, name.vorname),
      name: `${name.vorname} ${name.nachname}`,
      name_padoka: `${name.nachname}, ${name.vorname}`,
      role: "abstimmend",
      fraktion: fractionLabel,
      vote: mapped,
    });
  }
  const stimmberechtigt = persons.length;
  const result: VoteResult["result"] =
    poll.field_accepted === true ? "annahme" :
    poll.field_accepted === false ? "ablehnung" :
    (ja > nein ? "annahme" : nein > ja ? "ablehnung" : "sonstig");

  const a: Activity = {
    id: `aw-abst-${slug}-${poll.id}`,
    source: "abgeordnetenwatch",
    parliament: slug,
    wp,
    type: "abstimmung",
    title: poll.label,
    date: poll.field_poll_date,
    persons,
    fraktionen: Array.from(fraktionenSet),
    vote: { result, ja, nein, enthalten, abwesend, stimmberechtigt },
    document: { url: poll.abgeordnetenwatch_url },
  };
  return a;
}

function filenameFor(a: Activity): string {
  return `${a.date}-abstimmung-aw-${a.id.replace(`aw-abst-${a.parliament}-`, "")}.json`;
}

function writeIfMissing(parliamentDir: string, a: Activity): "written" | "skipped" {
  const dir = join(parliamentDir, `wp-${a.wp}`, "aktivitaet", a.date);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filenameFor(a));
  if (existsSync(path)) return "skipped";
  writeFileSync(path, JSON.stringify(a, null, 2) + "\n");
  return "written";
}

async function main(): Promise<void> {
  if (!PARLIAMENT_SLUG) {
    console.error("PARLIAMENT=<slug> setzen, z.B. PARLIAMENT=brandenburg");
    process.exit(1);
  }
  const cfg = PERIOD_BY_PARLIAMENT[PARLIAMENT_SLUG];
  if (!cfg) {
    console.error(`Unbekanntes Parlament: ${PARLIAMENT_SLUG}. Bekannt: ${Object.keys(PERIOD_BY_PARLIAMENT).join(", ")}`);
    process.exit(1);
  }
  const parliamentDir = resolve(import.meta.dirname, "../wiki", PARLIAMENT_SLUG);

  console.log(`[aw-abst] ${PARLIAMENT_SLUG} wp-${cfg.wp} (period=${cfg.periodId}), Zeitraum ${MIN_DATE} … ${MAX_DATE}`);
  const allPolls = await fetchAllPolls(cfg.periodId);
  const inRange = allPolls.filter((p) => p.field_poll_date >= MIN_DATE && p.field_poll_date <= MAX_DATE);
  console.log(`[aw-abst] ${allPolls.length} Polls gelistet, ${inRange.length} im Zeitraum`);

  let written = 0, skipped = 0;
  for (const poll of inRange) {
    const votes = await fetchAllVotes(poll.id);
    const a = buildActivity(PARLIAMENT_SLUG, cfg.periodId, cfg.wp, poll, votes);
    if (!a) continue;
    if (writeIfMissing(parliamentDir, a) === "written") {
      written++;
      console.log(`  ${poll.field_poll_date} · ${votes.length} Stimmen · ${poll.label.slice(0, 70)}`);
    } else {
      skipped++;
    }
  }
  console.log(`[aw-abst] ${written} neu · ${skipped} vorhanden`);
}

main().catch((e) => { console.error(e); process.exit(1); });
