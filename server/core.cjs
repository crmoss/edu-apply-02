'use strict';
const {randomBytes,createHash,scrypt:derive,timingSafeEqual}=require('node:crypto');
const {promisify}=require('node:util');
const scrypt=promisify(derive);
class AppError extends Error { constructor(status,message){super(message);this.status=status;} }
function phoneNumber(value){
 if(typeof value!=='string'||!/^\+?[\d\s-]+$/.test(value))throw new AppError(400,'휴대폰 번호 형식을 확인해 주세요.');
 let phone=value.replace(/[\s-]/g,'');if(phone.startsWith('+82'))phone='0'+phone.slice(3);
 if(!/^010\d{8}$/.test(phone))throw new AppError(400,'010으로 시작하는 휴대폰 번호 11자리를 입력해 주세요.');
 return phone;
}
function passwordValid(password){if(typeof password!=='string'||password.length<12||password.length>128)throw new AppError(400,'비밀번호는 12~128자로 입력해 주세요.');}
const digest=value=>createHash('sha256').update(value).digest('hex');
async function hashPassword(password){passwordValid(password);const salt=randomBytes(16).toString('hex');const key=await scrypt(password,salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024});return `scrypt$${salt}$${key.toString('hex')}`;}
async function verifyPassword(password,stored){
 const parts=String(stored).split('$');if(parts.length!==3||parts[0]!=='scrypt'||!/^[a-f0-9]{32}$/.test(parts[1])||!/^[a-f0-9]{128}$/.test(parts[2]))return false;
 const key=await scrypt(password,parts[1],64,{N:131072,r:8,p:1,maxmem:256*1024*1024});return timingSafeEqual(key,Buffer.from(parts[2],'hex'));
}
function scheduleInput(input){
 if(!input||!['work','personal'].includes(input.category)||typeof input.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.date))throw new AppError(400,'일정 분류와 날짜를 확인해 주세요.');
 const date=new Date(input.date+'T12:00:00Z');if(!Number.isFinite(+date)||date.getUTCFullYear()<1||date.toISOString().slice(0,10)!==input.date)throw new AppError(400,'올바른 날짜를 입력해 주세요.');
 const minute=t=>{if(typeof t!=='string'||!/^([01]\d|2[0-3]):(00|30)$/.test(t))throw new AppError(400,'시간은 30분 단위로 입력해 주세요.');return Number(t.slice(0,2))*60+Number(t.slice(3));};
 const start=minute(input.start),end=minute(input.end),content=typeof input.content==='string'?input.content.trim():'';
 if(start<420||end>1380||start>=end||!content||content.length>200)throw new AppError(400,'시간 범위(07:00~23:00)와 내용(1~200자)을 확인해 주세요.');
 return {category:input.category,schedule_date:input.date,start_minute:start,end_minute:end,content};
}
const time=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const scheduleOutput=row=>({id:row.id,category:row.category,date:row.schedule_date,start:time(row.start_minute),end:time(row.end_minute),content:row.content,version:row.version});
function uuid(value){if(typeof value!=='string'||!/^\b[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\b$/i.test(value))throw new AppError(400,'일정 ID를 확인해 주세요.');return value;}
module.exports={AppError,phoneNumber,passwordValid,digest,hashPassword,verifyPassword,scheduleInput,scheduleOutput,uuid};
