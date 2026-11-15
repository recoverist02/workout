/* Firebase-only request transport. No Apps Script or Sheets calls. */
function createWorkoutPrimary({fetcher,token,url,notify=()=>{}}){
  let queue=Promise.resolve(),latest=null,serial=0;
  const emit=e=>notify({...e,serial:++serial});
  const enqueue=fn=>{const task=queue.then(fn);queue=task.catch(()=>{});return task;};
  async function request(init={}){
    const idToken=await token(),controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),15000);
    try{
      // Firebase ID tokens use auth=; never log this URL or persist the token.
      const res=await fetcher(url+'?auth='+encodeURIComponent(idToken),{...init,cache:'no-store',signal:controller.signal,headers:{'X-Firebase-ETag':'true',...init.headers}});
      if(res.status===412)return null;
      if(!res.ok)throw Error('Firebase 연결을 확인해줘. ('+res.status+')');
      const state=await res.json(),etag=res.headers.get('etag');
      if(state?.schema!==1||!etag)throw Error('Firebase 원본 초기화가 필요해.');
      WorkoutCloudCore.validate(JSON.parse(state.sheetsJSON));return {state,etag};
    }finally{clearTimeout(timer);}
  }
  function response(snapshot){
    const s=snapshot.state;
    return {ok:true,source:'firebase',bridgeReady:true,initialized:true,protocol:2,partial:false,
      revision:String(s.revision),sheets:{...JSON.parse(s.auxJSON||'{}'),...JSON.parse(s.sheetsJSON)},
      backup:{revision:s.backup.revision,pending:s.revision>s.backup.revision,status:s.backup.status,completedAt:s.backup.completedAt,message:s.backup.message||''}};
  }
  function accept(snapshot){latest=snapshot;const data=response(snapshot);emit({type:'verified',scope:'state_main',data});return data;}
  async function work(payload){
    const started=performance.now();
    if(payload.action==='read')return accept(await request());
    if(['recordScore','recordStatus'].includes(payload.action)){
      const snapshot=await request(),sheets=JSON.parse(snapshot.state.sheetsJSON);
      if(!WorkoutCloudCore.names.includes(payload.table))throw Error('기록 종류를 확인해줘.');
      const row=WorkoutCloudCore.rows(sheets[payload.table]).get(String(payload.id))||null;
      return {ok:true,source:'firebase',protocol:2,table:payload.table,id:payload.id,row,exists:!!row};
    }
    if(!latest)throw Error('Firebase에서 최신 기록을 먼저 불러와줘.');
    const baseline=JSON.parse(latest.state.sheetsJSON);
    emit({type:'mutation'});
    let snapshot=latest;
    for(let attempt=0;attempt<5;attempt++){
      const change=WorkoutCloudCore.apply(snapshot.state,payload,baseline);
      // Even an apparent no-op must pass CAS: the cached row may have changed
      // elsewhere since it was displayed. Never confirm deletion from cache.
      let saved;
      try{saved=await request({method:'PUT',headers:{'Content-Type':'application/json','if-match':snapshot.etag},body:JSON.stringify(change.state)});}
      catch(error){
        // A timeout can occur after Firebase committed. Read back before
        // reporting failure; never overwrite by blindly retrying old bytes.
        const check=await request().catch(()=>null);
        if(check&&WorkoutCloudCore.signature(JSON.parse(check.state.sheetsJSON))===WorkoutCloudCore.signature(JSON.parse(change.state.sheetsJSON)))saved=check;
        else throw error;
      }
      if(saved){const data=accept(saved);return {...data,...change.result,timing:{totalMs:performance.now()-started},scorePending:false};}
      snapshot=await request();
    }
    throw Error('다른 기기에서 기록을 저장 중이야. 입력값은 유지돼. 다시 시도해줘.');
  }
  return {call:payload=>enqueue(()=>work(payload)).catch(error=>{emit({type:'error',message:error.message});throw error;})};
}
if(typeof module!=='undefined')module.exports=createWorkoutPrimary;
