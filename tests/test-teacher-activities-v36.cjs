const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');const read=name=>fs.readFileSync(path.join(root,name),'utf8');
test('V36 icon-only bulk actions, per-page control and three targeted image assets',()=>{
 const html=read('index.html'),js=read('js/teacher-activities-design-b-v35.js'),css=read('css/teacher-v36-polish.css'),sw=read('service-worker.js');
 assert.match(html,/teacher-v36-polish\.css\?v=36\.0/);
 assert.match(html,/teacher-activities-design-b-v35\.js\?v=(?:36|38|40)\.0/);
 for(const label of ['Archive selected activities','Delete selected activities']) assert.ok(js.includes(label));
 for(const name of ['archive','trash']) assert.ok(js.includes('svg(\''+name+'\')'));
 assert.match(js,/id="bulkArchiveAssignmentsBtn"/);assert.match(js,/id="bulkDeleteAssignmentsBtn"/);
 assert.doesNotMatch(js,/ms35PageSize|Rows per page/);assert.match(js,/const rowsPerPage = 5/);
 assert.match(js,/scrollIntoView/);
 assert.match(css,/\.ms35-bulk-icon/);assert.match(css,/border:0!important/);
 for(const file of ['dashboard-crisp.png','classes-crisp.png','activities-crisp.png']){
  const rel='assets/teacher-headers-v36/'+file;
  assert.ok(fs.statSync(path.join(root,rel)).size>250000);
  assert.ok(sw.includes('./'+rel));assert.ok(css.includes(file));
 }
 assert.match(sw,/mathside-pwa-v(?:36-activity-icons-hd-headers|37-performance-table|38-five-per-page|39-submissions-workspace|40-fixed-five-per-page|41-class-record-design-a|42-competencies-design-b|43-archive-design-a|44-art-and-class-designs|45-cloud-class-designs|46-create-class-theme)/);
});
