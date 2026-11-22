const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('V46 Create Class retains V45 cross-device theme choices and original fields',()=>{
 const html=read('index.html');
 const section=html.slice(html.indexOf('<!-- CREATE CLASS MODAL -->'),html.indexOf('<!-- ADD STUDENTS MODAL -->'));
 assert.match(section,/id="sectionForm"/);
 for(const name of ['grade_level','name','import_archived_section','theme_id']) assert.match(section,new RegExp(`name="${name}"`));
 const values=[...section.matchAll(/name="theme_id" value="(\d+)"/g)].map(x=>Number(x[1]));
 assert.deepEqual(values,Array.from({length:16},(_,i)=>i));
 assert.match(section,/name="theme_id" value="0" checked="checked"/);
 assert.match(section,/id="ms46ThemePreview"/);
 assert.match(section,/id="ms46ThemeChoices"/);
 assert.match(section,/class="orange-step">4<\/span><div><strong>Reuse students/);
 assert.match(html,/css\/teacher-create-theme-v46\.css\?v=46\.0/);
 assert.match(html,/js\/teacher-create-theme-v46\.js\?v=46\.0/);
 for(const img of [...section.matchAll(/<img src="(assets\/[^\"]+)"/g)])assert.ok(fs.existsSync(path.join(root,img[1])),img[1]);
});
test('V46 both create handlers insert validated theme ID in same Supabase write',()=>{
 for(const f of ['js/app.js','js/v12-archive-features.js']){
  const js=read(f);
  const insertion=js.slice(js.indexOf("db.from('mathside_sections').insert({"),js.indexOf('}).select().single()',js.indexOf("db.from('mathside_sections').insert({"))+18);
  assert.match(insertion,/theme_id:\s*themeId/);
  assert.match(insertion,/teacher_id:\s*state\.user\.id/);
  assert.match(insertion,/grade_level:\s*grade/);
  assert.match(insertion,/\bname\b/);
  assert.match(js,/form\.get\('theme_id'\)/);
  assert.match(js,/if\s*\(!\/\^\(\?:\[0-9\]\|1\[0-5\]\)\$\/\.test\(themeId\)\)/);
 }
});
test('V46 inherits V45 SQL schema and refreshes installed PWA',()=>{
 const sql=read('sql/Mathside-V45-Class-Theme-Sync.sql');
 assert.match(sql,/mathside_sections/);assert.match(sql,/theme_id/);
 const sw=read('service-worker.js');
 assert.match(sw,/mathside-pwa-v46-create-class-theme/);
 assert.match(sw,/teacher-create-theme-v46/);
 assert.match(sw,/js\/app\.js\?v=46\.0-class-theme-creation/);
});
