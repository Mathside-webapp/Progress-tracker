# Mathside V24.17 — Classic Create-Class and Red Delete Buttons

This is the COMPLETE Mathside website (GitHub Pages static files) based on V24.16.

## Changes
- Restored V24.13's exact simple **Create Class** form: Grade, Class name, Reuse students, Cancel, Create class.
- Removed all 10 logos and 10 backgrounds (20 `assets/v16/` files), both selectors, their JS handlers, and the per-class **Style** button/modal.
- Removed logo/background fields from the new class insert. Existing Supabase columns and saved data are left alone to avoid damage.
- Made Delete (including student roster, assignment, performance tasks, archives, notifications) red with white text. Archive and Unarchive remain their separate colors.
- Ensured the dialog stays within narrow phone screens and updated service-worker cache name so users get new files.
- Preserved `js/config.js` and notification-related enhancements from V24.15 / V24.16.

## Install
1. Keep a copy of the currently published GitHub files.
2. Unzip and replace the contents of your Mathside GitHub Pages project (NOT the folder itself).
3. Commit/publish, then reload the page. For installed PWA, close and reopen the app; if old styles persist, refresh while online to update its cache.
4. Verify the Create Class popup and a Delete confirmation with your teacher account. Deleting real class/students is irreversible.

No additional Supabase SQL or Edge Function redeployment is required for the *existing* project.

## Testing limits
Static source validation and local browser interaction tests are recorded in `TEST-REPORT-V24.17.md`.
Real Supabase inserts/deletes require a teacher sign-in and were intentionally not executed on live student records.
