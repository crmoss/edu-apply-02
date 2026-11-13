'use strict';
// 테스트 DB에만 사용. HTTP 로그인 우회 기능은 만들지 않는다.
const {randomBytes}=require('node:crypto');
const {digest}=require('../../server/core.cjs');
const EMAIL='paran95@gmail.com',SUBJECT='owner-subject-123';
async function seedOwner(database){
 const owner=(await database('notebook_users',{method:'POST',body:{phone:null,password_hash:null}}))[0];
 await database('notebook_owner_identity',{method:'POST',body:{singleton:true,user_id:owner.id,google_sub:SUBJECT,email:EMAIL}});
 async function session({userId=owner.id,subject=SUBJECT,provider='google'}={}){
  const token=randomBytes(32).toString('hex');
  await database('notebook_sessions',{method:'POST',body:{token_hash:digest(token),user_id:userId,expires_at:new Date(Date.now()+86400000).toISOString(),auth_provider:provider,google_subject:subject}});
  return {token,cookie:'notebook_local_session='+token};
 }
 return {userId:owner.id,session,...await session()};
}
module.exports={seedOwner,EMAIL,SUBJECT};
