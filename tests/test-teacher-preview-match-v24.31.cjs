const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const html = read('index.html');
const css = read('css/teacher-preview-match-v24.31.css');
const js = read('js/teacher-preview-match-v24.31.js');
const crypto = require('node:crypto');
const sha256 = x => crypto.createHash('sha256').update(x).digest('hex');
const originalCreatorHashes = {"sectionModal": "d852bb03ff09a421d157d068ef3d799f28e5972de1dda029416d7ff8c919ebf1", "assignmentModal": "7af98cfc3c29ddfcb9e55b712c8b9a58b7ca1e28de33715b039b3ab6a452959d", "performanceTaskModal": "92555f80b66e1c8e2730ee9be0fd7736f3971317a841a51bf382664e089accc1"};
const originalAssetHashes = {"assets/mathside-icon.svg": "fa08c7632b3c338d23149a473f10d675cbd946f7b1cff4ac2a03607234fcb4db", "assets/panel-identity/dashboard-workspace.svg": "8e7645692756d6dd9bc65d6a0d1e5e702eecc984214ee895ed05f5360ec6e15c", "assets/panel-identity/classes-study.svg": "2b93cd606f8271ee0e383ea2c33fd01571219e05dc8d5ec5d49166f30500e2f5", "assets/panel-identity/activities.svg": "949b91a21c702624d4588f8513ec31f65ec9891b1009af3aad0c6004bf0e314f", "assets/panel-identity/performance-project.svg": "c80d705cfe54ad80bd1a8d1f7916177996984ef7f9f333953ff51254087066e9", "assets/panel-identity/submissions.svg": "911a8dc08b6d09ae889edaa45c7df58b3e72356268e0e29dcea5fd9c01190ad5", "assets/panel-identity/archive-records.svg": "536329249c67f684e53dd1c1061b203ed61b1cb200fe4e79bfeeecb9b76b1370"};
assert.match(html,/V24\.32/);
assert.match(html,/data-view="records"/);
assert.match(html,/id="view-records"/);
assert.match(html,/id="msRecordsExport"/);
assert.match(html,/ms-hero-records/);
assert.match(html,/teacher-preview-match-v24\.31\.css/);
assert.match(html,/teacher-preview-match-v24\.31\.js/);
assert.match(css,/#teacherApp/);
assert.match(css,/ms-list-table/);
assert.match(css,/ms-list-table tbody tr\.assignment-card\[hidden\]/);
assert.match(js,/MutationObserver/);
assert.match(js,/data-ms-record-type/);
assert.match(js,/data-preview-assignment/);
assert.match(js,/data-archive-assignment-group/);
assert.match(js,/MathsideV10\?\.exportClassRecord/);
assert.match(js,/classRecordPreview/);
assert.doesNotMatch(js,/containsArchived\?'See export'/); 
assert.match(read('js/v10-features.js'),/async function exportClassRecord\(sectionId = null\)/);
assert.match(read('js/v10-features.js'),/sectionById\(typeof sectionId === 'string' \? sectionId : activeRosterSectionId\)/);
// The approved creation dialogs and original illustration bytes are pinned against V24.30.
for(const [id, expected] of Object.entries(originalCreatorHashes)) {
  const regex = new RegExp(`<dialog\\b[^>]*\\bid="${id}"[\\s\\S]*?<\\/dialog>`);
  const current=html.match(regex)?.[0];
  assert.ok(current,`Original ${id} still exists`);
  assert.equal(sha256(current),expected,`Preserve creator dialog ${id}`);
}
for(const [file, expected] of Object.entries(originalAssetHashes))
  assert.equal(sha256(fs.readFileSync(path.join(root,file))),expected,`Preserve ${file}`);
console.log('PASS: new Class Records nav and unchanged Excel engine, compact tables, mobile cards, teacher-only styles, preserved creator dialogs and all original illustrations');
