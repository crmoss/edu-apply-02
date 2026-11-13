'use strict';
const {randomBytes,createHash,createHmac}=require('node:crypto');
const databaseDefault=require('../server/database.cjs');
const {AppError,digest}=require('../server/core.cjs');
const {ownerSettings,cookieNames,cookieValue,cookie,verifyGoogleIdentity}=require('../server/owner-auth.cjs');
function createLoginHandler({database=databaseDefault,localOrigin,config,fetchGoogle=(...args)=>fetch(...args),verifyIdToken}={}){
 if(localOrigin&&!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(localOrigin))throw Error('Loopback origin required');
 const names=cookieNames(localOrigin);
 function settings(){
  const raw=config||{clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,origin:process.env.APP_ORIGIN,rateSecret:process.env.RATE_LIMIT_SECRET};
  if(!raw.clientId&&!raw.clientSecret)return null;
  if(!raw.clientId||!raw.clientSecret)throw new AppError(503,'구글 로그인 환경 변수를 확인해 주세요.');
  const origin=new URL(localOrigin||raw.origin);
  if(origin.origin!==(localOrigin||raw.origin)||!localOrigin&&origin.protocol!=='https:'||!raw.rateSecret||raw.rateSecret.length<32)throw new AppError(503,'구글 로그인 서버 설정을 확인해 주세요.');
  return {...raw,...ownerSettings(config),origin:origin.origin,callback:origin.origin+'/api/google-login?action=callback'};
 }
 return async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  const action=String(req.query?.action||'status'),callback=action==='callback';let claimed=false;
  const redirect=value=>{res.setHeader('Location','/?login='+value+'#upcomingSection');res.status(303);return res.end();};
  try{
   if(!['status','start','callback'].includes(action)||req.method!==(action==='start'?'POST':'GET'))throw new AppError(405,'허용되지 않은 요청입니다.');
   const cfg=settings();
   if(action==='status')return res.status(200).json({configured:!!cfg});
   if(!cfg)throw new AppError(503,'구글 로그인 설정이 아직 완료되지 않았습니다.');
   if(action==='start'){
    if(req.headers.origin!==cfg.origin||!String(req.headers['content-type']||'').startsWith('application/json'))throw new AppError(403,'허용되지 않은 로그인 요청입니다.');
    if(Buffer.byteLength(typeof req.body==='string'?req.body:JSON.stringify(req.body||{}))>1024)throw new AppError(413,'요청이 너무 큽니다.');
    const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||'local').split(',')[0].trim();
    const key=createHmac('sha256',cfg.rateSecret).update('owner-login:ip:'+ip).digest('hex');
    if(!await database('rpc/notebook_take_attempt',{method:'POST',body:{p_key:key,p_limit:30}}))throw new AppError(429,'이 접속 환경의 로그인 요청이 많습니다. 잠시 후 다시 시도해 주세요.');
    const previous=cookieValue(req,names.oauth);
    if(/^[a-f0-9]{64}$/.test(previous))await database(`notebook_login_states?browser_hash=eq.${digest(previous)}`,{method:'DELETE'});
    await database(`notebook_login_states?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`,{method:'DELETE'});
    const state=randomBytes(32).toString('hex'),browser=randomBytes(32).toString('hex'),nonce=randomBytes(32).toString('hex'),verifier=randomBytes(32).toString('base64url');
    await database('notebook_login_states',{method:'POST',body:{state_hash:digest(state),browser_hash:digest(browser),nonce_hash:digest(nonce),verifier,expires_at:new Date(Date.now()+600000).toISOString()}});
    res.setHeader('Set-Cookie',cookie(names.oauth,browser,600,localOrigin));
    const params=new URLSearchParams({client_id:cfg.clientId,redirect_uri:cfg.callback,response_type:'code',scope:'openid email',state,nonce,
     code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',access_type:'online',prompt:'select_account',include_granted_scopes:'false'});
    return res.status(200).json({url:'https://accounts.google.com/o/oauth2/v2/auth?'+params});
   }
   const {state,code}=req.query,browser=cookieValue(req,names.oauth);
   if(typeof state!=='string'||!/^[a-f0-9]{64}$/.test(state)||!/^[a-f0-9]{64}$/.test(browser))throw new AppError(400,'로그인 요청을 다시 시작해 주세요.');
   const rows=await database(`notebook_login_states?state_hash=eq.${digest(state)}&browser_hash=eq.${digest(browser)}&claimed=eq.false&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`,{method:'PATCH',body:{claimed:true},prefer:'return=representation'});
   const pending=rows[0];if(!pending)throw new AppError(400,'로그인 요청이 만료되었거나 이미 사용되었습니다.');claimed=true;
   if(req.query.error||typeof code!=='string'||!code||code.length>4096)throw new AppError(400,'구글 로그인이 취소되었습니다.');
   let response;
   try{response=await fetchGoogle('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:cfg.clientId,client_secret:cfg.clientSecret,redirect_uri:cfg.callback,grant_type:'authorization_code',code_verifier:pending.verifier}).toString(),signal:AbortSignal.timeout(10000)});}catch{throw new AppError(502,'구글 로그인에 연결하지 못했습니다.');}
   if(!response.ok)throw new AppError(403,'구글 로그인을 다시 진행해 주세요.');
   const tokens=await response.json();
   const identity=await verifyGoogleIdentity(tokens.id_token,{clientId:cfg.clientId,nonceHash:pending.nonce_hash,ownerEmail:cfg.email,verifyIdToken});
   const token=randomBytes(32).toString('hex'),old=cookieValue(req,names.session);
   const result=await database('rpc/notebook_finish_owner_login',{method:'POST',body:{p_subject:identity.subject,p_email:identity.email,p_existing_user:cfg.existingUserId,
    p_token_hash:digest(token),p_old_token_hash:/^[a-f0-9]{64}$/.test(old)?digest(old):null,p_state_hash:digest(state),p_browser_hash:digest(browser)}});
   if(result?.error)return redirect(result.error==='migration'?'setup-required':'denied');
   if(!result?.userId)throw new AppError(503,'로그인 계정을 확인하지 못했습니다.');
   res.setHeader('Set-Cookie',[cookie(names.session,token,86400,localOrigin),cookie(names.oauth,'',0,localOrigin)]);
   return redirect('success');
  }catch(error){
   if(callback){if(claimed)res.setHeader('Set-Cookie',cookie(names.oauth,'',0,localOrigin));return redirect('error');}
   return res.status(error instanceof AppError?error.status:503).json({error:error instanceof AppError?error.message:'구글 로그인 설정 또는 연결 상태를 확인해 주세요.'});
  }
 };
}
module.exports=createLoginHandler();module.exports.createLoginHandler=createLoginHandler;
