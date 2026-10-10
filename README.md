# Brookwood: The London Necropolis

An interactive visitor's guide to Brookwood Cemetery, near Woking, Surrey, styled as a Victorian letterpress guidebook. It covers the cemetery's history, the London Necropolis Railway, its faith, society and military grounds, and its notable graves and monuments.

Open `index.html` in a browser. It is a single self-contained page; only the typefaces load from Google Fonts.

## What is in it

- Ten chapters and two appendices of history, with shoulder-notes in the margin.
- **Plate I**, an interactive engraved plan of the cemetery: 45 numbered places, a key, four suggested walks, pan and zoom.
- **Plate II**, a register of 44 notable people buried or once buried at Brookwood, searchable and filterable, each with a memorial card giving the grave, plot, sources and an evidence grade.
- A catalogue of monuments, mausolea, buildings and grounds.
- The Necropolis Railway's three classes of coffin ticket, and an animated journey from Westminster Bridge Road.
- A key to Victorian funerary emblems, and a chronology.

## Sources and accuracy

The content was compiled in October 2026 from published sources: Historic England, the Brookwood Cemetery Society, the cemetery's own site, John M. Clarke's histories, the Surrey History Centre, the CWGC and the ABMC, among others. Every person and place carries its own source links and an evidence grade. Where sources disagree, both readings are given.

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
| `src/data/*.json` | People, places, chronology, walks and estimated geography |

Run `python3 build.py`. It writes `index.html`, the standalone page, and `build/artifact.html`, the same page without a document skeleton, for embedding.
