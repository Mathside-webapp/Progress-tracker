/* Mathside PWA — V24.10 Separate Performance Task Class Record
   GitHub Pages + localhost friendly.
   Provides app-shell caching, a graceful offline fallback, and controlled updates. */

// Previous deployment cache: mathside-pwa-v46-create-class-theme.
const CACHE_NAME = 'mathside-pwa-v47-dashboard-mobile-fixes';
const CACHE_PREFIX = 'mathside-pwa-';

const APP_SHELL = [
  './css/teacher-mobile-fixes-v47.css?v=47.0',
  './css/teacher-create-theme-v46.css?v=46.0',
  './js/teacher-create-theme-v46.js?v=46.0',
  './js/app.js?v=46.0-class-theme-creation',
  './js/v12-archive-features.js?v=46.0-class-theme-creation',
  './css/teacher-art-v44.css?v=44.0',
  './js/teacher-class-designs-v44.js?v=45.0',
  './assets/teacher-art-v44/activities.png',
  './assets/teacher-art-v44/class-01.png',
  './assets/teacher-art-v44/class-02.png',
  './assets/teacher-art-v44/class-03.png',
  './assets/teacher-art-v44/class-04.png',
  './assets/teacher-art-v44/class-05.png',
  './assets/teacher-art-v44/class-06.png',
  './assets/teacher-art-v44/class-07.png',
  './assets/teacher-art-v44/class-08.png',
  './assets/teacher-art-v44/class-09.png',
  './assets/teacher-art-v44/class-10.png',
  './assets/teacher-art-v44/classes.png',
  './assets/teacher-art-v44/dashboard.png',
  './assets/teacher-art-v44/records.png',
  './assets/teacher-art-v44/submissions.png',

  './css/teacher-archive-v43.css?v=43.0',
  './assets/teacher-archive-v43/archive-header.png',
  './css/teacher-competencies-v42.css?v=42.0',
  './assets/teacher-competencies-v42/competencies-header.png',
  './css/teacher-records-v41.css?v=41.0',
  './assets/teacher-records-v41/class-record-header.png',
  './css/teacher-submissions-v39.css?v=39.0',
  './js/teacher-submissions-v39.js?v=39.0',
  './assets/teacher-submissions-v39/submissions-header.png',
  './',
  './index.html',
  './css/teacher-pixelmatch-v27.css?v=27.2',
  './css/teacher-fixed-sidebar-v28.css?v=28.0',
  './css/teacher-compact-v29.css?v=29.0',
  './css/teacher-live-submissions-v30.css?v=30.0',
  './css/teacher-hero-waves-v31.css?v=31.0',
  './css/teacher-classes-design-a-v32.css?v=32.0',
  './css/teacher-approved-headers-v33.css?v=33.0',
  './css/teacher-banner-refinements-v34.css?v=34.0',
  './css/teacher-activities-design-b-v35.css?v=35.0',
  './js/teacher-activities-design-b-v35.js?v=40.0',
  './assets/teacher-activities-v35/activities-header-hd.png',
  './assets/teacher-headers-v36/dashboard-crisp.png',
  './assets/teacher-headers-v36/classes-crisp.png',
  './assets/teacher-headers-v36/activities-crisp.png',
  './css/teacher-v36-polish.css?v=36.0',
  './css/teacher-performance-design-b-v37.css?v=37.0',
  './assets/teacher-performance-v37/performance-header.png',
  './js/v15-performance-tasks.js?v=44.0',
  './assets/teacher-section-headers-v34/01-dashboard-hd.png',
  './assets/teacher-section-headers-v34/02-classes-hd.png',
  './assets/teacher-section-headers-v33/01-dashboard.png',
  './assets/teacher-section-headers-v33/02-classes.png',
  './assets/teacher-section-headers-v33/02-classes-header-objects.png',
  './js/teacher-classes-design-a-v32.js?v=44.0',
  './assets/teacher-classes-v32/classes-header-art.png',
  './assets/teacher-classes-v32/class-roster-empty.png',
  './assets/teacher-classes-v32/class-yellow.png',
  './assets/teacher-classes-v32/class-rose.png',
  './assets/teacher-classes-v32/class-blue-math.png',
  './assets/teacher-classes-v32/class-green-math.png',
  './assets/teacher-classes-v32/class-purple-math.png',
  './assets/teacher-pixelmatch/mathside-sidebar-waves-v31.png',
  './assets/teacher-pixelmatch/mathside-hero-desk-fitted-v31.png',
  './js/teacher-live-submissions-v30.js?v=39.0',
  './js/teacher-pixelmatch-v27.js?v=44.0',
  './assets/teacher-pixelmatch/mathside-hero-desk-original.png',
  './assets/teacher-pixelmatch/class-orange.png',
  './assets/teacher-pixelmatch/class-green.png',
  './assets/teacher-pixelmatch/class-blue.png',
  './assets/teacher-pixelmatch/class-purple.png',
  './assets/teacher-pixelmatch/icons/charcoal/01-dashboard.png',
  './assets/teacher-pixelmatch/icons/charcoal/02-classes.png',
  './assets/teacher-pixelmatch/icons/charcoal/03-activities.png',
  './assets/teacher-pixelmatch/icons/charcoal/04-performance-tasks.png',
  './assets/teacher-pixelmatch/icons/charcoal/05-submissions.png',
  './assets/teacher-pixelmatch/icons/charcoal/06-class-records.png',
  './assets/teacher-pixelmatch/icons/charcoal/07-competencies.png',
  './assets/teacher-pixelmatch/icons/charcoal/08-archive.png',
  './assets/teacher-pixelmatch/icons/charcoal/09-notifications.png',
  './assets/teacher-pixelmatch/icons/charcoal/10-settings.png',
  './assets/teacher-pixelmatch/icons/charcoal/alert.png',
  './assets/teacher-pixelmatch/icons/charcoal/arrow-right.png',
  './assets/teacher-pixelmatch/icons/charcoal/award.png',
  './assets/teacher-pixelmatch/icons/charcoal/book.png',
  './assets/teacher-pixelmatch/icons/charcoal/calendar.png',
  './assets/teacher-pixelmatch/icons/charcoal/chart.png',
  './assets/teacher-pixelmatch/icons/charcoal/check.png',
  './assets/teacher-pixelmatch/icons/charcoal/chevron.png',
  './assets/teacher-pixelmatch/icons/charcoal/ellipsis.png',
  './assets/teacher-pixelmatch/icons/charcoal/file.png',
  './assets/teacher-pixelmatch/icons/charcoal/grad.png',
  './assets/teacher-pixelmatch/icons/charcoal/logout.png',
  './assets/teacher-pixelmatch/icons/charcoal/menu.png',
  './assets/teacher-pixelmatch/icons/charcoal/plus.png',
  './assets/teacher-pixelmatch/icons/charcoal/refresh.png',
  './assets/teacher-pixelmatch/icons/charcoal/search.png',
  './assets/teacher-pixelmatch/icons/gray/alert.png',
  './assets/teacher-pixelmatch/icons/gray/arrow-right.png',
  './assets/teacher-pixelmatch/icons/gray/award.png',
  './assets/teacher-pixelmatch/icons/gray/book.png',
  './assets/teacher-pixelmatch/icons/gray/calendar.png',
  './assets/teacher-pixelmatch/icons/gray/chart.png',
  './assets/teacher-pixelmatch/icons/gray/check.png',
  './assets/teacher-pixelmatch/icons/gray/chevron.png',
  './assets/teacher-pixelmatch/icons/gray/ellipsis.png',
  './assets/teacher-pixelmatch/icons/gray/file.png',
  './assets/teacher-pixelmatch/icons/gray/grad.png',
  './assets/teacher-pixelmatch/icons/gray/logout.png',
  './assets/teacher-pixelmatch/icons/gray/menu.png',
  './assets/teacher-pixelmatch/icons/gray/plus.png',
  './assets/teacher-pixelmatch/icons/gray/refresh.png',
  './assets/teacher-pixelmatch/icons/gray/search.png',
  './assets/teacher-pixelmatch/icons/green/alert.png',
  './assets/teacher-pixelmatch/icons/green/arrow-right.png',
  './assets/teacher-pixelmatch/icons/green/award.png',
  './assets/teacher-pixelmatch/icons/green/book.png',
  './assets/teacher-pixelmatch/icons/green/calendar.png',
  './assets/teacher-pixelmatch/icons/green/chart.png',
  './assets/teacher-pixelmatch/icons/green/check.png',
  './assets/teacher-pixelmatch/icons/green/chevron.png',
  './assets/teacher-pixelmatch/icons/green/ellipsis.png',
  './assets/teacher-pixelmatch/icons/green/file.png',
  './assets/teacher-pixelmatch/icons/green/grad.png',
  './assets/teacher-pixelmatch/icons/green/logout.png',
  './assets/teacher-pixelmatch/icons/green/menu.png',
  './assets/teacher-pixelmatch/icons/green/plus.png',
  './assets/teacher-pixelmatch/icons/green/refresh.png',
  './assets/teacher-pixelmatch/icons/green/search.png',
  './assets/teacher-pixelmatch/icons/orange/01-dashboard.png',
  './assets/teacher-pixelmatch/icons/orange/02-classes.png',
  './assets/teacher-pixelmatch/icons/orange/03-activities.png',
  './assets/teacher-pixelmatch/icons/orange/04-performance-tasks.png',
  './assets/teacher-pixelmatch/icons/orange/05-submissions.png',
  './assets/teacher-pixelmatch/icons/orange/06-class-records.png',
  './assets/teacher-pixelmatch/icons/orange/07-competencies.png',
  './assets/teacher-pixelmatch/icons/orange/08-archive.png',
  './assets/teacher-pixelmatch/icons/orange/09-notifications.png',
  './assets/teacher-pixelmatch/icons/orange/10-settings.png',
  './assets/teacher-pixelmatch/icons/orange/alert.png',
  './assets/teacher-pixelmatch/icons/orange/arrow-right.png',
  './assets/teacher-pixelmatch/icons/orange/award.png',
  './assets/teacher-pixelmatch/icons/orange/book.png',
  './assets/teacher-pixelmatch/icons/orange/calendar.png',
  './assets/teacher-pixelmatch/icons/orange/chart.png',
  './assets/teacher-pixelmatch/icons/orange/check.png',
  './assets/teacher-pixelmatch/icons/orange/chevron.png',
  './assets/teacher-pixelmatch/icons/orange/ellipsis.png',
  './assets/teacher-pixelmatch/icons/orange/file.png',
  './assets/teacher-pixelmatch/icons/orange/grad.png',
  './assets/teacher-pixelmatch/icons/orange/logout.png',
  './assets/teacher-pixelmatch/icons/orange/menu.png',
  './assets/teacher-pixelmatch/icons/orange/plus.png',
  './assets/teacher-pixelmatch/icons/orange/refresh.png',
  './assets/teacher-pixelmatch/icons/orange/search.png',
  './assets/teacher-pixelmatch/icons/white/01-dashboard.png',
  './assets/teacher-pixelmatch/icons/white/02-classes.png',
  './assets/teacher-pixelmatch/icons/white/03-activities.png',
  './assets/teacher-pixelmatch/icons/white/04-performance-tasks.png',
  './assets/teacher-pixelmatch/icons/white/05-submissions.png',
  './assets/teacher-pixelmatch/icons/white/06-class-records.png',
  './assets/teacher-pixelmatch/icons/white/07-competencies.png',
  './assets/teacher-pixelmatch/icons/white/08-archive.png',
  './assets/teacher-pixelmatch/icons/white/09-notifications.png',
  './assets/teacher-pixelmatch/icons/white/10-settings.png',
  './assets/teacher-pixelmatch/icons/white/alert.png',
  './assets/teacher-pixelmatch/icons/white/arrow-right.png',
  './assets/teacher-pixelmatch/icons/white/award.png',
  './assets/teacher-pixelmatch/icons/white/book.png',
  './assets/teacher-pixelmatch/icons/white/calendar.png',
  './assets/teacher-pixelmatch/icons/white/chart.png',
  './assets/teacher-pixelmatch/icons/white/check.png',
  './assets/teacher-pixelmatch/icons/white/chevron.png',
  './assets/teacher-pixelmatch/icons/white/ellipsis.png',
  './assets/teacher-pixelmatch/icons/white/file.png',
  './assets/teacher-pixelmatch/icons/white/grad.png',
  './assets/teacher-pixelmatch/icons/white/logout.png',
  './assets/teacher-pixelmatch/icons/white/menu.png',
  './assets/teacher-pixelmatch/icons/white/plus.png',
  './assets/teacher-pixelmatch/icons/white/refresh.png',
  './assets/teacher-pixelmatch/icons/white/search.png',
  './assets/teacher-pixelmatch/mathside-logo-white.png',
  './assets/teacher-pixelmatch/mathside-reminder-calendar.png',
  './assets/teacher-pixelmatch/preview-teacher-avatar.png',
  './css/teacher-dashboard-orange-v26.css?v=26.1',
  './js/teacher-dashboard-orange-v26.js?v=26.1',
  './assets/teacher-dashboard/mathside-math-hero.png',
  './assets/teacher-dashboard/teacher-productivity.png',
  './css/friendly-editors.css?v=2',
  './css/orange-create-panels.css?v=22-github-update',
  './css/panel-identities.css?v=22-github-update',
  './assets/panel-identity/classes.svg',
  './assets/panel-identity/activities.svg',
  './assets/panel-identity/performance.svg',
  './assets/panel-identity/submissions.svg',
  './assets/panel-identity/archive.svg',
  './js/orange-exact-forms.js?v=3',
  './assets/orange-exact/class-hero.png?v=22-header-art',
  './assets/orange-exact/assignment-hero.png',
  './assets/orange-exact/performance-hero.png',
  './js/friendly-editors.js?v=1',
  './offline.html',
  './manifest.webmanifest',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './assets/mathside-icon.svg?v=12.3',
  './assets/mathside-maintenance.png',
  './css/styles.css?v=22-github-update',
  './css/art-theme.css?v=7.0',
  './css/student-v8.css?v=10.7-student-history',
  './css/design-v9.css?v=9.1',
  './css/v10-features.css?v=11.5',
  './css/competency-tracker.css?v=16.0-add-competency',
  './js/competency-tracker.js?v=42.0-teacher-competencies',
  './css/competency-dashboard-polish.css?v=16',
  './css/mobile-header-safety.css?v=19.0',
  './css/student-v20-refresh.css?v=20.0',
  './css/student-v22-dashboard.css?v=22.2',
  './css/student-zigzag-v24.35.css?v=24.35-student-journey',
  './css/student-cleared-v24.37.css?v=24.39-todo-cleared',
  './assets/panel-identity/competencies.svg',
  './assets/panel-identity/classes-study.svg',
  './assets/panel-identity/dashboard-workspace.svg',
  './assets/panel-identity/performance-project.svg',
  './assets/panel-identity/archive-records.svg',
  './js/config.js',
  './js/question-tools.js?v=1.2-per-question-choice-order',
  './css/mathside-question-tools.css?v=1.3-activity-ux',
  './css/teacher-classic-refinement.css?v=24.28-teacher-compact',
  './css/teacher-preview-alignment.css?v=24.29',
  './css/teacher-all-panels-v24.30.css?v=24.30',
  './css/teacher-preview-match-v24.31.css?v=24.31',
  './js/teacher-preview-match-v24.31.js?v=41.0',
  './css/teacher-preview-fixes-v24.32.css?v=24.32',
  './js/teacher-preview-fixes-v24.32.js?v=24.32',
  './css/teacher-empty-art-v24.32.css?v=24.32',
  './js/teacher-empty-art-v24.32.js?v=24.32',
  './assets/empty-states/activities.png',
  './assets/empty-states/submissions.png',
  './assets/empty-states/performance.png',
  './assets/empty-states/classes.png',
  './assets/empty-states/competencies.png',
  './assets/empty-states/archive.png',
  './assets/empty-states/records.png',
  './js/app.js?v=24.39-cleared-to-do',
  './js/student-v8.js?v=24.39-cleared-to-do',
  './js/v10-features.js?v=24.39-bell-to-do',
  './js/design-v9.js?v=9',
  './js/pwa.js?v=30.0-safe-refresh',
  './js/push-notifications.js?v=24.38-student-alerts',
  './css/v12-archive-features.css?v=24.36-clear-reasons',
  './css/v14-layout-fixes.css?v=14.0',
  './css/v15-performance-calendar.css?v=15.11',
  './css/performance-class-mode.css?v=2',
  './js/v12-archive-features.js?v=24.39-clear-confirm',
  './js/v15-performance-tasks.js?v=24.23-class-leader-rating'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => (key.startsWith(CACHE_PREFIX) || key.startsWith('mathside-v')) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Supabase/CDN/other third-party requests stay network-controlled.
  if (url.origin !== self.location.origin) return;

  // Page navigations: use the network when Mathside is healthy.
  // If the website cannot be reached (or returns an error response), show the
  // dedicated maintenance screen instead of silently reopening a stale app shell.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (!fresh || !fresh.ok) {
          return (await caches.match('./offline.html')) || fresh || Response.error();
        }
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, fresh.clone());
        return fresh;
      } catch (_) {
        return (await caches.match('./offline.html'))
          || new Response('Mathside is temporarily unavailable.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
      }
    })());
    return;
  }

  // Same-origin assets: network first so CSS/JS edits appear quickly, cache as fallback.
  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, fresh.clone());
      }
      return fresh;
    } catch (_) {
      return (await caches.match(request)) || Response.error();
    }
  })());
});


// ---------------------------------------------------------------------------
// Step 6.9.3: Web Push notifications + final mobile roster polish.
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try {
      payload = event.data ? event.data.json() : {};
    } catch (_) {
      payload = { body: event.data ? event.data.text() : '' };
    }

    const title = payload.title || 'Mathside';
    const data = {
      notificationId: payload.notificationId || '',
      type: payload.type || 'update',
      relatedAssignmentId: payload.relatedAssignmentId || '',
      relatedSubmissionId: payload.relatedSubmissionId || '',
      url: payload.url || './'
    };

    await self.registration.showNotification(title, {
      body: payload.body || 'You have a new Mathside update.',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: payload.tag || `mathside-${data.notificationId || Date.now()}`,
      renotify: false,
      data,
      actions: [{ action: 'open', title: 'Open Mathside' }]
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const params = new URLSearchParams();
    if (data.notificationId) params.set('push_notification', data.notificationId);
    if (data.type) params.set('push_type', data.type);
    if (data.relatedAssignmentId) params.set('assignment', data.relatedAssignmentId);
    const target = `./${params.toString() ? `?${params.toString()}` : ''}`;

    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => {
      try { return new URL(client.url).origin === self.location.origin; } catch (_) { return false; }
    });
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'MATHSIDE_PUSH_OPEN', ...data });
      return;
    }
    await self.clients.openWindow(target);
  })());
});
