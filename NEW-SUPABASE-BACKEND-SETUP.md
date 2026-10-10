# Mathside — New Supabase Backend Setup

Use this guide only if you want to move/copy Mathside to a **new Supabase project/account**. Your current `js/config.js` is intentionally left unchanged in this backup.

## 1. Create a new Supabase project

Create a fresh Supabase project and wait until it is fully provisioned.

## 2. Run the database SQL files

In **Supabase Dashboard → SQL Editor**, run the files in this order:

1. `supabase/sql/01-supabase-setup.sql`
2. `supabase/sql/02-v10-classroom-features-upgrade.sql`
3. `supabase/sql/03-v10.3-notification-retention-upgrade.sql`
4. `supabase/sql/04-v12-archive-classroom-upgrade.sql`
5. `supabase/sql/05-v13-neumorphism-comments-upgrade.sql`
6. `supabase/sql/06-v15-performance-multiple-files.sql`
7. `supabase/sql/07-v16-push-notifications.sql`
8. `supabase/sql/08-v17-math-answer-normalization.sql`
9. `supabase/sql/09-v18-math-autocorrect-canonicalization.sql`
10. `supabase/sql/10-v19-performance-teamwork.sql`
11. `supabase/sql/11-v20-reuse-any-class-roster.sql`
12. `supabase/sql/12-v21-performance-team-leader-choice.sql`
13. `supabase/sql/13-v22-student-created-team-leader-approval.sql`
14. `supabase/sql/14-v23-storage-optimization.sql`
15. `supabase/sql/14-v24.2-performance-group-reshuffle.sql`
16. `supabase/sql/15-v24.3-notification-delete.sql`

The duplicate `14-` prefix is only a filename/version-history detail. Run them in the order shown above.

## 3. Deploy the Edge Functions

Deploy these folders from `supabase/functions/` and keep **Verify JWT enabled**:

- `create-students`
- `delete-student`
- `delete-assignment`
- `reset-student-passwords`
- `send-push-notification`

The `reset-student-passwords` source in this package already supports the teacher-chosen-password workflow used by the current Mathside frontend.

## 4. Configure push-notification secrets

If you want push notifications, follow `PUSH-NOTIFICATIONS-SETUP.md` and configure the required secrets in the new Supabase project before using `send-push-notification`.

## 5. Point Mathside to the new Supabase project

Copy `js/config.example.js` to `js/config.js`, then replace:

- `YOUR_SUPABASE_PROJECT_URL`
- `YOUR_SUPABASE_PUBLISHABLE_KEY`

Use the **Project URL** and the frontend-safe **Publishable key** from Supabase → Connect.

Never place a service-role/secret key in frontend JavaScript.

## 6. Create/approve the teacher account

Register the teacher account through Mathside, then use `Mathside-Approve-Teacher.sql` in the new project's SQL Editor to approve/promote the intended teacher account. Adjust the identifying value in that SQL to the new teacher account before running it.

## 7. Re-upload the website

Upload the complete Mathside website to GitHub Pages or your chosen host. Make sure the updated `js/config.js` is included.

## 8. Test before using with students

Verify these flows in the new backend:

- Teacher sign in/out
- Create class
- Create/import student accounts
- Reset student password
- Post Activity
- Post Performance Task
- Performance Task group reshuffle
- Student Activity submission
- Student Performance Task submission
- Teacher grading/review
- Archive/Unarchive Class, Activity, and Performance Task
- Archived panel filters
- Delete class
- Delete/Clear notifications
- Export class record to Excel
- Push notifications (if enabled)

## Important

This portable backup contains the **code and database setup**, not the live data stored in your current Supabase project. Moving existing users, submissions, uploaded images/files, and other live records to another Supabase project requires a separate database/storage migration or export/import process.

## V24.14 class visuals
After the base Mathside schema is installed, run `Mathside-V24.14-Class-Visuals.sql` once. It adds the `logo_key` and `background_key` fields used by the 10 class logo/background choices.
