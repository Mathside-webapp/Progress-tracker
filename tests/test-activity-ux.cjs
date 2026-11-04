const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/mathside-question-tools.css'), 'utf8');
const draft = fs.readFileSync(path.join(root, 'js/v10-features.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'sql/Mathside-V24.25-Optional-Solution-Photos.sql'), 'utf8');

const duplicateSource = js.slice(js.indexOf('function normalizeQuestionForDuplicate('), js.indexOf('function updateDuplicateQuestionNotice('));
const ctx = vm.createContext({});
vm.runInContext(duplicateSource, ctx);
assert.deepEqual(Array.from(ctx.duplicateQuestionGroups([
  {text:'\\sqrt{32} + \\sqrt{8}'},
  {text:'  \\sqrt{32}+\\sqrt{8} '},
  {text:'\\sqrt{8}+\\sqrt{18}'}
])).map(x => Array.from(x)), [[1,2]], 'Equivalent formulas should warn, not erase questions');
assert.deepEqual(Array.from(ctx.duplicateQuestionGroups([{text:'Question 1'}, {text:'Question 2'}])), []);

const counterSource = js.slice(js.indexOf('function unansweredStudentQuestionIndexes('), js.indexOf('function refreshStudentAnswerProgress('));
const questions = [{id:'id-a', question_type:'mcq'}, {id:'id-b', question_type:'short'}];
const cards = [
  {dataset:{questionId:'id-b'}, values:{'answer_id-b':''}},
  {dataset:{questionId:'id-a'}, values:{'answer_id-a':'A'}}
];
const answerCtx = vm.createContext({
  activeStudentAssignment:{id:'assignment'},
  questionsFor:()=>questions,
  $$:()=>cards,
  $:(selector,card)=>({value:card.values[selector.match(/answer_[^"\]]+/)?.[0]] || ''})
});
vm.runInContext(counterSource, answerCtx);
assert.deepEqual(Array.from(answerCtx.unansweredStudentQuestionIndexes()),[0], 'Unanswered questions must use shuffled display order');

for (const marker of ['studentAnsweredCount','studentUnansweredHint','studentIncompleteDialog','assignmentRequireSolutionPhoto','assignmentDuplicateNotice'])
  assert(html.includes(`id="${marker}"`), `${marker} missing from DOM`);
assert(css.includes('#answerModal #answerQuestions .answer-question'), 'CSS must be scoped to student answer UI');
assert(css.includes('width: 19px'), 'Radio button sizing must remain constrained');
assert(draft.includes("'mathside:answer-draft-applied'"), 'Restoring drafts must update question progress');
assert(js.includes("document.addEventListener('mathside:answer-draft-applied'"), 'App must listen for draft restores');
assert(sql.includes('add column if not exists require_solution_photo boolean not null default true'));
assert(sql.includes("coalesce(v_assignment.work_type, 'written_work') <> 'written_work'"), 'Performance-task photos must stay mandatory');
assert(sql.includes('coalesce(v_assignment.require_solution_photo, true)'), 'Backend must respect photo requirement');
assert(js.includes("require_solution_photo: form.get('require_solution_photo') === 'on'"), 'Front-end save must persist photo setting');
console.log('PASS: duplicate warnings, shuffled unanswered detection, accessible progress, proof settings, scoped styling, and SQL validation');
