const WORKOUT_SHEET_ID = 'SET_WORKOUT_SPREADSHEET_ID';
const WORKOUT_READ = {'운동기록':16,'운동리스트':4,'현황':21,'신체수치':9,'목표':12,'신체수치현황':24,'운동계획':6,'식단계획':5,'건강데이터':8,'주간브리핑':10,'브리핑이력':17};
const WORKOUT_EDIT = ['운동기록','신체수치','운동리스트','목표','운동계획','식단계획'];
function workoutRead_(ss,names){
 try{return workoutBatchRead_(names||Object.keys(WORKOUT_READ));}catch(error){console.warn('Batch read unavailable; using Spreadsheet service: '+String(error.message||error));}
 const tables={};
 (names||Object.keys(WORKOUT_READ)).forEach(function(name){
  const sheet=ss.getSheetByName(name);if(!sheet)throw Error('시트를 찾지 못했어: '+name);
  const count=WORKOUT_EDIT.indexOf(name)!==-1?workoutLastInputRow_(sheet):sheet.getLastRow();if(count>10000)throw Error(name+': 데이터가 10,000행을 넘었어. 연결 범위를 확장해야 해.');
  let data=sheet.getRange(1,1,Math.max(1,count),WORKOUT_READ[name]).getValues();
  data=data.map(function(row){return row.map(function(v){
   if(v instanceof Date){const s=Utilities.formatDate(v,'Asia/Seoul','yyyy-MM-dd');return Math.round(Date.parse(s+'T00:00:00Z')/86400000)+25569;}
   return v===''?null:v;
  });});
  while(data.length>1&&data[data.length-1].every(function(v){return v===null;}))data.pop();
  tables[name]=data;
 });return tables;
}
function workoutCanonical_(row,width){if(!row)return null;return JSON.stringify(Array.from({length:width},function(_,i){return row[i]===undefined||row[i]===''?null:row[i];}));}
function workoutInputWidth_(name){return name==='운동기록'?15:WORKOUT_READ[name];}
function workoutApply_(ss,current,next){
 const operations=[];
 WORKOUT_EDIT.forEach(function(k){
  const sheet=ss.getSheetByName(k),width=workoutInputWidth_(k),existing={};
  current[k].slice(1).forEach(function(row,i){if(row[0]!=null&&row[0]!=='')existing[String(row[0])]={row:row,index:i+2};});
  const ids={};let append=Object.keys(existing).reduce(function(last,id){return Math.max(last,existing[id].index);},1)+1;
  next[k].slice(1).forEach(function(row){if(row[0]==null||row[0]==='')return;const id=String(row[0]);ids[id]=true;const old=existing[id];
   if(old&&workoutCanonical_(old.row,width)===workoutCanonical_(row,width))return;
   operations.push({sheet:sheet,k:k,index:old?old.index:append++,width:width,row:Array.from({length:width},function(_,i){const v=row[i];return v==null?'':typeof v==='string'&&v.startsWith('=')?"'"+v:v;})});
  });
  Object.keys(existing).forEach(function(id){if(!ids[id])operations.push({sheet:sheet,k:k,index:existing[id].index,width:width,row:null});});
 });
 const undo=[];
 try{operations.forEach(function(op){
  if(op.index>op.sheet.getMaxRows())op.sheet.insertRowsAfter(op.sheet.getMaxRows(),op.index-op.sheet.getMaxRows());
  const range=op.sheet.getRange(op.index,1,1,op.width);
  const old=range.getValues()[0],formulas=range.getFormulas()[0];undo.push({range:range,row:old.map(function(v,i){return formulas[i]||v;})});
  if(op.row){
   op.sheet.getRange(op.index,1,1,op.width).setValues([op.row]);
   if(op.k==='운동기록'||op.k==='신체수치')op.sheet.getRange(op.index,2).setNumberFormat('yyyy-mm-dd');}
  else range.clearContent();
 });}catch(e){undo.reverse().forEach(function(op){try{op.range.setValues([op.row]);}catch(ignored){}});throw e;}
}
function workoutLastInputRow_(sheet){
 const bottom=sheet.getRange(sheet.getMaxRows(),1);
 if(bottom.getValue()!=='')return sheet.getMaxRows();
 return Math.max(1,bottom.getNextDataCell(SpreadsheetApp.Direction.UP).getRow());
}
function workoutBatchRead_(names){
 const ranges=names.map(function(name){return "'"+name.replace(/'/g,"''")+"'!A1:"+workoutColumn_(WORKOUT_READ[name])+"10001";});
 const values=Sheets.Spreadsheets.Values.batchGet(WORKOUT_SHEET_ID,{ranges:ranges,valueRenderOption:'UNFORMATTED_VALUE',dateTimeRenderOption:'SERIAL_NUMBER'}).valueRanges;
 if(!Array.isArray(values)||values.length!==names.length)throw Error('Incomplete batch read');
 const tables={};
 names.forEach(function(name,i){
  const width=WORKOUT_READ[name];let rows=values[i].values||[];
  if(rows.length>10000)throw Error(name+': 데이터가 10,000행을 넘었어.');
  rows=rows.map(function(row){return Array.from({length:width},function(_,column){return row[column]===undefined||row[column]===''?null:row[column];});});
  while(rows.length>1&&rows[rows.length-1].every(function(value){return value===null;}))rows.pop();
  if(!rows.length)throw Error(name+': 헤더가 없어.');
  tables[name]=rows;
 });return tables;
}
function workoutColumn_(n){let result='';while(n>0){n--;result=String.fromCharCode(65+n%26)+result;n=Math.floor(n/26);}return result;}
