-- 개인 구글 로그인 설정 도우미. 기존 001이 적용된 DB에서 이 파일 전체를 한 번 실행합니다.
-- 002와 003을 합친 파일이며 기존 사용자와 일정은 보존하고 이전 로그인 세션은 종료합니다.
begin;
-- Source: 002_google_calendar.sql
-- 기존 001_initial.sql 실행 후 적용. 기존 일정/계정 데이터는 변경하지 않습니다.

create table if not exists public.notebook_google_connections (
 user_id uuid primary key references public.notebook_users(id) on delete cascade,
 status text not null default 'disconnected' check(status in ('connected','disconnected','reconnect','revocation_pending')),
 refresh_ciphertext text,
 revision uuid not null default gen_random_uuid(),
 selected jsonb not null default '[]' check(jsonb_typeof(selected)='array' and jsonb_array_length(selected)<=3),
 last_synced timestamptz, last_attempt timestamptz, lease uuid,
 range_start timestamptz, range_end timestamptz
);
create table if not exists public.notebook_google_states (
 state_hash text primary key check(state_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid not null references public.notebook_google_connections(user_id) on delete cascade,
 session_hash text not null references public.notebook_sessions(token_hash) on delete cascade,
 expires_at timestamptz not null, claimed boolean not null default false
);
create index if not exists notebook_google_states_expiry on public.notebook_google_states(expires_at);
create table if not exists public.notebook_google_events (
 user_id uuid not null references public.notebook_google_connections(user_id) on delete cascade,
 calendar_id text not null, event_id text not null, payload jsonb not null,
 primary key(user_id,calendar_id,event_id)
);
alter table public.notebook_google_connections enable row level security;
alter table public.notebook_google_states enable row level security;
alter table public.notebook_google_events enable row level security;
revoke all on public.notebook_google_connections,public.notebook_google_states,public.notebook_google_events from public,anon,authenticated;
grant select,insert,update,delete on public.notebook_google_connections,public.notebook_google_states,public.notebook_google_events to service_role;

-- 연결/해제/동기화의 경합을 한 연결 행의 잠금과 임대 토큰으로 조정합니다.
-- 호출자는 서버 전용 service_role만 허용하며 사용자 ID는 서버 세션에서 결정합니다.
create or replace function public.notebook_google_operation(p_user uuid,p_session text,p_op text,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.notebook_google_connections%rowtype; st public.notebook_google_states%rowtype; ticket uuid;
begin
 if not exists(select 1 from public.notebook_sessions where token_hash=p_session and user_id=p_user and expires_at>now()) then
  return jsonb_build_object('error','session');
 end if;
 if p_op='start' then
  insert into public.notebook_google_connections(user_id) values(p_user) on conflict do nothing;
 end if;
 select * into c from public.notebook_google_connections where user_id=p_user for update;
 if p_op='status' then
  return jsonb_build_object('status',coalesce(c.status,'disconnected'),'selected',coalesce(c.selected,'[]'),
   'lastSynced',c.last_synced,'rangeStart',c.range_start,'rangeEnd',c.range_end,
   'events',coalesce((select jsonb_agg(payload order by calendar_id,event_id) from public.notebook_google_events where user_id=p_user),'[]'));
 end if;
 if c.user_id is null then return jsonb_build_object('error','connection'); end if;
 if p_op='start' then
  if c.status='revocation_pending' then return jsonb_build_object('error','revoke'); end if;
  delete from public.notebook_google_states where user_id=p_user or expires_at<now();
  insert into public.notebook_google_states(state_hash,user_id,session_hash,expires_at)
   values(p_data->>'state',p_user,p_session,now()+interval '10 minutes');
 elsif p_op='claim' then
  update public.notebook_google_states set claimed=true where state_hash=p_data->>'state' and user_id=p_user
   and session_hash=p_session and expires_at>now() and not claimed returning * into st;
  if st.state_hash is null then return jsonb_build_object('error','state'); end if;
 elsif p_op='finish' then
  delete from public.notebook_google_states where state_hash=p_data->>'state' and user_id=p_user
   and session_hash=p_session and expires_at>now() and claimed returning * into st;
  if st.state_hash is null then return jsonb_build_object('error','state'); end if;
  delete from public.notebook_google_events where user_id=p_user;
  update public.notebook_google_connections set status='connected',refresh_ciphertext=p_data->>'cipher',
   revision=gen_random_uuid(),selected='[]',lease=null,last_synced=null,last_attempt=null,range_start=null,range_end=null where user_id=p_user;
 elsif p_op='sync_begin' then
  if c.status<>'connected' then return jsonb_build_object('error','connection'); end if;
  if c.last_attempt>now()-interval '60 seconds' or (c.lease is not null and c.last_attempt>now()-interval '90 seconds') then
   return jsonb_build_object('error','cooldown');
  end if;
  ticket:=gen_random_uuid();
  update public.notebook_google_connections set lease=ticket,last_attempt=now() where user_id=p_user;
  return jsonb_build_object('ticket',ticket);
 elsif p_op in ('sync_finish','sync_fail','reconnect') then
  if c.lease is distinct from (p_data->>'ticket')::uuid or c.status<>'connected' then return jsonb_build_object('error','changed'); end if;
  if p_op='sync_finish' then
   if jsonb_array_length(p_data->'events')>1000 or jsonb_array_length(p_data->'selected')>3 then raise exception 'limit exceeded'; end if;
   delete from public.notebook_google_events where user_id=p_user;
   insert into public.notebook_google_events(user_id,calendar_id,event_id,payload)
    select p_user,item->>'calendarId',item->>'eventId',item from jsonb_array_elements(p_data->'events') item;
   update public.notebook_google_connections set selected=p_data->'selected',last_synced=now(),
    range_start=(p_data->>'rangeStart')::timestamptz,range_end=(p_data->>'rangeEnd')::timestamptz,lease=null where user_id=p_user;
  else
   update public.notebook_google_connections set lease=null,status=case when p_op='reconnect' then 'reconnect' else status end where user_id=p_user;
  end if;
 elsif p_op='disconnect' then
  delete from public.notebook_google_states where user_id=p_user;
  if (p_data->>'removeEvents')::boolean then delete from public.notebook_google_events where user_id=p_user; end if;
  update public.notebook_google_connections set status=case when refresh_ciphertext is null then 'disconnected' else 'revocation_pending' end,
   lease=null,revision=gen_random_uuid() where user_id=p_user;
 elsif p_op='revoked' then
  if c.status<>'revocation_pending' or c.revision::text<>p_data->>'revision' then return jsonb_build_object('error','changed'); end if;
  update public.notebook_google_connections set status='disconnected',refresh_ciphertext=null where user_id=p_user;
 else raise exception 'unknown operation';
 end if;
 return jsonb_build_object('ok',true);
end;
$$;
revoke all on function public.notebook_google_operation(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.notebook_google_operation(uuid,text,text,jsonb) to service_role;

-- Source: 003_owner_google_login.sql
-- 001 → 002 → 003 순서. 계정/일정은 보존하고 기존 로그인 세션만 종료합니다.

alter table public.notebook_users alter column phone drop not null;
alter table public.notebook_users alter column password_hash drop not null;
alter table public.notebook_sessions add column if not exists auth_provider text not null default 'legacy' check(auth_provider in ('legacy','google'));
alter table public.notebook_sessions add column if not exists google_subject text;
create table if not exists public.notebook_owner_identity (
 singleton boolean primary key default true check(singleton),
 user_id uuid not null unique references public.notebook_users(id) on delete cascade,
 google_sub text not null unique, email text not null,
 created_at timestamptz not null default now()
);
create table if not exists public.notebook_login_states (
 state_hash text primary key check(state_hash ~ '^[a-f0-9]{64}$'),
 browser_hash text not null check(browser_hash ~ '^[a-f0-9]{64}$'),
 nonce_hash text not null check(nonce_hash ~ '^[a-f0-9]{64}$'),
 verifier text not null, expires_at timestamptz not null,
 claimed boolean not null default false
);
create index if not exists notebook_login_states_browser on public.notebook_login_states(browser_hash);
create index if not exists notebook_login_states_expiry on public.notebook_login_states(expires_at);
alter table public.notebook_google_states add column if not exists nonce_hash text;
alter table public.notebook_owner_identity enable row level security;
alter table public.notebook_login_states enable row level security;
revoke all on public.notebook_owner_identity,public.notebook_login_states from public,anon,authenticated;
grant select,insert,update,delete on public.notebook_owner_identity,public.notebook_login_states to service_role;
delete from public.notebook_sessions where auth_provider='legacy';
delete from public.notebook_google_states;
-- 이전 방식으로 연결한 토큰은 본인 확인을 다시 마칠 때까지 사용하지 않는다.
update public.notebook_google_connections set status='revocation_pending',lease=null
 where refresh_ciphertext is not null and not exists(select 1 from public.notebook_owner_identity);

create or replace function public.notebook_finish_owner_login(p_subject text,p_email text,p_existing_user uuid,
 p_token_hash text,p_old_token_hash text,p_state_hash text,p_browser_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare owner public.notebook_owner_identity%rowtype; target uuid; claimed_state text;
begin
 -- 기존 일정의 소유자를 추측하지 않고 첫 연결 시 명시한 ID에만 연결한다.
 lock table public.notebook_owner_identity in exclusive mode;
 delete from public.notebook_login_states where state_hash=p_state_hash and browser_hash=p_browser_hash
  and claimed and expires_at>now() returning state_hash into claimed_state;
 if claimed_state is null then return jsonb_build_object('error','state'); end if;
 select * into owner from public.notebook_owner_identity where singleton=true;
 if owner.user_id is not null then
  if owner.google_sub<>p_subject or owner.email<>p_email or p_existing_user is not null and owner.user_id<>p_existing_user then
   return jsonb_build_object('error','owner');
  end if;
  target:=owner.user_id;
 else
  if p_existing_user is not null then
   select id into target from public.notebook_users where id=p_existing_user for update;
   if target is null then return jsonb_build_object('error','migration'); end if;
  elsif exists(select 1 from public.notebook_users) then
   return jsonb_build_object('error','migration');
  else
   insert into public.notebook_users default values returning id into target;
  end if;
  insert into public.notebook_owner_identity(singleton,user_id,google_sub,email) values(true,target,p_subject,p_email);
 end if;
 insert into public.notebook_sessions(token_hash,user_id,expires_at,auth_provider,google_subject)
  values(p_token_hash,target,now()+interval '24 hours','google',p_subject);
 delete from public.notebook_sessions where token_hash=p_old_token_hash and user_id=target;
 return jsonb_build_object('userId',target);
end;
$$;
revoke all on function public.notebook_finish_owner_login(text,text,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.notebook_finish_owner_login(text,text,uuid,text,text,text,text) to service_role;

commit;

-- 결과의 본인 계정 user_id는 다음 단계의 Vercel 설정에 사용합니다.
select u.id as user_id,
       case when u.phone is null then 'Google account'
            else left(u.phone,3) || '-****-' || right(u.phone,4) end as phone_hint,
       count(s.id) as schedule_count
from public.notebook_users u
left join public.notebook_schedules s on s.user_id=u.id
group by u.id,u.phone,u.created_at
order by u.created_at; 