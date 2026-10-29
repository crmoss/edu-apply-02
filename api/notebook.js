'use strict';
const {randomBytes,randomUUID,createHmac}=require('node:crypto');
const productionDatabase=require('../server/database.cjs');
const {AppError,phoneNumber,passwordValid,digest,hashPassword,verifyPassword,scheduleInput,scheduleOutput,uuid}=require('../server/core.cjs');
// 로컬 서버가 명시적으로 구성할 때만 별도 DB·HTTP 쿠키를 사용한다.
function createHandler({database=productionDatabase,localOrigin,localRateSecret}={}){
if(localOrigin){const origin=new URL(localOrigin);if(origin.protocol!=='http:'||!['127.0.0.1','localhost'].includes(origin.hostname)||origin.origin!==localOrigin)throw Error('Local mode requires an exact loopback HTTP origin');}
const COOKIE=localOrigin?'notebook_local_session':'__Host-notebook_session';
const duration=7*24*60*60;
function cookieToken(req){const cookie=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='));return cookie?cookie.slice(COOKIE.length+1):'';}
function setCookie(res,token,maxAge=duration){res.setHeader('Set-Cookie',`${COOKIE}=${token}; Path=/; HttpOnly;${localOrigin?'':' Secure;'} SameSite=Lax; Max-Age=${maxAge}`);}
async function account(req){
 const token=cookieToken(req);if(!/^[a-f0-9]{64}$/.test(token))throw new AppError(401,'로그인이 필요합니다.');
 const rows=await database(`notebook_sessions?token_hash=eq.${digest(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=user_id&limit=1`);
 if(!rows.length)throw new AppError(401,'로그인이 만료되었습니다. 다시 로그인해 주세요.');
 return rows[0].user_id;
}
async function throttle(req,phone,action){
 const secret=localOrigin?localRateSecret:process.env.RATE_LIMIT_SECRET;if(!secret||secret.length<32)throw new AppError(503,'서버 인증 설정이 필요합니다.');
 // Vercel이 설정한 IP 헤더를 사용한다. 개발 환경은 고정 버킷을 사용한다.
 const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||'unknown').split(',')[0].trim();
 for(const [type,value,limit] of [['ip',ip,30],['phone',phone,10]]){
  const key=createHmac('sha256',secret).update(`${action}:${type}:${value}`).digest('hex');
  const allowed=await database('rpc/notebook_take_attempt',{method:'POST',body:{p_key:key,p_limit:limit}});
  if(!allowed)throw new AppError(429,'요청이 많습니다. 15분 후 다시 시도해 주세요.');
 }
}
async function newSession(userId,res,req){
 const token=randomBytes(32).toString('hex');
 await database('notebook_sessions',{method:'POST',body:{token_hash:digest(token),user_id:userId,expires_at:new Date(Date.now()+duration*1000).toISOString()}});
 const old=cookieToken(req);if(/^[a-f0-9]{64}$/.test(old))await database(`notebook_sessions?token_hash=eq.${digest(old)}`,{method:'DELETE'});
 setCookie(res,token);
}
async function list(userId){
 const all=[];
 for(let offset=0;offset<=10000;offset+=1000){
  const rows=await database(`notebook_schedules?user_id=eq.${userId}&order=schedule_date.asc,start_minute.asc,id.asc&limit=1000&offset=${offset}`);
  all.push(...rows);if(all.length>10000)throw new AppError(413,'일정이 10,000건을 초과했습니다. 기간별 조회 기능 확장이 필요합니다.');
  if(rows.length<1000)return all.map(scheduleOutput);
 }
}
async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{
  if(!localOrigin&&(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY))throw new AppError(503,'온라인 DB 연결 설정이 아직 완료되지 않았습니다.');
  const action=String(req.query?.action||'session');
  if(!['GET','POST'].includes(req.method))throw new AppError(405,'허용되지 않은 요청입니다.');
  if(req.method==='POST'){
   const expected=localOrigin||process.env.APP_ORIGIN;
   if(!expected||req.headers.origin!==new URL(expected).origin)throw new AppError(403,'허용되지 않은 접속 주소입니다.');
   if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new AppError(415,'JSON 요청이 필요합니다.');
  }
  let body=req.body||{};if(typeof body==='string'){if(Buffer.byteLength(body)>262144)throw new AppError(413,'요청이 너무 큽니다.');body=JSON.parse(body);}
  if(Buffer.byteLength(JSON.stringify(body))>262144)throw new AppError(413,'요청이 너무 큽니다.');
  if(!body||typeof body!=='object'||Array.isArray(body))throw new AppError(400,'잘못된 요청입니다.');
  if(['signup','login'].includes(action)){
   if(req.method!=='POST')throw new AppError(405,'POST 요청이 필요합니다.');
   const phone=phoneNumber(body.phone);passwordValid(body.password);await throttle(req,phone,action);
   let user;
   if(action==='signup'){
    if(body.password!==body.passwordConfirm)throw new AppError(400,'비밀번호 확인이 일치하지 않습니다.');
    const rows=await database('notebook_users',{method:'POST',body:{phone,password_hash:await hashPassword(body.password)},prefer:'return=representation'});user=rows[0];
   }else{
    const rows=await database(`notebook_users?phone=eq.${phone}&select=id,password_hash&limit=1`);user=rows[0];
    // 계정이 없는 경우에도 같은 비용의 해시 계산을 수행한다.
    const valid=user?await verifyPassword(body.password,user.password_hash):(await hashPassword(body.password),false);
    if(!valid)throw new AppError(401,'휴대폰 번호 또는 비밀번호를 확인해 주세요.');
   }
   await newSession(user.id,res,req);return res.status(200).json({user:{id:user.id,phone:`010-****-${phone.slice(-4)}`}});
  }
  if(action==='logout'){
   if(req.method!=='POST')throw new AppError(405,'POST 요청이 필요합니다.');
   const token=cookieToken(req);if(/^[a-f0-9]{64}$/.test(token))await database(`notebook_sessions?token_hash=eq.${digest(token)}`,{method:'DELETE'});
   setCookie(res,'',0);return res.status(200).json({ok:true});
  }
  const userId=await account(req);
  if(action==='session'){
   if(req.method!=='GET')throw new AppError(405,'GET 요청이 필요합니다.');
   const users=await database(`notebook_users?id=eq.${userId}&select=id,phone&limit=1`);
   if(!users.length)throw new AppError(401,'다시 로그인해 주세요.');
   return res.status(200).json({user:{id:userId,phone:`010-****-${users[0].phone.slice(-4)}`}});
  }
  if(action==='list'){
   if(req.method!=='GET')throw new AppError(405,'GET 요청이 필요합니다.');
   return res.status(200).json({schedules:await list(userId)});
  }
  if(req.method!=='POST')throw new AppError(405,'POST 요청이 필요합니다.');
  if(action==='create'){
   const id=uuid(body.id||randomUUID()),input=scheduleInput(body);
   const rows=await database('notebook_schedules',{method:'POST',body:{...input,id,user_id:userId},prefer:'resolution=ignore-duplicates,return=representation'});
   // 재시도 시 같은 ID의 기존 결과를 반환하되 타인 ID와 다른 내용은 허용하지 않는다.
   const row=rows[0]||(await database(`notebook_schedules?id=eq.${id}&user_id=eq.${userId}&limit=1`))[0];
   if(!row||Object.entries(input).some(([key,value])=>row[key]!==value))throw new AppError(409,'같은 요청 ID로 다른 내용이 저장되어 있습니다. 새로고침 후 확인해 주세요.');
   return res.status(200).json({schedule:scheduleOutput(row)});
  }
  if(['update','delete'].includes(action)){
   const id=uuid(body.id);if(!Number.isSafeInteger(body.version)||body.version<1)throw new AppError(400,'일정 버전을 확인해 주세요.');
   const target=`notebook_schedules?id=eq.${id}&user_id=eq.${userId}&version=eq.${body.version}`;
   const rows=await database(target,{method:action==='delete'?'DELETE':'PATCH',prefer:'return=representation',...(action==='update'?{body:{...scheduleInput(body),version:body.version+1,updated_at:new Date().toISOString()}}:{})});
   if(!rows.length)throw new AppError(409,'일정이 변경되었거나 삭제되었습니다. 새로고침 후 확인해 주세요.');
   return res.status(200).json(action==='delete'?{ok:true}:{schedule:scheduleOutput(rows[0])});
  }
  if(action==='import'){
   if(!Array.isArray(body.schedules)||body.schedules.length<1||body.schedules.length>500)throw new AppError(400,'한 번에 1~500건을 가져올 수 있습니다.');
   const ids=new Set();const rows=body.schedules.map(item=>{
    if(typeof item.id!=='string'||!item.id||ids.has(item.id))throw new AppError(400,'기존 일정 ID가 없거나 중복되었습니다.');ids.add(item.id);
    const hex=digest(`${userId}:legacy:${item.id}`).slice(0,32);const id=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    return {...scheduleInput(item),id,user_id:userId};
   });
   await database('notebook_schedules',{method:'POST',body:rows,prefer:'resolution=ignore-duplicates'});
   return res.status(200).json({ok:true});
  }
  throw new AppError(404,'요청한 기능을 찾을 수 없습니다.');
 }catch(error){
  const status=error instanceof AppError?error.status:error instanceof SyntaxError?400:503;
  return res.status(status).json({error:error instanceof AppError?error.message:status===400?'올바른 JSON을 입력해 주세요.':'서버 연결에 문제가 있습니다. 잠시 후 다시 시도해 주세요.'});
 }
}
return handler;
}
module.exports=createHandler();
module.exports.createHandler=createHandler;
