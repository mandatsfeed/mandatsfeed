export type ActivityType =
  | "kleine_anfrage"
  | "grosse_anfrage"
  | "antrag"
  | "gesetzentwurf"
  | "beschlussempfehlung"
  | "rede"
  | "abstimmung";

export interface ActivityPerson {
  slug: string;
  name: string;
  name_padoka?: string;
  role: "fragesteller" | "redner" | "urheber" | "abstimmend" | "antragsteller";
  fraktion: string;
  /** Nur für role=abstimmend bei type=abstimmung. */
  vote?: "ja" | "nein" | "enthalten" | "abwesend";
}

export interface PlenarProtokollRef {
  nr: string;
  date: string;
  page?: number;
}

export interface VoteResult {
  result: "annahme" | "ablehnung" | "sonstig";
  ja: number;
  nein: number;
  enthalten: number;
  abwesend: number;
  stimmberechtigt: number;
}

export interface ActivityDocument {
  url: string;
  filename?: string;
  filenameSuffix?: string;
  pages?: number;
}

export interface Activity {
  id: string;
  source: "padoka" | "dip" | "starweb" | "parldok" | "edas";
  parliament: string;
  wp: number;
  type: ActivityType;
  subtype?: string;
  title: string;
  date: string;
  drsNr?: string;
  visibility?: string;
  status?: string;
  document?: ActivityDocument;
  persons: ActivityPerson[];
  fraktionen: string[];
  urheber?: string;
  eingangLandesregierung?: string;
  note?: string;
  summary?: string;
  relatedTo?: string;
  plenarprotokoll?: PlenarProtokollRef;
  vote?: VoteResult;
}

export interface ParliamentConfig {
  slug: string;
  label: string;
  source: Activity["source"];
  homepage: string;
  fraktionLabels: Record<string, string>;
  sourceNotice: string;
  // Wenn `false`: Adapter lokal vorhanden, aber Daten werden NICHT im Repo
  // veroeffentlicht (z. B. Forschungsphase wegen robots.txt: Disallow /).
  // metadata.json laesst diese Parlamente aus, damit die fuer GitHub Pages
  // gebaute Public-Sicht konsistent bleibt.
  published: boolean;
}

export interface ExternalFeed {
  type: string;       // z. B. "bundestag-mediathek"
  label: string;      // UI-Label, z. B. "Videos im Plenum"
  url: string;        // Absolute Feed-URL (RSS / Atom)
}

export interface FeedEntry {
  kind: "person" | "fraktion";
  parliament: string;
  slug: string;
  label: string;
  fraktion?: string;
  count: number;
  updatedAt: string | null;
  rssUrl: string;
  externalFeeds?: ExternalFeed[];
}

export interface Metadata {
  generatedAt: string;
  parliaments: Array<{
    slug: string;
    label: string;
    homepage: string;
    personen: FeedEntry[];
    fraktionen: FeedEntry[];
  }>;
}
