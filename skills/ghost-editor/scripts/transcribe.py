#!/usr/bin/env python3
"""Word-level transcript of the single source recording -> <project>/transcript.json

    python3 transcribe.py <P>/raw.mp4 [--lang ru] [--model large-v3]

Uses faster-whisper if installed (pip install faster-whisper), otherwise the
openai-whisper package (pip install openai-whisper). Output format:
    {"source": "raw.mp4", "language": "ru", "words": [{"w": "Привет", "s": 0.52, "e": 0.81}, ...]}
Times are in SOURCE seconds; edit.json takes/beats use the same clock.
"""
import argparse
import json
import os
import sys


def with_faster_whisper(path, lang, model_name):
    from faster_whisper import WhisperModel  # type: ignore

    model = WhisperModel(model_name, device="auto", compute_type="auto")
    segments, info = model.transcribe(path, language=lang, word_timestamps=True, vad_filter=False,
                                      condition_on_previous_text=False)
    words = [{"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3)}
             for seg in segments for w in (seg.words or []) if w.word.strip()]
    return words, info.language


def with_openai_whisper(path, lang, model_name):
    import whisper  # type: ignore

    model = whisper.load_model(model_name)
    r = model.transcribe(path, language=lang, word_timestamps=True, condition_on_previous_text=False)
    words = [{"w": w["word"].strip(), "s": round(w["start"], 3), "e": round(w["end"], 3)}
             for seg in r["segments"] for w in seg.get("words", []) if w["word"].strip()]
    return words, r.get("language", lang)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("--lang", default=None, help="ISO code, e.g. ru / en (auto if omitted)")
    ap.add_argument("--model", default="large-v3")
    ap.add_argument("--out", default=None, help="default: transcript.json next to the source")
    a = ap.parse_args()

    src = os.path.abspath(a.source)
    out = a.out or os.path.join(os.path.dirname(src), "transcript.json")
    errors = []
    for fn in (with_faster_whisper, with_openai_whisper):
        try:
            words, lang = fn(src, a.lang, a.model)
            break
        except ImportError as e:
            errors.append(str(e))
    else:
        sys.exit("no whisper backend found. Install one:\n  pip install faster-whisper\n  # or: pip install openai-whisper\n"
                 + "\n".join(errors))

    with open(out, "w", encoding="utf-8") as f:
        json.dump({"source": os.path.basename(src), "language": lang, "words": words}, f, ensure_ascii=False, indent=1)
    print(f"{len(words)} words -> {out}")


if __name__ == "__main__":
    main()
