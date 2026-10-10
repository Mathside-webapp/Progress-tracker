/* Mathside V24.14 — Reference UI redesign
   Teacher workspace visual layer + class visual customization + teacher calendar.
   Keeps existing data/auth/submission logic intact. */
(() => {
  'use strict';

  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => [...root.querySelectorAll(sel)];
  const pad = n => String(n).padStart(2, '0');
  const safeKey = (value, prefix) => new RegExp(`^${prefix}-\\d{2}$`).test(String(value || '')) ? String(value) : `${prefix}-01`;
  const logoPath = section => `assets/v16/class-logos/${safeKey(section?.logo_key, 'logo')}.jpg`;
  const bgPath = section => `assets/v16/class-backgrounds/${safeKey(section?.background_key, 'bg')}.jpg`;
  const activeSectionsV16 = () => (state.sections || []).filter(section => !section.archived_at);
  const activeAssignmentsV16 = () => (state.assignments || []).filter(a => a.status !== 'archived' && !a.archived_at);
  const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  const parseDate = value => value ? new Date(value) : null;
  const classNameFor = id => sectionById(id)?.name || 'Class';

  // ---------------------------------------------------------------------------
  // VISUAL PICKERS (10 logos + 10 class backgrounds)
  // ---------------------------------------------------------------------------
  function logoChoicesHtml(selected = 'logo-01') {
    return Array.from({length:10}, (_,i) => {
      const key = `logo-${pad(i+1)}`;
      return `<button type="button" class="v16-logo-choice ${key===selected?'selected':''}" data-v16-logo-choice="${key}" aria-pressed="${key===selected?'true':'false'}"><img src="assets/v16/class-logos/${key}.jpg" alt="Logo option ${i+1}"><span>${pad(i+1)}</span></button>`;
    }).join('');
  }

  function backgroundChoicesHtml(selected = 'bg-01') {
    return Array.from({length:10}, (_,i) => {
      const key = `bg-${pad(i+1)}`;
      return `<button type="button" class="v16-bg-choice ${key===selected?'selected':''}" data-v16-background-choice="${key}" aria-pressed="${key===selected?'true':'false'}"><img src="assets/v16/class-backgrounds/${key}.jpg" alt="Background option ${i+1}"><span>${pad(i+1)}</span></button>`;
    }).join('');
  }

  function renderVisualPicker(logoRoot, bgRoot, logoKey, bgKey) {
    if (logoRoot) logoRoot.innerHTML = logoChoicesHtml(safeKey(logoKey,'logo'));
    if (bgRoot) bgRoot.innerHTML = backgroundChoicesHtml(safeKey(bgKey,'bg'));
  }

  function syncCreateVisualPicker(logo='logo-01', bg='bg-01') {
    const logoInput = q('#sectionLogoKey');
    const bgInput = q('#sectionBackgroundKey');
    if (logoInput) logoInput.value = safeKey(logo,'logo');
    if (bgInput) bgInput.value = safeKey(bg,'bg');
    renderVisualPicker(q('#sectionLogoChoices'), q('#sectionBackgroundChoices'), logoInput?.value, bgInput?.value);
  }

  renderVisualPicker(q('#sectionLogoChoices'), q('#sectionBackgroundChoices'), 'logo-01', 'bg-01');

  document.addEventListener('click', event => {
    const logoBtn = event.target.closest('[data-v16-logo-choice]');
    if (logoBtn) {
      const root = logoBtn.closest('.v16-logo-choice-row');
      qa('.v16-logo-choice', root).forEach(btn => { btn.classList.toggle('selected', btn===logoBtn); btn.setAttribute('aria-pressed', btn===logoBtn?'true':'false'); });
      const target = root?.id === 'classVisualLogoChoices' ? q('#classVisualLogoKey') : q('#sectionLogoKey');
      if (target) target.value = logoBtn.dataset.v16LogoChoice;
      return;
    }
    const bgBtn = event.target.closest('[data-v16-background-choice]');
    if (bgBtn) {
      const root = bgBtn.closest('.v16-background-choice-row');
      qa('.v16-bg-choice', root).forEach(btn => { btn.classList.toggle('selected', btn===bgBtn); btn.setAttribute('aria-pressed', btn===bgBtn?'true':'false'); });
      const target = root?.id === 'classVisualBackgroundChoices' ? q('#classVisualBackgroundKey') : q('#sectionBackgroundKey');
      if (target) target.value = bgBtn.dataset.v16BackgroundChoice;
      return;
    }

    const custom = event.target.closest('[data-v16-customize-class]');
    if (custom) {
      const section = sectionById(custom.dataset.v16CustomizeClass);
      if (!section) return;
      q('#classVisualSectionId').value = section.id;
      q('#classVisualTitle').textContent = `Customize ${section.name}`;
      q('#classVisualLogoKey').value = safeKey(section.logo_key,'logo');
      q('#classVisualBackgroundKey').value = safeKey(section.background_key,'bg');
      renderVisualPicker(q('#classVisualLogoChoices'), q('#classVisualBackgroundChoices'), q('#classVisualLogoKey').value, q('#classVisualBackgroundKey').value);
      openDialog('classVisualModal');
      return;
    }

    const createClass = event.target.closest('#createClassBtn, #dashboardCreateClass, [data-empty-create-class]');
    if (createClass) setTimeout(() => syncCreateVisualPicker('logo-01','bg-01'), 0);

    const reuse = event.target.closest('[data-create-from-archive]');
    if (reuse) {
      const section = sectionById(reuse.dataset.createFromArchive);
      setTimeout(() => syncCreateVisualPicker(section?.logo_key || 'logo-01', section?.background_key || 'bg-01'), 0);
    }
  }, true);

  q('#saveClassVisualBtn')?.addEventListener('click', async event => {
    const btn = event.currentTarget;
    const sectionId = q('#classVisualSectionId')?.value;
    const section = sectionById(sectionId);
    if (!section || !requireSupabase()) return;
    const payload = {
      logo_key: safeKey(q('#classVisualLogoKey')?.value,'logo'),
      background_key: safeKey(q('#classVisualBackgroundKey')?.value,'bg')
    };
    const oldText = btn.textContent;
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const { error } = await db.from('mathside_sections').update(payload).eq('id', sectionId).eq('teacher_id', state.user.id);
      if (error) throw error;
      Object.assign(section, payload);
      closeDialog('classVisualModal');
      renderTeacher();
      toast('Class style updated.', 'success');
    } catch (error) {
      console.error('CLASS VISUAL UPDATE', error);
      toast(friendlyErrorMessage(error, 'Could not update the class style.'), 'orange');
    } finally {
      btn.disabled = false; btn.textContent = oldText;
    }
  });

  // ---------------------------------------------------------------------------
  // OVERVIEW
  // ---------------------------------------------------------------------------
  function renderOverviewExtras() {
    const sections = activeSectionsV16();
    const activeIds = new Set(sections.map(s=>s.id));
    const relevantAssignments = activeAssignmentsV16().filter(a=>activeIds.has(a.section_id));
    const relevantAssignmentIds = new Set(relevantAssignments.map(a=>a.id));
    const submissions = (state.submissions || []).filter(s=>relevantAssignmentIds.has(s.assignment_id));
    const review = submissions.filter(s=>s.status !== 'graded');
    const dayAgo = Date.now() - 24*60*60*1000;
    const recent = submissions.filter(s => new Date(s.submitted_at || 0).getTime() >= dayAgo);

    if (q('#v16NewSubmissionTotal')) q('#v16NewSubmissionTotal').textContent = String(recent.length);
    if (q('#v16ReviewTotal')) q('#v16ReviewTotal').textContent = String(review.length);
    if (q('#v16SubmissionHeaderCount')) q('#v16SubmissionHeaderCount').textContent = String(review.length);
    if (q('#v16SubmissionNavBadge')) { q('#v16SubmissionNavBadge').textContent = String(review.length); q('#v16SubmissionNavBadge').hidden = review.length===0; }

    const firstName = String(state.profile?.display_name || state.user?.email || 'Teacher').trim().split(/\s+/)[0] || 'Teacher';
    if (q('#v16WelcomeBack')) q('#v16WelcomeBack').textContent = `Welcome back, Teacher ${firstName}.`;

    const upcomingRoot = q('#v16UpcomingList');
    if (upcomingRoot) {
      const now = new Date();
      const cutoff = new Date(now.getTime()+45*24*60*60*1000);
      const upcoming = relevantAssignments.filter(a=>a.due_at && parseDate(a.due_at)>=now && parseDate(a.due_at)<=cutoff).sort((a,b)=>parseDate(a.due_at)-parseDate(b.due_at)).slice(0,4);
      upcomingRoot.innerHTML = upcoming.length ? upcoming.map(a=>{
        const d=parseDate(a.due_at), section=sectionById(a.section_id);
        return `<button type="button" class="v16-upcoming-item" data-preview-assignment="${a.id}"><span class="v16-date-block"><b>${d.toLocaleString(undefined,{month:'short'}).toUpperCase()}</b><strong>${d.getDate()}</strong></span><span><strong>${esc(a.title)}</strong><small>${esc(section?.name||'Class')} · ${isPerformanceTask(a)?'Performance task':'Activity'}</small></span><em>→</em></button>`;
      }).join('') : '<div class="v16-empty-small">No upcoming deadlines.</div>';
    }

    const latestRoot = q('#v16LatestSubmissions');
    if (latestRoot) {
      const latest=[...submissions].sort((a,b)=>new Date(b.submitted_at||0)-new Date(a.submitted_at||0)).slice(0,4);
      latestRoot.innerHTML = latest.length ? latest.map((sub,index)=>{
        const a=assignmentById(sub.assignment_id), st=studentById(sub.student_id), sec=sectionById(a?.section_id), graded=sub.status==='graded';
        return `<article class="v16-latest-row"><span class="v16-student-chip">S${index+1}</span><div><strong>${esc(st?.display_name||'Student')}</strong><small>${esc(a?.title||'Activity')} · ${esc(sec?.name||'Class')}</small></div><span class="v16-review-state ${graded?'done':''}">${graded?'Graded':'Needs review'}</span><button type="button" class="btn btn-light" data-v16-review-submission="${sub.id}">${graded?'View':'Review'}</button></article>`;
      }).join('') : '<div class="v16-empty-small">No submissions yet.</div>';
    }
  }

  // ---------------------------------------------------------------------------
  // TEACHER CALENDAR
  // ---------------------------------------------------------------------------
  let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let calendarSelected = dateKey(new Date());
  let calendarClass = 'all';

  function calendarAssignments() {
    return activeAssignmentsV16().filter(a=>a.due_at && (calendarClass==='all' || a.section_id===calendarClass));
  }

  function renderCalendarControls() {
    const select=q('#v16CalendarClassFilter');
    const sections=activeSectionsV16();
    if (select) {
      select.innerHTML='<option value="all">All classes</option>'+sections.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');
      if (calendarClass!=='all' && !sections.some(s=>s.id===calendarClass)) calendarClass='all';
      select.value=calendarClass;
    }
    const legend=q('#v16CalendarLegend');
    if (legend) legend.innerHTML=sections.slice(0,5).map(s=>`<span><i style="background:${esc(s.color||'#ff5b15')}"></i>${esc(s.name)}</span>`).join('');
  }

  function renderTeacherCalendar() {
    const root=q('#v16TeacherCalendarGrid');
    if (!root) return;
    renderCalendarControls();
    const year=calendarCursor.getFullYear(), month=calendarCursor.getMonth();
    q('#v16CalendarMonth').textContent=calendarCursor.toLocaleString(undefined,{month:'long',year:'numeric'});
    const first=new Date(year,month,1);
    const offset=(first.getDay()+6)%7; // Monday first
    const gridStart=new Date(year,month,1-offset);
    const assignments=calendarAssignments();
    const byDay=new Map();
    assignments.forEach(a=>{
      const d=parseDate(a.due_at); if(!d) return;
      const key=dateKey(d); if(!byDay.has(key)) byDay.set(key,[]); byDay.get(key).push(a);
    });
    const todayKey=dateKey(new Date());
    root.innerHTML=Array.from({length:42},(_,i)=>{
      const d=new Date(gridStart); d.setDate(gridStart.getDate()+i);
      const key=dateKey(d); const items=byDay.get(key)||[]; const inMonth=d.getMonth()===month;
      return `<button type="button" class="v16-calendar-day ${inMonth?'':'outside'} ${key===todayKey?'today':''} ${key===calendarSelected?'selected':''}" data-v16-calendar-day="${key}"><span class="v16-calendar-number">${d.getDate()}</span><span class="v16-day-events">${items.slice(0,2).map(a=>{const sec=sectionById(a.section_id);return `<i style="--event-color:${esc(sec?.color||'#ff5b15')}">${esc(a.title)}</i>`}).join('')}${items.length>2?`<small>+${items.length-2} more</small>`:''}</span></button>`;
    }).join('');
    renderCalendarAgenda(byDay);
  }

  function renderCalendarAgenda(byDay = null) {
    const assignments=calendarAssignments();
    if (!byDay) {
      byDay=new Map(); assignments.forEach(a=>{const d=parseDate(a.due_at);if(!d)return;const k=dateKey(d);if(!byDay.has(k))byDay.set(k,[]);byDay.get(k).push(a);});
    }
    let selected = byDay.get(calendarSelected) || [];
    if (!selected.length) {
      const monthPrefix=`${calendarCursor.getFullYear()}-${pad(calendarCursor.getMonth()+1)}-`;
      selected=assignments.filter(a=>dateKey(parseDate(a.due_at)).startsWith(monthPrefix)).sort((a,b)=>parseDate(a.due_at)-parseDate(b.due_at)).slice(0,6);
    }
    const title=q('#v16CalendarAgendaTitle');
    const selectedDate = new Date(`${calendarSelected}T12:00:00`);
    if (title) title.textContent = selected.length && byDay.has(calendarSelected) ? selectedDate.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}) : 'Deadlines this month';
    const root=q('#v16CalendarAgenda');
    if (!root) return;
    root.innerHTML=selected.length?selected.map(a=>{
      const sec=sectionById(a.section_id), d=parseDate(a.due_at);
      return `<article class="v16-agenda-item"><img src="${logoPath(sec)}" alt=""><div><span class="v16-class-pill">${esc(sec?.name||'Class')}</span><h3>${esc(a.title)}</h3><p>${isPerformanceTask(a)?'Performance task':'Activity'} · Due ${d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</p></div><button type="button" class="btn btn-orange" data-preview-assignment="${a.id}">View ${isPerformanceTask(a)?'task':'activity'} →</button></article>`;
    }).join(''):'<div class="v16-empty-small">No deadlines here.</div>';
  }

  q('#v16CalendarPrev')?.addEventListener('click',()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()-1,1);calendarSelected=`${calendarCursor.getFullYear()}-${pad(calendarCursor.getMonth()+1)}-01`;renderTeacherCalendar();});
  q('#v16CalendarNext')?.addEventListener('click',()=>{calendarCursor=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth()+1,1);calendarSelected=`${calendarCursor.getFullYear()}-${pad(calendarCursor.getMonth()+1)}-01`;renderTeacherCalendar();});
  q('#v16CalendarToday')?.addEventListener('click',()=>{const now=new Date();calendarCursor=new Date(now.getFullYear(),now.getMonth(),1);calendarSelected=dateKey(now);renderTeacherCalendar();});
  q('#v16CalendarClassFilter')?.addEventListener('change',e=>{calendarClass=e.currentTarget.value||'all';renderTeacherCalendar();});
  q('#v16TeacherCalendarGrid')?.addEventListener('click',e=>{const btn=e.target.closest('[data-v16-calendar-day]');if(!btn)return;calendarSelected=btn.dataset.v16CalendarDay;renderTeacherCalendar();});

  // ---------------------------------------------------------------------------
  // SEARCH + LIGHTWEIGHT FILTERING
  // ---------------------------------------------------------------------------
  function filterDom(selector, needle, root=document) {
    const query=String(needle||'').trim().toLowerCase();
    qa(selector,root).forEach(card=>{
      const hay=(card.dataset.v16Search || card.textContent || '').toLowerCase();
      card.hidden=Boolean(query && !hay.includes(query));
    });
  }

  const searchBindings=[
    ['#v16ClassSearch','#classGrid .v16-class-card'],
    ['#v16ActivitySearch','#assignmentList .v16-activity-card'],
    ['#v16PerformanceSearch','#performanceTaskList .v16-performance-card'],
    ['#v16ArchiveSearch','#archiveList .archive-record'],
    ['#v16SubmissionSearch','#submissionList .submission-card']
  ];
  searchBindings.forEach(([inputSel,itemSel])=>q(inputSel)?.addEventListener('input',e=>filterDom(itemSel,e.currentTarget.value)));

  function applyGlobalSearch(value) {
    const view=q('#teacherApp .app-view.active')?.id?.replace('view-','') || 'dashboard';
    const map={classes:['#v16ClassSearch','#classGrid .v16-class-card'],assignments:['#v16ActivitySearch','#assignmentList .v16-activity-card'],performance:['#v16PerformanceSearch','#performanceTaskList .v16-performance-card'],archive:['#v16ArchiveSearch','#archiveList .archive-record'],submissions:['#v16SubmissionSearch','#submissionList .submission-card']};
    if (!map[view]) return;
    const [inputSel,itemSel]=map[view]; const input=q(inputSel); if(input) input.value=value; filterDom(itemSel,value);
  }
  q('#teacherGlobalSearch')?.addEventListener('input',e=>applyGlobalSearch(e.currentTarget.value));

  // Class filter popover (grade only, intentionally compact)
  q('#v16ClassFilterToggle')?.addEventListener('click',()=>{
    let panel=q('#v16ClassFilterPanel');
    if (!panel) {
      panel=document.createElement('div'); panel.id='v16ClassFilterPanel'; panel.className='v16-class-filter-panel';
      panel.innerHTML=`<label>Grade<select id="v16ClassGradeFilter"><option value="all">All grades</option>${[7,8,9,10,11,12].map(g=>`<option value="${g}">Grade ${g}</option>`).join('')}</select></label>`;
      q('#view-classes .v16-page-toolbar')?.append(panel);
      q('#v16ClassGradeFilter')?.addEventListener('change',e=>{
        const value=e.currentTarget.value; qa('#classGrid .v16-class-card').forEach(card=>card.hidden=value!=='all' && card.dataset.grade!==value);
      });
    }
    panel.hidden=!panel.hidden;
  });

  // ---------------------------------------------------------------------------
  // NAV + RENDER WRAPPERS
  // ---------------------------------------------------------------------------
  const baseShowTeacherView = showTeacherView;
  showTeacherView = function(view) {
    baseShowTeacherView(view);
    const titleMap={dashboard:'Overview',classes:'My Classes',assignments:'Activities',performance:'Performance Tasks',submissions:'Submissions',calendar:'Calendar',archive:'Archived'};
    if (q('#teacherPageTitle')) q('#teacherPageTitle').textContent=titleMap[view]||'Mathside';
    if (view==='calendar') renderTeacherCalendar();
    if (view==='dashboard') renderOverviewExtras();
    if (q('#teacherGlobalSearch')) q('#teacherGlobalSearch').value='';
  };

  const baseRenderTeacher = renderTeacher;
  renderTeacher = function() {
    baseRenderTeacher();
    renderOverviewExtras();
    renderTeacherCalendar();
  };

  q('#v16CreateActivityBtn')?.addEventListener('click',()=>q('#postAssignmentBtn')?.click());

  document.addEventListener('click', async event => {
    const submissionJump=event.target.closest('[data-v16-go-submissions]');
    if (submissionJump) {
      const assignment = assignmentById(submissionJump.dataset.v16GoSubmissions);
      showTeacherView('submissions');
      const type = isPerformanceTask(assignment) ? 'performance_task' : 'written_work';
      const typeBtn = q(`#submissionTypeTabs [data-submission-type="${type}"]`);
      typeBtn?.click();
      setTimeout(() => {
        const select = q('#submissionActivityFilter');
        if (select && [...select.options].some(option => option.value === assignment?.id)) {
          select.value = assignment.id;
          select.dispatchEvent(new Event('change', { bubbles:true }));
        }
      }, 0);
      return;
    }
    const review=event.target.closest('[data-v16-review-submission]');
    if (review) {
      await openSubmissionReview(review.dataset.v16ReviewSubmission);
      return;
    }
  });

  // Small mobile affordance: close card menus after choosing an action.
  document.addEventListener('click', event => {
    if (event.target.closest('.v16-card-menu-popover button')) {
      const details=event.target.closest('details'); if(details) details.open=false;
    }
  });

  // Render static pickers on load. Actual teacher data will render after auth.
  syncCreateVisualPicker();
})();
