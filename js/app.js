(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const Store = window.GradeDockStore;

  const state = {
    user: null,
    classes: [],
    exams: [],
    students: [],
    results: [],
    scan: null,
    scanImageBlob: null,
    currentPage: 'dashboard'
  };

  let cameraAssistTimer = null;
  let cameraAssistBusy = false;
  let cameraAssistLastState = '';

  const subtitles = {
    dashboard: 'Overview of your classes and assessments',
    classes: 'Organize grade levels and sections',
    exams: 'Create assessments, keys, and downloadable answer sheets',
    scan: 'Choose a section, then capture or upload an answer sheet',
    results: 'Review scores organized by section/class',
    analytics: 'See performance patterns across assessments',
    archives: 'Archived classes and exams can be restored anytime',
    settings: 'Profile, connection, and scanning preferences'
  };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  function classLabel(c) {
    if (!c) return 'Unassigned';
    return c.section || c.name || 'Section';
  }

  function resultClassLabel(r) {
    if (r.class_name) return r.class_name;
    return classLabel(state.classes.find(c => c.id === r.class_id));
  }

  function examTitle(id) {
    return state.exams.find(e => e.id === id)?.title || 'Exam';
  }

  function toast(message, type = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    $('#toastHost').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  function modal(html) {
    $('#modalHost').innerHTML = `<div class="modal-backdrop"><div class="modal-card" role="dialog" aria-modal="true" aria-label="GradeDock dialog" tabindex="-1">${html}</div></div>`;
    $('.modal-backdrop').addEventListener('click', e => {
      // Close only with explicit dialog buttons.
    });
    $$('[data-close-modal]').forEach(b => b.onclick = closeModal);
    $('.modal-card')?.focus();
  }

  function closeModal() { $('#modalHost').innerHTML = ''; }

  function processModal(title, message, icon = 'GD') {
    $('#modalHost').innerHTML = `<div class="modal-backdrop process-backdrop"><div class="modal-card process-card" role="status" aria-live="polite">
      <div class="process-animation"><span class="process-logo">${esc(icon)}</span><i></i><i></i><i></i></div>
      <h3>${esc(title)}</h3><p>${esc(message)}</p>
    </div></div>`;
  }

  function successModal(title, message, detail = '', buttonLabel = 'Done', onDone = null) {
    modal(`<div class="success-process-card">
      <div class="success-checkmark">✓</div>
      <span class="kicker">GRADEDock</span>
      <h3>${esc(title)}</h3><p>${esc(message)}</p>
      ${detail ? `<div class="success-process-detail">${esc(detail)}</div>` : ''}
      <div class="modal-actions"><button type="button" id="successProcessDone" class="btn btn-primary">${esc(buttonLabel)}</button></div>
    </div>`);
    $('#successProcessDone').onclick = () => { closeModal(); if (typeof onDone === 'function') onDone(); };
  }

  function go(page) {
    if (page !== 'scan' && state.currentPage === 'scan') {
      stopCameraAssist();
      window.GradeDockScanner?.stopCamera?.($('#cameraVideo'));
      $('#cameraPlaceholder')?.classList.remove('hidden');
      if ($('#captureBtn')) $('#captureBtn').disabled = true;
    }
    state.currentPage = page;
    $$('.page').forEach(x => x.classList.remove('active'));
    $(`#page-${page}`).classList.add('active');
    $$('.nav-item[data-page]').forEach(x => x.classList.toggle('active', x.dataset.page === page));
    $('#pageTitle').textContent = page[0].toUpperCase() + page.slice(1);
    $('#pageSubtitle').textContent = subtitles[page] || '';
    $('#sidebar').classList.remove('open');
    if (page === 'scan') populateScanSelectors();
  }

  async function refresh() {
    state.user = await Store.user();
    state.classes = await Store.classes();
    state.exams = await Store.exams();
    state.students = await Store.students();
    state.results = await Store.results();
    renderAll();
  }

  function renderAll() {
    const u = state.user || {};
    $('#userName').textContent = u.full_name || 'Teacher';
    $('#userEmail').textContent = u.email || '';
    $('#userAvatar').textContent = (u.full_name || 'T')[0].toUpperCase();
    $('#welcomeTitle').textContent = `Good day, ${(u.full_name || 'Teacher').split(' ')[0]}.`;
    const modeBadge = $('#modeBadge');
    if (modeBadge) modeBadge.textContent = Store.demo ? 'Demo mode' : 'Supabase connected';
    renderDashboard();
    renderClasses();
    renderExams();
    renderArchives();
    renderResults();
    renderAnalytics();
    renderSettings();
    populateScanSelectors();
  }

  function emptyMini(heading, text) {
    return `<div class="empty-mini"><strong>${heading}</strong><span>${text}</span></div>`;
  }

  function renderDashboard() {
    const avg = state.results.length
      ? Math.round(state.results.reduce((a, b) => a + Number(b.percentage || 0), 0) / state.results.length)
      : 0;

    $('#statGrid').innerHTML = [
      ['Classes', state.classes.filter(c => !c.is_archived).length, '▦'],
      ['Exams', state.exams.filter(e => !e.is_archived).length, '▤'],
      ['Scanned papers', state.results.length, '⌗'],
      ['Average score', `${avg}%`, '↗']
    ].map(([label, value, icon]) => `
      <div class="stat-card"><span class="stat-icon">${icon}</span><div><small>${label}</small><strong>${value}</strong></div></div>
    `).join('');

    $('#recentExams').innerHTML = state.exams.filter(e => !e.is_archived).slice(0, 4).map(e => examRow(e, true)).join('') ||
      emptyMini('No exams yet', 'Create your first assessment.');

    $('#recentResults').innerHTML = state.results.slice(0, 5).map(r => `
      <div class="result-mini"><div><strong>${esc(r.student_name || 'Unnamed student')}</strong><small>${esc(examTitle(r.exam_id))} • ${esc(resultClassLabel(r))}</small></div><b>${r.score}/${r.total_items}</b></div>
    `).join('') || emptyMini('No results yet', 'Scan a paper to generate your first score.');
  }

  function renderClasses() {
    const q = ($('#classSearch')?.value || '').toLowerCase();
    const list = state.classes.filter(c => !c.is_archived).filter(c => `${classLabel(c)} ${c.grade_level || ''} ${c.school_year || ''}`.toLowerCase().includes(q));

    $('#classesGrid').innerHTML = list.map(c => {
      const scans = state.results.filter(r => r.class_id === c.id).length;
      const students = state.students.filter(s => s.class_id === c.id).length;
      return `
        <article class="class-card" data-class="${c.id}">
          <div class="class-color"></div>
          <label class="gd-select"><input type="checkbox" data-select-item="${c.id}" aria-label="Select ${esc(classLabel(c))}"> Select</label><span class="kicker">GRADE ${esc(c.grade_level || '—')}</span>
          <h3>${esc(classLabel(c))}</h3>
          <p>${esc(c.school_year || 'School year not set')}</p>
          <div class="class-meta"><span>${students} student${students === 1 ? '' : 's'}</span><span>${scans} result${scans === 1 ? '' : 's'}</span></div>
          <div class="gd-flex-buttons"><button class="btn btn-soft" data-open-class="${c.id}">Open class</button><button class="btn btn-soft" data-archive-class="${c.id}">Archive</button><button class="btn btn-danger" data-delete-class="${c.id}">Delete</button></div>
        </article>`;
    }).join('') || `<div class="empty-state"><span>▦</span><h4>No classes found</h4><p>Create a grade level and section to organize scan results.</p></div>`;

    $$('[data-open-class]').forEach(b => b.onclick = () => openClass(b.dataset.openClass));
    $$('[data-delete-class]').forEach(b => b.onclick = () => bulkAction('classes', [b.dataset.deleteClass], 'delete'));
    setupSelection('classesGrid','classes');
    $$('[data-archive-class]').forEach(b => b.onclick = () => archiveItem('classes', b.dataset.archiveClass));
  }

  function examRow(exam, compact = false) {
    const count = state.results.filter(r => r.exam_id === exam.id).length;
    const pdfLabel = compact ? '⇩ PDF' : '⇩ Answer Sheet PDF';
    const pngLabel = compact ? '⇩ PNG' : '⇩ Answer Sheet Image';
    const keyLabel = compact ? '✎ Key' : '✎ Set / Update Answer Key';
    const scanLabel = compact ? '⌗ Scan' : '⌗ Scan Papers';
    return `
      <div class="exam-row">
        ${compact ? '' : `<label class="gd-select"><input type="checkbox" data-select-item="${exam.id}" aria-label="Select ${esc(exam.title)}"> Select</label>`}<div class="exam-icon">${exam.question_count}</div>
        <div class="exam-main"><strong>${esc(exam.title)}</strong><small>${exam.question_count} items • A–${String.fromCharCode(64 + Number(exam.choice_count || 4))} • ${count} scan${count === 1 ? '' : 's'}</small></div>
        ${compact ? '' : '<span class="muted">Answer sheet available anytime</span>'}
        <div class="row-actions exam-actions">
          <button class="mini-action sheet-download-action" data-sheet-pdf="${exam.id}" title="Download scanner-ready answer sheet as PDF">${pdfLabel}</button>
          <button class="mini-action" data-sheet-png="${exam.id}" title="Download scanner-ready answer sheet as PNG image">${pngLabel}</button>
          <button class="mini-action" data-manage-key="${exam.id}" title="Enter, import, or replace the answer key">${keyLabel}</button>
          <button class="mini-action" data-scan-exam="${exam.id}" title="Scan this exam">${scanLabel}</button>
          ${compact ? '' : `<button class="mini-action" data-archive-exam="${exam.id}">Archive</button><button class="mini-action danger-action" data-delete-exam="${exam.id}" title="Delete this exam">Delete</button>`}
        </div>
      </div>`;
  }

  function bindExamRowActions() {
    $$('[data-sheet-pdf]').forEach(b => b.onclick = () => downloadSheetPdf(b.dataset.sheetPdf));
    $$('[data-sheet-png]').forEach(b => b.onclick = () => downloadSheetPng(b.dataset.sheetPng));
    $$('[data-manage-key]').forEach(b => b.onclick = () => manageExamKey(b.dataset.manageKey));
    $$('[data-delete-exam]').forEach(b => b.onclick = () => confirmDeleteExam(b.dataset.deleteExam));
    $$('[data-archive-exam]').forEach(b => b.onclick = () => archiveItem('exams', b.dataset.archiveExam));
    $$('[data-scan-exam]').forEach(b => b.onclick = () => {
      go('scan');
      $('#scanExam').value = b.dataset.scanExam;
      $('#scanStatusText').textContent = 'Choose the section that this paper belongs to, then scan it.';
    });
  }

  function renderExams() {
    const q = ($('#examSearch')?.value || '').toLowerCase();
    $('#examList').innerHTML = state.exams
      .filter(e => !e.is_archived)
      .filter(e => e.title.toLowerCase().includes(q))
      .map(e => examRow(e))
      .join('') || `<div class="empty-state"><span>▤</span><h4>No exams found</h4><p>Create an exam first to download its scanner-ready answer sheet. The correct answers can be added later.</p></div>`;
    bindExamRowActions();
    setupSelection('examList','exams');
  }

  function renderResults() {
    const classFilter = $('#resultClassFilter');
    const examFilter = $('#resultExamFilter');

    if (classFilter) {
      const current = classFilter.value;
      classFilter.innerHTML = '<option value="">All sections</option>' + state.classes.map(c =>
        `<option value="${c.id}">Grade ${esc(c.grade_level || '—')} • ${esc(classLabel(c))}</option>`
      ).join('');
      if (state.classes.some(c => c.id === current)) classFilter.value = current;
    }

    if (examFilter) {
      const current = examFilter.value;
      examFilter.innerHTML = '<option value="">All exams</option>' + state.exams.map(e =>
        `<option value="${e.id}">${esc(e.title)}</option>`
      ).join('');
      if (state.exams.some(e => e.id === current)) examFilter.value = current;
    }

    const filtered = state.results.filter(r =>
      (!classFilter?.value || r.class_id === classFilter.value) &&
      (!examFilter?.value || r.exam_id === examFilter.value)
    );

    const groups = new Map();
    filtered.forEach(r => {
      const key = r.class_id || 'unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });

    const order = [...state.classes.map(c => c.id), 'unassigned'];
    const html = order.filter(id => groups.has(id)).map(id => {
      const rows = groups.get(id);
      const cls = state.classes.find(c => c.id === id);
      const title = cls ? classLabel(cls) : 'Unassigned';
      const grade = cls?.grade_level ? `Grade ${cls.grade_level}` : 'Section';
      return `
        <section class="panel results-section">
          <div class="panel-head"><div><span class="kicker">${esc(grade)}</span><h3>${esc(title)}</h3><p>${rows.length} result${rows.length === 1 ? '' : 's'} in this section</p></div></div>
          <div class="table-wrap"><table><thead><tr><th>Student</th><th>Exam</th><th>Score</th><th>Percentage</th><th>Review</th><th>Date</th><th>Actions</th></tr></thead><tbody>
            ${rows.map(r => `<tr><td><strong>${esc(r.student_name || 'Unnamed student')}</strong></td><td>${esc(examTitle(r.exam_id))}</td><td><b>${r.score}/${r.total_items}</b></td><td>${r.percentage}%</td><td>${r.review_count ? `<span class="badge warn">${r.review_count} review</span>` : '<span class="badge good">Clear</span>'}</td><td>${new Date(r.created_at).toLocaleDateString()}</td><td><div class="result-actions"><button class="mini-action result-edit-btn" data-edit-result="${r.id}">Preview / Edit</button><button class="mini-action danger-action" data-delete-result="${r.id}">Delete</button></div></td></tr>`).join('')}
          </tbody></table></div>
        </section>`;
    }).join('');

    $('#resultsGroups').innerHTML = html || `<section class="panel"><div class="empty-state"><span>✓</span><h4>No results</h4><p>Scanned papers will be grouped here by section/class.</p></div></section>`;
    $$('[data-edit-result]').forEach(b => b.onclick = () => openResultEditor(b.dataset.editResult));
    $$('[data-delete-result]').forEach(b => b.onclick = () => openDeleteResult(b.dataset.deleteResult));
  }

  function openDeleteResult(resultId) {
    const result = state.results.find(r => r.id === resultId);
    if (!result) return;
    modal(`
      <div class="modal-head"><div><span class="kicker danger-text">DELETE RESULT</span><h3>${esc(result.student_name || 'Unnamed student')}</h3><p>${esc(examTitle(result.exam_id))} • ${esc(resultClassLabel(result))}</p></div><button class="icon-btn" data-close-modal>✕</button></div>
      <div class="delete-warning">This permanently deletes this student's saved score, answer details, and its stored scan image if one was saved.</div>
      <div class="modal-actions"><button type="button" class="btn btn-soft" data-close-modal>Cancel</button><button type="button" id="confirmDeleteResultBtn" class="btn btn-danger">Delete result</button></div>`);

    $('#confirmDeleteResultBtn').onclick = async () => {
      const btn = $('#confirmDeleteResultBtn');
      btn.disabled = true;
      btn.textContent = 'Deleting…';
      processModal('Deleting result…', `Removing ${result.student_name || 'this student'}'s saved scan result.`, '×');
      try {
        await Store.deleteResult(resultId);
        await refresh();
        successModal('Result deleted', `${result.student_name || 'The student'}'s scan result was removed.`);
      } catch (err) {
        closeModal();
        toast(Store.friendlyError ? Store.friendlyError(err) : err.message, 'warn');
      }
    };
  }

  async function openResultEditor(resultId) {
    const result = state.results.find(r => r.id === resultId);
    if (!result) return;
    const exam = state.exams.find(e => e.id === result.exam_id);
    const choiceCount = Number(exam?.choice_count || 4);

    modal(`
      <div class="modal-head"><div><span class="kicker">RESULT DETAILS</span><h3>${esc(result.student_name || 'Unnamed student')}</h3><p>${esc(examTitle(result.exam_id))} • ${esc(resultClassLabel(result))}</p></div><button class="icon-btn" data-close-modal>✕</button></div>
      <div class="result-editor-loading">Loading saved answers…</div>`);

    try {
      const saved = await Store.resultAnswers(resultId);
      if (!saved.length) throw new Error('No saved answer details were found for this result.');
      const answers = saved.map(a => ({
        question_number: Number(a.question_number),
        student_answer: a.student_answer || '',
        correct_answer: a.correct_answer || '',
        is_correct: Boolean(a.is_correct),
        status: a.status || 'ok'
      }));

      const answerRows = () => answers.map(a => {
        const options = ['', ...Array.from({ length: choiceCount }, (_, i) => String.fromCharCode(65 + i))]
          .map(v => `<option value="${v}" ${v === a.student_answer ? 'selected' : ''}>${v || 'Blank'}</option>`).join('');
        return `<div class="saved-answer-row ${a.is_correct ? 'is-correct' : 'is-wrong'}">
          <b>${a.question_number}</b>
          <select data-saved-answer="${a.question_number}">${options}</select>
          <span>Key: <strong>${esc(a.correct_answer || '—')}</strong></span>
          <em data-saved-status="${a.question_number}">${a.student_answer ? (a.is_correct ? 'Correct' : 'Incorrect') : 'Blank'}</em>
        </div>`;
      }).join('');

      modal(`
        <div class="modal-head"><div><span class="kicker">RESULT DETAILS</span><h3>${esc(result.student_name || 'Unnamed student')}</h3><p>${esc(examTitle(result.exam_id))} • ${esc(resultClassLabel(result))}</p></div><button class="icon-btn" data-close-modal>✕</button></div>
        <div class="result-editor-summary">
          <div><small>SCORE</small><strong id="savedResultScore">${result.score}/${result.total_items}</strong></div>
          <div><small>PERCENTAGE</small><strong id="savedResultPct">${result.percentage}%</strong></div>
          <div><small>SECTION</small><strong>${esc(resultClassLabel(result))}</strong></div>
        </div>
        <div class="result-editor-note">Preview every detected response below. Change any answer that the camera read incorrectly, then save.</div>
        <div class="saved-answer-grid">${answerRows()}</div>
        <div class="modal-actions result-editor-actions"><button type="button" class="btn btn-soft" data-close-modal>Cancel</button><button type="button" id="saveResultEditsBtn" class="btn btn-primary">Save answer changes</button></div>`);

      const recalc = () => {
        const score = answers.filter(a => a.is_correct).length;
        const pct = Math.round((score / answers.length) * 10000) / 100;
        $('#savedResultScore').textContent = `${score}/${answers.length}`;
        $('#savedResultPct').textContent = `${pct}%`;
      };

      $$('[data-saved-answer]').forEach(sel => sel.onchange = () => {
        const answer = answers.find(a => a.question_number === Number(sel.dataset.savedAnswer));
        if (!answer) return;
        answer.student_answer = sel.value;
        answer.status = sel.value ? 'ok' : 'blank';
        answer.is_correct = Boolean(sel.value) && sel.value === answer.correct_answer;
        const row = sel.closest('.saved-answer-row');
        row.classList.toggle('is-correct', answer.is_correct);
        row.classList.toggle('is-wrong', !answer.is_correct);
        const status = row.querySelector(`[data-saved-status="${answer.question_number}"]`);
        if (status) status.textContent = answer.student_answer ? (answer.is_correct ? 'Correct' : 'Incorrect') : 'Blank';
        recalc();
      });

      $('#saveResultEditsBtn').onclick = async () => {
        const btn = $('#saveResultEditsBtn');
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
          await Store.updateResultAnswers(resultId, answers);
          closeModal();
          await refresh();
          successModal('Result updated','Student answers and score were saved.');
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Save answer changes';
          toast(Store.friendlyError ? Store.friendlyError(err) : err.message, 'warn');
        }
      };
    } catch (err) {
      modal(`
        <div class="modal-head"><div><span class="kicker">RESULT DETAILS</span><h3>${esc(result.student_name || 'Unnamed student')}</h3><p>${esc(examTitle(result.exam_id))} • ${esc(resultClassLabel(result))}</p></div><button class="icon-btn" data-close-modal>✕</button></div>
        <div class="delete-warning">${esc(Store.friendlyError ? Store.friendlyError(err) : err.message)}</div>`);
    }
  }

  function renderAnalytics() {
    const avg = state.results.length
      ? Math.round(state.results.reduce((a, b) => a + Number(b.percentage || 0), 0) / state.results.length)
      : 0;
    const clear = state.results.filter(r => !r.review_count).length;

    $('#analyticsStats').innerHTML = [
      ['Average', `${avg}%`, '↗'],
      ['Results', state.results.length, '✓'],
      ['Clear scans', clear, '●'],
      ['Needs review', state.results.length - clear, '!']
    ].map(([label, value, icon]) => `<div class="stat-card"><span class="stat-icon">${icon}</span><div><small>${label}</small><strong>${value}</strong></div></div>`).join('');

    const byExam = state.exams.map(e => {
      const rs = state.results.filter(r => r.exam_id === e.id);
      const average = rs.length ? Math.round(rs.reduce((x, y) => x + Number(y.percentage || 0), 0) / rs.length) : 0;
      return { e, average, n: rs.length };
    }).filter(x => x.n);

    $('#examBars').innerHTML = byExam.map(x => `
      <div class="bar-row"><div><strong>${esc(x.e.title)}</strong><small>${x.n} result${x.n === 1 ? '' : 's'}</small></div><div class="bar-track"><i style="width:${x.average}%"></i></div><b>${x.average}%</b></div>
    `).join('') || emptyMini('No analytics yet', 'Scan answer sheets to build performance data.');

    const buckets = [['90–100', 0], ['80–89', 0], ['70–79', 0], ['Below 70', 0]];
    state.results.forEach(r => {
      const p = Number(r.percentage);
      if (p >= 90) buckets[0][1]++;
      else if (p >= 80) buckets[1][1]++;
      else if (p >= 70) buckets[2][1]++;
      else buckets[3][1]++;
    });
    $('#distribution').innerHTML = buckets.map(([label, n]) => `<div class="dist-row"><span>${label}</span><div class="dots">${Array.from({ length: n }, () => '<i></i>').join('')}</div><b>${n}</b></div>`).join('');

    const analysisExam = $('#itemAnalysisExam');
    const analysisClass = $('#itemAnalysisClass');
    if (analysisExam) {
      const current = analysisExam.value;
      analysisExam.innerHTML = '<option value="">Choose an exam…</option>' + state.exams.map(e => `<option value="${e.id}">${esc(e.title)}</option>`).join('');
      if (state.exams.some(e => e.id === current)) analysisExam.value = current;
    }
    if (analysisClass) {
      const current = analysisClass.value;
      analysisClass.innerHTML = '<option value="">All sections</option>' + state.classes.map(c => `<option value="${c.id}">Grade ${esc(c.grade_level || '—')} • ${esc(classLabel(c))}</option>`).join('');
      if (state.classes.some(c => c.id === current)) analysisClass.value = current;
    }
  }

  function renderSettings() {
    $('#profileName').value = state.user?.full_name || '';
    $('#profileSchool').value = state.user?.school_name || '';
    $('#storeScansToggle').checked = localStorage.getItem('gradedock_store_scans') === '1';
    $('#connectionCard').innerHTML = Store.demo
      ? `<div class="connection demo"><strong>Demo mode</strong><p>Data is stored only in this browser. To enable accounts and cloud storage, configure <code>js/config.js</code> and run the SQL setup.</p></div>`
      : `<div class="connection live"><strong>Supabase connected</strong><p>Authentication and teacher-owned classes, exams, answer keys, and results are using your configured Supabase project.</p></div>`;
  }

  function newClass() {
    modal(`
      <div class="modal-head"><div><h3>Create class</h3><p>Create a grade level and section. The section is the class name shown throughout GradeDock.</p></div><button class="icon-btn" data-close-modal>✕</button></div>
      <form id="classForm" class="form-stack">
        <div class="form-grid two compact-grid">
          <label>Grade level<input name="grade_level" required placeholder="9"></label>
          <label>Section<input name="section" required placeholder="Cobalt"></label>
        </div>
        <label>School year<input name="school_year" placeholder="2026-2027"></label>
        <div class="modal-actions"><button type="button" class="btn btn-soft" data-close-modal>Cancel</button><button class="btn btn-primary">Create class</button></div>
      </form>`);

    $('#classForm').onsubmit = async e => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(e.target));
      payload.name = payload.section;
      processModal('Creating class…', `Setting up ${payload.section || 'your class'} and saving it to GradeDock.`);
      try {
        await Store.createClass(payload);
        await refresh();
        successModal('Class created', `${payload.section || 'Your class'} is ready.`, payload.grade_level ? `Grade ${payload.grade_level}` : '');
      } catch (err) {
        closeModal();
        toast(Store.friendlyError ? Store.friendlyError(err) : err.message, 'warn');
      }
    };
  }

  function openClass(id) {
    const c = state.classes.find(x => x.id === id);
    const rows = state.results.filter(r => r.class_id === id).slice(0, 8);
    const students = state.students.filter(s => s.class_id === id);
    modal(`
      <div class="modal-head"><div><span class="kicker">GRADE ${esc(c?.grade_level || '—')}</span><h3>${esc(classLabel(c))}</h3><p>${esc(c?.school_year || 'School year not set')}</p></div><button class="icon-btn" data-close-modal>✕</button></div>
      <div class="class-summary-strip"><div><small>Saved results</small><strong>${state.results.filter(r => r.class_id === id).length}</strong></div><div><small>Section</small><strong>${esc(classLabel(c))}</strong></div></div>
      <div class="gd-roster-actions"><strong>Student roster (${students.length})</strong><button type="button" class="btn btn-primary" id="manageRosterBtn">Manage students</button></div>
      <div class="gd-roster-preview">${students.length ? students.slice(0, 6).map(s => `<span>${esc(s.full_name)}</span>`).join('') : '<small>No students added yet</small>'}</div>
      <div class="class-results-preview">
        ${rows.length ? rows.map(r => `<div class="class-result-row"><div><strong>${esc(r.student_name || 'Unnamed student')}</strong><small>${esc(examTitle(r.exam_id))}</small></div><b>${r.score}/${r.total_items}</b></div>`).join('') : emptyMini('No results yet', 'Select this section when scanning papers and its results will appear here.')}
      </div>`);
    $('#manageRosterBtn').onclick = () => manageRoster(id);
  }

  function setupSelection(containerId,kind,archived=false) {
    const container=document.getElementById(containerId);
    document.getElementById(containerId+'Bulk')?.remove();
    const boxes=[...container.querySelectorAll('[data-select-item]')];
    if(!boxes.length)return;
    const bar=document.createElement('div');bar.id=containerId+'Bulk';bar.className='gd-bulk-bar';
    bar.innerHTML=`<label class="gd-select"><input type="checkbox" data-all> Select all shown</label><span data-count>0 selected</span><button class="btn btn-soft" data-bulk="${archived?'restore':'archive'}" disabled>${archived?'Restore':'Archive'} selected</button><button class="btn btn-danger" data-bulk="delete" disabled>Delete selected</button>`;
    container.before(bar);
    const all=bar.querySelector('[data-all]');
    const update=()=>{const n=boxes.filter(b=>b.checked).length;all.checked=n===boxes.length;all.indeterminate=n>0&&n<boxes.length;bar.querySelector('[data-count]').textContent=n+' selected';bar.querySelectorAll('button').forEach(b=>b.disabled=!n);};
    all.onchange=()=>{boxes.forEach(b=>b.checked=all.checked);update();};boxes.forEach(b=>b.onchange=update);
    bar.querySelectorAll('[data-bulk]').forEach(b=>b.onclick=()=>bulkAction(kind,boxes.filter(x=>x.checked).map(x=>x.dataset.selectItem),b.dataset.bulk));
  }

  function bulkAction(kind,ids,action) {
    const items=state[kind].filter(x=>ids.includes(x.id));if(!items.length)return;
    const label=action[0].toUpperCase()+action.slice(1);
    const related=state.results.filter(r=>ids.includes(kind==='classes'?r.class_id:r.exam_id)).length;
    const warning=action==='delete' ? `Permanently remove these ${kind} and ${related} saved results with their answers. ${kind==='classes'?'Student rosters will also be removed; shared exams remain.':'Exam answer keys will also be removed.'} This cannot be undone.` : action==='archive'?'Move these items to Archives. Students, answer keys and results will be preserved.':'Return these items to the active list with their saved data.';
    modal(`<h3>${label} ${items.length} ${kind}?</h3><p>${esc(warning)}</p><ul class="gd-confirm-list">${items.map(x=>`<li>${esc(kind==='classes'?classLabel(x):x.title)}</li>`).join('')}</ul><p id="bulkStatus" role="status"></p><div class="modal-actions"><button class="btn btn-soft" data-close-modal>Cancel</button><button id="bulkConfirm" class="btn ${action==='delete'?'btn-danger':'btn-primary'}">${label}</button></div>`);
    $('#bulkConfirm').onclick=async()=>{
      let completed=0;const failures=[];
      for(const item of items){
        $('#bulkStatus').textContent=`${label}: ${completed+failures.length+1} of ${items.length}`;
        try{if(action==='delete')await (kind==='classes'?Store.deleteClass(item.id):Store.deleteExam(item.id));else await Store.setArchived(kind,item.id,action==='archive');completed++;}
        catch(e){failures.push((kind==='classes'?classLabel(item):item.title)+': '+Store.friendlyError(e));}
      }
      try{await refresh();}catch(e){failures.push('Refresh failed: '+Store.friendlyError(e));}
      successModal(failures.length?'Action finished with errors':`${label} complete`,`${completed} of ${items.length} ${kind} ${action==='delete'?'deleted':action==='archive'?'archived':'restored'}.`,failures.join('\n'));
    };
  }
  function archiveItem(kind,id){bulkAction(kind,[id],'archive');}
  function restoreItem(kind,id){bulkAction(kind,[id],'restore');}
  function renderArchives() {
    for(const kind of ['classes','exams']){
      const target=kind==='classes'?'archivedClasses':'archivedExams';
      const items=state[kind].filter(x=>x.is_archived);
      document.getElementById(target).innerHTML=items.map(x=>`<div class="gd-archive-row"><label class="gd-select"><input type="checkbox" data-select-item="${x.id}" aria-label="Select ${esc(kind==='classes'?classLabel(x):x.title)}"> Select</label><strong>${esc(kind==='classes'?classLabel(x):x.title)}</strong><div class="row-actions"><button class="btn btn-soft" data-restore="${x.id}">Restore</button><button class="btn btn-danger" data-delete="${x.id}">Delete</button></div></div>`).join('')||emptyMini('No archived '+kind,'Archived items appear here.');
      const root=document.getElementById(target);
      root.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>restoreItem(kind,b.dataset.restore));
      root.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>bulkAction(kind,[b.dataset.delete],'delete'));
      setupSelection(target,kind,true);
    }
  }

  function manageRoster(classId) {
    const cls = state.classes.find(c => c.id === classId);
    const students = state.students.filter(s => s.class_id === classId).sort((a,b) => (({Male:0,Female:1,Unspecified:2})[a.gender] ?? 2) - (({Male:0,Female:1,Unspecified:2})[b.gender] ?? 2) || a.full_name.localeCompare(b.full_name));
    modal(`<div class="modal-head"><div><h3>Students · ${esc(classLabel(cls))}</h3><p>Add students individually or import an SF1 Excel file. Male and Female groups are detected automatically from SF1; no gender column is required.</p></div><button class="icon-btn" data-close-modal>✕</button></div>
      <div class="gd-roster-top"><form id="addRosterForm" class="form-stack">
        <label>Student name<input name="name" required placeholder="Surname, First Name"></label>
        <div class="form-grid two compact-grid"><label>Gender<select name="gender"><option value="Male">Male</option><option value="Female">Female</option><option value="Unspecified">Unspecified</option></select></label><label>LRN (optional)<input name="lrn" placeholder="Optional"></label></div>
        <button class="btn btn-primary">+ Add student</button>
      </form><div class="gd-sf1-import"><strong>Import School Form 1 (SF1)</strong><p>Accepts DepEd SF1 (.xls and .xlsx), ordinary Excel lists, or CSV. Detects Male/Female sections automatically and supports names and optional LRN. No gender dropdown required. Duplicates are skipped.</p><input id="gdSF1Input" type="file" accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"><a class="btn btn-soft" href="templates/GradeDock-Student-Import-Template.xlsx" download>Download sample template</a><button type="button" class="btn btn-soft" id="gdSF1Import">Import students</button><small id="gdSF1Info" role="status"></small></div></div>
      <div class="gd-roster-heading">${students.length} students</div>
      <div id="rosterSelection" class="gd-bulk-bar"><label class="gd-select"><input type="checkbox" id="allStudents"> Select all students</label><button class="btn btn-danger" id="deleteStudents" disabled>Delete selected</button></div><div class="student-list">${students.map((s,i) => `<div><label class="gd-select"><input type="checkbox" data-student-select="${s.id}" aria-label="Select ${esc(s.full_name)}">${i+1}</label><div><strong>${esc(s.full_name)}</strong><small>${esc(s.gender)}${s.lrn ? ' · LRN '+esc(s.lrn) : ''}</small></div><div class="row-actions"><button class="mini-action" data-edit-student="${s.id}">Edit</button><button class="mini-action danger-action" data-remove-student="${s.id}">Delete</button></div></div>`).join('') || emptyMini('No students yet','Add names above to start your roster.')}</div>`);
    const studentBoxes=$$('[data-student-select]');
    const updateStudentSelection=()=>{const n=studentBoxes.filter(b=>b.checked).length;$('#deleteStudents').disabled=!n;$('#deleteStudents').textContent=n?`Delete selected (${n})`:'Delete selected';$('#allStudents').checked=n>0&&n===studentBoxes.length;$('#allStudents').indeterminate=n>0&&n<studentBoxes.length;};
    $('#allStudents').onchange=()=>{studentBoxes.forEach(b=>b.checked=$('#allStudents').checked);updateStudentSelection();};
    studentBoxes.forEach(b=>b.onchange=updateStudentSelection);
    $('#deleteStudents').onclick=()=>{
      const ids=studentBoxes.filter(b=>b.checked).map(b=>b.dataset.studentSelect);
      modal(`<h3>Delete ${ids.length} students?</h3><p>Remove the selected names from this roster. Previously saved scan results stay unchanged.</p><ul class="gd-confirm-list">${students.filter(s=>ids.includes(s.id)).map(s=>`<li>${esc(s.full_name)}</li>`).join('')}</ul><div class="modal-actions"><button class="btn btn-soft" id="cancelStudentDelete">Cancel</button><button class="btn btn-danger" id="confirmStudentsDelete">Delete students</button></div>`);
      $('#cancelStudentDelete').onclick=()=>manageRoster(classId);
      $('#confirmStudentsDelete').onclick=async()=>{
        let deleted=0;const failed=[];
        for(const id of ids){try{await Store.deleteStudent(id);deleted++;}catch(e){failed.push(Store.friendlyError(e));}}
        try{await refresh();}catch(e){failed.push(Store.friendlyError(e));}
        successModal(failed.length?'Deletion finished with errors':'Students deleted',`${deleted} of ${ids.length} students removed.`,failed.join('\n'),'View students',()=>manageRoster(classId));
      };
    };
    $('#addRosterForm').onsubmit = async ev => {
      ev.preventDefault(); const f = new FormData(ev.target);
      try { await Store.addStudents(classId, [{full_name:String(f.get('name')).trim(), gender:f.get('gender'), lrn:String(f.get('lrn')).trim()}]); await refresh(); successModal('Student added','The student is saved in your class.', '', 'View students',()=>manageRoster(classId)); }
      catch(e) { toast(Store.friendlyError(e),'warn'); }
    };
    $('#gdSF1Import').onclick = async () => {
      const file = $('#gdSF1Input').files?.[0];
      if (!file) return toast('Choose an Excel or CSV file first.', 'warn');
      const button = $('#gdSF1Import'); button.disabled = true;
      try {
        const parsed = await window.GradeDockRosterImport.read(file, students);
        const imported = parsed.students;
        if (!imported.length) throw new Error('No new student names found. Check for duplicates and a Name or Last Name / First Name header. Gender and LRN are optional. If this is your SF1, send a copy so its exact layout can be checked.');
        const males=imported.filter(x=>x.gender==='Male').length, females=imported.filter(x=>x.gender==='Female').length, unspecified=imported.filter(x=>x.gender==='Unspecified').length;
        modal(`<h3>Review ${imported.length} students</h3><p>Check the complete names before importing. Male: ${males} · Female: ${females} · Unspecified: ${unspecified}. Skipped/duplicates: ${parsed.skipped}.</p><div class="gd-import-preview"><table><thead><tr><th>Name</th><th>Gender</th><th>LRN</th></tr></thead><tbody>${imported.map(x=>`<tr><td>${esc(x.full_name)}</td><td>${esc(x.gender)}</td><td>${esc(x.lrn)}</td></tr>`).join('')}</tbody></table></div><p id="importProgress" role="status"></p><div class="modal-actions"><button class="btn btn-soft" id="cancelImport">Back</button><button class="btn btn-primary" id="confirmImport">Import students</button></div>`);
        $('#cancelImport').onclick=()=>manageRoster(classId);
        $('#confirmImport').onclick=async()=>{
          let saved=0;
          try{
            for(let i=0;i<imported.length;i+=40){$('#importProgress').textContent=`Importing ${saved} of ${imported.length}…`;await Store.addStudents(classId,imported.slice(i,i+40));saved+=imported.slice(i,i+40).length;}
            await refresh();successModal('Import complete',`${saved} students added.`, '', 'View students',()=>manageRoster(classId));
          }catch(e){
            try{await refresh();}catch(_){}
            successModal('Import stopped',`${saved} students were saved before the error. Choose the file again to retry; saved names will be skipped.`,Store.friendlyError(e),'Back to students',()=>manageRoster(classId));
          }
        };

      } catch(e) { if($('#gdSF1Info')) $('#gdSF1Info').textContent='Import failed: '+(e.message||String(e));console.error('GradeDock student import:',e);toast(e.message||'Excel import failed','warn'); }
      finally { button.disabled=false; }
    };
    $$('[data-edit-student]').forEach(b => b.onclick = () => {
      const s = students.find(x => x.id === b.dataset.editStudent);
      modal(`<div class="modal-head"><h3>Edit student</h3><button class="icon-btn" data-close-modal>✕</button></div><form id="editStudentForm" class="form-stack"><label>Name<input name="full_name" required value="${esc(s.full_name)}"></label><label>Gender<select name="gender"><option value="Male" ${s.gender==='Male'?'selected':''}>Male</option><option value="Female" ${s.gender==='Female'?'selected':''}>Female</option><option value="Unspecified" ${s.gender==='Unspecified'?'selected':''}>Unspecified</option></select></label><label>LRN (optional)<input name="lrn" value="${esc(s.lrn || '')}"></label><div class="modal-actions"><button type="button" class="btn btn-soft" data-close-modal>Cancel</button><button class="btn btn-primary">Save</button></div></form>`);
      $('#editStudentForm').onsubmit = async ev => {ev.preventDefault();const f=new FormData(ev.target);try {await Store.editStudent(s.id,{full_name:String(f.get('full_name')).trim(),gender:f.get('gender'),lrn:String(f.get('lrn')).trim()||null});await refresh();successModal('Student updated','Changes saved.', '', 'View students',()=>manageRoster(classId));}catch(e){toast(Store.friendlyError(e),'warn');}};
    });
    $$('[data-remove-student]').forEach(b => b.onclick = () => {
      const id = b.dataset.removeStudent;
      modal(`<div class="gd-dialog"><h3>Delete student?</h3><p>This removes the student from the roster. Previously saved scan results remain unchanged.</p><div class="modal-actions"><button class="btn btn-soft" data-close-modal>Cancel</button><button class="btn btn-primary" id="confirmRemoveStudent">Delete student</button></div></div>`);
      $('#confirmRemoveStudent').onclick = async () => {try {await Store.deleteStudent(id);await refresh();successModal('Student deleted','The student was removed from the roster.', '', 'View students',()=>manageRoster(classId));}catch(e){toast(Store.friendlyError(e),'warn');}};
    });
  }

  function newExam() {
    modal(`
      <div class="modal-head"><div><h3>Create exam</h3><p>Create the exam now to get its answer sheet. The answer key is optional and can be imported later.</p></div><button class="icon-btn" data-close-modal>✕</button></div>
      <form id="examForm" class="form-stack">
        <label>Exam title<input id="examTitleInput" name="title" required placeholder="Quarter 1 Mathematics"></label>
        <div class="form-grid two compact-grid">
          <label>Number of items<input id="qCount" name="question_count" type="number" min="5" max="50" value="40" required></label>
          <label>Choices<select id="choiceCount" name="choice_count"><option value="4">A–D</option><option value="5">A–E</option></select></label>
        </div>
        <div class="excel-key-box">
          <div><strong>Excel answer-key workflow</strong><small>Download the template, choose the item count inside Excel, fill the active yellow answer rows, then import it. GradeDock will use the item count stored in the workbook.</small></div>
          <div class="excel-key-actions"><button type="button" id="downloadKeyTemplate" class="btn btn-soft">⇩ Download Excel template</button><button type="button" id="importKeyBtn" class="btn btn-soft">⇧ Import completed Excel</button><input id="keyWorkbookInput" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></div>
        </div>
        <div><div class="key-head"><strong>Answer key <span class="muted">(optional for now)</span></strong><span id="keyImportStatus" class="muted">Leave it blank if you only need the answer sheet first.</span></div><div id="keyGrid" class="key-grid"></div></div>
        <div class="modal-actions"><button type="button" class="btn btn-soft" data-close-modal>Cancel</button><button class="btn btn-primary">Create exam</button></div>
      </form>`);

    const examDraft = () => ({
      title: $('#examTitleInput').value.trim() || 'Untitled Exam',
      question_count: Number($('#qCount').value || 40),
      choice_count: Number($('#choiceCount').value || 4)
    });

    const draftKey = () => Array.from({ length: Number($('#qCount').value || 0) }, (_, i) =>
      document.querySelector(`[data-key-radio="${i}"]:checked`)?.value || ''
    );

    const draw = (keep = []) => {
      const n = Number($('#qCount').value);
      const c = Number($('#choiceCount').value);
      $('#keyGrid').innerHTML = Array.from({ length: n }, (_, i) => `
        <div class="radio-key-row">
          <span class="radio-key-number">${i + 1}</span>
          <div class="key-radio-options" role="radiogroup" aria-label="Correct answer for item ${i + 1}">
            ${Array.from({ length: c }, (_, j) => {
              const v = String.fromCharCode(65 + j);
              return `<label class="key-radio-choice"><input type="radio" name="create-key-${i}" data-key-radio="${i}" value="${v}" ${keep[i] === v ? 'checked' : ''}><span>${v}</span></label>`;
            }).join('')}
          </div>
          <button type="button" class="key-clear-btn" data-clear-create-key="${i}" title="Clear item ${i + 1}">Clear</button>
        </div>
      `).join('');
      $$('[data-clear-create-key]').forEach(btn => btn.onclick = () => {
        const checked = document.querySelector(`[data-key-radio="${btn.dataset.clearCreateKey}"]:checked`);
        if (checked) checked.checked = false;
      });
    };

    draw();
    $('#qCount').oninput = () => draw(draftKey());
    $('#choiceCount').onchange = () => draw(draftKey());

    $('#downloadKeyTemplate').onclick = async () => {
      try {
        await window.GradeDockExcel.downloadTemplate(examDraft(), [], state.user?.full_name || 'Teacher');
        toast('Excel answer-key template downloaded');
      } catch (err) { toast(err.message, 'warn'); }
    };

    $('#importKeyBtn').onclick = () => $('#keyWorkbookInput').click();
    $('#keyWorkbookInput').onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const imported = await window.GradeDockExcel.importTemplate(file);
        $('#qCount').value = imported.questionCount;
        $('#choiceCount').value = String(imported.choiceCount);
        if (imported.title && !$('#examTitleInput').value.trim()) $('#examTitleInput').value = imported.title;
        draw(imported.answers);
        $('#keyImportStatus').textContent = `Imported ${imported.answers.length} answers • ${imported.questionCount} items • A–${String.fromCharCode(64 + imported.choiceCount)} • ${file.name}`;
        toast(`Answer key imported: ${imported.questionCount} items detected`);
      } catch (err) { toast(err.message, 'warn'); }
      e.target.value = '';
    };

    $('#examForm').onsubmit = async e => {
      e.preventDefault();
      const submitBtn = e.submitter || e.target.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating...'; }
      try {
        const payload = Object.fromEntries(new FormData(e.target));
        delete payload.class_id;
        payload.question_count = Number(payload.question_count);
        payload.choice_count = Number(payload.choice_count);
        const key = draftKey();
        const hasCompleteKey = key.length === payload.question_count && key.every(Boolean);
        const hasPartialKey = key.some(Boolean) && !hasCompleteKey;
        processModal('Creating exam…', `Saving ${payload.title || 'your exam'} and preparing its answer-sheet tools.`);
        const createdExam = await Store.createExam(payload, hasCompleteKey ? key : []);
        await refresh();
        showExamCreatedActions(createdExam, hasCompleteKey);
        if (hasPartialKey) toast('Exam created. The incomplete key was not saved; add it later.', 'warn');
      } catch (err) {
        const message = Store.friendlyError ? Store.friendlyError(err) : (err?.message || 'Could not create the exam.');
        toast(message, 'warn');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create exam'; }
      }
    };
  }


  function showExamCreatedActions(exam, hasKey = false) {
    if (!exam) return;
    modal(`
      <div class="modal-head"><div><span class="kicker">EXAM READY</span><h3>${esc(exam.title)}</h3><p>${hasKey ? 'The exam and answer key are saved.' : 'The exam is saved. You can download the answer sheet now and add the correct answers later.'}</p></div><button class="icon-btn" data-close-modal>✕</button></div>
      <div class="exam-ready-body">
        <div class="exam-ready-summary"><strong>${exam.question_count} items</strong><span>A–${String.fromCharCode(64 + Number(exam.choice_count || 4))} choices</span></div>
        <button id="createdDownloadSheetPdf" class="btn btn-primary btn-block">⇩ Download Answer Sheet PDF</button>
        <button id="createdDownloadSheetPng" class="btn btn-soft btn-block">⇩ Download Answer Sheet Image (PNG)</button>
        <button id="createdManageKey" class="btn btn-soft btn-block">✎ ${hasKey ? 'Update Answer Key' : 'Add Answer Key Later'}</button>
        <button id="createdScanPapers" class="btn btn-soft btn-block">⌗ Go to Scan Papers</button>
      </div>
      <div class="modal-actions exam-ready-actions"><button type="button" class="btn btn-soft" data-close-modal>Done</button></div>`);
    $('#createdDownloadSheetPdf').onclick = () => downloadSheetPdf(exam.id);
    $('#createdDownloadSheetPng').onclick = () => downloadSheetPng(exam.id);
    $('#createdManageKey').onclick = () => manageExamKey(exam.id);
    $('#createdScanPapers').onclick = () => {
      closeModal();
      go('scan');
      populateScanSelectors();
      $('#scanExam').value = exam.id;
      $('#scanStatusText').textContent = 'Choose the section that this paper belongs to, then scan it.';
    };
  }

  async function downloadSheetPdf(id) {
    const exam = state.exams.find(x => x.id === id);
    if (!exam) return;
    await new Promise(resolve=>setTimeout(resolve,0));
    await window.GradeDockSheet.downloadPdf(exam, state.user?.full_name || 'Teacher');
    toast('Answer sheet PDF downloaded');
  }

  async function downloadSheetPng(id) {
    const exam = state.exams.find(x => x.id === id);
    if (!exam) return;
    await new Promise(resolve=>setTimeout(resolve,0));
    await window.GradeDockSheet.downloadPng(exam, state.user?.full_name || 'Teacher');
    toast('Answer sheet PNG downloaded');
  }

  async function exportExamKey(id) {
    const exam = state.exams.find(x => x.id === id);
    if (!exam) return;
    try {
      const key = await Store.examKey(exam.id);
      await window.GradeDockExcel.downloadTemplate(exam, key, state.user?.full_name || 'Teacher');
      toast(key.length ? 'Answer key exported to Excel' : 'Blank answer-key template downloaded');
    } catch (err) { toast(err.message, 'warn'); }
  }

  async function manageExamKey(id) {
    const exam = state.exams.find(x => x.id === id);
    if (!exam) return;
    let currentKey = [];
    try { currentKey = await Store.examKey(exam.id); } catch (_) {}

    const manualGrid = () => Array.from({ length: Number(exam.question_count) }, (_, i) => {
      const current = currentKey[i] || '';
      return `<div class="radio-key-row">
        <span class="radio-key-number">${i + 1}</span>
        <div class="key-radio-options" role="radiogroup" aria-label="Correct answer for item ${i + 1}">
          ${Array.from({ length: Number(exam.choice_count || 4) }, (_, j) => {
            const value = String.fromCharCode(65 + j);
            return `<label class="key-radio-choice"><input type="radio" name="manual-key-${i}" data-manual-key-radio="${i}" value="${value}" ${current === value ? 'checked' : ''}><span>${value}</span></label>`;
          }).join('')}
        </div>
      </div>`;
    }).join('');

    const collectManualKey = () => Array.from({ length: Number(exam.question_count) }, (_, i) =>
      document.querySelector(`[data-manual-key-radio="${i}"]:checked`)?.value || ''
    );

    modal(`
      <div class="modal-head"><div><span class="kicker">ANSWER KEY</span><h3>${esc(exam.title)}</h3><p>Enter the correct answers manually, or use the Excel template. A complete key is only required when you are ready to scan and score papers.</p></div><button class="icon-btn" data-close-modal>✕</button></div>
      <div class="exam-ready-body key-manager-body">
        <div class="exam-ready-summary"><strong>${currentKey.length === Number(exam.question_count) && currentKey.every(Boolean) ? 'Key ready' : 'No complete key yet'}</strong><span>${exam.question_count} items • A-${String.fromCharCode(64 + Number(exam.choice_count || 4))}</span></div>
        <div class="manual-key-section">
          <div class="key-head"><strong>Manual answer key</strong><span class="muted">Choose one answer for every item, then save.</span></div>
          <div class="key-grid manual-key-grid">${manualGrid()}</div>
          <button id="saveManualKey" class="btn btn-primary btn-block">Save Manual Answer Key</button>
        </div>
        <div class="key-divider"><span>or use Excel</span></div>
        <button id="manageDownloadKey" class="btn btn-soft btn-block">⇩ Download Excel Answer-Key Template</button>
        <button id="manageUploadKey" class="btn btn-soft btn-block">⇧ Upload Completed Excel Key</button>
        <input id="manageKeyFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
      </div>
      <div class="modal-actions"><button type="button" class="btn btn-soft" data-close-modal>Close</button></div>`);

    $('#saveManualKey').onclick = async () => {
      const key = collectManualKey();
      if (key.length !== Number(exam.question_count) || key.some(x => !x)) {
        toast('Choose a correct answer for every item before saving the manual key.', 'warn');
        return;
      }
      try {
        await Store.replaceExamKey(exam.id, key);
        closeModal();
        await refresh();
        successModal('Answer key saved','Your manual answer key is ready.');
      } catch (err) {
        toast(Store.friendlyError ? Store.friendlyError(err) : err.message, 'warn');
      }
    };

    $('#manageDownloadKey').onclick = async () => {
      try { await window.GradeDockExcel.downloadTemplate(exam, currentKey, state.user?.full_name || 'Teacher'); }
      catch (err) { toast(err.message, 'warn'); }
    };
    $('#manageUploadKey').onclick = () => $('#manageKeyFile').click();
    $('#manageKeyFile').onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const imported = await window.GradeDockExcel.importTemplate(file);
        if (imported.answers.length !== imported.questionCount || imported.answers.some(x => !x)) {
          throw new Error('Complete every active Correct Answer row in the Excel file before uploading it.');
        }
        await Store.updateExam(exam.id, {
          question_count: imported.questionCount,
          choice_count: imported.choiceCount,
          ...(imported.title ? { title: imported.title } : {})
        });
        await Store.replaceExamKey(exam.id, imported.answers);
        closeModal();
        await refresh();
        successModal('Answer key saved',`${imported.questionCount} items imported from Excel.`);
      } catch (err) { toast(Store.friendlyError ? Store.friendlyError(err) : err.message, 'warn'); }
      e.target.value = '';
    };
  }

  function confirmDeleteExam(id) { bulkAction('exams',[id],'delete'); }

  function populateScanSelectors() {
    const classSelect = $('#scanClass');
    const examSelect = $('#scanExam');
    if (!classSelect || !examSelect) return;

    const currentClass = classSelect.value;
    const currentExam = examSelect.value;

    classSelect.innerHTML = '<option value="">Choose a section…</option>' + state.classes.filter(c => !c.is_archived).map(c =>
      `<option value="${c.id}">Grade ${esc(c.grade_level || '—')} • ${esc(classLabel(c))}</option>`
    ).join('');
    examSelect.innerHTML = '<option value="">Choose an exam…</option>' + state.exams.filter(e => !e.is_archived).map(e =>
      `<option value="${e.id}">${esc(e.title)}</option>`
    ).join('');

    if (state.classes.some(c => c.id === currentClass)) classSelect.value = currentClass;
    if (state.exams.some(e => e.id === currentExam)) examSelect.value = currentExam;
  }

  function scanContext() {
    const cls = state.classes.find(c => c.id === $('#scanClass').value);
    const exam = state.exams.find(e => e.id === $('#scanExam').value);
    return { cls, exam };
  }

  function requireScanContext() {
    const { cls, exam } = scanContext();
    if (!cls) { toast('Select the section/class first.', 'warn'); return null; }
    if (!exam) { toast('Select the exam before scanning.', 'warn'); return null; }
    return { cls, exam };
  }

  async function processCanvas(canvas, blob = null) {
    const context = requireScanContext();
    if (!context) return;
    const { cls, exam } = context;
    try {
      $('#scanStatusText').textContent = `Reading ${classLabel(cls)} paper: registration markers and bubbles…`;
      $('#scanConfidence').textContent = 'Scanning';
      $('#scanConfidence').className = 'badge neutral';
      const key = await Store.examKey(exam.id);
      if (key.length !== Number(exam.question_count) || key.some(x => !x)) {
        throw new Error('This exam does not have a complete answer key yet. Open Exams → Set / Update Answer Key, then upload the completed Excel key before scanning.');
      }
      const result = window.GradeDockScanner.analyze(canvas, exam, key);
      state.scan = { ...result, exam, key, classId: cls.id, className: classLabel(cls) };
      state.scanImageBlob = blob;
      renderScanResult();
      const activeScan = state.scan;
      window.GradeDockScanner.readStudentName(canvas, result.homography, result.orientationTransform).then(ocr => {
        if (state.scan !== activeScan) return;
        const input = $('#scannedStudentName');
        const note = $('#nameOcrStatus');
        if (!input || !note) return;
        if (ocr.text) {
          if (!input.value.trim()) input.value = ocr.text;
          note.textContent = `Detected name: ${ocr.text}. Please verify before saving.`;
          note.className = 'ocr-success';
        } else if (ocr.available === false) {
          note.textContent = 'Automatic name reading is unavailable. Type the name manually.';
          note.className = 'ocr-warn';
        } else {
          note.textContent = 'I could not read the handwriting clearly. Type or correct the name manually.';
          note.className = 'ocr-warn';
        }
      });
      return true;
    } catch (err) {
      state.scan = null;
      $('#scanConfidence').textContent = 'Needs retake';
      $('#scanConfidence').className = 'badge warn';
      $('#scanStatusText').textContent = err.message;
      if (window.GradeDockScanner?.stream) {
        setCameraAssistStatus({ state: 'warn', title: 'Not ready to scan', text: 'Reposition the paper, wait for a green GOOD TO SCAN message, then retry.' }, true);
      }
      toast(err.message, 'warn');
      return false;
    }
  }

  function renderScanResult() {
    const r = state.scan;
    $('#scanEmpty').classList.add('hidden');
    $('#scanResult').classList.remove('hidden');
        $('#scanConfidence').textContent = `${r.confidence}% clear responses`;
    $('#scanConfidence').className = `badge ${r.uncertain ? 'warn' : 'good'}`;
    const mirrorNote = r.cameraMirrorCorrected ? ' Camera orientation was corrected automatically.' : '';
    $('#scanStatusText').textContent = r.uncertain
      ? `${r.uncertain} response${r.uncertain === 1 ? '' : 's'} need teacher confirmation before saving to ${r.className}.${mirrorNote}`
      : `All responses were read clearly. This result will be saved to ${r.className}.${mirrorNote}`;

    const choices = ['', ...Array.from({ length: Number(r.exam.choice_count || 4) }, (_, i) => String.fromCharCode(65 + i))];
    const stateLabel = a => {
      if (a.state === 'multiple') return 'Multiple marks — choose one';
      if (a.state === 'blank') return 'No clear mark — confirm blank or choose';
      if (a.state === 'low') return `Unclear mark: ${a.answer || '—'} — confirm`;
      return a.answer ? (a.isCorrect ? '✓ Correct' : `✕ Key: ${a.key}`) : 'Blank';
    };

    $('#scanResult').innerHTML = `
      <div class="scan-section-pill">SECTION: <strong>${esc(r.className)}</strong></div>
      <div class="score-hero"><div><small>SCORE</small><strong id="liveScore">${r.correct}/${r.total}</strong><span id="livePct">${r.percentage}%</span></div><div class="score-ring">${r.percentage}%</div></div>
      <div class="review-help"><strong>Review highlighted items.</strong><span>Check the selected answers, especially Multiple?, Blank?, or Light mark. Confirm items individually or use Confirm All after reviewing. GradeDock will not save until all are confirmed.</span><div class="review-bulk-actions"><span id="reviewPendingCount">${r.uncertain} item${r.uncertain === 1 ? '' : 's'} to confirm</span><button type="button" id="confirmAllReviewBtn" class="btn btn-soft" ${r.uncertain ? '' : 'disabled'}>✓ Confirm All</button></div></div>
      <div class="answer-review">${r.answers.map(a => {
        const needsConfirm = a.state !== 'ok';
        const options = choices.map(x => `<option value="${x}" ${x === a.answer ? 'selected' : ''}>${x || 'Blank'}</option>`).join('');
        return `<div class="answer-chip ${needsConfirm ? 'uncertain needs-confirm' : a.isCorrect ? 'correct' : 'wrong'}" data-answer-chip="${a.question}">
          <b>${a.question}</b>
          <select data-review="${a.question}" aria-label="Answer for item ${a.question}">${options}</select>
          <small data-review-status="${a.question}">${stateLabel(a)}</small>
          ${needsConfirm ? `<button type="button" class="confirm-answer-btn" data-confirm-review="${a.question}">✓ Confirm</button>` : ''}
        </div>`;
      }).join('')}
      </div>
      <div class="save-scan"><div class="scanned-name-wrap"><label class="gd-name-label" for="scannedStudentName">Student name — search or select</label><input id="scannedStudentName" type="search" autocomplete="off" placeholder="Search student name…"><select id="gdScanRosterSelect" aria-label="Select student from roster"><option value="">Choose from class roster…</option></select><small id="nameOcrStatus">Reading the handwritten name…</small></div><div class="scan-save-actions"><button id="retryScanBtn" type="button" class="btn btn-soft">↻ Retry scan</button><button id="saveScanBtn" class="btn btn-primary" ${r.uncertain ? 'disabled' : ''}>Save to ${esc(r.className)}</button></div></div>`;

    const roster = state.students.filter(s => s.class_id === r.classId).sort((a,b)=>a.full_name.localeCompare(b.full_name));
    const nameInput = $('#scannedStudentName'), nameSelect = $('#gdScanRosterSelect');
    const renderNames = (q='') => {
      const matches = roster.filter(s => s.full_name.toLowerCase().includes(q.toLowerCase()));
      nameSelect.innerHTML = '<option value="">Choose from class roster…</option>' + matches.map(st => `<option value="${esc(st.full_name)}">${esc(st.full_name)}</option>`).join('');
    };
    renderNames();
    nameInput.addEventListener('input', () => renderNames(nameInput.value));
    nameSelect.addEventListener('change', () => {if(nameSelect.value) {nameInput.value=nameSelect.value;renderNames();nameSelect.value=nameInput.value;}});

    const updateChip = a => {
      const chip = $(`[data-answer-chip="${a.question}"]`);
      if (!chip) return;
      chip.classList.remove('uncertain', 'needs-confirm', 'correct', 'wrong');
      const status = chip.querySelector(`[data-review-status="${a.question}"]`);
      const confirm = chip.querySelector(`[data-confirm-review="${a.question}"]`);
      if (a.state !== 'ok') {
        chip.classList.add('uncertain', 'needs-confirm');
        if (status) status.textContent = stateLabel(a);
        if (confirm) confirm.classList.remove('hidden');
      } else {
        chip.classList.add(a.isCorrect ? 'correct' : 'wrong');
        if (status) status.textContent = a.answer ? (a.isCorrect ? '✓ Correct' : `✕ Key: ${a.key}`) : 'Blank confirmed';
        if (confirm) confirm.remove();
      }
    };

    $$('[data-review]').forEach(sel => sel.onchange = () => {
      const a = r.answers.find(x => x.question == sel.dataset.review);
      if (!a) return;
      a.answer = sel.value;
      // A highlighted item stays unresolved until the teacher explicitly confirms it.
      if (a.state === 'ok') {
        a.isCorrect = Boolean(a.answer) && a.answer === a.key;
        updateChip(a);
        recalcScan();
      } else {
        a.isCorrect = false;
        const status = $(`[data-review-status="${a.question}"]`);
        if (status) status.textContent = a.answer ? `Selected ${a.answer} — press ✓ Confirm` : 'Selected Blank — press ✓ Confirm';
      }
    });

    $$('[data-confirm-review]').forEach(btn => btn.onclick = () => {
      const a = r.answers.find(x => x.question == btn.dataset.confirmReview);
      if (!a) return;
      const sel = $(`[data-review="${a.question}"]`);
      a.answer = sel ? sel.value : a.answer;
      a.state = 'ok';
      a.isCorrect = Boolean(a.answer) && a.answer === a.key;
      updateChip(a);
      recalcScan();
      const next = r.answers.find(x => x.state !== 'ok');
      if (next) {
        const nextChip = $(`[data-answer-chip="${next.question}"]`);
        nextChip?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    $('#confirmAllReviewBtn').onclick = () => {
      const remaining = r.answers.filter(a => a.state !== 'ok');
      if (!remaining.length) return;
      modal(`<div class="confirm-all-dialog"><h3>Confirm all ${remaining.length} items?</h3
        <p>This will accept the currently selected answer (including Blank) for every highlighted item. Please check uncertain, multiple-mark, and blank items against the paper first. This does not save the result yet.</p>
        <div class="modal-actions"><button type="button" class="btn btn-soft" data-close-modal>Review again</button><button type="button" class="btn btn-primary" id="applyConfirmAllBtn">✓ Confirm ${remaining.length} items</button></div></div>`);
      $('#applyConfirmAllBtn').onclick = () => {
        remaining.forEach(a => {
          const sel = $(`[data-review="${a.question}"]`);
          a.answer = sel ? sel.value : a.answer;
          a.state = 'ok';
          a.isCorrect = Boolean(a.answer) && a.answer === a.key;
          updateChip(a);
        });
        recalcScan();
        closeModal();
        toast(`${remaining.length} items confirmed. Check the score, then save.`);
      };
    };

    $('#retryScanBtn').onclick = retryScan;
    $('#saveScanBtn').onclick = saveScan;
  }

  function retryScan() {
    state.scan = null;
    state.scanImageBlob = null;
    $('#scanResult').classList.add('hidden');
    $('#scanResult').innerHTML = '';
    $('#scanEmpty').classList.remove('hidden');
    $('#scanConfidence').textContent = 'Waiting';
    $('#scanConfidence').className = 'badge neutral';
    $('#scanStatusText').textContent = 'Ready to retry. Position the answer sheet and scan again.';
    if (window.GradeDockScanner?.stream) {
      startCameraAssist();
      const stage = $('.camera-stage');
      stage?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if ($('#cameraMode')?.classList.contains('active')) {
      $('#startCameraBtn')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function recalcScan() {
    const r = state.scan;
    r.correct = r.answers.filter(a => a.isCorrect).length;
    r.uncertain = r.answers.filter(a => a.state !== 'ok').length;
    r.percentage = Math.round(r.correct / r.total * 10000) / 100;
    $('#liveScore').textContent = `${r.correct}/${r.total}`;
    $('#livePct').textContent = `${r.percentage}%`;
    const ring = $('.score-ring');
    if (ring) ring.textContent = `${r.percentage}%`;
    const count = $('#reviewPendingCount');
    if (count) count.textContent = `${r.uncertain} item${r.uncertain === 1 ? '' : 's'} to confirm`;
    const bulkBtn = $('#confirmAllReviewBtn');
    if (bulkBtn) bulkBtn.disabled = r.uncertain === 0;
    const saveBtn = $('#saveScanBtn');
    if (saveBtn) saveBtn.disabled = r.uncertain > 0;
    const badge = $('#scanConfidence');
    if (badge) {
      badge.textContent = r.uncertain ? `${r.uncertain} to confirm` : 'Checked';
      badge.className = `badge ${r.uncertain ? 'warn' : 'good'}`;
    }
    if (r.uncertain) {
      $('#scanStatusText').textContent = `${r.uncertain} highlighted response${r.uncertain === 1 ? '' : 's'} still need teacher confirmation.`;
    } else {
      $('#scanStatusText').textContent = `All highlighted responses have been checked. Ready to save to ${r.className}.`;
    }
  }

  async function saveScan() {
    const r = state.scan;
    if (!r) return;
    const unresolved = r.answers.filter(a => a.state !== 'ok');
    if (unresolved.length) {
      toast(`Confirm ${unresolved.length} highlighted answer${unresolved.length === 1 ? '' : 's'} before saving.`, 'warn');
      const first = $(`[data-answer-chip=\"${unresolved[0].question}\"]`);
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const name = $('#scannedStudentName').value.trim();
    if (!name) {
      toast('Type the student name shown on the answer sheet.', 'warn');
      $('#scannedStudentName').focus();
      return;
    }

    const payload = {
      exam_id: r.exam.id,
      class_id: r.classId,
      student_name: name,
      score: r.correct,
      total_items: r.total,
      percentage: r.percentage,
      review_count: r.uncertain
    };

    try {
      processModal('Saving scan…', `Recording ${name}'s result in ${r.className}.`, '⌗');
      await Store.saveResult(payload, r.answers, state.scanImageBlob);
      state.scan = null;
      state.scanImageBlob = null;
      $('#scanResult').classList.add('hidden');
      $('#scanEmpty').classList.remove('hidden');
      $('#scanStatusText').textContent = `Saved to ${r.className}. Ready for the next paper.`;
      await refresh();
      successModal('Scan complete', `${name}'s paper was scanned and saved successfully.`, `${r.correct}/${r.total} • ${r.percentage}% • ${r.className}`, 'Scan next paper', () => {
        go('scan');
        $('#scanStatusText').textContent = `Ready for the next ${r.className} paper.`;
        if (window.GradeDockScanner?.stream) startCameraAssist();
      });
    } catch (err) { closeModal(); toast(err.message, 'warn'); }
  }

  function itemDifficultyLabel(percent) {
    if (percent >= 70) return 'Easy';
    if (percent >= 40) return 'Moderate';
    return 'Difficult';
  }

  function discriminationLabel(value) {
    if (value == null) return 'Not enough data';
    if (value >= .40) return 'Very good';
    if (value >= .30) return 'Good';
    if (value >= .20) return 'Fair';
    return 'Needs review';
  }

  async function buildItemAnalysisReport() {
    const examId = $('#itemAnalysisExam')?.value || '';
    const classId = $('#itemAnalysisClass')?.value || '';
    if (!examId) throw new Error('Choose an exam first.');
    const exam = state.exams.find(e => e.id === examId);
    if (!exam) throw new Error('Exam not found.');

    const selectedResults = state.results.filter(r => r.exam_id === examId && (!classId || r.class_id === classId));
    if (!selectedResults.length) throw new Error('There are no saved scan results for this exam and section yet.');

    const detailed = await Promise.all(selectedResults.map(async result => {
      try { return { result, answers: await Store.resultAnswers(result.id) }; }
      catch (_) { return { result, answers: [] }; }
    }));
    const usable = detailed.filter(x => x.answers.length);
    if (!usable.length) throw new Error('These results do not contain saved per-item answers yet, so item analysis cannot be generated.');

    const key = await Store.examKey(examId);
    const choiceCount = Number(exam.choice_count || 4);
    const choices = Array.from({ length: choiceCount }, (_, i) => String.fromCharCode(65 + i));
    const questionCount = Number(exam.question_count || key.length || 0);
    const sorted = [...usable].sort((a, b) => Number(b.result.score || 0) - Number(a.result.score || 0));
    const groupSize = sorted.length >= 4 ? Math.max(1, Math.floor(sorted.length * .27)) : 0;
    const upper = groupSize ? sorted.slice(0, groupSize) : [];
    const lower = groupSize ? sorted.slice(-groupSize) : [];

    const answerAt = (entry, item) => entry.answers.find(a => Number(a.question_number) === item);
    const rows = Array.from({ length: questionCount }, (_, idx) => {
      const item = idx + 1;
      const answerRows = usable.map(entry => answerAt(entry, item)).filter(Boolean);
      const n = answerRows.length;
      const correct = answerRows.filter(a => Boolean(a.is_correct)).length;
      const blank = answerRows.filter(a => !String(a.student_answer || '').trim()).length;
      const incorrect = Math.max(0, n - correct - blank);
      const percentCorrect = n ? Math.round(correct / n * 10000) / 100 : 0;
      const distribution = Object.fromEntries(choices.map(choice => [choice, answerRows.filter(a => a.student_answer === choice).length]));
      let discrimination = null;
      if (groupSize) {
        const upperCorrect = upper.filter(entry => Boolean(answerAt(entry, item)?.is_correct)).length;
        const lowerCorrect = lower.filter(entry => Boolean(answerAt(entry, item)?.is_correct)).length;
        discrimination = Math.round(((upperCorrect - lowerCorrect) / groupSize) * 100) / 100;
      }
      const correctAnswer = key[idx] || answerRows.find(Boolean)?.correct_answer || '';
      return {
        item, correctAnswer, examinees: n, correct, incorrect, blank, percentCorrect,
        difficulty: itemDifficultyLabel(percentCorrect), discrimination,
        discriminationInterpretation: discriminationLabel(discrimination), distribution
      };
    });

    const classInfo = classId ? state.classes.find(c => c.id === classId) : null;
    const analyzedResults = usable.map(x => x.result);
    const meanScore = analyzedResults.length ? analyzedResults.reduce((sum, r) => sum + Number(r.score || 0), 0) / analyzedResults.length : 0;
    const mps = questionCount ? (meanScore / questionCount) * 100 : 0;
    // GradeDock follows the common DepEd consolidated-report convention where
    // Minimum Proficiency Level (MPL) is 60% of the total test items.
    const mpl = Math.ceil(questionCount * 0.60);
    const learnersAtOrAboveMpl = analyzedResults.filter(r => Number(r.score || 0) >= mpl).length;
    const percentAtOrAboveMpl = analyzedResults.length ? learnersAtOrAboveMpl / analyzedResults.length * 100 : 0;
    const avg = Math.round(mps * 100) / 100;
    const ranked = rows.filter(r => r.examinees).sort((a, b) => a.percentCorrect - b.percentCorrect);
    return {
      exam,
      classInfo,
      sectionLabel: classInfo ? `Grade ${classInfo.grade_level || '—'} • ${classLabel(classInfo)}` : 'All sections',
      examinees: usable.length,
      meanScore: Math.round(meanScore * 100) / 100,
      mps: Math.round(mps * 100) / 100,
      mpl,
      mplPercent: 60,
      learnersAtOrAboveMpl,
      percentAtOrAboveMpl: Math.round(percentAtOrAboveMpl * 100) / 100,
      averagePercentage: avg,
      easiest: ranked.length ? ranked[ranked.length - 1] : null,
      mostDifficult: ranked.length ? ranked[0] : null,
      rows,
      choices
    };
  }

  function itemAnalysisRowClass(row) {
    if (row.difficulty === 'Difficult') return 'analysis-difficult';
    if (row.difficulty === 'Easy') return 'analysis-easy';
    return 'analysis-moderate';
  }

  async function previewItemAnalysis() {
    const button = $('#previewItemAnalysisBtn');
    if (button) { button.disabled = true; button.textContent = 'Building preview…'; }
    try {
      const report = await buildItemAnalysisReport();
      const distractorHeaders = report.choices.map(c => `<th>${c}</th>`).join('');
      const rows = report.rows.map(row => `<tr class="${itemAnalysisRowClass(row)}">
        <td><b>${row.item}</b></td><td><span class="answer-key-pill">${esc(row.correctAnswer || '—')}</span></td>
        <td>${row.correct}</td><td>${row.incorrect}</td><td>${row.blank}</td><td><b>${row.percentCorrect}%</b></td>
        <td><span class="difficulty-pill ${row.difficulty.toLowerCase()}">${row.difficulty}</span></td>
        <td>${row.discrimination == null ? '—' : row.discrimination.toFixed(2)}</td><td>${esc(row.discriminationInterpretation)}</td>
        ${report.choices.map(c => `<td>${row.distribution[c] || 0}</td>`).join('')}
      </tr>`).join('');
      modal(`
        <div class="modal-head"><div><span class="kicker">ITEM ANALYSIS PREVIEW</span><h3>${esc(report.exam.title)}</h3><p>${esc(report.sectionLabel)} • ${report.examinees} analyzed result${report.examinees === 1 ? '' : 's'}</p></div><button class="icon-btn" data-close-modal>✕</button></div>
        <div class="analysis-summary-grid">
          <div><small>EXAMINEES</small><strong>${report.examinees}</strong></div>
          <div><small>MPS</small><strong>${report.mps}%</strong></div>
          <div><small>MPL (60%)</small><strong>${report.mpl}/${Number(report.exam.question_count || report.rows.length || 0)}</strong></div>
          <div><small>MOST DIFFICULT</small><strong>${report.mostDifficult ? `Item ${report.mostDifficult.item}` : '—'}</strong></div>
          <div><small>EASIEST</small><strong>${report.easiest ? `Item ${report.easiest.item}` : '—'}</strong></div>
        </div>
        <div class="analysis-guide"><b>Reading the preview:</b> % Correct is the item facility/difficulty measure. Difficulty colors use Easy ≥70%, Moderate 40–69%, Difficult &lt;40%. Discrimination compares the upper and lower 27% groups when at least four results are available.</div>
        <div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>Item</th><th>Key</th><th>Correct</th><th>Wrong</th><th>Blank</th><th>% Correct</th><th>Difficulty</th><th>Disc.</th><th>Interpretation</th>${distractorHeaders}</tr></thead><tbody>${rows}</tbody></table></div>
        <div class="modal-actions analysis-actions"><button type="button" class="btn btn-soft" data-close-modal>Close</button><button type="button" id="downloadItemAnalysisExcelBtn" class="btn btn-primary">⇩ Download Excel</button></div>`);
      $('#downloadItemAnalysisExcelBtn').onclick = async () => {
        const btn = $('#downloadItemAnalysisExcelBtn');
        btn.disabled = true; btn.textContent = 'Preparing Excel…';
        try { await downloadItemAnalysisExcel(report); toast('Item analysis Excel downloaded'); }
        catch (err) { toast(err.message, 'warn'); }
        finally { btn.disabled = false; btn.textContent = '⇩ Download Excel'; }
      };
    } catch (err) {
      toast(Store.friendlyError ? Store.friendlyError(err) : err.message, 'warn');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Preview item analysis'; }
    }
  }

  async function downloadItemAnalysisExcel(report) {
    if (!window.ExcelJS) throw new Error('Excel export library is not available. Reload GradeDock while online, then try again.');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'GradeDock';
    workbook.created = new Date();

    const summary = workbook.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 5 }] });
    summary.columns = [{ width: 24 }, { width: 28 }];
    summary.mergeCells('A1:B1');
    summary.getCell('A1').value = 'GradeDock Item Analysis';
    summary.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
    summary.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    summary.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
    summary.getRow(1).height = 30;
    [
      ['Exam', report.exam.title],
      ['Section', report.sectionLabel],
      ['Analyzed Results', report.examinees],
      ['Number of Test Items', Number(report.exam.question_count || report.rows.length || 0)],
      ['Mean Score', report.meanScore],
      ['MPS — Mean Percentage Score', report.mps / 100],
      ['MPL — Minimum Proficiency Level (60%)', report.mpl],
      ['Learners at / above MPL', report.learnersAtOrAboveMpl],
      ['% of Learners at / above MPL', report.percentAtOrAboveMpl / 100],
      ['Most Difficult Item', report.mostDifficult ? `Item ${report.mostDifficult.item} (${report.mostDifficult.percentCorrect}%)` : '—'],
      ['Easiest Item', report.easiest ? `Item ${report.easiest.item} (${report.easiest.percentCorrect}%)` : '—'],
      ['Generated', new Date()]
    ].forEach((values, i) => {
      const row = summary.getRow(i + 3); row.values = values;
      row.getCell(1).font = { bold: true, color: { argb: 'FF334155' } };
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
      row.eachCell(cell => { cell.border = { top:{style:'thin',color:{argb:'FFD6DEE9'}}, left:{style:'thin',color:{argb:'FFD6DEE9'}}, bottom:{style:'thin',color:{argb:'FFD6DEE9'}}, right:{style:'thin',color:{argb:'FFD6DEE9'}} }; cell.alignment = { vertical:'middle', wrapText:true }; });
    });
    summary.getCell('B7').numFmt = '0.00';
    summary.getCell('B8').numFmt = '0.00%';
    summary.getCell('B11').numFmt = '0.00%';
    summary.getCell('B14').numFmt = 'mmm d, yyyy h:mm AM/PM';
    summary.getCell('B8').fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFE8F7ED'} };
    summary.getCell('B8').font = { bold:true, color:{argb:'FF166534'} };
    summary.getCell('B9').fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFFF5D6'} };
    summary.getCell('B9').font = { bold:true, color:{argb:'FF92400E'} };
    summary.getCell('B11').fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFEFF6FF'} };
    summary.getCell('B11').font = { bold:true, color:{argb:'FF1D4ED8'} };

    const ws = workbook.addWorksheet('Item Analysis', { views: [{ state: 'frozen', ySplit: 6 }] });
    const headers = ['Item','Key','Correct','Incorrect','Blank','% Correct','Difficulty','Discrimination','Interpretation', ...report.choices.map(c => `${c} Count`)];
    ws.mergeCells(1, 1, 1, headers.length);
    const title = ws.getCell(1,1);
    title.value = 'GradeDock Item Analysis';
    title.font = { bold:true, size:18, color:{argb:'FFFFFFFF'} };
    title.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1D4ED8'} };
    title.alignment = { horizontal:'center', vertical:'middle' };
    ws.getRow(1).height = 30;
    ws.mergeCells(2,1,2,headers.length); ws.getCell(2,1).value = report.exam.title; ws.getCell(2,1).font = { bold:true, size:13, color:{argb:'FF172033'} }; ws.getCell(2,1).alignment={horizontal:'center'};
    ws.mergeCells(3,1,3,headers.length); ws.getCell(3,1).value = `${report.sectionLabel} • ${report.examinees} analyzed results`; ws.getCell(3,1).font={color:{argb:'FF64748B'}}; ws.getCell(3,1).alignment={horizontal:'center'};
    ws.mergeCells(4,1,4,headers.length); ws.getCell(4,1).value = 'Difficulty: Easy ≥70% • Moderate 40–69% • Difficult <40% | Discrimination uses upper/lower 27% groups when enough data are available.'; ws.getCell(4,1).font={italic:true,size:10,color:{argb:'FF64748B'}}; ws.getCell(4,1).alignment={horizontal:'center',wrapText:true};

    const headerRow = ws.getRow(6); headerRow.values = headers;
    headerRow.height = 30;
    headerRow.eachCell(cell => {
      cell.font = { bold:true, color:{argb:'FFFFFFFF'} };
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF2563EB'} };
      cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
      cell.border = { top:{style:'thin',color:{argb:'FFB7C5DA'}}, left:{style:'thin',color:{argb:'FFB7C5DA'}}, bottom:{style:'thin',color:{argb:'FFB7C5DA'}}, right:{style:'thin',color:{argb:'FFB7C5DA'}} };
    });

    report.rows.forEach(rowData => {
      const values = [rowData.item, rowData.correctAnswer || '', rowData.correct, rowData.incorrect, rowData.blank, rowData.percentCorrect / 100, rowData.difficulty, rowData.discrimination == null ? '' : rowData.discrimination, rowData.discriminationInterpretation, ...report.choices.map(c => rowData.distribution[c] || 0)];
      const row = ws.addRow(values);
      row.eachCell(cell => {
        cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
        cell.border = { top:{style:'thin',color:{argb:'FFD6DEE9'}}, left:{style:'thin',color:{argb:'FFD6DEE9'}}, bottom:{style:'thin',color:{argb:'FFD6DEE9'}}, right:{style:'thin',color:{argb:'FFD6DEE9'}} };
      });
      row.getCell(6).numFmt = '0.00%';
      if (typeof rowData.discrimination === 'number') row.getCell(8).numFmt = '0.00';
      const fill = rowData.difficulty === 'Easy' ? 'FFE8F7ED' : rowData.difficulty === 'Difficult' ? 'FFFFE8E8' : 'FFFFF5D6';
      row.getCell(7).fill = { type:'pattern', pattern:'solid', fgColor:{argb:fill} };
      row.getCell(7).font = { bold:true, color:{argb: rowData.difficulty === 'Easy' ? 'FF166534' : rowData.difficulty === 'Difficult' ? 'FF991B1B' : 'FF92400E'} };
      row.getCell(2).fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFEFF6FF'} };
      row.getCell(2).font = { bold:true, color:{argb:'FF1D4ED8'} };
    });
    ws.autoFilter = { from: { row:6, column:1 }, to: { row:6 + report.rows.length, column:headers.length } };
    const widths = [8,8,11,11,9,12,14,15,18, ...report.choices.map(() => 10)];
    widths.forEach((width, i) => { ws.getColumn(i + 1).width = width; });
    ws.getColumn(9).width = 20;

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    const safeTitle = String(report.exam.title || 'exam').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'exam';
    link.download = `GradeDock-Item-Analysis-${safeTitle}.xlsx`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  async function exportResultsExcel() {
    if (!window.ExcelJS) { toast('Excel export library is not available. Reload GradeDock while online, then try again.', 'warn'); return; }
    const filtered = state.results.filter(r =>
      (!$('#resultClassFilter')?.value || r.class_id === $('#resultClassFilter').value) &&
      (!$('#resultExamFilter')?.value || r.exam_id === $('#resultExamFilter').value)
    );
    if (!filtered.length) { toast('There are no results to export for the current filter.', 'warn'); return; }

    processModal('Preparing Excel…', 'Formatting GradeDock results with clear headers, borders, colors, and readable dates.', '⇩');
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'GradeDock'; workbook.created = new Date();
      const ws = workbook.addWorksheet('Results', { views: [{ state:'frozen', ySplit:5 }] });
      const headers = ['Section','Grade Level','Student','Exam','Score','Total','Percentage','Review','Date'];
      ws.mergeCells(1,1,1,headers.length);
      const title = ws.getCell(1,1); title.value = 'GradeDock Results';
      title.font = { bold:true, size:18, color:{argb:'FFFFFFFF'} };
      title.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1D4ED8'} };
      title.alignment = { horizontal:'center', vertical:'middle' }; ws.getRow(1).height = 30;

      ws.mergeCells(2,1,2,headers.length);
      const filters = [];
      const classId = $('#resultClassFilter')?.value || '';
      const examId = $('#resultExamFilter')?.value || '';
      if (classId) { const c = state.classes.find(x => x.id === classId); if (c) filters.push(`Grade ${c.grade_level || '—'} • ${classLabel(c)}`); }
      if (examId) filters.push(examTitle(examId));
      ws.getCell(2,1).value = filters.length ? filters.join(' • ') : 'All saved results';
      ws.getCell(2,1).alignment = { horizontal:'center' }; ws.getCell(2,1).font = { italic:true, color:{argb:'FF64748B'} };

      const avgPct = filtered.reduce((sum,r) => sum + Number(r.percentage || 0), 0) / filtered.length;
      ws.mergeCells('A3:B3'); ws.getCell('A3').value = `Papers: ${filtered.length}`;
      ws.mergeCells('C3:D3'); ws.getCell('C3').value = `Average: ${avgPct.toFixed(2)}%`;
      ws.mergeCells('E3:F3'); ws.getCell('E3').value = `Generated: ${new Date().toLocaleDateString()}`;
      ['A3','C3','E3'].forEach(ref => { ws.getCell(ref).font={bold:true,color:{argb:'FF334155'}}; ws.getCell(ref).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEFF6FF'}}; ws.getCell(ref).alignment={horizontal:'center'}; });

      const headerRow = ws.getRow(5); headerRow.values = headers; headerRow.height = 28;
      headerRow.eachCell(cell => {
        cell.font = { bold:true, color:{argb:'FFFFFFFF'} };
        cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF2563EB'} };
        cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
        cell.border = { top:{style:'thin',color:{argb:'FF9FB3D1'}}, left:{style:'thin',color:{argb:'FF9FB3D1'}}, bottom:{style:'thin',color:{argb:'FF9FB3D1'}}, right:{style:'thin',color:{argb:'FF9FB3D1'}} };
      });

      filtered.forEach((r, idx) => {
        const cls = state.classes.find(c => c.id === r.class_id);
        const row = ws.addRow([
          resultClassLabel(r), r.grade_level || cls?.grade_level || '', r.student_name || 'Unnamed student',
          examTitle(r.exam_id), Number(r.score || 0), Number(r.total_items || 0), Number(r.percentage || 0)/100,
          Number(r.review_count || 0), r.created_at ? new Date(r.created_at) : ''
        ]);
        row.height = 22;
        row.eachCell(cell => {
          cell.border = { top:{style:'thin',color:{argb:'FFD6DEE9'}}, left:{style:'thin',color:{argb:'FFD6DEE9'}}, bottom:{style:'thin',color:{argb:'FFD6DEE9'}}, right:{style:'thin',color:{argb:'FFD6DEE9'}} };
          cell.alignment = { vertical:'middle', wrapText:true };
          if (idx % 2 === 1) cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF8FAFC'} };
        });
        row.getCell(5).alignment = row.getCell(6).alignment = row.getCell(7).alignment = row.getCell(8).alignment = { horizontal:'center', vertical:'middle' };
        row.getCell(7).numFmt = '0.00%';
        row.getCell(9).numFmt = 'mmm d, yyyy h:mm AM/PM';
        const pct = Number(r.percentage || 0);
        row.getCell(7).fill = { type:'pattern', pattern:'solid', fgColor:{argb: pct >= 75 ? 'FFE8F7ED' : pct >= 60 ? 'FFFFF5D6' : 'FFFFE8E8'} };
        row.getCell(7).font = { bold:true, color:{argb: pct >= 75 ? 'FF166534' : pct >= 60 ? 'FF92400E' : 'FF991B1B'} };
        if (Number(r.review_count || 0) > 0) { row.getCell(8).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF5D6'}}; row.getCell(8).font={bold:true,color:{argb:'FF92400E'}}; }
      });
      ws.autoFilter = { from:{row:5,column:1}, to:{row:5+filtered.length,column:headers.length} };
      [18,12,28,28,10,10,13,10,24].forEach((w,i)=>{ ws.getColumn(i+1).width=w; });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href=url; link.download='GradeDock-Results.xlsx'; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1200);
      closeModal(); toast('Formatted Excel results downloaded');
    } catch (err) { closeModal(); toast(err.message, 'warn'); }
  }

  function setCameraAssistStatus(status = {}, visible = true) {
    const box = $('#cameraScanAssist');
    if (!box) return;
    if (!visible) {
      box.classList.add('hidden');
      box.style.setProperty('display', 'none', 'important');
      return;
    }
    const stateName = status.state || 'searching';
    box.classList.remove('hidden', 'state-starting', 'state-searching', 'state-focus', 'state-warn', 'state-ready', 'state-reading');
    box.style.setProperty('display', 'grid', 'important');
    box.classList.add(`state-${stateName}`);
    const title = $('#cameraScanAssistTitle');
    const text = $('#cameraScanAssistText');
    const icon = $('#cameraScanAssistIcon');
    const label = box.querySelector('.camera-scan-assist-label');
    if (label) label.textContent = stateName === 'ready' ? 'GOOD TO SCAN' : stateName === 'reading' ? 'CHECKING' : 'NOT READY';
    if (title) title.textContent = status.title || 'Position the answer sheet';
    if (text) text.textContent = status.text || 'Keep the whole sheet visible and hold the camera steady.';
    if (icon) icon.textContent = stateName === 'ready' ? '✓' : stateName === 'reading' ? '⌗' : '!';

    if (stateName === 'ready' && cameraAssistLastState !== 'ready' && navigator.vibrate) {
      try { navigator.vibrate(35); } catch (_) {}
    }
    cameraAssistLastState = stateName;
  }

  function stopCameraAssist(hide = true) {
    if (cameraAssistTimer) clearInterval(cameraAssistTimer);
    cameraAssistTimer = null;
    cameraAssistBusy = false;
    cameraAssistLastState = '';
    if (hide) setCameraAssistStatus({}, false);
  }

  function updateCameraAssist() {
    if (cameraAssistBusy || !window.GradeDockScanner?.stream) return;
    const video = $('#cameraVideo');
    if (!video) return;
    cameraAssistBusy = true;
    try {
      const status = window.GradeDockScanner.inspectFrame(video);
      setCameraAssistStatus(status, true);
    } catch (err) {
      setCameraAssistStatus({ state: 'searching', title: 'Looking for answer sheet…', text: 'Keep the entire paper visible and hold the camera steady.' }, true);
    } finally {
      cameraAssistBusy = false;
    }
  }

  function startCameraAssist() {
    stopCameraAssist(false);
    setCameraAssistStatus({ state: 'starting', title: 'Not ready to scan', text: 'Show the whole answer sheet and hold the phone steady.' }, true);
    updateCameraAssist();
    cameraAssistTimer = setInterval(updateCameraAssist, 550);
  }

  function switchScanMode(mode) {
    $('#cameraTab').classList.toggle('active', mode === 'camera');
    $('#uploadTab').classList.toggle('active', mode === 'upload');
    $('#cameraMode').classList.toggle('active', mode === 'camera');
    $('#uploadMode').classList.toggle('active', mode === 'upload');
    if (mode === 'upload') {
      stopCameraAssist();
      window.GradeDockScanner.stopCamera($('#cameraVideo'));
      $('#cameraPlaceholder')?.classList.remove('hidden');
      if ($('#captureBtn')) $('#captureBtn').disabled = true;
    }
  }

  function bind() {
    $$('.auth-tab').forEach(b => b.onclick = () => {
      $$('.auth-tab').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      $$('.auth-form').forEach(f => f.classList.remove('active'));
      $(`#${b.dataset.authTab}Form`).classList.add('active');
    });

    $('#demoBtn').onclick = async () => { Store.useDemo(); await enterApp(); };

    $('#signinForm').onsubmit = async e => {
      e.preventDefault();
      processModal('Signing you in…', 'Opening your GradeDock teacher workspace.');
      try {
        await Store.signin({ email: $('#signinEmail').value, password: $('#signinPassword').value });
        await enterApp();
        closeModal();
        toast('Welcome back');
      } catch (err) { closeModal(); toast(err.message, 'warn'); }
    };

    $('#signupForm').onsubmit = async e => {
      e.preventDefault();
      processModal('Creating account…', 'Setting up your GradeDock teacher workspace.');
      try {
        const d = await Store.signup({ name: $('#signupName').value, email: $('#signupEmail').value, password: $('#signupPassword').value });
        if (d.session) { await enterApp(); closeModal(); toast('Account created'); }
        else { closeModal(); successModal('Check your email', 'Your GradeDock account was created. Confirm your email before signing in.'); }
      } catch (err) { closeModal(); toast(err.message, 'warn'); }
    };

    $$('.nav-item[data-page]').forEach(b => b.onclick = () => go(b.dataset.page));
    $$('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
    $$('[data-action="new-exam"]').forEach(b => b.onclick = newExam);
    const quickScanBtn = $('#quickScanBtn');
    if (quickScanBtn) quickScanBtn.onclick = () => go('scan');
    $('#newClassBtn').onclick = newClass;
    $('#newExamBtn').onclick = newExam;
    $('#downloadBlankExcelBtn').onclick = async () => {
      try {
        await window.GradeDockExcel.downloadTemplate({ title: '', question_count: 40, choice_count: 4 }, [], state.user?.full_name || 'Teacher');
        toast('Dynamic Excel answer-key template downloaded');
      } catch (err) { toast(err.message, 'warn'); }
    };
    $('#classSearch').oninput = renderClasses;
    $('#examSearch').oninput = renderExams;
    $('#resultClassFilter').onchange = renderResults;
    $('#resultExamFilter').onchange = renderResults;
    $('#exportResultsBtn').onclick = exportResultsExcel;
    $('#previewItemAnalysisBtn').onclick = previewItemAnalysis;
    $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
    $('#signoutBtn').onclick = async () => {
      stopCameraAssist();
      window.GradeDockScanner.stopCamera($('#cameraVideo'));
      processModal('Signing you out…', 'Closing your GradeDock workspace safely.');
      try {
        await Store.signout();
        setTimeout(() => location.reload(), 450);
      } catch (err) { closeModal(); toast(err.message, 'warn'); }
    };

    $('#cameraTab').onclick = () => switchScanMode('camera');
    $('#uploadTab').onclick = () => switchScanMode('upload');

    const syncCameraOrientationUI = () => {
      const orientation = window.GradeDockScanner?.orientation === 'portrait' ? 'portrait' : 'landscape';
      const stage = $('.camera-stage');
      const button = $('#cameraOrientationBtn');
      stage?.classList.toggle('camera-portrait', orientation === 'portrait');
      stage?.classList.toggle('camera-landscape', orientation === 'landscape');
      if (button) {
        button.textContent = orientation === 'portrait' ? '↕ Portrait' : '↔ Landscape';
        button.setAttribute('aria-pressed', orientation === 'portrait' ? 'true' : 'false');
        button.title = orientation === 'portrait' ? 'Switch camera view to landscape' : 'Switch camera view to portrait';
      }
    };
    window.GradeDockScanner?.setOrientation?.('landscape');
    syncCameraOrientationUI();

    $('#cameraOrientationBtn').onclick = async () => {
      if (!requireScanContext()) return;
      const video = $('#cameraVideo');
      const wasRunning = Boolean(window.GradeDockScanner?.stream);
      const orientation = window.GradeDockScanner.toggleOrientation();
      syncCameraOrientationUI();
      $('#scanStatusText').textContent = `${orientation === 'portrait' ? 'Portrait' : 'Landscape'} view selected.`;
      if (!wasRunning) return;
      const button = $('#cameraOrientationBtn');
      button.disabled = true;
      try {
        await window.GradeDockScanner.startCamera(video);
        $('#cameraPlaceholder').classList.add('hidden');
        $('#captureBtn').disabled = false;
        startCameraAssist();
        $('#scanStatusText').textContent = `${orientation === 'portrait' ? 'Portrait' : 'Landscape'} camera ready. Follow the live scanning message below the camera.`;
      } catch (err) {
        stopCameraAssist();
        $('#captureBtn').disabled = true;
        $('#scanStatusText').textContent = err.message;
        toast(err.message, 'warn');
      } finally {
        button.disabled = false;
      }
    };

    $('#startCameraBtn').onclick = async () => {
      const context = requireScanContext();
      if (!context) return;
      const startBtn = $('#startCameraBtn');
      const help = $('#cameraHelpText');
      startBtn.disabled = true;
      startBtn.textContent = 'Starting…';
      $('#scanStatusText').textContent = `Opening camera for ${classLabel(context.cls)}…`;
      try {
        await window.GradeDockScanner.startCamera($('#cameraVideo'));
        $('#cameraPlaceholder').classList.add('hidden');
        $('#captureBtn').disabled = false;
        startBtn.textContent = 'Restart camera';
        if (help) help.textContent = 'Need another method? You can take a photo with your device camera instead.';
        startCameraAssist();
        $('#scanStatusText').textContent = 'Camera ready. Follow the live scanning message below the camera.';
      } catch (err) {
        stopCameraAssist();
        startBtn.textContent = 'Start camera';
        $('#captureBtn').disabled = true;
        if (help) help.textContent = err.message;
        $('#scanStatusText').textContent = err.message;
        toast(err.message, 'warn');
      } finally {
        startBtn.disabled = false;
      }
    };

    $('#switchCameraBtn').onclick = async () => {
      if (!requireScanContext()) return;
      try {
        await window.GradeDockScanner.switchCamera($('#cameraVideo'));
        $('#cameraPlaceholder').classList.add('hidden');
        $('#captureBtn').disabled = false;
        startCameraAssist();
        $('#scanStatusText').textContent = 'Camera switched. Follow the live scanning message below the camera.';
      } catch (err) {
        stopCameraAssist();
        $('#scanStatusText').textContent = err.message;
        toast(err.message, 'warn');
      }
    };

    $('#captureBtn').onclick = async () => {
      if (!requireScanContext()) return;
      stopCameraAssist(false);
      setCameraAssistStatus({ state: 'reading', title: 'Reading answer sheet…', text: 'Keep the paper steady while GradeDock checks the markers and bubbles.' }, true);
      const captured = await window.GradeDockScanner.captureBestFrame($('#cameraVideo'), $('#captureCanvas'));
      const canvas = captured.canvas;
      const blob = captured.blob;
      const ok = await processCanvas(canvas, blob);
      if (ok) stopCameraAssist();
      else if (window.GradeDockScanner?.stream) startCameraAssist();
    };

    $('#cameraFallbackFile').onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      if (!requireScanContext()) { e.target.value = ''; return; }
      try {
        const canvas = await window.GradeDockScanner.fileToCanvas(file, $('#captureCanvas'));
        await processCanvas(canvas, file);
      } catch (err) {
        $('#scanStatusText').textContent = err.message;
        toast(err.message, 'warn');
      }
      e.target.value = '';
    };

    $('#scanFile').onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      if (!requireScanContext()) { e.target.value = ''; return; }
      const canvas = await window.GradeDockScanner.fileToCanvas(file, $('#captureCanvas'));
      processCanvas(canvas, file);
      e.target.value = '';
    };

    $('#dropZone').ondragover = e => { e.preventDefault(); e.currentTarget.classList.add('drag'); };
    $('#dropZone').ondragleave = e => e.currentTarget.classList.remove('drag');
    $('#dropZone').ondrop = async e => {
      e.preventDefault();
      e.currentTarget.classList.remove('drag');
      const file = e.dataTransfer.files[0];
      if (!file || !requireScanContext()) return;
      const canvas = await window.GradeDockScanner.fileToCanvas(file, $('#captureCanvas'));
      processCanvas(canvas, file);
    };

    $('#profileForm').onsubmit = async e => {
      e.preventDefault();
      await Store.updateProfile({ full_name: $('#profileName').value.trim(), school_name: $('#profileSchool').value.trim() });
      await refresh();
      successModal('Profile updated','Your changes were saved.');
    };
    $('#storeScansToggle').onchange = e => localStorage.setItem('gradedock_store_scans', e.target.checked ? '1' : '0');
  }

  async function enterApp() {
    $('#authView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    await refresh();
  }

  async function init() {
    bind();
    if (Store.configured) {
      const s = await Store.session();
      if (s?.user) await enterApp();
    }
  }

  init();
})();
