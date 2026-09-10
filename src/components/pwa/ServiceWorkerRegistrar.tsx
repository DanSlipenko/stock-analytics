'use client';

import { useEffect } from 'react';
import { Button, notification } from 'antd';

/* How often to ask the browser to re-check sw.js for a new build. */
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

/**
 * Registers the service worker, surfaces updates, and follows it to the login
 * page when it reports the session has ended.
 *
 * A new worker installs in the background and waits; rather than swapping the
 * app out from under someone mid-edit, we prompt and let them choose when to
 * reload. Registration is production-only — in dev the cache fights HMR.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    let registration: ServiceWorkerRegistration | undefined;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    let reloading = false;

    // On a first install the worker claims a page that had no controller. That
    // claim is not an update, so it must not trigger a reload — but every
    // controller change after it is a genuine new build.
    let hasController = !!navigator.serviceWorker.controller;

    const promptToUpdate = (waiting: ServiceWorker) => {
      const key = 'sw-update';
      notification.info({
        key,
        message: 'Update available',
        description: 'A new version of StockPulse is ready.',
        placement: 'bottomRight',
        duration: 0,
        btn: (
          <Button
            type="primary"
            size="small"
            onClick={() => {
              notification.destroy(key);
              waiting.postMessage({ type: 'SKIP_WAITING' });
            }}
          >
            Reload
          </Button>
        ),
      });
    };

    // The new worker takes control once it skips waiting — reload to pick it up.
    const onControllerChange = () => {
      if (!hasController) {
        // First-install claim: adopt the worker quietly, nothing to swap out.
        hasController = true;
        return;
      }
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    // The worker sees every API call, so it's the one that notices a 401 once
    // the session expires or is revoked. The store treats a failed fetch as
    // "no data", which would otherwise leave an installed app — no address bar,
    // no reload button — showing an empty portfolio instead of a sign-in form.
    let signingIn = false;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'SIGNED_OUT' || signingIn) return;
      // The login page's own data fetches 401 too; don't redirect it to itself.
      if (window.location.pathname === '/login') return;
      signingIn = true;
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/login?next=${encodeURIComponent(next)}`);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);

    const checkForUpdate = () => registration?.update().catch(() => {});
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    };

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        registration = reg;

        // Already waiting from an earlier visit.
        if (reg.waiting && navigator.serviceWorker.controller) promptToUpdate(reg.waiting);

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;

          installing.addEventListener('statechange', () => {
            // `controller` is null on the very first install — nothing to
            // replace then, so only prompt on a genuine update.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              promptToUpdate(installing);
            }
          });
        });

        intervalId = setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL);
        document.addEventListener('visibilitychange', onVisibilityChange);
      })
      .catch((error) => {
        console.error('Service worker registration failed:', error);
      });

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      navigator.serviceWorker.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  return null;
}
