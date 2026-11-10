"""Plain SSIM and FOREGROUND SSIM of a test (video or snap.mjs folder) against a reference video, per second.

  PYTHONUTF8=1 uv run --with numpy --with scipy --with pillow python fgdiff.py REF TEST [--range A B] [--fps 10] [--times t1,t2,..] [--out x.tsv] [--frames x-frames.tsv]

TEST is a video or a folder of snap.mjs PNGs (t<sec>_<frac>.png, e.g. t12_5.png). Frames are compared on luma at full size.
SSIM map: 7x7 box window (K1 .01, K2 .03). Foreground = union of pixels where either frame's local contrast
|Y - boxblur31(Y)| > 8, dilated 5 px; FG-SSIM = mean of the SSIM map over that mask (the dark ground is left out).
Output TSV: second, frames, ssim, fg_ssim, fg_share (mask fraction); last line: summary.
"""
import argparse, os, subprocess, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ni

FPS_SRC = 30


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "csv=p=0", path], capture_output=True, text=True, check=True).stdout
    w, h = map(int, out.strip().split(",")[:2])
    return w, h


def video_frames(path, idx):
    """Yield (n, luma) at source frame numbers idx (sorted unique): one decode, streamed, one frame in memory."""
    w, h = probe(path)
    want, sz, k = set(idx), w * h, 0
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-frames:v", str(max(idx) + 1), "-vf", "format=gray", "-f", "rawvideo", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    for n in range(max(idx) + 1):
        buf = p.stdout.read(sz)
        if len(buf) < sz:
            break
        if n in want:
            k += 1
            yield n, np.frombuffer(buf, np.uint8).reshape(h, w).astype(np.float32)
    p.stdout.close(); p.wait()
    if k != len(want):
        sys.exit(f"{path}: got {k} frames for {len(want)} requested")


def png_luma(p):
    return np.asarray(Image.open(p).convert("L"), np.float32)


def ssim_map(a, b):
    m = lambda x: ni.uniform_filter(x, 7)
    C1, C2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    ma, mb = m(a), m(b)
    va, vb, cab = m(a * a) - ma * ma, m(b * b) - mb * mb, m(a * b) - ma * mb
    return ((2 * ma * mb + C1) * (2 * cab + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2))


def fg_mask(a, b):
    c = lambda x: np.abs(x - ni.uniform_filter(x, 31)) > 8
    return ni.binary_dilation(c(a) | c(b), iterations=5)


def snap_name(t):
    return "t" + ("%g" % round(t, 3)).replace(".", "_") + ".png"  # snap.mjs names t<arg> with "." -> "_"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ref"); ap.add_argument("test")
    ap.add_argument("--range", nargs=2, type=float); ap.add_argument("--fps", type=float, default=10)
    ap.add_argument("--times"); ap.add_argument("--out"); ap.add_argument("--frames")
    o = ap.parse_args()
    if o.times:
        ts = [float(x) for x in o.times.split(",")]
    else:
        a, b = o.range or (0, 40)
        ts = [round(a + i / o.fps, 4) for i in range(int(round((b - a) * o.fps)))]
    idx = sorted({int(round(t * FPS_SRC)) for t in ts})
    if os.path.isdir(o.test):
        paths = {}
        for t in ts:
            p = os.path.join(o.test, snap_name(t))
            if not os.path.exists(p):  # snap.mjs keeps the argument's spelling: "9.0" -> t9_0.png
                p = os.path.join(o.test, "t" + f"{t:.1f}".replace(".", "_") + ".png")
            if os.path.exists(p):
                paths[int(round(t * FPS_SRC))] = p
            else:
                print("missing", p, file=sys.stderr)
        pairs = ((n, r, png_luma(paths[n])) for n, r in video_frames(o.ref, idx) if n in paths)
    else:
        pairs = ((n, r, t) for (n, r), (_, t) in zip(video_frames(o.ref, idx), video_frames(o.test, idx)))
    rows, per = [], {}
    for n, r, t in pairs:
        if r.shape != t.shape:
            t = np.asarray(Image.fromarray(t.astype(np.uint8)).resize(r.shape[::-1], Image.BILINEAR), np.float32)
        sm, mk = ssim_map(r, t), fg_mask(r, t)
        s, fg = float(sm.mean()), float(sm[mk].mean()) if mk.any() else 1.0
        rows.append((n / FPS_SRC, s, fg, float(mk.mean())))
        per.setdefault(int(n // FPS_SRC), []).append(rows[-1])
    lines = ["second\tframes\tssim\tfg_ssim\tfg_share"]
    for sec in sorted(per):
        v = np.array([x[1:] for x in per[sec]])
        lines.append(f"{sec}\t{len(v)}\t{v[:,0].mean():.4f}\t{v[:,1].mean():.4f}\t{v[:,2].mean():.3f}")
    allv = np.array([x[1:] for x in rows])
    weak = [l.split("\t")[0] for l in lines[1:] if float(l.split("\t")[2]) < 0.93]
    summ = f"# frames {len(rows)}  ssim {allv[:,0].mean():.4f}  fg_ssim {allv[:,1].mean():.4f}  seconds<0.93: {','.join(weak) or 'none'}"
    lines.append(summ)
    txt = "\n".join(lines) + "\n"
    if o.out:
        open(o.out, "w", encoding="utf-8").write(txt)
    if o.frames:
        open(o.frames, "w", encoding="utf-8").write("t\tssim\tfg_ssim\tfg_share\n" + "".join(f"{a:.3f}\t{b:.4f}\t{c:.4f}\t{d:.3f}\n" for a, b, c, d in rows))
    print(txt if not o.out else summ)


if __name__ == "__main__":
    main()
