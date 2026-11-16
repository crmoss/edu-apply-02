# 본인 구글 계정 전용 로그인 설정

2026-11-13 기준. 허용 계정은 사용자가 확인한 **paran95@gmail.com**입니다. 전화번호·비밀번호 로그인과 신규 가입은 서버와 화면에서 종료했습니다. 이 문서는 현재 인증 방식의 기준입니다.

## 기존 일정 연결

Supabase SQL Editor에서 다음 **조회 전용 SQL**로 기존 계정 ID를 확인합니다.

```sql
select u.id as user_id, u.phone, u.created_at, count(s.id) as schedule_count
from public.notebook_users u
left join public.notebook_schedules s on s.user_id=u.id
group by u.id,u.phone,u.created_at
order by u.created_at;
```

본인이 사용하던 휴대폰 번호의 행에서 `user_id`를 복사하여 Vercel 프로젝트 환경 변수 **OWNER_NOTEBOOK_USER_ID**에 등록합니다. 다른 테스트 계정의 ID를 고르지 마세요. ID 자체는 비밀번호가 아니며 서버 설정으로만 사용합니다.

기존 계정이 있으면 이 값을 지정하기 전에는 첫 구글 로그인을 완료하지 않습니다. 계정이 하나뿐이어도 자동으로 소유자를 추측하지 않습니다. 기존 일정의 `user_id`를 바꾸거나 다른 계정의 데이터를 합치지 않고, 지정한 기존 계정에 구글 신원을 연결합니다. 완전히 새 DB이며 기존 계정이 없을 때만 개인 계정을 자동 생성합니다.

## Google Cloud와 Vercel

기존 웹 OAuth 클라이언트를 그대로 사용할 수 있습니다. 승인된 리디렉션 URI에 아래 두 주소를 추가합니다. 쿼리 문자열까지 정확히 일치해야 합니다.

```text
https://edu-apply-02.vercel.app/api/google-login?action=callback
https://edu-apply-02.vercel.app/api/google-calendar?action=callback
```

- 로그인: `openid email`만 요청합니다. 로그인만 해도 캘린더 읽기 권한을 받는 것은 아닙니다.
- 캘린더 연결: 로그인 후 별도로 `openid email`과 `calendar.calendarlist.readonly`, `calendar.events.readonly` 권한을 요청합니다. ID 토큰의 계정 고유 ID가 로그인 계정과 같아야 연결됩니다.
- 테스트 상태라면 Google Auth Platform의 테스트 사용자에 `paran95@gmail.com`을 추가합니다. Testing 상태의 캘린더 장기 연결 토큰 만료 조건은 [구글 설정 안내](GOOGLE_CALENDAR_SETUP.md)를 참고합니다.

Vercel 프로젝트 → Settings → Environment Variables:

| 변수 | 설정 |
|---|---|
| `GOOGLE_CLIENT_ID` | 해당 웹 OAuth 클라이언트 ID |
| `GOOGLE_CLIENT_SECRET` | 해당 클라이언트 비밀키 |
| `OWNER_GOOGLE_EMAIL` | `paran95@gmail.com` (생략해도 코드의 허용 계정 기본값은 동일) |
| `OWNER_NOTEBOOK_USER_ID` | 위에서 확인한 기존 계정 UUID. 기존 계정이 없을 때만 생략 가능 |
| `APP_ORIGIN` | `https://edu-apply-02.vercel.app` |
| `RATE_LIMIT_SECRET` | 기존 32자 이상 난수 유지 |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | 캘린더 연결 시 필요한 기존 32바이트 base64 암호화 키 |

기존 Supabase URL/서버용 키도 유지합니다. 비밀값을 Git·브라우저 파일·채팅에 올리지 않습니다. 로그인에는 캘린더 암호화 키가 필요 없으므로 캘린더 설정을 나중에 해도 로그인부터 사용할 수 있습니다.

## DB와 배포

새 설치는 `db/001_initial.sql` → `db/002_google_calendar.sql` → **[db/003_owner_google_login.sql](db/003_owner_google_login.sql)** → [db/004_continuous_schedules.sql](db/004_continuous_schedules.sql) 순서입니다. 004는 연속 일정용 종료일과 중복 검사 설정입니다. 기존 설치는 이미 실행한 초기 SQL을 반복하지 말고 적용하지 않은 추가 SQL만 실행합니다.

003은 기존 사용자/일정을 보존하고, 기존 전화번호 방식의 세션과 진행 중 캘린더 인증 요청을 종료합니다. 기존 구글 연결 토큰이 있으면 권한 해제 대기 상태로 바꾸어 재검증 없이 사용하지 못하게 합니다. 본인 구글 로그인 후 연결 설정에서 기존 권한을 해제하고 다시 연결합니다.

환경 변수를 등록하고 새 코드를 배포한 뒤 추가 SQL을 적용해 구글 로그인을 확인합니다. 배포와 DB 적용 사이에는 일시적으로 로그인이 되지 않을 수 있습니다. 로그인 설정 후 기존 일정이 보이는지 확인하세요. 이 작업은 DB 소유자의 설정이 필요하며 로컬 파일 수정만으로 운영 DB나 Vercel 설정이 바뀌지는 않습니다.

## 보안 동작

- 서버는 공식 `google-auth-library`로 ID 토큰의 서명·발급자·클라이언트·만료를 검증한 뒤 이메일 검증 여부와 nonce를 확인합니다.
- 처음에는 승인된 이메일만 통과합니다. 첫 성공 시 해당 계정의 고유 `sub`를 DB에 고정하며 이후 동일 이메일이라도 다른 `sub`는 거부합니다. 환경 변수의 이메일만 바꿔 다른 계정으로 넘겨받을 수 없습니다.
- 로그인 요청은 브라우저 전용 HttpOnly 쿠키, 10분 유효·일회용 DB state, nonce, PKCE(S256)에 결속합니다. 인증코드·ID 토큰·구글 로그인 access token을 브라우저 저장소나 DB에 보관하지 않습니다. PKCE verifier는 짧게 유효한 서버 전용 인증 요청 테이블에만 저장합니다.
- 성공 시 새 32바이트 난수로 24시간 세션을 만들고 DB에는 해시만 저장합니다. 운영 쿠키는 Secure·HttpOnly·SameSite=Lax이며 활동에 따라 자동 연장하지 않습니다.
- 모든 일정/캘린더 API는 세션의 구글 신원과 고정된 본인 계정 ID를 확인합니다. 기존 전화번호 세션은 유효 기간이 남아도 거부합니다.
- 전화번호별 실패 횟수를 누적하지 않습니다. 로그인 시작 요청 제한은 접속 IP별 15분에 30회입니다. 다른 IP에서 전화번호를 반복 입력해 본인 계정 전체를 잠글 수 없습니다. 같은 공용 IP의 요청 제한은 별개로 적용될 수 있습니다.
- 로그아웃 시 세션과 진행 중 로그인 요청을 취소합니다. 로그인 자체는 구글 캘린더 토큰을 폐기하지 않습니다. 캘린더 연결 해제 시에만 별도로 폐기합니다.

## 검증

`npm.cmd test`와 `npm.cmd run build`로 로컬 테스트/빌드를 확인합니다. 기본 로컬 서버에는 전화번호 로그인이나 테스트 로그인 우회 버튼이 없습니다. 테스트는 임시 DB의 인증 픽스처와 모의 Google 응답을 사용하며 운영 Google 계정·운영 DB에 접근하지 않습니다.

실제 배포 후 본인 구글 계정으로 로그인, 다른 계정 거부, 기존 일정 보존, 로그아웃·재로그인, 캘린더 별도 동의·같은 구글 계정 확인을 진행해야 합니다. Google 계정의 2단계 인증도 사용하세요.

공식 참고: [Google ID 토큰 검증](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [OpenID Connect와 계정 고유 ID](https://developers.google.com/identity/openid-connect/openid-connect).
