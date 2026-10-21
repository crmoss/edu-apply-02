'use strict';
const NotebookAPI={
 async request(action,body){
  let response;
  try{response=await fetch(`/api/notebook?action=${encodeURIComponent(action)}`,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});}
  catch{throw new Error('서버에 연결하지 못했습니다. 연결 상태를 확인해 주세요.');}
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(data.error||'요청을 처리하지 못했습니다.');error.status=response.status;throw error;}
  return data;
 }
};
