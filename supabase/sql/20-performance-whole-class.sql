-- Mathside V24.19: class-based performance projects.
-- Run AFTER existing Mathside SQL migrations 01-19 in Supabase SQL Editor.
-- Before running: back up your database. Do not re-run old schema setup files afterward.
-- Does not remove older assignments, student submissions, scores, or history.
begin;

alter table public.mathside_assignments
  drop constraint if exists mathside_assignments_collaboration_mode_check;
alter table public.mathside_assignments
  add constraint mathside_assignments_collaboration_mode_check
  check (collaboration_mode in ('individual','pair','group','class'));

alter table public.mathside_submissions
  add column if not exists is_class_mirror boolean not null default false;
alter table public.mathside_submissions
  add column if not exists class_video_url text;
alter table public.mathside_submissions
  add column if not exists class_project_url text;

create table if not exists public.mathside_class_score_overrides (
  assignment_id uuid not null references public.mathside_assignments(id) on delete cascade,
  student_id uuid not null references public.mathside_profiles(id) on delete cascade,
  score numeric(10,2) not null check (score >= 0),
  changed_by uuid not null references public.mathside_profiles(id),
  changed_at timestamptz not null default now(),
  primary key (assignment_id, student_id)
);
alter table public.mathside_class_score_overrides enable row level security;
revoke all on public.mathside_class_score_overrides from anon, authenticated;

-- Keep past work safe: a task with submissions may not be converted to or from
-- whole-class collaboration, which would otherwise reassign scores.
create or replace function mathside_private.protect_class_assignment_setup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (old.collaboration_mode = 'class' or new.collaboration_mode = 'class')
     and (old.collaboration_mode is distinct from new.collaboration_mode
          or old.grouping_creator is distinct from new.grouping_creator
          or old.group_count is distinct from new.group_count
          or old.section_id is distinct from new.section_id
          or old.work_type is distinct from new.work_type)
     and exists (select 1 from public.mathside_submissions s where s.assignment_id = old.id) then
    raise exception 'Cannot change the class project setup after students have submitted. Existing scores are protected.';
  end if;
  return new;
end; $$;
drop trigger if exists mathside_protect_class_assignment_setup on public.mathside_assignments;
create trigger mathside_protect_class_assignment_setup
before update of collaboration_mode, grouping_creator, group_count, section_id, work_type
on public.mathside_assignments
for each row execute function mathside_private.protect_class_assignment_setup();

-- Prevent deleting the sole class team after the representative submits.
-- Deleting the entire assignment intentionally still cascades when the teacher
-- explicitly deletes the entire task.
create or replace function mathside_private.protect_class_team_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.mathside_assignments a
             where a.id = old.assignment_id and a.collaboration_mode = 'class')
     and exists (select 1 from public.mathside_submissions s
                 where s.assignment_id=old.assignment_id and s.student_id=old.leader_id
                 and not s.is_class_mirror) then
    raise exception 'This class has already submitted. The class team cannot be rebuilt.';
  end if;
  return old;
end; $$;
drop trigger if exists mathside_protect_class_team_delete on public.mathside_performance_groups;
create trigger mathside_protect_class_team_delete
before delete on public.mathside_performance_groups
for each row execute function mathside_private.protect_class_team_delete();

-- Prevent the class representative being changed once a class submission exists;
-- otherwise the original submission could become detached from its section.
create or replace function mathside_private.protect_class_representative()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.leader_id is distinct from new.leader_id
     and exists (
       select 1 from public.mathside_assignments a
       where a.id = new.assignment_id and a.collaboration_mode = 'class'
     )
     and exists (
       select 1 from public.mathside_submissions s
       where s.assignment_id = new.assignment_id and not s.is_class_mirror
     ) then
    raise exception 'The class representative cannot be changed after the class has submitted. Archive this task and create a new one if needed.';
  end if;
  return new;
end; $$;
drop trigger if exists mathside_protect_class_representative on public.mathside_performance_groups;
create trigger mathside_protect_class_representative
before update of leader_id on public.mathside_performance_groups
for each row execute function mathside_private.protect_class_representative();

-- A single representative submission becomes a read-only record for each learner.
-- The main submission remains the ONLY one shown in the teacher review inbox;
-- mirrored records are visible to students and counted in exports and competencies.
create or replace function mathside_private.sync_class_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_assignment public.mathside_assignments;
  v_leader uuid;
begin
  if new.is_class_mirror then return new; end if;
  select * into v_assignment from public.mathside_assignments where id=new.assignment_id;
  if v_assignment.id is null or v_assignment.work_type <> 'performance_task'
      or v_assignment.collaboration_mode <> 'class' then return new; end if;
  select leader_id into v_leader from public.mathside_performance_groups where assignment_id=new.assignment_id limit 1;
  if v_leader is null or new.student_id <> v_leader then return new; end if;

  if tg_op = 'UPDATE' then
    if new.submitted_at is distinct from old.submitted_at and new.status='submitted' then
      delete from public.mathside_class_score_overrides where assignment_id=new.assignment_id;
    end if;
  end if;

  insert into public.mathside_submissions (
    assignment_id, student_id, status, proof_path, proof_paths, auto_score, teacher_score,
    feedback, attempt_count, submitted_at, graded_at, graded_by, updated_at,
    resubmit_allowed, is_class_mirror, class_video_url, class_project_url
  )
  select new.assignment_id, sm.student_id, new.status, new.proof_path, new.proof_paths,
    new.auto_score,
    case when new.status = 'graded' then coalesce(ov.score,new.teacher_score) else null end,
    new.feedback, new.attempt_count, new.submitted_at, new.graded_at, new.graded_by, now(),
    false, true, new.class_video_url, new.class_project_url
  from public.mathside_section_members sm
  left join public.mathside_class_score_overrides ov
    on ov.assignment_id = new.assignment_id and ov.student_id = sm.student_id
  where sm.section_id = v_assignment.section_id and sm.student_id <> v_leader
  on conflict (assignment_id, student_id) do update
    set status=excluded.status,
        proof_path=excluded.proof_path,
        proof_paths=excluded.proof_paths,
        auto_score=excluded.auto_score,
        teacher_score=excluded.teacher_score,
        feedback=excluded.feedback,
        attempt_count=excluded.attempt_count,
        submitted_at=excluded.submitted_at,
        graded_at=excluded.graded_at,
        graded_by=excluded.graded_by,
        updated_at=now(),
        resubmit_allowed=false,
        is_class_mirror=true,
        class_video_url=excluded.class_video_url,
        class_project_url=excluded.class_project_url;
  return new;
end; $$;
drop trigger if exists mathside_sync_class_submission on public.mathside_submissions;
create trigger mathside_sync_class_submission
  after insert or update of status, proof_paths, proof_path, teacher_score, feedback,
    submitted_at, graded_at, resubmit_allowed, class_video_url, class_project_url
  on public.mathside_submissions
  for each row execute function mathside_private.sync_class_submission();

-- New enrollments get the class project record if the project was already submitted.
create or replace function mathside_private.backfill_class_submission_for_enrollment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.mathside_submissions (
    assignment_id, student_id, status, proof_path, proof_paths, auto_score,
    teacher_score, feedback, attempt_count, submitted_at, graded_at, graded_by,
    resubmit_allowed, is_class_mirror, class_video_url, class_project_url
  )
  select a.id, new.student_id, rep.status, rep.proof_path, rep.proof_paths, rep.auto_score,
    coalesce(ov.score, rep.teacher_score), rep.feedback, rep.attempt_count,
    rep.submitted_at, rep.graded_at, rep.graded_by, false, true,
    rep.class_video_url, rep.class_project_url
  from public.mathside_assignments a
  join public.mathside_performance_groups g on g.assignment_id=a.id
  join public.mathside_submissions rep on rep.assignment_id=a.id and rep.student_id=g.leader_id
  left join public.mathside_class_score_overrides ov on ov.assignment_id=a.id and ov.student_id=new.student_id
  where a.section_id=new.section_id and a.collaboration_mode='class' and a.work_type='performance_task'
    and new.student_id<>g.leader_id
  on conflict (assignment_id,student_id) do nothing;
  return new;
end; $$;
drop trigger if exists mathside_backfill_class_submission on public.mathside_section_members;
create trigger mathside_backfill_class_submission
  after insert on public.mathside_section_members
  for each row execute function mathside_private.backfill_class_submission_for_enrollment();

-- Only the active class representative can attach video / project links.
create or replace function public.mathside_save_class_submission_links(
  p_assignment_id uuid, p_video_url text default null, p_project_url text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_video text := nullif(btrim(p_video_url),''); v_project text := nullif(btrim(p_project_url),'');
begin
  if v_uid is null or not mathside_private.is_student(v_uid) then raise exception 'Sign in as a student first.'; end if;
  if (v_video is not null and (length(v_video)>2048 or v_video !~* '^https://[^[:space:]/]+')) or
     (v_project is not null and (length(v_project)>2048 or v_project !~* '^https://[^[:space:]/]+')) then
    raise exception 'Video and project URLs must use HTTPS.';
  end if;
  if not exists (
    select 1 from public.mathside_assignments a
    join public.mathside_performance_groups g on g.assignment_id=a.id
    where a.id=p_assignment_id and a.work_type='performance_task' and a.collaboration_mode='class'
      and g.leader_id=v_uid and a.status='published'
  ) then raise exception 'Only the class representative can save project links.'; end if;
  update public.mathside_submissions s
    set class_video_url=v_video, class_project_url=v_project
    where s.assignment_id=p_assignment_id and s.student_id=v_uid and not s.is_class_mirror;
  if not found then raise exception 'Submit the class project before adding links.'; end if;
  return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.mathside_save_class_submission_links(uuid,text,text) from public,anon;
grant execute on function public.mathside_save_class_submission_links(uuid,text,text) to authenticated;

-- Teacher reads the full section roster, base grade and any overrides.
create or replace function public.mathside_get_class_scores(p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_assignment public.mathside_assignments; v_leader uuid; v_score numeric(10,2); v_members jsonb;
begin
  select * into v_assignment from public.mathside_assignments where id=p_assignment_id;
  if v_assignment.id is null or v_assignment.teacher_id is distinct from v_uid or
     not mathside_private.is_teacher(v_uid) or v_assignment.collaboration_mode <> 'class' then
    raise exception 'Only the owning teacher can view these class scores.';
  end if;
  select g.leader_id into v_leader from public.mathside_performance_groups g where g.assignment_id=p_assignment_id limit 1;
  select s.teacher_score into v_score from public.mathside_submissions s
   where s.assignment_id=p_assignment_id and s.student_id=v_leader;
  select coalesce(jsonb_agg(jsonb_build_object(
     'id',p.id,'display_name',p.display_name,'score',s.teacher_score,'override',ov.score,
     'representative', p.id=v_leader
   ) order by p.display_name), '[]'::jsonb)
    into v_members
  from public.mathside_section_members sm
  join public.mathside_profiles p on p.id=sm.student_id
  left join public.mathside_submissions s on s.assignment_id=p_assignment_id and s.student_id=sm.student_id
  left join public.mathside_class_score_overrides ov on ov.assignment_id=p_assignment_id and ov.student_id=sm.student_id
  where sm.section_id=v_assignment.section_id;
  return jsonb_build_object('base_score',v_score,'max_points',v_assignment.max_points,'students',v_members);
end; $$;
revoke all on function public.mathside_get_class_scores(uuid) from public,anon;
grant execute on function public.mathside_get_class_scores(uuid) to authenticated;

-- NULL score removes the special adjustment; a numeric score replaces it.
create or replace function public.mathside_set_class_scores(p_assignment_id uuid, p_scores jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_assignment public.mathside_assignments;
  v_leader uuid; v_rep_score numeric(10,2);
  v_row jsonb; v_student uuid; v_score numeric(10,2);
  v_seen uuid[] := '{}'::uuid[]; v_count integer := 0;
begin
  select * into v_assignment from public.mathside_assignments where id=p_assignment_id for update;
  if v_assignment.id is null or v_assignment.teacher_id is distinct from v_uid or
     not mathside_private.is_teacher(v_uid) or v_assignment.collaboration_mode <> 'class' then
    raise exception 'Only the owning teacher can adjust class scores.';
  end if;
  select g.leader_id into v_leader from public.mathside_performance_groups g where g.assignment_id=p_assignment_id limit 1;
  select s.teacher_score into v_rep_score from public.mathside_submissions s
    where s.assignment_id=p_assignment_id and s.student_id=v_leader and s.status='graded';
  if v_rep_score is null then raise exception 'Grade the class representative submission first.'; end if;
  if jsonb_typeof(p_scores) <> 'array' or jsonb_array_length(p_scores)>500 then raise exception 'Invalid class scores payload.'; end if;
  for v_row in select value from jsonb_array_elements(p_scores) loop
    begin v_student := (v_row->>'student_id')::uuid; exception when others then raise exception 'Invalid learner identifier.'; end;
    if v_student is null or v_student = any(v_seen) then raise exception 'Duplicate or missing learner in adjustments.'; end if;
    v_seen := array_append(v_seen, v_student);
    if v_student=v_leader then raise exception 'Adjust the representative score through the main class score.'; end if;
    if not exists (select 1 from public.mathside_section_members where section_id=v_assignment.section_id and student_id=v_student) then
      raise exception 'Student is not enrolled in this section.';
    end if;
    begin v_score := nullif(v_row->>'score','')::numeric(10,2);
    exception when others then raise exception 'Invalid score value.'; end;
    if v_score is not null and (v_score<0 or v_score>v_assignment.max_points) then
      raise exception 'Scores must be between zero and the task total.';
    end if;
    if v_score is null then
      delete from public.mathside_class_score_overrides where assignment_id=p_assignment_id and student_id=v_student;
    else
      insert into public.mathside_class_score_overrides(assignment_id,student_id,score,changed_by)
      values(p_assignment_id,v_student,v_score,v_uid)
      on conflict(assignment_id,student_id) do update set
        score=excluded.score,changed_by=excluded.changed_by,changed_at=now();
    end if;
    update public.mathside_submissions
      set teacher_score=coalesce(v_score,v_rep_score)
      where assignment_id=p_assignment_id and student_id=v_student and is_class_mirror;
    v_count := v_count+1;
  end loop;
  return jsonb_build_object('updated',v_count);
end; $$;
revoke all on function public.mathside_set_class_scores(uuid,jsonb) from public,anon;
grant execute on function public.mathside_set_class_scores(uuid,jsonb) to authenticated;

-- Stop ordinary class members from uploading orphan files for a class task.
-- Keep the verified upload ownership and section checks from migration 18.
drop policy if exists mathside_proof_upload on storage.objects;
create policy mathside_proof_upload on storage.objects for insert to authenticated with check (
  bucket_id='mathside-submission-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and array_length(storage.foldername(name),1) = 2
  and mathside_private.is_student((select auth.uid()))
  and exists (
    select 1 from public.mathside_assignments a
    where a.id=mathside_private.safe_uuid((storage.foldername(name))[2])
      and a.status='published'
      and mathside_private.student_in_section(a.section_id,(select auth.uid()))
      and (a.collaboration_mode<>'class' or exists (
        select 1 from public.mathside_performance_groups g
        where g.assignment_id=a.id and g.leader_id=(select auth.uid())
      ))
  )
);

-- Students of the same assigned class may open the representative's uploaded
-- photos, while the original upload/delete restrictions remain unchanged.
drop policy if exists mathside_class_proof_read on storage.objects;
create policy mathside_class_proof_read on storage.objects for select to authenticated using (
  bucket_id='mathside-submission-proofs' and exists (
    select 1 from public.mathside_assignments a
    join public.mathside_performance_groups g on g.assignment_id=a.id
    where a.id=mathside_private.safe_uuid((storage.foldername(name))[2])
      and a.collaboration_mode='class' and a.work_type='performance_task'
      and g.leader_id=mathside_private.safe_uuid((storage.foldername(name))[1])
      and mathside_private.student_in_section(a.section_id,(select auth.uid()))
  )
);
commit;
notify pgrst, 'reload schema';
