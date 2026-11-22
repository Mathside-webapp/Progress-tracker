const fs=require('node:fs'); const path=require('node:path');const assert=require('node:assert/strict');
const r=path.resolve(__dirname,'..'); const read=p=>fs.readFileSync(path.join(r,p),'utf8');
const js=read('js/teacher-dashboard-orange-v26.js');const html=read('index.html');const sw=read('service-worker.js');
for(const im of ['mathside-math-hero.png','teacher-productivity.png']) {
 const bytes=fs.readFileSync(path.join(r,'assets/teacher-dashboard',im));
 assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a','should be actual PNG');
 assert.ok(bytes.length>10000,'should include detailed artwork');
 assert.ok(sw.includes(`./assets/teacher-dashboard/${im}`),'PWA must pre-cache new illustration');
}
// The cache name tracks the current site release; the V28 sidebar assets remain precached.
assert.match(sw,/mathside-pwa-v46-create-class-theme/);
assert.ok(sw.includes('./css/teacher-fixed-sidebar-v28.css?v=28.0'),'PWA must pre-cache the fixed sidebar stylesheet');
for(const art of ['mathside-hero-desk-original.png','mathside-books-plant.png','class-orange.png','class-green.png','class-blue.png','class-purple.png']){
 const file=path.join(r,'assets/teacher-pixelmatch',art);assert.ok(fs.existsSync(file),'new asset '+art); assert.ok(sw.includes(`./assets/teacher-pixelmatch/${art}`));
}
assert.match(js,/const pending=subs.filter\(s => s.status !== 'graded'\)/);
assert.match(js,/window\.MathsideTeacherDashboardV26/);
assert.match(js,/state\.profile\?\.display_name/);
assert.match(js,/\bshowTeacherView\(view\)/);
assert.ok(!js.includes('db.from('),'visual-only UI must not modify or query the database');
assert.ok(html.includes('id="teacherApp"'));
console.log('PASS: accessible teacher-only dashboard, data-driven cards, self-contained PNGs and PWA assets');
