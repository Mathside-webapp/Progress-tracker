/* Mathside V30 — Teacher submissions live refresh and workspace persistence.
 * Never reload the document to check work. Uses targeted, paginated RLS reads.
 * The review modal, scoring and student-side behavior remain unchanged. */
(() => {
  'use strict';
  const REFRESH_INTERVAL_MS = 18000;
  const PAGE_SIZE = 400;
  const PREFS_KEY = 'mathside:teacher:workspace:v30';
  const VALID_VIEWS = new Set(['dashboard','classes','assignments','performance','submissions','records','competencies','archive']);
  const $ = id => document.getElementById(id);
  let busy = false;
  let lastSignature = '';
  let staleRender = false;
  let lastSyncAt = 0;
  let pendingToken = 0;
  const teacherActive = () => Boolean(state?.profile?.role === 'teacher' && state?.user?.id && !$('teacherApp')?.hidden);
  const submissionsOpen = () => teacherActive() && $('view-submissions')?.classList.contains('active');
  const modalOpen = () => Boolean($('reviewSubmissionModal')?.open);
  const getPrefs = () => { try { return JSON.parse(sessionStorage.getItem(PREFS_KEY) || 'null'); } catch { return null; } };
  const clearPrefs = () => { try { sessionStorage.removeItem(PREFS_KEY); } catch {} };
  function savePrefs() {
    if (!teacherActive()) return;
    const currentView=$('teacherApp')?.querySelector('.app-view.active')?.id?.replace('view-','') || 'dashboard';
    if (!VALID_VIEWS.has(currentView)) return;
    try {
      sessionStorage.setItem(PREFS_KEY, JSON.stringify({ userId:String(state.user.id),view:currentView, filters:window.MathsideSubmissionViewPreferences?.read?.()||null }));
    } catch {}
  }
  function status(message,kind='ready') {
    const node=$('msSubmissionSyncStatus');if(!node)return;
    node.textContent=message;node.dataset.state=kind;
  }
  function signature(rows) {
    // Include all server fields so grades, clears, resubmits, feedback and
    // solution-proof metadata can trigger updates. Sort by stable primary key.
    return JSON.stringify([...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id))));
  }
  function redrawIfNeeded(force=false) {
    if (!submissionsOpen() || modalOpen()) {staleRender=true;return;}
    if (!force && !staleRender) return;
    const y=window.scrollY;
    renderSubmissions();
    window.scrollTo({top:y,behavior:'instant'});
    staleRender=false;
    savePrefs();
  }
  async function fetchAllSubmissions(userId) {
    const ids=(state.assignments||[]).filter(a=>String(a.teacher_id||userId)===String(userId)).map(a=>a.id).filter(Boolean);
    if (!ids.length) return [];
    const rows=[];
    for (let i=0; i<ids.length; i+=40) {
      const chunk=ids.slice(i,i+40);
      for (let offset=0;;offset+=PAGE_SIZE) {
        const res=await db.from('mathside_submissions').select('*').in('assignment_id',chunk)
          .order('submitted_at',{ascending:false}).order('id',{ascending:true})
          .range(offset,offset+PAGE_SIZE-1);
        if (res.error) throw res.error;
        const batch=res.data||[];
        rows.push(...batch);
        if(batch.length<PAGE_SIZE) break;
      }
    }
    return rows;
  }
  async function refreshSubmissions({manual=false}={}) {
    if(!submissionsOpen() || !db || busy || document.hidden) return;
    if(window.MathsideSubmissionsV39?.isReviewOpen?.()) { if(manual) status('Review open · refresh resumes after closing'); return; }
    busy=true;
    const token=++pendingToken;
    const userId=String(state.user.id);
    const btn=$('msSubmissionRefreshBtn');if(btn)btn.disabled=true;
    if(manual)status('Checking for new work…','checking');
    try {
      const rows=await fetchAllSubmissions(userId);
      // A sign-out or account switch must never leak another account's data.
      if(token!==pendingToken || !teacherActive() || String(state.user.id)!==userId) return;
      if(window.MathsideSubmissionsV39?.isReviewOpen?.()) return;
      const next=signature(rows);
      const changed=next!==lastSignature;
      if(changed){state.submissions=rows;lastSignature=next;staleRender=true;}
      redrawIfNeeded(manual);
      if(changed) {
        // Keep the dashboard counters in sync without navigating away.
        window.MathsideTeacherDashboardV26?.render?.();
      }
      lastSyncAt=Date.now();
      status(changed?'New submission updates received':'Up to date');
    } catch(error) {
      if(teacherActive() && String(state.user.id)===userId){
        console.warn('Mathside submissions refresh skipped:',error?.message||error);
        status('Unable to sync · Retry','error');
      }
    } finally {
      busy=false;
      if(btn)btn.disabled=false;
    }
  }
  function checkIfOpen() {
    if(!submissionsOpen())return;
    if(staleRender && !modalOpen()) redrawIfNeeded(true);
    if(Date.now()-lastSyncAt>REFRESH_INTERVAL_MS-2000) refreshSubmissions();
  }
  // Avoid replacing the teacher's selected panel or filters during a refresh.
  const priorShow=showTeacherView;
  showTeacherView=function(view){
    const result=priorShow(view);
    savePrefs();
    if(view==='submissions') refreshSubmissions();
    return result;
  };
  const priorOpen=openTeacherApp;
  openTeacherApp=function(...args){
    const result=priorOpen(...args);
    const saved=getPrefs();
    lastSignature=signature(state.submissions||[]);
    if(saved?.userId===String(state.user?.id)) {
      if(saved.filters)window.MathsideSubmissionViewPreferences?.apply?.(saved.filters);
      if(VALID_VIEWS.has(saved.view))showTeacherView(saved.view);
    } else {
      clearPrefs();
    }
    if(submissionsOpen())refreshSubmissions();
    return result;
  };
  // Filter switches are handled by the original scripts; persist after they run.
  document.addEventListener('click',e=>{
    if(e.target.closest('[data-submission-type],[data-submission-section],[data-submission-review-filter],#submissionClearFilters')) queueMicrotask(savePrefs);
  });
  document.addEventListener('change',e=>{
    if(e.target.closest('#submissionActivityFilter,#submissionGroupMode,#submissionSort'))queueMicrotask(savePrefs);
  });
  $('msSubmissionRefreshBtn')?.addEventListener('click',()=>refreshSubmissions({manual:true}));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkIfOpen();});
  window.addEventListener('focus',checkIfOpen);
  // The network refresh is intentionally scoped to the Submissions view.
  window.setInterval(()=>{
    if(submissionsOpen() && !document.hidden){
      if(staleRender&&!modalOpen())redrawIfNeeded(true);
      refreshSubmissions();
    }
  },REFRESH_INTERVAL_MS);
  db?.auth?.onAuthStateChange?.((event)=>{
    if(event==='SIGNED_OUT') {
      clearPrefs();pendingToken++;lastSignature='';staleRender=false;lastSyncAt=0;
    }
  });
  window.MathsideLiveSubmissionsV30={refresh:()=>refreshSubmissions({manual:true}),savePrefs};
})();
