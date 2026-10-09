# Mathside Step 6.9 — Installed App Push Notifications

The website code is already wired for Web Push. Complete these Supabase steps once.

## 1. Run the SQL
Run:

`supabase/sql/07-v16-push-notifications.sql`

This adds secure per-device subscriptions and the 24/48/72-hour deadline reminder job.

## 2. Generate VAPID keys
On a computer with Node.js, run:

`npx web-push generate-vapid-keys`

Keep the **private key secret**. Never paste it into `js/config.js`, GitHub Pages, or any public frontend file.

## 3. Add Supabase Edge Function secrets
In Supabase Dashboard → Edge Functions → Secrets, add:

- `VAPID_PUBLIC_KEY` = generated public key
- `VAPID_PRIVATE_KEY` = generated private key
- `VAPID_SUBJECT` = a contact such as `mailto:your-email@example.com`

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically to deployed Edge Functions.

## 4. Deploy the Edge Function
Deploy the folder:

`supabase/functions/send-push-notification`

Function name: `send-push-notification`

JWT verification should stay **ON**.

## 5. Create one Database Webhook
Supabase Dashboard → Database → Webhooks → Create webhook:

- Table: `public.mathside_notifications`
- Event: **INSERT**
- Webhook type: **Supabase Edge Function**
- Function: `send-push-notification`
- Method: POST
- Add the built-in **service key auth header**

After this, every Mathside notification row can be delivered as an operating-system push notification to the student's/teacher's installed PWA.

## 6. Student/teacher device flow
1. Install Mathside as a PWA.
2. Sign in.
3. Mathside offers **Turn on notifications**.
4. Accept the browser/device permission.

The notification bell also contains an **Enable app alerts / App alerts on** button so the user can change the setting later.

## What is pushed
- New activities
- New performance tasks
- Submission/resubmission notifications to teachers
- Grades/feedback to students
- Existing 24/48/72-hour deadline reminders when configured by the teacher

## Platform notes
- Android/desktop Chromium-based browsers: Web Push works for installed PWAs when permission is granted.
- iPhone/iPad: Web Push requires the site to be added to the Home Screen as a web app and notification permission must be granted from that installed web app.
