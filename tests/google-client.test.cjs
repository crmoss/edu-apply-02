'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
test('Google 화면: 읽기 전용 표시·계정 전환 시 캐시 삭제·늦은 응답 무시',async()=>{
 const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8'),nodes=new Map(),contentNodes=[];
 for(const match of read('index.html').matchAll(/id="([^"]+)"/g))nodes.set(match[1],{
  value:'',hidden:false,disabled:false,checked:true,textContent:'',innerHTML:'',dataset:{},handlers:{},
  classList:{add(){},remove(){},toggle(){}},setAttribute(){},focus(){},scrollIntoView(){},reset(){},
  replaceChildren(){this.innerHTML='';},querySelectorAll(){return [];},
  addEventListener(name,fn){this.handlers[name]=fn;},showModal(){this.open=true;},close(){this.open=false;this.handlers.close?.();}
 });
 nodes.get('categoryFilter').value='all';nodes.get('category').value='work';
 let cookieUser='a',pendingStatus=null;const requests=[];
 const event={calendarId:'cal',eventId:'evt',calendarName:'구글 개인',title:'<img src=x onerror=alert(1)>',category:'personal',allDay:true,startDate:'2026-11-02',endDate:'2026-11-04'};
 const state={configured:true,status:'connected',selected:[{id:'cal',category:'personal'}],lastSynced:new Date().toISOString(),events:[event]};
 const fakeFetch=async(url,options={})=>{
  requests.push({url,options});const action=new URL(url,'https://app.example').searchParams.get('action');
  if(action==='status')return new Response(JSON.stringify(pendingStatus?await pendingStatus:cookieUser==='a'?state:{...state,events:[],selected:[]}));
  if(action==='start')return new Response(JSON.stringify({url:'https://accounts.google.com/o/oauth2/v2/auth?state=fake'}));
  throw Error('unexpected action '+action);
 };
 const document={getElementById:id=>nodes.get(id),querySelectorAll(selector){
  if(selector!=='[data-content]')return [];
  contentNodes.length=0;
  for(const name of ['upcomingList','calendarBody','scheduleList'])for(const m of nodes.get(name).innerHTML.matchAll(/data-content="([^"]*)"/g)){
   const id=m[1].replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');contentNodes.push({dataset:{content:id},textContent:''});
  }
  return contentNodes;
 }};
 let navigated='';const ctx=vm.createContext({document,console,URL,Response,AbortSignal,fetch:fakeFetch,crypto:require('node:crypto').webcrypto,
  localStorage:{getItem(){return null;}},window:{location:{href:'https://app.example/',assign(url){navigated=url;}},history:{replaceState(){}}}});
 vm.runInContext(read('logic.js')+'\n'+read('app.js')+'\n'+read('google-calendar-client.js'),ctx);
 const run=code=>vm.runInContext(code,ctx),flush=()=>new Promise(resolve=>setImmediate(resolve));
 run("setCurrentUser({id:'a',phone:'010-****-0000'});storageHealthy=true;anchor='2026-11-02'");await flush();
 run('render()');assert.equal(run('externalEvents.length'),1);
 assert.ok(nodes.get('calendarBody').innerHTML.includes('구글 · 읽기 전용'));
 assert.ok(!nodes.get('calendarBody').innerHTML.includes('<img'));
 assert.ok(!nodes.get('calendarBody').innerHTML.includes('data-edit='));
 assert.ok(contentNodes.some(n=>n.textContent===event.title),'title is written as text');
 await nodes.get('googleConnectForm').onsubmit({preventDefault(){}});
 assert.ok(!nodes.has('googlePassword'));assert.ok(navigated.startsWith('https://accounts.google.com/'));
 let release;pendingStatus=new Promise(resolve=>{release=resolve;});
 run("setCurrentUser({id:'a'})");
 cookieUser='b';pendingStatus=null;run("setCurrentUser({id:'b'})");await flush();
 release(state);await flush();
 assert.equal(run('externalEvents.length'),0,'previous user late response cannot populate cache');
 assert.equal(nodes.get('googleChoices').innerHTML,'');
 run('setCurrentUser(null)');assert.equal(nodes.get('googlePanel').hidden,true);assert.equal(run('externalEvents.length'),0);
 assert.ok(!requests.some(r=>r.options.method==='POST'&&r.url.includes('sync')),'no background sync for fresh cache');
});
