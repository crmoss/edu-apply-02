const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../server/core.cjs');
const handler=require('../api/notebook.js');
test('서버 일정 검증은 클라이언트와 독립적으로 동작',()=>{
 const input={category:'work',date:'2028-02-29',start:'09:00',end:'09:30',content:' 일정 '};
 assert.equal(core.scheduleInput(input).content,'일정');
 for(const changed of [{date:'2026-02-29'},{start:'06:30'},{end:'09:00'},{category:'bad'},{content:' '}])assert.throws(()=>core.scheduleInput({...input,...changed}));
});
test('API: 미설정·CSRF·인증·권한·버전·충돌·로그아웃',async()=>{
 const original={...process.env},originalFetch=global.fetch;
 const requests=[];
 const userA='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
 let fake=(url,options)=>{
  if(url.includes('notebook_sessions?'))return new Response(JSON.stringify([{user_id:userA,google_subject:'owner-subject'}]));
  if(url.includes('notebook_owner_identity?'))return new Response(JSON.stringify([{user_id:userA,google_sub:'owner-subject',email:'paran95@gmail.com'}]));
  if(url.includes('notebook_schedules?'))return new Response('[]');
  return new Response(null,{status:204});
 };
 global.fetch=async(url,options)=>{requests.push({url,options});return fake(url,options);};
 async function call(action,{method='POST',body={},origin='https://example.test',cookie='__Host-notebook_session='+'a'.repeat(64)}={}){
  const headers={};let status,payload;
  await handler({method,query:{action},body,headers:{origin,cookie,'content-type':'application/json'}},{setHeader(k,v){headers[k]=v;},status(s){status=s;return this;},json(data){payload=data;}});
  return {status,payload,headers};
 }
 try{
  delete process.env.SUPABASE_URL;assert.equal((await call('list',{method:'GET'})).status,503);
  process.env.SUPABASE_URL='https://db.example.test';process.env.SUPABASE_SERVICE_ROLE_KEY='test-key';process.env.APP_ORIGIN='https://example.test';process.env.RATE_LIMIT_SECRET='x'.repeat(64);
  assert.equal((await call('create',{origin:'https://evil.test'})).status,403);
  assert.equal((await call('list',{method:'GET',cookie:''})).status,401);
  requests.length=0;assert.equal((await call('list',{method:'GET'})).status,200);
  assert.ok(requests.some(r=>r.url.includes(`user_id=eq.${userA}`)),'조회 소유자 필터');
  const update={id,version:3,category:'work',date:'2026-10-21',start:'09:00',end:'09:30',content:'일정',user_id:'attacker'};
  const stale=await call('update',{body:update});assert.equal(stale.status,409);
  const request=requests.findLast(r=>r.options.method==='PATCH');assert.ok(request.url.includes(`user_id=eq.${userA}`));assert.ok(request.url.includes('version=eq.3'));assert.ok(!JSON.parse(request.options.body).user_id);
  fake=url=>url.includes('notebook_sessions?')?new Response(JSON.stringify([{user_id:userA,google_subject:'owner-subject'}])):url.includes('notebook_owner_identity?')?new Response(JSON.stringify([{user_id:userA,google_sub:'owner-subject',email:'paran95@gmail.com'}])):new Response(JSON.stringify({code:'23P01'}),{status:409});
  assert.equal((await call('create',{body:update})).status,409,'DB 중복 제약 오류 변환');
  fake=()=>new Response(null,{status:204});const out=await call('logout');assert.equal(out.status,200);assert.ok(out.headers['Set-Cookie'][0].includes('Max-Age=0'));assert.ok(out.headers['Set-Cookie'][0].includes('HttpOnly'));assert.ok(out.headers['Set-Cookie'][0].includes('Secure'));
 }finally{global.fetch=originalFetch;for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);}
});
