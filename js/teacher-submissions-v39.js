/* V39: visual checking workspace. All grading and storage writes use the original review handlers. */
(() => {
  'use strict';
  const by = id => document.getElementById(id);
  const view = by('view-submissions'), dialog = by('reviewSubmissionModal'), host = by('ms39ReviewHost'), list = by('submissionList');
  if (!view || !dialog || !host || !list) return;
  const filterPanel = by('submissionFilterPanel');
  if(filterPanel) new MutationObserver(()=>{if(filterPanel.hidden)filterPanel.hidden=false;}).observe(filterPanel,{attributes:true,attributeFilter:['hidden']});
  const originalRender = renderSubmissions, originalReview = openSubmissionReview, originalOpen = openDialog, originalClose = closeDialog, originalShow = showTeacherView;
  const home = document.createComment('original review dialog location'); dialog.before(home);
  const iconBase = 'assets/teacher-pixelmatch/icons/';
  const PAGE_SIZE = 5;
  let page = 1, filterKey = '', rows = [], selected = null, opening = false, dirty = false, gallery = [], imageIndex = 0, zoom = 1, moved = [], layout = null;
  const isInline = () => dialog.classList.contains('ms39-inline');
  const isActive = () => view.classList.contains('active') && !by('teacherApp')?.hidden;
  const safe = value => esc(String(value ?? ''));
  const person = s => studentById(s.student_id)?.display_name || 'Student';
  const assignment = s => assignmentById(s.assignment_id);
  const late = s => Boolean(assignment(s)?.due_at && s.submitted_at && Date.parse(s.submitted_at) > Date.parse(assignment(s).due_at));
  const mode = s => isPerformanceTask(assignment(s)) ? (assignment(s)?.collaboration_mode || 'individual') : 'individual';
  const score = s => s.status === 'graded' ? (s.teacher_score ?? s.auto_score ?? '—') : (isPerformanceTask(assignment(s)) ? '—' : (s.teacher_score ?? s.auto_score ?? 0));
  const tag = (s, cls, text) => `<span class="ms39-badge ${cls}">${text}</span>`;
  const status = s => s.status === 'graded' ? tag(s,'checked','Checked') : tag(s,'new','For checking');
  const metric = (icon, color, value, label, tint) => `<div class="ms39-metric ${tint}"><img alt="" src="${iconBase}${color}/${icon}.png"><div><strong>${safe(value)}</strong><small>${label}</small></div></div>`;
  function scoped(prefs) {
    return (state.submissions || []).filter(s => !s.is_class_mirror && workType(assignment(s)) === prefs.workType && (prefs.sectionId === 'all' || assignment(s)?.section_id === prefs.sectionId) && (prefs.assignmentId === 'all' || s.assignment_id === prefs.assignmentId));
  }
  function renderMetrics(prefs) {
    const all = scoped(prefs), checked = all.filter(s => s.status === 'graded').length;
    const a = prefs.assignmentId !== 'all' ? assignmentById(prefs.assignmentId) : null;
    const individual = a && (!isPerformanceTask(a) || (a.collaboration_mode || 'individual') === 'individual');
    const roster = individual ? new Set((state.members || []).filter(m => m.section_id === a.section_id).map(m => m.student_id)) : null;
    const submitted = new Set(all.map(s => s.student_id));
    if (roster && a) for(const id of roster) if(teacherAssignmentProgress(id,a).submitted) submitted.add(id);
    const missed = roster ? [...roster].filter(id => !submitted.has(id)).length : null;
    const overdue = roster && a.due_at && Date.parse(a.due_at) < Date.now();
    by('ms39Metrics').innerHTML = metric('02-classes','orange',roster ? roster.size : submitted.size,roster?'Total learners':'Submitted learners','') + metric('check','green',checked,'Checked','green') + metric('calendar','orange',all.length-checked,'For checking','gold') + metric('refresh','orange',all.filter(s => s.resubmit_allowed).length,'Resubmission allowed','purple') + metric('alert','orange',overdue?missed:all.filter(late).length,overdue?'Missed deadline':'Late submissions','red');
  }
  function drawQueue() {
    const query = (by('ms39Search').value || '').trim().toLowerCase();
    const prefs=window.MathsideSubmissionViewPreferences.read();
    const visible = rows.filter(s => `${person(s)} ${assignment(s)?.title || ''} ${sectionLabel(sectionById(assignment(s)?.section_id))}`.toLowerCase().includes(query));
    const pages = Math.max(1,Math.ceil(visible.length/PAGE_SIZE)); page = Math.min(Math.max(page,1),pages);
    const shown = visible.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
    list.innerHTML = shown.map(s => {
      const isSelected = selected === s.id, total = totalPoints(s.assignment_id), work = mode(s), prefix = work === 'class' ? 'Class representative · ' : work === 'individual' ? '' : 'Team leader · ';
      return `<article class="ms39-entry ${isSelected?'selected':''}"><button type="button" data-review-submission="${safe(s.id)}" class="ms39-open" aria-pressed="${isSelected}"><span class="ms39-selection" aria-hidden="true">${isSelected?'✓':''}</span><span class="ms39-entry-copy"><strong>${safe(person(s))}</strong>${prefs.assignmentId==='all'||prefix?`<small>${safe(prefix + (assignment(s)?.title || 'Assignment'))}</small>`:''}${prefs.sectionId==='all'?`<small>${safe(sectionLabel(sectionById(assignment(s)?.section_id)))}</small>`:''}<span class="ms39-tags">${status(s)}${late(s)?tag(s,'late','Late'):''}${s.resubmit_allowed?tag(s,'resubmit','Resubmit allowed'):''}</span></span><b class="ms39-queue-score">${safe(score(s))} / ${safe(total)}</b></button><button type="button" class="ms39-track" title="View student progress" aria-label="View student progress" data-track-student-from-submissions="${safe(s.student_id)}" data-track-section="${safe(assignment(s)?.section_id || '')}"><img src="${iconBase}charcoal/chart.png" alt=""></button></article>`;
    }).join('') || '<div class="ms39-queue-empty">No matching submissions.<small>Try a different class, activity, or status.</small></div>';
    by('ms39QueueCount').textContent = `${visible.length} submissions`;
    by('ms39Page').textContent = `${page} of ${pages}`;
    by('ms39Prev').disabled = page === 1; by('ms39Next').disabled = page === pages;
  }
  renderSubmissions = function(...args) {
    if (isInline() && dialog.open && opening) return;
    const result = originalRender(...args);
    const prefs = window.MathsideSubmissionViewPreferences.read();
    const key = JSON.stringify(prefs);
    if (filterKey !== key) {page=1;filterKey=key;}
    // The original renderer is authoritative for grouping, assignment category, status and sorting.
    rows = Array.from(list.querySelectorAll('[data-review-submission]')).map(b => state.submissions.find(s => s.id === b.dataset.reviewSubmission)).filter(Boolean);
    const section = by('ms39Section');
    section.innerHTML = Array.from(by('submissionSectionTabs').querySelectorAll('[data-submission-section]')).map(b => `<option value="${safe(b.dataset.submissionSection)}">${safe(b.querySelector('b')?.textContent || 'All classes')}${b.dataset.submissionSection==='all'?' classes':''}</option>`).join('');
    section.value = prefs.sectionId;
    renderMetrics(prefs); drawQueue(); updateQuestionOptions();
    return result;
  };
  function updateQuestionOptions() {
    const input = by('ms39Question'), old = input.value;
    const prefs = window.MathsideSubmissionViewPreferences.read();
    const selectedSubmission = state.submissions.find(s => s.id === selected);
    const aid = selectedSubmission?.assignment_id || (prefs.assignmentId !== 'all' ? prefs.assignmentId : null);
    const qs = aid ? questionsFor(aid) : [];
    input.innerHTML = '<option value="all">All questions</option>'+qs.map((q,i)=>`<option value="${safe(q.id)}">Question ${i+1}</option>`).join('');
    input.value = qs.some(q=>String(q.id)===old) ? old : 'all';
    input.disabled = !qs.length; applyQuestionFilter();
  }
  function applyQuestionFilter() {
    const value = by('ms39Question').value;
    dialog.querySelectorAll('[data-review-question]').forEach(el => {el.hidden = value !== 'all' && el.dataset.reviewQuestion !== value; if(value!=='all'&&!el.hidden) {const detail=el.querySelector('.ms39-question-detail');if(detail){detail.hidden=false;el.querySelector('.ms39-question-toggle')?.setAttribute('aria-expanded','true');}}});
  }
  by('ms39Question').addEventListener('change', ()=>{applyQuestionFilter();if(by('ms39Question').value==='all'){dialog.querySelectorAll('.ms39-question-detail').forEach(el=>{el.hidden=true;el.parentElement.querySelector('.ms39-question-toggle')?.setAttribute('aria-expanded','false');});by('reviewSubmissionAnswers').scrollTop=0;}});
  by('ms39Section').addEventListener('change', e => {Array.from(by('submissionSectionTabs').querySelectorAll('[data-submission-section]')).find(b=>b.dataset.submissionSection===e.target.value)?.click();});
  by('ms39Search').addEventListener('input',()=>{page=1;drawQueue();});
  by('ms39Prev').addEventListener('click',()=>{page--;drawQueue();});
  by('ms39Next').addEventListener('click',()=>{page++;drawQueue();});
  // Move original elements, never clone or replace the Grade form and its event listeners.
  function move(id, destination) {
    const el=by(id); if(!el)return; const mark=document.createComment(id); el.before(mark); moved.push([el,mark]); destination.append(el);
  }
  function createLayout() {
    const box = dialog.querySelector('.modal-box');
    layout=document.createElement('div'); layout.className='ms39-review-layout';
    layout.innerHTML=`<div class="ms39-review-top"><div class="ms39-review-identity"></div><div class="ms39-review-actions"><span id="ms39ReviewStatus"></span><button type="button" id="ms39Close" title="Close review" aria-label="Close review">×</button></div></div><div class="ms39-review-tabs"><button type="button" data-ms39-tab="submission" class="active">Submission</button><button type="button" data-ms39-tab="questions">Question scores</button><button type="button" data-ms39-tab="history">Details</button><button type="button" data-ms39-tab="remarks">Remarks</button></div><div class="ms39-review-grid"><div class="ms39-image-side"><div class="ms39-viewer" id="ms39Viewer"><div id="ms39Media"></div><div class="ms39-viewer-tools"><button type="button" data-zoom="out" title="Zoom out" aria-label="Zoom out">−</button><span id="ms39Zoom">100%</span><button type="button" data-zoom="in" title="Zoom in" aria-label="Zoom in">+</button><a id="ms39External" target="_blank" rel="noopener" title="Open original file" aria-label="Open original file">↗</a></div><button type="button" class="ms39-image-prev" id="ms39ImagePrev" title="Previous image" aria-label="Previous image">‹</button><button type="button" class="ms39-image-next" id="ms39ImageNext" title="Next image" aria-label="Next image">›</button></div><div id="ms39Thumbs" class="ms39-thumbs"></div><div class="ms39-original-links"></div><div class="ms39-detail" hidden></div></div><div class="ms39-grade-side"><div class="ms39-score-head"><h3>Checking &amp; scoring</h3><span id="ms39LiveScore"></span></div><div class="ms39-answers"></div><div class="ms39-team"></div><div class="ms39-grade"></div></div></div>`;
    box.append(layout);
    const id=layout.querySelector('.ms39-review-identity');
    move('reviewSubmissionStudentName',id); move('reviewSubmissionTitle',id); move('reviewSubmissionMeta',id);
    move('reviewProofWrap',layout.querySelector('.ms39-original-links'));
    move('reviewSubmissionAnswers',layout.querySelector('.ms39-answers'));
    move('manualReviewSummary',layout.querySelector('.ms39-answers'));
    move('reviewPerformanceTeamInfo',layout.querySelector('.ms39-team')); move('reviewClassScoring',layout.querySelector('.ms39-team'));
    move('gradeForm',layout.querySelector('.ms39-grade'));
    by('ms39Close').addEventListener('click',()=>{if(!dirty||window.confirm('Discard unsaved checking changes?'))closeDialog('reviewSubmissionModal');});
    layout.addEventListener('click', e=>{
      const tab=e.target.closest('[data-ms39-tab]');if(tab){switchTab(tab.dataset.ms39Tab);return;}
      const thumb=e.target.closest('[data-ms39-image]');if(thumb){imageIndex=Number(thumb.dataset.ms39Image);zoom=1;renderMedia();return;}
      if(e.target.closest('#ms39ImagePrev')){imageIndex=Math.max(0,imageIndex-1);zoom=1;renderMedia();}
      if(e.target.closest('#ms39ImageNext')){imageIndex=Math.min(gallery.length-1,imageIndex+1);zoom=1;renderMedia();}
      const z=e.target.closest('[data-zoom]');if(z){zoom=Math.min(3,Math.max(.5,zoom+(z.dataset.zoom==='in'?.25:-.25)));applyZoom();}
    });
    layout.addEventListener('input',e=>{if(e.target.matches('input,textarea,select')){dirty=true;updateScore();}});
    layout.addEventListener('change',e=>{if(e.target.matches('input,textarea,select')){dirty=true;updateScore();}});
  }
  function applyZoom() {const img=by('ms39Media')?.querySelector('img'); if(img){img.style.width=`${zoom*100}%`;img.style.maxWidth='none';} if(by('ms39Zoom'))by('ms39Zoom').textContent=`${Math.round(zoom*100)}%`;}
  function renderMedia() {
    const current=gallery[imageIndex], area=by('ms39Media'), external=by('ms39External'); if(!area||!external)return;
    area.replaceChildren();
    if(!current){area.innerHTML='<div class="ms39-no-media"><img src="'+iconBase+'orange/file.png" alt=""><b>No uploaded picture available</b><small>Check the submitted answers or existing score on the right.</small></div>';external.hidden=true;}
    else {external.hidden=false;external.href=current.href;
      if(current.pdf){const frame=document.createElement('iframe');frame.src=current.href;frame.title='Submitted PDF';area.append(frame);}
      else {const img=document.createElement('img');img.src=current.href;img.alt=`Submitted work ${imageIndex+1}`;img.onerror=()=>{area.textContent='Preview unavailable. Use the open-file action to access the original.';};area.append(img);}
    }
    by('ms39ImagePrev').disabled=imageIndex===0;by('ms39ImageNext').disabled=imageIndex>=gallery.length-1;
    by('ms39Thumbs').innerHTML=gallery.map((g,i)=>`<button type="button" data-ms39-image="${i}" aria-label="Open file ${i+1}" class="${i===imageIndex?'active':''}">${g.pdf?'PDF':`<img alt="" src="${safe(g.href)}">`}<span>${i+1}</span></button>`).join('')+(gallery.length?`<small>${gallery.length} file${gallery.length===1?'':'s'}</small>`:'');applyZoom();
  }
  function compactQuestions() {
    dialog.querySelectorAll('#reviewSubmissionAnswers [data-review-question]').forEach((row,i)=>{
      const heading=row.querySelector('.review-answer-heading'), label=row.querySelector('.manual-answer-check'), check=row.querySelector('[data-manual-correct]');
      if(!heading||!label||!check)return;
      const auto=row.querySelector('.review-answer-points')?.textContent.match(/Auto points:\s*([\d.]+)/)?.[1] || '0';
      row.dataset.ms39AutoPoints=auto;
      const detail=document.createElement('div');detail.className='ms39-question-detail';detail.hidden=true;
      const question=heading.querySelector('h3');if(question)detail.append(question);
      Array.from(row.children).filter(el=>el!==heading).forEach(el=>detail.append(el));
      const b=document.createElement('button');b.type='button';b.className='ms39-question-toggle';b.setAttribute('aria-expanded','false');b.setAttribute('aria-label',`Question ${i+1}, show answer details`);b.innerHTML=`<strong>Q${i+1}</strong><span class="ms39-question-points"></span><span class="ms39-q-chevron">›</span>`;
      check.setAttribute('aria-label',`Question ${i+1} correct`);heading.append(b);row.append(detail);row.classList.add('ms39-compact-question');
      b.addEventListener('click',()=>{detail.hidden=!detail.hidden;b.setAttribute('aria-expanded',String(!detail.hidden));});
    });
  }
  function updateScore() {
    const s=state.submissions.find(s=>s.id===selected), out=by('ms39LiveScore');if(!s||!out)return;
    const input=by('teacherScoreInput'), value=input?.value === '' ? (isPerformanceTask(assignment(s))?'—':s.auto_score??0) : input?.value;
    out.textContent=`Score: ${value} / ${totalPoints(s.assignment_id)}`;
    dialog.querySelectorAll('.ms39-compact-question').forEach(row=>{const cb=row.querySelector('[data-manual-correct]'), points=row.querySelector('.ms39-question-points');if(!cb||!points)return;const n=cb.dataset.manualExisting==='true'?(cb.checked?Number(cb.dataset.maxPoints):0):row.dataset.ms39AutoPoints;points.textContent=`${n} / ${cb.dataset.maxPoints}`;});
  }
  function switchTab(tab) {
    if(!layout)return;layout.dataset.tab=tab;layout.querySelectorAll('[data-ms39-tab]').forEach(b=>b.classList.toggle('active',b.dataset.ms39Tab===tab));
    const viewer=by('ms39Viewer'), thumbs=by('ms39Thumbs'), detail=layout.querySelector('.ms39-detail');
    viewer.hidden=tab==='history';thumbs.hidden=tab==='history';detail.hidden=tab!=='history';
    if(tab==='history'){
      const s=state.submissions.find(s=>s.id===selected);if(s){detail.innerHTML=`<h3>Submission details</h3><p><b>Submitted:</b> ${safe(formatStudentDate(s.submitted_at)||'—')}</p><p><b>Attempt:</b> ${Number(s.attempt_count||1)}</p><p><b>Last graded:</b> ${safe(formatStudentDate(s.graded_at)||'Not graded')}</p><p><b>Resubmission:</b> ${s.resubmit_allowed?'Allowed':'Not currently allowed'}</p>${s.feedback?`<p><b>Saved feedback:</b> ${safe(s.feedback)}</p>`:''}`;}
    }
    if(tab==='questions'){dialog.querySelectorAll('.ms39-question-detail').forEach(el=>{el.hidden=false;el.parentElement.querySelector('.ms39-question-toggle')?.setAttribute('aria-expanded','true');});}
    else if(tab==='submission'){dialog.querySelectorAll('.ms39-question-detail').forEach(el=>{el.hidden=true;el.parentElement.querySelector('.ms39-question-toggle')?.setAttribute('aria-expanded','false');});}
    if(tab==='remarks')by('teacherFeedbackInput')?.focus({preventScroll:true});
  }
  function populateReview() {
    const s=state.submissions.find(s=>s.id===activeSubmissionId); if(!s)return;
    selected=s.id;dirty=false;imageIndex=0;zoom=1;
    gallery=Array.from(by('reviewProofLinks').querySelectorAll('a[href]')).filter(a=>/^Open (solution|output picture)/i.test(a.textContent.trim())).map(a=>({href:a.href,pdf:/\.pdf(?:\?|$)/i.test(a.href)}));
    by('ms39ReviewStatus').innerHTML=status(s)+(late(s)?tag(s,'late','Late'):'');
    renderMedia();compactQuestions();updateScore();updateQuestionOptions();drawQueue();
    const rubric=assignment(s)?.rubric_path, details=layout.querySelector('.ms39-original-links');
    if(rubric){const b=document.createElement('button');b.type='button';b.className='ms39-rubric-link';b.textContent='Open attached rubric';b.addEventListener('click',async()=>{try{const url=await signedUrl('mathside-assignment-images',rubric,1800);if(url){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.click();}else toast('Rubric file unavailable.','orange');}catch(e){toast('Could not open the rubric.','orange');}});details.append(b);}
  }
  function restore() {
    if(!isInline())return;
    for(const [el,mark] of moved)mark.replaceWith(el);moved=[];
    layout?.remove();layout=null;dialog.classList.remove('ms39-inline');home.after(dialog);by('ms39ReviewEmpty').hidden=false;
    selected=null;dirty=false;gallery=[];drawQueue();updateQuestionOptions();
    if(isActive())window.MathsideLiveSubmissionsV30?.refresh?.();
  }
  openDialog=function(id){
    if(id!=='reviewSubmissionModal'||!isActive())return originalOpen(id);
    if(!isInline()){host.append(dialog);dialog.classList.add('ms39-inline');createLayout();}
    by('ms39ReviewEmpty').hidden=true;
    if(!dialog.open)dialog.show();populateReview();
  };
  closeDialog=function(id){
    if(id!=='reviewSubmissionModal'||!isInline())return originalClose(id);
    if(dialog.open)dialog.close();restore();
  };
  dialog.addEventListener('close',()=>{if(isInline()&&!dialog.open)restore();});
  openSubmissionReview=async function(id){
    if(opening)return;
    if(isInline()&&selected===id&&dialog.open)return;
    if(isInline()&&dirty&&!window.confirm('Discard unsaved checking changes and open another submission?'))return;
    if(isInline())closeDialog('reviewSubmissionModal');
    opening=true;
    try {if(isActive())submissionAnswerCache.delete(id);return await originalReview(id);}
    catch(e){console.error(e);toast(friendlyErrorMessage(e,'Could not load this submission.'),'orange');}
    finally{opening=false;}
  };
  showTeacherView=function(name){
    if(name!=='submissions'&&isInline()){if(dirty&&!window.confirm('Discard unsaved checking changes?'))return;closeDialog('reviewSubmissionModal');}
    return originalShow(name);
  };
  // Protect the original Cancel action from silently discarding edited answers.
  dialog.addEventListener('click',e=>{if(isInline()&&dirty&&e.target.closest('[data-close="reviewSubmissionModal"]')&&!window.confirm('Discard unsaved checking changes?')){e.preventDefault();e.stopImmediatePropagation();}},true);
  // Sign-out must not leave a previous account's selected work in the DOM.
  db?.auth?.onAuthStateChange?.(event=>{if(event==='SIGNED_OUT'&&isInline()){closeDialog('reviewSubmissionModal');by('reviewProofLinks').replaceChildren();by('reviewSubmissionAnswers').replaceChildren();by('teacherScoreInput').value='';by('teacherFeedbackInput').value='';}});
  window.MathsideSubmissionsV39={isReviewOpen:()=>opening||(isInline()&&dialog.open)};
})();
