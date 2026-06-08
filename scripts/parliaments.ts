import type { ParliamentConfig } from "./types.ts";

export const PARLIAMENTS: ParliamentConfig[] = [
  {
    slug: "bundestag",
    label: "Deutscher Bundestag",
    source: "dip",
    homepage: "https://dip.bundestag.de/",
    fraktionLabels: {
      "cdu-csu": "CDU/CSU",
      "spd": "SPD",
      "afd": "AfD",
      "bundnis-90-die-gruenen": "BÜNDNIS 90/DIE GRÜNEN",
      "die-linke": "Die Linke",
      "bsw": "BSW",
      "fdp": "FDP",
      "fraktionslos": "Fraktionslose Abgeordnete",
      "bundesregierung": "Bundesregierung",
    },
    sourceNotice:
      "Aufbereitung durch mandatsfeed. Die Daten stehen in DIP unter dip.bundestag.de kostenfrei zur Verfügung. Quelle: Deutscher Bundestag/Bundesrat – DIP. Ohne Gewähr für Richtigkeit.",
    published: true,
  },
  {
    slug: "sachsen-anhalt",
    label: "Landtag Sachsen-Anhalt",
    source: "padoka",
    homepage: "https://padoka.landtag.sachsen-anhalt.de/",
    fraktionLabels: {
      "cdu": "CDU",
      "afd": "AfD",
      "die-linke": "Die Linke",
      "spd": "SPD",
      "fdp": "FDP",
      "bundnis-90-die-gruenen": "BÜNDNIS 90/DIE GRÜNEN",
      "fraktionslos": "Fraktionslose Abgeordnete",
      "landesregierung": "Landesregierung",
    },
    sourceNotice:
      "Aufbereitung durch mandatsfeed. Quelle: Landtag Sachsen-Anhalt – PADOKA (padoka.landtag.sachsen-anhalt.de). Ohne Gewähr für Richtigkeit.",
    published: false, // robots.txt: Disallow / — Forschungsphase
  },
  {
    slug: "sachsen",
    label: "Sächsischer Landtag",
    source: "edas",
    homepage: "https://redas.landtag.sachsen.de/redas/",
    fraktionLabels: {
      "cdu": "CDU",
      "afd": "AfD",
      "bsw": "BSW",
      "spd": "SPD",
      "die-linke": "Die Linke",
      "bundnisgruene": "BÜNDNISGRÜNE",
      "fdp": "FDP",
      "fraktionslos": "Fraktionslose Abgeordnete",
      "landesregierung": "Staatsregierung",
    },
    sourceNotice:
      "Aufbereitung durch mandatsfeed. Quelle: Sächsischer Landtag – EDAS (redas.landtag.sachsen.de). Ohne Gewähr für Richtigkeit.",
    published: true,
  },
  {
    slug: "brandenburg",
    label: "Landtag Brandenburg",
    source: "starweb",
    homepage: "https://www.parlamentsdokumentation.brandenburg.de/",
    fraktionLabels: {
      "spd": "SPD",
      "bsw": "BSW",
      "cdu": "CDU",
      "afd": "AfD",
      "die-linke": "Die Linke",
      "bundnis-90-die-gruenen": "BÜNDNIS 90/DIE GRÜNEN",
      "fraktionslos": "Fraktionslose Abgeordnete",
      "landesregierung": "Landesregierung",
    },
    sourceNotice:
      "Aufbereitung durch mandatsfeed. Quelle: Landtag Brandenburg – Parlamentsdokumentation (www.parlamentsdokumentation.brandenburg.de). Ohne Gewähr für Richtigkeit.",
    published: false, // robots.txt: Disallow / — Forschungsphase
  },
  {
    slug: "mecklenburg-vorpommern",
    label: "Landtag Mecklenburg-Vorpommern",
    source: "parldok",
    homepage: "https://www.dokumentation.landtag-mv.de/parldok",
    fraktionLabels: {
      "spd": "SPD",
      "afd": "AfD",
      "cdu": "CDU",
      "die-linke": "Die Linke",
      "fdp": "FDP",
      "bundnis-90-die-gruenen": "BÜNDNIS 90/DIE GRÜNEN",
      "freie-waehler": "FREIE WÄHLER",
      "fraktionslos": "Fraktionslose Abgeordnete",
      "landesregierung": "Landesregierung",
    },
    sourceNotice:
      "Aufbereitung durch mandatsfeed. Quelle: Landtag Mecklenburg-Vorpommern – Parlamentsdatenbank (dokumentation.landtag-mv.de). Ohne Gewähr für Richtigkeit.",
    published: true,
  },
  {
    slug: "thueringen",
    label: "Thüringer Landtag",
    source: "parldok",
    homepage: "https://parldok.thueringer-landtag.de/parldok/",
    fraktionLabels: {
      "cdu": "CDU",
      "afd": "AfD",
      "bsw": "BSW",
      "die-linke": "Die Linke",
      "spd": "SPD",
      "fraktionslos": "Fraktionslose Abgeordnete",
      "landesregierung": "Landesregierung",
    },
    sourceNotice:
      "Aufbereitung durch mandatsfeed. Quelle: Thüringer Landtag – Parlamentsdatenbank (parldok.thueringer-landtag.de). Ohne Gewähr für Richtigkeit.",
    published: true,
  },
  {
    slug: "hessen",
    label: "Hessischer Landtag",
    source: "starweb",
    homepage: "https://starweb.hessen.de/",
    fraktionLabels: {
      "cdu": "CDU",
      "spd": "SPD",
      "afd": "AfD",
      "bundnis-90-die-gruenen": "BÜNDNIS 90/DIE GRÜNEN",
      "fdp": "FDP",
      "die-linke": "Die Linke",
      "fraktionslos": "Fraktionslose Abgeordnete",
      "landesregierung": "Landesregierung",
    },
    sourceNotice:
      "Aufbereitung durch mandatsfeed. Quelle: Hessischer Landtag – Landtagsinformationssystem (starweb.hessen.de). Ohne Gewähr für Richtigkeit.",
    published: true,
  },
  {
    slug: "berlin",
    label: "Abgeordnetenhaus Berlin",
    source: "starweb",
    homepage: "https://pardok.parlament-berlin.de/",
    fraktionLabels: {
      "spd": "SPD",
      "cdu": "CDU",
      "afd": "AfD",
      "die-linke": "Die Linke",
      "bundnis-90-die-gruenen": "BÜNDNIS 90/DIE GRÜNEN",
      "fdp": "FDP",
      "fraktionslos": "Fraktionslose Abgeordnete",
      "landesregierung": "Senat",
    },
    sourceNotice:
      "Aufbereitung durch mandatsfeed. Quelle: Abgeordnetenhaus Berlin – Parlamentsdokumentation (pardok.parlament-berlin.de). Ohne Gewähr für Richtigkeit.",
    published: true,
  },
];

export const TYPE_LABELS: Record<string, string> = {
  kleine_anfrage: "Kleine Anfrage",
  grosse_anfrage: "Große Anfrage",
  antrag: "Antrag",
  gesetzentwurf: "Gesetzentwurf",
  beschlussempfehlung: "Beschlussempfehlung",
  rede: "Rede",
  abstimmung: "Abstimmung",
};
