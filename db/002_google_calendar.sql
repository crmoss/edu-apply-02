-- 기존 001_initial.sql 실행 후 적용. 기존 일정/계정 데이터는 변경하지 않습니다.
begin;
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
commit;
