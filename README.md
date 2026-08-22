# 프로젝트 관리를 위한 AI 특강 및 PM 역량 고도화 니즈 서베이

조직(기업/기관) 내 프로젝트 관리와 업무 효율화를 위한 AI Agent 개발, AI 강의/교육,
PM 역량 고도화·모델링 컨설팅 수요를 파악하기 위한 설문 웹페이지입니다.

## 웹 페이지

GitHub Pages로 배포됩니다: <https://now4next.github.io/AI-Consultant/>

- [index.html](index.html) — PLI 홈 (뉴스레터형: Weekly Insight 스포트라이트 + 커버 카드 아카이브, 부엉이 마스코트 '플리', 구독 폼)
- [survey.html](survey.html) — AI4PM 니즈 조사 설문 (단일 HTML, 별도 서버 불필요)
- [blog.html](blog.html) — 추진 내용 홍보 블로그 글 (설문 참여 CTA 포함) · <https://now4next.github.io/AI-Consultant/blog.html>
- [city/index.html](city/index.html) — Smart Sustainable City Partners 소개 사이트 (UI/UX 업그레이드) · <https://now4next.github.io/AI-Consultant/city/>
- [insight.html](insight.html) — "AI 시대 리더십의 사각지대" 리더십 인사이트 Vol. 01 · <https://now4next.github.io/AI-Consultant/insight.html>
- [insight-vol-02.html](insight-vol-02.html) — "리더십의 역설" 리더십 인사이트 Vol. 02 · <https://now4next.github.io/AI-Consultant/insight-vol-02.html>
- [insight-vol-03.html](insight-vol-03.html) — "질문의 주권" 리더십 인사이트 Vol. 03 · <https://now4next.github.io/AI-Consultant/insight-vol-03.html>
- [insight-vol-04.html](insight-vol-04.html) — "결단력의 부재" 리더십 인사이트 Vol. 04 · <https://now4next.github.io/AI-Consultant/insight-vol-04.html>
- [insight-vol-05.html](insight-vol-05.html) — "가치가 사는 곳" 리더십 인사이트 Vol. 05 (McKinsey) · <https://now4next.github.io/AI-Consultant/insight-vol-05.html>
- [insight-vol-06.html](insight-vol-06.html) — "사람에 대한 더 깊은 이해" 리더십 인사이트 Vol. 06 (Kahneman) · <https://now4next.github.io/AI-Consultant/insight-vol-06.html>
- [insight-vol-07.html](insight-vol-07.html) — "인간의 자리" 리더십 인사이트 Vol. 07 (Stanford GSB · AI Effect) · <https://projectleadership.cc/insight-vol-07.html>
- [insight-vol-08.html](insight-vol-08.html) — "브레인 캐피탈" 리더십 인사이트 Vol. 08 (McKinsey · 브레인 파워 조직) · <https://projectleadership.cc/insight-vol-08.html>
- [insight-vol-09.html](insight-vol-09.html) — "분별의 값" 리더십 인사이트 Vol. 09 (MIT SMR · The Judgment Premium) · <https://projectleadership.cc/insight-vol-09.html>
- [insight-vol-10.html](insight-vol-10.html) — "신뢰의 화폐" 리더십 인사이트 Vol. 10 (Botsman · Frei · The Currency of Trust) · <https://projectleadership.cc/insight-vol-10.html>
- [insight-vol-11.html](insight-vol-11.html) — "사라진 사다리" 리더십 인사이트 Vol. 11 (McKinsey · Matt Beane · The Apprenticeship Gap) · <https://projectleadership.cc/insight-vol-11.html>
- [insight-vol-12.html](insight-vol-12.html) — "곁에 있다는 것" 리더십 인사이트 Vol. 12 (Graham Ward · INSEAD Knowledge, 2025) · <https://projectleadership.cc/insight-vol-12.html>
- [insight-vol-13.html](insight-vol-13.html) — "좋은 실패" 리더십 인사이트 Vol. 13 (Amy C. Edmondson · Harvard Business School, 2023) · <https://projectleadership.cc/insight-vol-13.html>
- [insight-vol-14.html](insight-vol-14.html) — "나누어 기르다" 리더십 인사이트 Vol. 14 (Terblanche · ICF · Passmore et al. · 2022–2026) · <https://projectleadership.cc/insight-vol-14.html>

### 새 볼륨 발행 워크플로우

손으로 하던 조립·검증을 스크립트로 대체했습니다. **직접 쓰는 것은 본문뿐**이고, 나머지는 자동입니다.

```bash
# 1) 주제 고르기 — 큐 맨 위 항목 사용
#    data/backlog.md

# 2) 두 파일 작성
#    data/volumes/vol-12.json        ← TEMPLATE.json 복사해 채우기 (제목·히어로·커버·종합·홈 카드)
#    data/volumes/vol-12.body.html   ← 본문 (<article> 안쪽 내용만)

# 3) 조립 (원하면 --dry-run 으로 페이지만 먼저 확인)
python scripts/new_volume.py 12

# 4) 검증
python scripts/lint_volume.py
```

`new_volume.py` 가 자동 처리하는 것: 페이지 생성(헤더·히어로·이전호 콜아웃·커버·종합·다음호 티저·공유·푸터)
· 스크립트 id 번호 변경 · 듣기 버튼 주입 · **이전 볼륨 네비/푸터 연결** · **홈 스포트라이트 교체 + 이전호를 아카이브 카드로 강등 + 편수 갱신** · `vol-NN/` 리다이렉트 · README 줄 추가 · `data/volumes.json` 레지스트리 등록.

`lint_volume.py` 가 검사하는 것: 필수 컴포넌트 · 태그 균형 · **내부 링크 유효성** · 중복 id · **스크립트가 참조하는 요소 존재 여부**(볼륨 복제 시 id 누락 탐지) · 하우스 스타일(em대시 과다, "단 하나/핵심은" 등 금칙어, "아니라" 반복). 에러가 있으면 종료 코드 1.

- 주제 큐: [data/backlog.md](data/backlog.md)
- 볼륨 레지스트리: [data/volumes.json](data/volumes.json)

### 커버 자동 생성 (Option A · 무료)

Vol.11부터 커버는 이미지 파일 대신 **데이터 기반 HTML/CSS 컴포넌트**(`.gcover`)로 렌더됩니다(사이트 폰트 사용, API·비용 없음).
- 볼륨 메타데이터를 [scripts/gen_cover.py](scripts/gen_cover.py)의 `VOLUMES`에 추가하고 `python scripts/gen_cover.py` 실행 → `scripts/out/vol-NN.cover.html` 스니펫 생성.
- 그 스니펫을 해당 글 히어로(`.cover-bleed`)와 홈 스포트라이트(`.spot .cover`)에 붙여넣으면 커버 완성.
- 모티프(예: `broken-ladder`)는 `MOTIFS`에 인라인 SVG로 추가.
- [field-trip/index.html](field-trip/index.html) — EPM 30기 현장 견학 신청 페이지 (Next.js 스타터를 정적 변환) · <https://now4next.github.io/AI-Consultant/field-trip/>
  - "참가 신청하기" 클릭 시 Google 시트에 기록됩니다(설문과 동일 Apps Script 엔드포인트). `__sheet__` 값으로 별도 탭('현장견학 신청')에 분리 저장하려면 [apps-script/Code.gs](apps-script/Code.gs) 최신본을 재배포하세요(미배포 시에도 기본 시트에 정상 기록).

## 주요 내용

1. 응답자 기본정보
2. AI 기술 변화 특강(강의) 니즈
3. PM을 위한 AI Agent 개발 니즈
4. 우리 조직 PM 역량 고도화 니즈
5. 올해 PM 역량 진단·분석·솔루션 도출 니즈
6. 추진 조건 및 상담 요청
7. 개인정보 수집 및 활용 동의

제출 시 응답이 Google 스프레드시트로 **자동 수집**됩니다. (아래 설정 필요)
서버 연결이 없더라도 응답 내용을 JSON으로 생성·복사·다운로드할 수 있습니다.

---

## 응답 자동 수집 설정

정적 호스팅(GitHub Pages)에는 서버가 없으므로, **Google Apps Script 웹앱**을 통해
응답을 **본인 소유의 Google 스프레드시트**에 자동 저장합니다. 무료·무제한이며 데이터는 전적으로 본인이 소유합니다.

### 1) 스프레드시트 + Apps Script 준비

1. 응답을 저장할 Google 스프레드시트를 새로 하나 만듭니다.
2. 상단 메뉴 **[확장 프로그램] → [Apps Script]** 를 엽니다.
3. 기본 코드를 모두 지우고 [apps-script/Code.gs](apps-script/Code.gs) 내용을 전부 붙여넣고 저장합니다.

### 2) 웹앱으로 배포

1. Apps Script 편집기에서 **[배포] → [새 배포]** 를 클릭합니다.
2. 톱니바퀴 아이콘에서 유형을 **웹 앱**으로 선택합니다.
3. 옵션을 아래처럼 설정합니다.
   - **실행 계정(Execute as)**: 나(Me)
   - **액세스 권한(Who has access)**: 모든 사용자(Anyone)
4. **배포**를 누르고, 최초 1회 Google 계정 권한을 승인합니다.
5. 생성된 **웹 앱 URL**( `https://script.google.com/macros/s/…/exec` )을 복사합니다.

> 배포 URL을 브라우저에서 직접 열었을 때 `{"result":"ok", ...}` 가 보이면 정상입니다.

### 3) 설문에 URL 연결

[index.html](index.html) 상단 스크립트의 아래 한 줄에 복사한 URL을 붙여넣습니다.

```js
const ENDPOINT_URL = "";  // ← 여기에 배포 URL(.../exec)을 붙여넣기
```

예:

```js
const ENDPOINT_URL = "https://script.google.com/macros/s/AKfy...exec";
```

저장 후 GitHub에 커밋·푸시하면 반영됩니다.

### 동작 방식

- 응답자가 **제출하기**를 누르면 응답이 스프레드시트 `설문응답` 시트에 한 행씩 추가됩니다.
- 첫 열은 `서버 수신 시각`, 이후 각 설문 항목이 열로 저장되며, 복수 선택 항목은 쉼표로 연결됩니다.
- 설문 항목을 추가·변경해도 Apps Script 수정 없이 새 항목이 자동으로 새 열로 추가됩니다.
- 전송에 실패하면 화면에 안내가 표시되고, 응답 내용을 복사/다운로드해 백업할 수 있습니다.

### 참고

- 이 설문은 이름·연락처·이메일 등 개인정보를 수집합니다. 스프레드시트 공유 범위를 최소화하고,
  개인정보 보유·파기 기준에 따라 관리하세요.
- 응답 알림을 이메일로 받고 싶다면 스프레드시트의 **[도구] → [알림 규칙]** 또는 Apps Script에
  `MailApp.sendEmail(...)` 을 추가해 확장할 수 있습니다.
