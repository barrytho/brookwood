# Type and ornaments from Font Revival

The guide's display types, initials, rules, corner pieces, pointing hand and printers' cuts come from [Font Revival](https://font-revival.com/), which revives nineteenth-century American type-foundry specimens as MIT-licensed fonts and vector cuts. `fontrevival.py` takes what the guide uses from a checkout of [its repository](https://github.com/fontrevival/font-revival) and writes it into `src/`.

```
python3 -m venv .venv && .venv/bin/pip install -r tools/fonts/requirements.txt
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 https://github.com/fontrevival/font-revival ../font-revival
.venv/bin/python tools/fonts/fontrevival.py ../font-revival
```

The full repository is very large. To save space, a sparse checkout of `icons.json`, `LICENSE` and the `web/` folders of the collections named in the script is enough.

| Output | Contents |
|---|---|
| `src/fonts/Doric1889-Regular.woff2` | Headings. Boston Type Foundry, 1889. Given ä, ë, ö and ü, composed from its own letters and full stops |
| `src/fonts/ModernAntique1889-Regular.woff2` | Labels, tabs and buttons. Boston Type Foundry, 1889. Given the same four letters |
| `src/fonts/BaltimoreBold1832-Regular.woff2` | The title. Baltimore Type Foundry, 1832 |
| `src/fonts/BaltimoreTitle1832-Regular.woff2` | Spaced capitals. Baltimore Type Foundry, 1832 |
| `src/fonts/BrookwoodInitials.woff2` | The leafy blackletter initials (series 17) from the Boston Initials 1889 collection, keyed to A–Z so that a drop cap is the paragraph's real first letter |
| `src/ornaments-revival.svg` | Symbols for the corner piece, the chapter rule, the fleuron and the pointing hand, cropped to the ink |
| `src/img/cuts/mourner.svg`, `finis.svg` | Printers' cuts from the Boston Type and Stereotype Foundry and Baltimore Type Foundry specimens of 1832, in plate ink |
| `src/fonts/LICENSE-font-revival.txt` | Font Revival's MIT licence, which must accompany the files |

The script names the source of every item, by Font Revival's own identifiers, at the top of the file. The faces cover Basic Latin with curly quotes and dashes. A character they lack, such as £, falls back to Old Standard TT, the text face.
