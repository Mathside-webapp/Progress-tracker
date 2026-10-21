import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-mathside-webhook-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// This endpoint uses a service-role client. A valid Supabase user JWT is not
// sufficient to authorize a push request: require a separate webhook secret.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function constantTimeEqual(actual: string, expected: string): boolean {
  const a = new TextEncoder().encode(actual);
  const b = new TextEncoder().encode(expected);
  let different = a.length ^ b.length;
  const limit = Math.max(a.length, b.length);
  for (let i = 0; i < limit; i++) different |= (a[i] || 0) ^ (b[i] || 0);
  return different === 0;
}

async function limitedJson(req: Request): Promise<unknown> {
  if (Number(req.headers.get('content-length') || 0) > 32_768) throw new Error('Payload too large');
  const reader = req.body?.getReader();
  if (!reader) throw new Error('Request body is empty');
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 32_768) { await reader.cancel(); throw new Error('Payload too large'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(length);
  let at = 0;
  for (const part of parts) { joined.set(part, at); at += part.byteLength; }
  return JSON.parse(new TextDecoder().decode(joined));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:mathside@example.com";

  if (req.method === "GET") {
    if (!publicKey) return json({ error: "VAPID_PUBLIC_KEY is not configured." }, 503);
    return json({ publicKey });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  // The secret must be set in Edge Functions > Secrets and in the Database
  // Webhook's custom header. Do NOT place it in any browser-side file.
  const webhookSecret = Deno.env.get("MATHSIDE_PUSH_WEBHOOK_SECRET") || "";
  if (webhookSecret.length < 32) return json({ error: "Push webhook secret is not configured." }, 503);
  const providedSecret = req.headers.get("x-mathside-webhook-secret") || "";
  if (!constantTimeEqual(providedSecret, webhookSecret)) {
    return json({ error: "Unauthorized webhook request." }, 401);
  }
  if (!publicKey || !privateKey) return json({ error: "VAPID secrets are not configured." }, 503);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let payload: any;
  try { payload = await limitedJson(req); }
  catch { return json({ error: "Invalid JSON or oversized request." }, 400); }

  // Only Supabase INSERT events for actual stored notifications are accepted.
  // Never trust a caller-supplied user_id, title, or message body.
  if (payload?.type !== "INSERT" || payload?.table !== "mathside_notifications" ||
      (payload?.schema && payload.schema !== "public")) {
    return json({ ok: true, ignored: true });
  }
  const notificationId = String(payload?.record?.id || "");
  if (!UUID_RE.test(notificationId)) return json({ error: "Invalid notification ID." }, 400);

  const { data: note, error: notificationError } = await admin
    .from("mathside_notifications")
    .select("id,user_id,title,body,type,related_assignment_id,related_submission_id")
    .eq("id", notificationId).maybeSingle();
  if (notificationError) {
    console.error("Push notification lookup failed", notificationError.message);
    return json({ error: "Unable to verify notification." }, 500);
  }
  if (!note || !UUID_RE.test(String(note.user_id || ""))) {
    return json({ ok: true, ignored: true });
  }
  const userId = note.user_id;

  const { data: subscriptions, error } = await admin
    .from("mathside_push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (error) {
    console.error("Push subscription lookup failed", error.message);
    return json({ error: "Unable to load registered push devices." }, 500);
  }
  if (!subscriptions?.length) return json({ ok: true, delivered: 0 });

  webpush.setVapidDetails(vapidSubject, publicKey, privateKey);

  const body = JSON.stringify({
    title: note.title || "Mathside",
    body: note.body || "You have a new Mathside update.",
    tag: `mathside-${note.id || crypto.randomUUID()}`,
    notificationId: note.id || null,
    type: note.type || "update",
    relatedAssignmentId: note.related_assignment_id || null,
    relatedSubmissionId: note.related_submission_id || null,
    url: "./",
  });

  let delivered = 0;
  let removed = 0;

  await Promise.all(subscriptions.map(async (sub: any) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
        { TTL: 60 * 60 * 24, urgency: "high" },
      );
      delivered += 1;
    } catch (sendError: any) {
      const statusCode = Number(sendError?.statusCode || sendError?.status || 0);
      console.error("Web Push delivery failed", statusCode, sendError?.message || sendError);
      if (statusCode === 404 || statusCode === 410) {
        await admin.from("mathside_push_subscriptions").delete().eq("id", sub.id);
        removed += 1;
      }
    }
  }));

  return json({ ok: true, delivered, removed });
});
