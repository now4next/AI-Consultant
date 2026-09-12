#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Open Graph images + meta for every volume (and the home page).

For each registry entry this writes a 1200x630 landscape card that reuses the
volume's cover palette and motif, renders it to assets/og/vol-NN.jpg with Edge
headless, and injects an idempotent <!-- og:start -->…<!-- og:end --> block
into the page head (description, canonical, Open Graph, Twitter card).

Usage:
    python scripts/gen_og.py            # all volumes + home
    python scripts/gen_og.py 42         # one volume
    python scripts/gen_og.py --meta-only 42   # skip rendering, just (re)inject meta
"""
import os, re, sys, json, html, shutil, subprocess, tempfile, importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REG_PATH = os.path.join(ROOT, "data", "volumes.json")
OUT_DIR = os.path.join(ROOT, "assets", "og")
SITE = "https://projectleadership.cc"
EDGE = next((p for p in [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
] if os.path.exists(p)), None)


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


gen_cover = _load("gen_cover", os.path.join(ROOT, "scripts", "gen_cover.py"))

FONTS = ("https://fonts.googleapis.com/css2?family=Playfair+Display:wght@900"
         "&family=Gowun+Batang:wght@700&family=JetBrains+Mono:wght@400&family=Noto+Serif+KR:wght@400;700&display=swap")

CSS = """
html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{background:linear-gradient(158deg,var(--c1),var(--c2));color:#fff;position:relative;
  font-family:'Gowun Batang','Noto Serif KR',serif;-webkit-font-smoothing:antialiased}
.left{position:absolute;left:0;top:0;width:440px;height:630px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.left .num{position:absolute;right:-18px;top:-60px;font-family:'Playfair Display',serif;font-weight:900;font-size:520px;line-height:1;color:rgba(255,255,255,.05)}
.left svg{width:250px;height:250px;position:relative}
.left img{width:100%;height:100%;object-fit:cover;display:block}
.right{position:absolute;left:470px;right:64px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center}
.eyebrow{font-family:'JetBrains Mono',monospace;font-size:19px;letter-spacing:.24em;text-transform:uppercase;color:#9fb2cc;margin-bottom:26px}
.title{font-weight:700;line-height:1.08;letter-spacing:-.03em;word-break:keep-all;text-wrap:balance}
.sub{font-size:27px;line-height:1.45;color:#cdd5e2;margin-top:26px;word-break:keep-all;max-width:620px}
.brand{position:absolute;left:470px;right:64px;bottom:44px;font-family:'JetBrains Mono',monospace;font-size:17px;letter-spacing:.12em;
  color:#8595a9;padding-top:18px;border-top:1px solid rgba(255,255,255,.16);display:flex;justify-content:space-between}
.rule{position:absolute;left:440px;top:64px;bottom:64px;width:1px;background:rgba(255,255,255,.12)}
"""

HOME_CSS = """
html,body{margin:0;width:1200px;height:630px;overflow:hidden}
body{background:#0a0a0a;color:#fff;font-family:'Inter Tight','Gowun Batang',sans-serif;position:relative;-webkit-font-smoothing:antialiased}
.wrap{position:absolute;left:84px;right:84px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center}
.mark{font-family:'Playfair Display',serif;font-weight:900;font-size:150px;line-height:1;letter-spacing:.01em}
.full{font-family:'JetBrains Mono',monospace;font-size:22px;letter-spacing:.3em;text-transform:uppercase;color:#9a9a9a;margin-top:6px}
.tag{font-family:'Gowun Batang',serif;font-weight:700;font-size:44px;line-height:1.25;margin-top:54px;word-break:keep-all;max-width:900px}
.tag em{font-style:normal;color:#52f6fa}
.url{position:absolute;left:84px;bottom:56px;font-family:'JetBrains Mono',monospace;font-size:18px;letter-spacing:.14em;color:#6e6e6e}
"""


def title_px(t):
    n = len(t.replace(" ", ""))
    return 104 if n <= 6 else 92 if n <= 9 else 76 if n <= 13 else 62


def vol_html(v):
    cov = v["cover"]
    c1, c2 = cov.get("c1", "#16233a"), cov.get("c2", "#080b12")
    if cov.get("kind") == "image":
        img = "file:///" + os.path.join(ROOT, cov["file"]).replace("\\", "/")
        left = f'<img src="{img}" alt="">'
    else:
        svg = gen_cover.MOTIFS.get(cov.get("motif", "none"), gen_cover.MOTIFS["none"])(cov.get("accent", "#d9c48f"))
        left = f'<div class="num">{v["vol"]:02d}</div>{svg}'
    sub = cov.get("sub") or v.get("desc", "")
    sub = re.sub(r"<br\s*/?>", " ", sub)
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<link href="{FONTS}" rel="stylesheet"><style>{CSS}</style></head>
<body style="--c1:{c1};--c2:{c2}">
<div class="left">{left}</div><div class="rule"></div>
<div class="right">
  <div class="eyebrow">{html.escape(v["eyebrow"])}</div>
  <div class="title" style="font-size:{title_px(v["title"])}px">{html.escape(v["title"])}</div>
  <div class="sub">{html.escape(sub)}</div>
</div>
<div class="brand"><span>Leadership Insight</span><span>projectleadership.cc</span></div>
</body></html>"""


def home_html():
    return f"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<link href="{FONTS}&family=Inter+Tight:wght@400" rel="stylesheet"><style>{HOME_CSS}</style></head>
<body><div class="wrap">
  <div class="mark">PLI</div>
  <div class="full">Project Leadership Insight</div>
  <div class="tag">리더는 시간이 없지,<br><em>통찰</em>이 필요 없는 건 아니니까</div>
</div><div class="url">projectleadership.cc · 매주 금요일 한 편</div></body></html>"""


def render(html_src, png_path, tmpdir):
    if not EDGE:
        raise SystemExit("msedge.exe not found; cannot render OG images")
    src = os.path.join(tmpdir, os.path.basename(png_path).replace(".png", ".html"))
    open(src, "w", encoding="utf-8").write(html_src)
    prof = os.path.join(tmpdir, "profile")
    os.makedirs(os.path.dirname(png_path), exist_ok=True)
    # capture the pipes: Edge's launcher returns before the renderer child has
    # finished writing the screenshot, and holding the pipes waits for the child
    subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                    f"--user-data-dir={prof}", "--hide-scrollbars", "--window-size=1200,630",
                    "--virtual-time-budget=9000", f"--screenshot={png_path}",
                    "file:///" + src.replace("\\", "/")],
                   capture_output=True, timeout=120)
    # the launcher can return before the file lands; poll up to 30s
    import time
    for _ in range(120):
        if os.path.exists(png_path) and os.path.getsize(png_path) > 1000:
            break
        time.sleep(0.25)
    if not os.path.exists(png_path):
        raise SystemExit(f"render failed: {png_path}")
    # ship JPEG: the gradient cards compress ~4x better than PNG with no visible loss
    from PIL import Image
    jpg = png_path[:-4] + ".jpg"
    Image.open(png_path).convert("RGB").save(jpg, "JPEG", quality=88, optimize=True, progressive=True)
    os.remove(png_path)
    return jpg


def build_one(n):
    """Render + inject meta for a single volume (used by new_volume.py)."""
    reg = json.load(open(REG_PATH, encoding="utf-8"))["volumes"]
    v = next(x for x in reg if x["vol"] == n)
    tmp = tempfile.mkdtemp(prefix="og-")
    try:
        render(vol_html(v), os.path.join(OUT_DIR, f"vol-{n:02d}.png"), tmp)
        inject_meta(v)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def meta_block(v):
    n = v["vol"]
    title = f'{v["title"]} · Leadership Insight Vol. {n:02d}'
    desc = v.get("desc", v.get("sub", ""))
    url = f'{SITE}/{v["file"]}'
    img = f'{SITE}/assets/og/vol-{n:02d}.jpg'
    e = html.escape
    return f"""<!-- og:start -->
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Leadership Insight">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(desc)}">
<meta name="twitter:image" content="{img}">
<!-- og:end -->"""


def inject_meta(v):
    p = os.path.join(ROOT, v["file"])
    s = open(p, encoding="utf-8").read()
    block = meta_block(v)
    if "<!-- og:start -->" in s:
        s = re.sub(r"<!-- og:start -->.*?<!-- og:end -->", block, s, count=1, flags=re.S)
    else:
        anchor = re.search(r'<meta name="theme-color"[^>]*>\n', s)
        if not anchor:
            anchor = re.search(r'<meta name="viewport"[^>]*>\n', s)
        s = s[: anchor.end()] + block + "\n" + s[anchor.end():]
    open(p, "w", encoding="utf-8").write(s)


def inject_home_meta():
    p = os.path.join(ROOT, "index.html")
    s = open(p, encoding="utf-8").read()
    s = re.sub(r'(<meta property="og:image" content=")[^"]*(")', rf"\g<1>{SITE}/assets/og/home.jpg\g<2>", s, count=1)
    if 'property="og:image:width"' not in s:
        s = s.replace('<meta property="og:locale" content="ko_KR">',
                      '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n'
                      '<meta property="og:locale" content="ko_KR">\n<meta name="twitter:card" content="summary_large_image">', 1)
    open(p, "w", encoding="utf-8").write(s)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    meta_only = "--meta-only" in sys.argv
    reg = json.load(open(REG_PATH, encoding="utf-8"))["volumes"]
    todo = [v for v in reg if not args or v["vol"] == int(args[0])]
    def fresh():
        return tempfile.mkdtemp(prefix="og-")   # a clean profile per render keeps Edge fast and stateless

    for v in todo:
        png = os.path.join(OUT_DIR, f"vol-{v['vol']:02d}.png")
        if not meta_only:
            tmp = fresh()
            try:
                render(vol_html(v), png, tmp)
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
        inject_meta(v)
        print(f"og: vol-{v['vol']:02d} {'meta' if meta_only else 'jpg+meta'}")
    if not args:
        if not meta_only:
            tmp = fresh()
            try:
                render(home_html(), os.path.join(OUT_DIR, "home.png"), tmp)
            finally:
                shutil.rmtree(tmp, ignore_errors=True)
        inject_home_meta()
        print("og: home")


if __name__ == "__main__":
    main()
