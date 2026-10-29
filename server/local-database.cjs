'use strict';
// 운영과 같은 SQL 제약조건을 사용하며 SQL 식별자는 고정 목록에서만 만든다.
const fs=require('node:fs');
const path=require('node:path');
const {AppError}=require('./core.cjs');
const tables={
 notebook_users:['id','phone','password_hash','created_at'],
 notebook_sessions:['token_hash','user_id','expires_at','created_at'],
 notebook_schedules:['id','user_id','category','schedule_date','start_minute','end_minute','content','version','created_at','updated_at']
};
// PGlite의 Date 객체를 Supabase REST와 동일한 날짜 문자열로 변환한다.
const normalizeRows=rows=>rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date?(key==='schedule_date'?value.toISOString().slice(0,10):value.toISOString()):value])));
async function createLocalDatabase(dataDir){
 const {PGlite}=await import('@electric-sql/pglite');
 const {btree_gist}=await import('@electric-sql/pglite/contrib/btree_gist');
 const pg=new PGlite({...dataDir?{dataDir}:{},extensions:{btree_gist}});
 const exists=(await pg.query("select to_regclass('public.notebook_users') as existing")).rows[0].existing;
 if(!exists){
  await pg.exec('create schema if not exists extensions; create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon,authenticated,service_role;');
  await pg.exec(fs.readFileSync(path.join(__dirname,'../db/001_initial.sql'),'utf8'));
 }
 async function database(target,{method='GET',body,prefer=''}={}){
  try{
   if(target==='rpc/notebook_take_attempt')return (await pg.query('select public.notebook_take_attempt($1,$2) as allowed',[body.p_key,body.p_limit])).rows[0].allowed;
   const [table,query='']=target.split('?');const columns=tables[table];if(!columns)throw Error('Unknown local table');
   const params=new URLSearchParams(query),values=[];
   const identifier=name=>{if(!columns.includes(name))throw Error('Unknown local column');return `"${name}"`;};
   const parameter=value=>{values.push(value);return `$${values.length}`;};
   const number=value=>{if(!/^\d+$/.test(value))throw Error('Invalid pagination');return Number(value);};
   const conditions=[];
   for(const [key,value] of params){
    if(['select','order','limit','offset'].includes(key))continue;
    const match=/^(eq|gt)\.(.*)$/.exec(value);if(!match)throw Error('Unsupported local filter');
    conditions.push(`${identifier(key)} ${match[1]==='eq'?'=':'>'} ${parameter(match[2])}`);
   }
   const where=conditions.length?' where '+conditions.join(' and '):'';
   if(method==='GET'){
    const selected=(params.get('select')||columns.join(',')).split(',').map(identifier).join(',');
    const order=params.has('order')?' order by '+params.get('order').split(',').map(item=>{const [name,direction]=item.split('.');if(!['asc','desc'].includes(direction))throw Error('Unsupported sort');return identifier(name)+' '+direction;}).join(','):'';
    const limit=params.has('limit')?' limit '+number(params.get('limit')):'';
    const offset=params.has('offset')?' offset '+number(params.get('offset')):'';
    return normalizeRows((await pg.query(`select ${selected} from public."${table}"${where}${order}${limit}${offset}`,values)).rows);
   }
   if(method==='POST'){
    const rows=Array.isArray(body)?body:[body];if(!rows.length)return [];
    const keys=Object.keys(rows[0]);const names=keys.map(identifier).join(',');
    const tuples=rows.map(row=>'('+keys.map(key=>parameter(row[key])).join(',')+')').join(',');
    const conflict=prefer.includes('resolution=ignore-duplicates')?' on conflict do nothing':'';
    return normalizeRows((await pg.query(`insert into public."${table}" (${names}) values ${tuples}${conflict} returning *`,values)).rows);
   }
   if(!conditions.length)throw Error('Local mutations require filters');
   if(method==='PATCH'){
    const assignments=Object.keys(body).map(key=>`${identifier(key)}=${parameter(body[key])}`).join(',');
    return normalizeRows((await pg.query(`update public."${table}" set ${assignments}${where} returning *`,values)).rows);
   }
   if(method==='DELETE')return normalizeRows((await pg.query(`delete from public."${table}"${where} returning *`,values)).rows);
   throw Error('Unsupported local operation');
  }catch(error){
   if(error instanceof AppError)throw error;
   if(error.code==='23P01')throw new AppError(409,'같은 시간에 다른 일정이 있습니다. 시간을 변경해 주세요.');
   if(error.code==='23505')throw new AppError(409,'이미 등록된 정보입니다. 기존 계정은 로그인해 주세요.');
   if(['23514','22007','22008'].includes(error.code))throw new AppError(400,'저장할 데이터 형식을 확인해 주세요.');
   throw new AppError(503,'로컬 테스트 DB를 처리하지 못했습니다. 서버를 다시 시작해 주세요.');
  }
 }
 return {database,close:()=>pg.close()};
}
module.exports={createLocalDatabase};
