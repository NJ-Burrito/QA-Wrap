#!/usr/bin/env python
"""Write extension/tools/film/audio/cues/brand-<slug>.cues.json for each brand film (worker bv, 2026-11-10).

    PYTHONUTF8=1 python cues.py [<slug> ...]

Source: the film's Sound section (work/film/brand/films.json: sfx, bed) on the commercial's bed character
(qa-wrap-40-ar.cues.json: master, lowPad, pad, swell shape, out plan, SFX gains by cue kind), with the builders'
cue moves (MOVES) applied so each hit lands on the drawn key frame. Read-only on the commercial cue file."""
import copy, json, pathlib, sys
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[4]
CUES = ROOT / "extension" / "tools" / "film" / "audio" / "cues"
FILMS = ROOT / "work" / "film" / "brand" / "films.json"
# (slug, cue, doc sec) -> (drawn sec, why)
MOVES = {
    ("every-moment", "sting", 25.6): (23.5, "b1-notes: the scrub head reaches the red mark at 23.5 s (key frame 23.6); 25.6 s would hit a second pulse"),
    ("yours-sealed", "tick", 12.8): (12.2, "b3-notes: Mask real data is pressed at 12.2 s; 12.8 s is the key frame showing the result"),
    ("the-toolbox", "success", 35.6): (35.4, "b2-notes: the coverage meter fills 34.7-35.4 s; the success lands as it completes"),
}
GAIN = {"tick": 4, "sting": -3}  # commercial's per-kind levels (ticks +4, stings -3..-4, others 0)


def build(f, ref):
    b = f["bed"]
    secs = b["sections"]
    drive = next(s for s in secs if s["name"] == "drive")
    out = [s for s in secs if s["name"] == "out"][-1]
    bed = copy.deepcopy(ref["bed"])
    for k in ("drop", "gridOffsetSec", "gridNote", "swells", "outPlan", "targetLufs"):
        bed.pop(k, None)
    bed["sections"] = secs
    bed["swells"] = [{"endSec": b["swellEndSec"], "dur": 0.75, "gain": 0.45, "note": "reverse swell into the end card"}]
    bed["outPlan"] = {"kickThroughBar": drive["toBar"], "singleHitBar": out["fromBar"], "ringOut": True}
    if b.get("silence"):
        bed["drop"] = {"fromSec": b["silence"][0], "toSec": b["silence"][1], "note": "the one deliberate silence (films.json bed.silence)"}
    sfx, moved = [], []
    for c in f["sfx"]:
        at, why = MOVES.get((f["slug"], c["cue"], c["atSec"]), (c["atSec"], None))
        e = {"cue": c["cue"], "atSec": at, "gainDb": GAIN.get(c["cue"], 0), "event": c["hits"]}
        if why:
            e.update(docSec=c["atSec"], moved=why); moved.append(e)
        sfx.append(e)
    D, T = float(f["duration"]), float(b["tailFadeSec"])
    return {
        "id": f"brand-{f['slug']}", "kind": "trailer", "bpm": b["bpm"], "fps": f["fps"], "bars": b["bars"], "seconds": D,
        "sampleRate": 48000,
        "source": "brand film Sound section (work/film/brand/films.json) on the bed character of qa-wrap-40-ar.cues.json; worker bv 2026-11-10",
        "master": dict(ref["master"], truePeakDbtp=-1.5), "bed": bed, "voice": {"voice": "Kore", "lines": []},
        "seed": 20260908 + int(f["n"]), "rests": [], "revision": f"brand-{f['slug']}-1", "sfx": sfx,
        "tail": {"envelopeDb": [[T, 0], [T + 0.1, -9], [T + 0.6, -14], [T + 0.9, -30], [D - 0.05, -70]], "fadeToSec": D - 0.05,
                 "note": "tail fade from films.json bed.tailFadeSec, the commercial's envelope shape"},
    }


def main(slugs):
    ref = json.loads((CUES / "qa-wrap-40-ar.cues.json").read_text(encoding="utf-8"))
    films = json.loads(FILMS.read_text(encoding="utf-8"))["films"]
    for f in films:
        if slugs and f["slug"] not in slugs: continue
        c = build(f, ref)
        p = CUES / f"brand-{f['slug']}.cues.json"
        p.write_text(json.dumps(c, ensure_ascii=False, indent=2), encoding="utf-8")
        print(p.name, len(c["sfx"]), "cues", [(m["docSec"], m["atSec"]) for m in c["sfx"] if "moved" in m])


main(sys.argv[1:])
