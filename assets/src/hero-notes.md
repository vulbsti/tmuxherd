# Hero image notes

`hero.png` is a generated photograph (Codex image tool, model `gpt-6-luna`),
made with `gen-hero.sh` from `hero-prompt.txt`. `hero-banner.png` is the same
photo with the title set by `compose-banner.py`.

## Concept

A night-shift desk with a wall of old monochrome CRT terminals: twelve
screens of calm green text, one amber screen showing a short numbered list
(a question waiting for an answer), one screen taped round in red with its
text frozen mid-line (stalled). No people, no robots, no neon, no readable
text. Shot like a 35 mm documentary photo under tungsten and phosphor light.
It maps directly onto the dashboard: a grid of agents, most fine, one asking,
one stuck.

## Variants

Five variants were generated (originals kept in `render/raw/`, gitignored).

- **v1-v3** used a first prompt that put the monitors on the right two
  thirds and asked for an empty wall on the left third. All three came out
  with the lamp, mug and clipboard spilling into the left side, leaving only
  about 350-400 px of clean wall after the 2.5:1 crop: not enough for a title
  and a one-line subtitle. v2 was the most convincing of the three (grimy
  mixed beige/grey cases, real-looking red tape).
- **v4-v5** used the current `hero-prompt.txt`, which confines the desk and
  monitors to the right half and says explicitly that nothing stands in the
  left half. v5 kept too much desk (keyboard, phone and clipboard all in the
  banner crop, which reads as clutter).

## Pick: v4, cropped at `CROP_Y=0.45`

- It has the most believable light: a single tungsten lamp raking across the
  monitor cases, phosphor bloom, dust and scuffs, uneven case colours. It
  reads as a photograph, not a render.
- The amber and red screens sit next to each other in the middle of the grid,
  so the story (one waiting, one stalled, the rest fine) is visible at
  README thumbnail size.
- The left ~560 px are plain dark wall, enough room for the title and
  subtitle with nothing behind them.
- Nothing in it is a known cliché (no glowing brain, no hologram, no purple).

## Size

A grainy photo does not compress as a lossless PNG (1.3 MB at 1600x640).
`gen-hero.sh` rounds each colour channel to 5 bits (`BITS=5`), which brings
it to about 520 KB with no visible banding, because the film grain dithers
the steps. Palette quantization (256 colours) was tried and rejected: it
posterized the lamp shade and greyed the green phosphor.

## Banner text

Noto Sans Display (SemiBold title, Regular subtitle; the script prefers
Inter when installed), warm white on the dark wall, left-aligned at x=84.
Against the average wall colour behind the text, contrast is about 16:1 for the title and 11:1 for the subtitle. The script
warns if the subtitle runs into the lamp.
