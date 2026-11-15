const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../cloud-core.js');global.WorkoutCloudCore=C;const Client=require('../cloud-client.js');
const clone=x=>JSON.parse(JSON.stringify(x));
function tables(){const t={};for(const [name,w]of Object.entries(C.widths))t[name]=[Array.from({length:w},(_,i)=>i?'col'+i:'ID')];return t;}
const row=(id='r1',weight=30)=>[id,46300,'근력','가슴','체스트프레스',weight,12,12,12,null,null,null,null,null,null,null];
function state(t=tables()){const j=JSON.stringify(C.clean(t));return {schema:1,revision:1,sheetsJSON:j,auxJSON:'{}',backup:{revision:1,baselineJSON:j,status:'synced'}};}
function add(s,r){return C.apply(s,{action:'saveRecord',table:'운동기록',row:r,previous:null},JSON.parse(s.sheetsJSON)).state;}
function harness(initial){let s=clone(initial),version=1,calls=[],beforePut=null;
return {get state(){return s},set state(v){s=clone(v);version++},calls,set beforePut(fn){beforePut=fn},fetch:async(url,init)=>{
 calls.push({url,method:init.method||'GET'});
 if(init.method==='PUT'){
  if(beforePut){const fn=beforePut;beforePut=null;fn();}
  if(init.headers['if-match']!==String(version))return {status:412,ok:false};
  s=JSON.parse(init.body);version++;
 }
 return {ok:true,status:200,headers:{get:()=>String(version)},json:async()=>clone(s)};
}};}
test('score matches worksheet formula, including cardio and blank cells',()=>{
 assert.equal(C.score(row()),30*36*Math.log(7)/100);
 const r=row();r[2]='유산소';r[13]=45;assert.equal(C.score(r),45);r[13]=null;assert.equal(C.score(r),null);
 r[2]='근력';r[5]=null;assert.equal(C.score(r),null);
});
test('JSON payload preserves numeric IDs, null cells and sparse-looking rows',()=>{
 const t=tables();t['운동기록'].push(row(10001));const s=state(t);assert.ok(Array.isArray(JSON.parse(s.sheetsJSON)['운동기록'][1]));
 assert.equal(JSON.parse(s.sheetsJSON)['운동기록'][1][9],null);
});
test('edits are idempotent but conflicting edits fail',()=>{
 let s=add(state(),row());assert.equal(C.apply(s,{action:'saveRecord',table:'운동기록',row:row(),previous:null}).changed,false);
 assert.throws(()=>C.apply(s,{action:'saveRecord',table:'운동기록',row:row('r1',40),previous:null}),/다른 곳/);
});
test('three-way sheet import merges independent changes and protects conflicts/deletions',()=>{
 const b=tables();b['운동기록'].push(row());const l=clone(b),r=clone(b);l['운동기록'].push(row('sheet'));r['운동기록'].push(row('cloud'));
 assert.equal(C.merge(b,l,r)['운동기록'].length,4);
 l['운동기록'][1]=row('r1',40);r['운동기록'][1]=row('r1',50);assert.throws(()=>C.merge(b,l,r),/양쪽/);
 l['운동기록'].splice(1,1);assert.throws(()=>C.merge(b,l,r),/양쪽/);
});
test('normal reads and writes only contact Firebase and preserve concurrent additions',async()=>{
 const h=harness(state()),client=Client({fetcher:h.fetch,token:async()=>'test-token',url:'https://example.test/workout_primary_v1.json'});
 await client.call({action:'read'});h.beforePut=()=>{h.state=add(h.state,row('other'));};
 const res=await client.call({action:'saveRecord',table:'운동기록',row:row(),previous:null});
 assert.equal(res.sheets['운동기록'].length,3);assert.equal(res.backup.pending,true);assert.equal(res.scorePending,false);
 assert.ok(h.calls.every(c=>c.url.startsWith('https://example.test/')));
});
test('stale delete cannot remove a concurrently edited row',async()=>{
 const h=harness(add(state(),row())),client=Client({fetcher:h.fetch,token:async()=>'t',url:'https://example.test/data.json'});
 await client.call({action:'read'});h.beforePut=()=>{h.state=C.apply(h.state,{action:'saveRecord',table:'운동기록',row:row('r1',40),previous:row()}).state;};
 await assert.rejects(client.call({action:'deleteRecord',table:'운동기록',id:'r1'}),/삭제 전에/);
 assert.equal(JSON.parse(h.state.sheetsJSON)['운동기록'][1][5],40);
});
test('network failure is not reported as saved',async()=>{
 let fail=false;const h=harness(state()),client=Client({fetcher:(...args)=>{if(fail)throw Error('offline');return h.fetch(...args)},token:async()=>'t',url:'https://example.test/data.json'});
 await client.call({action:'read'});fail=true;await assert.rejects(client.call({action:'saveRecord',table:'운동기록',row:row(),previous:null}),/offline/);
 assert.equal(h.state.revision,1);
});
test('invalid types, duplicates, headers and non-finite values rejected',()=>{
 const t=tables();t['운동기록'].push(row(),row());assert.throws(()=>C.validate(t),/중복/);
 t['운동기록'].pop();t['운동기록'][1][5]=Infinity;assert.throws(()=>C.validate(t),/형식/);
});
function server(initial,initialTables){
 let s=clone(initial),sheet=clone(initialTables),v=1,applyFailure=false,onApply=null;
 const ctx={WorkoutCloudCore:C,WORKOUT_EDIT:C.names,WORKOUT_READ:C.widths,WORKOUT_SHEET_ID:'test',console,
  PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'yes'})},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  SpreadsheetApp:{openById:()=>({}),flush(){},getUi:()=>({alert(){}})},
  Utilities:{getUuid:()=> 'job1'},workoutRead_:()=>clone(sheet),workoutApply_:(_,current,target)=>{if(onApply)onApply();if(applyFailure){sheet['운동기록']=clone(target['운동기록']);throw Error('partial write');}sheet=clone(target);}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(__dirname+'/../firebase-server/CloudPrimary.gs','utf8'),ctx);
 ctx.wcRead_=()=>({state:clone(s),etag:String(v)});
 ctx.wcPut_=(next,etag)=>{if(etag!==String(v))return null;s=clone(next);v++;return {state:clone(s),etag:String(v)};};
 ctx.wcAux_=()=> '{}';
 return {ctx,get state(){return s},get sheet(){return sheet},set sheet(t){sheet=clone(t)},set fail(f){applyFailure=f},set onApply(fn){onApply=fn},advance(fn){s=fn(s);v++;}};
}
test('server worker backs up after browser closes and only acknowledges captured revision',()=>{
 const base=tables(),s=server(add(state(base),row()),base);
 s.onApply=()=>s.advance(x=>add(x,row('later')));s.ctx.backupWorkoutCloud();
 assert.equal(s.state.revision,3);assert.equal(s.state.backup.revision,2);assert.equal(s.state.backup.status,'pending');assert.equal(s.sheet['운동기록'].length,2);
});
test('manual sheet edits pause backup without overwriting',()=>{
 const base=tables(),s=server(add(state(base),row()),base),edited=clone(base);edited['운동기록'].push(row('manual'));s.sheet=edited;
 s.ctx.backupWorkoutCloud();assert.equal(s.state.backup.status,'sheet-edited');assert.equal(s.sheet['운동기록'][1][0],'manual');
});
test('interrupted partial backup retains journal and safely retries',()=>{
 const base=tables(),s=server(add(state(base),row()),base);s.fail=true;
 assert.throws(()=>s.ctx.backupWorkoutCloud(),/partial/);assert.ok(s.state.backup.inFlight);assert.equal(s.state.backup.revision,1);
 s.fail=false;s.ctx.backupWorkoutCloud();assert.equal(s.state.backup.revision,2);assert.equal(s.state.backup.inFlight,undefined);
});
test('manual import preserves pending cloud rows and schedules merged backup',()=>{
 const base=tables(),s=server(add(state(base),row('cloud')),base),local=clone(base);local['운동기록'].push(row('manual'));s.sheet=local;
 s.ctx.importWorkoutSheetToCloud();assert.equal(JSON.parse(s.state.sheetsJSON)['운동기록'].length,3);
 s.ctx.backupWorkoutCloud();assert.equal(s.sheet['운동기록'].length,3);assert.equal(s.state.backup.revision,s.state.revision);
});
