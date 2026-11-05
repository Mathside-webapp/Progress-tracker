const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html');const css=read('css/teacher-empty-art-v24.32.css');const js=read('js/teacher-empty-art-v24.32.js');
const iconJs=read('js/teacher-preview-fixes-v24.32.js'); const record=read('js/v10-features.js');
const files=['activities','submissions','performance','classes','competencies','archive'];
for(const name of files){
 const f=`assets/empty-states/${name}.svg`;const content=read(f);
 assert.match(content,/^<svg .*xmlns="http:\/\/www.w3.org\/2000\/svg"/);
 assert(!/onload=|<script|http:\/\/(?!www\.w3\.org)/i.test(content),'unsafe remote ref in '+f);
 assert.match(js,new RegExp(name));
}
assert.match(html,/teacher-empty-art-v24\.32\.css/);assert.match(html,/teacher-empty-art-v24\.32\.js/);
assert.match(js,/new MutationObserver/);assert.match(js,/document\.getElementById\('teacherApp'\)/);
assert.match(css,/#teacherApp \.ms-has-empty-art/);
assert.match(iconJs,/aria-label/);assert.match(iconJs,/data-ms-archive-category/);
assert.match(record,/async function classRecordPreview\(sectionId\)/);
assert.match(record,/classRecordPreview\s*\n\s*};/);
console.log('PASS: 6 original SVG empty states, scoped injection, accessible icon actions, archive tabs, preserved class-record reader');
