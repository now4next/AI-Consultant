# 알림 관리자 대시보드 기획 (pli-notify /admin)

작성 2026-09-12 · 대상: 카카오톡·이메일 알림 신청자 관리 · 상태: 기획 (구현 전)

## 1. 목표와 범위

- 관리자 한 명이 **ID/PW 하나**로 로그인해 알림 신청자 목록·접속 기록·발송 기록을 보고, 필요한 조치(일시정지·해지·테스트 발송)를 한다.
- 별도 서버 없이 **지금의 워커(`notify/`)에 `/admin` 경로를 추가**한다. 같은 도메인(`notify.projectleadership.cc`)이라 D1을 바로 읽고, CORS·배포 추가가 없다.
- 회원 시스템·다중 관리자·권한 등급은 범위 밖. (필요해지면 Cloudflare Access를 앞에 붙이는 것으로 확장)

## 2. 화면 구성

| 경로 | 화면 | 내용 |
|---|---|---|
| `/admin/login` | 로그인 | ID·PW 입력. 5회 실패 시 15분 잠금. |
| `/admin` | 개요 | 카드: 전체 신청자(채널별), 상태별(active/paused/pending/exhausted), 오늘 발송 예정·완료·실패, 마지막 크론 실행 시각. 최근 발송 10건. 최근 30일 일별 발송 막대 그래프(인라인 SVG). |
| `/admin/subscribers` | 신청자 목록 | 표: 채널, 연락처(이메일 전체 / 카카오 회원번호 앞 4자리), 요일·시간·주제·순서, 상태, 받은 편 수, 마지막 발송일, 실패 횟수, 신청일. 필터(채널·상태), 이메일 검색, 정렬, 50건 페이지. **CSV 내보내기**. |
| `/admin/subscribers/:id` | 신청자 상세 | 설정 전체, 받은 편 목록(Vol·제목·일시), 발송·접속 기록. 조치 버튼: 일시정지/재개, 받은 편 기록 지우기, **지금 1편 보내기**(force), 테스트 메일, 해지(확인 창). |
| `/admin/sends` | 발송 기록 | `sends` 표: 일시, 신청자, 채널, 종류(issue/welcome/test/exhausted/link), Vol, 성공/실패, 오류 메시지. 필터(종류·결과·채널·기간), 실패 건 **재시도**. |
| `/admin/access` | 접속 기록 | 신청 흐름의 이벤트 로그: 시각, 이벤트, 신청자, 경로, 국가, 기기(UA 요약). 필터(이벤트·기간). 크론 실행 기록(슬롯, 대상 수, 발송, 실패, 소요 시간)도 여기서. |
| `/admin/settings` | 설정 | 비밀번호 변경(현재 PW 확인), 연동 상태(카카오 키·시크릿, Resend 키·발신 도메인 검증 = `/health?deep=1` 결과), 로그 보존 기간. |

디자인은 설정 페이지와 같은 언어(Gowun Batang·Inter Tight, 다크 모드 자동)로 서버 렌더링 HTML. 표는 모바일에서 가로 스크롤. 프레임워크 없음.

## 3. 인증·보안

- **자격 증명**: `ADMIN_USER`(변수) + `ADMIN_PASS_HASH`(시크릿). 비밀번호는 PBKDF2-SHA256(10만 회, 무작위 salt) 해시로만 저장. 해시 생성 명령을 제공하고, 등록은 지금까지처럼 클립보드 파이프로 사용자가 직접 한다.
- **세션**: 로그인 성공 시 HMAC 서명 쿠키(`SIGNING_KEY` 재사용, 만료 12시간) · `HttpOnly; Secure; SameSite=Strict; Path=/admin`. 로그아웃은 쿠키 삭제.
- **무차별 대입 방지**: `admin_state` 테이블에 실패 횟수·잠금 시각. 5회 실패 → 15분 잠금. 로그인 시도는 접속 기록에 남김(성공/실패, 국가).
- **CSRF**: 모든 관리자 POST에 서명 토큰(폼 hidden) 검사.
- **노출 최소화**: `/admin*`은 사이트 어디에도 링크하지 않음. `robots` 차단 헤더. 선택 사항으로 `ADMIN_ALLOW_IPS` 변수(비우면 전체 허용).
- **한 단계 더 (선택)**: Cloudflare Zero Trust **Access**를 `/admin` 앞에 붙이면 이메일 OTP 2단계가 코드 없이 추가된다(50명까지 무료). 1차는 ID/PW로 가고, 운영 중 필요하면 켠다.
- 비밀번호·토큰은 절대 로그에 남기지 않음.

## 4. 데이터 변경 (D1)

```sql
-- 접속·행동 기록 (신청 흐름 + 관리자 행동)
CREATE TABLE access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  event TEXT NOT NULL,          -- kakao_start, kakao_callback, email_start, settings_view, settings_save,
                                -- pause, resume, reset, unsubscribe, test, admin_login_ok, admin_login_fail, admin_action
  subscriber_id TEXT,
  path TEXT,
  ip_hash TEXT,                 -- SHA-256(ip + SIGNING_KEY) 앞 16자 · 원본 IP는 저장하지 않음
  country TEXT,                 -- request.cf.country
  ua TEXT,                      -- 120자로 자름
  meta TEXT                     -- JSON (예: 관리자 행동 대상·결과)
);
CREATE INDEX idx_access_ts ON access_log(ts);

-- 크론 실행 기록
CREATE TABLE cron_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  slot TEXT, due INTEGER, sent INTEGER, exhausted INTEGER, errors INTEGER, duration_ms INTEGER
);

-- 관리자 상태 (잠금 카운터 등)
CREATE TABLE admin_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')));
```

- `subscribers`·`sends`는 그대로. `sends`에 `channel` 컬럼을 추가하면 조인이 줄어든다(선택).
- **보존**: 접속 기록·크론 기록 90일, 발송 기록 1년. 매일 04:00 KST 크론 틱에서 정리.

## 5. 기존 흐름에 넣을 기록 지점

`index.js`의 각 라우트 끝에 `track(env, request, event, subscriber_id)` 한 줄씩:
`/kakao/start`, `/kakao/callback`, `/email/start`, `/settings` GET·POST, `/pause`, `/resume`, `/reset`, `/unsubscribe`, `/test`. `tick()`은 끝에서 `cron_runs`에 한 줄.
`ctx.waitUntil`로 기록해 응답 지연 없음.

## 6. 개인정보 원칙

- 관리자 화면은 개인정보(이메일) 열람 화면이므로 **관리자 행동도 모두 기록**한다(누가·언제·무엇을).
- IP는 해시만, 카카오 회원번호는 앞 4자리만 표시(상세에서만 전체).
- 해지한 신청자는 기존대로 즉시 삭제되며, 그 사람의 발송·접속 기록도 함께 지운다.
- 개인정보 처리방침 문구에 "신청·발송 기록을 서비스 운영 목적으로 최대 1년 보관" 추가.

## 7. 구현 단계

| 단계 | 내용 | 산출물 | 예상 |
|---|---|---|---|
| 1 | 로그인·세션·CSRF, 개요, 신청자 목록(읽기), 발송 기록(읽기), `access_log`·`cron_runs` 테이블과 기록 지점 | `notify/src/admin.js`(신규), `index.js` 라우트 연결, `migrate-002-admin.sql` | 반나절 |
| 2 | 신청자 상세·조치(일시정지/재개/기록 지우기/지금 보내기/테스트/해지), 실패 재시도, CSV 내보내기, 로그 정리 크론 | 같은 파일 | 반나절 |
| 3 | 30일 그래프, 설정 화면(비밀번호 변경·연동 상태), 선택: Cloudflare Access | 같은 파일 + `SETUP.md` 7단계 | 2–3시간 |

사용자가 할 일은 시크릿 두 개 등록뿐:
```powershell
# 해시 만들기 (비밀번호는 클립보드에 복사해 둔 상태에서)
cd C:/Users/User/AI-Consultant-main/notify; node scripts/hash-password.js   # 클립보드 → 해시 출력·클립보드 복사
((Get-Clipboard -Raw) -replace '[^\x20-\x7E]','') | npx wrangler secret put ADMIN_PASS_HASH
```
`ADMIN_USER`는 `wrangler.toml` 변수.

## 8. 기본값으로 정한 것 (바꾸려면 알려 주세요)

- 세션 12시간 · 잠금 5회/15분 · 접속 기록 90일 · 발송 기록 1년
- 이메일은 관리자에게 전체 표시, IP는 해시만
- 관리자 1명, ID/PW만(2단계 인증 없음). 필요 시 Cloudflare Access 추가
- 경로 `/admin` (원하면 임의 문자열 경로로 변경 가능)
