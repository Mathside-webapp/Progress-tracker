/* Mathside V10 classroom features: To-Do, Calendar, Feedback Inbox,
   Draft Saving, Notifications, Resubmission controls, and Class Record export.
   Attendance and private messaging are intentionally not included. */
(() => {
  'use strict';

  const feature = {
    calendarCursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    draftTimer: null,
    notifications: [],
    notificationCleanupDone: false,
    pollTimer: null
  };

  const safeDate = value => {
    const d = value ? new Date(value) : null;
    return d && Number.isFinite(d.getTime()) ? d : null;
  };
  const dayKey = value => {
    const d = safeDate(value);
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const formatFullDate = value => {
    const d = safeDate(value);
    return d ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(d) : 'No date';
  };
  const formatDateTime = value => {
    const d = safeDate(value);
    return d ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d) : '';
  };
  const relativeDue = value => {
    const d = safeDate(value);
    if (!d) return { label: 'No deadline', key: 'none' };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((target - today) / 86400000);
    if (days < 0) return { label: `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`, key: 'overdue' };
    if (days === 0) return { label: 'Due today', key: 'today' };
    if (days === 1) return { label: 'Due tomorrow', key: 'soon' };
    if (days <= 7) return { label: `Due in ${days} days`, key: 'soon' };
    return { label: `Due ${formatFullDate(d)}`, key: 'later' };
  };
  const currentUserId = () => state.user?.id || null;
  const connected = () => Boolean(db && currentUserId());
  const studentAssignments = () => state.assignments.filter(a => a.status === 'published');
  const todoAssignments = () => studentAssignments().filter(a => !submissionFor(a.id));

  function setBadge(id, count) {
    const node = document.getElementById(id);
    if (!node) return;
    const n = Math.max(0, Number(count || 0));
    node.textContent = n > 99 ? '99+' : String(n);
    node.hidden = n === 0;
  }

  function featureEmpty(title, copy = '') {
    return `<div class="v10-feature-empty"><b>${esc(title)}</b>${copy ? `<span>${esc(copy)}</span>` : ''}</div>`;
  }

  // ------------------------------------------------------------------
  // STUDENT TO-DO
  // ------------------------------------------------------------------
  function renderTodo() {
    const list = document.getElementById('studentTodoList');
    const summary = document.getElementById('studentTodoSummary');
    if (!list || !summary) return;
    const pending = todoAssignments().sort((a, b) => {
      const ad = safeDate(a.due_at)?.getTime() ?? Infinity;
      const bd = safeDate(b.due_at)?.getTime() ?? Infinity;
      return ad - bd || new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
    const overdue = pending.filter(a => safeDate(a.due_at) && safeDate(a.due_at).getTime() < Date.now()).length;
    const dueWeek = pending.filter(a => {
      const d = safeDate(a.due_at);
      return d && d.getTime() >= Date.now() && d.getTime() <= Date.now() + 7 * 86400000;
    }).length;
    summary.innerHTML = `<article><b>${pending.length}</b><span>To do</span></article><article><b>${overdue}</b><span>Overdue</span></article><article><b>${dueWeek}</b><span>Due this week</span></article>`;
    setBadge('studentTodoNavBadge', pending.length);
    if (!pending.length) {
      list.innerHTML = featureEmpty('You’re all caught up!', 'No unfinished activities right now.');
      return;
    }
    list.innerHTML = pending.map(a => {
      const due = relativeDue(a.due_at);
      const section = sectionById(a.section_id);
      return `<article class="v10-todo-card ${due.key}">
        <div class="v10-todo-check" aria-hidden="true">✓</div>
        <div class="v10-todo-copy"><span>${esc(sectionLabel(section))}</span><h3>${esc(a.title)}</h3><p>${esc(a.instructions || 'Open this activity to continue working.')}</p></div>
        <div class="v10-todo-meta"><span class="v10-due-chip ${due.key}">${esc(due.label)}</span><button class="v8-view-button" type="button" data-answer-assignment="${esc(a.id)}">Open</button></div>
      </article>`;
    }).join('');
  }

  // ------------------------------------------------------------------
  // STUDENT CALENDAR
  // ------------------------------------------------------------------
  function renderCalendar() {
    const grid = document.getElementById('studentCalendarGrid');
    const label = document.getElementById('calendarMonthLabel');
    const agenda = document.getElementById('studentCalendarAgenda');
    if (!grid || !label || !agenda) return;
    const cursor = feature.calendarCursor;
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    label.textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(cursor);
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevDays = first.getDay();
    const assignments = studentAssignments().filter(a => {
      const d = safeDate(a.due_at);
      return d && d.getFullYear() === year && d.getMonth() === month;
    });
    const byDay = new Map();
    assignments.forEach(a => {
      const key = dayKey(a.due_at);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(a);
    });
    const cells = [];
    for (let i = 0; i < prevDays; i += 1) cells.push('<div class="v10-calendar-day is-outside" aria-hidden="true"></div>');
    const today = dayKey(new Date());
    for (let day = 1; day <= daysInMonth; day += 1) {
      const d = new Date(year, month, day);
      const key = dayKey(d);
      const tasks = byDay.get(key) || [];
      cells.push(`<button type="button" class="v10-calendar-day ${key === today ? 'is-today' : ''} ${tasks.length ? 'has-task' : ''}" data-calendar-day="${key}"><span>${day}</span>${tasks.slice(0, 3).map(a => `<i title="${esc(a.title)}"></i>`).join('')}${tasks.length > 3 ? `<small>+${tasks.length - 3}</small>` : ''}</button>`);
    }
    grid.innerHTML = cells.join('');
    if (!assignments.length) {
      agenda.innerHTML = featureEmpty('No deadlines this month.', 'Assignments with deadlines will appear here.');
      return;
    }
    agenda.innerHTML = assignments.sort((a,b) => new Date(a.due_at) - new Date(b.due_at)).map(a => {
      const submitted = submissionFor(a.id);
      return `<article class="v10-agenda-row" data-calendar-agenda="${dayKey(a.due_at)}"><time>${esc(formatFullDate(a.due_at))}</time><div><b>${esc(a.title)}</b><span>${esc(sectionLabel(sectionById(a.section_id)))}</span></div><span class="v10-agenda-status ${submitted ? 'done' : ''}">${submitted ? 'Submitted' : relativeDue(a.due_at).label}</span><button type="button" class="v8-view-button" ${submitted ? `data-preview-response="${esc(submitted.id)}"` : `data-answer-assignment="${esc(a.id)}"`}>View</button></article>`;
    }).join('');
  }

  // ------------------------------------------------------------------
  // FEEDBACK INBOX
  // ------------------------------------------------------------------
  function renderFeedbackInbox() {
    const box = document.getElementById('studentFeedbackInbox');
    if (!box) return;
    const graded = state.submissions
      .filter(s => s.student_id === currentUserId() && s.status === 'graded')
      .sort((a,b) => new Date(b.graded_at || b.updated_at || b.submitted_at || 0) - new Date(a.graded_at || a.updated_at || a.submitted_at || 0));
    if (!graded.length) {
      box.innerHTML = featureEmpty('No teacher feedback yet.', 'Reviewed activities and teacher comments will appear here.');
      return;
    }
    box.innerHTML = graded.map(s => {
      const a = assignmentById(s.assignment_id);
      const total = a ? totalPoints(a.id) : 0;
      const raw = Number(s.teacher_score ?? s.auto_score ?? 0);
      const pct = total > 0 ? Math.round(raw / total * 100) : null;
      return `<article class="v10-feedback-card">
        <div class="v10-feedback-icon">✓</div>
        <div class="v10-feedback-main"><span>${esc(sectionLabel(sectionById(a?.section_id)))}</span><h3>${esc(a?.title || 'Reviewed activity')}</h3><p>${esc(s.feedback || 'Your teacher reviewed this activity.')}</p><time>${esc(formatDateTime(s.graded_at || s.updated_at || s.submitted_at))}</time></div>
        <div class="v10-feedback-score"><b>${pct === null ? '—' : `${pct}%`}</b><span>${raw}/${total}</span><button class="v8-view-button" type="button" data-preview-response="${esc(s.id)}">View response</button></div>
      </article>`;
    }).join('');
  }

  // ------------------------------------------------------------------
  // DRAFT SAVING
  // ------------------------------------------------------------------
  function collectDraftAnswers(assignment) {
    return questionsFor(assignment.id).map(q => ({
      question_id: q.id,
      answer: q.question_type === 'mcq'
        ? (document.querySelector(`input[name="answer_${q.id}"]:checked`)?.value || '')
        : (document.querySelector(`[name="answer_${q.id}"]`)?.value || '')
    }));
  }

  function applyDraftAnswers(assignment, answers = []) {
    const map = new Map((Array.isArray(answers) ? answers : []).map(row => [row.question_id, row.answer ?? '']));
    questionsFor(assignment.id).forEach(q => {
      const value = map.get(q.id);
      if (value == null) return;
      if (q.question_type === 'mcq') {
        const options = [...document.querySelectorAll(`input[name="answer_${q.id}"]`)];
        const match = options.find(input => input.value === value);
        if (match) match.checked = true;
      } else {
        const input = document.querySelector(`[name="answer_${q.id}"]`);
        if (input) input.value = value;
      }
    });
  }

  async function saveDraft() {
    if (!connected() || state.profile?.role !== 'student' || !activeStudentAssignment) return;
    const status = document.getElementById('studentDraftStatus');
    const answers = collectDraftAnswers(activeStudentAssignment);
    if (status) status.textContent = 'Saving draft…';
    const { error } = await db.from('mathside_assignment_drafts').upsert({
      student_id: currentUserId(),
      assignment_id: activeStudentAssignment.id,
      answers,
      updated_at: new Date().toISOString()
    }, { onConflict: 'student_id,assignment_id' });
    if (error) {
      console.warn('Draft save failed:', error.message || error);
      if (status) status.textContent = 'Draft could not be saved. Check your connection.';
      return;
    }
    if (status) status.textContent = `Draft saved ${new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date())}`;
  }

  function queueDraftSave() {
    clearTimeout(feature.draftTimer);
    feature.draftTimer = setTimeout(() => saveDraft().catch(() => {}), 650);
  }

  async function prepareAnswerDraft(assignment) {
    if (!connected() || state.profile?.role !== 'student' || !assignment) return;
    const status = document.getElementById('studentDraftStatus');
    if (status) status.textContent = 'Loading saved draft…';
    const { data, error } = await db.from('mathside_assignment_drafts')
      .select('answers,updated_at')
      .eq('student_id', currentUserId())
      .eq('assignment_id', assignment.id)
      .maybeSingle();
    if (!error && data?.answers) {
      applyDraftAnswers(assignment, data.answers);
      if (status) status.textContent = `Draft restored from ${formatDateTime(data.updated_at)}.`;
      return;
    }
    const existing = submissionFor(assignment.id);
    if (existing && assignment.allow_resubmission) {
      const previousAnswers = state.submissionAnswers
        .filter(row => row.submission_id === existing.id)
        .map(row => ({ question_id: row.question_id, answer: row.answer_text || '' }));
      applyDraftAnswers(assignment, previousAnswers);
      if (status) status.textContent = 'Previous submission loaded for your new attempt.';
      return;
    }
    if (status) status.textContent = 'Draft saving is ready.';
  }

  async function clearDraft(assignmentId) {
    if (!connected() || !assignmentId) return;
    await db.from('mathside_assignment_drafts')
      .delete()
      .eq('student_id', currentUserId())
      .eq('assignment_id', assignmentId);
  }

  document.getElementById('answerForm')?.addEventListener('input', queueDraftSave);
  document.getElementById('answerForm')?.addEventListener('change', event => {
    if (event.target?.id === 'studentSolutionImage') return;
    queueDraftSave();
  });


  // ------------------------------------------------------------------
  // NOTIFICATIONS CENTER
  // ------------------------------------------------------------------
  function ensureNotificationDialog() {
    if (document.getElementById('v10NotificationDialog')) return;
    document.body.insertAdjacentHTML('beforeend', `<dialog id="v10NotificationDialog" class="modal v10-notification-dialog"><div class="modal-box v10-notification-box"><button class="modal-close" type="button" id="v10NotificationClose" aria-label="Close">×</button><div class="v10-notification-title"><div><p class="eyebrow">MATHSIDE UPDATES</p><h2>Notifications</h2></div><button type="button" class="btn btn-light btn-small" id="v10MarkAllRead">Mark all read</button></div><div id="v10NotificationList" class="v10-notification-list"></div></div></dialog>`);
    document.getElementById('v10NotificationClose')?.addEventListener('click', () => document.getElementById('v10NotificationDialog')?.close());
    document.getElementById('v10MarkAllRead')?.addEventListener('click', async () => {
      if (!connected()) return;
      await db.rpc('mathside_mark_notifications_read', { p_ids: null });
      await refreshNotifications();
    });
    document.getElementById('v10NotificationList')?.addEventListener('click', async event => {
      const btn = event.target.closest('[data-notification-id]');
      if (!btn) return;
      const note = feature.notifications.find(n => n.id === btn.dataset.notificationId);
      if (!note) return;
      await db.rpc('mathside_mark_notifications_read', { p_ids: [note.id] });
      document.getElementById('v10NotificationDialog')?.close();
      await refreshNotifications();
      routeNotification(note);
    });
  }

  function notificationIcon(type) {
    if (type === 'feedback') return '✓';
    if (type === 'submission') return '↥';
    return '●';
  }

  function renderNotifications() {
    const box = document.getElementById('v10NotificationList');
    const unread = feature.notifications.filter(n => !n.read_at);
    setBadge('teacherNotificationBadge', state.profile?.role === 'teacher' ? unread.length : 0);
    setBadge('studentNotificationBadge', state.profile?.role === 'student' ? unread.length : 0);
    setBadge('studentFeedbackNavBadge', state.profile?.role === 'student' ? unread.filter(n => n.type === 'feedback').length : 0);
    if (!box) return;
    box.innerHTML = feature.notifications.length ? feature.notifications.map(n => `<button type="button" class="v10-notification-row ${n.read_at ? '' : 'unread'}" data-notification-id="${esc(n.id)}"><span class="v10-notification-kind">${notificationIcon(n.type)}</span><span><b>${esc(n.title || 'Mathside update')}</b><small>${esc(n.body || '')}</small><time>${esc(formatDateTime(n.created_at))}</time></span>${n.read_at ? '' : '<i></i>'}</button>`).join('') : featureEmpty('You’re all caught up.', 'New class updates will appear here.');
  }

  async function refreshNotifications() {
    if (!connected()) return;

    // Notifications are retained for seven days only. The RPC removes expired
    // database rows; the date filter also guarantees that an expired item never
    // appears in the UI while an older deployment is being upgraded.
    if (!feature.notificationCleanupDone) {
      const { error: cleanupError } = await db.rpc('mathside_cleanup_old_notifications');
      if (cleanupError && !String(cleanupError.message || '').toLowerCase().includes('could not find')) {
        console.warn('Notification cleanup:', cleanupError.message || cleanupError);
      }
      feature.notificationCleanupDone = true;
    }
    const retentionCutoff = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString();
    const { data, error } = await db.from('mathside_notifications')
      .select('*')
      .eq('user_id', currentUserId())
      .gte('created_at', retentionCutoff)
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) {
      console.warn('Notifications not ready:', error.message || error);
      return;
    }
    feature.notifications = data || [];
    renderNotifications();
  }

  async function openNotifications() {
    ensureNotificationDialog();
    await refreshNotifications();
    const dialog = document.getElementById('v10NotificationDialog');
    if (dialog && !dialog.open) dialog.showModal();
  }

  function routeNotification(note) {
    if (state.profile?.role === 'student') {
      if (note.type === 'feedback') showStudentPanel('feedback');
      else showStudentPanel('todo');
    } else if (state.profile?.role === 'teacher') {
      showTeacherView('submissions');
    }
  }

  document.getElementById('teacherNotificationBtn')?.addEventListener('click', openNotifications);
  document.getElementById('studentNotificationBtn')?.addEventListener('click', openNotifications);

  // ------------------------------------------------------------------
  // EXPORT CLASS RECORD
  // ------------------------------------------------------------------
  function safeFilename(value) {
    return String(value || 'class').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'class';
  }

  function exportClassRecord() {
    if (!window.XLSX) return toast('Excel export library is not available.', 'orange', 'Export unavailable');
    const section = sectionById(activeRosterSectionId);
    if (!section) return toast('Open a class roster first.', 'orange', 'Choose a class');
    const students = studentsForSection(section.id).slice().sort((a,b) => String(a.display_name || '').localeCompare(String(b.display_name || '')));
    const assignments = state.assignments
      .filter(a => a.section_id === section.id && a.status === 'published')
      .sort((a,b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    const title = `Mathside Class Record — ${section.name}`;
    const headers = ['Student Name', 'Gender', 'Username', 'Submitted / Assigned', ...assignments.map(a => `${a.title} (${totalPoints(a.id)} pts)`), 'Average % (submitted)'];
    const rows = students.map(student => {
      const values = [];
      let earned = 0;
      let possible = 0;
      let submittedCount = 0;
      assignments.forEach(a => {
        const sub = state.submissions.find(s => s.assignment_id === a.id && s.student_id === student.id);
        if (!sub) { values.push(''); return; }
        submittedCount += 1;
        const score = Number(sub.status === 'graded' ? (sub.teacher_score ?? sub.auto_score ?? 0) : (sub.auto_score ?? 0));
        const total = Number(totalPoints(a.id) || 0);
        earned += score;
        possible += total;
        values.push(score);
      });
      const average = possible > 0 ? Math.round((earned / possible) * 10000) / 100 : '';
      return [student.display_name || '', student.gender || '', student.username || '', `${submittedCount}/${assignments.length}`, ...values, average];
    });
    const data = [
      [title],
      [`Grade ${section.grade_level}`, `Teacher: ${state.profile?.display_name || 'Teacher'}`, `Exported: ${new Date().toLocaleString()}`],
      [],
      headers,
      ...rows
    ];
    const workbook = XLSX.utils.book_new();
    const recordSheet = XLSX.utils.aoa_to_sheet(data);
    recordSheet['!cols'] = [{wch:28},{wch:14},{wch:22},{wch:20}, ...assignments.map(() => ({wch:22})), {wch:24}];
    XLSX.utils.book_append_sheet(workbook, recordSheet, 'Class Record');
    const assignmentSheet = XLSX.utils.aoa_to_sheet([
      ['Assignment', 'Maximum Points', 'Deadline', 'Resubmission'],
      ...assignments.map(a => [a.title, totalPoints(a.id), a.due_at ? formatFullDate(a.due_at) : 'No deadline', a.allow_resubmission ? 'Allowed' : 'Not allowed'])
    ]);
    assignmentSheet['!cols'] = [{wch:36},{wch:18},{wch:22},{wch:18}];
    XLSX.utils.book_append_sheet(workbook, assignmentSheet, 'Assignments');
    XLSX.writeFile(workbook, `Mathside-${safeFilename(section.name)}-Grade-${section.grade_level}-Class-Record.xlsx`);
    toast('Class record exported to Excel.', 'success', 'Export complete');
  }
  document.getElementById('exportClassRecordBtn')?.addEventListener('click', exportClassRecord);

  // ------------------------------------------------------------------
  // PANEL HOOKS + CALENDAR CONTROLS
  // ------------------------------------------------------------------
  document.getElementById('calendarPrevBtn')?.addEventListener('click', () => {
    feature.calendarCursor = new Date(feature.calendarCursor.getFullYear(), feature.calendarCursor.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById('calendarNextBtn')?.addEventListener('click', () => {
    feature.calendarCursor = new Date(feature.calendarCursor.getFullYear(), feature.calendarCursor.getMonth() + 1, 1);
    renderCalendar();
  });
  document.getElementById('studentCalendarGrid')?.addEventListener('click', event => {
    const cell = event.target.closest('[data-calendar-day]');
    if (!cell) return;
    const match = studentAssignments().filter(a => dayKey(a.due_at) === cell.dataset.calendarDay);
    if (!match.length) return;
    const agenda = document.getElementById('studentCalendarAgenda');
    agenda?.querySelector(`[data-calendar-agenda="${cell.dataset.calendarDay}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  async function renderStudentPanel(panel) {
    if (state.profile?.role !== 'student') return;
    renderTodo();
    if (panel === 'calendar') renderCalendar();
    if (panel === 'feedback') renderFeedbackInbox();
    refreshNotifications();
  }

  async function renderTeacherView() {
    if (state.profile?.role !== 'teacher') return;
    refreshNotifications();
  }

  async function syncWorkspace() {
    if (!connected() || !state.profile) return;
    ensureNotificationDialog();
    if (state.profile.role === 'student') {
      renderTodo();
      renderCalendar();
      renderFeedbackInbox();
    }
    await refreshNotifications();
  }

  const teacherApp = document.getElementById('teacherApp');
  const studentApp = document.getElementById('studentApp');
  if (teacherApp) new MutationObserver(syncWorkspace).observe(teacherApp, { attributes: true, attributeFilter: ['hidden'] });
  if (studentApp) new MutationObserver(syncWorkspace).observe(studentApp, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('focus', () => syncWorkspace().catch(() => {}));
  feature.pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && connected() && state.profile) refreshNotifications().catch(() => {});
  }, 45000);

  window.MathsideV10 = {
    renderStudentPanel,
    renderTeacherView,
    prepareAnswerDraft,
    clearDraft,
    refreshNotifications,
    exportClassRecord
  };

  // Initial render for sessions restored before this script loaded.
  setTimeout(() => syncWorkspace().catch(() => {}), 0);
})();
