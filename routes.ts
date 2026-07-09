import { ViewType } from './types';

// Central mapping from each top-level ViewType to a real URL path.
// Detail views carry their id as a real path param instead of in-memory state,
// so a refresh or a copy-pasted URL always lands on the exact same record.
export const VIEW_ROUTES: Record<ViewType, string> = {
  'Dashboard': '/',
  'Inventory Forecasting': '/inventory/forecasting',
  'Draft Orders': '/logistics/draft-orders',
  'Purchase Orders': '/purchasing/purchase-orders',
  'Vendor Shipments': '/logistics/vendor-shipments',
  'Shipment Tracker': '/logistics/shipment-tracker',
  'Batch Detail': '/logistics/shipment-tracker/:batchId',
  'Finance': '/finance',
  'Inventory Analytics': '/inventory/analytics',
  'Settings': '/settings',
  'Shipment Finance': '/finance/shipments',
  'Shipment Finance Detail': '/finance/shipments/:batchId',
  'Payment Ledger': '/finance/payment-ledger',
  'Accounts View': '/finance/accounts',
  'Settlement Ledger': '/finance/settlement-ledger',
  'Amazon Forecasting': '/amazon/forecasting',
  'Create SKU': '/sku',
  'Update SKU': '/sku/update',
  // Must come after 'Update SKU' — matchPathToView returns the first
  // matching template, and this parameterized route would otherwise
  // swallow /sku/update by treating "update" as a :requestId.
  'SKU Detail': '/sku/:requestId',
};

// Views not reachable from the sidebar directly, but whose path should still
// highlight a parent nav item when active.
const DETAIL_VIEW_PARENT: Partial<Record<ViewType, ViewType>> = {
  'Batch Detail': 'Shipment Tracker',
  'Shipment Finance Detail': 'Shipment Finance',
  'SKU Detail': 'Create SKU',
};

export function viewToPath(view: ViewType, params?: Record<string, string>): string {
  let path = VIEW_ROUTES[view];
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      path = path.replace(`:${key}`, encodeURIComponent(value));
    });
  }
  return path;
}

// Reverse lookup used by the sidebar to determine which nav item is active
// for the current URL, including detail sub-paths mapping back to their parent.
export function matchPathToView(pathname: string): { view: ViewType; params: Record<string, string> } | null {
  for (const [view, template] of Object.entries(VIEW_ROUTES) as [ViewType, string][]) {
    const templateParts = template.split('/');
    const pathParts = pathname.split('/');
    if (templateParts.length !== pathParts.length) continue;

    const params: Record<string, string> = {};
    const isMatch = templateParts.every((part, i) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(pathParts[i]);
        return true;
      }
      return part === pathParts[i];
    });

    if (isMatch) return { view, params };
  }
  return null;
}

// Nav-highlighting helper: resolves a detail view back to its parent sidebar item.
export function viewForSidebarHighlight(view: ViewType): ViewType {
  return DETAIL_VIEW_PARENT[view] || view;
}
