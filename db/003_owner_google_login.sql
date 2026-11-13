-- 001 → 002 → 003 순서. 계정/일정은 보존하고 기존 로그인 세션만 종료합니다.
begin;
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
