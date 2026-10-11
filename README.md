# Brookwood: The London Necropolis

An interactive visitor's guide to Brookwood Cemetery, near Woking, Surrey, styled as a Victorian letterpress guidebook. It covers the cemetery's history, the London Necropolis Railway, its faith, society and military grounds, and its notable graves and monuments.

Visit the published site, or preview it locally over HTTP: run `python3 -m http.server` in the repository and open http://localhost:8000/. Opening `index.html` straight from disk shows everything except the engravings, because browsers will not load CSS mask images from `file://` pages. The typefaces load from Google Fonts and the illustrations from `src/img/`.

## What is in it

- Nine thumb-index tabs holding ten chapters and two appendices, with shoulder-notes in the margin.
- Fifteen plates: photographs and prints from Wikimedia Commons redrawn as Victorian engravings and watercolours (`tools/illustrate/`), each credited in its caption.
- **Plate I**, an interactive engraved plan of the cemetery: 45 numbered places, a key, four suggested walks, pan and zoom.
- **Plate II**, a register of 44 notable people buried or once buried at Brookwood, searchable and filterable, each with a memorial card giving the grave, plot, sources and an evidence grade.
- A catalogue of monuments, mausolea, buildings and grounds.
- The Necropolis Railway's three classes of coffin ticket, and an animated journey from Westminster Bridge Road.
- A key to Victorian funerary emblems, and a chronology.

## Sources and accuracy

The content was compiled in October 2026 from published sources: Historic England (read through British Listed Buildings), the Brookwood Cemetery Society, the cemetery's own site, John M. Clarke's histories, the Surrey History Centre, the ABMC and Wikipedia, among others. Every person, place, date and sentence of chapter text was then checked against the full text of those sources and corrected where they differed. [`docs/fact-check.md`](docs/fact-check.md) records each check, what changed and the passage relied on. Every person and place in the guide carries its own source links and an evidence grade, and where sources disagree, both readings are given.

The 19 listed monuments on the plan are placed from their Historic England grid references. The boundary, roads, railway and other positions are estimates, and the plan says so.

## Building

The page is assembled from `src/`:

| File | Contents |
|---|---|
| `src/page.html` | Title page, CSS design tokens, dialog, script slots |
| `src/chapters.html` | Chapter prose; each section's `data-toc-*` attributes build the contents page |
| `src/main.js` | Register, memorial cards, catalogue, chronology, railway tickets and journey |
| `src/plan.js` | The interactive plan (`window.BrookwoodPlan`) |
| `src/ornaments.svg` | Engraved ornaments, emblems, vignette, locomotive and compass |
| `src/data/*.json` | People, places, chronology, walks, estimated geography and illustration credits |
| `src/img/*.webp` | The rendered plates |

Run `python3 build.py`. It writes `index.html`, the page itself, and `build/artifact.html`, the same page without a document skeleton, for embedding. Both refer to the illustrations in `src/img/`.
