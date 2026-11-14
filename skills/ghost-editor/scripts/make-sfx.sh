#!/usr/bin/env bash
# Regenerates the built-in SFX set in assets/sfx (synthesised, no licences involved).
# Peaks are kept near -1 dBFS; per-type mix levels live in scripts/lib/levels.mjs.
set -euo pipefail
cd "$(dirname "$0")/../assets/sfx"
gen() { ffmpeg -hide_banner -loglevel error -y -f lavfi -i "$2" -ar 48000 -ac 1 -c:a pcm_s16le "$1.wav"; }

gen whoosh "anoisesrc=d=0.5:c=pink:a=0.9,lowpass=f=2600,highpass=f=300,afade=t=in:d=0.32:curve=exp,afade=t=out:st=0.32:d=0.18,volume=10dB,alimiter=limit=0.89"
gen pop    "aevalsrc='0.85*sin(2*PI*(380+1800*exp(-t*45))*t)*exp(-t*28)':d=0.18"
gen boom   "aevalsrc='0.9*sin(2*PI*(48+90*exp(-t*14))*t)*exp(-t*3.5)':d=1.1"
gen ding   "aevalsrc='0.6*(sin(2*PI*1318*t)+0.5*sin(2*PI*2637*t))*exp(-t*4.5)':d=1.3"
gen click  "aevalsrc='0.8*(random(0)*2-1)*exp(-t*220)':d=0.04"
gen riser  "aevalsrc='0.7*(t/1.4)*sin(2*PI*(180*t+260*t*t))':d=1.4,afade=t=out:st=1.3:d=0.1"
ls -la
