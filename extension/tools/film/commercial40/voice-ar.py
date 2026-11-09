#!/usr/bin/env python
"""Voice step for the Arabic 40 s film: Gemini Kore through OpenRouter, ONE request per line, one take.

    PYTHONUTF8=1 python voice-ar.py            # writes work/film/c40/audio/vo/NN.wav

Allowed for this job only (owner, 2026-11-09). Key: ~/.config/openrouter/qa-wrap-1109.env (OPENROUTER_API_KEY),
read inside this process, never printed, logged or written. No verify, no re-voice, no ASR/LLM judge.
A line that already has a wav is skipped (idempotent), never re-voiced. The only retry is for a transport
failure that returned no audio (HTTP error / empty stream); a take that returned audio is final."""
import json, pathlib, struct, sys, time, urllib.request, urllib.error
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[3]
OUT = ROOT / "work" / "film" / "c40" / "audio" / "vo"
KEY = pathlib.Path.home() / ".config" / "openrouter" / "qa-wrap-1109.env"
DELIVERY = ("Read this in Arabic at a steady, natural pace, warm and professional, like a colleague explaining "
            "something. Breathe briefly after commas and full stops, but keep the sentence flowing. Fall at the end: ")
def main():
    if not KEY.exists():
        sys.exit(f"NO KEY: {KEY} is missing; nothing was voiced.")
    tok = None
    for ln in KEY.read_text(encoding="utf-8").splitlines():
        if ln.strip().startswith("OPENROUTER_API_KEY"):
            tok = ln.split("=", 1)[1].strip().strip('"').strip("'")
    if not tok:
        sys.exit("NO KEY: OPENROUTER_API_KEY not found in the key file.")
    spec = json.loads((HERE / "vo-ar.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    for ln in spec["lines"]:
        wav = OUT / f"{ln['n']:02d}.wav"
        if wav.exists():
            print("skip", wav.name); continue
        body = json.dumps({"model": spec["model"], "input": DELIVERY + '"' + ln["tts"] + '"', "voice": spec["voice"],
                           "response_format": "pcm"}).encode("utf-8")
        for attempt in range(1, 4):
            req = urllib.request.Request("https://openrouter.ai/api/v1/audio/speech", data=body,
                                         headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
            try:
                pcm = urllib.request.urlopen(req, timeout=180).read()
            except urllib.error.HTTPError as e:
                print(f"line {ln['n']} HTTP {e.code} (attempt {attempt}, no audio returned)"); pcm = b""
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
