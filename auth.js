'use strict';
// 본인 구글 계정 로그인·로그아웃과 기존 일정 가져오기.
let authWorking=false,authEpoch=0,loginConfigured=false,loginFeedback='';
function authError(text){$('loginError').textContent=text;$('loginError').hidden=false;}
function updateAuthUI(){
 $('openLogin').hidden=!!currentUser;$('logoutButton').hidden=!currentUser;$('accountEmail').hidden=!currentUser;
 $('accountEmail').textContent=currentUser?.email||'';
 $('accountMessage').textContent=currentUser?'':loginFeedback||'본인 구글 계정으로 로그인하세요.';
 $('accountMessage').hidden=!!currentUser;$('legacyImport').hidden=true;
 if(currentUser){try{const items=readData(localStorage.getItem(KEY));if(items.length){$('legacyImportInfo').textContent=`기존 브라우저 일정 ${items.length}건 · 원본을 유지하고 내 계정에 복사합니다.`;$('legacyImport').hidden=false;}}catch{$('accountMessage').textContent='기존 브라우저 일정을 읽을 수 없습니다.';$('accountMessage').hidden=false;}}
 $('accountPanel').hidden=$('accountMessage').hidden&&$('legacyImport').hidden;
}
async function loginRequest(action,body){
 let response;
 try{response=await fetch('/api/google-login?action='+action,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});}catch{throw Error('구글 로그인 서버에 연결하지 못했습니다.');}
 const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'로그인을 시작하지 못했습니다.');return data;
}
$('openLogin').addEventListener('click',()=>{if(busy||authWorking)return;$('loginError').hidden=true;$('loginDialog').showModal();if(!loginConfigured)authError('구글 로그인 설정이 아직 완료되지 않았습니다.');});
$('closeLogin').onclick=()=>{if(!authWorking)$('loginDialog').close();};
$('loginDialog').addEventListener('cancel',e=>{if(authWorking)e.preventDefault();});
$('authSubmit').onclick=async()=>{
 if(busy||authWorking||!loginConfigured)return;authWorking=true;authEpoch++;$('authSubmit').disabled=true;
 try{const data=await loginRequest('start',{}),url=new URL(data.url);if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth')throw Error('로그인 주소를 확인할 수 없습니다.');window.location.assign(url.href);}
 catch(error){authError(error.message);}
 finally{authWorking=false;$('authSubmit').disabled=!loginConfigured;}
};
$('logoutButton').onclick=async()=>{
 if(busy||authWorking)return;authWorking=true;authEpoch++;$('logoutButton').disabled=true;
 try{await NotebookAPI.request('logout',{});loginFeedback='';setCurrentUser(null);}
 catch(error){message(error.message,true);}
 finally{authWorking=false;$('logoutButton').disabled=false;}
};
$('importSchedules').onclick=async()=>{
 if(busy||!currentUser)return;const userId=currentUser.id;busy=true;updateSaveButton();$('importSchedules').disabled=true;
 try{const legacy=readData(localStorage.getItem(KEY));await NotebookAPI.request('import',{schedules:legacy});if(currentUser?.id===userId&&await refresh()){render();message('기존 일정이 현재 계정의 DB로 복사되었습니다.');}}
 catch(error){if(currentUser?.id===userId){if(error.status===401)setCurrentUser(null);message(error.message,true);}}
 finally{busy=false;updateSaveButton();$('importSchedules').disabled=false;}
};
async function initializeAccount(){
 const epoch=authEpoch;
 try{const data=await NotebookAPI.request('session');if(epoch!==authEpoch)return;setCurrentUser(data.user);await refresh();render();}
 catch(error){if(epoch!==authEpoch)return;setCurrentUser(null);if(error.status!==401){$('accountMessage').textContent=error.message;$('accountPanel').hidden=false;}}
}
const loginURL=new URL(window.location.href),loginResult=loginURL.searchParams.get('login');
if(loginResult){
 loginFeedback=loginResult==='setup-required'?'기존 일정 계정 ID 설정이 필요합니다. 개인용 로그인 설정 안내를 확인해 주세요.':loginResult==='success'?'':loginResult==='denied'?'허용된 본인 계정으로 로그인해 주세요.':'로그인을 완료하지 못했습니다. 본인 구글 계정으로 다시 시도해 주세요.';
 loginURL.searchParams.delete('login');window.history.replaceState(null,'',loginURL.pathname+loginURL.search+loginURL.hash);
}
loginRequest('status').then(data=>{loginConfigured=data.configured;$('authSubmit').disabled=!loginConfigured;}).catch(error=>authError(error.message));
initializeAccount();
