#!/usr/bin/env python
"""Fit one brand film's takes to their windows and the pace band, no model, no re-voice (worker bv, 2026-11-10).
Generalised from commercial40/fit.py.

    PYTHONUTF8=1 uv run --with numpy --with scipy python fit.py <slug> <en|ar>

Deterministic edits, in order:
  (a) trim head/tail silence; every internal silence (10 ms RMS < -45 dBFS) longer than 0.18 s is cut to 0.18 s,
      0.30 s at a full stop (the n longest pauses where the text has n internal sentence ends); the middle of the
      pause is removed with 10 ms fades (if 0.18/0.30 alone would put a take above the band's top, the kept pause
      steps to 0.25/0.40, 0.35/0.50, 0.50/0.70, 0.80/1.00 until it is not; pauseKeep in fit json); every cut is checked to sit in silence (else the film stops);
  (b) atempo (pitch kept), never below 1.0, cap 1.7: max(what lands the clip just inside the pace band (AR 110-120,
      EN 145-155 from voice-styles.json), what ends the line inside its window);
  (c) a line may start up to 0.2 s before its scripted start if the previous line has ended (+0.12 s breath), never
      inside the film's deliberate silence; lines never overlap; the last line ends >= 0.4 s before the film's end.
Window = voice start to the end of its last caption (films.json fit.window), and never past the next line's start.
Writes work/film/brand/<slug>/audio/vo-fit-<lang>/<V>.wav, fit-<lang>.json, and the finished seconds + tempo of
each line into work/film/brand/narration-manifest.json (the fields voice_style_gate.py reads in full mode)."""
import json, pathlib, re, subprocess, sys
import numpy as np
HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "audio"))
from bed import wav_write  # noqa: E402
ROOT = HERE.parents[4]
B = ROOT / "work" / "film" / "brand"
SR, H, THR = 48000, 480, -45.0
BREATH, EARLY, MAXT, END_PAD = 0.12, 0.20, 1.70, 0.40
KEEPS = [(0.18, 0.30), (0.25, 0.40), (0.35, 0.50), (0.50, 0.70), (0.80, 1.00)]
REG = pathlib.Path.home() / "Desktop" / "nj-plugin" / "skills" / "nj-writer" / "voice-styles.json"
BAND = json.loads(REG.read_text(encoding="utf-8"))["pace_target_wpm"]["band"]


def ff(p, af=None):
    c = ["ffmpeg", "-v", "error", "-i", str(p)] + (["-af", af] if af else []) + ["-f", "f32le", "-ac", "1", "-ar", str(SR), "-"]
    return np.frombuffer(subprocess.run(c, capture_output=True).stdout, np.float32).astype(np.float64)


def frames_db(x):
    n = len(x) // H
    return 20 * np.log10(np.sqrt(np.mean(x[:n * H].reshape(n, H) ** 2, 1)) + 1e-9)


def fade(x, n, out):
    n = min(n, len(x))
    if out: x[-n:] *= np.linspace(1, 0, n)
    else: x[:n] *= np.linspace(0, 1, n)
    return x


def edit(x, text, lid, ks=0.18, kf=0.30):
    e = frames_db(x)
    sp = e > THR
    i0, i1 = int(np.argmax(sp)), len(sp) - int(np.argmax(sp[::-1]))
    ps, i = [], i0
    while i < i1:
        if not sp[i]:
            j = i
            while j < i1 and not sp[j]: j += 1
            ps.append((i, j)); i = j
        else:
            i += 1
    F = int(0.010 * SR)
    stops = len(re.findall(r"[.?!؟]\s+\S", text))
    long_ps = [p for p in ps if (p[1] - p[0]) * 0.01 > ks]
    full = set(sorted(long_ps, key=lambda p: p[0] - p[1])[:stops])
    a, b = max(0, i0 - 1) * H, min(len(e), i1 + 1) * H
    segs, cur, cuts = [], [a], []
    for p in long_ps:
        s, t = p[0] * H, p[1] * H
        keep = int((kf if p in full else ks) * SR)
        cur.append(s + keep // 2); segs.append(cur); cur = [t - (keep - keep // 2)]
        cuts += [s + keep // 2, t - (keep - keep // 2)]
    cur.append(b); segs.append(cur)
    y = np.concatenate([fade(fade(x[s:t].copy(), F, False), F, True) for s, t in segs])
    worst = -120.0
    for c in cuts:
        lo, hi = max(0, c - F), min(len(x), c + F)
        worst = max(worst, 20 * np.log10(np.sqrt(np.mean(x[lo:hi] ** 2)) + 1e-9))
    if worst > THR: sys.exit(f"{lid}: a cut lands in speech ({worst:.1f} dBFS)")
    return y, len(long_ps), round(worst, 1)


def main(slug, lang):
    film = next(f for f in json.loads((B / "films.json").read_text(encoding="utf-8"))["films"] if f["slug"] == slug)
    man_p = B / "narration-manifest.json"
    man = json.loads(man_p.read_text(encoding="utf-8"))
    mlines = {l["id"]: l for l in man["lines"]}
    D = float(film["duration"])
    sil = film["bed"].get("silence")
    lo, hi = BAND[lang]
    out_dir = B / slug / "audio" / f"vo-fit-{lang}"
    out_dir.mkdir(parents=True, exist_ok=True)
    V = film["voice"]
    items = []
    for k, v in enumerate(V):
        lid = f"{slug}-{v['id']}-{lang}"
        src = B / "vo" / slug / f"{lid}.wav"
        if not src.exists(): sys.exit(f"missing take {src}")
        x = ff(src)
        m = mlines[lid]
        words = len(m["text"].split())
        # tighten to 0.18/0.30 s; if that alone pushes the line past the band's top (takes are never slowed), keep
        # the pauses a little longer, step by step, until the clip is back under the top of the band
        for ks, kf in KEEPS:
            y, npause, worst = edit(x, m.get("tts_text") or m["text"], lid, ks, kf)
            if words / (len(y) / SR) * 60 <= hi - 1: break
        start0 = float(v["startSec"])
        end_by = start0 + float(v["fit"]["window"])
        if k + 1 < len(V): end_by = min(end_by, float(V[k + 1]["startSec"]) - BREATH)
        else: end_by = min(end_by, D - END_PAD)
        if sil and start0 < sil[0]: end_by = min(end_by, sil[0])
        d = len(y) / SR
        t_band = max(1.0, (lo + 1.5) * d / (60 * words))  # just enough to land inside the band; never slowed
        items.append(dict(id=lid, v=v["id"], words=words, style=m["style"], takeSec=round(len(x) / SR, 3), editedSec=round(d, 3),
                          pausesCut=npause, pauseKeep=[ks, kf], cutCheckMaxDb=worst, scripted=start0, endBy=round(end_by, 3), tBand=t_band, _y=y))
    prev_end = 0.0
    for it in items:
        earliest = max(it["scripted"] - EARLY, prev_end + BREATH)
        if sil and it["scripted"] >= sil[1]: earliest = max(earliest, sil[1])
        t = min(MAXT, it["tBand"])
        start = max(it["scripted"], prev_end + BREATH)
        dur = it["editedSec"] / t + 0.02  # atempo runs up to ~15 ms long
        if start + dur > it["endBy"]:
            start = max(earliest, it["endBy"] - dur)
            if start + dur > it["endBy"]:
                t = min(MAXT, max(t, it["editedSec"] / (it["endBy"] - 0.02 - start)))
        y = it.pop("_y")
        if t > 1.0001:
            tmp = out_dir / "_t.wav"; wav_write(tmp, y); y = ff(tmp, f"atempo={t:.4f}"); tmp.unlink()
        fin = len(y) / SR
        wpm = it["words"] / fin * 60
        it.update(tempo=round(t, 3), tempoForBand=round(it.pop("tBand"), 3), start=round(start, 3), end=round(start + fin, 3),
                  finishedSec=round(fin, 3), wpm=round(wpm, 1), inBand=bool(lo <= wpm <= hi),
                  overrunMs=int(round(max(0.0, start + fin - it["endBy"]) * 1000)), file=f"vo-fit-{lang}/{it['v']}.wav")
        wav_write(out_dir / f"{it['v']}.wav", y)
        prev_end = start + fin
        ml = mlines[it["id"]]
        ml["seconds"], ml["tempo"] = it["finishedSec"], it["tempo"]
    man["note"] = "seconds = finished (fitted) clip, tempo = applied atempo; written by extension/tools/film/brand/audio/fit.py"
    man_p.write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")
    (B / slug / "audio" / f"fit-{lang}.json").write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    for it in items:
        print(f"{it['id']:24} take {it['takeSec']:5.2f} edit {it['editedSec']:5.2f} t {it['tempo']:.3f} start {it['start']:6.2f} "
              f"end {it['end']:6.2f} by {it['endBy']:6.2f} wpm {it['wpm']:5.1f} {'ok ' if it['inBand'] else 'OUT'} over {it['overrunMs']} ms")


main(sys.argv[1], sys.argv[2])
