'use strict';
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const css=read('css/teacher-banner-refinements-v34.css');
const html=read('index.html');const sw=read('service-worker.js');
assert.match(html,/teacher-banner-refinements-v34\.css\?v=34\.0/);
assert.match(css,/#view-dashboard \.pm-hero/);
assert.match(css,/#view-classes \.ms32-hero/);
assert.match(css,/#view-classes \.ms32-action-menu button\[data-archive-class\]/);
assert.match(css,/border:0!important/);
assert.doesNotMatch(css,/#view-(assignments|performance|submissions|records|competencies|archive)/);
for(const p of ['01-dashboard-hd.png','02-classes-hd.png']){
 const rel='assets/teacher-section-headers-v34/'+p;
 assert.ok(fs.statSync(path.join(root,rel)).size>20000);
 const buf=fs.readFileSync(path.join(root,rel));
 assert.equal(buf.toString('ascii',1,4),'PNG');
 assert.equal(buf.readUInt32BE(16),3234);
 assert.equal(buf.readUInt32BE(20),519);
 assert.ok(sw.includes('./'+rel));
}
assert.match(sw,/mathside-pwa-v(?:34-hd-banners|35-activities-design-b|36-activity-icons-hd-headers|37-performance-table|38-five-per-page|39-submissions-workspace|40-fixed-five-per-page|41-class-record-design-a|42-competencies-design-b|43-archive-design-a|44-art-and-class-designs|45-cloud-class-designs|46-create-class-theme)/);
assert.ok(sw.includes('./css/teacher-banner-refinements-v34.css?v=34.0'));
console.log('PASS: V34 illustrations, heights, archive border, scope and PWA cache');
