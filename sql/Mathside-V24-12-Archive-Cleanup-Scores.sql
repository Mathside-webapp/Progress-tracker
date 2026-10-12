-- MATHSIDE V24.12 — Safe irreversible archive, checked score retention.
-- Apply to MATHSIDE Supabase project only, BEFORE uploading V24.12 website.
-- This migration installs new objects; it does NOT change historical data or
-- archive/delete any existing activities by itself.
BEGIN;

CREATE TABLE IF NOT EXISTS public.mathside_archived_scores (
  assignment_id uuid NOT NULL REFERENCES public.mathside_assignments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.mathside_profiles(id) ON DELETE CASCADE,
  score numeric NOT NULL CHECK (score >= 0),
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(assignment_id,student_id)
);
CREATE INDEX IF NOT EXISTS mathside_archived_scores_student_idx
  ON public.mathside_archived_scores(student_id);
ALTER TABLE public.mathside_archived_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mathside_archived_scores_teacher_select ON public.mathside_archived_scores;
CREATE POLICY mathside_archived_scores_teacher_select ON public.mathside_archived_scores
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.mathside_assignments a
    WHERE a.id = assignment_id AND a.teacher_id = (SELECT auth.uid())
  ));
REVOKE ALL ON public.mathside_archived_scores FROM PUBLIC, anon;
GRANT SELECT ON public.mathside_archived_scores TO authenticated;

-- Durable file cleanup list: retained until the Storage API confirms deletion.
CREATE TABLE IF NOT EXISTS public.mathside_archive_cleanup_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.mathside_assignments(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES public.mathside_profiles(id) ON DELETE CASCADE,
  object_path text NOT NULL CHECK (length(btrim(object_path)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, object_path)
);
CREATE INDEX IF NOT EXISTS mathside_archive_cleanup_queue_teacher_idx
  ON public.mathside_archive_cleanup_queue(teacher_id, created_at);
ALTER TABLE public.mathside_archive_cleanup_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mathside_archive_cleanup_queue_teacher_select ON public.mathside_archive_cleanup_queue;
CREATE POLICY mathside_archive_cleanup_queue_teacher_select ON public.mathside_archive_cleanup_queue
  FOR SELECT TO authenticated USING (teacher_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS mathside_archive_cleanup_queue_teacher_delete ON public.mathside_archive_cleanup_queue;
CREATE POLICY mathside_archive_cleanup_queue_teacher_delete ON public.mathside_archive_cleanup_queue
  FOR DELETE TO authenticated USING (teacher_id = (SELECT auth.uid()));
REVOKE ALL ON public.mathside_archive_cleanup_queue FROM PUBLIC, anon;
GRANT SELECT, DELETE ON public.mathside_archive_cleanup_queue TO authenticated;

CREATE SCHEMA IF NOT EXISTS mathside_private;

-- Secure atomic operation: scores saved + submissions deleted + status changed
-- in ONE transaction. It never deletes teacher task instructions or rubrics.
CREATE OR REPLACE FUNCTION public.mathside_archive_assignments_clean(p_assignment_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[];
  v_count integer;
  v_score_count integer;
  v_deleted integer;
  v_queued integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in as the owning teacher before archiving';
  END IF;
  SELECT array_agg(DISTINCT id ORDER BY id) INTO v_ids
  FROM unnest(p_assignment_ids) AS item(id) WHERE id IS NOT NULL;
  IF v_ids IS NULL OR cardinality(v_ids) < 1 OR cardinality(v_ids) > 200 THEN
    RAISE EXCEPTION 'Select between 1 and 200 activities';
  END IF;

  -- Lock selected assignments to prevent concurrent submission/archive races.
  PERFORM 1 FROM public.mathside_assignments a
  WHERE a.id = ANY(v_ids) ORDER BY a.id FOR UPDATE;
  SELECT count(*) INTO v_count FROM public.mathside_assignments a
  WHERE a.id = ANY(v_ids)
    AND a.teacher_id = auth.uid()
    AND a.status <> 'archived';
  IF v_count <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Archive cancelled: some tasks are already archived or do not belong to you';
  END IF;

  -- Save ONLY teacher-checked/graded individual scores (not incomplete work).
  INSERT INTO public.mathside_archived_scores(assignment_id, student_id, score, archived_at)
  SELECT s.assignment_id, s.student_id, COALESCE(s.teacher_score, s.auto_score), now()
  FROM public.mathside_submissions s
  JOIN public.mathside_assignments a ON a.id = s.assignment_id
  WHERE s.assignment_id = ANY(v_ids)
    AND s.status = 'graded'
    AND (a.work_type IS DISTINCT FROM 'performance_task' OR s.teacher_score IS NOT NULL)
    AND COALESCE(s.teacher_score, s.auto_score) IS NOT NULL
  ON CONFLICT (assignment_id,student_id) DO UPDATE
    SET score = excluded.score, archived_at = excluded.archived_at;

  -- Preserve each graded team member's final grade using the existing
  -- leader score minus participation deduction (5→0,4→2,3→3,2→4,1→5).
  INSERT INTO public.mathside_archived_scores(assignment_id,student_id,score,archived_at)
  SELECT a.id, m.student_id,
    CASE WHEN m.student_id = g.leader_id THEN s.teacher_score
      ELSE greatest(0::numeric, s.teacher_score -
        (CASE r.rating WHEN 5 THEN 0 WHEN 4 THEN 2 WHEN 3 THEN 3
          WHEN 2 THEN 4 WHEN 1 THEN 5 END)::numeric)
    END,
    now()
  FROM public.mathside_assignments a
  JOIN public.mathside_performance_groups g ON g.assignment_id=a.id
  JOIN public.mathside_performance_group_members m ON m.group_id=g.id
  JOIN public.mathside_submissions s
    ON s.assignment_id=a.id AND s.student_id=g.leader_id
  LEFT JOIN public.mathside_performance_participation_ratings r
    ON r.assignment_id=a.id AND r.group_id=g.id AND r.member_id=m.student_id
  WHERE a.id=ANY(v_ids)
    AND a.work_type='performance_task'
    AND a.collaboration_mode <> 'individual'
    AND s.status='graded' AND s.teacher_score IS NOT NULL
    AND (m.student_id=g.leader_id OR r.rating IS NOT NULL)
  ON CONFLICT (assignment_id,student_id) DO UPDATE
    SET score = excluded.score, archived_at = excluded.archived_at;

  SELECT count(*) INTO v_score_count FROM public.mathside_archived_scores
  WHERE assignment_id=ANY(v_ids);

  -- Gather ALL submission object paths before responses disappear.
  INSERT INTO public.mathside_archive_cleanup_queue(assignment_id,teacher_id,object_path)
  SELECT DISTINCT q.assignment_id, a.teacher_id, q.object_path
  FROM (
    SELECT s.assignment_id, s.proof_path AS object_path
      FROM public.mathside_submissions s WHERE s.assignment_id=ANY(v_ids)
    UNION
    SELECT s.assignment_id, jsonb_array_elements_text(COALESCE(s.proof_paths,'[]'::jsonb)) AS object_path
      FROM public.mathside_submissions s WHERE s.assignment_id=ANY(v_ids)
  ) q
  JOIN public.mathside_assignments a ON a.id=q.assignment_id
  WHERE q.object_path IS NOT NULL AND length(btrim(q.object_path))>0
  ON CONFLICT (assignment_id, object_path) DO NOTHING;
  SELECT count(*) INTO v_queued FROM public.mathside_archive_cleanup_queue
  WHERE assignment_id=ANY(v_ids);

  -- CASCADE removes individual answers. Explicitly delete drafts/groups so
  -- unarchiving restores an EMPTY submission workspace, not prior work.
  DELETE FROM public.mathside_submissions WHERE assignment_id=ANY(v_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  DELETE FROM public.mathside_assignment_drafts WHERE assignment_id=ANY(v_ids);
  DELETE FROM public.mathside_performance_participation_ratings WHERE assignment_id=ANY(v_ids);
  DELETE FROM public.mathside_performance_group_members WHERE assignment_id=ANY(v_ids);
  DELETE FROM public.mathside_performance_groups WHERE assignment_id=ANY(v_ids);
  UPDATE public.mathside_assignments
    SET status='archived', archived_at=now()
    WHERE id=ANY(v_ids);
  RETURN jsonb_build_object('archived',cardinality(v_ids),
    'deleted_submissions',v_deleted,'saved_scores',v_score_count,
    'files_queued',v_queued);
END;
$$;
REVOKE ALL ON FUNCTION public.mathside_archive_assignments_clean(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mathside_archive_assignments_clean(uuid[]) TO authenticated;
COMMIT;
