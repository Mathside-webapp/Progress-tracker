-- MATHSIDE V24.36 — Teacher reason when clearing a student submission
-- REQUIRED ONCE. Execute this file in Supabase SQL Editor before using the updated
-- "Clear submission" dialog. No tables or columns need to be added.
-- Do not paste project secrets into this script.
-- The new RPC is deliberately separate from the existing one-argument RPC,
-- so older Mathside versions remain backward-compatible.

create or replace function public.mathside_clear_submission_with_reason(
  p_submission_id uuid,
  p_reason_code text,
  p_teacher_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $mathside$
declare
  v_uid uuid := auth.uid();
  v_submission public.mathside_submissions%rowtype;
  v_assignment public.mathside_assignments%rowtype;
  v_reason_code text := lower(btrim(coalesce(p_reason_code, '')));
  v_reason text;
  v_note text := nullif(btrim(coalesce(p_teacher_note,'')), '');
  v_message text;
  v_notification_id uuid;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;
  if not mathside_private.is_teacher(v_uid) then raise exception 'Only teachers can clear submissions.'; end if;

  -- Prevent arbitrary message injection into the reason. The optional note
  -- is length-limited and shown verbatim in the student's own notification.
  v_reason := case v_reason_code
    when 'unclear_photo' then 'Blurry or unreadable solution image'
    when 'incomplete_work' then 'Incomplete answers or solution steps'
    when 'wrong_file' then 'Wrong file or activity submitted'
    when 'missing_attachment' then 'Missing required solution or attachment'
    when 'instructions' then 'Submission does not follow the instructions'
    when 'resubmission' then 'Teacher requests a corrected submission'
    when 'other' then 'Other reason'
    else null
  end;
  if v_reason is null then raise exception 'Please select a valid reason.'; end if;
  if length(coalesce(v_note,'')) > 280 then raise exception 'Teacher note exceeds 280 characters.'; end if;
  if v_reason_code='other' and v_note is null then raise exception 'Please explain the other reason.'; end if;

  select * into v_submission
  from public.mathside_submissions
  where id=p_submission_id for update;
  if not found then raise exception 'Submission not found.'; end if;

  select * into v_assignment from public.mathside_assignments
  where id=v_submission.assignment_id;
  if not found or v_assignment.teacher_id <> v_uid then
    raise exception 'You do not own this submission.';
  end if;

  -- Keep notification independent of deleted submission, but connected to
  -- the still-existing assignment so clicking the notification can open To Do.
  v_message := 'Your submission for “' || coalesce(v_assignment.title,'your assignment') ||
     '” was cleared. Reason: ' || v_reason ||
     case when v_reason_code = 'other' then ': ' || v_note
          when v_note is not null then '. Teacher note: ' || v_note
          else '' end ||
     '. Open the activity to check whether you can submit again.';

  delete from public.mathside_submissions where id=p_submission_id;

  insert into public.mathside_notifications
    (user_id,type,title,body,related_assignment_id,related_submission_id)
  values
    (v_submission.student_id,'system','Submission cleared — action needed',
     v_message,v_submission.assignment_id,null)
  returning id into v_notification_id;

  return jsonb_build_object(
    'submission_id',p_submission_id,
    'student_id',v_submission.student_id,
    'assignment_id',v_submission.assignment_id,
    'notification_id',v_notification_id,
    'reason_code',v_reason_code
  );
end;
$mathside$;

revoke all on function public.mathside_clear_submission_with_reason(uuid,text,text)
  from public, anon;
grant execute on function public.mathside_clear_submission_with_reason(uuid,text,text)
  to authenticated;
