'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createLocalDatabase}=require('../server/local-database.cjs');
const {createLoginHandler}=require('../api/google-login.js');
const {createHandler}=require('../api/notebook.js');
const {verifyGoogleIdentity}=require('../server/owner-auth.cjs');
const {digest}=require('../server/core.cjs');
const {EMAIL,SUBJECT}=require('./helpers/owner-fixture.cjs');
const origin='http://127.0.0.1:3000';
function claims(nonce,changes={}){return {iss:'https://accounts.google.com',aud:'test-client',exp:Math.floor(Date.now()/1000)+3600,sub:SUBJECT,email:EMAIL,email_verified:true,nonce,...changes};}
test('개인 로그인: 이메일·고유 ID·nonce·audience·issuer·만료·서명 검증 실패 거부',async()=>{
 const nonce='test-nonce',base={clientId:'test-client',nonceHash:digest(nonce),ownerEmail:EMAIL,expectedSubject:SUBJECT};
 for(const change of [{email:'someone@gmail.com'},{sub:'another-sub'},{email_verified:false},{nonce:'wrong'},{aud:'other-client'},{iss:'https://evil.example'},{exp:1},{azp:'other-client'}])await assert.rejects(verifyGoogleIdentity('id-token',{...base,verifyIdToken:async()=>claims(nonce,change)}));
 await assert.rejects(verifyGoogleIdentity('forged-token',{...base,verifyIdToken:async()=>{throw Error('invalid signature');}}));
 assert.equal((await verifyGoogleIdentity('id-token',{...base,verifyIdToken:async()=>claims(nonce)})).subject,SUBJECT);
});
test('개인 로그인: 브라우저 결속·PKCE·기존 일정 보존·고유 ID 고정·24시간 세션',async()=>{
 const store=await createLocalDatabase();let cfg,nonce,challenge,currentClaims=null,requests=0;
 const fetchGoogle=async(url,options)=>{
  requests++;assert.equal(url,'https://oauth2.googleapis.com/token');
  const form=new URLSearchParams(options.body);assert.ok(form.get('code_verifier'));assert.equal(form.get('redirect_uri'),origin+'/api/google-login?action=callback');
  assert.equal(require('node:crypto').createHash('sha256').update(form.get('code_verifier')).digest('base64url'),challenge);
  return new Response(JSON.stringify({id_token:'verified-in-test'}));
 };
 const verifyIdToken=async()=>currentClaims||claims(nonce);
 async function call(handler,action,{body,cookie='',query={},requestOrigin=origin}={}){
  const headers={};let status,payload;
  await handler({method:body===undefined?'GET':'POST',query:{action,...query},body,headers:{cookie,origin:requestOrigin,'content-type':'application/json'}},{setHeader(k,v){headers[k]=v;},status(s){status=s;return this;},json(v){payload=v;},end(){}});
  return {status,payload,headers};
 }
 try{
  const legacy=(await store.database('notebook_users',{method:'POST',body:{phone:'01000000000',password_hash:null}}))[0];
  await store.database('notebook_schedules',{method:'POST',body:{user_id:legacy.id,category:'work',schedule_date:'2026-11-13',start_minute:540,end_minute:570,content:'기존 일정 보존'}});
  cfg={clientId:'test-client',clientSecret:'test-secret',origin,rateSecret:'r'.repeat(64)};
  const auth=createLoginHandler({database:store.database,localOrigin:origin,config:cfg,fetchGoogle,verifyIdToken});
  const notebook=createHandler({database:store.database,localOrigin:origin,ownerConfig:cfg});
  for(let i=0;i<12;i++)assert.equal((await call(notebook,'login',{body:{phone:'01000000000',password:'wrong'}})).status,403);
  assert.equal((await call(notebook,'signup',{body:{}})).status,403);
  assert.equal((await call(auth,'start',{body:{},requestOrigin:'https://evil.example'})).status,403);
  async function start(){const result=await call(auth,'start',{body:{}});assert.equal(result.status,200,JSON.stringify(result.payload));const u=new URL(result.payload.url);nonce=u.searchParams.get('nonce');challenge=u.searchParams.get('code_challenge');assert.equal(u.searchParams.get('scope'),'openid email');assert.equal(u.searchParams.get('code_challenge_method'),'S256');return {state:u.searchParams.get('state'),cookie:result.headers['Set-Cookie'].split(';')[0]};}
  const unconfigured=await start();const setup=await call(auth,'callback',{query:{state:unconfigured.state,code:'code'},cookie:unconfigured.cookie});
  assert.equal(setup.headers.Location,'/?login=setup-required#upcomingSection');
  assert.equal((await store.database('notebook_owner_identity')).length,0,'existing user is never claimed by guessing');
  cfg.existingUserId=legacy.id;
  const first=await start();
  let response=await call(auth,'callback',{query:{state:first.state,code:'code'},cookie:'notebook_local_oauth='+'a'.repeat(64)});
  assert.equal(response.headers.Location,'/?login=error#upcomingSection');assert.equal(requests,1);
  currentClaims=claims(nonce,{email:'outsider@gmail.com'});
  response=await call(auth,'callback',{query:{state:first.state,code:'code'},cookie:first.cookie});assert.equal(response.headers.Location,'/?login=error#upcomingSection');
  assert.equal((await store.database('notebook_owner_identity')).length,0,'other email cannot pin owner');
  currentClaims=null;
  const second=await start();response=await call(auth,'callback',{query:{state:second.state,code:'code'},cookie:second.cookie});
  assert.equal(response.headers.Location,'/?login=success#upcomingSection');
  const cookies=response.headers['Set-Cookie'];assert.match(cookies[0],/Max-Age=86400/);assert.match(cookies[0],/HttpOnly/);
  const sessionCookie=cookies[0].split(';')[0];
  const session=await call(notebook,'session',{cookie:sessionCookie});assert.equal(session.payload.user.id,legacy.id);assert.equal(session.payload.user.email,EMAIL);
  assert.equal((await call(notebook,'list',{cookie:sessionCookie})).payload.schedules[0].content,'기존 일정 보존');
  const count=requests;await call(auth,'callback',{query:{state:second.state,code:'replay'},cookie:second.cookie});assert.equal(requests,count);
  // Same verified email with a different stable subject must never inherit existing data.
  const third=await start();currentClaims=claims(nonce,{sub:'different-sub'});
  response=await call(auth,'callback',{query:{state:third.state,code:'code'},cookie:third.cookie});assert.equal(response.headers.Location,'/?login=denied#upcomingSection');
  assert.equal((await store.database('notebook_owner_identity'))[0].google_sub,SUBJECT);
  // Logout invalidates a pending login, even if its browser cookie is replayed afterwards.
  currentClaims=null;const fourth=await start();await call(notebook,'logout',{body:{},cookie:sessionCookie+'; '+fourth.cookie});
  response=await call(auth,'callback',{query:{state:fourth.state,code:'code'},cookie:fourth.cookie});assert.equal(response.headers.Location,'/?login=error#upcomingSection');
  assert.equal((await call(notebook,'session',{cookie:sessionCookie})).status,401);
  const fifth=await start();await store.database(`notebook_login_states?state_hash=eq.${digest(fifth.state)}`,{method:'PATCH',body:{expires_at:'2000-01-01T00:00:00Z'}});
  const before=requests;await call(auth,'callback',{query:{state:fifth.state,code:'code'},cookie:fifth.cookie});assert.equal(requests,before);
 }finally{await store.close();}
});

test('개인 로그인: 빈 DB 첫 본인 계정 생성·운영 Secure 쿠키',async()=>{
 const store=await createLocalDatabase();let nonce;
 const appOrigin='https://app.example.test';
 const auth=createLoginHandler({database:store.database,config:{clientId:'test-client',clientSecret:'test-secret',origin:appOrigin,rateSecret:'r'.repeat(64)},
  fetchGoogle:async()=>new Response(JSON.stringify({id_token:'fake-id-token'})),verifyIdToken:async()=>claims(nonce)});
 async function call(action,body,cookieValue='',query={}){
  const headers={};let payload,status;
  await auth({method:body===undefined?'GET':'POST',query:{action,...query},body,headers:{origin:appOrigin,'content-type':'application/json',cookie:cookieValue}},
   {setHeader(k,v){headers[k]=v;},status(s){status=s;return this;},json(v){payload=v;},end(){}});
  return {headers,payload,status};
 }
 try{
  const start=await call('start',{});assert.equal(start.status,200);
  const u=new URL(start.payload.url);nonce=u.searchParams.get('nonce');
  assert.match(start.headers['Set-Cookie'],/^__Host-notebook_oauth=/);assert.match(start.headers['Set-Cookie'],/; Secure;/);
  const done=await call('callback',undefined,start.headers['Set-Cookie'].split(';')[0],{state:u.searchParams.get('state'),code:'fake-code'});
  assert.equal(done.headers.Location,'/?login=success#upcomingSection');
  assert.match(done.headers['Set-Cookie'][0],/^__Host-notebook_session=/);assert.match(done.headers['Set-Cookie'][0],/; Secure;/);assert.match(done.headers['Set-Cookie'][0],/Max-Age=86400/);
  const users=await store.database('notebook_users');assert.equal(users.length,1);assert.equal(users[0].phone,null);assert.equal(users[0].password_hash,null);
 }finally{await store.close();}
});
