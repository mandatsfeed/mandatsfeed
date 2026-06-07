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
