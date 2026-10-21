'use strict';
// 날짜·시간·저장 데이터 검증 규칙 (화면 코드 없음)
const localDate=d=>`${String(d.getFullYear()).padStart(4,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today=()=>localDate(new Date());
function parseDate(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return null;const d=new Date(v+'T12:00:00');return !isNaN(d)&&d.getFullYear()>0&&localDate(d)===v?d:null}
const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
const timeLabel=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const validTime=(t,end=false)=>typeof t==='string'&&(/^([01]\d|2[0-3]):(00|30)$/.test(t)||(end&&t==='24:00'));
function addDays(v,n){const d=parseDate(v);d.setDate(d.getDate()+n);return localDate(d)}
function sunday(v){const d=parseDate(v);d.setDate(d.getDate()-d.getDay());return localDate(d)}
const categoryName=c=>c==='work'?'업무':'개인';

// 시각 대신 현지 달력 날짜의 차이로 D-day를 계산한다.
function daysUntil(target,base=today()){
 const targetDate=parseDate(target),baseDate=parseDate(base);
 return targetDate&&baseDate?Math.round((targetDate-baseDate)/86400000):NaN;
}
function ddayLabel(target,base=today()){
 const days=daysUntil(target,base);
 if(!Number.isFinite(days))return '';
 return days===0?'D-day':days>0?`D-${days}`:`D+${Math.abs(days)}`;
}
function upcomingSchedules(items,base=today()){
 return items.filter(s=>{const days=daysUntil(s.date,base);return days>=0&&days<=7})
  .sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
}

function overlaps(a,b){return a.date===b.date&&a.start<b.end&&a.end>b.start}
function readData(raw){
 if(raw===null)return [];
 const data=JSON.parse(raw);if(!Array.isArray(data))throw Error('잘못된 저장 데이터');
 const ids=new Set();
 for(const s of data){if(!s||typeof s.id!=='string'||!s.id||ids.has(s.id)||!['work','personal'].includes(s.category)||!parseDate(s.date)||!validTime(s.start)||!validTime(s.end,true)||s.start>=s.end||minutes(s.start)<420||minutes(s.end)>1380||typeof s.content!=='string'||!s.content.trim()||s.content.length>200)throw Error('잘못된 일정');ids.add(s.id)}
 const sorted=[...data].sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
 for(let i=1;i<sorted.length;i++)if(overlaps(sorted[i-1],sorted[i]))throw Error('중복 일정');
 return data;
}
