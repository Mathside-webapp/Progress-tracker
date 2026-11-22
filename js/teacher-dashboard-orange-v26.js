/* Mathside Teacher Dashboard V26: visual-only shell with real data.
   Does not make network requests or change assessment data. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const safe = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeTeacher = () => Boolean($('teacherApp') && !$('teacherApp').hidden && typeof state !== 'undefined' && state.profile?.role === 'teacher');
  const isProject = (a) => typeof isPerformanceTask === 'function' ? isPerformanceTask(a) : a?.assignment_type === 'performance';
  const sectionFor = (id) => (state.sections || []).find(s => String(s.id) === String(id));
  const cleanTasks = () => (state.assignments || []).filter(a => a.status !== 'archived' && !sectionFor(a.section_id)?.archived_at);
  const labelSection = (a) => {
    const s = sectionFor(a?.section_id);
    return s ? `Grade ${s.grade_level} ${s.name || ''}`.trim() : 'Class activity';
  };
  const timeValue = (d) => { const t = Date.parse(d || ''); return Number.isFinite(t) ? t : 0; };
  const shortDay = (value) => {
    const n = timeValue(value); if(!n) return 'No due date';
    return new Intl.DateTimeFormat('en-PH', {month:'short',day:'numeric',timeZone:'Asia/Manila'}).format(new Date(n));
  };
  const taskStatus = (a) => {
    if (a.status === 'draft') return 'Draft';
    if (a.due_at && timeValue(a.due_at) < Date.now()) return 'Closed';
    return 'Ongoing';
  };
  const icon = (type) => type==='project'?'♜':type==='reminder'?'▣':type==='check'?'☑':'▤';
  const empty = (message, actionText, actionView) => `<div class="tw-empty-inline">${safe(message)}${actionView ? `<div style="margin-top:8px"><button class="tw-panel-link" type="button" data-go-view="${actionView}">${safe(actionText)} →</button></div>` : ''}</div>`;
  function upcomingLabel(a) {
    const due=timeValue(a.due_at); if(!due) return 'No due date';
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'});
    const todayKey=day.format(new Date()); const dueKey=day.format(new Date(due));
    if(dueKey===todayKey) return 'Due today';
    const dayDelta=Math.round((new Date(dueKey+'T12:00:00Z')-new Date(todayKey+'T12:00:00Z'))/86400000);
    if(dayDelta===1) return 'Tomorrow';
    return shortDay(a.due_at);
  }
  function renderDashboard() {
    if(!activeTeacher()) return;
    const name=String(state.profile?.display_name || 'Teacher').trim() || 'Teacher';
    if($('twWelcomeName')) $('twWelcomeName').textContent=name;
    if($('twProfileName')) $('twProfileName').textContent=name;
    if($('teacherName')) $('teacherName').textContent=name;
    if($('twTodayDate')) $('twTodayDate').textContent=new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(new Date());
    const pNow=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'numeric'}).formatToParts(new Date());
    const y=Number(pNow.find(p=>p.type==='year')?.value || new Date().getFullYear());
    const m=Number(pNow.find(p=>p.type==='month')?.value || 1);
    const sy=(m>=6?y:y-1);
    if($('twSchoolYear')) $('twSchoolYear').textContent=`SY ${sy}–${sy+1}`;
    if($('twTermLabel')) $('twTermLabel').textContent=`SY ${sy}–${sy+1}`;
    const tasks=cleanTasks();
    const byId=new Map(tasks.map(a=>[String(a.id),a]));
    const subs=(state.submissions || []).filter(s => byId.has(String(s.assignment_id)));
    const pending=subs.filter(s => s.status !== 'graded');
    if($('twPendingStat')) $('twPendingStat').textContent=String(pending.length);
    const grouped=new Map();
    for (const submission of pending) {
      const a=byId.get(String(submission.assignment_id));
      const key=String(a.id);
      if(!grouped.has(key)) grouped.set(key,{a,count:0});
      grouped.get(key).count += 1;
    }
    const pendingTasks=[...grouped.values()].sort((a,b)=>b.count-a.count || timeValue(b.a.created_at)-timeValue(a.a.created_at)).slice(0,3);
    if($('twPendingList')) $('twPendingList').innerHTML=pendingTasks.length
      ? pendingTasks.map(({a,count}) => `<button type="button" class="tw-list-row" data-go-view="submissions" aria-label="Open submissions to check ${safe(a.title)}, ${count} pending"><span class="tw-list-icon" aria-hidden="true">${icon('check')}</span><span><b>${safe(a.title || 'Untitled activity')}</b><small>${safe(labelSection(a))}</small></span><span class="tw-row-pill">${count} to check</span></button>`).join('')
      : empty('All caught up! New student submissions will appear here.', 'Open submissions','submissions');
    const seenRecent=new Set();
    const recent=tasks.filter(a=>!isProject(a)).sort((a,b)=>timeValue(b.created_at)-timeValue(a.created_at)).filter(a=>{
      const k=[a.title||'',a.created_at?.slice(0,16)||'',a.assignment_type||''].join('|');
      if(seenRecent.has(k)) return false;seenRecent.add(k);return true;
    }).slice(0,3);
    if($('twRecentList')) $('twRecentList').innerHTML=recent.length
      ? recent.map(a=>`<button type="button" class="tw-list-row" data-go-view="assignments" aria-label="Open activities, ${safe(a.title)}"><span class="tw-list-icon" aria-hidden="true">${icon('activity')}</span><span><b>${safe(a.title || 'Untitled activity')}</b><small>${safe(labelSection(a))} · ${shortDay(a.created_at)}</small></span><span class="tw-row-pill ${a.status==='draft'?'tw-muted':taskStatus(a)==='Closed'?'tw-success':''}">${taskStatus(a)}</span></button>`).join('')
      : empty('Activities you create will appear here.', 'Create your first activity','assignments');
    const due=tasks.filter(a=>a.due_at && timeValue(a.due_at)>Date.now() && a.status!=='draft').sort((a,b)=>timeValue(a.due_at)-timeValue(b.due_at));
    const seenDue=new Set();
    const upcoming=due.filter(a=>{
      const key=[a.title,a.due_at].join('|');if(seenDue.has(key))return false;seenDue.add(key);return true;
    }).slice(0,3);
    if($('twReminderList')) $('twReminderList').innerHTML=upcoming.length
      ? upcoming.map(a=>`<button type="button" class="tw-list-row" data-go-view="${isProject(a)?'performance':'assignments'}" aria-label="Open ${safe(a.title)} due ${shortDay(a.due_at)}"><span class="tw-list-icon" aria-hidden="true">${icon('reminder')}</span><span><b>${safe(a.title || 'Upcoming assessment')}</b><small>${safe(labelSection(a))}</small></span><span class="tw-row-pill ${upcomingLabel(a)==='Due today'?'tw-late':''}">${upcomingLabel(a)}</span></button>`).join('')
      : empty('No upcoming published deadlines.', 'Open activities','assignments');
    const reviewed=subs.filter(s=>s.status==='graded').length;
    const total=subs.length;const percentage=total?Math.round(reviewed/total*100):0;
    if($('twReviewPct')) $('twReviewPct').textContent=percentage+'%';
    if($('twReviewDonut')) $('twReviewDonut').style.setProperty('--tw-progress',String(percentage));
    if($('twReviewBar')) $('twReviewBar').style.width=percentage+'%';
    if($('twReviewLine')) $('twReviewLine').textContent=total?reviewed===total?'All submissions reviewed':`${total-reviewed} waiting for review`:'No submissions yet';
    if($('twReviewDetail')) $('twReviewDetail').textContent=total?'Based on current non-archived assessment submissions.':'Once students submit their work, checking progress appears here.';
    if($('twReviewFraction')) $('twReviewFraction').textContent=`${reviewed} reviewed of ${total} submissions`;
    if($('twProfileAvatar')) $('twProfileAvatar').textContent=(name.match(/[\p{L}\p{N}]/u)||['T'])[0].toUpperCase();
    const profile=$('teacherApp')?.querySelector('.tw-profile-avatar');if(profile) profile.textContent=(name.match(/[\p{L}\p{N}]/u)||['T'])[0].toUpperCase();
  }
  function openView(view) {
    if(typeof showTeacherView !== 'function') return;
    showTeacherView(view);
    if(typeof closeTeacherSidebar==='function') closeTeacherSidebar();
    if($('twSearchDialog')?.open) $('twSearchDialog').close();
  }
  function searchEntries(){
    const pages=[
      ['Dashboard','Overview and teaching workspace','dashboard','⌂'],
      ['Classes','Rosters, sections and students','classes','♧'],
      ['Activities','Written works and assessment questions','assignments','▤'],
      ['Performance Tasks','Projects, groups and rubrics','performance','♜'],
      ['Submissions','Check students’ work and feedback','submissions','☑'],
      ['Class Records','View and export WW/PT grades','records','▥'],
      ['Competencies','Competency tracking and mastery','competencies','◎'],
      ['Archive','Archived classes and assessments','archive','▣']
    ].map(([title,desc,view,mark])=>({title,desc,view,mark,type:'page'}));
    if(typeof state==='undefined'||!state.profile||state.profile.role!=='teacher')return pages;
    const classes=(state.sections||[]).slice(0,80).map(s=>({title:`Grade ${s.grade_level} ${s.name}`,desc:`Class · ${s.archived_at?'Archived':'Active'}`,view:s.archived_at?'archive':'classes',mark:'♧',type:'class',name:s.name}));
    const seen=new Set();
    const tasks=(state.assignments||[]).filter(a=>{
      const k=a.title+'|'+(isProject(a)?'p':'a');if(seen.has(k))return false;seen.add(k);return true;
    }).slice(0,120).map(a=>({title:a.title||'Untitled assessment',desc:isProject(a)?'Performance Task':'Activity',view:isProject(a)?'performance':'assignments',mark:isProject(a)?'♜':'▤',type:'assignment',name:a.title||''}));
    return [...pages,...classes,...tasks];
  }
  let searchItems=[],selected=0;
  function renderSearch() {
    const query=String($('twSearchInput')?.value||'').trim().toLowerCase();
    searchItems=searchEntries().filter(x=>!query||`${x.title} ${x.desc}`.toLowerCase().includes(query)).slice(0,16);
    selected=Math.min(selected,Math.max(0,searchItems.length-1));
    if($('twSearchResults')) $('twSearchResults').innerHTML=searchItems.length
      ? searchItems.map((x,i)=>`<button class="tw-search-result" role="option" aria-selected="${i===selected}" data-selected="${i===selected}" type="button" data-index="${i}"><span class="tw-search-result-icon">${x.mark}</span><span><b>${safe(x.title)}</b><small>${safe(x.desc)}</small></span><span aria-hidden="true">↗</span></button>`).join('')
      : '<div class="tw-search-empty">No matching tools, classes, or activities.</div>';
  }
  function activateSearch(index) {
    const target=searchItems[index];if(!target)return;
    const q=target.name||'';
    openView(target.view);
    if(target.type==='class' && q){const el=$('msClassSearch');if(el){el.value=q;el.dispatchEvent(new Event('input',{bubbles:true}));}}
    if(target.type==='assignment' && q){const el=document.querySelector(target.view==='assignments'?'#msListToolbar-assignmentList input[type="search"]':'#msListToolbar-performanceTaskList input[type="search"]');if(el){el.value=q;el.dispatchEvent(new Event('input',{bubbles:true}));}}
  }
  function searchOpen() {if(!activeTeacher())return;const d=$('twSearchDialog');if(d&&!d.open){d.showModal();selected=0;$('twSearchInput').value='';renderSearch();$('twSearchInput').focus();}}
  $('twSearchTrigger')?.addEventListener('click',searchOpen);
  $('twSearchClose')?.addEventListener('click',()=>$('twSearchDialog')?.close());
  $('twSearchInput')?.addEventListener('input',()=>{selected=0;renderSearch();});
  $('twSearchInput')?.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'||e.key==='ArrowUp') {e.preventDefault();selected=(selected+(e.key==='ArrowDown'?1:-1)+searchItems.length)%Math.max(searchItems.length,1);renderSearch();}
    if(e.key==='Enter'){e.preventDefault();activateSearch(selected);}
  });
  $('twSearchResults')?.addEventListener('click',e=>{
    const item=e.target.closest('[data-index]');if(item)activateSearch(Number(item.dataset.index));
  });
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&activeTeacher()){e.preventDefault();searchOpen();}});
  $('twCreateActivity')?.addEventListener('click',()=>$('postAssignmentBtn')?.click());
  $('twCreatePerformance')?.addEventListener('click',()=>$('postPerformanceTaskBtn')?.click());
  // The existing app binds [data-go-view] on first load. These page shortcuts are
  // recreated from data after login, so event delegation covers them safely.
  $('view-dashboard')?.addEventListener('click',e=>{
    const btn=e.target.closest('[data-go-view]');
    if(!btn)return;
    // Initial static buttons already have app.js direct handlers; don't double navigate.
    if(btn.closest('#twPendingList,#twRecentList,#twReminderList')){e.stopPropagation();openView(btn.dataset.goView);}
  });
  if(typeof renderTeacher==='function'){
    const previous=renderTeacher;
    renderTeacher=function(...args){const result=previous(...args);renderDashboard();return result;};
  }
  if(activeTeacher()) renderDashboard();
  window.MathsideTeacherDashboardV26={render:renderDashboard};
})();
