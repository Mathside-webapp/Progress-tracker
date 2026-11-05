/* Mathside V24.32 • Teacher list presentation only.
   All existing actions keep their original delegated data-* hooks and handlers.
   Does NOT modify creation forms, grading state, student UI or Supabase. */
(() => {
 'use strict';
 const teacher=document.getElementById('teacherApp');
 if(!teacher) return;
 const ICON={
  eye:'<circle cx="12" cy="12" r="2.8"/><path d="M2 12s3.8-6 10-6 10 6 10 6-3.8 6-10 6S2 12 2 12Z"/>',
  pencil:'<path d="m4 20 4.4-1.1L20 7.3 16.7 4 5.1 15.6 4 20Z"/><path d="m14.7 6 3.3 3.3"/>',
  archive:'<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8M9 12h6"/>',
  trash:'<path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  restore:'<path d="M4 11a8 8 0 1 1 2.5 6M4 5v6h6"/><path d="M12 8v5l3 2"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 7a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',
  copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/>'
 };
 const svg=name=>`<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;
 function action(button){
  const attr=button.getAttributeNames().find(a=>a.startsWith('data-')&&/preview-assignment|edit-assignment|edit-performance-task|archive-assignment|delete-assignment|unarchive-assignment|view-class-students|archive-class|delete-class|unarchive-class|create-from-archive/.test(a));
  if(!attr) return;
  const kind= attr.includes('preview')?'eye':attr.includes('edit-')?'pencil':attr.includes('delete')?'trash':attr.includes('unarchive')?'restore':attr.includes('create-from')?'copy':attr.includes('archive')?'archive':'users';
  const label=kind==='eye'?'Preview':kind==='pencil'?'Edit':kind==='trash'?'Delete':kind==='restore'?'Restore':kind==='copy'?'Reuse students':kind==='archive'?'Archive':'View students';
  if(button.dataset.ms32Icon===kind) return;
  button.dataset.ms32Icon=kind;
  button.title=label;
  button.setAttribute('aria-label',label);
  button.innerHTML=svg(kind)+`<span class="ms-action-sr">${label}</span>`;
  button.classList.add('ms-icon-action','ms-icon-'+kind);
  if(kind==='trash') button.classList.add('ms-destructive-action');
 }
 function enhanceClassCard(card){
  if(card.dataset.ms32Class==='yes')return;
  const actions=card.querySelector('.class-card-actions');if(!actions)return;
  card.dataset.ms32Class='yes';
  const view=actions.querySelector('[data-view-class-students]');
  if(view){view.classList.add('ms-class-view-btn');view.title='Open class roster';view.setAttribute('aria-label','View students');}
  actions.querySelectorAll('button:not([data-view-class-students])').forEach(action);
 }
 function enhanceArchive(){
  const root=document.getElementById('archiveList');
  if(!root)return;
  root.querySelectorAll('.archive-record-actions button').forEach(action);
 }
 function enhanceTables(){teacher.querySelectorAll('#view-assignments .ms-list-actions button, #view-performance .ms-list-actions button').forEach(action);}
 const grids=['dashboardClassGrid','classGrid'];
 for(const id of grids){
  const grid=document.getElementById(id); if(!grid)continue;
  const update=()=>grid.querySelectorAll('.class-card').forEach(enhanceClassCard);
  new MutationObserver(update).observe(grid,{childList:true,subtree:false});
  update();
 }
 for(const id of ['assignmentList','performanceTaskList','archiveList']){
  const el=document.getElementById(id);if(!el)continue;
  const fn=id==='archiveList'?enhanceArchive:enhanceTables;
  new MutationObserver(fn).observe(el,{childList:true,subtree:false});
  fn();
 }
 const category=document.getElementById('archiveCategoryFilter');
 const tabs=[...document.querySelectorAll('[data-ms-archive-category]')];
 function syncTabs(){const value=category?.value||'all';tabs.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.msArchiveCategory===value)));}
 tabs.forEach(btn=>btn.addEventListener('click',()=>{
  if(!category)return;
  category.value=btn.dataset.msArchiveCategory;
  category.dispatchEvent(new Event('change',{bubbles:true}));
  syncTabs();
 }));
 category?.addEventListener('change',syncTabs);
 document.getElementById('archiveClearFilters')?.addEventListener('click',()=>requestAnimationFrame(syncTabs));
 syncTabs();
 // An empty competency library should show 0 competencies, never invented progress.
 // The dashboard owns real counts once loaded; do not override its computed percentages.
 const competency=document.getElementById('ctHeroCompetencyCount');
 const tagged=document.getElementById('ctHeroTaggedCount');
 if(competency && competency.textContent.trim()==='—')competency.textContent='0';
 if(tagged && tagged.textContent.trim()==='—')tagged.textContent='0';
 window.MathsideTeacherUIV2432={enhanceClassCard,enhanceArchive,enhanceTables};
})();
