const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const config = window.MATHSIDE_CONFIG || {};
const isConfigured = Boolean(
  !window.MATHSIDE_PREVIEW && window.supabase &&
  /^https?:\/\//i.test(String(config.SUPABASE_URL || '')) &&
  !String(config.SUPABASE_URL || '').includes('YOUR-PROJECT') &&
  String(config.SUPABASE_PUBLISHABLE_KEY || '').length > 20 &&
  !String(config.SUPABASE_PUBLISHABLE_KEY || '').includes('REPLACE_ME')
);

const db = isConfigured
  ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

const state = {
  user: null,
  profile: null,
  sections: [],
  members: [],
  students: [],
  assignments: [],
  questions: [],
  keys: [],
  submissions: [],
  submissionAnswers: []
};

let authMode = 'signin';
let activeSectionId = null;
let questionCount = 0;
let activeStudentAssignment = null;
let activeSubmissionId = null;
let lastGeneratedAccounts = [];
let lastGeneratedSection = null;
let pendingStudentAction = null;
let pendingAssignmentDeleteId = null;
let pendingAssignmentDeleteIds = [];
let editingAssignmentId = null;
let editingAssignmentIds = [];
let missingAnswerResolve = null;
const selectedStudentIds = new Set();
const selectedAssignmentIds = new Set();
let studentTaskFilter = 'todo';
let studentTaskSort = 'newest';
let studentTaskSearch = '';
let activeStudentPanel = 'overview';
let studentGradeWatchTimer = null;
let studentLoginAlertsShownFor = null;
let activeRosterSectionId = null;
let studentRosterSearch = '';
let studentRosterSort = 'gender';
let submissionSectionId = 'all';
let submissionSort = 'gender';
let activeTrackingStudentId = null;
let loadingDepth = 0;
const signedUrlCache = new Map();

const messageQueue = [];
let messagePopupOpen = false;

function toast(message, type = 'orange', title = '') {
  messageQueue.push({ message: String(message || ''), type, title });
  showNextMessage();
}

function showNextMessage() {
  if (messagePopupOpen || !messageQueue.length) return;
  const dialog = $('#messageDialog');
  if (!dialog) return;
  const item = messageQueue.shift();
  messagePopupOpen = true;
  dialog.classList.remove('message-success', 'message-orange', 'message-danger');
  const messageClass = item.type === 'success' ? 'message-success' : item.type === 'danger' ? 'message-danger' : 'message-orange';
  dialog.classList.add(messageClass);
  $('#messageEyebrow').textContent = item.type === 'success' ? 'MATHSIDE • COMPLETE' : item.type === 'danger' ? 'MATHSIDE • URGENT' : 'MATHSIDE • NOTICE';
  $('#messageTitle').textContent = item.title || (item.type === 'success' ? 'Success' : item.type === 'danger' ? 'Deadline warning' : 'Please check');
  $('#messageText').textContent = item.message;
  $('#messageIcon').innerHTML = item.type === 'success'
    ? iconSvg('check', 'dynamic-icon')
    : iconSvg('assignment', 'dynamic-icon');
  if (!dialog.open) dialog.showModal();
}


function esc(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[ch]));
}


// Mathside math text format: plain text can include inline LaTeX as \( ... \).
// The Math Keyboard writes this format so existing database text columns do not need to change.
function richMath(value = '') {
  const source = String(value ?? '');
  const token = /\\\(([\s\S]*?)\\\)/g;
  let html = '';
  let last = 0;
  let match;
  while ((match = token.exec(source))) {
    html += esc(source.slice(last, match.index)).replace(/\n/g, '<br>');
    html += `<math-span class="inline-math">${esc(match[1])}</math-span>`;
    last = match.index + match[0].length;
  }
  html += esc(source.slice(last)).replace(/\n/g, '<br>');
  return html;
}


function iconSvg(name, className = 'dynamic-icon') {
  const paths = {
    people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v2"/>',
    assignment: '<path d="M6 3h9l3 3v15H6zM14 3v4h4M9 11h6M9 15h6"/>',
    calculator: '<path d="M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01"/>',
    inbox: '<path d="M4 5h16v14H4zM4 14h4l2 3h4l2-3h4"/>',
    check: '<path d="M5 12.5 10 17l9-10"/>',
    class: '<path d="M4 5h16v14H4zM8 5V3h8v2M8 10h8M8 14h5"/>'
  };
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.assignment}</svg>`;
}

function safeFileName(name = 'file') {
  return String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-100) || 'file';
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function startLoading(title, message) {
  loadingDepth += 1;
  const overlay = $('#appLoading');
  $('#loadingTitle').textContent = title;
  $('#loadingMessage').textContent = message;
  overlay.hidden = false;
  overlay.classList.remove('leaving');
}

async function stopLoading() {
  loadingDepth = Math.max(0, loadingDepth - 1);
  if (loadingDepth) return;
  const overlay = $('#appLoading');
  overlay.classList.add('leaving');
  await sleep(320);
  overlay.hidden = true;
  overlay.classList.remove('leaving');
}

async function withLoading(title, message, fn) {
  startLoading(title, message);
  const started = Date.now();
  try {
    return await fn();
  } finally {
    const elapsed = Date.now() - started;
    if (elapsed < 450) await sleep(450 - elapsed);
    await stopLoading();
  }
}

function openDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog && !dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog?.open) dialog.close();
}

$('#messageCloseBtn')?.addEventListener('click', () => {
  const dialog = $('#messageDialog');
  if (dialog?.open) dialog.close();
  messagePopupOpen = false;
  showNextMessage();
});

$('#messageDialog')?.addEventListener('cancel', event => {
  // Notifications only disappear when the user explicitly clicks Close.
  event.preventDefault();
});

function requireSupabase() {
  if (db) return true;
  toast('Connect Mathside first: edit js/config.js with your Supabase Project URL and publishable key.', 'orange');
  return false;
}

function resetState() {
  stopStudentGradeWatcher();
  studentLoginAlertsShownFor = null;
  state.user = null;
  state.profile = null;
  state.sections = [];
  state.members = [];
  state.students = [];
  state.assignments = [];
  state.questions = [];
  state.keys = [];
  state.submissions = [];
  state.submissionAnswers = [];
  lastGeneratedAccounts = [];
  lastGeneratedSection = null;
  pendingStudentAction = null;
  signedUrlCache.clear();
}

async function signedUrl(bucket, path, seconds = 3600) {
  if (!db || !path) return '';
  const key = `${bucket}:${path}`;
  if (signedUrlCache.has(key)) return signedUrlCache.get(key);
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, seconds);
  if (error) return '';
  const url = data?.signedUrl || '';
  if (url) signedUrlCache.set(key, url);
  return url;
}

document.addEventListener('error', async event => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  const path = image.dataset.assignmentStoragePath;
  if (!path || image.dataset.retryingAssignmentImage === 'done') return;
  if (image.dataset.retryingAssignmentImage === 'retrying') {
    image.dataset.retryingAssignmentImage = 'done';
    image.closest('.assignment-thumb')?.classList.add('image-fallback');
    image.hidden = true;
    return;
  }
  image.dataset.retryingAssignmentImage = 'retrying';
  signedUrlCache.delete(`mathside-assignment-images:${path}`);
  const freshUrl = await signedUrl('mathside-assignment-images', path, 3600);
  if (freshUrl) {
    image.src = freshUrl;
  } else {
    image.dataset.retryingAssignmentImage = 'done';
    image.closest('.assignment-thumb')?.classList.add('image-fallback');
    image.hidden = true;
  }
}, true);

function sectionById(id) { return state.sections.find(s => s.id === id); }
function studentById(id) { return state.students.find(s => s.id === id); }
function assignmentById(id) { return state.assignments.find(a => a.id === id); }
function questionsFor(assignmentId) { return state.questions.filter(q => q.assignment_id === assignmentId).sort((a,b) => a.position-b.position); }
function keyFor(questionId) { return state.keys.find(k => k.question_id === questionId); }
function submissionFor(assignmentId, studentId = state.user?.id) { return state.submissions.find(s => s.assignment_id === assignmentId && s.student_id === studentId); }
function sectionStudentIds(sectionId) { return state.members.filter(m => m.section_id === sectionId).map(m => m.student_id); }
function studentsForSection(sectionId) {
  const ids = new Set(sectionStudentIds(sectionId));
  return state.students.filter(s => ids.has(s.id)).sort((a,b) => a.display_name.localeCompare(b.display_name));
}
function sectionLabel(section) { return section ? `${section.name} · Grade ${section.grade_level}` : 'Unknown class'; }
function totalPoints(assignmentId) { return questionsFor(assignmentId).reduce((sum, q) => sum + Number(q.max_points || 0), 0); }


function formatDeadlineDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    hour: 'numeric', minute: '2-digit'
  }).format(date);
}

function deadlineRelativeLabel(value) {
  if (!value) return '';
  const ms = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(ms)) return '';
  const abs = Math.abs(ms);
  const hours = Math.max(1, Math.round(abs / (60 * 60 * 1000)));
  if (ms < 0) return hours < 24 ? `${hours}h overdue` : `${Math.max(1, Math.round(hours / 24))}d overdue`;
  return hours < 24 ? `${hours}h left` : `${Math.max(1, Math.round(hours / 24))}d left`;
}

function reminderLabel(hours) {
  const value = Number(hours || 0);
  if (value === 24) return '1 day before';
  if (value === 48) return '2 days before';
  if (value === 72) return '3 days before';
  return 'No reminder';
}

function studentUrgentAssignments() {
  const now = Date.now();
  return state.assignments
    .filter(a => !submissionFor(a.id) && a.due_at && Number(a.reminder_hours_before || 0) > 0)
    .filter(a => {
      const due = new Date(a.due_at).getTime();
      const reminderMs = Number(a.reminder_hours_before || 0) * 60 * 60 * 1000;
      return Number.isFinite(due) && reminderMs > 0 && due <= now + reminderMs;
    })
    .sort((a,b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
}

function notifyStudentDeadlineOnLogin() {
  const urgent = studentUrgentAssignments();
  if (!urgent.length) return;
  const overdue = urgent.filter(a => new Date(a.due_at).getTime() < Date.now()).length;
  const preview = urgent.slice(0, 4).map(a => `• ${a.title} — ${formatDeadlineDate(a.due_at)} (${deadlineRelativeLabel(a.due_at)})`).join('\n');
  const more = urgent.length > 4 ? `\n• +${urgent.length - 4} more activity${urgent.length - 4 === 1 ? '' : 'ies'}` : '';
  const lead = overdue
    ? `You have ${urgent.length} unfinished activity${urgent.length === 1 ? '' : 'ies'} needing attention, including ${overdue} past the deadline.`
    : `You have ${urgent.length} unfinished activity${urgent.length === 1 ? '' : 'ies'} approaching the deadline.`;
  toast(`${lead}\n\n${preview}${more}\n\nSubmit your work before time runs out.`, 'danger', overdue ? 'Overdue activity warning' : 'Deadline approaching');
}

function gradeNoticeStorageKey() {
  return `mathside_seen_grades_${state.user?.id || 'student'}`;
}

function readSeenGradeNotices() {
  try { return JSON.parse(localStorage.getItem(gradeNoticeStorageKey()) || '{}') || {}; }
  catch { return {}; }
}

function writeSeenGradeNotices(value) {
  try { localStorage.setItem(gradeNoticeStorageKey(), JSON.stringify(value)); } catch {}
}

function notifyUnseenStudentGrades() {
  if (!state.user || state.profile?.role !== 'student') return;
  const seen = readSeenGradeNotices();
  const graded = state.submissions
    .filter(s => s.status === 'graded' && s.graded_at)
    .sort((a,b) => new Date(a.graded_at).getTime() - new Date(b.graded_at).getTime());
  const unseen = graded.filter(s => seen[s.id] !== String(s.graded_at));
  if (!unseen.length) return;

  unseen.forEach(submission => {
    const assignment = assignmentById(submission.assignment_id);
    const total = assignment ? totalPoints(assignment.id) : 0;
    const score = Number(submission.teacher_score ?? submission.auto_score ?? 0);
    const feedback = String(submission.feedback || '').trim();
    const message = `${assignment?.title || 'Your activity'} has been checked and graded.\n\nScore: ${score}/${total}${feedback ? `\nTeacher feedback: ${feedback}` : ''}`;
    toast(message, 'success', 'Activity graded');
    seen[submission.id] = String(submission.graded_at);
  });
  writeSeenGradeNotices(seen);
}

async function checkStudentGradeUpdates() {
  if (!db || state.profile?.role !== 'student' || !state.user?.id) return;
  try {
    // Reload the student workspace so newly scheduled assignments also appear
    // automatically after Supabase Cron publishes them.
    await loadStudentData();
    notifyUnseenStudentGrades();
    renderStudentDashboard();
    showStudentPanel(activeStudentPanel);
  } catch (error) {
    console.warn('Student workspace refresh skipped:', error?.message || error);
  }
}

function startStudentGradeWatcher() {
  stopStudentGradeWatcher();
  studentGradeWatchTimer = window.setInterval(checkStudentGradeUpdates, 60000);
}

function stopStudentGradeWatcher() {
  if (studentGradeWatchTimer) window.clearInterval(studentGradeWatchTimer);
  studentGradeWatchTimer = null;
}

// ---------- PUBLIC NAV ----------
const menuToggle = $('#menuToggle');
const mainNav = $('#mainNav');
menuToggle.addEventListener('click', () => mainNav.classList.toggle('mobile-open'));
$$('.main-nav a').forEach(link => link.addEventListener('click', () => mainNav.classList.remove('mobile-open')));

// ---------- AUTH ----------
function setAuthMode(mode, requestedRole = '') {
  authMode = mode;
  const signup = mode === 'signup';
  $('#authHeading').textContent = signup ? 'Create teacher account' : 'Sign in';
  $('#authCopy').textContent = signup
    ? 'Use the teacher email that you added to the Mathside teacher allowlist in Supabase.'
    : 'Teachers use email. Students use the username generated by their teacher.';
  $('#nameField').hidden = !signup;
  $('#roleField').hidden = true;
  $('#roleSelect').value = requestedRole || 'teacher';
  $('#authSubmit').textContent = signup ? 'Create teacher account' : 'Sign in';
  $('#switchAuth').textContent = signup ? 'Already have an account? Sign in' : 'Teacher without an account? Create one';
}

$$('[data-open-auth]').forEach(btn => {
  btn.addEventListener('click', () => {
    setAuthMode(btn.dataset.openAuth || 'signin', btn.dataset.role || '');
    openDialog('authDialog');
  });
});

$('#switchAuth').addEventListener('click', () => setAuthMode(authMode === 'signin' ? 'signup' : 'signin'));

$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!requireSupabase()) return;

  const form = new FormData(event.currentTarget);
  const login = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');
  const name = String(form.get('name') || '').trim();

  if (authMode === 'signup') {
    if (!login.includes('@')) return toast('Teacher accounts must use an email address.', 'orange');
    try {
      await withLoading('Creating your Mathside…', 'Connecting your teacher workspace to Supabase.', async () => {
        const { data, error } = await db.auth.signUp({
          email: login,
          password,
          options: { data: { display_name: name || login.split('@')[0] } }
        });
        if (error) throw error;
        closeDialog('authDialog');
        if (data.session) {
          await routeAuthenticatedUser();
          toast('Teacher account created.', 'success');
        } else {
          toast('Account created. Check your email to confirm it, then sign in.', 'success');
        }
      });
    } catch (error) {
      console.error(error);
      toast(error.message || 'Could not create the teacher account. Make sure this email is in the teacher allowlist.', 'orange');
    }
    return;
  }

  try {
    await withLoading('Signing you in…', 'Opening your Mathematics classroom.', async () => {
      let authEmail = login;
      if (!login.includes('@')) {
        const { data, error } = await db.rpc('mathside_resolve_login', { p_username: login.toLowerCase() });
        if (error) throw error;
        if (!data) throw new Error('Student username or password is incorrect.');
        authEmail = data;
      }
      const { error } = await db.auth.signInWithPassword({ email: authEmail, password });
      if (error) throw error;
      closeDialog('authDialog');
      await routeAuthenticatedUser();
    });
  } catch (error) {
    console.error(error);
    toast(error.message || 'Could not sign in.', 'orange');
  }
});

$$('[data-close]').forEach(btn => btn.addEventListener('click', () => closeDialog(btn.dataset.close)));
// Dialogs no longer close when the user clicks the shaded backdrop.
// Action dialogs close only through their explicit X/Cancel/Done controls,
// while notification popups close only through their Close button.

async function loadCurrentIdentity() {
  const { data: userData, error: userError } = await db.auth.getUser();
  if (userError || !userData?.user) throw userError || new Error('Your session is no longer valid.');
  state.user = userData.user;
  const { data: profile, error: profileError } = await db
    .from('mathside_profiles')
    .select('id,display_name,role,username,gender,grade_level,avatar_path,created_by_teacher')
    .eq('id', state.user.id)
    .single();
  if (profileError) throw profileError;
  state.profile = profile;
}

async function routeAuthenticatedUser() {
  if (!db) return;
  await loadCurrentIdentity();
  if (state.profile.role === 'teacher') {
    await loadTeacherData();
    openTeacherApp();
    return;
  }
  if (state.profile.role === 'student') {
    await loadStudentData();
    openStudentApp();
    return;
  }
  throw new Error('This account has no valid Mathside role.');
}

async function signOut(message) {
  if (!db) returnPublic();
  try {
    await withLoading('Signing you out…', message, async () => {
      const { error } = await db.auth.signOut();
      if (error) throw error;
      resetState();
      returnPublic();
    });
    toast('Signed out successfully.', 'success');
  } catch (error) {
    console.error(error);
    toast(error.message || 'Could not sign out.', 'orange');
  }
}

// ---------- APP SHELLS ----------
function openTeacherApp() {
  closeTeacherSidebar?.();
  stopStudentGradeWatcher();
  $('#publicSite').hidden = true;
  $('#studentApp').hidden = true;
  $('#teacherApp').hidden = false;
  $('#teacherName').textContent = state.profile?.display_name || 'Teacher';
  renderTeacher();
}

function openStudentApp() {
  $('#publicSite').hidden = true;
  $('#teacherApp').hidden = true;
  $('#studentApp').hidden = false;
  $('#studentWelcome').textContent = `Hi, ${state.profile?.display_name || 'Student'}`;
  studentTaskFilter = 'todo';
  studentTaskSort = 'newest';
  studentTaskSearch = '';
  activeStudentPanel = 'overview';
  showStudentPanel('overview');
  renderStudentDashboard();
  startStudentGradeWatcher();
  if (studentLoginAlertsShownFor !== state.user?.id) {
    studentLoginAlertsShownFor = state.user?.id || null;
    notifyStudentDeadlineOnLogin();
    notifyUnseenStudentGrades();
  }
}

function returnPublic() {
  closeTeacherSidebar?.();
  $('#teacherApp').hidden = true;
  $('#studentApp').hidden = true;
  $('#publicSite').hidden = false;
}

$('#teacherSignout').addEventListener('click', () => signOut('Saving your Mathside workspace.'));
$('#studentSignout').addEventListener('click', () => signOut('See you next time.'));

// ---------- DATA LOADING ----------
async function loadTeacherData() {
  signedUrlCache.clear();
  const teacherId = state.user.id;
  const [sectionsRes, membersRes, studentsRes, assignmentsRes] = await Promise.all([
    db.from('mathside_sections').select('*').eq('teacher_id', teacherId).order('grade_level').order('name'),
    db.from('mathside_section_members').select('section_id,student_id,joined_at'),
    db.from('mathside_profiles').select('id,display_name,role,username,gender,grade_level,avatar_path').eq('role', 'student').order('display_name'),
    db.from('mathside_assignments').select('*').eq('teacher_id', teacherId).order('created_at', { ascending: false })
  ]);
  for (const result of [sectionsRes, membersRes, studentsRes, assignmentsRes]) if (result.error) throw result.error;
  state.sections = sectionsRes.data || [];
  state.members = membersRes.data || [];
  state.students = studentsRes.data || [];
  state.assignments = assignmentsRes.data || [];

  const assignmentIds = state.assignments.map(a => a.id);
  state.questions = [];
  state.keys = [];
  state.submissions = [];
  if (assignmentIds.length) {
    const [questionsRes, submissionsRes] = await Promise.all([
      db.from('mathside_questions').select('*').in('assignment_id', assignmentIds).order('position'),
      db.from('mathside_submissions').select('*').in('assignment_id', assignmentIds).order('submitted_at', { ascending: false })
    ]);
    if (questionsRes.error) throw questionsRes.error;
    if (submissionsRes.error) throw submissionsRes.error;
    state.questions = questionsRes.data || [];
    state.submissions = submissionsRes.data || [];
    const questionIds = state.questions.map(q => q.id);
    if (questionIds.length) {
      const keysRes = await db.from('mathside_question_keys').select('*').in('question_id', questionIds);
      if (keysRes.error) throw keysRes.error;
      state.keys = keysRes.data || [];
    }
  }

  await Promise.all(state.assignments.map(async assignment => {
    assignment.image_url = assignment.image_path
      ? await signedUrl('mathside-assignment-images', assignment.image_path)
      : '';
  }));
}

async function loadStudentData() {
  signedUrlCache.clear();
  const studentId = state.user.id;
  const [sectionsRes, membersRes, assignmentsRes, submissionsRes] = await Promise.all([
    db.from('mathside_sections').select('*').order('grade_level').order('name'),
    db.from('mathside_section_members').select('*').eq('student_id', studentId),
    db.from('mathside_assignments').select('*').eq('status', 'published').order('created_at', { ascending: false }),
    db.from('mathside_submissions').select('*').eq('student_id', studentId).order('submitted_at', { ascending: false })
  ]);
  for (const result of [sectionsRes, membersRes, assignmentsRes, submissionsRes]) if (result.error) throw result.error;
  state.sections = sectionsRes.data || [];
  state.assignments = assignmentsRes.data || [];
  state.submissions = submissionsRes.data || [];
  state.students = [state.profile];
  state.members = membersRes.data || [];
  state.keys = [];
  state.submissionAnswers = [];

  const assignmentIds = state.assignments.map(a => a.id);
  state.questions = [];
  if (assignmentIds.length) {
    const questionsRes = await db.from('mathside_questions').select('*').in('assignment_id', assignmentIds).order('position');
    if (questionsRes.error) throw questionsRes.error;
    state.questions = questionsRes.data || [];
  }

  const submissionIds = state.submissions.map(s => s.id);
  if (submissionIds.length) {
    const answersRes = await db.from('mathside_submission_answers').select('*').in('submission_id', submissionIds);
    if (answersRes.error) throw answersRes.error;
    state.submissionAnswers = answersRes.data || [];
  }

  await Promise.all(state.assignments.map(async assignment => {
    assignment.image_url = assignment.image_path
      ? await signedUrl('mathside-assignment-images', assignment.image_path)
      : '';
  }));
}

async function refreshTeacher() {
  await loadTeacherData();
  renderTeacher();
}

async function refreshStudent() {
  await loadStudentData();
  renderStudentDashboard();
  showStudentPanel(activeStudentPanel);
}

// ---------- TEACHER NAV ----------
function showTeacherView(view) {
  $$('.app-view').forEach(v => v.classList.remove('active'));
  $(`#view-${view}`)?.classList.add('active');
  $$('.side-link[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  const titleMap = { dashboard: 'Dashboard', classes: 'Classes', assignments: 'Assignments', submissions: 'Submissions' };
  $('#teacherPageTitle').textContent = titleMap[view] || 'Mathside';
  if (view === 'classes') renderClasses();
  if (view === 'assignments') renderAssignments();
  if (view === 'submissions') renderSubmissions();
  window.MathsideV10?.renderTeacherView?.(view);
}

function setTeacherSidebar(open) {
  const sidebar = $('#teacherSidebar') || $('.sidebar');
  const backdrop = $('#teacherSidebarBackdrop');
  const toggle = $('#teacherMenuBtn');
  if (!sidebar) return;
  sidebar.classList.toggle('open', Boolean(open));
  backdrop?.classList.toggle('open', Boolean(open));
  document.body.classList.toggle('teacher-menu-open', Boolean(open));
  toggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function closeTeacherSidebar() { setTeacherSidebar(false); }

$$('[data-view]').forEach(btn => btn.addEventListener('click', () => {
  showTeacherView(btn.dataset.view);
  closeTeacherSidebar();
}));
$$('[data-go-view]').forEach(btn => btn.addEventListener('click', () => {
  showTeacherView(btn.dataset.goView);
  closeTeacherSidebar();
}));
$('#teacherMenuBtn')?.setAttribute('aria-expanded', 'false');
$('#teacherMenuBtn')?.addEventListener('click', () => setTeacherSidebar(!($('#teacherSidebar') || $('.sidebar'))?.classList.contains('open')));
$('#teacherMenuClose')?.addEventListener('click', closeTeacherSidebar);
$('#teacherSidebarBackdrop')?.addEventListener('click', closeTeacherSidebar);
window.addEventListener('resize', () => { if (window.innerWidth > 780) closeTeacherSidebar(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeTeacherSidebar(); });

function classCard(section, dashboard = false) {
  const studentCount = studentsForSection(section.id).length;
  const assignmentCount = state.assignments.filter(a => a.section_id === section.id).length;
  return `<article class="class-card" data-class-card-id="${section.id}" ${dashboard ? 'data-dashboard-class="true"' : ''}>
    <div class="class-card-top">
      <div class="class-card-heading">
        <span class="class-icon">${iconSvg('class', 'class-card-icon')}</span>
        <div class="class-card-copy"><small>CLASS</small><h3>${esc(section.name)}</h3></div>
      </div>
      <span class="grade-pill">Grade ${esc(section.grade_level)}</span>
    </div>
    <footer><span><b>${studentCount}</b> student${studentCount === 1 ? '' : 's'}</span><span>${assignmentCount} assignment${assignmentCount === 1 ? '' : 's'}</span></footer>
    <div class="class-card-actions">
      <button class="btn btn-light class-view-students-btn" type="button" data-view-class-students="${section.id}">${iconSvg('people', 'btn-icon')}View students</button>
    </div>
  </article>`;
}

function renderTeacher() {
  const uniqueStudents = new Set(state.members.map(m => m.student_id)).size;
  $('#studentTotal').textContent = uniqueStudents;
  $('#classTotal').textContent = state.sections.length;
  $('#assignmentTotal').textContent = groupedAssignmentsForDisplay().length;
  $('#dashboardClassGrid').innerHTML = state.sections.length
    ? state.sections.map(section => classCard(section, true)).join('')
    : `<div class="class-empty"><span>${iconSvg('class', 'empty-icon')}</span><h3>No classes yet</h3><p>Create your first class and choose its grade level.</p><button class="btn btn-orange" data-empty-create-class>Create class</button></div>`;
  renderClasses();
  renderAssignments();
  renderSubmissions();
  populateAssignmentSections();
}

function renderClasses() {
  const grid = $('#classGrid');
  grid.innerHTML = state.sections.length
    ? state.sections.map(section => classCard(section)).join('')
    : `<div class="class-empty"><span>${iconSvg('class', 'empty-icon')}</span><h3>No classes yet</h3><p>Click Create class, enter the class name, and choose its grade.</p></div>`;
}

document.addEventListener('click', event => {
  const viewStudentsBtn = event.target.closest('[data-view-class-students]');
  if (viewStudentsBtn) {
    const sectionId = viewStudentsBtn.dataset.viewClassStudents;
    activeSectionId = sectionId;
    openClassStudentsModal(sectionId);
    return;
  }
  if (event.target.closest('[data-empty-create-class]')) openSectionModal();
});

function rosterSortStudents(students) {
  const list = [...students];
  if (studentRosterSort === 'gender') {
    const genderOrder = { Male: 0, Female: 1, 'Prefer not to say': 2, 'Not specified': 3 };
    return list.sort((a, b) => {
      const ga = ['Female','Male','Prefer not to say'].includes(a.gender) ? a.gender : 'Not specified';
      const gb = ['Female','Male','Prefer not to say'].includes(b.gender) ? b.gender : 'Not specified';
      const g = (genderOrder[ga] ?? 9) - (genderOrder[gb] ?? 9);
      return g || String(a.display_name || '').localeCompare(String(b.display_name || ''), undefined, { sensitivity: 'base' });
    });
  }
  return list.sort((a, b) => String(a.display_name || '').localeCompare(String(b.display_name || ''), undefined, { sensitivity: 'base' }));
}

function currentRosterStudents() {
  if (!activeRosterSectionId) return [];
  const query = studentRosterSearch.trim().toLowerCase();
  const filtered = studentsForSection(activeRosterSectionId).filter(student => {
    if (!query) return true;
    return `${student.display_name || ''} ${student.username || ''} ${student.gender || ''}`.toLowerCase().includes(query);
  });
  return rosterSortStudents(filtered);
}

function updateRosterBulkUI() {
  const shown = currentRosterStudents();
  const shownIds = shown.map(student => student.id);
  const count = shownIds.filter(id => selectedStudentIds.has(id)).length;
  $('#selectedStudentCount') && ($('#selectedStudentCount').textContent = `${count} selected`);
  $('#bulkRemoveStudentsBtn') && ($('#bulkRemoveStudentsBtn').disabled = count === 0);
  $('#bulkDeleteStudentsBtn') && ($('#bulkDeleteStudentsBtn').disabled = count === 0);
  const selectAll = $('#selectAllStudents');
  if (selectAll) {
    selectAll.checked = count > 0 && count === shownIds.length;
    selectAll.indeterminate = count > 0 && count < shownIds.length;
  }
}

function renderClassStudentsModal() {
  const section = sectionById(activeRosterSectionId);
  const list = $('#classStudentsList');
  if (!section || !list) return;
  const allStudents = studentsForSection(section.id);
  const students = currentRosterStudents();
  const maleCount = allStudents.filter(student => student.gender === 'Male').length;
  const femaleCount = allStudents.filter(student => student.gender === 'Female').length;
  $('#classStudentsTitle').textContent = section.name;
  $('#classStudentsMeta').textContent = `Grade ${section.grade_level} · ${allStudents.length} students · ${maleCount} male · ${femaleCount} female`;
  if (!students.length) {
    list.innerHTML = `<div class="assignment-empty">${studentRosterSearch ? 'No student matches your search.' : 'No students are enrolled in this section yet.'}</div>`;
    updateRosterBulkUI();
    return;
  }
  list.innerHTML = students.map(student => {
    const assignmentCount = state.assignments.filter(a => a.section_id === section.id).length;
    const submissions = state.submissions.filter(sub => sub.student_id === student.id && assignmentById(sub.assignment_id)?.section_id === section.id);
    const graded = submissions.filter(sub => sub.status === 'graded').length;
    const genderClass = student.gender === 'Male' ? 'gender-male' : student.gender === 'Female' ? 'gender-female' : 'gender-other';
    return `<article class="roster-student-card ${genderClass} ${selectedStudentIds.has(student.id) ? 'is-selected' : ''}">
      <label class="roster-check"><input class="row-check" type="checkbox" data-select-student="${student.id}" ${selectedStudentIds.has(student.id) ? 'checked' : ''}><span class="sr-only">Select ${esc(student.display_name)}</span></label>
      <button class="roster-student-main" type="button" data-track-student="${student.id}">
        <span class="roster-avatar">${esc((student.display_name || 'S').trim().charAt(0).toUpperCase())}</span>
        <span class="roster-student-copy"><b>${esc(student.display_name)}</b><small>${esc(student.username || 'No username')} · ${esc(student.gender || 'Not specified')}</small></span>
      </button>
      <div class="roster-progress"><span>${submissions.length}/${assignmentCount} submitted</span><span>${graded} graded</span></div>
      <div class="roster-student-actions"><button class="btn btn-light btn-small" type="button" data-track-student="${student.id}">Track</button><button class="table-delete" type="button" data-delete-student="${student.id}">Delete</button></div>
    </article>`;
  }).join('');
  updateRosterBulkUI();
}

function openClassStudentsModal(sectionId) {
  const section = sectionById(sectionId);
  if (!section) return;
  activeRosterSectionId = sectionId;
  studentRosterSearch = '';
  studentRosterSort = 'gender';
  selectedStudentIds.clear();
  $('#classStudentSearch') && ($('#classStudentSearch').value = '');
  $('#classStudentSort') && ($('#classStudentSort').value = 'gender');
  renderClassStudentsModal();
  openDialog('classStudentsModal');
}

$('#rosterAddStudentsBtn')?.addEventListener('click', () => {
  if (!activeRosterSectionId) return;
  const sectionId = activeRosterSectionId;
  closeDialog('classStudentsModal');
  openStudentModal(sectionId);
});

$('#classStudentSearch')?.addEventListener('input', event => {
  studentRosterSearch = event.currentTarget.value || '';
  renderClassStudentsModal();
});
$('#classStudentSort')?.addEventListener('change', event => {
  studentRosterSort = event.currentTarget.value || 'name';
  renderClassStudentsModal();
});
$('#classStudentsList')?.addEventListener('change', event => {
  const check = event.target.closest('[data-select-student]');
  if (!check) return;
  if (check.checked) selectedStudentIds.add(check.dataset.selectStudent);
  else selectedStudentIds.delete(check.dataset.selectStudent);
  check.closest('.roster-student-card')?.classList.toggle('is-selected', check.checked);
  updateRosterBulkUI();
});
$('#selectAllStudents')?.addEventListener('change', event => {
  const checked = event.currentTarget.checked;
  currentRosterStudents().forEach(student => {
    if (checked) selectedStudentIds.add(student.id);
    else selectedStudentIds.delete(student.id);
  });
  renderClassStudentsModal();
});
$('#classStudentsList')?.addEventListener('click', event => {
  const deleteBtn = event.target.closest('[data-delete-student]');
  if (deleteBtn) {
    openDeleteStudentModal(activeRosterSectionId, deleteBtn.dataset.deleteStudent);
    return;
  }
  const trackBtn = event.target.closest('[data-track-student]');
  if (trackBtn) openStudentTrackingModal(activeRosterSectionId, trackBtn.dataset.trackStudent);
});
$('#bulkRemoveStudentsBtn')?.addEventListener('click', () => {
  const ids = studentsForSection(activeRosterSectionId).map(s => s.id).filter(id => selectedStudentIds.has(id));
  if (ids.length) openDeleteStudentModal(activeRosterSectionId, ids);
});
$('#bulkDeleteStudentsBtn')?.addEventListener('click', () => {
  const ids = studentsForSection(activeRosterSectionId).map(s => s.id).filter(id => selectedStudentIds.has(id));
  if (ids.length) openDeleteStudentModal(activeRosterSectionId, ids);
});

function renderStudentTracking(sectionId, studentId) {
  const section = sectionById(sectionId);
  const student = studentById(studentId);
  if (!section || !student) return;
  const assignments = state.assignments.filter(a => a.section_id === sectionId && a.status === 'published').sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const submissions = state.submissions.filter(sub => sub.student_id === studentId && assignments.some(a => a.id === sub.assignment_id));
  const graded = submissions.filter(sub => sub.status === 'graded').length;
  $('#studentTrackingName').textContent = student.display_name || 'Student';
  $('#studentTrackingMeta').textContent = `${sectionLabel(section)} · ${student.gender || 'Not specified'} · ${student.username || 'No username'}`;
  $('#studentTrackingStats').innerHTML = `<article><b>${assignments.length}</b><span>Assigned</span></article><article><b>${submissions.length}</b><span>Submitted</span></article><article><b>${graded}</b><span>Graded</span></article><article><b>${Math.max(0, assignments.length - submissions.length)}</b><span>To do</span></article>`;
  const list = $('#studentTrackingList');
  if (!assignments.length) {
    list.innerHTML = '<div class="assignment-empty">No assignments have been posted to this section yet.</div>';
    return;
  }
  list.innerHTML = assignments.map(assignment => {
    const submission = submissions.find(sub => sub.assignment_id === assignment.id);
    const total = totalPoints(assignment.id);
    const score = submission ? Number(submission.status === 'graded' ? (submission.teacher_score ?? submission.auto_score ?? 0) : (submission.auto_score || 0)) : 0;
    const status = submission ? (submission.status === 'graded' ? 'Graded' : 'Submitted') : 'Not submitted';
    return `<article class="tracking-assignment-card ${submission ? 'has-submission' : 'missing-submission'}"><div><span class="student-status ${submission?.status === 'graded' ? 'status-graded' : submission ? 'status-submitted' : ''}">${status}</span><h4>${esc(assignment.title)}</h4><p>${assignment.due_at ? `Deadline ${esc(formatDeadlineDate(assignment.due_at))}` : 'No deadline'}</p></div><div class="tracking-assignment-meta">${submission ? `<b>${score}/${total}</b><small>Submitted ${esc(formatStudentDate(submission.submitted_at) || '')}</small>` : '<b>—</b><small>No response yet</small>'}</div>${submission ? `<button class="btn btn-light btn-small" type="button" data-track-review-submission="${submission.id}">Preview submission</button>` : '<span></span>'}</article>`;
  }).join('');
}

function openStudentTrackingModal(sectionId, studentId) {
  activeTrackingStudentId = studentId;
  renderStudentTracking(sectionId, studentId);
  openDialog('studentTrackingModal');
}

$('#studentTrackingList')?.addEventListener('click', async event => {
  const btn = event.target.closest('[data-track-review-submission]');
  if (!btn) return;
  closeDialog('studentTrackingModal');
  await openSubmissionReview(btn.dataset.trackReviewSubmission);
});

// ---------- CLASSES ----------
function openSectionModal() {
  $('#sectionForm').reset();
  $('#sectionGrade').value = '7';
  openDialog('sectionModal');
}

$('#createClassBtn').addEventListener('click', openSectionModal);
$('#dashboardCreateClass').addEventListener('click', openSectionModal);

$('#sectionForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!requireSupabase()) return;
  const form = new FormData(event.currentTarget);
  const grade = Number(form.get('grade_level'));
  const name = String(form.get('name') || '').trim();
  const colors = { 7:'#ff6b00', 8:'#ff8f00', 9:'#ff4f81', 10:'#3e8ef7', 11:'#7b61c8', 12:'#2c9c78' };
  if (!name) return toast('Enter a class name.', 'orange');
  try {
    await withLoading('Creating class…', `Setting up ${name} for Grade ${grade}.`, async () => {
      const { data, error } = await db.from('mathside_sections').insert({
        teacher_id: state.user.id,
        grade_level: grade,
        name,
        color: colors[grade] || '#ff6b00'
      }).select().single();
      if (error) throw error;
      activeSectionId = data.id;
      closeDialog('sectionModal');
      await refreshTeacher();
      showTeacherView('classes');
    });
    toast('Class created.', 'success');
  } catch (error) {
    console.error(error);
    toast(error.message || 'Could not create the class.', 'orange');
  }
});

// ---------- STUDENT ACCOUNT MANAGEMENT ----------
async function invokeTeacherFunction(name, body) {
  const { data: sessionData, error: sessionError } = await db.auth.getSession();
  if (sessionError) throw sessionError;
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error('Your teacher session has expired. Please sign in again.');

  const { data, error } = await db.functions.invoke(name, {
    body,
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (error) {
    let detail = error.message || `${name} rejected the request.`;
    try {
      const response = error.context;
      if (response && typeof response.clone === 'function') {
        const clone = response.clone();
        const payload = await clone.json().catch(() => null);
        if (payload) detail = payload.error || payload.message || payload.msg || detail;
      }
    } catch (_) {}
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data || {};
}

function openDeleteStudentModal(sectionId, studentIdOrIds) {
  const section = sectionById(sectionId);
  const studentIds = Array.isArray(studentIdOrIds) ? studentIdOrIds.filter(Boolean) : [studentIdOrIds].filter(Boolean);
  const students = studentIds.map(studentById).filter(Boolean);
  if (!section || !students.length) return;
  pendingStudentAction = { sectionId, studentIds };
  if (students.length === 1) {
    const student = students[0];
    $('#deleteStudentTitle').textContent = student.display_name || 'Student';
    $('#deleteStudentUsernameLabel').textContent = 'Username';
    $('#deleteStudentUsername').textContent = student.username || 'No username';
  } else {
    $('#deleteStudentTitle').textContent = `${students.length} students selected`;
    $('#deleteStudentUsernameLabel').textContent = 'Accounts';
    $('#deleteStudentUsername').textContent = `${students.length} Mathside accounts`;
  }
  $('#deleteStudentClass').textContent = sectionLabel(section);
  openDialog('deleteStudentModal');
}

async function runStudentDelete(deleteAccount) {
  if (!requireSupabase() || !pendingStudentAction) return;
  const { sectionId, studentIds = [] } = pendingStudentAction;
  const students = studentIds.map(studentById).filter(Boolean);
  if (!students.length) return;
  const actionTitle = deleteAccount
    ? `Deleting ${students.length === 1 ? 'student account' : `${students.length} student accounts`}…`
    : `Removing ${students.length === 1 ? 'student' : `${students.length} students`}…`;
  const actionMessage = deleteAccount
    ? 'Removing login accounts, Mathside records, and student-uploaded files from Supabase Storage.'
    : 'Removing the selected students from this class while keeping their login accounts.';

  const failures = [];
  try {
    closeDialog('deleteStudentModal');
    await withLoading(actionTitle, actionMessage, async () => {
      for (const student of students) {
        try {
          await invokeTeacherFunction('delete-student', {
            section_id: sectionId,
            student_id: student.id,
            delete_account: Boolean(deleteAccount)
          });
        } catch (error) {
          failures.push({ name: student.display_name || 'Student', error: error.message || 'Delete failed' });
        }
      }
      pendingStudentAction = null;
      selectedStudentIds.clear();
      await refreshTeacher();
      activeSectionId = sectionId;
      if ($('#classStudentsModal')?.open) renderClassStudentsModal();
    });

    const successCount = students.length - failures.length;
    if (successCount) {
      toast(
        deleteAccount
          ? `${successCount} student account${successCount === 1 ? '' : 's'} permanently deleted.`
          : `${successCount} student${successCount === 1 ? '' : 's'} removed from this class. Their login accounts were kept.`,
        'success'
      );
    }
    if (failures.length) {
      toast(`${failures.length} student${failures.length === 1 ? '' : 's'} could not be updated.\n\n${failures.map(item => `${item.name}: ${item.error}`).join('\n')}`, 'orange', 'Some actions failed');
    }
  } catch (error) {
    console.error(error);
    toast(error.message || 'Could not update the selected students.', 'orange');
  }
}

$('#removeStudentOnlyBtn')?.addEventListener('click', () => runStudentDelete(false));
$('#deleteStudentAccountBtn')?.addEventListener('click', () => runStudentDelete(true));

function excelTimestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function downloadGeneratedAccountsExcel() {
  if (!window.XLSX) return toast('Excel export could not load. Check your internet connection and try again.', 'orange');
  if (!lastGeneratedAccounts.length) return toast('There are no newly generated student credentials to download.', 'orange');

  const section = lastGeneratedSection || sectionById(activeSectionId) || {};
  const generatedAt = new Date();
  const rows = [
    ['MATHSIDE STUDENT LOGIN ACCOUNTS', '', '', '', '', '', ''],
    ['Class', section.name || '', 'Grade', section.grade_level || '', 'Generated', generatedAt.toLocaleString(), ''],
    ['', '', '', '', '', '', ''],
    ['No.', 'Student Name', 'Gender', 'Class', 'Grade', 'Username', 'Temporary Password'],
    ...lastGeneratedAccounts.map((student, index) => [
      index + 1,
      student.name || '',
      student.gender || 'Not specified',
      section.name || '',
      section.grade_level ? `Grade ${section.grade_level}` : '',
      student.username || '',
      student.temporary_password || ''
    ])
  ];

  const credentialsSheet = XLSX.utils.aoa_to_sheet(rows);
  credentialsSheet['!merges'] = [XLSX.utils.decode_range('A1:G1')];
  credentialsSheet['!cols'] = [
    { wch: 7 }, { wch: 30 }, { wch: 20 }, { wch: 24 }, { wch: 12 }, { wch: 30 }, { wch: 24 }
  ];

  const notes = [
    ['MATHSIDE — IMPORTANT'],
    ['Keep this file private. It contains student login credentials.'],
    ['Temporary passwords are returned only when the accounts are generated and are not stored by Mathside for later download.'],
    ['Give each student only their own username and temporary password.'],
    ['Class', section.name || ''],
    ['Grade', section.grade_level ? `Grade ${section.grade_level}` : '']
  ];
  const notesSheet = XLSX.utils.aoa_to_sheet(notes);
  notesSheet['!cols'] = [{ wch: 22 }, { wch: 90 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, credentialsSheet, 'Student Accounts');
  XLSX.utils.book_append_sheet(workbook, notesSheet, 'Read Me');

  const classPart = safeFileName(section.name || 'Class');
  const filename = `Mathside-Student-Accounts-${classPart}-${excelTimestamp(generatedAt)}.xlsx`;
  XLSX.writeFile(workbook, filename, { compression: true });
  toast('A new Excel file with the generated student accounts was downloaded.', 'success');
}

$('#downloadAccountsExcelBtn')?.addEventListener('click', downloadGeneratedAccountsExcel);

// ---------- ADD STUDENTS ----------
const MAX_STUDENTS_PER_ADD = 60;
const STUDENT_CREATE_BATCH_SIZE = 30;

function studentImportCell(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeImportedGender(value) {
  const text = studentImportCell(value).toLowerCase().replace(/\./g, '');
  if (['m', 'male', 'boy'].includes(text)) return 'Male';
  if (['f', 'female', 'girl'].includes(text)) return 'Female';
  if (text.includes('prefer not')) return 'Prefer not to say';
  return '';
}

function normalizeStudentNameKey(value) {
  return studentImportCell(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function looksLikeLrn(value) {
  return /^\d{12}$/.test(studentImportCell(value).replace(/[^0-9]/g, ''));
}

function looksLikeStudentName(value) {
  const text = studentImportCell(value);
  if (text.length < 3 || !/[A-Za-zÀ-ÿÑñ]/.test(text)) return false;
  if (/^(name|student|learner|lrn|sex|gender|birth|age|address|father|mother|guardian|remarks|total)/i.test(text)) return false;
  return true;
}

function findStudentHeader(rows) {
  const limit = Math.min(rows.length, 90);
  for (let r = 0; r < limit; r += 1) {
    const cells = (rows[r] || []).map(studentImportCell);
    const normalized = cells.map(value => value.toLowerCase().replace(/\s+/g, ' ').trim());
    const lrnCol = normalized.findIndex(value => /^lrn\b/.test(value));
    const nameCol = normalized.findIndex(value => /^name\b/.test(value) || /^(student|learner)\s+name\b/.test(value) || /^full\s+name\b/.test(value));
    const sexCol = normalized.findIndex(value => /^sex\b/.test(value) || /^gender\b/.test(value));
    if (nameCol >= 0 && (lrnCol >= 0 || sexCol >= 0)) {
      return { row: r, lrnCol, nameCol, sexCol };
    }
  }
  return null;
}

function extractStudentRecordsFromRows(sourceRows) {
  const rows = (sourceRows || []).map(row => Array.isArray(row) ? row : []);
  const sampleText = rows.slice(0, 90).flat().map(studentImportCell).join(' ').toUpperCase();
  const header = findStudentHeader(rows);
  const isSf1 = sampleText.includes('SCHOOL FORM 1') || sampleText.includes('SCHOOL REGISTER') || Boolean(header?.lrnCol >= 0 && sampleText.includes('LRN'));
  const records = [];

  if (isSf1) {
    let groupGender = 'Male';
    const firstDataRow = header ? header.row + 1 : 0;
    for (let r = firstDataRow; r < rows.length; r += 1) {
      const row = rows[r] || [];
      const rowCells = row.map(studentImportCell);
      const rowText = rowCells.join(' ').toUpperCase();
      if (rowText.includes('TOTAL MALE')) {
        groupGender = 'Female';
        continue;
      }
      if (rowText.includes('TOTAL FEMALE') || rowText.includes('COMBINED')) break;

      let lrnCol = header?.lrnCol ?? -1;
      if (lrnCol < 0 || !looksLikeLrn(rowCells[lrnCol])) {
        lrnCol = rowCells.findIndex(looksLikeLrn);
      }
      if (lrnCol < 0) continue;

      let name = header?.nameCol >= 0 ? studentImportCell(rowCells[header.nameCol]) : '';
      if (!looksLikeStudentName(name)) {
        for (let c = lrnCol + 1; c < Math.min(rowCells.length, lrnCol + 6); c += 1) {
          if (looksLikeStudentName(rowCells[c])) {
            name = studentImportCell(rowCells[c]);
            break;
          }
        }
      }
      if (!looksLikeStudentName(name)) continue;

      let gender = header?.sexCol >= 0 ? normalizeImportedGender(rowCells[header.sexCol]) : '';
      if (!gender) {
        gender = rowCells.map(normalizeImportedGender).find(Boolean) || groupGender || 'Not specified';
      }
      records.push({ name, gender, lrn: studentImportCell(rowCells[lrnCol]).replace(/[^0-9]/g, '') });
    }
    if (records.length) return { records, format: 'DepEd SF1' };
  }

  if (header?.nameCol >= 0) {
    for (let r = header.row + 1; r < rows.length; r += 1) {
      const row = rows[r] || [];
      const name = studentImportCell(row[header.nameCol]);
      if (!looksLikeStudentName(name)) continue;
      const gender = header.sexCol >= 0 ? normalizeImportedGender(row[header.sexCol]) : '';
      records.push({ name, gender: gender || 'Not specified' });
    }
    if (records.length) return { records, format: 'Excel list' };
  }

  return { records: [], format: 'Unknown' };
}

function parseStudentWorkbook(workbook) {
  let best = { records: [], format: 'Unknown', sheetName: '' };
  for (const sheetName of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    const parsed = extractStudentRecordsFromRows(rows);
    if (parsed.records.length > best.records.length) best = { ...parsed, sheetName };
  }
  return best;
}

function updateStudentEntryCount() {
  const count = $('#studentEntryBody')?.children.length || 0;
  if ($('#studentEntryCount')) $('#studentEntryCount').textContent = `${count} / ${MAX_STUDENTS_PER_ADD}`;
  if ($('#addStudentRowBtn')) $('#addStudentRowBtn').disabled = count >= MAX_STUDENTS_PER_ADD;
}

function currentStudentEntryRows() {
  return [...($('#studentEntryBody')?.querySelectorAll('tr') || [])].map(row => ({
    name: row.querySelector('.student-name-input')?.value.trim() || '',
    gender: row.querySelector('.student-gender-input')?.value || 'Not specified'
  })).filter(student => student.name);
}

function openStudentModal(sectionId) {
  activeSectionId = sectionId;
  const section = sectionById(sectionId);
  if (!section) return;
  $('#studentModalTitle').textContent = sectionLabel(section);
  $('#studentEntryBody').innerHTML = '';
  addStudentEntryRow({}, true);
  addStudentEntryRow({}, true);
  addStudentEntryRow({}, true);
  $('#studentImportStatus').textContent = 'You can review imported learners before generating accounts.';
  if ($('#studentsFileInput')) $('#studentsFileInput').value = '';
  updateStudentEntryCount();
  openDialog('studentModal');
}

function addStudentEntryRow(student = {}, silent = false) {
  const body = $('#studentEntryBody');
  if (!body) return false;
  if (body.children.length >= MAX_STUDENTS_PER_ADD) {
    if (!silent) toast(`You can add up to ${MAX_STUDENTS_PER_ADD} students at a time.`, 'orange');
    updateStudentEntryCount();
    return false;
  }
  const row = document.createElement('tr');
  const index = body.children.length + 1;
  const gender = ['Female', 'Male', 'Prefer not to say', 'Not specified'].includes(student.gender) ? student.gender : 'Not specified';
  row.innerHTML = `<td>${index}</td><td><input class="student-name-input" placeholder="Student full name" value="${esc(student.name || '')}"></td><td><select class="student-gender-input"><option value="Female">Female</option><option value="Male">Male</option><option value="Prefer not to say">Prefer not to say</option><option value="Not specified">Not specified</option></select></td><td><button class="table-remove" type="button">Remove</button></td>`;
  body.append(row);
  row.querySelector('.student-gender-input').value = gender;
  row.querySelector('.table-remove').addEventListener('click', () => {
    row.remove();
    [...body.children].forEach((r,i) => r.children[0].textContent = i+1);
    updateStudentEntryCount();
  });
  updateStudentEntryCount();
  return true;
}

function fillStudentEntryRows(imported, formatName) {
  const body = $('#studentEntryBody');
  const existingManual = currentStudentEntryRows();
  const currentClassNames = new Set(studentsForSection(activeSectionId).map(student => normalizeStudentNameKey(student.display_name)));
  const seen = new Set();
  const combined = [];
  let duplicateCount = 0;

  for (const student of [...existingManual, ...imported]) {
    const key = normalizeStudentNameKey(student.name);
    if (!key) continue;
    if (seen.has(key) || currentClassNames.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    combined.push({ name: student.name, gender: student.gender || 'Not specified' });
  }

  const importGenderOrder = { Male: 0, Female: 1, 'Prefer not to say': 2, 'Not specified': 3 };
  combined.sort((a, b) => {
    const byGender = (importGenderOrder[a.gender] ?? 9) - (importGenderOrder[b.gender] ?? 9);
    if (byGender) return byGender;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  });

  const limited = combined.slice(0, MAX_STUDENTS_PER_ADD);
  const trimmedCount = Math.max(0, combined.length - limited.length);
  body.innerHTML = '';
  limited.forEach(student => addStudentEntryRow(student, true));
  if (!limited.length) addStudentEntryRow({}, true);
  updateStudentEntryCount();

  const notes = [`Loaded ${limited.length} learner${limited.length === 1 ? '' : 's'} from ${formatName}.`];
  if (duplicateCount) notes.push(`${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'} skipped.`);
  if (trimmedCount) notes.push(`${trimmedCount} learner${trimmedCount === 1 ? '' : 's'} skipped because the limit is ${MAX_STUDENTS_PER_ADD}.`);
  if (formatName === 'DepEd SF1') notes.push('LRNs are used only to identify SF1 learner rows; Mathside does not store the LRN.');
  $('#studentImportStatus').textContent = notes.join(' ');
}

$('#addStudentRowBtn').addEventListener('click', () => addStudentEntryRow());
$('#importStudentsFileBtn')?.addEventListener('click', () => $('#studentsFileInput')?.click());
$('#studentsFileInput')?.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!window.XLSX) {
    toast('Excel reader could not load. Check your internet connection and try again.', 'orange');
    event.target.value = '';
    return;
  }
  try {
    $('#studentImportStatus').textContent = `Reading ${file.name}…`;
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array', cellDates: false });
    const parsed = parseStudentWorkbook(workbook);
    if (!parsed.records.length) {
      throw new Error('No learner rows were detected. For a regular Excel file, use a Name column and a Sex or Gender column.');
    }
    fillStudentEntryRows(parsed.records, parsed.format);
    toast(`${parsed.records.length} learner row${parsed.records.length === 1 ? '' : 's'} detected from ${parsed.format}. Review the list before generating accounts.`, 'success');
  } catch (error) {
    console.error('STUDENT IMPORT ERROR', error);
    $('#studentImportStatus').textContent = error.message || 'Could not read this student list.';
    toast(error.message || 'Could not import the student list.', 'orange');
  } finally {
    event.target.value = '';
  }
});

$('#saveStudentsBtn').addEventListener('click', async () => {
  if (!requireSupabase() || !activeSectionId) return;
  const students = currentStudentEntryRows();
  if (!students.length) return toast('Enter at least one student name.', 'orange');
  if (students.length > MAX_STUDENTS_PER_ADD) return toast(`You can generate up to ${MAX_STUDENTS_PER_ADD} student accounts at a time.`, 'orange');

  try {
    closeDialog('studentModal');

    let result = { created: [], failures: [], section: null };
    await withLoading('Creating student accounts…', `Generating ${students.length} secure student account${students.length === 1 ? '' : 's'}.`, async () => {
      for (let start = 0; start < students.length; start += STUDENT_CREATE_BATCH_SIZE) {
        const batch = students.slice(start, start + STUDENT_CREATE_BATCH_SIZE);
        try {
          const partial = await invokeTeacherFunction('create-students', {
            section_id: activeSectionId,
            students: batch
          });
          result.created.push(...(partial?.created || []));
          result.failures.push(...(partial?.failures || []));
          if (!result.section && partial?.section) result.section = partial.section;
        } catch (batchError) {
          batch.forEach(student => result.failures.push({
            name: student.name,
            error: batchError.message || 'Account creation failed.'
          }));
        }
      }
      await refreshTeacher();
    });

    const created = result.created || [];
    const failures = result.failures || [];
    if (created.length) {
      lastGeneratedAccounts = created.map(item => ({ ...item }));
      lastGeneratedSection = result.section || sectionById(activeSectionId) || null;
    }
    $('#generatedAccountsBody').innerHTML = created.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.gender)}</td><td><b>${esc(s.username)}</b></td><td><b>${esc(s.temporary_password)}</b></td></tr>`).join('');
    if (created.length) openDialog('accountsModal');
    if (failures.length) {
      const details = failures.map(f => `${f.name || 'Student'}: ${f.error || 'Account creation failed.'}`).join('\n');
      toast(`${failures.length} account${failures.length === 1 ? '' : 's'} could not be created.\n\n${details}`, 'orange');
    }
    if (created.length) toast(`${created.length} student account${created.length === 1 ? '' : 's'} created.`, 'success');
  } catch (error) {
    console.error(error);
    toast(error.message || 'Could not create student accounts. Deploy the create-students Edge Function first.', 'orange');
  }
});

// ---------- ASSIGNMENTS ----------
function questionBlock(number) {
  return `<article class="question-block" data-question-block>
    <div class="question-top"><strong>Question ${number}</strong><button type="button" class="question-remove">Remove</button></div>
    <label>Question<div class="math-entry-wrap"><input class="q-text" placeholder="e.g. Solve 2x + 5 = 15"><button type="button" class="math-keyboard-btn" data-math-keyboard data-math-label="Question ${number}">∑ Math Keyboard</button></div></label>
    <div class="question-type-row"><label>Type<select class="q-type"><option value="short">Short answer</option><option value="mcq">Multiple choice</option></select></label><label>Correct answer <small class="field-optional">Optional</small><div class="math-entry-wrap"><input class="q-answer" placeholder="Add now or later for auto-checking"><button type="button" class="math-keyboard-btn" data-math-keyboard data-math-label="Correct answer">∑ Math Keyboard</button></div></label><label>Points<input class="q-points" type="number" min="0" step="0.25" value="1"></label></div>
    <div class="option-list" hidden>
      <div class="option-row"><div class="math-entry-wrap"><input class="q-option" placeholder="Option A"><button type="button" class="math-keyboard-btn" data-math-keyboard data-math-label="Option A">∑ Math Keyboard</button></div><span></span></div>
      <div class="option-row"><div class="math-entry-wrap"><input class="q-option" placeholder="Option B"><button type="button" class="math-keyboard-btn" data-math-keyboard data-math-label="Option B">∑ Math Keyboard</button></div><span></span></div>
      <div class="option-row"><div class="math-entry-wrap"><input class="q-option" placeholder="Option C"><button type="button" class="math-keyboard-btn" data-math-keyboard data-math-label="Option C">∑ Math Keyboard</button></div><span></span></div>
      <div class="option-row"><div class="math-entry-wrap"><input class="q-option" placeholder="Option D"><button type="button" class="math-keyboard-btn" data-math-keyboard data-math-label="Option D">∑ Math Keyboard</button></div><span></span></div>
    </div>
  </article>`;
}

function populateAssignmentSections() {
  const list = $('#assignmentSectionChecklist');
  if (!list) return;
  if (!state.sections.length) {
    list.innerHTML = '<p class="class-checklist-empty">Create a class first.</p>';
    return;
  }
  list.innerHTML = state.sections.map((section, index) => `
    <label class="class-check-option">
      <input type="checkbox" name="assignment_sections" value="${section.id}" ${state.sections.length === 1 && index === 0 ? 'checked' : ''}>
      <span><b>${esc(section.name)}</b><small>Grade ${esc(section.grade_level)}</small></span>
    </label>`).join('');
}

function selectedAssignmentSectionIds() {
  return $$('input[name="assignment_sections"]:checked', $('#assignmentSectionChecklist')).map(input => input.value);
}

function normalizeExcelText(value = '') {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function applyExcelClassSelection(rawClasses) {
  if (editingAssignmentId) return 1;
  if (!rawClasses) return 0;
  const wanted = String(rawClasses).split(/[;|\n]+/).map(normalizeExcelText).filter(Boolean);
  if (!wanted.length) return 0;
  let matched = 0;
  $$('input[name="assignment_sections"]', $('#assignmentSectionChecklist')).forEach(input => {
    const section = sectionById(input.value);
    const candidates = [
      section?.name,
      sectionLabel(section),
      `grade ${section?.grade_level} ${section?.name}`,
      `${section?.name} grade ${section?.grade_level}`
    ].map(normalizeExcelText);
    input.checked = wanted.some(token => candidates.includes(token));
    if (input.checked) matched += 1;
  });
  return matched;
}

function importQuestionsFromRows(rows) {
  const valid = rows.filter(row => String(row.question || '').trim());
  $('#questionBuilder').innerHTML = '';
  questionCount = 0;
  if (!valid.length) {
    addQuestion();
    return 0;
  }
  valid.forEach(row => {
    addQuestion();
    const block = $$('[data-question-block]', $('#questionBuilder')).at(-1);
    const typeText = normalizeExcelText(row.type || row.question_type || 'short');
    const type = typeText.includes('multiple') || typeText === 'mcq' ? 'mcq' : 'short';
    block.querySelector('.q-text').value = String(row.question || '').trim();
    block.querySelector('.q-type').value = type;
    block.querySelector('.q-answer').value = String(row.correct_answer || row.answer || '').trim();
    block.querySelector('.q-points').value = Number(row.points || 1) || 1;
    const options = [row.option_a, row.option_b, row.option_c, row.option_d].map(v => String(v || '').trim());
    [...block.querySelectorAll('.q-option')].forEach((input, index) => { input.value = options[index] || ''; });
    block.querySelector('.option-list').hidden = type !== 'mcq';
  });
  return valid.length;
}

async function importAssignmentExcel(file) {
  if (!window.XLSX) throw new Error('Excel reader could not load. Check your internet connection and try again.');
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });
  const assignmentSheet = workbook.Sheets.Assignment || workbook.Sheets[workbook.SheetNames[0]];
  if (!assignmentSheet) throw new Error('The workbook does not contain an Assignment sheet.');
  const assignmentRows = XLSX.utils.sheet_to_json(assignmentSheet, { header: 1, defval: '' });
  const fields = {};
  assignmentRows.slice(1).forEach(row => {
    const key = normalizeExcelText(row[0]).replace(/ /g, '_');
    if (key) fields[key] = row[1];
  });
  const form = $('#assignmentForm');
  if (fields.title) form.elements.title.value = String(fields.title);
  if (fields.instructions) form.elements.instructions.value = String(fields.instructions);
  if (fields.deadline || fields.due_at || fields.due) {
    const rawDeadline = fields.deadline || fields.due_at || fields.due;
    const parsed = new Date(rawDeadline);
    if (!Number.isNaN(parsed.getTime())) {
      const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000).toISOString().slice(0,16);
      if (form.elements.due_at) form.elements.due_at.value = local;
    }
  }
  const matchedClasses = applyExcelClassSelection(fields.classes || fields.class || fields.sections);

  const questionSheet = workbook.Sheets.Questions || workbook.Sheets[workbook.SheetNames.find(name => normalizeExcelText(name) === 'questions')];
  let questionCountImported = 0;
  if (questionSheet) {
    const rawRows = XLSX.utils.sheet_to_json(questionSheet, { defval: '' });
    const normalized = rawRows.map(row => {
      const result = {};
      Object.entries(row).forEach(([key, value]) => {
        const normalizedKey = normalizeExcelText(key).replace(/ /g, '_');
        result[normalizedKey] = value;
      });
      return result;
    });
    questionCountImported = importQuestionsFromRows(normalized);
  }
  return { questionCountImported, matchedClasses };
}

function resetAssignmentForm() {
  $('#assignmentForm').reset();
  populateAssignmentSections();
  if ($('#assignmentPublishMode')) $('#assignmentPublishMode').value = 'now';
  if ($('#assignmentPublishAtWrap')) $('#assignmentPublishAtWrap').hidden = true;
  if ($('#assignmentPublishAt')) $('#assignmentPublishAt').value = '';
  $('#assignmentImagePreview').hidden = true;
  $('#assignmentImagePreview').removeAttribute('src');
  $('#questionBuilder').innerHTML = '';
  questionCount = 0;
  addQuestion();
}

function addQuestion() {
  questionCount += 1;
  $('#questionBuilder').insertAdjacentHTML('beforeend', questionBlock(questionCount));
}

$('#addQuestionBtn').addEventListener('click', addQuestion);
$('#questionBuilder').addEventListener('change', event => {
  if (!event.target.classList.contains('q-type')) return;
  const block = event.target.closest('[data-question-block]');
  block.querySelector('.option-list').hidden = event.target.value !== 'mcq';
});
$('#questionBuilder').addEventListener('click', event => {
  if (!event.target.classList.contains('question-remove')) return;
  const blocks = $$('[data-question-block]', $('#questionBuilder'));
  if (blocks.length === 1) return toast('Keep at least one question.', 'orange');
  event.target.closest('[data-question-block]').remove();
  $$('[data-question-block]', $('#questionBuilder')).forEach((b,i) => b.querySelector('.question-top strong').textContent = `Question ${i+1}`);
  questionCount = $$('[data-question-block]', $('#questionBuilder')).length;
});

let mathKeyboardTarget = null;
let mathKeyboardSelection = { start: 0, end: 0 };

function openMathKeyboard(target, label = 'Math field') {
  if (!target) return;
  if (!window.customElements?.get('math-field')) {
    return toast('The Math Keyboard library is still loading. Try again in a moment.', 'orange', 'Math Keyboard');
  }
  mathKeyboardTarget = target;
  mathKeyboardSelection = {
    start: Number.isInteger(target.selectionStart) ? target.selectionStart : String(target.value || '').length,
    end: Number.isInteger(target.selectionEnd) ? target.selectionEnd : String(target.value || '').length
  };
  const field = $('#mathKeyboardField');
  field.value = '';
  field.inlineShortcuts = { ...field.inlineShortcuts, infty: '\\infty', theta: '\\theta', pi: '\\pi' };
  $('#mathKeyboardTargetLabel').textContent = `Insert formatted mathematics into: ${label}.`;
  openDialog('mathKeyboardModal');
  setTimeout(() => field.focus(), 60);
}

function closeMathKeyboard() {
  const dialog = $('#mathKeyboardModal');
  if (dialog?.open) dialog.close();
  try { window.mathVirtualKeyboard?.hide?.(); } catch (_) {}
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-math-keyboard]');
  if (!button) return;
  const wrap = button.closest('.math-entry-wrap, .student-math-answer-wrap');
  const target = wrap?.querySelector('input, textarea');
  openMathKeyboard(target, button.dataset.mathLabel || target?.placeholder || 'Math field');
});

document.addEventListener('click', event => {
  const key = event.target.closest('[data-math-insert]');
  if (!key) return;
  const field = $('#mathKeyboardField');
  field.insert(key.dataset.mathInsert || '', { selectionMode: 'placeholder', focus: true });
});

$('#mathKeyboardClearBtn')?.addEventListener('click', () => { const field = $('#mathKeyboardField'); field.value = ''; field.focus(); });
$('#mathKeyboardCancelBtn')?.addEventListener('click', closeMathKeyboard);
$('#mathKeyboardCloseBtn')?.addEventListener('click', closeMathKeyboard);
$('#mathKeyboardInsertBtn')?.addEventListener('click', () => {
  if (!mathKeyboardTarget) return closeMathKeyboard();
  const latex = String($('#mathKeyboardField')?.value || '').trim();
  if (!latex) return toast('Type or choose a mathematical expression first.', 'orange', 'Math Keyboard');
  const current = String(mathKeyboardTarget.value || '');
  const start = Math.max(0, Math.min(mathKeyboardSelection.start, current.length));
  const end = Math.max(start, Math.min(mathKeyboardSelection.end, current.length));
  const block = `\\(${latex}\\)`;
  mathKeyboardTarget.value = current.slice(0, start) + block + current.slice(end);
  mathKeyboardTarget.dispatchEvent(new Event('input', { bubbles: true }));
  const caret = start + block.length;
  try { mathKeyboardTarget.setSelectionRange(caret, caret); } catch (_) {}
  mathKeyboardTarget.focus();
  closeMathKeyboard();
});

function syncAssignmentPublishFields() {
  const mode = $('#assignmentPublishMode')?.value || 'now';
  const wrap = $('#assignmentPublishAtWrap');
  if (wrap) wrap.hidden = mode !== 'schedule';
}
$('#assignmentPublishMode')?.addEventListener('change', syncAssignmentPublishFields);

function formatDateTimeLocalInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function loadAssignmentQuestions(assignmentId) {
  const questions = questionsFor(assignmentId).sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  $('#questionBuilder').innerHTML = '';
  questionCount = 0;
  if (!questions.length) {
    addQuestion();
    return;
  }
  questions.forEach(question => {
    addQuestion();
    const block = $$('[data-question-block]', $('#questionBuilder')).at(-1);
    block.querySelector('.q-text').value = question.question_text || '';
    block.querySelector('.q-type').value = question.question_type || 'short';
    block.querySelector('.q-answer').value = keyFor(question.id)?.correct_answer || '';
    block.querySelector('.q-points').value = Number(question.max_points ?? 1);
    const options = Array.isArray(question.options) ? question.options : [];
    [...block.querySelectorAll('.q-option')].forEach((input, index) => { input.value = options[index] || ''; });
    block.querySelector('.option-list').hidden = question.question_type !== 'mcq';
  });
}

function setAssignmentEditorMode(assignment = null, assignmentGroup = []) {
  editingAssignmentId = assignment?.id || null;
  editingAssignmentIds = assignment ? (assignmentGroup.length ? assignmentGroup : [assignment]).map(item => item.id) : [];
  const isEditing = Boolean(assignment);
  const classCount = editingAssignmentIds.length;
  $('#assignmentModalEyebrow').textContent = isEditing ? 'EDIT CLASSWORK' : 'POST CLASSWORK';
  $('#assignmentModalTitle').textContent = isEditing ? 'Edit assignment' : 'Create assignment';
  $('#assignmentModalLead').textContent = isEditing
    ? (classCount > 1
      ? `Update this shared assignment once. Changes will be applied to all ${classCount} linked classes.`
      : 'Update the activity, deadline, questions, choices, points, or answer key.')
    : 'Build the activity, choose the classes, then review the questions before posting.';
  $('#assignmentSubmitBtn').textContent = isEditing ? 'Save changes' : 'Post assignment';
  $('#assignmentClassHint').textContent = isEditing
    ? (classCount > 1 ? `${classCount} linked classes` : 'Class is fixed while editing')
    : 'Select one or more';
}

function openAssignmentModal(assignmentId = null) {
  if (!state.sections.length) {
    toast('Create at least one class before posting an assignment.', 'orange');
    showTeacherView('classes');
    return;
  }
  resetAssignmentForm();
  const assignment = assignmentId ? assignmentById(assignmentId) : null;
  if (assignmentId && !assignment) return toast('This assignment is no longer available. Refresh and try again.', 'orange');
  const assignmentGroup = assignment ? assignmentDisplayGroupForId(assignment.id) : [];
  setAssignmentEditorMode(assignment, assignmentGroup);

  if (assignment) {
    const form = $('#assignmentForm');
    form.elements.title.value = assignment.title || '';
    form.elements.instructions.value = assignment.instructions || '';
    const isScheduled = assignment.status === 'draft' && assignment.publish_at && new Date(assignment.publish_at).getTime() > Date.now();
    form.elements.publish_mode.value = isScheduled ? 'schedule' : 'now';
    form.elements.publish_at.value = isScheduled ? formatDateTimeLocalInput(assignment.publish_at) : '';
    syncAssignmentPublishFields();
    form.elements.due_at.value = formatDateTimeLocalInput(assignment.due_at);
    form.elements.reminder_hours_before.value = String(Number(assignment.reminder_hours_before || 0));
    if (form.elements.allow_resubmission) form.elements.allow_resubmission.checked = Boolean(assignment.allow_resubmission);
    const groupSectionIds = new Set((assignmentGroup.length ? assignmentGroup : [assignment]).map(item => item.section_id));
    $$('input[name="assignment_sections"]', $('#assignmentSectionChecklist')).forEach(input => {
      input.checked = groupSectionIds.has(input.value);
      input.disabled = true;
      input.closest('.class-check-option')?.classList.toggle('editing-class-option', input.checked);
    });
    if (assignment.image_url) {
      $('#assignmentImagePreview').src = assignment.image_url;
      $('#assignmentImagePreview').hidden = false;
      $('#assignmentImagePreview').dataset.existingPath = assignment.image_path || '';
    }
    loadAssignmentQuestions(assignment.id);
  }
  openDialog('assignmentModal');
}

$('#postAssignmentBtn').addEventListener('click', () => openAssignmentModal());
$('#assignmentImage').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  $('#assignmentImagePreview').src = URL.createObjectURL(file);
  $('#assignmentImagePreview').hidden = false;
});

$('#importAssignmentExcelBtn')?.addEventListener('click', () => $('#assignmentExcelInput')?.click());
$('#assignmentExcelInput')?.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const result = await importAssignmentExcel(file);
    const classMessage = editingAssignmentId
      ? ' The linked classes remain unchanged while editing.'
      : result.matchedClasses
        ? ` ${result.matchedClasses} class${result.matchedClasses === 1 ? '' : 'es'} matched from the Classes field.`
        : ' Choose the destination class or classes below if none were matched.';
    toast(`Excel imported. ${result.questionCountImported} question${result.questionCountImported === 1 ? '' : 's'} loaded.${classMessage}`, 'success', 'Excel import complete');
  } catch (error) {
    console.error(error);
    toast(error.message || 'Could not import the Excel assignment.', 'orange', 'Excel import failed');
  } finally {
    event.target.value = '';
  }
});

function resolveMissingAnswerWarning(result) {
  if (!missingAnswerResolve) return;
  const resolve = missingAnswerResolve;
  missingAnswerResolve = null;
  closeDialog('missingAnswerModal');
  resolve(Boolean(result));
}

function confirmMissingAnswers(count, isEditing = false) {
  if (!count) return Promise.resolve(true);
  $('#missingAnswerText').textContent = `${count} question${count === 1 ? '' : 's'} ${count === 1 ? 'does' : 'do'} not have a correct answer yet. You can still ${isEditing ? 'save' : 'post'} the activity. Those questions will not be auto-checked until you edit the assignment and add their correct answers.`;
  $('#proceedPostAssignmentBtn').textContent = isEditing ? 'Proceed saving' : 'Proceed posting';
  openDialog('missingAnswerModal');
  return new Promise(resolve => { missingAnswerResolve = resolve; });
}

$('#continueEditingAssignmentBtn')?.addEventListener('click', () => resolveMissingAnswerWarning(false));
$('#proceedPostAssignmentBtn')?.addEventListener('click', () => resolveMissingAnswerWarning(true));
$('#missingAnswerCloseBtn')?.addEventListener('click', () => resolveMissingAnswerWarning(false));
$('#missingAnswerModal')?.addEventListener('cancel', event => {
  event.preventDefault();
  resolveMissingAnswerWarning(false);
});

async function saveQuestionsForAssignment(assignmentId, questions) {
  const existing = questionsFor(assignmentId).sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    const existingQuestion = existing[index];
    let questionId = existingQuestion?.id || null;
    const payload = {
      assignment_id: assignmentId,
      position: question.position,
      question_text: question.text,
      question_type: question.type,
      options: question.type === 'mcq' ? question.options : null,
      max_points: question.points
    };
    if (questionId) {
      const updateRes = await db.from('mathside_questions').update(payload).eq('id', questionId);
      if (updateRes.error) throw updateRes.error;
    } else {
      const insertRes = await db.from('mathside_questions').insert(payload).select('id').single();
      if (insertRes.error) throw insertRes.error;
      questionId = insertRes.data.id;
    }
    const keyRes = await db.from('mathside_question_keys').upsert({
      question_id: questionId,
      correct_answer: question.correctAnswer || ''
    }, { onConflict: 'question_id' });
    if (keyRes.error) throw keyRes.error;
  }
  const extraIds = existing.slice(questions.length).map(question => question.id).filter(Boolean);
  if (extraIds.length) {
    const deleteRes = await db.from('mathside_questions').delete().in('id', extraIds);
    if (deleteRes.error) throw deleteRes.error;
  }
}

async function updateExistingAssignment(assignment, form, questions, dueAt, reminderHours, publishStatus, publishAt) {
  const imageFile = $('#assignmentImage').files[0];
  let newImagePath = assignment.image_path || null;
  let uploadedNewPath = null;
  if (imageFile) {
    uploadedNewPath = `${state.user.id}/${assignment.id}/${Date.now()}-${safeFileName(imageFile.name)}`;
    const uploadRes = await db.storage.from('mathside-assignment-images').upload(uploadedNewPath, imageFile, { upsert: false });
    if (uploadRes.error) throw uploadRes.error;
    newImagePath = uploadedNewPath;
  }

  try {
    const updateRes = await db.from('mathside_assignments').update({
      title: String(form.get('title') || '').trim(),
      instructions: String(form.get('instructions') || '').trim(),
      due_at: dueAt,
      reminder_hours_before: dueAt ? reminderHours : 0,
      image_path: newImagePath,
      status: publishStatus,
      publish_at: publishAt,
      allow_resubmission: form.get('allow_resubmission') === 'on'
    }).eq('id', assignment.id);
    if (updateRes.error) throw updateRes.error;

    await saveQuestionsForAssignment(assignment.id, questions);

    if (uploadedNewPath && assignment.image_path && assignment.image_path !== uploadedNewPath) {
      try { await db.storage.from('mathside-assignment-images').remove([assignment.image_path]); } catch (error) { console.warn('Old assignment image cleanup failed', error); }
    }
  } catch (error) {
    if (uploadedNewPath) {
      try { await db.storage.from('mathside-assignment-images').remove([uploadedNewPath]); } catch {}
    }
    throw error;
  }
}

$('#assignmentForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!requireSupabase()) return;
  const form = new FormData(event.currentTarget);
  const sectionIds = selectedAssignmentSectionIds();
  if (!sectionIds.length) return toast('Select at least one class for this assignment.', 'orange', 'Choose a class');
  if (sectionIds.some(id => !sectionById(id))) return toast('One of the selected classes is no longer available. Refresh and try again.', 'orange');

  const blocks = $$('[data-question-block]', $('#questionBuilder'));
  const questions = blocks.map((block, index) => ({
    position: index + 1,
    text: block.querySelector('.q-text').value.trim(),
    type: block.querySelector('.q-type').value,
    correctAnswer: block.querySelector('.q-answer').value.trim(),
    points: Math.max(0, Number(block.querySelector('.q-points')?.value || 1)),
    options: [...block.querySelectorAll('.q-option')].map(input => input.value.trim()).filter(Boolean)
  })).filter(question => question.text);
  if (!questions.length) return toast('Add at least one question.', 'orange');
  if (questions.some(question => question.type === 'mcq' && question.options.length < 2)) return toast('Each multiple-choice question needs at least two options.', 'orange');

  const missingAnswerCount = questions.filter(question => !question.correctAnswer).length;
  if (missingAnswerCount) {
    const proceed = await confirmMissingAnswers(missingAnswerCount, Boolean(editingAssignmentId));
    if (!proceed) return;
  }

  const dueRaw = String(form.get('due_at') || '').trim();
  let dueAt = null;
  if (dueRaw) {
    const parsedDue = new Date(dueRaw);
    if (Number.isNaN(parsedDue.getTime())) return toast('Enter a valid assignment deadline.', 'orange', 'Check the deadline');
    dueAt = parsedDue.toISOString();
  }
  const reminderHours = Number(form.get('reminder_hours_before') || 0);
  const allowedReminderHours = new Set([0, 24, 48, 72]);
  if (!allowedReminderHours.has(reminderHours)) return toast('Choose a valid student reminder.', 'orange', 'Check the reminder');
  if (!dueAt && reminderHours > 0) return toast('Choose a deadline before turning on a student reminder.', 'orange', 'Deadline required');

  const publishMode = String(form.get('publish_mode') || 'now');
  let publishAt = null;
  let publishStatus = 'published';
  if (publishMode === 'schedule') {
    const rawPublishAt = String(form.get('publish_at') || '').trim();
    if (!rawPublishAt) return toast('Choose the date and time when Mathside should post this assignment.', 'orange', 'Posting time required');
    const parsedPublishAt = new Date(rawPublishAt);
    if (Number.isNaN(parsedPublishAt.getTime())) return toast('Enter a valid posting date and time.', 'orange', 'Check posting time');
    if (parsedPublishAt.getTime() <= Date.now() + 30000) return toast('Scheduled posting must be in the future.', 'orange', 'Choose a future time');
    publishAt = parsedPublishAt.toISOString();
    publishStatus = 'draft';
  }
  if (dueAt && publishAt && new Date(dueAt).getTime() <= new Date(publishAt).getTime()) {
    return toast('The assignment deadline must be after the scheduled posting time.', 'orange', 'Check the schedule');
  }

  if (editingAssignmentId) {
    const assignmentsToUpdate = (editingAssignmentIds.length ? editingAssignmentIds : [editingAssignmentId])
      .map(id => assignmentById(id))
      .filter(Boolean);
    if (!assignmentsToUpdate.length) return toast('This assignment is no longer available. Refresh and try again.', 'orange');
    try {
      const copyCount = assignmentsToUpdate.length;
      await withLoading(
        copyCount > 1 ? `Saving in ${copyCount} classes…` : 'Saving assignment…',
        copyCount > 1
          ? 'Updating every linked class copy, including questions, answer keys, deadline, and image.'
          : 'Updating the activity, questions, answer keys, deadline, and image.',
        async () => {
          for (const assignment of assignmentsToUpdate) {
            await updateExistingAssignment(assignment, form, questions, dueAt, reminderHours, publishStatus, publishAt);
          }
          closeDialog('assignmentModal');
          editingAssignmentId = null;
          editingAssignmentIds = [];
          await refreshTeacher();
          showTeacherView('assignments');
        }
      );
      toast(
        publishStatus === 'draft'
          ? `Assignment scheduled for ${formatDeadlineDate(publishAt)}${copyCount > 1 ? ` in ${copyCount} classes` : ''}.`
          : (copyCount > 1 ? `Assignment changes saved in ${copyCount} classes.` : 'Assignment changes saved.'),
        'success',
        publishStatus === 'draft' ? 'Assignment scheduled' : 'Assignment updated'
      );
    } catch (error) {
      console.error(error);
      toast(error.message || 'Could not save the assignment changes.', 'orange', 'Save failed');
    }
    return;
  }

  const createdAssignments = [];
  const uploadedPaths = [];
  try {
    await withLoading(
      `Posting to ${sectionIds.length} class${sectionIds.length === 1 ? '' : 'es'}…`,
      'Creating the assignment, questions, answer keys, and image copies.',
      async () => {
        const imageFile = $('#assignmentImage').files[0];
        for (const sectionId of sectionIds) {
          const { data, error } = await db.from('mathside_assignments').insert({
            section_id: sectionId,
            teacher_id: state.user.id,
            title: String(form.get('title') || '').trim(),
            instructions: String(form.get('instructions') || '').trim(),
            due_at: dueAt,
            reminder_hours_before: dueAt ? reminderHours : 0,
            status: publishStatus,
            publish_at: publishAt,
            allow_resubmission: form.get('allow_resubmission') === 'on'
          }).select().single();
          if (error) throw error;
          const assignment = data;
          createdAssignments.push(assignment);

          if (imageFile) {
            const uploadedPath = `${state.user.id}/${assignment.id}/${Date.now()}-${safeFileName(imageFile.name)}`;
            const uploadRes = await db.storage.from('mathside-assignment-images').upload(uploadedPath, imageFile, { upsert: false });
            if (uploadRes.error) throw uploadRes.error;
            uploadedPaths.push(uploadedPath);
            const updateRes = await db.from('mathside_assignments').update({ image_path: uploadedPath }).eq('id', assignment.id);
            if (updateRes.error) throw updateRes.error;
          }

          const questionPayload = questions.map(question => ({
            assignment_id: assignment.id,
            position: question.position,
            question_text: question.text,
            question_type: question.type,
            options: question.type === 'mcq' ? question.options : null,
            max_points: question.points
          }));
          const questionRes = await db.from('mathside_questions').insert(questionPayload).select('id,position');
          if (questionRes.error) throw questionRes.error;
          const inserted = (questionRes.data || []).sort((a, b) => a.position - b.position);
          const keyPayload = inserted.map(row => ({
            question_id: row.id,
            correct_answer: questions.find(question => question.position === row.position)?.correctAnswer || ''
          }));
          const keyRes = await db.from('mathside_question_keys').insert(keyPayload);
          if (keyRes.error) throw keyRes.error;
        }

        closeDialog('assignmentModal');
        await refreshTeacher();
        showTeacherView('assignments');
      }
    );
    toast(
      publishStatus === 'draft'
        ? `Assignment scheduled for ${formatDeadlineDate(publishAt)}${sectionIds.length > 1 ? ` in ${sectionIds.length} classes` : ''}.`
        : (sectionIds.length === 1 ? 'Assignment posted successfully.' : `Assignment posted successfully to ${sectionIds.length} classes.`),
      'success',
      publishStatus === 'draft' ? 'Assignment scheduled' : 'Assignment posted'
    );
  } catch (error) {
    console.error(error);
    if (uploadedPaths.length) { try { await db.storage.from('mathside-assignment-images').remove(uploadedPaths); } catch {} }
    const createdIds = createdAssignments.map(assignment => assignment.id).filter(Boolean);
    if (createdIds.length) { try { await db.from('mathside_assignments').delete().in('id', createdIds); } catch {} }
    toast(error.message || 'Could not post the assignment.', 'orange', 'Posting failed');
  }
});


function assignmentQuestionSignature(assignmentId) {
  return questionsFor(assignmentId)
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
    .map(question => ({
      position: Number(question.position || 0),
      text: String(question.question_text || '').trim(),
      type: String(question.question_type || 'short'),
      options: Array.isArray(question.options) ? question.options.map(option => String(option || '').trim()) : [],
      points: Number(question.max_points ?? 1),
      answer: String(keyFor(question.id)?.correct_answer || '').trim()
    }));
}

function assignmentDisplaySignature(assignment) {
  return JSON.stringify({
    title: String(assignment.title || '').trim(),
    instructions: String(assignment.instructions || '').trim(),
    dueAt: assignment.due_at || null,
    reminderHours: Number(assignment.reminder_hours_before || 0),
    status: assignment.status || 'published',
    publishAt: assignment.publish_at || null,
    questions: assignmentQuestionSignature(assignment.id)
  });
}

function groupedAssignmentsForDisplay() {
  const signatureBuckets = new Map();
  const orderedGroups = [];
  state.assignments.forEach(assignment => {
    const signature = assignmentDisplaySignature(assignment);
    if (!signatureBuckets.has(signature)) signatureBuckets.set(signature, []);
    const groups = signatureBuckets.get(signature);
    let group = groups.find(candidate => !candidate.some(item => item.section_id === assignment.section_id));
    if (!group) {
      group = [];
      groups.push(group);
      orderedGroups.push(group);
    }
    group.push(assignment);
  });
  return orderedGroups;
}

function assignmentDisplayGroupForId(assignmentId) {
  return groupedAssignmentsForDisplay().find(group => group.some(assignment => assignment.id === assignmentId)) || [];
}

function assignmentGroupSectionLabels(group) {
  return [...new Set(group.map(assignment => sectionLabel(sectionById(assignment.section_id))))].sort((a, b) => a.localeCompare(b));
}

function updateAssignmentBulkToolbar() {
  const validIds = state.assignments.map(assignment => assignment.id);
  [...selectedAssignmentIds].forEach(id => { if (!validIds.includes(id)) selectedAssignmentIds.delete(id); });
  const groups = groupedAssignmentsForDisplay();
  const selectedGroups = groups.filter(group => group.length && group.every(assignment => selectedAssignmentIds.has(assignment.id)));
  const count = selectedGroups.length;
  const countEl = $('#selectedAssignmentCount');
  if (countEl) countEl.textContent = `${count} selected`;
  const deleteBtn = $('#bulkDeleteAssignmentsBtn');
  if (deleteBtn) deleteBtn.disabled = count === 0;
  const selectAll = $('#selectAllAssignments');
  if (selectAll) {
    selectAll.checked = count > 0 && count === groups.length;
    selectAll.indeterminate = count > 0 && count < groups.length;
  }
}

function renderAssignments() {
  const list = $('#assignmentList');
  if (!state.assignments.length) {
    selectedAssignmentIds.clear();
    list.innerHTML = `<div class="assignment-empty v9-empty"><span class="v9-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5"/></svg></span><b>No assignments yet</b><p>Create your first Mathematics task to get started.<br>You can assign it to one or more classes.</p><button class="btn btn-orange" type="button" data-v9-new-assignment>＋ New assignment</button></div>`;
    return;
  }
  const groups = groupedAssignmentsForDisplay();
  const cards = groups.map(group => {
    const assignment = group[0];
    const groupIds = group.map(item => item.id);
    const groupIdsAttr = groupIds.join(',');
    const sectionLabels = assignmentGroupSectionLabels(group);
    const questions = questionsFor(assignment.id);
    const groupIdSet = new Set(groupIds);
    const submissions = state.submissions.filter(submission => groupIdSet.has(submission.assignment_id)).length;
    const missingAnswers = questions.filter(question => !(keyFor(question.id)?.correct_answer || '').trim()).length;
    const scheduled = assignment.status === 'draft' && assignment.publish_at && new Date(assignment.publish_at).getTime() > Date.now();
    const selected = group.every(item => selectedAssignmentIds.has(item.id));
    const classSummary = sectionLabels.length === 1
      ? `<span class="meta-chip">${esc(sectionLabels[0])}</span>`
      : `<span class="meta-chip assignment-group-count">${sectionLabels.length} classes</span>`;
    const classList = sectionLabels.length > 1
      ? `<div class="assignment-class-list" aria-label="Classes">${sectionLabels.map(label => `<span>${esc(label)}</span>`).join('')}</div>`
      : '';
    return `<article class="assignment-card assignment-group-card ${selected ? 'is-selected' : ''} ${scheduled ? 'assignment-scheduled' : ''}">
      <label class="assignment-select-check"><input class="row-check" type="checkbox" data-select-assignment="${assignment.id}" data-assignment-group-ids="${esc(groupIdsAttr)}" ${selected ? 'checked' : ''}><span class="sr-only">Select ${esc(assignment.title)}</span></label>
      <div class="assignment-thumb">${assignment.image_url ? `<img src="${esc(assignment.image_url)}" alt="Assignment image" data-assignment-storage-path="${esc(assignment.image_path || '')}">` : iconSvg('assignment', 'assignment-line-icon')}</div>
      <div class="assignment-card-body"><div class="assignment-title-line"><h3>${esc(assignment.title)}</h3>${group.length > 1 ? '<span class="shared-assignment-badge">Shared assignment</span>' : ''}${scheduled ? '<span class="scheduled-badge">Scheduled</span>' : ''}</div><p>${esc(assignment.instructions || 'Mathematics assignment')}</p>${classList}<div class="assignment-meta">${classSummary}<span class="meta-chip">${questions.length} question${questions.length===1?'':'s'}</span><span class="meta-chip">${submissions} submission${submissions===1?'':'s'}</span>${scheduled ? `<span class="meta-chip scheduled-chip">Posts ${esc(formatDeadlineDate(assignment.publish_at))}</span>` : ''}${missingAnswers ? `<span class="meta-chip answer-key-warning">${missingAnswers} answer${missingAnswers===1?'':'s'} pending</span>` : ''}<span class="meta-chip deadline-chip">${assignment.due_at ? `Deadline ${esc(formatDeadlineDate(assignment.due_at))}` : 'No deadline'}</span>${assignment.due_at && Number(assignment.reminder_hours_before || 0) > 0 ? `<span class="meta-chip reminder-chip">Reminder ${esc(reminderLabel(assignment.reminder_hours_before))}</span>` : ''}</div></div>
      <div class="assignment-card-actions"><button class="btn btn-light" data-preview-assignment="${assignment.id}">Preview</button><button class="btn btn-light" data-edit-assignment="${assignment.id}">Edit</button><button class="btn btn-danger-outline" data-delete-assignment-group="${esc(groupIdsAttr)}">Delete</button></div>
    </article>`;
  }).join('');
  list.innerHTML = `
    <div class="bulk-toolbar assignment-bulk-toolbar">
      <label class="bulk-select-all"><input id="selectAllAssignments" class="row-check" type="checkbox"><span>Select all activities</span></label>
      <span class="bulk-selected-count" id="selectedAssignmentCount">0 selected</span>
      <div class="bulk-actions"><button class="btn btn-danger" id="bulkDeleteAssignmentsBtn" type="button" disabled>Delete selected</button></div>
    </div>
    ${cards}`;
  updateAssignmentBulkToolbar();
}

document.addEventListener('change', event => {
  const check = event.target.closest('[data-select-assignment]');
  if (!check) return;
  const ids = String(check.dataset.assignmentGroupIds || check.dataset.selectAssignment || '').split(',').filter(Boolean);
  ids.forEach(id => {
    if (check.checked) selectedAssignmentIds.add(id);
    else selectedAssignmentIds.delete(id);
  });
  check.closest('.assignment-card')?.classList.toggle('is-selected', check.checked);
  updateAssignmentBulkToolbar();
});

document.addEventListener('change', event => {
  if (event.target.id !== 'selectAllAssignments') return;
  const checked = event.target.checked;
  state.assignments.forEach(assignment => {
    if (checked) selectedAssignmentIds.add(assignment.id);
    else selectedAssignmentIds.delete(assignment.id);
  });
  $$('[data-select-assignment]', $('#assignmentList')).forEach(check => {
    check.checked = checked;
    check.closest('.assignment-card')?.classList.toggle('is-selected', checked);
  });
  updateAssignmentBulkToolbar();
});

function openAssignmentPreview(assignmentId) {
  const assignment = assignmentById(assignmentId);
  if (!assignment) return;
  const group = assignmentDisplayGroupForId(assignment.id);
  const linked = group.length ? group : [assignment];
  const sectionLabels = assignmentGroupSectionLabels(linked);
  const questions = questionsFor(assignment.id).sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  const scheduled = assignment.status === 'draft' && assignment.publish_at;

  $('#assignmentPreviewTitle').textContent = assignment.title || 'Assignment';
  $('#assignmentPreviewInstructions').textContent = assignment.instructions || 'No additional instructions were provided.';

  const detailItems = [
    ['Classes', sectionLabels.join(', ') || 'No class selected'],
    ['Posting', scheduled ? `Scheduled for ${formatDeadlineDate(assignment.publish_at)}` : 'Posted immediately'],
    ['Deadline', assignment.due_at ? formatDeadlineDate(assignment.due_at) : 'No deadline'],
    ['Student reminder', assignment.due_at ? reminderLabel(assignment.reminder_hours_before) : 'No reminder'],
    ['Questions', `${questions.length} question${questions.length === 1 ? '' : 's'}`],
    ['Total points', `${totalPoints(assignment.id)} points`]
  ];
  $('#assignmentPreviewDetails').innerHTML = detailItems.map(([label, value]) => `<article><span>${esc(label)}</span><b>${esc(value)}</b></article>`).join('');

  $('#assignmentPreviewQuestions').innerHTML = questions.length ? questions.map((question, index) => {
    const key = String(keyFor(question.id)?.correct_answer || '').trim();
    const options = Array.isArray(question.options) ? question.options.filter(Boolean) : [];
    return `<article class="assignment-preview-question-card">
      <div class="assignment-preview-question-head"><span>${index + 1}</span><div><h4 class="math-content">${richMath(question.question_text || 'Untitled question')}</h4><small>${question.question_type === 'mcq' ? 'Multiple choice' : 'Short answer'} · ${Number(question.max_points || 0)} point${Number(question.max_points || 0) === 1 ? '' : 's'}</small></div></div>
      ${options.length ? `<div class="assignment-preview-options">${options.map((option, optionIndex) => `<span class="math-content"><b>${String.fromCharCode(65 + optionIndex)}.</b> ${richMath(option)}</span>`).join('')}</div>` : ''}
      <div class="assignment-preview-answer ${key ? '' : 'missing'}"><span>Correct answer</span><b class="math-content">${richMath(key || 'Not set yet')}</b></div>
    </article>`;
  }).join('') : '<div class="assignment-empty">No questions have been added yet.</div>';
  openDialog('assignmentPreviewModal');
}

document.addEventListener('click', event => {
  const btn = event.target.closest('[data-preview-assignment]');
  if (!btn) return;
  openAssignmentPreview(btn.dataset.previewAssignment);
});

document.addEventListener('click', event => {
  const btn = event.target.closest('[data-edit-assignment]');
  if (!btn) return;
  openAssignmentModal(btn.dataset.editAssignment);
});

function openAssignmentDeleteModal(ids) {
  const uniqueIds = [...new Set((ids || []).filter(id => assignmentById(id)))];
  if (!uniqueIds.length) return;
  pendingAssignmentDeleteIds = uniqueIds;
  pendingAssignmentDeleteId = uniqueIds.length === 1 ? uniqueIds[0] : null;
  if (uniqueIds.length === 1) {
    const assignment = assignmentById(uniqueIds[0]);
    const section = sectionById(assignment.section_id);
    $('#deleteAssignmentTitle').textContent = assignment.title || 'Assignment';
    $('#deleteAssignmentClass').textContent = sectionLabel(section);
    $('#confirmDeleteAssignmentBtn').textContent = 'Delete activity permanently';
  } else {
    const first = assignmentById(uniqueIds[0]);
    const displayGroup = first ? assignmentDisplayGroupForId(first.id) : [];
    const isOneSharedAssignment = displayGroup.length === uniqueIds.length && displayGroup.every(item => uniqueIds.includes(item.id));
    if (isOneSharedAssignment) {
      const labels = assignmentGroupSectionLabels(displayGroup);
      $('#deleteAssignmentTitle').textContent = first?.title || 'Shared assignment';
      $('#deleteAssignmentClass').textContent = `This shared activity will be deleted from: ${labels.join(', ')}.`;
      $('#confirmDeleteAssignmentBtn').textContent = `Delete from ${labels.length} classes`;
    } else {
      $('#deleteAssignmentTitle').textContent = `${uniqueIds.length} activities selected`;
      $('#deleteAssignmentClass').textContent = 'Multiple assignments may belong to different classes.';
      $('#confirmDeleteAssignmentBtn').textContent = `Delete ${uniqueIds.length} activities permanently`;
    }
  }
  openDialog('deleteAssignmentModal');
}

document.addEventListener('click', event => {
  const groupBtn = event.target.closest('[data-delete-assignment-group]');
  if (groupBtn) {
    openAssignmentDeleteModal(String(groupBtn.dataset.deleteAssignmentGroup || '').split(',').filter(Boolean));
    return;
  }
  const btn = event.target.closest('[data-delete-assignment]');
  if (!btn) return;
  openAssignmentDeleteModal([btn.dataset.deleteAssignment]);
});

document.addEventListener('click', event => {
  if (event.target.closest('#bulkDeleteAssignmentsBtn')) {
    openAssignmentDeleteModal([...selectedAssignmentIds]);
  }
});

async function deleteAssignmentThroughFunction(assignmentId, accessToken) {
  const { data, error } = await db.functions.invoke('delete-assignment', {
    body: { assignment_id: assignmentId },
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
}

$('#confirmDeleteAssignmentBtn')?.addEventListener('click', async () => {
  const ids = pendingAssignmentDeleteIds.filter(id => assignmentById(id));
  if (!ids.length) return;
  const failures = [];
  closeDialog('deleteAssignmentModal');
  try {
    await withLoading(`Deleting ${ids.length === 1 ? 'activity' : `${ids.length} activities`}…`, 'Removing assignments, submissions, and related Supabase Storage files.', async () => {
      const { data: sessionData, error: sessionError } = await db.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('Your teacher session has expired. Please sign in again.');
      for (const id of ids) {
        const assignment = assignmentById(id);
        try {
          await deleteAssignmentThroughFunction(id, accessToken);
        } catch (error) {
          failures.push({ title: assignment?.title || 'Assignment', error: error.message || 'Delete failed' });
        }
      }
      pendingAssignmentDeleteIds = [];
      pendingAssignmentDeleteId = null;
      selectedAssignmentIds.clear();
      await refreshTeacher();
      showTeacherView('assignments');
    });
    const successCount = ids.length - failures.length;
    if (successCount) toast(`${successCount} activit${successCount === 1 ? 'y was' : 'ies were'} deleted with related uploaded files.`, 'success', 'Activity deleted');
    if (failures.length) toast(`${failures.length} activit${failures.length === 1 ? 'y' : 'ies'} could not be deleted.\n\n${failures.map(item => `${item.title}: ${item.error}`).join('\n')}`, 'orange', 'Some deletes failed');
  } catch (error) {
    console.error(error);
    toast(error.message || 'Could not delete the selected activities. Deploy the delete-assignment Edge Function first.', 'orange', 'Delete failed');
  }
});

// ---------- STUDENT WORKSPACE NAV ----------
function showStudentPanel(panel = 'overview') {
  const allowed = new Set(['overview', 'activities', 'grades', 'todo', 'calendar', 'feedback', 'account']);
  activeStudentPanel = allowed.has(panel) ? panel : 'overview';
  $$('[data-student-panel-view]').forEach(view => {
    const active = view.dataset.studentPanelView === activeStudentPanel;
    view.hidden = !active;
    view.classList.toggle('active', active);
  });
  $$('[data-student-panel]').forEach(btn => btn.classList.toggle('active', btn.dataset.studentPanel === activeStudentPanel));
  if (activeStudentPanel === 'activities') renderStudentAssignments();
  if (activeStudentPanel === 'grades') renderStudentGrades();
  if (activeStudentPanel === 'account') renderStudentAccount();
  window.MathsideV10?.renderStudentPanel?.(activeStudentPanel);
  window.MathsideStudent?.syncPanel();
}

document.addEventListener('click', event => {
  const btn = event.target.closest('[data-student-panel]');
  if (!btn) return;
  showStudentPanel(btn.dataset.studentPanel);
});

// ---------- STUDENT DASHBOARD + ASSIGNMENTS ----------
function studentDisplayName() {
  return state.profile?.display_name || 'Student';
}

function studentInitials(name = studentDisplayName()) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'ST';
  return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts[parts.length - 1][0]}`).toUpperCase();
}

function formatStudentDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }).format(date);
}

function studentAssignmentState(assignment) {
  const submission = submissionFor(assignment.id);
  if (!submission) return 'todo';
  return submission.status === 'graded' ? 'graded' : 'submitted';
}

function studentClassForDashboard() {
  const member = state.members?.[0];
  if (member) {
    const section = sectionById(member.section_id);
    if (section) return section;
  }
  const firstAssignment = state.assignments?.[0];
  return firstAssignment ? sectionById(firstAssignment.section_id) : state.sections?.[0] || null;
}

function studentScorePercent() {
  const scores = state.submissions.map(submission => {
    const assignment = assignmentById(submission.assignment_id);
    if (!assignment) return null;
    const total = totalPoints(assignment.id);
    if (!total) return null;
    const score = submission.status === 'graded' && submission.teacher_score != null
      ? Number(submission.teacher_score)
      : Number(submission.auto_score || 0);
    return Math.max(0, Math.min(100, (score / total) * 100));
  }).filter(value => value != null && Number.isFinite(value));
  if (!scores.length) return null;
  return Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length);
}

function renderStudentDashboard() {
  const assigned = state.assignments.length;
  const completed = state.assignments.filter(a => Boolean(submissionFor(a.id))).length;
  const todo = Math.max(0, assigned - completed);
  const completion = assigned ? Math.round((completed / assigned) * 100) : 0;
  const average = studentScorePercent();
  const profileName = studentDisplayName();
  const firstName = profileName.trim().split(/\s+/)[0] || 'Student';
  const studentClass = studentClassForDashboard();

  $('#studentWelcome').textContent = `Hi, ${profileName}`;
  $('#studentFirstName').textContent = firstName.toUpperCase();
  $('#studentInitials').textContent = studentInitials(profileName);
  $('#studentAssignedCount').textContent = assigned;
  $('#studentCompletedCount').textContent = completed;
  $('#studentTodoCount').textContent = todo;
  $('#studentAverageScore').textContent = average == null ? '—' : `${average}%`;
  $('#studentProgressValue').textContent = `${completion}% complete`;
  $('#studentProgressBar').style.width = `${completion}%`;
  $('#studentClassChip').textContent = studentClass?.name || 'My class';
  $('#studentGradeChip').textContent = `Grade ${studentClass?.grade_level || state.profile?.grade_level || '—'}`;

  if (!assigned) {
    $('#studentHeroCopy').textContent = 'Your class is ready. New Mathematics tasks will appear here when your teacher posts them.';
    $('#studentProgressCopy').textContent = 'No assignments yet. Your progress will begin with your first posted task.';
  } else if (!todo) {
    $('#studentHeroCopy').textContent = 'You are caught up. Review your feedback and keep the momentum going.';
    $('#studentProgressCopy').textContent = `You have submitted all ${assigned} of your current tasks.`;
  } else {
    $('#studentHeroCopy').textContent = `${todo} task${todo === 1 ? '' : 's'} still waiting. Pick one and make a little progress today.`;
    $('#studentProgressCopy').textContent = `${completed} of ${assigned} task${assigned === 1 ? '' : 's'} submitted so far.`;
  }

  renderStudentNextUp();
  renderStudentRecentFeedback();
  renderStudentAssignments();
  renderStudentResponses();
  renderStudentGrades();
  renderStudentAccount();
  window.MathsideDesign?.render();
}

function renderStudentNextUp() {
  const holder = $('#studentNextUp');
  const pending = state.assignments
    .filter(a => !submissionFor(a.id))
    .sort((a, b) => {
      const ad = a.due_at ? new Date(a.due_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bd = b.due_at ? new Date(b.due_at).getTime() : Number.MAX_SAFE_INTEGER;
      if (ad !== bd) return ad - bd;
      return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
    });

  if (!pending.length) {
    holder.innerHTML = `<div class="student-empty-insight"><b>You're caught up.</b><p>There is no unfinished assignment right now.</p><span class="student-done-mark">✓</span></div>`;
    return;
  }

  const assignment = pending[0];
  const section = sectionById(assignment.section_id);
  const qs = questionsFor(assignment.id);
  const due = formatDeadlineDate(assignment.due_at);
  const overdue = assignment.due_at && new Date(assignment.due_at).getTime() < Date.now();
  holder.innerHTML = `<div class="student-next-content">
    <h3>${esc(assignment.title)}</h3>
    <p>${esc(assignment.instructions || 'Open this task and work through it one question at a time.')}</p>
    <div class="student-next-meta"><span>${esc(sectionLabel(section))}</span><span>${qs.length} question${qs.length === 1 ? '' : 's'}</span>${due ? `<span class="${overdue ? 'is-overdue' : ''}">${overdue ? 'Past due' : 'Due'} ${esc(due)}</span>` : ''}</div>
    <button class="btn btn-orange" type="button" data-answer-assignment="${assignment.id}">Start this task</button>
  </div>`;
}

function renderStudentRecentFeedback() {
  const holder = $('#studentRecentFeedback');
  const latest = state.submissions.find(s => s.status === 'graded' || String(s.feedback || '').trim());
  if (!latest) {
    holder.innerHTML = `<div class="student-empty-insight"><b>Feedback will appear here.</b><p>Once your teacher reviews your work, their comments and score will be easy to find.</p></div>`;
    return;
  }
  const assignment = assignmentById(latest.assignment_id);
  const total = assignment ? totalPoints(assignment.id) : 0;
  const score = latest.status === 'graded' && latest.teacher_score != null ? Number(latest.teacher_score) : Number(latest.auto_score || 0);
  holder.innerHTML = `<div class="student-feedback-content">
    <div class="student-feedback-score"><b>${score}</b><span>/ ${total}</span></div>
    <div><h3>${esc(assignment?.title || 'Reviewed work')}</h3><p>${esc(latest.feedback || (latest.status === 'graded' ? 'Your teacher has reviewed this task.' : 'Your work has been submitted.'))}</p><small>${latest.status === 'graded' ? 'Teacher reviewed' : 'Latest submission'}</small></div>
  </div>`;
}

function studentTaskSortValue(assignment, mode) {
  if (mode === 'due') return assignment.due_at ? new Date(assignment.due_at).getTime() : Number.MAX_SAFE_INTEGER;
  if (mode === 'oldest') return new Date(assignment.created_at || 0).getTime();
  if (mode === 'title') return String(assignment.title || '').toLowerCase();
  if (mode === 'status') {
    const order = { todo: 0, submitted: 1, graded: 2 };
    return order[studentAssignmentState(assignment)] ?? 9;
  }
  return -new Date(assignment.created_at || 0).getTime();
}

function renderStudentAssignments() {
  if (window.MathsideStudent) return window.MathsideStudent.renderActivities();
  const list = $('#studentAssignmentList');
  if (!list) return;
  if (!state.assignments.length) {
    $('#studentTaskSummary').textContent = 'No tasks yet. Your teacher’s assignments will appear here.';
    list.innerHTML = `<div class="assignment-empty student-empty-state"><b>No assignments yet.</b><span>When your teacher posts a Mathematics task, it will show up here.</span></div>`;
    return;
  }

  const needle = studentTaskSearch.trim().toLowerCase();
  let filtered = state.assignments.filter(a => {
    const matchesStatus = studentTaskFilter === 'all' || studentAssignmentState(a) === studentTaskFilter;
    const matchesSearch = !needle || `${a.title || ''} ${a.instructions || ''} ${sectionLabel(sectionById(a.section_id))}`.toLowerCase().includes(needle);
    return matchesStatus && matchesSearch;
  });

  filtered = [...filtered].sort((a, b) => {
    const av = studentTaskSortValue(a, studentTaskSort);
    const bv = studentTaskSortValue(b, studentTaskSort);
    if (typeof av === 'string') return av.localeCompare(String(bv));
    return av - bv;
  });

  const labels = { all: 'all tasks', todo: 'tasks to do', submitted: 'submitted tasks', graded: 'graded tasks' };
  $('#studentTaskSummary').textContent = `${filtered.length} ${labels[studentTaskFilter] || 'tasks'} shown${needle ? ` for “${studentTaskSearch.trim()}”` : ''}.`;
  $$('.student-filter').forEach(btn => btn.classList.toggle('active', btn.dataset.studentFilter === studentTaskFilter));
  if ($('#studentTaskSort')) $('#studentTaskSort').value = studentTaskSort;
  if ($('#studentTaskSearch') && $('#studentTaskSearch').value !== studentTaskSearch) $('#studentTaskSearch').value = studentTaskSearch;

  if (!filtered.length) {
    list.innerHTML = `<div class="assignment-empty student-empty-state"><b>Nothing matches this view.</b><span>Change the filter, sorting, or search to find another activity.</span></div>`;
    return;
  }

  list.innerHTML = filtered.map(a => {
    const submitted = submissionFor(a.id);
    const qs = questionsFor(a.id);
    const section = sectionById(a.section_id);
    const total = totalPoints(a.id);
    const taskState = studentAssignmentState(a);
    const due = formatDeadlineDate(a.due_at);
    const overdue = !submitted && a.due_at && new Date(a.due_at).getTime() < Date.now();
    let status = 'To do';
    let statusClass = 'status-todo';
    if (submitted) {
      if (submitted.status === 'graded') {
        status = `Graded · ${Number(submitted.teacher_score ?? submitted.auto_score)}/${total}`;
        statusClass = 'status-graded';
      } else {
        status = `Submitted · ${Number(submitted.auto_score || 0)}/${total}`;
        statusClass = 'status-submitted';
      }
    }
    const canSubmit = !submitted || a.allow_resubmission;
    const actionLabel = submitted ? (canSubmit ? 'Resubmit' : 'Completed') : 'Open task';
    return `<article class="assignment-card student-task-card ${taskState}">
      <div class="assignment-thumb">${a.image_url ? `<img src="${esc(a.image_url)}" alt="Assignment image" data-assignment-storage-path="${esc(a.image_path || '')}">` : iconSvg('calculator', 'assignment-line-icon')}</div>
      <div class="student-task-body">
        <span class="student-card-section-name">${esc(section?.name || 'Class')}</span>
        <div class="student-task-title-row"><h3>${esc(a.title)}</h3><span class="student-status ${statusClass}">${esc(status)}</span></div>
        <p>${esc(a.instructions || 'Open the task and submit your answers.')}</p>
        <div class="assignment-meta">
          ${section?.grade_level ? `<span class="meta-chip">Grade ${esc(section.grade_level)}</span>` : ''}
          <span class="meta-chip">${qs.length} question${qs.length === 1 ? '' : 's'}</span>
          ${due ? `<span class="meta-chip deadline-chip ${overdue ? 'meta-overdue' : ''}">${overdue ? 'Past due' : 'Deadline'} ${esc(due)}</span>` : `<span class="meta-chip deadline-chip no-deadline">No deadline</span>`}
          ${submitted?.attempt_count ? `<span class="meta-chip">Attempt ${Number(submitted.attempt_count)}</span>` : ''}
        </div>
        ${submitted?.feedback ? `<div class="student-inline-feedback"><b>Teacher feedback:</b> ${esc(submitted.feedback)}</div>` : ''}
      </div>
      <div class="student-task-actions">
        ${submitted ? `<button class="btn btn-light" type="button" data-preview-response="${submitted.id}">Preview response</button>` : ''}
        <button class="btn ${canSubmit ? 'btn-orange' : 'btn-light'}" data-answer-assignment="${a.id}" ${canSubmit ? '' : 'disabled'}>${actionLabel}</button>
      </div>
    </article>`;
  }).join('');
}

document.addEventListener('click', event => {
  const filter = event.target.closest('[data-student-filter]');
  if (!filter) return;
  studentTaskFilter = filter.dataset.studentFilter || 'all';
  renderStudentAssignments();
});

$('#studentTaskSort')?.addEventListener('change', event => {
  studentTaskSort = event.currentTarget.value || 'newest';
  renderStudentAssignments();
});

$('#studentTaskSearch')?.addEventListener('input', event => {
  studentTaskSearch = event.currentTarget.value || '';
  renderStudentAssignments();
});

function renderStudentResponses() {
  const list = $('#studentResponseList');
  if (!list) return;
  const submissions = [...state.submissions].sort((a, b) => new Date(b.submitted_at || 0).getTime() - new Date(a.submitted_at || 0).getTime());
  $('#studentResponseCount').textContent = `${submissions.length} response${submissions.length === 1 ? '' : 's'}`;
  if (!submissions.length) {
    list.innerHTML = `<div class="assignment-empty student-empty-state"><b>No submitted work yet.</b><span>Your answers will appear here after you submit an activity.</span></div>`;
    return;
  }
  list.innerHTML = submissions.map(submission => {
    const assignment = assignmentById(submission.assignment_id);
    const total = assignment ? totalPoints(assignment.id) : 0;
    const score = submission.status === 'graded' && submission.teacher_score != null ? Number(submission.teacher_score) : Number(submission.auto_score || 0);
    return `<article class="student-response-card">
      <div class="student-response-icon">${submission.status === 'graded' ? '✓' : '↗'}</div>
      <div class="student-response-body"><div class="student-response-title"><h3>${esc(assignment?.title || 'Activity')}</h3><span class="student-status ${submission.status === 'graded' ? 'status-graded' : 'status-submitted'}">${submission.status === 'graded' ? 'Graded' : 'Submitted'}</span></div><p>${esc(sectionLabel(sectionById(assignment?.section_id)))}</p><div class="assignment-meta"><span class="meta-chip">Score ${score}/${total}</span><span class="meta-chip">Attempt ${Number(submission.attempt_count || 1)}</span><span class="meta-chip">${esc(formatStudentDate(submission.submitted_at) || 'Submitted')}</span></div></div>
      <button class="btn btn-orange" type="button" data-preview-response="${submission.id}">Preview response</button>
    </article>`;
  }).join('');
}

function renderStudentGrades() {
  if (window.MathsideStudent) return window.MathsideStudent.renderGrades();
  const list = $('#studentGradeList');
  if (!list) return;
  const graded = state.submissions.filter(s => s.status === 'graded').sort((a,b) => new Date(b.graded_at || b.updated_at || 0).getTime() - new Date(a.graded_at || a.updated_at || 0).getTime());
  $('#studentGradedCount').textContent = `${graded.length} graded`;
  if (!graded.length) {
    list.innerHTML = `<div class="assignment-empty student-empty-state"><b>No teacher-reviewed grades yet.</b><span>Submitted work will appear here after your teacher grades it.</span></div>`;
    return;
  }
  list.innerHTML = graded.map(submission => {
    const assignment = assignmentById(submission.assignment_id);
    const total = assignment ? totalPoints(assignment.id) : 0;
    const score = Number(submission.teacher_score ?? submission.auto_score ?? 0);
    const percent = total ? Math.round(score / total * 100) : 0;
    return `<article class="student-grade-card"><div class="student-grade-score"><b>${score}</b><span>/ ${total}</span><small>${percent}%</small></div><div class="student-grade-body"><h3>${esc(assignment?.title || 'Activity')}</h3><p>${esc(submission.feedback || 'Your teacher reviewed this activity.')}</p><div class="assignment-meta"><span class="meta-chip">${esc(sectionLabel(sectionById(assignment?.section_id)))}</span><span class="meta-chip">Attempt ${Number(submission.attempt_count || 1)}</span></div></div><button class="btn btn-light" type="button" data-preview-response="${submission.id}">View response</button></article>`;
  }).join('');
}

function renderStudentAccount() {
  if (!$('#studentAccountName')) return;
  const profile = state.profile || {};
  const studentClass = studentClassForDashboard();
  $('#studentAccountInitials').textContent = studentInitials(profile.display_name || 'Student');
  $('#studentAccountName').textContent = profile.display_name || 'Student';
  $('#studentAccountUsername').textContent = profile.username || '—';
  $('#studentAccountClass').textContent = studentClass?.name || 'Not assigned';
  $('#studentAccountGrade').textContent = studentClass?.grade_level ? `Grade ${studentClass.grade_level}` : (profile.grade_level ? `Grade ${profile.grade_level}` : '—');
  $('#studentAccountGender').textContent = profile.gender || 'Not specified';
  window.MathsideStudent?.renderIdentity();
}

async function openStudentResponsePreview(submissionId) {
  const submission = state.submissions.find(s => s.id === submissionId);
  if (!submission) return;
  const assignment = assignmentById(submission.assignment_id);
  if (!assignment) return;
  const qs = questionsFor(assignment.id);
  const answers = state.submissionAnswers.filter(a => a.submission_id === submission.id);
  const total = totalPoints(assignment.id);
  const shownScore = submission.status === 'graded' && submission.teacher_score != null ? Number(submission.teacher_score) : Number(submission.auto_score || 0);
  $('#studentResponseTitle').textContent = assignment.title;
  $('#studentResponseMeta').textContent = `${sectionLabel(sectionById(assignment.section_id))} · Submitted ${formatStudentDate(submission.submitted_at) || ''} · Attempt ${Number(submission.attempt_count || 1)}`;
  $('#studentResponseScore').innerHTML = `<div><span>${submission.status === 'graded' ? 'Teacher score' : 'Auto-check score'}</span><b>${shownScore}<small>/ ${total}</small></b></div><span class="student-status ${submission.status === 'graded' ? 'status-graded' : 'status-submitted'}">${submission.status === 'graded' ? 'Graded' : 'Submitted'}</span>`;
  $('#studentResponseAnswers').innerHTML = qs.map((q, i) => {
    const answer = answers.find(a => a.question_id === q.id);
    const resultText = answer?.is_correct === true ? 'Correct' : answer?.is_correct === false ? 'Needs review' : 'Recorded';
    return `<article class="answer-question student-preview-answer ${answer?.is_correct === true ? 'correct' : answer?.is_correct === false ? 'needs-review' : ''}"><div class="student-preview-question-head"><h3>${i + 1}. ${richMath(q.question_text)}</h3><span>${esc(resultText)}</span></div><p><b>Your answer:</b> <span class="math-content">${richMath(answer?.answer_text || 'No answer')}</span></p><p><b>Auto points:</b> ${Number(answer?.awarded_points || 0)}/${Number(q.max_points || 0)}</p></article>`;
  }).join('') || '<div class="assignment-empty">No answer details are available for this submission.</div>';
  const proofWrap = $('#studentResponseProofWrap');
  if (submission.proof_path) {
    const url = await signedUrl('mathside-submission-proofs', submission.proof_path, 1800);
    if (url) {
      $('#studentResponseProofLink').href = url;
      proofWrap.hidden = false;
    } else proofWrap.hidden = true;
  } else proofWrap.hidden = true;
  const feedback = $('#studentResponseFeedback');
  if (submission.feedback) {
    feedback.innerHTML = `<p class="eyebrow">TEACHER FEEDBACK</p><p>${esc(submission.feedback)}</p>`;
    feedback.hidden = false;
  } else feedback.hidden = true;
  openDialog('studentResponseModal');
}

document.addEventListener('click', async event => {
  const btn = event.target.closest('[data-preview-response]');
  if (!btn) return;
  try {
    await withLoading('Opening your response…', 'Loading your submitted answers and uploaded work.', async () => {
      await openStudentResponsePreview(btn.dataset.previewResponse);
    });
  } catch (error) {
    console.error(error);
    toast(error.message || 'Could not open your submitted response.', 'orange');
  }
});

document.addEventListener('click', event => {
  const btn = event.target.closest('[data-answer-assignment]');
  if (!btn || btn.disabled) return;
  const assignment = assignmentById(btn.dataset.answerAssignment);
  if (!assignment) return;
  activeStudentAssignment = assignment;
  $('#answerAssignmentTitle').textContent = assignment.title;
  $('#answerInstructions').textContent = assignment.instructions || '';
  if (assignment.image_url) {
    const taskImage = $('#studentAssignmentImage');
    taskImage.dataset.assignmentStoragePath = assignment.image_path || '';
    taskImage.dataset.retryingAssignmentImage = '';
    taskImage.src = assignment.image_url;
    taskImage.hidden = false;
  } else {
    $('#studentAssignmentImage').hidden = true;
  }
  $('#answerQuestions').innerHTML = questionsFor(assignment.id).map((q,i) => {
    if (q.question_type === 'mcq') {
      const options = Array.isArray(q.options) ? q.options : [];
      return `<article class="answer-question"><h3 class="math-content">${i+1}. ${richMath(q.question_text)}</h3>${options.map(opt => `<label><input type="radio" name="answer_${q.id}" value="${esc(opt)}"> <span class="math-content">${richMath(opt)}</span></label>`).join('')}</article>`;
    }
    return `<article class="answer-question"><h3 class="math-content">${i+1}. ${richMath(q.question_text)}</h3><div class="student-math-answer-wrap"><input name="answer_${q.id}" placeholder="Type your final answer"><button type="button" class="math-keyboard-btn" data-math-keyboard data-math-label="Your answer for question ${i+1}">∑ Math Keyboard</button></div></article>`;
  }).join('');
  $('#studentSolutionImage').value = '';
  openDialog('answerModal');
  window.MathsideV10?.prepareAnswerDraft?.(assignment);
});

$('#answerForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!requireSupabase() || !activeStudentAssignment || state.profile?.role !== 'student') return;
  const qs = questionsFor(activeStudentAssignment.id);
  const answers = qs.map(q => {
    const answer = q.question_type === 'mcq'
      ? ($(`input[name="answer_${q.id}"]:checked`)?.value || '')
      : ($(`[name="answer_${q.id}"]`)?.value || '');
    return { question_id: q.id, answer };
  });
  let proofPath = '';
  const previousProofPath = submissionFor(activeStudentAssignment.id)?.proof_path || '';
  try {
    let rpcResult;
    await withLoading('Submitting your answers…', 'Saving answers and uploading your solution image.', async () => {
      const proofFile = $('#studentSolutionImage').files[0];
      if (proofFile) {
        proofPath = `${state.user.id}/${activeStudentAssignment.id}/${Date.now()}-${safeFileName(proofFile.name)}`;
        const uploadRes = await db.storage.from('mathside-submission-proofs').upload(proofPath, proofFile, { upsert: false });
        if (uploadRes.error) throw uploadRes.error;
      }
      const { data, error } = await db.rpc('mathside_submit_assignment', {
        p_assignment_id: activeStudentAssignment.id,
        p_answers: answers,
        p_proof_path: proofPath || null
      });
      if (error) throw error;
      rpcResult = data;
      if (proofPath && previousProofPath && previousProofPath !== proofPath) {
        try { await db.storage.from('mathside-submission-proofs').remove([previousProofPath]); } catch {}
      }
      closeDialog('answerModal');
      await window.MathsideV10?.clearDraft?.(activeStudentAssignment.id);
      await refreshStudent();
    });
    toast(`Submitted! Auto-check score: ${Number(rpcResult?.auto_score || 0)}/${totalPoints(activeStudentAssignment.id)}.`, 'success');
  } catch (error) {
    console.error(error);
    if (proofPath) { try { await db.storage.from('mathside-submission-proofs').remove([proofPath]); } catch {} }
    toast(error.message || 'Could not submit your answers.', 'orange');
  }
});

// ---------- SUBMISSIONS / GRADING ----------
function submissionSectionCounts() {
  const counts = new Map(state.sections.map(section => [section.id, 0]));
  state.submissions.forEach(submission => {
    const assignment = assignmentById(submission.assignment_id);
    if (assignment?.section_id) counts.set(assignment.section_id, (counts.get(assignment.section_id) || 0) + 1);
  });
  return counts;
}

function renderSubmissionSectionTabs() {
  const tabs = $('#submissionSectionTabs');
  if (!tabs) return;
  const counts = submissionSectionCounts();
  if (submissionSectionId !== 'all' && !sectionById(submissionSectionId)) submissionSectionId = 'all';
  tabs.innerHTML = `<button type="button" class="submission-section-tab ${submissionSectionId === 'all' ? 'active' : ''}" data-submission-section="all"><b>All</b><span>${state.submissions.length}</span></button>` +
    state.sections.map(section => `<button type="button" class="submission-section-tab ${submissionSectionId === section.id ? 'active' : ''}" data-submission-section="${section.id}"><b>${esc(section.name)}</b><small>Grade ${esc(section.grade_level)}</small><span>${counts.get(section.id) || 0}</span></button>`).join('');
}

function renderSubmissions() {
  const list = $('#submissionList');
  if (!list) return;
  renderSubmissionSectionTabs();
  const sortSelect = $('#submissionSort');
  if (sortSelect) sortSelect.value = submissionSort;
  let submissions = state.submissions.filter(submission => {
    if (submissionSectionId === 'all') return true;
    return assignmentById(submission.assignment_id)?.section_id === submissionSectionId;
  });
  submissions.sort((a, b) => {
    if (submissionSort === 'oldest') return new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0);
    if (submissionSort === 'name') return String(studentById(a.student_id)?.display_name || '').localeCompare(String(studentById(b.student_id)?.display_name || ''), undefined, { sensitivity: 'base' });
    if (submissionSort === 'gender') {
      const order = { Male: 0, Female: 1, 'Prefer not to say': 2, 'Not specified': 3 };
      const ga = String(studentById(a.student_id)?.gender || 'Not specified');
      const gb = String(studentById(b.student_id)?.gender || 'Not specified');
      const byGender = (order[ga] ?? 9) - (order[gb] ?? 9);
      return byGender || String(studentById(a.student_id)?.display_name || '').localeCompare(String(studentById(b.student_id)?.display_name || ''), undefined, { sensitivity: 'base' });
    }
    return new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0);
  });
  const selectedSection = submissionSectionId === 'all' ? null : sectionById(submissionSectionId);
  if ($('#submissionSort')) $('#submissionSort').value = submissionSort;
  const uniqueStudents = new Set(submissions.map(submission => submission.student_id)).size;
  const summary = $('#submissionSectionSummary');
  if (summary) summary.innerHTML = `<span><b>${submissions.length}</b> submission${submissions.length === 1 ? '' : 's'}</span><span><b>${uniqueStudents}</b> learner${uniqueStudents === 1 ? '' : 's'}</span>${selectedSection ? `<span><b>${esc(selectedSection.name)}</b> · Grade ${esc(selectedSection.grade_level)}</span>` : '<span>All sections</span>'}`;
  if (!submissions.length) {
    list.innerHTML = `<div class="assignment-empty v9-empty"><span class="v9-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5"/></svg></span><b>${selectedSection ? `No submissions yet from ${esc(selectedSection.name)}.` : 'No student submissions yet'}</b><p>When students submit their work, you’ll be able to review<br>their solutions here.</p></div>`;
    return;
  }
  list.innerHTML = submissions.map(s => {
    const a = assignmentById(s.assignment_id);
    const student = studentById(s.student_id);
    const section = sectionById(a?.section_id);
    const total = a ? totalPoints(a.id) : 0;
    const shownScore = s.status === 'graded' ? s.teacher_score : s.auto_score;
    const genderClass = student?.gender === 'Male' ? 'submission-male' : student?.gender === 'Female' ? 'submission-female' : 'submission-other';
    return `<article class="submission-card ${genderClass}">
      <div class="submission-status-icon">${s.status === 'graded' ? iconSvg('check', 'assignment-line-icon') : iconSvg('inbox', 'assignment-line-icon')}</div>
      <div class="submission-card-body">
        <div class="submission-student-row"><button type="button" class="submission-student-name" data-track-student-from-submissions="${student?.id || ''}" data-track-section="${section?.id || ''}">${esc(student?.display_name || 'Student')}</button><span class="gender-pill">${esc(student?.gender || 'Not specified')}</span></div>
        <h3 class="submission-assignment-title">${esc(a?.title || 'Assignment')}</h3>
        <p class="submission-class-label">${esc(sectionLabel(section))}</p>
        <div class="submission-meta-grid"><span><small>Status</small><b>${esc(s.status)}</b></span><span><small>Score</small><b>${Number(shownScore || 0)}/${total}</b></span><span><small>Attempt</small><b>${Number(s.attempt_count || 1)}</b></span><span><small>Submitted</small><b>${esc(formatStudentDate(s.submitted_at) || '')}</b></span></div>
      </div>
      <button class="btn btn-orange submission-review-btn" data-review-submission="${s.id}">Review</button>
    </article>`;
  }).join('');
}

$('#submissionSectionTabs')?.addEventListener('click', event => {
  const btn = event.target.closest('[data-submission-section]');
  if (!btn) return;
  submissionSectionId = btn.dataset.submissionSection || 'all';
  renderSubmissions();
});
$('#submissionSort')?.addEventListener('change', event => {
  submissionSort = event.currentTarget.value || 'newest';
  renderSubmissions();
});
$('#submissionList')?.addEventListener('click', event => {
  const btn = event.target.closest('[data-track-student-from-submissions]');
  if (!btn || !btn.dataset.trackStudentFromSubmissions || !btn.dataset.trackSection) return;
  openStudentTrackingModal(btn.dataset.trackSection, btn.dataset.trackStudentFromSubmissions);
});

document.addEventListener('click', async event => {
  const btn = event.target.closest('[data-review-submission]');
  if (!btn) return;
  await openSubmissionReview(btn.dataset.reviewSubmission);
});

async function openSubmissionReview(submissionId) {
  const submission = state.submissions.find(s => s.id === submissionId);
  if (!submission) return;
  activeSubmissionId = submissionId;
  const assignment = assignmentById(submission.assignment_id);
  const student = studentById(submission.student_id);
  const qs = questionsFor(assignment.id);
  try {
    await withLoading('Opening submission…', 'Loading answers and uploaded work.', async () => {
      const answersRes = await db.from('mathside_submission_answers').select('*').eq('submission_id', submissionId);
      if (answersRes.error) throw answersRes.error;
      const answers = answersRes.data || [];
      $('#reviewSubmissionTitle').textContent = `${student?.display_name || 'Student'} — ${assignment.title}`;
      $('#reviewSubmissionMeta').textContent = `${sectionLabel(sectionById(assignment.section_id))} · Auto-check ${Number(submission.auto_score || 0)}/${totalPoints(assignment.id)}`;
      $('#reviewSubmissionAnswers').innerHTML = qs.map((q,i) => {
        const answer = answers.find(a => a.question_id === q.id);
        const key = keyFor(q.id);
        return `<article class="answer-question review-answer ${answer?.is_correct ? 'correct' : 'needs-review'}"><h3>${i+1}. ${richMath(q.question_text)}</h3><p><b>Student:</b> <span class="math-content">${richMath(answer?.answer_text || 'No answer')}</span></p><p><b>Answer key:</b> <span class="math-content">${richMath(key?.correct_answer || '—')}</span></p><p><b>Auto points:</b> ${Number(answer?.awarded_points || 0)}/${Number(q.max_points || 0)}</p></article>`;
      }).join('');
      const total = totalPoints(assignment.id);
      $('#teacherScoreInput').max = String(total);
      $('#teacherScoreInput').value = String(submission.teacher_score ?? submission.auto_score ?? 0);
      $('#teacherFeedbackInput').value = submission.feedback || '';
      const feedbackPreset = $('#teacherFeedbackPreset');
      if (feedbackPreset) feedbackPreset.value = '';
      const proofWrap = $('#reviewProofWrap');
      if (submission.proof_path) {
        const url = await signedUrl('mathside-submission-proofs', submission.proof_path, 1800);
        if (url) {
          $('#reviewProofLink').href = url;
          proofWrap.hidden = false;
        } else proofWrap.hidden = true;
      } else proofWrap.hidden = true;
      openDialog('reviewSubmissionModal');
    });
  } catch (error) {
    console.error(error);
    toast(error.message || 'Could not load this submission.', 'orange');
  }
}

$('#teacherFeedbackPreset')?.addEventListener('change', event => {
  const preset = String(event.currentTarget.value || '').trim();
  if (!preset) return;
  const feedbackBox = $('#teacherFeedbackInput');
  if (!feedbackBox) return;
  feedbackBox.value = preset;
  feedbackBox.focus();
  feedbackBox.setSelectionRange(feedbackBox.value.length, feedbackBox.value.length);
});

$('#gradeForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!activeSubmissionId) return;
  const form = new FormData(event.currentTarget);
  const score = Number(form.get('teacher_score'));
  const feedback = String(form.get('feedback') || '').trim();
  const submission = state.submissions.find(s => s.id === activeSubmissionId);
  const total = totalPoints(submission.assignment_id);
  if (!Number.isFinite(score) || score < 0 || score > total) return toast(`Enter a score from 0 to ${total}.`, 'orange');
  try {
    await withLoading('Saving grade…', 'Updating the student score and feedback.', async () => {
      const { error } = await db.rpc('mathside_grade_submission', {
        p_submission_id: activeSubmissionId,
        p_teacher_score: score,
        p_feedback: feedback || null
      });
      if (error) throw error;
      closeDialog('reviewSubmissionModal');
      await refreshTeacher();
      showTeacherView('submissions');
    });
    toast('Grade and feedback saved.', 'success');
  } catch (error) {
    console.error(error);
    toast(error.message || 'Could not save the grade.', 'orange');
  }
});

// ---------- STARTUP / SESSION RESTORE ----------
(async function restoreSession() {
  if (!db) {
    if (window.MATHSIDE_PREVIEW) return;
    setTimeout(() => toast('Mathside is ready for Supabase. Edit js/config.js before signing in.', 'orange'), 500);
    return;
  }
  try {
    const { data } = await db.auth.getSession();
    if (!data?.session) return;
    await withLoading('Restoring your Mathside…', 'Loading your Supabase classroom.', routeAuthenticatedUser);
  } catch (error) {
    console.error(error);
    try { await db.auth.signOut(); } catch {}
    resetState();
    returnPublic();
    toast('Your previous session could not be restored. Please sign in again.', 'orange');
  }
})();

if (db) {
  db.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      resetState();
      returnPublic();
    }
  });
}
