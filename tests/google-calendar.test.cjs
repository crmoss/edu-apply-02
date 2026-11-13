'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createLocalDatabase}=require('../server/local-database.cjs');
const {createHandler}=require('../api/notebook.js');
const {createGoogleHandler,encryptToken,decryptToken,normalizeEvent}=require('../api/google-calendar.js');
const {googleDisplayEvents}=require('../google-calendar-client.js');
const {seedOwner,EMAIL,SUBJECT}=require('./helpers/owner-fixture.cjs');

test('Google: 암호문은 사용자에 결속되고 변조·다른 키를 거부',()=>{
 const key=Buffer.alloc(32,7),a=encryptToken('private-refresh-token',key,'a','client');
 assert.ok(!a.includes('private-refresh-token'));
 assert.notEqual(a,encryptToken('private-refresh-token',key,'a','client'));
 assert.equal(decryptToken(a,key,'a','client'),'private-refresh-token');
 assert.throws(()=>decryptToken(a,key,'b','client'));
 assert.throws(()=>decryptToken(a,Buffer.alloc(32,8),'a','client'));
 const parts=a.split('.');parts[2]=Buffer.alloc(16).toString('base64url');
 assert.throws(()=>decryptToken(parts.join('.'),key,'a','client'));
});

test('Google: 종일 종료일 미포함·여러 날·반복 인스턴스·시간대·취소',()=>{
 const calendar={id:'cal',name:'개인',category:'personal'};
 const allDay=normalizeEvent({id:'a',summary:'<script>unsafe</script>',start:{date:'2026-11-01'},end:{date:'2026-11-04'}},calendar);
 const display=googleDisplayEvents([allDay],'2026-11-02','2026-11-10');
 assert.deepEqual(display.map(e=>e.date),['2026-11-02','2026-11-03']);assert.equal(display[0].displayTime,'종일');
 assert.equal(display[0].content,'<script>unsafe</script>');assert.equal(display[0].source,'google');
 const originalZone=process.env.TZ;process.env.TZ='Asia/Seoul';
 try{
  const event=id=>normalizeEvent({id,start:{dateTime:'2026-11-02T14:15:00Z'},end:{dateTime:'2026-11-02T15:00:00Z'}},calendar);
  const timed=googleDisplayEvents([event('instance1'),event('instance2')],'2026-11-02','2026-11-03');
  assert.equal(timed.length,2);assert.equal(timed[0].date,'2026-11-02');assert.equal(timed[0].displayTime,'23:15 ~ 24:00');
  assert.notEqual(timed[0].id,timed[1].id);
 }finally{if(originalZone===undefined)delete process.env.TZ;else process.env.TZ=originalZone;}
 assert.equal(normalizeEvent({status:'cancelled'},calendar),null);
 assert.throws(()=>normalizeEvent({id:'bad',start:{date:'2026-02-30'},end:{date:'2026-03-04'}},calendar));
});

test('Google: 실제 DB로 OAuth 세션 결속·일회성·소유자·동기화·해제 경합 검증',async()=>{
 const store=await createLocalDatabase();
 const origin='http://127.0.0.1:3000',secret='s'.repeat(64),key=Buffer.alloc(32,4).toString('base64');
 const config={clientId:'test-client',clientSecret:'test-secret',key,origin,rateSecret:secret};
 const base=createHandler({database:store.database,localOrigin:origin,localRateSecret:secret});
 const calls=[];let events=[],providerError=false,revokeError=false,eventWait=null,nonce,subject=SUBJECT;
 const scopes='https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly';
 const fake=async(url,options)=>{
  calls.push({url,options});const parsed=new URL(url);
  if(parsed.hostname==='oauth2.googleapis.com'&&parsed.pathname==='/token'){
   const body=new URLSearchParams(options.body);
   return new Response(JSON.stringify(body.has('code')?{refresh_token:'private-refresh',access_token:'private-access',scope:scopes,id_token:'calendar-id-token'}:{access_token:'private-access'}));
  }
  if(parsed.pathname==='/revoke')return new Response(revokeError?'{}':'',{status:revokeError?500:200});
  if(parsed.pathname.endsWith('/calendarList'))return new Response(JSON.stringify({items:[{id:'calendar-a',summary:'가상 캘린더'}]}));
  if(parsed.pathname.endsWith('/events')){
   if(eventWait)await eventWait;
   if(providerError)return new Response(JSON.stringify({error:'failed'}),{status:503});
   assert.equal(parsed.searchParams.get('singleEvents'),'true');assert.equal(parsed.searchParams.get('showDeleted'),'false');
   return new Response(JSON.stringify({items:events}));
  }
  throw Error('Unexpected Google URL');
 };
 const google=createGoogleHandler({database:store.database,localOrigin:origin,config,fetchGoogle:fake,verifyIdToken:async()=>({iss:'https://accounts.google.com',aud:'test-client',exp:Math.floor(Date.now()/1000)+3600,sub:subject,email:EMAIL,email_verified:true,nonce})});
 async function call(handler,action,body,cookie='',query={},requestOrigin=origin){
  const headers={};let status,payload;
  await handler({method:body===undefined?'GET':'POST',query:{action,...query},body,headers:{origin:requestOrigin,cookie,'content-type':'application/json'}},{setHeader(k,v){headers[k]=v;},status(code){status=code;return this;},json(value){payload=value;},end(){}});
  return {status,payload,headers};
 }
 try{
  const owner=await seedOwner(store.database),cookie=owner.cookie,user=owner.userId;
  const other=(await owner.session({subject:'outsider-subject'})).cookie;
  assert.equal((await call(google,'status',undefined)).status,401);
  assert.equal((await call(google,'start',{},cookie,{},'https://evil.example')).status,403);
  const start=await call(google,'start',{},cookie);assert.equal(start.status,200,JSON.stringify(start.payload));
  const authURL=new URL(start.payload.url),state=authURL.searchParams.get('state');
  nonce=authURL.searchParams.get('nonce');
  assert.ok(!authURL.searchParams.get('scope').split(' ').includes('https://www.googleapis.com/auth/calendar'));
  let row=(await store.database(`notebook_google_states?user_id=eq.${user}`))[0];assert.notEqual(row.state_hash,state);
  assert.equal((await call(google,'callback',undefined,other,{state,code:'fake-code'})).headers.Location,'/?google=error#upcomingSection');assert.equal(calls.length,0);
  assert.equal((await call(google,'callback',undefined,cookie,{state,code:'fake-code'})).headers.Location,'/?google=connected#upcomingSection');
  let count=calls.length;await call(google,'callback',undefined,cookie,{state,code:'fake-code'});assert.equal(calls.length,count,'callback replay does not call Google');
  row=(await store.database(`notebook_google_connections?user_id=eq.${user}`))[0];assert.ok(!row.refresh_ciphertext.includes('private-refresh'));
  const status=await call(google,'status',undefined,cookie);assert.equal(status.payload.status,'connected');assert.ok(!JSON.stringify(status).includes('refresh_ciphertext'));
  assert.equal((await call(google,'status',undefined,other)).status,403);
  events=[{id:'event-1',summary:'외부 일정',start:{date:'2026-11-01'},end:{date:'2026-11-03'}}];
  const selected=[{id:'calendar-a',category:'personal'}];
  let sync=await call(google,'sync',{selected,user_id:'attacker'},cookie);assert.equal(sync.status,200,JSON.stringify(sync.payload));
  assert.equal((await call(google,'status',undefined,cookie)).payload.events.length,1);
  assert.equal((await call(google,'status',undefined,other)).status,403);
  assert.equal((await call(google,'sync',{},cookie)).status,429,'cooldown');
  const unlock=()=>store.database(`notebook_google_connections?user_id=eq.${user}`,{method:'PATCH',body:{last_attempt:'2000-01-01T00:00:00Z'}});
  await unlock();providerError=true;assert.equal((await call(google,'sync',{},cookie)).status,502);providerError=false;
  assert.equal((await call(google,'status',undefined,cookie)).payload.events.length,1,'failed refresh keeps cache');
  await unlock();events=[];assert.equal((await call(google,'sync',{},cookie)).status,200);
  assert.equal((await call(google,'status',undefined,cookie)).payload.events.length,0,'successful snapshot removes deleted events');
  await unlock();events=[{id:'event-2',start:{date:'2026-11-01'},end:{date:'2026-11-02'}}];
  assert.equal((await call(google,'sync',{selected:[{id:'not-owned',category:'work'}]},cookie)).status,400);
  await unlock();await call(google,'sync',{},cookie);await unlock();
  let release;eventWait=new Promise(resolve=>{release=resolve;});
  const pending=call(google,'sync',{},cookie);
  while(!calls.at(-1)?.url.includes('/events?'))await new Promise(resolve=>setImmediate(resolve));
  revokeError=true;
  const disconnect=await call(google,'disconnect',{removeEvents:true},cookie);assert.equal(disconnect.status,502);
  let after=(await call(google,'status',undefined,cookie)).payload;assert.equal(after.status,'revocation_pending');assert.equal(after.events.length,0);
  release();await pending;eventWait=null;
  assert.equal((await call(google,'status',undefined,cookie)).payload.events.length,0,'in-flight sync cannot resurrect disconnected cache');
  assert.equal((await call(google,'start',{},cookie)).status,409,'pending revocation blocks reconnect');
  revokeError=false;assert.equal((await call(google,'disconnect',{removeEvents:true},cookie)).status,200);
  row=(await store.database(`notebook_google_connections?user_id=eq.${user}`))[0];assert.equal(row.refresh_ciphertext,null);
  assert.equal((await call(google,'sync',{},cookie)).status,409);
  // State is bound to the exact notebook session, not merely the same user.
  const started=await call(google,'start',{},cookie),newState=new URL(started.payload.url).searchParams.get('state');
  const newCookie=(await owner.session()).cookie;
  count=calls.length;await call(google,'callback',undefined,newCookie,{state:newState,code:'fake-code'});assert.equal(calls.length,count);
  await store.database(`notebook_google_states?user_id=eq.${user}`,{method:'PATCH',body:{expires_at:'2000-01-01T00:00:00Z'}});
  await call(google,'callback',undefined,cookie,{state:newState,code:'fake-code'});assert.equal(calls.length,count,'expired state is rejected before token exchange');
  const rejected=await call(google,'start',{},cookie),badURL=new URL(rejected.payload.url);
  nonce=badURL.searchParams.get('nonce');subject='different-google-account';
  const denied=await call(google,'callback',undefined,cookie,{state:badURL.searchParams.get('state'),code:'fake-code'});
  assert.equal(denied.headers.Location,'/?google=error#upcomingSection','calendar connection must use the same Google subject as login');
  await call(base,'logout',{},cookie);assert.equal((await call(google,'status',undefined,cookie)).status,401);
 }finally{await store.close();}
});
