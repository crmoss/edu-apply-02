const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createDevelopmentServer}=require('../scripts/dev-server.cjs');
const {createHandler}=require('../api/notebook.js');
test('로컬 서버: 실제 HTTP 가입·로그인·DB 저장·소유자 분리·로그아웃',async()=>{
 assert.throws(()=>createHandler({localOrigin:'https://example.com'}),/loopback/);
 const originalFetch=global.fetch;let origin;
 // 로컬 모드가 실수로 Supabase 등 외부 URL을 호출하면 테스트를 실패시킨다.
 global.fetch=(url,options)=>{assert.ok(String(url).startsWith(origin+'/'),'외부 DB 연결 금지');return originalFetch(url,options);};
 const app=await createDevelopmentServer({port:0,dataDir:null});origin=app.origin;
 try{
  const page=await fetch(origin+'/');assert.ok((await page.text()).includes('운영 DB 미연결'));
  for(const hidden of ['/.env','/server/database.cjs','/db/001_initial.sql'])assert.equal((await fetch(origin+hidden)).status,404);
  async function call(action,body,cookie='',requestOrigin=origin){
   const response=await fetch(origin+'/api/notebook?action='+action,{method:body===undefined?'GET':'POST',headers:{Origin:requestOrigin,Cookie:cookie,...body===undefined?{}:{'Content-Type':'application/json'}},...body===undefined?{}:{body:JSON.stringify(body)}});
   return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')};
  }
  const creds={phone:'01000000000',password:'local-test-password-123',passwordConfirm:'local-test-password-123'};
  const signup=await call('signup',creds);assert.equal(signup.status,200,JSON.stringify(signup.body));
  assert.ok(signup.cookie.includes('notebook_local_session='));assert.ok(signup.cookie.includes('HttpOnly'));assert.ok(!signup.cookie.includes('Secure'));
  const cookie=signup.cookie.split(';')[0];
  const input={category:'work',date:'2026-10-22',start:'09:00',end:'09:30',content:'로컬 등록 테스트'};
  const created=await call('create',input,cookie);assert.equal(created.status,200,JSON.stringify(created.body));
  assert.equal(created.body.schedule.date,input.date);
  assert.equal((await call('create',{...input,start:'09:00',end:'10:00'},cookie)).status,409);
  const listed=await call('list',undefined,cookie);assert.equal(listed.body.schedules.length,1);
  assert.equal((await call('update',{...created.body.schedule,content:'변경 완료'},cookie)).status,200);
  assert.equal((await call('update',{...created.body.schedule,content:'오래된 버전'},cookie)).status,409);
  assert.equal((await call('create',input,cookie,'https://evil.example')).status,403);
  const second=await call('signup',{...creds,phone:'01000000001'});const secondCookie=second.cookie.split(';')[0];
  assert.equal((await call('list',undefined,secondCookie)).body.schedules.length,0);
  assert.equal((await call('delete',{id:created.body.schedule.id,version:2},secondCookie)).status,409);
  const loggedOut=await call('logout',{},cookie);assert.equal(loggedOut.status,200);
  assert.equal((await call('session',undefined,cookie)).status,401);
  const login=await call('login',creds);assert.equal(login.status,200);const newCookie=login.cookie.split(';')[0];
  assert.equal((await call('list',undefined,newCookie)).body.schedules[0].content,'변경 완료');
  assert.equal((await call('delete',{id:created.body.schedule.id,version:2},newCookie)).status,200);
 }finally{await app.close();global.fetch=originalFetch;}
});
