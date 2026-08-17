#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Add the "음성 듣기" (listen) button to Leadership Insight volume pages.

Option A: browser-native Web Speech API (speechSynthesis) — free, no API key,
works on a static site. Reads the article aloud with a Korean voice and
highlights the block being read.

UI: a single small toggle button, right-aligned in the hero just above the
deck rule. Idle label "음성 듣기"; while reading it becomes "듣기 정지", and
clicking again stops.

Idempotent: injected sections are wrapped in pli-listen markers, so re-running
replaces the previous version cleanly.

Usage:
    python scripts/add_listen.py                 # all volume pages
    python scripts/add_listen.py insight-vol-11.html
"""
import os, re, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CSS = """  /* pli-listen:start */
  .hero .listen{display:flex;justify-content:flex-end;margin:-8px 0 12px}
  .hero .listen button{display:inline-flex;align-items:center;gap:6px;cursor:pointer;
    font-family:var(--sans);font-weight:600;font-size:12.6px;letter-spacing:-.01em;
    border:1px solid var(--ink);background:var(--ink);color:var(--paper);
    padding:8px 14px;border-radius:999px;transition:.15s}
  .hero .listen button:hover{opacity:.85}
  .hero .listen button.on{background:transparent;color:var(--ink)}
  .hero .listen .ico{font-size:10px;line-height:1}
  .reading{background:rgba(26,62,107,.10);border-radius:2px;
    box-shadow:0 0 0 4px rgba(26,62,107,.10);transition:background .2s}
  /* pli-listen:end */
"""

HTML = """    <!-- pli-listen:start -->
    <div class="listen">
      <button id="lsnPlay" type="button" aria-label="본문 음성으로 듣기">
        <span class="ico" id="lsnIco">&#9654;</span><span id="lsnLabel">음성 듣기</span>
      </button>
    </div>
    <!-- pli-listen:end -->
"""

JS = """<script>
/* pli-listen:start — read the article aloud with the browser's built-in Korean voice */
(function(){
  var btn = document.getElementById('lsnPlay');
  if(!btn) return;
  var synth = window.speechSynthesis;
  if(!synth || typeof window.SpeechSynthesisUtterance === 'undefined'){
    var wrap = btn.parentNode; if(wrap) wrap.style.display = 'none'; return;
  }

  var label = document.getElementById('lsnLabel'),
      ico   = document.getElementById('lsnIco');

  var HERO_SEL = ['.ko-lead', '.ko-sub', '.deck'];   /* 제목 → 부제 → 도입문 */
  var SEL = '.prose h2, .prose h3, .prose p, .prose blockquote, .td-word, .td-body,'
          + ' .stat .cap, .ld-ti, .st-title, .st-body, .ck-ti, .item .txt, .item .sub';
  var blocks = [], queue = [], playing = false, voice = null;

  /* innerText turns <br> into a line break, which split() folds into a space */
  function textOf(el){ return (el.innerText || el.textContent || ''); }

  function collect(){
    var out = [], hero = document.querySelector('section.hero');
    if(hero){
      HERO_SEL.forEach(function(sel){
        var el = hero.querySelector(sel);
        if(el && textOf(el).trim().length > 1) out.push(el);
      });
    }
    var art = document.querySelector('article.article');
    if(art){
      Array.prototype.slice.call(art.querySelectorAll(SEL)).forEach(function(el){
        if(textOf(el).trim().length > 1) out.push(el);
      });
    }
    return out;
  }

  /* Chrome truncates long utterances, so speak sentence-sized chunks. */
  function split(text){
    text = (text || '').replace(/\\s+/g, ' ').trim();
    var out = [], buf = '', ch, next;
    for(var i = 0; i < text.length; i++){
      ch = text[i]; buf += ch;
      if(ch === '.' || ch === '!' || ch === '?' || ch === '\\u3002' || ch === '\\uff01' || ch === '\\uff1f'){
        next = text[i+1];
        if(!next || next === ' '){ if(buf.trim()) out.push(buf.trim()); buf = ''; continue; }
      }
      if(buf.length >= 170){
        var cut = buf.lastIndexOf(' ');
        if(cut > 90){ out.push(buf.slice(0, cut).trim()); buf = buf.slice(cut + 1); }
        else { out.push(buf.trim()); buf = ''; }
      }
    }
    if(buf.trim()) out.push(buf.trim());
    return out;
  }

  function build(){
    blocks = collect(); queue = [];
    blocks.forEach(function(el, bi){
      split(textOf(el)).forEach(function(s){ queue.push({ text: s, bi: bi }); });
    });
  }

  function pickVoice(){
    var vs = synth.getVoices() || [];
    var ko = vs.filter(function(v){ return /^ko(-|_|$)/i.test(v.lang || ''); });
    if(!ko.length) return null;
    var pref = ['Yuna', '\\uc720\\ub098', 'Google', 'SunHi', 'InJoon', 'Heami', 'Nari'];
    for(var i = 0; i < pref.length; i++){
      for(var j = 0; j < ko.length; j++){
        if((ko[j].name || '').indexOf(pref[i]) >= 0) return ko[j];
      }
    }
    return ko[0];
  }

  function clearMark(){ blocks.forEach(function(el){ el.classList.remove('reading'); }); }

  function mark(bi){
    clearMark();
    var el = blocks[bi];
    if(!el) return;
    el.classList.add('reading');
    var r = el.getBoundingClientRect();
    if(r.top < 70 || r.bottom > (window.innerHeight - 40)){
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function ui(){
    if(playing){ label.textContent = '듣기 정지'; ico.innerHTML = '&#9632;'; btn.classList.add('on'); }
    else { label.textContent = '음성 듣기'; ico.innerHTML = '&#9654;'; btn.classList.remove('on'); }
  }

  function speakFrom(i){
    if(!playing) return;
    if(i >= queue.length){ stop(); return; }
    var item = queue[i];
    mark(item.bi);
    var u = new SpeechSynthesisUtterance(item.text);
    u.lang = 'ko-KR';
    if(voice) u.voice = voice;
    u.rate = 1.2; u.pitch = 1;
    u.onend   = function(){ speakFrom(i + 1); };
    u.onerror = function(){ speakFrom(i + 1); };
    synth.speak(u);
  }

  function start(){
    build();
    if(!queue.length) return;
    voice = voice || pickVoice();
    btn.title = voice ? ('음성: ' + voice.name) : '이 브라우저에는 한국어 음성이 없어요';
    playing = true; ui();
    try{ synth.cancel(); }catch(e){}
    speakFrom(0);
  }

  function stop(){
    playing = false;
    try{ synth.cancel(); }catch(e){}
    clearMark(); ui();
  }

  btn.addEventListener('click', function(){ playing ? stop() : start(); });

  if(!synth.getVoices().length && typeof synth.addEventListener === 'function'){
    synth.addEventListener('voiceschanged', function(){ voice = pickVoice(); });
  }
  window.addEventListener('pagehide', function(){ try{ synth.cancel(); }catch(e){} });

  window.__pliListen = { playing: function(){ return playing; }, blocks: function(){ return blocks.length; },
                         chunks: function(){ return queue.length; }, voice: function(){ return voice && voice.name; } };
})();
/* pli-listen:end */
</script>
</body>"""

RE_CSS  = re.compile(r"[ \t]*/\* pli-listen:start \*/.*?/\* pli-listen:end \*/\n", re.S)
RE_HTML = re.compile(r"[ \t]*<!-- pli-listen:start -->.*?<!-- pli-listen:end -->\n", re.S)
RE_JS   = re.compile(r"<script>\n/\* pli-listen:start.*?/\* pli-listen:end \*/\n</script>\n", re.S)
# v1 (unmarked) blocks, for upgrading pages patched by the earlier version
RE_V1_CSS  = re.compile(r"[ \t]*/\* ---- listen / TTS \(Web Speech API\) ---- \*/.*?\.reading\{[^}]*\}\n", re.S)
RE_V1_HTML = re.compile(r'<div class="listen" id="listenBar">.*?</div>\n\n', re.S)
RE_V1_JS   = re.compile(r"<script>\n/\* pli-listen —.*?\n</script>\n(?=</body>)", re.S)


def unpatch(s):
    for rx in (RE_CSS, RE_HTML, RE_JS, RE_V1_CSS, RE_V1_HTML, RE_V1_JS):
        s = rx.sub("", s)
    return s


def patch(path):
    s0 = open(path, encoding="utf-8").read()
    s = unpatch(s0)

    if "</style>" not in s:
        return "FAIL (no </style>)"
    s = s.replace("</style>", CSS + "</style>", 1)

    m = re.search(r'[ \t]*<p class="deck">', s)
    if not m:
        return "FAIL (no deck anchor)"
    s = s[:m.start()] + HTML + s[m.start():]

    if "</body>" not in s:
        return "FAIL (no </body>)"
    s = s.replace("</body>", JS, 1)

    if s == s0:
        return "unchanged"
    open(path, "w", encoding="utf-8").write(s)
    return "patched"


def main():
    args = sys.argv[1:]
    if args:
        files = [os.path.join(ROOT, a) for a in args]
    else:
        files = sorted(glob.glob(os.path.join(ROOT, "insight-vol-*.html")))
        files.append(os.path.join(ROOT, "insight.html"))
    for f in files:
        if os.path.exists(f):
            print("%-24s %s" % (os.path.basename(f), patch(f)))
        else:
            print("%-24s missing" % os.path.basename(f))


if __name__ == "__main__":
    main()
