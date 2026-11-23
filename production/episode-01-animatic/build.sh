#!/usr/bin/env bash
# 1-серия аниматигін толық жинау: кадрлар → дыбыс → MP4.
# Талап: node 22+, Playwright + Chromium, python3 + numpy, ffmpeg.
set -euo pipefail
cd "$(dirname "$0")"

[ -d node_modules/three ] || npm install

# кадрлар (3 параллель процесс; бар кадрлар өткізіліп кетеді)
node render.mjs --from 0 --to 480 &
node render.mjs --from 480 --to 960 &
node render.mjs --from 960 --to 1440 &
wait

python3 audio.py

mkdir -p out
ffmpeg -y -loglevel error -framerate 24 -i frames/%05d.jpg -i out/audio.wav \
  -map 0:v -map 1:a -c:v libx264 -preset slow -crf 23 -maxrate 8M -bufsize 16M -pix_fmt yuv420p -profile:v high \
  -c:a aac -b:a 256k -af "loudnorm=I=-14:TP=-1:LRA=11" -ar 48000 \
  -movflags +faststart -shortest out/episode-01-animatic.mp4

ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate:format=duration -of compact out/episode-01-animatic.mp4
