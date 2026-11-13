'use strict';
// 운영 서버·실제 로컬 DB를 사용하지 않는 보안 점검 재현 스크립트.
const assert=require('node:assert/strict');
const {createDevelopmentServer}=require('./dev-server.cjs');
const {seedOwner}=require('../tests/helpers/owner-fixture.cjs');
async function review(){
 let fixture,otherCookie;
 const app=await createDevelopmentServer({port:0,dataDir:null,initializeDatabase:async database=>{fixture=await seedOwner(database);otherCookie=(await fixture.session({subject:'outsider'})).cookie;}});const results=[];
 try{
  async function call(action,body,cookie='',origin=app.origin){
   const response=await fetch(`${app.origin}/api/notebook?action=${action}`,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const credentials={phone:'01000000000',password:'audit-only-password-123',passwordConfirm:'audit-only-password-123'};
  const signup=await call('signup',credentials);assert.equal(signup.status,403);
  const duplicate=await call('signup',credentials);assert.equal(duplicate.status,403);
  results.push({check:'legacy_registration_disabled',result:'PASS',newAccountStatus:signup.status,duplicateAccountStatus:duplicate.status});
  const account={cookie:fixture.cookie};
  const input={category:'work',date:'2026-10-22',start:'09:00',end:'09:30',content:'<img src=x onerror=alert(1)>'};
  const created=await call('create',{...input,user_id:'attacker'},account.cookie);assert.equal(created.status,200);
  const other=await call('list',undefined,otherCookie);assert.equal(other.status,403);
  const changed=await call('update',{...created.body.schedule,content:'unauthorized'},otherCookie);assert.equal(changed.status,403);
  const deleted=await call('delete',{id:created.body.schedule.id,version:1},otherCookie);assert.equal(deleted.status,403);
  const own=await call('list',undefined,account.cookie);assert.equal(own.body.schedules.length,1);assert.equal(own.body.schedules[0].content,input.content);
  results.push({check:'ownership_isolation_and_client_owner_override',result:'PASS',details:'Non-owner access rejected; submitted user_id ignored.'});
  assert.equal((await call('list')).status,401);
  assert.equal((await call('create',input,account.cookie,'https://external.example')).status,403);
  assert.equal((await call('create',input,account.cookie,'')).status,403);
  results.push({check:'authentication_and_cross_origin_write_block',result:'PASS'});
  const listStatuses=[];for(let i=0;i<31;i++)listStatuses.push((await call('list',undefined,account.cookie)).status);
  assert.ok(listStatuses.every(status=>status===200));
  results.push({check:'authenticated_list_rate_limit',result:'CONFIRMED_GAP',requests:31,accepted:31,details:'This demonstrates no application rate limit, not a measured outage.'});
  const failed=[];for(let i=0;i<10;i++)failed.push((await call('login',{phone:credentials.phone,password:'wrong-audit-password-123'})).status);
  assert.ok(failed.every(status=>status===403));
  assert.equal((await call('session',undefined,account.cookie)).status,200);
  results.push({check:'phone_login_disabled_without_owner_lockout',result:'PASS',legacyAttempts:10});
  const logout=await call('logout',{},account.cookie);assert.equal(logout.status,200);assert.equal((await call('session',undefined,account.cookie)).status,401);
  results.push({check:'logout_revokes_session',result:'PASS'});
  console.log(JSON.stringify({scope:'temporary in-memory local DB only; no production accounts or records touched',results},null,2));
 }finally{await app.close();}
}
review().catch(error=>{console.error(error.message);process.exitCode=1;});
