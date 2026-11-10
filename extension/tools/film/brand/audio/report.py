#!/usr/bin/env python
"""Write work/film/brand/audio-report.md from the fit/mix/cue files and the gate's FULL-mode run (worker bv).

    PYTHONUTF8=1 python report.py"""
import json, os, pathlib, subprocess, sys
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[4]
B = ROOT / "work" / "film" / "brand"
CUES = ROOT / "extension" / "tools" / "film" / "audio" / "cues"
GATE = pathlib.Path.home() / "Desktop" / "nj-plugin" / "skills" / "nj-writer" / "scripts" / "voice_style_gate.py"
ORDER = ["every-moment", "one-report", "show-it", "the-toolbox", "yours-sealed", "your-way"]

g = subprocess.run([sys.executable, str(GATE), str(B / "narration-manifest.json")], capture_output=True, text=True,
                   encoding="utf-8", env=dict(os.environ, PYTHONUTF8="1"))
glines = g.stdout.strip().splitlines()
films = {f["slug"]: f for f in json.loads((B / "films.json").read_text(encoding="utf-8"))["films"]}
voiced = json.loads((B / "vo" / "voiced.json").read_text(encoding="utf-8"))
out = ["# Brand films: voice, fit and mix report (worker bv, 2026-11-10)", "",
       f"Lines voiced: {len(voiced)} of 94 (`work/film/brand/vo/voiced.json`). Kore, google/gemini-3.1-flash-tts-preview, one request per line, one take; "
       "the 9 Arabic lines voiced earlier were kept as they were.",
       "Pipeline: `extension/tools/film/brand/audio/{voice,cues,bedsfx,fit,mix,report}.py` (generalised copies of the commercial's; "
       "the commercial files were not edited).", "",
       "Pace band (voice-styles.json): AR 110-120 wpm, EN 145-155 wpm. wpm = words of the visible text / finished clip seconds x 60, "
       "as the gate measures it. Tempo = atempo applied (1.0 = untouched), cap 1.7.", ""]
outside, over, mixes = [], [], []
for s in ORDER:
    f = films[s]
    out += [f"## {s} ({f['duration']} s)", ""]
    for lang in ("en", "ar"):
        p = B / s / "audio" / f"fit-{lang}.json"
        if not p.exists():
            out += [f"{lang.upper()}: not fitted.", ""]; continue
        fit = json.loads(p.read_text(encoding="utf-8"))
        out += [f"### {lang.upper()}", "", "| Line | Style | Take s | Fitted s | Tempo | Start | End | Window | wpm | In band | Overrun ms | Pause keep s |",
                "|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for it in fit:
            out.append(f"| {it['v']} | {it['style']} | {it['takeSec']:.2f} | {it['finishedSec']:.2f} | {it['tempo']:.3f} | {it['start']:.2f} | "
                       f"{it['end']:.2f} | {it['scripted']:.2f}-{it['endBy']:.2f} | {it['wpm']:.1f} | {'yes' if it['inBand'] else 'NO'} | "
                       f"{it['overrunMs']} | {it['pauseKeep'][0]}/{it['pauseKeep'][1]} |")
            if not it["inBand"]: outside.append(f"{it['id']} ({it['wpm']} wpm, tempo {it['tempo']})")
            if it["overrunMs"]: over.append(f"{it['id']} ({it['overrunMs']} ms)")
        r = B / s / "audio" / f"mix-report-{lang}.json"
        if r.exists():
            m = json.loads(r.read_text(encoding="utf-8"))
            fin = (B / s / "audio" / f"MIX-FINAL-{lang}.txt").exists()
            mixes.append(f"| {s} | {lang.upper()} | {m['integratedLufs']} | {m['truePeakDbtp']} | {m['durationSec']:.3f} | {'yes' if fin else 'NO'} |")
        out.append("")
    c = json.loads((CUES / f"brand-{s}.cues.json").read_text(encoding="utf-8"))
    mv = [x for x in c["sfx"] if "moved" in x]
    out += [f"SFX: {len(c['sfx'])} cues (`extension/tools/film/audio/cues/brand-{s}.cues.json`)" + ("." if not mv else "; moved:")]
    out += [f"- {x['cue']} {x['docSec']} -> {x['atSec']} s: {x['moved']}" for x in mv]
    if c["bed"].get("drop"): out.append(f"- deliberate silence {c['bed']['drop']['fromSec']}-{c['bed']['drop']['toSec']} s (bed and SFX out; mix holds it at -75 dB or lower)")
    out.append("")
out += ["## Mixes", "", "| Film | Lang | Integrated LUFS | True peak dBTP | Duration s | MIX-FINAL |", "|---|---|---|---|---|---|"] + mixes + [""]
out += ["## Gate, FULL mode (`voice_style_gate.py work/film/brand/narration-manifest.json`)", "", "Last line: `" + (glines[-1] if glines else "no output") + "`", ""]
if len(glines) > 1: out += ["Failures:", ""] + [f"- {x}" for x in glines[:-1]] + [""]
out += ["## Lines still outside the band", ""] + ([f"- {x}" for x in outside] or ["- none"]) + [""]
out += ["## Lines with residual overrun", ""] + ([f"- {x}" for x in over] or ["- none"]) + [""]
(B / "audio-report.md").write_text("\n".join(out), encoding="utf-8")
print(glines[-1] if glines else "gate: no output", "| outside", len(outside), "| overruns", len(over), "| mixes", len(mixes))
