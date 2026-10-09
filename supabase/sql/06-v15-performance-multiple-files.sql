-- =====================================================================
-- Mathside V15 - Performance Tasks + Multiple Solution Pictures
-- Run ONCE after the V13 teacher-comment upgrade.
-- =====================================================================

begin;

-- 1) Assignment work types and Performance Task fields
alter table public.mathside_assignments
  add column if not exists work_type text not null default 'written_work';

alter table public.mathside_assignments
  drop constraint if exists mathside_assignments_work_type_check;
alter table public.mathside_assignments
  add constraint mathside_assignments_work_type_check
  check (work_type in ('written_work','performance_task'));

alter table public.mathside_assignments
  add column if not exists max_points numeric(10,2) not null default 100
  check (max_points >= 0);

alter table public.mathside_assignments
  add column if not exists rubric_path text;

alter table public.mathside_assignments
  add column if not exists image_paths jsonb not null default '[]'::jsonb;

alter table public.mathside_assignments
  drop constraint if exists mathside_assignments_image_paths_array_check;
alter table public.mathside_assignments
  add constraint mathside_assignments_image_paths_array_check
  check (jsonb_typeof(image_paths) = 'array');

update public.mathside_assignments
set image_paths = jsonb_build_array(image_path)
where image_path is not null
  and (image_paths is null or image_paths = '[]'::jsonb);

create index if not exists mathside_assignments_work_type_idx
  on public.mathside_assignments(teacher_id, work_type, created_at desc);

-- 2) Multiple uploaded solution/output pictures
alter table public.mathside_submissions
  add column if not exists proof_paths jsonb not null default '[]'::jsonb;

alter table public.mathside_submissions
  drop constraint if exists mathside_submissions_proof_paths_array_check;
alter table public.mathside_submissions
  add constraint mathside_submissions_proof_paths_array_check
  check (jsonb_typeof(proof_paths) = 'array');

update public.mathside_submissions
set proof_paths = jsonb_build_array(proof_path)
where proof_path is not null
  and (proof_paths is null or proof_paths = '[]'::jsonb);

-- 3) Generic student submission RPC preserving Mathside teacher-approved resubmission.
create or replace function public.mathside_submit_work(
  p_assignment_id uuid,
  p_answers jsonb default '[]'::jsonb,
  p_proof_paths jsonb default '[]'::jsonb
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
  v_paths jsonb := case when jsonb_typeof(coalesce(p_proof_paths,'[]'::jsonb))='array' then coalesce(p_proof_paths,'[]'::jsonb) else '[]'::jsonb end;
  v_first_path text;
  v_path_item text;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;
  if not mathside_private.is_student(v_uid) then raise exception 'Only student accounts can submit classwork.'; end if;

  select * into v_assignment
  from public.mathside_assignments
  where id = p_assignment_id and status = 'published';
  if v_assignment.id is null then raise exception 'This activity is closed or archived.'; end if;
  if not mathside_private.student_in_section(v_assignment.section_id, v_uid) then
    raise exception 'This classwork is not assigned to your section.';
  end if;

  if jsonb_array_length(v_paths) < 1 then
    raise exception 'Upload at least one solution or output picture before submitting.';
  end if;
  if jsonb_array_length(v_paths) > 10 then
    raise exception 'Choose up to 10 uploaded pictures for one submission.';
  end if;

  for v_path_item in
    select elem #>> '{}'
    from jsonb_array_elements(v_paths) as supplied_path(elem)
  loop
    if v_path_item is null
       or v_path_item not like v_uid::text || '/' || p_assignment_id::text || '/%' then
      raise exception 'Invalid upload path for this submission.';
    end if;
  end loop;

  select elem #>> '{}'
  into v_first_path
  from jsonb_array_elements(v_paths) as path_item(elem)
  limit 1;

  select * into v_existing
  from public.mathside_submissions
  where assignment_id = p_assignment_id and student_id = v_uid
  for update;

  if v_existing.id is not null then
    if not v_assignment.allow_resubmission then raise exception 'This classwork has already been submitted.'; end if;
    if not coalesce(v_existing.resubmit_allowed,false) then raise exception 'Your teacher has not allowed another attempt yet.'; end if;
    v_submission_id := v_existing.id;
    v_attempt := v_existing.attempt_count + 1;
    delete from public.mathside_submission_answers where submission_id = v_submission_id;
    update public.mathside_submissions
    set status='submitted', proof_path=v_first_path, proof_paths=v_paths,
        auto_score=0, teacher_score=null, feedback=null,
        attempt_count=v_attempt, submitted_at=now(), graded_at=null, graded_by=null,
        resubmit_allowed=false, updated_at=now()
    where id=v_submission_id;
  else
    insert into public.mathside_submissions(assignment_id,student_id,proof_path,proof_paths,status,resubmit_allowed)
    values(p_assignment_id,v_uid,v_first_path,v_paths,'submitted',false)
    returning id into v_submission_id;
  end if;

  for v_answer in
    select value from jsonb_array_elements(coalesce(p_answers,'[]'::jsonb))
  loop
    select q.* into v_question
    from public.mathside_questions q
    where q.id = mathside_private.safe_uuid(v_answer->>'question_id')
      and q.assignment_id = p_assignment_id;
    if v_question.id is null then continue; end if;

    select k.correct_answer into v_key
    from public.mathside_question_keys k where k.question_id=v_question.id;
    v_text := coalesce(v_answer->>'answer','');
    v_correct := length(btrim(coalesce(v_key,''))) > 0 and lower(btrim(v_text)) = lower(btrim(v_key));

    insert into public.mathside_submission_answers(submission_id,question_id,answer_text,is_correct,manual_is_correct,awarded_points)
    values(v_submission_id,v_question.id,v_text,v_correct,null,case when v_correct then v_question.max_points else 0 end);
    if v_correct then v_auto_score := v_auto_score + v_question.max_points; end if;
  end loop;

  update public.mathside_submissions set auto_score=v_auto_score, updated_at=now() where id=v_submission_id;
  return jsonb_build_object('submission_id',v_submission_id,'auto_score',v_auto_score,'attempt_count',v_attempt,'proof_paths',v_paths);
end;
$$;

revoke all on function public.mathside_submit_work(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.mathside_submit_work(uuid,jsonb,jsonb) to authenticated;

-- Backward compatibility for an older cached front end.
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
begin
  return public.mathside_submit_work(
    p_assignment_id,
    coalesce(p_answers,'[]'::jsonb),
    case when p_proof_path is null or btrim(p_proof_path)='' then '[]'::jsonb else jsonb_build_array(p_proof_path) end
  );
end;
$$;

revoke all on function public.mathside_submit_assignment(uuid,jsonb,text) from public, anon;
grant execute on function public.mathside_submit_assignment(uuid,jsonb,text) to authenticated;

-- 4) Review/grade function: Performance Tasks use assignment.max_points.
create or replace function public.mathside_save_submission_review(
  p_submission_id uuid,
  p_teacher_score numeric default null,
  p_feedback text default null,
  p_answer_reviews jsonb default '[]'::jsonb
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
  v_review jsonb;
  v_question_id uuid;
  v_correct boolean;
  v_manual_review boolean;
  v_manual_count integer := 0;
  v_manual_score numeric(10,2) := 0;
  v_total numeric(10,2) := 0;
  v_effective_score numeric(10,2);
  v_teacher_comment text;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;
  if not mathside_private.is_teacher(v_uid) then raise exception 'Only teachers can review submissions.'; end if;

  select * into v_submission from public.mathside_submissions where id=p_submission_id for update;
  if v_submission.id is null then raise exception 'Submission not found.'; end if;
  select * into v_assignment from public.mathside_assignments where id=v_submission.assignment_id;
  if v_assignment.id is null or v_assignment.teacher_id<>v_uid then raise exception 'You do not own this submission.'; end if;

  if v_assignment.work_type='performance_task' then
    v_total := greatest(0,coalesce(v_assignment.max_points,0));
  else
    select coalesce(sum(q.max_points),0) into v_total from public.mathside_questions q where q.assignment_id=v_assignment.id;
  end if;

  for v_review in select value from jsonb_array_elements(coalesce(p_answer_reviews,'[]'::jsonb))
  loop
    v_question_id := mathside_private.safe_uuid(v_review->>'question_id');
    if v_question_id is null then continue; end if;
    v_manual_review := coalesce((v_review->>'manual_review')::boolean,false);
    v_correct := coalesce((v_review->>'is_correct')::boolean,false);
    v_teacher_comment := nullif(btrim(coalesce(v_review->>'teacher_comment','')),'');
    update public.mathside_submission_answers a
    set manual_is_correct = case when v_manual_review then v_correct else a.manual_is_correct end,
        awarded_points = case when v_manual_review then (case when v_correct then q.max_points else 0 end) else a.awarded_points end,
        teacher_comment = v_teacher_comment
    from public.mathside_questions q
    where a.submission_id=p_submission_id
      and a.question_id=v_question_id
      and q.id=a.question_id
      and q.assignment_id=v_assignment.id;
  end loop;

  select count(*),coalesce(sum(case when coalesce(a.manual_is_correct,a.is_correct,false) then q.max_points else 0 end),0)
  into v_manual_count,v_manual_score
  from public.mathside_submission_answers a
  join public.mathside_questions q on q.id=a.question_id
  where a.submission_id=p_submission_id and a.manual_is_correct is not null;

  if v_assignment.work_type='performance_task' then
    v_effective_score := p_teacher_score;
  elsif v_manual_count>0 then
    select coalesce(sum(case when coalesce(a.manual_is_correct,a.is_correct,false) then q.max_points else 0 end),0)
    into v_effective_score
    from public.mathside_submission_answers a
    join public.mathside_questions q on q.id=a.question_id
    where a.submission_id=p_submission_id;
  else
    v_effective_score := p_teacher_score;
  end if;

  if v_effective_score is not null and (v_effective_score<0 or v_effective_score>v_total) then
    raise exception 'Teacher score must be between 0 and %.',v_total;
  end if;

  update public.mathside_submissions
  set teacher_score=v_effective_score,
      feedback=nullif(btrim(coalesce(p_feedback,'')),''),
      status='graded',graded_at=now(),graded_by=v_uid,updated_at=now()
  where id=p_submission_id;

  return jsonb_build_object('submission_id',p_submission_id,'teacher_score',v_effective_score,'total_points',v_total,'manual_review_count',v_manual_count,'manual_review_score',v_manual_score);
end;
$$;

revoke all on function public.mathside_save_submission_review(uuid,numeric,text,jsonb) from public, anon;
grant execute on function public.mathside_save_submission_review(uuid,numeric,text,jsonb) to authenticated;

-- 5) Friendlier notifications for both Activities and Performance Tasks.
create or replace function mathside_private.notify_assignment_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text;
begin
  if tg_op='INSERT' then
    if new.status<>'published' then return new; end if;
  elsif tg_op='UPDATE' then
    if new.status<>'published' or old.status='published' then return new; end if;
  end if;
  v_label := case when new.work_type='performance_task' then 'performance task' else 'activity' end;
  insert into public.mathside_notifications(user_id,type,title,body,related_assignment_id)
  select m.student_id,'assignment',
         case when new.work_type='performance_task' then 'New performance task' else 'New activity' end,
         new.title || case when new.due_at is not null then ' · Due ' || to_char(new.due_at at time zone 'UTC','Mon DD') else '' end,
         new.id
  from public.mathside_section_members m where m.section_id=new.section_id;
  return new;
end;
$$;

-- Allow rubric documents in the existing teacher-media bucket.
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg','image/png','image/webp','application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]
where id='mathside-assignment-images';

commit;
notify pgrst, 'reload schema';
