#!/usr/bin/env bash
# Usage: mix.sh SOURCE.mov ASSETS_DIR VIDEO_TRACK.mp4 OUT.mp4
set -euo pipefail
SRC=$1; A=$2; V=$3; OUT=$4
ffmpeg -v error -y -i "$V" -i "$SRC" -i "$A/whoosh-short.mp3" -i "$A/pop.mp3" -filter_complex "
[1:a]aresample=48000,apad=pad_dur=3,aecho=0.8:0.5:120|260:0.25|0.15,afade=t=out:st=7.6:d=2.2,atrim=0:10[mus];
[2:a]aresample=48000,volume=0.35,adelay=6850|6850[wh];
[3:a]aresample=48000,volume=0.30,adelay=8050|8050[pp];
[mus][wh][pp]amix=inputs=3:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,atrim=0:10[a]" \
 -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 256k -ar 48000 -movflags +faststart -shortest "$OUT"
