'use strict';
let authMode='login',authWorking=false,authEpoch=0;
function authError(text){$('signupError').textContent=text;$('signupError').hidden=false;}
function clearAuthInputs(){for(const id of ['signupPhone','signupPassword','signupPasswordConfirm'])$(id).value='';$('signupError').hidden=true;$('signupError').textContent='';}
function selectAuthMode(mode){
 authMode=mode;clearAuthInputs();$('passwordConfirmField').hidden=mode!=='signup';
 $('signupPassword').setAttribute('autocomplete',mode==='signup'?'new-password':'current-password');
 $('signupHeading').textContent=mode==='signup'?'회원가입':'로그인';$('authSubmit').textContent=$('signupHeading').textContent;
 $('loginTab').setAttribute('aria-pressed',String(mode==='login'));$('registerTab').setAttribute('aria-pressed',String(mode==='signup'));
}
function updateAuthUI(){
 $('openSignup').hidden=!!currentUser;$('logoutButton').hidden=!currentUser;$('accountPhone').hidden=!currentUser;
 $('accountPhone').textContent=currentUser?.phone||'';
 $('accountMessage').textContent=currentUser?'로그인한 계정의 일정만 DB에서 조회·저장합니다. 다른 기기에서 변경한 내용은 다시 조회해 주세요.':'휴대폰 번호와 비밀번호로 로그인하면 나의 일정을 조회·저장할 수 있습니다.';
 $('legacyImport').hidden=true;
 if(currentUser){try{const items=readData(localStorage.getItem(KEY));if(items.length){$('legacyImportInfo').textContent=`기존 브라우저 일정 ${items.length}건이 있습니다. 현재 계정에 복사하며 브라우저 원본은 유지합니다.`;$('legacyImport').hidden=false;}}catch{$('accountMessage').textContent+=' 기존 브라우저 일정은 읽을 수 없어 자동으로 이전하지 않습니다.';}}
}
$('openSignup').addEventListener('click',()=>{if(busy||authWorking)return;selectAuthMode('login');$('signupDialog').showModal();$('signupPhone').focus();});
$('closeSignup').addEventListener('click',()=>{if(!authWorking)$('signupDialog').close();});
$('signupDialog').addEventListener('close',clearAuthInputs);
$('signupDialog').addEventListener('cancel',e=>{if(authWorking)e.preventDefault();});
$('loginTab').onclick=()=>{if(!authWorking)selectAuthMode('login');};$('registerTab').onclick=()=>{if(!authWorking)selectAuthMode('signup');};
$('signupForm').addEventListener('submit',async e=>{
 e.preventDefault();if(authWorking||busy)return;
 const phone=$('signupPhone').value.trim(),password=$('signupPassword').value,confirm=$('signupPasswordConfirm').value;
 if(!/^010\d{8}$/.test(phone.replace(/[\s-]/g,''))||!/^[\d\s-]+$/.test(phone)){authError('010으로 시작하는 휴대폰 번호 11자리를 입력해 주세요.');return;}
 if(password.length<12||password.length>128){authError('비밀번호는 12~128자로 입력해 주세요.');return;}
 if(authMode==='signup'&&password!==confirm){authError('비밀번호 확인이 일치하지 않습니다.');return;}
 authWorking=true;authEpoch++;$('authSubmit').disabled=true;
 try{const data=await NotebookAPI.request(authMode,{phone,password,...(authMode==='signup'?{passwordConfirm:confirm}:{})});setCurrentUser(data.user);$('signupDialog').close();await refresh();render();}
 catch(error){authError(error.message);}
 finally{authWorking=false;$('authSubmit').disabled=false;}
});
$('logoutButton').onclick=async()=>{
 if(busy||authWorking)return;authWorking=true;authEpoch++;$('logoutButton').disabled=true;
 try{await NotebookAPI.request('logout',{});setCurrentUser(null);}
 catch(error){message(error.message,true);}
 finally{authWorking=false;$('logoutButton').disabled=false;}
};
$('importSchedules').onclick=async()=>{
 if(busy||!currentUser)return;const userId=currentUser.id;busy=true;updateSaveButton();$('importSchedules').disabled=true;
 try{
  const legacy=readData(localStorage.getItem(KEY));
  await NotebookAPI.request('import',{schedules:legacy});
  if(currentUser?.id===userId){if(await refresh()){render();message('기존 일정이 현재 계정의 DB로 복사되었습니다. 재실행해도 같은 일정은 중복 복사되지 않습니다.');}}
 }catch(error){if(currentUser?.id===userId){if(error.status===401)setCurrentUser(null);message(error.message,true);}}
 finally{busy=false;updateSaveButton();$('importSchedules').disabled=false;}
};
// 쿠키 세션 확인 후에만 사용자 데이터를 가져온다. 인증 실패 시 로컬 저장으로 대체하지 않는다.
async function initializeAccount(){
 const epoch=authEpoch;
 try{const data=await NotebookAPI.request('session');if(epoch!==authEpoch)return;setCurrentUser(data.user);await refresh();render();}
 catch(error){if(epoch!==authEpoch)return;setCurrentUser(null);if(error.status!==401)$('accountMessage').textContent=error.message;}
}
initializeAccount();
