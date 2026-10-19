// Offline regression tests for class-record retention logic (no Supabase credentials).
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('js/v10-features.js', 'utf8');
const start = source.indexOf('  // Fetch a full, current snapshot for exports.');
const end = source.indexOf('  function styleRecordTitle(', start);
assert(start >= 0 && end > start, 'Cannot locate record export helper functions');

const sample = {
  assignments: [{id:'written', status:'archived'}, {id:'perf', status:'archived'}],
  state: { submissions: [] },
  db: null,
  submissionNumericScore: submission => submission?.teacher_score ?? submission?.auto_score ?? null,
  performanceRatingDeduction: rating => ({5:0,4:2,3:3,2:4,1:5})[rating] ?? null
};
vm.createContext(sample);
vm.runInContext(source.slice(start, end), sample);

function fakeDb(tables) {
  return { from(table) { return {
    select() { return {
      in(key, ids) {
        const rows = (tables[table] || []).filter(row => ids.includes(row[key]));
        return {
          order() { return this; },
          async range(from, to) {
            return {data: rows.slice(from, to+1), error:null};
          }
        };
      }
    }; }
  }; }};
}
(async function(){
  const archived = Array.from({length:1325}, (_,i) => ({assignment_id:'written',student_id:'s'+i,score:i%15}));
  const snapshots = Array.from({length:1325}, (_,i) => ({assignment_id:'written',student_id:'s'+i,score:i%15,display_status:null}));
  sample.db = fakeDb({mathside_archived_scores:archived,mathside_class_record_snapshots:snapshots});
  const [scoresRows, snapshotRows] = await Promise.all([
    sample.readClassRecordArchiveRows('mathside_archived_scores','assignment_id,student_id,score',['written']),
    sample.readClassRecordArchiveRows('mathside_class_record_snapshots','assignment_id,student_id,score,display_status',['written'])
  ]);
  assert.strictEqual(scoresRows.length, 1325, 'Paged loading lost an archived score');
  assert.strictEqual(snapshotRows.length, 1325, 'Paged loading lost a snapshot');
  const scores = sample.classRecordRowsToMap(scoresRows,'score');
  const snaps = sample.classRecordRowsToMap(snapshotRows,null);
  assert.strictEqual(scores.get('written').get('s1324'),1324%15);
  assert.strictEqual(sample.savedClassRecordValue({id:'written'},'s0',snaps,scores).value,0,'Zero grade was discarded');
  assert.strictEqual(sample.savedClassRecordValue({id:'written'},'s1200',snaps,scores).value,1200%15);

  const single = new Map([['perf',new Map([
    ['member',{student_id:'member',score:17,display_status:null}],
    ['pending',{student_id:'pending',score:null,display_status:'Pending'}],
    ['unrated',{student_id:'unrated',score:null,display_status:'Not rated'}]
  ])]]);
  const emptyScores=new Map();
  const archivedPerf={id:'perf',status:'archived',collaboration_mode:'group'};
  assert.strictEqual(sample.performanceTaskExportScore(archivedPerf,'member',new Map(),emptyScores,single).value,17);
  assert.strictEqual(sample.performanceTaskExportScore(archivedPerf,'pending',new Map(),emptyScores,single).value,'Pending');
  assert.strictEqual(sample.performanceTaskExportScore(archivedPerf,'unrated',new Map(),emptyScores,single).value,'Not rated');
  assert.strictEqual(sample.performanceTaskExportScore(archivedPerf,'unknown',new Map(),emptyScores,single).value,'—');
  // Unarchived assignments use current submissions but retain saved grades when empty.
  const restored = {...archivedPerf,status:'published',collaboration_mode:'individual'};
  sample.state.submissions = [{assignment_id:'perf',student_id:'member',status:'graded',teacher_score:20}];
  assert.strictEqual(sample.performanceTaskExportScore(restored,'member',new Map(),emptyScores,single).value,20);
  assert.strictEqual(sample.performanceTaskExportScore(restored,'pending',new Map(),emptyScores,single).value,'Pending');

  // Backwards compatibility: previously archived checked scores still export.
  const pastScores=new Map([['perf',new Map([['past',8]])]]);
  assert.strictEqual(sample.performanceTaskExportScore(archivedPerf,'past',new Map(),pastScores,new Map()).value,8);

  // Mixed chunks: the query must fetch every assignment, not only the first 40.
  sample.db=fakeDb({mathside_class_record_snapshots:[{assignment_id:'a44',student_id:'s1',score:3}]});
  const ids=Array.from({length:45},(_,i)=>'a'+i);
  const last=await sample.readClassRecordArchiveRows('mathside_class_record_snapshots','assignment_id,student_id,score',ids);
  assert.strictEqual(last.length,1);
  assert.strictEqual(last[0].assignment_id,'a44');
  const sql=fs.readFileSync('sql/Mathside-Class-Record-Archive-Retention-Fix.sql','utf8');
  const snapshotBeforeDelete=sql.indexOf('INSERT INTO public.mathside_class_record_snapshots AS previous');
  const deleteAfterSnapshot=sql.indexOf('DELETE FROM public.mathside_submissions');
  assert(snapshotBeforeDelete>=0 && deleteAfterSnapshot>snapshotBeforeDelete,'Archive deletes submissions before preserving scores');
  assert(sql.includes('mathside_class_record_retention_version'), 'Missing archive RPC version guard');
  assert(sql.includes('mathside_submission_history'), 'Existing progress retention RPC changed');
  console.log('PASS: 1325 grades + snapshots fully paginated');
  console.log('PASS: 45 assignment IDs span multiple batches');
  console.log('PASS: Archived performance score, Pending, Not rated, missing learner');
  console.log('PASS: Zero grades, old saved grades, restored live scores');
  console.log('PASS: Atomic SQL orders score snapshots before deletions');
})().catch(err => {console.error(err);process.exit(1);});
