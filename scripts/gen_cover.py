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


def motif_doors(accent="#d9c48f"):
    """A two-way door (reversible, dashed sill, double arrow) beside a one-way door (irreversible)."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 90 L22 48 Q22 34 35 34 Q48 34 48 48 L48 90" stroke-width="2.6"/>
        <path d="M72 90 L72 48 Q72 34 85 34 Q98 34 98 48 L98 90" stroke-width="2.6"/>
        <line x1="20" y1="90" x2="50" y2="90" stroke-width="2.4" stroke-dasharray="3 4" opacity=".6"/>
        <line x1="70" y1="90" x2="100" y2="90" stroke-width="2.8"/>
        <g stroke-width="2">
          <line x1="28" y1="64" x2="42" y2="64"/>
          <path d="M32 60 L27 64 L32 68"/>
          <path d="M38 60 L43 64 L38 68"/>
          <line x1="78" y1="64" x2="92" y2="64"/>
          <path d="M88 60 L93 64 L88 68"/>
        </g>
      </g>
    </svg>'''


def motif_rethink(accent="#d9c48f"):
    """A near-closed loop arrow circling back on a marked belief: reconsidering, updating."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.8">
        <path d="M84 40 A32 32 0 1 1 60 28"/>
        <path d="M51 22 L60 28 L53 37"/>
      </g>
      <circle cx="60" cy="60" r="4.5" fill="{accent}"/>
      <circle cx="60" cy="60" r="12" fill="none" stroke="{accent}" stroke-width="1.3" opacity=".42"/>
    </svg>'''


def motif_catchup(accent="#d9c48f"):
    """A steep curve (roles changing) pulling ahead of a lagging one (learning) climbing to close the gap."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <line x1="18" y1="98" x2="104" y2="98" stroke="{accent}" stroke-width="1.4" opacity=".35"/>
      <path d="M20 92 C48 80 70 44 100 24" stroke="{accent}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <circle cx="100" cy="24" r="3.6" fill="{accent}"/>
      <path d="M20 92 C50 88 74 66 96 44" stroke="{accent}" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".8"/>
      <circle cx="96" cy="44" r="3.2" fill="{accent}" opacity=".8"/>
      <line x1="98" y1="28" x2="98" y2="42" stroke="{accent}" stroke-width="1.4" stroke-dasharray="3 3" opacity=".6"/>
      <path d="M91 47 L96 43 L99 49" stroke="{accent}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>
    </svg>'''


def motif_fork(accent="#d9c48f"):
    """A path rising to a choice node, then two diverging arrows: augment (up) or so-so (down)."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.6">
        <path d="M28 100 L60 62"/>
        <path d="M60 62 L96 34"/>
        <path d="M88 33 L96 34 L92 42"/>
      </g>
      <g stroke="{accent}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.6" opacity=".5">
        <path d="M60 62 L98 76"/>
        <path d="M90 71 L98 76 L91 82"/>
      </g>
      <circle cx="60" cy="62" r="4" fill="{accent}"/>
    </svg>'''


def motif_sensemaking(accent="#d9c48f"):
    """Scattered ambiguous signals, a workable path drawn through a subset: making meaning."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g fill="{accent}" opacity=".38">
        <circle cx="34" cy="30" r="2.4"/>
        <circle cx="92" cy="28" r="2.4"/>
        <circle cx="82" cy="92" r="2.4"/>
        <circle cx="22" cy="74" r="2.4"/>
      </g>
      <path d="M26 92 L48 58 L70 72 L96 38" stroke="{accent}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4"/>
      <g fill="{accent}">
        <circle cx="26" cy="92" r="3.4"/>
        <circle cx="48" cy="58" r="3.4"/>
        <circle cx="70" cy="72" r="3.4"/>
        <circle cx="96" cy="38" r="3.8"/>
      </g>
    </svg>'''


def motif_converge(accent="#d9c48f"):
    """A dense cluster pulled to the mean by inward arrows, with one outlier standing apart."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g fill="{accent}">
        <circle cx="56" cy="58" r="3.1"/>
        <circle cx="64" cy="55" r="3.1"/>
        <circle cx="62" cy="64" r="3.1"/>
        <circle cx="54" cy="65" r="3.1"/>
        <circle cx="67" cy="62" r="3.1"/>
      </g>
      <g stroke="{accent}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" opacity=".5">
        <path d="M22 28 L42 46"/><path d="M38 45 L43 47 L41 42"/>
        <path d="M99 32 L78 48"/><path d="M78 43 L77 49 L82 49"/>
        <path d="M24 90 L44 74"/><path d="M44 79 L45 73 L50 76"/>
      </g>
      <circle cx="96" cy="94" r="4" fill="{accent}"/>
      <circle cx="96" cy="94" r="11" fill="none" stroke="{accent}" stroke-width="1.3" opacity=".45"/>
    </svg>'''


def motif_hourglass(accent="#d9c48f"):
    """An hourglass: deliberate time amid speed — patience as the scarce strategic act."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.6">
        <line x1="36" y1="26" x2="84" y2="26"/>
        <line x1="36" y1="94" x2="84" y2="94"/>
        <path d="M42 26 L42 40 L60 60 L42 80 L42 94"/>
        <path d="M78 26 L78 40 L60 60 L78 80 L78 94"/>
      </g>
      <path d="M48 33 L72 33 L60 53 Z" fill="{accent}" opacity=".68"/>
      <path d="M52 87 L68 87 L60 73 Z" fill="{accent}"/>
      <circle cx="60" cy="66" r="1.8" fill="{accent}"/>
    </svg>'''


def motif_candor(accent="#d9c48f"):
    """A 2x2 grid with the care+challenge quadrant lit: Radical Candor."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" stroke-width="1.6" opacity=".35">
        <line x1="28" y1="60" x2="98" y2="60"/>
        <line x1="60" y1="26" x2="60" y2="94"/>
      </g>
      <rect x="63" y="31" width="30" height="27" rx="3" fill="{accent}" opacity=".85"/>
      <g stroke="{accent}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".6">
        <path d="M94 56 L98 60 L94 64"/>
        <path d="M56 30 L60 26 L64 30"/>
      </g>
    </svg>'''


def motif_practice(accent="#d9c48f"):
    """Ascending reps climbing above a dashed comfort line: deliberate practice."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <line x1="20" y1="74" x2="100" y2="74" stroke="{accent}" stroke-width="1.4" stroke-dasharray="4 4" opacity=".4"/>
      <g stroke="{accent}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4">
        <path d="M28 86 Q34 70 44 80"/>
        <path d="M44 80 Q52 58 62 70"/>
        <path d="M62 70 Q72 44 84 58"/>
      </g>
      <circle cx="28" cy="86" r="3.1" fill="{accent}" opacity=".55"/>
      <circle cx="84" cy="58" r="3.8" fill="{accent}"/>
      <path d="M79 53 L84 47 L89 53" stroke="{accent}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>'''


def motif_gap(accent="#d9c48f"):
    """A chain of responsibility broken by a gap, with responsibility falling through it."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g fill="{accent}">
        <circle cx="22" cy="42" r="5"/>
        <circle cx="52" cy="42" r="5"/>
        <circle cx="98" cy="42" r="5"/>
      </g>
      <line x1="27" y1="42" x2="47" y2="42" stroke="{accent}" stroke-width="2.6" stroke-linecap="round"/>
      <line x1="58" y1="42" x2="92" y2="42" stroke="{accent}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="2 6" opacity=".35"/>
      <g stroke="{accent}" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity=".7">
        <path d="M70 50 L70 86"/>
        <path d="M63 79 L70 88 L77 79"/>
      </g>
      <circle cx="70" cy="46" r="2.4" fill="{accent}" opacity=".7"/>
    </svg>'''


def motif_focus(accent="#d9c48f"):
    """A held focus (concentric rings) amid scattered drifting fragments: attention against distraction."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" stroke-width="2.2" stroke-linecap="round" opacity=".38">
        <line x1="20" y1="26" x2="31" y2="24"/>
        <line x1="94" y1="30" x2="104" y2="26"/>
        <line x1="24" y1="94" x2="35" y2="97"/>
        <line x1="90" y1="95" x2="100" y2="91"/>
        <line x1="15" y1="60" x2="25" y2="60"/>
      </g>
      <circle cx="60" cy="60" r="5" fill="{accent}"/>
      <circle cx="60" cy="60" r="14" fill="none" stroke="{accent}" stroke-width="2"/>
      <circle cx="60" cy="60" r="24" fill="none" stroke="{accent}" stroke-width="1.3" opacity=".42"/>
    </svg>'''


def motif_hierarchy(accent="#d9c48f"):
    """Steep hierarchy tiers with a voice rising from the bottom up through them."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" stroke-width="2.4" stroke-linecap="round" opacity=".45">
        <line x1="32" y1="30" x2="88" y2="30"/>
        <line x1="32" y1="52" x2="88" y2="52"/>
        <line x1="32" y1="74" x2="88" y2="74"/>
        <line x1="32" y1="96" x2="88" y2="96"/>
      </g>
      <path d="M60 92 L60 34" stroke="{accent}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <path d="M53 41 L60 32 L67 41" stroke="{accent}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="60" cy="96" r="4" fill="{accent}"/>
    </svg>'''


def motif_splitspeed(accent="#d9c48f"):
    """A speed streak splitting into a clean rising edge and a jagged breaking risk."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" stroke-width="2.6" stroke-linecap="round">
        <line x1="14" y1="60" x2="40" y2="60"/>
        <line x1="10" y1="50" x2="28" y2="50" opacity=".38"/>
        <line x1="10" y1="70" x2="28" y2="70" opacity=".38"/>
      </g>
      <circle cx="46" cy="60" r="4" fill="{accent}"/>
      <path d="M46 60 L96 34" stroke="{accent}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M88 33 L96 34 L93 42" stroke="{accent}" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M46 60 L60 72 L54 80 L68 88 L62 96" stroke="{accent}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".5"/>
    </svg>'''


def motif_oneonone(accent="#d9c48f"):
    """Two people facing across a table with dialog between: the 1:1."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <line x1="28" y1="74" x2="92" y2="74" stroke="{accent}" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="40" cy="52" r="9" fill="none" stroke="{accent}" stroke-width="2.6"/>
      <path d="M28 72 C28 62 34 60 40 60 C46 60 52 62 52 72" fill="none" stroke="{accent}" stroke-width="2.6" stroke-linecap="round"/>
      <circle cx="80" cy="52" r="9" fill="none" stroke="{accent}" stroke-width="2.6"/>
      <path d="M68 72 C68 62 74 60 80 60 C86 60 92 62 92 72" fill="none" stroke="{accent}" stroke-width="2.6" stroke-linecap="round"/>
      <circle cx="55" cy="40" r="2.8" fill="{accent}"/>
      <circle cx="65" cy="40" r="2.8" fill="{accent}" opacity=".45"/>
    </svg>'''


def motif_watch(accent="#d9c48f"):
    """A watching eye: the convenience tool that is also surveillance."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M18 60 Q60 26 102 60 Q60 94 18 60 Z" fill="none" stroke="{accent}" stroke-width="2.6" stroke-linejoin="round"/>
      <circle cx="60" cy="60" r="14" fill="none" stroke="{accent}" stroke-width="2.6"/>
      <circle cx="60" cy="60" r="5" fill="{accent}"/>
      <circle cx="65" cy="55" r="2" fill="#0e0b12"/>
    </svg>'''


def motif_jagged(accent="#d9c48f"):
    """An uneven (jagged) frontier line: safe dots above, an off/no-go dot below."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M14 68 L30 44 L44 62 L58 38 L74 60 L88 42 L106 58" fill="none" stroke="{accent}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="30" cy="28" r="3" fill="{accent}"/>
      <circle cx="74" cy="28" r="3" fill="{accent}"/>
      <circle cx="58" cy="92" r="3.6" fill="none" stroke="{accent}" stroke-width="2" opacity=".55"/>
      <path d="M55 89 L61 95 M61 89 L55 95" stroke="{accent}" stroke-width="1.8" stroke-linecap="round" opacity=".55"/>
    </svg>'''


def motif_unplug(accent="#d9c48f"):
    """An unplugged connection: cable and socket separated by a deliberate gap — detachment."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.6">
        <path d="M14 84 C30 84 30 60 44 60 L52 60"/>
        <rect x="52" y="52" width="12" height="16" rx="3"/>
        <line x1="64" y1="56" x2="70" y2="56"/>
        <line x1="64" y1="64" x2="70" y2="64"/>
        <path d="M88 46 L88 74 L106 74 L106 46 Z" opacity=".55"/>
        <circle cx="94" cy="60" r="1.6" fill="{accent}" opacity=".55"/>
        <circle cx="100" cy="60" r="1.6" fill="{accent}" opacity=".55"/>
      </g>
      <path d="M79 40 A21 21 0 0 1 79 80" stroke="{accent}" stroke-width="1.2" fill="none" stroke-dasharray="3 5" opacity=".4"/>
    </svg>'''


def motif_blueprint(accent="#d9c48f"):
    """An old flow (faint, dashed, many nodes) redrawn as a shorter bold path with a checkpoint gate."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" stroke-width="1.4" stroke-dasharray="2 5" opacity=".3" fill="none">
        <path d="M14 34 L38 34 L38 52 L62 52 L62 34 L86 34 L86 52 L106 52"/>
      </g>
      <g fill="{accent}" opacity=".3">
        <circle cx="14" cy="34" r="3"/><circle cx="38" cy="34" r="3"/><circle cx="38" cy="52" r="3"/>
        <circle cx="62" cy="52" r="3"/><circle cx="62" cy="34" r="3"/><circle cx="86" cy="34" r="3"/>
        <circle cx="86" cy="52" r="3"/><circle cx="106" cy="52" r="3"/>
      </g>
      <path d="M14 80 L50 80 L50 96 L90 96" stroke="{accent}" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="14" cy="80" r="4" fill="{accent}"/>
      <rect x="46" y="72" width="8" height="16" rx="2" fill="none" stroke="{accent}" stroke-width="2.2"/>
      <circle cx="90" cy="96" r="4.4" fill="{accent}"/>
    </svg>'''


def motif_comfort(accent="#d9c48f"):
    """Two human figures drifting apart while a small glowing node sits between them: comfort outsourced."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" stroke-width="2.4" fill="none" stroke-linecap="round">
        <circle cx="26" cy="42" r="8"/>
        <path d="M14 74 C14 58 18 54 26 54 C34 54 38 58 38 74"/>
        <circle cx="94" cy="42" r="8"/>
        <path d="M82 74 C82 58 86 54 94 54 C102 54 106 58 106 74"/>
      </g>
      <line x1="40" y1="64" x2="80" y2="64" stroke="{accent}" stroke-width="1.4" stroke-dasharray="2 6" opacity=".35"/>
      <circle cx="60" cy="64" r="6" fill="{accent}" opacity=".85"/>
      <circle cx="60" cy="64" r="13" fill="none" stroke="{accent}" stroke-width="1.2" opacity=".4"/>
    </svg>'''


def motif_upflow(accent="#d9c48f"):
    """Knowledge flowing upward: a junior figure below teaching a senior above; the old downward arrow faded."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" stroke-width="2.6" fill="none" stroke-linecap="round">
        <circle cx="60" cy="26" r="9"/>
        <path d="M46 48 C46 38 52 36 60 36 C68 36 74 38 74 48"/>
      </g>
      <g stroke="{accent}" stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".85">
        <circle cx="60" cy="88" r="7"/>
        <path d="M49 106 C49 98 54 96 60 96 C66 96 71 98 71 106"/>
      </g>
      <path d="M60 78 L60 56" stroke="{accent}" stroke-width="2.8" fill="none" stroke-linecap="round"/>
      <path d="M53 63 L60 54 L67 63" stroke="{accent}" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <g stroke="{accent}" stroke-width="1.4" stroke-dasharray="3 5" opacity=".3" stroke-linecap="round">
        <line x1="28" y1="46" x2="28" y2="78"/>
        <path d="M24 73 L28 79 L32 73" fill="none"/>
      </g>
    </svg>'''


def motif_scale(accent="#d9c48f"):
    """A balance scale tilted off-level: fairness that must be measured, not assumed."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" stroke-width="2.6" fill="none" stroke-linecap="round">
        <line x1="60" y1="46" x2="60" y2="92"/>
        <line x1="46" y1="98" x2="74" y2="98"/>
        <line x1="28" y1="54" x2="92" y2="38"/>
      </g>
      <circle cx="60" cy="46" r="3.4" fill="{accent}"/>
      <g stroke="{accent}" stroke-width="2" fill="none" stroke-linecap="round">
        <line x1="28" y1="54" x2="28" y2="66"/>
        <path d="M18 66 Q28 78 38 66"/>
        <line x1="92" y1="38" x2="92" y2="50"/>
        <path d="M82 50 Q92 62 102 50"/>
      </g>
      <circle cx="28" cy="72" r="2.6" fill="{accent}" opacity=".7"/>
    </svg>'''


def motif_disclose(accent="#d9c48f"):
    """A document with a visible AI label beside one where the label is hidden: to mark or not."""
    return f'''<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke="{accent}" stroke-width="2.4" fill="none" stroke-linejoin="round">
        <path d="M20 26 L52 26 L52 88 L20 88 Z"/>
        <path d="M68 26 L100 26 L100 88 L68 88 Z" opacity=".45"/>
      </g>
      <g stroke="{accent}" stroke-width="1.6" stroke-linecap="round" opacity=".5">
        <line x1="27" y1="38" x2="45" y2="38"/>
        <line x1="27" y1="46" x2="45" y2="46"/>
        <line x1="75" y1="38" x2="93" y2="38" opacity=".6"/>
        <line x1="75" y1="46" x2="93" y2="46" opacity=".6"/>
      </g>
      <rect x="26" y="66" width="20" height="12" rx="3" fill="{accent}"/>
      <rect x="74" y="66" width="20" height="12" rx="3" fill="none" stroke="{accent}" stroke-width="1.6" stroke-dasharray="3 4" opacity=".4"/>
    </svg>'''


MOTIFS = {"broken-ladder": motif_broken_ladder, "between": motif_between, "three-failures": motif_three_failures, "trellis": motif_trellis, "rewire": motif_rewire, "progress": motif_progress, "doors": motif_doors, "rethink": motif_rethink, "catchup": motif_catchup, "fork": motif_fork, "sensemaking": motif_sensemaking, "converge": motif_converge, "hourglass": motif_hourglass, "candor": motif_candor, "practice": motif_practice, "gap": motif_gap, "focus": motif_focus, "hierarchy": motif_hierarchy, "splitspeed": motif_splitspeed, "oneonone": motif_oneonone, "watch": motif_watch, "jagged": motif_jagged, "unplug": motif_unplug, "blueprint": motif_blueprint, "comfort": motif_comfort, "upflow": motif_upflow, "scale": motif_scale, "disclose": motif_disclose, "none": lambda accent=None: ""}

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
    {
        "vol": 17,
        "eyebrow": "Vol. 17 · The Delegation Line",
        "title": "되돌릴 수 있는가",
        "sub": "맡길 결정과 쥘 결정을 가르는 선. 능력이 아니라 되돌림이 정한다",
        "source": "원전 · Gary Klein · Kahneman · Bezos",
        "c1": "#1e2630", "c2": "#0b0f14",
        "accent": "#d9c48f",
        "motif": "doors",
    },
    {
        "vol": 18,
        "eyebrow": "Vol. 18 · Think Again",
        "title": "고쳐 생각하다",
        "sub": "확신이 싸진 시대, 리더의 근육은 답을 내는 힘보다 고쳐 생각하는 힘이다",
        "source": "원전 · Adam Grant · Tetlock",
        "c1": "#1f1a30", "c2": "#0d0a18",
        "accent": "#d9c48f",
        "motif": "rethink",
    },
    {
        "vol": 19,
        "eyebrow": "Vol. 19 · The Reskilling Economy",
        "title": "배우는 속도",
        "sub": "직무는 빨리 바뀌고 배움은 못 따라간다. 메우는 건 갈아 끼우기보다 다시 기르기다",
        "source": "원전 · WEF Future of Jobs · David Autor",
        "c1": "#282013", "c2": "#130f08",
        "accent": "#d9c48f",
        "motif": "catchup",
    },
    {
        "vol": 20,
        "eyebrow": "Vol. 20 · Power and Progress",
        "title": "방향을 고르다",
        "sub": "기술은 저절로 좋아지지 않는다. AI가 누구에게 이로울지는 무엇을 넓힐지의 선택이 정한다",
        "source": "원전 · Acemoglu & Johnson · MIT",
        "c1": "#2a151a", "c2": "#130a0c",
        "accent": "#d9c48f",
        "motif": "fork",
    },
    {
        "vol": 21,
        "eyebrow": "Vol. 21 · Sensemaking",
        "title": "지도가 없을 때",
        "sub": "정보가 넘칠수록 모자란 건 의미다. 지도가 없을 때 쓸 만한 해석을 짓는 일",
        "source": "원전 · Karl Weick · Ronald Heifetz",
        "c1": "#1a1f28", "c2": "#0c0f15",
        "accent": "#d9c48f",
        "motif": "sensemaking",
    },
    {
        "vol": 22,
        "eyebrow": "Vol. 22 · The Homogenization Effect",
        "title": "평균으로 끌리다",
        "sub": "각자는 나아지고 모두는 비슷해진다. 리더가 지킬 것은 평균이 아니라 바깥값이다",
        "source": "원전 · Doshi & Hauser · Meincke et al.",
        "c1": "#281526", "c2": "#120a11",
        "accent": "#d9c48f",
        "motif": "converge",
    },
    {
        "vol": 23,
        "eyebrow": "Vol. 23 · The Speed Trap",
        "title": "느림의 값",
        "sub": "실행이 공짜가 될수록 드러나는 것: 빨라지면 안 되는 결정들. 값은 언제 느려질지 아는 데 있다",
        "source": "원전 · Rita McGrath · Roger Martin",
        "c1": "#16262b", "c2": "#0a1013",
        "accent": "#d9c48f",
        "motif": "hourglass",
    },
    {
        "vol": 24,
        "eyebrow": "Vol. 24 · Beyond the Draft",
        "title": "초안 너머",
        "sub": "AI가 초안을 쓰는 시대, 고칠 것은 문장이 아니라 그 문장을 고른 판단이다",
        "source": "원전 · Kim Scott · Radical Candor",
        "c1": "#1e2417", "c2": "#0e120a",
        "accent": "#d9c48f",
        "motif": "candor",
    },
    {
        "vol": 25,
        "eyebrow": "Vol. 25 · The Right Kind of Practice",
        "title": "숙련의 재발명",
        "sub": "지름길이 흔해질수록 희소해지는 것은 의도된 연습이다",
        "source": "원전 · Anders Ericsson · Peak",
        "c1": "#2a1a13", "c2": "#130a07",
        "accent": "#d9c48f",
        "motif": "practice",
    },
    {
        "vol": 26,
        "eyebrow": "Vol. 26 · The Accountability Gap",
        "title": "떠넘길 수 없는 것",
        "sub": "결정은 맡겨도 책임은 떠넘길 수 없다. 공백은 통제 있는 자리에 붙들어 메운다",
        "source": "원전 · Matthias · Elish · EU AI Act",
        "c1": "#241a1a", "c2": "#100a0a",
        "accent": "#d9c48f",
        "motif": "gap",
    },
    {
        "vol": 27,
        "eyebrow": "Vol. 27 · Attention Span",
        "title": "집중력이라는 자원",
        "sub": "화면 앞 집중은 47초로 줄었다. 산출은 무한해도 집중력은 유한하다",
        "source": "원전 · Gloria Mark · UC Irvine",
        "c1": "#181d29", "c2": "#0a0d15",
        "accent": "#d9c48f",
        "motif": "focus",
    },
    {
        "vol": 28,
        "eyebrow": "Vol. 28 · Power Distance",
        "title": "말할 수 있는 위계",
        "sub": "권력거리가 큰 곳에서 안전감은 선언이 아니라 설계다",
        "source": "원전 · Hofstede · Edmondson",
        "c1": "#1e2622", "c2": "#0d120f",
        "accent": "#d9c48f",
        "motif": "hierarchy",
    },
    {
        "vol": 29,
        "eyebrow": "Vol. 29 · Ppalli-Ppalli",
        "title": "빨리빨리",
        "sub": "빨리빨리는 강점이자 약점이다. 늦추지 말고 속도를 가른다",
        "source": "원전 · 한국의 속도 문화 · 성수·삼풍",
        "c1": "#241a12", "c2": "#120a06",
        "accent": "#d9c48f",
        "motif": "splitspeed",
    },
    {
        "vol": 30,
        "eyebrow": "Vol. 30 · The 1:1 Playbook",
        "title": "AI 1:1 설계도",
        "sub": "상태는 도구에 맡기고, 1:1은 사람에게 돌려준다",
        "source": "원전 · Andy Grove · High Output Management",
        "c1": "#1b241d", "c2": "#0c120e",
        "accent": "#d9c48f",
        "motif": "oneonone",
    },
    {
        "vol": 31,
        "eyebrow": "Vol. 31 · Convenience as Surveillance",
        "title": "감시가 된 편의",
        "sub": "돕겠다며 들어온 도구가 지켜보는 도구가 된다. 편의는 미끼일 수 있다",
        "source": "원전 · Shoshana Zuboff · 직장 모니터링",
        "c1": "#1e1a24", "c2": "#0e0b12",
        "accent": "#d9c48f",
        "motif": "watch",
    },
    {
        "vol": 32,
        "eyebrow": "Vol. 32 · The Jagged Frontier",
        "title": "끄는 자리",
        "sub": "경계 밖에서 AI는 돕는 대신 더 틀리게 한다. 쓰는 법만큼 안 쓰는 자리를 안다",
        "source": "원전 · Dell'Acqua & Mollick · Harvard/BCG",
        "c1": "#1a2028", "c2": "#0b0e13",
        "accent": "#d9c48f",
        "motif": "jagged",
    },
    {
        "vol": 33,
        "eyebrow": "Vol. 33 · Psychological Detachment",
        "title": "꺼두는 시간",
        "sub": "일이 꺼지지 않으면 사람이 꺼진다. 회복은 마음이 일에서 떨어져 있는 동안 일어난다",
        "source": "원전 · Sabine Sonnentag · Fritz",
        "c1": "#1c1830", "c2": "#0d0b18",
        "accent": "#d9c48f",
        "motif": "unplug",
    },
    {
        "vol": 34,
        "eyebrow": "Vol. 34 · The Rewiring Playbook",
        "title": "다시 짜는 법",
        "sub": "얹지 말고 다시 짜라 했다. 이번엔 그 다시 짜기를 실습한다",
        "source": "원전 · McKinsey · Gartner",
        "c1": "#1c2130", "c2": "#0c0e16",
        "accent": "#d9c48f",
        "motif": "blueprint",
    },
    {
        "vol": 35,
        "eyebrow": "Vol. 35 · The Companionship Paradox",
        "title": "위로를 맡기면",
        "sub": "덜 외로우려다 더 외로워진다. 곁을 맡길수록 사람에게 가는 길이 멀어진다",
        "source": "원전 · OpenAI · MIT Media Lab · Sherry Turkle",
        "c1": "#241a28", "c2": "#110b14",
        "accent": "#d9c48f",
        "motif": "comfort",
    },
    {
        "vol": 36,
        "eyebrow": "Vol. 36 · Reverse Mentoring",
        "title": "거꾸로 배우기",
        "sub": "AI 앞에서 전문성의 기울기가 뒤집혔다. 위가 배우는 조직만 아래도 배운다",
        "source": "원전 · Jack Welch · HBR",
        "c1": "#232817", "c2": "#11130a",
        "accent": "#d9c48f",
        "motif": "upflow",
    },
    {
        "vol": 37,
        "eyebrow": "Vol. 37 · Bias at Scale",
        "title": "어제를 배운 기계",
        "sub": "AI는 편향을 지우지 않는다. 조용히, 일관되게, 대량으로 확장한다",
        "source": "원전 · Reuters · NYC LL144",
        "c1": "#2a151f", "c2": "#140a0f",
        "accent": "#d9c48f",
        "motif": "scale",
    },
    {
        "vol": 38,
        "eyebrow": "Vol. 38 · The Transparency Dilemma",
        "title": "밝히면 잃는다",
        "sub": "AI를 썼다고 밝히면 신뢰가 준다. 그래도 밝혀야 하는 이유",
        "source": "원전 · Schilke & Reimann · EU AI Act",
        "c1": "#1a2226", "c2": "#0b0f11",
        "accent": "#d9c48f",
        "motif": "disclose",
    },
]

def render_cover(m):
    num = str(m["vol"])
    motif_svg = MOTIFS.get(m.get("motif", "none"), MOTIFS["none"])(m.get("accent", "#d9c48f"))
    sub_html = "<br>".join(html.escape(line) for line in m["sub"].split("\n"))
    motif_block = f'<div class="g-motif">{motif_svg}</div>' if motif_svg else ""
    mw = max((len(w) for w in m["title"].split()), default=0)
    _gt = {5: 16, 6: 13, 7: 11.5}.get(mw, 10 if mw >= 8 else 0)
    gt = f";--gt:{_gt}cqw" if _gt else ""
    return (
        f'<figure class="gcover" style="--c1:{m["c1"]};--c2:{m["c2"]}{gt}" '
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
  .gcover .g-title{font-family:var(--serif);font-weight:700;font-size:var(--gt,19cqw);line-height:1.02;
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
