// No internet, no database credentials, no Supabase usage.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.join(__dirname, '..');
function src(p) { return fs.readFileSync(path.join(root,p),'utf8'); }

async function main() {
  const app = src('js/app.js');
  const from = app.indexOf('const MATHSIDE_IMPORT_MAX_BYTES =');
  const to = app.indexOf('\nfunction parseStudentWorkbook(sheets)', from);
  assert(from >= 0 && to > from, 'Workbook reader functions must be present');
  const sandbox = { Date, Error, Array, Uint8Array, TextDecoder, console, window: {} };
  vm.createContext(sandbox);
  vm.runInContext(app.slice(from,to) + '\nthis.readImport = mathsideReadImport; this.csvRows = mathsideCsvRows; this.sheetRows = mathsideSpreadsheetRows;', sandbox);

  const rows = sandbox.csvRows('Name,Gender\r\n"Dela Cruz, Ana",Female\r\n"John ""Jay"" Santos",Male\r\n');
  assert.equal(rows.length, 3);
  assert.equal(rows[1][0], 'Dela Cruz, Ana');
  assert.equal(rows[2][0], 'John "Jay" Santos');
  assert.equal(rows[2][1], 'Male');
  console.log('PASS: CSV parser preserves commas, quotes and blank lines');

  const textFile = (name, text) => ({name,size:Buffer.byteLength(text),text:async()=>text,arrayBuffer:async()=>Buffer.from(text)});
  const csv = await sandbox.readImport(textFile('student.csv','Name,Gender\nAlex,Nonbinary\n'),{allowCsv:true});
  assert.equal(csv[0].rows[1][0], 'Alex');
  await assert.rejects(sandbox.readImport(textFile('sf1.xls','legacy')),/\.xlsx/);
  await assert.rejects(sandbox.readImport({...textFile('huge.xlsx','some'),size:9*1024*1024}),/8 MB/);
  console.log('PASS: .csv accepted; .xls rejected; oversized import rejected');

  const xlsx = textFile('safe.xlsx','mock');
  let processedSheets = 0;
  sandbox.window.ExcelJS = class {
    constructor() { this.xlsx={load: async data => {assert(data.byteLength); return this;}}; }
    eachSheet(fn) {
      processedSheets++;
      fn({name:'Questions',eachRow(opts,add){
        assert.equal(opts.includeEmpty,true);
        add({eachCell(args, callback){callback({value:'Question'},1);callback({value:'Answer'},2);}},1);
        add({eachCell(args, callback){callback({value:{text:'What is 2+2?'}},1);callback({value:{result:4}},2);}},2);
      }});
    }
  };
  // Function is called with `new ExcelJS.Workbook()`.
  sandbox.window.ExcelJS.Workbook = sandbox.window.ExcelJS;
  sandbox.ExcelJS = sandbox.window.ExcelJS;
  const result = await sandbox.readImport(xlsx);
  assert.equal(processedSheets,1);
  assert.equal(result[0].rows[1][0],'What is 2+2?');
  assert.equal(result[0].rows[1][1],'4');
  console.log('PASS: ExcelJS .xlsx reader maintains row/column order');

  // Verify webpush ingress without ever using an actual Supabase project.
  let handler;
  const mockEnvironment = {
    VAPID_PUBLIC_KEY:'public-key',VAPID_PRIVATE_KEY:'private-key',
    MATHSIDE_PUSH_WEBHOOK_SECRET:'a'.repeat(40),
    SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'local-test-only'
  };
  let queriedNotification = 0;
  const dbNote = {id:'00000000-0000-4000-8000-000000000001',user_id:'00000000-0000-4000-8000-000000000002', title:'Real server title',body:'Real body',type:'system',related_assignment_id:null,related_submission_id:null};
  const query = {
    select(){return this;},
    eq(col,val){
      if(col==='id') { queriedNotification++; assert.equal(val,dbNote.id); }
      if(col==='user_id') assert.equal(val,dbNote.user_id);
      return this;
    },
    maybeSingle:async()=>({data:dbNote,error:null}),
    then(resolve){ return Promise.resolve({data:[],error:null}).then(resolve); }
  };
  const admin={from(table){assert(['mathside_notifications','mathside_push_subscriptions'].includes(table));return query;}};
  const pushSource = src('supabase/functions/send-push-notification/index.ts')
    .replace(/^import .*?;\r?\n/gm,'')
    .replace(/^import webpush from .*?;\r?\n/gm,'')
    .replace('const corsHeaders =', 'const webpush = {setVapidDetails(){},sendNotification:async()=>{}};\nconst createClient = () => globalThis.testAdmin;\nconst corsHeaders =');
  const transpiled=ts.transpileModule(pushSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None},reportDiagnostics:true});
  assert(!transpiled.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error),'TypeScript parse must pass');
  const deno = {env:{get:key=>mockEnvironment[key]},serve(cb){handler=cb;}};
  const sandboxPush = {Deno:deno, Response, Request, TextEncoder, TextDecoder, Uint8Array, crypto:globalThis.crypto, console, globalThis:{testAdmin:admin}};
  vm.runInNewContext(transpiled.outputText,sandboxPush);
  assert.equal(typeof handler,'function');
  const record={type:'INSERT',schema:'public',table:'mathside_notifications',record:{id:dbNote.id,user_id:'00000000-0000-4000-8000-000000000099',title:'Forged',body:'Bogus'}};
  const req = (secret) => new Request('https://test.invalid/notify',{method:'POST',headers:{'Content-Type':'application/json',...(secret?{'x-mathside-webhook-secret':secret}:{})},body:JSON.stringify(record)});
  const without=await handler(req());
  assert.equal(without.status,401);
  const wrong=await handler(req('incorrect'));
  assert.equal(wrong.status,401);
  assert.equal(queriedNotification,0,'Unauthorized requests must not touch DB');
  const valid=await handler(req(mockEnvironment.MATHSIDE_PUSH_WEBHOOK_SECRET));
  assert.equal(valid.status,200);
  assert.equal((await valid.json()).delivered,0);
  assert.equal(queriedNotification,1);
  mockEnvironment.MATHSIDE_PUSH_WEBHOOK_SECRET='';
  assert.equal((await handler(req('a'.repeat(40)))).status,503);
  console.log('PASS: push webhook rejects unauthorized calls and loads real DB note');

  const sql=src('supabase/sql/18-security-proof-upload-policy.sql');
  assert(sql.includes('mathside_private.student_in_section'));
  assert(sql.includes("a.status = 'published'"));
  assert(sql.includes('array_length(storage.foldername(name), 1) = 2'));
  assert(!src('index.html').includes('xlsx@0.18.5'));
  assert(!app.includes('window.XLSX'));
  const pw=src('supabase/functions/create-students/index.ts');
  assert(pw.includes('result.length < 16'));
  assert(src('supabase/functions/reset-student-passwords/index.ts').includes('chosenPassword.length < 12'));
  console.log('PASS: least-privilege SQL, removed vulnerable import, stronger credentials');
}
main().catch(error=>{console.error(error);process.exit(1)});
