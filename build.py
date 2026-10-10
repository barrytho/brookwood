#!/usr/bin/env python3
"""Assemble the Brookwood guide into a single self-contained page.

Inputs (all under src/):
  page.html       the shell: <title>, fonts, CSS, title page, dialog, script slots
  chapters.html   the chapters; each <section class="chapter"> carries data-toc-* attributes
  ornaments.svg   the inline SVG sprite of ornaments and emblems
  plan.js         the interactive plan of the cemetery (window.BrookwoodPlan)
  main.js         page behaviour; contains the /*__DATA__*/ slot
  data/*.json     people, places, timeline, walks, geo

Outputs:
  index.html           a complete standalone document (GitHub Pages or local viewing)
  build/artifact.html  the same page without the document skeleton, for a claude.ai Artifact
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"


def read(name, default=None):
    path = SRC / name
    if path.exists():
        return path.read_text(encoding="utf-8")
    if default is None:
        raise SystemExit(f"missing src/{name}")
    return default


def load_data():
    data = {}
    for name in ("people", "places", "timeline", "walks", "geo"):
        path = SRC / "data" / f"{name}.json"
        data[name] = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    return data


def build_toc(chapters):
    """One contents line per chapter, from its data-toc-* attributes."""
    items = []
    for m in re.finditer(r"<section\b([^>]*)>", chapters):
        attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(1)))
        if "data-toc-title" not in attrs:
            continue
        cls = ' class="toc-sub"' if attrs.get("data-toc-break") else ""
        items.append(
            f'<li{cls}><a href="#{attrs["id"]}">'
            f'<span class="toc-num">{attrs.get("data-toc-num", "")}</span>'
            f'<span class="toc-title">{attrs["data-toc-title"]}</span>'
            f'<span class="toc-leader" aria-hidden="true"></span>'
            f'<span class="toc-note">{attrs.get("data-toc-note", "")}</span></a></li>'
        )
    return "\n    ".join(items)


def main():
    page = read("page.html")
    chapters = read("chapters.html", "")
    data_js = json.dumps(load_data(), ensure_ascii=False, separators=(",", ":"))
    # Stop a stray "</script>" inside the data from closing the inline script early.
    data_js = data_js.replace("</", "<\\/")
    main_js = read("main.js", "")
    if main_js and "/*__DATA__*/null" not in main_js:
        raise SystemExit("slot /*__DATA__*/null missing from src/main.js")

    slots = {
        "<!--__ORNAMENTS__-->": read("ornaments.svg", ""),
        "<!--__TOC__-->": build_toc(chapters),
        "<!--__CHAPTERS__-->": chapters,
        "/*__PLAN_JS__*/": read("plan.js", ""),
        "/*__MAIN_JS__*/": main_js.replace("/*__DATA__*/null", data_js),
    }
    for slot, value in slots.items():
        if slot not in page:
            raise SystemExit(f"slot {slot!r} missing from src/page.html")
        page = page.replace(slot, value)

    (ROOT / "build").mkdir(exist_ok=True)
    (ROOT / "build" / "artifact.html").write_text(page, encoding="utf-8")

    standalone = (
        "<!doctype html>\n<html lang=\"en-GB\">\n<head>\n"
        "<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        "<style>[hidden]{display:none!important}img{max-width:100%}body{margin:0}</style>\n"
        "</head>\n<body>\n" + page + "\n</body>\n</html>\n"
    )
    (ROOT / "index.html").write_text(standalone, encoding="utf-8")
    print(f"index.html {len(standalone):,} bytes; build/artifact.html {len(page):,} bytes")


if __name__ == "__main__":
    main()
