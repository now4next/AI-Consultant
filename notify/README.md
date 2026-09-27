# pli-notify — 매주 리더십 인사이트 이메일 알림

Cloudflare Worker + D1. 구독자가 이메일 주소를 넣고 받을 요일·시간을 고르면, 아직 받지 않은 편을
한 편씩 메일로 받습니다. 관리자가 대신 등록해 줄 수도 있습니다(`/admin`).

> **카카오톡 채널은 2026-09-27에 제거했습니다.** `/kakao/*` 경로, 토큰 갱신·발송 코드, 동의 확인이
> 모두 빠졌고 `KAKAO_*` 시크릿은 더 이상 읽지 않습니다. DB에 남은 `channel='kakao'` 행은 주소가 없어
> 발송 대상 쿼리(`email IS NOT NULL`)에서 아예 제외되므로 오류를 내지 않습니다. 관리자 화면에서
> 그 행에 이메일 주소를 넣으면 이메일 알림으로 전환되고, 필요 없으면 삭제하면 됩니다.

## 0. 이메일 발송 (Resend)

`RESEND_API_KEY` 시크릿만 있으면 동작하고, 발신 주소는 `wrangler.toml`의 `MAIL_FROM`
(`insight@projectleadership.cc`)입니다. 이 도메인이 resend.com/domains에서 검증되지 않았으면 워커가
자동으로 `MAIL_FROM_FALLBACK`로, 그마저 없으면 Resend 테스트 발신자로 내려갑니다.

흐름: 사이트 폼에 주소 입력 → `POST /email/start` → **설정 페이지**(요일·시간·주제·순서) → 저장 시
**확인 메일**(주소 검증 겸)과 **첫 편**이 즉시 발송 → 이후 정해진 시간에 **표지 + 핵심 문장 + 이 글의 용어 +
도입부 두 문단 + 이어서 읽기** 메일. 이미 신청된 주소를 다시 넣으면 설정 페이지 대신 그 주소로 관리 링크
메일을 보냅니다(남의 설정을 열 수 없게). 설정 페이지의 **테스트 메일 다시 보내기**는 1분에 한 번.
모든 메일에 설정 변경·그만 받기 링크와 `List-Unsubscribe` 헤더가 붙습니다.
디자인 확인: `https://notify.projectleadership.cc/email/preview?vol=42&kind=issue|welcome|link|exhausted`.

## 1. 배포

```bash
cd notify
npm i -g wrangler && wrangler login

wrangler d1 create pli-notify-db          # → database_id를 wrangler.toml에 붙여넣기
wrangler d1 execute pli-notify-db --remote --file=schema.sql

wrangler secret put RESEND_API_KEY          # resend.com > API Keys
wrangler secret put SIGNING_KEY             # openssl rand -hex 32
wrangler secret put CRON_SECRET             # openssl rand -hex 24
wrangler secret put ADMIN_PASS_HASH         # node scripts/hash-password.js (SETUP.md 7단계)

wrangler deploy                             # custom_domain → notify.projectleadership.cc 자동 생성
```

카카오 시크릿이 남아 있다면 지워도 됩니다: `wrangler secret delete KAKAO_REST_API_KEY` (그리고 `KAKAO_CLIENT_SECRET`).

## 2. 확인

1. `https://notify.projectleadership.cc/health` → `{"ok":true,"ready":true,"email":true}`
   (`?deep=1`은 Resend 키 모양과 발신 도메인 검증 상태까지 확인)
2. 사이트 하단 폼에 주소 입력 → 설정 페이지 → 저장 → 확인 메일과 첫 편 수신
3. 지금 즉시 1편 보내 보기(구독자 id는 `/admin` 또는 D1에서 확인):
   ```bash
   curl -X POST "https://notify.projectleadership.cc/cron/run?id=<subscriber_id>&force=1" \
        -H "Authorization: Bearer $CRON_SECRET"
   ```
4. 정기 발송은 Cron Trigger(`*/5 * * * *`)가 돌립니다. `/health`가 호출될 때마다 마지막 크론이 12분 넘게
   멈춰 있으면 워커가 스스로 한 번 대신 돌립니다(fallback tick). `wrangler tail`로 로그 확인.

## 3. 사이트 연결

`index.html` 하단 구독 폼 → `https://notify.projectleadership.cc/email/start`.
콘텐츠는 `data/volumes.json`과 `assets/og/vol-NN.jpg`를 그대로 읽으므로, 새 편을 발행하면 별도 배포 없이
후보에 들어갑니다. 분류 목록은 `src/lib.js`의 `CATS`에 있으니 **분류 체계를 바꾸면 여기도 함께 고칩니다.**

## 4. 관리자 대시보드 (`/admin`)

`src/admin.js`. `ADMIN_USER` 변수 + `ADMIN_PASS_HASH` 시크릿(PBKDF2, `scripts/hash-password.js`)으로 로그인.
개요(상태별 수, 오늘 발송, 마지막 크론, 30일 그래프) · 신청자(필터·검색·CSV·상세) · 발송 기록(필터·재시도) ·
접속 기록(신청 흐름 이벤트 + 크론 실행) · 설정(비밀번호 변경·연동 상태·보존 기간).
세션 12시간 서명 쿠키, CSRF 토큰, 5회 실패 잠금, 관리자 행동은 모두 `access_log`에 기록.

**신청자 직접 등록·수정**(2026-09-27 추가)

- 신청자 목록 위의 **+ 신청자 직접 추가** → 이메일 주소, 요일, 시간, 주제, 순서, 상태를 관리자가 입력해 등록.
  '환영 메일을 바로 보내기'를 켜면 본인이 설정을 바꾸거나 그만 받을 수 있는 링크가 담긴 메일이 나갑니다.
  메일 발송이 실패해도 등록 자체는 유지되고 실패 사유가 화면과 발송 기록에 남습니다.
- 신청자 상세의 **알림 설정** 상자에서 주소·요일·시간·주제·순서·상태를 바로 수정. 주소가 없던 카카오 행에
  주소를 넣으면 `channel`이 `email`로 바뀌며 그때부터 발송 대상이 됩니다.
- 중복 주소는 막고(기존 신청자 화면으로 보냄), 요일을 하나도 고르지 않으면 저장되지 않습니다.

로컬 확인: 별도 폴더에 `src/`·`wrangler.toml`·`schema.sql`을 복사하고 `.dev.vars`에 테스트용
`ADMIN_PASS_HASH`·`SIGNING_KEY`를 넣은 뒤 `npx wrangler d1 execute pli-notify-db --local --file=schema.sql`
→ `npx wrangler dev --local`. 운영 D1을 건드리지 않습니다.

## 5. 운영 메모

- 발송 실패 3회 연속이면 `paused`. 하루 1회 잠금(`last_sent_date`)이라 크론이 늦게 떠도 중복 발송 없음.
- 선택 가능한 시간은 07:00–22:00(30분 단위), 발송은 :00/:30 슬롯에 3시간 캐치업 창을 둡니다.
- 모든 편을 다 받으면 안내 메일 후 `exhausted` → 설정에서 '받은 편 기록 지우기'로 2회차.
- 저장하는 개인정보는 이메일 주소와 발송 설정뿐입니다. '그만 받기'는 즉시 삭제입니다.
