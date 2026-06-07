import type { ParliamentConfig } from "./types.ts";

export const PARLIAMENTS: ParliamentConfig[] = [
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
