-- Mathside V24.23: Whole-class participation ratings (1-5), matching Group mode.
-- Run AFTER 20-performance-whole-class.sql and 21-fix-class-storage-permissions.sql.
-- Existing Group and Pair scoring behavior is unchanged.
-- Rating 5 => -0, 4 => -2, 3 => -3, 2 => -4, 1 => -5 points.
-- Teacher-entered class score overrides take precedence over leader ratings.
begin;

-- A private, reusable calculation for the actual student score displayed in
-- Mathside student view, competency tracker, teacher review and Excel exports.
create or replace function mathside_private.class_member_score(
  p_assignment_id uuid, p_member_id uuid, p_representative_score numeric
) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  v_override numeric(10,2);
  v_rating integer;
begin
  select score into v_override
  from public.mathside_class_score_overrides
  where assignment_id = p_assignment_id and student_id = p_member_id;
  if found then return v_override; end if;
  if p_representative_score is null then return null; end if;

  select r.rating into v_rating
  from public.mathside_performance_participation_ratings r
  join public.mathside_performance_groups g
    on g.id = r.group_id and g.assignment_id = p_assignment_id
  join public.mathside_performance_group_members gm
    on gm.group_id = g.id and gm.student_id = r.member_id
  where r.assignment_id = p_assignment_id
    and r.member_id = p_member_id
    and r.leader_id = g.leader_id;

  if v_rating is null then return null; end if;
  return greatest(0, p_representative_score - case v_rating
    when 5 then 0 when 4 then 2 when 3 then 3 when 2 then 4 when 1 then 5
    else 0 end);
end;
$$;
revoke all on function mathside_private.class_member_score(uuid,uuid,numeric) from public, anon, authenticated;

-- The representative submits once. Mirrors represent every other learner's
-- own graded record (including the participation deduction), not duplicate
-- submissions in the teacher's review inbox.
create or replace function mathside_private.sync_class_submission()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_assignment public.mathside_assignments;
  v_leader uuid;
begin
  if new.is_class_mirror then return new; end if;
  select * into v_assignment from public.mathside_assignments where id = new.assignment_id;
  if v_assignment.id is null or v_assignment.work_type <> 'performance_task'
      or v_assignment.collaboration_mode <> 'class' then return new; end if;
  select leader_id into v_leader from public.mathside_performance_groups
    where assignment_id = new.assignment_id limit 1;
  if v_leader is null or new.student_id <> v_leader then return new; end if;

  if tg_op = 'UPDATE' then
    if new.submitted_at is distinct from old.submitted_at and new.status = 'submitted' then
      delete from public.mathside_class_score_overrides where assignment_id = new.assignment_id;
    end if;
  end if;

  insert into public.mathside_submissions (
    assignment_id, student_id, status, proof_path, proof_paths, auto_score, teacher_score,
    feedback, attempt_count, submitted_at, graded_at, graded_by, updated_at,
    resubmit_allowed, is_class_mirror, class_video_url, class_project_url
  )
  select new.assignment_id, sm.student_id, new.status, new.proof_path, new.proof_paths,
    new.auto_score,
    case when new.status = 'graded' then
      mathside_private.class_member_score(new.assignment_id, sm.student_id, new.teacher_score)
    else null end,
    new.feedback, new.attempt_count, new.submitted_at, new.graded_at, new.graded_by, now(),
    false, true, new.class_video_url, new.class_project_url
  from public.mathside_section_members sm
  where sm.section_id = v_assignment.section_id and sm.student_id <> v_leader
  on conflict (assignment_id, student_id) do update
    set status = excluded.status,
        proof_path = excluded.proof_path,
        proof_paths = excluded.proof_paths,
        auto_score = excluded.auto_score,
        teacher_score = excluded.teacher_score,
        feedback = excluded.feedback,
        attempt_count = excluded.attempt_count,
        submitted_at = excluded.submitted_at,
        graded_at = excluded.graded_at,
        graded_by = excluded.graded_by,
        updated_at = now(),
        resubmit_allowed = false,
        is_class_mirror = true,
        class_video_url = excluded.class_video_url,
        class_project_url = excluded.class_project_url;
  return new;
end;
$$;

-- Preserve the same rating RPC used by Group Mode. New class-only safeguards:
-- every active class member (except the representative) must be rated;
-- archived assignments cannot be modified; only the selected representative
-- may rate their own section. Ratings can be saved separately after submit.
create or replace function public.mathside_save_participation_ratings(
  p_assignment_id uuid, p_group_id uuid, p_ratings jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_assignment public.mathside_assignments;
  v_item jsonb;
  v_member uuid;
  v_rating integer;
  v_seen uuid[] := '{}'::uuid[];
  v_expected integer;
  v_representative_score numeric(10,2);
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;
  select * into v_assignment from public.mathside_assignments
    where id = p_assignment_id for update;
  if v_assignment.id is null then raise exception 'Performance task not found.'; end if;
  if not exists (
    select 1 from public.mathside_performance_groups g
    where g.id = p_group_id and g.assignment_id = p_assignment_id
      and g.section_id = v_assignment.section_id and g.leader_id = v_uid
  ) then raise exception 'Only the selected team leader can rate members.'; end if;
  if jsonb_typeof(coalesce(p_ratings, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_ratings, '[]'::jsonb)) > 500 then
    raise exception 'Invalid participation rating list.';
  end if;

  if v_assignment.collaboration_mode = 'class' then
    if v_assignment.status <> 'published' or not mathside_private.is_student(v_uid)
       or not mathside_private.student_in_section(v_assignment.section_id, v_uid) then
      raise exception 'Class participation ratings cannot be changed for this task.';
    end if;
    select count(*) into v_expected
    from public.mathside_performance_group_members gm
    where gm.group_id = p_group_id and gm.student_id <> v_uid;
    if jsonb_array_length(coalesce(p_ratings, '[]'::jsonb)) <> v_expected then
      raise exception 'Rate every class member before saving.';
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_ratings, '[]'::jsonb)) loop
    begin
      v_member := (v_item->>'member_id')::uuid;
      v_rating := (v_item->>'rating')::integer;
    exception when others then raise exception 'Invalid member rating.'; end;
    if v_rating not between 1 and 5 then raise exception 'Ratings must be from 1 to 5.'; end if;
    if v_member is null or v_member = v_uid or v_member = any(v_seen) or
       not exists (select 1 from public.mathside_performance_group_members gm
                   where gm.group_id = p_group_id and gm.assignment_id = p_assignment_id
                     and gm.student_id = v_member) then
      raise exception 'Invalid or repeated team member rating.';
    end if;
    if v_assignment.collaboration_mode = 'class' and
       not mathside_private.student_in_section(v_assignment.section_id, v_member) then
      raise exception 'A rated learner is not enrolled in this section.';
    end if;
    v_seen := array_append(v_seen, v_member);
    insert into public.mathside_performance_participation_ratings
      (assignment_id, group_id, leader_id, member_id, rating, updated_at)
    values (p_assignment_id, p_group_id, v_uid, v_member, v_rating, now())
    on conflict (assignment_id, member_id) do update set
      group_id = excluded.group_id, leader_id = excluded.leader_id,
      rating = excluded.rating, updated_at = now();
  end loop;

  -- A leader can update a rating while the task is active. Refresh existing
  -- graded mirrors immediately, without overwriting a teacher override.
  if v_assignment.collaboration_mode = 'class' then
    select s.teacher_score into v_representative_score
    from public.mathside_submissions s
    where s.assignment_id = p_assignment_id and s.student_id = v_uid
      and s.status = 'graded' and not s.is_class_mirror;
    if found and v_representative_score is not null then
      update public.mathside_submissions s
      set teacher_score = mathside_private.class_member_score(
            p_assignment_id, s.student_id, v_representative_score),
          updated_at = now()
      where s.assignment_id = p_assignment_id and s.is_class_mirror;
    end if;
  end if;
end;
$$;
revoke all on function public.mathside_save_participation_ratings(uuid,uuid,jsonb) from public,anon;
grant execute on function public.mathside_save_participation_ratings(uuid,uuid,jsonb) to authenticated;

-- Later enrollment of a class member must use the same participation logic.
create or replace function mathside_private.backfill_class_submission_for_enrollment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.mathside_submissions (
    assignment_id, student_id, status, proof_path, proof_paths, auto_score, teacher_score,
    feedback, attempt_count, submitted_at, graded_at, graded_by, updated_at,
    resubmit_allowed, is_class_mirror, class_video_url, class_project_url
  )
  select a.id, new.student_id, rep.status, rep.proof_path, rep.proof_paths, rep.auto_score,
    case when rep.status = 'graded' then
      mathside_private.class_member_score(a.id, new.student_id, rep.teacher_score)
    else null end,
    rep.feedback, rep.attempt_count, rep.submitted_at, rep.graded_at,
    rep.graded_by, now(), false, true, rep.class_video_url, rep.class_project_url
  from public.mathside_assignments a
  join public.mathside_performance_groups g on g.assignment_id = a.id
  join public.mathside_submissions rep
    on rep.assignment_id = a.id and rep.student_id = g.leader_id
  where a.section_id = new.section_id and a.collaboration_mode = 'class'
    and a.work_type = 'performance_task' and new.student_id <> g.leader_id
  on conflict (assignment_id,student_id) do nothing;
  return new;
end;
$$;

-- Only the owning teacher sees scores, the underlying private ratings,
-- and whether an individual override has been entered.
create or replace function public.mathside_get_class_scores(p_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_assignment public.mathside_assignments;
  v_leader uuid;
  v_score numeric(10,2);
  v_members jsonb;
begin
  select * into v_assignment from public.mathside_assignments where id = p_assignment_id;
  if v_assignment.id is null or v_assignment.teacher_id is distinct from v_uid or
     not mathside_private.is_teacher(v_uid) or v_assignment.collaboration_mode <> 'class' then
    raise exception 'Only the owning teacher can view these class scores.';
  end if;
  select g.leader_id into v_leader from public.mathside_performance_groups g
    where g.assignment_id = p_assignment_id limit 1;
  select s.teacher_score into v_score from public.mathside_submissions s
    where s.assignment_id = p_assignment_id and s.student_id = v_leader;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'display_name', p.display_name, 'score', s.teacher_score,
    'override', ov.score, 'rating', r.rating,
    'representative', p.id = v_leader
  ) order by p.display_name), '[]'::jsonb) into v_members
  from public.mathside_section_members sm
  join public.mathside_profiles p on p.id = sm.student_id
  left join public.mathside_submissions s
    on s.assignment_id = p_assignment_id and s.student_id = sm.student_id
  left join public.mathside_class_score_overrides ov
    on ov.assignment_id = p_assignment_id and ov.student_id = sm.student_id
  left join public.mathside_performance_participation_ratings r
    on r.assignment_id = p_assignment_id and r.member_id = sm.student_id
  where sm.section_id = v_assignment.section_id;
  return jsonb_build_object('base_score', v_score,
    'max_points', v_assignment.max_points, 'students', v_members);
end;
$$;
revoke all on function public.mathside_get_class_scores(uuid) from public,anon;
grant execute on function public.mathside_get_class_scores(uuid) to authenticated;

-- Explicit teacher adjustments still win over the leader's rating; clearing
-- an adjustment returns the learner to the participation-calculated score.
create or replace function public.mathside_set_class_scores(p_assignment_id uuid, p_scores jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_assignment public.mathside_assignments;
  v_leader uuid;
  v_rep_score numeric(10,2);
  v_row jsonb;
  v_student uuid;
  v_score numeric(10,2);
  v_seen uuid[] := '{}'::uuid[];
  v_count integer := 0;
begin
  select * into v_assignment from public.mathside_assignments
    where id = p_assignment_id for update;
  if v_assignment.id is null or v_assignment.teacher_id is distinct from v_uid or
     not mathside_private.is_teacher(v_uid) or v_assignment.collaboration_mode <> 'class' then
    raise exception 'Only the owning teacher can adjust class scores.';
  end if;
  select g.leader_id into v_leader from public.mathside_performance_groups g
    where g.assignment_id = p_assignment_id limit 1;
  select s.teacher_score into v_rep_score from public.mathside_submissions s
    where s.assignment_id = p_assignment_id and s.student_id = v_leader
      and s.status = 'graded';
  if v_rep_score is null then raise exception 'Grade the class representative submission first.'; end if;
  if jsonb_typeof(p_scores) <> 'array' or jsonb_array_length(p_scores) > 500 then
    raise exception 'Invalid class scores payload.';
  end if;
  for v_row in select value from jsonb_array_elements(p_scores) loop
    begin v_student := (v_row->>'student_id')::uuid;
    exception when others then raise exception 'Invalid learner identifier.'; end;
    if v_student is null or v_student = any(v_seen) then
      raise exception 'Duplicate or missing learner in adjustments.';
    end if;
    v_seen := array_append(v_seen, v_student);
    if v_student = v_leader then raise exception 'Adjust the representative score in the main class grade.'; end if;
    if not exists (select 1 from public.mathside_section_members
                   where section_id = v_assignment.section_id and student_id = v_student) then
      raise exception 'Student is not enrolled in this section.';
    end if;
    begin v_score := nullif(v_row->>'score','')::numeric(10,2);
    exception when others then raise exception 'Invalid score value.'; end;
    if v_score is not null and (v_score < 0 or v_score > v_assignment.max_points) then
      raise exception 'Scores must be between zero and the task total.';
    end if;
    if v_score is null then
      delete from public.mathside_class_score_overrides
      where assignment_id = p_assignment_id and student_id = v_student;
    else
      insert into public.mathside_class_score_overrides (assignment_id,student_id,score,changed_by)
      values(p_assignment_id,v_student,v_score,v_uid)
      on conflict(assignment_id,student_id) do update
        set score = excluded.score, changed_by = excluded.changed_by,
            changed_at = now();
    end if;
    update public.mathside_submissions
       set teacher_score = mathside_private.class_member_score(
             p_assignment_id,v_student,v_rep_score), updated_at = now()
     where assignment_id = p_assignment_id and student_id = v_student
       and is_class_mirror;
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('updated',v_count);
end;
$$;
revoke all on function public.mathside_set_class_scores(uuid,jsonb) from public,anon;
grant execute on function public.mathside_set_class_scores(uuid,jsonb) to authenticated;

-- Upgrade previously graded class tasks without requiring resubmission.
update public.mathside_submissions s
   set teacher_score = mathside_private.class_member_score(
         s.assignment_id, s.student_id, rep.teacher_score),
       updated_at = now()
  from public.mathside_performance_groups g,
       public.mathside_submissions rep,
       public.mathside_assignments a
 where s.assignment_id = a.id
   and a.collaboration_mode = 'class'
   and g.assignment_id = a.id
   and rep.assignment_id = a.id
   and rep.student_id = g.leader_id
   and rep.status = 'graded'
   and s.is_class_mirror;

commit;
notify pgrst, 'reload schema';
