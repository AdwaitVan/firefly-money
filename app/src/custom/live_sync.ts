import { S, el } from '../core/base';
import { clearCache } from '../core/api';
import { refreshAll, route } from '../core/router';
import { App } from '../core/base';

/* =====================================================================
   Live Sync & Instant Telemetry Auto-Refresher
   Polls gateway sync-status every 2 seconds. When any change occurs via
   Telegram (transaction, rent settlement, expense, rule), the dashboard
   invalidates stale cache and quietly re-paints numbers within ~1-2 seconds
   with zero screen flicker and no manual page reloading.
   ===================================================================== */

let lastKnownChange: number = 0;
let liveSyncTimer: ReturnType<typeof setInterval> | null = null;
let fallbackTimer: ReturnType<typeof setInterval> | null = null;
let isChecking = false;

async function checkSyncHeartbeat(): Promise<void> {
  if (isChecking || !S.signedIn || el('app').hidden) return;
  isChecking = true;

  try {
    const urls = [
      '/api/gateway/system/sync-status',
      'http://192.168.0.150:8000/api/v1/system/sync-status',
      'http://localhost:8000/api/v1/system/sync-status',
    ];

    let res: Response | null = null;
    for (const u of urls) {
      try {
        res = await fetch(u, { cache: 'no-store' });
        if (res.ok) break;
      } catch {
        // try next endpoint
      }
    }

    if (res && res.ok) {
      const data = await res.json();
      const changeTs = Number(data.last_change) || 0;

      if (lastKnownChange === 0) {
        lastKnownChange = changeTs;
      } else if (changeTs > lastKnownChange) {
        lastKnownChange = changeTs;
        // Immediate instant re-sync
        triggerInstantRefresh();
      }
    }
  } catch {
    // Ignore heartbeat network glitches
  } finally {
    isChecking = false;
  }
}

export function triggerInstantRefresh(): void {
  // Clear in-memory caches
  clearCache();
  S.freshAfter = Date.now();
  S.dirtyAt = Date.now();
  S.listsAt = 0;

  // Quietly re-fetch and paint current active view
  refreshAll({ visible: false }).catch(() => {});

  // If currently on Rentals page, trigger immediate rentals re-render
  if (location.hash.includes('rentals') && typeof App.refreshRentals === 'function') {
    App.refreshRentals();
  }
}

export function initLiveSync(): void {
  if (liveSyncTimer) return;

  // 1. Fast heartbeat poll every 2000ms for instant Telegram reactivity
  liveSyncTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      checkSyncHeartbeat();
    }
  }, 2000);

  // 2. Fallback periodic refresh every 15s for external Firefly III edits
  fallbackTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && S.signedIn && !el('app').hidden) {
      refreshAll({ visible: false }).catch(() => {});
    }
  }, 15000);

  // 3. Instant refresh on tab or window focus if idle > 3s
  window.addEventListener('focus', () => {
    if (S.signedIn && !el('app').hidden && Date.now() - (S.lastRefresh || 0) > 3000) {
      checkSyncHeartbeat();
      refreshAll({ visible: false }).catch(() => {});
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.signedIn && !el('app').hidden && Date.now() - (S.lastRefresh || 0) > 3000) {
      checkSyncHeartbeat();
      refreshAll({ visible: false }).catch(() => {});
    }
  });
}

// Bind to App
const methods = {
  triggerInstantRefresh,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' {
  interface AppApi extends Methods {}
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initLiveSync());
  } else {
    initLiveSync();
  }
}
