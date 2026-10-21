const {test}=require('node:test');
const assert=require('node:assert/strict');
const database=require('../server/database.cjs');
test('DB 연결: 새 키·기존 키 헤더 및 비밀값 없는 오류 안내',async()=>{
 const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY,oldFetch=global.fetch;
 let options;
 try{
  process.env.SUPABASE_URL=' https://project.example.test/ ';
  process.env.SUPABASE_SERVICE_ROLE_KEY=' sb_secret_example_only ';
  global.fetch=async(url,init)=>{assert.equal(url,'https://project.example.test/rest/v1/notebook_users');options=init;return new Response('[]');};
  await database('notebook_users');assert.equal(options.headers.apikey,'sb_secret_example_only');assert.equal(options.headers.Authorization,undefined);
  process.env.SUPABASE_SERVICE_ROLE_KEY='legacy-test-key';await database('notebook_users');assert.equal(options.headers.Authorization,'Bearer legacy-test-key');
  for(const [status,code,expected] of [[401,'PGRST301','키 인증'],[404,'PGRST202','DB_FUNCTION_MISSING'],[404,'PGRST205','DB_TABLE_MISSING'],[403,'42501','DB_PERMISSION_DENIED'],[406,'PGRST106','DB_SCHEMA_NOT_EXPOSED']]){
   global.fetch=async()=>new Response(JSON.stringify({code,message:'do-not-expose-provider-details'}),{status});
   await assert.rejects(database('notebook_users'),e=>e.status===503&&e.message.includes(expected)&&!e.message.includes('legacy-test-key')&&!e.message.includes('do-not-expose'));
  }
  process.env.SUPABASE_SERVICE_ROLE_KEY='sb_publishable_example_only';await assert.rejects(database('notebook_users'),/공개용 키/);
  process.env.SUPABASE_SERVICE_ROLE_KEY='legacy-test-key';process.env.SUPABASE_URL='https://supabase.com/dashboard/project/example';await assert.rejects(database('notebook_users'),/주소 설정 오류/);
 }finally{
  global.fetch=oldFetch;
  if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
  if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
 }
});
