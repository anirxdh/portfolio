#!/usr/bin/env python3
"""Generate a 1200x630 share image for every published article in content/articles/*.md.

Output: public/blog/og/<slug>.png (committed; the Netlify build never runs Python).
Re-run after adding or renaming articles: `python3 scripts/gen-og.py` (FORCE=1 to redo all).

The look (General Sans, palette, frame, glow, badge, avatar) comes from scripts/gen-brand.py, which
also draws the site-wide public/assets/og-image.png, so every share card is one visual system.
An image is rebuilt when its article, this script, gen-brand.py, or the project's logo is newer.
"""
import importlib.util
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "content" / "articles"
OUT = ROOT / "public" / "blog" / "og"
FORCE = os.environ.get("FORCE") == "1"

sys.dont_write_bytecode = True  # importing gen-brand.py should not leave scripts/__pycache__ behind
_spec = importlib.util.spec_from_file_location("brand", Path(__file__).with_name("gen-brand.py"))
brand = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(brand)

# Articles whose project has a mark in public/assets/logos/ (keyed by frontmatter `project`).
PROJECT_LOGOS = {
    "LARK": "lark",
    "Apartment 4B": "apartment4b",
    "Living Photos": "livingphotos",
    "FaceTime from Mars": "facetime",
    "TalkativePDF": "talkativepdf",
    "CIVS": "civs",
}


def frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---", text, re.S)
    data = {}
    if not m:
        return data
    for line in m.group(1).splitlines():
        if ":" not in line or line.startswith(" "):
            continue
        k, v = line.split(":", 1)
        v = v.strip().strip('"').strip("'")
        data[k.strip()] = v
    return data


def fit_title(c, title, max_w):
    """Two lines at 68 to 52 px when the title allows it, else three lines at 60 to 44 px."""
    for max_lines, sizes in ((2, range(68, 51, -2)), (3, range(60, 43, -2))):
        for size in sizes:
            fnt = brand.font("semibold", size)
            lines = brand.wrap(c, title, fnt, max_w)
            if len(lines) <= max_lines:
                return fnt, size, lines
    return fnt, size, lines


def render(data, out):
    accent = data.get("accent") or brand.DEFAULT_ACCENT
    c = brand.Canvas(accent=accent, glow=0.26)
    c.frame()
    x, max_w = 80, brand.W - 160

    # eyebrow: award badge (accent) + project name, as on the article page header
    y = 76
    ex = x
    award = data.get("award")
    if award:
        ex = c.badge((x, y), award, brand.font("semibold", 19), c.accent, height=40) + 18
    c.tracked((ex, y + 11), data.get("project", "").upper(), brand.font("medium", 16), brand.BODY, tracking=0.14)

    # title (heading gradient) + standfirst, centred in the band between the eyebrow and the footer
    fnt, size, lines = fit_title(c, data.get("title", ""), max_w)
    lead = round(size * 1.12)
    df = brand.font("regular", 24)
    desc = brand.wrap(c, data.get("description", ""), df, max_w)[:2]
    desc_lead, desc_gap = 35, 56  # standfirst line height; title baseline to first standfirst baseline
    # visible block: cap top of the first title line down to the last standfirst descender
    block = c.cap_height(fnt) + lead * (len(lines) - 1) + desc_gap + desc_lead * (len(desc) - 1) + 7
    fy = brand.H - 124
    top, bottom = 140, fy - 32
    baseline = top + max(0, (bottom - top - block) / 2) + c.cap_height(fnt)
    for line in lines:
        c.gradient_text((x - 2, baseline), line, fnt, anchor="ls")
        baseline += lead
    dy = baseline - lead + desc_gap
    for line in desc:
        c.text((x, dy), line, df, brand.BODY, anchor="ls")
        dy += desc_lead

    # footer: author on the left, project mark on the right
    c.avatar((x, fy), 56)
    c.text((x + 72, fy + 4), "Anirudh Vasudevan", brand.font("semibold", 23), brand.BRIGHT)
    c.text((x + 72, fy + 33), "anirudhvasudevan.com/blog", brand.font("regular", 19), brand.BODY)
    logo = PROJECT_LOGOS.get(data.get("project", ""))
    if logo:
        c.logo_tile(logo, (brand.W - 80 - 60, fy - 2), 60, radius=14)

    c.save(out)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tooling = max(Path(__file__).stat().st_mtime, Path(brand.__file__).stat().st_mtime)
    n = 0
    for md in sorted(SRC.glob("*.md")):
        data = frontmatter(md.read_text())
        slug = data.get("slug")
        if not slug or data.get("draft") == "true":
            continue
        out = OUT / f"{slug}.png"
        newest = max(md.stat().st_mtime, tooling)
        logo = brand.LOGOS / f"{PROJECT_LOGOS.get(data.get('project', ''), '_')}.svg"
        if logo.exists():
            newest = max(newest, logo.stat().st_mtime)
        if out.exists() and not FORCE and out.stat().st_mtime > newest:
            continue
        render(data, out)
        n += 1
        print(f"og: {out.relative_to(ROOT)}")
    print(f"done ({n} generated)")


if __name__ == "__main__":
    sys.exit(main())
