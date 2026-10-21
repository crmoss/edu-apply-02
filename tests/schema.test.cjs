const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('PostgreSQL: 실제 마이그레이션·시간 제약·권한·요청 제한',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');
 const {btree_gist}=await import('@electric-sql/pglite/contrib/btree_gist');
 const db=new PGlite({extensions:{btree_gist}});
 try{
  // Supabase 기본 역할·확장 스키마를 로컬 엔진에 준비한다.
  await db.exec('create schema extensions; create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;');
  await db.exec(fs.readFileSync(require('node:path').join(__dirname,'../db/001_initial.sql'),'utf8'));
  const hash='scrypt$'+'a'.repeat(32)+'$'+'b'.repeat(128);
  const a=(await db.query('insert into notebook_users(phone,password_hash) values($1,$2) returning id',['01000000000',hash])).rows[0].id;
  const b=(await db.query('insert into notebook_users(phone,password_hash) values($1,$2) returning id',['01000000001',hash])).rows[0].id;
  const add=(owner,start,end)=>db.query("insert into notebook_schedules(user_id,category,schedule_date,start_minute,end_minute,content) values($1,'work','2026-10-21',$2,$3,'가상 일정')",[owner,start,end]);
  await add(a,540,600);await add(a,600,630);await add(b,540,600);
  await assert.rejects(add(a,570,630),e=>e.code==='23P01','같은 사용자의 중복 범위 차단');
  await assert.rejects(add(a,400,420),e=>e.code==='23514','시간 범위 제한');
  await assert.rejects(db.query('insert into notebook_users(phone,password_hash) values($1,$2)',['01000000000',hash]),e=>e.code==='23505');
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from notebook_users'),e=>e.code==='42501');
  await assert.rejects(db.query('select * from notebook_schedules'),e=>e.code==='42501');
  await assert.rejects(db.query('select notebook_take_attempt($1,2)',['a'.repeat(64)]),e=>e.code==='42501');
  await db.exec('reset role; set role service_role');
  assert.equal((await db.query('select count(*)::int as n from notebook_schedules')).rows[0].n,3);
  const attempt=()=>db.query('select notebook_take_attempt($1,2) as ok',['a'.repeat(64)]);
  assert.equal((await attempt()).rows[0].ok,true);assert.equal((await attempt()).rows[0].ok,true);assert.equal((await attempt()).rows[0].ok,false);
  await db.exec('reset role');
  // 일괄 가져오기는 한 건이라도 시간이 겹치면 전체 요청이 취소된다.
  await assert.rejects(db.query("insert into notebook_schedules(user_id,category,schedule_date,start_minute,end_minute,content) values($1,'work','2026-10-22',540,600,'first'),($1,'personal','2026-10-22',570,630,'second')",[a]),e=>e.code==='23P01');
  assert.equal((await db.query("select count(*)::int as n from notebook_schedules where schedule_date='2026-10-22'")).rows[0].n,0);
 }finally{await db.close();}
});
