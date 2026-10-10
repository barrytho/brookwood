# Illustration renderer

Turns a photograph or print into a Victorian-style line engraving or watercolour for the guide.

```
python3 -m venv .venv && .venv/bin/pip install -r tools/illustrate/requirements.txt
.venv/bin/python tools/illustrate/stylise.py engraving  in.jpg src/img/name.webp --width 1000
.venv/bin/python tools/illustrate/stylise.py watercolour in.jpg src/img/name.webp --width 1000
```

- **Engraving:** a WebP whose alpha channel is the ink. The page fills it with its ink colour through a CSS mask, so it works in both themes.
- **Watercolour:** an RGBA WebP of washes on paper with a ragged vignette edge. The page shows it on a paper mount.

Credit and licence details for each image go in `src/data/illustrations.json`. Renderings of CC BY-SA photographs are derivative works and carry the same licence.
