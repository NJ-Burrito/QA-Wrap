"""Caption-window gate: measure caption on-sets in a rendered MP4 (ink in the caption band) and compare them with the
language's own windows, read from composition.template.html (EN: CAPT = bible section 8; AR: CAPT_AR, which follows the Arabic
voice, work/film/c40/final/caption-sync-ar.md). Usage: uv run --with numpy python gate_captions.py <mp4> --aspect 16x9|9x16 [--lang ar|en]
Exit 1 if any on-set is more than 2 frames from its window start, or the count differs."""
import subprocess, sys, json, argparse
import numpy as np

ap = argparse.ArgumentParser(); ap.add_argument("mp4"); ap.add_argument("--aspect", default="16x9"); ap.add_argument("--lang", default="ar", choices=["ar", "en"]); a = ap.parse_args()
import os, re
_t = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "composition.template.html"), encoding="utf-8").read()
_w = json.loads(re.sub(r"(?<![\d])\.(?=\d)", "0.", re.search(r"const %s=(\[\[.*?\]\]);" % ("CAPT_AR" if a.lang == "ar" else "CAPT"), _t).group(1)))
STARTS = [w[0] for k, w in enumerate(_w) if k != 3]  # 20 captions; index 3 (bridge 3b) has no caption in either film (Director, round 3)
# caption band (x, y, w, h) at the composition's caption position, inline start = right for Arabic
x, y, w, h = ((1000 if a.lang == "ar" else 112), 884, 808, 58) if a.aspect == "16x9" else (70, 1425, 840, 70)  # 9:16 band follows CAPY_V 1432 (v1)
cmd = ["ffmpeg", "-v", "error", "-i", a.mp4, "-vf", f"crop={w}:{h}:{x}:{y},format=gray", "-f", "rawvideo", "-"]
raw = subprocess.run(cmd, capture_output=True, check=True).stdout
fr = np.frombuffer(raw, np.uint8).reshape(-1, h, w)
ink = (fr > 170).sum(axis=(1, 2))
# R15: prove the detector sees a caption (frame 30 = 1.0 s lies inside caption 1) and sees none at frame 0
assert ink[30] > 200 and ink[0] < 50, f"detector did not observe ink: f0={ink[0]} f30={ink[30]}"
on = ink > 120
onsets = [i for i in range(1, len(on)) if on[i] and not on[i - 1]]
res = {"frames": len(fr), "onsets_s": [round(i / 30, 3) for i in onsets]}
fails = []
if len(onsets) != len(STARTS):
    fails.append(f"count {len(onsets)} != {len(STARTS)}")
for k, s in enumerate(STARTS):
    near = min(onsets, key=lambda i: abs(i / 30 - s)) if onsets else None
    d = None if near is None else round(abs(near / 30 - s) * 30, 2)
    if d is None or d > 2: fails.append(f"cap {k}: start {s} nearest {near and near / 30:.3f} ({d} fr)")
res["fails"] = fails
print(json.dumps(res, ensure_ascii=False))
print(("CAPTIONS PASS" if not fails else "CAPTIONS FAIL") + f" {a.aspect}: {len(onsets)} on-sets, max diff "
      f"{max(round(abs(min(onsets, key=lambda i: abs(i/30-s))/30 - s)*30, 2) for s in STARTS) if onsets else 'n/a'} fr")
sys.exit(1 if fails else 0)
