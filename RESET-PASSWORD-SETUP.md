# Mathside V23.4 — Teacher-Chosen Student Passwords

## What changed
Teachers can now select one or more learners in a class roster and type the new password for each selected learner.

- Each learner can have a different new password.
- Passwords must be 6–72 characters in the Mathside interface.
- Supabase Auth can still enforce stronger project-level password rules.
- Only the teacher who originally created the student account can reset that account's password.
- Existing passwords are never read or recovered.
- After a successful reset, Mathside downloads an Excel copy of the new credentials.

## Required Edge Function update
Before uploading the new website files, update the existing Supabase Edge Function named:

`reset-student-passwords`

Use the code in:

`supabase/functions/reset-student-passwords/index.ts`

Keep **Verify JWT** enabled.

### Supabase Dashboard steps
1. Open your Mathside / MathHub Supabase project.
2. Go to **Edge Functions**.
3. Open **reset-student-passwords**.
4. Replace its `index.ts` with the file included in this ZIP.
5. Deploy the function with JWT verification enabled.
6. Then upload the website files to GitHub Pages.

The new Edge Function is backward-compatible with an older cached Mathside client: old clients can still request an automatically generated password, while V23.4 sends the teacher-chosen passwords.
