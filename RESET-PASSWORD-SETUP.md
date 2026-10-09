# Mathside V24.0 — reset-student-passwords Edge Function

The V24.0 website lets the teacher choose each student's new password. The Supabase Edge Function must be updated to the included version.

1. Open Supabase Dashboard → your Mathside / MathHub project.
2. Open Edge Functions → reset-student-passwords.
3. Open `index.ts`.
4. Replace all existing code with the contents of:
   `supabase/functions/reset-student-passwords/index.ts`
5. Keep **Verify JWT** enabled.
6. Deploy the function.

After deployment, Mathside sends `password_resets` containing the selected student IDs and teacher-chosen passwords. The function still verifies that the signed-in user is a teacher, owns the class, and originally created the student account before changing the Auth password.
