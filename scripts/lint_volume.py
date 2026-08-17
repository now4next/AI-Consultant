#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Leadership Insight — pre-publish checks.

Runs the checks that used to be done by hand before every deploy:
structure, required components, internal links, house-style (AI-slop) limits,
and per-volume script id consistency.

Usage:
    python scripts/lint_volume.py                    # every volume in the registry
    python scripts/lint_volume.py insight-vol-11.html
    python scripts/lint_volume.py --strict           # warnings count as failures

Exit code 0 = clean, 1 = at least one ERROR (or WARN with --strict).
"""
import os, re, sys, json, glob
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# House-style limits (see memory: avoid-ai-slop-prose)
MAX_PROSE_EMDASH = 2      # citations/signature live outside the prose scan
MAX_ANIRA        = 8      # "A가 아니라 B다" repetitions
BANNED = ["단 하나", "핵심은", "피터드러커소사이어티"]

PAIRED_TAGS = ["article", "blockquote", "figure", "footer", "section", "style", "script", "body"]

REQUIRED = [
    ('<header class="mast"', "masthead"),
    ('<section class="hero"', "hero"),
    ('<article class="article"', "article"),
    ('class="takeaway"', "takeaway"),
    ("<footer>", "footer"),
    ('id="lsnPlay"', "listen button"),
]


def load_registry():
    p = os.path.join(ROOT, "data", "volumes.json")
    if not os.path.exists(p):
        return []
    return json.load(open(p, encoding="utf-8")).get("volumes", [])


def prose_of(s):
    """Visible article prose: strip head/CSS/JS, cite blocks and the signature."""
    body = s.split("</style>", 1)[-1]
    body = re.sub(r"<script>.*?</script>", "", body, flags=re.S)
    body = re.sub(r"<cite>.*?</cite>", "", body, flags=re.S)
    body = re.sub(r"<b>— Leadership Insight</b>", "", body)
    body = re.sub(r"<!--.*?-->", "", body, flags=re.S)
    body = re.sub(r"<svg.*?</svg>", "", body, flags=re.S)
    return body


def check(path, reg_by_file):
    name = os.path.basename(path)
    s = open(path, encoding="utf-8").read()
    errors, warns = [], []

    # ---- required components
    for needle, label in REQUIRED:
        if needle not in s:
            errors.append(f"missing component: {label}")

    # ---- tag balance
    for t in PAIRED_TAGS:
        o = len(re.findall(rf"<{t}[\s>]", s))
        c = len(re.findall(rf"</{t}>", s))
        if o != c:
            errors.append(f"unbalanced <{t}>: {o} open / {c} close")

    # ---- internal links resolve
    for href in set(re.findall(r'href="([^"#][^"]*)"', s)):
        if href.startswith(("http://", "https://", "mailto:", "data:", "#")):
            continue
        target = os.path.join(ROOT, href.split("#")[0].split("?")[0])
        if href.endswith("/"):
            target = os.path.join(target, "index.html")
        if not os.path.exists(target):
            errors.append(f"broken link: {href}")

    # ---- house style
    prose = prose_of(s)
    em = prose.count("—")
    if em > MAX_PROSE_EMDASH:
        warns.append(f"em-dash in prose: {em} (limit {MAX_PROSE_EMDASH})")
    an = prose.count("아니라")
    if an > MAX_ANIRA:
        warns.append(f"'아니라' repeated {an}× (limit {MAX_ANIRA})")
    for b in BANNED:
        if b in prose:
            (errors if b == BANNED[-1] else warns).append(f"banned phrase: {b}")

    # ---- scripts actually resolve (catches bad id renames when cloning a volume)
    id_counts = Counter(re.findall(r'\sid="([^"]+)"', s))
    for i, c in id_counts.items():
        if c > 1:
            errors.append(f"duplicate id: {i} ({c}×)")
    for ref in sorted(set(re.findall(r"getElementById\(['\"]([^'\"]+)['\"]\)", s))):
        if ref not in id_counts:
            errors.append(f"script references missing element id: {ref}")
    for fn in sorted(set(re.findall(r'onclick="([A-Za-z_$][\w$]*)\(', s))):
        if not re.search(rf"function\s+{re.escape(fn)}\s*\(", s):
            errors.append(f"onclick handler not defined: {fn}()")

    # ---- registry agreement
    reg = reg_by_file.get(name)
    if reg:
        if reg["title"] not in s:
            warns.append(f"registry title not found in page: {reg['title']}")
        want = "Vol. %02d" % reg["vol"]
        head = s.split("</head>", 1)[0]
        if reg["vol"] > 1 and want not in head and want not in s[: s.find("</header>") + 1]:
            warns.append(f"masthead/title does not show {want}")

    # ---- cover present (from vol.06 on we always ship one)
    if reg and reg["vol"] >= 6:
        if not re.search(r'class="(cover-bleed|issue-cover|gcover)"', s):
            warns.append("no cover found")

    return errors, warns


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    strict = "--strict" in sys.argv

    reg = load_registry()
    reg_by_file = {v["file"]: v for v in reg}

    if args:
        files = [os.path.join(ROOT, a) for a in args]
    elif reg:
        files = [os.path.join(ROOT, v["file"]) for v in reg]
    else:
        files = sorted(glob.glob(os.path.join(ROOT, "insight*.html")))

    total_e = total_w = 0
    for f in files:
        if not os.path.exists(f):
            print(f"{os.path.basename(f):22} MISSING")
            total_e += 1
            continue
        e, w = check(f, reg_by_file)
        total_e += len(e)
        total_w += len(w)
        status = "OK" if not e and not w else ("ERROR" if e else "WARN")
        print(f"{os.path.basename(f):22} {status}")
        for m in e:
            print(f"    ERROR  {m}")
        for m in w:
            print(f"    warn   {m}")

    print(f"\n{len(files)} file(s) · {total_e} error(s) · {total_w} warning(s)")
    if total_e or (strict and total_w):
        sys.exit(1)


if __name__ == "__main__":
    main()
