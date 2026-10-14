'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/** Preparation is optional; unsupported browsers retain normal online use. */
export function RegisterOffline() {
  const pathname = usePathname();
  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'production' ||
      !/^\/(?:en\/?|zh\/?)?(?:plan)?$/.test(pathname) ||
      !('serviceWorker' in navigator)
    )
      return;
    void navigator.serviceWorker
      .register('/life-ledger-sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => {
        // Failure must not block calculations, edits or IndexedDB persistence.
      });
  }, [pathname]);
  return null;
}
