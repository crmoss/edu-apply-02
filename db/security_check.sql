-- 읽기 전용 보안 설정 확인. Supabase SQL Editor에서 실행하며 계정·일정 내용은 조회하지 않는다.
-- 실제 권한이 초기 스키마와 같은지 운영자가 확인할 때 사용한다.

select tablename, rowsecurity
from pg_tables
where schemaname='public'
  and tablename in ('notebook_users','notebook_sessions','notebook_schedules','notebook_auth_attempts')
order by tablename;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public'
  and table_name in ('notebook_users','notebook_sessions','notebook_schedules','notebook_auth_attempts')
order by table_name, grantee, privilege_type;

select p.proname, p.prosecdef as security_definer, p.proconfig,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='notebook_take_attempt';
