#!/usr/bin/env python
"""The SFX family, as one instrument.  Builder B, film pipeline.

Six sounds, built from the bed's own two primitives - 2-op FM and
differentiated noise - and tuned to A Dorian, the bed's key.  Every pitched
effect lands on a note of the chord underneath it.  That is what makes them a
family: they are not sounds *on* the music, they are notes *of* it.

No bare sine bell and no pink-noise wash anywhere.  The old set (1900 Hz sine
click, pink-noise whoosh, 880+1320 chime, 440/660/880 open, pink-noise riser)
is retired and not reused.

Each cue is rendered once, into `out/sfx/<cue>.wav`, and its duration, peak,
RMS and spectral centre are recorded in `out/sfx/sfx.json`.

Level one-shots by peak and RMS, never by LUFS: below about 400 ms the R128
gate makes the number meaningless (ebur128 reports -70 LUFS for the tick).

Usage:
    python sfx.py            # render all six
    python sfx.py --only tick reveal
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

import numpy as np
from scipy.signal import butter, resample_poly, sosfilt

from bed import SR, wav_write, env, diffnoise, LN1000

HERE = pathlib.Path(__file__).resolve().parent
# ── where the working tree lives ─────────────────────────────────────────────
#
# `work/film/audio/out`, at the repository root, NOT `out/` beside this file.
#
# `tools/lib-paths.mjs` moved every large regenerable tree out of the extension
# folder because Chrome measures that folder and reported it at about 7,000 MB.
# The picture stage and the manifest were pointed at the new roots; the three
# audio tools were not, and they kept writing beside themselves. Nothing noticed
# for a while, because the READERS had already been moved and simply found the
# older files that had been carried across by hand.
#
# Same constant as `FILM_AUDIO_OUT` in `tools/lib-paths.mjs`. If that moves,
# this moves with it.
REPO = HERE.parents[3]
OUT_ROOT = REPO / "work" / "film" / "audio" / "out"
OUT = OUT_ROOT / "sfx"

# A Dorian, the bed's key.
A4, C5, E5, G5, A5, E6, A6 = 440.00, 523.25, 659.25, 783.99, 880.00, 1318.51, 1760.00

# Peak targets inside the family.  These are the relative balance; mix.mjs
# sets the bus level against the voice.
PEAK_DBFS = {
    "tick": -16.0,
    "reveal": -9.0,
    "swish": -12.0,
    "success": -9.0,
    "sting": -5.0,
    "logo": -5.0,
}

OS = 4  # oversampling factor for FM, so high modulator ratios do not alias


def fm(freq, dur, ratio=3.0, index=4.5, index_decay=0.045, decay=0.110,
       attack=0.0015):
    """2-op FM, rendered at 4x and decimated so ratio 7:1 does not alias."""
    n = int(dur * SR) * OS
    t = np.arange(n) / (SR * OS)
    m = np.sin(2 * np.pi * ratio * freq * t) * index * np.exp(-LN1000 * t / index_decay)
    y = np.sin(2 * np.pi * freq * t + m)
    y = resample_poly(y, 1, OS)
    n2 = int(dur * SR)
    y = y[:n2] if len(y) >= n2 else np.pad(y, (0, n2 - len(y)))
    return y * env(n2, decay, attack)


def thump(f0, f1, dur, decay, sweep=0.045, clip=1.6):
    """A low sine sweep with a soft clip.  The body under a mark."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / (sweep / 3.0))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, decay)
    return np.tanh(clip * x) / np.tanh(clip)


def svf_sweep(x, f_lo, f_hi, q=6.0):
    """Chamberlin state-variable bandpass with a per-sample swept cutoff.
    This is the 'motion' in the swish: a filter travelling, not a wash."""
    n = len(x)
    fc = f_lo * (f_hi / f_lo) ** (np.arange(n) / max(1, n - 1))
    f = 2.0 * np.sin(np.pi * np.clip(fc, 20, SR * 0.45) / SR)
    damp = 1.0 / q
    low = band = high = 0.0
    out = np.empty(n)
    for i in range(n):
        fi = f[i]
        high = x[i] - low - damp * band
        band = fi * high + band
        low = fi * band + low
        out[i] = band
    m = np.max(np.abs(out))
    return out / m if m else out


def granular_tail(rng, dur, freqs, grains, lo=0.055, hi=0.105, skew=1.0,
                  fade=0.8):
    """Windowed sine grains scattered over `dur`.  Intermittent by
    construction, so a tail cannot become a drone."""
    n = int(dur * SR)
    out = np.zeros(n + SR // 4)
    for _ in range(grains):
        gl = int(rng.uniform(lo, hi) * SR)
        pos = int((rng.random() ** skew) * max(1, n - gl))
        f = float(rng.choice(freqs))
        t = np.arange(gl) / SR
        out[pos : pos + gl] += (np.sin(2 * np.pi * f * t) * np.hanning(gl)
                                * rng.uniform(0.35, 1.0)
                                * (1.0 - pos / (n + 1)) ** fade)
    m = np.max(np.abs(out))
    return (out / m if m else out)[:n]


def pan_static(mono, pan):
    th = (pan + 1.0) * np.pi / 4.0
    return np.stack([mono * np.cos(th), mono * np.sin(th)], axis=1)


def pan_sweep(mono, p0, p1):
    th = (np.linspace(p0, p1, len(mono)) + 1.0) * np.pi / 4.0
    return np.stack([mono * np.cos(th), mono * np.sin(th)], axis=1)


def fit(x, dur):
    n = int(round(dur * SR))
    x = x[:n] if len(x) >= n else np.pad(x, ((0, n - len(x)),) + ((0, 0),) * (x.ndim - 1))
    f = int(0.003 * SR)
    if x.ndim == 1:
        x[-f:] *= np.linspace(1.0, 0.0, f)
    else:
        x[-f:] *= np.linspace(1.0, 0.0, f)[:, None]
    return x


# --------------------------------------------------------------------------
# The six
# --------------------------------------------------------------------------


def cue_tick(rng):
    """UI tick.  FM 7:1, index 2.2 decaying in 4 ms, E6, + a 2 ms
    differentiated-noise edge.  34 ms.  Dead-centre mono: a UI mark that moves
    is a distraction."""
    d = 0.034
    y = fm(E6, d, ratio=7.0, index=2.2, index_decay=0.004, decay=0.022,
           attack=0.0004)
    k = int(0.002 * SR)
    y[:k] += diffnoise(k, rng, 3) * np.linspace(1.0, 0.0, k) ** 1.5 * 0.62
    y += 0.14 * thump(210.0, 130.0, d, 0.018, sweep=0.006)
    return fit(pan_static(y, 0.0), d)


def cue_reveal(rng):
    """Three FM grains A5 -> E6 -> A6, 45 ms apart, over a filtered-noise
    bloom.  The brightest thing in the palette and the only one that overlaps
    sibilance: never let it start on a sibilant."""
    d = 0.620
    n = int(d * SR)
    y = np.zeros(n + SR // 2)
    for i, f in enumerate((A5, E6, A6)):
        g = fm(f, 0.42, ratio=3.0, index=3.6, index_decay=0.035, decay=0.30)
        s = int(i * 0.045 * SR)
        y[s : s + len(g)] += g * (0.9 - 0.16 * i)
    sos = butter(4, [3200 / (SR / 2), 12000 / (SR / 2)], btype="band", output="sos")
    bloom = sosfilt(sos, rng.standard_normal(n))
    bloom *= (np.linspace(0, 1, n) ** 0.6) * np.exp(-LN1000 * np.arange(n) / SR / 0.34)
    bloom /= max(1e-12, np.max(np.abs(bloom)))
    y[:n] += 1.85 * bloom
    y += 0.18 * np.pad(granular_tail(rng, 0.45, [A6, E6 * 2, A6 * 1.5], 26),
                       (int(0.12 * SR), len(y) - int(0.12 * SR) - int(0.45 * SR)))
    st = pan_static(y, 0.0)
    st[:, 0] *= 1.0 + 0.10 * np.linspace(1, -1, len(y))
    st[:, 1] *= 1.0 + 0.10 * np.linspace(-1, 1, len(y))
    return fit(st, d)


def cue_swish(rng):
    """White noise through a resonant bandpass swept 400 Hz -> 6.5 kHz, plus a
    rising tone, panned -0.9 -> +0.9 across the sweep.  Motion, not a wash:
    79 % of its energy is in the voice's body, so it goes *between* lines."""
    d = 0.380
    n = int(d * SR)
    t = np.arange(n) / SR
    nz = rng.standard_normal(n)
    band = svf_sweep(svf_sweep(nz, 400.0, 6500.0, q=6.0), 400.0, 6500.0, q=6.0)
    tone = np.sin(2 * np.pi * np.cumsum(A4 * (1.6 ** (t / d))) / SR) * 0.30
    shape = np.sin(np.pi * (t / d) ** 0.8) ** 1.2
    y = (band + tone) * shape
    y /= max(1e-9, np.max(np.abs(y)))
    return fit(pan_sweep(y, -0.9, 0.9), d)


def cue_success(rng):
    """Two FM plucks a perfect fifth apart (A5, E6), the second 95 ms late,
    over a 70 -> 48 Hz thump.  Only 2.7 % in 3-5 kHz, so it sits under a voice
    tail cleanly."""
    d = 0.850
    n = int(d * SR)
    y = np.zeros(n + SR // 2)
    a = fm(A5, 0.55, ratio=2.0, index=3.0, index_decay=0.05, decay=0.40)
    b = fm(E6, 0.55, ratio=2.0, index=1.1, index_decay=0.05, decay=0.42)
    y[: len(a)] += a * 0.85
    s = int(0.095 * SR)
    y[s : s + len(b)] += b * 0.72
    y[:n] += 1.95 * thump(70.0, 48.0, d, 0.16, sweep=0.05)
    y[:n] += 0.04 * np.pad(granular_tail(rng, 0.36, [A5 * 2, E6 * 2], 14),
                           (int(0.10 * SR), n - int(0.10 * SR) - int(0.36 * SR)))
    st = pan_static(y, 0.0)
    st[:, 0] *= 1.0 + 0.08 * np.linspace(1, -1, len(y))
    st[:, 1] *= 1.0 + 0.08 * np.linspace(-1, 1, len(y))
    return fit(st, d)


def cue_sting(rng):
    """Sub drop 115 -> 36 Hz soft-clipped + a 20 ms noise crack + the four-note
    lift chord.  This replaces the old 2.2 s riser: an impact that lands on the
    cut, not a rise that announces it.  The line starts after it."""
    d = 1.300
    n = int(d * SR)
    y = np.zeros(n + SR // 2)
    y[:n] += 0.66 * thump(115.0, 36.0, d, 0.42, sweep=0.11, clip=2.2)
    k = int(0.020 * SR)
    y[:k] += diffnoise(k, rng, 2) * np.linspace(1.0, 0.0, k) ** 1.4 * 1.75
    for i, f in enumerate((A4, C5, E5, G5)):
        g = fm(f, 0.75, ratio=1.0, index=2.6, index_decay=0.07, decay=0.55)
        s = int((0.020 + i * 0.018) * SR)
        y[s : s + len(g)] += g * (0.62 - 0.06 * i)
    st = pan_static(y, 0.0)
    st[:, 0] *= 1.0 + 0.09 * np.linspace(1, -1, len(y))
    st[:, 1] *= 1.0 + 0.09 * np.linspace(-1, 1, len(y))
    return fit(st, d)


def cue_logo(rng):
    """The brand motif A -> E -> A (rising fifth, then octave) on FM plucks,
    135 ms apart, over a 90 -> 42 Hz thump, with a granular shimmer tail.
    It opens and closes every film and it never changes.  This is the
    mnemonic."""
    d = 2.000
    n = int(d * SR)
    y = np.zeros(n + SR // 2)
    for i, (f, g) in enumerate(((A4, 0.95), (E5, 0.88), (A5, 0.95))):
        p = fm(f, 1.10, ratio=2.0, index=1.05 - 0.2 * i, index_decay=0.055,
               decay=0.46)
        s = int(i * 0.135 * SR)
        y[s : s + len(p)] += p * g
    y[:n] += 2.60 * thump(90.0, 42.0, d, 0.30, sweep=0.06, clip=1.9)
    tail = granular_tail(rng, 1.72, [A5, E6, A6, E6 * 1.5], 70, skew=0.7,
                         fade=0.16)
    s = int(0.30 * SR)
    y[s : s + len(tail)] += 0.30 * tail
    st = pan_static(y, 0.0)
    st[:, 0] *= 1.0 + 0.11 * np.linspace(1, -1, len(y))
    st[:, 1] *= 1.0 + 0.11 * np.linspace(-1, 1, len(y))
    return fit(st, d)


CUES = {
    "tick": cue_tick,
    "reveal": cue_reveal,
    "swish": cue_swish,
    "success": cue_success,
    "sting": cue_sting,
    "logo": cue_logo,
}


def centroid(x):
    m = x.mean(axis=1) if x.ndim > 1 else x
    w = np.hanning(len(m))
    sp = np.abs(np.fft.rfft(m * w))
    f = np.fft.rfftfreq(len(m), 1.0 / SR)
    s = sp.sum()
    return float((f * sp).sum() / s) if s else 0.0


def band_share(x, lo, hi):
    m = x.mean(axis=1) if x.ndim > 1 else x
    sp = np.abs(np.fft.rfft(m * np.hanning(len(m)))) ** 2
    f = np.fft.rfftfreq(len(m), 1.0 / SR)
    tot = sp.sum()
    return float(sp[(f >= lo) & (f < hi)].sum() / tot * 100) if tot else 0.0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Render the SFX family.")
    ap.add_argument("--only", nargs="*", choices=sorted(CUES))
    a = ap.parse_args(argv)
    names = a.only or list(CUES)
    OUT.mkdir(parents=True, exist_ok=True)
    meta_path = OUT / "sfx.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    for name in names:
        rng = np.random.default_rng(abs(hash(name)) % (2**31) if False else
                                    20260905 + sum(bytearray(name.encode())))
        x = CUES[name](rng)
        peak = np.max(np.abs(x))
        x = x * (10 ** (PEAK_DBFS[name] / 20) / max(1e-12, peak))
        p = OUT / f"{name}.wav"
        wav_write(p, x)
        mono = x.mean(axis=1)
        corr = float(np.corrcoef(x[:, 0], x[:, 1])[0, 1]) if np.std(x[:, 1]) else 1.0
        meta[name] = {
            "file": f"out/sfx/{name}.wav",
            "durationSec": round(len(x) / SR, 4),
            "peakDbfs": round(20 * np.log10(np.max(np.abs(x))), 2),
            "rmsDbfs": round(20 * np.log10(np.sqrt(np.mean(mono**2)) + 1e-12), 2),
            "crestDb": round(20 * np.log10(np.max(np.abs(mono))
                                           / (np.sqrt(np.mean(mono**2)) + 1e-12)), 2),
            "centroidHz": round(centroid(x), 1),
            "shareBelow300Hz": round(band_share(x, 0, 300), 2),
            "share3to5kHz": round(band_share(x, 3000, 5000), 2),
            "share5to9kHz": round(band_share(x, 5000, 9000), 2),
            "shareAbove9kHz": round(band_share(x, 9000, 24000), 2),
            "lrCorrelation": round(corr, 3),
        }
        m = meta[name]
        print(f"{name:8s} {m['durationSec']*1000:7.1f} ms  centroid "
              f"{m['centroidHz']:7.1f} Hz  peak {m['peakDbfs']:6.2f}  rms "
              f"{m['rmsDbfs']:6.2f}  crest {m['crestDb']:5.1f} dB  corr {m['lrCorrelation']}")
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"-> {meta_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
