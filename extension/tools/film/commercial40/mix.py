#!/usr/bin/env python
"""Mix the Arabic 40 s film's audio (no mux: the Director orders the mux).

    PYTHONUTF8=1 uv run --with numpy --with scipy python mix.py [--no-voice]

Inputs : work/film/c40/audio/stems/{bed,sfx}.wav (bedsfx.py: bed + SFX on the hits measured on the EN film),
         work/film/c40/audio/vo/NN.wav (voice-ar.py), work/film/c40/audio/room-ir.wav (audio/room.py)
Output : work/film/c40/audio/mix-ar.wav (48 kHz stereo 24-bit, exactly 40.000 s), audio/mix-report.json,
         and the measured seconds/tempo written back into audio/narration-manifest.json.
Voice lines sit at their vo-ar.json atSec; a take longer than its window is sped up by at most 1.15x and the
overrun is reported (never re-voiced). The bed is CARVED under the voice (only its 250 Hz-3 kHz band is
sidechain-ducked, hyperframes-audio voiceover-carve convention); the SFX bus is never ducked, so the hits
stay audible under the voice as in EN. Master: the voice level is solved so the whole mix is -14 LUFS
integrated with the bed and SFX at their calibrated EN level, then a -1 dBTP ceiling.
--no-voice: writes mix-ar-novoice.wav (bed + SFX only, no loudness change) as a timing master."""
import argparse, json, pathlib, re, subprocess, sys
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[3]
A = ROOT / "work" / "film" / "c40" / "audio"
LAST_END = 38.95  # EN voice ends ~38.9; the tail fade starts at 39.0
ap = argparse.ArgumentParser(); ap.add_argument("--no-voice", action="store_true")
ap.add_argument("--vo", help="voice take folder (default audio/vo); for a dry test only")
ap.add_argument("--out", help="mix file (default audio/mix-ar.wav)")
a = ap.parse_args()


def run(*c):
    r = subprocess.run(list(c), capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode: sys.exit(r.stderr[-1500:])
    return r.stderr


def dur(p):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                                capture_output=True, text=True).stdout)


def lufs(p):
    e = run("ffmpeg", "-nostats", "-i", str(p), "-af", "ebur128=peak=true", "-f", "null", "-")
    s = e[e.rfind("Summary:"):]
    return float(re.search(r"I:\s*(-?[\d.]+) LUFS", s).group(1)), float(re.search(r"Peak:\s*(-?[\d.]+|-inf) dBFS", s).group(1))


spec = json.loads((HERE / "vo-ar.json").read_text(encoding="utf-8"))
vo = pathlib.Path(a.vo) if a.vo else A / "vo"
bed, sfx, ir = A / "stems" / "bed.wav", A / "stems" / "sfx.wav", A / "room-ir.wav"
if a.no_voice:
    out = A / "mix-ar-novoice.wav"
    run("ffmpeg", "-y", "-i", str(bed), "-i", str(sfx), "-filter_complex", "[0:a][1:a]amix=inputs=2:normalize=0,atrim=0:40[o]",
        "-map", "[o]", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s24le", str(out))
    print("NOT VOICED (timing master)", out, lufs(out)); sys.exit(0)

fitj = json.loads(((vo.parent if a.vo else A) / "vo-fit" / "fit.json").read_text(encoding="utf-8"))  # fit.py: edited takes + placement
segs = [f for f in fitj if f["n"] in {l["n"] for l in spec["lines"]}]
lines = sorted({f["n"] for f in segs})
missing = [l["n"] for l in spec["lines"] if l["n"] not in lines]
report, fc, inputs = [], [], ["-i", str(bed), "-i", str(sfx), "-i", str(ir)]
for i, f in enumerate(segs):
    report.append({k: f[k] for k in ("n", "part", "takeSec", "editedSec", "tempo", "start", "end", "window", "overrunMs", "finishedSec")})
    inputs += ["-i", str((vo.parent if a.vo else A) / "vo-fit" / f["file"])]
    ms = int(round(f["start"] * 1000))
    fc.append(f"[{i+3}:a]adelay={ms}:all=1,apad[v{i}]")


def build(gain_db, out):
    g = list(fc)
    g.append("".join(f"[v{i}]" for i in range(len(segs))) + f"amix=inputs={len(segs)}:normalize=0:duration=longest,atrim=0:40,"
             "highpass=f=90:poles=2,acompressor=threshold=-20dB:ratio=3:attack=8:release=140:knee=6:makeup=2,"
             f"volume={gain_db:.2f}dB,asplit=2[dry][wi]")
    g.append("[wi][2:a]afir=dry=0:wet=1:gtype=none,volume=0.30[wet]")
    g.append("[dry][wet]amix=inputs=2:weights='1 0.16':normalize=0,aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[vk][vm]")
    # carve: only the bed's voice band ducks
    g.append("[0:a]acrossover=split=250 3000[bl][bm][bh]")
    g.append("[bm][vk]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=320:makeup=1[bmd]")
    g.append("[bl][bmd][bh]amix=inputs=3:normalize=0[bedc]")
    g.append("[bedc][1:a][vm]amix=inputs=3:normalize=0,atrim=0:40,"
             # the film's hard silence (EN: digital zero 9.53-9.98) holds for the voice bus and the room tail too
             "volume='if(between(t,9.53,9.98),0,1)':eval=frame,"
             # true-peak ceiling: limit at 4x oversampling so inter-sample peaks stay under -1 dBTP
             "aresample=192000,alimiter=limit=0.83:attack=1:release=60:level=disabled,aresample=48000[o]")
    run("ffmpeg", "-y", *inputs, "-filter_complex", ";".join(g), "-map", "[o]", "-ac", "2", "-ar", "48000",
        "-t", "40", "-c:a", "pcm_s24le", str(out))


mix = pathlib.Path(a.out) if a.out else A / "mix-ar.wav"
test = bool(a.vo)
gain = 0.0
for _ in range(5):  # solve the voice level for -14 LUFS integrated (bed and SFX stay at the EN level)
    build(gain, mix)
    I, tp = lufs(mix)
    if abs(I + 14) <= 0.1: break
    gain += (-14 - I)
(A / ("mix-report-test.json" if test else f"mix-report-{mix.stem}.json")).write_text(json.dumps({"voiced": len(lines), "missing": missing, "voiceGainDb": round(gain, 2),
                                                "integratedLufs": I, "truePeakDbtp": tp, "lines": report}, indent=1), encoding="utf-8")
man = A / "narration-manifest.json"
if man.exists() and not test:
    m = json.loads(man.read_text(encoding="utf-8"))
    for l in m["lines"]:
        rs = [r for r in report if r["n"] == l["id"]]
        if rs:  # a split line counts its parts' spoken seconds together
            l["seconds"], l["tempo"] = round(sum(r["finishedSec"] for r in rs), 3), max(r["tempo"] for r in rs)
    man.write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"mix {mix}  voiced {len(lines)}/10  missing {missing}  I {I} LUFS  TP {tp} dBTP  voice gain {gain:+.2f} dB")
for r in report: print(r)
