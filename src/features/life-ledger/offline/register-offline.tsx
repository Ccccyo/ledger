'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const OFFLINE_CACHE_PREFIX = 'life-ledger-shell-';
const DEV_SW_RELOAD_KEY = 'life-ledger.dev-sw-cleaned';

/** Preparation is optional; unsupported browsers retain normal online use. */
export function RegisterOffline() {
  const pathname = usePathname();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      // A previously installed production worker can keep serving cached
      // chunks while Next's dev server is running. That mixes two builds and
      // causes repeated hydration/remount flashes. Remove only this product's
      // worker and caches, then reload once so the current page is no longer
      // controlled by the stale worker.
      void (async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const productRegistrations = registrations.filter((registration) => {
          const scriptUrl =
            registration.active?.scriptURL ||
            registration.waiting?.scriptURL ||
            registration.installing?.scriptURL ||
            '';
          return scriptUrl.endsWith('/life-ledger-sw.js');
        });
        const removed = (
          await Promise.all(
            productRegistrations.map((registration) =>
              registration.unregister()
            )
          )
        ).some(Boolean);

        if ('caches' in window) {
          const cacheKeys = await caches.keys();
          await Promise.all(
            cacheKeys
              .filter((key) => key.startsWith(OFFLINE_CACHE_PREFIX))
              .map((key) => caches.delete(key))
          );
        }

        const controlledByProductWorker =
          navigator.serviceWorker.controller?.scriptURL.endsWith(
            '/life-ledger-sw.js'
          ) ?? false;
        if (
          removed &&
          controlledByProductWorker &&
          !sessionStorage.getItem(DEV_SW_RELOAD_KEY)
        ) {
          sessionStorage.setItem(DEV_SW_RELOAD_KEY, 'true');
          window.location.reload();
          return;
        }
        if (!controlledByProductWorker) {
          sessionStorage.removeItem(DEV_SW_RELOAD_KEY);
        }
      })().catch(() => {
        // Development remains usable even when storage cleanup is blocked.
      });
      return;
    }

    if (!/^\/(?:en\/?|zh\/?)?(?:plan)?$/.test(pathname)) return;

    void navigator.serviceWorker
      .register('/life-ledger-sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => {
        // Failure must not block calculations, edits or IndexedDB persistence.
      });
  }, [pathname]);
  return null;
}
