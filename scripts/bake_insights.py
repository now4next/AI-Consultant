# -*- coding: utf-8 -*-
"""독자 기록을 글 페이지 HTML 안에 구워 넣는다.

인사이트 목록은 지금까지 브라우저가 워커에 물어 채웠다. 그래서 자바스크립트를 끈 사람,
사내망에서 notify 도메인이 막힌 사람, 검색 엔진에게는 그 자리가 늘 비어 있었다.
발행할 때 한 번 구워 넣으면 그 사람들에게도 보이고, 그다음부터 요청은 갱신분만 가져온다.

발행 시점의 사본이므로 최신이 아닐 수 있다. 그건 받아 온 목록으로 덮으니 오래된 사본이
쌓이지 않고, 브라우저의 요청이 실패하면 구워 둔 것이 그대로 남는다.

  python scripts/bake_insights.py              # 전체 페이지
  python scripts/bake_insights.py 79           # 그 편만
  python scripts/bake_insights.py --dry-run    # 바뀔 페이지만 보여 준다
  python scripts/bake_insights.py --api http://127.0.0.1:8793
"""
import io
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REG_PATH = os.path.join(ROOT, "data", "volumes.json")
API = "https://notify.projectleadership.cc"
PER = 50

# insList 는 늘 쓰기 버튼 바로 위에 있다. 그 사이를 통째로 갈아 끼운다.
LIST_RE = re.compile(r'(<div id="insList">)(.*?)(</div>\n  <button class="ins-open")', re.S)
HEAD_HIDDEN = '<div id="insHead" hidden>'
HEAD_SHOWN = '<div id="insHead">'


def esc(v):
    s = "" if v is None else str(v)
    return (s.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;").replace('"', "&quot;"))


def card(it):
    # draw() 가 만드는 것과 같은 모양이어야 한다. 갱신분으로 바뀔 때 화면이 흔들리지 않는다.
    # .ins-body 는 pre-wrap 이므로 안쪽에 줄바꿈이나 들여쓰기를 넣지 않는다.
    edited = " · 고침" if it.get("edited") else ""
    return ('<div class="ins-card"><div class="ins-who"><b>' + esc(it.get("nick")) +
            "</b> · " + esc(it.get("at")) + edited +
            '</div><div class="ins-body">' + esc(it.get("body")) + "</div></div>")


def fetch(api=API):
    # 기본 User-Agent 로는 Cloudflare 가 403 을 돌려준다. 발행 도구라고 밝히고 요청한다.
    req = urllib.request.Request(f"{api}/insights/all?per={PER}", headers={
        "accept": "application/json",
        "user-agent": "leadership-insight-publisher/1.0 (+https://projectleadership.cc)",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read().decode("utf-8"))
    if not d.get("ok"):
        raise RuntimeError(f"목록을 받지 못했다: {d}")
    return {int(k): v for k, v in (d.get("vols") or {}).items()}, d.get("total", 0)


def render(s, items):
    """페이지 문자열을 새로 만든다. 인사이트 영역이 없으면 None."""
    m = LIST_RE.search(s)
    if not m:
        return None

    inner = ("\n" + "\n".join("    " + card(it) for it in items) + "\n  ") if items else ""
    out = s[:m.start(2)] + inner + s[m.end(2):]
    # 기록이 있으면 제목도 드러낸다. 스크립트 없이 보는 사람에게는 이게 유일한 단서다.
    return (out.replace(HEAD_HIDDEN, HEAD_SHOWN, 1) if items
            else out.replace(HEAD_SHOWN, HEAD_HIDDEN, 1))


def pages():
    """편 번호와 파일 이름을 레지스트리에서 읽는다. Vol.01 만 이름이 다르므로 추측하지 않는다."""
    reg = json.load(io.open(REG_PATH, encoding="utf-8"))
    return [(int(v["vol"]), v["file"]) for v in sorted(reg["volumes"], key=lambda v: v["vol"])]


def run(vols, vol=None, dry=False):
    """바뀐 (파일, 건수) 목록을 돌려준다. 내용이 같으면 파일을 건드리지 않는다."""
    done, skipped = [], 0
    for n, f in pages():
        if vol is not None and n != vol:
            continue
        p = os.path.join(ROOT, f)
        s = io.open(p, encoding="utf-8").read()
        items = vols.get(n, [])
        out = render(s, items)
        if out is None:
            skipped += 1
            continue
        if out == s:
            continue
        if not dry:
            io.open(p, "w", encoding="utf-8").write(out)
        done.append((f, len(items)))
    return done, skipped


def bake(vol=None, api=API):
    """발행 스크립트가 부른다. 워커에 닿지 못해도 발행을 멈추지 않는다."""
    try:
        vols, _ = fetch(api)
    except Exception as e:
        print(f"독자 기록 굽기 건너뜀 ({e})")
        return 0
    return len(run(vols, vol)[0])


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    api = args[args.index("--api") + 1].rstrip("/") if "--api" in args else API
    only = [int(a) for a in args if a.isdigit()]

    vols, total = fetch(api)
    print(f"받아 온 기록 {total}건 · {len(vols)}개 편")

    done, skipped = run(vols, only[0] if only else None, dry)
    if skipped:
        print(f"인사이트 영역이 없는 페이지 {skipped}개는 건너뜀")
    if not done:
        print("바뀐 페이지 없음")
        return
    print(("바뀔 페이지 " if dry else "구워 넣음 ") + f"{len(done)}개")
    for f, k in done:
        print(f"  {f} · {k}건")


if __name__ == "__main__":
    main()
