#!/usr/bin/env python
"""The audio QC harness and build gate.  Builder B, film pipeline.

Reports, for any audio file:

  * integrated loudness, max short-term, max momentary, true peak (ffmpeg
    `ebur128` - the same meter the critic will run);
  * the engine test: the 20-200 Hz band's 20 ms RMS envelope, and the fraction
    of the time it sits below -25 dB of its own peak.  The bed must score
    >= 70 %.  The old bed scored 0.0 %;
  * the gap list: every run quieter than -40 dBFS lasting >= 0.4 s, checked
    against the rests the cue file declares;
  * stereo width: L/R correlation, side-minus-mid, and the loss on folding
    down to mono - the phone-speaker test.

Exits non-zero on any miss, so it can stand in a build chain.

Usage:
    python measure.py out/bed-qa-wrap.wav --as bed
    python measure.py out/qa-wrap-vo.wav  --as voice  --cues cues/qa-wrap.cues.json
    python measure.py out/qa-wrap.master.m4a --as master --cues cues/qa-wrap.cues.json \
        --json out/qa-wrap.audio.json --spectrogram out/qa-wrap.master.png
    python measure.py anything.wav --as any --presence
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys

import numpy as np
from scipy.signal import butter, sosfiltfilt

SR = 48000
HERE = pathlib.Path(__file__).resolve().parent

ENGINE_MIN_SILENCE_PCT = 70.0  # research/32-sound-design.md rule 5
GAP_SEC = 0.4
GAP_DBFS = -40.0


def run(args):
    return subprocess.run(args, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")


def channels(path):
    r = run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
             "stream=channels", "-of", "csv=p=0", str(path)])
    try:
        return int(r.stdout.strip().splitlines()[0])
    except Exception:
        return 2


def decode(path, ch=None):
    """Decode to float32 at 48 kHz without touching the disk. -> (n, ch)."""
    ch = ch or channels(path)
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le",
         "-acodec", "pcm_f32le", "-ac", str(ch), "-ar", str(SR), "-"],
        capture_output=True)
    if r.returncode:
        raise RuntimeError(r.stderr.decode("utf-8", "replace")[:400])
    return np.frombuffer(r.stdout, dtype="<f4").astype(np.float64).reshape(-1, ch)


# --------------------------------------------------------------------------
# Loudness, via the meter the acceptance checklist names
# --------------------------------------------------------------------------


def loudness(path):
    # No `framelog=verbose`: that demotes the per-frame M:/S: lines to the
    # verbose log level, where they are invisible at the default loglevel.
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af",
             "ebur128=peak=true", "-f", "null", "-"])
    log = r.stderr
    out = {"integratedLufs": None, "maxShortTermLufs": None,
           "maxMomentaryLufs": None, "truePeakDbtp": None}
    s = [float(v) for v in re.findall(r"\bS:\s*(-?\d+\.\d+)", log)
         if float(v) > -70.0]
    m = [float(v) for v in re.findall(r"\bM:\s*(-?\d+\.\d+)", log)
         if float(v) > -70.0]
    if s:
        out["maxShortTermLufs"] = round(max(s), 2)
    if m:
        out["maxMomentaryLufs"] = round(max(m), 2)
    tail = log[log.rfind("Summary:") :] if "Summary:" in log else log
    i = re.search(r"I:\s*(-?\d+\.\d+)\s*LUFS", tail)
    p = re.search(r"Peak:\s*(-?\d+\.\d+)\s*dBFS", tail)
    if i:
        out["integratedLufs"] = round(float(i.group(1)), 2)
    if p:
        out["truePeakDbtp"] = round(float(p.group(1)), 2)
    return out


def mono_fold(path):
    """Loudness lost when the mix is folded down and played back through both
    speakers - the phone-speaker test.

    The fold is to DUAL MONO, not to a one-channel file.  BS.1770 sums channel
    powers, so collapsing correlated stereo into a single channel drops the
    reading 3.01 dB by construction and measures nothing about the mix.  What
    matters is whether the balance survives phase cancellation, and that is
    what the dual-mono fold shows.  (AES TD1008 section 8.)"""
    st = loudness(path)["integratedLufs"]
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af",
             "pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1,ebur128=peak=true",
             "-f", "null", "-"])
    tail = r.stderr[r.stderr.rfind("Summary:") :]
    i = re.search(r"I:\s*(-?\d+\.\d+)\s*LUFS", tail)
    if st is None or not i:
        return None
    return round(float(i.group(1)) - st, 2)


# --------------------------------------------------------------------------
# The engine test - the only rule the bed really has
# --------------------------------------------------------------------------


def rms_env(x, block=0.020):
    n = int(block * SR)
    k = len(x) // n
    return np.sqrt(np.mean(x[: k * n].reshape(k, n) ** 2, axis=1))


def engine(x):
    """Band-limit 20-200 Hz, take the 20 ms RMS envelope, and ask how much of
    the time the low band is actually off."""
    m = x.mean(axis=1) if x.ndim > 1 else x
    sos = butter(4, [20 / (SR / 2), 200 / (SR / 2)], btype="band", output="sos")
    low = sosfiltfilt(sos, m)
    e = rms_env(low)
    peak = e.max()
    if peak <= 0:
        return {"lowBandSilencePct25": 100.0, "lowBandSilencePct40": 100.0,
                "lowBandCrestDb": 0.0}
    db = 20 * np.log10(np.maximum(e, 1e-12) / peak)
    crest = 20 * np.log10(np.max(np.abs(low)) / (np.sqrt(np.mean(low**2)) + 1e-12))
    return {
        "lowBandSilencePct25": round(float((db < -25).mean() * 100), 1),
        "lowBandSilencePct40": round(float((db < -40).mean() * 100), 1),
        "lowBandCrestDb": round(float(crest), 1),
    }


# --------------------------------------------------------------------------
# Gaps
# --------------------------------------------------------------------------


def gaps(x, thresh_db=GAP_DBFS, min_sec=GAP_SEC):
    """Peak-per-block, not RMS: this is what `silencedetect=noise=-40dB:d=0.4`
    measures, and that command is the acceptance test in the bible 8.4.  An
    RMS reading would call the space between two hat hits silence."""
    m = np.max(np.abs(x), axis=1) if x.ndim > 1 else np.abs(x)
    n = int(0.020 * SR)
    k = len(m) // n
    e = np.max(m[: k * n].reshape(k, n), axis=1)
    quiet = 20 * np.log10(np.maximum(e, 1e-12)) < thresh_db
    out, i, n = [], 0, len(quiet)
    while i < n:
        if quiet[i]:
            j = i
            while j < n and quiet[j]:
                j += 1
            dur = (j - i) * 0.020
            if dur >= min_sec:
                out.append({"fromSec": round(i * 0.020, 3),
                            "toSec": round(j * 0.020, 3),
                            "durSec": round(dur, 3)})
            i = j
        else:
            i += 1
    return out


def classify_gaps(found, rests, tol=0.20):
    """Match every found gap to the rest that declares it, and carry that
    rest's authoring beat onto the gap.

    Bible 8.4 checks declared gaps for *authorship*, not for length: each one
    must trace to a decision in 3.3, 4 or 6.5.  A gap that traces to nothing
    is dead air and fails, so a declaration with no `why` is not a
    declaration."""
    for g in found:
        g["declared"] = False
        g["why"] = None
        for r in rests:
            if (g["fromSec"] >= r["fromSec"] - tol
                    and g["toSec"] <= r["toSec"] + tol):
                g["why"] = (r.get("why") or "").strip() or None
                g["declared"] = g["why"] is not None
                r["_matched"] = True
                break
    return found


# --------------------------------------------------------------------------
# Pitch: the anti-robotic gate
# --------------------------------------------------------------------------


def f0_track(x, fmin=70.0, fmax=500.0, frame=0.025, hop=0.010, gate_db=-38.0):
    """Normalised autocorrelation f0 with parabolic interpolation.

    Returns (times, f0) over voiced frames only.  This is the estimator R3
    used; it is enough for a standard deviation and a terminal slope, which
    are the two things a delivery is judged on."""
    m = x.mean(axis=1) if x.ndim > 1 else x
    n = int(frame * SR)
    h = int(hop * SR)
    lo, hi = int(SR / fmax), int(SR / fmin)
    peak = np.max(np.abs(m)) + 1e-12
    ts, fs = [], []
    for i in range(0, max(0, len(m) - n), h):
        fr = m[i : i + n]
        rms = np.sqrt(np.mean(fr**2))
        if 20 * np.log10(rms / peak + 1e-12) < gate_db:
            continue
        fr = fr - fr.mean()
        ac = np.correlate(fr, fr, "full")[n - 1 :]
        if ac[0] <= 0:
            continue
        ac = ac / ac[0]
        seg = ac[lo:hi]
        if not len(seg):
            continue
        k = int(np.argmax(seg))
        if seg[k] < 0.35:
            continue
        j = lo + k
        # parabolic interpolation around the peak
        if 0 < j < len(ac) - 1:
            a, b, c = ac[j - 1], ac[j], ac[j + 1]
            d = a - 2 * b + c
            j = j + (0.5 * (a - c) / d) if abs(d) > 1e-12 else j
        ts.append((i + n / 2) / SR)
        fs.append(SR / j)
    return np.array(ts), np.array(fs)


def st(f, ref=None):
    """Hz -> semitones, relative to the median (or a given reference)."""
    f = np.asarray(f, dtype=float)
    ref = ref if ref else (np.median(f) if len(f) else 1.0)
    return 12 * np.log2(np.maximum(f, 1e-9) / ref)


def pitch_report(x):
    """f0 spread in semitones.  R3 rule 5: a line whose f0 standard deviation
    measures below 3.8 ST is flatter than ordinary conversation - that is the
    'robotic', and it is the pass mark."""
    t, f = f0_track(x)
    if len(f) < 8:
        return {"f0Frames": int(len(f))}
    s = st(f)
    lo, hi = np.percentile(f, [5, 95])
    return {
        "f0Frames": int(len(f)),
        "f0MedianHz": round(float(np.median(f)), 1),
        "f0SdSemitones": round(float(np.std(s)), 2),
        "f0Range5to95St": round(float(12 * np.log2(hi / max(lo, 1e-9))), 2),
        "f0P5Hz": round(float(lo), 1),
        "f0P95Hz": round(float(hi), 1),
    }


def terminal_slope(x, window=0.150):
    """Semitones per second over the last `window` of voiced speech.

    R3 measured punctuation this way: a comma is level (-3.4 st/s), a full
    stop falls (-21), an exclamation lands hard (-49) and a question rises
    (+45).  The spread across those four is the 'expressive' number."""
    t, f = f0_track(x)
    if len(f) < 4:
        return None
    keep = t >= t[-1] - window
    if keep.sum() < 3:
        keep = np.zeros(len(t), bool)
        keep[-3:] = True
    tt, ff = t[keep], st(f[keep], ref=np.median(f))
    a = np.polyfit(tt, ff, 1)[0]
    return round(float(a), 1)


def max_internal_gap(x, thresh_db=-38.0, block=0.005):
    """The longest silence between the first and last sound - the 'silent
    areas' Nader heard, measured at R3's own threshold and resolution."""
    m = np.max(np.abs(x), axis=1) if x.ndim > 1 else np.abs(x)
    n = int(block * SR)
    k = len(m) // n
    if not k:
        return 0.0
    e = np.max(m[: k * n].reshape(k, n), axis=1)
    peak = e.max() + 1e-12
    loud = 20 * np.log10(np.maximum(e, 1e-12) / peak) >= thresh_db
    idx = np.flatnonzero(loud)
    if len(idx) < 2:
        return 0.0
    run = best = 0
    for i in range(idx[0], idx[-1] + 1):
        if loud[i]:
            run = 0
        else:
            run += 1
            best = max(best, run)
    return round(best * block, 3)


# --------------------------------------------------------------------------
# Width and bands
# --------------------------------------------------------------------------


def width(x):
    if x.ndim < 2 or x.shape[1] < 2:
        return {"lrCorrelation": 1.0, "sideMinusMidDb": -120.0}
    l, r = x[:, 0], x[:, 1]
    mid, side = (l + r) / 2, (l - r) / 2
    c = float(np.corrcoef(l, r)[0, 1]) if np.std(r) and np.std(l) else 1.0
    ms = np.sqrt(np.mean(mid**2)) + 1e-12
    ss = np.sqrt(np.mean(side**2)) + 1e-12
    return {"lrCorrelation": round(c, 3),
            "sideMinusMidDb": round(float(20 * np.log10(ss / ms)), 1)}


def bands(x, gate_db=-45.0):
    """Band shares of voiced frames only, so silence does not skew the read.
    The 3-5 kHz share is the presence number the whole read depends on."""
    m = x.mean(axis=1) if x.ndim > 1 else x
    n = 2048
    k = len(m) // n
    if not k:
        return {}
    fr = m[: k * n].reshape(k, n)
    rms = np.sqrt(np.mean(fr**2, axis=1))
    keep = 20 * np.log10(np.maximum(rms, 1e-12)) > gate_db
    if not keep.any():
        keep = np.ones(k, bool)
    sp = np.abs(np.fft.rfft(fr[keep] * np.hanning(n), axis=1)) ** 2
    f = np.fft.rfftfreq(n, 1 / SR)
    tot = sp.sum()
    edges = [(80, 300), (300, 1000), (1000, 3000), (3000, 5000),
             (5000, 9000), (9000, 24000)]
    names = ["share80to300Hz", "share300to1kHz", "share1to3kHz",
             "share3to5kHz", "share5to9kHz", "shareAbove9kHz"]
    out = {n_: round(float(sp[:, (f >= a) & (f < b)].sum() / tot * 100), 2)
           for n_, (a, b) in zip(names, edges)}
    sp1 = np.abs(np.fft.rfft(fr[keep] * np.hanning(n), axis=1))
    out["centroidHz"] = round(float((f * sp1).sum() / sp1.sum()), 1)
    out["voicedPct"] = round(float(keep.mean() * 100), 1)
    return out


def spectrogram(path, png, size="1600x600"):
    r = run(["ffmpeg", "-y", "-v", "error", "-i", str(path), "-lavfi",
             f"showspectrumpic=s={size}:mode=combined:legend=1:fscale=log:"
             f"scale=log:gain=2",
             str(png)])
    return r.returncode == 0


# --------------------------------------------------------------------------


def crackle(path, block=0.005, voiced_db=-38.0):
    """Four counts, one per way a chain can crack a voice.

    1. **Level steps** - the broadband envelope moving more than 6 dB inside
       20 ms while speech is running.  A voice does not do that; a gate
       slamming, a compressor grabbing or a splice does.
    2. **Gate chatter** - the envelope crossing the gate's own working point
       up and down faster than 100 ms, which is what a frequency-keyed gate
       does when the key is marginal.
    3. **De-esser pumping** - the 5-9 kHz band dropping more than 10 dB inside
       a syllable (150 ms).  A dynamic EQ with a fast release and too much
       range audibly lisps on and off.
    4. **Clipping** - any sample at or above -0.1 dBFS."""
    x = decode(path)
    m = x.mean(axis=1) if x.ndim > 1 else x
    n = int(block * SR)
    k = len(m) // n
    if k < 8:
        return {}
    fr = m[: k * n].reshape(k, n)
    env = np.sqrt(np.mean(fr**2, axis=1))
    db = 20 * np.log10(np.maximum(env, 1e-12))
    peak = db.max()
    voiced = db > peak + voiced_db
    t = np.arange(k) * block

    step = int(0.020 / block)
    steps = []
    for i in range(step, k):
        if voiced[i] and voiced[i - step]:
            d = abs(db[i] - db[i - step])
            if d > 6.0:
                steps.append((round(float(t[i]), 3), round(float(d), 1)))

    # gate chatter: crossings of the working point, closer together than 100 ms
    thr = peak + voiced_db
    above = db > thr
    cross = [i for i in range(1, k) if above[i] != above[i - 1]]
    chatter = [round(float(t[cross[i]]), 3) for i in range(1, len(cross))
               if (cross[i] - cross[i - 1]) * block < 0.100]

    sos = butter(4, [5000 / (SR / 2), min(9000, SR / 2 - 1) / (SR / 2)],
                 btype="band", output="sos")
    hb = sosfiltfilt(sos, m)
    hdb = 20 * np.log10(np.maximum(
        np.sqrt(np.mean(hb[: k * n].reshape(k, n) ** 2, axis=1)), 1e-12))
    win = int(0.150 / block)
    pumps = []
    for i in range(win, k):
        if voiced[i] and voiced[i - win]:
            d = hdb[i - win : i + 1]
            drop = float(d.max() - d.min())
            if drop > 10.0:
                pumps.append((round(float(t[i]), 3), round(drop, 1)))

    clip = int(np.sum(np.abs(m) >= 10 ** (-0.1 / 20)))

    def worst(rows):
        return [r[0] for r in sorted(rows, key=lambda r: -r[1])[:3]]

    return {
        "levelSteps": len(steps), "worstLevelStepsAt": worst(steps),
        "gateChatter": len(chatter), "worstChatterAt": chatter[:3],
        "deEsserPumps": len(pumps), "worstPumpsAt": worst(pumps),
        "clippedSamples": clip,
        "peakDbfs": round(float(20 * np.log10(np.max(np.abs(m)) + 1e-12)), 2),
    }


def speech_runs(path, floor_db=-42.0, min_gap=0.04, min_run=0.03):
    """The [start, end] of every run of speech in a file.

    `silenceremove` is the only stage of the voice chain that changes time, and
    it changes it by deleting silence - speech itself is never scaled.  So a
    word's position inside a run of speech shifts by a constant, and aligning
    the runs of the raw render against the runs of the chained one maps
    edge-tts's word boundaries onto the chained timeline exactly rather than
    approximately.  A caption that is approximately right is the fault this
    revision exists to fix."""
    x = decode(path)
    m = np.max(np.abs(x), axis=1) if x.ndim > 1 else np.abs(x)
    thr = 10 ** (floor_db / 20)
    idx = np.flatnonzero(m > thr)
    if not len(idx):
        return []
    gap = int(min_gap * SR)
    runs = []
    start = prev = idx[0]
    for i in idx[1:]:
        if i - prev > gap:
            runs.append([start / SR, (prev + 1) / SR])
            start = i
        prev = i
    runs.append([start / SR, (prev + 1) / SR])
    return [[round(a, 4), round(b, 4)] for a, b in runs if b - a >= min_run]


def f0_yin_frame(fr, sr=SR, fmin=70.0, fmax=500.0, thresh=0.15):
    """YIN cumulative-mean-normalised difference on one frame."""
    n = len(fr)
    lo, hi = int(sr / fmax), min(int(sr / fmin), n - 1)
    if hi <= lo:
        return None
    d = np.empty(hi + 1)
    d[0] = 0.0
    for tau in range(1, hi + 1):
        diff = fr[: n - tau] - fr[tau:]
        d[tau] = float(np.dot(diff, diff))
    cum = np.cumsum(d[1:])
    idx = np.arange(1, hi + 1)
    dp = np.ones(hi + 1)
    nz = cum > 0
    dp[1:][nz] = d[1:][nz] * idx[nz] / cum[nz]
    cand = np.flatnonzero(dp[lo:hi + 1] < thresh)
    tau = lo + int(cand[0]) if len(cand) else lo + int(np.argmin(dp[lo:hi + 1]))
    if 0 < tau < hi:
        a, b, c = dp[tau - 1], dp[tau], dp[tau + 1]
        den = a - 2 * b + c
        if abs(den) > 1e-12:
            tau = tau + 0.5 * (a - c) / den
    return sr / tau if tau > 0 else None


def f0_track_agreed(x, frame=0.040, hop=0.010, gate_db=-38.0, tol_st=1.5):
    """Autocorrelation and YIN, keeping only the frames where they agree.

    R4 1.1's rule, implemented as a filter rather than as a footnote: about
    84 % of voiced frames survive it, and the ones that do not are precisely
    the octave errors that would otherwise decide a gate."""
    m = x.mean(axis=1) if x.ndim > 1 else x
    n = int(frame * SR)
    h = int(hop * SR)
    peak = np.max(np.abs(m)) + 1e-12
    ts, fs = [], []
    ac_t, ac_f = f0_track(x, frame=frame, hop=hop, gate_db=gate_db)
    ac = dict(zip(np.round(ac_t, 4), ac_f))
    for i in range(0, max(0, len(m) - n), h):
        t = round((i + n / 2) / SR, 4)
        if t not in ac:
            continue
        fr = m[i : i + n]
        if 20 * np.log10(np.sqrt(np.mean(fr**2)) / peak + 1e-12) < gate_db:
            continue
        y = f0_yin_frame(fr - fr.mean())
        if y is None or y <= 0:
            continue
        a = ac[t]
        if abs(12 * np.log2(y / a)) <= tol_st:
            ts.append(t)
            fs.append((a + y) / 2.0)
    return np.array(ts), np.array(fs)


def f0_yin_frame_unused():
    return None


def draw_shape(path, tail_sec=0.200):
    """The two numbers the draw gate rejects on.

    `tailSt` is the median f0 of the last `tail_sec` of voiced speech, in
    semitones relative to the line's own median.  A statement falls; a positive
    number means the voice lifted and hung, which is the English yes/no-question
    contour and is exactly what shipped in the delivered master at 43.0 s.

    `durSec` is the audible duration, so a draw that pauses differently from
    its siblings can be rejected on length."""
    x = decode(path)
    t, f = f0_track_agreed(x)
    out = {"durSec": active_end(path), "frames": int(len(f))}
    if len(f) < 8:
        out.update({"medianHz": None, "tailHz": None, "tailSt": None})
        return out
    med = float(np.median(f))
    keep = t >= t[-1] - tail_sec
    if keep.sum() < 3:
        keep = np.zeros(len(t), bool)
        keep[-3:] = True
    tail = float(np.median(f[keep]))
    out.update({
        "medianHz": round(med, 1),
        "tailHz": round(tail, 1),
        "tailSt": round(float(12 * np.log2(max(tail, 1e-9) / max(med, 1e-9))), 2),
    })
    return out


def band_quiet_run(path, lo=1000.0, hi=4000.0, floor_db=-45.0, block=0.020):
    """The longest run for which a band sits below `floor_db`.

    The bed is transient-only by design, which is what keeps it from sounding
    like an engine - and which also lets it go near-silent between hits.  Under
    a voice rest that reads as a hole.  This is the number that says whether the
    pad is actually carrying the rests."""
    x = decode(path)
    m = x.mean(axis=1) if x.ndim > 1 else x
    sos = butter(4, [lo / (SR / 2), min(hi, SR / 2 - 1) / (SR / 2)],
                 btype="band", output="sos")
    b = sosfiltfilt(sos, m)
    n = int(block * SR)
    k = len(b) // n
    if not k:
        return {"maxQuietSec": 0.0, "quietPct": 0.0}
    e = np.sqrt(np.mean(b[: k * n].reshape(k, n) ** 2, axis=1))
    db = 20 * np.log10(np.maximum(e, 1e-12))
    quiet = db < floor_db
    run = best = 0
    for q in quiet:
        run = run + 1 if q else 0
        best = max(best, run)
    return {"maxQuietSec": round(best * block, 3),
            "quietPct": round(float(quiet.mean() * 100), 1)}


def active_end(path, floor_db=-42.0):
    """The time after which a file is never again louder than `floor_db`.

    A chained phrase carries a room tail and a limiter release that decay
    below the gate about 0.1 s before the file ends.  Laying a read out by the
    FILE length therefore schedules a 0.30 s gap that
    `silencedetect=noise=-40dB` reads as 0.42 s, and the bible's gate fails on
    silence nobody can hear.  Laying it out by this number instead makes the
    cue sheet and the meter agree, and the tail still plays: it decays into
    the gap rather than ending at a cliff."""
    x = decode(path)
    m = np.max(np.abs(x), axis=1) if x.ndim > 1 else np.abs(x)
    thr = 10 ** (floor_db / 20)
    idx = np.flatnonzero(m > thr)
    return round(float((idx[-1] + 1) / SR), 4) if len(idx) else 0.0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Measure and gate film audio.")
    if argv is None:
        argv = sys.argv[1:]
    if argv and argv[0] in ("--active-batch", "--runs-batch",
                            "--draw-batch", "--band-batch",
                            "--crackle-batch"):
        # one python start for a whole film's lines
        mode = argv[0]
        for line in pathlib.Path(argv[1]).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            if mode == "--runs-batch":
                v = json.dumps(speech_runs(line))
            elif mode == "--draw-batch":
                v = json.dumps(draw_shape(line))
            elif mode == "--band-batch":
                v = json.dumps(band_quiet_run(line))
            elif mode == "--crackle-batch":
                v = json.dumps(crackle(line))
            else:
                v = active_end(line)
            print(f"{v}	{line}")
        return 0
    ap.add_argument("file")
    ap.add_argument("--as", dest="kind", default="any",
                    choices=["any", "bed", "sfx", "voice", "premaster", "master"])
    ap.add_argument("--cues")
    ap.add_argument("--json")
    ap.add_argument("--spectrogram")
    ap.add_argument("--presence", action="store_true",
                    help="always print the band table")
    ap.add_argument("--pitch", action="store_true",
                    help="f0 spread, terminal slope and the longest internal gap")
    ap.add_argument("--aspect", default="16:9", choices=["16:9", "1:1", "9:16"])
    a = ap.parse_args(argv)

    path = pathlib.Path(a.file)
    if not path.exists():
        print(f"FAIL  no such file: {path}")
        return 2
    cues = json.loads(pathlib.Path(a.cues).read_text(encoding="utf-8")) if a.cues else {}
    tgt = cues.get("master", {})

    x = decode(path)
    dur = len(x) / SR
    rep = {"file": str(path).replace("\\", "/"), "durationSec": round(dur, 3),
           "channels": x.shape[1], "sampleRate": SR,
           "peakDbfs": round(float(20 * np.log10(np.max(np.abs(x)) + 1e-12)), 2)}
    rep.update(width(x))
    if a.kind in ("bed", "any", "premaster", "master"):
        rep.update(engine(x))
        b = band_quiet_run(str(path))
        rep["band1to4kMaxQuietSec"] = b["maxQuietSec"]
        rep["band1to4kQuietPct"] = b["quietPct"]
    if a.kind in ("voice", "any") or a.presence:
        rep.update(bands(x))
    if a.kind == "voice" or a.pitch:
        rep.update(pitch_report(x))
        rep["terminalSlopeStPerSec"] = terminal_slope(x)
        rep["maxInternalGapSec"] = max_internal_gap(x)
    if a.kind in ("premaster", "master", "voice", "bed", "any"):
        rep.update(loudness(path))
    if a.kind == "master":
        rep["monoFoldLossDb"] = mono_fold(path)
    found = gaps(x)
    rep["gaps"] = classify_gaps(found, cues.get("rests", []))

    fails, notes = [], []

    if a.kind == "bed":
        if rep["lowBandSilencePct25"] < ENGINE_MIN_SILENCE_PCT:
            fails.append(f"engine test: low band silent only "
                         f"{rep['lowBandSilencePct25']} % of the time, "
                         f"need >= {ENGINE_MIN_SILENCE_PCT} %")
        if rep["lrCorrelation"] < 0.9:
            fails.append(f"bed L/R correlation {rep['lrCorrelation']} < 0.90")

    if a.kind == "voice":
        # R3 rule 5: below 3.8 ST of f0 standard deviation a read is flatter
        # than ordinary conversation.  That is the "robotic", as a number.
        if rep.get("f0SdSemitones") is not None and rep["f0SdSemitones"] < 3.8:
            notes.append(f"f0 SD {rep['f0SdSemitones']:.2f} ST is under the 3.8 ST "
                         "conversational floor (R3 rule 5)")
        # Bible 8.4, second gate: the stem is allowed to breathe, but every
        # gap it takes must be named in the cue file with the beat that
        # created it.  Undeclared fails; declared does not.
        for g in rep["gaps"]:
            if not g["declared"]:
                fails.append(
                    f"undeclared voice gap {g['fromSec']:.2f}-{g['toSec']:.2f} s "
                    f"({g['durSec']:.2f} s)" +
                    (" - the cue file declares it but gives no authoring beat"
                     if any(g["fromSec"] >= r["fromSec"] - 0.2
                            and g["toSec"] <= r["toSec"] + 0.2
                            for r in cues.get("rests", []))
                     else ". Declare it in the cue file with the beat that "
                          "created it, or fix the pacing."))
        stale = [r for r in cues.get("rests", []) if not r.pop("_matched", False)]
        for r in stale:
            notes.append(f"declared rest {r['fromSec']:.2f}-{r['toSec']:.2f} s "
                         f"produced no gap at this render (stale declaration)")

    if a.kind == "master":
        i_t = tgt.get("integratedLufs", -14.0)
        s_t = tgt.get("maxShortTermLufs", -9.0)
        tp_t = tgt.get("truePeakDbtp916", -1.5) if a.aspect == "9:16" \
            else tgt.get("truePeakDbtp", -1.0)
        if rep["integratedLufs"] is None or abs(rep["integratedLufs"] - i_t) > 0.2:
            fails.append(f"integrated {rep['integratedLufs']} LUFS, "
                         f"target {i_t} +/- 0.2")
        if rep["maxShortTermLufs"] is None or rep["maxShortTermLufs"] > s_t:
            fails.append(f"max short-term {rep['maxShortTermLufs']} LUFS > {s_t}")
        if rep["truePeakDbtp"] is None or rep["truePeakDbtp"] > tp_t + 0.05:
            fails.append(f"true peak {rep['truePeakDbtp']} dBTP > {tp_t}")
        if rep["monoFoldLossDb"] is not None and abs(rep["monoFoldLossDb"]) >= 0.5:
            fails.append(f"mono fold loss {rep['monoFoldLossDb']} dB, need < 0.5")
        if rep["channels"] != 2:
            fails.append(f"{rep['channels']} channel(s); the master must be stereo")
        secs = cues.get("seconds")
        if secs and abs(dur - secs) > 1.0 / cues.get("fps", 30):
            fails.append(f"duration {dur:.3f} s, expected {secs:.3f} s")
        # The mix must never go quiet: the bed runs under everything except the
        # one declared drop.
        for g in rep["gaps"]:
            if not g["declared"]:
                fails.append(f"silence in the mix at {g['fromSec']:.2f}-"
                             f"{g['toSec']:.2f} s ({g['durSec']:.2f} s)")

    # ---- print -----------------------------------------------------------
    print(f"\n{path.name}   {dur:.3f} s   {rep['channels']} ch   "
          f"peak {rep['peakDbfs']:.2f} dBFS")
    def num(v, u=""):
        return f"{v:>8.2f}{u}" if isinstance(v, (int, float)) else f"{'n/a':>8}{u}"
    if rep.get("integratedLufs") is not None:
        print(f"  integrated      {num(rep['integratedLufs'], ' LUFS')}")
        print(f"  max short-term  {num(rep['maxShortTermLufs'], ' LUFS')}")
        print(f"  max momentary   {num(rep['maxMomentaryLufs'], ' LUFS')}")
        print(f"  true peak       {num(rep['truePeakDbtp'], ' dBTP')}")
    if "lowBandSilencePct25" in rep:
        print(f"  1-4 kHz below -45 dBFS at most "
              f"{rep['band1to4kMaxQuietSec']:.3f} s in a row "
              f"({rep['band1to4kQuietPct']:.1f} % of blocks)")
        print(f"  low band 20-200 Hz silent {rep['lowBandSilencePct25']:.1f} % "
              f"of the time at -25 dB ({rep['lowBandSilencePct40']:.1f} % at -40 dB), "
              f"crest {rep['lowBandCrestDb']:.1f} dB")
    print(f"  L/R correlation {rep['lrCorrelation']:.3f}   side-mid "
          f"{rep['sideMinusMidDb']:.1f} dB", end="")
    if rep.get("monoFoldLossDb") is not None:
        print(f"   mono fold {rep['monoFoldLossDb']:+.2f} dB", end="")
    print()
    if "f0SdSemitones" in rep:
        print(f"  f0 median {rep['f0MedianHz']:.0f} Hz   SD "
              f"{rep['f0SdSemitones']:.2f} ST   5-95 spread "
              f"{rep['f0Range5to95St']:.2f} ST   terminal "
              f"{rep['terminalSlopeStPerSec']} st/s   longest internal gap "
              f"{rep['maxInternalGapSec']:.3f} s"
              + ("" if rep["f0SdSemitones"] >= 3.8 else
                 "   <- under the 3.8 ST conversational floor"))
    if "share3to5kHz" in rep:
        print(f"  bands (voiced {rep['voicedPct']:.0f} %): 80-300 "
              f"{rep['share80to300Hz']:.2f}  .3-1k {rep['share300to1kHz']:.2f}  "
              f"1-3k {rep['share1to3kHz']:.2f}  3-5k {rep['share3to5kHz']:.2f}  "
              f"5-9k {rep['share5to9kHz']:.2f}  >9k {rep['shareAbove9kHz']:.2f}  "
              f"centroid {rep['centroidHz']:.0f} Hz")
    if rep["gaps"]:
        print(f"  gaps >= {GAP_SEC} s below {GAP_DBFS} dBFS:")
        for g in rep["gaps"]:
            tag = "declared" if g.get("declared") else "UNDECLARED"
            print(f"    {g['fromSec']:7.2f} -> {g['toSec']:7.2f} s  "
                  f"{g['durSec']:5.2f} s  {tag}"
                  + (f"  {g['why']}" if g.get("why") else ""))
    else:
        print(f"  gaps >= {GAP_SEC} s below {GAP_DBFS} dBFS: none")

    if a.spectrogram:
        ok = spectrogram(path, a.spectrogram)
        print(f"  spectrogram -> {a.spectrogram}" if ok else "  spectrogram FAILED")

    if a.json:
        p = pathlib.Path(a.json)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(rep, indent=2) + "\n", encoding="utf-8")
        print(f"  json -> {p}")

    for n in notes:
        print(f"  note: {n}")
    for f in fails:
        print(f"  FAIL: {f}")
    print(("  PASS" if not fails else f"  {len(fails)} FAILURE(S)") + "\n")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
