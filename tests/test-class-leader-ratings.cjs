// Local regression tests: no Supabase credentials or live database are used.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const base = require('node:path').join(__dirname, '..');
const source = fs.readFileSync(base + '/js/v10-features.js', 'utf8');
const start = source.indexOf('  function savedClassRecordValue(');
const end = source.indexOf('  function styleRecordTitle(', start);
assert(start >= 0 && end > start);
const context = {
  state: { submissions: [] },
  submissionNumericScore: submission => submission && submission.status === 'graded' && submission.teacher_score != null ? Number(submission.teacher_score) : null,
  performanceRatingDeduction: rating => ({5:0,4:2,3:3,2:4,1:5}[Number(rating)] ?? null)
};
vm.createContext(context);
vm.runInContext(source.slice(start,end), context);
const task = {id:'a',status:'published',collaboration_mode:'class'};
const group = {id:'g', name:'Class',leader_id:'leader',members:[{id:'leader'},{id:'student'}]};
const data = new Map([['a',{groups:[group],ratingsByGroup:new Map([['g',new Map([['student',4]])]])}]]);
const pick = id => context.performanceTaskExportScore(task,id,data,new Map(),new Map());
context.state.submissions = [
  {assignment_id:'a',student_id:'leader',status:'graded',teacher_score:20},
  {assignment_id:'a',student_id:'student',status:'graded',teacher_score:18,is_class_mirror:true}
];
assert.equal(pick('leader').value,20,'leader gets teacher grade');
assert.equal(pick('student').value,18,'deduction must not be applied twice');
context.state.submissions[1].teacher_score = 20;
assert.equal(pick('student').value,20,'teacher override must not be deducted');
context.state.submissions[1].teacher_score = null;
assert.equal(pick('student').value,'Not rated');
task.collaboration_mode = 'group';
assert.equal(pick('student').value,18,'old Group mode still subtracts participation deduction');

const js = fs.readFileSync(base + '/js/v15-performance-tasks.js','utf8');
const sql = fs.readFileSync(base + '/supabase/sql/22-class-leader-participation.sql','utf8');
const fix = fs.readFileSync(base + '/supabase/sql/21-fix-class-storage-permissions.sql','utf8');
assert.match(js,/const members = \(team\?\.members \|\| \[\]\)\.filter/);
assert.doesNotMatch(js,/\['individual','class'\]\.includes\(a\.collaboration_mode/);
assert.match(js,/data-save-class-participation/);
assert.match(js,/class-participation-list/);
assert.match(js,/class-review-member-list/);
assert.match(sql,/create or replace function mathside_private\.class_member_score/);
assert.match(sql,/case v_rating\s+when 5 then 0 when 4 then 2 when 3 then 3 when 2 then 4 when 1 then 5/);
assert.match(sql,/only the selected team leader can rate members/i);
assert.match(sql,/v_member = any\(v_seen\)/);
assert.match(sql,/create or replace function mathside_private\.sync_class_submission/);
assert.match(sql,/create or replace function public\.mathside_save_participation_ratings/);
assert.match(sql,/create or replace function public\.mathside_set_class_scores/);
assert.match(sql,/create or replace function public\.mathside_get_class_scores/);
assert.match(sql,/on conflict \(assignment_id, student_id\) do update/);
assert.doesNotMatch(sql,/grant\s+select\s+on\s+public\.mathside_performance_groups/i);
assert.match(fix,/mathside_private\.can_read_class_submission_proof/);
assert.match(fix,/mathside_private\.is_class_submission_representative/);
console.log('PASS: class leader rates everyone privately, including post-submission saves');
console.log('PASS: existing Group deduction unchanged; class deduction applied exactly once');
console.log('PASS: teacher override retained, missing rating shown, and secure SQL migration included');
