-- Mathside V24.22 - fix "permission denied for table mathside_performance_groups"
-- for Class Performance Task proof uploads / proof reads.
-- Run in Supabase SQL Editor AFTER migration 20-performance-whole-class.sql.
-- Safe to rerun. Does not grant direct SELECT on the private teams table.
-- Does not change submissions, scores, storage files, or team membership.
begin;

-- Keep the team tables private, as originally required by teamwork migration 10.
-- A SECURITY DEFINER helper makes only the yes/no leader check available to
-- Storage RLS; callers never query or see the underlying team table.
create or replace function mathside_private.is_class_submission_representative(
  p_assignment_id uuid, p_student_id uuid
) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_student_id is not null and exists (
    select 1
    from public.mathside_assignments a
    join public.mathside_performance_groups g on g.assignment_id = a.id
    where a.id = p_assignment_id
      and a.work_type = 'performance_task'
      and a.collaboration_mode = 'class'
      and g.leader_id = p_student_id
      and mathside_private.student_in_section(a.section_id, p_student_id)
  );
$$;

-- A classmate may view the chosen representative's proof, even after the
-- task is archived. Students cannot view other sections' proof by this rule.
create or replace function mathside_private.can_read_class_submission_proof(
  p_assignment_id uuid, p_file_owner_id uuid, p_viewer_id uuid
) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_viewer_id is not null and p_file_owner_id is not null and exists (
    select 1
    from public.mathside_assignments a
    join public.mathside_performance_groups g on g.assignment_id = a.id
    where a.id = p_assignment_id
      and a.work_type = 'performance_task'
      and a.collaboration_mode = 'class'
      and g.leader_id = p_file_owner_id
      and mathside_private.student_in_section(a.section_id, p_viewer_id)
  );
$$;

revoke all on function mathside_private.is_class_submission_representative(uuid, uuid) from public, anon;
revoke all on function mathside_private.can_read_class_submission_proof(uuid, uuid, uuid) from public, anon;
grant execute on function mathside_private.is_class_submission_representative(uuid, uuid) to authenticated;
grant execute on function mathside_private.can_read_class_submission_proof(uuid, uuid, uuid) to authenticated;

-- The prior policy directly referenced mathside_performance_groups as the
-- signed-in user, which has no table privileges by design. Use the helper.
drop policy if exists mathside_proof_upload on storage.objects;
create policy mathside_proof_upload on storage.objects
for insert to authenticated with check (
  bucket_id = 'mathside-submission-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and array_length(storage.foldername(name), 1) = 2
  and mathside_private.is_student((select auth.uid()))
  and exists (
    select 1 from public.mathside_assignments a
    where a.id = mathside_private.safe_uuid((storage.foldername(name))[2])
      and a.status = 'published'
      and mathside_private.student_in_section(a.section_id, (select auth.uid()))
      and (
        a.collaboration_mode <> 'class'
        or mathside_private.is_class_submission_representative(a.id, (select auth.uid()))
      )
  )
);

-- Any select of the proofs bucket evaluates its SELECT policies. Reading
-- a group table from this policy made even normal proof previews fail.
drop policy if exists mathside_class_proof_read on storage.objects;
create policy mathside_class_proof_read on storage.objects
for select to authenticated using (
  bucket_id = 'mathside-submission-proofs'
  and array_length(storage.foldername(name), 1) = 2
  and mathside_private.can_read_class_submission_proof(
    mathside_private.safe_uuid((storage.foldername(name))[2]),
    mathside_private.safe_uuid((storage.foldername(name))[1]),
    (select auth.uid())
  )
);

-- Crucial: DO NOT grant SELECT on public.mathside_performance_groups.
-- The existing mathside_proof_read policy continues to allow the owner
-- and the owning teacher to read work from all collaboration modes.
commit;
notify pgrst, 'reload schema';
