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
  :root{--c-strategy:#1d4ed8;--c-people:#be123c;--c-judgment:#6d28d9;--c-growth:#15803d;--c-reflect:#0f766e;--c-history:#78716c}
  @media (prefers-color-scheme: dark){:root{--c-strategy:#60a5fa;--c-people:#fb7185;--c-judgment:#a78bfa;--c-growth:#4ade80;--c-reflect:#2dd4bf;--c-history:#c9c2bb}}
  .hero[data-cat="전략"]{--cc:var(--c-strategy)} .hero[data-cat="사람"]{--cc:var(--c-people)} .hero[data-cat="판단"]{--cc:var(--c-judgment)}
  .hero[data-cat="성장"]{--cc:var(--c-growth)} .hero[data-cat="성찰"]{--cc:var(--c-reflect)} .hero[data-cat="역사"]{--cc:var(--c-history)}
  .hero .eyebrow-row .r::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--cc,var(--muted));margin-right:8px;vertical-align:1px}
  /* cat:end */
"""


CONV_CSS = """
  /* conv:start */
  .fb{max-width:var(--measure);margin:34px auto 0;padding:20px 22px;border:1px solid rgba(var(--ink-rgb),.14);
    border-radius:var(--radius);background:rgba(var(--ink-rgb),.02);text-align:center}
  .fb-q{font-family:var(--sans);font-size:14.5px;color:var(--muted);margin-bottom:12px}
  .fb-row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
  .fb-b{font-family:var(--sans);font-size:14px;padding:9px 18px;border-radius:999px;cursor:pointer;
    border:1px solid rgba(var(--ink-rgb),.2);background:var(--paper);color:var(--ink);transition:border-color .15s,background .15s}
  .fb-b:hover{border-color:var(--accent)}
  .fb-b[aria-pressed="true"]{border-color:var(--accent);background:rgba(var(--accent-rgb),.08);font-weight:700}
  .fb-done{font-family:var(--sans);font-size:14px;color:var(--muted)}

  .endsub{max-width:var(--measure);margin:34px auto 0;padding:26px 24px;border-radius:var(--radius);
    border:1px solid rgba(var(--accent-rgb),.28);background:rgba(var(--accent-rgb),.05)}
  .endsub .lab{font-family:var(--mono);font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;
    color:var(--accent);margin-bottom:8px}
  .endsub h4{font-family:var(--serif);font-size:20px;line-height:1.5;margin:0 0 8px;word-break:keep-all}
  .endsub p{font-family:var(--sans);font-size:14.5px;line-height:1.75;color:var(--muted);margin:0 0 16px;word-break:keep-all}
  .endsub .go{display:inline-block;font-family:var(--sans);font-size:14.5px;font-weight:700;
    padding:11px 22px;border-radius:999px;background:var(--accent);color:var(--paper);text-decoration:none}
  .endsub .go:hover{opacity:.9}
  .endsub .days{display:flex;gap:5px;margin:0 0 14px;flex-wrap:wrap}
  .endsub .days span{font-family:var(--mono);font-size:11px;width:22px;height:22px;line-height:22px;text-align:center;
    border-radius:50%;border:1px solid rgba(var(--ink-rgb),.16);color:var(--muted)}
  .endsub .days span.on{border-color:var(--accent);background:var(--accent);color:var(--paper);font-weight:700}

  .mbar{position:fixed;left:0;right:0;bottom:0;z-index:60;display:none;gap:12px;align-items:center;
    padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:var(--paper);
    border-top:1px solid rgba(var(--ink-rgb),.14);box-shadow:0 -6px 20px rgba(0,0,0,.07)}
  .mbar .t{flex:1;font-family:var(--sans);font-size:13px;line-height:1.45;color:var(--ink);word-break:keep-all}
  .mbar .t b{color:var(--accent)}
  .mbar .go{font-family:var(--sans);font-size:13.5px;font-weight:700;white-space:nowrap;
    padding:9px 16px;border-radius:999px;background:var(--accent);color:var(--paper);text-decoration:none}
  .mbar .x{border:0;background:none;color:var(--muted);font-size:18px;line-height:1;cursor:pointer;padding:4px 2px}
  @media (max-width:760px){ .mbar.show{display:flex} body.has-mbar{padding-bottom:72px} }
  /* conv:end */
"""

CONV_JS = """<script>
/* conv:start */
(function(){
  var API='https://notify.projectleadership.cc';
  var sec=document.getElementById('insight');
  var VOL=sec?sec.dataset.vol:null;

  /* 1탭 피드백 — 이름도 이메일도 받지 않는다 */
  var fb=document.getElementById('fb');
  if(fb&&VOL){
    var row=fb.querySelector('.fb-row');
    var btns=[].slice.call(fb.querySelectorAll('.fb-b'));
    var KEY='pli-fb-'+VOL;
    try{ var was=localStorage.getItem(KEY); if(was) mark(was); }catch(e){}
    function mark(v){ btns.forEach(function(b){ b.setAttribute('aria-pressed', String(b.dataset.v===v)); }); }
    btns.forEach(function(b){
      b.addEventListener('click', function(){
        var v=b.dataset.v; mark(v);
        try{ localStorage.setItem(KEY,v); }catch(e){}
        fetch(API+'/feedback',{method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({vol:Number(VOL),verdict:v})})
          .then(function(r){return r.json();})
          .then(function(){ row.insertAdjacentHTML('afterend','<div class="fb-done" style="margin-top:10px">고맙습니다. 다음 편에 반영할게요.</div>'); })
          .catch(function(){});
      });
    });
  }

  /* 모바일 하단 바 — 30% 넘게 읽으면 올라오고, 닫으면 그 편에서는 다시 안 뜬다 */
  var bar=document.getElementById('mbar');
  if(bar){
    var closed=false;
    try{ closed=sessionStorage.getItem('pli-mbar')==='off'; }catch(e){}
    var x=bar.querySelector('.x');
    if(x) x.addEventListener('click',function(){
      closed=true; bar.classList.remove('show'); document.body.classList.remove('has-mbar');
      try{ sessionStorage.setItem('pli-mbar','off'); }catch(e){}
    });
    var onScroll=function(){
      if(closed) return;
      var h=document.documentElement.scrollHeight-innerHeight;
      var p=h>0?scrollY/h:0;
      if(p>0.3){ bar.classList.add('show'); document.body.classList.add('has-mbar'); }
      else { bar.classList.remove('show'); document.body.classList.remove('has-mbar'); }
    };
    addEventListener('scroll',onScroll,{passive:true}); onScroll();
  }

  /* 방문 신호 — 쿠키 없음, 외부 서비스 없음 */
  try{
    var r=document.referrer?new URL(document.referrer).host:'';
    if(r===location.host) r='';
    new Image().src=API+'/hit?p='+encodeURIComponent(location.pathname)+'&r='+encodeURIComponent(r)+'&_='+Date.now();
  }catch(e){}
})();
/* conv:end */
</script>
"""

FB_HTML = """
<div class="fb" id="fb">
  <div class="fb-q">이번 편이 도움이 되었나요? 한 번만 누르면 됩니다.</div>
  <div class="fb-row">
    <button class="fb-b" type="button" data-v="helpful" aria-pressed="false">도움이 됐어요</button>
    <button class="fb-b" type="button" data-v="meh" aria-pressed="false">아쉬웠어요</button>
  </div>
</div>
"""

ENDSUB_HTML = """
<div class="endsub">
  <div class="lab">Weekly</div>
  <h4>이런 편을 매주 한 통씩 받아 보시겠어요?</h4>
  <div class="days"><span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span class="on">금</span><span>토</span></div>
  <p>원하는 요일과 시간에, 아직 읽지 않은 편을 한 편씩 보내 드립니다. 회원가입은 없고, 그만 받기는 메일 아래 한 줄입니다.</p>
  <a class="go" href="https://projectleadership.cc/subscribe.html?from=article">받아 보기</a>
</div>
"""

MBAR_HTML = """
<div class="mbar" id="mbar">
  <div class="t">매주 금요일 한 편. <b>원문을 확인해서</b> 씁니다.</div>
  <a class="go" href="https://projectleadership.cc/subscribe.html?from=mbar">받아 보기</a>
  <button class="x" type="button" aria-label="닫기">&times;</button>
</div>
"""


QBOX_CSS = """
  /* qbox:start */
  .qbox{max-width:var(--measure);margin:26px auto 0;padding:18px 22px 16px;
    border-left:2px solid var(--accent);background:rgba(var(--accent-rgb),.045);border-radius:0 var(--radius) var(--radius) 0}
  .qbox .lab{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;
    color:var(--accent);margin-bottom:10px}
  .qbox ol{margin:0;padding:0;list-style:none;counter-reset:q}
  .qbox li{counter-increment:q;margin:0 0 7px;display:flex;gap:10px;align-items:baseline}
  .qbox li:last-child{margin-bottom:0}
  .qbox li::before{content:counter(q);font-family:var(--mono);font-size:11px;color:var(--accent);
    flex:0 0 auto;padding-top:2px}
  .qbox button{font-family:var(--serif);font-size:16px;line-height:1.65;text-align:left;
    border:0;background:none;padding:0;color:var(--ink);cursor:pointer;word-break:keep-all;
    border-bottom:1px solid transparent}
  .qbox button:hover{border-bottom-color:rgba(var(--ink-rgb),.3)}
  /* qbox:end */
"""

QBOX_JS = """<script>
/* qbox:start */
(function(){
  var box=document.querySelector('.qbox'); if(!box) return;
  var hs=[].slice.call(document.querySelectorAll('.article h2'));
  [].slice.call(box.querySelectorAll('button')).forEach(function(b,i){
    /* 섹션이 셋이 아닌 편은 data-sec 로 어느 섹션이 답하는지 적어 둔다(1부터) */
    var j=b.getAttribute('data-sec')?(+b.getAttribute('data-sec')-1):i, h=hs[j];
    if(!h){ b.disabled=true; return; }
    b.addEventListener('click',function(){ h.scrollIntoView({behavior:'smooth',block:'start'}); });
  });
})();
/* qbox:end */
</script>
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

    # --- "이 글이 답하는 질문" box; the markup itself is per-volume (registry: questions)
    if "/* qbox:start */" not in s:
        s = s.replace("</style>", QBOX_CSS + "</style>", 1)
        s = s.replace("</body>", QBOX_JS + "</body>", 1)
        done.append("qbox")

    # --- conversion surfaces: one-tap feedback, end-of-article subscribe, mobile bar
    if "/* conv:start */" not in s:
        s = s.replace("</style>", CONV_CSS + "</style>", 1)
        # 마크업이 스크립트보다 먼저 와야 한다. 인라인 스크립트는 즉시 실행되므로
        # 뒤에 오는 요소는 getElementById 로 잡히지 않는다.
        s = s.replace("</body>", MBAR_HTML + CONV_JS + "</body>", 1)
        # 피드백과 구독 블록은 독자 기록 영역 바로 앞에 둔다. 글을 다 읽은 자리다.
        anchor = '<section class="insights"'
        if anchor in s and 'id="fb"' not in s:
            s = s.replace(anchor, FB_HTML + ENDSUB_HTML + "\n" + anchor, 1)
        done.append("conv")

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
