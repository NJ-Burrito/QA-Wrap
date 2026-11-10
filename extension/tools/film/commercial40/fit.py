#!/usr/bin/env python
"""Fit the Arabic takes to their windows WITHOUT re-voicing and without any model (Director, 2026-11-10).

    PYTHONUTF8=1 uv run --with numpy python fit.py

Deterministic edits only, in this order:
  (a) pause tightening: inside a take, any silence (10 ms RMS < -45 dBFS) longer than 0.18 s is cut to 0.18 s,
      0.30 s at a full stop (the n longest pauses of a line whose TTS text has n internal full stops);
      the middle of the pause is removed, 10 ms fades at each cut; every cut is checked to lie in silence;
  (b) atempo (pitch kept), one instance per line, only after (a): per line the larger of what its window needs and
      what brings the finished clip to 112 wpm, 1.0..1.40 (Director ruling 2026-11-10), neighbours within 0.15;
  (c) a line may start up to 0.15 s before its anchor if the previous line has ended (+0.12 s breath).
Line-specific rulings live in vo-ar.json as `fit`: `cutAfterPause` (keep the take up to that pause, 30 ms fade),
`splitAtPause` (two parts at that pause), `parts` (anchor/endBy per part), `endBy`, `startAfterPrev`.
Writes work/film/c40/audio/vo-fit/NN[a|b].wav (48 kHz mono, tempo applied) and vo-fit/fit.json."""
import json, pathlib, re, subprocess, sys
import numpy as np
HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "audio"))
from bed import wav_write  # noqa: E402
ROOT = HERE.parents[3]
A = ROOT / "work" / "film" / "c40" / "audio"
OUT = A / "vo-fit"
SR, H, THR = 48000, 480, -45.0
BREATH, EARLY, MAXT, LAST_END, WPM = 0.12, 0.15, 1.70, 39.6, 112.0  # cap 1.7 + 112 wpm aim: owner pace ruling; line 10 by 39.6 s: Director 2026-11-10


def load(p):
    return np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                                        capture_output=True).stdout, np.float32).astype(np.float64)


def frames_db(x):
    n = len(x) // H
    return 20 * np.log10(np.sqrt(np.mean(x[:n * H].reshape(n, H) ** 2, 1)) + 1e-9)


def pauses(e):
    sp = e > THR
    i0, i1 = int(np.argmax(sp)), len(sp) - int(np.argmax(sp[::-1]))
    out, i = [], i0
    while i < i1:
        if not sp[i]:
            j = i
            while j < i1 and not sp[j]: j += 1
            out.append((i, j)); i = j
        else:
            i += 1
    return i0, i1, out


def fade(x, n, out):
    n = min(n, len(x))
    r = np.linspace(1, 0, n) if out else np.linspace(0, 1, n)
    if out: x[-n:] *= r
    else: x[:n] *= r
    return x


def edit(x, l):
    """-> list of parts (samples), edit log. Cuts only in silence."""
    e = frames_db(x)
    i0, i1, ps = pauses(e)
    F = int(0.010 * SR)
    stops = max(0, l["tts"].count(".") - (1 if l["tts"].rstrip().endswith(".") else 0))
    long_ps = [p for p in ps if (p[1] - p[0]) * 0.01 > 0.18]
    full = set(sorted(long_ps, key=lambda p: p[0] - p[1])[:stops])
    fit = l.get("fit", {})
    cut_after = fit.get("cutAfterPause")      # 1-based index into the line's punctuation pauses (long pauses)
    split_at = fit.get("splitAtPause")
    log = {"pausesCut": [], "cutCheckMaxDb": -120.0}
    # pauses that end/split the take, by order among long pauses
    end_p = long_ps[cut_after - 1] if cut_after else None
    split_p = long_ps[split_at - 1] if split_at else None
    a, b = max(0, i0 - 1) * H, min(len(e), i1 + 1) * H
    segs, cur = [], [a]
    parts, cuts = [], []
    for p in long_ps:
        s, t = p[0] * H, p[1] * H
        if p is end_p:
            s += 2 * F; cur.append(s); segs.append(cur); cur = None; cuts.append(s)
            log["cut"] = round(s / SR, 3)
            break
        if p is split_p:
            s, t = s + 2 * F, t - 2 * F; cur.append(s); segs.append(cur); parts.append(segs); segs = []; cur = [t]; cuts += [s, t]
            log["split"] = [round(s / SR, 3), round(t / SR, 3)]
            continue
        keep = int((0.30 if p in full else 0.18) * SR)
        cur.append(s + keep // 2); segs.append(cur); cur = [t - (keep - keep // 2)]; cuts += [s + keep // 2, t - (keep - keep // 2)]
        log["pausesCut"].append([round(s / SR, 3), round((t - s) / SR, 3), round(keep / SR, 2)])
    if cur is not None:
        cur.append(b); segs.append(cur)
    parts.append(segs)
    out = []
    for segs in parts:
        y = []
        for k, (s, t) in enumerate(segs):
            seg = x[s:t].copy()
            fd = int((0.030 if (cut_after and k == len(segs) - 1 and segs is parts[-1]) else 0.010) * SR)
            y.append(fade(fade(seg, F, False), fd, True))
        out.append(np.concatenate(y))
    for c in cuts:  # every cut must sit in silence: +-10 ms around it below the -45 dBFS speech threshold
        lo, hi = max(0, c - F), min(len(x), c + F)
        log["cutCheckMaxDb"] = max(log["cutCheckMaxDb"], 20 * np.log10(np.sqrt(np.mean(x[lo:hi] ** 2)) + 1e-9))
    log["cutCheckMaxDb"] = round(log["cutCheckMaxDb"], 1)
    if log["cutCheckMaxDb"] > THR: sys.exit(f"V{l['n']}: a cut lands in speech ({log['cutCheckMaxDb']} dBFS)")
    return out, log


def tempo(y, t):
    if t <= 1.0001: return y
    tmp = OUT / "_t.wav"; wav_write(tmp, y)
    z = load_f(tmp, f"atempo={t:.4f}"); tmp.unlink()
    return z


def load_f(p, af):
    return np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-af", af, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                                        capture_output=True).stdout, np.float32).astype(np.float64)


def main():
    spec = json.loads((HERE / "vo-ar.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    L = spec["lines"]
    # flatten into placed segments with anchors / end limits
    items = []
    for i, l in enumerate(L):
        src = A / "vo" / f"{l['n']:02d}.wav"
        if not src.exists(): continue
        x = load(src)
        parts, log = edit(x, l)
        fit = l.get("fit", {})
        nxt = L[i + 1]["atSec"] if i + 1 < len(L) else None
        pinfo = fit.get("parts") or [{"anchor": l["atSec"], "endBy": fit.get("endBy")}]
        for k, (y, pi) in enumerate(zip(parts, pinfo)):
            end_by = pi.get("endBy") or ((nxt - BREATH) if nxt is not None and k == len(parts) - 1 else LAST_END)
            if nxt is not None and k == len(parts) - 1 and not pi.get("endBy"): end_by = min(end_by, nxt - BREATH)
            items.append({"n": l["n"], "part": "ab"[k] if len(parts) > 1 else "", "anchor": pi["anchor"], "endBy": round(end_by, 3),
                          "startAfterPrev": fit.get("startAfterPrev", False), "startAt": fit.get("startAt"), "takeSec": round(len(x) / SR, 3),
                          "editedSec": round(len(y) / SR, 3), "edit": log, "_y": y})
    # tempo per LINE (Director + owner pace ruling 2026-11-10): max(what the window needs, what lands the finished clip
    # at 112 wpm), never below 1.0, never above 1.7, and not past 120 wpm unless the window itself needs it.
    # fit.tempoRule "fitOnly": only the window's need (line 1: 3 words, the band would need > 1.7x). Split parts share a tempo.
    MARKS = re.compile("[ً-ْٰ]")
    ns = sorted({it["n"] for it in items})
    words = {l["n"]: len(MARKS.sub("", l.get("ttsUsed", l["tts"])).split()) for l in L}
    rule = {l["n"]: l.get("fit", {}).get("tempoRule") for l in L}
    dsum = {n: sum(i["editedSec"] for i in items if i["n"] == n) for n in ns}
    t_at = lambda n, w: dsum[n] / (words[n] / w * 60)  # tempo that puts line n at w wpm
    tl = {n: 1.0 if rule[n] == "fitOnly" else min(MAXT, max(1.0, t_at(n, WPM))) for n in ns}
    wpm_t = dict(tl)
    def place():
        prev_end, raised = 0.0, False
        for it in items:
            t = tl[it["n"]]; d = it["editedSec"] / t + 0.02  # atempo output runs up to ~15 ms long: plan with 20 ms margin
            earliest = max(it.get("startAt") or (it["anchor"] - EARLY), prev_end + BREATH)
            start = max(it["anchor"], prev_end + BREATH) if it["startAfterPrev"] else it["anchor"]
            if start < prev_end + BREATH: start = prev_end + BREATH  # never overlap the previous line
            if it.get("startAt"): start = max(it["startAt"], prev_end + BREATH)  # a ruled start (line 10: 36.04 s)
            elif start + d > it["endBy"]: start = max(earliest, min(start, it["endBy"] - d))
            if start + d > it["endBy"] + 1e-6 and t < MAXT:  # the window needs more tempo
                tl[it["n"]] = min(MAXT, it["editedSec"] / (it["endBy"] - 0.02 - start)); raised = True
                return True
            it["_start"] = start; prev_end = start + d
        return raised

    for _ in range(200):
        if not place(): break
    over120 = [n for n in ns if tl[n] > max(1.0, t_at(n, 120.0)) + 1e-6]  # only the window can have pushed these
    for it in items:
        t = round(tl[it["n"]], 4)
        y = tempo(it.pop("_y"), t)
        fin = len(y) / SR
        start = it.pop("_start")
        it.update({"start": round(start, 3), "tempo": round(t, 3), "tempoForWpm": round(wpm_t[it["n"]], 3), "words": words[it["n"]],
                   "windowPushedPast120": it["n"] in over120,
                   "finishedSec": round(fin, 3), "end": round(start + fin, 3),
                   "window": [round(start, 3), it["endBy"]], "overrunMs": round(max(0, start + fin - it["endBy"]) * 1000)})
        name = f"{it['n']:02d}{it['part']}.wav"
        wav_write(OUT / name, y); it["file"] = name
    (OUT / "fit.json").write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    for it in items:
        print(f"V{it['n']}{it['part']:1} take {it['takeSec']:5.2f} edited {it['editedSec']:5.2f} tempo {it['tempo']:.3f} "
              f"start {it['start']:6.2f} end {it['end']:6.2f} endBy {it['endBy']:6.2f} overrun {it['overrunMs']:4d} ms  "
              f"cuts {len(it['edit']['pausesCut'])} cutMax {it['edit']['cutCheckMaxDb']} dB")


main()
