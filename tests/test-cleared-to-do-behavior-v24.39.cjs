const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '..', 'js/app.js'), 'utf8');
function extract(fn) {
  const start=app.indexOf(`function ${fn}(`);
  assert.ok(start>=0,`Missing ${fn}`);
  const brace=app.indexOf('{',start);
  let depth=0;
  for(let i=brace;i<app.length;i++){
    if(app[i]==='{')depth++;
    if(app[i]==='}' && --depth===0)return app.slice(start,i+1);
    if(app[i]!=='}')depth+=(0); // Only inspect these ordinary functions, not templates.
  }
  throw new Error(`Unclosed ${fn}`);
}
// Explicitly evaluate the actual application functions in a sandbox with only
// minimal fake records. No database access or student data are involved.
const state={ user:{id:'learner'}, submissions:[], submissionHistory:[{assignment_id:'A',student_id:'learner'}], archivedScores:[], clearedSubmissions:[{assignment_id:'A',reason_text:'Unreadable image'}] };
const context={state,Date};
vm.createContext(context);
vm.runInContext(`
function submissionFor(assignmentId,studentId=state.user.id){return state.submissions.find(s=>s.assignment_id===assignmentId&&s.student_id===studentId)}
${extract('studentHasRecordedSubmission')}
${extract('studentClearedSubmission')}
${extract('studentAssignmentState')}
${extract('studentNeedsToSubmit')}
`,context);
const active={id:'A',status:'published',archived_at:null,publish_at:'2026-10-01T00:00:00Z',due_at:'2026-11-01T00:00:00Z'};
assert.equal(context.studentHasRecordedSubmission('A'),true,'Historical credit may exist');
assert.equal(context.studentAssignmentState(active),'ongoing','Cleared task must be To Do even if overdue and historically submitted');
assert.equal(context.studentNeedsToSubmit(active),true,'Cleared task appears in To Do');
state.submissions.push({assignment_id:'A',student_id:'learner'});
assert.equal(context.studentClearedSubmission('A'),null,'New real response supersedes clearing');
assert.equal(context.studentAssignmentState(active),'submitted','Resubmitted task returns to Submitted');
assert.equal(context.studentNeedsToSubmit(active),false,'Resubmitted task no longer To Do');
state.submissions=[];
state.clearedSubmissions=[];
assert.equal(context.studentAssignmentState(active),'submitted','Recorded history without a clear is still submitted');
console.log('PASS: clearing overrides history and overdue, and resubmitting restores Submitted state');
