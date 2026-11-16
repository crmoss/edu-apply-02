'use strict';
const {createHash}=require('node:crypto');
class AppError extends Error { constructor(status,message){super(message);this.status=status;} }
const digest=value=>createHash('sha256').update(value).digest('hex');
function scheduleInput(input){
 if(!input||!['work','personal'].includes(input.category))throw new AppError(400,'일정 분류와 날짜를 확인해 주세요.');
 const endDate=input.endDate===undefined?input.date:input.endDate;
 const validDate=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(+d)&&d.getUTCFullYear()>=1&&d.toISOString().slice(0,10)===value;};
 if(!validDate(input.date)||!validDate(endDate)||endDate<input.date)throw new AppError(400,'종료일은 시작일과 같거나 이후의 올바른 날짜여야 합니다.');
 const minute=t=>{if(typeof t!=='string'||!/^([01]\d|2[0-3]):(00|30)$/.test(t))throw new AppError(400,'시간은 30분 단위로 입력해 주세요.');return Number(t.slice(0,2))*60+Number(t.slice(3));};
 const start=minute(input.start),end=minute(input.end),content=typeof input.content==='string'?input.content.trim():'';
 if(start<420||start>1350||end<450||end>1380||input.date===endDate&&start>=end||!content||content.length>200)throw new AppError(400,'시작 07:00~22:30·종료 07:30~23:00과 내용(1~200자)을 확인해 주세요.');
 return {category:input.category,schedule_date:input.date,end_date:endDate,start_minute:start,end_minute:end,content};
}
const time=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const scheduleOutput=row=>({id:row.id,category:row.category,date:row.schedule_date,endDate:row.end_date||row.schedule_date,start:time(row.start_minute),end:time(row.end_minute),content:row.content,version:row.version});
function uuid(value){if(typeof value!=='string'||!/^\b[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\b$/i.test(value))throw new AppError(400,'일정 ID를 확인해 주세요.');return value;}
module.exports={AppError,digest,scheduleInput,scheduleOutput,uuid};
