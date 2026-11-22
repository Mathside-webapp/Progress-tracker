const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('V41 record design keeps original read-only score/export hooks and adds student paging',()=>{
 const h=fs.readFileSync('index.html','utf8'),j=fs.readFileSync('js/teacher-preview-match-v24.31.js','utf8'),s=fs.readFileSync('service-worker.js','utf8');
 for(const id of ['msRecordsSection','msRecordsHead','msRecordsBody','msRecordsExport','msRecordsOpenRoster','ms41RecordSearch','ms41Prev','ms41Next'])assert.match(h,new RegExp(`id="${id}"`));
 assert.match(j,/const RECORD_PAGE_SIZE = 6/);assert.match(j,/window\.MathsideV10\.classRecordPreview\(selected.id\)/);assert.match(j,/MathsideV10\?\.exportClassRecord\(currentRecordSection\)/);assert.match(j,/rows\.slice\(offset,offset\+RECORD_PAGE_SIZE\)/);assert.match(j,/a\.archived/);assert.match(s,/mathside-pwa-v(?:42-competencies-design-b|43-archive-design-a|44-art-and-class-designs|45-cloud-class-designs|46-create-class-theme)/);assert.ok(fs.existsSync('assets/teacher-records-v41/class-record-header.png'));
});
