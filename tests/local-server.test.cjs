const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createDevelopmentServer}=require('../scripts/dev-server.cjs');
const {createHandler}=require('../api/notebook.js');
const {seedOwner}=require('./helpers/owner-fixture.cjs');
test('로컬 서버: 기존 로그인 차단·본인 세션·DB 저장·접근 제한·로그아웃',async()=>{
 assert.throws(()=>createHandler({localOrigin:'https://example.com'}),/loopback/);
 const originalFetch=global.fetch;let origin;
 // 로컬 모드가 실수로 Supabase 등 외부 URL을 호출하면 테스트를 실패시킨다.
 global.fetch=(url,options)=>{assert.ok(String(url).startsWith(origin+'/'),'외부 DB 연결 금지');return originalFetch(url,options);};
 let fixture,legacyCookie,otherCookie;
 const app=await createDevelopmentServer({port:0,dataDir:null,initializeDatabase:async database=>{
  fixture=await seedOwner(database);
  legacyCookie=(await fixture.session({provider:'legacy'})).cookie;
  otherCookie=(await fixture.session({subject:'other-subject'})).cookie;
 }});origin=app.origin;
 try{
  const page=await fetch(origin+'/');assert.ok((await page.text()).includes('운영 DB 미연결'));
  for(const hidden of ['/.env','/server/database.cjs','/db/001_initial.sql'])assert.equal((await fetch(origin+hidden)).status,404);
  async function call(action,body,cookie='',requestOrigin=origin){
   const response=await fetch(origin+'/api/notebook?action='+action,{method:body===undefined?'GET':'POST',headers:{Origin:requestOrigin,Cookie:cookie,...body===undefined?{}:{'Content-Type':'application/json'}},...body===undefined?{}:{body:JSON.stringify(body)}});
   return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')};
  }
  const creds={phone:'01000000000',password:'local-test-password-123',passwordConfirm:'local-test-password-123'};
  assert.equal((await call('signup',creds)).status,403);assert.equal((await call('login',creds)).status,403);
  const cookie=fixture.cookie;
  assert.equal((await call('session',undefined,cookie)).status,200);
  assert.equal((await call('session',undefined,legacyCookie)).status,401);
  assert.equal((await call('session',undefined,otherCookie)).status,403);
  const input={category:'work',date:'2026-10-22',start:'09:00',end:'09:30',content:'로컬 등록 테스트'};
  const created=await call('create',input,cookie);assert.equal(created.status,200,JSON.stringify(created.body));
  assert.equal(created.body.schedule.date,input.date);
  assert.equal((await call('create',{...input,start:'09:00',end:'10:00'},cookie)).status,409);
  const listed=await call('list',undefined,cookie);assert.equal(listed.body.schedules.length,1);
  assert.equal((await call('update',{...created.body.schedule,content:'변경 완료'},cookie)).status,200);
  assert.equal((await call('update',{...created.body.schedule,content:'오래된 버전'},cookie)).status,409);
  assert.equal((await call('create',input,cookie,'https://evil.example')).status,403);
  assert.equal((await call('list',undefined,otherCookie)).status,403);
  assert.equal((await call('delete',{id:created.body.schedule.id,version:2},otherCookie)).status,403);
  assert.equal((await call('delete',{id:created.body.schedule.id,version:2},cookie)).status,200);
  const loggedOut=await call('logout',{},cookie);assert.equal(loggedOut.status,200);
  assert.equal((await call('session',undefined,cookie)).status,401);
  assert.equal((await call('login',creds)).status,403);
 }finally{await app.close();global.fetch=originalFetch;}
});
