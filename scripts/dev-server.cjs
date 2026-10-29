'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {createLocalDatabase}=require('../server/local-database.cjs');
const {createHandler}=require('../api/notebook.js');
const root=path.join(__dirname,'..');
const publicFiles={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/logic.js':'logic.js','/app.js':'app.js','/signup.js':'signup.js','/client-api.js':'client-api.js'};
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8'};
async function createDevelopmentServer({port=3000,dataDir=path.join(root,'.local-db')}={}){
 const store=await createLocalDatabase(dataDir);
 let handler;
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  try{
   const url=new URL(req.url,'http://127.0.0.1');
   if(url.pathname==='/api/notebook'){
    const chunks=[];let bytes=0;
    for await(const chunk of req){bytes+=chunk.length;if(bytes>262144){res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'요청이 너무 큽니다.'}));return;}chunks.push(chunk);}
    req.body=Buffer.concat(chunks).toString('utf8')||{};req.query=Object.fromEntries(url.searchParams);
    res.status=function(status){this.statusCode=status;return this;};res.json=function(body){this.setHeader('Content-Type','application/json; charset=utf-8');this.end(JSON.stringify(body));};
    await handler(req,res);return;
   }
   if(!['GET','HEAD'].includes(req.method)||!publicFiles[url.pathname]){res.writeHead(404);res.end('Not found');return;}
   const file=publicFiles[url.pathname];let content=fs.readFileSync(path.join(root,file));
   if(file==='index.html')content=Buffer.from(content.toString('utf8').replace('<body>','<body><div class="local-mode-banner">로컬 테스트 · 이 PC에만 저장 · 운영 DB 미연결</div>'));
   res.setHeader('Content-Type',types[path.extname(file)]);res.end(req.method==='HEAD'?undefined:content);
  }catch{if(!res.headersSent)res.writeHead(500);res.end('Local test server error');}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);}).catch(async e=>{await store.close();throw e;});
 const origin=`http://127.0.0.1:${server.address().port}`;
 handler=createHandler({database:store.database,localOrigin:origin,localRateSecret:randomBytes(32).toString('hex')});
 return {origin,close:async()=>{server.closeIdleConnections();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await store.close();}};
}
if(require.main===module){
 createDevelopmentServer().then(app=>{
  console.log(`\nLocal notebook: ${app.origin}\nDatabase: .local-db (production Supabase is never used)\nStop: Ctrl+C\n`);
  const stop=()=>{app.close().then(()=>process.exit(0)).catch(()=>process.exit(1));};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 }).catch(error=>{console.error(error.code==='EADDRINUSE'?'Port 3000 is already in use. Stop the previous local server first.':error.message);process.exitCode=1;});
}
module.exports={createDevelopmentServer};
