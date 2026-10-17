# Mathside — View Students Archived Progress Fix

## Installation (IMPORTANT)

1. Back up your existing Mathside website and your Supabase database.
2. In Supabase > SQL Editor, run **sql/Mathside-Archive-Progress-History.sql** against the **Mathside** project. This depends on the existing `Mathside-V24-12-Archive-Cleanup-Scores.sql` migration.
3. Deploy the contents of this updated Mathside ZIP. Reload the browser so the updated service worker and JavaScript load.
4. Open **Classes > View students** and **Track** to see preserved counts and individual activity status.
5. Test a sample activity: have one student submit, check/grade the work, archive it, then return to the roster. Both Submitted and Graded remain counted. Test an ungraded submission too; only Submitted should increase.

## What the fix does

- In View students, Submitted and Graded use live submission rows, saved graded scores (`mathside_archived_scores`), AND durable submitted/graded archive evidence (`mathside_submission_history`). Every activity is counted only once per student, even if unarchived/re-submitted.
- The roster denominator and Track include both published and archived activities so totals do not shrink just because a task is archived.
- Track distinguishes graded/submitted archived work from current outstanding work; 'To do' counts only open, published tasks without a current response.
- The new SQL snapshots evidence **before** the normal archive cleanup permanently deletes the full response data; old checked scores are backfilled on installation.
- Archived work still does **not** restore answers, uploads, or detailed feedback. Historical ungraded submissions permanently deleted *before* this update cannot be reconstructed unless you have an earlier backup.
- For safety, the archive confirmation refuses destructive archive actions until the new table is accessible. Run the SQL and reload the site first.

## Database / privacy

The migration installs a small table storing only assignment ID, student ID, submitted/graded status, submission timestamp (if available), and archival timestamp. Teacher-only SELECT uses RLS. The archive RPC runs as before for all other cleanup and preserved-grade behavior. No personal student data is exported or sent anywhere new.

## Limits

This is a code-level correction. It has not been tested against your live Supabase project. The website does not automatically run SQL migrations; you must apply the included SQL. Back up and test with a sample activity before updating the live classroom site.
