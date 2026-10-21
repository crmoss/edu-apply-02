// Node.js 내장 모듈만 사용한 규칙·이벤트·저장 흐름 점검. 실제 브라우저 화면 검증은 별도입니다.
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const assert=require('node:assert/strict');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
const ruleContext=vm.createContext({});
vm.runInContext(read('logic.js')+'\n'+read('tests.js'),ruleContext);
const results=vm.runInContext('testResults',ruleContext);
for(const result of results)assert.equal(result.ok,true,result.label+': '+result.error);

function boot({raw=null,failWrite=false}={}){
  const nodes=new Map();
  const events={};
  const html=read('index.html');
  for(const match of html.matchAll(/id="([^"]+)"/g)){
    nodes.set(match[1],{
      value:'',textContent:'',innerHTML:'',disabled:false,dataset:{},handlers:{},
      classList:{add(){},remove(){},toggle(){}},
      setAttribute(){},addEventListener(name,fn){this.handlers[name]=fn},
      reset(){},focus(){},scrollIntoView(){},
      showModal(){this.open=true},close(){this.open=false;this.handlers.close?.()}
    });
  }
  nodes.get('categoryFilter').value='all';
  nodes.get('category').value='work';
  const values=new Map();
  if(raw!==null)values.set('online-work-notebook.standalone.v1',raw);
  const context=vm.createContext({
    console,crypto:{randomUUID:()=>`test-${Math.random()}`},
    document:{getElementById:id=>nodes.get(id),querySelectorAll:()=>[]},
    window:{addEventListener:(name,fn)=>events[name]=fn},
    localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>{if(failWrite)throw Error('quota');values.set(key,value)}}
  });
  vm.runInContext(read('logic.js')+'\n'+read('app.js')+'\n'+read('signup.js'),context);
  return {nodes,values,run:code=>vm.runInContext(code,context)};
}
const app=boot();
function submit(content='가상 회의',start='09:00',end='09:30'){
  app.nodes.get('date').value='2026-10-21';
  app.nodes.get('content').value=content;
  app.nodes.get('category').value='work';
  app.run(`setTime('start','${start}');setTime('end','${end}')`);
  app.nodes.get('scheduleForm').handlers.submit({preventDefault(){}});
}
submit();
assert.equal(app.run('schedules.length'),1,'일정 등록');
submit('겹치는 회의');
assert.equal(app.run('schedules.length'),1,'중복 등록 거부');
assert.ok(app.nodes.get('formMessage').textContent.includes('중복'));
app.run('editingId=schedules[0].id');
submit('변경된 가상 회의','10:00','10:30');
assert.equal(app.run('schedules[0].content'),'변경된 가상 회의','본인 일정 변경');
assert.equal(app.run('schedules.length'),1);
app.nodes.get('monthView').onclick();
assert.equal(app.run('view'),'month');
assert.ok(app.nodes.get('calendarBody').innerHTML.includes('booking'));
app.nodes.get('categoryFilter').value='personal';
app.nodes.get('categoryFilter').onchange();
assert.ok(app.nodes.get('scheduleList').innerHTML.includes('empty-table'));
const stored=app.values.get('online-work-notebook.standalone.v1');
const restored=boot({raw:stored});
assert.equal(restored.run('schedules[0].content'),'변경된 가상 회의','재시작 저장 복원');
app.run('pendingCancel=schedules[0].id');
app.nodes.get('confirmCancel').onclick();
assert.equal(app.run('schedules.length'),0,'일정 취소');
assert.equal(app.values.get('online-work-notebook.standalone.v1'),'[]');
const broken=boot({raw:'{'});
assert.equal(broken.nodes.get('submitBtn').disabled,true,'손상 데이터 보호');
assert.equal(broken.values.get('online-work-notebook.standalone.v1'),'{');
const quota=boot({failWrite:true});
assert.equal(quota.run('save([])'),false,'저장 실패 반환');
assert.ok(quota.nodes.get('formMessage').textContent.includes('저장하지 못'));
assert.ok(broken.nodes.get('upcomingList').innerHTML.includes('저장된 일정을 읽을 수 없습니다'));
const upcoming=boot();
upcoming.run(`save([
 {id:'due-today',category:'work',date:today(),start:'09:00',end:'09:30',content:'오늘 일정'},
 {id:'due-seven',category:'personal',date:addDays(today(),7),start:'10:00',end:'10:30',content:'일주일 뒤 일정'},
 {id:'too-late',category:'work',date:addDays(today(),8),start:'09:00',end:'09:30',content:'다음 범위 일정'}
]);render()`);
assert.equal(upcoming.nodes.get('upcomingCount').textContent,'2건');
assert.ok(upcoming.nodes.get('upcomingList').innerHTML.includes('D-day'));
assert.ok(upcoming.nodes.get('upcomingList').innerHTML.includes('D-7'));
assert.ok(!upcoming.nodes.get('upcomingList').innerHTML.includes('too-late'));
upcoming.nodes.get('categoryFilter').value='work';
upcoming.nodes.get('categoryFilter').onchange();
upcoming.nodes.get('nextPeriod').onclick();
assert.equal(upcoming.nodes.get('upcomingCount').textContent,'2건','기간·분류 선택과 무관한 D-day 목록');
upcoming.nodes.get('upcomingList').handlers.click({target:{closest:()=>({dataset:{edit:'due-today'}})}});
assert.equal(upcoming.run('editingId'),'due-today','상단 일정에서 변경 진입');
upcoming.nodes.get('date').value=upcoming.run('addDays(today(),9)');
upcoming.nodes.get('scheduleForm').handlers.submit({preventDefault(){}});
assert.equal(upcoming.nodes.get('upcomingCount').textContent,'1건','변경 후 D-day 목록 갱신');
upcoming.nodes.get('upcomingList').handlers.click({target:{closest:()=>({dataset:{cancel:'due-seven'}})}});
assert.equal(upcoming.nodes.get('cancelDialog').open,true,'상단 일정 취소 확인');
upcoming.nodes.get('confirmCancel').onclick();
assert.equal(upcoming.nodes.get('upcomingCount').textContent,'0건');
assert.ok(upcoming.nodes.get('upcomingList').innerHTML.includes('처리할 일정이 없습니다'));
const signup=boot();
const beforeSignup=JSON.stringify([...signup.values]);
signup.nodes.get('openSignup').handlers.click();
assert.equal(signup.nodes.get('signupDialog').open,true);
signup.nodes.get('signupForm').handlers.submit({preventDefault(){}});
assert.equal(signup.nodes.get('signupError').hidden,false,'빈 이름 안내');
signup.nodes.get('signupName').value='테스트 사용자';
signup.nodes.get('signupPhone').value='010-0000';
signup.nodes.get('signupForm').handlers.submit({preventDefault(){}});
assert.equal(signup.nodes.get('signupResult').hidden,true,'잘못된 전화번호 거부');
signup.nodes.get('signupPhone').value='010-0000-0000';
signup.nodes.get('signupForm').handlers.submit({preventDefault(){}});
assert.equal(signup.nodes.get('signupResult').hidden,false);
assert.equal(signup.nodes.get('signupPreviewName').textContent,'테스트 사용자');
assert.equal(signup.nodes.get('signupPreviewPhone').textContent,'010-****-0000','전화번호 마스킹');
assert.equal(signup.nodes.get('signupPhone').value,'','입력 전화번호 원문 지우기');
assert.equal(JSON.stringify([...signup.values]),beforeSignup,'가입 체험 정보 미저장');
signup.nodes.get('closeSignup').handlers.click();
assert.equal(signup.nodes.get('signupPreviewName').textContent,'','닫기 후 이름 지우기');
assert.equal(signup.nodes.get('signupPreviewPhone').textContent,'','닫기 후 번호 지우기');
signup.nodes.get('openSignup').handlers.click();
assert.equal(signup.nodes.get('signupForm').hidden,false,'다시 열기 초기화');
console.log(`PASS: ${results.length} rule tests; CRUD, D-day, signup preview validation, masking, no persistence, close/reopen reset.`);
