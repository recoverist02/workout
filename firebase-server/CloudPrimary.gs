/* Install in the spreadsheet-bound project, together with CloudCore.gs and SheetAdapter.gs. */
const WC_URL='https://YOUR_DATABASE.firebasedatabase.app/workout_primary_v1.json';
const WC_OWNER='SET_OWNER_EMAIL';
function wcRequest_(method,value,etag){
  const headers={Authorization:'Bearer '+ScriptApp.getOAuthToken(),'X-Firebase-ETag':'true'};
  if(etag)headers['if-match']=etag;
  const options={method:method,headers:headers,muteHttpExceptions:true};
  if(value!==undefined){options.contentType='application/json';options.payload=JSON.stringify(value);}
  const res=UrlFetchApp.fetch(WC_URL,options),status=res.getResponseCode();
  if(status===412)return null;
  if(status<200||status>=300)throw Error('Firebase 연결 실패 ('+status+'). 권한과 설정을 확인해줘.');
  const all=res.getAllHeaders(),key=Object.keys(all).find(k=>k.toLowerCase()==='etag');
  return {state:JSON.parse(res.getContentText()),etag:key?all[key]:null};
}
function wcRead_(){const r=wcRequest_('get');if(!r.etag)throw Error('클라우드 버전 확인 실패');return r;}
function wcPut_(state,etag){if(!etag)throw Error('버전 없는 저장 차단');return wcRequest_('put',state,etag);}
function wcLock_(fn){const lock=LockService.getScriptLock();lock.waitLock(20000);try{return fn();}finally{lock.releaseLock();}}
function wcTables_(ss){return WorkoutCloudCore.clean(workoutRead_(ss,WORKOUT_EDIT));}
function wcAux_(ss){return JSON.stringify(workoutRead_(ss,Object.keys(WORKOUT_READ).filter(k=>!WORKOUT_EDIT.includes(k))));}
function checkWorkoutCloudAccess(){
  if(Session.getEffectiveUser().getEmail()!==WC_OWNER)throw Error('소유자 계정으로 실행해줘.');
  const r=wcRead_();console.log(JSON.stringify({reachable:true,initialized:!!r.state,revision:r.state?r.state.revision:null}));
}
function installWorkoutCloudPrimary(){
  if(Session.getEffectiveUser().getEmail()!==WC_OWNER)throw Error('소유자 계정으로 실행해줘.');
  return wcLock_(()=>{
    const ss=SpreadsheetApp.openById(WORKOUT_SHEET_ID),props=PropertiesService.getScriptProperties();
    let snapshot=wcRead_();
    if(!snapshot.state){
      if(!props.getProperty('WC_PRE_MIGRATION_BACKUP')){
        const copy=ss.copy('운동기록_Firebase전환전_'+Utilities.formatDate(new Date(),'Asia/Seoul','yyyyMMdd_HHmmss'));
        props.setProperty('WC_PRE_MIGRATION_BACKUP',copy.getId());
      }
      const tables=wcTables_(ss),json=JSON.stringify(tables),now=Date.now();
      const state={schema:1,revision:1,sheetsJSON:json,auxJSON:wcAux_(ss),updatedAt:now,
        backup:{revision:1,baselineJSON:json,status:'synced',completedAt:now}};
      if(!wcPut_(state,snapshot.etag))throw Error('초기화 중 클라우드가 변경됐어. 다시 확인해줘.');
      snapshot=wcRead_();
      if(snapshot.state.sheetsJSON!==json)throw Error('초기화 검증 실패');
    }
    if(snapshot.state.schema!==1)throw Error('지원하지 않는 클라우드 형식');
    WorkoutCloudCore.validate(JSON.parse(snapshot.state.sheetsJSON));
    const triggers=ScriptApp.getProjectTriggers();
    if(!triggers.some(t=>t.getHandlerFunction()==='backupWorkoutCloud'))ScriptApp.newTrigger('backupWorkoutCloud').timeBased().everyMinutes(1).create();
    props.setProperty('WC_ENABLED','yes');
    console.log('Firebase 초기화 확인 및 1분 간격 백업 트리거 준비 완료. revision='+snapshot.state.revision);
  });
}
function onOpen(){
  SpreadsheetApp.getUi().createMenu('☁️ 클라우드 동기화')
    .addItem('시트 수정 내용 → Firebase 즉시 반영','importWorkoutSheetToCloud')
    .addItem('백업 상태 확인','showWorkoutCloudStatus').addToUi();
}
function showWorkoutCloudStatus(){
  const s=wcRead_().state;if(!s)throw Error('초기화가 필요해.');
  SpreadsheetApp.getUi().alert('Firebase 버전: '+s.revision+'\n시트 백업 버전: '+s.backup.revision+'\n상태: '+s.backup.status+(s.backup.message?'\n'+s.backup.message:''));
}
function wcStatus_(status,message){
  for(let attempt=0;attempt<4;attempt++){
    const r=wcRead_();if(!r.state)return;
    const next={...r.state,backup:{...r.state.backup,status:status,message:String(message||'').slice(0,500)}};
    if(wcPut_(next,r.etag))return;
  }
}
function wcCanRecover_(base,current,target){
  // After an interrupted partial backup, every row must still be either the old
  // row or the intended row. A third version means a manual sheet edit: stop.
  for(const name of WorkoutCloudCore.names){
    const b=WorkoutCloudCore.rows(base[name]),c=WorkoutCloudCore.rows(current[name]),t=WorkoutCloudCore.rows(target[name]);
    for(const id of new Set([...b.keys(),...c.keys(),...t.keys()]))
      if(!WorkoutCloudCore.equal(name,c.get(id),b.get(id))&&!WorkoutCloudCore.equal(name,c.get(id),t.get(id)))return false;
  }
  return true;
}
function wcCompleteBackup_(job,actual,auxJSON){
  for(let attempt=0;attempt<5;attempt++){
    const r=wcRead_(),s=r.state;
    if(s.backup.inFlight?.id!==job.id)throw Error('백업 작업 버전이 변경됐어.');
    // A new app save may already exist. Acknowledge only this job's revision.
    const backup={revision:job.revision,baselineJSON:JSON.stringify(actual),completedAt:Date.now(),status:s.revision===job.revision?'synced':'pending'};
    if(wcPut_({...s,auxJSON,backup},r.etag))return;
  }
  throw Error('백업 완료 표시가 지연돼. 다음 실행에서 확인할게.');
}
function backupWorkoutCloud(){
  if(PropertiesService.getScriptProperties().getProperty('WC_ENABLED')!=='yes')return;
  return wcLock_(()=>{
    try{
      const ss=SpreadsheetApp.openById(WORKOUT_SHEET_ID);
      let r=wcRead_(),s=r.state;if(!s||s.schema!==1)throw Error('클라우드 형식 확인 필요');
      let current=wcTables_(ss),job=s.backup.inFlight;
      if(!job){
        const base=JSON.parse(s.backup.baselineJSON);
        if(WorkoutCloudCore.signature(current)!==WorkoutCloudCore.signature(base)){
          wcStatus_('sheet-edited','시트에 직접 수정한 내용이 있어. ☁️ 클라우드 동기화 메뉴로 반영해줘.');return;
        }
        if(s.revision===s.backup.revision){
          const auxJSON=wcAux_(ss);
          if(auxJSON!==s.auxJSON)wcPut_({...s,auxJSON},r.etag);
          return;
        }
        job={id:Utilities.getUuid(),revision:s.revision,targetJSON:s.sheetsJSON};
        if(!wcPut_({...s,backup:{...s.backup,status:'running',inFlight:job}},r.etag))return;
      }
      const target=JSON.parse(job.targetJSON),base=JSON.parse(s.backup.baselineJSON);
      WorkoutCloudCore.validate(target,base);
      if(!wcCanRecover_(base,current,target))throw Error('백업 도중 시트가 수정됐어. 자동 덮어쓰기를 중단했어.');
      // Re-read immediately before applying. Sheet UI edits are not covered by
      // Apps Script locks; do not edit the sheet while a backup is running.
      const check=wcTables_(ss);
      if(WorkoutCloudCore.signature(check)!==WorkoutCloudCore.signature(current))throw Error('시트 편집 중이어서 백업을 미뤘어.');
      workoutApply_(ss,current,target);SpreadsheetApp.flush();
      current=wcTables_(ss);
      if(WorkoutCloudCore.signature(current)!==WorkoutCloudCore.signature(target))throw Error('시트 백업 결과가 달라. 원본은 Firebase에 보관돼.');
      wcCompleteBackup_(job,current,wcAux_(ss));
    }catch(error){wcStatus_('error',error.message);throw error;}
  });
}
function importWorkoutSheetToCloud(){
  const result=wcLock_(()=>{
    const ss=SpreadsheetApp.openById(WORKOUT_SHEET_ID),local=wcTables_(ss);
    for(let attempt=0;attempt<5;attempt++){
      const r=wcRead_(),s=r.state;if(!s)throw Error('클라우드 초기화가 필요해.');
      if(s.backup.inFlight)throw Error('미완료 백업이 있어. 백업 상태를 먼저 확인해줘.');
      const merged=WorkoutCloudCore.merge(JSON.parse(s.backup.baselineJSON),local,JSON.parse(s.sheetsJSON));
      if(WorkoutCloudCore.signature(local)!==WorkoutCloudCore.signature(wcTables_(ss)))throw Error('시트 편집이 계속되고 있어. 편집을 마친 뒤 다시 실행해줘.');
      const changed=WorkoutCloudCore.signature(merged)!==WorkoutCloudCore.signature(JSON.parse(s.sheetsJSON));
      const revision=s.revision+(changed?1:0),same=WorkoutCloudCore.signature(merged)===WorkoutCloudCore.signature(local);
      const next={...s,revision,sheetsJSON:JSON.stringify(merged),updatedAt:Date.now(),
        backup:{...s.backup,baselineJSON:JSON.stringify(local),revision:same?revision:s.backup.revision,status:same?'synced':'pending',message:''}};
      if(wcPut_(next,r.etag))return {revision,changed};
    }
    throw Error('다른 기기에서 저장 중이야. 잠시 후 다시 실행해줘.');
  });
  SpreadsheetApp.getUi().alert(result.changed?'Firebase에 반영했어. 버전 '+result.revision:'Firebase와 비교를 완료했어. 버전 '+result.revision);
}
