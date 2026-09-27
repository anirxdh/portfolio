#!/usr/bin/env python3
"""Generate a 1200x630 share image for every article in content/articles/*.md.

Output: public/blog/og/<slug>.png (committed; the Netlify build never runs Python).
Re-run after adding or renaming articles: `python3 scripts/gen-og.py` (FORCE=1 to redo all).
"""
import os
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "content" / "articles"
OUT = ROOT / "public" / "blog" / "og"
AVATAR = ROOT / "public" / "assets" / "anirudh-avatar.png"
W, H = 1200, 630
FORCE = os.environ.get("FORCE") == "1"

SERIF = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"
SANS = "/System/Library/Fonts/Supplemental/Arial.ttf"
SANS_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


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


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def wrap(draw, text, font, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= max_w:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def render(data, out):
    accent = hex_rgb(data.get("accent", "#7C9CFF"))
    img = Image.new("RGB", (W, H), (1, 1, 3))
    d = ImageDraw.Draw(img)

    # soft accent glow, top-right: concentric ellipses fading toward the ground colour
    for r in range(460, 0, -4):
        t = (1 - r / 460) ** 2 * 0.28
        fill = tuple(int(1 + (c - 1) * t) for c in accent)
        d.ellipse([W - 140 - r, -240 - r, W - 140 + r, -240 + r], fill=fill)

    # border
    d.rounded_rectangle([28, 28, W - 28, H - 28], radius=26, outline=(28, 28, 33), width=2)

    # eyebrow: badge + project
    x, y = 72, 78
    eyebrow_font = ImageFont.truetype(SANS_BOLD, 22)
    award = data.get("award")
    if award:
        t = award.upper()
        tw = d.textlength(t, font=eyebrow_font)
        d.rounded_rectangle([x, y - 8, x + tw + 32, y + 30], radius=19, fill=tuple(c // 6 for c in accent), outline=tuple(c // 2 for c in accent))
        d.text((x + 16, y), t, font=eyebrow_font, fill=accent)
        x += tw + 50
    d.text((x, y), data.get("project", "").upper(), font=eyebrow_font, fill=(125, 127, 136))

    # title
    title = data.get("title", "")
    size = 68
    while size > 40:
        font = ImageFont.truetype(SERIF, size)
        lines = wrap(d, title, font, W - 144)
        if len(lines) <= 3:
            break
        size -= 4
    ty = 150
    for line in lines:
        d.text((72, ty), line, font=font, fill=(228, 228, 230))
        ty += int(size * 1.12)

    # description
    desc_font = ImageFont.truetype(SANS, 26)
    dl = wrap(d, data.get("description", ""), desc_font, W - 144)[:2]
    dy = min(ty + 18, H - 210)
    for line in dl:
        d.text((72, dy), line, font=desc_font, fill=(175, 176, 182))
        dy += 36

    # footer: avatar + name + domain
    fy = H - 118
    try:
        av = Image.open(AVATAR).convert("RGBA").resize((56, 56), Image.LANCZOS)
        mask = Image.new("L", (56, 56), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, 55, 55], fill=255)
        img.paste(av, (72, fy), mask)
    except Exception:
        pass
    name_font = ImageFont.truetype(SANS_BOLD, 26)
    d.text((144, fy + 2), "Anirudh Vasudevan", font=name_font, fill=(228, 228, 230))
    d.text((144, fy + 32), "anirudhvasudevan.com/blog", font=ImageFont.truetype(SANS, 22), fill=(125, 127, 136))

    img.save(out, optimize=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    for md in sorted(SRC.glob("*.md")):
        data = frontmatter(md.read_text())
        slug = data.get("slug")
        if not slug or data.get("draft") == "true":
            continue
        out = OUT / f"{slug}.png"
        if out.exists() and not FORCE and out.stat().st_mtime > md.stat().st_mtime:
            continue
        render(data, out)
        n += 1
        print(f"og: {out.relative_to(ROOT)}")
    print(f"done ({n} generated)")


if __name__ == "__main__":
    sys.exit(main())
