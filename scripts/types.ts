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
}

export interface ParliamentConfig {
  slug: string;
  label: string;
  source: Activity["source"];
  homepage: string;
  fraktionLabels: Record<string, string>;
  sourceNotice: string;
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
