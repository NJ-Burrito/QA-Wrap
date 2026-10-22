#!/usr/bin/env python
"""The small hard room, as a synthesised impulse response.  Builder B.

The old chain's `aecho=0.86:0.9:42:0.16` is a single discrete repeat at 42 ms,
right at the threshold where the ear starts hearing it as a separate event.
This replaces it with a real IR: eight early reflections at deliberately
non-harmonic delays, so nothing flutters, then a diffuse noise tail with
one-pole HF damping at 4.2 kHz.

Target, from research/32-sound-design.md 4.2 stage 7:
    -5.4 dB at 30 ms, -24.9 dB at 100 ms, -56.9 dB at 220 ms - RT60 0.22 s.

The IR carries no direct sound: `voice.mjs` mixes it in parallel with the dry
signal at 16 % wet, so a direct in the IR would only double the dry.

Usage:
    python room.py
"""

from __future__ import annotations

import argparse
import pathlib
import sys

import numpy as np

from bed import SR, wav_write

HERE = pathlib.Path(__file__).resolve().parent

# Non-integer-related, so nothing flutters.
EARLY_MS = [11.3, 16.9, 23.1, 29.7, 37.3, 43.1, 53.9, 61.7]
RT60 = 0.22
DAMP_HZ = 4200.0


def one_pole_lp(x, fc, sr=SR):
    a = np.exp(-2 * np.pi * fc / sr)
    y = np.empty_like(x)
    z = 0.0
    for i in range(len(x)):
        z = (1 - a) * x[i] + a * z
        y[i] = z
    return y


def build(seed=20260905, dur=0.30):
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    ir = np.zeros(n)

    # Eight early reflections, alternating polarity, amplitude on the RT60 curve.
    for i, ms in enumerate(EARLY_MS):
        s = int(ms / 1000 * SR)
        a = 10 ** (-3.0 * (ms / 1000) / RT60) * (0.78**i)
        ir[s] += a * (1 if i % 2 == 0 else -1)

    # A diffuse noise tail from the first reflection, damped above 4.2 kHz.
    t = np.arange(n) / SR
    tail = rng.standard_normal(n) * 10 ** (-3.0 * t / RT60)
    start = int(EARLY_MS[0] / 1000 * SR)
    tail[:start] = 0.0
    tail *= np.clip((t - EARLY_MS[0] / 1000) / 0.003, 0, 1)  # fade the tail in
    tail = one_pole_lp(tail, DAMP_HZ)
    tail /= max(1e-12, np.max(np.abs(tail)))

    ir = ir + 0.85 * tail
    ir[-int(0.01 * SR) :] *= np.linspace(1.0, 0.0, int(0.01 * SR))
    ir /= max(1e-12, np.max(np.abs(ir)))
    return ir


def decay_report(ir, marks=(30, 100, 220)):
    """Energy in 10 ms windows, in dB relative to the loudest window."""
    w = int(0.010 * SR)
    e = np.array([np.sqrt(np.mean(ir[i : i + w] ** 2))
                  for i in range(0, len(ir) - w, w)])
    ref = e.max()
    out = {}
    for ms in marks:
        i = int(ms / 10)
        out[ms] = 20 * np.log10(max(e[i], 1e-12) / ref) if i < len(e) else -120.0
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Render the room IR.")
    ap.add_argument("--out")
    ap.add_argument("--seed", type=int, default=20260905)
    a = ap.parse_args(argv)
    out = pathlib.Path(a.out) if a.out else HERE / "out" / "room-ir.wav"
    ir = build(a.seed)
    wav_write(out, ir)
    d = decay_report(ir)
    print(f"room-ir  {len(ir)/SR:.3f} s  RT60 target {RT60:.2f} s  "
          f"damping {DAMP_HZ:.0f} Hz")
    for ms, db in d.items():
        print(f"  {ms:4d} ms  {db:7.1f} dB")
    print(f"-> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
