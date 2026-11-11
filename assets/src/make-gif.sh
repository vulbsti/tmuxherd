#!/usr/bin/env bash
# demo.webm + timeline.json (from record-demo.mjs) → assets/demo.gif
# Real time for the interactions; the wait between "api-fix idle" and
# "billing stalled" is sped up 6x (the caption in the README says so).
set -euo pipefail
cd "$(dirname "$0")"
R=render
t() { python3 -c "import json,sys;print([e['t'] for e in json.load(open('$R/timeline.json')) if e['label']==sys.argv[1]][0])" "$1"; }
A=$(t 'api-fix idle'); B=$(t 'billing stalled'); E=$(t end)
W=${GIF_WIDTH:-840}; FPS=${GIF_FPS:-4}
ffmpeg -y -loglevel error -i $R/demo.webm -filter_complex "
 [0:v]trim=0.6:$A,setpts=PTS-STARTPTS[a];
 [0:v]trim=$A:$B,setpts=(PTS-STARTPTS)/6[b];
 [0:v]trim=$B:$E,setpts=PTS-STARTPTS[c];
 [a][b][c]concat=n=3:v=1,fps=$FPS,scale=$W:-1:flags=lanczos,split[x][y];
 [x]palettegen=max_colors=${GIF_COLORS:-48}:stats_mode=diff[p];[y][p]paletteuse=dither=${GIF_DITHER:-none}:diff_mode=rectangle" ../demo.gif
# Lossy pass (README images must stay under 2 MB). gifsicle runs in a throwaway container.
docker run --rm -v "$PWD/..:/a" alpine:3.20 sh -c "apk add -q gifsicle >/dev/null && gifsicle -O3 --lossy=100 /a/demo.gif -o /a/demo.gif && chown $(id -u):$(id -g) /a/demo.gif"
ls -la ../demo.gif
