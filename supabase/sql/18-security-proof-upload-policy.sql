-- Mathside Security Release - proof upload policy hardening.
-- Run this once (or safely re-run) in your EXISTING Supabase project,
-- AFTER backing up and reviewing any custom Storage policies.
-- It does not alter or delete student records or stored files.
-- New files must use <student_uid>/<assignment_uuid>/<filename> and
-- must belong to a PUBLISHED assignment in one of the student's classes.
begin;
-- Needed by the secured push Edge Function when using new-project table grants.
grant select on public.mathside_notifications to service_role;
drop policy if exists mathside_proof_upload on storage.objects;
create policy mathside_proof_upload
on storage.objects for insert to authenticated
with check (
  bucket_id = 'mathside-submission-proofs'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and array_length(storage.foldername(name), 1) = 2
  and mathside_private.is_student((select auth.uid()))
  and exists (
    select 1 from public.mathside_assignments a
    where a.id = mathside_private.safe_uuid((storage.foldername(name))[2])
      and a.status = 'published'
      and mathside_private.student_in_section(a.section_id, (select auth.uid()))
  )
);
commit;
