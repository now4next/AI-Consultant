#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Leadership Insight — build and wire a new volume.

Automates every mechanical step that used to be done by hand:
  page shell + hero + series callout + cover + takeaway + teaser + footer,
  listen button, previous-volume nav, home spotlight/archive/count,
  redirect stub, README line, and the registry entry.

You write two files; this does the rest:
  data/volumes/vol-NN.json        metadata (see data/volumes/TEMPLATE.json)
  data/volumes/vol-NN.body.html   the article body (the creative part)

Usage:
    python scripts/new_volume.py 12
    python scripts/new_volume.py 12 --dry-run     # build the page only, touch nothing else
"""
import os, re, sys, json, shutil, importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC_DIR = os.path.join(ROOT, "data", "volumes")
REG_PATH = os.path.join(ROOT, "data", "volumes.json")


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


gen_cover = _load("gen_cover", os.path.join(ROOT, "scripts", "gen_cover.py"))
add_listen = _load("add_listen", os.path.join(ROOT, "scripts", "add_listen.py"))


# ---------------------------------------------------------------- helpers
def reg_load():
    return json.load(open(REG_PATH, encoding="utf-8"))


def vol_file(n):
    return "insight.html" if n == 1 else f"insight-vol-{n:02d}.html"


def render_cover(spec):
    c = spec["cover"]
    if c.get("kind") == "image":
        return (f'<div class="cover-bleed">\n<img src="{c["file"]}" '
                f'alt="Leadership Insight Vol. {spec["vol"]:02d} 커버" loading="lazy">\n</div>')
    fig = gen_cover.render_cover({
        "vol": spec["vol"], "eyebrow": spec["eyebrow"], "title": spec["title"],
        "sub": c.get("sub", spec["sub"]).replace("<br>", "\n"),
        "source": c.get("src", "원전 · " + spec["source"]),
        "c1": c.get("c1", "#16233a"), "c2": c.get("c2", "#080b12"),
        "accent": c.get("accent", "#d9c48f"), "motif": c.get("motif", "none"),
    })
    return f'<div class="cover-bleed">\n{fig}\n</div>'


def render_page(spec, body, prev, prev2, shell_src):
    n = spec["vol"]
    shell = open(os.path.join(ROOT, shell_src), encoding="utf-8").read()
    head = shell[: shell.index("<body id=\"top\">") + len('<body id="top">')]
    tail = shell[shell.index("<script>"):]

    # retitle + renumber the shell
    head = re.sub(r"<title>.*?</title>",
                  f'<title>{spec["title"]} · Leadership Insight Vol. {n:02d}</title>', head, count=1)
    pn = prev["vol"]
    for a, b in [(f"progBar{pn}", f"progBar{n}"), (f"bar{pn}", f"bar{n}"), (f"updProg{pn}", f"updProg{n}"),
                 (f"doShare{pn}", f"doShare{n}"), (f"shareLabel{pn}", f"shareLabel{n}"),
                 (f"copyLink{pn}", f"copyLink{n}"), (f"copyLabel{pn}", f"copyLabel{n}"),
                 (f"shareBtn{pn}", f"shareBtn{n}"), (f"copyBtn{pn}", f"copyBtn{n}")]:
        tail = tail.replace(a, b)

    pillars = "\n".join(
        f'      <div class="pillar"><span class="n">{a}</span><span class="t">{b}</span></div>'
        for a, b in spec["pillars"])
    footer_links = "\n".join(
        f'    <a href="{vol_file(v)}">{"Vol. %02d" % v if v == 1 else "%02d" % v}</a>'
        for v in range(1, n + 1))
    tk = spec["takeaway"]

    teaser = ""
    for p in [x for x in (prev, prev2) if x]:
        teaser += (f'  <a href="{p["file"]}" style="text-decoration:none">\n'
                   f'    <div class="prev">\n      <div class="body">\n'
                   f'        <span class="no">{p["eyebrow"]}</span>\n'
                   f'        <span class="ti"><strong>{p["title"]}</strong>'
                   f'<span class="sub">{p["desc"]}</span></span>\n'
                   f'      </div>\n      <span class="arr">←</span>\n    </div>\n  </a>\n')

    return f"""{head}
<div class="prog"><div class="bar" id="progBar{n}"></div></div>

<div class="app">

<header class="mast">
  <div class="L"><a href="{prev["file"]}">← Vol. {prev["vol"]:02d}</a></div>
  <div class="C"><a href="https://projectleadership.cc/" aria-label="Leadership Insight 홈으로">Leadership Insight</a></div>
  <div class="R">Vol. {n:02d}</div>
</header>

<section class="hero">
  <div class="eyebrow-row">
    <span class="k">{spec["eyebrow"]}</span>
    <span class="r">Deep read</span>
  </div>

  <div class="text-block">
    <div class="kicker">
      <span class="k-line"></span>
      <span class="k-text">{spec["kicker"]}</span>
      <span class="k-line"></span>
    </div>

    <h1>
      <span class="ko-lead">{spec["koLead"]}</span>
      <span class="ko-sub">{spec["koSub"]}</span>
    </h1>

    <p class="deck">
      {spec["deck"]}
    </p>

    <div class="pillars">
{pillars}
    </div>
  </div>

  <div class="source-row">
    <span class="src-lab">원전</span>
    <div class="src-body">
      <b>{spec["sourceTitle"]}</b>
      <span>{spec["source"]}</span>
    </div>
  </div>
</section>

<div class="series">
  <div>
    <div class="lab">Previously on Vol. {prev["vol"]:02d}</div>
    <div class="ti"><strong>{prev["title"]}</strong><span class="sub">{prev["sub"]}</span></div>
  </div>
  <a href="{prev["file"]}" class="arr">←</a>
</div>

<article class="article">

{render_cover(spec)}

{body.strip()}

</article>

<div class="takeaway">
  <div class="lab">Synthesis · Vol. {n:02d}</div>
  <h3>{tk["h3"]}</h3>
  <p class="ko">
    {tk["p1"]}
  </p>
  <p class="ko" style="margin-top:16px">
    {tk["p2"]}
  </p>
  <div class="sig">
    <span>{tk["sig"]}</span>
    <b>— Leadership Insight</b>
  </div>
</div>

<div class="next-teaser">
  <div class="lab">More from Leadership Insight</div>
{teaser}</div>

<div class="share">
  <button class="btn dark" onclick="doShare{n}()" id="shareBtn{n}">
    <span id="shareLabel{n}">이 글을 공유하기</span>
    <span class="arr">↗</span>
  </button>
  <button class="btn" onclick="copyLink{n}()" id="copyBtn{n}">
    <span id="copyLabel{n}">링크 복사</span>
    <span class="arr">→</span>
  </button>
</div>

<footer>
  <div class="big">Leadership Insight</div>
  <div>Vol. {n:02d} · {spec["title"]} · 2026</div>
  <div class="lnks">
{footer_links}
  </div>
</footer>

</div><!-- .app -->

{tail}"""


# ---------------------------------------------------------------- wiring
def wire_prev(prev_path, n):
    s = open(prev_path, encoding="utf-8").read()
    pn = int(re.search(r"insight(?:-vol-(\d+))?\.html", os.path.basename(prev_path)).group(1) or 1)
    s = s.replace(f'<div class="R">Vol. {pn:02d}</div>',
                  f'<div class="R"><a href="{vol_file(n)}">Vol. {n:02d} →</a></div>', 1)
    m = re.search(r'(<div class="lnks">)(.*?)(</div>)', s, re.S)
    if m and vol_file(n) not in m.group(2):
        inner = m.group(2).rstrip() + f'\n    <a href="{vol_file(n)}">{n:02d}</a>\n  '
        s = s[:m.start(2)] + inner + s[m.end(2):]
    open(prev_path, "w", encoding="utf-8").write(s)


def home_card(v):
    cov = v["cover"]
    if cov.get("kind") == "image":
        thumb = f'<div class="thumb"><img src="{cov["file"]}" alt="" loading="lazy"></div>'
    else:
        kw = cov.get("keyword", v["title"])
        thumb = (f'<div class="thumb ph" data-n="{v["vol"]:02d}"><span class="kw">{kw}</span>'
                 f'<span class="src">{cov.get("src", v["source"])}</span></div>')
    return (f'      <a class="card" data-cat="{v["cat"]}" href="{v["file"]}">\n'
            f'        {thumb}\n'
            f'        <div class="body"><div class="no">Vol. {v["vol"]:02d}</div><h3>{v["title"]}</h3>\n'
            f'          <p>{v["desc"]}</p>\n'
            f'          <div class="foot"><span class="tag">{v["tag"]}</span>'
            f'<span class="rt">⏱ {v["readTime"]}</span></div></div>\n'
            f'      </a>\n')


def update_home(spec, prev, total):
    p = os.path.join(ROOT, "index.html")
    s = open(p, encoding="utf-8").read()
    n = spec["vol"]

    cover_html = render_cover(spec)
    cover_inner = re.sub(r"^<div class=\"cover-bleed\">\n|\n</div>$", "", cover_html)
    tldr = "\n".join(f"          <li>{t}</li>" for t in spec["home"]["tldr"])
    spot = (f'    <a class="spot" href="{vol_file(n)}">\n'
            f'      <div class="cover">\n        {cover_inner}\n      </div>\n'
            f'      <div>\n        <div class="no">{spec["eyebrow"]}</div>\n'
            f'        <h2>{spec["title"]}</h2>\n        <ul class="tldr">\n{tldr}\n        </ul>\n'
            f'        <div class="meta">\n'
            f'          <span class="pill">⏱ 읽는 시간 {spec["home"]["readTime"]}</span>\n'
            f'          <span class="pill">{spec["home"]["tags"]}</span>\n'
            f'          <span class="curated">🦉 <strong>플리</strong>가 골랐어요</span>\n        </div>\n'
            f'        <span class="btn ghost">이번 주 통찰 읽기 →</span>\n      </div>\n    </a>')
    s = re.sub(r'    <a class="spot".*?\n    </a>', spot, s, count=1, flags=re.S)

    s = re.sub(r"(<b>Archive</b> · 전체 )\d+(편)", rf"\g<1>{total}\g<2>", s, count=1)

    m = re.search(r'(<div class="grid-cards" id="cards">\n)', s)
    if m and f'href="{prev["file"]}"' not in s[m.end(): m.end() + 400]:
        s = s[: m.end()] + home_card(prev) + s[m.end():]

    open(p, "w", encoding="utf-8").write(s)


def make_redirect(spec):
    n = spec["vol"]
    d = os.path.join(ROOT, f"vol-{n:02d}")
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(
        f'''<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{spec["title"]} · Leadership Insight Vol. {n:02d}</title>
<link rel="canonical" href="../{vol_file(n)}">
<meta http-equiv="refresh" content="0; url=../{vol_file(n)}">
<script>location.replace("../{vol_file(n)}");</script>
</head><body><p>이 문서는 <a href="../{vol_file(n)}">{spec["title"]} (Vol. {n:02d})</a> 로 이동합니다.</p></body></html>
''')


def update_readme(spec):
    p = os.path.join(ROOT, "README.md")
    s = open(p, encoding="utf-8").read()
    n = spec["vol"]
    line = (f'- [{vol_file(n)}]({vol_file(n)}) — "{spec["title"]}" 리더십 인사이트 '
            f'Vol. {n:02d} ({spec["source"]}) · <https://projectleadership.cc/{vol_file(n)}>')
    if line in s:
        return
    prev_line = re.search(rf"^- \[{re.escape(vol_file(n-1))}\].*$", s, re.M)
    if prev_line:
        s = s[: prev_line.end()] + "\n" + line + s[prev_line.end():]
        open(p, "w", encoding="utf-8").write(s)


def update_registry(spec):
    reg = reg_load()
    if any(v["vol"] == spec["vol"] for v in reg["volumes"]):
        return
    n = spec["vol"]
    reg["volumes"].append({
        "vol": n, "file": vol_file(n), "dir": f"vol-{n:02d}",
        "title": spec["title"], "sub": spec["sub"], "eyebrow": spec["eyebrow"],
        "source": spec["source"], "cat": spec["home"]["cat"], "tag": spec["home"]["tag"],
        "readTime": spec["home"]["readTime"], "desc": spec["home"]["desc"], "cover": spec["cover"],
    })
    json.dump(reg, open(REG_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=2)


# ---------------------------------------------------------------- main
def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    if not args:
        print("usage: python scripts/new_volume.py <vol-number> [--dry-run]")
        sys.exit(2)
    n = int(args[0])

    spec_p = os.path.join(SPEC_DIR, f"vol-{n:02d}.json")
    body_p = os.path.join(SPEC_DIR, f"vol-{n:02d}.body.html")
    for p in (spec_p, body_p):
        if not os.path.exists(p):
            print(f"missing: {os.path.relpath(p, ROOT)}")
            sys.exit(2)

    spec = json.load(open(spec_p, encoding="utf-8"))
    body = open(body_p, encoding="utf-8").read()
    vols = reg_load()["volumes"]
    prev = next(v for v in vols if v["vol"] == n - 1)
    prev2 = next((v for v in vols if v["vol"] == n - 2), None)

    out_name = vol_file(n)
    out = os.path.join(ROOT, out_name if not dry else f"_dryrun_{out_name}")
    page = render_page(spec, body, prev, prev2, prev["file"])
    open(out, "w", encoding="utf-8").write(page)
    add_listen.patch(out)
    print(f"built {os.path.basename(out)}")

    if dry:
        print("dry run: nav / home / redirect / README / registry untouched")
        return

    wire_prev(os.path.join(ROOT, prev["file"]), n)
    update_home(spec, prev, total=len(vols) + 1)
    make_redirect(spec)
    update_readme(spec)
    update_registry(spec)
    print("wired: prev nav · home · redirect · README · registry")
    print("next:  python scripts/lint_volume.py")


if __name__ == "__main__":
    main()
