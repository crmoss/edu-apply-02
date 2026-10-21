-- Supabase SQL Editor에서 실행할 초기 스키마. 기존 업무 수첩 테이블이 없는 새 프로젝트용.
begin;
create extension if not exists btree_gist with schema extensions;
set local search_path = public, extensions;

create table public.notebook_users (
 id uuid primary key default gen_random_uuid(),
 phone text not null unique check (phone ~ '^010[0-9]{8}$'),
 password_hash text not null check (password_hash ~ '^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$'),
 created_at timestamptz not null default now()
);
create table public.notebook_sessions (
 token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid not null references public.notebook_users(id) on delete cascade,
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index notebook_sessions_expiry on public.notebook_sessions(expires_at);
create index notebook_sessions_user on public.notebook_sessions(user_id);
create table public.notebook_schedules (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.notebook_users(id) on delete cascade,
 category text not null check (category in ('work','personal')),
 schedule_date date not null check (schedule_date between date '0001-01-01' and date '9999-12-31'),
 start_minute integer not null check (start_minute between 420 and 1350 and start_minute % 30 = 0),
 end_minute integer not null check (end_minute between 450 and 1380 and end_minute % 30 = 0),
 content text not null check (char_length(btrim(content)) between 1 and 200),
 version integer not null default 1 check (version > 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (start_minute < end_minute),
 constraint notebook_schedules_no_overlap exclude using gist (
  user_id with =, schedule_date with =, int4range(start_minute,end_minute,'[)') with &&
 )
);
create index notebook_schedules_owner_date on public.notebook_schedules(user_id,schedule_date,start_minute,id);
create table public.notebook_auth_attempts (
 bucket_key text not null,
 window_start timestamptz not null,
 attempts integer not null default 1,
 primary key (bucket_key,window_start)
);

-- 브라우저용 키의 접근을 차단하고 Vercel 서버의 service_role만 사용한다.
alter table public.notebook_users enable row level security;
alter table public.notebook_sessions enable row level security;
alter table public.notebook_schedules enable row level security;
alter table public.notebook_auth_attempts enable row level security;
revoke all on public.notebook_users, public.notebook_sessions, public.notebook_schedules, public.notebook_auth_attempts from anon, authenticated, public;
grant select,insert,update,delete on public.notebook_users, public.notebook_sessions, public.notebook_schedules, public.notebook_auth_attempts to service_role;

create function public.notebook_take_attempt(p_key text,p_limit integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare total integer; bucket timestamptz;
begin
 if p_limit < 1 or p_limit > 100 or p_key !~ '^[a-f0-9]{64}$' then raise exception 'invalid bucket'; end if;
 bucket := to_timestamp(floor(extract(epoch from now())/900)*900);
 delete from public.notebook_auth_attempts where window_start < now()-interval '1 hour';
 delete from public.notebook_sessions where expires_at < now();
 insert into public.notebook_auth_attempts(bucket_key,window_start,attempts) values(p_key,bucket,1)
 on conflict (bucket_key,window_start) do update set attempts=public.notebook_auth_attempts.attempts+1
 returning attempts into total;
 return total <= p_limit;
end;
$$;
revoke all on function public.notebook_take_attempt(text,integer) from public,anon,authenticated;
grant execute on function public.notebook_take_attempt(text,integer) to service_role;
commit;
