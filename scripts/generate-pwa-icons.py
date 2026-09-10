#!/usr/bin/env python3
"""Generate the PWA icon set from the app's brand mark.

The design mirrors `.sidebar-brand-icon` in globals.css: a rounded square with a
135deg neutral gradient (#f5f5f5 -> #a3a3a3) and a bold dark "S".

Usage:  python3 scripts/generate-pwa-icons.py
Output: public/icons/*.png
"""

import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "icons")

GRADIENT_START = (245, 245, 245)  # #f5f5f5
GRADIENT_END = (163, 163, 163)    # #a3a3a3
GLYPH = "S"
GLYPH_COLOR = (23, 23, 23, 255)   # #171717
SS = 4  # supersampling factor for smooth edges

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def gradient(size):
    """135deg linear gradient, drawn per-pixel along the diagonal."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    max_t = 2 * (size - 1)
    for y in range(size):
        for x in range(size):
            t = (x + y) / max_t
            px[x, y] = (
                round(GRADIENT_START[0] + (GRADIENT_END[0] - GRADIENT_START[0]) * t),
                round(GRADIENT_START[1] + (GRADIENT_END[1] - GRADIENT_START[1]) * t),
                round(GRADIENT_START[2] + (GRADIENT_END[2] - GRADIENT_START[2]) * t),
            )
    return img


def build(size, radius_ratio=0.22, glyph_ratio=0.62):
    """Render one icon.

    radius_ratio: corner radius as a fraction of the size (0 = full-bleed square).
    glyph_ratio:  cap height of the "S" as a fraction of the size. Maskable icons
                  use a smaller value so the glyph survives a circular crop.
    """
    big = size * SS
    canvas = gradient(big)

    mask = Image.new("L", (big, big), 0)
    md = ImageDraw.Draw(mask)
    if radius_ratio > 0:
        md.rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * radius_ratio), fill=255)
    else:
        md.rectangle([0, 0, big - 1, big - 1], fill=255)

    icon = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    icon.paste(canvas, (0, 0), mask)

    # Size the glyph by measuring its real ink bounds so it optically centres.
    target = big * glyph_ratio
    font = load_font(int(target))
    probe = ImageDraw.Draw(icon)
    box = probe.textbbox((0, 0), GLYPH, font=font)
    ink_h = box[3] - box[1]
    if ink_h:
        font = load_font(max(1, int(target * target / ink_h)))
        box = probe.textbbox((0, 0), GLYPH, font=font)

    x = (big - (box[2] - box[0])) / 2 - box[0]
    y = (big - (box[3] - box[1])) / 2 - box[1]
    probe.text((x, y), GLYPH, font=font, fill=GLYPH_COLOR)

    return icon.resize((size, size), Image.LANCZOS)


def save(img, name):
    path = os.path.join(OUT_DIR, name)
    img.save(path, "PNG", optimize=True)
    print(f"  {name}  ({img.width}x{img.height}, {os.path.getsize(path):,} bytes)")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print("Generating PWA icons ->", os.path.relpath(OUT_DIR, ROOT))

    # purpose: any — rounded square, transparent corners
    for size in (192, 512):
        save(build(size), f"icon-{size}.png")

    # purpose: maskable — full bleed, glyph inside the 80% safe zone
    for size in (192, 512):
        save(build(size, radius_ratio=0, glyph_ratio=0.44), f"icon-maskable-{size}.png")

    # iOS home screen (iOS applies its own mask, so no transparent corners)
    save(build(180, radius_ratio=0), "apple-touch-icon.png")

    # browser tab
    for size in (32, 96):
        save(build(size, glyph_ratio=0.66), f"favicon-{size}.png")


if __name__ == "__main__":
    main()
