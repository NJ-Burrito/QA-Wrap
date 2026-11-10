#!/usr/bin/env python3
"""Voice the QA Wrap tutorials and mux the voice onto the rendered masters.

    PYTHONUTF8=1 python videos-tut/voice.py --all            # every film that has a rendered master, EN and AR
    PYTHONUTF8=1 python videos-tut/voice.py record-a-session ar
    PYTHONUTF8=1 python videos-tut/voice.py --all --dry      # print the plan, call nothing

Owner exception for run qaw-1109 only (2026-11-09): Gemini Kore via OpenRouter, google/gemini-3.1-flash-tts-preview,
style `manual`, direction byte-exact from nj-writer/voice-styles.json. ONE request per line, ONE take: no verify, no
re-voice, no best-of-N, no ASR, no LLM judge. A line already voiced (its wav exists) is reused, never re-requested.
The key is read from ~/.config/openrouter/qa-wrap-1109.env inside this process; it is never printed or written.
Each line is placed at its slot (adelay); a line longer than its slot is sped up by at most 1.25 (atempo).
The mux copies the video stream (no re-encode), mixes the lines, one loudnorm pass (I=-14, TP=-2, LRA=11), AAC.
"""
import json, os, pathlib, struct, subprocess, sys, urllib.error, urllib.request, wave

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent
SRC = HERE / 'src'
OUT = REPO / 'site' / 'media' / 'tutorials'
WORK = pathlib.Path(os.environ.get('QAW_VOICE_WORK', 'O:/Temp/qaw1109-tut/voice'))
KEY_FILE = pathlib.Path.home() / '.config' / 'openrouter' / 'qa-wrap-1109.env'
STYLES = pathlib.Path('O:/VScode Projects/nj-plugin/skills/nj-writer/voice-styles.json')
MODEL = 'google/gemini-3.1-flash-tts-preview'
VOICE, STYLE = 'Kore', 'manual'
MAX_TEMPO = 1.25


def key():
    if os.environ.get('OPENROUTER_API_KEY'):  # owner-supplied in-process key; never stored on disk
        return os.environ['OPENROUTER_API_KEY']
    if not KEY_FILE.exists():
        sys.exit(f'no key file at {KEY_FILE}; nothing voiced (the masters stay silent)')
    vals = {}
    for ln in KEY_FILE.read_text(encoding='utf-8').splitlines():
        if '=' in ln and not ln.strip().startswith('#'):
            k, v = ln.split('=', 1)
            vals[k.strip()] = v.strip().strip('"').strip("'")
    for k in ('OPEN_ROUTER_TOKEN', 'OPENROUTER_API_KEY', 'OPENROUTER_KEY'):
        if vals.get(k):
            return vals[k]
    for v in vals.values():
        if v.startswith('sk-or-'):
            return v
    sys.exit('key file has no OpenRouter key')


def direction():
    d = json.loads(STYLES.read_text(encoding='utf-8'))
    return next(s['direction'] for s in d['styles'] if s['id'] == STYLE)


def speak(text, wav, tok):
    body = json.dumps({'model': MODEL, 'input': text, 'voice': VOICE, 'response_format': 'pcm'}).encode('utf-8')
    req = urllib.request.Request('https://openrouter.ai/api/v1/audio/speech', data=body,
                                 headers={'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'})
    try:
        pcm = urllib.request.urlopen(req, timeout=180).read()
    except urllib.error.HTTPError as e:
        sys.exit('HTTP %d: %s' % (e.code, e.read().decode('utf-8', 'replace')[:200]))
    if len(pcm) < 2000:
        sys.exit('only %d bytes of audio' % len(pcm))
    with wave.open(str(wav), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(pcm)


def seconds(wav):
    with wave.open(str(wav), 'rb') as w:
        return w.getnframes() / w.getframerate()


def one(fid, lang, dry):
    meta = json.loads((SRC / f'{fid}.json').read_text(encoding='utf-8'))
    master = OUT / f'{fid}-{lang}.mp4'
    if not master.exists():
        print(f'  skip {fid}-{lang}: no master at {master}')
        return
    d = direction()
    tok = None if dry else key()
    wd = WORK / f'{fid}-{lang}'
    wd.mkdir(parents=True, exist_ok=True)
    inputs, chains, labels = ['-i', str(master)], [], []
    for i, L in enumerate(meta['lines'], start=1):
        text = d + (L.get('ar_tts') or L['ar'] if lang == 'ar' else L['en'])
        wav = wd / f"{L['id']}.wav"
        if dry:
            print(f"  {fid}-{lang} {L['id']} slot {L['start']}-{L['end']} -> {len(text.encode('utf-8'))} bytes")
            continue
        if not wav.exists():
            speak(text, wav, tok)  # one request, one take
        dur = seconds(wav)
        slot = L['end'] - L['start']
        tempo = min(MAX_TEMPO, dur / slot) if dur > slot else 1.0
        print(f"  {fid}-{lang} {L['id']}: {dur:.2f}s in a {slot:.2f}s slot, tempo {tempo:.2f}")
        inputs += ['-i', str(wav)]
        chains.append(f"[{i}:a]aformat=sample_rates=48000:channel_layouts=mono,atempo={tempo:.4f},adelay={int(L['start'] * 1000)}:all=1[a{i}]")
        labels.append(f'[a{i}]')
    if dry:
        return
    fc = ';'.join(chains) + f";{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=longest,loudnorm=I=-14:TP=-2.0:LRA=11,apad[a]"  # apad: -shortest then ends at the video, never cuts the end card
    tmp = master.with_suffix('.voiced.mp4')
    cmd = ['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex', fc, '-map', '0:v:0', '-map', '[a]',
           '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', str(tmp)]
    subprocess.run(cmd, check=True)
    os.replace(tmp, master)
    print(f'  voiced {master.name}')


def main():
    a = [x for x in sys.argv[1:] if not x.startswith('--')]
    dry = '--dry' in sys.argv
    if '--all' in sys.argv:
        ids = sorted(p.stem for p in SRC.glob('*.json'))
        langs = ['en', 'ar']
    else:
        if not a:
            sys.exit(__doc__)
        ids = [a[0]]
        langs = [a[1]] if len(a) > 1 else ['en', 'ar']
    for fid in ids:
        for lang in langs:
            one(fid, lang, dry)


if __name__ == '__main__':
    main()
