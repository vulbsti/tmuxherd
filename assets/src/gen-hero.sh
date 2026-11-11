#!/usr/bin/env bash
# gen-hero.sh OUT.png [PROMPTFILE]  ->  OUT.png, a 1600x640 banner photo
#
# Asks Codex's built-in image tool (model gpt-6-luna, ChatGPT plan, no MCP or
# plugins) for one landscape 1536x1024 photo, keeps the untouched original in
# render/raw/ (gitignored), then crops it to 2.5:1 and resizes it to 1600x640
# with PIL. Run it several times to get variants.
#
# Environment:
#   CROP_Y    vertical centre of the crop, 0..1 (default 0.5)
#   BITS      bits kept per colour channel, rounded (default 5). A grainy
#             photo does not compress as a lossless PNG; 5 bits keeps the
#             1600x640 file under 600 KB with no visible banding.
#   FROM_RAW  path to an existing 1536x1024 original: skip generation and
#             only crop it (to re-crop the chosen variant).
#
# Example (how assets/src/hero.png was made):
#   ./gen-hero.sh render/hero-v4.png            # one of several variants
#   FROM_RAW=render/raw/hero-v4.png CROP_Y=0.45 ./gen-hero.sh hero.png
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=$(realpath -m "$1")
name=$(basename "$out" .png)
raw=${FROM_RAW:-$here/render/raw/$name.png}
mkdir -p "$here/render/raw" "$here/render/logs" "$(dirname "$out")"
t0=$(date +%s); sid=-

if [[ -z ${FROM_RAW:-} ]]; then
  prompt=$(cat "${2:-$here/hero-prompt.txt}")
  msg="Call your image generation tool directly, exactly once, landscape 1536x1024. Pass the image prompt below to the tool word for word: do not rewrite, shorten or add to it. Do not read any files or skills, do not run shell commands, do not copy or save anything, do not judge the result. Image prompt: $prompt"
  wd=$(mktemp -d); log=$here/render/logs/$name.log
  [[ -e $raw ]] && mv "$raw" "$raw.prev"
  # bash -i so the user's PATH and Codex login are picked up.
  bash -ic "$(printf '%q ' codex exec --ignore-user-config --skip-git-repo-check -s read-only -m gpt-6-luna -c model_reasoning_effort=low -C "$wd" -- "$msg")" </dev/null >"$log" 2>&1
  sid=$(grep -m1 -o 'session id: [0-9a-f-]*' "$log" | cut -d' ' -f3)
  png=$(ls -t "$HOME/.codex/generated_images/$sid"/*.png 2>/dev/null | head -1)
  [[ -n $png ]] && cp "$png" "$raw"
fi

if [[ -s $raw ]]; then
  python3 - "$raw" "$out" "${CROP_Y:-0.5}" "${BITS:-5}" <<'PY'
import sys
from PIL import Image
src, dst, cy, bits = sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4])
im = Image.open(src).convert('RGB'); w, h = im.size
th = round(w / 2.5)                                   # 1600x640 is 2.5:1
top = min(max(round(h * cy - th / 2), 0), h - th)
im = im.crop((0, top, w, top + th)).resize((1600, 640), Image.LANCZOS)
if bits < 8:                                          # round, not truncate
    step = 1 << (8 - bits)
    im = im.point(lambda v: min(255, (v + step // 2) // step * step))
im.save(dst, optimize=True)
PY
fi
echo "$name done in $(( $(date +%s) - t0 ))s exists=$([[ -s $out ]] && echo yes || echo no) session=${sid:-none}"
