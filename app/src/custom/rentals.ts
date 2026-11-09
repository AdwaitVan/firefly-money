import { type Html, html, htmlList } from '../core/html';
import { VIEWS, type Paint, type RouteInfo, refreshAll } from '../core/router';
import { head } from '../core/dom';
import { App } from '../core/base';

/* =====================================================================
   14-Tenant Rent Roll & Gateway Telemetry Integration
   Integrates with Python Gateway (http://192.168.0.150:8000/api/v1/dashboard/overview)
   Styled natively with Firefly Money design tokens.
   ===================================================================== */

export interface RentalKpi {
  total_properties: number;
  total_units: number;
  active_units: number;
  total_expected: number;
  total_collected: number;
  total_overdue: number;
  collection_rate_pct: number;
}

export interface PropertySummary {
  property_id: number;
  property_name: string;
  property_type: string;
  total_units: number;
  total_expected: number;
  total_collected: number;
  total_outstanding: number;
  collection_rate_pct: number;
}

export interface RentRollItem {
  tenant_id: number;
  tenant_name: string;
  property_name: string;
  unit_code: string;
  schedule_id?: number;
  amount_due: number;
  amount_collected: number;
  outstanding_balance: number;
  due_date: string;
  status: string;
  normalized_status: string;
  status_badge: string;
}

export interface ExpiringLease {
  lease_id: number;
  tenant_name: string;
  property_name: string;
  unit_code: string;
  end_date: string;
  days_left: number;
  agreed_rent: number;
}

export interface DashboardOverview {
  current_month?: string;
  as_of_timestamp?: string;
  liquid_cash?: number;
  total_liabilities?: number;
  safe_to_spend?: number;
  cashflow?: {
    income: number;
    expense: number;
    net: number;
  };
  rental_kpi?: RentalKpi;
  properties?: PropertySummary[];
  rent_roll?: RentRollItem[];
  upcoming_obligations?: {
    expiring_leases?: ExpiringLease[];
    maintenance_tickets?: unknown[];
  };
}

let latestData: DashboardOverview | null = null;
let activePainter: Paint | null = null;

export function fmtINR(val: number | undefined | null): string {
  if (val == null || isNaN(val)) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val);
}

export async function fetchGatewayOverview(): Promise<DashboardOverview> {
  const endpoints = [
    'http://192.168.0.150:8000/api/v1/dashboard/overview',
    '/api/gateway/overview',
    'http://localhost:8000/api/v1/dashboard/overview',
  ];

  let lastError: Error | null = null;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        return (await res.json()) as DashboardOverview;
      }
    } catch (e: any) {
      lastError = e;
    }
  }
  throw lastError || new Error('Gateway overview unreachable');
}

function renderStatusPill(item: RentRollItem): Html {
  if (item.outstanding_balance <= 0 || item.normalized_status === 'PAID' || item.status === 'SETTLED') {
    return html`<span class="status-pill settled">✅ Settled</span>`;
  }
  if (item.amount_collected > 0 && item.outstanding_balance > 0) {
    return html`<span class="status-pill partial">⚠️ Partial</span>`;
  }
  if (item.normalized_status === 'OVERDUE') {
    let days = '';
    const match = (item.status_badge || '').match(/(\d+)d/);
    if (match) {
      days = match[1];
    } else if (item.due_date) {
      const diffTime = Date.now() - new Date(item.due_date).getTime();
      const diffDays = Math.max(1, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
      days = String(diffDays);
    } else {
      days = '8';
    }
    return html`<span class="status-pill overdue">🔴 Overdue (${days} days)</span>`;
  }
  return html`<span class="status-pill upcoming">⏳ Upcoming</span>`;
}

function renderKpis(kpi: RentalKpi): Html {
  return html`
    <div class="kpis" id="rentals-kpis" style="margin-bottom: 22px;">
      <div class="kpi">
        <div class="eyebrow">Total Expected</div>
        <div class="val num">${fmtINR(kpi.total_expected)}</div>
        <div class="sub-s">${kpi.total_units} Units (${kpi.total_properties} Properties)</div>
      </div>
      <div class="kpi">
        <div class="eyebrow">Total Collected</div>
        <div class="val num pos">${fmtINR(kpi.total_collected)}</div>
        <div class="sub-s">${kpi.active_units} Active Units</div>
      </div>
      <div class="kpi">
        <div class="eyebrow">Total Overdue</div>
        <div class="val num neg">${fmtINR(kpi.total_overdue)}</div>
        <div class="sub-s">Arrears Pending Settlement</div>
      </div>
      <div class="kpi">
        <div class="eyebrow">Collection Rate</div>
        <div class="val num ${kpi.collection_rate_pct >= 90 ? 'pos' : kpi.collection_rate_pct >= 50 ? '' : 'neg'}">
          ${kpi.collection_rate_pct.toFixed(1)}%
        </div>
        <div class="sub-s">${kpi.collection_rate_pct >= 90 ? 'Healthy Cashflow' : 'Collection in Progress'}</div>
      </div>
    </div>
  `;
}

function renderLiquidityTelemetry(data: DashboardOverview): Html {
  if (data.liquid_cash == null) return html``;
  const net = data.cashflow?.net ?? 0;
  return html`
    <section class="panel" style="margin-bottom: 20px;">
      <div class="panel-head" style="margin-bottom: 12px;">
        <div>
          <h2 style="margin: 0; font-size: 17px;">Gateway Liquidity Telemetry</h2>
          <p class="lead" style="margin: 2px 0 0;">Combined family balance sheet and cashflow status</p>
        </div>
        <div class="sub-s" style="font-weight: 500;">Period: ${data.current_month || 'Current Month'}</div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
        <div class="stat">
          <div class="eyebrow">Liquid Cash</div>
          <div class="stat-v num pos" style="font-size: 26px;">${fmtINR(data.liquid_cash)}</div>
          <div class="sub-s">Unencumbered liquidity</div>
        </div>
        <div class="stat">
          <div class="eyebrow">Total Liabilities</div>
          <div class="stat-v num neg" style="font-size: 26px;">${fmtINR(data.total_liabilities)}</div>
          <div class="sub-s">Active short-term debts</div>
        </div>
        <div class="stat">
          <div class="eyebrow">Safe to Spend</div>
          <div class="stat-v num" style="font-size: 26px; color: var(--accent);">${fmtINR(data.safe_to_spend)}</div>
          <div class="sub-s">After obligations</div>
        </div>
        <div class="stat">
          <div class="eyebrow">Net Monthly Cashflow</div>
          <div class="stat-v num ${net >= 0 ? 'pos' : 'neg'}" style="font-size: 26px;">${fmtINR(net)}</div>
          <div class="sub-s">In: ${fmtINR(data.cashflow?.income)} · Out: ${fmtINR(data.cashflow?.expense)}</div>
        </div>
      </div>
    </section>
  `;
}

function renderLeaseWarnings(expiring: ExpiringLease[] | undefined): Html {
  if (!expiring || !expiring.length) return html``;
  return html`
    <section class="panel" style="margin-bottom: 22px; border-left: 4px solid var(--warn, #f59e0b);">
      <div class="panel-head" style="margin-bottom: 10px;">
        <h2 style="display: flex; align-items: center; gap: 8px; font-size: 16px; margin: 0;">
          <span aria-hidden="true">⚠️</span> Lease Expiration Warnings (&lt; 90 Days)
        </h2>
        <span class="sub-s" style="color: var(--warn, #f59e0b); font-weight: 600;">
          ${expiring.length} ${expiring.length === 1 ? 'Lease' : 'Leases'} Due for Renewal
        </span>
      </div>
      <p class="lead" style="margin-bottom: 14px;">Tenants with lease agreements terminating in the next 90 days:</p>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px;">
        ${htmlList(
          expiring.map(
            l => html`
              <div style="padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                  <strong style="font-size: 15px;">${l.tenant_name}</strong>
                  <span class="status-pill partial" style="font-size: 11px; padding: 2px 8px;">${l.days_left}d left</span>
                </div>
                <div class="sub-s" style="margin-top: 4px;">${l.property_name} · <span class="unit-badge">${l.unit_code}</span></div>
                <div class="sub-s" style="margin-top: 3px; color: var(--muted);">
                  Expires: ${l.end_date} · Rent: ${fmtINR(l.agreed_rent)}/mo
                </div>
              </div>
            `,
          ),
        )}
      </div>
    </section>
  `;
}

function renderPropertyPortfolio(properties: PropertySummary[] | undefined): Html {
  if (!properties || !properties.length) return html``;
  return html`
    <section class="panel" style="margin-bottom: 22px;">
      <div class="panel-head" style="margin-bottom: 12px;">
        <div>
          <h2 style="margin: 0; font-size: 17px;">Property Portfolio Breakdown</h2>
          <p class="lead" style="margin: 2px 0 0;">Asset allocation across ${properties.length} real estate holdings</p>
        </div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px;">
        ${htmlList(
          properties.map(
            p => html`
              <div style="padding: 14px 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <strong style="font-size: 15px;">${p.property_name}</strong>
                  <span class="sub-s" style="font-size: 12px; color: var(--muted);">${p.property_type}</span>
                </div>
                <div class="sub-s" style="margin: 6px 0 10px;">
                  ${p.total_units} ${p.total_units === 1 ? 'Unit' : 'Units'} · Collection Rate:
                  <strong class="${p.collection_rate_pct >= 90 ? 'pos' : ''}">${p.collection_rate_pct.toFixed(1)}%</strong>
                </div>
                <div class="track" style="margin-bottom: 10px;">
                  <div class="fill good" style="width: ${Math.min(100, p.collection_rate_pct)}%;"></div>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 13px;" class="num">
                  <span>Expected: ${fmtINR(p.total_expected)}</span>
                  <span class="pos">Collected: ${fmtINR(p.total_collected)}</span>
                </div>
              </div>
            `,
          ),
        )}
      </div>
    </section>
  `;
}

function renderRentRollTable(items: RentRollItem[] | undefined, asOf: string | undefined): Html {
  if (!items || !items.length) {
    return html`
      <section class="panel">
        <div class="center-empty" style="padding: 50px 20px;">
          <div style="font-size: 36px;">🏢</div>
          <h2 style="font-size: 18px; margin: 10px 0 4px;">No Rental Units Available</h2>
          <p class="lead">Could not find any active rent schedules in the gateway database.</p>
        </div>
      </section>
    `;
  }

  const rows = items.map(
    item => html`
      <tr>
        <td>
          <strong style="font-size: 14px;">${item.tenant_name}</strong>
        </td>
        <td>${item.property_name}</td>
        <td><span class="unit-badge">${item.unit_code}</span></td>
        <td class="r num">${fmtINR(item.amount_due)}</td>
        <td class="r num ${item.amount_collected > 0 ? 'pos' : ''}">${fmtINR(item.amount_collected)}</td>
        <td class="r num ${item.outstanding_balance > 0 ? 'neg' : ''}">${fmtINR(item.outstanding_balance)}</td>
        <td>${item.due_date}</td>
        <td class="c">${renderStatusPill(item)}</td>
      </tr>
    `,
  );

  return html`
    <section class="panel flush" style="margin-bottom: 24px;">
      <div style="padding: 20px 24px 10px; display: flex; justify-content: space-between; align-items: center;" class="panel-head">
        <div>
          <h2 style="margin: 0; font-size: 18px;">14-Tenant Rent Roll</h2>
          <p class="lead" style="margin: 4px 0 0;">Unit status, agreed rent, collections, arrears, and due dates</p>
        </div>
        <div class="sub-s" style="font-size: 12px; color: var(--muted);">
          ${asOf ? 'Updated: ' + asOf : ''}
        </div>
      </div>
      <div style="overflow-x: auto;">
        <table class="tbl">
          <thead>
            <tr>
              <th>Tenant Name</th>
              <th>Property</th>
              <th>Unit</th>
              <th class="r">Agreed Rent</th>
              <th class="r">Collected</th>
              <th class="r">Arrears / Outstanding</th>
              <th>Due Date</th>
              <th class="c">Status</th>
            </tr>
          </thead>
          <tbody>
            ${htmlList(rows)}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export function renderRentalsHtml(data: DashboardOverview): Html {
  const kpis = data.rental_kpi || {
    total_properties: 3,
    total_units: 14,
    active_units: 14,
    total_expected: 0,
    total_collected: 0,
    total_overdue: 0,
    collection_rate_pct: 0,
  };

  const actions = html`
    <button class="btn small" type="button" data-onclick="App.refreshRentals()" title="Refresh telemetry">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
      </svg>
      Refresh
    </button>
  `;

  return html`
    ${head('🏢 Rentals', 'Family Real Estate Portfolio & 14-Tenant Rent Roll', actions)}
    ${renderKpis(kpis)}
    ${renderLiquidityTelemetry(data)}
    ${renderLeaseWarnings(data.upcoming_obligations?.expiring_leases)}
    ${renderPropertyPortfolio(data.properties)}
    ${renderRentRollTable(data.rent_roll, data.as_of_timestamp)}
  `;
}

export const renderRentalsView = async (_r: RouteInfo, paint: Paint) => {
  activePainter = paint;

  // Render responsive skeleton placeholder while data loads
  paint(html`
    ${head('🏢 Rentals', 'Family Real Estate Portfolio & 14-Tenant Rent Roll')}
    <div class="kpis sk-kpis">
      <div class="kpi"><div class="sk" style="width:50%;height:12px;"></div><div style="height:12px;"></div><div class="sk" style="width:80%;height:28px;"></div></div>
      <div class="kpi"><div class="sk" style="width:50%;height:12px;"></div><div style="height:12px;"></div><div class="sk" style="width:80%;height:28px;"></div></div>
      <div class="kpi"><div class="sk" style="width:50%;height:12px;"></div><div style="height:12px;"></div><div class="sk" style="width:80%;height:28px;"></div></div>
      <div class="kpi"><div class="sk" style="width:50%;height:12px;"></div><div style="height:12px;"></div><div class="sk" style="width:80%;height:28px;"></div></div>
    </div>
    <section class="panel flush sk-list">
      <div style="padding:20px 24px;">
        <div class="sk" style="width:40%;height:16px;"></div>
        <div style="height:12px;"></div>
        <div class="sk" style="width:100%;height:200px;border-radius:10px;"></div>
      </div>
    </section>
  `);

  try {
    const data = await fetchGatewayOverview();
    latestData = data;
    paint(renderRentalsHtml(data));
  } catch (err: any) {
    paint(html`
      ${head('🏢 Rentals', 'Family Real Estate Portfolio & 14-Tenant Rent Roll')}
      <section class="panel" style="border-left: 4px solid var(--spend, #ef4444); padding: 28px 24px;">
        <h2 style="color: var(--spend, #ef4444); margin: 0 0 8px;">Gateway Telemetry Offline</h2>
        <p class="lead" style="margin: 0 0 12px;">
          Could not connect to the Python Gateway at <code>http://192.168.0.150:8000/api/v1/dashboard/overview</code>.
        </p>
        <p class="sub-s" style="margin: 0 0 18px; color: var(--muted);">${String(err?.message || err)}</p>
        <button class="btn primary" type="button" data-onclick="App.refreshRentals()">Retry Connection</button>
      </section>
    `);
  }
};

// Register route in VIEWS
VIEWS['rentals'] = renderRentalsView;

// Silent telemetry update listener for background refreshes
if (typeof window !== 'undefined') {
  window.addEventListener('gateway-telemetry-update', (e: Event) => {
    const detail = (e as CustomEvent).detail as DashboardOverview;
    if (detail) {
      latestData = detail;
      if (activePainter && activePainter.live) {
        activePainter(renderRentalsHtml(detail));
      }
    }
  });
}

// Bind refresh method to App
function refreshRentals(): void {
  refreshAll();
}

const methods = {
  refreshRentals,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' {
  interface AppApi extends Methods {}
}
