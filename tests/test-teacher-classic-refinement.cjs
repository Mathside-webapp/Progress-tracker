const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const css = fs.readFileSync(path.join(root,'css/teacher-classic-refinement.css'),'utf8');
const sw = fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
assert.match(html,/css\/teacher-classic-refinement\.css\?v=24\.28-teacher-compact/);
assert.match(sw,/css\/teacher-classic-refinement\.css\?v=24\.28-teacher-compact/);
assert.match(sw,/mathside-pwa-v24-(?:30-all-teacher-panels|31-preview-matched-records|32-record-scores-ui)/);
for (const id of ['view-dashboard','view-classes','view-assignments','view-performance','view-submissions','view-competencies','view-archive']) {
  assert.ok(html.includes(`id="${id}"`),`Missing ${id}`);
}
for (const id of ['sectionModal','assignmentModal','performanceTaskModal']) {
  assert.ok(html.includes(`id="${id}"`),`Missing original creation dialog ${id}`);
  assert.ok(!css.includes(`#${id}`),`Refinement touches original creation dialog ${id}`);
}
assert.ok(!css.includes('#studentApp'), 'No student UI selectors allowed');
assert.ok(!css.includes('#publicSite'), 'No public UI selectors allowed');
assert.match(css,/#teacherApp\s+\.ms-panel-hero:not\(\.ct-page-hero\)\s+\.ms-hero-art img/);
for(const file of ['assets/mathside-icon.svg','assets/panel-identity/dashboard-workspace.svg','assets/panel-identity/classes-study.svg','assets/panel-identity/activities.svg','assets/panel-identity/performance-project.svg','assets/panel-identity/submissions.svg','assets/panel-identity/competencies.svg','assets/panel-identity/archive-records.svg']){
  assert.ok(fs.existsSync(path.join(root,file)),`Missing original asset ${file}`);
}
console.log('PASS: teacher-only styling, preserved creation dialogs, illustration references, and PWA cache');
