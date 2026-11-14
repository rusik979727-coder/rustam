#!/usr/bin/env python3
"""Voice chain + music bed with sidechain ducking, all loudnorms two-pass.

usage: audio.py --voice .tmp/cut.mp4 --music music.m4a --total 29.9
                --drop 126.4 --phrase 26.54 [--bed -24] [--denoise 6]
Writes .tmp/voice.wav, .tmp/music_bed.wav, .tmp/music_ducked.wav, .tmp/audio_mixed.wav
"""
import argparse, json, re, subprocess

SR = 48000


def run(args):
    return subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-y"] + args,
                          check=True, capture_output=True, text=True).stderr


def loudnorm_2pass(inp, out, chain, I, TP=-1.0, LRA=11):
    """chain applied before loudnorm; returns measured json of pass 1."""
    pre = (chain + ",") if chain else ""
    err = run(["-i", inp, "-af", f"{pre}loudnorm=I={I}:TP={TP}:LRA={LRA}:print_format=json", "-f", "null", "-"])
    m = json.loads(err[err.rindex("{"):err.rindex("}") + 1])
    ln = (f"loudnorm=I={I}:TP={TP}:LRA={LRA}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
          f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    run(["-i", inp, "-af", f"{pre}{ln},aresample={SR}", "-ar", str(SR), "-c:a", "pcm_s24le", out])
    return m


def norm_linear(inp, out, chain, I, TP=-1.0):
    """Two passes, strictly linear: measure integrated loudness, apply the exact gain, then a
    peak limiter 0.6 dB under the TP target (4x oversampled) so the lift to I never clips.
    Used where loudnorm silently falls back to dynamic mode (speech with a silent tail, LRA > 11)."""
    pre = (chain + ",") if chain else ""
    err = run(["-i", inp, "-af", f"{pre}ebur128", "-f", "null", "-"])
    mI = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", err)[-1])
    lim = 10 ** ((TP - 0.6) / 20)
    gain = I - mI
    for _ in range(4):  # the limiter eats a little loudness: correct and re-run until within 0.1 LU
        run(["-i", inp, "-af", f"{pre}volume={gain:.2f}dB,aresample={SR * 4},"
             f"alimiter=limit={lim:.4f}:attack=1:release=50:level=disabled,aresample={SR}",
             "-ar", str(SR), "-c:a", "pcm_s24le", out])
        got, _ = lufs(out)
        if abs(got - I) <= 0.1:
            break
        gain += I - got
    return mI


def dur(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                          "-of", "csv=p=0", path]).strip())


def lufs(path):
    err = run(["-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"])
    I = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", err)[-1])
    tp = float(re.findall(r"Peak:\s+(-?[\d.]+) dBFS", err)[-1])
    return I, tp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default=".tmp/cut.mp4")
    ap.add_argument("--music", default="music.m4a", help="'none' = no music bed")
    ap.add_argument("--sfx", default=None, help="SFX bus wav (tools/sfx.py), mixed as is")
    ap.add_argument("--total", type=float, required=True)
    ap.add_argument("--drop", type=float, default=None)
    ap.add_argument("--phrase", type=float, default=None)
    ap.add_argument("--bed", type=float, default=-24)
    ap.add_argument("--denoise", type=float, default=6, help="afftdn nr in dB, 0 = off")
    ap.add_argument("--fadeout", type=float, default=1.2)
    a = ap.parse_args()
    T = a.total

    vchain = "highpass=f=80,highpass=f=80"
    if a.denoise > 0:
        vchain += f",afftdn=nr={a.denoise}:nf=-42"
    # sample-peak limiter at −3 dBFS: leaves headroom so the linear loudnorm can reach −14 LUFS at −1 dBTP
    vchain += f",alimiter=limit=0.708:attack=3:release=60:level=disabled,apad=whole_dur={T},atrim=0:{T}"
    norm_linear(a.voice, ".tmp/voice.wav", vchain, -14)

    if a.music != "none":
        off = a.drop - a.phrase
        mchain = (f"atrim=start={off}:duration={T},asetpts=PTS-STARTPTS,afade=t=in:d=0.4,"
                  f"afade=t=out:st={T - a.fadeout}:d={a.fadeout}")
        loudnorm_2pass(a.music, ".tmp/music_bed.wav", mchain, a.bed, TP=-3)
        # sidechain: pad both inputs, trim output, check length (sidechaincompress loses ~1 s)
        run(["-i", ".tmp/music_bed.wav", "-i", ".tmp/voice.wav", "-filter_complex",
             f"[0:a]apad=pad_dur=2[m];[1:a]apad=pad_dur=2[v];"
             f"[m][v]sidechaincompress=threshold=0.10:ratio=3:attack=20:release=380,atrim=0:{T}[o]",
             "-map", "[o]", "-c:a", "pcm_s24le", ".tmp/music_ducked.wav"])
    stems = [".tmp/voice.wav"]
    if a.music != "none":
        stems.append(".tmp/music_ducked.wav")
    if a.sfx:
        stems.append(a.sfx)
    inputs = sum((["-i", p] for p in stems), [])
    prep = ";".join(f"[{i}:a]aresample={SR},aformat=channel_layouts=mono,apad=whole_dur={T},atrim=0:{T}[s{i}]"
                    for i in range(len(stems)))
    mix = "".join(f"[s{i}]" for i in range(len(stems))) + f"amix=inputs={len(stems)}:normalize=0:duration=first[o]"
    run(inputs + ["-filter_complex", f"{prep};{mix}", "-map", "[o]", "-c:a", "pcm_s24le", ".tmp/premix.wav"])
    norm_linear(".tmp/premix.wav", ".tmp/audio_mixed.wav", "", -14)

    vI, _ = lufs(".tmp/voice.wav")
    fI, ftp = lufs(".tmp/audio_mixed.wav")
    if a.music != "none":
        mI, _ = lufs(".tmp/music_ducked.wav")
        print(f"music offset {off:.2f}s  voice {vI} LUFS  ducked music {mI} LUFS  separation {vI - mI:.1f} dB")
    else:
        print(f"no music; voice {vI} LUFS")
    print(f"final {fI} LUFS  true peak {ftp} dBFS")
    for p in [".tmp/voice.wav", ".tmp/audio_mixed.wav"]:
        print(f"{p}: {dur(p):.3f}s (target {T})")


if __name__ == "__main__":
    main()
