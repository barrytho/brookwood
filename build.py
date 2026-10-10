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
import base64
import html
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


def load_figures():
    """Illustrations: one CSS custom property per image (so a picture can appear in a chapter and a card
    without being embedded twice) and the <figure> markup for each <!--FIG:id--> slot."""
    path = SRC / "data" / "illustrations.json"
    if not path.exists():
        return "", {}, []
    figs = json.loads(path.read_text(encoding="utf-8"))
    css, markup, meta = [], {}, []
    for f in figs:
        img = SRC / "img" / f"{f['id']}.webp"
        if not img.exists():
            continue
        b64 = base64.b64encode(img.read_bytes()).decode("ascii")
        css.append(f'.im-{f["id"]}{{--img:url("data:image/webp;base64,{b64}");aspect-ratio:{f["w"]}/{f["h"]}}}')
        credit = (
            f'After {html.escape(f["after"])} by {html.escape(f["author"])}, '
            f'<a href="{html.escape(f["source_url"])}" target="_blank" rel="noopener">Wikimedia Commons</a>, '
            + (f'<a href="{html.escape(f["licence_url"])}" target="_blank" rel="noopener">{html.escape(f["licence"])}</a>'
               if f.get("licence_url") else html.escape(f["licence"]))
            + "."
        )
        style = "engraving" if f["style"] == "engraving" else "watercolour"
        markup[f["id"]] = (
            f'<figure class="fig fig-{style} fig-{f.get("size", "wide")}" data-fig="{f["id"]}">'
            f'<div class="fig-mount"><div class="im im-{f["id"]}" role="img" aria-label="{html.escape(f["alt"])}"></div></div>'
            f'<figcaption><span class="fig-cap">{html.escape(f["caption"])}</span> '
            f'<span class="fig-credit">{credit}</span></figcaption></figure>'
        )
        meta.append({k: f[k] for k in ("id", "style", "alt", "caption", "after", "author", "licence", "licence_url", "source_url") if k in f}
                    | {"for": f.get("for", [])})
    return "<style>" + "".join(css) + "</style>", markup, meta


def tab_panels(page):
    """Panels in page order, from each <div class="tabpanel"> and its data-tab-* attributes."""
    panels = []
    for m in re.finditer(r'<div class="tabpanel"([^>]*)>', page):
        attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(1)))
        panels.append({k: attrs.get("data-tab-" + k, "") for k in ("label", "num", "title")} | {"key": attrs["data-tab"]})
    return panels


def build_tabs(panels):
    return "\n    ".join(
        f'<button class="thumb" type="button" role="tab" id="t-{p["key"]}" aria-controls="tab-{p["key"]}" '
        f'aria-selected="false" tabindex="-1" data-tab-btn="{p["key"]}">'
        f'<span class="th-num">{p["num"]}</span><span class="th-label">{p["label"]}</span></button>'
        for p in panels
    )


def build_pager(panels, i):
    prev_p = panels[i - 1] if i > 0 else None
    next_p = panels[i + 1] if i + 1 < len(panels) else None
    out = '<nav class="pager" aria-label="Turn the page">'
    out += (
        f'<a class="pg-prev" href="#{prev_p["key"]}" data-tab-link="{prev_p["key"]}">'
        f'<span class="pg-dir">‹ Previous</span><span class="pg-t">{prev_p["label"]}</span></a>'
        if prev_p else "<span></span>"
    )
    out += (
        f'<a class="pg-next" href="#{next_p["key"]}" data-tab-link="{next_p["key"]}">'
        f'<span class="pg-dir">Turn to <svg aria-hidden="true" viewBox="0 0 48 24"><use href="#orn-manicule"/></svg></span>'
        f'<span class="pg-t">{next_p["title"]}</span></a>'
        if next_p else "<span></span>"
    )
    return out + "</nav>"


def main():
    page = read("page.html")
    chapters = read("chapters.html", "")
    fig_css, fig_markup, fig_meta = load_figures()
    for fid, markup in fig_markup.items():
        chapters = chapters.replace(f"<!--FIG:{fid}-->", markup)
    chapters = re.sub(r"<!--FIG:[\w-]+-->", "", chapters)   # slots whose image is not rendered yet
    data = load_data()
    data["figures"] = fig_meta
    data_js = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    # Stop a stray "</script>" inside the data from closing the inline script early.
    data_js = data_js.replace("</", "<\\/")
    main_js = read("main.js", "")
    if main_js and "/*__DATA__*/null" not in main_js:
        raise SystemExit("slot /*__DATA__*/null missing from src/main.js")

    slots = {
        "<!--__ORNAMENTS__-->": read("ornaments.svg", ""),
        "<!--__FIGURE_CSS__-->": fig_css,
        "<!--__TOC__-->": build_toc(chapters),
        "<!--__CHAPTERS__-->": chapters,
        "/*__PLAN_JS__*/": read("plan.js", ""),
        "/*__MAIN_JS__*/": main_js.replace("/*__DATA__*/null", data_js),
    }
    for slot, value in slots.items():
        if slot not in page:
            raise SystemExit(f"slot {slot!r} missing from src/page.html")
        page = page.replace(slot, value)

    panels = tab_panels(page)
    page = page.replace("<!--__TABS__-->", build_tabs(panels))
    for i, panel in enumerate(panels):
        page = page.replace(f"<!--__PAGER__{panel['key']}-->", build_pager(panels, i))

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
