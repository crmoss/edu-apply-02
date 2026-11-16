# 로컬 테스트 (2026-11-13)

현재 인증은 본인 구글 계정 전용입니다. 전화번호 회원가입·비밀번호 로그인·개발용 로그인 우회 버튼은 제공하지 않습니다.

## 화면 확인

```powershell
cd C:\work\edu-apply-02
npm.cmd ci
npm.cmd run dev
```

브라우저에서 **http://127.0.0.1:3000**을 엽니다. 기본 로컬 서버는 구글 로그인·캘린더를 비활성화하며, 운영 Supabase/Google 비밀값을 자동으로 읽지 않습니다. 로그인 전 화면과 모바일 배치를 확인할 수 있습니다. 실제 본인 구글 로그인은 [운영 설정 안내](OWNER_LOGIN_SETUP.md)를 완료한 HTTPS 배포에서 확인합니다.

로컬 DB는 `.local-db`에 저장하고 초기 SQL 001→002→003→004를 순서대로 적용합니다. 기존 테스트 사용자/일정은 유지하되 이전 인증 세션은 종료합니다. 004는 기존 하루 일정의 종료일을 채우고 연속 일정의 중복 검사를 적용합니다. Ctrl+C로 서버를 중지합니다. `.local-db`는 Git에 포함하지 않습니다. 포트가 사용 중이면 이전에 실행한 본인 테스트 서버를 종료한 뒤 다시 실행합니다.

## 인증·DB 기능 검증

```powershell
npm.cmd test
npm.cmd run build
node scripts/security-review.cjs
```

자동 테스트는 임시 PGlite DB와 모의 Google 응답을 사용합니다. 운영 DB·실제 Google 계정·기존 `.local-db`에 테스트 데이터를 쓰지 않습니다. 테스트용 세션은 테스트 코드가 DB에 직접 준비하며 HTTP 로그인 우회 엔드포인트는 만들지 않습니다.

검증 범위는 Google 신원/nonce/PKCE/브라우저 결속·재사용/만료 차단, 다른 계정과 이전 세션 거부, 기존 일정의 계정 연결 및 보존, 일정 CRUD·중복/버전 검사, 구글 일정 캐시·실패 보존·권한 해제 경합, 로그아웃과 UI 데이터 삭제입니다.

이 테스트는 실제 Google 동의 화면·HTTPS 쿠키·Vercel/Supabase 설정·휴대폰 브라우저 조작 검증을 대신하지 않습니다. 실제 연결 절차는 [OWNER_LOGIN_SETUP.md](OWNER_LOGIN_SETUP.md), 캘린더 기능은 [GOOGLE_CALENDAR_SETUP.md](GOOGLE_CALENDAR_SETUP.md)를 따릅니다.
