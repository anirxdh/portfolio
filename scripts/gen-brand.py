#!/usr/bin/env python3
"""Brand image system for anirudhvasudevan.com, plus the default share image.

Writes public/assets/og-image.png (1200x630), the Open Graph / Twitter image for the homepage,
the About page, and the blog index. scripts/gen-og.py imports this file for the per-article
share images, so every share card uses the same palette, type, frame, and glow.

    python3 scripts/gen-brand.py            # regenerate public/assets/og-image.png
    OUT=/tmp/og.png python3 scripts/gen-brand.py

Type is General Sans, the site's only font. Its license (ITF, fontshare.com/terms) does not allow
redistributing the files, so they are not committed: the first run downloads the same .woff files
the site loads from cdnfonts into ~/.cache/anirudhvasudevan-brand/fonts (override with
BRAND_FONT_DIR). Offline, it falls back to Arial and prints a warning. Project logo tiles are
rasterized from public/assets/logos/*.svg with rsvg-convert (brew install librsvg) when present.
Requires Pillow.
"""
import os
import shutil
import subprocess
import sys
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
AVATAR = ROOT / "public" / "assets" / "anirudh-avatar.png"
LOGOS = ROOT / "public" / "assets" / "logos"
OG_OUT = ROOT / "public" / "assets" / "og-image.png"

W, H = 1200, 630
SS = 2  # draw at 2x and downsample, so shapes get the same anti-aliasing as text

# ---------- palette: tailwind.config.js + src/index.css ----------
def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


GROUND = hex_rgb("#010103")  # black-100
SURFACE = hex_rgb("#0E0E10")  # black-200
BORDER = hex_rgb("#1C1C21")  # black-300
MUTED = hex_rgb("#3A3A49")  # black-500
BODY = hex_rgb("#AFB0B6")  # white-600
BRIGHT = hex_rgb("#E4E4E6")  # white-800
# .text-gray_gradient runs #BEC1CF to #D5D8EA; images use a smooth top-to-bottom version of it.
HEAD_TOP = hex_rgb("#EEF0F7")
HEAD_BOTTOM = hex_rgb("#BEC1CF")
DEFAULT_ACCENT = "#7C9CFF"  # same default glow as scripts/blog/blog.css

# Homepage project tiles (src/constants/index.js logoStyle.backgroundColor) for each logo mark.
LOGO_TILES = {
    "lark": "#1C1A43",
    "apartment4b": "#2A1816",
    "livingphotos": "#13202F",
    "facetime": "#2E1912",
    "talkativepdf": "#0E1F38",
    "civs": "#13202F",
}

# ---------- fonts ----------
FONT_URL = "https://fonts.cdnfonts.com/s/85793/GeneralSans-{}.woff"
WEIGHTS = {"regular": "Regular", "medium": "Medium", "semibold": "Semibold", "bold": "Bold"}
FALLBACK = {
    "regular": "/System/Library/Fonts/Supplemental/Arial.ttf",
    "medium": "/System/Library/Fonts/Supplemental/Arial.ttf",
    "semibold": "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "bold": "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
}
FONT_DIR = Path(os.environ.get("BRAND_FONT_DIR") or Path.home() / ".cache" / "anirudhvasudevan-brand" / "fonts")
_font_files = {}
_warned = False


def _font_file(weight):
    global _warned
    if weight in _font_files:
        return _font_files[weight]
    name = f"GeneralSans-{WEIGHTS[weight]}.woff"
    path = FONT_DIR / name
    if not path.exists():
        try:
            FONT_DIR.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(FONT_URL.format(WEIGHTS[weight]), timeout=20) as r:
                data = r.read()
            tmp = path.with_suffix(".part")
            tmp.write_bytes(data)
            tmp.replace(path)
        except Exception as e:  # offline or blocked: keep going with a system sans
            if not _warned:
                print(f"brand: could not fetch General Sans ({e}); falling back to Arial", file=sys.stderr)
                _warned = True
            _font_files[weight] = FALLBACK[weight]
            return FALLBACK[weight]
    _font_files[weight] = str(path)
    return str(path)


def font(weight, size):
    """General Sans at `size` px (1x units). Weight: regular, medium, semibold, bold."""
    return ImageFont.truetype(_font_file(weight), int(round(size * SS)))


# ---------- canvas ----------
class Canvas:
    """A 1200x630 card drawn at SS x scale. All coordinates passed in are 1x pixels."""

    def __init__(self, accent=DEFAULT_ACCENT, glow=0.22, glow_at=(1010, -40), glow_r=560):
        self.accent = hex_rgb(accent)
        self.img = Image.new("RGB", (W * SS, H * SS), GROUND)
        self.draw = ImageDraw.Draw(self.img)
        self.glow(self.accent, glow_at, glow_r, glow)

    @staticmethod
    def s(v):
        return int(round(v * SS))

    def glow(self, color, center, radius, strength):
        """Soft radial light, like the .glow element on the static pages."""
        size = self.s(radius) * 2
        # Pillow's radial gradient is 0 at the centre and 255 at the corners (about 181 at the
        # inscribed circle), so normalise to the circle: the light reaches exactly zero at `radius`.
        mask = Image.radial_gradient("L").point(lambda v: int(255 * strength * max(0.0, 1 - v / 181) ** 2.2))
        mask = mask.resize((size, size), Image.BILINEAR)
        layer = Image.new("RGB", (size, size), color)
        cx, cy = self.s(center[0]), self.s(center[1])
        self.img.paste(layer, (cx - size // 2, cy - size // 2), mask)

    def frame(self):
        """The 1px card outline every share image carries (rounded-2xl, border-black-300)."""
        s = self.s
        self.draw.rounded_rectangle([s(28), s(28), s(W - 28), s(H - 28)], radius=s(26), outline=BORDER, width=s(2))

    def text(self, xy, txt, fnt, fill, anchor="la"):
        self.draw.text((self.s(xy[0]), self.s(xy[1])), txt, font=fnt, fill=fill, anchor=anchor)

    def length(self, txt, fnt):
        return self.draw.textlength(txt, font=fnt) / SS

    def tracked(self, xy, txt, fnt, fill, tracking=0.12):
        """Uppercase eyebrow text with letter spacing (em units), like the site's eyebrows."""
        x, y = self.s(xy[0]), self.s(xy[1])
        gap = fnt.size * tracking
        for ch in txt:
            self.draw.text((x, y), ch, font=fnt, fill=fill)
            x += self.draw.textlength(ch, font=fnt) + gap
        return (x - gap) / SS

    def tracked_length(self, txt, fnt, tracking=0.12):
        gap = fnt.size * tracking
        return (sum(self.draw.textlength(ch, font=fnt) for ch in txt) + gap * (len(txt) - 1)) / SS

    def cap_height(self, fnt):
        """Cap height in 1x px (distance from baseline to the top of an H)."""
        return -fnt.getbbox("H", anchor="ls")[1] / SS

    def gradient_text(self, xy, txt, fnt, top=HEAD_TOP, bottom=HEAD_BOTTOM, anchor="la"):
        """Heading text filled with the site's gray gradient (top to bottom)."""
        x, y = self.s(xy[0]), self.s(xy[1])
        box = self.draw.textbbox((x, y), txt, font=fnt, anchor=anchor)
        w, h = box[2] - box[0], box[3] - box[1]
        mask = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mask).text((x - box[0], y - box[1]), txt, font=fnt, fill=255, anchor=anchor)
        grad = Image.linear_gradient("L").resize((w, h))
        fill = Image.composite(Image.new("RGB", (w, h), bottom), Image.new("RGB", (w, h), top), grad)
        self.img.paste(fill, (box[0], box[1]), mask)

    def pill(self, xy, txt, fnt, height=44, pad=20, dot=None):
        """Rounded-full chip: bg-black-200, border-black-300, white-800 text. Returns its right edge."""
        s = self.s
        x, y = xy
        tw = self.length(txt, fnt)
        dot_w = 18 if dot else 0
        w = tw + pad * 2 + dot_w
        self.draw.rounded_rectangle([s(x), s(y), s(x + w), s(y + height)], radius=s(height / 2), fill=SURFACE, outline=BORDER, width=s(1.5))
        if dot:
            r = 4
            cx, cy = x + pad + r, y + height / 2
            self.draw.ellipse([s(cx - r), s(cy - r), s(cx + r), s(cy + r)], fill=dot)
        self.text((x + pad + dot_w, y + height / 2), txt, fnt, BRIGHT, anchor="lm")
        return x + w

    def badge(self, xy, txt, fnt, color, height=40, pad=18):
        """Award badge, same as .badge on the static pages: accent text on a 14% accent wash."""
        s = self.s
        x, y = xy
        w = self.length(txt, fnt) + pad * 2
        wash = tuple(int(GROUND[i] + (color[i] - GROUND[i]) * 0.16) for i in range(3))
        edge = tuple(int(GROUND[i] + (color[i] - GROUND[i]) * 0.38) for i in range(3))
        self.draw.rounded_rectangle([s(x), s(y), s(x + w), s(y + height)], radius=s(height / 2), fill=wash, outline=edge, width=s(1.5))
        self.text((x + pad, y + height / 2), txt, fnt, readable(color), anchor="lm")
        return x + w

    def avatar(self, xy, size, ring=MUTED, ring_w=2, halo=None):
        """The memoji, cropped to a circle with a thin ring."""
        s = self.s
        x, y = xy
        if halo:
            self.glow(halo, (x + size / 2, y + size / 2), size * 0.95, 0.30)
        d = s(size)
        av = Image.open(AVATAR).convert("RGB").resize((d, d), Image.LANCZOS)
        mask = Image.new("L", (d, d), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, d - 1, d - 1], fill=255)
        self.img.paste(av, (s(x), s(y)), mask)
        if ring_w:
            self.draw.ellipse([s(x), s(y), s(x + size), s(y + size)], outline=ring, width=s(ring_w))

    def logo_tile(self, key, xy, size, radius=None):
        """A project mark on its homepage tile colour. Returns False when it cannot be drawn."""
        mark = rasterize_logo(key, self.s(size * 0.62))
        if mark is None:
            return False
        s = self.s
        x, y = xy
        tile = hex_rgb(LOGO_TILES.get(key, "#0E0E10"))
        edge = tuple(min(255, int(c * 1.45) + 6) for c in tile)
        self.draw.rounded_rectangle([s(x), s(y), s(x + size), s(y + size)], radius=s(radius or size * 0.24), fill=tile, outline=edge, width=s(1.5))
        off = (s(size) - mark.width) // 2
        self.img.paste(mark, (s(x) + off, s(y) + off), mark)
        return True

    def save(self, out):
        img = self.img.resize((W, H), Image.LANCZOS)
        # A dithered 256-colour palette keeps the glow smooth at roughly 40% of the RGB file size.
        img = img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
        out = Path(out)
        out.parent.mkdir(parents=True, exist_ok=True)
        img.save(out, optimize=True)
        return out


def lighten(rgb, t):
    return tuple(int(c + (255 - c) * t) for c in rgb)


def luminance(rgb):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def readable(rgb, target=0.32):
    """The accent, lightened just enough to read on the dark ground (about 7:1 against #010103)."""
    t = 0.12
    out = lighten(rgb, t)
    while luminance(out) < target and t < 0.9:
        t += 0.04
        out = lighten(rgb, t)
    return out


def wrap(canvas, text, fnt, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if canvas.length(t, fnt) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def rasterize_logo(key, px):
    svg = LOGOS / f"{key}.svg"
    if not svg.exists() or not shutil.which("rsvg-convert"):
        return None
    png = subprocess.run(["rsvg-convert", "-w", str(px), "-h", str(px), str(svg)], capture_output=True, check=True).stdout
    return Image.open(BytesIO(png)).convert("RGBA")


# ---------- default share image ----------
NAME = "Anirudh Vasudevan"
ROLE = "Full-stack and AI engineer, San Francisco"
PROOF = ["5x hackathon winner", "YC AI Hackathon top 10", "Granted patent"]
DOMAIN = "anirudhvasudevan.com"


def render_default(out=OG_OUT):
    c = Canvas(glow=0.20)
    c.frame()

    x = 80
    # avatar, right column, with a soft halo so it sits in the light
    av = 196
    c.avatar((W - 80 - av, 104), av, halo=hex_rgb(DEFAULT_ACCENT))

    c.tracked((x, 112), DOMAIN.upper(), font("medium", 17), BODY, tracking=0.16)
    c.gradient_text((x - 4, 150), "Anirudh", font("semibold", 112))
    c.gradient_text((x - 4, 270), "Vasudevan", font("semibold", 112))
    c.text((x, 414), ROLE, font("medium", 32), BODY)

    px = x
    pf = font("medium", 21)
    for item in PROOF:
        px = c.pill((px, 484), item, pf, height=46, pad=20) + 12
    return c.save(out)


if __name__ == "__main__":
    path = render_default(Path(os.environ["OUT"]) if os.environ.get("OUT") else OG_OUT)
    print(f"brand: {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path} ({path.stat().st_size // 1024} KB)")
