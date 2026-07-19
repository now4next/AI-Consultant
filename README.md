# 프로젝트 관리를 위한 AI 특강 및 PM 역량 고도화 니즈 서베이

조직(기업/기관) 내 프로젝트 관리와 업무 효율화를 위한 AI Agent 개발, AI 강의/교육,
PM 역량 고도화·모델링 컨설팅 수요를 파악하기 위한 설문 웹페이지입니다.

## 웹 페이지

GitHub Pages로 배포됩니다: <https://now4next.github.io/AI-Consultant/>

- [index.html](index.html) — 니즈 조사 설문 (단일 HTML, 별도 서버 불필요)
- [blog.html](blog.html) — 추진 내용 홍보 블로그 글 (설문 참여 CTA 포함) · <https://now4next.github.io/AI-Consultant/blog.html>
- [city/index.html](city/index.html) — Smart Sustainable City Partners 소개 사이트 (UI/UX 업그레이드) · <https://now4next.github.io/AI-Consultant/city/>
- [insight.html](insight.html) — "AI 시대 리더십의 사각지대" 리더십 인사이트 Vol. 01 · <https://now4next.github.io/AI-Consultant/insight.html>
- [insight-vol-02.html](insight-vol-02.html) — "리더십의 역설" 리더십 인사이트 Vol. 02 · <https://now4next.github.io/AI-Consultant/insight-vol-02.html>

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
