// Exported Written Works completion ratios: scored zero and Pending count; "—" does not.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('js/v10-features.js', 'utf8');
const start = source.indexOf('  // Progress is based on a saved score');
const end = source.indexOf('  function styleRecordTitle(', start);
assert(start >= 0 && end > start, 'Missing completion-progress helper');
const context = {};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

const run = (scores, range) => context.writtenWorkCompletionValue(scores, range);
let row = run([3, 5, '—', 5, 5, 8, 5, '—'], 'C6:J6');
assert.strictEqual(row.result, '6/8');
assert.strictEqual(row.formula, '(COUNTA(C6:J6)-COUNTIF(C6:J6,"—"))&"/8"');
row = run([0, 'Pending', '—', 4], 'C7:F7');
assert.strictEqual(row.result, '3/4', 'A scored zero and a pending submission must both count');
row = run(['—', '—'], 'C8:D8');
assert.strictEqual(row.result, '0/2');
assert.strictEqual(run([], 'C9:B9'), '0/0');

// Guard against accidentally shifting back to the prior last-column index.
assert(source.includes('const writtenCompletedColumn = 3 + writtenAssignments.length;'));
assert(source.includes('const writtenTotalScoreColumn = 4 + writtenAssignments.length;'));
assert(source.includes('...scoreValues, completionValue, totalEarned'));
assert(source.includes('writtenSheet.getColumn(writtenCompletedColumn).width = 23'));
assert(source.includes("Activities Completed\\n(of ${writtenAssignments.length})"));
console.log('PASS: completion ratio, zero-score, pending, missing and empty-sheet cases');
console.log('PASS: new Excel column precedes Total Score with matching styles and widths');
