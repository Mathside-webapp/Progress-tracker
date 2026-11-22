/* Mathside V35 — Activities Design B. View-layer only.
 * Uses existing mathside activity groups, status filters and action handlers.
 * Never creates/updates grading data or touches other teacher panels.
 */
(() => {
  'use strict';
  const root = document.getElementById('view-assignments');
  if (!root || typeof renderAssignments !== 'function') return;
  const previousRender = renderAssignments;
  const $local = (selector) => root.querySelector(selector);
  const IMG = 'assets/teacher-pixelmatch/icons/orange/file.png';
  let currentTab = 'all';
  let currentPage = 1;
  const rowsPerPage = 5;
  const icons = {
    eye:'<path d="M2 12s3.7-6.5 10-6.5S22 12 22 12s-3.7 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    edit:'<path d="m16 4 4 4-11 11-5 1 1-5L16 4Z"/><path d="m14 6 4 4"/>',
    copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    archive:'<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
    trash:'<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>'
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const dateStr = (value) => { if (!value) return '—'; const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'; };
  const isScheduled = (a) => a?.status === 'draft' && Boolean(a.publish_at) && new Date(a.publish_at).getTime() > Date.now();
  const isArchived = (group) => group.every(a=>a.status === 'archived');
  const groupStatus = (group) => isArchived(group) ? 'archived' : group.some(isScheduled) ? 'scheduled' : group.some(a=>a.status === 'draft') ? 'draft' : 'published';
  const allGroups = () => groupedAssignmentsForDisplay().filter(g=>g.length && !isPerformanceTask(g[0]));
  const groupIds = (group) => group.map(a=>String(a.id));
  function submissionNumbers(group){
    const ids = new Set(groupIds(group));
    const submitted = (state.submissions||[]).filter(s=>ids.has(String(s.assignment_id)) && s.status !== 'cleared' && !s.archived_at);
    const unique = new Map();
    for (const s of submitted){
      const key = `${s.assignment_id}:${s.student_id}`;
      if (!unique.has(key) || (new Date(s.submitted_at||0) > new Date(unique.get(key)?.submitted_at||0))) unique.set(key,s);
    }
    const seen = [...unique.values()];
    const total = group.reduce((sum,a)=>sum+new Set((state.members||[]).filter(m=>m.section_id===a.section_id).map(m=>m.student_id)).size,0);
    const submittedCount = seen.length;
    const checked = seen.filter(s=>s.status==='graded').length;
    const pending = seen.filter(s=>s.status!=='graded').length;
    return {total,submittedCount,checked,pending,progress:submittedCount?Math.round(100*checked/submittedCount):0};
  }
  function writeStats(){
    const active = allGroups().filter(g=>!isArchived(g));
    const posted = active.filter(g=>groupStatus(g)==='published').length;
    const scheduled = active.filter(g=>groupStatus(g)==='scheduled').length;
    const toCheck = active.reduce((n,g)=>n+submissionNumbers(g).pending,0);
    for (const [id,num] of [['ms35Total',active.length],['ms35Posted',posted],['ms35Scheduled',scheduled],['ms35ToCheck',toCheck]]){
      const element = $local('#'+id); if(element) element.textContent=String(num);
    }
  }
  const action = (name, label, dataAttr, value, danger=false) => `<button type="button" class="${danger?'ms35-danger':''}" aria-label="${safe(label)}" title="${safe(label)}" ${dataAttr}="${safe(value)}">${svg(name)}</button>`;
  function makeRow(group,index){
    const a=group[0];const ids=groupIds(group);const id=String(a.id);const status=groupStatus(group);
    const rawLabels=[...new Set(group.map(item=>sectionLabel(sectionById(item.section_id))))];
    const label=rawLabels[0]||'—';
    const sections=rawLabels.length>1?`<small>+${rawLabels.length-1} more classes</small>`:'';
    const nums=submissionNumbers(group);
    const missing = (typeof questionsFor==='function' && typeof keyFor==='function') ? questionsFor(a.id).filter(q=>!(keyFor(q.id)?.correct_answer || '').trim()).length : 0;
    const sub = `${nums.submittedCount} / ${nums.total || '—'}`;
    const date = status==='scheduled'? (a.publish_at||a.due_at) : a.due_at;
    const textStatus = status==='published'?'Published':status==='scheduled'?'Scheduled':status==='draft'?'Draft':'Archived';
    const selected=ids.every(x=>selectedAssignmentIds.has(x));
    const idsAttr=ids.join(',');
    return `<tr class="assignment-card ms35-row ${selected?'is-selected':''}" data-ms35-group-id="${safe(id)}">
      <td><div class="ms35-name-cell"><label class="assignment-select-check"><input class="row-check" type="checkbox" data-select-assignment="${safe(id)}" data-assignment-group-ids="${safe(idsAttr)}" ${selected?'checked':''}><span class="sr-only">Select ${safe(a.title)}</span></label><span class="ms35-document c${index%5}"><img src="${IMG}" alt=""></span><span class="ms35-name"><b>${safe(a.title)}</b><small>${missing ? `${missing} answer key${missing===1?'':'s'} missing` : (a.instructions ? String(a.instructions).slice(0,70) : 'Mathematics activity')}</small></span></div></td>
      <td><div class="ms35-class-list">${safe(label)}${sections}</div></td>
      <td>${safe(dateStr(date))}</td>
      <td><span class="ms35-status ${safe(status)}">${safe(textStatus)}</span></td>
      <td><span class="ms35-submitted">${safe(sub)}</span></td>
      <td><div class="ms35-progress-cell"><span class="ms35-progress"><i style="width:${nums.progress}%"></i></span><small>${nums.progress}%</small></div></td>
      <td><div class="ms35-action-icons">
        ${action('eye','Preview activity','data-preview-assignment',id)}
        ${status==='archived'?'':action('edit','Edit activity','data-edit-assignment',id)}
        ${status==='archived'?action('archive','Restore activity','data-unarchive-assignment-group',idsAttr):action('copy','Duplicate activity','data-duplicate-assignment',id)}
        ${status==='archived'?'':action('archive','Archive activity','data-archive-assignment-group',idsAttr)}
        ${action('trash','Delete activity','data-delete-assignment-group',idsAttr,true)}
      </div></td></tr>`;
  }
  function useDisplayFilter(group){
    const a=group[0];const status=groupStatus(group);
    const counts=submissionNumbers(group);
    const completed=status==='published' && counts.total>0 && counts.submittedCount>=counts.total && counts.pending===0;
    if (currentTab==='ongoing') return status==='published' && !completed;
    if (currentTab==='completed') return completed;
    return true;
  }
  function updateTabs(){
    root.querySelectorAll('[data-ms35-tab]').forEach(button=>{
      const selected=button.dataset.ms35Tab===currentTab;
      button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));
    });
  }
  function renderTable(){
    // Delegate existing section/status sorting and grouping to V34, then re-render visually.
    previousRender();
    writeStats(); updateTabs();
    const list = $local('#assignmentList'); if (!list) return;
    const items=[...list.querySelectorAll('[data-select-assignment]')].map(check=>String(check.dataset.selectAssignment));
    const groups=items.map(id=>assignmentDisplayGroupForId(id)).filter(g=>g.length && !isPerformanceTask(g[0]));
    const search=($local('#ms35ActivitySearch')?.value||'').trim().toLowerCase();
    let shown=groups.filter(useDisplayFilter);
    if(search)shown=shown.filter(group=>{
      const names=group.map(a=>sectionLabel(sectionById(a.section_id))).join(' ');
      return `${group[0].title||''} ${group[0].instructions||''} ${names}`.toLowerCase().includes(search);
    });
    const count=shown.length;
    const pages=Math.max(1,Math.ceil(count/rowsPerPage));currentPage=Math.min(Math.max(1,currentPage),pages);
    const visible=shown.slice((currentPage-1)*rowsPerPage,currentPage*rowsPerPage);
    const selectedVisible=visible.filter(g=>g.every(a=>selectedAssignmentIds.has(String(a.id))));
    const selectedTotal=allGroups().filter(g=>g.every(a=>selectedAssignmentIds.has(String(a.id)))).length;
    const buttons=`<div class="bulk-actions" role="group" aria-label="Actions for selected activities"><button class="ms35-bulk-icon" id="bulkArchiveAssignmentsBtn" type="button" aria-label="Archive selected activities" title="Archive selected activities" ${!selectedTotal?'disabled':''}>${svg('archive')}</button><button class="ms35-bulk-icon ms35-danger" id="bulkDeleteAssignmentsBtn" type="button" aria-label="Delete selected activities" title="Delete selected activities" ${!selectedTotal?'disabled':''}>${svg('trash')}</button></div>`;
    const toolbar=`<div class="ms35-bulkbar"><label class="bulk-select-all"><input id="selectAllAssignments" class="row-check" type="checkbox" ${visible.length && selectedVisible.length===visible.length?'checked':''}><span class="sr-only">Select all visible activities</span></label><span class="bulk-selected-count" id="selectedAssignmentCount">${selectedTotal} selected</span>${buttons}<span class="ms35-result-hint" aria-live="polite">${count} ${count===1?'activity':'activities'}</span></div>`;
    const head='<thead><tr><th style="width:26%">Activity</th><th style="width:13%">Class / Section</th><th style="width:13%">Due or Schedule</th><th style="width:11%">Status</th><th style="width:11%">Submissions</th><th style="width:14%">Checking Progress</th><th style="width:12%">Actions</th></tr></thead>';
    const body=visible.map((group,i)=>makeRow(group,(currentPage-1)*rowsPerPage+i)).join('');
    const empty = !count ? `<div class="ms35-empty"><img src="assets/teacher-pixelmatch/icons/orange/03-activities.png" alt=""><b>${search?'No matching activities':(allGroups().some(g=>!isArchived(g))?'No activities in this view':'No activities yet')}</b><p>${search?'Try another title or section.':'Activities you post to your classes will appear here.'}</p>${allGroups().some(g=>!isArchived(g))?'':'<button class="btn btn-orange" data-v9-new-assignment type="button">+ Create Activity</button>'}</div>` : `<div class="ms35-table-scroll" role="region" aria-label="Activity table" tabindex="0"><table class="ms35-table">${head}<tbody>${body}</tbody></table></div>`;
    const first=count?((currentPage-1)*rowsPerPage+1):0;const last=Math.min(count,currentPage*rowsPerPage);
    const footer=`<div class="ms35-footer"><span>Showing ${first}–${last} of ${count} activities</span><div class="ms35-footer-controls"><div class="ms35-pager" role="navigation" aria-label="Activity pages"><span>Page ${currentPage} of ${pages}</span><button type="button" data-ms35-page="prev" aria-label="Previous page" title="Previous page" ${currentPage<=1?'disabled':''}>‹</button><button type="button" data-ms35-page="next" aria-label="Next page" title="Next page" ${currentPage>=pages?'disabled':''}>›</button></div></div></div>`;
    list.innerHTML=toolbar+empty+footer;
    // Existing Mathside selection and archive listeners use these same IDs and data attributes.
    // Only the view-specific selector state is new.
  }
  renderAssignments=renderTable;
  // The original class/action event handlers are delegated at document level; do not duplicate them.
  root.addEventListener('input',event=>{
    if (event.target.id==='ms35ActivitySearch'){currentPage=1;renderAssignments();}
  });
  root.addEventListener('click',event=>{
    const tab=event.target.closest('[data-ms35-tab]');
    if(tab){
      if (tab.dataset.ms35Tab==='archived'){
        document.querySelector('#teacherApp .side-link[data-view="archive"]')?.click();return;
      }
      currentTab=tab.dataset.ms35Tab;currentPage=1;renderAssignments();return;
    }
    const pager=event.target.closest('[data-ms35-page]');
    if(pager){currentPage+=pager.dataset.ms35Page==='next'?1:-1;renderAssignments();root.querySelector('.ms35-list-shell')?.scrollIntoView({block:'start',behavior:'auto'});}
  });
  // Preserve the existing single-select and selection count implementation, but improve
  // UI counts for a page showing five rows rather than every activity at once.
  const originalBulkToolbar=updateAssignmentBulkToolbar;
  updateAssignmentBulkToolbar=function(){
    originalBulkToolbar();
    const rows=[...root.querySelectorAll('.ms35-row [data-select-assignment]')];
    const selectedCount=rows.filter(check=>check.checked).length;
    const selectedTotal=allGroups().filter(g=>g.every(a=>selectedAssignmentIds.has(String(a.id)))).length;
    const counter=$local('#selectedAssignmentCount'); if(counter)counter.textContent=`${selectedTotal} selected`;
    const all=$local('#selectAllAssignments');
    if(all){all.checked=rows.length>0 && selectedCount===rows.length;all.indeterminate=selectedCount>0 && selectedCount<rows.length;}
    for(const id of ['bulkArchiveAssignmentsBtn','bulkDeleteAssignmentsBtn']){
      const button=$local('#'+id); if(button)button.disabled=selectedTotal===0;
    }
  };
  // When filters change V34 will already call renderAssignments. Reset pagination for clarity.
  for(const id of ['activitySectionFilter','activityStatusFilter','activitySort']){
    $local('#'+id)?.addEventListener('change',()=>{currentPage=1;},true);
  }
  // Do not render pre-authenticated account data.
})();
