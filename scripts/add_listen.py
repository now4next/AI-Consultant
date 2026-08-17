#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Add the "본문 듣기" (listen) button to Leadership Insight volume pages.

Option A: browser-native Web Speech API (speechSynthesis).
Free, no API key, works on a static site. Reads the article aloud with a
Korean voice, highlights the block being read, and supports play/pause/stop.

Idempotent: running it again on an already-patched file changes nothing.

Usage:
    python scripts/add_listen.py                 # all volume pages
    python scripts/add_listen.py insight-vol-11.html
"""
import os, re, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARK = "pli-listen"

CSS = """  /* ---- listen / TTS (Web Speech API) ---- */
  .listen{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
    margin:0 0 28px;padding:13px 15px;border:1px solid var(--ink);background:var(--paper-2)}
  .listen button{display:inline-flex;align-items:center;gap:7px;cursor:pointer;
    font-family:var(--sans);font-weight:600;font-size:14px;letter-spacing:-.01em;
    border:1px solid var(--ink);background:var(--ink);color:var(--paper);
    padding:9px 16px;border-radius:999px;transition:.15s}
  .listen button:hover{opacity:.85}
  .listen button.ghost{background:transparent;color:var(--ink)}
  .listen .ico{font-size:11px;line-height:1}
  .listen .note{font-family:var(--mono);font-size:11px;letter-spacing:.05em;color:var(--muted)}
  .reading{background:rgba(26,62,107,.10);border-radius:2px;
    box-shadow:0 0 0 4px rgba(26,62,107,.10);transition:background .2s}
"""

HTML = """<div class="listen" id="listenBar">
  <button id="lsnPlay" type="button" aria-label="본문 음성으로 듣기">
    <span class="ico" id="lsnIco">&#9654;</span><span id="lsnLabel">본문 듣기</span>
  </button>
  <button id="lsnStop" type="button" class="ghost" hidden>&#9632; 정지</button>
  <span class="note" id="lsnNote">브라우저 음성으로 읽어 드려요</span>
</div>

"""

JS = """<script>
/* pli-listen — read the article aloud with the browser's built-in Korean voice */
(function(){
  var bar = document.getElementById('listenBar');
  if(!bar) return;
  var synth = window.speechSynthesis;
  if(!synth || typeof window.SpeechSynthesisUtterance === 'undefined'){ bar.style.display='none'; return; }

  var playBtn = document.getElementById('lsnPlay'),
      stopBtn = document.getElementById('lsnStop'),
      label   = document.getElementById('lsnLabel'),
      ico     = document.getElementById('lsnIco'),
      note    = document.getElementById('lsnNote');

  var SEL = '.prose h2, .prose h3, .prose p, .prose blockquote, .td-word, .td-body,'
          + ' .stat .cap, .ld-ti, .st-title, .st-body, .ck-ti, .item .txt, .item .sub';
  var blocks = [], queue = [], state = 'idle', voice = null;

  function collect(){
    var art = document.querySelector('article.article');
    if(!art) return [];
    return Array.prototype.slice.call(art.querySelectorAll(SEL)).filter(function(el){
      return (el.textContent || '').trim().length > 1;
    });
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
      split(el.textContent).forEach(function(s){ queue.push({ text: s, bi: bi }); });
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
    if(state === 'playing'){ label.textContent = '일시정지'; ico.innerHTML = '&#10074;&#10074;'; stopBtn.hidden = false; }
    else if(state === 'paused'){ label.textContent = '이어 듣기'; ico.innerHTML = '&#9654;'; stopBtn.hidden = false; }
    else { label.textContent = '본문 듣기'; ico.innerHTML = '&#9654;'; stopBtn.hidden = true; }
  }

  function speakFrom(i){
    if(state !== 'playing') return;
    if(i >= queue.length){ done(); return; }
    var item = queue[i];
    mark(item.bi);
    var u = new SpeechSynthesisUtterance(item.text);
    u.lang = 'ko-KR';
    if(voice) u.voice = voice;
    u.rate = 1; u.pitch = 1;
    u.onend   = function(){ speakFrom(i + 1); };
    u.onerror = function(){ speakFrom(i + 1); };
    synth.speak(u);
  }

  function done(){ state = 'idle'; clearMark(); ui(); note.textContent = '다 읽었어요'; }

  function start(){
    build();
    if(!queue.length) return;
    voice = voice || pickVoice();
    note.textContent = voice ? ('음성: ' + voice.name) : '이 브라우저에는 한국어 음성이 없어요';
    state = 'playing'; ui();
    try{ synth.cancel(); }catch(e){}
    speakFrom(0);
  }

  playBtn.addEventListener('click', function(){
    if(state === 'idle') start();
    else if(state === 'playing'){ try{ synth.pause(); }catch(e){} state = 'paused'; ui(); }
    else { try{ synth.resume(); }catch(e){} state = 'playing'; ui(); }
  });

  stopBtn.addEventListener('click', function(){
    state = 'idle';
    try{ synth.cancel(); }catch(e){}
    clearMark(); ui(); note.textContent = '브라우저 음성으로 읽어 드려요';
  });

  if(!synth.getVoices().length && typeof synth.addEventListener === 'function'){
    synth.addEventListener('voiceschanged', function(){ voice = pickVoice(); });
  }
  window.addEventListener('pagehide', function(){ try{ synth.cancel(); }catch(e){} });

  window.__pliListen = { state: function(){ return state; }, blocks: function(){ return blocks.length; },
                         chunks: function(){ return queue.length; }, voice: function(){ return voice && voice.name; } };
})();
</script>
</body>"""


def patch(path):
    s = open(path, encoding="utf-8").read()
    if MARK in s:
        return "skip (already patched)"

    # 1) CSS before </style>
    if "</style>" not in s:
        return "FAIL (no </style>)"
    s = s.replace("</style>", CSS + "</style>", 1)

    # 2) listen bar before the first .termdef / .prose inside the article
    ai = s.find('<article class="article">')
    if ai < 0:
        return "FAIL (no article)"
    rest = s[ai:]
    m = re.search(r'<div class="termdef">|<div class="prose">', rest)
    if not m:
        return "FAIL (no anchor)"
    at = ai + m.start()
    s = s[:at] + HTML + s[at:]

    # 3) JS before </body>
    if "</body>" not in s:
        return "FAIL (no </body>)"
    s = s.replace("</body>", JS, 1)

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
