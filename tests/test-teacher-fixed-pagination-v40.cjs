const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('V40 fixed five-row pagination, no size selector, retains previous/next',()=>{
 const a=fs.readFileSync('js/teacher-activities-design-b-v35.js','utf8'),p=fs.readFileSync('js/v15-performance-tasks.js','utf8');
 assert.match(a,/const rowsPerPage = 5/);assert.match(p,/const ptSize=5/);
 assert.doesNotMatch(a,/ms35PageSize|Rows per page/);assert.doesNotMatch(p,/ms37Size|Rows per page/);
 assert.match(a,/shown\.slice\(\(currentPage-1\)\*rowsPerPage,currentPage\*rowsPerPage\)/);assert.match(p,/rows\.slice\(\(ptPage-1\)\*ptSize,ptPage\*ptSize\)/);
 for(const s of [a,p]){assert.match(s,/aria-label="Previous page"/);assert.match(s,/aria-label="Next page"/);}
});
