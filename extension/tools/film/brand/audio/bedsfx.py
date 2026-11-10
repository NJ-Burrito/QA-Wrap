#!/usr/bin/env python
"""Voiceless timing master per brand film: bed + SFX (copied from commercial40/bedsfx.py, generalised; worker bv).

    PYTHONUTF8=1 uv run --with numpy --with scipy python bedsfx.py <slug>

Renders the bed with audio/bed.py from audio/cues/brand-<slug>.cues.json, places the SFX family
(work/film/audio/out/sfx/*.wav, rendered by audio/sfx.py) on the cue times, holds the deliberate silence and the
tail envelope, and writes work/film/brand/<slug>/audio/bed-sfx.wav (exact film duration, 48 kHz stereo, 24-bit)
plus stems/{bed,sfx}.wav for mix.py. Levels: the commercial's calibration (BED_DB 3.7, SFX_DB 1.5)."""
import json, pathlib, subprocess, sys
import numpy as np
HERE = pathlib.Path(__file__).resolve().parent
AUD = HERE.parents[1] / "audio"
sys.path.insert(0, str(AUD))
from bed import wav_read, wav_write, SR  # noqa: E402
ROOT = HERE.parents[4]
BED_DB, SFX_DB, C = 3.7, 1.5, 0.85

slug = sys.argv[1]
cues_p = AUD / "cues" / f"brand-{slug}.cues.json"
cues = json.loads(cues_p.read_text(encoding="utf-8"))
A = ROOT / "work" / "film" / "brand" / slug / "audio"
A.mkdir(parents=True, exist_ok=True)
r = subprocess.run([sys.executable, str(AUD / "bed.py"), "--cues", str(cues_p), "--out", str(A / "bed.wav")], capture_output=True, text=True)
if r.returncode: sys.exit(r.stderr[-1500:])
print(r.stdout.strip())
n = int(round(cues["seconds"] * SR))


def st(x):
    x = np.asarray(x, dtype=np.float64)
    return np.stack([x, x], 1) if x.ndim == 1 else x


bed = st(wav_read(A / "bed.wav")[0])
bed = np.concatenate([bed, np.zeros((max(0, n - len(bed)), 2))])[:n] * 10 ** (BED_DB / 20)
sfx = np.zeros_like(bed)
sfxdir = ROOT / "work" / "film" / "audio" / "out" / "sfx"
for c in cues.get("sfx", []):
    w = st(wav_read(sfxdir / f"{c['cue']}.wav")[0]) * 10 ** ((c.get("gainDb", 0) + SFX_DB) / 20)
    s = int(round(c["atSec"] * SR))
    m = min(len(w), n - s)
    sfx[s:s + m] += w[:m]


def shape(x):
    d = cues["bed"].get("drop")
    if d:  # the deliberate silence holds for the SFX too (bed.py only silences the bed)
        i, j = int(round(d["fromSec"] * SR)), int(round(d["toSec"] * SR))
        f = int(0.005 * SR)
        x[i:i + f] *= np.linspace(1, 0, f)[:, None]
        x[i + f:j] = 0
    t = cues["tail"]
    e = np.array(t["envelopeDb"], dtype=float)
    i, j = int(e[0, 0] * SR), int(t["fadeToSec"] * SR)
    x[i:j] *= (10 ** (np.interp(np.arange(i, j) / SR, e[:, 0], e[:, 1]) / 20))[:, None]
    x[j:] = 0
    return x


bed, sfx = shape(bed), shape(sfx)
out = C * np.tanh((bed + sfx) / C)
wav_write(A / "stems" / "bed.wav", C * np.tanh(bed / C))
wav_write(A / "stems" / "sfx.wav", C * np.tanh(sfx / C))
wav_write(A / "bed-sfx.wav", out)
print(f"bed-sfx {slug} {len(out)/SR:.3f} s  peak {20*np.log10(np.max(np.abs(out))):.2f} dBFS  {len(cues['sfx'])} hits")
