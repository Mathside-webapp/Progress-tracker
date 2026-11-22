/* Updated dashboard-screen contract: the earlier V24 illustration was replaced
   by the user's approved V26 Orange Teacher Dashboard design. */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const html=read('index.html');
const css=read('css/teacher-dashboard-orange-v26.css');
const sw=read('service-worker.js');
assert.match(html,/V24\.(?:30|31|32)/,'preserve existing teacher version marker');
assert.match(html,/css\/teacher-preview-alignment\.css\?v=24\.29/,'preserve legacy style');
assert.match(sw,/teacher-preview-alignment\.css\?v=24\.29/,'preserve current cached style');
for(const id of ['dashboardClassGrid','dashboardCreateClass','classTotal','assignmentTotal','performanceTotal','teacherNotificationBtn','teacherPageTitle','twWelcomeName','twPendingList','twRecentList','twReminderList','twSearchDialog']){
 assert.ok(html.includes(`id="${id}"`),'expected dashboard or legacy hook: '+id);
}
for(const view of ['submissions','assignments','performance','records','classes','competencies']) assert.ok(html.includes(`data-go-view="${view}"`) || html.includes(`data-view="${view}"`));
assert.ok(html.includes('class="pm-dashboard-main"'),'new screenshot-matched layout');
assert.ok(html.includes('src="assets/teacher-pixelmatch/mathside-hero-desk-fitted-v31.png"'),'PNG hero artwork is a real asset');
assert.ok(html.includes('src="assets/teacher-pixelmatch/mathside-books-plant.png"'),'productivity art is a PNG asset');
assert.ok(html.includes('css/teacher-dashboard-orange-v26.css?v=26.1'));
assert.ok(html.includes('js/teacher-dashboard-orange-v26.js?v=26.1'));
assert.ok(css.includes('#teacherApp .tw-welcome'),'original teacher-only styling');
const pixelCss=read('css/teacher-pixelmatch-v27.css');
assert.ok(pixelCss.includes('#teacherApp .pm-hero'),'screenshot-matched teacher styling');
assert.ok(!pixelCss.includes('#studentApp'),'visual change remains teacher-only');
assert.ok(!css.includes('#studentApp'),'do not scope redesign to student app');
console.log('PASS: approved dashboard layout, original Mathside routes and IDs, separate PNG art');
