'use strict';
const {randomBytes,createCipheriv,createDecipheriv,createHmac}=require('node:crypto');
const productionDatabase=require('../server/database.cjs');
const {AppError,digest}=require('../server/core.cjs');
const {ownerSession,verifyGoogleIdentity}=require('../server/owner-auth.cjs');
const READ_SCOPES=['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.readonly'];
const SCOPES=['openid','email',...READ_SCOPES];
const exactScopes=value=>{const scopes=String(value||'').split(' ').filter(Boolean);return READ_SCOPES.every(s=>scopes.includes(s))&&scopes.every(s=>SCOPES.includes(s)||s==='https://www.googleapis.com/auth/userinfo.email');};
const fail=(status,text)=>new AppError(status,text);
function encryptToken(token,key,userId,clientId){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(Buffer.from(`notebook-google:v1:${userId}:${clientId}`));
 const bytes=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
 return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),bytes.toString('base64url')].join('.');
}
function decryptToken(value,key,userId,clientId){
 try{
  const [version,iv,tag,bytes,...extra]=String(value).split('.');if(version!=='v1'||extra.length)throw Error();
  const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'));
  cipher.setAAD(Buffer.from(`notebook-google:v1:${userId}:${clientId}`));cipher.setAuthTag(Buffer.from(tag,'base64url'));
  return Buffer.concat([cipher.update(Buffer.from(bytes,'base64url')),cipher.final()]).toString('utf8');
 }catch{throw fail(503,'구글 연결 암호화 설정을 확인해 주세요. 관리자 확인이 필요합니다.');}
}
function normalizeEvent(event,calendar){
 if(event.status==='cancelled')return null;
 const allDay=typeof event.start?.date==='string',start=allDay?event.start.date:event.start?.dateTime,end=allDay?event.end?.date:event.end?.dateTime;
 if(!start||!end)throw fail(502,'구글 일정의 날짜 형식을 확인할 수 없습니다. 기존 일정을 유지합니다.');
 const date=/^\d{4}-\d{2}-\d{2}$/;
 const validDate=value=>date.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
 if(allDay?(!validDate(start)||!validDate(end)||start>=end):(!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(start)||!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(end)||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(start)>=Date.parse(end)))throw fail(502,'구글 일정의 시간 형식을 확인할 수 없습니다.');
 if(typeof event.id!=='string'||!event.id||event.id.length>1024)throw fail(502,'구글 일정 식별자가 올바르지 않습니다.');
 return {calendarId:calendar.id,eventId:event.id,calendarName:calendar.name,category:calendar.category,
  title:typeof event.summary==='string'?event.summary.slice(0,200):'(제목 없음)',allDay,
  ...(allDay?{startDate:start,endDate:end}:{startAt:new Date(start).toISOString(),endAt:new Date(end).toISOString()})};
}
function createGoogleHandler({database=productionDatabase,fetchGoogle=(...args)=>fetch(...args),localOrigin,config:injectedConfig,ownerConfig,verifyIdToken}={}){
 if(localOrigin&&!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(localOrigin))throw Error('Loopback origin required');
 function configuration(){
  const raw=injectedConfig||{clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,key:process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,origin:process.env.APP_ORIGIN,rateSecret:process.env.RATE_LIMIT_SECRET};
  if(!raw.clientId&&!raw.clientSecret&&!raw.key)return null;
  if(!raw.clientId||!raw.clientSecret||!raw.key)throw fail(503,'구글 연결 환경 변수 3개를 모두 등록해 주세요.');
  const key=Buffer.from(raw.key,'base64'),origin=new URL(localOrigin||raw.origin);
  if(key.length!==32||key.toString('base64')!==raw.key||(!localOrigin&&origin.protocol!=='https:')||origin.origin!==(localOrigin||raw.origin)||!raw.rateSecret||raw.rateSecret.length<32)throw fail(503,'구글 연결의 서버 환경 변수 설정을 확인해 주세요.');
  return {...raw,key,origin:origin.origin,callback:origin.origin+'/api/google-calendar?action=callback'};
 }
 async function session(req){
  return ownerSession(database,req,{localOrigin,ownerConfig});
 }
 async function operation(auth,op,data={}){
  const result=await database('rpc/notebook_google_operation',{method:'POST',body:{p_user:auth.userId,p_session:auth.sessionHash,p_op:op,p_data:data}});
  if(result?.error){
   const code=result.error;
   throw fail(code==='session'?401:code==='cooldown'?429:409,code==='cooldown'?'구글 일정은 1분 후 다시 갱신할 수 있습니다.':code==='revoke'?'구글 권한 해제를 먼저 완료해 주세요.':code==='session'?'로그인이 만료되었습니다.':'구글 연결 상태가 변경되었습니다. 다시 확인해 주세요.');
  }
  return result;
 }
 async function limited(req,auth,cfg,action){
  // 기존 서비스의 보류된 제한 정책은 변경하지 않고 새 연동에만 적용한다.
  const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||'local').split(',')[0].trim();
  for(const [kind,value,limit] of [['user',auth.userId,action==='start'?5:20],['ip',ip,60]]){
   const key=createHmac('sha256',cfg.rateSecret).update(`google:${action}:${kind}:${value}`).digest('hex');
   if(!await database('rpc/notebook_take_attempt',{method:'POST',body:{p_key:key,p_limit:limit}}))throw fail(429,'구글 연결 요청이 많습니다. 15분 후 다시 시도해 주세요.');
  }
 }
 async function connection(auth){return (await database(`notebook_google_connections?user_id=eq.${auth.userId}&limit=1`))[0];}
 async function provider(url,options,deadline){
  const remaining=deadline-Date.now();if(remaining<=0)throw fail(504,'구글 조회 시간이 초과되었습니다. 기존 일정을 유지합니다.');
  let response;
  try{response=await fetchGoogle(url,{...options,redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(8000,remaining)))});}catch{throw fail(502,'구글에 연결하지 못했습니다. 기존 일정을 유지합니다.');}
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
   if(data.error==='invalid_grant'||response.status===401)throw fail(409,'구글 연결이 만료되거나 취소되었습니다. 다시 연결해 주세요.');
   throw fail(response.status===429?429:502,'구글 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return data;
 }
 async function accessToken(auth,cfg,row,deadline){
  const refresh=decryptToken(row.refresh_ciphertext,cfg.key,auth.userId,cfg.clientId);
  const data=await provider('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refresh,client_id:cfg.clientId,client_secret:cfg.clientSecret}).toString()},deadline);
  if(typeof data.access_token!=='string')throw fail(502,'구글 접근 권한을 확인하지 못했습니다.');
  if(data.scope&&!exactScopes(data.scope))throw fail(409,'구글 읽기 전용 권한을 다시 연결해 주세요.');
  return data.access_token;
 }
 async function calendars(token,deadline){
  const items=[];let page;
  do{
   const query=new URLSearchParams({maxResults:'100',minAccessRole:'reader',fields:'items(id,summary,accessRole),nextPageToken',...(page?{pageToken:page}:{})});
   const data=await provider('https://www.googleapis.com/calendar/v3/users/me/calendarList?'+query,{headers:{Authorization:`Bearer ${token}`}},deadline);
   if(!Array.isArray(data.items)&&data.items!==undefined)throw fail(502,'구글 캘린더 목록을 확인하지 못했습니다.');
   items.push(...(data.items||[]).map(c=>{if(typeof c.id!=='string'||!c.id||c.id.length>1024)throw fail(502,'캘린더 식별자가 올바르지 않습니다.');return {id:c.id,name:String(c.summary||'캘린더').slice(0,100)};}));
   if(items.length>200||page&&data.nextPageToken)throw fail(413,'캘린더 목록이 너무 많습니다. 최대 200개까지 조회할 수 있습니다.');
   page=data.nextPageToken;
  }while(page);
  return items;
 }
 return async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  const action=String(req.query?.action||'status'),callback=action==='callback';
  const redirect=result=>{res.setHeader('Location','/?google='+result+'#upcomingSection');res.status(303);return res.end();};
  try{
   if(!['GET','POST'].includes(req.method)||((action==='status'||callback)?req.method!=='GET':req.method!=='POST'))throw fail(405,'허용되지 않은 요청입니다.');
   if(!['status','callback','start','calendars','sync','disconnect'].includes(action))throw fail(400,'알 수 없는 요청입니다.');
   const auth=await session(req),cfg=configuration();
   if(action==='status'&&!cfg)return res.status(200).json({configured:false,status:'disconnected',events:[],selected:[]});
   if(!cfg)throw fail(503,'관리자가 구글 캘린더 연결 설정을 완료해야 합니다.');
   if(action==='status')return res.status(200).json({configured:true,...await operation(auth,'status')});
   if(callback){
    const state=req.query.state,code=req.query.code;
    if(typeof state!=='string'||!/^[a-f0-9]{64}$/.test(state))throw fail(400,'잘못된 연결 요청입니다.');
    const pending=(await database(`notebook_google_states?state_hash=eq.${digest(state)}&user_id=eq.${auth.userId}&session_hash=eq.${auth.sessionHash}&limit=1`))[0];
    await operation(auth,'claim',{state:digest(state)});
    if(req.query.error||typeof code!=='string'||!code||code.length>4096)throw fail(400,'구글 연결이 취소되었습니다.');
    const data=await provider('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:cfg.clientId,client_secret:cfg.clientSecret,redirect_uri:cfg.callback,grant_type:'authorization_code'}).toString()},Date.now()+15000);
    if(typeof data.refresh_token!=='string'||!data.refresh_token||!exactScopes(data.scope))throw fail(400,'필요한 캘린더 읽기 권한에 동의해 주세요.');
    await verifyGoogleIdentity(data.id_token,{clientId:cfg.clientId,nonceHash:pending?.nonce_hash,ownerEmail:auth.email,expectedSubject:auth.googleSubject,verifyIdToken});
    await operation(auth,'finish',{state:digest(state),cipher:encryptToken(data.refresh_token,cfg.key,auth.userId,cfg.clientId)});
    return redirect('connected');
   }
   if(req.headers.origin!==cfg.origin||!String(req.headers['content-type']||'').startsWith('application/json'))throw fail(403,'허용되지 않은 접속 요청입니다.');
   let body=req.body||{};
   if(typeof body==='string'){if(Buffer.byteLength(body)>16384)throw fail(413,'요청이 너무 큽니다.');body=JSON.parse(body);}
   if(!body||typeof body!=='object'||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>16384)throw fail(400,'잘못된 요청입니다.');
   await limited(req,auth,cfg,action);
   if(action==='start'){
    const state=randomBytes(32).toString('hex'),nonce=randomBytes(32).toString('hex');await operation(auth,'start',{state:digest(state)});
    const pending=await database(`notebook_google_states?state_hash=eq.${digest(state)}&user_id=eq.${auth.userId}&session_hash=eq.${auth.sessionHash}`,{method:'PATCH',body:{nonce_hash:digest(nonce)},prefer:'return=representation'});
    if(!pending.length)throw fail(409,'구글 연결 요청을 다시 시작해 주세요.');
    const query=new URLSearchParams({client_id:cfg.clientId,redirect_uri:cfg.callback,response_type:'code',scope:SCOPES.join(' '),state,nonce,access_type:'offline',prompt:'consent select_account',include_granted_scopes:'false'});
    return res.status(200).json({url:'https://accounts.google.com/o/oauth2/v2/auth?'+query});
   }
   if(action==='disconnect'){
    if(typeof body.removeEvents!=='boolean')throw fail(400,'가져온 일정의 삭제 여부를 선택해 주세요.');
    await operation(auth,'disconnect',{removeEvents:body.removeEvents});
    const row=await connection(auth);
    if(row.refresh_ciphertext){
     const token=decryptToken(row.refresh_ciphertext,cfg.key,auth.userId,cfg.clientId);let response;
     try{response=await fetchGoogle('https://oauth2.googleapis.com/revoke',{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}).toString(),signal:AbortSignal.timeout(8000)});}catch{throw fail(502,'업무 수첩의 연결은 중지했습니다. 구글 권한 해제를 다시 시도해 주세요.');}
     // Google returns invalid_token if the grant has already been revoked.
     if(!response.ok){const error=await response.json().catch(()=>({}));if(error.error!=='invalid_token')throw fail(502,'연결은 중지했지만 구글 권한 해제가 완료되지 않았습니다. 다시 시도해 주세요.');}
     await operation(auth,'revoked',{revision:row.revision});
    }
    return res.status(200).json({ok:true});
   }
   let row=await connection(auth);if(!row||row.status!=='connected')throw fail(409,'구글 캘린더를 먼저 연결해 주세요.');
   const deadline=Date.now()+20000;
   if(action==='calendars')return res.status(200).json({calendars:await calendars(await accessToken(auth,cfg,row,deadline),deadline)});
   const ticket=(await operation(auth,'sync_begin')).ticket;
   try{
    row=await connection(auth);if(row.lease!==ticket||row.status!=='connected')throw fail(409,'구글 연결 상태가 변경되었습니다.');
    const token=await accessToken(auth,cfg,row,deadline);let selected=row.selected;
    if(body.selected!==undefined){
     if(!Array.isArray(body.selected)||body.selected.length>3||body.selected.some(c=>!c||typeof c.id!=='string'||!['work','personal'].includes(c.category))||new Set(body.selected.map(c=>c.id)).size!==body.selected.length)throw fail(400,'최대 3개 캘린더와 업무·개인 분류를 선택해 주세요.');
     const available=await calendars(token,deadline);
     selected=body.selected.map(c=>{const found=available.find(a=>a.id===c.id);if(!found)throw fail(400,'조회할 수 없는 캘린더입니다.');return {...found,category:c.category};});
    }
    if(!selected.length&&body.selected===undefined)return res.status(200).json({ok:true,selectRequired:true});
    const rangeStart=new Date(Date.now()-31*86400000).toISOString(),rangeEnd=new Date(Date.now()+93*86400000).toISOString(),events=[];
    for(const calendar of selected){
     let page,count=0;
     do{
      const query=new URLSearchParams({timeMin:rangeStart,timeMax:rangeEnd,singleEvents:'true',showDeleted:'false',orderBy:'startTime',maxResults:'500',fields:'items(id,status,summary,start,end),nextPageToken',...(page?{pageToken:page}:{})});
      const data=await provider('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendar.id)+'/events?'+query,{headers:{Authorization:`Bearer ${token}`}},deadline);
      if(!Array.isArray(data.items)&&data.items!==undefined)throw fail(502,'구글 일정 응답이 올바르지 않습니다.');
      events.push(...(data.items||[]).map(e=>normalizeEvent(e,calendar)).filter(Boolean));
      if(events.length>1000||++count>3)throw fail(413,'조회 범위의 구글 일정이 너무 많습니다. 캘린더 선택을 줄여 주세요.');
      page=data.nextPageToken;
     }while(page);
    }
    await operation(auth,'sync_finish',{ticket,selected,events,rangeStart,rangeEnd});
    return res.status(200).json({ok:true});
   }catch(error){await operation(auth,error.status===409?'reconnect':'sync_fail',{ticket}).catch(()=>{});throw error;}
   finally{await operation(auth,'sync_fail',{ticket}).catch(()=>{});}
  }catch(error){
   if(callback)return redirect('error');
   return res.status(error instanceof AppError?error.status:503).json({error:error instanceof AppError?error.message:'구글 연결을 처리하지 못했습니다. 설정 또는 연결 상태를 확인해 주세요.'});
  }
 };
}
module.exports=createGoogleHandler();
module.exports.createGoogleHandler=createGoogleHandler;
module.exports.encryptToken=encryptToken;module.exports.decryptToken=decryptToken;module.exports.normalizeEvent=normalizeEvent;
