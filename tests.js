'use strict';
// 브라우저 및 Node.js에서 같은 규칙 테스트를 실행한다.
const testResults=[];
function check(label,run){
  try{if(!run())throw Error('예상 결과와 다름');testResults.push({label,ok:true})}
  catch(error){testResults.push({label,ok:false,error:error.message})}
}
function rejects(run){try{run();return false}catch{return true}}
const fixture={id:'sample',category:'work',date:'2026-10-21',start:'09:00',end:'10:00',content:'가상 일정'};
const load=rows=>readData(JSON.stringify(rows));
check('R-01 윤년 날짜 허용',()=>!!parseDate('2028-02-29'));
check('R-01 존재하지 않는 날짜 거부',()=>!parseDate('2026-02-29')&&!parseDate('2026-04-31'));
check('연말 주간 계산',()=>addDays('2026-12-31',1)==='2027-01-01'&&sunday('2026-10-21')==='2026-10-18');
check('R-02 허용 시간 경계',()=>load([{...fixture,start:'07:00',end:'23:00'}]).length===1);
check('R-02 역전 시간 거부',()=>rejects(()=>load([{...fixture,start:'10:00',end:'09:00'}])));
check('R-02 같은 시작·종료 거부',()=>rejects(()=>load([{...fixture,end:'09:00'}])));
check('R-02 범위 밖 거부',()=>rejects(()=>load([{...fixture,start:'06:30'}]))&&rejects(()=>load([{...fixture,end:'23:30'}])));
check('R-02 30분 단위 외 거부',()=>rejects(()=>load([{...fixture,start:'09:15'}])));
check('R-03 업무·개인 시간 중복',()=>overlaps(fixture,{...fixture,category:'personal',start:'09:30',end:'10:30'}));
check('R-03 앞 일정 종료 시각 시작 허용',()=>!overlaps(fixture,{...fixture,start:'10:00',end:'10:30'}));
check('R-03 다른 날짜 허용',()=>!overlaps(fixture,{...fixture,date:'2026-10-22'}));
check('R-03 포함된 시간 중복 거부',()=>rejects(()=>load([fixture,{...fixture,id:'second',start:'09:30'}])));
check('R-05 공백 내용·200자 초과 거부',()=>rejects(()=>load([{...fixture,content:'  '}]))&&rejects(()=>load([{...fixture,content:'가'.repeat(201)}])));
check('R-07 미저장·빈 목록 허용',()=>readData(null).length===0&&load([]).length===0);
check('R-07 손상된 JSON 거부',()=>rejects(()=>readData('{')));
check('R-07 잘못된 구조 거부',()=>rejects(()=>readData('{}')));
check('R-07 중복 ID 거부',()=>rejects(()=>load([fixture,{...fixture,date:'2026-10-22'}])));
check('R-07 잘못된 분류 거부',()=>rejects(()=>load([{...fixture,category:'other'}])));
check('R-08 D-day 및 전후 날짜 표시',()=>ddayLabel('2026-10-21','2026-10-21')==='D-day'&&ddayLabel('2026-10-28','2026-10-21')==='D-7'&&ddayLabel('2026-10-20','2026-10-21')==='D+1');
check('R-08 오늘·7일 후 포함, 과거·8일 후 제외',()=>{
 const items=['2026-10-20','2026-10-21','2026-10-28','2026-10-29'].map(date=>({...fixture,date}));
 return upcomingSchedules(items,'2026-10-21').map(s=>s.date).join(',')==='2026-10-21,2026-10-28';
});
check('R-08 날짜·시작 시간 순 정렬 및 전체 분류 포함',()=>{
 const items=[{...fixture,id:'later',date:'2026-10-22'},{...fixture,id:'personal',category:'personal',start:'10:00'},{...fixture,id:'early'}];
 return upcomingSchedules(items,'2026-10-21').map(s=>s.id).join(',')==='early,personal,later';
});
check('R-08 연말·연초 날짜 차이',()=>daysUntil('2027-01-03','2026-12-28')===6);
check('R-08 윤년 월 경계 날짜 차이',()=>daysUntil('2028-03-01','2028-02-28')===2);
check('R-08 빈 일정과 잘못된 기준 날짜 처리',()=>upcomingSchedules([],'2026-10-21').length===0&&upcomingSchedules([fixture],'invalid').length===0);
check('R-08 원본 일정 배열 유지',()=>{
 const items=[{...fixture,date:'2026-10-22'},{...fixture}];
 upcomingSchedules(items,'2026-10-21');return items[0].date==='2026-10-22';
});
if(typeof document!=='undefined'){
  const body=document.getElementById('testResults');
  testResults.forEach((result,index)=>{
    const row=document.createElement('tr');
    [String(index+1),result.label,result.ok?'PASS':`FAIL: ${result.error}`].forEach(text=>{
      const cell=document.createElement('td');cell.textContent=text;row.append(cell);
    });body.append(row);
  });
  document.getElementById('testSummary').textContent=`${testResults.length}개 중 ${testResults.filter(r=>r.ok).length}개 PASS`;
}
