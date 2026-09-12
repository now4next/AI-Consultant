#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
One-off (idempotent) upgrade of every published volume page:

  cat      hero carries data-cat; the "Deep read" label names the category with an accent dot
  fonts    font diet: unused Playfair uprights and two Noto Serif KR weights dropped
  dark     prefers-color-scheme: dark palette for the reading page
  related  "Mentioned in this issue" block built from the Vol. NN references in the body
  rail     section markers on the top progress bar (click to jump)

Each step is guarded by a marker so the script can be re-run safely. New
volumes inherit the head/tail changes through new_volume.py's shell copy, and
the related block is generated there directly.

Usage:
    python scripts/upgrade_pages.py            # all pages
    python scripts/upgrade_pages.py 42         # one page
"""
import os, re, sys, glob, json, importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load(mod, path):
    spec = importlib.util.spec_from_file_location(mod, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


nv = _load("new_volume", os.path.join(ROOT, "scripts", "new_volume.py"))

DARK_CSS = """
  /* dark:start */
  @media (prefers-color-scheme: dark){
    :root{
      --ink:#e9e3d8; --ink-2:#d3ccc0;
      --paper:#141312; --paper-2:#1c1a18; --paper-3:#26231f;
      --rule:#e9e3d8; --accent:#8fb3e6; --accent-2:#a9c4ee;
      --muted:#9b9286; --muted-2:#6f6860;
      --ink-rgb:233,227,216; --accent-rgb:143,179,230;
    }
    body::before{mix-blend-mode:screen;opacity:.22}
    .hero-img .cap{color:#f3eee3}
    .share .btn.dark{background:var(--ink);color:var(--paper)}
    .pb-phase,.pb-col,.pb-template{background:rgba(255,255,255,.04)}
    .pb-ph-tag{color:var(--paper)}
    .pb-col.ai h4,.pb-scripts .sh,.pb-template .tt,.pb-ph-when{color:var(--muted)}
  }
  /* dark:end */
"""

RELATED_CSS = """
  /* related:start */
  .related{margin:0 24px 32px;padding:24px 0 4px;border-top:1px solid var(--ink)}
  .related .lab{font-family:var(--mono);font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
  .related > .ti{font-family:var(--serif);font-weight:700;font-size:18px;letter-spacing:-.02em;margin-bottom:10px;color:var(--ink)}
  .related .rl{display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:baseline;padding:12px 0;
    border-top:1px solid rgba(var(--ink-rgb),.14);text-decoration:none;color:inherit}
  .related .rl:first-of-type{border-top:none}
  .related .rl .no{font-family:var(--mono);font-size:11.5px;letter-spacing:.12em;color:var(--accent);white-space:nowrap}
  .related .rl .t{font-family:var(--serif);font-weight:700;font-size:16px;color:var(--ink);word-break:keep-all}
  .related .rl .cat{font-family:var(--mono);font-size:11px;letter-spacing:.08em;color:var(--muted);white-space:nowrap}
  .related .rl:hover .t{color:var(--accent)}
  /* related:end */
"""

RAIL_CSS = """
  /* rail:start */
  .article h2{scroll-margin-top:72px}
  .prog .mk{position:absolute;top:-3px;width:8px;height:8px;border-radius:50%;box-sizing:border-box;
    background:var(--paper);border:2px solid var(--accent);transform:translateX(-50%);pointer-events:auto;cursor:pointer;
    transition:transform .15s}
  .prog .mk:hover{transform:translateX(-50%) scale(1.5)}
  .prog .mk.done{background:var(--accent)}
  /* rail:end */
"""

RAIL_JS = """<script>
/* rail:start */
(function(){
  var prog=document.querySelector('.prog'); if(!prog) return;
  var hs=[].slice.call(document.querySelectorAll('.article h2')); if(!hs.length) return;
  var mks=hs.map(function(h){
    var m=document.createElement('a'); m.className='mk'; m.href='#';
    m.title=(h.textContent||'').replace(/\\s+/g,' ').trim();
    m.addEventListener('click',function(e){e.preventDefault(); h.scrollIntoView({behavior:'smooth',block:'start'});});
    prog.appendChild(m); return m;
  });
  function place(){
    var D=(document.documentElement.scrollHeight-innerHeight)||1;
    hs.forEach(function(h,i){
      var y=h.getBoundingClientRect().top+scrollY-72;
      mks[i].style.left=Math.min(100,Math.max(0,y/D*100))+'%';
      mks[i].classList.toggle('done',scrollY>=y-2);
    });
  }
  addEventListener('scroll',place,{passive:true}); addEventListener('resize',place); addEventListener('load',place); place();
})();
/* rail:end */
</script>
"""


CAT_CSS = """
  /* cat:start */
  :root{--c-strategy:#2b6cb0;--c-people:#c2410c;--c-judgment:#6b21a8;--c-duty:#b45309;--c-growth:#15803d;--c-reflect:#0e7490;--c-history:#7c2d12}
  @media (prefers-color-scheme: dark){:root{--c-strategy:#7fb3ff;--c-people:#ffa27a;--c-judgment:#c9a0ff;--c-duty:#f6bd5c;--c-growth:#5ce08c;--c-reflect:#5ccdf5;--c-history:#dca877}}
  .hero[data-cat="전략"]{--cc:var(--c-strategy)} .hero[data-cat="사람"]{--cc:var(--c-people)} .hero[data-cat="판단"]{--cc:var(--c-judgment)}
  .hero[data-cat="책임"]{--cc:var(--c-duty)} .hero[data-cat="성장"]{--cc:var(--c-growth)} .hero[data-cat="성찰"]{--cc:var(--c-reflect)} .hero[data-cat="역사"]{--cc:var(--c-history)}
  .hero .eyebrow-row .r::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--cc,var(--muted));margin-right:8px;vertical-align:1px}
  /* cat:end */
"""

FONT_DIET = [
    (r"family=Playfair\+Display:ital,wght@[^&\"]*", "family=Playfair+Display:ital,wght@0,700;0,900;1,400;1,500"),
    (r"family=Noto\+Serif\+KR:wght@[^&\"]*", "family=Noto+Serif+KR:wght@400;700"),
]


def upgrade(path, reg):
    s = open(path, encoding="utf-8").read()
    n = int(re.search(r"insight(?:-vol-(\d+))?\.html", os.path.basename(path)).group(1) or 1)
    done = []

    # --- category accent: hero carries data-cat, the "Deep read" label names the category
    cat = next((v["cat"] for v in reg if v["vol"] == n), None)
    if cat and "/* cat:start */" not in s:
        s = s.replace("</style>", CAT_CSS + "</style>", 1)
        s = s.replace('<section class="hero">', f'<section class="hero" data-cat="{cat}">', 1)
        s = re.sub(r'<span class="r">(Deep read|Long read)</span>', lambda m: f'<span class="r">{cat} · {m.group(1)}</span>', s, count=1)
        done.append("cat")

    # --- font diet: drop unused Playfair uprights and two Noto Serif KR weights (the heavy CJK file)
    before = s
    for pat, rep in FONT_DIET:
        s = re.sub(pat, rep, s, count=1)
    if s != before:
        done.append("fonts")

    # --- tokens for translucent ink/accent, so dark mode can retint them
    if "--ink-rgb:" not in s.split("</style>", 1)[0].split("@media (prefers-color-scheme")[0]:
        s = s.replace("    --ink:#1c1a17;\n", "    --ink:#1c1a17;\n    --ink-rgb:28,26,23;\n    --accent-rgb:26,62,107;\n", 1)
    s = s.replace("rgba(28,26,23,", "rgba(var(--ink-rgb),").replace("rgba(26,62,107,", "rgba(var(--accent-rgb),")

    # --- dark mode
    if "/* dark:start */" not in s:
        s = s.replace("</style>", DARK_CSS + "</style>", 1)
        s = s.replace('<meta name="theme-color" content="#fbf7f0">',
                      '<meta name="color-scheme" content="light dark">\n'
                      '<meta name="theme-color" content="#fbf7f0" media="(prefers-color-scheme: light)">\n'
                      '<meta name="theme-color" content="#141312" media="(prefers-color-scheme: dark)">', 1)
        done.append("dark")

    # --- related block
    if "/* related:start */" not in s:
        s = s.replace("</style>", RELATED_CSS + "</style>", 1)
    if 'class="related"' not in s:
        m = re.search(r"<article class=\"article\">(.*?)</article>", s, re.S)
        block = nv.related_html(n, m.group(1), reg) if m else ""
        if block:
            s = s.replace('<div class="next-teaser">', block + '<div class="next-teaser">', 1)
            done.append("related")

    # --- section rail
    if "/* rail:start */" not in s:
        s = s.replace("</style>", RAIL_CSS + "</style>", 1)
        s = s.replace("</body>", RAIL_JS + "</body>", 1)
        done.append("rail")

    open(path, "w", encoding="utf-8").write(s)
    return done


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    reg = json.load(open(os.path.join(ROOT, "data", "volumes.json"), encoding="utf-8"))["volumes"]
    files = [os.path.join(ROOT, v["file"]) for v in reg if not args or v["vol"] == int(args[0])]
    for f in files:
        d = upgrade(f, reg)
        print(f"{os.path.basename(f)}: {', '.join(d) or 'up to date'}")


if __name__ == "__main__":
    main()
