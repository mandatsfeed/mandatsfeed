# Thüringer Landtag

**Quellsystem:** [Parlamentsdatenbank Thüringen](https://parldok.thueringer-landtag.de/parldok/) (Parldok von J3S GmbH, Version 8.3.6 — selbe Engine wie Mecklenburg-Vorpommern)

**robots.txt:** `https://parldok.thueringer-landtag.de/robots.txt` liefert 404 (keine robots.txt vorhanden, damit keine Einschränkung). Das Page-Meta `<meta name="robots" content="index, nofollow">` erlaubt Indexierung. `mandatsfeed/0.1 (Forschungsprojekt)` als User-Agent.

**Wahlperiode 8:** seit 26.09.2024 (Landtagswahl Thüringen 2024). Fünf Fraktionen: AfD (32 Sitze), CDU (23), BSW (15), Die Linke (12), SPD (6) — Stand Konstituierung. Regierungsbildung: Brombeer-Koalition (CDU, BSW, SPD).

**URL-Pattern für Drucksachen-Liste:**

```
https://parldok.thueringer-landtag.de/parldok/neu/
  10_1_8___8.%20Wahlperiode%20(ab%2026.09.2024)/
  7_1_1___Dokumentart%3A%20Drucksache
```

Parldok ist JS-getrieben. Pagination per `window.pd.resultpage(N)`, Pagesize per Dropdown (10/25/50/100). Max-Hits 1000 pro Suche, daher bei Bedarf nach Drucksachenart oder Zeitraum aufteilen.

**Meta-String-Format pro Drucksache** (`li.docrow > p`, `<br>` als Separator):

```
8/3556 Dringlichkeitsanfrage und ihre Beantwortung vom 29.05.2026 | Ministerium für Inneres, Kommunales und Landesentwicklung (8. Wp)
8/3548 Dringlichkeitsanfrage vom 28.05.2026 | Ulrike Große-Röthig (Die Linke)
```

Antworten der Ministerien laufen als „… und ihre Beantwortung" (kein extra Antwort-Eintrag); MdL-Anfragen ohne Antwort als „Dringlichkeitsanfrage" pur.

**Implementiert:** Drucksachen (Anträge, Kleine/Große Anfragen, Gesetzentwürfe, Entschließungs-/Änderungs-/Alternativanträge). Reden + Abstimmungen offen.
