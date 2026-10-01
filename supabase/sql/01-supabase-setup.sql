-- =====================================================================
-- MATHSIDE — ENERGETIC ORANGE V2
-- COMPLETE SUPABASE DATABASE / RLS / STORAGE SETUP
-- =====================================================================
-- IMPORTANT:
-- 1) Run this in a NEW Mathside Supabase project.
-- 2) Add YOUR teacher email to mathside_teacher_allowlist BEFORE signing up.
-- 3) This package's app.js uses Supabase Auth, Database, Storage and RPCs.
-- 4) Automatic student account creation is handled by the included
--    create-students Edge Function. Never put a secret/service-role key
--    in frontend JavaScript.
-- =====================================================================

begin;

create extension if not exists pgcrypto;

create schema if not exists mathside_private;
revoke all on schema mathside_private from public;
grant usage on schema mathside_private to authenticated, anon;

-- ---------------------------------------------------------------------
-- 1. TEACHER ALLOWLIST
-- ---------------------------------------------------------------------
-- Only emails listed here can become teachers through public signup.
-- Student accounts are created only by the included trusted Edge Function.
-- Any other signup is rejected by the auth trigger.

create table if not exists public.mathside_teacher_allowlist (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.mathside_teacher_allowlist enable row level security;
revoke all on public.mathside_teacher_allowlist from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. PROFILES
-- ---------------------------------------------------------------------

create table if not exists public.mathside_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'student'
    check (role in ('teacher','student')),
  username text unique,
  gender text
    check (gender is null or gender in ('Female','Male','Prefer not to say','Not specified')),
  grade_level integer
    check (grade_level is null or grade_level between 7 and 12),
  avatar_path text,
  created_by_teacher uuid references public.mathside_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mathside_profiles_role_idx
  on public.mathside_profiles(role);

create index if not exists mathside_profiles_grade_idx
  on public.mathside_profiles(grade_level);

-- ---------------------------------------------------------------------
-- 3. CLASSES
-- ---------------------------------------------------------------------
-- Teachers create only the classes they actually teach.
-- Each class stores its selected grade level (7 to 12).

create table if not exists public.mathside_sections (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.mathside_profiles(id) on delete cascade,
  grade_level integer not null check (grade_level between 7 and 12),
  name text not null,
  school_year text,
  color text not null default '#ff6b00',
  created_at timestamptz not null default now(),
  unique (teacher_id, grade_level, name)
);

create index if not exists mathside_sections_teacher_idx
  on public.mathside_sections(teacher_id);

create table if not exists public.mathside_section_members (
  section_id uuid not null references public.mathside_sections(id) on delete cascade,
  student_id uuid not null references public.mathside_profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (section_id, student_id)
);

create index if not exists mathside_members_student_idx
  on public.mathside_section_members(student_id);

-- ---------------------------------------------------------------------
-- 4. USERNAME -> AUTH EMAIL ALIAS
-- ---------------------------------------------------------------------
-- Supabase Auth uses email/password. For generated student usernames,
-- the secure account-creation Edge Function can create a synthetic auth
-- email such as:
--   g9.santos.j@students.mathside.invalid
-- and store that mapping here.
--
-- The frontend can call mathside_resolve_login(username) before
-- signInWithPassword().

create table if not exists public.mathside_login_aliases (
  username text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  auth_email text not null unique,
  created_at timestamptz not null default now()
);

alter table public.mathside_login_aliases enable row level security;
revoke all on public.mathside_login_aliases from anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. ASSIGNMENTS
-- ---------------------------------------------------------------------

create table if not exists public.mathside_assignments (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.mathside_sections(id) on delete cascade,
  teacher_id uuid not null references public.mathside_profiles(id) on delete cascade,
  title text not null,
  instructions text,
  image_path text,
  due_at timestamptz,
  publish_at timestamptz,
  reminder_hours_before integer not null default 0
    check (reminder_hours_before in (0,24,48,72)),
  status text not null default 'published'
    check (status in ('draft','published','archived')),
  allow_resubmission boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mathside_assignments_section_due_idx
  on public.mathside_assignments(section_id, due_at);

create index if not exists mathside_assignments_teacher_idx
  on public.mathside_assignments(teacher_id);

create index if not exists mathside_assignments_publish_at_idx
  on public.mathside_assignments(status, publish_at)
  where publish_at is not null;

-- ---------------------------------------------------------------------
-- 6. QUESTIONS
-- ---------------------------------------------------------------------
-- Correct answers are intentionally kept in a separate protected table
-- so students cannot download the answer key through the API.

create table if not exists public.mathside_questions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.mathside_assignments(id) on delete cascade,
  position integer not null check (position > 0),
  question_text text not null,
  question_type text not null default 'short'
    check (question_type in ('short','mcq')),
  options jsonb,
  max_points numeric(10,2) not null default 1 check (max_points >= 0),
  created_at timestamptz not null default now(),
  unique (assignment_id, position),
  check (
    (question_type = 'short' and options is null)
    or
    (question_type = 'mcq' and jsonb_typeof(options) = 'array')
  )
);

create index if not exists mathside_questions_assignment_idx
  on public.mathside_questions(assignment_id, position);

create table if not exists public.mathside_question_keys (
  question_id uuid primary key references public.mathside_questions(id) on delete cascade,
  correct_answer text not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7. SUBMISSIONS + ANSWERS
-- ---------------------------------------------------------------------

create table if not exists public.mathside_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.mathside_assignments(id) on delete cascade,
  student_id uuid not null references public.mathside_profiles(id) on delete cascade,
  status text not null default 'submitted'
    check (status in ('submitted','graded','revision')),
  proof_path text,
  auto_score numeric(10,2) not null default 0 check (auto_score >= 0),
  teacher_score numeric(10,2),
  feedback text,
  attempt_count integer not null default 1 check (attempt_count >= 1),
  submitted_at timestamptz not null default now(),
  graded_at timestamptz,
  graded_by uuid references public.mathside_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);

create index if not exists mathside_submissions_assignment_idx
  on public.mathside_submissions(assignment_id);

create index if not exists mathside_submissions_student_idx
  on public.mathside_submissions(student_id);

create table if not exists public.mathside_submission_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.mathside_submissions(id) on delete cascade,
  question_id uuid not null references public.mathside_questions(id) on delete cascade,
  answer_text text,
  is_correct boolean,
  awarded_points numeric(10,2) not null default 0 check (awarded_points >= 0),
  created_at timestamptz not null default now(),
  unique (submission_id, question_id)
);

create index if not exists mathside_answers_submission_idx
  on public.mathside_submission_answers(submission_id);

-- ---------------------------------------------------------------------
-- 8. GENERIC UPDATED_AT TRIGGER
-- ---------------------------------------------------------------------

create or replace function mathside_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists mathside_profiles_touch on public.mathside_profiles;
create trigger mathside_profiles_touch
before update on public.mathside_profiles
for each row execute function mathside_private.touch_updated_at();

drop trigger if exists mathside_assignments_touch on public.mathside_assignments;
create trigger mathside_assignments_touch
before update on public.mathside_assignments
for each row execute function mathside_private.touch_updated_at();

drop trigger if exists mathside_submissions_touch on public.mathside_submissions;
create trigger mathside_submissions_touch
before update on public.mathside_submissions
for each row execute function mathside_private.touch_updated_at();

-- ---------------------------------------------------------------------
-- 9. PRIVATE SECURITY HELPERS
-- ---------------------------------------------------------------------

create or replace function mathside_private.safe_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

create or replace function mathside_private.is_teacher(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.mathside_profiles p
    where p.id = p_uid
      and p.role = 'teacher'
  );
$$;

create or replace function mathside_private.is_student(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.mathside_profiles p
    where p.id = p_uid
      and p.role = 'student'
  );
$$;

create or replace function mathside_private.teacher_owns_section(
  p_section uuid,
  p_teacher uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.mathside_sections s
    where s.id = p_section
      and s.teacher_id = p_teacher
  );
$$;

create or replace function mathside_private.student_in_section(
  p_section uuid,
  p_student uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.mathside_section_members m
    where m.section_id = p_section
      and m.student_id = p_student
  );
$$;

create or replace function mathside_private.teacher_owns_assignment(
  p_assignment uuid,
  p_teacher uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.mathside_assignments a
    where a.id = p_assignment
      and a.teacher_id = p_teacher
  );
$$;

create or replace function mathside_private.teacher_can_view_student(
  p_student uuid,
  p_teacher uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.mathside_section_members m
    join public.mathside_sections s
      on s.id = m.section_id
    where m.student_id = p_student
      and s.teacher_id = p_teacher
  );
$$;

revoke all on all functions in schema mathside_private from public, anon;
grant execute on all functions in schema mathside_private to authenticated;
grant execute on function mathside_private.safe_uuid(text) to anon;

-- ---------------------------------------------------------------------
-- 10. AUTH USER -> PROFILE TRIGGER
-- ---------------------------------------------------------------------
-- Teacher:
--   email must already exist in mathside_teacher_allowlist.
--
-- Student created by secure Edge Function:
--   raw_app_meta_data (server controlled) includes:
--     mathside_role      = "student"
--     username           = "g9.student.name"
--     gender             = "Female" / "Male" / ...
--     section_id         = UUID
--     created_by_teacher = teacher UUID
--   raw_user_meta_data may include the display_name only.
-- Never use raw_user_meta_data for section/role authorization because users
-- can edit their own user metadata.

create or replace function public.mathside_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  -- Student Auth users are created only by the secure Edge Function.
  -- Do not attempt to build the Mathside student profile in this INSERT
  -- trigger because custom app_metadata may not yet be visible here.
  if lower(coalesce(new.email, '')) like '%@students.mathside.invalid' then
    return new;
  end if;

  -- Public browser signup is for allowlisted teachers only.
  if not exists (
    select 1
    from public.mathside_teacher_allowlist a
    where lower(a.email) = lower(new.email)
  ) then
    raise exception 'This email is not authorized as a Mathside teacher.';
  end if;

  v_name := coalesce(
    nullif(new.raw_user_meta_data->>'display_name',''),
    split_part(new.email,'@',1),
    'Teacher'
  );

  insert into public.mathside_profiles(
    id,
    display_name,
    role,
    username,
    gender,
    grade_level,
    created_by_teacher
  )
  values (
    new.id,
    v_name,
    'teacher',
    null,
    null,
    null,
    null
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        role = 'teacher';

  -- Class-first design: do NOT automatically create Grade 7–12 classes.
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_mathside on auth.users;
create trigger on_auth_user_created_mathside
after insert on auth.users
for each row execute function public.mathside_handle_new_user();

revoke all on function public.mathside_handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 11. USERNAME LOGIN RESOLVER
-- ---------------------------------------------------------------------
-- Frontend flow:
--   const { data: email } = await supabase.rpc(
--     'mathside_resolve_login',
--     { p_username: login }
--   );
-- then signInWithPassword({ email, password })

create or replace function public.mathside_resolve_login(p_username text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.auth_email
  from public.mathside_login_aliases a
  where a.username = lower(trim(p_username))
  limit 1;
$$;

revoke all on function public.mathside_resolve_login(text) from public;
grant execute on function public.mathside_resolve_login(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 12. SECURE ASSIGNMENT SUBMISSION + AUTO-CHECK
-- ---------------------------------------------------------------------
-- p_answers JSON:
-- [
--   {"question_id":"UUID","answer":"5"},
--   {"question_id":"UUID","answer":"Option A"}
-- ]
--
-- Auto-check is exact text matching after trim/lowercase.
-- This is appropriate for MCQ and simple short answers.
-- More complex Mathematics equivalence should still be manually reviewed.

create or replace function public.mathside_submit_assignment(
  p_assignment_id uuid,
  p_answers jsonb,
  p_proof_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_assignment public.mathside_assignments;
  v_existing public.mathside_submissions;
  v_submission_id uuid;
  v_auto_score numeric(10,2) := 0;
  v_attempt integer := 1;
  v_answer jsonb;
  v_question public.mathside_questions;
  v_key text;
  v_text text;
  v_correct boolean;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  if not mathside_private.is_student(v_uid) then
    raise exception 'Only student accounts can submit assignments.';
  end if;

  select *
  into v_assignment
  from public.mathside_assignments
  where id = p_assignment_id
    and status = 'published';

  if v_assignment.id is null then
    raise exception 'Assignment not found.';
  end if;

  if not mathside_private.student_in_section(v_assignment.section_id, v_uid) then
    raise exception 'This assignment is not assigned to your section.';
  end if;

  select *
  into v_existing
  from public.mathside_submissions
  where assignment_id = p_assignment_id
    and student_id = v_uid
  for update;

  if v_existing.id is not null then
    if not v_assignment.allow_resubmission then
      raise exception 'This assignment has already been submitted.';
    end if;

    v_submission_id := v_existing.id;
    v_attempt := v_existing.attempt_count + 1;

    delete from public.mathside_submission_answers
    where submission_id = v_submission_id;

    update public.mathside_submissions
    set
      status = 'submitted',
      proof_path = coalesce(p_proof_path, v_existing.proof_path),
      auto_score = 0,
      teacher_score = null,
      feedback = null,
      attempt_count = v_attempt,
      submitted_at = now(),
      graded_at = null,
      graded_by = null
    where id = v_submission_id;
  else
    insert into public.mathside_submissions(
      assignment_id,
      student_id,
      proof_path,
      status
    )
    values(
      p_assignment_id,
      v_uid,
      p_proof_path,
      'submitted'
    )
    returning id into v_submission_id;
  end if;

  for v_answer in
    select value
    from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb))
  loop
    select q.*
    into v_question
    from public.mathside_questions q
    where q.id = mathside_private.safe_uuid(v_answer->>'question_id')
      and q.assignment_id = p_assignment_id;

    if v_question.id is null then
      continue;
    end if;

    select k.correct_answer
    into v_key
    from public.mathside_question_keys k
    where k.question_id = v_question.id;

    v_text := coalesce(v_answer->>'answer','');

    v_correct :=
      length(btrim(coalesce(v_key,''))) > 0
      and lower(btrim(v_text)) = lower(btrim(v_key));

    insert into public.mathside_submission_answers(
      submission_id,
      question_id,
      answer_text,
      is_correct,
      awarded_points
    )
    values(
      v_submission_id,
      v_question.id,
      v_text,
      v_correct,
      case when v_correct then v_question.max_points else 0 end
    );

    if v_correct then
      v_auto_score := v_auto_score + v_question.max_points;
    end if;
  end loop;

  update public.mathside_submissions
  set auto_score = v_auto_score
  where id = v_submission_id;

  return jsonb_build_object(
    'submission_id', v_submission_id,
    'auto_score', v_auto_score,
    'attempt_count', v_attempt
  );
end;
$$;

revoke all on function public.mathside_submit_assignment(uuid,jsonb,text) from public, anon;
grant execute on function public.mathside_submit_assignment(uuid,jsonb,text) to authenticated;

-- ---------------------------------------------------------------------
-- 13. TEACHER GRADING
-- ---------------------------------------------------------------------

create or replace function public.mathside_grade_submission(
  p_submission_id uuid,
  p_teacher_score numeric,
  p_feedback text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_submission public.mathside_submissions;
  v_assignment public.mathside_assignments;
  v_max_score numeric(10,2);
begin
  if v_uid is null or not mathside_private.is_teacher(v_uid) then
    raise exception 'Only teachers can grade submissions.';
  end if;

  select *
  into v_submission
  from public.mathside_submissions
  where id = p_submission_id
  for update;

  if v_submission.id is null then
    raise exception 'Submission not found.';
  end if;

  select *
  into v_assignment
  from public.mathside_assignments
  where id = v_submission.assignment_id;

  if v_assignment.teacher_id <> v_uid then
    raise exception 'You do not own this assignment.';
  end if;

  select coalesce(sum(q.max_points), 0)
  into v_max_score
  from public.mathside_questions q
  where q.assignment_id = v_assignment.id;

  if p_teacher_score is not null and p_teacher_score < 0 then
    raise exception 'Score cannot be negative.';
  end if;

  if p_teacher_score is not null and p_teacher_score > v_max_score then
    raise exception 'Score cannot exceed %.', v_max_score;
  end if;

  update public.mathside_submissions
  set
    teacher_score = p_teacher_score,
    feedback = p_feedback,
    status = 'graded',
    graded_at = now(),
    graded_by = v_uid
  where id = p_submission_id;

  return jsonb_build_object(
    'submission_id', p_submission_id,
    'auto_score', v_submission.auto_score,
    'teacher_score', p_teacher_score
  );
end;
$$;

revoke all on function public.mathside_grade_submission(uuid,numeric,text) from public, anon;
grant execute on function public.mathside_grade_submission(uuid,numeric,text) to authenticated;

-- ---------------------------------------------------------------------
-- 14. RLS
-- ---------------------------------------------------------------------

alter table public.mathside_profiles enable row level security;
alter table public.mathside_sections enable row level security;
alter table public.mathside_section_members enable row level security;
alter table public.mathside_assignments enable row level security;
alter table public.mathside_questions enable row level security;
alter table public.mathside_question_keys enable row level security;
alter table public.mathside_submissions enable row level security;
alter table public.mathside_submission_answers enable row level security;

drop policy if exists mathside_profiles_select on public.mathside_profiles;
drop policy if exists mathside_profiles_update_self on public.mathside_profiles;

drop policy if exists mathside_sections_select on public.mathside_sections;
drop policy if exists mathside_sections_insert_teacher on public.mathside_sections;
drop policy if exists mathside_sections_update_teacher on public.mathside_sections;
drop policy if exists mathside_sections_delete_teacher on public.mathside_sections;

drop policy if exists mathside_members_select on public.mathside_section_members;

drop policy if exists mathside_assignments_select on public.mathside_assignments;
drop policy if exists mathside_assignments_insert on public.mathside_assignments;
drop policy if exists mathside_assignments_update on public.mathside_assignments;
drop policy if exists mathside_assignments_delete on public.mathside_assignments;

drop policy if exists mathside_questions_select on public.mathside_questions;
drop policy if exists mathside_questions_insert on public.mathside_questions;
drop policy if exists mathside_questions_update on public.mathside_questions;
drop policy if exists mathside_questions_delete on public.mathside_questions;

drop policy if exists mathside_keys_teacher_all on public.mathside_question_keys;

drop policy if exists mathside_submissions_select on public.mathside_submissions;
drop policy if exists mathside_answers_select on public.mathside_submission_answers;

-- PROFILES
create policy mathside_profiles_select
on public.mathside_profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (
    role = 'student'
    and mathside_private.teacher_can_view_student(id, (select auth.uid()))
  )
);

create policy mathside_profiles_update_self
on public.mathside_profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- SECTIONS
create policy mathside_sections_select
on public.mathside_sections
for select
to authenticated
using (
  teacher_id = (select auth.uid())
  or mathside_private.student_in_section(id, (select auth.uid()))
);

create policy mathside_sections_insert_teacher
on public.mathside_sections
for insert
to authenticated
with check (
  teacher_id = (select auth.uid())
  and mathside_private.is_teacher((select auth.uid()))
);

create policy mathside_sections_update_teacher
on public.mathside_sections
for update
to authenticated
using (teacher_id = (select auth.uid()))
with check (teacher_id = (select auth.uid()));

create policy mathside_sections_delete_teacher
on public.mathside_sections
for delete
to authenticated
using (
  teacher_id = (select auth.uid())
  and mathside_private.is_teacher((select auth.uid()))
);

-- MEMBERS
create policy mathside_members_select
on public.mathside_section_members
for select
to authenticated
using (
  student_id = (select auth.uid())
  or mathside_private.teacher_owns_section(section_id, (select auth.uid()))
);

-- ASSIGNMENTS
create policy mathside_assignments_select
on public.mathside_assignments
for select
to authenticated
using (
  teacher_id = (select auth.uid())
  or (
    status = 'published'
    and mathside_private.student_in_section(section_id, (select auth.uid()))
  )
);

create policy mathside_assignments_insert
on public.mathside_assignments
for insert
to authenticated
with check (
  teacher_id = (select auth.uid())
  and mathside_private.is_teacher((select auth.uid()))
  and mathside_private.teacher_owns_section(section_id, (select auth.uid()))
);

create policy mathside_assignments_update
on public.mathside_assignments
for update
to authenticated
using (teacher_id = (select auth.uid()))
with check (
  teacher_id = (select auth.uid())
  and mathside_private.teacher_owns_section(section_id, (select auth.uid()))
);

create policy mathside_assignments_delete
on public.mathside_assignments
for delete
to authenticated
using (teacher_id = (select auth.uid()));

-- QUESTIONS
create policy mathside_questions_select
on public.mathside_questions
for select
to authenticated
using (
  exists (
    select 1
    from public.mathside_assignments a
    where a.id = assignment_id
      and (
        a.teacher_id = (select auth.uid())
        or (
          a.status = 'published'
          and mathside_private.student_in_section(
            a.section_id,
            (select auth.uid())
          )
        )
      )
  )
);

create policy mathside_questions_insert
on public.mathside_questions
for insert
to authenticated
with check (
  mathside_private.teacher_owns_assignment(
    assignment_id,
    (select auth.uid())
  )
);

create policy mathside_questions_update
on public.mathside_questions
for update
to authenticated
using (
  mathside_private.teacher_owns_assignment(
    assignment_id,
    (select auth.uid())
  )
)
with check (
  mathside_private.teacher_owns_assignment(
    assignment_id,
    (select auth.uid())
  )
);

create policy mathside_questions_delete
on public.mathside_questions
for delete
to authenticated
using (
  mathside_private.teacher_owns_assignment(
    assignment_id,
    (select auth.uid())
  )
);

-- ANSWER KEY: TEACHER ONLY
create policy mathside_keys_teacher_all
on public.mathside_question_keys
for all
to authenticated
using (
  exists (
    select 1
    from public.mathside_questions q
    join public.mathside_assignments a
      on a.id = q.assignment_id
    where q.id = question_id
      and a.teacher_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.mathside_questions q
    join public.mathside_assignments a
      on a.id = q.assignment_id
    where q.id = question_id
      and a.teacher_id = (select auth.uid())
  )
);

-- SUBMISSIONS
create policy mathside_submissions_select
on public.mathside_submissions
for select
to authenticated
using (
  student_id = (select auth.uid())
  or exists (
    select 1
    from public.mathside_assignments a
    where a.id = assignment_id
      and a.teacher_id = (select auth.uid())
  )
);

-- ANSWERS
create policy mathside_answers_select
on public.mathside_submission_answers
for select
to authenticated
using (
  exists (
    select 1
    from public.mathside_submissions s
    join public.mathside_assignments a
      on a.id = s.assignment_id
    where s.id = submission_id
      and (
        s.student_id = (select auth.uid())
        or a.teacher_id = (select auth.uid())
      )
  )
);

-- ---------------------------------------------------------------------
-- 15. TABLE GRANTS
-- ---------------------------------------------------------------------
-- RLS still determines which rows are allowed.

grant select on
  public.mathside_profiles,
  public.mathside_sections,
  public.mathside_section_members,
  public.mathside_assignments,
  public.mathside_questions,
  public.mathside_submissions,
  public.mathside_submission_answers
to authenticated;

grant select, insert, update, delete
on public.mathside_assignments
to authenticated;

grant select, insert, update, delete
on public.mathside_questions
to authenticated;

grant select, insert, update, delete
on public.mathside_question_keys
to authenticated;

-- Only safe profile columns can be edited directly by a user.
revoke update on public.mathside_profiles from authenticated;
grant update(display_name, avatar_path)
on public.mathside_profiles
to authenticated;

grant select, insert, update, delete
on public.mathside_sections
to authenticated;

-- The Edge Function uses an admin client. New Supabase projects no longer
-- auto-expose public tables, so grant the service role explicit table access.
grant select, insert, update, delete on
  public.mathside_teacher_allowlist,
  public.mathside_profiles,
  public.mathside_sections,
  public.mathside_section_members,
  public.mathside_login_aliases,
  public.mathside_assignments,
  public.mathside_questions,
  public.mathside_question_keys,
  public.mathside_submissions,
  public.mathside_submission_answers
to service_role;

-- Submissions/answers are written through secure RPCs.
revoke insert, update, delete
on public.mathside_submissions
from authenticated;

revoke insert, update, delete
on public.mathside_submission_answers
from authenticated;

-- ---------------------------------------------------------------------
-- 16. STORAGE BUCKETS
-- ---------------------------------------------------------------------

insert into storage.buckets(
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
(
  'mathside-assignment-images',
  'mathside-assignment-images',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']
),
(
  'mathside-submission-proofs',
  'mathside-submission-proofs',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']
),
(
  'mathside-avatars',
  'mathside-avatars',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Remove old Mathside storage policies if this file is rerun.
drop policy if exists mathside_assignment_image_upload on storage.objects;
drop policy if exists mathside_assignment_image_read on storage.objects;
drop policy if exists mathside_assignment_image_delete on storage.objects;

drop policy if exists mathside_proof_upload on storage.objects;
drop policy if exists mathside_proof_read on storage.objects;
drop policy if exists mathside_proof_delete on storage.objects;

drop policy if exists mathside_avatar_upload on storage.objects;
drop policy if exists mathside_avatar_update on storage.objects;
drop policy if exists mathside_avatar_read on storage.objects;
drop policy if exists mathside_avatar_delete on storage.objects;

-- Assignment image path:
--   <teacher_uid>/<assignment_uuid>/<filename>

create policy mathside_assignment_image_upload
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'mathside-assignment-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and mathside_private.is_teacher((select auth.uid()))
  and mathside_private.teacher_owns_assignment(
    mathside_private.safe_uuid((storage.foldername(name))[2]),
    (select auth.uid())
  )
);

create policy mathside_assignment_image_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'mathside-assignment-images'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1
      from public.mathside_assignments a
      where a.id = mathside_private.safe_uuid((storage.foldername(name))[2])
        and (
          a.teacher_id = (select auth.uid())
          or mathside_private.student_in_section(
            a.section_id,
            (select auth.uid())
          )
        )
    )
  )
);

create policy mathside_assignment_image_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'mathside-assignment-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and mathside_private.is_teacher((select auth.uid()))
);

-- Student proof path:
--   <student_uid>/<assignment_uuid>/<filename>
-- The assignment UUID is known before the submit RPC runs.

create policy mathside_proof_upload
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'mathside-submission-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and mathside_private.is_student((select auth.uid()))
);

create policy mathside_proof_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'mathside-submission-proofs'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1
      from public.mathside_assignments a
      where a.id = mathside_private.safe_uuid(
        (storage.foldername(name))[2]
      )
        and a.teacher_id = (select auth.uid())
    )
  )
);

create policy mathside_proof_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'mathside-submission-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Avatar path:
--   <user_uid>/<filename>

create policy mathside_avatar_upload
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'mathside-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy mathside_avatar_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'mathside-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'mathside-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy mathside_avatar_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'mathside-avatars'
);

create policy mathside_avatar_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'mathside-avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- ---------------------------------------------------------------------
-- 17. POSTGREST RELOAD
-- ---------------------------------------------------------------------

commit;

notify pgrst, 'reload schema';

-- =====================================================================
-- AFTER RUNNING THIS FILE
-- =====================================================================
--
-- A) BEFORE creating your teacher account, allowlist your email:
--
-- insert into public.mathside_teacher_allowlist(email)
-- values ('YOUR_EMAIL@example.com')
-- on conflict do nothing;
--
-- B) AUTO-GENERATED STUDENT AUTH ACCOUNTS:
-- Deploy the included supabase/functions/create-students Edge Function.
-- It verifies the signed-in teacher, creates Auth users with an admin client,
-- and returns each temporary password to the teacher only once.
-- Never store a secret/service-role key in index.html, config.js or app.js.
-- =====================================================================


-- ---------------------------------------------------------------------
-- SCHEDULED ASSIGNMENT PUBLISHING
-- ---------------------------------------------------------------------
alter table public.mathside_assignments
  add column if not exists publish_at timestamptz;

create or replace function mathside_private.publish_scheduled_assignments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  update public.mathside_assignments
     set status = 'published', updated_at = now()
   where status = 'draft'
     and publish_at is not null
     and publish_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function mathside_private.publish_scheduled_assignments() from public;
revoke all on function mathside_private.publish_scheduled_assignments() from anon;
revoke all on function mathside_private.publish_scheduled_assignments() from authenticated;
create extension if not exists pg_cron;
select cron.schedule(
  'mathside-publish-scheduled-assignments',
  '* * * * *',
  $$select mathside_private.publish_scheduled_assignments();$$
);


-- =====================================================================
-- MATHSIDE V10 ADDITIONS (included for fresh installs)
-- =====================================================================

-- =====================================================================
-- MATHSIDE V10 CLASSROOM FEATURES UPGRADE
-- Adds:
--   * Student To-Do List (uses existing assignments/submissions)
--   * Student Calendar (uses existing assignment due dates)
--   * Teacher Feedback Inbox (uses existing graded submissions)
--   * Student assignment draft saving
--   * Assignment resubmission controls (uses existing allow_resubmission)
--   * Notifications Center
--   * Export Class Record to Excel (frontend only)
--
-- Attendance and private messaging are intentionally NOT included.
-- No new Edge Function is required for these V10 features.
--
-- Run this ONCE after the existing Mathside V9.x database setup.
-- This script is idempotent and can be safely re-run.
-- =====================================================================

create extension if not exists pgcrypto;
create schema if not exists mathside_private;

-- ---------------------------------------------------------------------
-- 0. CLEAN UP PRIVATE-MESSAGING OBJECTS FROM ANY EARLIER V10 TEST BUILD
-- ---------------------------------------------------------------------
-- These statements do nothing on a normal V9.x database. They make this
-- upgrade safe if an earlier preview of V10 with messaging was tested.
drop table if exists public.mathside_messages cascade;
drop function if exists public.mathside_message_contacts();
drop function if exists public.mathside_send_message(uuid, text, uuid);
drop function if exists public.mathside_get_conversation(uuid);
drop function if exists public.mathside_mark_conversation_read(uuid);
drop function if exists mathside_private.notify_private_message();
drop function if exists mathside_private.can_message_users(uuid, uuid);

-- ---------------------------------------------------------------------
-- 1. STUDENT ASSIGNMENT DRAFTS
-- ---------------------------------------------------------------------
create table if not exists public.mathside_assignment_drafts (
  student_id uuid not null references public.mathside_profiles(id) on delete cascade,
  assignment_id uuid not null references public.mathside_assignments(id) on delete cascade,
  answers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (student_id, assignment_id),
  check (jsonb_typeof(answers) = 'array')
);

create index if not exists mathside_assignment_drafts_updated_idx
  on public.mathside_assignment_drafts(student_id, updated_at desc);

alter table public.mathside_assignment_drafts enable row level security;

drop policy if exists mathside_drafts_select on public.mathside_assignment_drafts;
drop policy if exists mathside_drafts_insert on public.mathside_assignment_drafts;
drop policy if exists mathside_drafts_update on public.mathside_assignment_drafts;
drop policy if exists mathside_drafts_delete on public.mathside_assignment_drafts;

create policy mathside_drafts_select
on public.mathside_assignment_drafts
for select
to authenticated
using (student_id = (select auth.uid()));

create policy mathside_drafts_insert
on public.mathside_assignment_drafts
for insert
to authenticated
with check (
  student_id = (select auth.uid())
  and mathside_private.is_student((select auth.uid()))
  and exists (
    select 1
    from public.mathside_assignments a
    where a.id = assignment_id
      and a.status = 'published'
      and mathside_private.student_in_section(a.section_id, (select auth.uid()))
  )
);

create policy mathside_drafts_update
on public.mathside_assignment_drafts
for update
to authenticated
using (student_id = (select auth.uid()))
with check (
  student_id = (select auth.uid())
  and exists (
    select 1
    from public.mathside_assignments a
    where a.id = assignment_id
      and a.status = 'published'
      and mathside_private.student_in_section(a.section_id, (select auth.uid()))
  )
);

create policy mathside_drafts_delete
on public.mathside_assignment_drafts
for delete
to authenticated
using (student_id = (select auth.uid()));

grant select, insert, update, delete on public.mathside_assignment_drafts to authenticated;

-- ---------------------------------------------------------------------
-- 2. NOTIFICATIONS CENTER
-- ---------------------------------------------------------------------
create table if not exists public.mathside_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.mathside_profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  related_assignment_id uuid references public.mathside_assignments(id) on delete cascade,
  related_submission_id uuid references public.mathside_submissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

-- Remove columns/data that existed only in the abandoned messaging preview.
alter table public.mathside_notifications drop column if exists related_message_id;
delete from public.mathside_notifications where type = 'message';
alter table public.mathside_notifications
  drop constraint if exists mathside_notifications_type_check;
alter table public.mathside_notifications
  add constraint mathside_notifications_type_check
  check (type in ('assignment','submission','feedback','system'));

create index if not exists mathside_notifications_user_created_idx
  on public.mathside_notifications(user_id, created_at desc);
create index if not exists mathside_notifications_user_unread_idx
  on public.mathside_notifications(user_id, created_at desc)
  where read_at is null;

alter table public.mathside_notifications enable row level security;

drop policy if exists mathside_notifications_select on public.mathside_notifications;
create policy mathside_notifications_select
on public.mathside_notifications
for select
to authenticated
using (user_id = (select auth.uid()));

grant select on public.mathside_notifications to authenticated;

create or replace function public.mathside_mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  update public.mathside_notifications
  set read_at = coalesce(read_at, now())
  where user_id = v_uid
    and read_at is null
    and (p_ids is null or id = any(p_ids));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mathside_mark_notifications_read(uuid[]) from public;
grant execute on function public.mathside_mark_notifications_read(uuid[]) to authenticated;

-- Assignment published -> notify students in that section.
create or replace function mathside_private.notify_assignment_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'published' then
      return new;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.status <> 'published' or old.status = 'published' then
      return new;
    end if;
  end if;

  insert into public.mathside_notifications(
    user_id, type, title, body, related_assignment_id
  )
  select
    m.student_id,
    'assignment',
    'New assignment',
    new.title || case when new.due_at is not null then ' · Due ' || to_char(new.due_at at time zone 'UTC', 'Mon DD') else '' end,
    new.id
  from public.mathside_section_members m
  where m.section_id = new.section_id;

  return new;
end;
$$;

-- Student submission/resubmission -> teacher notification.
-- Teacher grade/feedback -> student notification.
create or replace function mathside_private.notify_submission_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.mathside_assignments;
  v_student_name text;
begin
  select * into v_assignment
  from public.mathside_assignments
  where id = new.assignment_id;

  select p.display_name into v_student_name
  from public.mathside_profiles p
  where p.id = new.student_id;

  if tg_op = 'INSERT' then
    insert into public.mathside_notifications(
      user_id, type, title, body, related_assignment_id, related_submission_id
    ) values (
      v_assignment.teacher_id,
      'submission',
      'New submission',
      coalesce(v_student_name, 'A student') || ' submitted ' || coalesce(v_assignment.title, 'an assignment') || '.',
      new.assignment_id,
      new.id
    );
  elsif tg_op = 'UPDATE' then
    if new.attempt_count > old.attempt_count then
      insert into public.mathside_notifications(
        user_id, type, title, body, related_assignment_id, related_submission_id
      ) values (
        v_assignment.teacher_id,
        'submission',
        'Assignment resubmitted',
        coalesce(v_student_name, 'A student') || ' sent attempt ' || new.attempt_count || ' for ' || coalesce(v_assignment.title, 'an assignment') || '.',
        new.assignment_id,
        new.id
      );
    end if;

    if new.status = 'graded'
       and (old.status is distinct from 'graded' or new.graded_at is distinct from old.graded_at) then
      insert into public.mathside_notifications(
        user_id, type, title, body, related_assignment_id, related_submission_id
      ) values (
        new.student_id,
        'feedback',
        'New teacher feedback',
        coalesce(v_assignment.title, 'Your assignment') || ' has been reviewed.',
        new.assignment_id,
        new.id
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists mathside_assignment_publish_notification on public.mathside_assignments;
create trigger mathside_assignment_publish_notification
after insert or update of status on public.mathside_assignments
for each row execute function mathside_private.notify_assignment_published();

drop trigger if exists mathside_submission_notification on public.mathside_submissions;
create trigger mathside_submission_notification
after insert or update on public.mathside_submissions
for each row execute function mathside_private.notify_submission_change();

-- ---------------------------------------------------------------------
-- 3. CLEAN DRAFT AFTER SUCCESSFUL SUBMISSION / RESUBMISSION
-- ---------------------------------------------------------------------
create or replace function mathside_private.clear_submitted_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.mathside_assignment_drafts
  where student_id = new.student_id
    and assignment_id = new.assignment_id;
  return new;
end;
$$;

drop trigger if exists mathside_submission_clear_draft on public.mathside_submissions;
create trigger mathside_submission_clear_draft
after insert or update of submitted_at on public.mathside_submissions
for each row execute function mathside_private.clear_submitted_draft();

-- ---------------------------------------------------------------------
-- 4. SECURITY CLEANUP
-- ---------------------------------------------------------------------
revoke all on function mathside_private.notify_assignment_published() from public;
revoke all on function mathside_private.notify_submission_change() from public;
revoke all on function mathside_private.clear_submitted_draft() from public;

-- V10 upgrade complete.
