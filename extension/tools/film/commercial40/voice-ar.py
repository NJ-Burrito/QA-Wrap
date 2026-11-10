#!/usr/bin/env python
"""Voice step for the Arabic 40 s film: Gemini Kore through OpenRouter, ONE request per line, one take.

    PYTHONUTF8=1 python voice-ar.py              # manifest + text gate, then voice -> work/film/c40/audio/vo/NN.wav
    PYTHONUTF8=1 python voice-ar.py --gate-only  # manifest + text gate, no TTS call
    PYTHONUTF8=1 python voice-ar.py --only 1,2,4  # gate and voice only these lines (the others are held, not gated)

Style: each line of vo-ar.json names a REGISTERED style (nj-writer voice-styles.json, chosen by good_for/never_for);
its direction is taken byte-for-byte from the registry and sent as `input = direction + tts` (NARRATION.md §11).
No invented delivery text. Before any call the narration manifest is written and voice_style_gate.py --text-only
must PASS; a FAIL stops the step with zero calls.

Allowed for this job only (owner, 2026-11-09). Key: ~/.config/openrouter/qa-wrap-1109.env (OPENROUTER_API_KEY),
read inside this process, never printed, logged or written. No verify, no re-voice, no ASR/LLM judge.
A line that already has a wav is skipped (idempotent), never re-voiced. The only retry is for a transport
failure that returned no audio (HTTP error / empty stream); a take that returned audio is final."""
import json, os, pathlib, re, struct, subprocess, sys, time, urllib.request, urllib.error
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[3]
AUD = ROOT / "work" / "film" / "c40" / "audio"
OUT = AUD / "vo"
KEY = pathlib.Path.home() / ".config" / "openrouter" / "qa-wrap-1109.env"
NJW = pathlib.Path.home() / "Desktop" / "nj-plugin" / "skills" / "nj-writer"
MARKS = re.compile("[ً-ْٰ]")


def manifest(spec):
    reg = json.loads((NJW / "voice-styles.json").read_text(encoding="utf-8"))
    by = {s["id"]: s for s in reg["styles"]}
    lines = [{"id": l["n"], "lang": "ar", "style": l["style"], "direction": by[l["style"]]["direction"],
              "text": MARKS.sub("", l.get("ttsUsed", l["tts"])), "tts_text": l.get("ttsUsed", l["tts"])} for l in spec["lines"]]  # ttsUsed: the part of a cut take that is in the film
    m = {"film": "qa-wrap-40 AR", "voice": spec["voice"], "model": spec["model"], "lines": lines}
    AUD.mkdir(parents=True, exist_ok=True)
    p = AUD / "narration-manifest.json"
    p.write_text(json.dumps(m, ensure_ascii=False, indent=1), encoding="utf-8")
    r = subprocess.run([sys.executable, str(NJW / "scripts" / "voice_style_gate.py"), str(p), "--text-only"],
                       capture_output=True, text=True, encoding="utf-8", env=dict(os.environ, PYTHONUTF8="1"))
    print(r.stdout.strip())
    if r.returncode:
        sys.exit("GATE FAIL: nothing was voiced.")
    return {l["id"]: l["direction"] for l in lines}


def main():
    spec = json.loads((HERE / "vo-ar.json").read_text(encoding="utf-8"))
    if "--only" in sys.argv:
        keep = {int(x) for x in sys.argv[sys.argv.index("--only") + 1].split(",")}
        held = [l["n"] for l in spec["lines"] if l["n"] not in keep]
        spec["lines"] = [l for l in spec["lines"] if l["n"] in keep]
        print("held (not gated, not voiced):", held)
    direction = manifest(spec)
    if "--gate-only" in sys.argv:
        return
    tok = os.environ.get("OPENROUTER_API_KEY")  # owner-supplied in-process key; never stored on disk
    if not tok and not KEY.exists():
        sys.exit(f"NO KEY: {KEY} is missing; nothing was voiced.")
    for ln in ([] if tok else KEY.read_text(encoding="utf-8").splitlines()):
        if ln.strip().startswith("OPENROUTER_API_KEY"):
            tok = ln.split("=", 1)[1].strip().strip('"').strip("'")
    if not tok:
        sys.exit("NO KEY: OPENROUTER_API_KEY not found in the key file.")
    OUT.mkdir(parents=True, exist_ok=True)
    for ln in spec["lines"]:
        wav = OUT / f"{ln['n']:02d}.wav"
        if wav.exists():
            print("skip", wav.name); continue
        body = json.dumps({"model": spec["model"], "input": direction[ln["n"]] + ln["tts"], "voice": spec["voice"],
                           "response_format": "pcm"}).encode("utf-8")
        for attempt in range(1, 4):
            req = urllib.request.Request("https://openrouter.ai/api/v1/audio/speech", data=body,
                                         headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
            try:
                pcm = urllib.request.urlopen(req, timeout=180).read()
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
                print(f"line {ln['n']} transport error {getattr(e, 'code', type(e).__name__)} (attempt {attempt}, no audio returned)"); pcm = b""
            if len(pcm) > 2000: break
            time.sleep(4 * attempt)
        if len(pcm) <= 2000:
            sys.exit(f"line {ln['n']}: no audio after transport retries; stopped.")
        hdr = (b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE" + b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, 24000, 48000, 2, 16)
               + b"data" + struct.pack("<I", len(pcm)))
        wav.write_bytes(hdr + pcm)
        print("voiced", wav.name, round(len(pcm) / 48000, 2), "s")
        time.sleep(1.2)
main()
