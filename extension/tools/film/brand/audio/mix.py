#!/usr/bin/env python
"""Mix one brand film in one language (copied from commercial40/mix.py, generalised; worker bv, 2026-11-10).

    PYTHONUTF8=1 python mix.py <slug> <en|ar>

Inputs : work/film/brand/<slug>/audio/stems/{bed,sfx}.wav (bedsfx.py), fit-<lang>.json + vo-fit-<lang>/*.wav (fit.py),
         work/film/brand/room-ir.wav (audio/room.py).
Output : work/film/brand/<slug>/audio/mix-<lang>.wav (48 kHz stereo 24-bit, exact film duration) and
         mix-report-<lang>.json. Voice at its fitted starts; the bed is CARVED under the voice (only its 250 Hz-3 kHz
         band sidechain-ducked, as the commercial); SFX never ducked; the film's deliberate silence held at -75 dB;
         tail faded from films.json bed.tailFadeSec. The voice gain is solved for -14 LUFS integrated (+-0.3), then a
         4x-oversampled limiter keeps the true peak <= -1.5 dBTP (AAC headroom); both are measured, not assumed.
MIX-FINAL-<lang>.txt (sha256 of the mix) is written only when loudness, true peak and duration all pass."""
import hashlib, json, pathlib, re, subprocess, sys
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[4]
B = ROOT / "work" / "film" / "brand"
TARGET, TOL, TP_MAX = -14.0, 0.3, -1.5


def run(*c):
    r = subprocess.run(list(c), capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode: sys.exit(r.stderr[-1500:])
    return r.stderr


def measure(p):
    e = run("ffmpeg", "-nostats", "-i", str(p), "-af", "ebur128=peak=true", "-f", "null", "-")
    s = e[e.rfind("Summary:"):]
    d = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                             capture_output=True, text=True).stdout)
    return float(re.search(r"I:\s*(-?[\d.]+) LUFS", s).group(1)), float(re.search(r"Peak:\s*(-?[\d.]+|-inf) dBFS", s).group(1)), d


slug, lang = sys.argv[1], sys.argv[2]
film = next(f for f in json.loads((B / "films.json").read_text(encoding="utf-8"))["films"] if f["slug"] == slug)
D, T, sil = float(film["duration"]), float(film["bed"]["tailFadeSec"]), film["bed"].get("silence")
A = B / slug / "audio"
fit = json.loads((A / f"fit-{lang}.json").read_text(encoding="utf-8"))
inputs = ["-i", str(A / "stems" / "bed.wav"), "-i", str(A / "stems" / "sfx.wav"), "-i", str(B / "room-ir.wav")]
fc = []
for i, f in enumerate(fit):
    inputs += ["-i", str(A / f["file"])]
    fc.append(f"[{i+3}:a]adelay={int(round(f['start'] * 1000))}:all=1,apad[v{i}]")
hold = f"volume='if(between(t,{sil[0]},{sil[1]}),0.000178,1)':eval=frame," if sil else ""  # -75 dB


def build(gain_db, limit, out):
    g = list(fc)
    g.append("".join(f"[v{i}]" for i in range(len(fit))) + f"amix=inputs={len(fit)}:normalize=0:duration=longest,atrim=0:{D},"
             "highpass=f=90:poles=2,acompressor=threshold=-20dB:ratio=3:attack=8:release=140:knee=6:makeup=2,"
             f"volume={gain_db:.2f}dB,asplit=2[dry][wi]")
    g.append("[wi][2:a]afir=dry=0:wet=1:gtype=none,volume=0.30[wet]")
    g.append("[dry][wet]amix=inputs=2:weights='1 0.16':normalize=0,aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[vk][vm]")
    g.append("[0:a]acrossover=split=250 3000[bl][bm][bh]")
    g.append("[bm][vk]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=320:makeup=1[bmd]")
    g.append("[bl][bmd][bh]amix=inputs=3:normalize=0[bedc]")
    g.append(f"[bedc][1:a][vm]amix=inputs=3:normalize=0,apad,atrim=0:{D},{hold}"
             f"afade=t=out:st={T}:d={D - T - 0.02:.3f},"
             f"aresample=192000,alimiter=limit={limit:.4f}:attack=1:release=60:level=disabled,aresample=48000[o]")
    run("ffmpeg", "-y", *inputs, "-filter_complex", ";".join(g), "-map", "[o]", "-ac", "2", "-ar", "48000",
        "-t", f"{D}", "-c:a", "pcm_s24le", str(out))


mix = A / f"mix-{lang}.wav"
final = A / f"MIX-FINAL-{lang}.txt"
if final.exists(): final.unlink()  # a re-mix is not final until it passes again
gain, limit = 0.0, 0.80
for _ in range(8):
    build(gain, limit, mix)
    I, tp, d = measure(mix)
    if tp > TP_MAX - 0.05:
        limit *= 10 ** ((TP_MAX - 0.15 - tp) / 20); continue
    if abs(I - TARGET) <= 0.1: break
    gain += TARGET - I
ok = abs(I - TARGET) <= TOL and tp <= TP_MAX and abs(d - D) < 0.001
rep = {"film": slug, "lang": lang, "voiceGainDb": round(gain, 2), "limiter": round(limit, 4), "integratedLufs": I, "truePeakDbtp": tp,
       "durationSec": d, "pass": ok, "lines": [{k: f[k] for k in ("id", "start", "end", "tempo", "wpm", "inBand", "overrunMs")} for f in fit]}
(A / f"mix-report-{lang}.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
if ok:
    final.write_text(hashlib.sha256(mix.read_bytes()).hexdigest() + "  " + mix.name + "\n", encoding="utf-8")
print(f"{slug} {lang}: I {I} LUFS  TP {tp} dBTP  dur {d:.3f}/{D}  gain {gain:+.2f} dB  {'FINAL' if ok else 'NOT FINAL'}")
