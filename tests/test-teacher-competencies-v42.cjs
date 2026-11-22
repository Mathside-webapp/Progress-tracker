const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs');
test('V42 teacher competency management keeps original tracker and five-row paging',()=>{
const html=fs.readFileSync('index.html','utf8'), js=fs.readFileSync('js/competency-tracker.js','utf8'), sw=fs.readFileSync('service-worker.js','utf8');
for(const id of ['ctDashboardGrade','ctDashboardSection','ctDashboardStudentSearch','ctDashboardAddCompetency','ctLibraryList','ctTeacherList','ctCreateOverlay','ctDeleteDialog']) assert.match(html,new RegExp(`id="${id}"`));
assert.match(js,/MS42_PAGE_SIZE=5/);assert.match(js,/slice\(offset,offset\+MS42_PAGE_SIZE\)/);assert.match(js,/x>=85\?'mastered'/);assert.match(js,/state\.archivedScores/);assert.match(js,/mathside_ct_my_progress/);assert.match(js,/mathside_ct_assign_competency/);assert.match(js,/mathside_ct_delete_competency/);assert.match(sw,/mathside-pwa-v(?:42-competencies-design-b|43-archive-design-a|44-art-and-class-designs|45-cloud-class-designs|46-create-class-theme)/);assert.ok(fs.existsSync('assets/teacher-competencies-v42/competencies-header.png'));
});
