'use strict';
const {AppError}=require('./core.cjs');
async function database(path,{method='GET',body,prefer}={}){
 const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!base||!key)throw new AppError(503,'온라인 DB 연결 설정이 필요합니다.');
 const response=await fetch(`${base.replace(/\/$/,'')}/rest/v1/${path}`,{
  method,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)
 });
 if(!response.ok){
  const error=await response.json().catch(()=>({}));
  if(error.code==='23P01')throw new AppError(409,'같은 시간에 다른 일정이 있습니다. 시간을 변경해 주세요.');
  if(error.code==='23505')throw new AppError(409,'이미 등록된 정보입니다. 기존 계정은 로그인해 주세요.');
  if(['23514','22007','22008'].includes(error.code))throw new AppError(400,'저장할 데이터 형식을 확인해 주세요.');
  throw new AppError(503,'DB에 연결하지 못했습니다. 설정 또는 연결 상태를 확인해 주세요.');
 }
 const text=await response.text();return text?JSON.parse(text):null;
}
module.exports=database;
