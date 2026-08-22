#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PLI cover generator (Option A) — data-driven, font-accurate, free.

Covers are rendered as an inline HTML/CSS component (.gcover) so they use the
page's loaded webfonts (Gowun Batang / Playfair / JetBrains Mono). No image
files, no external image API, no cost.

To add a volume: append an entry to VOLUMES below and run this script.
It writes, per volume, to scripts/out/:
  - vol-NN.cover.html   (portrait cover figure — paste into the volume hero + home spotlight)
It also writes scripts/out/gcover.css once (paste into each page's <style> if missing).

Usage:  python scripts/gen_cover.py
"""
import os, html

OUT = os.path.join(os.path.dirname(__file__), "out")

# ---- motif library (inline SVG, no text so fonts don't matter) ----
def motif_broken_ladder(accent="#d9c48f"):
    return f'''<svg viewBox="0 0 100 132" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" stroke-width="3" stroke-linecap="round" fill="none">
        <line x1="32" y1="6" x2="32" y2="126"/>
        <line x1="68" y1="6" x2="68" y2="126"/>
        <line x1="32" y1="30" x2="68" y2="30"/>
        <line x1="32" y1="56" x2="68" y2="56"/>
        <line x1="32" y1="82" x2="68" y2="82"/>
      </g>
      <line x1="32" y1="110" x2="68" y2="110" stroke="{accent}" stroke-width="3"
            stroke-dasharray="4 6" opacity=".33"/>
    </svg>'''

def motif_between(accent="#d9c48f"):
    """Two presences facing each other, and the space that opens between them."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" stroke-width="3" fill="none" stroke-linecap="round">
        <path d="M40 18 C16 40 16 80 40 102"/>
        <path d="M80 18 C104 40 104 80 80 102"/>
      </g>
      <circle cx="60" cy="60" r="7" fill="{accent}"/>
      <circle cx="60" cy="60" r="17" stroke="{accent}" stroke-width="1.4" fill="none" opacity=".45"/>
      <circle cx="60" cy="60" r="27" stroke="{accent}" stroke-width="1" fill="none" opacity=".22"/>
    </svg>'''


def motif_three_failures(accent="#d9c48f"):
    """Three failures side by side: preventable, tangled, and the one worth paying for."""
    return f'''<svg viewBox="0 0 132 92" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".3">
        <circle cx="22" cy="44" r="18"/>
        <path d="M14 36 L30 52 M30 36 L14 52"/>
        <circle cx="66" cy="44" r="18"/>
        <path d="M56 50 C62 34 70 56 76 40"/>
        <path d="M56 40 C63 52 69 32 76 48"/>
      </g>
      <g stroke="{accent}" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="110" cy="44" r="18"/>
        <path d="M110 54 L110 34"/>
        <path d="M103 41 L110 34 L117 41"/>
      </g>
      <circle cx="110" cy="44" r="26" stroke="{accent}" stroke-width="1" fill="none" opacity=".28"/>
    </svg>'''


def motif_trellis(accent="#d9c48f"):
    """A sprig growing along a structured lattice: the tool holds the structure, the person grows."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" stroke-width="1.1" opacity=".30">
        <line x1="30" y1="26" x2="78" y2="74"/>
        <line x1="54" y1="26" x2="96" y2="68"/>
        <line x1="90" y1="26" x2="42" y2="74"/>
        <line x1="66" y1="26" x2="24" y2="68"/>
      </g>
      <g stroke="{accent}" stroke-width="2.8" fill="none" stroke-linecap="round">
        <path d="M60 102 C60 86 60 74 60 48"/>
      </g>
      <path d="M60 74 C50 71 45 63 47 54 C57 56 62 65 60 74Z" fill="{accent}" stroke="none"/>
      <path d="M60 64 C70 60 75 52 73 43 C63 46 58 55 60 64Z" fill="{accent}" stroke="none"/>
      <circle cx="60" cy="46" r="3.4" fill="{accent}"/>
    </svg>'''


def motif_rewire(accent="#d9c48f"):
    """A hub agent with faint old links being rerouted into new solid ones: rewiring the org."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" stroke-width="1.2" opacity=".24" stroke-dasharray="3 5" fill="none">
        <line x1="60" y1="60" x2="24" y2="30"/>
        <line x1="60" y1="60" x2="96" y2="34"/>
        <line x1="60" y1="60" x2="30" y2="94"/>
      </g>
      <g stroke="{accent}" stroke-width="2.2" fill="none" stroke-linecap="round">
        <line x1="60" y1="60" x2="90" y2="88"/>
        <line x1="60" y1="60" x2="34" y2="46"/>
        <line x1="60" y1="60" x2="74" y2="24"/>
      </g>
      <g fill="{accent}">
        <circle cx="60" cy="60" r="7"/>
        <circle cx="90" cy="88" r="4.2"/>
        <circle cx="34" cy="46" r="4.2"/>
        <circle cx="74" cy="24" r="4.2"/>
      </g>
      <g fill="none" stroke="{accent}" stroke-width="1.2" opacity=".4">
        <circle cx="24" cy="30" r="3.4"/>
        <circle cx="96" cy="34" r="3.4"/>
        <circle cx="30" cy="94" r="3.4"/>
      </g>
    </svg>'''


def motif_progress(accent="#d9c48f"):
    """Small wins accumulating into a rising climb, with the spark of felt progress on top."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g fill="{accent}">
        <rect x="28" y="80" width="12" height="14" rx="2" opacity=".45"/>
        <rect x="46" y="68" width="12" height="26" rx="2" opacity=".62"/>
        <rect x="64" y="54" width="12" height="40" rx="2" opacity=".8"/>
        <rect x="82" y="38" width="12" height="56" rx="2"/>
      </g>
      <g stroke="{accent}" stroke-width="2.4" stroke-linecap="round">
        <line x1="88" y1="26" x2="88" y2="16"/>
        <line x1="81" y1="22" x2="74" y2="18"/>
        <line x1="95" y1="22" x2="102" y2="18"/>
      </g>
      <circle cx="88" cy="31" r="3.2" fill="{accent}"/>
    </svg>'''


MOTIFS = {"broken-ladder": motif_broken_ladder, "between": motif_between, "three-failures": motif_three_failures, "trellis": motif_trellis, "rewire": motif_rewire, "progress": motif_progress, "none": lambda accent=None: ""}

# ---- per-volume metadata ----
VOLUMES = [
    {
        "vol": 11,
        "eyebrow": "Vol. 11 · The Apprenticeship Gap",
        "title": "사라진 사다리",
        "sub": "AI가 신입의 일을 삼킬 때,\n전문가는 어떻게 자라는가",
        "source": "원전 · McKinsey · Matt Beane",
        "c1": "#16233a", "c2": "#080b12",  # bg gradient
        "accent": "#d9c48f",
        "motif": "broken-ladder",
    },
    {
        "vol": 14,
        "eyebrow": "Vol. 14 · The Augmented Coach",
        "title": "나누어 기르다",
        "sub": "코칭은 통째로 자동화되지 않는다. 과업마다 나누어 설계한다",
        "source": "원전 · Terblanche · ICF · Passmore et al.",
        "c1": "#17281d", "c2": "#0b130e",
        "accent": "#d9c48f",
        "motif": "trellis",
    },
    {
        "vol": 15,
        "eyebrow": "Vol. 15 · The Agentic Organization",
        "title": "일을 다시 짜다",
        "sub": "덧대면 값이 나오지 않는다. 일을 다시 짜야 한다",
        "source": "원전 · McKinsey · State of AI 2025",
        "c1": "#1b2338", "c2": "#0a0e18",
        "accent": "#d9c48f",
        "motif": "rewire",
    },
    {
        "vol": 16,
        "eyebrow": "Vol. 16 · The Progress Principle",
        "title": "만드는 동안",
        "sub": "동기는 진척에서 온다. 만드는 과정을 내주면 의미도 옅어진다",
        "source": "원전 · Amabile & Kramer · Pink",
        "c1": "#2a1e26", "c2": "#140a10",
        "accent": "#d9c48f",
        "motif": "progress",
    },
]

def render_cover(m):
    num = str(m["vol"])
    motif_svg = MOTIFS.get(m.get("motif", "none"), MOTIFS["none"])(m.get("accent", "#d9c48f"))
    sub_html = "<br>".join(html.escape(line) for line in m["sub"].split("\n"))
    motif_block = f'<div class="g-motif">{motif_svg}</div>' if motif_svg else ""
    return (
        f'<figure class="gcover" style="--c1:{m["c1"]};--c2:{m["c2"]}" '
        f'role="img" aria-label="{html.escape(m["title"])} 커버">\n'
        f'  <span class="g-num">{num}</span>\n'
        f'  <span class="g-eyebrow">{html.escape(m["eyebrow"])}</span>\n'
        f'  {motif_block}\n'
        f'  <div class="g-body">\n'
        f'    <div class="g-title">{html.escape(m["title"])}</div>\n'
        f'    <div class="g-sub">{sub_html}</div>\n'
        f'  </div>\n'
        f'  <div class="g-src">{html.escape(m["source"])}</div>\n'
        f'</figure>'
    )

GCOVER_CSS = """  /* ---- generated cover component (.gcover) — data-driven, scales with width ---- */
  .gcover{container-type:inline-size;position:relative;aspect-ratio:600/1050;overflow:hidden;
    background:linear-gradient(158deg,var(--c1,#16233a),var(--c2,#080b12));color:#fff}
  .gcover .g-num{position:absolute;right:-3cqw;top:-6cqw;font-family:var(--serif-display);
    font-weight:900;font-size:82cqw;line-height:1;color:rgba(255,255,255,.05)}
  .gcover .g-eyebrow{position:absolute;top:8cqw;left:9cqw;right:9cqw;font-family:var(--mono);
    font-size:3cqw;letter-spacing:.26em;color:#9fb2cc;text-transform:uppercase}
  .gcover .g-motif{position:absolute;top:26cqw;left:0;right:0;display:flex;justify-content:center}
  .gcover .g-motif svg{width:34cqw;height:auto}
  .gcover .g-body{position:absolute;left:9cqw;right:9cqw;bottom:13cqw}
  .gcover .g-title{font-family:var(--serif);font-weight:700;font-size:19cqw;line-height:1.02;
    letter-spacing:-.03em;word-break:keep-all}
  .gcover .g-sub{font-family:var(--serif);font-size:4.6cqw;line-height:1.45;color:#cdd5e2;
    margin-top:3.4cqw;word-break:keep-all}
  .gcover .g-src{position:absolute;left:9cqw;right:9cqw;bottom:5cqw;font-family:var(--mono);
    font-size:2.9cqw;letter-spacing:.1em;color:#8595a9;padding-top:3cqw;border-top:1px solid rgba(255,255,255,.14)}
"""

def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "gcover.css"), "w", encoding="utf-8") as f:
        f.write(GCOVER_CSS)
    for m in VOLUMES:
        snippet = render_cover(m)
        with open(os.path.join(OUT, f"vol-{m['vol']:02d}.cover.html"), "w", encoding="utf-8") as f:
            f.write(snippet)
        print(f"wrote vol-{m['vol']:02d}.cover.html ({len(snippet)} chars)")
    print("wrote gcover.css")

if __name__ == "__main__":
    main()
