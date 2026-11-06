const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sw=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
const css=fs.readFileSync(path.join(root,'css/teacher-all-panels-v24.30.css'),'utf8');
assert.match(html,/teacher-all-panels-v24\.30\.css\?v=24\.30/);
assert.match(sw,/teacher-all-panels-v24\.30\.css\?v=24\.30/);
assert.match(sw,/mathside-pwa-v24-(?:30-all-teacher-panels|31-preview-matched-records|32-record-scores-ui|34-css-recovery-png|35-student-zigzag-css)/);
for(const page of ['dashboard','classes','assignments','performance','submissions','competencies','archive']){
  assert.ok(html.includes(`id="view-${page}"`),`Missing teacher page: ${page}`);
}
for(const page of ['classes','assignments','performance','submissions','competencies','archive']){
  assert.ok(css.includes(`#view-${page}`),`Missing refined page: ${page}`);
}
for(const protectedId of ['#studentApp','#publicSite','#sectionModal','#assignmentModal','#performanceTaskModal']){
  assert.ok(!css.includes(protectedId),`Protected surface referenced in teacher styles: ${protectedId}`);
}
assert.match(css,/\.class-card-top\{display:contents!important\}/);
assert.match(css,/\.grade-pill[\s\S]*grid-row:1 \/ 3/);
assert.match(css,/\.assignment-group-card \.assignment-card-actions/);
for (const file of ['assets/mathside-icon.svg','assets/panel-identity/dashboard-workspace.svg', 'assets/panel-identity/classes-study.svg', 'assets/panel-identity/activities.svg', 'assets/panel-identity/performance-project.svg', 'assets/panel-identity/submissions.svg', 'assets/panel-identity/competencies.svg', 'assets/panel-identity/archive-records.svg']) {
  assert.ok(fs.existsSync(path.join(root,file)),`Missing protected art: ${file}`);
}
console.log('PASS: seven teacher panels styled, grade alignment, no protected UI selectors, retained artwork and PWA version');
