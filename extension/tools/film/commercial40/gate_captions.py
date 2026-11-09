"""Caption-window gate: measure caption on-sets in a rendered MP4 (ink in the caption band) and compare them with the
treatment's windows (bible section 8). Usage: uv run --with numpy python gate_captions.py <mp4> --aspect 16x9|9x16
Exit 1 if any on-set is more than 2 frames from its window start, or the count differs."""
import subprocess, sys, json, argparse
import numpy as np

STARTS = [.37, 2.47, 4.03, 6.0, 8.2, 10.37, 13.07, 15.47, 16.97, 17.77, 20.07, 21.6, 22.7, 24.77, 26.4, 28.67, 30.1,
          31.5, 33.07, 36.37, 37.43]  # 21 AR captions incl. bridge 3b at 6.0
ap = argparse.ArgumentParser(); ap.add_argument("mp4"); ap.add_argument("--aspect", default="16x9"); a = ap.parse_args()
# caption band (x, y, w, h) at the composition's caption position, inline start = right for Arabic
x, y, w, h = (1000, 884, 808, 58) if a.aspect == "16x9" else (70, 1272, 840, 120)
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
