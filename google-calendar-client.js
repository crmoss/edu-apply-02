'use strict';
// 순수 표시 함수: 시각 일정은 기기 시간대, 종일 일정은 원본 달력 날짜를 사용한다.
function googleDisplayEvents(events,first,last){
 const day=d=>`${String(d.getFullYear()).padStart(4,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 const time=d=>`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
 const output=[];
 for(const event of events){
  const start=event.allDay?event.startDate:day(new Date(event.startAt));
  // 종료 날짜/시각은 미포함. 자정에 끝나는 일정이 다음 날에 나타나지 않는다.
  const allDayEnd=event.allDay?new Date(event.endDate+'T12:00:00'):null;
  if(allDayEnd)allDayEnd.setDate(allDayEnd.getDate()-1);
  const end=event.allDay?day(allDayEnd):day(new Date(Date.parse(event.endAt)-1));
  let date=start<first?first:start;const final=end>last?last:end;
  while(date<=final){
   const startTime=event.allDay?'00:00':date===start?time(new Date(event.startAt)):'00:00';
   const endDay=event.allDay?'':day(new Date(event.endAt));
   const endTime=event.allDay?'24:00':date===endDay?time(new Date(event.endAt)):'24:00';
   output.push({id:'google:'+JSON.stringify([event.calendarId,event.eventId,date]),source:'google',date,start:startTime,end:endTime,
    displayTime:event.allDay?'종일':`${startTime} ~ ${endTime}`,category:event.category,content:event.title,calendarName:event.calendarName});
   if(output.length>=1000)return output;
   const next=new Date(date+'T12:00:00');next.setDate(next.getDate()+1);date=day(next);
  }
 }
 return output;
}
if(typeof module!=='undefined')module.exports={googleDisplayEvents};
if(typeof document!=='undefined'){
 let googleState=null,googleWorking=false,googleEpoch=0,availableCalendars=[],choicesReady=false;
 const el=id=>document.getElementById(id);
 function googleMessage(text){el('googleMessage').textContent=text;el('googleDialogMessage').textContent=text;}
 async function googleRequest(action,body){
  let response;
  try{response=await fetch('/api/google-calendar?action='+action,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(28000)});}catch{throw Error('구글 연결 서버에 접속하지 못했습니다.');}
  const data=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(data.error||'구글 요청을 처리하지 못했습니다.');error.status=response.status;throw error;}return data;
 }
 function updateGoogleUI(){
  el('googlePanel').hidden=!currentUser;
  el('googleManage').disabled=googleWorking||!googleState?.configured;
  el('googleSync').hidden=googleState?.status!=='connected';el('googleSync').disabled=googleWorking;
  const labels={connected:'연결됨',disconnected:'연결 안 됨',reconnect:'다시 연결 필요',revocation_pending:'권한 해제 재시도 필요'};
  const state=googleState;
  el('googleStatus').textContent=!state?'연결 상태 확인 중':!state.configured?'구글 연결 준비 중':`구글 ${labels[state.status]||'상태 확인 필요'}${state.lastSynced?' · 마지막 갱신 '+new Date(state.lastSynced).toLocaleString():''}`;
  const range=state?.rangeStart?`${new Date(state.rangeStart).toLocaleDateString()} ~ ${new Date(state.rangeEnd).toLocaleDateString()} 범위 · 기기 시간대 기준 · 화면당 구글 일정 최대 1,000건`:'';
  el('googleRange').textContent=range;
  el('googleDisconnect').hidden=!state||!state.configured||state.status==='disconnected'&&!state.events?.length;
  el('googleDisconnect').textContent=state?.status==='revocation_pending'?'구글 권한 해제 다시 시도':'연결 해제';
  el('googleConnectForm').hidden=state?.status==='revocation_pending';
  el('googleConnectSubmit').textContent=state?.status==='connected'?'구글 계정 다시 연결':'구글 계정 연결';
  el('googleChoicesForm').hidden=state?.status!=='connected';
  el('googleChoicesSubmit').disabled=googleWorking||!choicesReady;
  el('googleConnectSubmit').disabled=googleWorking;el('googleDisconnect').disabled=googleWorking;
 }
 async function loadGoogleStatus(epoch){
  const data=await googleRequest('status');if(epoch!==googleEpoch||!currentUser)return false;
  googleState=data;externalEvents=data.events||[];updateGoogleUI();render();return true;
 }
 async function syncGoogle(selected,automatic=false){
  if(googleWorking||!currentUser)return;const epoch=googleEpoch;googleWorking=true;updateGoogleUI();
  try{
   const result=await googleRequest('sync',selected===undefined?{}:{selected});if(epoch!==googleEpoch)return;
   await loadGoogleStatus(epoch);
   googleMessage(result.selectRequired?'연결 설정에서 가져올 캘린더를 선택해 주세요.':'구글 일정을 갱신했습니다.');
  }catch(error){if(epoch===googleEpoch){if(error.status===401)setCurrentUser(null);else if(!automatic||error.status!==429)googleMessage(error.message);}}
  finally{if(epoch===googleEpoch){googleWorking=false;updateGoogleUI();}}
 }
 // 앱이 계정을 바꿀 때 즉시 캐시/대화상자/입력을 지우며 이전 비동기 결과를 버린다.
 globalThis.googleAccountChanged=function(){
  const epoch=++googleEpoch;googleState=null;externalEvents=[];availableCalendars=[];choicesReady=false;googleWorking=false;
  el('googleChoices').replaceChildren();el('googleDialog').close();googleMessage('');updateGoogleUI();
  if(currentUser)loadGoogleStatus(epoch).then(ok=>{if(ok&&epoch===googleEpoch&&googleState.status==='connected'&&googleState.selected.length&&(!googleState.lastSynced||Date.now()-Date.parse(googleState.lastSynced)>5*60000))return syncGoogle(undefined,true);}).catch(error=>{if(epoch===googleEpoch)googleMessage(error.message);});
 };
 el('googleManage').onclick=async()=>{
  if(googleWorking)return;const epoch=googleEpoch;el('googleDialog').showModal();googleMessage('');updateGoogleUI();
  if(googleState?.status!=='connected')return;
  googleWorking=true;choicesReady=false;el('googleChoices').replaceChildren();updateGoogleUI();
  try{
   const data=await googleRequest('calendars',{});if(epoch!==googleEpoch)return;availableCalendars=data.calendars;
   el('googleChoices').innerHTML=availableCalendars.map((c,i)=>{const chosen=googleState.selected.find(s=>s.id===c.id);return `<div class="google-choice"><label><input type="checkbox" data-google-index="${i}" ${chosen?'checked':''}> ${esc(c.name)}</label><select aria-label="${esc(c.name)} 분류" data-google-category="${i}"><option value="work">업무</option><option value="personal" ${chosen?.category==='personal'?'selected':''}>개인</option></select></div>`;}).join('');choicesReady=true;
  }catch(error){if(epoch===googleEpoch)googleMessage(error.message);}
  finally{if(epoch===googleEpoch){googleWorking=false;updateGoogleUI();}}
 };
 el('googleConnectForm').onsubmit=async e=>{
  e.preventDefault();if(googleWorking)return;const epoch=googleEpoch;googleWorking=true;updateGoogleUI();
  try{const data=await googleRequest('start',{});if(epoch!==googleEpoch)return;const url=new URL(data.url);if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth')throw Error('연결 주소를 확인할 수 없습니다.');window.location.assign(url.href);}
  catch(error){if(epoch===googleEpoch)googleMessage(error.message);}
  finally{if(epoch===googleEpoch){googleWorking=false;updateGoogleUI();}}
 };
 el('googleChoicesForm').onsubmit=async e=>{
  e.preventDefault();if(googleWorking||!choicesReady)return;
  const selected=[...el('googleChoices').querySelectorAll('[data-google-index]:checked')].map(input=>({id:availableCalendars[Number(input.dataset.googleIndex)].id,category:el('googleChoices').querySelector(`[data-google-category="${input.dataset.googleIndex}"]`).value}));
  if(selected.length>3){googleMessage('캘린더는 최대 3개까지 선택해 주세요.');return;}
  await syncGoogle(selected);
 };
 el('googleDisconnect').onclick=async()=>{
  if(googleWorking)return;const epoch=googleEpoch;googleWorking=true;updateGoogleUI();
  try{await googleRequest('disconnect',{removeEvents:el('googleRemoveEvents').checked});if(epoch===googleEpoch){await loadGoogleStatus(epoch);googleMessage('구글 연결을 해제했습니다.');}}
  catch(error){if(epoch===googleEpoch){await loadGoogleStatus(epoch).catch(()=>{});googleMessage(error.message);}}
  finally{if(epoch===googleEpoch){googleWorking=false;updateGoogleUI();}}
 };
 el('googleSync').onclick=()=>syncGoogle();
 el('googleClose').onclick=()=>el('googleDialog').close();
 const url=new URL(window.location.href);const result=url.searchParams.get('google');
 if(result){el('googleCallbackMessage').textContent=result==='connected'?'구글이 연결되었습니다. 연결 설정에서 가져올 캘린더를 선택해 주세요.':'구글 연결을 완료하지 못했습니다. 로그인 상태와 권한 동의를 확인한 뒤 다시 시도해 주세요.';url.searchParams.delete('google');window.history.replaceState(null,'',url.pathname+url.search+url.hash);}
}
