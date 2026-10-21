// 실제 브라우저 대신 모의 DOM/API로 비동기 화면·계정 전환 흐름을 검증한다.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
async function main(){
 const rules=vm.createContext({});vm.runInContext(read('logic.js')+'\n'+read('tests.js'),rules);
 const results=vm.runInContext('testResults',rules);for(const r of results)assert.equal(r.ok,true,r.label);
 const nodes=new Map();
 for(const match of read('index.html').matchAll(/id="([^"]+)"/g))nodes.set(match[1],{
  value:'',hidden:false,disabled:false,textContent:'',innerHTML:'',dataset:{},handlers:{},
  classList:{add(){},remove(){},toggle(){}},setAttribute(){},focus(){},scrollIntoView(){},reset(){},
  addEventListener(name,fn){this.handlers[name]=fn;},showModal(){this.open=true;},close(){this.open=false;this.handlers.close?.();}
 });
 nodes.get('categoryFilter').value='all';nodes.get('category').value='work';
 let rows=[],signedIn=false,nextError=null;const calls=[];
 const api={async request(action,body){
  calls.push({action,body});if(nextError){const error=nextError;nextError=null;throw error;}
  if(action==='session'){const e=new Error('로그인 필요');e.status=401;throw e;}
  if(action==='signup'||action==='login'){signedIn=true;return {user:{id:'account-a',phone:'010-****-0000'}};}
  if(action==='logout'){signedIn=false;return {ok:true};}
  assert.ok(signedIn,'인증 뒤 API 접근');
  if(action==='list')return {schedules:structuredClone(rows)};
  if(action==='create'){const s={...body,version:1};rows.push(s);return {schedule:structuredClone(s)};}
  if(action==='update'){const old=rows.find(r=>r.id===body.id);assert.equal(body.version,old.version);const s={...body,version:old.version+1};rows=rows.map(r=>r.id===s.id?s:r);return {schedule:structuredClone(s)};}
  if(action==='delete'){rows=rows.filter(r=>r.id!==body.id);return {ok:true};}
  if(action==='import')return {ok:true};throw Error(action);
 }};
 const legacy=[{id:'old',category:'work',date:'2026-10-21',start:'07:00',end:'07:30',content:'이전 일정'}];
 const local=new Map([['online-work-notebook.standalone.v1',JSON.stringify(legacy)]]);
 const ctx=vm.createContext({console,NotebookAPI:api,crypto:require('node:crypto').webcrypto,
  document:{getElementById:id=>nodes.get(id),querySelectorAll:()=>[]},window:{addEventListener(){}},
  localStorage:{getItem:key=>local.get(key)??null,setItem(){throw Error('온라인 모드에서 로컬 저장 금지');}}
 });
 vm.runInContext(read('logic.js')+'\n'+read('app.js')+'\n'+read('signup.js'),ctx);
 const run=code=>vm.runInContext(code,ctx);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(nodes.get('submitBtn').disabled,true,'로그인 전 저장 불가');
 assert.equal(run('schedules.length'),0,'로컬 일정을 로그인 전 표시하지 않음');
 nodes.get('openSignup').handlers.click();nodes.get('registerTab').onclick();
 nodes.get('signupPhone').value='010-0000-0000';nodes.get('signupPassword').value='sample-password-123';nodes.get('signupPasswordConfirm').value='mismatch';
 await nodes.get('signupForm').handlers.submit({preventDefault(){}});
 assert.equal(calls.filter(c=>c.action==='signup').length,0,'비밀번호 확인 오류');
 nodes.get('signupPasswordConfirm').value='sample-password-123';
 await nodes.get('signupForm').handlers.submit({preventDefault(){}});
 assert.equal(run('currentUser.id'),'account-a');assert.equal(nodes.get('submitBtn').disabled,false);
 assert.equal(nodes.get('signupPassword').value,'','인증 후 비밀번호 지우기');
 assert.equal(nodes.get('legacyImport').hidden,false,'기존 일정 가져오기 안내');
 async function submit(content='오늘 일정',start='09:00',end='09:30'){
  nodes.get('date').value=run('today()');nodes.get('category').value='work';nodes.get('content').value=content;
  run(`setTime('start','${start}');setTime('end','${end}')`);await nodes.get('scheduleForm').handlers.submit({preventDefault(){}});
 }
 await submit();assert.equal(rows.length,1);assert.equal(nodes.get('upcomingCount').textContent,'1건');
 assert.ok(nodes.get('upcomingList').innerHTML.includes('upcoming-work'));
 await submit('중복');assert.equal(rows.length,1,'같은 시간 등록 거부');
 nodes.get('upcomingList').handlers.click({target:{closest:()=>({dataset:{edit:rows[0].id}})}});
 await submit('수정 일정','10:00','10:30');assert.equal(rows[0].content,'수정 일정');assert.equal(rows[0].version,2);
 const error=new Error('저장 실패');error.status=503;nextError=error;
 await submit('유지할 입력','11:00','11:30');assert.equal(rows.length,1);assert.equal(nodes.get('content').value,'유지할 입력');
 nodes.get('monthView').onclick();nodes.get('categoryFilter').value='personal';nodes.get('categoryFilter').onchange();assert.equal(nodes.get('upcomingCount').textContent,'1건');
 await nodes.get('importSchedules').onclick();assert.ok(calls.some(c=>c.action==='import'&&c.body.schedules.length===1));assert.equal(local.size,1);
 nodes.get('upcomingList').handlers.click({target:{closest:()=>({dataset:{cancel:rows[0].id}})}});
 await nodes.get('confirmCancel').onclick();assert.equal(rows.length,0);
 await nodes.get('logoutButton').onclick();assert.equal(run('currentUser'),null);assert.equal(run('schedules.length'),0);assert.equal(nodes.get('submitBtn').disabled,true);
 console.log(`PASS: ${results.length} rules; signup/login, password confirmation, DB CRUD, failure preservation, D-day colors, import, logout clearing.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
