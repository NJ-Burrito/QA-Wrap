#!/usr/bin/env python
"""voice_style_gate.py <manifest.json> — FAILS a narration manifest that breaks the Kore style rules.
Manifest: {"lines":[{"id","lang":"ar|en","style","direction","text"(visible),"tts_text"(Arabic only, required: full tashkeel),"seconds"(finished clip),"tempo"(applied atempo, optional)}]}
Fails on: no style, unregistered style, direction not byte-equal to the registry, wpm outside the
registry band (words of visible text / seconds * 60), tempo > max_tempo, visible text that looks like the TTS text pasted in
(more than 50% of its Arabic words marked; the source's OWN marks, e.g. فتحاً, are allowed), and for Arabic: no tts_text, any word of tts_text
with no mark, any markable letter (final letter included) without a mark, tts_text letters != visible letters,
a shadda split into letter+sukun+same letter (R-TASHKEEL-002, measured worse), a control character in tts_text
(a mark-rewriting helper once injected U+0001 and dropped a vowel). Mark ORDER is not checked: vowel-then-shadda (NFC) measured as good as shadda-first (R-TASHKEEL-001).
Exempt from needing a mark: ا آ ٱ ى; و after damma and ي after kasra (madd); the lam of ال before a
shadda'd sun letter.
--text-only (pre-voicing, Nader 2026-10-03): runs every check that needs no audio (style, direction, tashkeel,
alignment, split shadda, control chars, over-marked visible text) and skips seconds/wpm/tempo, so it can run
BEFORE the first TTS call; lines need no seconds/tempo. Full mode is unchanged.
Usage: PYTHONUTF8=1 python voice_style_gate.py <manifest.json> [--text-only] | --selftest
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from voice_style import load  # noqa: E402

TASHKEEL = re.compile("[ً-ْٰ]")
ARLETTER = re.compile("[ء-غف-يٱ]")
DAMMA, KASRA, SHADDA = "ُ", "ِ", "ّ"
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")  # stray control chars from text rewriting
SPLIT_SHADDA = re.compile(r"([ء-غف-ي])ْ\1")   # letter+sukun+same letter instead of a shadda (KB #15)
MAX_VISIBLE_MARKED = 0.5                   # share of Arabic words that may carry marks in visible text


def marked_share(t):
    ws = words(t)
    return sum(any(m for _, m in w) for w in ws) / len(ws) if ws else 0.0


def words(t):
    """Arabic words as [(letter, marks)] lists; non-Arabic tokens are skipped."""
    out = []
    for tok in t.split():
        w = []
        for ch in tok:
            if ARLETTER.match(ch):
                w.append([ch, ""])
            elif TASHKEEL.match(ch) and w:
                w[-1][1] += ch
        if w:
            out.append(w)
    return out


def bare_ok(w, i):
    """True if letter i of word w may carry no mark (documented exceptions)."""
    ch, prev = w[i][0], (w[i - 1][1] if i else "")
    if ch in "اآٱى":
        return True
    if ch == "و":
        return DAMMA in prev
    if ch == "ي":
        return KASRA in prev
    # lam of the article before a shadda'd sun letter: after alif (ال), or after the preposition lam
    # with kasra when the alif is dropped (لِلتَّرْوِيجِ)
    if ch != "ل" or not i or i + 1 >= len(w) or SHADDA not in w[i + 1][1]:
        return False
    return w[i - 1][0] in "اٱ" or (w[i - 1][0] == "ل" and KASRA in w[i - 1][1])


def tts_fails(n, vis, tts):
    if not tts or not tts.strip():
        return [f"line {n}: Arabic line has no tts_text"]
    f = []
    if CONTROL.search(tts):
        f.append(f"line {n}: tts_text contains a control character (corrupted by a text rewrite)")
    if SPLIT_SHADDA.search(tts):
        f.append(f"line {n}: tts_text doubles a letter with a sukun instead of a shadda")
    tw = words(tts)
    for w in tw:
        word = "".join(c + m for c, m in w)
        if not any(m for _, m in w):
            f.append(f"line {n}: word {word!r} has no tashkeel")
            continue
        miss = [w[i][0] for i in range(len(w)) if not w[i][1] and not bare_ok(w, i)]
        if miss:
            end = " (case ending/final letter)" if not w[-1][1] and not bare_ok(w, len(w) - 1) else ""
            f.append(f"line {n}: word {word!r} unmarked letter(s) {''.join(miss)}{end}")
    ww = ["".join(c for c, _ in w) for w in tw]
    return f + align_fails(n, vis, ww)


def align_fails(n, vis, ww):
    """Visible Arabic tokens must match tts words 1:1; a visible Latin/digit token (R-TASHKEEL-008:
    spelled out in tts_text) matches one or more tts words, up to the next visible Arabic word."""
    vt = []
    for tok in vis.split():
        ar = "".join(ch for ch in tok if ARLETTER.match(ch))
        if ar:
            vt.append(ar)
        elif re.search(r"[A-Za-z0-9٠-٩]", tok):
            vt.append(None)
    f, j = [], 0
    count = f"line {n}: tts_text has {len(ww)} words, visible text {sum(1 for v in vt if v)}"
    for k, v in enumerate(vt):
        if v:
            if j >= len(ww):
                return f + [count]
            if ww[j] != v:
                f.append(f"line {n}: tts word {ww[j]!r} differs from visible word {v!r}")
            j += 1
        else:
            nxt = next((x for x in vt[k + 1:] if x), None)
            start = j
            while j < len(ww) and (j == start or ww[j] != nxt):
                j += 1
            if j == start:
                return f + [count]
    return f + ([count] if j != len(ww) else [])


def check(manifest, text_only=False):
    reg = load()
    by = {s["id"]: s for s in reg["styles"]}
    band, mt = reg["pace_target_wpm"]["band"], reg["max_tempo"]
    fails = []
    lines = manifest.get("lines") or []
    if not lines:
        fails.append("manifest has no lines")
    for i, l in enumerate(lines):
        n = l.get("id", i)
        st = l.get("style")
        if not st:
            fails.append(f"line {n}: no style")
        elif st not in by:
            fails.append(f"line {n}: unregistered style {st!r}")
        elif l.get("direction") != by[st]["direction"]:
            fails.append(f"line {n}: direction is not byte-equal to registry style {st!r}")
        text = l.get("text", "")
        if marked_share(text) > MAX_VISIBLE_MARKED:
            fails.append(f"line {n}: visible text looks like the TTS text pasted in ({marked_share(text):.0%} of Arabic words marked; the source's own marks are fine, TTS tashkeel goes in tts_text)")
        lang, sec = l.get("lang"), l.get("seconds")
        if lang == "ar":
            fails += tts_fails(n, text, l.get("tts_text"))
        if lang not in band:
            fails.append(f"line {n}: lang must be ar or en")
        elif text_only:
            continue
        elif not sec or sec <= 0:
            fails.append(f"line {n}: no measured seconds")
        else:
            wpm = len(text.split()) / sec * 60
            lo, hi = band[lang]
            if not lo <= wpm <= hi:
                fails.append(f"line {n}: wpm {wpm:.0f} outside {lang} band {lo}-{hi}")
        if (l.get("tempo") or 1) > mt:
            fails.append(f"line {n}: tempo {l['tempo']} above max_tempo {mt}")
    return fails


def selftest():
    reg = load()
    s = next(x for x in reg["styles"] if x["id"] == "manual")
    good = {"id": 1, "lang": "en", "style": "manual", "direction": s["direction"],
            "text": " ".join(["word"] * 25), "seconds": 10.0, "tempo": 1.2}
    assert check({"lines": [good]}) == []
    bad = lambda **k: check({"lines": [dict(good, **k)]})  # noqa: E731
    assert any("no style" in f for f in bad(style=None))
    assert any("unregistered" in f for f in bad(style="loud"))
    assert any("byte-equal" in f for f in bad(direction=s["direction"].strip()))
    assert any("pasted in" in f for f in bad(lang="ar", text="مَرْحَبًا " * 19, seconds=10))
    assert any("wpm" in f for f in bad(seconds=20.0))
    assert any("tempo" in f for f in bad(tempo=1.8))
    # R15: every registry Arabic sample is known-true and must pass; count proves the loop looked
    n = 0
    for st in reg["styles"]:
        if "sample_ar_tashkeel" not in st:
            continue
        n += 1
        vis, tts = st["sample_ar"], st["sample_ar_tashkeel"]
        assert tts_fails(st["id"], vis, tts) == [], (st["id"], tts_fails(st["id"], vis, tts))
    assert n >= 5, n
    ref = reg["styles"][0]
    vis, tts = ref["sample_ar"], ref["sample_ar_tashkeel"]
    ar = lambda **k: dict(good, lang="ar", text=vis, tts_text=tts, seconds=len(vis.split()) / 115 * 60, **k)  # noqa: E731
    assert check({"lines": [ar()]}) == [], check({"lines": [ar()]})
    f = check({"lines": [dict(ar(), tts_text=None)]})
    assert any("no tts_text" in x for x in f), f
    f = tts_fails(1, vis, tts.replace("نَبْنِي", "نبني"))  # one bare word
    assert any("نبني" in x and "no tashkeel" in x for x in f), f
    f = tts_fails(1, vis, tts.replace("تَعْمَلُ", "تَعْمَل"))  # missing case ending
    assert any("تَعْمَل" in x and "case ending" in x for x in f), f
    f = tts_fails(1, vis, tts.replace("الْعَالَمِ", "الْعَالَمَاتِ"))  # mismatched text
    assert any("differs" in x for f2 in [f] for x in f2), f
    # source's own marks in visible text are allowed (portal wording: فتحاً, دائماً)
    own = "هذه خدمة فتحاً دائماً لاستئناف العمل وهي مجانية للمواطن"
    assert marked_share(own) < 0.5 and not any("pasted" in x for x in check({"lines": [dict(ar(), text=own)]})), "own marks"
    # KB checks: mark order is NOT policed (NFC passes), split shadda and control chars are
    assert tts_fails(1, vis, unicodedata.normalize("NFC", tts)) == [] and tts_fails(1, vis, re.sub("([ً-ِ])ّ", lambda m: "ّ" + m.group(1), tts)) == [], "order must not matter"
    assert any("control character" in x for x in tts_fails(1, vis, tts.replace("نَبْنِي", "نَبْنِي"))), "control char"
    f = tts_fails(1, vis, tts.replace("تَعْمَلُ", "تَعْعَمَلُ"))
    assert any("sukun instead of a shadda" in x for x in f), f
    # preposition-lam + dropped alif before a sun letter: exempt only with kasra and shadda
    sv = "للترويج الدوائي"
    assert tts_fails(1, sv, "لِلتَّرْوِيجِ الدَّوَائِيِّ".replace("الدَّوَائِيِّ", "الدَّوَائِيِّ")) == []
    assert any("unmarked" in x for x in tts_fails(1, "للترويج", "لِلتَرْوِيجِ"))   # no shadda: still fails
    assert any("unmarked" in x for x in tts_fails(1, "للترويج", "لَلتَّرْوِيجِ"))   # no kasra: still fails
    assert any("unmarked" in x for x in tts_fails(1, "الترويج", "الْتَرْوِيج"))     # missing mark: still fails
    # a Latin token / digits spelled out in several words passes; an unrelated extra word still fails
    lv = "ملف PDF الآن"
    assert tts_fails(1, lv, "مِلَفُّ بِي دِي إِفْ الْآنَ") == [], tts_fails(1, lv, "مِلَفُّ بِي دِي إِفْ الْآنَ")
    assert any("words" in x for x in tts_fails(1, lv, "مِلَفُّ بِي دِي إِفْ الْآنَ جِدًّا"))
    assert any("words" in x for x in tts_fails(1, "ملف الآن", "مِلَفُّ جِدًّا الْآنَ"))
    # --text-only: no seconds/tempo needed; text faults still fail; audio faults are not looked at
    to = lambda **k: check({"lines": [{k2: v for k2, v in dict(ar(), **k).items() if k2 not in ("seconds", "tempo")}]}, text_only=True)  # noqa: E731
    assert to() == [], to()
    assert any("no measured seconds" in x for x in check({"lines": [{k2: v for k2, v in ar().items() if k2 != "seconds"}]}))  # full mode unchanged
    assert any("نبني" in x for x in to(tts_text=tts.replace("نَبْنِي", "نبني"))), "text-only must fail bare word"
    assert any("no style" in x for x in to(style=None))
    assert any("no tts_text" in x for x in to(tts_text=None))
    print("selftest PASS (%d registry samples)" % n)
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if sys.argv[1:] == ["--selftest"]:
        sys.exit(selftest())
    to = "--text-only" in sys.argv
    argv = [a for a in sys.argv[1:] if a != "--text-only"]
    if len(argv) != 1:
        print(__doc__)
        sys.exit(1)
    f = check(json.loads(Path(argv[0]).read_text(encoding="utf-8")), text_only=to)
    for x in f:
        print("FAIL: " + x)
    print("RESULT: %s (%d fail)" % ("FAIL" if f else "PASS", len(f)))
    sys.exit(1 if f else 0)
