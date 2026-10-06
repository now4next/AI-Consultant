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
import os, re, sys, json, glob, shutil, importlib.util

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
gen_og = _load("gen_og", os.path.join(ROOT, "scripts", "gen_og.py"))


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


def related_html(n, body, reg=None):
    """'Mentioned in this issue' block: the volumes this body cites (Vol. NN), in order, max 4."""
    reg = reg or reg_load()["volumes"]
    by = {v["vol"]: v for v in reg}
    seen = []
    for m in re.finditer(r"Vol\.\s?(\d{1,2})", body):
        k = int(m.group(1))
        if k != n and k in by and k not in seen:
            seen.append(k)
    seen = seen[:4]
    if not seen:
        return ""
    items = "".join(
        f'  <a class="rl" href="{by[k]["file"]}"><span class="no">Vol. {k:02d}</span>'
        f'<span class="t">{by[k]["title"]}</span><span class="cat">#{by[k]["cat"]}</span></a>\n' for k in seen)
    return ('<section class="related">\n  <div class="lab">Mentioned in this issue</div>\n'
            '  <div class="ti">이 글에서 언급한 편들</div>\n' + items + '</section>\n')


# 헤더 오른쪽 테마 전환 버튼. 스타일과 동작은 직전 편 셸에서 함께 복사된다.
THEME_BTN = ('<button class="thm" id="thm" type="button" aria-label="테마 바꾸기" title="테마: 자동"><svg class="i-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8.2"/><path d="M12 3.8a8.2 8.2 0 0 1 0 16.4z" fill="currentColor" stroke="none"/></svg><svg class="i-light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.3M12 19.1v2.3M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.6 12h2.3M19.1 12h2.3M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"/></svg><svg class="i-dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M20.2 14.6A8.3 8.3 0 0 1 9.4 3.8a8.4 8.4 0 1 0 10.8 10.8z"/></svg></button>')


# 독자 인사이트 영역. 스타일과 스크립트는 직전 편 셸에서 복사된다.
INSIGHTS_SEC = """<section class="insights" id="insight" data-vol="{n}">
  <div class="lab">Reader Insights</div>
  <div class="ti">독자들이 남긴 기록</div>
  <div id="insList"></div>
  <div class="ins-write" id="insWrite" hidden>
    <div class="ins-q" id="insQ"></div>
    <div class="ins-nick" id="insNickRow" hidden>
      <label for="insNick">표시할 별명</label>
      <input id="insNick" maxlength="16" autocomplete="off" placeholder="예: 느린결정">
    </div>
    <label for="insBody">이 편에서 얻은 생각</label>
    <textarea id="insBody" maxlength="400" placeholder="조직에 바로 적용할 수 있는 한 가지를 적어 보세요."></textarea>
    <div class="ins-foot">
      <span class="ins-cnt" id="insCnt">0 / 400</span>
      <span class="ins-msg" id="insMsg"></span>
      <button class="ins-lnk" id="insDel" type="button" hidden>지우기</button>
      <button class="ins-btn" id="insSave" type="button">남기기</button>
    </div>
    <p class="ins-fine">구독자만 남길 수 있고 한 편에 하나예요. 언제든 고치거나 지울 수 있어요.
      여러 사람이 보는 자리이니 회사 이름과 사람 이름은 적지 말아 주세요.</p>
  </div>
  <div class="ins-cta" id="insCta" hidden>
    메일로 글을 받는 분이 남길 수 있어요. 메일의 <b>인사이트 남기기</b> 링크로 들어오면 바로 쓸 수 있고,
    아직 구독 전이라면 <a href="https://projectleadership.cc/#subscribe">여기에서 신청</a>할 수 있어요.
  </div>
</section>"""


def render_page(spec, body, prev, prev2, shell_src):
    n = spec["vol"]
    shell = open(os.path.join(ROOT, shell_src), encoding="utf-8").read()
    head = shell[: shell.index("<body id=\"top\">") + len('<body id="top">')]
    tail = shell[shell.index("<script>"):]

    # retitle + renumber the shell; drop the previous volume's OG block (gen_og re-adds ours)
    head = re.sub(r"<title>.*?</title>",
                  f'<title>{spec["title"]} · Leadership Insight Vol. {n:02d}</title>', head, count=1)
    head = re.sub(r"<!-- og:start -->.*?<!-- og:end -->\n?", "", head, count=1, flags=re.S)
    pn = prev["vol"]
    for a, b in [(f"progBar{pn}", f"progBar{n}"), (f"bar{pn}", f"bar{n}"), (f"updProg{pn}", f"updProg{n}"),
                 (f"doShare{pn}", f"doShare{n}"), (f"shareLabel{pn}", f"shareLabel{n}"),
                 (f"copyLink{pn}", f"copyLink{n}"), (f"copyLabel{pn}", f"copyLabel{n}"),
                 (f"shareBtn{pn}", f"shareBtn{n}"), (f"copyBtn{pn}", f"copyBtn{n}")]:
        tail = tail.replace(a, b)

    pillars = "\n".join(
        f'      <div class="pillar"><span class="n">{a}</span><span class="t">{b}</span></div>'
        for a, b in spec["pillars"])
    reg_now = reg_load()
    if not any(int(v["vol"]) == n for v in reg_now["volumes"]):
        reg_now["volumes"].append({"vol": n, "file": vol_file(n), "title": spec["title"]})
    footer_links = footer_index(n, reg_now)
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
  <div class="R"><span class="vn">Vol. {n:02d}</span>{THEME_BTN}</div>
</header>

<section class="hero" data-cat="{spec["home"]["cat"]}">
  <div class="eyebrow-row">
    <span class="k">{spec["eyebrow"]}</span>
    <span class="r">{spec["home"]["cat"]} · Deep read</span>
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

{INSIGHTS_SEC.format(n=n)}

{related_html(n, body)}
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
  <div class="arch"><a href="index.html#archive">아카이브에서 분류별로 보기 →</a></div>
</footer>

</div><!-- .app -->

{tail}"""


# ---------------------------------------------------------------- wiring
LNKS_RE = re.compile(r'(<div class="lnks">)(.*?)(\n?  </div>)', re.S)


def footer_index(current, reg):
    """푸터의 전체 편 색인. 제목은 title 속성으로, 현재 편은 .on 으로 표시한다."""
    rows = []
    for v in sorted(reg["volumes"], key=lambda x: int(x["vol"])):
        num = int(v["vol"])
        label = f'{num:02d}'
        cur = ' class="on" aria-current="page"' if num == current else ''
        rows.append(f'    <a href="{v["file"]}"{cur} title="Vol. {num:02d} · {v["title"]}">{label}</a>')
    return "\n".join(rows)


def refresh_footer_index(reg):
    """모든 글 페이지의 색인을 다시 쓴다.

    예전에는 wire_prev가 직전 페이지에만 새 링크를 덧붙여서, 나머지 페이지의 색인이
    발행 시점에 멈춰 있었다(Vol.30은 31편까지만 보였다). 매번 전체를 다시 쓴다.
    """
    done = 0
    for f in sorted(glob.glob("insight-vol-*.html")) + ["insight.html"]:
        m = re.search(r"insight-vol-(\d+)", f)
        cur = int(m.group(1)) if m else 1
        s = open(f, encoding="utf-8").read()
        mm = LNKS_RE.search(s)
        if not mm:
            continue
        new = s[:mm.start(2)] + "\n" + footer_index(cur, reg) + mm.group(3) + s[mm.end(3):]
        if new != s:
            open(f, "w", encoding="utf-8").write(new); done += 1
    return done


def wire_prev(prev_path, n):
    s = open(prev_path, encoding="utf-8").read()
    pn = int(re.search(r"insight(?:-vol-(\d+))?\.html", os.path.basename(prev_path)).group(1) or 1)
    s = s.replace(f'<span class="vn">Vol. {pn:02d}</span>',
                  f'<a class="vn" href="{vol_file(n)}">Vol. {n:02d} →</a>', 1)
    open(prev_path, "w", encoding="utf-8").write(s)


def home_card(v):
    cov = v["cover"]
    if cov.get("kind") == "image":
        thumb = f'<div class="thumb"><img src="{cov["file"]}" alt="" loading="lazy"></div>'
    else:
        kw = cov.get("keyword", v["title"])
        c1, c2 = cov.get("c1", "#24314a"), cov.get("c2", "#0a0e17")
        svg = gen_cover.MOTIFS.get(cov.get("motif", "none"), gen_cover.MOTIFS["none"])(cov.get("accent", "#d9c48f"))
        svg = re.sub(r"\s+", " ", svg).strip()
        motif = f'<span class="motif">{svg}</span>' if svg else ""
        thumb = (f'<div class="thumb ph" data-n="{v["vol"]:02d}" style="--c1:{c1};--c2:{c2}">{motif}'
                 f'<span class="kw">{kw}</span><span class="src">{cov.get("src", v["source"])}</span></div>')
    kw = v.get("tags", "")
    return (f'      <a class="card" data-cat="{v["cat"]}"{f' data-kw="{kw}"' if kw else ""} href="{v["file"]}">\n'
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
    spot = (f'    <a class="spot" data-cat="{spec["home"]["cat"]}" href="{vol_file(n)}">\n'
            f'      <div class="cover">\n        {cover_inner}\n      </div>\n'
            f'      <div>\n        <div class="no">{spec["eyebrow"]}</div>\n'
            f'        <h2>{spec["title"]}</h2>\n        <ul class="tldr">\n{tldr}\n        </ul>\n'
            f'        <div class="meta">\n'
            f'          <span class="pill">⏱ 읽는 시간 {spec["home"]["readTime"]}</span>\n'
            f'          <span class="pill">{spec["home"]["tags"]}</span>\n'
            f'          <span class="curated"><img class="owl-mini" src="assets/pli-owl.png" alt="" width="28" height="28"> <strong>플리</strong>가 골랐어요</span>\n        </div>\n'
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
        "readTime": spec["home"]["readTime"], "desc": spec["home"]["desc"],
        "tags": spec["home"].get("tags", ""), "cover": spec["cover"],
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
    touched = refresh_footer_index(reg_load())
    gen_og.build_one(n)
    print(f"wired: prev nav · home · redirect · README · registry · footer index ({touched} pages) · og image+meta")
    print("next:  python scripts/lint_volume.py")


if __name__ == "__main__":
    main()
