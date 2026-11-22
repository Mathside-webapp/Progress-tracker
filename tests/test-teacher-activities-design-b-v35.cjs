const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname,'..');
const read = p => fs.readFileSync(path.join(ROOT,p),'utf8');
test('V35 approved Activities B table keeps functional legacy hooks and restores asset',()=>{
 const html=read('index.html'),css=read('css/teacher-activities-design-b-v35.css'),js=read('js/teacher-activities-design-b-v35.js'),sw=read('service-worker.js');
 for(const id of ['view-assignments','assignmentList','postAssignmentBtn','activitySectionFilter','activityStatusFilter','activitySort','ms35ActivitySearch']) assert.match(html,new RegExp('id="'+id+'"'));
 for(const id of ['ms35Total','ms35Posted','ms35Scheduled','ms35ToCheck'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/teacher-activities-design-b-v35.css\?v=35\.0/);
 assert.match(html,/teacher-activities-design-b-v35.js\?v=(?:35|36|38|40)\.0/);
 assert.match(js,/previousRender = renderAssignments/);
 for(const event of ['data-select-assignment','bulkArchiveAssignmentsBtn','bulkDeleteAssignmentsBtn','data-preview-assignment','data-edit-assignment','data-duplicate-assignment','data-archive-assignment-group','data-delete-assignment-group'])assert.ok(js.includes(event),event);
 assert.match(css,/#teacherApp #view-assignments .ms35-table/);
 assert.match(sw,/mathside-pwa-v(?:35-activities-design-b|36-activity-icons-hd-headers|37-performance-table|38-five-per-page|39-submissions-workspace|40-fixed-five-per-page|41-class-record-design-a|42-competencies-design-b|43-archive-design-a|44-art-and-class-designs|45-cloud-class-designs|46-create-class-theme)/);
 assert.match(sw,/teacher-activities-design-b-v35.css/);
 assert.match(sw,/teacher-activities-design-b-v35.js/);
 const png = path.join(ROOT,'assets/teacher-activities-v35/activities-header-hd.png');
 assert.ok(fs.existsSync(png));assert.ok(fs.statSync(png).size>100000);
 assert.ok(!html.includes('id="activityFilterPanel"'),'old duplicate filter form removed');
 // Other sections remain installed.
 for(const page of ['view-dashboard','view-classes','view-performance','view-records','view-submissions','view-archive'])assert.match(html,new RegExp('id="'+page+'"'));
});
