const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html'), js=read('js/v12-archive-features.js');
const css=read('css/v12-archive-features.css');
const sw=read('service-worker.js');
const notificationJs=read('js/v10-features.js');
const sql=read('sql/Mathside-V24.37-Cleared-Submitted-Status.sql');
// Teacher reason picker; no bell-preview panel; non-destructive until a reason is selected.
for(const id of ['clearSubmissionReason','clearSubmissionNote','clearSubmissionNoteCount'])assert.match(html,new RegExp(`id="${id}"`));
for(const reason of ['unclear_photo','incomplete_work','wrong_file','missing_attachment','instructions','resubmission','other']) {
 assert.ok(html.includes(`value="${reason}"`),`UI missing ${reason}`);
 assert.match(sql,new RegExp(`when '${reason}' then`));
}
assert.ok(html.includes('maxlength="280"'));
assert.match(js,/updateClearSubmissionReasonState\(\)/);
assert.doesNotMatch(html,/Notification bell preview|id="clearSubmissionNotificationPreview"|After clearing, the bell shows a generic alert/);
assert.doesNotMatch(js,/clearSubmissionNotificationPreview/);
assert.match(js,/if \(reasonCode === 'other' && !teacherNote\)/);
assert.match(js,/db\.rpc\('mathside_clear_submission_with_reason'/);
assert.match(js,/p_reason_code: reasonCode/);
assert.match(js,/p_teacher_note: teacherNote \|\| null/);
// Do not silently invoke old destructive endpoint when DB update is unavailable.
assert.doesNotMatch(js,/db\.rpc\('mathside_clear_submission',/);
assert.match(sql,/mathside_private\.is_teacher\(v_uid\)/);
assert.match(sql,/v_assignment\.teacher_id <> v_uid/);
assert.match(sql,/for update;/);
assert.ok(sql.indexOf('delete from public.mathside_submissions') < sql.indexOf('insert into public.mathside_notifications'));
assert.match(sql,/'system','Submission cleared — action needed'/);
assert.match(sql,/v_submission\.student_id/);
assert.match(sql,/v_submission\.assignment_id,null/);
assert.match(sql,/revoke all on function public\.mathside_clear_submission_with_reason\(uuid,text,text\)/);
assert.match(css,/#clearSubmissionModal \.clear-reason-block/);
assert.match(css,/#clearSubmissionModal \.archive-confirm-box/);
assert.match(html,/css\/v12-archive-features\.css\?v=24\.36-clear-reasons/);
assert.match(html,/js\/v12-archive-features\.js\?v=24\.39-clear-confirm/);
assert.match(sw,/mathside-pwa-v24-39-cleared-to-do/);
assert.match(notificationJs,/n\.type === 'system' && n\.title === 'Submission cleared — action needed'/);
assert.match(html,/js\/v10-features\.js\?v=24\.39-bell-to-do/);
assert.match(sw,/js\/v10-features\.js\?v=24\.39-bell-to-do/);
assert.match(sw,/css\/v12-archive-features\.css\?v=24\.36-clear-reasons/);
assert.match(sw,/js\/v12-archive-features\.js\?v=24\.39-clear-confirm/);
for(const id of ['sectionModal','assignmentModal','performanceTaskModal'])assert.ok(html.includes(`id="${id}"`));
console.log('PASS: reason validation, teacher-only atomic delete+notify RPC, mobile scoped CSS, PWA cache and unchanged editor forms');
