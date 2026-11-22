/* Mathside V32: faithfully implemented Classes Design A.
 * Teacher-side presentation only; existing create, roster, archive, delete and record actions are preserved.
 * No network or database writes originate from this module. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const root = $('view-classes');
  if (!root || typeof renderClasses !== 'function') return;
  const asset = 'assets/teacher-pixelmatch/';
  const art = 'assets/teacher-classes-v32/';
  const safe = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sections = () => (state.sections || []).filter(s => !s.archived_at);
  const count = s => typeof studentsForSection === 'function' ? studentsForSection(s.id).length : new Set((state.members || []).filter(m => String(m.section_id) === String(s.id)).map(m => String(m.student_id))).size;
  const activeAssignments = () => (state.assignments || []).filter(a => a.status !== 'archived' && !a.archived_at);
  const gradePercents = (id = null) => {
    const allowed = new Map(activeAssignments().filter(a => id === null ? sections().some(s => String(s.id) === String(a.section_id)) : String(a.section_id) === String(id)).map(a => [String(a.id), a]));
    const grades=[];
    for (const submission of state.submissions || []) {
      if (submission.status !== 'graded') continue;
      const a=allowed.get(String(submission.assignment_id));if (!a) continue;
      const possible=typeof totalPoints === 'function' ? Number(totalPoints(a.id)) : NaN;
      const score=Number(submission.teacher_score ?? submission.auto_score);
      if (Number.isFinite(possible) && possible>0 && Number.isFinite(score) && score>=0) grades.push(Math.min(100,Math.max(0,100*score/possible)));
    }
    return grades;
  };
  const average = values => values.length ? Math.round((values.reduce((sum,v)=>sum+v,0)/values.length)*10)/10 : null;
  const format = num => num == null ? '—' : `${num.toFixed(1)}%`;
  const label = s => {
    const name=String(s.name||'Class').trim();
    return /^\d+\s*[\-–—]\s*/.test(name)?name:`${String(s.grade_level||'').trim()} – ${name}`;
  };
  let viewMode='grid';
  const bannerSpecs = [
    {file:asset+'class-orange.png',accent:'#ff810e'},
    {file:asset+'class-green.png',accent:'#20b95f'},
    {file:asset+'class-blue.png',accent:'#168cf6'},
    {file:asset+'class-purple.png',accent:'#a043dd'},
    {file:art+'class-yellow.png',accent:'#ffb300'},
    {file:art+'class-rose.png',accent:'#ed4c7f'}
  ];
  const colorFor = (s,i,total) => {
    if (total===1) return bannerSpecs[1];
    if(total>4) {
      const idx=[0,2,1,4,3,5]; return bannerSpecs[idx[i%idx.length]];
    }
    return bannerSpecs[i%4];
  };
  function card(s,i,total){
    const grade=`Grade ${safe(s.grade_level)}`;
    const name=safe(label(s));
    const num=count(s);
    const avg=average(gradePercents(s.id));
    const image=window.MathsideClassDesignsV44?.get(s)||colorFor(s,i,total);
    return `<article class="class-card ms32-card" data-class-card-id="${safe(s.id)}" style="--ms32-accent:${image.accent}">
      <div class="ms32-banner" style="background-image:url('${image.file}')"><span class="ms32-grade-badge">${grade}</span></div>
      <div class="ms32-card-content">
        <div class="ms32-card-title"><button class="ms32-card-open" type="button" data-view-class-students="${safe(s.id)}" title="Open ${name} students">${name}</button>
         <details class="ms32-card-more"><summary aria-label="Manage ${name}" title="Class actions">⋮</summary><div class="ms32-action-menu">
          <button type="button" data-view-class-students="${safe(s.id)}">View Students</button>
          <button type="button" data-ms32-records="${safe(s.id)}">Class Record</button>
          <button type="button" data-ms32-activities="${safe(s.id)}">All Activities</button>
          <button type="button" data-ms44-design="${safe(s.id)}">Change Class Design</button>
          <button type="button" data-archive-class="${safe(s.id)}">Archive Class</button>
          <button type="button" data-delete-class="${safe(s.id)}" class="ms32-danger">Delete Class</button>
         </div></details></div>
        <div class="ms32-card-meta"><img src="${asset}icons/charcoal/02-classes.png" alt="" aria-hidden="true"/><span>${num} Student${num===1?'':'s'}</span></div>
        <div class="ms32-card-meta ${avg===null?'ms32-muted':''}"><img src="${asset}icons/${avg===null?'gray':'green'}/chart.png" alt="" aria-hidden="true"/><span>${avg===null?'Not yet graded':`${format(avg)} Avg.`}</span></div>
        <div class="ms32-card-track" role="progressbar" aria-label="${name} average" aria-valuemin="0" aria-valuemax="100" ${avg===null?'aria-valuetext="Not yet graded"':`aria-valuenow="${avg}"`}><span style="width:${avg ?? 0}%"></span></div>
      </div>
    </article>`;
  }
  function setView(mode){
    viewMode=mode==='list'?'list':'grid';
    $('classGrid')?.classList.toggle('ms32-list-mode',viewMode==='list');
    for(const [id,selected] of [['ms32GridBtn','grid'],['ms32ListBtn','list']]){
      const btn=$(id);if(!btn)continue;
      btn.classList.toggle('active',viewMode===selected);btn.setAttribute('aria-pressed',String(viewMode===selected));
    }
  }
  function filters(){
    const term=($('msClassSearch')?.value||'').trim().toLowerCase();
    const grade=$('msClassGrade')?.value||'all';
    const order=$('ms32ClassSort')?.value||'grade-name';
    return {term,grade,order};
  }
  function syncGradeSelect(classes){
    const select=$('msClassGrade');if(!select)return;
    const grades=[...new Set(classes.map(s=>String(s.grade_level)))].sort((a,b)=>Number(a)-Number(b));
    const prev=select.value;const hash=grades.join('|');
    if(select.dataset.ms32Grades===hash)return;
    select.innerHTML='<option value="all">All Grade Levels</option>'+grades.map(g=>`<option value="${safe(g)}">Grade ${safe(g)}</option>`).join('');
    select.value=grades.includes(prev)?prev:'all';select.dataset.ms32Grades=hash;
  }
  function applyFilters(){
    if (!$('classGrid'))return;
    const {term,grade,order}=filters();
    const active=sections();
    const shown=active.filter(s=>(grade==='all'||String(s.grade_level)===grade) && `${s.name} ${s.grade_level} ${label(s)}`.toLowerCase().includes(term));
    shown.sort((a,b)=>{
      if(order==='grade'||order==='grade-name')return Number(a.grade_level)-Number(b.grade_level)||String(a.name||'').localeCompare(String(b.name||''));
      if(order==='students')return count(b)-count(a)||String(a.name||'').localeCompare(String(b.name||''));
      return String(a.name||'').localeCompare(String(b.name||''),undefined,{numeric:true,sensitivity:'base'})*(order==='name-desc'?-1:1);
    });
    const grid=$('classGrid');
    grid.innerHTML=shown.length? shown.map(s=>card(s,Math.max(0,active.indexOf(s)),active.length)).join('') : `<div class="ms32-no-match">No classes match the selected filters.</div>`;
    grid.classList.add('ms32-class-grid');
    setView(viewMode);
  }
  function render(){
    const active=sections();
    $('ms32ClassSummary').hidden=!active.length;
    $('ms32ClassesEmpty').hidden=active.length>0;
    $('ms32ClassesDirectory').hidden=!active.length;
    root.classList.toggle('ms32-single',active.length===1);
    if(!active.length){$('classGrid').innerHTML='';return;}
    $('ms32TotalClasses').textContent=String(active.length);
    $('ms32TotalStudents').textContent=String(active.reduce((n,s)=>n+count(s),0));
    $('ms32OverallAverage').textContent=format(average(gradePercents()));
    syncGradeSelect(active);
    // Search/sort controls appear only when enough classes warrant them.
    $('ms32ClassTools').hidden=active.length<=4;
    applyFilters();
  }
  // V12 owns archived classes, roster and data. Wrap only the existing Classes renderer.
  const previous=renderClasses;
  renderClasses=function(...args){const value=previous(...args);render();return value;};
  for (const id of ['msClassSearch','msClassGrade','ms32ClassSort']) {
    $(id)?.addEventListener(id==='msClassSearch'?'input':'change',()=>queueMicrotask(applyFilters));
  }
  $('ms32GridBtn')?.addEventListener('click',()=>setView('grid'));
  $('ms32ListBtn')?.addEventListener('click',()=>setView('list'));
  document.addEventListener('click',e=>{
    const record=e.target.closest('[data-ms32-records]');
    if(record){const id=record.dataset.ms32Records;document.querySelectorAll('#view-classes .ms32-card-more').forEach(d=>d.open=false);showTeacherView('records');requestAnimationFrame(()=>{const select=$('msRecordsSection');if(select){select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}));}});return;}
    const activities=e.target.closest('[data-ms32-activities]');
    if(activities){document.querySelectorAll('#view-classes .ms32-card-more').forEach(d=>d.open=false);showTeacherView('assignments');return;}
    if(!e.target.closest('#view-classes .ms32-card-more')) document.querySelectorAll('#view-classes .ms32-card-more').forEach(d=>d.open=false);
  });
  if(typeof state!=='undefined' && state.profile?.role==='teacher')render();
  window.MathsideClassesV32={render,setView,applyFilters};
})();
