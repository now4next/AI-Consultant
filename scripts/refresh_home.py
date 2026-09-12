#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Rebuild the home archive cards from data/volumes.json.

The newest volume is the spotlight (not a card); every other volume becomes a
card rendered by new_volume.home_card, so the archive always matches the
registry and the current card template (palette, motif, tag).

Usage:
    python scripts/refresh_home.py
"""
import os, re, sys, json, importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


nv = _load("new_volume", os.path.join(ROOT, "scripts", "new_volume.py"))


def main():
    reg = json.load(open(os.path.join(ROOT, "data", "volumes.json"), encoding="utf-8"))["volumes"]
    vols = sorted(reg, key=lambda v: v["vol"], reverse=True)
    latest, rest = vols[0], vols[1:]

    p = os.path.join(ROOT, "index.html")
    s = open(p, encoding="utf-8").read()

    cards = "".join(nv.home_card(v) for v in rest)
    m = re.search(r'(<div class="grid-cards" id="cards">\n)(.*?)(\n    </div>\n    <p class="no-cards")', s, re.S)
    if not m:
        print("archive grid not found")
        sys.exit(1)
    s = s[: m.end(1)] + cards.rstrip("\n") + s[m.start(3):]

    # spotlight carries its category so chip counts can include it
    s = re.sub(r'<a class="spot"(?: data-cat="[^"]*")? href="',
               f'<a class="spot" data-cat="{latest["cat"]}" href="', s, count=1)

    open(p, "w", encoding="utf-8").write(s)
    print(f"home: {len(rest)} cards rebuilt, spotlight = Vol. {latest['vol']:02d} ({latest['cat']})")


if __name__ == "__main__":
    main()
