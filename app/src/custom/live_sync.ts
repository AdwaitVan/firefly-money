import { S, el } from '../core/base';
import { CACHE, PAGES } from '../core/api';
import { route } from '../core/router';
import { App } from '../core/base';

/* =====================================================================
   Live Sync & Instant Telemetry Auto-Refresher
   Polls gateway sync-status every 2.5 seconds. When any change occurs via
   Telegram (transaction, rent settlement, expense, rule, delete/undo),
   the dashboard invalidates stale cache and smoothly morphs the active
   view in real time without screen flicker, layout shift, or blind polling.
   ===================================================================== */

let lastKnownChange: number = 0;
let liveSyncTimer: ReturnType<typeof setInterval> | null = null;
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
  // Clear in-memory caches so latest data is fetched from Firefly III
  CACHE.clear();
  PAGES.clear();
  S.dirtyAt = Date.now();
  S.freshAfter = Date.now();
  S.listsAt = 0;

  // If currently on Rentals page, trigger immediate rentals re-render
  if (location.hash.includes('rentals') && typeof App.refreshRentals === 'function') {
    App.refreshRentals();
    return;
  }

  // Smooth, native in-place morph redraw of current active view
  route({ quiet: true }).catch(() => {});
}

export function initLiveSync(): void {
  if (liveSyncTimer) return;

  // Fast heartbeat poll every 2500ms for instant Telegram & gateway reactivity
  liveSyncTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      checkSyncHeartbeat();
    }
  }, 2500);

  // Instant heartbeat check on tab visibility return or window focus
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkSyncHeartbeat();
    }
  });

  window.addEventListener('focus', () => {
    if (document.visibilityState === 'visible') {
      checkSyncHeartbeat();
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
