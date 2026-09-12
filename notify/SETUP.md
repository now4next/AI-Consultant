# 카카오톡 알림 워커 — 처음 설정 가이드 (화면 단위)

> **진행 상태 (2026-09-12)** — 카카오 앱 `PLI`(ID 1574940, 새 앱·비즈 앱 아님) 콘솔 설정 완료:
> 카카오 로그인 ON · `talk_message` 선택 동의 · Redirect URI 등록 · 클라이언트 시크릿 발급/활성 · 대표 도메인.
> Cloudflare 쪽 완료: D1 `pli-notify-db` + 스키마, 워커 배포(`notify.projectleadership.cc`), 크론, `SIGNING_KEY`·`CRON_SECRET`.
> **남은 것: `KAKAO_REST_API_KEY`·`KAKAO_CLIENT_SECRET` 두 시크릿 등록(3단계)** → `/health`가 `ready:true`가 되면 사이트에 카카오 버튼이 켜집니다.
> 값은 카카오 콘솔 **앱 > 플랫폼 키 > REST API 키**(키 값)와 **더보기 > 수정 > 클라이언트 시크릿 > 카카오 로그인**(코드)에서 복사합니다.

> 계정 권한이 필요한 5단계. 0·1·3단계는 직접 하셔야 하고, **1단계(`wrangler login`)만 끝나면 2·4·5단계는 같은 PC에서 Claude가 대신 실행할 수 있습니다** (wrangler가 로그인 정보를 PC에 저장하므로).

| 단계 | 내용 | 누가 | 걸리는 시간 |
|---|---|---|---|
| 0 | 카카오 디벨로퍼스 앱 설정 | 사용자 | 10분 (A) / 며칠 (B, 심사) |
| 1 | Cloudflare 로그인 (`wrangler login`) | 사용자 | 2분 |
| 2 | D1 데이터베이스 생성 + 스키마 | 사용자 또는 Claude | 2분 |
| 3 | 시크릿 4개 등록 | 사용자 | 5분 |
| 4 | 배포 (`wrangler deploy`) | 사용자 또는 Claude | 2분 |
| 5 | 동작 확인 | 함께 | 5분 |

---

## 0단계 · 카카오 디벨로퍼스 (https://developers.kakao.com)

먼저 어느 앱을 쓸지 정합니다.

### A. 99WisdomBook 앱 재사용 (권장 · 가장 빠름)

이미 일반 사용자에게 '나에게 보내기'가 동작하는 앱입니다. 동의 화면에 이 앱의 이름·아이콘이 뜬다는 점만 감안하세요.

1. **로그인 → 내 애플리케이션 → 99WisdomBook 앱** 클릭
2. **앱 > 일반 > 비즈니스 정보** (구 메뉴: 앱 설정 > 비즈니스) — "개인 개발자 비즈 앱" 또는 "비즈 앱" 표시가 있는지 확인. 있으면 A로 진행, 없으면 B의 전환 신청이 필요합니다.
3. **플랫폼(Web) 도메인 추가** — 앱 > 플랫폼 (구: 앱 설정 > 플랫폼 > Web) → 사이트 도메인에 한 줄 추가:
   ```
   https://notify.projectleadership.cc
   ```
4. **Redirect URI 추가** — 앱 > 플랫폼 키 > REST API 키 > 리다이렉트 URI (구: 제품 설정 > 카카오 로그인 > Redirect URI) → 등록:
   ```
   https://notify.projectleadership.cc/kakao/callback
   ```
   기존 `https://99wisdombook.org/kakao-callback.html`은 그대로 두고 **추가**만 합니다.
5. **동의항목 확인** — 카카오 로그인 > 동의항목 → "카카오톡 메시지 전송(`talk_message`)"이 **선택 동의**로 켜져 있는지 확인. (99Wisdom이 이미 쓰고 있으면 켜져 있습니다.)
5-b. **메시지 링크 도메인** — 앱 > **제품 링크 관리 > 웹 도메인 등록** → `https://projectleadership.cc`, `https://notify.projectleadership.cc` 두 개 등록.
   메시지 템플릿의 `web_url`은 여기 등록된 도메인만 허용됩니다. 등록 전에는 카드가 도착해도 링크가 죽어 있고 PC 카카오톡에 "모바일에서 확인해 주세요"만 뜹니다. (JavaScript SDK 도메인과는 다른 설정입니다.)
6. **키 두 개 복사**
   - **REST API 키**: 앱 > 플랫폼 키 > REST API 키 (구: 앱 설정 > 앱 키) → 32자리 값. → 3단계의 `KAKAO_REST_API_KEY`
   - **Client Secret**: 같은 REST API 키 화면의 "클라이언트 시크릿" (구: 카카오 로그인 > 보안) → 코드가 없으면 **생성**, 상태를 **사용함**으로 → 값 복사. → `KAKAO_CLIENT_SECRET`
   - 두 값 모두 메모장에 잠시 보관(3단계에서 붙여넣기). 채팅에는 붙여넣지 마세요.

### B. 새 앱 + 개인 개발자 비즈 앱 전환 (브랜드를 분리하고 싶을 때)

1. **내 애플리케이션 > 애플리케이션 추가하기** → 앱 이름 `Project Leadership Insight`, 회사명 `NFN`, 카테고리 아무거나 → 저장
2. **내 계정 > 계정 설정**에서 **본인인증** 완료 (개인 개발자 비즈 앱의 전제조건)
3. **앱 > 일반 > 비즈니스 정보 > 개인 개발자 비즈 앱** → 카카오비즈니스 통합 서비스 약관 동의 → 전환 신청. 화면에 "데브톡으로 신청" 안내가 뜨면 데브톡 **[추가 기능 신청]** 게시판에 앱 ID·서비스 설명(무료 뉴스레터 알림, 본인이 설정한 시간에 본인 카카오톡으로 발송)을 적어 글 작성 → 보통 며칠 내 처리
4. 승인 뒤 **카카오 로그인 활성화** → 동의항목에서 `talk_message`를 **선택 동의**로 → 위 A의 3~6단계 동일 (도메인·Redirect URI·키)

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

## 3단계 · 시크릿 4개

값은 입력해도 화면에 보이지 않습니다. 붙여넣고 Enter.

```bash
npx wrangler secret put KAKAO_REST_API_KEY     # 0단계에서 복사한 REST API 키
npx wrangler secret put KAKAO_CLIENT_SECRET    # 0단계 Client Secret
npx wrangler secret put SIGNING_KEY            # 아래에서 생성한 무작위 값
npx wrangler secret put CRON_SECRET            # 아래에서 생성한 무작위 값 (따로 메모 — 5단계 테스트에 씀)
```

무작위 값 만들기 (둘 중 하나):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # PowerShell·Git Bash 모두 가능
openssl rand -hex 32                                                         # Git Bash
```
두 번 실행해 하나는 `SIGNING_KEY`, 하나는 `CRON_SECRET`에 씁니다.

확인: `npx wrangler secret list` → 4개 이름이 보이면 됩니다. (값은 다시 볼 수 없으니 CRON_SECRET만 메모.)

> **붙여넣기가 안 되는 터미널이면** (Claude 앱 내장 터미널은 `Enter a secret value:` 숨김 입력에 Ctrl+V가 `^V` 제어 문자로 들어갑니다):
> 값을 클립보드에 복사한 직후 아래처럼 클립보드를 바로 파이프로 넘깁니다. Windows PowerShell 5.1은 `&&`를 못 쓰니 `;`로 잇습니다.
> ```powershell
> ((Get-Clipboard -Raw) -replace '[^\x20-\x7E]','') | npx wrangler secret put KAKAO_CLIENT_SECRET
> ```
> 확인: `curl "https://notify.projectleadership.cc/health?deep=1"` → `"secret":"ok"` (`mismatch`면 값이 틀린 것).

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

1. **사이트 홈 하단** (https://projectleadership.cc/#subscribe) 새로고침 → 노란 **카카오톡으로 받기** 버튼이 나타나면 사이트↔워커 연결 OK (health 통과 시에만 보입니다).
2. 버튼 클릭 → 카카오 동의 화면에서 **카카오톡 메시지 전송** 항목이 보이고 동의 → 설정 페이지 → 요일·시간 고르고 **알림 시작하기** → 카카오톡 **나와의 채팅**에 "설정이 끝났어요 🦉" 도착.
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
3. **발신 도메인**: Resend > **Domains > Add Domain** → `projectleadership.cc` (Region: Tokyo) → 표시되는 DNS 레코드 3개(MX·SPF TXT·DKIM TXT)를
   Cloudflare 대시보드 > projectleadership.cc > DNS에 **Proxy 끄고(DNS only)** 그대로 추가 → Resend에서 **Verify**. 검증 전까지는
   워커가 자동으로 `noreply@99wisdombook.org`(이미 검증됨)로 보내므로 테스트는 바로 가능합니다.
4. 테스트: 홈 하단 **이메일로 받기** → 주소 입력 → 설정 링크 메일 → 요일·시간 저장 → 환영 메일. 즉시 1편:
   ```bash
   npx wrangler d1 execute pli-notify-db --remote --command "SELECT id, channel, email, status FROM subscribers"
   curl -X POST "https://notify.projectleadership.cc/cron/run?id=<id>&force=1" -H "Authorization: Bearer <CRON_SECRET>"
   ```

## 자주 나오는 오류

| 증상 | 원인 → 조치 |
|---|---|
| 카카오 화면에 `KOE006` | Redirect URI 미등록/오타 → 0-4단계 값 그대로 등록 |
| `KOE101` / `invalid_client` | REST API 키 또는 Client Secret 불일치 → 3단계 값 재등록 |
| 설정 페이지 대신 "권한 필요" | 동의 화면에서 메시지 전송을 거부했거나 `talk_message`가 동의항목에 없음 → 0-5단계 |
| 메시지 발송 시 `insufficient scopes` | 같은 원인. 사용자가 설정에서 "그만 받기" 후 재신청하면 동의 화면이 다시 뜹니다 |
| 발송 시 `-402` 계열 "허용되지 않은 앱" | 앱이 비즈 앱이 아님 → B 경로(개인 개발자 비즈 앱 전환) |
| 사이트에 카카오 버튼이 안 보임 | `/health`가 안 열림 → 4단계 배포·도메인 확인 |
| `wrangler` 명령이 `Error: Not logged in` | 1단계 다시 |

---

## 이후 운영

- 새 편 발행: 평소처럼 `python scripts/new_volume.py N`만 하면 됩니다. 워커는 `data/volumes.json`을 매번 읽어 자동으로 후보에 넣습니다.
- 구독자 현황: `npx wrangler d1 execute pli-notify-db --remote --command "SELECT status, COUNT(*) FROM subscribers GROUP BY status"`
- 발송 기록: `... --command "SELECT * FROM sends ORDER BY sent_at DESC LIMIT 20"`
- 코드 수정 후 재배포: `npx wrangler deploy` (30초).
