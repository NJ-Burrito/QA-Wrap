#!/usr/bin/env python
"""Mix the 40 s film's audio and mux it onto a rendered video.

    PYTHONUTF8=1 uv run --with numpy python mix.py --lang ar --aspect 16x9 [--no-voice]

Inputs : work/film/c40/<lang>-<aspect>.mp4 (silent render), work/film/c40/audio/bed.wav, vo/NN.wav (Arabic only)
Output : work/film/c40/<lang>-<aspect>-final.mp4 (video copied, AAC 192k), audio/mix-<lang>.wav, audio/mix-report.json
Voice lines sit at their anchors; a take longer than its window is sped up by at most 1.15x and reported (never re-voiced).
The bed ducks under the voice; master -14 LUFS, true peak -1 dBTP."""
import argparse, json, pathlib, subprocess, sys
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[3]
W = ROOT / "work" / "film" / "c40"
ap = argparse.ArgumentParser(); ap.add_argument("--lang", default="ar"); ap.add_argument("--aspect", default="16x9"); ap.add_argument("--no-voice", action="store_true")
a = ap.parse_args()
def run(*c):
    r = subprocess.run(list(c), capture_output=True, text=True)
    if r.returncode: sys.exit(r.stderr[-1500:])
    return r.stderr
def dur(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)], capture_output=True, text=True).stdout)
spec = json.loads((HERE / "vo-ar.json").read_text(encoding="utf-8"))
vo = W / "audio" / "vo"
lines = [] if a.no_voice or a.lang != "ar" else [l for l in spec["lines"] if (vo / f"{l['n']:02d}.wav").exists()]
report = []
inputs = ["-i", str(W / "audio" / "bed.wav")]
fc = []
labels = []
for i, l in enumerate(lines):
    nxt = [x["atSec"] for x in spec["lines"] if x["atSec"] > l["atSec"]]
    window = (nxt[0] - 0.12 if nxt else 39.8) - l["atSec"]
    src = vo / f"{l['n']:02d}.wav"
    # trim leading/trailing silence only (no speech change)
    trimmed = W / "audio" / f"vo-trim-{l['n']:02d}.wav"
    run("ffmpeg", "-y", "-i", str(src), "-af", "silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=1:stop_threshold=-45dB:stop_duration=0.25", "-ar", "48000", "-ac", "1", str(trimmed))
    d = dur(trimmed); tempo = 1.0
    if d > window: tempo = min(1.15, d / window)
    report.append({"n": l["n"], "atSec": l["atSec"], "takeSec": round(d, 2), "windowSec": round(window, 2), "tempo": round(tempo, 3), "overrunSec": round(max(0, d / tempo - window), 2)})
    inputs += ["-i", str(trimmed)]
    ms = int(l["atSec"] * 1000)
    fc.append(f"[{i+1}:a]atempo={tempo},highpass=f=70,volume=1.0,adelay={ms}|{ms},apad[v{i}]")
    labels.append(f"[v{i}]")
if lines:
    fc.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0:duration=longest,atrim=0:40,aformat=sample_rates=48000:channel_layouts=stereo[vox]")
    fc.append("[vox]asplit=2[vsc][vmix]")
    fc.append("[0:a]atrim=0:40,volume=0.9[bed0]")
    fc.append("[bed0][vsc]sidechaincompress=threshold=0.02:ratio=9:attack=15:release=350:makeup=1[bedd]")
    fc.append("[bedd][vmix]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.0:LRA=9[out]")
else:
    fc.append("[0:a]atrim=0:40,loudnorm=I=-16:TP=-1.0:LRA=9[out]")
mix = W / "audio" / f"mix-{a.lang}.wav"
run("ffmpeg", "-y", *inputs, "-filter_complex", ";".join(fc), "-map", "[out]", "-ar", "48000", "-t", "40", str(mix))
src_v = W / f"{a.lang}-{a.aspect}.mp4"; fin = W / f"{a.lang}-{a.aspect}-final.mp4"
run("ffmpeg", "-y", "-i", str(src_v), "-i", str(mix), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", "40", "-movflags", "+faststart", str(fin))
(W / "audio" / "mix-report.json").write_text(json.dumps({"voiced": bool(lines), "lines": report}, indent=1), encoding="utf-8")
print("voiced" if lines else "NOT VOICED (timing master)", fin)
for r in report: print(r)
