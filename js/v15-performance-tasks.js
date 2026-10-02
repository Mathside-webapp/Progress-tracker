/* Mathside V15 — Performance Tasks + submission categories.
   Adapted from the established EduCore performance-task workflow while
   preserving Mathside archive, manual review and controlled resubmission. */
(() => {
  'use strict';

  let submissionWorkType = 'written_work';
  let editingPerformanceTaskId = null;
  let editingPerformanceTaskIds = [];
  let activePerformanceTaskId = null;

  const originalOpenAssignmentPreview = openAssignmentPreview;
  const originalOpenSubmissionReview = openSubmissionReview;
  const originalOpenStudentResponsePreview = openStudentResponsePreview;
  const originalShowTeacherView = showTeacherView;
  const originalRenderTeacher = renderTeacher;
  const originalShowStudentPanel = showStudentPanel;

  const asPaths = (value, fallback = '') => normalizeStoredPaths(value, fallback);
  const performanceTasks = () => state.assignments.filter(a => isPerformanceTask(a));
  const writtenWorks = () => state.assignments.filter(a => !isPerformanceTask(a));
  const assignmentTaskImages = a => asPaths(a?.image_paths, a?.image_path || '');
  const submissionOutputPaths = s => asPaths(s?.proof_paths, s?.proof_path || '');
  const activeSections = () => state.sections.filter(section => !section.archived_at);

  function performanceSignature(a) {
    return JSON.stringify({
      title: String(a.title || '').trim(),
      instructions: String(a.instructions || '').trim(),
      due: a.due_at || null,
      reminder: Number(a.reminder_hours_before || 0),
      status: a.status || 'published',
      publish: a.publish_at || null,
      resubmit: Boolean(a.allow_resubmission),
      points: Number(a.max_points || 0),
      type: 'performance_task'
    });
  }

  function performanceGroups() {
    const bySignature = new Map();
    performanceTasks().forEach(task => {
      const sig = performanceSignature(task);
      if (!bySignature.has(sig)) bySignature.set(sig, []);
      const buckets = bySignature.get(sig);
      let group = buckets.find(candidate => !candidate.some(item => item.section_id === task.section_id));
      if (!group) { group = []; buckets.push(group); }
      group.push(task);
    });
    return [...bySignature.values()].flat();
  }

  function performanceGroupForId(id) {
    return performanceGroups().find(group => group.some(item => item.id === id)) || [];
  }

  function groupSectionLabels(group) {
    return [...new Set(group.map(item => sectionLabel(sectionById(item.section_id))))];
  }

  async function signedLinks(bucket, paths, seconds = 1800) {
    const results = [];
    for (const path of paths) {
      const url = await signedUrl(bucket, path, seconds);
      if (url) results.push({ path, url });
    }
    return results;
  }

  async function removeStoragePaths(bucket, paths) {
    const unique = [...new Set((paths || []).filter(Boolean))];
    if (!unique.length) return;
    try { await db.storage.from(bucket).remove(unique); }
    catch (error) { console.warn('Storage cleanup skipped', error); }
  }

  async function uploadTeacherFiles(taskId, files, prefix) {
    const paths = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const path = `${state.user.id}/${taskId}/${prefix}-${Date.now()}-${i + 1}-${safeFileName(file.name)}`;
      const result = await db.storage.from('mathside-assignment-images').upload(path, file, { upsert: false });
      if (result.error) throw result.error;
      paths.push(path);
    }
    return paths;
  }

  // ---------------------------------------------------------------
  // TEACHER NAV / COUNTS
  // ---------------------------------------------------------------
  showTeacherView = function(view) {
    originalShowTeacherView(view);
    if (view === 'performance') {
      $('#teacherPageTitle').textContent = 'Performance Tasks';
      renderPerformanceTasks();
    }
    if (view === 'assignments') $('#teacherPageTitle').textContent = 'Activities';
  };

  renderTeacher = function() {
    originalRenderTeacher();
    const performanceTotal = $('#performanceTotal');
    if (performanceTotal) performanceTotal.textContent = String(performanceTasks().filter(a => a.status !== 'archived').length);
    const assignmentTotal = $('#assignmentTotal');
    if (assignmentTotal) assignmentTotal.textContent = String(writtenWorks().filter(a => a.status !== 'archived').length);
    renderPerformanceTasks();
  };

  // ---------------------------------------------------------------
  // WRITTEN ACTIVITY LIST — do not mix performance tasks into it
  // ---------------------------------------------------------------
  renderAssignments = function() {
    const list = $('#assignmentList');
    if (!list) return;
    const groups = groupedAssignmentsForDisplay().filter(group => !isPerformanceTask(group[0]));
    if (!groups.length) {
      selectedAssignmentIds.clear();
      list.innerHTML = `<div class="assignment-empty v9-empty"><span class="v9-empty-icon">${iconSvg('assignment','assignment-line-icon')}</span><b>No activities yet</b><p>Create your first question-based Mathematics activity.</p><button class="btn btn-orange" type="button" data-v9-new-assignment>＋ New activity</button></div>`;
      return;
    }
    const cards = groups.map(group => {
      const assignment = group[0];
      const groupIds = group.map(item => item.id);
      const groupIdsAttr = groupIds.join(',');
      const sectionLabels = assignmentGroupSectionLabels(group);
      const questions = questionsFor(assignment.id);
      const missingAnswers = questions.filter(question => !(keyFor(question.id)?.correct_answer || '').trim()).length;
      const scheduled = assignment.status === 'draft' && assignment.publish_at && new Date(assignment.publish_at).getTime() > Date.now();
      const archived = group.every(item => item.status === 'archived');
      const selected = group.every(item => selectedAssignmentIds.has(item.id));
      const classSummary = sectionLabels.length === 1 ? `<span class="meta-chip">${esc(sectionLabels[0])}</span>` : `<span class="meta-chip assignment-group-count">${sectionLabels.length} classes</span>`;
      const classList = sectionLabels.length > 1 ? `<div class="assignment-class-list" aria-label="Classes">${sectionLabels.map(label => `<span>${esc(label)}</span>`).join('')}</div>` : '';
      return `<article class="assignment-card assignment-group-card ${selected ? 'is-selected' : ''} ${scheduled ? 'assignment-scheduled' : ''} ${archived ? 'assignment-archived' : ''}">
        <label class="assignment-select-check"><input class="row-check" type="checkbox" data-select-assignment="${assignment.id}" data-assignment-group-ids="${esc(groupIdsAttr)}" ${selected ? 'checked' : ''}><span class="sr-only">Select ${esc(assignment.title)}</span></label>
        <div class="assignment-thumb">${assignment.image_url ? `<img src="${esc(assignment.image_url)}" alt="Activity image" data-assignment-storage-path="${esc(assignment.image_path || '')}">` : iconSvg('assignment','assignment-line-icon')}</div>
        <div class="assignment-card-body"><div class="assignment-title-line"><h3>${esc(assignment.title)}</h3>${group.length > 1 ? '<span class="shared-assignment-badge">Shared activity</span>' : ''}${scheduled ? '<span class="scheduled-badge">Scheduled</span>' : ''}${archived ? '<span class="archived-badge">Archived</span>' : ''}</div><p>${esc(assignment.instructions || 'Mathematics activity')}</p>${classList}<div class="assignment-meta">${classSummary}${scheduled ? `<span class="meta-chip scheduled-chip">Posts ${esc(formatDeadlineDate(assignment.publish_at))}</span>` : ''}${missingAnswers ? `<span class="meta-chip answer-key-warning">${missingAnswers} answer${missingAnswers===1?'':'s'} pending</span>` : ''}</div></div>
        <div class="assignment-card-actions"><button class="btn btn-light" data-preview-assignment="${assignment.id}">Preview</button>${archived ? '' : `<button class="btn btn-light" data-edit-assignment="${assignment.id}">Edit</button><button class="btn btn-archive" data-archive-assignment-group="${esc(groupIdsAttr)}">Archive</button>`}<button class="btn btn-danger-outline" data-delete-assignment-group="${esc(groupIdsAttr)}">Delete</button></div>
      </article>`;
    }).join('');
    list.innerHTML = `<div class="bulk-toolbar assignment-bulk-toolbar"><label class="bulk-select-all"><input id="selectAllAssignments" class="row-check" type="checkbox"><span>Select all activities</span></label><span class="bulk-selected-count" id="selectedAssignmentCount">0 selected</span><div class="bulk-actions"><button class="btn btn-archive" id="bulkArchiveAssignmentsBtn" type="button" disabled>Archive selected</button><button class="btn btn-danger" id="bulkDeleteAssignmentsBtn" type="button" disabled>Delete selected</button></div></div>${cards}`;
    updateAssignmentBulkToolbar();
  };

  // ---------------------------------------------------------------
  // PERFORMANCE TASK EDITOR
  // ---------------------------------------------------------------
  function populatePerformanceSections() {
    const list = $('#performanceSectionChecklist');
    if (!list) return;
    const sections = activeSections();
    if (!sections.length) { list.innerHTML = '<p class="class-checklist-empty">Create an active class first.</p>'; return; }
    list.innerHTML = sections.map((section, index) => `<label class="class-check-option"><input type="checkbox" name="performance_sections" value="${section.id}" ${sections.length === 1 && index === 0 ? 'checked' : ''}><span><b>${esc(section.name)}</b><small>Grade ${esc(section.grade_level)}</small></span></label>`).join('');
  }

  function selectedPerformanceSections() {
    return $$('input[name="performance_sections"]:checked', $('#performanceSectionChecklist')).map(n => n.value);
  }

  function resetPerformanceForm() {
    const form = $('#performanceTaskForm');
    form?.reset();
    if (form?.elements?.max_points) form.elements.max_points.value = '100';
    $('#performanceImagePreview').innerHTML = '';
    $('#performanceRubricExisting').innerHTML = '';
    $('#performanceRubricExisting').hidden = true;
    $('#removePerformanceImagesWrap').hidden = true;
    $('#removePerformanceRubricWrap').hidden = true;
    $('#performancePublishAtWrap').hidden = true;
    editingPerformanceTaskId = null;
    editingPerformanceTaskIds = [];
    populatePerformanceSections();
  }

  function syncPerformancePublishFields() {
    const scheduled = $('#performancePublishMode')?.value === 'schedule';
    if ($('#performancePublishAtWrap')) $('#performancePublishAtWrap').hidden = !scheduled;
    if (!scheduled && $('#performancePublishAt')) $('#performancePublishAt').value = '';
  }

  async function openPerformanceTaskModal(taskId = null) {
    if (!activeSections().length) { toast('Create at least one active class before posting a performance task.', 'orange'); showTeacherView('classes'); return; }
    resetPerformanceForm();
    const task = taskId ? assignmentById(taskId) : null;
    if (taskId && (!task || !isPerformanceTask(task))) return toast('This performance task is no longer available.', 'orange');
    if (task) {
      const group = performanceGroupForId(task.id);
      editingPerformanceTaskId = task.id;
      editingPerformanceTaskIds = (group.length ? group : [task]).map(item => item.id);
      const form = $('#performanceTaskForm');
      form.elements.title.value = task.title || '';
      form.elements.instructions.value = task.instructions || '';
      form.elements.max_points.value = String(Number(task.max_points || 100));
      const isScheduled = task.status === 'draft' && task.publish_at && new Date(task.publish_at).getTime() > Date.now();
      form.elements.publish_mode.value = isScheduled ? 'schedule' : 'now';
      form.elements.publish_at.value = isScheduled ? formatDateTimeLocalInput(task.publish_at) : '';
      form.elements.due_at.value = formatDateTimeLocalInput(task.due_at);
      form.elements.reminder_hours_before.value = String(Number(task.reminder_hours_before || 0));
      form.elements.allow_resubmission.checked = Boolean(task.allow_resubmission);
      syncPerformancePublishFields();
      const sectionIds = new Set((group.length ? group : [task]).map(item => item.section_id));
      $$('input[name="performance_sections"]', $('#performanceSectionChecklist')).forEach(input => { input.checked = sectionIds.has(input.value); input.disabled = true; input.closest('.class-check-option')?.classList.toggle('editing-class-option', input.checked); });
      const existingImages = assignmentTaskImages(task);
      if (existingImages.length) {
        $('#removePerformanceImagesWrap').hidden = false;
        const links = await signedLinks('mathside-assignment-images', existingImages, 1800);
        $('#performanceImagePreview').innerHTML = links.map((x,i)=>`<img src="${esc(x.url)}" alt="Existing task picture ${i+1}">`).join('');
      }
      if (task.rubric_path) {
        $('#removePerformanceRubricWrap').hidden = false;
        const url = await signedUrl('mathside-assignment-images', task.rubric_path, 1800);
        if (url) { $('#performanceRubricExisting').hidden = false; $('#performanceRubricExisting').innerHTML = `<a class="btn btn-light btn-small" href="${esc(url)}" target="_blank" rel="noopener">Open current rubric</a>`; }
      }
      $('#performanceTaskModalTitle').textContent = 'Edit performance task';
      $('#performanceTaskSubmitBtn').textContent = 'Save performance task';
    } else {
      $('#performanceTaskModalTitle').textContent = 'Create performance task';
      $('#performanceTaskSubmitBtn').textContent = 'Post performance task';
    }
    openDialog('performanceTaskModal');
  }

  $('#postPerformanceTaskBtn')?.addEventListener('click', () => openPerformanceTaskModal());
  $('#performancePublishMode')?.addEventListener('change', syncPerformancePublishFields);
  $('#performanceImages')?.addEventListener('change', event => {
    const files = [...(event.currentTarget.files || [])].slice(0, 8);
    $('#performanceImagePreview').innerHTML = files.map((file,i)=>`<figure><img src="${URL.createObjectURL(file)}" alt="Selected task picture ${i+1}"><figcaption>${esc(file.name)}</figcaption></figure>`).join('');
  });

  document.addEventListener('click', event => {
    const btn = event.target.closest('[data-edit-performance-task]');
    if (btn) openPerformanceTaskModal(btn.dataset.editPerformanceTask);
  });

  async function savePerformanceCopy(task, form, schedule, files, rubricFile, removeImages, removeRubric) {
    let imagePaths = assignmentTaskImages(task);
    let rubricPath = task.rubric_path || null;
    const uploaded = [];
    try {
      if (files.length) {
        const fresh = await uploadTeacherFiles(task.id, files, 'task');
        uploaded.push(...fresh);
        await removeStoragePaths('mathside-assignment-images', imagePaths);
        imagePaths = fresh;
      } else if (removeImages) {
        await removeStoragePaths('mathside-assignment-images', imagePaths);
        imagePaths = [];
      }
      if (rubricFile) {
        const [freshRubric] = await uploadTeacherFiles(task.id, [rubricFile], 'rubric');
        uploaded.push(freshRubric);
        if (rubricPath) await removeStoragePaths('mathside-assignment-images', [rubricPath]);
        rubricPath = freshRubric;
      } else if (removeRubric && rubricPath) {
        await removeStoragePaths('mathside-assignment-images', [rubricPath]);
        rubricPath = null;
      }
      const update = await db.from('mathside_assignments').update({
        title: String(form.get('title') || '').trim(), instructions: String(form.get('instructions') || '').trim(),
        work_type:'performance_task', max_points:Number(form.get('max_points') || 100),
        due_at:schedule.dueAt, reminder_hours_before:schedule.dueAt ? schedule.reminderHours : 0,
        status:schedule.status, publish_at:schedule.publishAt, allow_resubmission:form.get('allow_resubmission') === 'on',
        image_path:imagePaths[0] || null, image_paths:imagePaths, rubric_path:rubricPath
      }).eq('id', task.id);
      if (update.error) throw update.error;
    } catch (error) {
      if (uploaded.length) await removeStoragePaths('mathside-assignment-images', uploaded);
      throw error;
    }
  }

  function readPerformanceSchedule(form) {
    const dueRaw = String(form.get('due_at') || '').trim();
    let dueAt = null;
    if (dueRaw) { const d = new Date(dueRaw); if (Number.isNaN(d.getTime())) throw new Error('Enter a valid performance task deadline.'); dueAt = d.toISOString(); }
    const reminderHours = Number(form.get('reminder_hours_before') || 0);
    if (![0,24,48,72].includes(reminderHours)) throw new Error('Choose a valid student reminder.');
    if (!dueAt && reminderHours > 0) throw new Error('Choose a deadline before turning on a student reminder.');
    let publishAt = null, status = 'published';
    if (String(form.get('publish_mode') || 'now') === 'schedule') {
      const raw = String(form.get('publish_at') || '').trim();
      if (!raw) throw new Error('Choose when Mathside should post this performance task.');
      const d = new Date(raw); if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now() + 30000) throw new Error('Scheduled posting must be a valid future date and time.');
      publishAt = d.toISOString(); status = 'draft';
    }
    if (dueAt && publishAt && new Date(dueAt) <= new Date(publishAt)) throw new Error('The performance task deadline must be after the scheduled posting time.');
    return { dueAt, reminderHours, publishAt, status };
  }

  $('#performanceTaskForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!requireSupabase()) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') || '').trim();
    const instructions = String(form.get('instructions') || '').trim();
    const maxPoints = Number(form.get('max_points') || 0);
    if (!title || !instructions) return toast('Add a title and instructions for the performance task.', 'orange');
    if (!Number.isFinite(maxPoints) || maxPoints <= 0) return toast('Total points must be greater than zero.', 'orange');
    const sectionIds = selectedPerformanceSections();
    if (!sectionIds.length) return toast('Select at least one class for this performance task.', 'orange');
    const taskImages = [...($('#performanceImages')?.files || [])];
    if (taskImages.length > 8) return toast('Upload up to 8 reference pictures.', 'orange');
    if (taskImages.some(file => !String(file.type || '').startsWith('image/'))) return toast('Reference pictures must be image files.', 'orange');
    const rubricFile = $('#performanceRubric')?.files?.[0] || null;
    let schedule;
    try { schedule = readPerformanceSchedule(form); }
    catch (error) { return toast(error.message, 'orange', 'Check performance task'); }

    if (editingPerformanceTaskId) {
      const copies = editingPerformanceTaskIds.map(id => assignmentById(id)).filter(Boolean);
      try {
        await withLoading(copies.length > 1 ? `Saving in ${copies.length} classes…` : 'Saving performance task…', 'Updating instructions, deadline, pictures, rubric, and score settings.', async () => {
          for (const task of copies) await savePerformanceCopy(task, form, schedule, taskImages, rubricFile, $('#removePerformanceImages')?.checked, $('#removePerformanceRubric')?.checked);
          closeDialog('performanceTaskModal'); editingPerformanceTaskId = null; editingPerformanceTaskIds = [];
          await refreshTeacher(); showTeacherView('performance');
        });
        toast(schedule.status === 'draft' ? `Performance task scheduled for ${formatDeadlineDate(schedule.publishAt)}.` : 'Performance task updated.', 'success');
      } catch (error) { console.error(error); toast(error.message || 'Could not save the performance task.', 'orange'); }
      return;
    }

    const created = [], uploaded = [];
    try {
      await withLoading(`Posting to ${sectionIds.length} class${sectionIds.length===1?'':'es'}…`, 'Creating the performance task, pictures, rubric, deadline, and notifications.', async () => {
        for (const sectionId of sectionIds) {
          const insert = await db.from('mathside_assignments').insert({
            section_id:sectionId, teacher_id:state.user.id, title, instructions, work_type:'performance_task', max_points:maxPoints,
            due_at:schedule.dueAt, reminder_hours_before:schedule.dueAt ? schedule.reminderHours : 0,
            status:'draft', publish_at:schedule.publishAt, allow_resubmission:form.get('allow_resubmission') === 'on', image_paths:[]
          }).select().single();
          if (insert.error) throw insert.error;
          const task = insert.data; created.push(task);
          const imagePaths = taskImages.length ? await uploadTeacherFiles(task.id, taskImages, 'task') : [];
          uploaded.push(...imagePaths);
          let rubricPath = null;
          if (rubricFile) { [rubricPath] = await uploadTeacherFiles(task.id, [rubricFile], 'rubric'); uploaded.push(rubricPath); }
          const update = await db.from('mathside_assignments').update({ image_path:imagePaths[0] || null, image_paths:imagePaths, rubric_path:rubricPath, status:schedule.status, publish_at:schedule.publishAt }).eq('id', task.id);
          if (update.error) throw update.error;
        }
        closeDialog('performanceTaskModal'); await refreshTeacher(); showTeacherView('performance');
      });
      toast(schedule.status === 'draft' ? `Performance task scheduled for ${formatDeadlineDate(schedule.publishAt)}.` : `Performance task posted to ${sectionIds.length} class${sectionIds.length===1?'':'es'}.`, 'success');
    } catch (error) {
      console.error(error);
      if (uploaded.length) await removeStoragePaths('mathside-assignment-images', uploaded);
      const ids = created.map(x=>x.id); if (ids.length) try { await db.from('mathside_assignments').delete().in('id',ids); } catch {}
      toast(error.message || 'Could not post the performance task.', 'orange');
    }
  });

  function renderPerformanceTasks() {
    const list = $('#performanceTaskList');
    if (!list) return;
    const groups = performanceGroups();
    if (!groups.length) {
      list.innerHTML = `<div class="assignment-empty v9-empty"><span class="v9-empty-icon">▣</span><b>No performance tasks yet</b><p>Post a task with instructions, pictures, rubric, deadline, and assigned sections.</p></div>`;
      return;
    }
    list.innerHTML = groups.map(group => {
      const a = group[0], ids = group.map(x=>x.id), labels = groupSectionLabels(group);
      const scheduled = a.status === 'draft' && a.publish_at && new Date(a.publish_at).getTime() > Date.now();
      const archived = group.every(item => item.status === 'archived');
      const images = assignmentTaskImages(a);
      const classList = labels.length > 1 ? `<div class="assignment-class-list">${labels.map(x=>`<span>${esc(x)}</span>`).join('')}</div>` : '';
      return `<article class="assignment-card performance-task-card ${scheduled?'assignment-scheduled':''} ${archived?'assignment-archived':''}">
        <div class="assignment-thumb performance-thumb">${a.image_url?`<img src="${esc(a.image_url)}" alt="Performance task picture" data-assignment-storage-path="${esc(a.image_path||'')}">`:'▣'}</div>
        <div class="assignment-card-body"><div class="assignment-title-line"><h3>${esc(a.title)}</h3>${group.length>1?'<span class="shared-assignment-badge">Shared performance task</span>':''}${scheduled?'<span class="scheduled-badge">Scheduled</span>':''}${archived?'<span class="archived-badge">Archived</span>':''}</div><p>${esc(a.instructions || 'Performance task')}</p>${classList}<div class="assignment-meta"><span class="meta-chip">${labels.length===1?esc(labels[0]):`${labels.length} classes`}</span><span class="meta-chip">${Number(a.max_points||0)} pts</span>${a.due_at?`<span class="meta-chip">Due ${esc(formatDeadlineDate(a.due_at))}</span>`:''}${images.length?`<span class="meta-chip">${images.length} picture${images.length===1?'':'s'}</span>`:''}${a.rubric_path?'<span class="meta-chip rubric-chip">Rubric attached</span>':''}${scheduled?`<span class="meta-chip scheduled-chip">Posts ${esc(formatDeadlineDate(a.publish_at))}</span>`:''}</div></div>
        <div class="assignment-card-actions"><button class="btn btn-light" data-preview-assignment="${a.id}">Preview</button>${archived?'':`<button class="btn btn-light" data-edit-performance-task="${a.id}">Edit</button><button class="btn btn-archive" data-archive-assignment-group="${esc(ids.join(','))}">Archive</button>`}<button class="btn btn-danger-outline" data-delete-assignment-group="${esc(ids.join(','))}">Delete</button></div>
      </article>`;
    }).join('');
  }
  window.renderPerformanceTasks = renderPerformanceTasks;

  // ---------------------------------------------------------------
  // PREVIEW
  // ---------------------------------------------------------------
  openAssignmentPreview = async function(id) {
    const task = assignmentById(id);
    if (!task || !isPerformanceTask(task)) {
      const questionSection = $('.assignment-preview-questions', $('#assignmentPreviewModal'));
      if (questionSection) questionSection.hidden = false;
      const resources = $('#performancePreviewResources');
      if (resources) resources.hidden = true;
      return originalOpenAssignmentPreview(id);
    }
    const group = performanceGroupForId(id); const linked = group.length ? group : [task];
    $('#assignmentPreviewTitle').textContent = task.title || 'Performance Task';
    $('#assignmentPreviewInstructions').textContent = task.instructions || 'No additional instructions were provided.';
    const scheduled = task.status === 'draft' && task.publish_at;
    const details = [
      ['Type','Performance Task'], ['Classes',groupSectionLabels(linked).join(', ') || 'No class selected'],
      ['Posting',scheduled?`Scheduled for ${formatDeadlineDate(task.publish_at)}`:'Posted immediately'],
      ['Deadline',task.due_at?formatDeadlineDate(task.due_at):'No deadline'],
      ['Student reminder',task.due_at?reminderLabel(task.reminder_hours_before):'No reminder'],
      ['Total points',`${Number(task.max_points||0)} points`]
    ];
    $('#assignmentPreviewDetails').innerHTML = details.map(([l,v])=>`<article><span>${esc(l)}</span><b>${esc(v)}</b></article>`).join('');
    const qSection = $('.assignment-preview-questions', $('#assignmentPreviewModal')); if (qSection) qSection.hidden = true;
    const resources = $('#performancePreviewResources'); resources.hidden = false;
    const images = await signedLinks('mathside-assignment-images', assignmentTaskImages(task), 1800);
    $('#performancePreviewImages').innerHTML = images.length ? images.map((x,i)=>`<a href="${esc(x.url)}" target="_blank" rel="noopener"><img src="${esc(x.url)}" alt="Task picture ${i+1}"></a>`).join('') : '<p class="muted">No reference pictures attached.</p>';
    if (task.rubric_path) {
      const url = await signedUrl('mathside-assignment-images', task.rubric_path, 1800);
      $('#performancePreviewRubric').innerHTML = url ? `<a class="btn btn-light" href="${esc(url)}" target="_blank" rel="noopener">Open rubric</a>` : '<p class="muted">Rubric file is unavailable.</p>';
    } else $('#performancePreviewRubric').innerHTML = '<p class="muted">No rubric attached.</p>';
    openDialog('assignmentPreviewModal');
  };
  $('#assignmentPreviewModal')?.addEventListener('close', () => {
    const q = $('.assignment-preview-questions', $('#assignmentPreviewModal')); if (q) q.hidden = false;
    if ($('#performancePreviewResources')) $('#performancePreviewResources').hidden = true;
  });

  // ---------------------------------------------------------------
  // SUBMISSIONS: category > section > activity; newest by default
  // ---------------------------------------------------------------
  function typeSubmissionCount(type) { return state.submissions.filter(s => workType(assignmentById(s.assignment_id)) === type).length; }
  function renderTypeTabs() {
    if ($('#writtenSubmissionCount')) $('#writtenSubmissionCount').textContent = String(typeSubmissionCount('written_work'));
    if ($('#performanceSubmissionCount')) $('#performanceSubmissionCount').textContent = String(typeSubmissionCount('performance_task'));
    $$('#submissionTypeTabs [data-submission-type]').forEach(btn => btn.classList.toggle('active', btn.dataset.submissionType === submissionWorkType));
  }

  renderSubmissionSectionTabs = function() {
    const tabs = $('#submissionSectionTabs'); if (!tabs) return;
    const relevant = state.submissions.filter(s => workType(assignmentById(s.assignment_id)) === submissionWorkType);
    const counts = new Map(state.sections.map(s => [s.id,0]));
    relevant.forEach(s => { const a = assignmentById(s.assignment_id); if (a?.section_id) counts.set(a.section_id, (counts.get(a.section_id)||0)+1); });
    if (submissionSectionId !== 'all' && !sectionById(submissionSectionId)) submissionSectionId = 'all';
    tabs.innerHTML = `<button type="button" class="submission-section-tab ${submissionSectionId==='all'?'active':''}" data-submission-section="all"><b>All</b><span>${relevant.length}</span></button>` + state.sections.filter(s=>!s.archived_at).map(section => `<button type="button" class="submission-section-tab ${submissionSectionId===section.id?'active':''}" data-submission-section="${section.id}"><b>${esc(section.name)}</b><small>Grade ${esc(section.grade_level)}</small><span>${counts.get(section.id)||0}</span></button>`).join('');
  };

  function sortSubmissionRows(rows) {
    return [...rows].sort((a,b) => {
      if (submissionSort === 'oldest') return new Date(a.submitted_at||0)-new Date(b.submitted_at||0);
      if (submissionSort === 'name') return String(studentById(a.student_id)?.display_name||'').localeCompare(String(studentById(b.student_id)?.display_name||''));
      if (submissionSort === 'gender') {
        const order={Male:0,Female:1,'Prefer not to say':2,'Not specified':3},sa=studentById(a.student_id),sb=studentById(b.student_id);
        return ((order[sa?.gender]??9)-(order[sb?.gender]??9)) || String(sa?.display_name||'').localeCompare(String(sb?.display_name||''));
      }
      return new Date(b.submitted_at||0)-new Date(a.submitted_at||0);
    });
  }

  function submissionCard(s) {
    const a = assignmentById(s.assignment_id), student = studentById(s.student_id), section = sectionById(a?.section_id), total = totalPoints(a?.id), graded = s.status === 'graded';
    const shown = graded ? Number(s.teacher_score ?? 0) : (isPerformanceTask(a) ? null : Number(s.auto_score || 0));
    const genderClass = student?.gender === 'Male' ? 'submission-male' : student?.gender === 'Female' ? 'submission-female' : 'submission-other';
    return `<article class="submission-card ${genderClass}"><div class="submission-status-icon">${graded?iconSvg('check','assignment-line-icon'):iconSvg('inbox','assignment-line-icon')}</div><div class="submission-card-body"><div class="submission-student-row"><button type="button" class="submission-student-name" data-track-student-from-submissions="${student?.id||''}" data-track-section="${section?.id||''}">${esc(student?.display_name||'Student')}</button><span class="gender-pill">${esc(student?.gender||'Not specified')}</span></div><div class="submission-meta-grid"><span><small>Status</small><b>${esc(s.status)}</b></span><span><small>Score</small><b>${shown===null?'Pending':`${shown}/${total}`}</b></span><span><small>Attempt</small><b>${Number(s.attempt_count||1)}</b></span><span><small>Submitted</small><b>${esc(formatStudentDate(s.submitted_at)||'')}</b></span></div></div><button class="btn btn-orange submission-review-btn" data-review-submission="${s.id}">Review</button></article>`;
  }

  renderSubmissions = function() {
    const list = $('#submissionList'); if (!list) return;
    submissionSort = submissionSort || 'newest';
    renderTypeTabs(); renderSubmissionSectionTabs();
    if ($('#submissionSort')) $('#submissionSort').value = submissionSort;
    let rows = state.submissions.filter(s => workType(assignmentById(s.assignment_id)) === submissionWorkType && (submissionSectionId === 'all' || assignmentById(s.assignment_id)?.section_id === submissionSectionId));
    const uniqueStudents = new Set(rows.map(s=>s.student_id)).size;
    const selectedSection = submissionSectionId === 'all' ? null : sectionById(submissionSectionId);
    const typeLabel = submissionWorkType === 'performance_task' ? 'Performance Tasks' : 'Activities';
    $('#submissionSectionSummary').innerHTML = `<span><b>${rows.length}</b> submission${rows.length===1?'':'s'}</span><span><b>${uniqueStudents}</b> learner${uniqueStudents===1?'':'s'}</span><span><b>${typeLabel}</b></span>${selectedSection?`<span><b>${esc(selectedSection.name)}</b> · Grade ${esc(selectedSection.grade_level)}</span>`:'<span>Grouped by section, then activity</span>'}`;
    if (!rows.length) { list.innerHTML = `<div class="assignment-empty v9-empty"><b>No ${typeLabel.toLowerCase()} submissions yet</b><p>Student work will appear here after submission.</p></div>`; return; }
    const sectionMap = new Map();
    rows.forEach(sub => {
      const assignment = assignmentById(sub.assignment_id); if (!assignment) return;
      if (!sectionMap.has(assignment.section_id)) sectionMap.set(assignment.section_id, new Map());
      const assignmentMap = sectionMap.get(assignment.section_id);
      if (!assignmentMap.has(assignment.id)) assignmentMap.set(assignment.id, []);
      assignmentMap.get(assignment.id).push(sub);
    });
    const sectionIds = [...sectionMap.keys()].sort((a,b)=>sectionLabel(sectionById(a)).localeCompare(sectionLabel(sectionById(b))));
    list.innerHTML = sectionIds.map(sectionId => {
      const section = sectionById(sectionId), assignmentMap = sectionMap.get(sectionId);
      const assignmentIds = [...assignmentMap.keys()].sort((a,b)=>String(assignmentById(a)?.title||'').localeCompare(String(assignmentById(b)?.title||''),undefined,{sensitivity:'base'}));
      const groups = assignmentIds.map(assignmentId => {
        const assignment = assignmentById(assignmentId), subs = sortSubmissionRows(assignmentMap.get(assignmentId));
        return `<section class="submission-activity-group"><header><div><span>${isPerformanceTask(assignment)?'PERFORMANCE TASK':'ACTIVITY'}</span><h3>${esc(assignment?.title||'Activity')}</h3></div><div><b>${subs.length}</b><small>submission${subs.length===1?'':'s'}</small></div></header><div class="submission-activity-list">${subs.map(submissionCard).join('')}</div></section>`;
      }).join('');
      return `<section class="submission-section-group"><div class="submission-section-group-title"><span>${iconSvg('class','btn-icon')}</span><div><p>SECTION</p><h2>${esc(section?.name||'Class')}</h2><small>Grade ${esc(section?.grade_level||'')}</small></div></div>${groups}</section>`;
    }).join('');
  };

  $('#submissionTypeTabs')?.addEventListener('click', event => {
    const btn = event.target.closest('[data-submission-type]'); if (!btn) return;
    submissionWorkType = btn.dataset.submissionType || 'written_work'; submissionSectionId = 'all'; renderSubmissions();
  });

  // ---------------------------------------------------------------
  // REVIEW PERFORMANCE TASK
  // ---------------------------------------------------------------
  openSubmissionReview = async function(submissionId) {
    const submission = state.submissions.find(s=>s.id===submissionId), a = assignmentById(submission?.assignment_id);
    if (!submission || !isPerformanceTask(a)) return originalOpenSubmissionReview(submissionId);
    activeSubmissionId = submissionId;
    const student = studentById(submission.student_id), total = totalPoints(a.id);
    await withLoading('Opening performance task…','Loading the student output pictures.', async () => {
      $('#reviewSubmissionTitle').textContent = a.title;
      if ($('#reviewSubmissionStudentName')) $('#reviewSubmissionStudentName').textContent = student?.display_name || 'Student';
      $('#reviewSubmissionMeta').textContent = `${sectionLabel(sectionById(a.section_id))} · Performance Task · Submitted ${formatStudentDate(submission.submitted_at)||''}`;
      $('#reviewSubmissionAnswers').innerHTML = `<article class="answer-question review-answer"><p class="eyebrow">TASK INSTRUCTIONS</p><p>${esc(a.instructions||'No additional instructions.')}</p></article>`;
      $('#manualReviewSummary').hidden = true;
      $('#teacherScoreInput').readOnly = false;
      $('#teacherScoreInput').max = String(total);
      $('#teacherScoreInput').value = submission.teacher_score != null ? String(submission.teacher_score) : '';
      $('#teacherScoreInput').placeholder = `Enter a score from 0 to ${total}`;
      $('#teacherFeedbackInput').value = submission.feedback || '';
      if ($('#teacherFeedbackPreset')) $('#teacherFeedbackPreset').value = '';
      const links = await signedLinks('mathside-submission-proofs', submissionOutputPaths(submission), 1800);
      const wrap = $('#reviewProofWrap');
      if ($('#reviewProofLabel')) $('#reviewProofLabel').textContent = 'PERFORMANCE TASK OUTPUT';
      $('#reviewProofLinks').innerHTML = links.map((x,i)=>`<a class="btn btn-light" href="${esc(x.url)}" target="_blank" rel="noopener">Open output picture ${i+1}</a>`).join('');
      wrap.hidden = !links.length;
      const allowAgainBtn = $('#allowResubmissionBtn');
      if (allowAgainBtn) {
        allowAgainBtn.hidden = !a.allow_resubmission;
        allowAgainBtn.disabled = Boolean(submission.resubmit_allowed);
        allowAgainBtn.textContent = submission.resubmit_allowed ? 'Resubmission already allowed' : 'Allow student to submit again';
      }
      openDialog('reviewSubmissionModal');
    });
  };

  // ---------------------------------------------------------------
  // STUDENT PERFORMANCE TASKS
  // ---------------------------------------------------------------
  function performanceStatus(a) {
    const sub = submissionFor(a.id);
    if (sub) return { label: sub.status === 'graded' ? 'Graded' : 'Submitted', cls: sub.status === 'graded' ? 'graded' : 'submitted' };
    if (a.status === 'archived') return { label:'Archived', cls:'archived' };
    if (a.due_at && new Date(a.due_at).getTime() < Date.now()) return { label:'Missed', cls:'missed' };
    return { label:'To do', cls:'not-started' };
  }

  function renderStudentPerformanceTasks() {
    const list = $('#studentPerformanceList'); if (!list) return;
    const tasks = performanceTasks().filter(a => a.status === 'published' || a.status === 'archived').sort((a,b)=>(a.due_at?new Date(a.due_at).getTime():Infinity)-(b.due_at?new Date(b.due_at).getTime():Infinity));
    if (!tasks.length) { list.innerHTML = '<div class="v8-empty"><b>No performance tasks yet.</b>Your teacher’s performance tasks will appear here once posted.</div>'; return; }
    list.innerHTML = tasks.map(a => {
      const sub = submissionFor(a.id), st = performanceStatus(a), due = a.due_at ? `Due ${formatDeadlineDate(a.due_at)}` : 'No due date';
      const canNewAttempt = !sub || Boolean(sub.resubmit_allowed);
      const primary = sub ? `<button type="button" class="v8-view-button" data-preview-response="${esc(sub.id)}">View</button>` : `<button type="button" class="v8-view-button" data-submit-performance="${esc(a.id)}">Open</button>`;
      const retry = sub && canNewAttempt && a.status !== 'archived' ? `<button type="button" class="v8-resubmit" data-submit-performance="${esc(a.id)}">Submit new attempt</button>` : '';
      return `<article class="v8-activity-row performance-student-row ${a.status==='archived'?'is-archived':''}"><span class="v8-task-icon orange">▣</span><div class="v8-task-title"><b>${esc(a.title)}</b><small>${esc(sectionLabel(sectionById(a.section_id)))} · ${Number(a.max_points||0)} pts</small></div><span class="v8-due"><span>${esc(due)}</span></span><span class="v8-status ${st.cls}">${st.label}</span>${primary}${retry}</article>`;
    }).join('');
  }
  window.renderStudentPerformanceTasks = renderStudentPerformanceTasks;

  showStudentPanel = function(panel='overview') {
    const allowed = new Set(['overview','activities','performance','grades','todo','calendar','feedback','account']);
    activeStudentPanel = allowed.has(panel) ? panel : 'overview';
    $$('[data-student-panel-view]').forEach(view => { const active = view.dataset.studentPanelView === activeStudentPanel; view.hidden = !active; view.classList.toggle('active', active); });
    $$('[data-student-panel]').forEach(btn => btn.classList.toggle('active', btn.dataset.studentPanel === activeStudentPanel));
    if (activeStudentPanel === 'activities') renderStudentAssignments();
    if (activeStudentPanel === 'performance') renderStudentPerformanceTasks();
    if (activeStudentPanel === 'grades') renderStudentGrades();
    if (activeStudentPanel === 'account') renderStudentAccount();
    window.MathsideV10?.renderStudentPanel?.(activeStudentPanel);
    window.MathsideStudent?.syncPanel();
  };

  async function openStudentPerformanceTask(id) {
    const a = assignmentById(id); if (!a || !isPerformanceTask(a)) return;
    activePerformanceTaskId = id;
    $('#performanceStudentTitle').textContent = a.title;
    $('#performanceStudentInstructions').textContent = a.instructions || '';
    $('#performanceStudentMeta').innerHTML = `<span class="meta-chip">${esc(sectionLabel(sectionById(a.section_id)))}</span><span class="meta-chip">${Number(a.max_points||0)} pts</span>${a.due_at?`<span class="meta-chip">Due ${esc(formatDeadlineDate(a.due_at))}</span>`:''}`;
    const pictures = await signedLinks('mathside-assignment-images', assignmentTaskImages(a), 1800);
    $('#performanceStudentPictures').innerHTML = pictures.map((x,i)=>`<a href="${esc(x.url)}" target="_blank" rel="noopener"><img src="${esc(x.url)}" alt="Performance task picture ${i+1}"></a>`).join('');
    if (a.rubric_path) {
      const url = await signedUrl('mathside-assignment-images', a.rubric_path, 1800);
      $('#performanceStudentRubric').innerHTML = url ? `<p class="eyebrow">RUBRIC</p><a class="btn btn-light" href="${esc(url)}" target="_blank" rel="noopener">Open rubric</a>` : '';
    } else $('#performanceStudentRubric').innerHTML = '<p class="muted">No rubric file was attached.</p>';
    const existing = submissionFor(a.id), oldPaths = submissionOutputPaths(existing);
    $('#performanceOutputImages').value = '';
    const submitBtn = $('#performanceSubmitForm button[type="submit"]');
    const allowed = a.status !== 'archived' && (!existing || existing.resubmit_allowed);
    if (submitBtn) { submitBtn.disabled = !allowed; submitBtn.textContent = a.status === 'archived' ? 'Archived' : existing && !existing.resubmit_allowed ? 'Waiting for teacher approval' : 'Submit performance task'; }
    $('#performanceOutputHint').textContent = a.status === 'archived' ? 'This performance task is archived. You can view it, but you cannot upload a new output.' : existing && !existing.resubmit_allowed ? `You already submitted ${oldPaths.length} picture${oldPaths.length===1?'':'s'}. Ask your teacher to allow another attempt.` : existing ? `You already submitted ${oldPaths.length} picture${oldPaths.length===1?'':'s'}. Upload a new set for your approved attempt.` : 'Upload one or more clear pictures of your output.';
    openDialog('performanceSubmitModal');
  }

  document.addEventListener('click', event => {
    const btn = event.target.closest('[data-submit-performance]');
    if (btn) { event.preventDefault(); openStudentPerformanceTask(btn.dataset.submitPerformance); }
  }, true);

  document.addEventListener('click', event => {
    const btn = event.target.closest('[data-answer-assignment]'); if (!btn) return;
    const a = assignmentById(btn.dataset.answerAssignment); if (!isPerformanceTask(a)) return;
    event.preventDefault(); event.stopImmediatePropagation(); openStudentPerformanceTask(a.id);
  }, true);

  $('#performanceSubmitForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!requireSupabase() || state.profile?.role !== 'student') return;
    const a = assignmentById(activePerformanceTaskId); if (!a) return;
    const existing = submissionFor(a.id);
    if (a.status === 'archived') return toast('This performance task has been archived.', 'orange');
    if (existing && !existing.resubmit_allowed) return toast('Your teacher must allow another attempt before you can resubmit.', 'orange');
    const files = [...($('#performanceOutputImages')?.files || [])];
    if (!files.length) return toast('Upload at least one picture of your output.', 'orange');
    if (files.length > 10) return toast('Choose up to 10 output pictures.', 'orange');
    if (files.some(f => !String(f.type||'').startsWith('image/'))) return toast('Performance task outputs must be image files.', 'orange');
    const oldPaths = submissionOutputPaths(existing), newPaths = [];
    try {
      await withLoading('Submitting performance task…','Uploading your output pictures and saving your submission.', async () => {
        for (let i=0; i<files.length; i+=1) {
          const f = files[i], path = `${state.user.id}/${a.id}/${Date.now()}-${i+1}-${safeFileName(f.name)}`;
          const up = await db.storage.from('mathside-submission-proofs').upload(path, f, {upsert:false});
          if (up.error) throw up.error;
          newPaths.push(path);
        }
        const { error } = await db.rpc('mathside_submit_work', { p_assignment_id:a.id, p_answers:[], p_proof_paths:newPaths });
        if (error) throw error;
        if (oldPaths.length) await removeStoragePaths('mathside-submission-proofs', oldPaths);
        closeDialog('performanceSubmitModal'); await refreshStudent(); showStudentPanel('performance');
      });
      toast('Performance task submitted.', 'success');
    } catch (error) {
      console.error(error); if (newPaths.length) await removeStoragePaths('mathside-submission-proofs', newPaths);
      toast(error.message || 'Could not submit the performance task.', 'orange');
    }
  });

  openStudentResponsePreview = async function(submissionId) {
    const submission = state.submissions.find(s=>s.id===submissionId), a = assignmentById(submission?.assignment_id);
    if (!submission || !isPerformanceTask(a)) return originalOpenStudentResponsePreview(submissionId);
    const total = totalPoints(a.id), graded = submission.status === 'graded' && submission.teacher_score != null, score = graded ? Number(submission.teacher_score) : null;
    $('#studentResponseTitle').textContent = a.title;
    $('#studentResponseMeta').textContent = `${sectionLabel(sectionById(a.section_id))} · Performance Task · Submitted ${formatStudentDate(submission.submitted_at)||''} · Attempt ${Number(submission.attempt_count||1)}`;
    $('#studentResponseScore').innerHTML = `<div><span>${graded?'Teacher score':'Status'}</span><b>${graded?`${score}<small>/ ${total}</small>`:'Awaiting review'}</b></div><span class="student-status ${graded?'status-graded':'status-submitted'}">${graded?'Graded':'Submitted'}</span>`;
    $('#studentResponseAnswers').innerHTML = `<article class="answer-question student-preview-answer"><p class="eyebrow">PERFORMANCE TASK</p><p>${esc(a.instructions||'')}</p></article>`;
    const links = await signedLinks('mathside-submission-proofs', submissionOutputPaths(submission), 1800);
    $('#studentResponseProofLabel').textContent = 'MY OUTPUT PICTURES';
    $('#studentResponseProofLinks').innerHTML = links.map((x,i)=>`<a class="btn btn-light" href="${esc(x.url)}" target="_blank" rel="noopener">Open output picture ${i+1}</a>`).join('');
    $('#studentResponseProofWrap').hidden = !links.length;
    const feedback = $('#studentResponseFeedback');
    if (submission.feedback) { feedback.innerHTML = `<p class="eyebrow">TEACHER FEEDBACK</p><p>${esc(submission.feedback)}</p>`; feedback.hidden = false; }
    else feedback.hidden = true;
    openDialog('studentResponseModal');
  };

  // Initial correction after the script loads.
  submissionSort = 'newest';
  if ($('#submissionSort')) $('#submissionSort').value = 'newest';
  setTimeout(() => {
    if (state.profile?.role === 'teacher') renderTeacher();
    if (state.profile?.role === 'student') renderStudentPerformanceTasks();
  }, 0);

  window.MathsidePerformanceTasks = { renderPerformanceTasks, renderStudentPerformanceTasks, openPerformanceTaskModal };
})();
