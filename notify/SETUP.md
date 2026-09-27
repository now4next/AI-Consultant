# 이메일 알림 워커 — 처음 설정 가이드 (화면 단위)

> **2026-09-27 · 카카오톡 채널을 제거했습니다.** 이 가이드는 이메일 알림만 다룹니다.
> `/kakao/*` 경로와 토큰·동의 관련 코드가 모두 빠졌고, `KAKAO_REST_API_KEY`·`KAKAO_CLIENT_SECRET`
> 시크릿은 더 이상 읽지 않습니다. 남아 있으면 지워도 됩니다:
> `npx wrangler secret delete KAKAO_REST_API_KEY` (그리고 `KAKAO_CLIENT_SECRET`).
> DB에 남은 카카오 신청자 행은 주소가 없어 발송 대상에서 자동으로 빠지며, 관리자 화면에서
> 이메일 주소를 넣어 전환하거나 삭제할 수 있습니다.

> **진행 상태** — Cloudflare 쪽 완료: D1 `pli-notify-db` + 스키마, 워커 배포
> (`notify.projectleadership.cc`), 크론, `SIGNING_KEY`·`CRON_SECRET`·`RESEND_API_KEY`·`ADMIN_PASS_HASH`.
> `/health`가 `{"ok":true,"ready":true,"email":true}`면 사이트의 구독 폼이 워커로 연결된 상태입니다.

> 계정 권한이 필요한 단계가 섞여 있습니다. **1단계(`wrangler login`)만 끝나면 2·4·5단계는 같은 PC에서
> Claude가 대신 실행할 수 있습니다** (wrangler가 로그인 정보를 PC에 저장하므로).
> 시크릿 등록(3단계)은 값을 직접 넣어야 하므로 사용자가 합니다.

| 단계 | 내용 | 누가 | 걸리는 시간 |
|---|---|---|---|
| 1 | Cloudflare 로그인 (`wrangler login`) | 사용자 | 2분 |
| 2 | D1 데이터베이스 생성 + 스키마 | 사용자 또는 Claude | 2분 |
| 3 | 시크릿 등록 | 사용자 | 5분 |
| 4 | 배포 (`wrangler deploy`) | 사용자 또는 Claude | 2분 |
| 5 | 동작 확인 | 함께 | 5분 |
| 6 | 이메일 발송 (Resend) | 사용자 | 10분 |
| 7 | 관리자 대시보드 | 사용자 | 5분 |

---

## 1단계 · Cloudflare 로그인

DNS 권한이 있는 Cloudflare 계정으로 합니다. 터미널(PowerShell 또는 Git Bash) 아무거나:

```bash
cd C:/Users/User/AI-Consultant-main/notify
npx wrangler login
```

- 브라우저가 열리고 Cloudflare 로그인 화면 → 로그인 → **Allow** → 터미널에 `Successfully logged in` 이 뜨면 끝.
- 확인: `npx wrangler whoami` → 계정 이메일과 Account ID가 보입니다.
- 이 PC에 로그인 정보가 저장되므로 이후 wrangler 명령은 Claude가 대신 실행할 수 있습니다.

---

## 2단계 · D1 데이터베이스

```bash
npx wrangler d1 create pli-notify-db
```

출력 마지막에 이런 블록이 나옵니다:
```
[[d1_databases]]
binding = "DB"
database_name = "pli-notify-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```
`database_id` 값을 `notify/wrangler.toml`의 `REPLACE_WITH_ID_FROM_wrangler_d1_create` 자리에 붙여넣습니다. 그다음 스키마 적용:

```bash
npx wrangler d1 execute pli-notify-db --remote --file=schema.sql
```
확인 질문에 `y`. `subscribers`·`sends` 테이블이 만들어집니다.

> Claude에게: "로그인했어요, 2단계 실행해줘"라고 하면 여기까지 대신 합니다.

---

## 3단계 · 시크릿

값은 입력해도 화면에 보이지 않습니다. 붙여넣고 Enter.

```bash
npx wrangler secret put SIGNING_KEY            # 아래에서 생성한 무작위 값
npx wrangler secret put CRON_SECRET            # 아래에서 생성한 무작위 값 (따로 메모 — 5단계 테스트에 씀)
npx wrangler secret put RESEND_API_KEY         # 6단계에서 발급 (이메일 발송)
npx wrangler secret put ADMIN_PASS_HASH        # 7단계에서 생성 (관리자 로그인)
```

무작위 값 만들기 (둘 중 하나):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # PowerShell·Git Bash 모두 가능
openssl rand -hex 32                                                         # Git Bash
```
두 번 실행해 하나는 `SIGNING_KEY`, 하나는 `CRON_SECRET`에 씁니다.

확인: `npx wrangler secret list` → 등록한 이름들이 보이면 됩니다. (값은 다시 볼 수 없으니 CRON_SECRET만 메모.)

> **붙여넣기가 안 되는 터미널이면** (Claude 앱 내장 터미널은 `Enter a secret value:` 숨김 입력에 Ctrl+V가 `^V` 제어 문자로 들어갑니다):
> 값을 클립보드에 복사한 직후 아래처럼 클립보드를 바로 파이프로 넘깁니다. Windows PowerShell 5.1은 `&&`를 못 쓰니 `;`로 잇습니다.
> ```powershell
> ((Get-Clipboard -Raw) -replace '[^\x20-\x7E]','') | npx wrangler secret put RESEND_API_KEY
> ```
> 확인: `curl "https://notify.projectleadership.cc/health?deep=1"` → `"resend":"ok"` (키가 틀리면 `invalid …`).

---

## 4단계 · 배포

```bash
npx wrangler deploy
```

- `Deployed pli-notify triggers` 아래에 `notify.projectleadership.cc (custom domain)`와 `schedule: */5 * * * *`가 보이면 성공.
- DNS가 Cloudflare에 있으므로 `notify` 서브도메인 레코드와 인증서가 자동으로 만들어집니다(1~2분).
- 확인: 브라우저에서 `https://notify.projectleadership.cc/health` → `{"ok":true,"time":"..."}`
- 만약 custom domain 오류가 나면: Cloudflare 대시보드 > Workers & Pages > `pli-notify` > Settings > Domains & Routes > **Add > Custom domain** → `notify.projectleadership.cc` 입력.

> Claude에게: "배포해줘"라고 하면 대신 실행하고 health까지 확인합니다.

---

## 5단계 · 동작 확인

1. `curl https://notify.projectleadership.cc/health` → `{"ok":true,"ready":true,"email":true}`.
2. **사이트 홈 하단** (https://projectleadership.cc/#subscribe)에서 이메일 주소를 넣고 **이메일 알림 받기** →
   설정 페이지 → 요일·시간 고르고 **알림 시작하기** → 메일함에 "설정이 끝났어요 🦉"와 첫 편이 도착.
3. 즉시 1편 발송 테스트(정해진 시간까지 기다리지 않고):
   ```bash
   npx wrangler d1 execute pli-notify-db --remote --command "SELECT id, days, slot, status FROM subscribers"
   curl -X POST "https://notify.projectleadership.cc/cron/run?id=<위에서 본 id>&force=1" -H "Authorization: Bearer <CRON_SECRET>"
   ```
   → 응답 `{"sent":1,...}` 와 함께 나와의 채팅에 OG 카드 메시지가 옵니다.
4. 실시간 로그: `npx wrangler tail` (다음 :00/:30 슬롯에 크론이 도는 것을 볼 수 있습니다).

---

## 6단계 · 이메일 채널 (Resend)

1. https://resend.com 로그인(99WisdomBook과 같은 계정) → **API Keys > Create API Key** → 이름 `pli-notify`, 권한 Sending access → 생성된 키 복사(한 번만 보입니다).
2. 복사 직후 터미널에서 (붙여넣기 없이 클립보드를 그대로 넘깁니다):
   ```powershell
   cd C:/Users/User/AI-Consultant-main/notify; ((Get-Clipboard -Raw) -replace '[^\x20-\x7E]','') | npx wrangler secret put RESEND_API_KEY
   ```
   확인: `curl.exe -s https://notify.projectleadership.cc/health` → `"email":true`
3. **발신 도메인: `projectleadership.cc` (검증 완료 2026-09-12 16:11), 회신 `now@nfn.co.kr`** — Resend > Domains에서 Auto configure로
   Cloudflare에 아래 3개가 자동 등록됐습니다. 참고용 값:
   | 이름 | 타입 | 값 | 우선순위 |
   |---|---|---|---|
   | `resend._domainkey` | TXT | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDO6wX3ua5/EygrpTMlfBbGcAt1hR4kPPZXyOkFBd7hA/iZ0PFT02UfMtj1PdTcUwn4M85Vo3IfMvEUa6BiwTbD2vQb0Aom7t9/SHmlVAE1b7XCXhHnKXYoIPJ/4ZAx559fWuE33E7q5uZdi9Z55fMDW80eZj+/bfHtPTxSUWVAgQIDAQAB` | |
   | `send` | MX | `feedback-smtp.ap-northeast-1.amazonses.com` | 10 |
   | `send` | TXT | `v=spf1 include:amazonses.com ~all` | |
   (DMARC `_dmarc` TXT `v=DMARC1; p=none;`는 선택. "Enable Receiving"의 `@ MX`는 넣지 않음.)
   Resend 화면의 **Auto configure > Go to Cloudflare**로 Cloudflare에 로그인·승인하면 위 레코드가 자동으로 들어갑니다.

   (예비안) Resend > **Domains**에 `nfn.co.kr`도 추가돼 있습니다(Region Tokyo, 상태 Not Started, 2026-09-12). Resend 화면의
   **DNS Records** 표에 있는 **보내기용 3개**를 nfn.co.kr의 DNS(**AWS Route 53**)에 추가한 뒤 **Verify DNS Records**:
   | 이름 | 타입 | 값 |
   |---|---|---|
   | `resend._domainkey` | TXT | `p=MIGf…` (Resend 화면의 복사 버튼으로 그대로) |
   | `rsend` | CNAME | `rsend-apne1.forge.rmta.net` |
   | `send` | CNAME | `send.forge.rmta.net` |
   **주의**: "Enable Receiving"의 `@ MX inbound-smtp…` 레코드는 넣지 마세요. 회사 메일(Naver Works) MX를 덮어씁니다.
   검증되면 `wrangler.toml`의 `MAIL_FROM`을 `now@nfn.co.kr`로 바꾸고 `npx wrangler deploy`.
   Resend 계정(nowfornext@gmail.com 팀)에는 검증된 도메인이 없어서, 검증 전에는 워커가 Resend 테스트 발신(`onboarding@resend.dev`)으로
   **계정 주인 주소(nowfornext@gmail.com)** 에만 보낼 수 있습니다. `99wisdombook.org`는 다른 Resend 계정에 검증돼 있어 이 키로는 못 씁니다.
4. 테스트: 홈 하단 **이메일로 받기** → 주소 입력 → 바로 설정 페이지 → 요일·시간 저장 → 확인 메일 + 첫 편이 즉시 도착.
   안 오면 설정 페이지의 **테스트 메일 다시 보내기**(실패 사유가 화면에 표시됩니다). 이미 받은 편 외에 1편 더 보내려면:
   ```bash
   npx wrangler d1 execute pli-notify-db --remote --command "SELECT id, channel, email, status FROM subscribers"
   curl -X POST "https://notify.projectleadership.cc/cron/run?id=<id>&force=1" -H "Authorization: Bearer <CRON_SECRET>"
   ```

## 7단계 · 관리자 대시보드 (`/admin`)

신청자 목록·발송 기록·접속 기록·설정을 보는 화면입니다. 관리자 1명, ID/PW 하나. 기획: `docs/admin-dashboard-plan.md`.

1. 아이디는 `wrangler.toml`의 `ADMIN_USER`(기본 `admin`). 바꾸려면 값을 고치고 `npx wrangler deploy`.
2. 비밀번호(8자 이상, 영문·숫자·기호)를 정해 **클립보드에 복사**한 뒤, 아래를 Run. 비밀번호는 해시로만 저장되고 화면에 보이지 않습니다.
   ```powershell
   cd C:/Users/User/AI-Consultant-main/notify; ((Get-Clipboard -Raw) -replace '[^\x20-\x7E]','') | node scripts/hash-password.js | npx wrangler secret put ADMIN_PASS_HASH
   ```
3. https://notify.projectleadership.cc/admin/login 에서 로그인. 5회 실패 시 15분 잠금, 세션 12시간.
4. 비밀번호는 이후 **설정 > 관리자 비밀번호**에서 바꿀 수 있습니다(D1에 저장되어 시크릿보다 우선). 잊어버리면 2번을 다시 실행하고
   `npx wrangler d1 execute pli-notify-db --remote --command "DELETE FROM admin_state WHERE key='pass_hash'"`.
5. 선택: 특정 IP에서만 열리게 하려면 `wrangler.toml`의 `ADMIN_ALLOW_IPS`에 IP를 적고 배포. 더 강하게는 Cloudflare Zero Trust Access를 `/admin`에 붙이면 이메일 OTP가 추가됩니다.

데이터: `migrate-002-admin.sql`(적용 완료)로 `access_log`·`cron_runs`·`admin_state`가 추가됐습니다. 접속 기록 90일, 발송 기록 1년 보관 후 매일 04:00(KST) 이후 첫 크론에서 정리(설정에서 변경 가능).

## 8단계 · 운영 점검 (발송이 안 올 때)

1. **관리자 개요**에 빨간 배너(예약 발송이 N분째 실행되지 않음)가 있으면 Cron이 멈춘 것입니다. 2026-09-13 08:20 ~ 09-15 11:43(KST)에
   Cloudflare가 예약 실행을 보내지 않은 적이 있습니다(배포·오류 없음). 대응: `npx wrangler deploy`로 트리거 재등록, 그래도 안 되면
   Cloudflare 대시보드 › Workers › pli-notify › Settings › Triggers 확인. 멈춘 동안에도 사이트 방문(`/health`)이 대체 실행을 돌리고,
   3시간 안에 놓친 발송은 따라잡습니다.
2. **진단**: `curl -H "Authorization: Bearer <CRON_SECRET>" "https://notify.projectleadership.cc/cron/diag?id=<구독자 id>"`
   → 최근 Cron 실행, Resend 메일 도착 상태(`delivered`/`bounced`/`opened`), `?id=`를 주면 그 신청자의 설정과 최근 발송 10건.
3. **메일이 안 온다**: 스팸함 확인 → `/health?deep=1`의 `mail_from_verified`가 `false`면 발신 도메인 미검증(6단계) →
   `/cron/diag`의 Resend 이벤트가 `bounced`면 주소 오류입니다. 관리자 화면의 신청자 상세에서 **테스트 메일**로 바로 재시도할 수 있습니다.
4. **내 알림 설정** `https://notify.projectleadership.cc/me`: 한 번 설정 화면을 연 브라우저는 바로 열리고(쿠키),
   아니면 신청한 주소를 넣으면 그 주소로 설정 링크를 보냅니다.
5. **관리자가 대신 등록**: `/admin` > 신청자 > **+ 신청자 직접 추가**에서 주소·요일·시간·주제를 넣어 등록하고,
   상세 화면의 **알림 설정** 상자에서 언제든 수정할 수 있습니다.

## 자주 나오는 오류

| 증상 | 원인 → 조치 |
|---|---|
| 메일 발송 시 `API key is invalid` | `RESEND_API_KEY` 값이 틀림 → 3단계 재등록 (`/health?deep=1`의 `resend`로 확인) |
| 메일 발송 시 `not verified` | 발신 도메인 미검증 → 6단계. 검증 전에는 `MAIL_FROM_FALLBACK` 또는 Resend 테스트 발신자로 내려갑니다 |
| 설정 페이지가 "링크 만료" | 관리 토큰의 서명 키가 바뀜(`SIGNING_KEY` 재등록) → `/me`에서 링크를 다시 받습니다 |
| 신청자 목록에 `카카오(중단)` 표시 | 채널 제거 전에 가입한 행. 주소를 넣으면 이메일로 전환되고, 두면 발송되지 않습니다 |
| `/admin`이 "관리자 설정이 아직 없어요" | `ADMIN_PASS_HASH` 미등록 → 7단계 |
| `wrangler` 명령이 `Error: Not logged in` | 1단계 다시 |

---

## 이후 운영

- 새 편 발행: 평소처럼 `python scripts/new_volume.py N`만 하면 됩니다. 워커는 `data/volumes.json`을 매번 읽어 자동으로 후보에 넣습니다.
- 구독자 현황: `npx wrangler d1 execute pli-notify-db --remote --command "SELECT status, COUNT(*) FROM subscribers GROUP BY status"`
- 발송 기록: `... --command "SELECT * FROM sends ORDER BY sent_at DESC LIMIT 20"`
- 코드 수정 후 재배포: `npx wrangler deploy` (30초).
