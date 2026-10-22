const fs=require('fs'); const assert=require('node:assert/strict'); const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const js=fs.readFileSync(path.join(root,'js/v15-performance-tasks.js'),'utf8');
const sql=fs.readFileSync(path.join(root,'supabase/sql/20-performance-whole-class.sql'),'utf8');
const css=fs.readFileSync(path.join(root,'css/performance-class-mode.css'),'utf8');
for (const fragment of [
  'value="class"', 'performanceClassHelp','performanceClassLinks','reviewClassScoring',
  'class representative','performance-class-mode.css'
]) assert(html.includes(fragment), `Missing HTML ${fragment}`);
for (const fragment of [
  "if (performanceMode() === 'class') return ''",
  'Choose a class representative',
  "mode === 'class' ? 1",
  '!s.is_class_mirror',
  'mathside_get_class_scores',
  'mathside_set_class_scores',
  'mathside_save_class_submission_links',
  'only the class representative'
]) assert(js.toLowerCase().includes(fragment.toLowerCase()), `Missing JS ${fragment}`);
for (const fragment of [
  "'individual','pair','group','class'",
  'sync_class_submission',
  'mathside_protect_class_representative',
  'mathside_protect_class_assignment_setup',
  'mathside_proof_upload',
  'mathside_class_proof_read',
  'mathside_set_class_scores',
  'is_class_mirror'
]) assert(sql.includes(fragment), `Missing SQL ${fragment}`);
assert(css.includes('.performance-class-grade-panel'));
console.log('PASS: whole-class mode and explicitly selected representative');
console.log('PASS: class mirror records, grading, storage access and video/project links');
