-- Mathside V24.39, run once in Supabase SQL Editor.
-- Safe for current V24.37 databases and new installs (includes complete V24.37 foundation).
-- This updates older stored bell alerts and the teacher RPC to point to the To Do area.

-- MATHSIDE V24.39: Persistent, private clear reasons in student's To Do tab
-- Run in Supabase SQL Editor BEFORE publishing the new website files.
-- The bell stores only a generic notice; the detailed reason lives separately.
-- Safe to run after V24.36. Reuses the same three-argument RPC.

create table if not exists public.mathside_submission_clears (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.mathside_assignments(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  submission_id uuid not null,
  reason_code text not null,
  reason_text text not null,
  teacher_note text,
  cleared_by uuid not null references auth.users(id),
  cleared_at timestamptz not null default now(),
  constraint mathside_submission_clears_one_per_student_assignment unique (assignment_id, student_id)
);
create index if not exists mathside_submission_clears_student_recent_idx
  on public.mathside_submission_clears (student_id, cleared_at desc);
alter table public.mathside_submission_clears enable row level security;
revoke all on public.mathside_submission_clears from public, anon, authenticated;
grant select on public.mathside_submission_clears to authenticated;
drop policy if exists mathside_submission_clears_student_read on public.mathside_submission_clears;
create policy mathside_submission_clears_student_read
  on public.mathside_submission_clears for select to authenticated
  using (student_id = (select auth.uid()));

-- Migrate details from V24.36's existing bell messages into the private
-- To Do record BEFORE removing those details from the bell.
-- Older messages without a parseable reason are retained as a generic
-- explanation rather than making up a teacher note.
insert into public.mathside_submission_clears
  (assignment_id,student_id,submission_id,reason_code,reason_text,teacher_note,cleared_by,cleared_at)
select distinct on (n.related_assignment_id,n.user_id)
  n.related_assignment_id,n.user_id,gen_random_uuid(),'legacy',
  coalesce(nullif(substring(n.body from 'Reason: (.*)[.] Open the activity'),''),
    'Submission cleared by your teacher (earlier notice).'),
  null,a.teacher_id,n.created_at
from public.mathside_notifications n
join public.mathside_assignments a on a.id = n.related_assignment_id
where n.type='system'
  and n.title='Submission cleared — action needed'
  and n.related_assignment_id is not null
  and n.user_id is not null
order by n.related_assignment_id,n.user_id,n.created_at desc
on conflict (assignment_id,student_id) do update set
  reason_text=excluded.reason_text,teacher_note=excluded.teacher_note,
  reason_code=excluded.reason_code,cleared_at=excluded.cleared_at
where public.mathside_submission_clears.cleared_at < excluded.cleared_at;

-- Protect old notifications as well as new ones. Previous message bodies
-- may have included private teacher notes. The bell must never show them.
update public.mathside_notifications
set body='Your submission was cleared. Open Activities > To Do to view the reason.'
where type='system' and title='Submission cleared — action needed';

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
  v_notification_id uuid;
begin
  if v_uid is null then raise exception 'You must be signed in.'; end if;
  if not mathside_private.is_teacher(v_uid) then raise exception 'Only teachers can clear submissions.'; end if;
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

  select * into v_submission from public.mathside_submissions
    where id=p_submission_id for update;
  if not found then raise exception 'Submission not found.'; end if;
  select * into v_assignment from public.mathside_assignments
    where id=v_submission.assignment_id;
  if not found or v_assignment.teacher_id <> v_uid then
    raise exception 'You do not own this submission.';
  end if;

  -- Preserve private explanation even after the original response is deleted.
  -- Upsert makes multiple clears of the same activity use the latest reason.
  insert into public.mathside_submission_clears
    (assignment_id,student_id,submission_id,reason_code,reason_text,teacher_note,cleared_by,cleared_at)
  values
    (v_submission.assignment_id,v_submission.student_id,p_submission_id,v_reason_code,
     v_reason,v_note,v_uid,now())
  on conflict (assignment_id,student_id) do update set
    submission_id=excluded.submission_id,
    reason_code=excluded.reason_code,
    reason_text=excluded.reason_text,
    teacher_note=excluded.teacher_note,
    cleared_by=excluded.cleared_by,
    cleared_at=excluded.cleared_at;

  delete from public.mathside_submissions where id=p_submission_id;
  insert into public.mathside_notifications
    (user_id,type,title,body,related_assignment_id,related_submission_id)
  values
    (v_submission.student_id,'system','Submission cleared — action needed',
     'Your submission was cleared. Open Activities > To Do to view the reason.',
     v_submission.assignment_id,null)
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
