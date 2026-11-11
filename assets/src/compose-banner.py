#!/usr/bin/env python3
"""Set the title and subtitle on the hero photo.

    python3 assets/src/compose-banner.py [hero.png] [hero-banner.png]

Defaults are assets/src/hero.png -> assets/hero-banner.png, relative to this file.
The text sits in the empty wall on the left of the photo. Fonts are looked up
with fc-list, in order of preference; the first installed family wins.
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'hero.png'
DST = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE.parent / 'hero-banner.png'

TITLE = 'tmuxherd'
SUBTITLE = ['Supervise every terminal coding agent', 'from one browser tab']

# (family, style) candidates, best first.
TITLE_FONTS = [('Inter', 'Bold'), ('Noto Sans Display', 'SemiBold'), ('Noto Sans', 'SemiBold'),
               ('DejaVu Sans', 'Bold'), ('Liberation Sans', 'Bold')]
BODY_FONTS = [('Inter', 'Regular'), ('Noto Sans Display', 'Regular'), ('Noto Sans', 'Regular'),
              ('DejaVu Sans', 'Book'), ('Liberation Sans', 'Regular')]

INK = (244, 239, 230)      # warm white, reads as paper under tungsten light
SOFT = (214, 204, 189)     # subtitle: still >= 9:1 against the wall
LEFT = 84                  # left margin, px
TITLE_PX = 104
BODY_PX = 27


def font_file(candidates):
    """Path of the first installed (family, style), matched exactly."""
    for family, style in candidates:
        out = subprocess.run(['fc-list', '-f', '%{file}|%{family}|%{style}\n', f':family={family}'],
                             capture_output=True, text=True).stdout
        for line in sorted(out.splitlines()):
            path, fams, styles = line.split('|')
            if family in fams.split(',') and styles.split(',')[0] == style and path.endswith(('.ttf', '.otf')):
                return path
    sys.exit(f'no usable font among {candidates}')


def main():
    im = Image.open(SRC).convert('RGB')
    d = ImageDraw.Draw(im)
    title = ImageFont.truetype(font_file(TITLE_FONTS), TITLE_PX)
    body = ImageFont.truetype(font_file(BODY_FONTS), BODY_PX)

    # Optical alignment: the title's left side bearing is larger at this size,
    # so nudge it left by its own bearing to line up with the subtitle.
    bearing = title.getbbox(TITLE)[0] - body.getbbox(SUBTITLE[0])[0]
    y = 262
    d.text((LEFT - bearing, y), TITLE, font=title, fill=INK, anchor='ls')
    y += 54
    for line in SUBTITLE:
        d.text((LEFT, y), line, font=body, fill=SOFT, anchor='ls')
        y += round(BODY_PX * 1.4)

    # Guard: the text block must stay clear of the lamp (starts near x=600).
    right = LEFT + max(d.textlength(l, font=body) for l in SUBTITLE)
    if right > 590:
        print(f'warning: subtitle reaches x={right:.0f}, close to the lamp', file=sys.stderr)
    im.save(DST, optimize=True)
    print(f'{DST.name}: {im.size[0]}x{im.size[1]}, {DST.stat().st_size // 1024} KB, text right edge x={right:.0f}')


if __name__ == '__main__':
    main()
