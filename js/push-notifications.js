/* Mathside PWA Push Notifications — v6.12 Android repair
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
  let registrationFailure = null;
  let vapidCache = null;
  let lastFailedStage = null;
  let lastError = null;
  const SW_TIMEOUT_MS = 14000;

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

  function errorWithStage(stage, error) {
    const wrapped = error instanceof Error ? error : new Error(String(error || stage));
    wrapped.mathsideStage = stage;
    return wrapped;
  }

  function timeout(promise, ms, label) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(errorWithStage('service-worker', new Error(`${label} timed out.`))), ms);
      })
    ]).finally(() => clearTimeout(timer));
  }

  async function getRegistration({ refresh = false } = {}) {
    if (!window.isSecureContext) throw errorWithStage('secure-context', new Error('Mathside must be opened over HTTPS to receive push alerts.'));
    if (!supported()) throw errorWithStage('compatibility', new Error('This browser does not support Web Push. Open Mathside in Chrome or another Web Push-capable browser.'));
    const reg = await timeout(navigator.serviceWorker.ready, SW_TIMEOUT_MS, 'Mathside service worker');
    if (refresh) {
      try { await timeout(reg.update(), SW_TIMEOUT_MS, 'Service worker update'); }
      catch (error) { console.warn('Mathside service worker update check failed:', error); }
    }
    if (!reg.active) throw errorWithStage('service-worker', new Error('Mathside service worker has not activated. Reload the app and retry.'));
    return reg;
  }

  async function fetchVapidPublicKey() {
    if (vapidCache) return vapidCache;
    if (typeof db === 'undefined' || !db) throw errorWithStage('configuration', new Error('Mathside is not connected to Supabase.'));
    const { data, error } = await db.functions.invoke(FUNCTION_NAME, { method: 'GET' });
    if (error) throw errorWithStage('configuration', error);
    const key = String(data?.publicKey || '').trim();
    if (!key) throw errorWithStage('configuration', new Error('Push notifications are not configured. Add valid VAPID secrets in Supabase.'));
    let raw;
    try { raw = base64ToUint8Array(key); }
    catch (error) { throw errorWithStage('configuration', new Error('Invalid VAPID public key encoding.')); }
    if (raw.length !== 65 || raw[0] !== 4) {
      throw errorWithStage('configuration', new Error('The public push key is invalid. Contact the Mathside administrator.'));
    }
    vapidCache = raw;
    return raw;
  }

  function keysMatch(subscription, key) {
    const existing = subscription?.options?.applicationServerKey;
    if (!existing) return true; // Older browsers may not expose the key.
    const a = new Uint8Array(existing);
    return a.length === key.length && a.every((value, i) => value === key[i]);
  }

  async function removeStaleSubscription(subscription) {
    if (!subscription) return;
    // Remove only this device's obsolete endpoint. Never delete user notifications.
    if (typeof db !== 'undefined' && db) {
      const { error } = await db.rpc('mathside_remove_push_subscription', { p_endpoint: subscription.endpoint });
      if (error) console.warn('Mathside old endpoint cleanup failed:', error.message);
    }
    const ok = await subscription.unsubscribe();
    if (!ok) throw errorWithStage('stale-subscription', new Error('Chrome could not replace the old push subscription.'));
    localStorage.removeItem(PUSH_SYNC_KEY);
  }

  function describeFailure(error, stage) {
    const message = String(error?.message || error || '').trim();
    const name = String(error?.name || 'Error');
    if (stage === 'push-service' && /push service|registration failed|aborterror|network/i.test(`${name} ${message}`)) {
      return 'Your Android browser could not register with its push provider. Mathside reached this step correctly. You can try Repair and retry; if it still fails, try Mathside in Firefox for Android to test a different push provider.';
    }
    if (stage === 'permission') return 'Notifications are blocked or were not allowed. Enable them for Chrome and Mathside in Android settings.';
    if (stage === 'service-worker') return 'Mathside could not activate its background service worker. Reload Mathside online and try again.';
    if (stage === 'secure-context') return 'Open Mathside through its secure HTTPS address.';
    if (stage === 'configuration') return message || 'Mathside notification configuration is unavailable.';
    if (stage === 'database') return 'Your phone registered, but Mathside could not save its subscription. Sign in again and retry.';
    if (stage === 'stale-subscription') return 'Chrome has an old device registration that needs repair.';
    return message || 'Mathside could not activate notifications.';
  }

  function failureDiagnostic(error, stage) {
    return {
      stage,
      errorName: String(error?.name || 'Error'),
      errorMessage: String(error?.message || error || '').slice(0, 400),
      permission: supported() ? Notification.permission : 'unsupported',
      standalone: isStandalone(),
      secureContext: Boolean(window.isSecureContext),
      activeServiceWorker: Boolean(navigator.serviceWorker?.controller),
      browser: navigator.userAgent.slice(0, 200),
      checkedAt: new Date().toISOString()
    };
  }

  function showFailureDialog(error, stage) {
    lastFailedStage = stage;
    lastError = error;
    registrationFailure = failureDiagnostic(error, stage);
    let dlg = document.getElementById('mathsidePushRepairDialog');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'mathsidePushRepairDialog';
      dlg.className = 'pwa-dialog mathside-push-dialog';
      dlg.innerHTML = `<div class="pwa-card mathside-push-card" style="max-width:460px;text-align:left">
        <div class="pwa-card-eyebrow">MATHSIDE · APP ALERTS</div>
        <h2 style="margin:10px 0">Phone registration failed</h2>
        <p id="mathsidePushRepairExplanation" style="line-height:1.55"></p>
        <div class="mathside-push-note">This does not affect your grades, classes, submissions, or notifications in Mathside. A phone popup test checks local notification permission; it is not a push delivery test.</div>
        <p id="mathsidePushRepairStage" style="margin:8px 0;font-size:12px;color:#775b4c"></p>
        <div class="pwa-card-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
          <button type="button" class="pwa-btn pwa-btn-light" id="mathsidePushLocalTest">Test phone popup</button>
          <button type="button" class="pwa-btn pwa-btn-light" id="mathsidePushCopyError">Copy error</button>
          <button type="button" class="pwa-btn pwa-btn-orange" id="mathsidePushRepairButton">Repair and retry</button>
          <button type="button" class="pwa-btn pwa-btn-light" id="mathsidePushRepairClose">Close</button>
        </div>
      </div>`;
      document.body.appendChild(dlg);
      dlg.querySelector('#mathsidePushRepairClose').addEventListener('click', () => dlg.close());
      dlg.querySelector('#mathsidePushCopyError').addEventListener('click', async () => {
        const detail = JSON.stringify(registrationFailure || {}, null, 2);
        try { await navigator.clipboard.writeText(detail); if (typeof toast === 'function') toast('Error details copied.', 'success'); }
        catch (_) { window.prompt('Copy these details:', detail); }
      });
      dlg.querySelector('#mathsidePushLocalTest').addEventListener('click', async () => {
        try {
          if (Notification.permission !== 'granted') throw new Error('Notifications are not allowed on this phone.');
          const reg = await getRegistration();
          await reg.showNotification('Mathside notification test', {
            body: 'Your phone can display local Mathside alerts. This is not a push service delivery test.',
            icon: './icons/icon-192.png', tag: 'mathside-local-test'
          });
          if (typeof toast === 'function') toast('Phone popup test sent. Check your notifications.', 'success');
        } catch (err) { if (typeof toast === 'function') toast(String(err?.message || err), 'orange'); }
      });
      dlg.querySelector('#mathsidePushRepairButton').addEventListener('click', async () => {
        const button = dlg.querySelector('#mathsidePushRepairButton');
        if (button.disabled) return;
        button.disabled = true; button.textContent = 'Repairing…';
        try {
          const reg = await getRegistration({ refresh: true });
          const key = await fetchVapidPublicKey();
          const existing = await reg.pushManager.getSubscription();
          if (existing && !keysMatch(existing, key)) await removeStaleSubscription(existing);
          dlg.close();
          await enable({ repair: true });
        } catch (err) { showFailureDialog(err, err.mathsideStage || 'service-worker'); }
        finally { button.disabled = false; button.textContent = 'Repair and retry'; }
      });
    }
    dlg.querySelector('#mathsidePushRepairExplanation').textContent = describeFailure(error, stage);
    dlg.querySelector('#mathsidePushRepairStage').textContent = `Failed at: ${stage}. ${error?.name || 'Error'}: ${String(error?.message || '').slice(0, 150)}`;
    const prompt = document.getElementById('mathsidePushPrompt');
    if (prompt?.open) prompt.close();
    if (!dlg.open && typeof dlg.showModal === 'function') dlg.showModal();
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

    const syncValue = localStorage.getItem(PUSH_SYNC_KEY) || '';
    const [syncUserId, syncTime] = syncValue.split(':');
    const lastSync = syncUserId === user.id ? Number(syncTime || 0) : 0;
    if (!force && lastSync && Date.now() - lastSync < PUSH_SYNC_TTL_MS) {
      updateUi();
      return true;
    }
    if (pushSyncPromise) return pushSyncPromise;

    pushSyncPromise = (async () => {
      await saveSubscription(subscription);
      localStorage.setItem(PUSH_SYNC_KEY, `${user.id}:${Date.now()}`);
      updateUi();
      return true;
    })();

    try {
      return await pushSyncPromise;
    } finally {
      pushSyncPromise = null;
    }
  }

  async function enable({ quiet = false, repair = false } = {}) {
    if (busy) return false;
    busy = true;
    let stage = 'compatibility';
    updateUi();
    try {
      if (!supported()) throw errorWithStage(stage, new Error('This browser does not support Web Push.'));
      if (!window.isSecureContext) throw errorWithStage('secure-context', new Error('Mathside requires HTTPS.'));
      // Request permission before any network call while the user's tap is still active.
      stage = 'permission';
      let permission = Notification.permission;
      if (permission === 'default') permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        if (permission === 'denied') throw errorWithStage(stage, new Error('Notifications were blocked.'));
        return false;
      }
      stage = 'account';
      const user = await currentUser();
      if (!user) throw errorWithStage(stage, new Error('Sign in before enabling app notifications.'));
      stage = 'service-worker';
      const registration = await getRegistration({ refresh: repair });
      stage = 'configuration';
      const key = await fetchVapidPublicKey();
      stage = 'push-service';
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !keysMatch(subscription, key)) {
        stage = 'stale-subscription';
        await removeStaleSubscription(subscription);
        subscription = null;
      }
      if (!subscription) {
        stage = 'push-service';
        // Only subscribe following an explicit user tap (or the optional repair tap).
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key
        });
      }
      stage = 'database';
      await saveSubscription(subscription);
      localStorage.setItem(PUSH_SYNC_KEY, `${user.id}:${Date.now()}`);
      localStorage.removeItem(PROMPT_KEY);
      registrationFailure = null;
      if (!quiet && typeof toast === 'function') toast('App alerts enabled on this device.', 'success', 'Notifications enabled');
      updateUi();
      return true;
    } catch (error) {
      stage = error?.mathsideStage || stage;
      console.warn('Mathside notification registration failed:', stage, error?.name, error?.message);
      if (!quiet) showFailureDialog(error, stage);
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
      try {
        const info = await status();
        if (info.enabled) await disable();
        else await enable();
      } catch (error) { showFailureDialog(error, error.mathsideStage || 'service-worker'); }
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
    maybeOfferPush,
    getDiagnostic: () => registrationFailure
  };
})();
