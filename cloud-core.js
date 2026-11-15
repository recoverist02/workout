/* Shared by the browser and Apps Script. No credentials or personal records. */
var WorkoutCloudCore = (() => {
  const widths = {'운동기록':16,'신체수치':9,'운동리스트':4,'목표':12,'운동계획':6,'식단계획':5};
  const names = Object.keys(widths);
  const width = name => name === '운동기록' ? 15 : widths[name];
  const canonical = (row, n) => row == null ? null : JSON.stringify(Array.from({length:n}, (_,i) => row[i] == null || row[i] === '' ? null : row[i]));
  const equal = (name,a,b) => canonical(a,width(name)) === canonical(b,width(name));
  const rows = table => new Map(table.slice(1).filter(r=>r[0]!=null && r[0]!=='').map(r=>[String(r[0]),r]));
  function fail(message,code='INVALID'){const e=new Error(message);e.code=code;throw e;}
  function validate(tables, original=tables) {
    for(const name of names){
      const table=tables?.[name];
      if(!Array.isArray(table)||!table.length||table.length>10000||canonical(table[0],widths[name])!==canonical(original?.[name]?.[0],widths[name]))fail(name+': 열 구성을 확인해줘.');
      const ids=new Set();
      for(const row of table.slice(1)){
        if(!Array.isArray(row)||row.length>widths[name]||row.some(v=>v!=null && typeof v!=='string' && !(typeof v==='number'&&Number.isFinite(v))))fail(name+': 잘못된 기록 형식');
        if(row[0]==null||row[0]==='')continue;
        const id=String(row[0]);if(ids.has(id)||id.length>128)fail(name+': 중복 또는 잘못된 ID');ids.add(id);
        if(['운동기록','신체수치'].includes(name)&&(!Number.isFinite(Number(row[1]))||Number(row[1])<1))fail('날짜를 확인해줘.');
      }
    }
    return tables;
  }
  function score(row){
    if(row[2]==='유산소')return row[13]==null||row[13]===''?null:row[13];
    const total=row.slice(6,11).reduce((sum,v)=>sum+(typeof v==='number'?v:0),0);
    if(row[5]==null||row[5]===''||!total)return null;
    const value=Number(row[5])*total*Math.log(Number(row[5])/5+1)/100;
    if(!Number.isFinite(value))fail('무게를 확인해줘.');return value;
  }
  function clean(tables){
    validate(tables);
    const result={};
    for(const name of names)result[name]=[tables[name][0],...rows(tables[name]).values()].map((r,i)=>{
      const row=JSON.parse(canonical(r,widths[name]));
      if(i&&name==='운동기록')row[15]=score(row);return row;
    });
    return result;
  }
  function signature(tables){return JSON.stringify(names.map(name=>[canonical(tables[name][0],widths[name]),...[...rows(tables[name])].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,row])=>canonical(row,width(name)))]));}
  function merge(base,local,remote){
    validate(local,base);validate(remote,base);const result={};const conflicts=[];
    for(const name of names){
      const b=rows(base[name]),l=rows(local[name]),r=rows(remote[name]);const output=[];
      for(const id of new Set([...r.keys(),...l.keys(),...b.keys()])){
        let row;
        if(equal(name,l.get(id),b.get(id)))row=r.get(id);
        else if(equal(name,r.get(id),b.get(id))||equal(name,l.get(id),r.get(id)))row=l.get(id);
        else {conflicts.push(name+' / '+id);continue;}
        if(row)output.push(row);
      }
      result[name]=[remote[name][0],...output];
    }
    if(conflicts.length)fail('양쪽에서 바뀐 기록이 있어. 덮어쓰지 않았어: '+conflicts.slice(0,8).join(', '),'CONFLICT');
    return clean(result);
  }
  function apply(state,request,baseline){
    if(state?.schema!==1||!Number.isSafeInteger(state.revision))fail('클라우드 초기화를 확인해줘.');
    const tables=JSON.parse(state.sheetsJSON);validate(tables);
    let result={};const name=request.table;
    if(request.action==='save'){
      if(String(state.revision)!==String(request.revision))fail('다른 곳에서 기록이 바뀌었어. 새로고침해줘.','CONFLICT');
      validate(request.sheets,tables);for(const key of names)tables[key]=request.sheets[key];
    }else{
      if(!names.includes(name))fail('지원하지 않는 기록 종류야.');
      const map=rows(tables[name]),id=String(request.row?.[0]??request.id??'');
      if(!id||id.length>128)fail('기록 ID를 확인해줘.');
      const current=map.get(id)||null;
      if(request.action==='saveRecord'){
        if(!Array.isArray(request.row)||request.previous!==null&&(!Array.isArray(request.previous)||String(request.previous[0])!==id))fail('이전 기록을 확인해줘.');
        if(!equal(name,current,request.row)&&!equal(name,current,request.previous))fail('이 기록이 다른 곳에서 변경됐어. 입력값은 보관했어.','CONFLICT');
        map.set(id,request.row);result={table:name,id,row:request.row};
      }else if(request.action==='deleteRecord'){
        if(!['운동기록','신체수치'].includes(name))fail('삭제할 기록을 확인해줘.');
        if(current && (!baseline||!equal(name,current,rows(baseline[name]).get(id))))fail('삭제 전에 기록이 변경됐어. 새로고침해줘.','CONFLICT');
        map.delete(id);result={table:name,id,exists:false,deleted:true};
      }else fail('지원하지 않는 요청이야.');
      tables[name]=[tables[name][0],...map.values()];
    }
    const next=clean(tables),changed=signature(next)!==signature(JSON.parse(state.sheetsJSON));
    if(result.row)result.row=rows(next[name]).get(result.id);
    return {state:changed?{...state,sheetsJSON:JSON.stringify(next),revision:state.revision+1,updatedAt:Date.now()}:state,result,changed};
  }
  return {names,widths,width,canonical,equal,rows,validate,score,clean,signature,merge,apply,fail};
})();
if(typeof module!=='undefined')module.exports=WorkoutCloudCore;
