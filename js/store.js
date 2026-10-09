(function () {
  const cfg = window.GRADEDOCK_CONFIG || {};
  const configured = Boolean(cfg.supabaseUrl && cfg.supabasePublishableKey && window.supabase?.createClient);
  const client = configured
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;

  const LS = 'gradedock_demo_v2';
  const now = () => new Date().toISOString();
  const id = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const defaultDemo = () => ({
    profile: {
      id: 'demo-user',
      full_name: 'Demo Teacher',
      school_name: 'Sample High School',
      email: 'demo@gradedock.local'
    },
    classes: [
      { id: 'class-1', name: 'Beryl', section: 'Beryl', grade_level: '9', school_year: '2026-2027', teacher_id: 'demo-user', created_at: now() },
      { id: 'class-2', name: 'Cobalt', section: 'Cobalt', grade_level: '9', school_year: '2026-2027', teacher_id: 'demo-user', created_at: now() }
    ],
    exams: [
      { id: 'exam-1', teacher_id: 'demo-user', title: '40-Item Reading Assessment', question_count: 40, choice_count: 4, created_at: now() }
    ],
    keys: {
      'exam-1': Array.from({ length: 40 }, (_, i) => ['A', 'B', 'C', 'D'][i % 4])
    },
    results: [],
    students: [],
    resultAnswers: {}
  });

  let demo = false;

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(LS)) || defaultDemo();
      if (!data.resultAnswers || typeof data.resultAnswers !== 'object') data.resultAnswers = {};
      if (!Array.isArray(data.students)) data.students = [];
      data.classes.forEach(c => { if (c.is_archived == null) c.is_archived = false; });
      data.exams.forEach(e => { if (e.is_archived == null) e.is_archived = false; });
      return data;
    } catch { return defaultDemo(); }
  }

  function save(data) { localStorage.setItem(LS, JSON.stringify(data)); }

  const Store = {
    client,
    configured,
    get demo() { return demo; },

    friendlyError(err) {
      const message = String(err?.message || err || 'Unknown error');
      const code = String(err?.code || '');
      if (code === 'PGRST205' || /relation .* does not exist|could not find the table|schema cache/i.test(message)) {
        return 'GradeDock database tables are not installed yet. In Supabase SQL Editor, run sql/01_RUN_THIS_FIRST.sql, then refresh this page.';
      }
      if (/row-level security|violates row-level security/i.test(message)) {
        return 'Supabase blocked this action. Run the latest sql/01_RUN_THIS_FIRST.sql so the required RLS policies are installed.';
      }
      return message;
    },

    useDemo() {
      demo = true;
      if (!localStorage.getItem(LS)) save(defaultDemo());
    },

    async session() {
      if (demo) return { user: { id: 'demo-user', email: 'demo@gradedock.local' } };
      if (!client) return null;
      const { data } = await client.auth.getSession();
      return data.session;
    },

    async signup({ name, email, password }) {
      if (!client) throw new Error('Supabase is not configured. Use Demo Mode or fill js/config.js.');
      const { data, error } = await client.auth.signUp({ email, password, options: { data: { full_name: name } } });
      if (error) throw error;
      return data;
    },

    async signin({ email, password }) {
      if (!client) throw new Error('Supabase is not configured. Use Demo Mode or fill js/config.js.');
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },

    async signout() {
      if (demo) { demo = false; return; }
      if (client) await client.auth.signOut();
    },

    async user() {
      if (demo) return load().profile;
      const s = await this.session();
      if (!s?.user) return null;
      let { data, error } = await client.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
      if (error) throw error;
      if (!data) {
        const profile = {
          id: s.user.id,
          full_name: s.user.user_metadata?.full_name || s.user.email?.split('@')[0] || 'Teacher',
          email: s.user.email
        };
        const q = await client.from('profiles').upsert(profile).select().single();
        if (q.error) throw q.error;
        data = q.data;
      }
      return data;
    },

    async updateProfile(payload) {
      if (demo) {
        const d = load();
        d.profile = { ...d.profile, ...payload };
        save(d);
        return d.profile;
      }
      const s = await this.session();
      const { data, error } = await client.from('profiles').update(payload).eq('id', s.user.id).select().single();
      if (error) throw error;
      return data;
    },

    async classes() {
      if (demo) return load().classes;
      const { data, error } = await client.from('classes').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },

    async createClass(payload) {
      const normalized = { ...payload, name: payload.section || payload.name || 'Section' };
      if (demo) {
        const d = load();
        const row = { id: id('class'), teacher_id: 'demo-user', created_at: now(), ...normalized };
        d.classes.unshift(row);
        save(d);
        return row;
      }
      const s = await this.session();
      const { data, error } = await client.from('classes').insert({ ...normalized, teacher_id: s.user.id }).select().single();
      if (error) throw error;
      return data;
    },

    async students(classId = null) {
      if (demo) return load().students.filter(x => !classId || x.class_id === classId);
      let query = client.from('students').select('*').order('gender').order('full_name');
      if (classId) query = query.eq('class_id', classId);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },

    async addStudents(classId, students) {
      const rows = students.map(student => ({ class_id: classId, full_name: student.full_name.trim(), gender: student.gender || 'Unspecified', lrn: student.lrn || null }));
      if (!rows.length) return [];
      if (demo) {
        const d = load();
        const newRows = rows.map(x => ({ ...x, id: id('student'), teacher_id: 'demo-user', created_at: now() }));
        d.students.push(...newRows); save(d); return newRows;
      }
      const s = await this.session();
      const { data, error } = await client.from('students').insert(rows.map(x => ({ ...x, teacher_id: s.user.id }))).select();
      if (error) throw error;
      return data;
    },

    async editStudent(studentId, changes) {
      if (demo) {
        const d = load(); const student = d.students.find(x => x.id === studentId);
        if (!student) throw new Error('Student not found');
        Object.assign(student, changes); save(d); return student;
      }
      const { data, error } = await client.from('students').update(changes).eq('id', studentId).select().single();
      if (error) throw error;
      return data;
    },

    async deleteStudent(studentId) {
      if (demo) { const d = load(); d.students = d.students.filter(x => x.id !== studentId); save(d); return; }
      const { data, error } = await client.from('students').delete().eq('id', studentId).select('id');
      if (error) throw error;
      if(!data?.length)throw new Error('Student was not deleted. Check your delete permissions.');
    },

    async setArchived(kind, itemId, archived) {
      if (!['classes', 'exams'].includes(kind)) throw new Error('Invalid archive type.');
      if (demo) {
        const d = load(); const row = d[kind].find(x => x.id === itemId);
        if (!row) throw new Error('Item not found.');
        row.is_archived = archived; save(d); return row;
      }
      const { data, error } = await client.from(kind).update({ is_archived: archived }).eq('id', itemId).select().single();
      if (error) throw error;
      return data;
    },

    async exams() {
      if (demo) return load().exams;
      const { data, error } = await client.from('exams').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },

    async createExam(payload, key = []) {
      const completeKey = Array.isArray(key)
        && key.length === Number(payload.question_count)
        && key.every(answer => Boolean(answer));
      if (demo) {
        const d = load();
        const row = { id: id('exam'), teacher_id: 'demo-user', created_at: now(), ...payload };
        d.exams.unshift(row);
        d.keys[row.id] = completeKey ? key : [];
        save(d);
        return row;
      }
      const s = await this.session();
      const { data: exam, error } = await client.from('exams').insert({ ...payload, teacher_id: s.user.id }).select().single();
      if (error) throw error;
      if (completeKey) {
        const rows = key.map((answer, i) => ({ exam_id: exam.id, question_number: i + 1, correct_answer: answer }));
        const keyInsert = await client.from('exam_keys').insert(rows);
        if (keyInsert.error) throw keyInsert.error;
      }
      return exam;
    },

    async updateExam(examId, payload) {
      if (demo) {
        const d = load();
        const row = d.exams.find(x => x.id === examId);
        if (!row) throw new Error('Exam not found.');
        Object.assign(row, payload);
        save(d);
        return row;
      }
      const { data, error } = await client.from('exams').update(payload).eq('id', examId).select().single();
      if (error) throw error;
      return data;
    },

    async deleteExam(examId) {
      if (demo) {
        const d = load();
        d.exams = d.exams.filter(x => x.id !== examId);
        delete d.keys[examId];
        const removedResultIds = d.results.filter(r => r.exam_id === examId).map(r => r.id);
        d.results = d.results.filter(r => r.exam_id !== examId);
        removedResultIds.forEach(resultId => delete d.resultAnswers[resultId]);
        save(d);
        return true;
      }
      return this.deleteOwnedItem('exams',examId);
    },
    async deleteClass(classId) {
      if(demo){
        const d=load();const ids=d.results.filter(r=>r.class_id===classId).map(r=>r.id);
        d.classes=d.classes.filter(c=>c.id!==classId);d.students=d.students.filter(s=>s.class_id!==classId);
        d.results=d.results.filter(r=>r.class_id!==classId);ids.forEach(id=>delete d.resultAnswers[id]);save(d);return true;
      }
      return this.deleteOwnedItem('classes',classId);
    },
    async deleteOwnedItem(kind,itemId) {
      if(!['classes','exams'].includes(kind))throw new Error('Invalid item type.');
      const scans=await client.from('results').select('scan_path').eq(kind==='classes'?'class_id':'exam_id',itemId);
      if(scans.error)throw scans.error;
      const removed=await client.from(kind).delete().eq('id',itemId).select('id');
      if(removed.error)throw removed.error;
      if(!removed.data?.length)throw new Error('Nothing was deleted. The item is missing or your account has no delete permission.');
      const paths=(scans.data||[]).map(x=>x.scan_path).filter(Boolean);
      if(paths.length){
        try{const cleanup=await client.storage.from(cfg.storageBucket||'gradedock-scans').remove(paths);if(cleanup.error)throw cleanup.error;}
        catch(e){console.warn('Records deleted; stored image cleanup failed:',e);}
      }
      return true;
    },

    async replaceExamKey(examId, key = []) {
      if (!Array.isArray(key) || !key.length || key.some(answer => !answer)) {
        throw new Error('The imported answer key must contain a correct answer for every item.');
      }
      if (demo) {
        const d = load();
        d.keys[examId] = [...key];
        save(d);
        return key;
      }
      const removed = await client.from('exam_keys').delete().eq('exam_id', examId);
      if (removed.error) throw removed.error;
      const rows = key.map((answer, i) => ({ exam_id: examId, question_number: i + 1, correct_answer: answer }));
      const inserted = await client.from('exam_keys').insert(rows);
      if (inserted.error) throw inserted.error;
      return key;
    },

    async examKey(examId) {
      if (demo) return load().keys[examId] || [];
      const { data, error } = await client.from('exam_keys')
        .select('question_number,correct_answer')
        .eq('exam_id', examId)
        .order('question_number');
      if (error) throw error;
      return data.map(x => x.correct_answer);
    },

    async results() {
      if (demo) return load().results;
      const { data, error } = await client.from('results')
        .select('*, classes(section,name,grade_level), exams(title)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(r => ({
        ...r,
        student_name: r.student_name || 'Unnamed student',
        exam_title: r.exams?.title || 'Exam',
        class_name: r.classes?.section || r.classes?.name || 'Unassigned',
        grade_level: r.classes?.grade_level || ''
      }));
    },

    async resultAnswers(resultId) {
      if (demo) return load().resultAnswers[resultId] || [];
      const { data, error } = await client.from('result_answers')
        .select('result_id,question_number,student_answer,correct_answer,is_correct,status')
        .eq('result_id', resultId)
        .order('question_number');
      if (error) throw error;
      return data || [];
    },

    async updateResultAnswers(resultId, answers) {
      const normalized = (answers || []).map(a => ({
        result_id: resultId,
        question_number: Number(a.question_number ?? a.question),
        student_answer: a.student_answer ?? a.answer ?? null,
        correct_answer: a.correct_answer ?? a.key ?? null,
        is_correct: Boolean(a.is_correct ?? a.isCorrect),
        status: a.status ?? a.state ?? 'ok'
      }));
      if (!normalized.length) throw new Error('No saved answers were found for this result.');

      const score = normalized.filter(a => a.is_correct).length;
      const total_items = normalized.length;
      const percentage = Math.round((score / total_items) * 10000) / 100;
      const review_count = normalized.filter(a => a.status !== 'ok').length;

      if (demo) {
        const d = load();
        const row = d.results.find(r => r.id === resultId);
        if (!row) throw new Error('Result not found.');
        d.resultAnswers[resultId] = normalized;
        Object.assign(row, { score, total_items, percentage, review_count });
        save(d);
        return row;
      }

      const saved = await client.from('result_answers')
        .upsert(normalized, { onConflict: 'result_id,question_number' });
      if (saved.error) throw saved.error;

      const { data: row, error } = await client.from('results')
        .update({ score, total_items, percentage, review_count })
        .eq('id', resultId)
        .select()
        .single();
      if (error) throw error;
      return row;
    },


    async deleteResult(resultId) {
      if (demo) {
        const d = load();
        d.results = d.results.filter(r => r.id !== resultId);
        delete d.resultAnswers[resultId];
        save(d);
        return true;
      }

      const existing = await client.from('results')
        .select('id,scan_path')
        .eq('id', resultId)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (!existing.data) throw new Error('Result not found.');

      const scanPath = existing.data.scan_path || null;
      const removed = await client.from('results').delete().eq('id', resultId);
      if (removed.error) throw removed.error;

      // result_answers are removed automatically by ON DELETE CASCADE.
      // If a stored scan image exists, remove it after the database row succeeds.
      if (scanPath) {
        const storageRemoved = await client.storage
          .from(cfg.storageBucket || 'gradedock-scans')
          .remove([scanPath]);
        if (storageRemoved.error) console.warn('Could not remove stored scan image:', storageRemoved.error);
      }
      return true;
    },

    async saveResult(payload, answers, imageBlob) {
      if (demo) {
        const d = load();
        const cls = d.classes.find(c => c.id === payload.class_id);
        const exam = d.exams.find(e => e.id === payload.exam_id);
        const row = {
          id: id('result'),
          created_at: now(),
          class_name: cls?.section || cls?.name || 'Unassigned',
          grade_level: cls?.grade_level || '',
          exam_title: exam?.title || 'Exam',
          ...payload
        };
        d.results.unshift(row);
        d.resultAnswers[row.id] = (answers || []).map(a => ({
          result_id: row.id,
          question_number: a.question,
          student_answer: a.answer || null,
          correct_answer: a.key || null,
          is_correct: Boolean(a.isCorrect),
          status: a.state || 'ok'
        }));
        save(d);
        return row;
      }

      const s = await this.session();
      let scan_path = null;
      if (imageBlob && localStorage.getItem('gradedock_store_scans') === '1') {
        const file = `${s.user.id}/${payload.exam_id}/${Date.now()}.jpg`;
        const upload = await client.storage.from(cfg.storageBucket || 'gradedock-scans')
          .upload(file, imageBlob, { contentType: 'image/jpeg', upsert: false });
        if (!upload.error) scan_path = file;
      }

      const { data: row, error } = await client.from('results')
        .insert({ ...payload, teacher_id: s.user.id, scan_path })
        .select()
        .single();
      if (error) throw error;

      const answerRows = answers.map(a => ({
        result_id: row.id,
        question_number: a.question,
        student_answer: a.answer || null,
        correct_answer: a.key || null,
        is_correct: a.isCorrect,
        status: a.state
      }));
      const q = await client.from('result_answers').insert(answerRows);
      if (q.error) throw q.error;
      return row;
    }
  };

  window.GradeDockStore = Store;
})();
