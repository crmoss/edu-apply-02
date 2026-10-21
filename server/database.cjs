'use strict';
const {AppError}=require('./core.cjs');
async function database(path,{method='GET',body,prefer}={}){
 const base=process.env.SUPABASE_URL?.trim(),key=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
 if(!base||!key)throw new AppError(503,'온라인 DB 연결 설정이 필요합니다.');
 let project;
 try{project=new URL(base);if(project.protocol!=='https:'||project.pathname!=='/'||project.search||project.hash||project.username||project.password)throw Error();}
 catch{throw new AppError(503,'DB 주소 설정 오류입니다. SUPABASE_URL에는 https://프로젝트ID.supabase.co 형식의 주소만 입력해 주세요.');}
 if(key.startsWith('sb_publishable_'))throw new AppError(503,'DB에 공개용 키가 입력되어 있습니다. Vercel의 SUPABASE_SERVICE_ROLE_KEY에 서버용 secret 또는 service_role 키를 등록해 주세요.');
 // 새 secret 키는 JWT가 아니므로 Authorization: Bearer에 넣지 않는다.
 let response;
 try{response=await fetch(`${project.origin}/rest/v1/${path}`,{
  method,headers:{apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)
 });}catch{throw new AppError(503,'Supabase 서버에 연결하지 못했습니다. 프로젝트가 중지되지 않았는지와 SUPABASE_URL을 확인해 주세요.');}
 if(!response.ok){
  const error=await response.json().catch(()=>({}));
  if(response.status===401)throw new AppError(503,'DB 키 인증에 실패했습니다. URL과 서버용 키가 같은 Supabase 프로젝트의 값인지 확인하고 Vercel에 다시 저장·배포해 주세요.');
  if(error.code==='PGRST202'||error.code==='42883')throw new AppError(503,'DB 함수가 없거나 API에 반영되지 않았습니다. Supabase SQL Editor에서 notebook_take_attempt 함수 생성 여부를 확인해 주세요. [DB_FUNCTION_MISSING]');
  if(error.code==='PGRST205'||error.code==='42P01')throw new AppError(503,'업무 수첩 DB 테이블을 찾지 못했습니다. 현재 프로젝트에 notebook_ 테이블이 생성됐는지 확인해 주세요. [DB_TABLE_MISSING]');
  if(response.status===403||error.code==='42501')throw new AppError(503,'DB 접근 권한이 부족합니다. 서버용 키와 초기 SQL의 service_role 권한 설정을 확인해 주세요. [DB_PERMISSION_DENIED]');
  if(error.code==='PGRST106')throw new AppError(503,'Supabase Data API의 공개 스키마 설정에서 public을 사용할 수 있는지 확인해 주세요. [DB_SCHEMA_NOT_EXPOSED]');
  if(response.status===404)throw new AppError(503,'Supabase Data API 주소를 찾지 못했습니다. 프로젝트 URL과 Data API 활성화 여부를 확인해 주세요. [DB_API_NOT_FOUND]');
  if(error.code==='23P01')throw new AppError(409,'같은 시간에 다른 일정이 있습니다. 시간을 변경해 주세요.');
  if(error.code==='23505')throw new AppError(409,'이미 등록된 정보입니다. 기존 계정은 로그인해 주세요.');
  if(['23514','22007','22008'].includes(error.code))throw new AppError(400,'저장할 데이터 형식을 확인해 주세요.');
  throw new AppError(503,'DB에 연결하지 못했습니다. 설정 또는 연결 상태를 확인해 주세요.');
 }
 const text=await response.text();return text?JSON.parse(text):null;
}
module.exports=database;
