"""Take the typefaces and ornaments the guide uses from a checkout of Font Revival and write them into src/.

Font Revival (https://font-revival.com/, https://github.com/fontrevival/font-revival) revives nineteenth-century
American type-foundry specimens as MIT-licensed fonts and vector cuts.

    python3 tools/fonts/fontrevival.py PATH-TO-FONT-REVIVAL-CHECKOUT

Writes:
  src/fonts/<Face>-Regular.woff2      the display faces, as published; the two with a lowercase gain a, e, o and u
                                      with a dieresis, built from their own letters and full stops
  src/fonts/BrookwoodInitials.woff2   the Boston 1889 leafy blackletter initials (series 17), mapped to A-Z so the
                                      first letter of a paragraph can be set in them with ::first-letter
  src/ornaments-revival.svg           <symbol>s for the corner, rules, fleuron and pointing hand, cropped to the ink
  src/img/cuts/<name>.svg             pictorial cuts, drawn in plate ink, shown as <img>
  src/fonts/LICENSE-font-revival.txt  Font Revival's MIT licence, which must travel with the files
"""
import json
import pathlib
import re
import shutil
import sys

from fontTools import subset
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "src"

FACES = {                                   # file stem: collection folder
    "Doric1889": "doric-1889",              # headings
    "ModernAntique1889": "modern-antique-1889",  # labels, tabs, buttons
    "BaltimoreTitle1832": "baltimore-title-1832",  # spaced capitals
    "BaltimoreBold1832": "baltimore-bold-1832",    # the title
}
DIERESIS = {"ä": "a", "ë": "e", "ö": "o", "ü": "u"}

INITIALS = "boston-1889-p237-series17-{}"   # Leafy blackletter initial A-Z

SYMBOLS = {                                 # symbol id: Font Revival icon id
    "fr-corner": "boston-1889-p269-corner-109-left",   # title-page corners
    "fr-dash": "boston-1889-p270-dash-56",             # rule under chapter titles
    "fr-fleuron": "boston-1889-p270-dash-75",          # memorial cards, title page
    "fr-hand": "boston-1889-p271-4006",                # pointing hand: "Turn to", "Particulars"
}
CUTS = {                                    # file name: Font Revival icon id
    "mourner": "boston-1832-p365-552",
    "finis": "baltimore-1832-p129-83",
}
PLATE_INK = "#1d1c18"


def add_dieresis(font):
    """Compose lowercase letters with a dieresis from the face's own letter and two scaled full stops."""
    go = font.getGlyphOrder()
    if not all(g in go for g in ("period", *DIERESIS.values())):
        return
    gs = font.getGlyphSet()
    dot = BoundsPen(gs)
    gs["period"].draw(dot)
    dx0, dy0, dx1, dy1 = dot.bounds
    x_height = font["OS/2"].sxHeight or 480
    scale = 0.9
    size = (dx1 - dx0) * scale
    cmap_add = {}
    for char, base in DIERESIS.items():
        name = base + "dieresis"
        if name in go:
            continue
        b = BoundsPen(gs)
        gs[base].draw(b)
        bx0, _, bx1, _ = b.bounds
        mid, gap = (bx0 + bx1) / 2, size * 0.9
        pen = TTGlyphPen(gs)
        gs[base].draw(pen)
        for cx in (mid - gap / 2 - size / 2, mid + gap / 2 + size / 2):
            tx = cx - (dx0 + (dx1 - dx0) / 2) * scale
            ty = x_height + size * 0.8 - dy0 * scale
            gs["period"].draw(TransformPen(pen, (scale, 0, 0, scale, tx, ty)))
        font["glyf"][name] = pen.glyph()           # also appends the name to the glyph order
        font["hmtx"][name] = font["hmtx"][base]
        cmap_add[ord(char)] = name
    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap.update(cmap_add)


def copy_faces(fr):
    out = SRC / "fonts"
    out.mkdir(exist_ok=True)
    for stem, folder in FACES.items():
        font = TTFont(fr / "collection" / folder / "web" / f"{stem}-Regular.woff2", recalcTimestamp=False)
        add_dieresis(font)
        font.flavor = "woff2"
        font.save(out / f"{stem}-Regular.woff2")
    shutil.copyfile(fr / "LICENSE", out / "LICENSE-font-revival.txt")


def build_initials(fr, icons):
    """Subset the initials font to one alphabet and map it to A-Z (and a-z), so real text stays real text."""
    path = fr / "collection" / "boston-initials-1889" / "web" / "BostonInitials1889-Regular.woff2"
    font = TTFont(path, recalcTimestamp=False)
    cmap = font.getBestCmap()
    letters = {}
    for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        icon = icons[INITIALS.format(letter.lower())]
        letters[letter] = cmap[int(icon["codepoint"], 16)]
    opts = subset.Options()
    opts.glyph_names = True
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6]
    opts.notdef_outline = True
    sub = subset.Subsetter(opts)
    sub.populate(glyphs=list(letters.values()))
    sub.subset(font)
    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap = {}
            for letter, glyph in letters.items():
                table.cmap[ord(letter)] = glyph
                table.cmap[ord(letter.lower())] = glyph
    name = font["name"]
    for rec in list(name.names):
        if rec.nameID in (1, 3, 4, 6, 16, 17):
            name.removeNames(nameID=rec.nameID)
    name.setName("Brookwood Initials", 1, 3, 1, 0x409)
    name.setName("Brookwood Initials Regular", 4, 3, 1, 0x409)
    name.setName("BrookwoodInitials-Regular;derived from Boston Initials 1889", 3, 3, 1, 0x409)
    name.setName("BrookwoodInitials-Regular", 6, 3, 1, 0x409)
    font.flavor = "woff2"
    font.save(SRC / "fonts" / "BrookwoodInitials.woff2")


def icon_path(fr, icon, cache={}):
    """The mono master of a cut: its SVG path (font units, y up) and the ink bounds."""
    sprite = icon["sprite"].split("#")[0]
    if sprite not in cache:
        cache[sprite] = (fr / sprite).read_text(encoding="utf-8")
    m = re.search(r'<symbol id="%s" viewBox="[^"]+">(.*?)</symbol>' % re.escape(icon["id"]), cache[sprite], re.S)
    paths = re.findall(r'<path[^>]*\sd="([^"]+)"', m.group(1))
    pen = BoundsPen(None)
    for d in paths:
        parse_path(d, pen)
    return paths, pen.bounds


def view_box(bounds, pad):
    x0, y0, x1, y1 = bounds
    return f"{x0 - pad:.0f} {-y1 - pad:.0f} {x1 - x0 + 2 * pad:.0f} {y1 - y0 + 2 * pad:.0f}"


def write_symbols(fr, icons):
    out = ['<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" '
           'style="position:absolute;width:0;height:0;overflow:hidden">',
           "<!-- Cuts from Font Revival (MIT), after nineteenth-century type-foundry specimens; "
           "made by tools/fonts/fontrevival.py -->"]
    for sid, iid in SYMBOLS.items():
        paths, bounds = icon_path(fr, icons[iid])
        d = " ".join(paths)
        out.append(f'<symbol id="{sid}" viewBox="{view_box(bounds, 8)}"><path fill="currentColor" '
                   f'transform="scale(1,-1)" d="{d}"/></symbol>')
    out.append("</svg>")
    (SRC / "ornaments-revival.svg").write_text("\n".join(out) + "\n", encoding="utf-8")


def write_cuts(fr, icons):
    out = SRC / "img" / "cuts"
    out.mkdir(parents=True, exist_ok=True)
    for name, iid in CUTS.items():
        paths, bounds = icon_path(fr, icons[iid])
        vb = view_box(bounds, 12)
        w, h = (round(float(v)) for v in vb.split()[2:])
        body = "".join(f'<path d="{d}"/>' for d in paths)
        (out / f"{name}.svg").write_text(
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{w}" height="{h}">'
            f'<g fill="{PLATE_INK}" transform="scale(1,-1)">{body}</g></svg>\n', encoding="utf-8")
        print(f"cut {name}: {w}x{h}, {(out / f'{name}.svg').stat().st_size // 1024} KB")


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    fr = pathlib.Path(sys.argv[1]).resolve()
    icons = {i["id"]: i for i in json.loads((fr / "icons.json").read_text(encoding="utf-8"))["icons"]}
    copy_faces(fr)
    build_initials(fr, icons)
    write_symbols(fr, icons)
    write_cuts(fr, icons)
    for p in sorted((SRC / "fonts").iterdir()):
        print(f"{p.name}: {p.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
