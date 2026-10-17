-- MATHSIDE Student Grade History Visibility (run ONCE in Supabase SQL Editor)
-- Prerequisite: mathside_submission_history and mathside_archived_scores exist.
-- This DOES NOT archive, delete, or modify any student submissions/grades.
-- Only the owning student can SELECT their own saved history/score rows.
-- Students see archived assignment metadata and questions ONLY if that
-- student actually has a retained submission or score for that activity.
BEGIN;

ALTER TABLE public.mathside_archived_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mathside_submission_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mathside_archived_scores_student_select
  ON public.mathside_archived_scores;
CREATE POLICY mathside_archived_scores_student_select
  ON public.mathside_archived_scores
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS mathside_submission_history_student_select
  ON public.mathside_submission_history;
CREATE POLICY mathside_submission_history_student_select
  ON public.mathside_submission_history
  FOR SELECT TO authenticated
  USING (student_id = (SELECT auth.uid()));

GRANT SELECT ON public.mathside_archived_scores TO authenticated;
GRANT SELECT ON public.mathside_submission_history TO authenticated;

-- A narrowly scoped, private SECURITY DEFINER existence check avoids
-- circular RLS checks (history's teacher policy looks up assignments).
CREATE OR REPLACE FUNCTION mathside_private.student_has_archived_result(p_assignment uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS '
  SELECT (auth.uid() IS NOT NULL) AND (
    EXISTS (SELECT 1 FROM public.mathside_submission_history h
            WHERE h.assignment_id = p_assignment AND h.student_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.mathside_archived_scores s
               WHERE s.assignment_id = p_assignment AND s.student_id = auth.uid())
  );
';
REVOKE ALL ON FUNCTION mathside_private.student_has_archived_result(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mathside_private.student_has_archived_result(uuid) TO authenticated;

DROP POLICY IF EXISTS mathside_assignments_student_archived_result
  ON public.mathside_assignments;
CREATE POLICY mathside_assignments_student_archived_result
  ON public.mathside_assignments
  FOR SELECT TO authenticated
  USING (
    status = 'archived'
    AND (SELECT auth.uid()) IS NOT NULL
    AND mathside_private.student_has_archived_result(id)
  );

-- Total points remain visible for previously graded written work.
-- Answer keys, deleted responses, and student-uploaded files remain private.
DROP POLICY IF EXISTS mathside_questions_student_archived_result
  ON public.mathside_questions;
CREATE POLICY mathside_questions_student_archived_result
  ON public.mathside_questions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.mathside_assignments a
      WHERE a.id = assignment_id
        AND a.status = 'archived'
        AND mathside_private.student_has_archived_result(a.id)
    )
  );

COMMIT;

-- Verify policies exist (this is not an impersonation test).
SELECT tablename, policyname
FROM pg_catalog.pg_policies
WHERE schemaname = 'public' AND policyname IN (
  'mathside_archived_scores_student_select',
  'mathside_submission_history_student_select',
  'mathside_assignments_student_archived_result',
  'mathside_questions_student_archived_result'
)
ORDER BY tablename, policyname;
