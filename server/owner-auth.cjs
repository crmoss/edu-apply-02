'use strict';
const {OAuth2Client}=require('google-auth-library');
const {AppError,digest}=require('./core.cjs');
const OWNER_EMAIL='paran95@gmail.com';
const clients=new Map();
function ownerSettings(config){
 const email=String(config?(config.ownerEmail||OWNER_EMAIL):(process.env.OWNER_GOOGLE_EMAIL||OWNER_EMAIL)).trim().toLowerCase();
 const existingUserId=config?(config.existingUserId||null):(process.env.OWNER_NOTEBOOK_USER_ID||null);
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||existingUserId&&!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(existingUserId))throw new AppError(503,'개인 계정 설정을 확인해 주세요.');
 return {email,existingUserId};
}
function cookieValue(req,name){return String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)||'';}
function cookieNames(localOrigin){return {session:localOrigin?'notebook_local_session':'__Host-notebook_session',oauth:localOrigin?'notebook_local_oauth':'__Host-notebook_oauth'};}
function cookie(name,value,maxAge,localOrigin){return `${name}=${value}; Path=/; HttpOnly;${localOrigin?'':' Secure;'} SameSite=Lax; Max-Age=${maxAge}`;}
async function ownerSession(database,req,{localOrigin,ownerConfig}={}){
 const token=cookieValue(req,cookieNames(localOrigin).session);
 if(!/^[a-f0-9]{64}$/.test(token))throw new AppError(401,'구글 로그인이 필요합니다.');
 const sessionHash=digest(token);
 const sessions=await database(`notebook_sessions?token_hash=eq.${sessionHash}&auth_provider=eq.google&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);
 const session=sessions[0];if(!session)throw new AppError(401,'로그인이 만료되었습니다. 다시 로그인해 주세요.');
 const owners=await database('notebook_owner_identity?singleton=eq.true&limit=1'),owner=owners[0],settings=ownerSettings(ownerConfig);
 if(!owner||owner.user_id!==session.user_id||owner.google_sub!==session.google_subject||owner.email!==settings.email||settings.existingUserId&&owner.user_id!==settings.existingUserId)throw new AppError(403,'허용된 본인 계정으로 로그인해 주세요.');
 return {userId:owner.user_id,sessionHash,googleSubject:owner.google_sub,email:owner.email};
}
async function defaultVerify({idToken,audience}){
 let client=clients.get(audience);if(!client){client=new OAuth2Client({clientId:audience,transporterOptions:{timeout:8000,retry:false}});clients.set(audience,client);}
 const ticket=await client.verifyIdToken({idToken,audience});return ticket.getPayload();
}
async function verifyGoogleIdentity(idToken,{clientId,nonceHash,ownerEmail,expectedSubject,verifyIdToken=defaultVerify}){
 try{
  if(typeof idToken!=='string'||!idToken||idToken.length>16384||!/^[a-f0-9]{64}$/.test(nonceHash||''))throw Error();
  const p=await verifyIdToken({idToken,audience:clientId});
  if(!p||!['accounts.google.com','https://accounts.google.com'].includes(p.iss)||p.aud!==clientId||p.azp&&p.azp!==clientId||!Number.isFinite(p.exp)||p.exp<=Date.now()/1000||p.email_verified!==true||typeof p.nonce!=='string'||digest(p.nonce)!==nonceHash||typeof p.sub!=='string'||!p.sub||p.sub.length>255||String(p.email||'').toLowerCase()!==ownerEmail||expectedSubject&&p.sub!==expectedSubject)throw Error();
  return {subject:p.sub,email:String(p.email).toLowerCase()};
 }catch{throw new AppError(403,'허용된 본인 구글 계정으로 다시 로그인해 주세요.');}
}
module.exports={OWNER_EMAIL,ownerSettings,cookieValue,cookieNames,cookie,ownerSession,verifyGoogleIdentity,defaultVerify};
