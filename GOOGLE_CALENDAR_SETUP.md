# 구글 캘린더 연결 설정

**2026-11-13 변경:** 로그인은 [본인 구글 계정 전용](OWNER_LOGIN_SETUP.md)입니다. 추가 SQL 003까지 적용하고 로그인용 콜백도 등록합니다. 캘린더 연결에서도 `openid email`을 요청하고 로그인 계정과 같은 고유 ID인지 검증합니다. 기존 연결이 있으면 먼저 권한을 해제하고 다시 연결합니다.

최종 갱신: 2026-11-13. **코드 구현과 로컬 모의 Google 테스트가 완료된 단계이며 실제 Google 계정 연동·운영 DB 적용은 별도입니다.** 네이버 연동은 제외합니다. 개인 구글 로그인 전환으로 전화번호 가입과 번호별 로그인 차단은 종료했습니다. 자체 일정 API 요청/저장 제한에 대한 이전 보류 결정은 유지합니다.

## 1. Supabase에 추가 테이블/함수 생성

기존 `001_initial.sql`이 적용된 프로젝트의 SQL Editor에서 미적용한 [db/002_google_calendar.sql](db/002_google_calendar.sql), [db/003_owner_google_login.sql](db/003_owner_google_login.sql)을 순서대로 실행합니다. 기존 계정/일정 데이터는 보존합니다. 새 설치는 001 → 002 → 003 순서입니다.

- `notebook_google_connections`: 사용자당 하나의 구글 연결, 암호화된 refresh token, 선택 캘린더, 갱신 상태
- `notebook_google_states`: 10분 유효·일회용 OAuth state의 해시, 현재 로그인 세션 결속
- `notebook_google_events`: 구글 일정만 저장하는 캐시. 자체 일정의 중복/시간 제약과 분리
- `notebook_google_operation`: 연결·해제·스냅샷 교체를 원자 처리. 서버 역할만 실행 가능

세 테이블 모두 RLS 활성화, public/anon/authenticated 접근 차단. service_role 서버만 접근하며 모든 작업의 소유자는 서버 세션에서 결정합니다. SQL 실행 후 Data API 스키마 반영을 기다립니다. 누락된 함수/권한 오류를 무시하지 마세요.

## 2. Google Cloud에서 OAuth 설정

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 생성하거나 선택합니다.
2. API 및 서비스 → 라이브러리에서 **Google Calendar API**를 활성화합니다.
3. Google Auth Platform에서 Branding(앱 이름, 지원 이메일, 개발자 연락처), Audience(외부 사용자), Data Access를 설정합니다. 처음에는 Testing으로 두고 실제 시험할 Google 계정을 테스트 사용자에 추가합니다.
4. `openid email`로 로그인 신원을 확인하고 아래 두 캘린더 읽기 권한을 추가합니다. 일정 쓰기/삭제 및 Gmail/Drive 권한은 요청하지 않습니다.
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/calendar.events.readonly`
5. Clients → OAuth 클라이언트 생성 → **웹 애플리케이션**을 선택합니다.
6. 승인된 리디렉션 URI에 아래 주소를 **쿼리 문자열까지 그대로** 추가합니다.

```text
https://edu-apply-02.vercel.app/api/google-calendar?action=callback
```

서버 리디렉션 방식이며 JavaScript에서 Google 토큰을 다루지 않습니다. 프리뷰 도메인이나 와일드카드를 등록하지 않습니다. 도메인이 바뀌면 APP_ORIGIN과 리디렉션 URI를 함께 변경해야 합니다.

Testing 외부 앱의 refresh token은 일반적으로 7일 후 만료됩니다. 업무 수첩의 24시간 로그인 세션과 별개입니다. 정식 공개 전 공개 개인정보처리방침·실제 지원 연락처·Google 앱 검증/도메인 소유 확인 요구사항을 준비하고 해당 앱의 검증 또는 예외 요건을 확인해야 합니다. Testing 설정만으로 일반 사용자 대상 운영 완료로 보지 않습니다.

## 3. Vercel 환경 변수 등록

해당 **프로젝트**의 Settings → Environment Variables에 아래 세 개를 서버 환경 변수로 등록합니다. Production에 적용하고, 저장 후 새로 배포합니다. 비밀값은 채팅·GitHub·config.js·브라우저 코드에 넣지 않습니다.

| 이름 | 값 |
|---|---|
| `GOOGLE_CLIENT_ID` | 웹 OAuth 클라이언트 ID |
| `GOOGLE_CLIENT_SECRET` | 해당 클라이언트의 비밀키 |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | 새로 생성한 32바이트 난수의 표준 base64 문자열 |

암호화 키는 본인 터미널에서 아래 명령으로 생성한 뒤 Vercel에 직접 붙여 넣습니다. 실제 출력값을 문서에 저장하지 마세요.

```powershell
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))"
```

기존 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN`, `RATE_LIMIT_SECRET`도 필요합니다. 암호화 키는 DB 밖에 보관합니다. 변경/분실하면 기존 토큰을 복호화할 수 없으므로 Google 계정의 [타사 연결 관리](https://myaccount.google.com/connections)에서 권한을 직접 취소한 뒤 관리자가 연결을 정리하고 새 키로 다시 연결해야 합니다. 운영 중 키를 임의 교체하지 마세요. 암호화는 DB 단독 유출의 영향을 줄이지만 서버 비밀키까지 함께 유출된 경우를 보호하지 않습니다.

세 Google 변수가 없으면 기존 서비스는 계속 동작하고 구글 연결 버튼은 준비 중으로 표시됩니다. 세 값 중 일부만 넣거나 키 형식이 틀리면 설정 오류를 해결한 후 테스트합니다.

## 4. 사용자 흐름

1. 업무 수첩 로그인 → D-day 영역의 **구글 캘린더 연결 설정**.
2. Google 계정 선택·읽기 권한 동의. 로그인한 본인 계정과 동일한 고유 ID인지 서버에서 확인합니다.
3. 돌아온 뒤 연결 설정을 열어 최대 3개 캘린더를 선택하고 각각 업무/개인 분류를 지정합니다.
4. **선택 저장·일정 가져오기**. D-day·PC 주/월간·등록 목록에 `구글 · 읽기 전용` 표시가 나타납니다. 모바일에서 일정표/등록 목록을 숨기는 기존 정책은 유지합니다.
5. 접속 시 마지막 성공 갱신이 5분 이상 지났으면 갱신을 시도합니다. 버튼으로도 갱신할 수 있습니다. 서버 상시 작업·웹훅·자동 쓰기는 없습니다.
6. 연결 해제 시 Google 토큰을 폐기하고 암호문을 삭제합니다. 가져온 일정도 삭제할지 체크박스로 선택합니다. 보관하면 이후 원본 변경은 반영되지 않습니다.

Google 권한 폐기가 실패하면 로컬 동기화부터 중지하고 `권한 해제 재시도 필요`로 표시합니다. 암호문은 재시도를 위해 남겨두고 재연결을 막습니다. 재시도 성공 시 삭제합니다. Google 권한 폐기는 동일 앱에 대한 기존 허가에도 영향을 줄 수 있습니다.

## 범위·저장·개인정보

- 1 사용자 = 1 Google 계정, 캘린더 최대 3개, 조회 구간 현재 시각 기준 과거 31일~미래 93일, 이벤트 인스턴스 합계 최대 1,000개.
- 한 화면의 여러 날 일정 확장 표시도 최대 1,000개입니다. 범위/표시 한계를 화면에서 안내합니다. Google 원본 전체를 백업하는 기능은 아닙니다.
- 종일 일정은 종료 날짜를 포함하지 않습니다. 시간 지정 일정은 사용 기기의 시간대 기준, 자정까지 이어지는 일정은 날짜별로 나누어 표시합니다.
- 반복 일정은 Google의 `singleEvents=true`로 예외/변경을 반영한 인스턴스를 받습니다. 매번 선택 구간 전체를 받아 원자 교체하므로 구간 내 원본 삭제도 반영됩니다. 페이지 일부 실패·시간 초과·한도 초과는 교체하지 않습니다.
- 제목(최대 200자), 날짜/시간, 캘린더 이름·ID, 일정 ID, 업무/개인 분류만 일정 캐시에 저장합니다. 설명·장소·참석자·첨부파일·Google 계정 이메일은 수집하지 않습니다. Google 응답에는 fields 제한을 사용합니다.
- 캘린더 읽기 scope의 권한은 선택한 캘린더보다 넓을 수 있습니다. 사용자가 선택한 캘린더만 API로 조회·저장하도록 서버에서 검증합니다. 신원 확인용 `openid email`로 받은 이메일과 `sub`는 허용 계정에 대조합니다.
- refresh token은 사용자와 OAuth 클라이언트에 결속한 AES-256-GCM 암호문으로 DB에 저장합니다. access token은 해당 요청 메모리에서만 사용합니다. 토큰을 응답·localStorage·로그에 기록하지 않습니다.
- OAuth는 세션에 결속한 일회용 state, 정확한 HTTPS callback, 로그인 세션 재검증을 사용합니다. 다른 계정/세션, 만료, 재사용을 거부합니다. 연결 중 로그아웃하면 처음부터 다시 진행합니다.
- 새 연동의 POST는 Origin/JSON 검증, 16KB 본문 제한, 15분당 사용자별 연결 시작 5회·다른 작업 각 20회, IP별 작업당 60회 제한을 적용합니다. 동기화는 최소 60초 간격이며 진행 중 임대가 90초 유효합니다. Google 요청은 개별 8초/전체 조회 20초 한도로 중단합니다.
- 연결 해제/재연결 시 진행 중이던 이전 동기화가 뒤늦게 캐시를 다시 저장하지 못하도록 임대 토큰과 DB 잠금을 사용합니다.
- 접속·로그아웃 시 브라우저의 외부 일정/선택 UI를 비웁니다. 업무 수첩 로그아웃 자체가 Google 연결 해제를 의미하지 않습니다.

## 로컬 테스트와 운영 확인

```powershell
npm.cmd test
npm.cmd run build
```

기본 `npm.cmd run dev`는 Google 연동도 비활성화하며 운영 Google 자격증명을 자동으로 읽지 않습니다. 테스트는 가상 토큰과 모의 Google 응답, 임시 PGlite DB로 실제 SQL/트랜잭션을 검증합니다. 실서비스나 기존 `.local-db`에 테스트 데이터를 쓰지 않습니다.

실제 Google 계정은 위 설정·배포 후 다음을 직접 확인해야 합니다.

- 본인 구글 계정으로 로그인·다른 구글 계정 거부·권한 거부·취소 후 재시도.
- 캘린더 선택·업무/개인 색상·종일/반복/여러 날/한국 외 시간대 표시.
- Google에서 수정·삭제 후 갱신, 1분 이내 재요청 차단, 실패 시 마지막 데이터 유지.
- PC/모바일 실제 브라우저에서 연결 리디렉션과 화면 조작. 두 업무 수첩 계정 사이 데이터 분리.
- 로그아웃 후 접근 차단, 재로그인 시 연결 유지, 연결 해제·캐시 삭제·Google 타사 연결 관리 확인.
- 운영 DB에서 RLS/역할 권한 및 Vercel 로그의 토큰/인증코드 마스킹 확인. 콜백 코드는 프록시 요청 URL에 나타날 수 있으므로 요청 전체 URL/본문을 별도 로그에 저장하지 않습니다.

## 공식 참고

- [Google 서버 OAuth 및 state 검증](https://developers.google.com/identity/protocols/oauth2/web-server)
- [토큰 보관 권고](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [Calendar 조회 권한](https://developers.google.com/workspace/calendar/api/auth)
- [이벤트 조회/반복 인스턴스](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [테스트 상태 토큰 만료](https://developers.google.com/identity/protocols/oauth2#expiration)
- [사용량/비용](https://developers.google.com/workspace/calendar/api/guides/quota): 표준 사용 추가비용 없음, 초과 한도·과금 정책은 운영 전 재확인. Vercel/Supabase 사용량은 별도입니다.
