'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {scheduleInput}=require('../server/core.cjs');
const {createDevelopmentServer}=require('../scripts/dev-server.cjs');
const {seedOwner}=require('./helpers/owner-fixture.cjs');

test('연속 일정: 날짜/시간 검증·밤 시간 중복·경계 허용·기존 하루 일정 호환',()=>{
 const input={category:'work',date:'2026-11-16',endDate:'2026-11-18',start:'18:00',end:'09:00',content:'연속 출장'};
 assert.equal(scheduleInput(input).end_date,'2026-11-18');
 assert.equal(scheduleInput({...input,endDate:undefined,end:'19:00'}).end_date,input.date);
 for(const changed of [{endDate:'2026-11-15'},{endDate:'2026-11-16'},{endDate:'2026-02-30'},{endDate:null},{start:'23:00'},{end:'07:00'},{end:'23:30'}])assert.throws(()=>scheduleInput({...input,...changed}));
 assert.equal(scheduleInput({...input,date:'2028-02-28',endDate:'2028-03-01'}).end_date,'2028-03-01');
 const ctx=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../logic.js'),'utf8'),ctx);
 ctx.span={id:'span',...input};
 const check=(record)=>{ctx.other=record;return vm.runInContext('overlaps(span,other)',ctx);};
 assert.equal(check({...input,date:'2026-11-17',endDate:'2026-11-17',start:'22:00',end:'22:30'}),true);
 assert.equal(check({...input,date:'2026-11-18',endDate:'2026-11-18',start:'09:00',end:'09:30'}),false);
 assert.equal(check({...input,date:'2026-11-16',endDate:'2026-11-16',start:'17:30',end:'18:00'}),false);
 assert.equal(vm.runInContext("readData(JSON.stringify([span])).length",ctx),1);
 const legacy={id:'old',category:'work',date:'2026-11-15',start:'09:00',end:'09:30',content:'이전 일정'};ctx.legacy=legacy;
 assert.equal(vm.runInContext('readData(JSON.stringify([legacy])).length',ctx),1);
});

test('연속 일정: 주·월 경계 날짜별 표시와 진행 중 D-day 한 건 유지',()=>{
 const ctx=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../logic.js'),'utf8'),ctx);
 vm.runInContext("var span={id:'span',category:'work',date:'2026-11-29',endDate:'2026-12-02',start:'18:00',end:'09:00',content:'출장'};",ctx);
 const run=code=>vm.runInContext(code,ctx);
 assert.equal(run("schedulesOnDay([span],'2026-11-29')[0].displayTime"),'18:00 ~ 24:00 · 시작');
 assert.equal(run("schedulesOnDay([span],'2026-11-30')[0].displayTime"),'종일 · 연속 일정');
 assert.equal(run("schedulesOnDay([span],'2026-12-02')[0].displayTime"),'00:00 ~ 09:00 · 종료');
 assert.equal(run("schedulesOnDay([span],'2026-12-03').length"),0);
 assert.equal(run("schedulesOnDay([span],'2026-12-01')[0].id"),'span');
 assert.equal(run("upcomingSchedules([span],'2026-12-01').length"),1);
 assert.equal(run("upcomingSchedules([span],'2026-12-02').length"),1);
 assert.equal(run("upcomingSchedules([span],'2026-12-03').length"),0);
});

test('연속 일정: 실제 HTTP·DB에서 한 건 저장·재시도·기간 충돌·수정·전체 삭제',async()=>{
 let owner;
 const app=await createDevelopmentServer({port:0,dataDir:null,initializeDatabase:async database=>{owner=await seedOwner(database);}});
 async function call(action,body){
  const response=await fetch(app.origin+'/api/notebook?action='+action,{method:body===undefined?'GET':'POST',headers:{Origin:app.origin,Cookie:owner.cookie,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json()};
 }
 try{
  const input={id:require('node:crypto').randomUUID(),category:'work',date:'2026-11-16',endDate:'2026-11-18',start:'18:00',end:'09:00',content:'연속 출장'};
  const created=await call('create',input);assert.equal(created.status,200,JSON.stringify(created.body));
  assert.equal(created.body.schedule.endDate,'2026-11-18');assert.equal((await call('create',input)).status,200,'same request is idempotent');
  assert.equal((await call('list')).body.schedules.length,1,'one range is one DB record');
  for(const part of [{date:'2026-11-16',endDate:'2026-11-16',start:'22:00',end:'22:30'},{date:'2026-11-17',endDate:'2026-11-17',start:'07:00',end:'07:30'},{date:'2026-11-18',endDate:'2026-11-18',start:'08:30',end:'09:00'}]){
   const result=await call('create',{...input,...part,id:require('node:crypto').randomUUID()});assert.equal(result.status,409,JSON.stringify(result.body));
  }
  const first={...input,id:require('node:crypto').randomUUID(),endDate:'2026-11-16',start:'17:30',end:'18:00'};
  const last={...input,id:require('node:crypto').randomUUID(),date:'2026-11-18',endDate:'2026-11-18',start:'09:00',end:'09:30'};
  assert.equal((await call('create',first)).status,200);assert.equal((await call('create',last)).status,200);
  const updated=await call('update',{...created.body.schedule,endDate:'2026-11-17'});assert.equal(updated.status,200,JSON.stringify(updated.body));
  assert.equal(updated.body.schedule.id,input.id);assert.equal(updated.body.schedule.version,2);
  assert.equal((await call('update',{...created.body.schedule,endDate:'2026-11-19'})).status,409,'stale version rejected');
  assert.equal((await call('create',{...last,id:require('node:crypto').randomUUID(),start:'08:30',end:'09:00'})).status,200,'time released by shortening the range');
  assert.equal((await call('delete',{id:input.id,version:2})).status,200);
  const remaining=(await call('list')).body.schedules;assert.equal(remaining.length,3);assert.ok(remaining.every(s=>s.id!==input.id));
 }finally{await app.close();}
});
