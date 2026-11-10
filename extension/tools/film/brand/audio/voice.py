#!/usr/bin/env python
"""Voice brand-film lines (EN and AR) exactly as work/film/brand/narration-manifest.json writes them.
Copied from commercial40/voice-brand-ar.py and generalised to both languages (worker bv, 2026-11-10).

    PYTHONUTF8=1 python voice.py <slug> [<slug> ...]        # every line of those films, EN then AR
    PYTHONUTF8=1 python voice.py --ids <line-id> [...]

input = the line's registered `direction` + its `tts_text` (AR) or `text` (EN, no tts_text), Kore,
gemini-3.1-flash-tts-preview, ONE request per line, one take. Before any call the whole manifest must pass
voice_style_gate.py --text-only. Output work/film/brand/vo/<slug>/<line-id>.wav and vo/voiced.json
(id, lang, style, seconds, sha256). A wav that exists is never voiced again. The only retry is a transport
failure that returned no audio. Key: ~/.config/openrouter/qa-wrap-1109.env, read in-process, never printed."""
import hashlib, json, os, pathlib, re, struct, subprocess, sys, time, urllib.request, urllib.error
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[4]
B = ROOT / "work" / "film" / "brand"
MAN = B / "narration-manifest.json"
OUT = B / "vo"
KEY = pathlib.Path.home() / ".config" / "openrouter" / "qa-wrap-1109.env"
NJW = pathlib.Path.home() / "Desktop" / "nj-plugin" / "skills" / "nj-writer"
MODEL, VOICE = "google/gemini-3.1-flash-tts-preview", "Kore"


def slug_of(i):
    return re.sub(r"-V\d+-(ar|en)$", "", i)


def save_voiced(voiced):
    (OUT / "voiced.json").write_text(json.dumps(voiced, ensure_ascii=False, indent=1), encoding="utf-8")


def main(argv):
    if not argv: sys.exit(__doc__)
    r = subprocess.run([sys.executable, str(NJW / "scripts" / "voice_style_gate.py"), str(MAN), "--text-only"],
                       capture_output=True, text=True, encoding="utf-8", env=dict(os.environ, PYTHONUTF8="1"))
    print(r.stdout.strip().splitlines()[-1])
    if r.returncode: sys.exit("GATE FAIL: nothing was voiced.")
    lines = {l["id"]: l for l in json.loads(MAN.read_text(encoding="utf-8"))["lines"]}
    if argv[0] == "--ids":
        ids = argv[1:]
    else:
        ids = [i for s in argv for lang in ("en", "ar") for i in lines if slug_of(i) == s and lines[i]["lang"] == lang]
    bad = [i for i in ids if i not in lines]
    if bad: sys.exit(f"not manifest lines: {bad}")
    vj = OUT / "voiced.json"
    voiced = json.loads(vj.read_text(encoding="utf-8")) if vj.exists() else []
    for v in voiced: v.setdefault("lang", v["id"].rsplit("-", 1)[1])
    save_voiced(voiced)
    todo = [i for i in ids if not (OUT / slug_of(i) / f"{i}.wav").exists()]
    if not todo: print("nothing to voice"); return
    tok = os.environ.get("OPENROUTER_API_KEY")
    for ln in ([] if tok else KEY.read_text(encoding="utf-8").splitlines()):
        if ln.strip().startswith("OPENROUTER_API_KEY"):
            tok = ln.split("=", 1)[1].strip().strip('"').strip("'")
    if not tok: sys.exit("NO KEY; nothing was voiced.")
    for i in todo:
        l = lines[i]
        wav = OUT / slug_of(i) / f"{i}.wav"
        if wav.exists(): print("skip", wav.name); continue
        wav.parent.mkdir(parents=True, exist_ok=True)
        text = l["tts_text"] if l["lang"] == "ar" else l.get("tts_text") or l["text"]
        body = json.dumps({"model": MODEL, "input": l["direction"] + text, "voice": VOICE, "response_format": "pcm"}).encode("utf-8")
        pcm = b""
        for attempt in range(1, 4):  # transport failures only: a response with audio is never re-requested
            req = urllib.request.Request("https://openrouter.ai/api/v1/audio/speech", data=body,
                                         headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
            try:
                pcm = urllib.request.urlopen(req, timeout=180).read()
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ConnectionError) as e:
                print(f"{i} transport error {getattr(e, 'code', type(e).__name__)} (attempt {attempt}, no audio)"); pcm = b""
            if len(pcm) > 2000: break
            time.sleep(4 * attempt)
        if len(pcm) <= 2000: sys.exit(f"{i}: no audio after transport retries; stopped.")
        hdr = (b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE" + b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, 24000, 48000, 2, 16)
               + b"data" + struct.pack("<I", len(pcm)))
        wav.write_bytes(hdr + pcm)
        voiced = [v for v in voiced if v["id"] != i] + [{"id": i, "lang": l["lang"], "style": l["style"], "seconds": round(len(pcm) / 48000, 3),
                                                          "sha256": hashlib.sha256(wav.read_bytes()).hexdigest(), "file": str(wav.relative_to(B)).replace("\\", "/")}]
        save_voiced(voiced)
        print("voiced", wav.name, round(len(pcm) / 48000, 2), "s", flush=True)
        time.sleep(1.2)


main(sys.argv[1:])
