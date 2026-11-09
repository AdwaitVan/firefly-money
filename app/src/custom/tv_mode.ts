import { App } from '../core/base';

/* =====================================================================
   TV Kiosk Mode
   10-foot readability, large KPI typography, full TV Remote D-Pad
   sidebar & content navigation, and 60-second silent background polling.
   ===================================================================== */

const TV_STORAGE_KEY = 'tv_mode_active';
let tvRefreshTimer: ReturnType<typeof setInterval> | null = null;
let dpadListenerAttached = false;

export function isTvMode(): boolean {
  try {
    return localStorage.getItem(TV_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setTvMode(active: boolean): void {
  try {
    localStorage.setItem(TV_STORAGE_KEY, active ? 'true' : 'false');
  } catch {
    // Ignore localStorage errors
  }
  applyTvMode(active);
}

export function toggleTvMode(): void {
  setTvMode(!isTvMode());
}

function ensureExitButton(): void {
  let btn = document.getElementById('tv-exit-btn') as HTMLButtonElement | null;
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'tv-exit-btn';
    btn.className = 'tv-exit-btn';
    btn.type = 'button';
    btn.tabIndex = 0;
    btn.setAttribute('aria-label', 'Exit TV Mode');
    btn.innerHTML = '<span>📺</span><span>Exit TV Mode</span>';
    btn.addEventListener('click', () => {
      toggleTvMode();
    });
    document.body.appendChild(btn);
  }
}

function removeExitButton(): void {
  const btn = document.getElementById('tv-exit-btn');
  if (btn) {
    btn.remove();
  }
}

async function silentTvRefresh(): Promise<void> {
  const urls = [
    'http://192.168.0.150:8000/api/v1/dashboard/overview',
    '/api/gateway/overview',
    'http://localhost:8000/api/v1/dashboard/overview',
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        window.dispatchEvent(new CustomEvent('gateway-telemetry-update', { detail: data }));
        return;
      }
    } catch {
      // Continue to next URL
    }
  }
}

function startTvRefreshTimer(): void {
  stopTvRefreshTimer();
  tvRefreshTimer = setInterval(() => {
    silentTvRefresh().catch(() => {});
  }, 60000);
}

function stopTvRefreshTimer(): void {
  if (tvRefreshTimer) {
    clearInterval(tvRefreshTimer);
    tvRefreshTimer = null;
  }
}

/**
 * TV Remote D-Pad Navigation Handler
 * Supports ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Enter (OK), and Back/Escape.
 * Seamlessly transitions focus between the sidebar navigation rail and the main view.
 */
function setupTvDpadNavigation(): void {
  if (dpadListenerAttached) return;
  dpadListenerAttached = true;

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!isTvMode()) return;

    const key = e.key;
    const code = e.keyCode;

    const isUp = key === 'ArrowUp' || code === 38;
    const isDown = key === 'ArrowDown' || code === 40;
    const isLeft = key === 'ArrowLeft' || code === 37;
    const isRight = key === 'ArrowRight' || code === 39;
    const isEnter = key === 'Enter' || code === 13;
    const isBack = key === 'Escape' || key === 'GoBack' || code === 27 || code === 461 || code === 10009;

    if (!isUp && !isDown && !isLeft && !isRight && !isEnter && !isBack) return;

    const activeEl = document.activeElement as HTMLElement | null;
    const sidebar = document.querySelector('aside.side') as HTMLElement | null;
    const mainView = document.getElementById('view') as HTMLElement | null;
    const exitBtn = document.getElementById('tv-exit-btn') as HTMLElement | null;

    // Get all interactive sidebar links
    const sideLinks = sidebar ? Array.from(sidebar.querySelectorAll<HTMLElement>('.nav a, .foot a, .foot button, .side-tv-btn')).filter(el => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && !el.hasAttribute('disabled');
    }) : [];

    const inSidebar = !!(sidebar && activeEl && sidebar.contains(activeEl));

    if (isBack) {
      e.preventDefault();
      if (inSidebar) {
        const firstMain = mainView?.querySelector<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]');
        if (firstMain) firstMain.focus();
        else exitBtn?.focus();
      } else {
        toggleTvMode();
      }
      return;
    }

    if (inSidebar) {
      const idx = activeEl ? sideLinks.indexOf(activeEl) : -1;

      if (isDown) {
        e.preventDefault();
        const next = idx >= 0 && idx < sideLinks.length - 1 ? sideLinks[idx + 1] : sideLinks[0];
        next?.focus();
        next?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (isUp) {
        e.preventDefault();
        const prev = idx > 0 ? sideLinks[idx - 1] : sideLinks[sideLinks.length - 1];
        prev?.focus();
        prev?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (isRight) {
        e.preventDefault();
        // Jump focus from sidebar into the content view
        const target = mainView?.querySelector<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]');
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else if (exitBtn) {
          exitBtn.focus();
        }
      }
    } else {
      // Focus is currently in the main content or document body
      if (isLeft) {
        // Jump focus smoothly to sidebar active item
        e.preventDefault();
        const activeLink = (sidebar?.querySelector<HTMLElement>('.nav a.on') || sideLinks[0]);
        if (activeLink) {
          activeLink.focus();
          activeLink.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      } else if (!activeEl || activeEl === document.body) {
        // First remote interaction: focus the active sidebar link
        e.preventDefault();
        const activeLink = (sidebar?.querySelector<HTMLElement>('.nav a.on') || sideLinks[0]);
        activeLink?.focus();
      }
    }
  });
}

function applyTvMode(active: boolean): void {
  if (active) {
    document.body.classList.add('tv-mode');
    document.documentElement.classList.add('tv-mode');
    ensureExitButton();
    startTvRefreshTimer();
    setupTvDpadNavigation();
  } else {
    document.body.classList.remove('tv-mode');
    document.documentElement.classList.remove('tv-mode');
    removeExitButton();
    stopTvRefreshTimer();
  }
}

export function initTvMode(): void {
  injectTvStyles();
  setupTvDpadNavigation();
  const active = isTvMode();
  applyTvMode(active);
}

function injectTvStyles(): void {
  if (document.getElementById('tv-mode-custom-css')) return;
  const style = document.createElement('style');
  style.id = 'tv-mode-custom-css';
  style.textContent = `
    /* Sidebar TV Button */
    .side-tv-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      background: none;
      border: 0;
      padding: 6px 12px;
      color: var(--muted);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
      border-radius: 8px;
      width: 100%;
      text-align: left;
      transition: background var(--t-hover), color var(--t-hover);
    }
    .side-tv-btn:hover {
      background: var(--faint);
      color: var(--text);
    }
    html.side-mini .side-tv-btn {
      padding: 6px 4px;
      font-size: 0;
    }

    /* TV Mode 10-foot Kiosk Scaling */
    body.tv-mode {
      font-size: 19px !important;
    }
    body.tv-mode .app {
      display: flex !important;
      width: 100% !important;
      min-height: 100vh !important;
    }

    /* Sidebar in TV Mode (D-Pad accessible rail) */
    body.tv-mode aside.side {
      display: flex !important;
      flex-direction: column !important;
      width: 260px !important;
      min-width: 260px !important;
      max-width: 260px !important;
      flex-shrink: 0 !important;
      background: var(--panel, #18181b) !important;
      border-right: 1px solid var(--line, rgba(255, 255, 255, 0.12)) !important;
      padding: 24px 14px !important;
      z-index: 100 !important;
      overflow-y: auto !important;
    }
    body.tv-mode aside.side .brand {
      font-size: 24px !important;
      font-weight: 700 !important;
      margin-bottom: 16px !important;
    }
    body.tv-mode aside.side .nav-h {
      font-size: 13px !important;
      text-transform: uppercase !important;
      letter-spacing: 0.06em !important;
      margin-top: 14px !important;
      padding-bottom: 6px !important;
      color: var(--muted) !important;
    }
    body.tv-mode aside.side .nav a,
    body.tv-mode aside.side .foot .nav a,
    body.tv-mode aside.side .foot button {
      min-height: 48px !important;
      font-size: 18px !important;
      padding: 10px 16px !important;
      border-radius: 10px !important;
      margin-bottom: 4px !important;
      display: flex !important;
      align-items: center !important;
      gap: 12px !important;
      cursor: pointer !important;
    }
    body.tv-mode aside.side .nav a svg {
      width: 22px !important;
      height: 22px !important;
    }

    /* Hide elements not suitable for 10-foot TV view */
    body.tv-mode #tabbar,
    body.tv-mode #fab,
    body.tv-mode #searchBtn,
    body.tv-mode .side-search,
    body.tv-mode .side-tg,
    body.tv-mode .dash-edit,
    body.tv-mode .month button.round,
    body.tv-mode .month button.small {
      display: none !important;
    }

    body.tv-mode #view {
      flex: 1 !important;
      max-width: calc(100vw - 260px) !important;
      padding: 24px 36px 60px !important;
      overflow-y: auto !important;
    }
    body.tv-mode .head h1 {
      font-size: 36px !important;
      line-height: 1.15 !important;
      letter-spacing: -0.025em !important;
    }
    body.tv-mode .head .sub {
      font-size: 18px !important;
    }
    body.tv-mode .kpi {
      padding: 20px 24px !important;
    }
    body.tv-mode .kpi .eyebrow {
      font-size: 15px !important;
      letter-spacing: 0.04em !important;
    }
    body.tv-mode .kpi .val {
      font-size: 36px !important;
      line-height: 1.15 !important;
    }
    body.tv-mode .kpi .sub-s {
      font-size: 15px !important;
    }
    body.tv-mode .stat-v {
      font-size: 34px !important;
    }
    body.tv-mode .tbl th {
      font-size: 15px !important;
      padding: 14px 16px !important;
    }
    body.tv-mode .tbl td {
      font-size: 16px !important;
      padding: 14px 16px !important;
    }
    body.tv-mode .status-pill {
      font-size: 13px !important;
      padding: 5px 12px !important;
    }

    /* TV Remote D-Pad Glowing Focus Outline */
    body.tv-mode a:focus,
    body.tv-mode a:focus-visible,
    body.tv-mode button:focus,
    body.tv-mode button:focus-visible,
    body.tv-mode [tabindex="0"]:focus,
    body.tv-mode [tabindex="0"]:focus-visible,
    body.tv-mode .tv-exit-btn:focus,
    body.tv-mode .tv-exit-btn:focus-visible {
      outline: 3px solid var(--accent, #3b82f6) !important;
      outline-offset: 3px !important;
      box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.4), 0 0 24px var(--accent, #3b82f6) !important;
      transform: scale(1.03) !important;
      background-color: var(--faint, rgba(255, 255, 255, 0.12)) !important;
      color: var(--text, #ffffff) !important;
      transition: transform 0.12s ease, box-shadow 0.12s ease !important;
      z-index: 9999 !important;
    }

    /* TV Exit Floating Button */
    .tv-exit-btn {
      position: fixed;
      top: 20px;
      right: 28px;
      z-index: 10000;
      background: var(--panel, #1f1f23);
      color: var(--text, #ffffff);
      border: 1px solid var(--line, rgba(255, 255, 255, 0.18));
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.55);
      border-radius: 999px;
      padding: 10px 22px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: transform 0.2s, background 0.2s, border-color 0.2s;
    }
    .tv-exit-btn:hover {
      transform: scale(1.05);
      background: var(--spend, #ef4444);
      border-color: transparent;
      color: #ffffff;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Trigger upstream sync and Docker rebuild from the UI
 */
export async function syncUpstream(btn?: HTMLElement): Promise<void> {
  const origText = btn ? btn.innerText : '';
  if (btn) {
    btn.setAttribute('disabled', 'true');
    btn.innerText = 'Checking & updating...';
  }
  try {
    const urls = [
      '/api/gateway/system/sync-upstream',
      'http://192.168.0.150:8000/api/v1/system/sync-upstream',
      'http://localhost:8000/api/v1/system/sync-upstream',
    ];

    let res: Response | null = null;
    let errDetail = '';
    for (const u of urls) {
      try {
        res = await fetch(u, { method: 'POST' });
        if (res.ok) break;
        errDetail = `HTTP ${res.status}`;
      } catch (err: any) {
        errDetail = err?.message || 'network error';
      }
    }

    if (!res || !res.ok) {
      throw new Error(errDetail || 'Gateway unavailable');
    }

    const data = await res.json();
    if (data.already_up_to_date) {
      alert('✅ Dashboard is already up to date with upstream Firefly Money!\n\nAll custom family modules are active and in sync.');
    } else if (data.status === 'success') {
      alert('🚀 Successfully merged upstream updates and rebuilt custom Docker container!\n\nThe page will now refresh.');
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } else {
      alert('⚠️ Sync completed:\n' + (data.output || data.message || 'Done'));
    }
  } catch (e: any) {
    alert('❌ Update check failed: ' + (e?.message || e));
  } finally {
    if (btn) {
      btn.removeAttribute('disabled');
      btn.innerText = origText || 'Check & Update';
    }
  }
}

// Bind methods to App
const methods = {
  toggleTvMode,
  syncUpstream,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' {
  interface AppApi extends Methods {}
}

// Initialize on script execution
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initTvMode());
  } else {
    initTvMode();
  }
}
