/* Mathside V24.31 — Teacher visual layout to match the approved preview.
   Only teacher list presentation and a read-only Class Records page.
   Existing creators, scoring, exporting, Supabase and student views are unchanged. */
(() => {
  'use strict';
  const teacher = document.getElementById('teacherApp');
  if (!teacher) return;
  const byId = id => document.getElementById(id);
  const text = value => String(value ?? '');
  const safe = value => text(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const shortDate = date => { if (!date) return 'No deadline'; const d = new Date(date); return Number.isFinite(d.getTime()) ? d.toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}) : 'No deadline'; };
  const isTeacher = () => typeof state !== 'undefined' && state.profile?.role === 'teacher';
  let recordType = 'ww';
  let currentRecordSection = '';
  const listState = {
    assignmentList: { search:'', classId:'all', status:'all' },
    performanceTaskList: { search:'', classId:'all', status:'all' }
  };

  function groupIdsFromCard(card) {
    const checkbox = card.querySelector('input[data-select-assignment]');
    if (checkbox?.dataset.assignmentGroupIds) return checkbox.dataset.assignmentGroupIds.split(',').filter(Boolean);
    const action = card.querySelector('[data-archive-assignment-group],[data-delete-assignment-group],[data-unarchive-assignment-group]');
    return (action?.dataset.archiveAssignmentGroup || action?.dataset.deleteAssignmentGroup || action?.dataset.unarchiveAssignmentGroup || '').split(',').filter(Boolean);
  }
  function assignmentStatus(assignment, card) {
    if (assignment?.status === 'archived' || card.classList.contains('assignment-archived')) return 'archived';
    if (card.classList.contains('assignment-scheduled') || (assignment?.status === 'draft' && assignment?.publish_at && new Date(assignment.publish_at) > new Date())) return 'scheduled';
    if (assignment?.status === 'draft') return 'draft';
    if (assignment?.due_at && new Date(assignment.due_at) < new Date()) return 'closed';
    return 'published';
  }
  function populateLibraryControls(root, config) {
    const viewId = root.id === 'assignmentList' ? 'view-assignments' : 'view-performance';
    const page = byId(viewId);
    if (!page || byId('msListToolbar-'+root.id)) return;
    const toolbar = document.createElement('div');
    toolbar.className='ms-list-toolbar'; toolbar.id='msListToolbar-'+root.id;
    toolbar.innerHTML=`<label class="ms-list-search"><span class="sr-only">Search ${config.label.toLowerCase()}</span><input type="search" placeholder="Search ${config.label.toLowerCase()} by title or class…" aria-label="Search ${config.label.toLowerCase()}"></label>
      <label class="ms-list-class-filter"><span class="sr-only">Filter by class</span><select aria-label="Filter ${config.label.toLowerCase()} by class"><option value="all">All classes</option></select></label>
      <div class="ms-list-tabs" role="group" aria-label="Filter by status">${['all','published','scheduled','draft','closed'].map((s,i)=>`<button type="button" data-ms-status="${s}" aria-pressed="${i===0}">${s==='all'?'All':s[0].toUpperCase()+s.slice(1)}</button>`).join('')}</div>`;
    page.insertBefore(toolbar, page.querySelector('.compact-filter-wrap'));
    const search=toolbar.querySelector('input'); const classSelect=toolbar.querySelector('select');
    search.addEventListener('input',()=>{listState[root.id].search=search.value.toLowerCase().trim();applyLibraryFilters(root);});
    classSelect.addEventListener('change',()=>{listState[root.id].classId=classSelect.value;applyLibraryFilters(root);});
    toolbar.querySelector('.ms-list-tabs').addEventListener('click',ev=>{
      const btn=ev.target.closest('button[data-ms-status]');if(!btn)return;
      listState[root.id].status=btn.dataset.msStatus;
      toolbar.querySelectorAll('button[data-ms-status]').forEach(item=>item.setAttribute('aria-pressed',String(item===btn)));
      applyLibraryFilters(root);
    });
    config.classSelect=classSelect;
  }
  function refreshSectionOptions(root) {
    const select=byId('msListToolbar-'+root.id)?.querySelector('.ms-list-class-filter select');
    if (!select || !isTeacher()) return;
    const old=select.value;
    const sections=(state.sections||[]).filter(s=>!s.archived_at);
    const opts=sections.map(sec=>`<option value="${safe(sec.id)}">Grade ${safe(sec.grade_level)} – ${safe(sec.name)}</option>`).join('');
    if (select.dataset.ids !== sections.map(s=>s.id).join(',')) {
      select.innerHTML='<option value="all">All classes</option>'+opts;
      select.value=sections.some(s=>s.id===old)?old:'all';
      select.dataset.ids=sections.map(s=>s.id).join(',');
      listState[root.id].classId=select.value;
    }
  }
  function applyLibraryFilters(root) {
    const filter=listState[root.id];
    const rows=[...root.querySelectorAll('.ms-list-table tbody tr[data-ms-list-row]')];
    let shown=0;
    rows.forEach(row=>{
      const search=!(filter.search) || (row.dataset.msSearch||'').includes(filter.search);
      const group=(row.dataset.msSections||'').split(',');
      const classOk=filter.classId==='all'||group.includes(filter.classId);
      const statusOk=filter.status==='all'||row.dataset.msStatus===filter.status;
      row.hidden=!(search&&classOk&&statusOk);
      if (!row.hidden) shown++;
    });
    const empty=root.querySelector('.ms-list-table-empty');
    if (empty)empty.hidden=shown>0;
  }
  function convertToTable(root) {
    if (!root) return;
    const cards=[...root.children].filter(el=>el.matches?.('article.assignment-card'));
    if (!cards.length) return;
    const performance=root.id==='performanceTaskList';
    populateLibraryControls(root,{label:performance?'Performance Tasks':'Activities'});
    refreshSectionOptions(root);
    const wrapper=document.createElement('div'); wrapper.className='ms-list-table-scroll';
    wrapper.setAttribute('role','region'); wrapper.setAttribute('aria-label',performance?'Performance Task list':'Activity list');wrapper.tabIndex=0;
    const table=document.createElement('table');table.className='ms-list-table';
    table.innerHTML=`<thead><tr><th scope="col">${performance?'Task':'Activity'}</th><th scope="col">Class</th><th scope="col">${performance?'Points':'Items'}</th><th scope="col">Deadline</th><th scope="col">Submissions</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody></tbody>`;
    const tbody=table.querySelector('tbody');
    cards.forEach(card=>{
      const preview=card.querySelector('button[data-preview-assignment]');
      const id=preview?.dataset.previewAssignment;
      const assignment= typeof state!=='undefined' && state.assignments?.find(a=>String(a.id)===String(id));
      const groupIds=groupIdsFromCard(card);
      const title=card.querySelector('.assignment-title-line h3')?.textContent||assignment?.title||'Activity';
      const instruction=card.querySelector('.assignment-card-body>p')?.textContent||'';
      const classLabels=card.querySelector('.assignment-class-list')?.textContent?.trim() || card.querySelector('.assignment-meta .meta-chip')?.textContent?.trim() || 'Class';
      const count=performance ? (assignment?.max_points ?? '—') : (typeof questionsFor === 'function' && assignment ? questionsFor(assignment.id).length : '—');
      const submitted=(state.submissions||[]).filter(s=>groupIds.includes(String(s.assignment_id))).length;
      const status=assignmentStatus(assignment,card);
      const tr=document.createElement('tr');tr.className='assignment-card';tr.dataset.msListRow='1';tr.dataset.msSearch=(title+' '+instruction+' '+classLabels).toLowerCase();tr.dataset.msSections=groupIds.map(item=>state.assignments?.find(a=>String(a.id)===String(item))?.section_id).filter(Boolean).join(',');tr.dataset.msStatus=status;
      const titleCell=document.createElement('td');titleCell.className='ms-list-title';
      const titleWrap=document.createElement('div');titleWrap.className='ms-list-title-text';
      const check=card.querySelector('input[data-select-assignment]');
      if(check){const label=document.createElement('label');label.className='ms-list-select';label.setAttribute('aria-label','Select '+title);label.append(check.cloneNode(true));titleCell.append(label);}
      const titleText=document.createElement('span');titleText.innerHTML=`<b>${safe(title)}</b><small>${safe(instruction)}</small>`;titleWrap.append(titleText);titleCell.append(titleWrap);
      tr.append(titleCell);
      const td1=document.createElement('td');td1.textContent=classLabels;tr.append(td1);
      const td2=document.createElement('td');td2.className='ms-numeric';td2.textContent=text(count);tr.append(td2);
      const td3=document.createElement('td');td3.className='ms-list-date';td3.textContent=shortDate(assignment?.due_at);tr.append(td3);
      const td4=document.createElement('td');td4.className='ms-numeric';td4.textContent=String(submitted);tr.append(td4);
      const td5=document.createElement('td');td5.innerHTML=`<span class="ms-list-status" data-status="${safe(status)}">${safe(status[0].toUpperCase()+status.slice(1))}</span>`;tr.append(td5);
      const td6=document.createElement('td');const actions=document.createElement('div');actions.className='ms-list-actions';
      card.querySelectorAll('.assignment-card-actions button').forEach(button=>{const copy=button.cloneNode(true);copy.type='button';actions.append(copy);});
      td6.append(actions);tr.append(td6);
      [...tr.children].forEach((cell,index)=>cell.dataset.label=[performance?'Task':'Activity','Class',performance?'Points':'Items','Deadline','Submissions','Status','Actions'][index]);
      tbody.append(tr);
    });
    const empty=document.createElement('tr');empty.className='ms-list-table-empty';empty.hidden=true;empty.innerHTML='<td colspan="7">No items match these filters.</td>';tbody.append(empty);
    wrapper.append(table);
    cards.forEach(card=>card.remove());root.append(wrapper);
    applyLibraryFilters(root);
  }
  // The original application re-renders cards on class/filter changes. Convert after each render,
  // leaving the existing event-delegated data-* actions and all creator dialogs untouched.
  ['assignmentList','performanceTaskList'].forEach(id=>{
    const root=byId(id);if(!root)return;
    let updating=false;
    const obs=new MutationObserver(()=>{
      if(updating||!root.querySelector(':scope > article.assignment-card'))return;
      updating=true;obs.disconnect();
      try{root.querySelector('.ms-list-table-scroll')?.remove();convertToTable(root);}
      finally{obs.observe(root,{childList:true});updating=false;}
    });
    obs.observe(root,{childList:true});
    if(root.querySelector(':scope > article.assignment-card'))convertToTable(root);
  });

  // Class search and grade filter: applies to the existing class cards, not creation/edit forms.
  function filterClasses() {
    const grid=byId('classGrid'), gradeSelect=byId('msClassGrade'), search=byId('msClassSearch');
    if(!grid||!gradeSelect||!isTeacher())return;
    const gradeList=[...new Set((state.sections||[]).filter(s=>!s.archived_at).map(s=>String(s.grade_level)))].sort((a,b)=>Number(a)-Number(b));
    const sig=gradeList.join('|');
    if(gradeSelect.dataset.sig!==sig){const was=gradeSelect.value;gradeSelect.innerHTML='<option value="all">All grades</option>'+gradeList.map(g=>`<option value="${safe(g)}">Grade ${safe(g)}</option>`).join('');gradeSelect.value=gradeList.includes(was)?was:'all';gradeSelect.dataset.sig=sig;}
    const q=(search?.value||'').trim().toLowerCase();
    const grade=gradeSelect.value;
    let visible=0;
    grid.querySelectorAll('.class-card[data-class-card-id]').forEach(card=>{
      const sec=(state.sections||[]).find(s=>String(s.id)===String(card.dataset.classCardId));
      const match=sec && (grade==='all'||String(sec.grade_level)===grade)&&(`${sec.name} grade ${sec.grade_level}`.toLowerCase().includes(q));
      card.hidden=!match;if(match)visible++;
    });
    let empty=byId('msClassFilterEmpty');
    if(!empty){empty=document.createElement('p');empty.id='msClassFilterEmpty';empty.className='ms-class-no-results';grid.after(empty);}
    const hasCards=grid.querySelectorAll('.class-card').length;
    empty.hidden=!hasCards||visible>0;
    if(!empty.hidden)empty.textContent='No classes match your search. Change the search or grade filter.';
  }
  byId('msClassSearch')?.addEventListener('input',filterClasses);
  byId('msClassGrade')?.addEventListener('change',filterClasses);
  if(byId('classGrid')) new MutationObserver(filterClasses).observe(byId('classGrid'),{childList:true,subtree:false});
  let recordRequestId = 0;
  async function renderRecords() {
    const select=byId('msRecordsSection');
    if(!select||!isTeacher()||!byId('view-records')?.classList.contains('active'))return;
    const sections=state.sections||[];
    const selected=sections.find(s=>String(s.id)===String(currentRecordSection))||sections.find(s=>!s.archived_at)||sections[0];
    const sig=sections.map(s=>[s.id,s.name,s.grade_level,s.archived_at||''].join(':')).join('|');
    if(select.dataset.sections!==sig){
      select.innerHTML=sections.map(s=>`<option value="${safe(s.id)}">Grade ${safe(s.grade_level)} – ${safe(s.name)}${s.archived_at?' (Archived)':''}</option>`).join('') || '<option value="">No classes</option>';
      select.dataset.sections=sig;
    }
    currentRecordSection=selected?.id||'';select.value=currentRecordSection;
    const summary=byId('msRecordsSummary'),head=byId('msRecordsHead'),body=byId('msRecordsBody'),note=byId('msRecordsNote');
    if(!selected){summary.innerHTML='';head.innerHTML='';body.innerHTML='<tr><td>No classes yet. Create a class to view records.</td></tr>';return;}
    const request=++recordRequestId;
    head.innerHTML='';body.innerHTML='<tr><td class="ms-record-loading">Loading your class scores…</td></tr>';
    note.textContent='Reading current scores and preserved archived records…';
    if(typeof window.MathsideV10?.classRecordPreview!=='function'){
      body.innerHTML='<tr><td>Class record reader unavailable. Reload Mathside.</td></tr>';return;
    }
    try{
      const data=await window.MathsideV10.classRecordPreview(selected.id);
      if(request!==recordRequestId)return;
      const record=recordType==='pt'?data.performance:data.written;
      const assignments=record.assignments, ww=recordType==='ww';
      const cols=assignments.map(a=>`<th scope="col" title="${safe(a.title)}" class="ms-record-activity-heading"><span>${safe(a.title)}</span><small>${a.possible!=null?`${a.possible} pts`:'Score'}${a.archived?' · Archived':''}</small></th>`).join('');
      head.innerHTML=`<tr><th scope="col">#</th><th scope="col">Student Name</th>${cols}<th scope="col">Completed</th><th scope="col">Total Score</th></tr>`;
      const colSpan=assignments.length+4;
      body.innerHTML=record.rows.map((row,i)=>{
        const values=row.values.map(v=>`<td class="ms-numeric ${v==='—'?'ms-missing':''} ${v==='Unavailable'?'ms-history-unavailable':''}">${safe(v)}</td>`).join('');
        return `<tr><td class="ms-record-no">${i+1}</td><td class="ms-record-name">${safe(row.name)}</td>${values}<td class="ms-record-completed">${row.completed}/${assignments.length}</td><td class="ms-record-total">${safe(row.totalScore)}</td></tr>`;
      }).join('')||`<tr><td colspan="${colSpan}">No students in this class yet.</td></tr>`;
      const possible=assignments.map(a=>a.possible).every(n=>n!=null) ? assignments.reduce((sum,a)=>sum+a.possible,0) : null;
      const scored=record.rows.reduce((sum,r)=>sum+r.totalScore,0);
      summary.innerHTML=`<article><span>Class</span><strong>${safe(data.section.name)} · Grade ${safe(data.section.grade_level)}</strong></article><article><span>Students</span><strong>${data.students}</strong></article><article><span>${ww?'Written Works':'Performance Tasks'}</span><strong>${assignments.length}</strong></article><article><span>Points available</span><strong>${possible===null?'See activity headers':possible}</strong></article><article><span>Total scored across class</span><strong>${scored}</strong></article>`;
      note.textContent=data.archivedUnavailable ? 'Some archived grades cannot be read because the archive snapshot tables are unavailable. Unavailable values are not counted in totals. The saved Excel record may also require the archive SQL migrations.' :
        'Scores include preserved archived grades and teacher overrides. Pending work counts as completed; missing work does not. Performance Task scores use the same team/class participation logic as the Excel export. The workbook format is unchanged.';
    }catch(error){
      if(request!==recordRequestId)return;
      console.error('Mathside Class Records:',error);
      summary.innerHTML='';head.innerHTML='';body.innerHTML='<tr><td class="ms-record-error">Unable to load record scores. Check your connection and permissions, then reopen Class Records.</td></tr>';
      note.textContent=String(error?.message||'Record data could not be loaded.');
    }
  }
  byId('msRecordsSection')?.addEventListener('change',e=>{currentRecordSection=e.target.value;renderRecords();});
  document.querySelectorAll('[data-ms-record-type]').forEach(button=>button.addEventListener('click',()=>{
    recordType=button.dataset.msRecordType;
    document.querySelectorAll('[data-ms-record-type]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});
    renderRecords();
  }));
  byId('msRecordsExport')?.addEventListener('click',()=>{
    if(!isTeacher()||!currentRecordSection)return;
    window.MathsideV10?.exportClassRecord(currentRecordSection);
  });
  byId('msRecordsOpenRoster')?.addEventListener('click',()=>{
    if(!isTeacher()||!currentRecordSection)return;
    const btn=[...document.querySelectorAll('[data-view-class-students]')].find(b=>b.dataset.viewClassStudents===currentRecordSection);
    if(btn)btn.click();else {showTeacherView('classes');requestAnimationFrame(()=>document.querySelector(`[data-view-class-students="${CSS.escape(currentRecordSection)}"]`)?.click());}
  });
  function renderFocus() {
    const area=byId('msDashboardFocus');if(!area||!isTeacher())return;
    const assignments=state.assignments||[], subs=state.submissions||[];
    const pendingByTask=new Map();
    subs.filter(s=>s.status!=='graded').forEach(s=>{
      const assignment=assignments.find(a=>String(a.id)===String(s.assignment_id));
      if(!assignment||assignment.status==='archived')return;
      const current=pendingByTask.get(assignment.id)||{a:assignment,count:0};current.count++;pendingByTask.set(assignment.id,current);
    });
    const pending=[...pendingByTask.values()].sort((a,b)=>b.count-a.count).slice(0,4);
    const future=assignments.filter(a=>a.due_at && a.status==='published' && new Date(a.due_at)>new Date()).sort((a,b)=>new Date(a.due_at)-new Date(b.due_at)).slice(0,4);
    const note=(item,type)=>`<button type="button" class="ms-focus-item" data-ms-focus="${type}" aria-label="${safe(type==='submissions'?'Review submitted work':'Open activities')}"><span class="ms-focus-icon" aria-hidden="true">${type==='submissions'?'✓':'▤'}</span><span><b>${safe(item.a.title)}</b><small>${type==='submissions'?`${item.count} awaiting review`:shortDate(item.a.due_at)}</small></span><span class="ms-focus-arrow" aria-hidden="true">›</span></button>`;
    area.innerHTML=`<section class="ms-focus-card"><div class="ms-focus-head"><h3>Needs your attention</h3><button type="button" data-ms-focus="submissions">Open review desk →</button></div>${pending.length?pending.map(p=>note(p,'submissions')).join(''):'<p class="ms-focus-empty">No submissions currently awaiting review.</p>'}</section><section class="ms-focus-card"><div class="ms-focus-head"><h3>Upcoming deadlines</h3><button type="button" data-ms-focus="assignments">All activities →</button></div>${future.length?future.map(a=>note({a},'assignments')).join(''):'<p class="ms-focus-empty">No upcoming published deadlines.</p>'}</section>`;
  }
  const dashboard=byId('view-dashboard');
  if(dashboard&&!byId('msDashboardFocus')) {
    const area=document.createElement('div');area.className='ms-dashboard-focus';area.id='msDashboardFocus';
    const after=dashboard.querySelector('.stats-grid');after?.insertAdjacentElement('afterend',area);
    area.addEventListener('click',ev=>{const btn=ev.target.closest('[data-ms-focus]');if(btn)showTeacherView(btn.dataset.msFocus);});
  }
  // Keep all original Mathside navigation and data events. This augments only teacher view rendering.
  if(typeof showTeacherView==='function'){
    const old=showTeacherView;
    showTeacherView=function(view){old(view);if(view==='records'){byId('teacherPageTitle').textContent='Class Records';renderRecords();}if(view==='dashboard')renderFocus();if(view==='classes')filterClasses();};
  }
  if(typeof renderTeacher==='function'){
    const old=renderTeacher;
    renderTeacher=function(...args){const result=old(...args);if(isTeacher()){renderRecords();renderFocus();filterClasses();}return result;};
  }
  window.MathsideTeacherPreviewMatch={renderRecords,renderFocus,convertToTable};
})();
