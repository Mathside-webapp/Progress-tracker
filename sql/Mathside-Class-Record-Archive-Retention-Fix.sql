-- MATHSIDE CLASS RECORD RETENTION FIX (October 2026)
-- Run in Supabase SQL Editor AFTER:
--   1. sql/Mathside-V24-12-Archive-Cleanup-Scores.sql
--   2. sql/Mathside-Archive-Progress-History.sql
-- SAFE: adds a small grade-only record, does not change existing archived work.
-- Submissions, answers, feedback, proof files and group data are STILL deleted.
-- Back up the Supabase database before applying SQL migrations.

BEGIN;
CREATE TABLE IF NOT EXISTS public.mathside_class_record_snapshots (
  assignment_id uuid NOT NULL REFERENCES public.mathside_assignments(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.mathside_profiles(id) ON DELETE CASCADE,
  score numeric,
  display_status text CHECK (display_status IS NULL OR display_status IN ('Pending','Not rated')),
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, student_id),
  CONSTRAINT mathside_class_record_snapshot_value_check CHECK
    (score IS NOT NULL OR display_status IN ('Pending','Not rated')),
  CONSTRAINT mathside_class_record_snapshot_nonnegative CHECK
    (score IS NULL OR score >= 0)
);
CREATE INDEX IF NOT EXISTS mathside_class_record_snapshots_student_idx
  ON public.mathside_class_record_snapshots(student_id);
ALTER TABLE public.mathside_class_record_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mathside_class_record_snapshots_teacher_select
  ON public.mathside_class_record_snapshots;
CREATE POLICY mathside_class_record_snapshots_teacher_select
  ON public.mathside_class_record_snapshots FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.mathside_assignments a
    WHERE a.id = assignment_id AND a.teacher_id = (SELECT auth.uid())
  ));
REVOKE ALL ON public.mathside_class_record_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mathside_class_record_snapshots TO authenticated;

-- Previously archived CHECKED grades remain visible (if saved by the
-- existing archive RPC). Deleted ungraded submissions cannot be recovered.
INSERT INTO public.mathside_class_record_snapshots
  (assignment_id, student_id, score, display_status, archived_at)
SELECT s.assignment_id, s.student_id, s.score, NULL, s.archived_at
FROM public.mathside_archived_scores s
ON CONFLICT (assignment_id, student_id) DO NOTHING;

-- The frontend checks this migration before allowing irreversible archives.
-- In particular, installing the new JS without running the SQL blocks archive.
CREATE OR REPLACE FUNCTION public.mathside_class_record_retention_version()
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT 'class-record-retention-v1'::text;
$$;
REVOKE ALL ON FUNCTION public.mathside_class_record_retention_version() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mathside_class_record_retention_version() TO authenticated;

-- Replace only the existing archive RPC with its original secure cleanup
-- procedure plus a durable progress snapshot BEFORE the response rows vanish.
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

  -- Snapshot ALL class-record values BEFORE permanent submission cleanup.
  -- Unlike mathside_archived_scores, this includes automatically scored
  -- submitted written work and visible Pending/Not rated performance cells.
  -- One row per learner/assignment; no answers, uploads or feedback retained.
  INSERT INTO public.mathside_class_record_snapshots AS previous
    (assignment_id, student_id, score, display_status, archived_at)
  SELECT s.assignment_id, s.student_id,
    CASE
      WHEN a.work_type = 'performance_task'
        THEN CASE WHEN s.status = 'graded' THEN s.teacher_score ELSE NULL END
      WHEN s.status = 'graded' THEN COALESCE(s.teacher_score, s.auto_score)
      ELSE s.auto_score
    END AS score,
    CASE
      WHEN a.work_type = 'performance_task'
        AND (s.status IS DISTINCT FROM 'graded' OR s.teacher_score IS NULL)
        THEN 'Pending'::text
      WHEN a.work_type IS DISTINCT FROM 'performance_task'
        AND (CASE WHEN s.status = 'graded'
          THEN COALESCE(s.teacher_score, s.auto_score)
          ELSE s.auto_score END) IS NULL
        THEN 'Pending'::text
      ELSE NULL::text
    END AS display_status, now()
  FROM public.mathside_submissions s
  JOIN public.mathside_assignments a ON a.id = s.assignment_id
  WHERE a.id = ANY(v_ids)
    AND (a.work_type IS DISTINCT FROM 'performance_task'
      OR COALESCE(a.collaboration_mode, 'individual') = 'individual')
  ON CONFLICT (assignment_id, student_id) DO UPDATE SET
    score = COALESCE(excluded.score, previous.score),
    display_status = CASE WHEN COALESCE(excluded.score, previous.score) IS NOT NULL
      THEN NULL ELSE COALESCE(excluded.display_status, previous.display_status) END,
    archived_at = excluded.archived_at;

  -- Team performance tasks must retain individual grades AFTER the team
  -- roster and participation ratings are deleted by the archive procedure.
  INSERT INTO public.mathside_class_record_snapshots AS previous
    (assignment_id, student_id, score, display_status, archived_at)
  SELECT a.id, m.student_id,
    CASE WHEN s.status = 'graded' AND s.teacher_score IS NOT NULL THEN
      CASE WHEN m.student_id = grp.leader_id THEN s.teacher_score
        WHEN r.rating IS NOT NULL THEN GREATEST(0::numeric, s.teacher_score -
          (CASE r.rating WHEN 5 THEN 0 WHEN 4 THEN 2 WHEN 3 THEN 3
            WHEN 2 THEN 4 WHEN 1 THEN 5 END)::numeric)
        ELSE NULL::numeric END
      ELSE NULL::numeric END AS score,
    CASE WHEN s.status IS DISTINCT FROM 'graded' OR s.teacher_score IS NULL
      THEN 'Pending'::text
      WHEN m.student_id <> grp.leader_id AND r.rating IS NULL
      THEN 'Not rated'::text
      ELSE NULL::text END AS display_status, now()
  FROM public.mathside_assignments a
  JOIN public.mathside_performance_groups grp ON grp.assignment_id = a.id
  JOIN public.mathside_performance_group_members m ON m.group_id = grp.id
  JOIN public.mathside_submissions s
    ON s.assignment_id = a.id AND s.student_id = grp.leader_id
  LEFT JOIN public.mathside_performance_participation_ratings r
    ON r.assignment_id = a.id AND r.group_id = grp.id AND r.member_id = m.student_id
  WHERE a.id = ANY(v_ids) AND a.work_type = 'performance_task'
    AND COALESCE(a.collaboration_mode, 'individual') <> 'individual'
  ON CONFLICT (assignment_id, student_id) DO UPDATE SET
    score = COALESCE(excluded.score, previous.score),
    display_status = CASE WHEN COALESCE(excluded.score, previous.score) IS NOT NULL
      THEN NULL ELSE COALESCE(excluded.display_status, previous.display_status) END,
    archived_at = excluded.archived_at;

  SELECT count(*) INTO v_score_count FROM public.mathside_archived_scores
  WHERE assignment_id=ANY(v_ids);

  -- Durable progress evidence: one record for every actual submission,
  -- including work that was submitted but not graded. Preserve previous
  -- checked status when a task has been unarchived and archived again.
  INSERT INTO public.mathside_submission_history AS old_progress
    (assignment_id, student_id, status, submitted_at, archived_at)
  SELECT s.assignment_id, s.student_id,
    CASE WHEN s.status = 'graded' OR g.student_id IS NOT NULL
      THEN 'graded' ELSE 'submitted' END,
    s.submitted_at, now()
  FROM public.mathside_submissions s
  LEFT JOIN public.mathside_archived_scores g
    ON g.assignment_id = s.assignment_id AND g.student_id = s.student_id
  WHERE s.assignment_id = ANY(v_ids)
  ON CONFLICT (assignment_id, student_id) DO UPDATE SET
    status = CASE WHEN old_progress.status = 'graded'
      OR excluded.status = 'graded' THEN 'graded' ELSE 'submitted' END,
    submitted_at = COALESCE(old_progress.submitted_at, excluded.submitted_at),
    archived_at = excluded.archived_at;

  -- A team task can have only one submitted response, owned by its leader.
  -- Record the participating team members as submitted too. Their grade
  -- is recorded only if a checked score was actually saved for that member.
  INSERT INTO public.mathside_submission_history AS old_progress
    (assignment_id, student_id, status, submitted_at, archived_at)
  SELECT a.id, m.student_id,
    CASE WHEN gscore.student_id IS NOT NULL THEN 'graded' ELSE 'submitted' END,
    s.submitted_at, now()
  FROM public.mathside_assignments a
  JOIN public.mathside_performance_groups grp ON grp.assignment_id = a.id
  JOIN public.mathside_performance_group_members m ON m.group_id = grp.id
  JOIN public.mathside_submissions s
    ON s.assignment_id = a.id AND s.student_id = grp.leader_id
  LEFT JOIN public.mathside_archived_scores gscore
    ON gscore.assignment_id = a.id AND gscore.student_id = m.student_id
  WHERE a.id = ANY(v_ids)
    AND a.work_type = 'performance_task'
    AND a.collaboration_mode <> 'individual'
  ON CONFLICT (assignment_id, student_id) DO UPDATE SET
    status = CASE WHEN old_progress.status = 'graded'
      OR excluded.status = 'graded' THEN 'graded' ELSE 'submitted' END,
    submitted_at = COALESCE(old_progress.submitted_at, excluded.submitted_at),
    archived_at = excluded.archived_at;

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
REVOKE ALL ON FUNCTION public.mathside_archive_assignments_clean(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mathside_archive_assignments_clean(uuid[])
  TO authenticated;
COMMIT;
