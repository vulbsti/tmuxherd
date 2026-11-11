#!/usr/bin/env python3
"""Make the dark twin of a hand-written light SVG.

    python3 assets/src/theme-swap.py assets/architecture-light.svg

The SVGs are written by hand in their light form. Every colour lives in one
CSS block between `/* palette:start */` and `/* palette:end */`; this script
copies the file to `*-dark.svg` with that block swapped for the GitHub dark
palette below. Edit the light file, then re-run this. Nothing else changes.
"""
import re
import sys
from pathlib import Path

DARK = """/* palette:start (dark) */
    svg { --bg: #0d1117; --ink: #e6edf3; --muted: #9198a1; --faint: #7d8590; --ghost: #3d444d;
          --edge: #8b949e; --frame: #3d444d; --well: #151b23; --card: #0d1117; --bar: #30363d;
          --working: #1f9e89; --waiting: #d29922; --stalled: #da3633; --idle: #8b949e; }
    /* palette:end */"""

for arg in sys.argv[1:]:
    src = Path(arg)
    if not src.name.endswith('-light.svg'):
        sys.exit(f'{src}: expected a *-light.svg file')
    text = src.read_text()
    out, n = re.subn(r'/\* palette:start.*?/\* palette:end \*/', lambda _: DARK, text, flags=re.S)
    if n != 1:
        sys.exit(f'{src}: expected exactly one palette block, found {n}')
    dst = src.with_name(src.name.replace('-light.svg', '-dark.svg'))
    dst.write_text(out)
    print(f'{src.name} -> {dst.name}')
