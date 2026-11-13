# DB 및 Vercel 연결 안내

현재 서비스는 본인 구글 계정 전용입니다. 로그인 계정과 기존 일정 연결은 [OWNER_LOGIN_SETUP.md](OWNER_LOGIN_SETUP.md), 캘린더 읽기 권한은 [GOOGLE_CALENDAR_SETUP.md](GOOGLE_CALENDAR_SETUP.md)를 따릅니다.

## DB 구성

Supabase 프로젝트의 SQL Editor에서 적용하지 않은 마이그레이션만 순서대로 실행합니다. 새 DB는 다음 세 파일이 모두 필요합니다.

1. [db/001_initial.sql](db/001_initial.sql): 일정·사용자·세션·요청 제한의 기본 구조
2. [db/002_google_calendar.sql](db/002_google_calendar.sql): 캘린더 연결·일정 캐시와 원자적 갱신
3. [db/003_owner_google_login.sql](db/003_owner_google_login.sql): 본인 구글 신원·로그인 요청·기존 일정 연결

이미 적용한 초기 SQL을 반복하거나 중복 오류를 해결하려고 기존 테이블을 삭제하지 않습니다. 사용자·일정 데이터는 보존합니다. 003은 이전 방식의 로그인 세션을 종료합니다. 과거의 전화번호·비밀번호 컬럼은 기존 계정 확인과 이전용이며 현재 인증에는 사용하지 않습니다.

모든 서비스 테이블은 RLS를 활성화하고 브라우저 역할의 직접 접근을 차단합니다. Vercel 서버만 서버용 키를 사용하며, API에서 본인 계정과 세션의 소유자를 검사합니다. 읽기 전용 권한 점검은 [db/security_check.sql](db/security_check.sql)을 사용할 수 있습니다.

## Vercel 환경 변수

Vercel의 `edu-apply-02` 프로젝트 → Settings → Environment Variables에서 Production 환경을 설정합니다.

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | 해당 프로젝트의 `https://프로젝트ID.supabase.co` 주소 |
| `SUPABASE_SERVICE_ROLE_KEY` | 같은 프로젝트의 서버용 secret 또는 legacy service_role 키 |
| `APP_ORIGIN` | `https://edu-apply-02.vercel.app` |
| `RATE_LIMIT_SECRET` | 32자 이상의 기존 난수 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 웹 OAuth 클라이언트 설정 |
| `OWNER_GOOGLE_EMAIL` | `paran95@gmail.com` |
| `OWNER_NOTEBOOK_USER_ID` | 기존 일정 계정 UUID. 조회 방법은 개인용 로그인 안내 참고 |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | 캘린더 장기 토큰용 32바이트 base64 키 |

Supabase 공개용 publishable/anon 키를 서버용 키 대신 넣지 않습니다. 비밀값은 Git·화면 코드·채팅에 저장하지 않습니다. 값 변경 후 다시 배포해야 반영됩니다. Google Cloud에는 로그인/캘린더 콜백 주소 두 개를 등록합니다.

## 배포

| 항목 | 값 |
|---|---|
| Framework Preset | Other |
| Root Directory | 저장소 루트 |
| Build Command | `node build.cjs` |
| Output Directory | `dist` |
| Node.js | 24.x |

코드와 환경 변수, 추가 SQL이 모두 적용된 뒤 본인 구글 로그인·다른 계정 거부·기존 일정·로그아웃을 확인합니다. `dist`에는 허용된 화면 파일만 복사하고 Vercel이 `api/` 함수를 별도로 배포합니다. 서버 파일·SQL·환경 파일을 정적 경로에 업로드하지 않습니다.

## 검증과 오류

- `npm.cmd test`는 임시 DB/모의 Google로 인증과 일정 기능을 검증합니다. `npm.cmd run build`로 배포 파일을 만듭니다. [LOCAL_TEST.md](LOCAL_TEST.md)도 참고합니다.
- 본인 로그인 후 일정 등록·재조회·수정·삭제·시간 중복·두 기기의 같은 버전 수정 충돌을 확인합니다.
- 로그인 시작은 IP별 15분 30회입니다. 자체 일정 조회는 최대 10,000건, 구글 갱신은 최소 60초 간격입니다.
- 설정/DB 연결 실패는 503, 미로그인은 401, 다른 계정/출처는 403, 일정 중복/버전 충돌은 409, 요청 제한은 429로 처리합니다.
- `DB_FUNCTION_MISSING`, `DB_TABLE_MISSING`, `DB_PERMISSION_DENIED`는 추가 SQL·Data API 반영·서버 역할 권한을 확인합니다. 키나 공급자 원문 오류는 공개하지 않습니다.
- 운영 비용·용량·중지·백업 조건은 사용하는 Supabase/Vercel 플랜에서 확인합니다. 실제 Google 동의 화면·HTTPS 쿠키·휴대폰 브라우저는 배포 환경에서 확인해야 합니다.

## 기존 브라우저 일정

로그인 후 같은 브라우저·주소에 과거 일정이 있으면 가져오기 버튼을 제공합니다. 한 번에 1~500건이며 원본을 유지하고 동일 ID의 중복 복사를 막습니다. 가져온 일정은 이후 온라인 DB에서 수정합니다. 로컬 파일 주소의 브라우저 데이터는 배포 주소에서 자동으로 읽을 수 없습니다.
