-- 001~003 적용 후 실행. 기존 하루 일정과 ID/내용/버전은 보존합니다.
begin;
set local search_path=public,extensions;
alter table public.notebook_schedules add column if not exists end_date date;
update public.notebook_schedules set end_date=schedule_date where end_date is null;
alter table public.notebook_schedules alter column end_date set not null;

-- 이전 SQL/가져오기 자료의 단일 날짜 입력도 동일 날짜 종료로 처리합니다.
create or replace function public.notebook_default_end_date()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.end_date is null then new.end_date:=new.schedule_date; end if;
 return new;
end;
$$;
revoke all on function public.notebook_default_end_date() from public,anon,authenticated;
grant execute on function public.notebook_default_end_date() to service_role;
drop trigger if exists notebook_schedule_end_date on public.notebook_schedules;
create trigger notebook_schedule_end_date before insert or update on public.notebook_schedules
 for each row execute function public.notebook_default_end_date();

alter table public.notebook_schedules drop constraint if exists notebook_schedules_no_overlap;
alter table public.notebook_schedules drop constraint if exists notebook_schedules_check;
alter table public.notebook_schedules drop constraint if exists notebook_schedules_period_valid;
alter table public.notebook_schedules add constraint notebook_schedules_period_valid check (
 end_date between date '0001-01-01' and date '9999-12-31'
 and end_date>=schedule_date
 and (end_date>schedule_date or start_minute<end_minute)
);
-- 첫날 시작부터 마지막 날 종료까지 밤 시간도 포함하는 하나의 구간으로 검사합니다.
alter table public.notebook_schedules add constraint notebook_schedules_no_overlap exclude using gist (
 user_id with =,
 tsrange(schedule_date+start_minute*interval '1 minute',end_date+end_minute*interval '1 minute','[)') with &&
);
commit;
