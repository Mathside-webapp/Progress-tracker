'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'css/teacher-approved-headers-v33.css'),'utf8');
const sw=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
assert.match(html,/teacher-approved-headers-v33\.css\?v=33\.0/);
assert.match(css,/#view-dashboard \.pm-hero/);
assert.match(css,/#view-classes \.ms32-hero-art/);
assert.doesNotMatch(css,/#view-(assignments|performance|submissions|records|competencies|archive)/);
for(const image of ['01-dashboard.png','02-classes.png','02-classes-header-objects.png']){
  const file=path.join(root,'assets/teacher-section-headers-v33',image);
  assert.ok(fs.statSync(file).size>10000,'Missing PNG '+image);
  assert.ok(sw.includes('./assets/teacher-section-headers-v33/'+image));
}
assert.match(sw,/mathside-pwa-v(?:33-dashboard-classes-headers|34-hd-banners|35-activities-design-b|36-activity-icons-hd-headers|37-performance-table|38-five-per-page|39-submissions-workspace|40-fixed-five-per-page|41-class-record-design-a|42-competencies-design-b|43-archive-design-a|44-art-and-class-designs|45-cloud-class-designs|46-create-class-theme)/);
assert.match(html,/assets\/teacher-section-headers-v33\/02-classes-header-objects\.png/);
assert.ok(!html.includes('teacher-section-headers-v33/03-activities.png'));
for(const image of ['class-orange.png','class-green.png','class-blue.png','class-purple.png']){
 assert.ok(fs.existsSync(path.join(root,'assets/teacher-pixelmatch',image)));
}
console.log('PASS: only Dashboard and Classes headers changed, class card artwork preserved');
