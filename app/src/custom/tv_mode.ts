import { App } from '../core/base';

/* =====================================================================
   TV Kiosk Mode
   10-foot readability, large KPI typography, hidden navigation,
   and 60-second silent background polling of gateway telemetry.
   ===================================================================== */

const TV_STORAGE_KEY = 'tv_mode_active';
let tvRefreshTimer: ReturnType<typeof setInterval> | null = null;

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

function applyTvMode(active: boolean): void {
  if (active) {
    document.body.classList.add('tv-mode');
    document.documentElement.classList.add('tv-mode');
    ensureExitButton();
    startTvRefreshTimer();
  } else {
    document.body.classList.remove('tv-mode');
    document.documentElement.classList.remove('tv-mode');
    removeExitButton();
    stopTvRefreshTimer();
  }
}

export function initTvMode(): void {
  injectTvStyles();
  const active = isTvMode();
  applyTvMode(active);
}

function injectTvStyles(): void {
  if (document.getElementById('tv-mode-custom-css')) return;
  const style = document.createElement('style');
  style.id = 'tv-mode-custom-css';
  style.textContent = `
    /* TV Mode 10-foot Kiosk Scaling */
    body.tv-mode {
      font-size: 19px !important;
    }
    body.tv-mode .app {
      display: block !important;
      width: 100% !important;
      max-width: 100vw !important;
    }
    body.tv-mode aside.side,
    body.tv-mode #tabbar,
    body.tv-mode #fab,
    body.tv-mode #searchBtn,
    body.tv-mode .side-search,
    body.tv-mode .side-tg,
    body.tv-mode .btn-tv-toggle,
    body.tv-mode .dash-edit,
    body.tv-mode .month button.round,
    body.tv-mode .month button.small {
      display: none !important;
    }
    body.tv-mode #view {
      margin: 0 auto !important;
      max-width: 96vw !important;
      padding: 24px 36px 60px !important;
      width: 100% !important;
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

// Bind methods to App
const methods = {
  toggleTvMode,
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
