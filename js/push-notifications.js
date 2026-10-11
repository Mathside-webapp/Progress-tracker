/* Mathside PWA Push Notifications — v6.11.1 (Android registration diagnostics)
   - Works only for authenticated users.
   - Uses the installed PWA service worker + Web Push.
   - VAPID public key is fetched securely from the authenticated Edge Function.
*/
(() => {
  'use strict';

  const FUNCTION_NAME = 'send-push-notification';
  const PROMPT_KEY = 'mathside_push_prompt_dismissed_v1';
  const PUSH_SYNC_KEY = 'mathside_push_last_sync_v1';
  const PUSH_SYNC_TTL_MS = 6 * 60 * 60 * 1000;
  let pushSyncPromise = null;
  let busy = false;
  let promptTimer = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const supported = () =>
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  // Only teachers can offer/manage browser push from the interface. Students
  // retain their normal in-app notification bell (mathside_notifications).
  const isTeacherAccount = () =>
    typeof state !== 'undefined' && state?.profile?.role === 'teacher';

  const currentUser = async () => {
    if (typeof db === 'undefined' || !db) return null;
    // This helper only needs the locally persisted session to decide whether the
    // UI should sync a push subscription. Authorization remains enforced by the
    // authenticated RPC itself, so avoid an extra Auth network request here.
    const { data } = await db.auth.getSession();
    return data?.session?.user || null;
  };

  const base64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
  };

  async function getRegistration() {
    if (!supported()) throw new Error('Push notifications are not supported on this browser.');
    return navigator.serviceWorker.ready;
  }

  async function fetchVapidPublicKey() {
    if (typeof db === 'undefined' || !db) throw new Error('Mathside is not connected to Supabase.');
    const { data, error } = await db.functions.invoke(FUNCTION_NAME, { method: 'GET' });
    if (error) throw error;
    const key = String(data?.publicKey || '').trim();
    if (!key) throw new Error('Push notifications are not configured yet. Add the VAPID secrets to Supabase.');
    return key;
  }

  async function saveSubscription(subscription) {
    const user = await currentUser();
    if (!user) throw new Error('Sign in before enabling app notifications.');
    const json = subscription.toJSON();
    const endpoint = String(json.endpoint || subscription.endpoint || '');
    const p256dh = String(json.keys?.p256dh || '');
    const auth = String(json.keys?.auth || '');
    if (!endpoint || !p256dh || !auth) throw new Error('The browser returned an incomplete push subscription.');

    const { error } = await db.rpc('mathside_register_push_subscription', {
      p_endpoint: endpoint,
      p_p256dh: p256dh,
      p_auth: auth,
      p_user_agent: navigator.userAgent || null,
      p_platform: navigator.platform || null
    });
    if (error) throw error;
  }

  async function syncExistingSubscription({ force = false } = {}) {
    // Don't re-register background push for student accounts.
    if (!isTeacherAccount() || !supported() || Notification.permission !== 'granted') return false;
    const user = await currentUser();
    if (!user) return false;
    const registration = await getRegistration();
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return false;

    const lastSync = Number(localStorage.getItem(PUSH_SYNC_KEY) || 0);
    if (!force && lastSync && Date.now() - lastSync < PUSH_SYNC_TTL_MS) {
      updateUi();
      return true;
    }
    if (pushSyncPromise) return pushSyncPromise;

    pushSyncPromise = (async () => {
      await saveSubscription(subscription);
      localStorage.setItem(PUSH_SYNC_KEY, String(Date.now()));
      updateUi();
      return true;
    })();

    try {
      return await pushSyncPromise;
    } finally {
      pushSyncPromise = null;
    }
  }

  // V6.11.1 — Diagnose Web Push registration without exposing secrets or
  // deleting the website's stored data, service worker, or subscriptions.
  let latestDiagnostic = null;
  function explainPushFailure(error, stage) {
    const name = String(error?.name || 'Error');
    const message = String(error?.message || error || 'Unknown error');
    if (stage === 'push-service' && /push service|registration failed|aborterror|network/i.test(`${name} ${message}`)) {
      return 'Android could not connect to its push service. Mathside settings loaded, but Chrome/Google Play services did not create a subscription. Update Chrome and Google Play services, restart your phone, try a different network, and temporarily disable Private DNS or VPN filtering.';
    }
    if (stage === 'permission') return 'Phone notification permission was not granted. Allow notifications for Mathside in Android settings, then try again.';
    if (stage === 'service-worker') return 'Mathside could not activate its service worker. Open the website in Chrome while online, reload, then try again.';
    if (stage === 'vapid') return 'Mathside could not load its notification configuration. Check the internet connection and Supabase Edge Function.';
    if (stage === 'database') return 'The phone created a subscription, but Mathside could not save it. Sign in again and retry.';
    return message || 'Could not enable app notifications.';
  }

  function reportPushFailure(error, stage) {
    latestDiagnostic = {
      stage: stage || 'unknown',
      errorName: String(error?.name || 'Error'),
      errorMessage: String(error?.message || error || 'Unknown error').slice(0, 500),
      notificationPermission: supported() ? Notification.permission : 'unsupported',
      secureContext: Boolean(window.isSecureContext),
      standalone: isStandalone(),
      timestamp: new Date().toISOString(),
      browser: navigator.userAgent.slice(0, 240)
    };
    return explainPushFailure(error, stage);
  }

  function showPushHelp(message, stage) {
    let dialog = document.getElementById('mathsidePushDiagnostic');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'mathsidePushDiagnostic';
      dialog.className = 'pwa-dialog mathside-push-dialog';
      dialog.innerHTML = `
        <div class="pwa-card mathside-push-card" style="max-width:490px;text-align:left">
          <div class="pwa-card-eyebrow">MATHSIDE · NOTIFICATION CHECK</div>
          <h2 style="margin:9px 0 12px;font-size:25px">Phone alerts could not be enabled</h2>
          <p id="mathsidePushFailureText" style="line-height:1.5;margin-bottom:14px"></p>
          <div class="mathside-push-note" style="text-align:left">
            <b>On Android, try this:</b>
            <ol style="margin:9px 0 0;padding-left:20px;line-height:1.7">
              <li>Update <b>Chrome</b> and <b>Google Play services</b>; restart the phone.</li>
              <li>Allow notifications and unrestricted background/battery usage for Chrome and Google Play services.</li>
              <li>Turn off VPN, ad-blocking Private DNS, or network filters temporarily; try mobile data instead of Wi-Fi.</li>
              <li>Open Mathside in Chrome or its installed app and tap <b>Enable app alerts</b> again.</li>
            </ol>
          </div>
          <p id="mathsidePushFailureStage" style="font-size:11px;color:#8b5d44;margin-top:10px"></p>
          <div class="pwa-card-actions" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:15px">
            <button type="button" class="pwa-btn pwa-btn-light" id="mathsidePushCopyDiagnostic">Copy error details</button>
            <button type="button" class="pwa-btn pwa-btn-orange" id="mathsidePushDiagnosticClose">Close</button>
          </div>
        </div>`;
      document.body.appendChild(dialog);
      dialog.querySelector('#mathsidePushDiagnosticClose')?.addEventListener('click', () => dialog.close());
      dialog.querySelector('#mathsidePushCopyDiagnostic')?.addEventListener('click', async () => {
        const data = JSON.stringify(latestDiagnostic || { stage: 'unknown' }, null, 2);
        try {
          await navigator.clipboard.writeText(data);
          const btn = dialog.querySelector('#mathsidePushCopyDiagnostic');
          if (btn) btn.textContent = 'Copied — send to support';
        } catch (_) {
          const pre = document.createElement('textarea');
          pre.value = data; pre.setAttribute('readonly','');
          pre.style.cssText = 'width:100%;height:130px;margin-top:10px;font-size:11px;';
          dialog.querySelector('.pwa-card')?.appendChild(pre);
          pre.focus(); pre.select();
        }
      });
    }
    dialog.querySelector('#mathsidePushFailureText').textContent = message;
    dialog.querySelector('#mathsidePushFailureStage').textContent = `Failed at: ${stage}. Your Mathside data has not been changed.`;
    if (!dialog.open) {
      const prompt = document.getElementById('mathsidePushPrompt');
      if (prompt?.open) prompt.close();
      if (typeof dialog.showModal === 'function') dialog.showModal();
    }
  }

  async function enable({ quiet = false } = {}) {
    if (!isTeacherAccount() || busy) return false;
    busy = true;
    let stage = 'compatibility';
    updateUi();
    try {
      if (!supported()) throw new Error('This device/browser does not support Web Push.');
      if (!window.isSecureContext) throw new Error('Push notifications require an HTTPS connection.');
      const user = await currentUser();
      if (!user) throw new Error('Sign in before enabling app notifications.');

      stage = 'permission';
      let permission = Notification.permission;
      if (permission !== 'granted') permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        if (permission === 'denied') throw new Error('Notifications are blocked. Allow notifications for Mathside in your device/browser settings.');
        return false;
      }

      stage = 'service-worker';
      const registration = await getRegistration();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        stage = 'vapid';
        const publicKey = await fetchVapidPublicKey();
        stage = 'push-service';
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToUint8Array(publicKey)
        });
      }
      stage = 'database';
      await saveSubscription(subscription);
      latestDiagnostic = null;
      localStorage.setItem(PUSH_SYNC_KEY, String(Date.now()));
      localStorage.removeItem(PROMPT_KEY);
      if (!quiet && typeof toast === 'function') toast('App notifications are on. Mathside can alert you even when the installed app is closed.', 'success', 'Notifications enabled');
      updateUi();
      return true;
    } catch (error) {
      console.error('Mathside push enable failed at', stage, error);
      const guidance = reportPushFailure(error, stage);
      if (!quiet) showPushHelp(guidance, stage);
      updateUi();
      return false;
    } finally {
      busy = false;
      updateUi();
    }
  }

  async function unregisterForCurrentUser({ unsubscribe = true } = {}) {
    if (!supported() || typeof db === 'undefined' || !db) return;
    try {
      const registration = await getRegistration();
      const subscription = await registration.pushManager.getSubscription();
      const endpoint = subscription?.endpoint || null;
      if (endpoint) {
        await db.rpc('mathside_remove_push_subscription', { p_endpoint: endpoint });
        if (unsubscribe) await subscription.unsubscribe().catch(() => {});
      }
    } catch (error) {
      console.warn('Mathside push cleanup:', error);
    }
    localStorage.removeItem(PUSH_SYNC_KEY);
    updateUi();
  }

  async function disable() {
    if (busy) return;
    busy = true;
    updateUi();
    try {
      await unregisterForCurrentUser({ unsubscribe: true });
      localStorage.setItem(PROMPT_KEY, '1');
      localStorage.removeItem(PUSH_SYNC_KEY);
      if (typeof toast === 'function') toast('App notifications were turned off on this device.', 'success', 'Notifications off');
    } finally {
      busy = false;
      updateUi();
    }
  }

  async function status() {
    if (!supported()) return { supported: false, enabled: false, permission: 'unsupported' };
    const registration = await getRegistration();
    const subscription = await registration.pushManager.getSubscription();
    return {
      supported: true,
      enabled: Notification.permission === 'granted' && Boolean(subscription),
      permission: Notification.permission,
      standalone: isStandalone()
    };
  }

  async function updateUi() {
    const button = document.getElementById('v10PushNotificationBtn');
    if (!button) return;
    // Hide the action entirely for students, including when the notification
    // dialog was created before the account role had finished loading.
    if (!isTeacherAccount() || !supported()) {
      button.hidden = true;
      button.disabled = true;
      return;
    }
    try {
      const info = await status();
      // The user may have signed out while Web Push status was being checked.
      if (!isTeacherAccount()) {
        button.hidden = true;
        button.disabled = true;
        return;
      }
      button.hidden = false;
      button.disabled = busy;
      button.classList.toggle('push-enabled', info.enabled);
      button.textContent = busy ? 'Checking…' : (info.enabled ? 'App alerts on' : 'Enable app alerts');
      button.title = info.enabled ? 'Turn off push notifications on this device' : 'Receive Mathside notifications outside the app';
    } catch (_) {
      const teacher = isTeacherAccount();
      button.hidden = !teacher;
      button.disabled = !teacher || busy;
      button.textContent = 'Enable app alerts';
    }
  }

  function ensurePromptDialog() {
    if (document.getElementById('mathsidePushPrompt')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'mathsidePushPrompt';
    dialog.className = 'pwa-dialog mathside-push-dialog';
    dialog.innerHTML = `
      <div class="pwa-card mathside-push-card">
        <div class="pwa-card-icon" aria-hidden="true">🔔</div>
        <div class="pwa-card-eyebrow">MATHSIDE APP ALERTS</div>
        <h2>Get deadline and class notifications</h2>
        <p>Turn on notifications for new activities, performance tasks, teacher feedback, submissions, and configured deadline reminders—even when the installed app is closed.</p>
        <div class="mathside-push-note">You can turn these off anytime from the notification bell.</div>
        <div class="pwa-card-actions">
          <button type="button" class="pwa-btn pwa-btn-light" id="mathsidePushLaterBtn">Not now</button>
          <button type="button" class="pwa-btn pwa-btn-orange" id="mathsidePushEnableBtn">Turn on notifications</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);
    dialog.querySelector('#mathsidePushLaterBtn')?.addEventListener('click', () => {
      localStorage.setItem(PROMPT_KEY, '1');
      dialog.close();
    });
    dialog.querySelector('#mathsidePushEnableBtn')?.addEventListener('click', async () => {
      const ok = await enable();
      if (ok) dialog.close();
    });
  }

  async function maybeOfferPush() {
    clearTimeout(promptTimer);
    if (!isTeacherAccount()) {
      const dialog = document.getElementById('mathsidePushPrompt');
      if (dialog?.open) dialog.close();
      return;
    }
    promptTimer = setTimeout(async () => {
      try {
        if (!isTeacherAccount() || !isStandalone() || !supported() || Notification.permission === 'denied') return;
        if (localStorage.getItem(PROMPT_KEY) === '1') return;
        const user = await currentUser();
        if (!user) return;
        const info = await status();
        if (info.enabled) {
          await syncExistingSubscription().catch(() => {});
          return;
        }
        ensurePromptDialog();
        const dialog = document.getElementById('mathsidePushPrompt');
        if (dialog && !dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
      } catch (error) {
        console.warn('Mathside push prompt:', error);
      }
    }, 1400);
  }

  async function handlePushOpen(detail = {}) {
    const notificationId = String(detail.notificationId || '');
    try {
      if (notificationId && typeof db !== 'undefined' && db) {
        await db.rpc('mathside_mark_notifications_read', { p_ids: [notificationId] });
      }
      await window.MathsideV10?.refreshNotifications?.();
      if (detail.type === 'feedback' && typeof showStudentPanel === 'function' && state?.profile?.role === 'student') {
        showStudentPanel('feedback');
      } else if (detail.relatedAssignmentId && state?.profile?.role === 'student') {
        showStudentPanel('todo');
      } else if (state?.profile?.role === 'teacher' && typeof showTeacherView === 'function') {
        showTeacherView('submissions');
      }
    } catch (error) {
      console.warn('Mathside push deep link:', error);
    }
  }

  function consumePushQuery() {
    const url = new URL(location.href);
    const notificationId = url.searchParams.get('push_notification');
    if (!notificationId) return;
    const detail = {
      notificationId,
      type: url.searchParams.get('push_type') || '',
      relatedAssignmentId: url.searchParams.get('assignment') || ''
    };
    url.searchParams.delete('push_notification');
    url.searchParams.delete('push_type');
    url.searchParams.delete('assignment');
    history.replaceState({}, '', url.pathname + (url.search ? url.search : '') + url.hash);
    setTimeout(() => handlePushOpen(detail), 1800);
  }

  function bindNotificationButton() {
    const button = document.getElementById('v10PushNotificationBtn');
    if (!button || button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    button.addEventListener('click', async () => {
      if (!isTeacherAccount()) return;
      const info = await status();
      if (info.enabled) await disable();
      else await enable();
    });
    updateUi();
  }

  function injectStyles() {
    if (document.getElementById('mathsidePushStyles')) return;
    const style = document.createElement('style');
    style.id = 'mathsidePushStyles';
    style.textContent = `
      .v10-notification-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
      #v10PushNotificationBtn[hidden]{display:none!important}
      #v10PushNotificationBtn{border-color:#ffb47b!important;color:#c94f00!important;background:#fff6ef!important}
      #v10PushNotificationBtn.push-enabled{background:#ff6500!important;border-color:#ff6500!important;color:#fff!important}
      .mathside-push-note{margin-top:14px;padding:11px 12px;border-radius:13px;background:#fff7ef;color:#6e4b34;font-size:12px;line-height:1.45;border:1px solid #ffe0c8}
      @media(max-width:620px){.v10-notification-title{align-items:flex-start!important}.v10-notification-actions{width:100%;justify-content:flex-start}.v10-notification-actions .btn{font-size:11px!important;padding:8px 10px!important}}
    `;
    document.head.appendChild(style);
  }

  const observer = new MutationObserver(() => bindNotificationButton());
  window.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    ensurePromptDialog();
    observer.observe(document.body, { childList: true, subtree: true });
    bindNotificationButton();
    consumePushQuery();
  });

  window.addEventListener('appinstalled', () => maybeOfferPush());
  window.addEventListener('focus', () => {
    updateUi();
    if (Notification.permission === 'granted') syncExistingSubscription().catch(() => {});
  });
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'MATHSIDE_PUSH_OPEN') handlePushOpen(event.data);
  });

  if (typeof db !== 'undefined' && db) {
    db.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        setTimeout(() => {
          syncExistingSubscription().catch(() => {});
          maybeOfferPush();
          updateUi();
        }, 1000);
      }
      if (event === 'SIGNED_OUT') updateUi();
    });
  }

  window.MathsidePush = {
    enable,
    disable,
    status,
    syncExistingSubscription,
    updateUi,
    unregisterForCurrentUser,
    maybeOfferPush,
    lastDiagnostic: () => latestDiagnostic
  };
})();
