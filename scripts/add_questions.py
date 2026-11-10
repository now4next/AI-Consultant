# -*- coding: utf-8 -*-
"""레지스트리의 questions 로 각 글 맨 앞에 '이 글이 답하는 질문' 상자를 넣는다.

질문 셋은 섹션 셋과 1:1 로 맞춘다. 상자의 질문을 누르면 그 답이 있는 섹션으로 간다.
섹션에 id 가 없으므로 순서로 찾는다(레일과 같은 방식).

  python scripts/add_questions.py            # questions 가 있는 편 전부
  python scripts/add_questions.py 92         # 그 편만
  python scripts/add_questions.py --dry-run
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REG_PATH = os.path.join(ROOT, "data", "volumes.json")

BOX_RE = re.compile(r'<div class="qbox">.*?</div>\s*\n', re.S)


def esc(v):
    s = "" if v is None else str(v)
    return (s.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;").replace('"', "&quot;"))


def box(questions):
    lis = "\n".join(
        '    <li><button type="button">%s</button></li>' % esc(q) for q in questions
    )
    return ('<div class="qbox">\n'
            '  <div class="lab">이 글이 답하는 질문</div>\n'
            '  <ol>\n%s\n  </ol>\n'
            '</div>\n\n' % lis)


def render(s, questions):
    """페이지 문자열을 새로 만든다. 꽂을 자리가 없으면 None."""
    s = BOX_RE.sub("", s, count=1)          # 있던 상자는 걷어 내고 다시 넣는다
    if not questions:
        return s
    # 용어 정의보다 앞에 둔다. 글에서 독자가 가장 먼저 만나는 자리다.
    for anchor in ('<div class="termdef">', '<div class="prose">'):
        if anchor in s:
            return s.replace(anchor, box(questions) + anchor, 1)
    return None


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    only = [int(a) for a in args if a.isdigit()]

    reg = json.load(io.open(REG_PATH, encoding="utf-8"))["volumes"]
    done, missing = [], []
    for v in sorted(reg, key=lambda v: v["vol"]):
        n = v["vol"]
        if only and n not in only:
            continue
        qs = v.get("questions") or []
        if not qs:
            missing.append(n)
            continue
        p = os.path.join(ROOT, v["file"])
        s0 = io.open(p, encoding="utf-8").read()
        s = render(s0, qs)
        if s is None:
            print("  꽂을 자리를 못 찾음: %s" % v["file"])
            continue
        if s != s0:
            if not dry:
                io.open(p, "w", encoding="utf-8").write(s)
            done.append((v["file"], len(qs)))

    if missing:
        print("questions 가 아직 없는 편 %d개: %s%s" % (
            len(missing), ", ".join(str(x) for x in missing[:12]),
            " …" if len(missing) > 12 else ""))
    if not done:
        print("바뀐 페이지 없음")
        return
    print(("바뀔 페이지 " if dry else "질문 상자 넣음 ") + "%d개" % len(done))
    for f, k in done:
        print("  %s · %d개" % (f, k))


if __name__ == "__main__":
    main()
