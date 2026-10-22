#!/usr/bin/env python
"""The procedural music bed.  Builder B, film pipeline.

120 BPM, A Dorian, transient-only.  Reads the section map and the seed from
`cues/<id>.cues.json` and writes `out/bed-<id>.wav`.

The one rule the bed really has (research/32-sound-design.md 1.1):

    no oscillator runs longer than its envelope, and no envelope is longer
    than a beat.

Nothing sustains; everything decays.  A bed built that way cannot idle,
because there is nothing left running to idle.  The gate is measurable, not a
matter of taste: band-limit 20-200 Hz, take the 20 ms RMS envelope, and the
low band must sit below -25 dB of its own peak at least 70 % of the time.
`measure.py --engine` is the gate.

Deterministic from the seed: the same cue file always renders the same bed.

Usage:
    python bed.py --id qa-wrap
    python bed.py --cues cues/qa-wrap.cues.json --out out/bed-qa-wrap.wav
"""

from __future__ import annotations

import argparse
import json
import pathlib
import struct
import sys

import numpy as np
from scipy.signal import butter, sosfiltfilt

SR = 48000
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

# --------------------------------------------------------------------------
# WAV i/o (numpy only; soundfile is not installed and is not needed)
# --------------------------------------------------------------------------


def wav_write(path, data, sr=SR):
    """Write float32 [-1,1] mono (n,) or stereo (n,2) as 24-bit PCM WAV."""
    x = np.asarray(data, dtype=np.float64)
    if x.ndim == 1:
        x = x[:, None]
    ch = x.shape[1]
    x = np.clip(x, -1.0, 1.0)
    ints = np.round(x * 8388607.0).astype(np.int32)
    b = ints.astype("<i4").tobytes()
    raw = bytearray()
    for i in range(0, len(b), 4):
        raw += b[i : i + 3]
    raw = bytes(raw)
    if len(raw) % 2:
        raw += b"\x00"
    block = ch * 3
    hdr = b"RIFF" + struct.pack("<I", 36 + len(raw)) + b"WAVE"
    hdr += b"fmt " + struct.pack("<IHHIIHH", 16, 1, ch, sr, sr * block, block, 24)
    hdr += b"data" + struct.pack("<I", len(raw))
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(hdr + raw)
    return path


def wav_read(path):
    """Read a PCM WAV (16/24/32-bit int or 32-bit float). -> (float64 (n,ch), sr)."""
    b = pathlib.Path(path).read_bytes()
    if b[:4] != b"RIFF" or b[8:12] != b"WAVE":
        raise ValueError(f"not a RIFF/WAVE file: {path}")
    pos, fmt, data = 12, None, None
    while pos + 8 <= len(b):
        cid = b[pos : pos + 4]
        size = struct.unpack("<I", b[pos + 4 : pos + 8])[0]
        body = b[pos + 8 : pos + 8 + size]
        if cid == b"fmt ":
            fmt = struct.unpack("<HHIIHH", body[:16])
        elif cid == b"data":
            data = body
        pos += 8 + size + (size & 1)
    if fmt is None or data is None:
        raise ValueError(f"missing fmt/data chunk: {path}")
    tag, ch, sr, _, _, bits = fmt
    if tag == 3 and bits == 32:
        x = np.frombuffer(data, dtype="<f4").astype(np.float64)
    elif bits == 16:
        x = np.frombuffer(data, dtype="<i2").astype(np.float64) / 32768.0
    elif bits == 24:
        n = len(data) // 3
        raw = np.frombuffer(data[: n * 3], dtype=np.uint8).reshape(n, 3).astype(np.int32)
        v = raw[:, 0] | (raw[:, 1] << 8) | (raw[:, 2] << 16)
        v = np.where(v & 0x800000, v - 0x1000000, v)
        x = v.astype(np.float64) / 8388608.0
    elif bits == 32:
        x = np.frombuffer(data, dtype="<i4").astype(np.float64) / 2147483648.0
    else:
        raise ValueError(f"unsupported wav: tag={tag} bits={bits}")
    return x.reshape(-1, ch), sr


# --------------------------------------------------------------------------
# Envelopes.  `decay` is always the time to -60 dB, and is never longer than
# one beat (0.500 s at 120 BPM).
# --------------------------------------------------------------------------

LN1000 = 6.907755278982137  # ln(1000) = 60 dB


def env(n, decay, attack=0.0015):
    t = np.arange(n) / SR
    e = np.exp(-LN1000 * t / decay)
    a = int(attack * SR)
    if a > 1:
        e[:a] *= np.linspace(0.0, 1.0, a)
    return e


def diffnoise(n, rng, order=4):
    """White noise differentiated `order` times: a cheap 6-pole highpass."""
    x = rng.standard_normal(n + order)
    for _ in range(order):
        x = np.diff(x)
    m = np.max(np.abs(x))
    return x / m if m else x


# --------------------------------------------------------------------------
# The seven voices.  Two primitives only: 2-op FM and differentiated noise.
# --------------------------------------------------------------------------


def kick(rng, f0=95.0, f1=45.0, sweep=0.030, decay=0.075):
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / (sweep / 3.0))
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, decay)
    click = np.zeros(n)
    k = int(0.004 * SR)
    click[:k] = diffnoise(k, rng, 2) * np.linspace(1.0, 0.0, k) ** 2
    x = body + 0.30 * click
    return np.tanh(1.7 * x) / np.tanh(1.7)


def bass(rng, freq, decay=0.055):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * freq * t) + 0.16 * np.sin(2 * np.pi * 3 * freq * t)
    return np.tanh(1.8 * x) / np.tanh(1.8) * env(n, decay)


def pluck(freq, ratio=3.0, index=4.5, index_decay=0.045, decay=0.110):
    """2-op FM.  The 'wood' of the bed."""
    n = int(min(0.5, decay * 1.6) * SR)
    t = np.arange(n) / SR
    m = np.sin(2 * np.pi * ratio * freq * t) * index * np.exp(-LN1000 * t / index_decay)
    return np.sin(2 * np.pi * freq * t + m) * env(n, decay)


def hat(rng, decay=0.010):
    n = int(0.035 * SR)
    return diffnoise(n, rng, 4) * env(n, decay, attack=0.0002)


def snap(rng, decay=0.028):
    """Three noise bursts 9 ms apart."""
    n = int(0.09 * SR)
    out = np.zeros(n)
    for i in range(3):
        s = int(i * 0.009 * SR)
        ln = n - s
        out[s:] += diffnoise(ln, rng, 3) * env(ln, decay, attack=0.0003) * (0.75**i)
    return out / max(1e-9, np.max(np.abs(out)))


def shimmer(rng, dur, freqs, grains=46):
    """Granular: windowed sine grains scattered over a bar.  Intermittent by
    construction, so it cannot drone."""
    n = int(dur * SR)
    out = np.zeros(n + SR // 4)
    for _ in range(grains):
        gl = int(rng.uniform(0.055, 0.105) * SR)
        pos = int(rng.uniform(0.0, max(1, n - gl)))
        f = float(rng.choice(freqs))
        t = np.arange(gl) / SR
        w = np.hanning(gl)
        out[pos : pos + gl] += np.sin(2 * np.pi * f * t) * w * rng.uniform(0.4, 1.0)
    m = np.max(np.abs(out))
    return out / m if m else out


def pad(rng, dur, freqs, seed_phase=0.0):
    """A sustained, band-limited chord.  Present, never a slab.

    Band-limited 350 Hz - 3.5 kHz so it cannot touch the 20-200 Hz band the
    anti-engine rule measures, and each partial undulates on its own slow LFO
    so the layer never sits still.  It is the one thing in this bed that is
    allowed to sustain, and it is allowed because it lives an octave and a half
    above the band the rule is about."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for i, f in enumerate(freqs):
        detune = 1.0 + rng.uniform(-0.0015, 0.0015)
        lfo_hz = rng.uniform(0.10, 0.28)
        lfo_ph = rng.uniform(0, 2 * np.pi) + seed_phase
        # a shallow undulation: 0.70-1.00 is 3.1 dB of movement, enough that
        # the layer is never static and little enough that its own dips do not
        # reopen the hole it exists to fill
        amp = 0.85 + 0.15 * np.sin(2 * np.pi * lfo_hz * t + lfo_ph)
        out += np.sin(2 * np.pi * f * detune * t + rng.uniform(0, 2 * np.pi)) * amp
        # a quiet third harmonic keeps it from reading as a test tone
        out += 0.12 * np.sin(2 * np.pi * 3 * f * detune * t) * amp
    sos = butter(2, [350 / (SR / 2), 3500 / (SR / 2)], btype="band", output="sos")
    out = sosfiltfilt(sos, out)
    m = np.max(np.abs(out))
    return out / m if m else out


def swell(rng, dur=1.0, f_lo=110.0, f_hi=164.81):
    """Reverse swell: differentiated noise + two tones on a (t/d)^2.2 ramp."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    ramp = (t / dur) ** 2.2
    nz = diffnoise(n, rng, 2)
    tone = 0.5 * np.sin(2 * np.pi * f_lo * t * (1 + 0.06 * t / dur))
    tone += 0.35 * np.sin(2 * np.pi * f_hi * t * (1 + 0.06 * t / dur))
    x = (0.8 * nz + tone) * ramp
    x[-int(0.006 * SR) :] *= np.linspace(1.0, 0.0, int(0.006 * SR))
    return x / max(1e-9, np.max(np.abs(x)))


# --------------------------------------------------------------------------
# A Dorian.  Every pitched element is a note of the chord underneath it.
# --------------------------------------------------------------------------

A = 55.0  # A1, the bass root
NOTE = {  # A Dorian degrees, octave 3
    "A3": 220.00, "B3": 246.94, "C4": 261.63, "D4": 293.66,
    "E4": 329.63, "F#4": 369.99, "G4": 392.00, "A4": 440.00,
}
CHORDS = [
    ("Am7", 55.00, ["A3", "C4", "E4", "G4"]),
    ("D9",  73.42, ["D4", "F#4", "A4", "E4"]),
    ("Am7", 55.00, ["A3", "E4", "G4", "C4"]),
    ("G6",  98.00, ["B3", "D4", "E4", "G4"]),
]
SHIMMER_NOTES = [880.0, 987.77, 1046.50, 1174.66, 1318.51, 1479.98, 1760.00]

# beat offsets inside a bar (4 beats)
PLUCK_SPARSE = [0.0, 1.5, 2.5, 3.5]
PLUCK_FULL = [0.0, 0.75, 1.5, 2.0, 2.5, 3.25, 3.5]
BASS_8THS = [0.0, 1.5, 2.0, 2.5, 3.5]
KICK_BEATS = [0.0, 2.5]  # beat 1 and the "&" of 3
SNAP_BEATS = [1.0, 3.0]  # backbeat on 2 and 4


# --------------------------------------------------------------------------


class Bed:
    def __init__(self, cues):
        self.cues = cues
        self.bpm = float(cues.get("bpm", 120))
        self.beat = 60.0 / self.bpm
        self.bar = 4 * self.beat
        self.bars = int(cues["bars"])
        self.seconds = float(cues.get("seconds", self.bars * self.bar))
        b = cues.get("bed", {})
        self.sections = b["sections"]
        self.swells = b.get("swells", [])
        self.drop = b.get("drop")
        self.out_plan = b.get("outPlan", {})
        self.rng = np.random.default_rng(int(cues.get("seed", 20260905)))
        n = int(round(self.seconds * SR)) + SR
        self.buf = np.zeros((n, 2))
        self.events = []

    # -- grid helpers -----------------------------------------------------
    def t_of(self, bar, beat=0.0):
        """1-based bar, 0-based beat offset -> seconds."""
        return (bar - 1) * self.bar + beat * self.beat

    def section_at(self, t):
        for s in self.sections:
            if self.t_of(s["fromBar"]) - 1e-9 <= t < self.t_of(s["toBar"]) - 1e-9:
                return s["name"]
        return self.sections[-1]["name"]

    def place(self, t, mono, gain=1.0, pan=0.0):
        """Equal-power pan into the stereo bus.  Width comes from genuine
        per-voice panning only (research 5.5) - never from M/S tricks."""
        s = int(round(t * SR))
        if s < 0:
            mono, s = mono[-s:], 0
        n = len(mono)
        if s >= len(self.buf):
            return
        n = min(n, len(self.buf) - s)
        th = (pan + 1.0) * np.pi / 4.0
        self.buf[s : s + n, 0] += mono[:n] * gain * np.cos(th)
        self.buf[s : s + n, 1] += mono[:n] * gain * np.sin(th)

    # -- the arrangement --------------------------------------------------
    def build(self):
        rng = self.rng
        kick_through = self.out_plan.get("kickThroughBar", 0)
        single_hit_bar = self.out_plan.get("singleHitBar")

        pad_secs = set(self.cues.get("bed", {}).get(
            "padSections", ["drive", "main"]))
        pad_gain = float(self.cues.get("bed", {}).get("padGain", 0.0))

        pad_only = bool(self.cues.get('bed', {}).get('padOnly'))
        for bar in range(1, self.bars + 1):
            t0 = self.t_of(bar)
            sec = self.section_at(t0 + 0.001)
            if sec == "drop":
                continue
            # the pre-roll bar carries the pad and the logo mnemonic and
            # nothing else: the film's first hit is at 2.000
            preroll = sec == "preroll"
            # -- the pad: one bar of chord, crossfaded into the next ------
            if pad_gain > 0 and sec in pad_secs:
                _, _, notes = CHORDS[(bar - 1) % len(CHORDS)]
                # voiced an octave up, plus one two octaves up: the chord in
                # its own register sits at 220-392 Hz, which is below the band
                # a voice rest actually sounds empty in.  The pad has to live
                # where the hole is - 1-4 kHz - without touching 20-200 Hz.
                # Voiced two and three octaves above the plucks.  The band a
                # voice rest sounds empty in is 1-4 kHz, and a layer whose
                # FUNDAMENTALS sit below it does not fill it however loud it
                # gets - the first two attempts put the chord at 220-392 and
                # then 440-784 Hz and neither moved the number.
                freqs = [NOTE[nm] * 4 for nm in notes] + [NOTE[notes[0]] * 8]
                seg = pad(self.rng, self.bar + 0.35, freqs, seed_phase=bar * 0.7)
                f = int(0.18 * SR)
                seg[:f] *= np.linspace(0.0, 1.0, f)
                seg[-f:] *= np.linspace(1.0, 0.0, f)
                self.place(t0 - 0.1, seg, pad_gain, pan=-0.12)
                self.place(t0 - 0.1, pad(self.rng, self.bar + 0.35, freqs,
                                        seed_phase=bar * 0.7 + 1.9)
                           * np.concatenate([np.linspace(0, 1, f),
                                             np.ones(int((self.bar + 0.35) * SR) - 2 * f),
                                             np.linspace(1, 0, f)]),
                           pad_gain, pan=0.12)
            name, root, notes = CHORDS[(bar - 1) % len(CHORDS)]
            in_out = sec == "out"
            # The out section: the snap stops, the kick stops at `kickThroughBar`,
            # and the last bar carries the single hit and the ring-out alone.
            # The plucks and thinned hats keep running through the bars between,
            # so the bed never goes silent under the end card.
            #
            # `ringOut` keeps the thinned hats going through the single-hit bar
            # too.  A film whose end card is a single bar has nothing else under
            # it, and the master's gain then takes the last half-second below
            # -40 dBFS - which fails the bible's silence gate on the mix.  A hat
            # every 250 ms cannot leave a 0.4 s hole.
            spent = bar == single_hit_bar
            ring_out = bool(self.out_plan.get("ringOut")) and spent

            if pad_only or preroll:
                continue
            # -- hats ------------------------------------------------------
            if not spent or ring_out:
                if sec == "intro":
                    div, base = 2, 0.34
                elif ring_out or in_out:
                    # the ring-out bar runs at the same level as the rest of the
                    # out section: quieter and the hats fall under the -40 dBFS
                    # gate themselves, which is the hole they exist to fill
                    div, base = 2, 0.26
                else:
                    div, base = 4, 0.30
                for i in range(4 * div):
                    b = i / div
                    t = t0 + b * self.beat
                    if self.in_drop(t):
                        continue
                    accent = 1.0 if i % div == 0 else (0.62 if i % 2 == 0 else 0.44)
                    g = base * accent * rng.uniform(0.88, 1.12)
                    self.place(t, hat(rng, decay=rng.uniform(0.008, 0.013)), g,
                               pan=0.22 * (1 if i % 2 else -1))

            # -- kick ------------------------------------------------------
            if sec in ("drive", "main", "lift") or (in_out and bar <= kick_through):
                for b in KICK_BEATS:
                    t = t0 + b * self.beat
                    if self.in_drop(t):
                        continue
                    self.place(t, kick(rng), 0.92 if b == 0.0 else 0.66, 0.0)

            # -- bass ------------------------------------------------------
            if sec in ("drive", "main", "lift") or (in_out and bar <= kick_through):
                for j, b in enumerate(BASS_8THS):
                    t = t0 + b * self.beat
                    if self.in_drop(t):
                        continue
                    f = root * (1.0 if j % 3 else 1.5)  # root and the fifth above
                    self.place(t, bass(rng, f), 0.55 * rng.uniform(0.9, 1.05), 0.0)

            # -- snap ------------------------------------------------------
            if sec in ("main", "lift"):
                for b in SNAP_BEATS:
                    t = t0 + b * self.beat
                    if self.in_drop(t):
                        continue
                    self.place(t, snap(rng), 0.40, pan=0.06)

            # -- pluck: the chords ----------------------------------------
            if not spent:
                offs = PLUCK_SPARSE if sec in ("intro", "out") else PLUCK_FULL
                oct_up = sec == "lift"
                index = 2.4 if oct_up else 4.5
                for i, b in enumerate(offs):
                    t = t0 + b * self.beat
                    if self.in_drop(t):
                        continue
                    f = NOTE[notes[i % len(notes)]] * (2.0 if oct_up else 1.0)
                    g = (0.26 if oct_up else 0.30) * rng.uniform(0.85, 1.1)
                    self.place(t, pluck(f, index=index), g,
                               pan=0.30 * np.sin(i * 1.7))

            # -- shimmer: the lift only -----------------------------------
            if sec == "lift" or (in_out and bar <= kick_through):
                for side in (-0.55, 0.55):
                    self.place(t0, shimmer(rng, self.bar, SHIMMER_NOTES, 23),
                               0.115, pan=side)

        # -- the single hit that closes the film --------------------------
        if single_hit_bar:
            t = self.t_of(single_hit_bar)
            _, root, notes = CHORDS[(single_hit_bar - 1) % len(CHORDS)]
            self.place(t, kick(self.rng), 0.95, 0.0)
            for i, nm in enumerate(notes):
                self.place(t + i * 0.012, pluck(NOTE[nm], index=2.2, decay=0.45),
                           0.24, pan=0.28 * np.sin(i * 1.9))

        # -- the drop: everything stops -----------------------------------
        if self.drop:
            a = int(round(float(self.drop["fromSec"]) * SR))
            b = int(round(float(self.drop["toSec"]) * SR))
            f = int(0.005 * SR)
            self.buf[a : a + f] *= np.linspace(1.0, 0.0, f)[:, None]
            self.buf[a + f : b] = 0.0

        # -- the reverse swells, added after the gate ---------------------
        for sw in self.swells:
            dur = float(sw.get("dur", 1.0))
            end = float(sw["endSec"])
            x = swell(self.rng, dur)
            self.place(end - dur, x, float(sw.get("gain", 0.5)), pan=-0.18)
            self.place(end - dur, swell(self.rng, dur), float(sw.get("gain", 0.5)), pan=0.18)

        # -- trim and level -----------------------------------------------
        n = int(round(self.seconds * SR))
        out = self.buf[:n].copy()
        f = int(0.004 * SR)
        out[:f] *= np.linspace(0.0, 1.0, f)[:, None]
        out[-f:] *= np.linspace(1.0, 0.0, f)[:, None]
        peak = np.max(np.abs(out))
        if peak > 0:
            out *= 10 ** (-6.0 / 20) / peak  # deterministic -6 dBFS peak;
        return out                            # mix.mjs sets the loudness

    def in_drop(self, t):
        if not self.drop:
            return False
        return float(self.drop["fromSec"]) - 1e-9 <= t < float(self.drop["toSec"]) - 1e-9


def main(argv=None):
    ap = argparse.ArgumentParser(description="Render the procedural bed.")
    ap.add_argument("--id")
    ap.add_argument("--cues")
    ap.add_argument("--out")
    ap.add_argument("--pad-only", action="store_true",
                    help="render only the sustained layer, to set its level")
    a = ap.parse_args(argv)
    if not a.cues:
        if not a.id:
            ap.error("--id or --cues is required")
        a.cues = HERE / "cues" / f"{a.id}.cues.json"
    cues = json.loads(pathlib.Path(a.cues).read_text(encoding="utf-8"))
    fid = cues["id"]
    out = pathlib.Path(a.out) if a.out else OUT_ROOT / f"bed-{fid}.wav"
    if getattr(a, 'pad_only', False):
        cues = json.loads(json.dumps(cues))
        cues['bed']['padOnly'] = True
    x = Bed(cues).build()
    wav_write(out, x)
    print(f"bed  {fid}  {len(x)/SR:.3f} s  {x.shape[1]} ch  peak "
          f"{20*np.log10(np.max(np.abs(x))):.2f} dBFS  -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
