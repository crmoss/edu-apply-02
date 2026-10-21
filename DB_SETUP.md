# 무료 DB 생성 및 Vercel 연결 안내

## 현재 상태

휴대폰 번호·비밀번호 가입, 로그인·로그아웃, 사용자별 일정 DB 저장 코드와 SQL을 제공합니다. 운영자가 Supabase 프로젝트와 테이블 생성을 진행한 상태입니다. 아래 환경 변수 설정을 완료하고 새 코드를 배포한 후 실제 연결을 확인해야 합니다. 이미 생성한 테이블에 초기 SQL을 다시 실행하지 마세요.

Supabase·Vercel 연동 기능을 설치하고 계정을 연결하면 설정을 함께 진행할 수 있습니다. 직접 설정할 경우 아래 순서로 진행하세요. 비밀번호·service_role 키를 채팅·GitHub·화면 코드에 붙여 넣지 마세요.

## 1. Supabase 무료 프로젝트 만들기

1. [Supabase](https://supabase.com/dashboard)에 로그인하고 무료 조직/플랜에서 새 프로젝트를 만듭니다.
2. 이름은 `online-work-notebook` 등으로 지정하고 서비스에 적합한 가까운 지역을 선택합니다.
3. DB 관리자 비밀번호를 안전하게 보관합니다. 이 비밀번호는 사용자가 가입할 때 입력하는 비밀번호와 다릅니다.
4. 유료 플랜·추가 기능은 선택하지 않습니다. 무료 플랜은 사용량 제한과 비활동 중지 조건이 있으므로 항상 운영되는 서비스를 보장하지 않습니다. [공식 가격·무료 조건](https://supabase.com/pricing)

이 구현은 Supabase Auth의 휴대폰 인증을 사용하지 않습니다. Phone Provider·Twilio·문자 발송 계정 설정은 필요 없습니다. 자체 사용자 테이블과 서버의 비밀번호 해시 검증을 사용합니다.

## 2. 테이블과 권한 생성

1. 새 프로젝트의 **SQL Editor**를 엽니다.
2. 저장소의 [db/001_initial.sql](db/001_initial.sql)을 복사해 실행합니다. 새 DB에서 1회 실행하는 마이그레이션입니다. 재실행은 테이블 중복 오류가 나므로 기존 테이블을 삭제해서 해결하지 마세요.
3. 다음 4개 테이블과 `notebook_take_attempt` 함수가 생성됐는지 확인합니다.

| 테이블 | 저장 데이터 |
| --- | --- |
| notebook_users | UUID, 정규화한 국내 번호, 비밀번호 해시, 생성 시각 |
| notebook_sessions | 세션 토큰의 SHA-256 해시, 사용자 ID, 만료 시각 |
| notebook_schedules | 일정 UUID, 소유자 ID, 분류, 날짜, 시작·종료 분, 내용, 버전, 생성·수정 시각 |
| notebook_auth_attempts | 번호/IP의 HMAC 값, 15분 구간, 인증 요청 횟수 |

모든 테이블에 RLS를 켜고 `anon`, `authenticated`, `public` 역할의 접근을 차단합니다. 실제 쿼리는 Vercel 서버의 `service_role`로 수행하므로 API의 사용자별 필터가 필수입니다. 일반 브라우저에서 DB로 직접 접근하는 구조가 아닙니다. 서비스 키가 유출되면 이 차단을 우회할 수 있으므로 반드시 서버에서만 보관합니다. [Supabase 접근 권한 안내](https://supabase.com/docs/guides/api/securing-your-api)

## 3. Vercel 환경 변수 등록

Supabase 프로젝트의 API 설정에서 Project URL과 **서버 전용 legacy service_role 키**를 확인합니다. 현재 코드는 이 JWT 키를 apikey/Authorization에 사용합니다. publishable/anon 키로 대체하지 않습니다.

Vercel → `edu-apply-02` → Settings → Environment Variables에 다음 값을 등록합니다.

| 이름 | 값 |
| --- | --- |
| SUPABASE_URL | `https://프로젝트ID.supabase.co` |
| SUPABASE_SERVICE_ROLE_KEY | 서버 전용 service_role JWT 키 |
| APP_ORIGIN | `https://edu-apply-02.vercel.app` |
| RATE_LIMIT_SECRET | 직접 생성한 32자 이상의 긴 난수 |

난수는 다음 명령으로 생성해 Vercel에만 저장할 수 있습니다. 예제 파일의 안내 문구를 그대로 사용하지 마세요.

```powershell
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
```

Production 환경에 우선 등록합니다. Preview를 테스트할 때는 별도의 검증용 DB·환경 변수를 권장하며 `APP_ORIGIN`을 해당 Preview의 정확한 HTTPS origin으로 설정합니다. Production 주소만 설정한 상태에서는 다른 Preview 주소의 변경 요청이 거부됩니다. 새 도메인 사용 시에도 값을 변경해야 합니다.

## 4. GitHub 업로드 및 Vercel 배포

DB·환경 변수 설정 후 코드 변경을 검토하고 커밋·푸시합니다. 이번 버전은 API를 사용하므로 기존 정적 배포 설정에서 아래 값을 확인합니다.

| 항목 | 값 |
| --- | --- |
| Framework Preset | Other |
| Root Directory | 저장소 루트 |
| Build Command | `node build.cjs` |
| Output Directory | `dist` |
| Node.js | 24.x |

`vercel.json`에도 빌드 명령·출력 폴더를 선언했습니다. 기존 Dashboard Override가 있다면 충돌하지 않게 맞추고 다시 배포합니다. API의 `server/` 모듈도 함께 번들되므로 정적 파일만 수동 업로드하지 마세요. [Vercel Node.js Functions](https://vercel.com/docs/functions/runtimes/node-js)

## 5. 실제 연결 점검

1. HTTPS 서비스에서 로그인 전 등록 버튼이 비활성화되고, 기존 로컬 일정이 계정 일정처럼 표시되지 않는지 확인합니다.
2. 소유한 번호와 새 비밀번호로 가입합니다. 비밀번호는 12~128자입니다. 임의의 다른 사람 번호를 사용하지 마세요.
3. Supabase Table Editor에서 `notebook_users`에 행이 생겼는지 확인합니다. 비밀번호 원문 대신 `scrypt$...` 값이어야 합니다. 세션에도 원본 토큰이 아닌 해시가 저장됩니다.
4. 일정을 등록하고 `notebook_schedules`의 `user_id`가 해당 계정 UUID인지 확인합니다.
5. 로그아웃한 후 다른 계정으로 로그인했을 때 앞 계정의 일정이 보이지 않아야 합니다.
6. 같은 계정으로 두 기기에서 로그인하고 일정 조회·변경을 확인합니다. 같은 버전의 동시 수정은 한 번만 성공해야 합니다.
7. 겹치는 시간의 등록은 거부되고, 종료 시각과 다음 시작이 같은 일정은 허용돼야 합니다.
8. 로그아웃 후 세션이 폐기되고 화면이 비워지는지 확인합니다.

## 6. 기존 브라우저 일정 가져오기

이전과 같은 브라우저·주소에서 로그인하면 원래 키 `online-work-notebook.standalone.v1`의 일정을 감지합니다. 건수를 확인하고 **기존 브라우저 일정을 내 계정으로 가져오기**를 누르면 현재 로그인 계정의 DB로 복사합니다. 다른 사람 계정에 옮기지 않도록 상단 번호를 확인하세요.

- 한 번에 1~500건, 오류·시간 중복이면 전체 요청이 실패합니다.
- 가져온 일정의 DB ID는 사용자 UUID와 기존 ID에서 결정적으로 생성해 재시도 시 중복 생성을 막습니다.
- 같은 ID를 재실행하면 이미 가져온 DB 내용을 덮어쓰지 않습니다. 이후 변경은 온라인 일정에서 수정합니다.
- 가져오기는 복사이며 브라우저 원본을 삭제하지 않습니다. 완료 후 건수와 내용을 대조하세요.
- 로컬 파일 주소의 일정은 Vercel 주소에서 읽을 수 없습니다. 이 버전에는 파일 내보내기·업로드 UI가 없으므로 그 경우 별도 이전 작업이 필요합니다.

## 7. 운영 제한과 오류 확인

- 문자 인증·비밀번호 복구·번호 변경·탈퇴 UI·공유 캘린더·실시간 동기화는 아직 없습니다.
- 조회는 사용자당 최대 10,000건까지 페이지 단위로 가져옵니다. 초과 시 조용히 누락하지 않고 오류를 표시합니다.
- 인증 시도는 IP당 30회·번호당 10회/15분 구간으로 제한합니다. signup/login은 각자 별도 구간입니다. 제한 설정·보안·무료 용량을 운영 중 점검하세요.
- 환경 변수가 없으면 503 오류, 다른 도메인의 변경 요청은 403, 로그인 미완료·만료는 401, 중복 시간·버전 충돌은 409입니다.
- 무료 DB 사용량 한도를 넘거나 중지되면 서비스를 사용할 수 없습니다. 유료 전환은 자동으로 진행하지 않습니다.
- 비밀번호 복구는 타인이 쉽게 계정을 탈취하는 번호 입력만의 초기화로 구현하지 않았습니다. 운영자는 복구·탈퇴 요청 처리와 개인정보 보관·삭제 안내를 공개 운영 전에 확정해야 합니다.
- DB 복구·백업은 별도 운영 절차가 필요합니다. 무료 플랜에 유료 플랜의 백업 보장을 가정하지 마세요.

연결 전 테스트 결과는 모의 HTTP API·화면 및 로컬 PostgreSQL 실행 환경 기준입니다. 실제 Supabase 권한·REST API와 Vercel 쿠키 동작은 위 순서로 최종 확인해야 합니다.
