-- =====================================================================
-- MATHSIDE — APPROVE / CONVERT AN EXISTING ACCOUNT TO TEACHER
-- =====================================================================
-- HOW TO USE:
-- 1) Open Supabase > SQL Editor.
-- 2) Change ONLY the email below.
-- 3) Run the whole file.
--
-- This script:
--   • verifies the Auth account already exists
--   • refuses to convert Mathside auto-generated student accounts
--   • adds the email to mathside_teacher_allowlist
--   • creates/fixes the Mathside profile if needed
--   • sets the profile role to 'teacher'
--
-- It does NOT confirm the user's email address for them.
-- =====================================================================

begin;

do $$
declare
  -- ================================================================
  -- CHANGE ONLY THIS EMAIL
  -- ================================================================
  v_email text := lower(trim('TEACHER_EMAIL@example.com'));

  v_uid uuid;
  v_display_name text;
begin
  if v_email = '' or v_email = 'teacher_email@example.com' then
    raise exception 'Replace TEACHER_EMAIL@example.com with the teacher''s real email before running this file.';
  end if;

  -- Find the already-registered Supabase Auth account.
  select
    u.id,
    coalesce(
      nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
      nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
      split_part(u.email, '@', 1),
      'Teacher'
    )
  into v_uid, v_display_name
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_uid is null then
    raise exception 'No Supabase Auth account exists for %. Ask the teacher to register first, then run this approval file.', v_email;
  end if;

  -- Protect auto-generated student accounts from accidental conversion.
  if v_email like '%@students.mathside.invalid' then
    raise exception 'This is a Mathside student account and cannot be approved as a teacher.';
  end if;

  -- Keep the email approved in Mathside's teacher authorization table.
  insert into public.mathside_teacher_allowlist (email)
  values (v_email)
  on conflict (email) do nothing;

  -- Create the profile if it is missing, otherwise convert it to teacher.
  insert into public.mathside_profiles (
    id,
    display_name,
    role,
    username,
    gender,
    grade_level,
    created_by_teacher
  )
  values (
    v_uid,
    v_display_name,
    'teacher',
    null,
    null,
    null,
    null
  )
  on conflict (id) do update
  set
    display_name = case
      when nullif(trim(public.mathside_profiles.display_name), '') is null
        then excluded.display_name
      else public.mathside_profiles.display_name
    end,
    role = 'teacher';

  raise notice 'APPROVED: % is now a Mathside teacher. User ID: %', v_email, v_uid;
end
$$;

commit;

notify pgrst, 'reload schema';

-- OPTIONAL CHECK: this should return role = teacher.
-- Replace the email here too if you want to verify manually.
--
-- select
--   u.id,
--   u.email,
--   u.email_confirmed_at,
--   p.display_name,
--   p.role
-- from auth.users u
-- left join public.mathside_profiles p on p.id = u.id
-- where lower(u.email) = lower('TEACHER_EMAIL@example.com');
