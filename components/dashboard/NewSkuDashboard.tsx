import React, { useState, useMemo, useEffect } from 'react';
import { APPS_SCRIPT_URL, API_ACTIONS } from '../../constants';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { PlusIcon, MagnifyingGlassIcon, ChevronRightIcon, ExclamationTriangleIcon } from '../icons/Icons';

// ─────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────

type SkuStatus = 'PENDING' | 'IN_PROGRESS' | 'ACTION_REQ' | 'CREATED' | 'REJECTED';

interface SkuRequest {
  request_id: string;
  shipment_id: string;
  item_name: string;
  category: string;
  vendor_code: string;
  invoice_qty: number;
  unit_price: number;
  requested_by: string;
  requested_at: string;
  status: SkuStatus;
  ee_done: boolean;
  zoho_done: boolean;
  shopify_done: boolean;
  ee_po_updated: boolean;
  ee_sku: string;
  shopify_listing_url: string;
  suggested_sku: string;
  listing_name: string;
  // IMP-flaggable fields — optional/non-blocking at creation time, but
  // worth surfacing once a SKU is fully live (see "Needs Attention" filter)
  ean: string;
  pack_size: number;
  nw_gm: number;
  pkg_weight_gm: number;
  pkg_height_cm: number;
  pkg_length_cm: number;
  pkg_width_cm: number;
}

// A CREATED SKU with any of these blank/zero still needs a follow-up
// visit to Update SKU — Item Weight, Size, EAN/ID, Pkg Weight, Pkg Size.
const hasOutstandingImpFields = (r: SkuRequest): boolean => {
  return (
    !r.nw_gm ||
    !r.pack_size ||
    !r.ean ||
    !r.pkg_weight_gm ||
    !r.pkg_height_cm || !r.pkg_length_cm || !r.pkg_width_cm
  );
};

// ─────────────────────────────────────────
// STATUS CONFIG
// ─────────────────────────────────────────

const STATUS_CONFIG: Record<SkuStatus, { label: string; classes: string }> = {
  PENDING:     { label: 'Pending',     classes: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
  IN_PROGRESS: { label: 'In Progress', classes: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
  ACTION_REQ:  { label: 'Action Req',  classes: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' },
  CREATED:     { label: 'Created',     classes: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
  REJECTED:    { label: 'Rejected',    classes: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' },
};

// ─────────────────────────────────────────
// HELPER COMPONENTS
// ─────────────────────────────────────────

const StatusBadge: React.FC<{ status: SkuStatus }> = ({ status }) => {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
};

const PlatformDots: React.FC<{
  ee_done: boolean;
  zoho_done: boolean;
  shopify_done: boolean;
  ee_po_updated: boolean;
}> = ({ ee_done, zoho_done, shopify_done, ee_po_updated }) => {
  const items = [
    { label: 'EE', done: ee_done },
    { label: 'Zoho', done: zoho_done },
    { label: 'Shop', done: shopify_done },
    { label: 'PO', done: ee_po_updated },
  ];
  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      {items.map((item, idx) => (
        <React.Fragment key={item.label}>
          {idx > 0 && <span className="text-gray-300 dark:text-gray-600">·</span>}
          <span className={item.done ? 'text-green-500 dark:text-green-400' : 'text-gray-300 dark:text-gray-600'}>
            {item.label}&nbsp;{item.done ? '●' : '○'}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
};

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const formatCNY = (val: number): string => {
  return `¥ ${val.toFixed(2)}`;
};

// ─────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────

export const NewSkuDashboard: React.FC<{
  onOpenDetail: (id: string) => void;
  onOpenUpdateSku?: (sku: string) => void;
  cachedData: any[];
  onDataLoaded: (data: any[]) => void;
  dataLoaded: boolean;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  vendorFilter: string;
  onVendorFilterChange: (v: string) => void;
  dateFrom: string;
  onDateFromChange: (v: string) => void;
  dateTo: string;
  onDateToChange: (v: string) => void;
}> = ({ onOpenDetail, onOpenUpdateSku, cachedData, onDataLoaded, dataLoaded,
        statusFilter, onStatusFilterChange,
        vendorFilter, onVendorFilterChange,
        dateFrom, onDateFromChange,
        dateTo, onDateToChange }) => {
  const [data, setData] = useState<SkuRequest[]>(() => cachedData || []);
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debugMode, setDebugMode] = useState<boolean>(
    () => localStorage.getItem('skuDebugMode') === 'true'
  );

  // Sync cached data from App.tsx into local state on every mount
  useEffect(() => {
    if (cachedData && cachedData.length > 0) {
      setData(cachedData);
    }
  }, [cachedData]);

  const fetchRequests = async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: API_ACTIONS.GET_NEW_SKU_REQUESTS })
      });
      const result = await response.json();
      if (result.success) {
        setData(result.data || []);
        onDataLoaded(result.data || []);
      } else {
        setFetchError(result.error || 'Failed to load requests');
      }
    } catch (err) {
      setFetchError('Network error — could not reach server');
      console.error('fetchRequests error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!dataLoaded) {
      fetchRequests();
    }
  }, []);

  // Search is client-side only — no refetch needed for search

  // Derived: unique vendor codes
  const vendors = useMemo(() => {
    const codes = [...new Set(data.map(r => r.vendor_code).filter(v => v !== ''))];
    return codes.sort();
  }, [data]);

  const filtered = useMemo(() => {
    return data.filter(r => {
      if (needsAttentionOnly) {
        if (r.status !== 'CREATED' || !hasOutstandingImpFields(r)) return false;
      } else {
        if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      }
      if (vendorFilter !== 'ALL' && r.vendor_code !== vendorFilter) return false;
      if (dateFrom && r.requested_at < dateFrom) return false;
      if (dateTo && r.requested_at > dateTo) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          r.item_name.toLowerCase().includes(q) ||
          r.request_id.toLowerCase().includes(q) ||
          (r.ee_sku || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [data, statusFilter, vendorFilter, dateFrom, dateTo, searchQuery, needsAttentionOnly]);

  const needsAttentionCount = useMemo(
    () => data.filter(r => r.status === 'CREATED' && hasOutstandingImpFields(r)).length,
    [data]
  );

  const toggleDebug = () => {
    setDebugMode(prev => {
      const next = !prev;
      localStorage.setItem('skuDebugMode', String(next));
      return next;
    });
  };

  const statusChips: (SkuStatus | 'ALL')[] = ['ALL', 'PENDING', 'IN_PROGRESS', 'ACTION_REQ', 'CREATED', 'REJECTED'];

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto p-6 animate-in fade-in duration-500">

      {/* ─── SECTION 5+6: UNIFIED FILTER BAR WITH HEADER ─── */}
      <Card className="!p-4">

        {/* Top row: title + actions */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Manage new SKU creation requests across EasyEcom, Zoho and Shopify
          </p>
          <div className="flex items-center gap-3">
            {/* Debug toggle */}
            <button
              onClick={() => {
                const next = !debugMode;
                setDebugMode(next);
                localStorage.setItem('skuDebugMode', String(next));
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                debugMode
                  ? 'bg-amber-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
              }`}
            >
              Debug
            </button>
            {/* + Create SKU button */}
            <Button onClick={() => onOpenDetail('NEW')} className="flex items-center gap-1.5">
              <PlusIcon className="w-4 h-4" />
              Create SKU
            </Button>
          </div>
        </div>

        {/* Status chips */}
        <div className="flex flex-wrap gap-2 mb-3">
          {(['ALL', 'PENDING', 'IN_PROGRESS', 'ACTION_REQ', 'CREATED', 'REJECTED'] as const).map(s => (
            <button
              key={s}
              onClick={() => onStatusFilterChange(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all ${
                statusFilter === s
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700/60 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {s === 'ALL' ? 'All'
                : s === 'IN_PROGRESS' ? 'In Progress'
                : s === 'ACTION_REQ' ? 'Action Req'
                : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
          {/* Needs Attention — CREATED SKUs still missing an IMP field
              (Item Weight, Size, EAN/ID, Pkg Weight, Pkg Size). Clicking a
              row here opens Update SKU instead of the Create SKU detail
              view, since these are already live and just need a follow-up edit. */}
          <button
            onClick={() => setNeedsAttentionOnly(prev => !prev)}
            title="CREATED SKUs still missing Item Weight, Size, EAN/ID, Pkg Weight, or Pkg Size"
            className={`px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5 ${
              needsAttentionOnly
                ? 'bg-amber-500 text-white shadow-sm'
                : 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30'
            }`}
          >
            <ExclamationTriangleIcon className="w-3.5 h-3.5" />
            Needs Attention
            {needsAttentionCount > 0 && (
              <span className={`px-1.5 rounded-full text-[10px] ${needsAttentionOnly ? 'bg-white/20' : 'bg-amber-200 dark:bg-amber-800/50'}`}>
                {needsAttentionCount}
              </span>
            )}
          </button>
        </div>

        {/* Filter controls row */}
        <div className="flex flex-wrap items-center gap-3">

          {/* Vendor */}
          <select
            value={vendorFilter}
            onChange={e => onVendorFilterChange(e.target.value)}
            className="h-9 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            <option value="ALL">All Vendors</option>
            {vendors.map(v => <option key={v} value={v}>{v}</option>)}
          </select>

          {/* From date */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={e => onDateFromChange(e.target.value)}
              className="h-9 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {/* To date */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">To</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => onDateToChange(e.target.value)}
              className="h-9 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <MagnifyingGlassIcon className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by name, ID or SKU..."
              className="h-9 w-full pl-8 pr-3 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {/* Count */}
          <span className="ml-auto text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
            Showing {filtered.length} of {data.length} requests
          </span>

        </div>
      </Card>

      {/* ─── SECTION 7: REQUESTS TABLE ─── */}
      <Card className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-left w-[110px]">Request ID</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-left w-[140px]">Shipment ID</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-left min-w-[200px]">Item Name</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-left w-[100px]">Category</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-center w-[80px]">Vendor</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-right w-[60px]">Qty</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-right w-[90px]">Cost (¥)</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-left w-[110px]">Requested</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-left w-[160px]">Platforms</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-center w-[110px]">Status</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 text-center w-[60px]"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={11}>
                    <div className="py-16 text-center">
                      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent 
                                      rounded-full animate-spin mx-auto mb-4" />
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Loading requests...
                      </p>
                    </div>
                  </td>
                </tr>
              ) : fetchError ? (
                <tr>
                  <td colSpan={11}>
                    <div className="py-16 text-center">
                      <ExclamationTriangleIcon className="w-8 h-8 text-red-400 mx-auto mb-3" />
                      <p className="text-sm font-medium text-red-500">{fetchError}</p>
                      <button
                        onClick={fetchRequests}
                        className="mt-3 text-xs text-blue-500 hover:text-blue-600 
                                   underline underline-offset-2">
                        Try again
                      </button>
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={11}>
                    <div className="py-16 text-center">
                      <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 
                                      flex items-center justify-center mx-auto mb-4">
                        <MagnifyingGlassIcon className="w-6 h-6 text-gray-400" />
                      </div>
                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                        No SKU requests found
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        Try adjusting your filters
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map(r => (
                  <tr
                    key={r.request_id}
                    className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors cursor-pointer"
                    onClick={() => {
                      if (needsAttentionOnly && onOpenUpdateSku) {
                        onOpenUpdateSku(r.suggested_sku || r.ee_sku);
                      } else {
                        onOpenDetail(r.request_id);
                      }
                    }}
                  >
                    {/* 1. Request ID */}
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">
                        {r.request_id}
                      </span>
                    </td>

                    {/* 2. Shipment ID */}
                    <td className="px-4 py-3">
                      {r.shipment_id ? (
                        <span className="flex items-center gap-1 font-mono text-xs text-gray-600 dark:text-gray-400">
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.125-.504 1.125-1.125V14.25m-17.25 4.5v-9m17.25 9v-9" />
                          </svg>
                          {r.shipment_id}
                        </span>
                      ) : (
                        <span className="font-mono text-xs text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>

                    {/* 3. Item Name */}
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900 dark:text-white text-xs truncate max-w-[220px]">
                        {r.item_name}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {r.requested_by}
                      </p>
                    </td>

                    {/* 4. Category */}
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                      {r.category}
                    </td>

                    {/* 5. Vendor */}
                    <td className="px-4 py-3 text-center">
                      {r.vendor_code ? (
                        <span className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-0.5 rounded text-xs font-mono font-semibold">
                          {r.vendor_code}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                      )}
                    </td>

                    {/* 6. Qty */}
                    <td className="px-4 py-3 text-right text-xs font-mono text-gray-900 dark:text-white">
                      {r.invoice_qty}
                    </td>

                    {/* 7. Cost (¥) */}
                    <td className="px-4 py-3 text-right text-xs font-mono text-gray-600 dark:text-gray-400">
                      {formatCNY(r.unit_price)}
                    </td>

                    {/* 8. Requested */}
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {formatDate(r.requested_at)}
                    </td>

                    {/* 9. Platforms */}
                    <td className="px-4 py-3">
                      <PlatformDots
                        ee_done={r.ee_done}
                        zoho_done={r.zoho_done}
                        shopify_done={r.shopify_done}
                        ee_po_updated={r.ee_po_updated}
                      />
                    </td>

                    {/* 10. Status */}
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={r.status} />
                    </td>

                    {/* 11. Action */}
                    <td className="px-4 py-3 text-center">
                      <ChevronRightIcon className="w-4 h-4 text-gray-400 dark:text-gray-500 mx-auto" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ─── SECTION 8: DEBUG PANEL ─── */}
      {debugMode && (
        <Card className="border-2 border-amber-400 dark:border-amber-600 !p-4">
          <div className="flex items-center gap-2 mb-3">
            <ExclamationTriangleIcon className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
              Debug Mode Active
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-xs font-mono">
            <div>
              <p className="text-gray-500 dark:text-gray-400 mb-1">Active Filters:</p>
              <pre className="bg-gray-100 dark:bg-gray-900 rounded p-2 text-gray-700 dark:text-gray-300 text-[10px] overflow-auto">
                {JSON.stringify({ statusFilter, vendorFilter, dateFrom, dateTo, searchQuery }, null, 2)}
              </pre>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400 mb-1">
                Filtered Results: {filtered.length} / {data.length}
              </p>
              <pre className="bg-gray-100 dark:bg-gray-900 rounded p-2 text-gray-700 dark:text-gray-300 text-[10px] overflow-auto max-h-32">
                {JSON.stringify(filtered.map(r => r.request_id), null, 2)}
              </pre>
              <button
                onClick={fetchRequests}
                className="mt-2 px-3 py-1 bg-amber-500 text-white text-xs 
                           rounded font-semibold hover:bg-amber-600">
                Force Refresh
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};


