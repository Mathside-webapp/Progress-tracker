-- =====================================================================
-- Mathside V24.13 - Supabase Security + Performance Maintenance
-- Safe to run after the existing Mathside SQL files.
-- The live Mathside project already has this maintenance applied.
-- =====================================================================

begin;

-- Notification actions exposed to the browser must require a signed-in user.
revoke execute on function public.mathside_mark_notifications_read(uuid[])
  from public, anon;
grant execute on function public.mathside_mark_notifications_read(uuid[])
  to authenticated;

-- Retention cleanup is server-side only. Browsers no longer call this RPC.
revoke execute on function public.mathside_cleanup_old_notifications()
  from public, anon, authenticated;
grant execute on function public.mathside_cleanup_old_notifications()
  to service_role;

-- Foreign-key indexes recommended by Supabase Database Advisor.
create index if not exists mathside_assignment_drafts_assignment_id_fk_idx
  on public.mathside_assignment_drafts(assignment_id);
create index if not exists mathside_deadline_reminder_log_student_id_fk_idx
  on public.mathside_deadline_reminder_log(student_id);
create index if not exists mathside_notifications_related_assignment_id_fk_idx
  on public.mathside_notifications(related_assignment_id);
create index if not exists mathside_notifications_related_submission_id_fk_idx
  on public.mathside_notifications(related_submission_id);
create index if not exists mathside_performance_group_members_student_id_fk_idx
  on public.mathside_performance_group_members(student_id);
create index if not exists mathside_performance_groups_leader_id_fk_idx
  on public.mathside_performance_groups(leader_id);
create index if not exists mathside_performance_groups_section_id_fk_idx
  on public.mathside_performance_groups(section_id);
create index if not exists mathside_performance_participation_ratings_group_id_fk_idx
  on public.mathside_performance_participation_ratings(group_id);
create index if not exists mathside_performance_participation_ratings_leader_id_fk_idx
  on public.mathside_performance_participation_ratings(leader_id);
create index if not exists mathside_performance_participation_ratings_member_id_fk_idx
  on public.mathside_performance_participation_ratings(member_id);
create index if not exists mathside_profiles_created_by_teacher_fk_idx
  on public.mathside_profiles(created_by_teacher);
create index if not exists mathside_submission_answers_question_id_fk_idx
  on public.mathside_submission_answers(question_id);
create index if not exists mathside_submissions_graded_by_fk_idx
  on public.mathside_submissions(graded_by);

-- Private daily notification retention job.
create or replace function mathside_private.cleanup_old_notifications_scheduled()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  delete from public.mathside_notifications
  where created_at < now() - interval '7 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function mathside_private.cleanup_old_notifications_scheduled()
  from public, anon, authenticated;
grant execute on function mathside_private.cleanup_old_notifications_scheduled()
  to service_role, postgres;

commit;

create extension if not exists pg_cron;

-- Keep notification cleanup server-side.
select cron.schedule(
  'mathside-notification-retention-daily',
  '0 19 * * *',
  $$select mathside_private.cleanup_old_notifications_scheduled();$$
);

-- Five-minute publishing cadence reduces unnecessary cron/log activity while
-- keeping scheduled classroom posts reasonably prompt.
select cron.schedule(
  'mathside-publish-scheduled-assignments',
  '*/5 * * * *',
  $$select mathside_private.publish_scheduled_assignments();$$
);

notify pgrst, 'reload schema';
