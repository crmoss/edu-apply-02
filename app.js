'use strict';
const KEY='online-work-notebook.standalone.v1', $=id=>document.getElementById(id);
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
let schedules=[],anchor=today(),view='week',editingId=null,editingVersion=null,pendingCancel=null,pendingCancelVersion=null,storageHealthy=false,navSelection='currentPeriod',currentUser=null,busy=false;
function message(text,error=false){$('formMessage').textContent=text;$('formMessage').classList.remove('hidden');$('formMessage').classList.toggle('error',error)}
function updateSaveButton(){ $('submitBtn').disabled=busy||!currentUser||!storageHealthy; }
function setCurrentUser(user){currentUser=user;schedules=[];storageHealthy=false;resetForm();$('cancelDialog').close();$('formMessage').classList.add('hidden');$('storageBadge').textContent=user?'DB 조회 중':'로그인 필요';updateSaveButton();render();if(typeof updateAuthUI==='function')updateAuthUI();}
async function refresh(){
 const userId=currentUser?.id;if(!userId){updateSaveButton();return false;}
 try{const data=await NotebookAPI.request('list');if(currentUser?.id!==userId)return false;readData(JSON.stringify(data.schedules));schedules=data.schedules;storageHealthy=true;$('storageBadge').textContent='온라인 DB 연결';updateSaveButton();return true;}
 catch(error){if(currentUser?.id!==userId)return false;if(error.status===401)setCurrentUser(null);else{schedules=[];storageHealthy=false;$('storageBadge').textContent='DB 조회 실패';}message(error.message,true);updateSaveButton();render();return false;}
}
async function save(next){
 const userId=currentUser?.id;if(!userId){message('로그인 후 일정을 저장해 주세요.',true);return false;}
 const removed=schedules.find(s=>!next.some(n=>n.id===s.id));
 const changed=next.find(n=>{const old=schedules.find(s=>s.id===n.id);return !old||JSON.stringify(n)!==JSON.stringify(old)});
 try{
  let data;
  if(removed){data=await NotebookAPI.request('delete',{id:removed.id,version:pendingCancelVersion||removed.version});}
  else if(changed){const old=schedules.find(s=>s.id===changed.id);data=await NotebookAPI.request(old?'update':'create',{...changed,...(old?{version:editingVersion||old.version}:{})});}
  else return true;
  if(currentUser?.id!==userId)return false;
  schedules=removed?schedules.filter(s=>s.id!==removed.id):schedules.filter(s=>s.id!==changed.id).concat(data.schedule);
  $('storageBadge').textContent='DB 저장 완료';return true;
 }catch(error){if(currentUser?.id===userId){if(error.status===401)setCurrentUser(null);message(error.message,true);if(error.status===409){await refresh();render();}}return false;}
}
function period(){if(view==='week'){const first=sunday(anchor);return {first,last:addDays(first,6)}}const d=parseDate(anchor);d.setDate(1);const first=localDate(d);d.setMonth(d.getMonth()+1,0);return {first,last:localDate(d)}}
function selectPeriodForAnchor(){const {first,last}=period();navSelection=today()<first?'nextPeriod':today()>last?'prevPeriod':'currentPeriod'}
function actions(s){return `<div class="item-actions"><button data-edit="${esc(s.id)}" aria-label="일정 변경">변경</button><button class="danger" data-cancel="${esc(s.id)}" aria-label="일정 취소">취소</button></div>`}
function card(s){return `<article class="booking ${s.category==='personal'?'personal':''}"><div class="booking-time">${s.start} ~ ${s.end}</div><p class="booking-title" data-content="${esc(s.id)}"></p><div class="booking-category">${categoryName(s.category)}</div>${actions(s)}</article>`}
function ddayBadge(date,base){
 const days=daysUntil(date,base),tone=days===0?'due-today':days>0&&days<=7?'due-soon':days<0?'due-past':'';
 return `<span class="dday-badge ${tone}">${ddayLabel(date,base)}</span>`;
}
function renderUpcoming(base){
 const items=upcomingSchedules(schedules,base);
 $('upcomingCount').textContent=`${items.length}건`;
 $('upcomingDescription').textContent=`${base} 기준 · 오늘부터 7일 후까지 · 전체 업무·개인 일정 (아래 기간·분류 선택과 무관)`;
 $('upcomingList').innerHTML=!currentUser?'<p class="upcoming-empty">로그인하면 나의 D-day 일정을 확인할 수 있습니다.</p>':!storageHealthy?'<p class="upcoming-empty">DB 일정을 조회하지 못했거나 조회 중입니다. 다시 조회해 주세요.</p>':items.length?items.map(s=>`<div class="upcoming-item ${s.category==='personal'?'upcoming-personal':'upcoming-work'}"><div class="upcoming-meta">${ddayBadge(s.date,base)}<span>${s.date}</span></div>${card(s)}</div>`).join(''):'<p class="upcoming-empty">오늘부터 7일 이내에 처리할 일정이 없습니다.</p>';
}
function render(){
 const base=today();
 renderUpcoming(base);
 const {first,last}=period(),filter=$('categoryFilter').value;
 const items=schedules.filter(s=>s.date>=first&&s.date<=last&&(filter==='all'||s.category===filter)).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
 $('calendarHeading').textContent=view==='week'?'주간 일정 현황':'월간 일정 현황';
 $('periodTitle').textContent=view==='week'?`${first} ~ ${last}`:`${Number(first.slice(0,4))}년 ${Number(first.slice(5,7))}월`;
 for(const [id,label] of [['prevPeriod','이전'],['currentPeriod','이번'],['nextPeriod','다음']]){$(id).textContent=label+(view==='week'?' 주':' 달');$(id).classList.toggle('selected',navSelection===id);$(id).setAttribute('aria-pressed',String(navSelection===id))}
 for(const mode of ['week','month']){$(mode+'View').classList.toggle('selected',view===mode);$(mode+'View').setAttribute('aria-pressed',String(view===mode))}
 $('periodCount').textContent=`표시 중인 일정 ${items.length}건 · 업무 ${items.filter(s=>s.category==='work').length}건 · 개인 ${items.filter(s=>s.category==='personal').length}건`;
 const names=['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];
 const redDay=i=>i===0||i===6;
 if(view==='week'){
  const days=Array.from({length:7},(_,i)=>addDays(first,i));
  $('calendarCaption').textContent='일요일부터 토요일까지의 일정입니다. 분류별로 시간을 확인하세요.';
  $('calendarHead').innerHTML='<tr><th scope="col" class="calendar-category">분류</th>'+days.map((d,i)=>`<th scope="col" class="${d===today()?'today-head':''} ${redDay(i)?'red-day':''}">${names[i]}<span>${Number(d.slice(5,7))}월 ${Number(d.slice(8))}일${d===today()?' · 오늘':''}</span></th>`).join('')+'</tr>';
  $('calendarBody').innerHTML=['work','personal'].filter(c=>filter==='all'||c===filter).map(c=>`<tr><th scope="row">${categoryName(c)}</th>${days.map(d=>{const dayItems=items.filter(s=>s.date===d&&s.category===c);return `<td>${dayItems.map(card).join('')}</td>`}).join('')}</tr>`).join('');
 }else{
  $('calendarCaption').textContent='일요일부터 토요일 순서의 월간 일정입니다. 선택한 달의 일정만 표시합니다.';
  $('calendarHead').innerHTML='<tr>'+names.map((n,i)=>`<th scope="col" class="${redDay(i)?'red-day':''}">${n}</th>`).join('')+'</tr>';
  const gridStart=sunday(first),offset=parseDate(first).getDay(),total=Math.ceil((offset+Number(last.slice(8)))/7)*7;
  let html='';for(let i=0;i<total;i++){if(i%7===0)html+='<tr>';const d=addDays(gridStart,i),inside=d>=first&&d<=last,dayItems=items.filter(s=>s.date===d);html+=`<td class="${!inside?'outside':d===today()?'today-cell':''}"><p class="day-label ${redDay(i%7)?'red-day':''}">${Number(d.slice(8))}일${d===today()?' · 오늘':''}</p>${inside?dayItems.map(card).join(''):''}</td>`;if(i%7===6)html+='</tr>'}$('calendarBody').innerHTML=html;
 }
 $('listSummary').textContent=`${$('periodTitle').textContent} · ${filter==='all'?'전체 분류':categoryName(filter)} · 총 ${items.length}건`;
 $('scheduleList').innerHTML=items.length?items.map(s=>`<tr><td>${s.date}</td><td>${ddayBadge(s.date,base)}</td><td>${s.start} ~ ${s.end}</td><td>${categoryName(s.category)}</td><td data-content="${esc(s.id)}"></td><td>${actions(s)}</td></tr>`).join(''):'<tr><td colspan="6" class="empty-table">선택한 기간에 등록된 일정이 없습니다. 아래에서 새 일정을 등록해 주세요.</td></tr>';
 const byId=new Map(schedules.map(s=>[s.id,s]));
 document.querySelectorAll('[data-content]').forEach(el=>{el.textContent=byId.get(el.dataset.content)?.content||''});
 document.querySelectorAll('[data-edit],[data-cancel]').forEach(el=>{const s=byId.get(el.dataset.edit||el.dataset.cancel);if(s)el.setAttribute('aria-label',`${s.content} 일정 ${el.dataset.edit?'변경':'취소'}`)});
}
const getTime=id=>`${$(id+'Hour').value}:${$(id+'Minute').value}`;
function syncEndMinute(){const hour=$('endHour').value,boundary=hour==='07'||hour==='23';if(boundary)$('endMinute').value=hour==='07'?'30':'00';$('endMinute').disabled=boundary}
function setTime(id,value){const clamped=timeLabel(Math.max(id==='start'?420:450,Math.min(id==='start'?1350:1380,minutes(value))));const [hour,minute]=clamped.split(':');$(id+'Hour').value=hour;$(id+'Minute').value=minute;if(id==='end')syncEndMinute()}
function resetForm(){editingId=null;editingVersion=null;$('scheduleForm').reset();$('date').value=today();setTime('start','09:00');setTime('end','09:30');$('formHeading').textContent='일정 등록하기';$('submitBtn').textContent='일정 등록';$('cancelEdit').classList.add('hidden')}
for(const id of ['start','end'])$(id+'Hour').innerHTML=Array.from({length:id==='end'?17:16},(_,i)=>{const hour=String(i+7).padStart(2,'0');return `<option value="${hour}">${hour}시</option>`}).join('');
resetForm();updateSaveButton();render();
function adjustEnd(){setTime('end',timeLabel(minutes(getTime('start'))+30))}
$('startHour').onchange=adjustEnd;$('startMinute').onchange=adjustEnd;$('endHour').onchange=syncEndMinute;
$('scheduleForm').addEventListener('submit',async e=>{
 e.preventDefault();if(busy)return;if(!currentUser){message('로그인 후 일정을 등록해 주세요.',true);return;}if(!storageHealthy){message('DB 일정을 먼저 조회해 주세요.',true);return;}
 const s={id:editingId||uid(),category:$('category').value,date:$('date').value,start:getTime('start'),end:getTime('end'),content:$('content').value.trim()};
 if(!['work','personal'].includes(s.category)||!parseDate(s.date)||!validTime(s.start)||!validTime(s.end,true)||!s.content||s.content.length>200){message('분류, 날짜, 30분 단위의 시간과 일정 내용을 올바르게 입력해 주세요.',true);return}
 if(s.start>=s.end){message('종료 시간은 시작 시간보다 늦어야 합니다.',true);return}
 if(minutes(s.start)<420||minutes(s.end)>1380){message('일정은 07:00~23:00 사이에 등록해 주세요. 마지막 시작 시간은 22:30입니다.',true);return}
 if(editingId&&!schedules.some(x=>x.id===editingId)){message('변경할 일정이 이미 취소되었습니다. 변경 취소 후 다시 등록해 주세요.',true);render();return}
 const conflict=schedules.find(x=>x.id!==s.id&&overlaps(x,s));
 if(conflict){message(`중복 일정입니다. ${conflict.date} ${conflict.start} ~ ${conflict.end}에 [${categoryName(conflict.category)}] ${conflict.content} 일정이 있습니다. 다른 시간을 선택해 주세요.`,true);render();return}
 const wasEditing=!!editingId,next=editingId?schedules.map(x=>x.id===editingId?s:x):[...schedules,s];
 busy=true;updateSaveButton();try{if(await save(next)){anchor=s.date;selectPeriodForAnchor();$('categoryFilter').value='all';resetForm();render();message(wasEditing?'일정이 DB에서 변경되었습니다.':'일정이 DB에 등록되었습니다.')}}finally{busy=false;updateSaveButton();}
});
$('cancelEdit').onclick=()=>{resetForm();message('일정 변경을 취소했습니다.')};
function movePeriod(n){const d=parseDate(anchor);if(view==='week')d.setDate(d.getDate()+n*7);else{d.setDate(1);d.setMonth(d.getMonth()+n)}if(d.getFullYear()<1||d.getFullYear()>9999)return;anchor=localDate(d);navSelection=n<0?'prevPeriod':'nextPeriod';render()}
$('prevPeriod').onclick=()=>movePeriod(-1);$('nextPeriod').onclick=()=>movePeriod(1);$('currentPeriod').onclick=()=>{anchor=today();navSelection='currentPeriod';render()};
$('weekView').onclick=()=>{view='week';selectPeriodForAnchor();render()};$('monthView').onclick=()=>{view='month';selectPeriodForAnchor();render()};$('categoryFilter').onchange=render;
function handleAction(e){
 const button=e.target.closest('[data-edit],[data-cancel]');if(!button||busy||!currentUser||!storageHealthy)return;
 const s=schedules.find(x=>x.id===(button.dataset.edit||button.dataset.cancel));if(!s){render();message('이미 취소된 일정입니다.',true);return}
 if(button.dataset.edit){editingId=s.id;editingVersion=s.version;for(const id of ['category','date','content'])$(id).value=s[id];setTime('start',s.start);setTime('end',s.end);$('formHeading').textContent='일정 변경하기';$('submitBtn').textContent='변경 저장';$('cancelEdit').classList.remove('hidden');message('일정을 수정한 후 변경 저장을 눌러 주세요.');$('scheduleForm').scrollIntoView({behavior:'smooth',block:'center'});$('content').focus({preventScroll:true})}
 else{pendingCancel=s.id;pendingCancelVersion=s.version;$('cancelDescription').textContent=`${s.date} ${s.start} ~ ${s.end} / ${categoryName(s.category)} / ${s.content}. 취소하면 DB에서 삭제됩니다.`;$('cancelDialog').showModal()}
}
$('calendarBody').addEventListener('click',handleAction);$('scheduleList').addEventListener('click',handleAction);
$('upcomingList').addEventListener('click',handleAction);
$('keepSchedule').onclick=()=>$('cancelDialog').close();$('cancelDialog').addEventListener('close',()=>{pendingCancel=null;pendingCancelVersion=null});
$('confirmCancel').onclick=async()=>{const id=pendingCancel;if(!id||busy)return;busy=true;updateSaveButton();try{if(await save(schedules.filter(s=>s.id!==id))){if(editingId===id)resetForm();$('cancelDialog').close();render();message('일정이 DB에서 삭제되었습니다.')}}finally{busy=false;updateSaveButton();}};
$('reloadSchedules').onclick=async()=>{if(busy)return;busy=true;updateSaveButton();try{if(await refresh())render();}finally{busy=false;updateSaveButton();}};
