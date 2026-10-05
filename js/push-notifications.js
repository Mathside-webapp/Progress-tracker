/* Mathside PWA Push Notifications — Step 6.9
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
    if (!supported() || Notification.permission !== 'granted') return false;
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

  async function enable({ quiet = false } = {}) {
    if (busy) return false;
    busy = true;
    updateUi();
    try {
      if (!supported()) throw new Error('This device/browser does not support Web Push.');
      const user = await currentUser();
      if (!user) throw new Error('Sign in before enabling app notifications.');

      let permission = Notification.permission;
      if (permission !== 'granted') permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        if (permission === 'denied') throw new Error('Notifications are blocked. Allow notifications for Mathside in your device/browser settings.');
        return false;
      }

      const registration = await getRegistration();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        const publicKey = await fetchVapidPublicKey();
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToUint8Array(publicKey)
        });
      }
      await saveSubscription(subscription);
      localStorage.setItem(PUSH_SYNC_KEY, String(Date.now()));
      localStorage.removeItem(PROMPT_KEY);
      if (!quiet && typeof toast === 'function') toast('App notifications are on. Mathside can alert you even when the installed app is closed.', 'success', 'Notifications enabled');
      updateUi();
      return true;
    } catch (error) {
      console.error('Mathside push enable failed:', error);
      if (!quiet && typeof toast === 'function') toast(friendlyErrorMessage(error, 'Could not enable app notifications.'), 'orange', 'Notifications');
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
    if (!supported()) {
      button.hidden = true;
      return;
    }
    try {
      const info = await status();
      button.hidden = false;
      button.disabled = busy;
      button.classList.toggle('push-enabled', info.enabled);
      button.textContent = busy ? 'Checking…' : (info.enabled ? 'App alerts on' : 'Enable app alerts');
      button.title = info.enabled ? 'Turn off push notifications on this device' : 'Receive Mathside notifications outside the app';
    } catch (_) {
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
    promptTimer = setTimeout(async () => {
      try {
        if (!isStandalone() || !supported() || Notification.permission === 'denied') return;
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
    unregisterForCurrentUser,
    maybeOfferPush
  };
})();
