const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const r=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const sql=r('sql/Mathside-V24.39-Cleared-To-Do.sql'),app=r('js/app.js'),
student=r('js/student-v8.js'),v10=r('js/v10-features.js'),teacher=r('js/v12-archive-features.js'),
css=r('css/student-cleared-v24.37.css'),html=r('index.html'),sw=r('service-worker.js');
assert.match(sql,/create table if not exists public\.mathside_submission_clears/);
assert.match(sql,/mathside_private\.is_teacher\(v_uid\)/);
assert.match(sql,/Your submission was cleared\. Open Activities > To Do to view the reason\./);
assert.doesNotMatch(sql,/Your submission was cleared\. Open Activities > Submitted to view the reason\./);
assert.match(app,/if \(studentClearedSubmission\(assignment\.id\)\) return true/);
assert.match(app,/if \(assignment\?\.status === 'published' && studentClearedSubmission\(assignment\.id\)\) return 'ongoing'/);
assert.match(student,/if \(a\.status==='published' && studentClearedSubmission\(a\.id\)\) return \{key:'cleared'/);
assert.match(student,/cleared=a\.status==='published'\?studentClearedSubmission\(a\.id\):null/);
assert.doesNotMatch(student,/counts\.submitted\+=writtenAssignments\.filter\(a=>!!studentClearedSubmission/);
assert.match(v10,/const cleared = studentClearedSubmission\(a\.id\)/);
assert.match(v10,/v10-cleared-reason/);
assert.match(v10,/studentTaskFilter = 'ongoing'/);
assert.match(v10,/refreshStudent\(\)\.catch/);
assert.match(css,/v10-cleared-reason/);
assert.match(teacher,/toast\('Submission cleared\.'/);
assert.doesNotMatch(teacher,/The student will see a generic bell alert and the reason/);
assert.doesNotMatch(teacher,/The student was notified in the bell and can see the reason/);
assert.match(html,/Reason shown in the student’s To Do area/);
assert.match(sw,/mathside-pwa-v24-39-cleared-to-do/);
assert.match(html,/css\/student-cleared-v24\.37\.css\?v=24\.39-todo-cleared/);
console.log('PASS: red cleared in both To Do views, generic bell navigation, no Submitted ghost card, database migration, refreshed CSS');
