/* Mathside V24.32 — accessible teacher-only empty-state illustrations.
   Presentation only: no changes to creation, grading, records, storage or student UX. */
(() => {
  'use strict';
  const teacher = document.getElementById('teacherApp');
  if (!teacher) return;
  const artRoot = 'assets/empty-states/';
  const illustrations = [
    ['dashboardClassGrid', '.class-empty', 'classes'],
    ['classGrid', '.class-empty', 'classes'],
    ['assignmentList', '.assignment-empty', 'activities'],
    ['performanceTaskList', '.assignment-empty', 'performance'],
    ['submissionList', '.assignment-empty', 'submissions'],
    ['archiveList', '.assignment-empty', 'archive'],
    ['ctLibraryList', '.ct-library-empty', 'competencies'],
    ['ctDashboardContent', '.ct-empty', 'competencies'],
    ['ctDashboardContent', '.ct-single-student-empty', 'competencies'],
  ];
  function enhance(root, selector, subject) {
    root.querySelectorAll(selector).forEach(panel => {
      // Don't decorate error screens as if they were ordinary empty states.
      if (/unavailable|database is ready|error|failed/i.test(panel.textContent||'')) return;
      if (panel.querySelector(':scope > img.ms-empty-art')) return;
      const img = document.createElement('img');
      img.className = 'ms-empty-art';
      img.src = `${artRoot}${subject}.png`;
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.loading = 'lazy';
      img.decoding = 'async';
      panel.classList.add('ms-has-empty-art');
      panel.prepend(img);
    });
  }
  for (const [id, selector, subject] of illustrations) {
    const root = document.getElementById(id);
    if (!root) continue;
    const refresh = () => enhance(root, selector, subject);
    new MutationObserver(refresh).observe(root, {childList: true, subtree: true});
    refresh();
  }
  const recordBody = document.getElementById('msRecordsBody');
  if (recordBody) {
    const refreshRecord = () => {
      const first = recordBody.querySelector('tr:first-child > td:first-child');
      if (!first || first.querySelector('img.ms-empty-art')) return;
      if (recordBody.querySelectorAll('tr').length !== 1) return;
      const text = first.textContent || '';
      if (!/No classes yet|No students in this class yet/i.test(text)) return;
      const img = document.createElement('img');
      img.className='ms-empty-art'; img.src=artRoot+'records.png'; img.alt='';
      img.setAttribute('aria-hidden', 'true'); img.loading='lazy';
      first.prepend(img); first.classList.add('ms-has-empty-art','ms-record-empty-cell');
    };
    new MutationObserver(refreshRecord).observe(recordBody, {childList:true, subtree:true});
    refreshRecord();
  }
  window.MathsideTeacherEmptyArt = {artRoot, count:illustrations.length};
})();
