const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html');const css=read('css/teacher-empty-art-v24.32.css');const js=read('js/teacher-empty-art-v24.32.js');
const iconJs=read('js/teacher-preview-fixes-v24.32.js'); const record=read('js/v10-features.js');
const files=['activities','submissions','performance','classes','competencies','archive','records'];
for(const name of files){
 const f=`assets/empty-states/${name}.png`;const content=read(f);
 assert.ok(require('fs').readFileSync(require('path').join(root,f)).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'Expected PNG file');
 assert(!/onload=|<script|http:\/\/(?!www\.w3\.org)/i.test(content),'unsafe remote ref in '+f);
 assert.match(js,new RegExp(name));
}
assert.match(html,/teacher-empty-art-v24\.32\.css/);assert.match(html,/teacher-empty-art-v24\.32\.js/);
assert.match(js,/new MutationObserver/);assert.match(js,/document\.getElementById\('teacherApp'\)/);
assert.match(css,/#teacherApp \.ms-has-empty-art/);
assert.match(iconJs,/aria-label/);assert.match(iconJs,/data-ms-archive-category/);
assert.match(record,/async function classRecordPreview\(sectionId\)/);
assert.match(record,/classRecordPreview\s*\n\s*};/);
console.log('PASS: 7 PNG empty states, scoped injection, accessible icon actions, archive tabs, preserved class-record reader');
