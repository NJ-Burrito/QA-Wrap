#!/usr/bin/env python
"""voice_style.py list | get <id> — the Kore style registry (../voice-styles.json).
Read-only. A direction is used byte-for-byte; never edit one, propose a new style.
Usage: PYTHONUTF8=1 python voice_style.py list|get <id> [--json]
"""
import json
import sys
from pathlib import Path

REG = Path(__file__).resolve().parent.parent / "voice-styles.json"


def load():
    return json.loads(REG.read_text(encoding="utf-8"))


def main(argv):
    sys.stdout.reconfigure(encoding="utf-8")
    d = load()
    by = {s["id"]: s for s in d["styles"]}
    if len(argv) >= 2 and argv[1] == "list":
        print(f"voice {d['voice']} · {d['model']} · registry {REG}")
        for s in d["styles"]:
            print(f"{s['id']:9}| good_for: {s['good_for']}\n{'':9}| never_for: {s['never_for']}")
        return 0
    if len(argv) >= 3 and argv[1] == "get":
        s = by.get(argv[2])
        if not s:
            print(f"unregistered style {argv[2]!r}; registered: {', '.join(by)}")
            return 1
        print(json.dumps(s, ensure_ascii=False, indent=1))
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
