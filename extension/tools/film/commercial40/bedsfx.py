#!/usr/bin/env python
"""Voiceless timing master for the 40 s film: bed + SFX placed on the hits measured on the EN film.

    PYTHONUTF8=1 uv run --with numpy --with scipy python bedsfx.py [--cues ../audio/cues/qa-wrap-40-ar.cues.json]

Needs: bed.py output (work/film/c40/audio/bed-ar.wav, rendered from the same cue file) and sfx.py output
(work/film/audio/out/sfx/*.wav). Writes work/film/c40/audio/bed-sfx.wav, 40.000 s, 48 kHz stereo, 24-bit,
at FINAL master level (bed-only gaps at the EN level, hits at the EN level); mix.py adds the voice on top.
Levels: BED_DB / SFX_DB below were calibrated once against the EN reference (en-audio-measure.md)."""
import argparse, json, pathlib, sys
import numpy as np
HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "audio"))
from bed import wav_read, wav_write, SR  # noqa: E402
ROOT = HERE.parents[3]
A = ROOT / "work" / "film" / "c40" / "audio"
BED_DB = 3.7   # calibrated: bed-only 6.1-7.9 s = EN -27.8 dBFS (en-audio-measure.md)
SFX_DB = 1.5   # calibrated on the turn (9.985) and the end card (35.99) against EN

ap = argparse.ArgumentParser()
ap.add_argument("--cues", default=str(HERE.parent / "audio" / "cues" / "qa-wrap-40-ar.cues.json"))
ap.add_argument("--bed-db", type=float, default=BED_DB)
ap.add_argument("--sfx-db", type=float, default=SFX_DB)
ap.add_argument("--out", default=str(A / "bed-sfx.wav"))
a = ap.parse_args()
cues = json.loads(pathlib.Path(a.cues).read_text(encoding="utf-8"))
n = int(round(cues["seconds"] * SR))


def st(x):
    x = np.asarray(x, dtype=np.float64)
    return np.stack([x, x], 1) if x.ndim == 1 else x


bed = st(wav_read(A / "bed-ar.wav")[0])
sh = int(round(-cues["bed"].get("gridOffsetSec", 0.0) * SR))  # 15 ms earlier, as the EN grid
bed = np.concatenate([bed[sh:], np.zeros((sh, 2))])[:n] * 10 ** (a.bed_db / 20)
sfx = np.zeros_like(bed)
sfxdir = ROOT / "work" / "film" / "audio" / "out" / "sfx"
for c in cues.get("sfx", []):
    w = st(wav_read(sfxdir / f"{c['cue']}.wav")[0]) * 10 ** ((c.get("gainDb", 0) + a.sfx_db) / 20)
    s = int(round(c["atSec"] * SR))
    m = min(len(w), n - s)
    sfx[s:s + m] += w[:m]


def shape(x):
    d = cues["bed"].get("drop")
    if d:  # the hard silence holds for the SFX too (bed.py only silences the bed)
        i, j = int(round(d["fromSec"] * SR)), int(round(d["toSec"] * SR))
        f = int(0.005 * SR)
        x[i:i + f] *= np.linspace(1, 0, f)[:, None]
        x[i + f:j] = 0
    t = cues.get("tail")
    if t:
        e = np.array(t["envelopeDb"], dtype=float)  # [[sec, dB], ...] gain envelope, silence after fadeToSec
        i, j = int(e[0, 0] * SR), int(t["fadeToSec"] * SR)
        g = 10 ** (np.interp(np.arange(i, j) / SR, e[:, 0], e[:, 1]) / 20)
        x[i:j] *= g[:, None]
        x[j:] = 0
    return x


bed, sfx = shape(bed), shape(sfx)
# soft ceiling at -1.4 dBFS: the turn hit (+8 dB to match EN) would clip a 24-bit file; below about -10 dBFS it is linear
C = 0.85
out = C * np.tanh((bed + sfx) / C)
# stems for mix.py (the bed is carved under the voice, the SFX are not); same ceiling, so stems sum to the master closely
stems = pathlib.Path(a.out).parent / "stems"
wav_write(stems / "bed.wav", C * np.tanh(bed / C))
wav_write(stems / "sfx.wav", C * np.tanh(sfx / C))
pk = np.max(np.abs(out))
wav_write(pathlib.Path(a.out), out)
print(f"bed-sfx {len(out)/SR:.3f} s  peak {20*np.log10(pk):.2f} dBFS  {len(cues.get('sfx', []))} hits -> {a.out}")
