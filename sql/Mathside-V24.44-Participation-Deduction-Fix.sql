-- Run once in Supabase SQL Editor after the existing Mathside setup.
-- Correct rule: grade = group score - (5 - leader rating), minimum zero.
-- Existing leader ratings and teacher overrides are preserved.
BEGIN;
DO $migration$
DECLARE
  fn record;
  definition text;
  corrected text;
  old_rule constant text := 'WHEN[[:space:]]+5[[:space:]]+THEN[[:space:]]+0[[:space:]]+WHEN[[:space:]]+4[[:space:]]+THEN[[:space:]]+2[[:space:]]+WHEN[[:space:]]+3[[:space:]]+THEN[[:space:]]+3[[:space:]]+WHEN[[:space:]]+2[[:space:]]+THEN[[:space:]]+4[[:space:]]+WHEN[[:space:]]+1[[:space:]]+THEN[[:space:]]+5';
BEGIN
  -- Modify only installed Mathside functions containing the exact old scale.
  -- Preserve each function's signature, permissions and security attributes.
  FOR fn IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.prokind='f'
      AND (n.nspname='mathside_private' OR
           (n.nspname='public' AND left(p.proname,9)='mathside_'))
  LOOP
    definition := pg_get_functiondef(fn.oid);
    IF definition ~* old_rule AND definition ILIKE '%rating%' THEN
      corrected := regexp_replace(definition, old_rule,
        'WHEN 5 THEN 0 WHEN 4 THEN 1 WHEN 3 THEN 2 WHEN 2 THEN 3 WHEN 1 THEN 4', 'gi');
      EXECUTE corrected;
    END IF;
  END LOOP;

  -- Recalculate active, already-graded whole-class member scores, when this
  -- optional module is installed. The score function preserves teacher overrides.
  IF to_regprocedure('mathside_private.class_member_score(uuid,uuid,numeric)') IS NOT NULL THEN
    EXECUTE $recalculate$
      UPDATE public.mathside_submissions s
      SET teacher_score=mathside_private.class_member_score(s.assignment_id,s.student_id,rep.teacher_score),
          updated_at=now()
      FROM public.mathside_performance_groups g,
           public.mathside_submissions rep,
           public.mathside_assignments a
      WHERE s.assignment_id=a.id AND a.collaboration_mode='class'
        AND a.status IS DISTINCT FROM 'archived'
        AND g.assignment_id=a.id AND rep.assignment_id=a.id
        AND rep.student_id=g.leader_id AND rep.status='graded'
        AND s.is_class_mirror
    $recalculate$;
  END IF;
END;
$migration$;
-- Archived snapshots are historical records and are not rewritten.
COMMIT;
NOTIFY pgrst, 'reload schema';
