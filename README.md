# 온라인 업무 수첩

본인 구글 계정(paran95@gmail.com)으로만 로그인하는 개인 업무 수첩입니다. 기존 휴대폰 번호·비밀번호 로그인과 회원가입은 종료했습니다. 기존 일정은 본인 계정 ID를 지정해 그대로 유지합니다.

배포 주소: https://edu-apply-02.vercel.app/

**온라인 기능은 DB 테이블·Vercel 환경 변수 설정이 필요합니다.** [DB_SETUP.md](DB_SETUP.md)의 설정을 완료하고 새 코드를 배포한 뒤 연결을 확인하세요. 화면을 더블클릭하는 방식으로는 서버 API를 사용할 수 없습니다.

## 주요 기능

- 로그인·로그아웃: 허용된 본인 구글 계정만 통과하며 고유 ID를 고정합니다. 서버 쿠키 세션은 24시간 유지됩니다. [개인용 로그인 설정](OWNER_LOGIN_SETUP.md)을 먼저 완료하세요.
- 일정: 업무·개인 분류, 주간·월간 보기, 기간·분류 필터, 등록·변경·삭제
- D-day: 오늘부터 7일 후까지 전체 분류의 일정을 표시합니다. 업무는 초록색, 개인은 금색입니다.
- 시간 규칙: 07:00~23:00, 30분 단위. 같은 사용자의 같은 날짜에 겹치는 시간은 DB에서도 거부합니다.
- 기존 브라우저 일정: 로그인 후 가져오기 버튼을 눌러 현재 계정에 복사합니다. 원본은 삭제하지 않습니다.
- 구글 캘린더: 별도 설정 후 읽기 전용 연결·캘린더 선택·D-day/PC 일정표 표시·연결 해제를 제공합니다. 종일·반복 일정을 지원하며 네이버 연동은 보류합니다. **실제 연결 전 [구글 설정 안내](GOOGLE_CALENDAR_SETUP.md)를 완료해야 합니다.**

로그인 전에는 일정 저장이 비활성화됩니다. DB 오류 시 브라우저 저장으로 대체하지 않고 오류를 알립니다. 다른 기기의 변경사항은 **DB 일정 다시 조회** 또는 새로고침으로 반영합니다. 사용자별 비공개 수첩이며 팀 공유 기능은 없습니다.

## 구성

```text
브라우저 → 같은 도메인의 Vercel Functions → Supabase PostgreSQL
```

| 파일 | 역할 |
| --- | --- |
| index.html / style.css | 메인 화면·구글 로그인 창·반응형 스타일 |
| logic.js | 날짜·시간·D-day·기존 데이터 검증 |
| app.js | 온라인 일정 조회·등록·변경·삭제 |
| auth.js / client-api.js | 구글 로그인·로그아웃·기존 일정 가져오기 / API 호출 |
| api/notebook.js | 인증·소유자 검사·일정 API |
| api/google-login.js / server/owner-auth.cjs | 개인 전용 Google OIDC 로그인·공식 ID 토큰 검증·세션 |
| api/google-calendar.js / google-calendar-client.js | 구글 OAuth·암호화·소유자·갱신 제한 / 연결 화면·외부 일정 표시 |
| server/core.cjs / database.cjs | 일정 입력 검증·세션 해시 / 서버 전용 DB 연결 |
| db/001_initial.sql | 사용자·세션·일정·요청 제한 테이블과 권한 |
| db/002_google_calendar.sql | 구글 연결·외부 일정·일회용 인증 요청 및 원자적 갱신 함수 |
| db/003_owner_google_login.sql / OWNER_LOGIN_SETUP.md | 기존 일정 보존·개인 구글 계정 고정 / 전환 설정 |
| GOOGLE_CALENDAR_SETUP.md | Google Cloud·Supabase·Vercel 추가 설정 및 운영 검증 |
| .env.example | Vercel 환경 변수 이름과 예시, 실제 키 없음 |
| vercel.json / build.cjs | Vercel 설정 / 공개할 화면 파일만 dist로 복사 |
| tests/rules.js | 업무 규칙 25개 검증 |
| smoke-test.cjs | 모의 DOM·API로 비동기 화면 흐름 검증 |
| tests/ | 서버·실행 SQL 검증 |
| DB_SETUP.md | DB 생성, Vercel 연결·검증 절차 |
| PRD.md / OWNER_LOGIN_SETUP.md | 현재 요구사항 / 개인용 인증 설정 |

## 검증

로컬 화면은 **`npm.cmd run dev`** 후 **http://127.0.0.1:3000**에서 확인합니다. 운영과 분리된 로컬 DB를 자동 생성합니다. 기본 로컬 서버에서는 구글 인증이 비활성화되며, 전화번호/개발용 로그인 우회는 제공하지 않습니다. 인증·CRUD 전체 흐름은 임시 DB 자동 테스트로 확인합니다. [LOCAL_TEST.md](LOCAL_TEST.md)를 참고하세요.

Node.js 24 사용을 권장합니다. Google ID 토큰 검증에 공식 google-auth-library를 사용하며 SQL 검증에는 개발용 PGlite를 사용합니다.

```powershell
npm ci
npm test
npm run build
```

`dist/`에는 화면 파일만 배포하고, 서버 코드·SQL·문서·환경 파일은 정적 공개하지 않습니다. Vercel은 `api/` 함수를 별도로 배포합니다. 빌드 설정은 [DB_SETUP.md](DB_SETUP.md)를 참고하세요.

모의 API 테스트와 로컬 SQL 검증은 실제 Supabase REST 연결·Vercel 보안 쿠키·모바일 화면 검증을 대체하지 않습니다. 설정 후 본인 구글 로그인·다른 계정 거부·기존 일정 보존·두 기기 동시 수정·가져오기·로그아웃을 실제 HTTPS 주소에서 확인합니다.

## 계정 운영 범위

보안 점검 결과와 개선 우선순위는 [SECURITY_REVIEW_2026-10-22.md](SECURITY_REVIEW_2026-10-22.md)에 정리했습니다. 읽기 전용 운영 DB 권한 점검은 [db/security_check.sql](db/security_check.sql), 운영 자료를 사용하지 않는 재현은 `node scripts/security-review.cjs`로 실행합니다.

구글 계정 접근 복구는 Google 계정 복구 절차를 사용합니다. 계정 변경은 고정한 구글 고유 ID와 기존 일정 소유자 연결을 함께 검토해야 합니다. 로그인 시작 요청은 IP별로 제한하며, 전화번호별 로그인 잠금은 사용하지 않습니다. 초기 SQL과 기존 데이터의 호환 컬럼은 일정 이전을 위해 유지합니다.
