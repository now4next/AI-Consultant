# pli-notify — 매주 리더십 인사이트 카카오톡 알림

Cloudflare Worker + D1. 구독자가 카카오 동의 1탭으로 신청하고, 고른 요일·시간에
아직 받지 않은 편을 **본인 카카오톡 '나와의 채팅'**으로 받습니다. 기획: `docs/kakao-notify-plan.md`.

## 0. 카카오 앱 (사업자등록 없이)

둘 중 하나:

- **A. 99WisdomBook 앱 재사용** — 이미 일반 사용자에게 '나에게 보내기'가 동작하는 앱.
  카카오 디벨로퍼스 > 그 앱 > 플랫폼(Web)에 `https://notify.projectleadership.cc` 추가,
  카카오 로그인 > Redirect URI에 `https://notify.projectleadership.cc/kakao/callback` 추가.
  동의 화면에 그 앱의 이름·아이콘이 뜹니다.
- **B. 새 앱** — 앱 생성 → 카카오 로그인 활성화 → 동의항목 `talk_message` 선택 동의 →
  **개인 개발자 비즈앱 전환 신청**(사업자등록 불필요, 데브톡 문의) → 승인 후 공개 사용 가능.

공통: 카카오 로그인 > 보안 > **Client Secret** 생성·사용 ON. REST API 키와 함께 아래 시크릿으로 저장.

## 0-b. 이메일 채널 (Resend)

99WisdomBook과 같은 Resend 계정을 씁니다. `RESEND_API_KEY` 시크릿만 있으면 동작하고, 발신 주소는
`wrangler.toml`의 `MAIL_FROM`(`insight@projectleadership.cc`)입니다. 이 도메인이 resend.com/domains에서
아직 검증되지 않았으면 워커가 자동으로 `MAIL_FROM_FALLBACK`(이미 검증된 `noreply@99wisdombook.org`)로 보냅니다.

흐름: 사이트 폼에 주소 입력 → `POST /email/start` → 바로 **설정 페이지**(카카오와 같은 화면) → 저장 시 **확인 메일**(주소 검증 겸)과
**첫 편**이 즉시 발송 → 이후 정해진 시간에 **표지 + 핵심 문장 + 이 글의 용어 + 도입부 두 문단 + 이어서 읽기** 메일.
이미 신청된 주소를 다시 넣으면 설정 페이지 대신 그 주소로 관리 링크 메일을 보냅니다(남의 설정을 열 수 없게). 설정 페이지의
**테스트 메일 다시 보내기**는 1분에 한 번. 모든 메일에 설정 변경·그만 받기 링크와 `List-Unsubscribe` 헤더가 붙습니다.
디자인 확인: `https://notify.projectleadership.cc/email/preview?vol=42&kind=issue|welcome|link|exhausted`.

## 1. 배포

```bash
cd notify
npm i -g wrangler && wrangler login

wrangler d1 create pli-notify-db          # → database_id를 wrangler.toml에 붙여넣기
wrangler d1 execute pli-notify-db --remote --file=schema.sql

wrangler secret put KAKAO_REST_API_KEY
wrangler secret put KAKAO_CLIENT_SECRET
wrangler secret put RESEND_API_KEY         # 이메일 채널 (resend.com > API Keys)
wrangler secret put SIGNING_KEY            # openssl rand -hex 32
wrangler secret put CRON_SECRET            # openssl rand -hex 24

wrangler deploy                            # custom_domain → notify.projectleadership.cc 자동 생성
```

## 2. 확인

1. `https://notify.projectleadership.cc/health` → `{"ok":true}`
2. `https://notify.projectleadership.cc/kakao/start` → 동의 → 설정 페이지 → 저장 → 카카오톡 '나와의 채팅'에 환영 메시지
3. 지금 즉시 1편 보내 보기(구독자 id는 D1에서 확인):
   ```bash
   curl -X POST "https://notify.projectleadership.cc/cron/run?id=<subscriber_id>&force=1" \
        -H "Authorization: Bearer $CRON_SECRET"
   ```
4. 정기 발송은 Cron Trigger(`*/5 * * * *`)가 자동으로 돌립니다. `wrangler tail`로 로그 확인.

## 3. 사이트 연결

`index.html` 하단 섹션의 "카카오톡으로 받기" 버튼 → `https://notify.projectleadership.cc/kakao/start`.
콘텐츠는 `data/volumes.json`과 `assets/og/vol-NN.jpg`를 그대로 읽으므로, 새 편을 발행하면 별도 배포 없이 후보에 들어갑니다.

## 4. 관리자 대시보드 (`/admin`)

`src/admin.js`. `ADMIN_USER` 변수 + `ADMIN_PASS_HASH` 시크릿(PBKDF2, `scripts/hash-password.js`)으로 로그인.
개요(채널·상태별 수, 오늘 발송, 마지막 크론, 30일 그래프) · 신청자(필터·검색·CSV·상세·조치) · 발송 기록(필터·재시도) ·
접속 기록(신청 흐름 이벤트 + 크론 실행) · 설정(비밀번호 변경·연동 상태·보존 기간). 세션 12시간 서명 쿠키, CSRF 토큰,
5회 실패 잠금, 관리자 행동은 모두 `access_log`에 기록. 로컬 확인: `.dev.vars`에 `ADMIN_PASS_HASH`를 넣고 `npx wrangler dev`.

## 5. 운영 메모

- refresh token은 AES-GCM으로 암호화 저장(`SIGNING_KEY`). 매주 발송이 곧 토큰 갱신이라 활성 구독자는 만료되지 않음.
- 카카오 연결 끊김(`invalid_grant`)은 자동 해지, 그 외 실패 3회 연속이면 `paused`.
- 선택 가능한 시간은 07:00–22:00(30분 단위). 하루 1회 잠금(`last_sent_date`)이라 크론이 늦게 떠도 중복 발송 없음.
- 모든 편을 다 받으면 안내 메시지 후 `exhausted` → 설정에서 '받은 편 기록 지우기'로 2회차.
