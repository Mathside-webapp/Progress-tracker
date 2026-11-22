const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const css=read('css/teacher-hero-waves-v31.css');
const html=read('index.html');
const sw=read('service-worker.js');
assert.match(html,/css\/teacher-hero-waves-v31\.css\?v=31\.0/);
assert.match(html,/mathside-hero-desk-fitted-v31\.png/);
assert.match(css,/height:clamp\(212px,17\.3vw,242px\)/);
assert.match(css,/object-fit:contain!important/);
assert.match(css,/mathside-sidebar-waves-v31\.png/);
assert.match(css,/#teacherApp #teacherSidebar\{position:fixed!important;overflow:hidden!important\}/);
assert.doesNotMatch(html,/id="pmSidebarNotifications"/);
assert.doesNotMatch(html,/id="pmSidebarSettings"/);
for(const name of ['assets/teacher-pixelmatch/mathside-sidebar-waves-v31.png','assets/teacher-pixelmatch/mathside-hero-desk-fitted-v31.png']) {
 const buf=fs.readFileSync(path.join(root,name));
 assert.ok(buf.length>10000, name);
 assert.equal(buf.toString('hex',0,8),'89504e470d0a1a0a',name+' has PNG signature');
 assert.ok(sw.includes(name));
}
console.log('PASS: V31 non-distorted full desk art, taller teacher hero, waves, fixed non-scroll sidebar, unchanged notifications removal');
