-- Mathside V17 — Answer normalization / auto-check accuracy
-- Run this after 06-v15-performance-multiple-files.sql.

-- Mathside V17 — tolerant math-answer auto-checking.
-- This intentionally normalizes formatting differences only. It does not try to
-- symbolically solve/rearrange arbitrary algebra. Examples treated as equal:
--   \(x^{4}y^{4}\)   x^4y^4   x ^ 4 y ^ 4
--   \(a^6b^2\)       a^6b^2
--   \frac{1}{2}      1/2

create or replace function mathside_private.normalize_math_answer(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := lower(btrim(coalesce(p_value, '')));
begin
  if v = '' then return ''; end if;

  -- Remove Mathside/LaTeX display wrappers and spacing-only commands.
  v := replace(v, E'\\(', '');
  v := replace(v, E'\\)', '');
  v := replace(v, E'\\[', '');
  v := replace(v, E'\\]', '');
  v := replace(v, '$', '');
  v := replace(v, E'\\left', '');
  v := replace(v, E'\\right', '');
  v := replace(v, E'\\,', '');
  v := replace(v, E'\\;', '');
  v := replace(v, E'\\:', '');
  v := replace(v, E'\\!', '');

  -- Normalize visually equivalent operator characters/forms.
  v := replace(v, '−', '-');
  v := replace(v, '–', '-');
  v := replace(v, '×', '*');
  v := replace(v, '·', '*');
  v := replace(v, '÷', '/');
  v := replace(v, E'\\times', '*');
  v := replace(v, E'\\cdot', '*');
  v := replace(v, E'\\div', '/');

  -- Common Unicode superscripts, useful when answers are pasted/typed directly.
  v := replace(v, '⁰', '^0');
  v := replace(v, '¹', '^1');
  v := replace(v, '²', '^2');
  v := replace(v, '³', '^3');
  v := replace(v, '⁴', '^4');
  v := replace(v, '⁵', '^5');
  v := replace(v, '⁶', '^6');
  v := replace(v, '⁷', '^7');
  v := replace(v, '⁸', '^8');
  v := replace(v, '⁹', '^9');

  -- MathLive often adds braces while normal typing usually does not.
  -- These rules preserve mathematical grouping while removing simple LaTeX-only braces.
  v := regexp_replace(v, $re$\\mathrm\{([^{}]*)\}$re$, $rep$\1$rep$, 'g');
  v := regexp_replace(v, $re$\\mathit\{([^{}]*)\}$re$, $rep$\1$rep$, 'g');
  v := regexp_replace(v, $re$\\mathbf\{([^{}]*)\}$re$, $rep$\1$rep$, 'g');
  v := regexp_replace(v, $re$\\text\{([^{}]*)\}$re$, $rep$\1$rep$, 'g');

  -- Simple fraction forms: \frac{1}{2} and \dfrac{1}{2} -> 1/2.
  v := regexp_replace(v, $re$\\dfrac\{([^{}]+)\}\{([^{}]+)\}$re$, $rep$\1/\2$rep$, 'g');
  v := regexp_replace(v, $re$\\frac\{([^{}]+)\}\{([^{}]+)\}$re$, $rep$\1/\2$rep$, 'g');

  -- x^{4} -> x^4 and x_{2} -> x_2 for simple contents.
  v := regexp_replace(v, $re$\^\{([^{}]+)\}$re$, $rep$^\1$rep$, 'g');
  v := regexp_replace(v, $re$_\{([^{}]+)\}$re$, $rep$_\1$rep$, 'g');

  -- Whitespace has no scoring significance for short mathematical answers.
  v := regexp_replace(v, '[[:space:]]+', '', 'g');

  return v;
end;
$$;

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
    v_correct :=
      length(mathside_private.normalize_math_answer(v_key)) > 0
      and mathside_private.normalize_math_answer(v_text) = mathside_private.normalize_math_answer(v_key);

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

-- No table changes are required. Existing answer keys are normalized at comparison time.
