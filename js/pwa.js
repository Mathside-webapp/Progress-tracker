(() => {
  if (!('serviceWorker' in navigator)) return;

  let registrationRef = null;
  let reloadingForUpdate = false;
  let deferredInstallPrompt = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

  function ensurePwaUi() {
    if (!document.getElementById('pwaOfflineBanner')) {
      const banner = document.createElement('div');
      banner.id = 'pwaOfflineBanner';
      banner.setAttribute('role', 'status');
      banner.innerHTML = '<strong>You are offline.</strong><span> Some Mathside features need an internet connection.</span>';
      Object.assign(banner.style, {
        position: 'fixed', left: '50%', bottom: '18px', transform: 'translateX(-50%)',
        zIndex: '100000', maxWidth: 'calc(100% - 28px)', padding: '11px 16px',
        borderRadius: '14px', background: '#2f241d', color: '#fff',
        boxShadow: '0 14px 34px rgba(47,36,29,.24)',
        font: '600 14px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        display: 'none', textAlign: 'center'
      });
      document.body.appendChild(banner);
    }

    if (!document.getElementById('pwaUpdateDialog')) {
      const dialog = document.createElement('dialog');
      dialog.id = 'pwaUpdateDialog';
      dialog.setAttribute('aria-labelledby', 'pwaUpdateTitle');
      dialog.innerHTML = `
        <div class="pwa-card">
          <div class="pwa-card-icon">↻</div>
          <div class="pwa-card-eyebrow">MATHSIDE UPDATE</div>
          <h2 id="pwaUpdateTitle">A new version is ready</h2>
          <p>Update now to load the latest Mathside changes. Your account and Supabase data will not be removed.</p>
          <div class="pwa-card-actions">
            <button id="pwaUpdateLaterBtn" type="button" class="pwa-btn pwa-btn-light">Later</button>
            <button id="pwaUpdateNowBtn" type="button" class="pwa-btn pwa-btn-orange">Update now</button>
          </div>
        </div>`;
      dialog.className = 'pwa-dialog';
      document.body.appendChild(dialog);

      dialog.querySelector('#pwaUpdateLaterBtn').addEventListener('click', () => dialog.close());
      dialog.querySelector('#pwaUpdateNowBtn').addEventListener('click', () => {
        const waiting = registrationRef && registrationRef.waiting;
        if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
        else { dialog.close(); location.reload(); }
      });
    }

    if (!document.getElementById('pwaIosInstallDialog')) {
      const dialog = document.createElement('dialog');
      dialog.id = 'pwaIosInstallDialog';
      dialog.className = 'pwa-dialog';
      dialog.setAttribute('aria-labelledby', 'pwaIosInstallTitle');
      dialog.innerHTML = `
        <div class="pwa-card">
          <div class="pwa-card-icon">⌂</div>
          <div class="pwa-card-eyebrow">INSTALL MATHSIDE</div>
          <h2 id="pwaIosInstallTitle">Add Mathside to your Home Screen</h2>
          <ol class="pwa-ios-steps">
            <li>Open Mathside in <strong>Safari</strong>.</li>
            <li>Tap the <strong>Share</strong> button.</li>
            <li>Choose <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong>.</li>
          </ol>
          <div class="pwa-card-actions">
            <button id="pwaIosInstallCloseBtn" type="button" class="pwa-btn pwa-btn-orange">Got it</button>
          </div>
        </div>`;
      document.body.appendChild(dialog);
      dialog.querySelector('#pwaIosInstallCloseBtn').addEventListener('click', () => dialog.close());
    }

    if (!document.getElementById('pwaInstallHelpDialog')) {
      const dialog = document.createElement('dialog');
      dialog.id = 'pwaInstallHelpDialog';
      dialog.className = 'pwa-dialog';
      dialog.setAttribute('aria-labelledby', 'pwaInstallHelpTitle');
      dialog.innerHTML = `
        <div class="pwa-card">
          <div class="pwa-card-icon">⇩</div>
          <div class="pwa-card-eyebrow">INSTALL MATHSIDE</div>
          <h2 id="pwaInstallHelpTitle">Install Mathside on this device</h2>
          <p>If the browser install prompt does not appear, open your browser menu <strong>⋮</strong> and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>
          <div class="pwa-card-actions">
            <button id="pwaInstallHelpCloseBtn" type="button" class="pwa-btn pwa-btn-orange">Got it</button>
          </div>
        </div>`;
      document.body.appendChild(dialog);
      dialog.querySelector('#pwaInstallHelpCloseBtn').addEventListener('click', () => dialog.close());
    }

    if (!document.getElementById('pwaRuntimeStyles')) {
      const style = document.createElement('style');
      style.id = 'pwaRuntimeStyles';
      style.textContent = `
        .pwa-dialog{border:0;padding:0;border-radius:22px;background:transparent;max-width:none}
        .pwa-dialog::backdrop{background:rgba(30,22,17,.5);backdrop-filter:blur(3px)}
        .pwa-card{width:min(440px,calc(100vw - 36px));padding:26px;border-radius:22px;background:#fff;color:#2f241d;box-shadow:0 24px 70px rgba(47,36,29,.24);font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
        .pwa-card-icon{width:52px;height:52px;border-radius:16px;background:#fff1e8;color:#ff6500;display:grid;place-items:center;font-size:26px;margin-bottom:14px}
        .pwa-card-eyebrow{font-size:12px;font-weight:800;letter-spacing:.14em;color:#ff6500;margin-bottom:6px}
        .pwa-card h2{margin:0 0 8px;font-size:25px;line-height:1.1}
        .pwa-card p{margin:0;color:#6e6259;line-height:1.55}
        .pwa-card-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px;flex-wrap:wrap}
        .pwa-btn{border-radius:12px;padding:10px 16px;font-weight:800;cursor:pointer;font:inherit}
        .pwa-btn-light{border:1px solid #ead8cb;background:#fff;color:#2f241d}
        .pwa-btn-orange{border:0;background:#ff6500;color:#fff;padding-inline:18px}
        .pwa-ios-steps{margin:16px 0 0;padding-left:22px;color:#574a41;line-height:1.6}
        .pwa-ios-steps li+li{margin-top:5px}
        #pwaInstallBtn{white-space:nowrap}
        /* Step 5.5: keep all three hero actions visually consistent on desktop and mobile. */
        #publicSite .hero-buttons > .btn{
          width:190px;
          min-height:50px;
          height:50px;
          padding:13px 18px;
          font-size:16px;
        }
        .pwa-install-button{
          position:relative!important;
          border:1px solid #4a3326!important;
          color:#fff!important;
          background:#30251d!important;
          box-shadow:0 8px 20px rgba(48,37,29,.16)!important;
          display:inline-flex!important;align-items:center!important;justify-content:center!important;
          transition:transform .18s ease,box-shadow .18s ease,background .18s ease!important;
        }
        .pwa-install-button > span{margin:0!important;font-size:inherit!important;line-height:1!important;font-weight:800!important}
        .pwa-install-button .pwa-download-icon{
          position:absolute;right:16px;top:50%;transform:translateY(-50%);
          width:17px;height:17px;display:block;color:#ff8a3d;
        }
        .pwa-install-button:hover{transform:translateY(-2px);background:#3b2d24!important;box-shadow:0 10px 22px rgba(48,37,29,.22)!important}
        .pwa-install-button:focus-visible{outline:3px solid rgba(255,101,0,.25)!important;outline-offset:3px}
        @media(max-width:1100px){
          #publicSite .hero-buttons > .btn{font-size:14px}
        }
        @media(max-width:520px){
          #publicSite .hero-buttons > .btn{width:100%!important;height:50px!important;min-height:50px!important;font-size:13px!important;padding:12px 16px!important}
          .hero-buttons #pwaInstallBtn .pwa-download-icon{width:16px;height:16px;right:16px}
        }
      `;
      document.head.appendChild(style);
    }

    ensureInstallButton();
  }

  function ensureInstallButton() {
    if (isStandalone()) {
      document.getElementById('pwaInstallBtn')?.remove();
      return;
    }

    const actions = document.querySelector('#publicSite .hero-buttons');
    if (!actions || document.getElementById('pwaInstallBtn')) return;

    const button = document.createElement('button');
    button.id = 'pwaInstallBtn';
    button.type = 'button';
    button.className = 'btn btn-large pwa-install-button';
    button.innerHTML = `
      <span>Install Mathside</span>
      <svg class="pwa-download-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;

    button.addEventListener('click', async () => {
      if (isIos()) {
        const dialog = document.getElementById('pwaIosInstallDialog');
        if (dialog && typeof dialog.showModal === 'function') dialog.showModal();
        return;
      }

      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        try {
          const choice = await deferredInstallPrompt.userChoice;
          if (choice && choice.outcome === 'accepted') button.remove();
        } catch (_) {}
        deferredInstallPrompt = null;
        return;
      }

      const help = document.getElementById('pwaInstallHelpDialog');
      if (help && typeof help.showModal === 'function') help.showModal();
    });

    actions.appendChild(button);
  }

  function updateConnectivityUi() {
    ensurePwaUi();
    const banner = document.getElementById('pwaOfflineBanner');
    if (banner) banner.style.display = navigator.onLine ? 'none' : 'block';
  }

  function showUpdatePrompt() {
    ensurePwaUi();
    const dialog = document.getElementById('pwaUpdateDialog');
    if (!dialog || dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
  }

  function watchRegistration(registration) {
    registrationRef = registration;

    if (registration.waiting && navigator.serviceWorker.controller) showUpdatePrompt();

    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdatePrompt();
      });
    });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    ensurePwaUi();
    ensureInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    document.getElementById('pwaInstallBtn')?.remove();
  });

  window.addEventListener('online', updateConnectivityUi);
  window.addEventListener('offline', updateConnectivityUi);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    location.reload();
  });

  window.addEventListener('load', async () => {
    ensurePwaUi();
    updateConnectivityUi();

    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
      watchRegistration(registration);
      console.log('Mathside service worker ready:', registration.scope);

      registration.update().catch(() => {});
      window.addEventListener('focus', () => registration.update().catch(() => {}));
    } catch (error) {
      console.error('Mathside service worker registration failed:', error);
    }
  });
})();
