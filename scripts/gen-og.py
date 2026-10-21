#!/usr/bin/env python3
"""Generate a 1200x630 share image for every published article in content/articles/*.md, and one
for each static page that is not an article (/projects/, /hackathons/, /research/, /resume/,
/uses/, /blog/ and /blog/topics/).

Output: public/blog/og/<slug>.png and public/blog/og/pages/<name>.png (committed; the Netlify build
never runs Python). Re-run after adding or renaming articles: `python3 scripts/gen-og.py`
(FORCE=1 to redo all, PAGE=<name> to redraw one page card).

The look (General Sans, palette, frame, glow, badge, avatar) comes from scripts/gen-brand.py, which
also draws the site-wide public/assets/og-image.png, so every share card is one visual system.
An image is rebuilt when its article, this script, gen-brand.py, or the project's logo is newer;
a page card when its content/pages file (or, for the blog cards, any article) is newer.
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


# ---------- share images for the static pages ----------
# One card per generated page that is not an article: public/blog/og/pages/<name>.png, wired up in
# scripts/build-blog.mjs (PAGE_OG). The copy repeats each page's own header (content/pages/*.md and
# the templates in build-blog.mjs); keep the two in step when a headline changes.
PAGES_SRC = ROOT / "content" / "pages"
PAGES_OUT = OUT / "pages"

# Same folding as scripts/blog/topics.mjs, so the topic names match the topic pages.
TAG_ALIASES = {
    "web audio": "Web Audio",
    "web audio api": "Web Audio",
    "webaudio": "Web Audio",
    "react.js": "React",
    "reactjs": "React",
    "nextjs": "Next.js",
    "threejs": "Three.js",
    "ffmpeg": "ffmpeg",
}


def published_articles():
    out = []
    for md in sorted(SRC.glob("*.md")):
        data = frontmatter(md.read_text())
        if data.get("slug") and data.get("draft") != "true":
            out.append(data)
    return out


def topics(articles, min_articles=2):
    """[(name, count)] for every tag shared by `min_articles` or more articles, most used first."""
    counts, names = {}, {}
    for a in articles:
        seen = set()
        for raw in a.get("tags", "").strip("[]").split(","):
            raw = raw.strip().strip('"').strip("'")
            if not raw:
                continue
            name = TAG_ALIASES.get(raw.lower(), raw)
            key = re.sub(r"[^a-z0-9]+", "-", name.lower().replace("+", " plus ").replace("#", " sharp ")).strip("-")
            if key in seen:
                continue
            seen.add(key)
            names.setdefault(key, name)
            counts[key] = counts.get(key, 0) + 1
    rows = [(names[k], n) for k, n in counts.items() if n >= min_articles]
    return sorted(rows, key=lambda r: (-r[1], r[0]))


def plural(n, one, many=None):
    return f"{n} {one if n == 1 else (many or one + 's')}"


def page_specs():
    """Copy and chips for each page card. Counts that change with the articles are computed here."""
    arts = published_articles()
    tops = topics(arts)
    return [
        {
            "name": "projects",
            "path": "/projects/",
            "eyebrow": "Projects",
            "title": "Things I have built.",
            "line": "Hackathon wins, products, and experiments, each with its result, the stack, and links to the code and write-up.",
            "pills": ["LARK", "Living Photos", "Apartment 4B", "FaceTime from Mars", "ScreenSense", "RUA"],
            "sources": [PAGES_SRC / "projects.md", ROOT / "src" / "constants" / "index.js"],
        },
        {
            "name": "hackathons",
            "path": "/hackathons/",
            "eyebrow": "Hackathons",
            "title": "Hackathon record.",
            "line": "Five wins and placements, including Top 10 at the Y Combinator AI Hackathon, and 4th overall in ElevenHacks Season 1.",
            "badges": ["Winner", "Best Voice Agent", "2nd Place", "3rd Place", "Top 10"],
            "sources": [PAGES_SRC / "hackathons.md"],
        },
        {
            "name": "research",
            "path": "/research/",
            "eyebrow": "Research",
            "title": "Patent and research.",
            "line": "A granted patent for a contactless voting system and two papers, one of them at the EMNLP 2026 Main Conference.",
            "pills": ["Granted patent, May 2023", "EMNLP 2026 Main Conference", "Springer, 2023"],
            "sources": [PAGES_SRC / "research.md"],
        },
        {
            "name": "resume",
            "path": "/resume/",
            "eyebrow": "Resume",
            "title": "Full-stack and AI engineer in San Francisco.",
            "line": "Member of Technical Staff at Rivo. Previously the founding engineer at Nonlinear.",
            "pills": ["MS in Computer Science, University of Minnesota", "Granted patent", "EMNLP 2026"],
            "sources": [PAGES_SRC / "resume.md"],
        },
        {
            "name": "uses",
            "path": "/uses/",
            "eyebrow": "Uses",
            "title": "Tools I use.",
            "line": "The stack I reach for at Rivo and in my own projects, each tool linked to the write-ups that use it.",
            "pills": ["TypeScript", "Python", "React Native", "Next.js", "ElevenLabs", "LiveKit", "AWS"],
            "sources": [PAGES_SRC / "uses.md"],
        },
        {
            "name": "blog",
            "path": "/blog/",
            "eyebrow": f"Writing · {plural(len(arts), 'article')}",
            "title": "How I built the things I built.",
            "line": "Architecture, trade-offs, and the honest story behind each project: the hackathon wins, the products, and the experiments.",
            "pills": [name for name, _ in tops[:4]],
            "sources": list(SRC.glob("*.md")),
        },
        {
            "name": "topics",
            "path": "/blog/topics/",
            "eyebrow": f"Writing · {plural(len(tops), 'topic')}",
            "title": "Writing by topic.",
            "line": "Every topic that at least two articles share, so you can read those articles side by side.",
            "counts": tops[:5],
            "sources": list(SRC.glob("*.md")),
        },
    ]


def chip_row(x, y, items, draw, gap=12, max_x=None):
    """Lay chips left to right, stopping before one would cross max_x. Returns the right edge."""
    max_x = max_x or brand.W - 80
    for item in items:
        right = draw(x, y, item, dry=True)
        if right > max_x:
            break
        x = draw(x, y, item) + gap
    return x - gap


def render_page(spec, out):
    c = brand.Canvas(accent=brand.DEFAULT_ACCENT, glow=0.24)
    c.frame()
    x, max_w = 80, brand.W - 160

    c.tracked((x, 87), spec["eyebrow"].upper(), brand.font("medium", 16), brand.BODY, tracking=0.14)

    # heading: as large as fits on one line (or two for the longer ones), in the heading gradient
    for size in range(92, 55, -2):
        fnt = brand.font("semibold", size)
        lines = brand.wrap(c, spec["title"], fnt, max_w)
        if len(lines) == 1 or (len(lines) == 2 and size <= 72):
            break
    lead = round(size * 1.08)
    df = brand.font("regular", 26)
    desc = brand.wrap(c, spec["line"], df, max_w - 40)[:2]
    chip_h = 46
    gap = round(28 + size * 0.44)  # heading baseline to the first standfirst baseline

    # centre heading, standfirst and chips between the eyebrow and the footer
    fy = brand.H - 124
    block = c.cap_height(fnt) + lead * (len(lines) - 1) + gap + 38 * (len(desc) - 1) + 44 + chip_h
    top, bottom = 132, fy - 40
    baseline = top + max(0, (bottom - top - block) / 2) + c.cap_height(fnt)
    for line in lines:
        c.gradient_text((x - 3, baseline), line, fnt, anchor="ls")
        baseline += lead
    dy = baseline - lead + gap
    for line in desc:
        c.text((x, dy), line, df, brand.BODY, anchor="ls")
        dy += 38

    # chips: result badges, plain pills, or topic pills with counts
    cy = dy - 38 + 44
    pf = brand.font("medium", 21)
    accent = c.accent
    if spec.get("badges"):
        bf = brand.font("semibold", 20)
        gold = brand.hex_rgb("#F5B942")

        def badge(px, py, txt, dry=False):
            if dry:
                return px + c.length(txt, bf) + 36
            return c.badge((px, py), txt, bf, gold, height=46)

        chip_row(x, cy, spec["badges"], badge)
    elif spec.get("counts"):
        # topic pills with the article count in the accent, like .chip__count on the site
        tx = x
        nf = brand.font("semibold", 19)
        for name, n in spec["counts"]:
            w = c.length(name, pf) + 14 + c.length(str(n), nf) + 40
            if tx + w > brand.W - 80:
                break
            s = c.s
            c.draw.rounded_rectangle([s(tx), s(cy), s(tx + w), s(cy + 46)], radius=s(23), fill=brand.SURFACE, outline=brand.BORDER, width=s(1.5))
            c.text((tx + 20, cy + 23), name, pf, brand.BRIGHT, anchor="lm")
            c.text((tx + 20 + c.length(name, pf) + 14, cy + 23), str(n), nf, brand.readable(accent), anchor="lm")
            tx += w + 12
    elif spec.get("pills"):

        def pill(px, py, txt, dry=False):
            if dry:
                return px + c.length(txt, pf) + 40
            return c.pill((px, py), txt, pf, height=46, pad=20)

        chip_row(x, cy, spec["pills"], pill)

    # footer: author and the page's address
    c.avatar((x, fy), 56)
    c.text((x + 72, fy + 4), "Anirudh Vasudevan", brand.font("semibold", 23), brand.BRIGHT)
    c.text((x + 72, fy + 33), "anirudhvasudevan.com" + spec["path"].rstrip("/"), brand.font("regular", 19), brand.BODY)
    c.save(out)


def main_pages(tooling):
    PAGES_OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    only = os.environ.get("PAGE")
    for spec in page_specs():
        if only and spec["name"] != only:
            continue
        out = PAGES_OUT / f"{spec['name']}.png"
        newest = max([tooling] + [p.stat().st_mtime for p in spec["sources"] if p.exists()])
        if out.exists() and not FORCE and not only and out.stat().st_mtime > newest:
            continue
        render_page(spec, out)
        n += 1
        print(f"og: {out.relative_to(ROOT)}")
    return n


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tooling = max(Path(__file__).stat().st_mtime, Path(brand.__file__).stat().st_mtime)
    n = main_pages(tooling)
    if os.environ.get("PAGE"):
        return

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
