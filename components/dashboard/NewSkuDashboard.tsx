import React, { useState, useMemo } from 'react';
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
}

// ─────────────────────────────────────────
// MOCK DATA
// ─────────────────────────────────────────

const MOCK_SKU_REQUESTS: SkuRequest[] = [
  {
    request_id: 'NSR-001',
    shipment_id: 'VS-PW260401-4',
    item_name: 'MoYu RS3M 2021 Stickerless',
    category: '3x3',
    vendor_code: 'PW',
    invoice_qty: 500,
    unit_price: 48.50,
    requested_by: 'Nitesh',
    requested_at: '2026-04-10T09:30:00Z',
    status: 'CREATED',
    ee_done: true,
    zoho_done: true,
    shopify_done: true,
    ee_po_updated: true,
    ee_sku: 'CUBE-RS3M-STK-001',
    shopify_listing_url: 'https://cubelelo.com/products/moyu-rs3m-2021',
  },
  {
    request_id: 'NSR-002',
    shipment_id: 'VS-QY260402-1',
    item_name: 'QiYi MS Pyraminx',
    category: 'Pyraminx',
    vendor_code: 'QY',
    invoice_qty: 200,
    unit_price: 32.00,
    requested_by: 'Arjun',
    requested_at: '2026-04-11T11:15:00Z',
    status: 'IN_PROGRESS',
    ee_done: true,
    zoho_done: true,
    shopify_done: false,
    ee_po_updated: false,
    ee_sku: 'CUBE-QIYI-PYR-002',
    shopify_listing_url: '',
  },
  {
    request_id: 'NSR-003',
    shipment_id: 'VS-MY260403-2',
    item_name: 'GAN 12 M Leap',
    category: '3x3',
    vendor_code: 'MY',
    invoice_qty: 100,
    unit_price: 198.00,
    requested_by: 'Nitesh',
    requested_at: '2026-04-12T14:00:00Z',
    status: 'PENDING',
    ee_done: false,
    zoho_done: false,
    shopify_done: false,
    ee_po_updated: false,
    ee_sku: '',
    shopify_listing_url: '',
  },
  {
    request_id: 'NSR-004',
    shipment_id: '',
    item_name: 'YJ MGC Megaminx Magnetic',
    category: 'Megaminx',
    vendor_code: 'PW',
    invoice_qty: 150,
    unit_price: 85.00,
    requested_by: 'Priya',
    requested_at: '2026-04-13T08:45:00Z',
    status: 'ACTION_REQ',
    ee_done: true,
    zoho_done: false,
    shopify_done: false,
    ee_po_updated: false,
    ee_sku: 'CUBE-MGC-MEGA-004',
    shopify_listing_url: '',
  },
  {
    request_id: 'NSR-005',
    shipment_id: 'VS-QY260404-3',
    item_name: 'QiYi X-Man Tornado V3 Pioneer',
    category: '3x3',
    vendor_code: 'QY',
    invoice_qty: 300,
    unit_price: 72.50,
    requested_by: 'Arjun',
    requested_at: '2026-04-14T10:20:00Z',
    status: 'REJECTED',
    ee_done: false,
    zoho_done: false,
    shopify_done: false,
    ee_po_updated: false,
    ee_sku: '',
    shopify_listing_url: '',
  },
  {
    request_id: 'NSR-006',
    shipment_id: 'VS-PW260405-1',
    item_name: 'MoYu WeiLong WRM V10 MagLev',
    category: '3x3',
    vendor_code: 'PW',
    invoice_qty: 250,
    unit_price: 135.00,
    requested_by: 'Nitesh',
    requested_at: '2026-04-15T07:10:00Z',
    status: 'PENDING',
    ee_done: false,
    zoho_done: false,
    shopify_done: false,
    ee_po_updated: false,
    ee_sku: '',
    shopify_listing_url: '',
  },
  {
    request_id: 'NSR-007',
    shipment_id: '',
    item_name: 'QiYi Clock Magnetic',
    category: 'Clock',
    vendor_code: 'QY',
    invoice_qty: 120,
    unit_price: 55.00,
    requested_by: 'Priya',
    requested_at: '2026-04-16T13:30:00Z',
    status: 'IN_PROGRESS',
    ee_done: true,
    zoho_done: false,
    shopify_done: false,
    ee_po_updated: false,
    ee_sku: 'CUBE-QY-CLK-007',
    shopify_listing_url: '',
  },
  {
    request_id: 'NSR-008',
    shipment_id: 'VS-MY260406-5',
    item_name: 'MoYu AoYan Skewb M',
    category: 'Skewb',
    vendor_code: 'MY',
    invoice_qty: 180,
    unit_price: 42.00,
    requested_by: 'Arjun',
    requested_at: '2026-04-17T06:00:00Z',
    status: 'ACTION_REQ',
    ee_done: true,
    zoho_done: true,
    shopify_done: true,
    ee_po_updated: false,
    ee_sku: 'CUBE-AOYAN-SKW-008',
    shopify_listing_url: 'https://cubelelo.com/products/moyu-aoyan-skewb',
  },
];

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

export const NewSkuDashboard: React.FC<{ onOpenDetail: (id: string) => void }> = ({ onOpenDetail }) => {
  const [data] = useState<SkuRequest[]>(MOCK_SKU_REQUESTS);
  const [statusFilter, setStatusFilter] = useState<SkuStatus | 'ALL'>('ALL');
  const [vendorFilter, setVendorFilter] = useState<string>('ALL');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debugMode, setDebugMode] = useState<boolean>(
    () => localStorage.getItem('skuDebugMode') === 'true'
  );

  // Derived: unique vendor codes
  const vendors = useMemo(() => {
    const codes = [...new Set(data.map(r => r.vendor_code).filter(v => v !== ''))];
    return codes.sort();
  }, [data]);

  // Derived: filtered list
  const filtered = useMemo(() => {
    let result = data;

    if (statusFilter !== 'ALL') {
      result = result.filter(r => r.status === statusFilter);
    }

    if (vendorFilter !== 'ALL') {
      result = result.filter(r => r.vendor_code === vendorFilter);
    }

    if (dateFrom) {
      const from = new Date(dateFrom);
      result = result.filter(r => new Date(r.requested_at) >= from);
    }

    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter(r => new Date(r.requested_at) <= to);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r =>
        r.item_name.toLowerCase().includes(q) ||
        r.request_id.toLowerCase().includes(q) ||
        r.ee_sku.toLowerCase().includes(q)
      );
    }

    return result;
  }, [data, statusFilter, vendorFilter, dateFrom, dateTo, searchQuery]);

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
              onClick={() => setStatusFilter(s)}
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
        </div>

        {/* Filter controls row */}
        <div className="flex flex-wrap items-center gap-3">

          {/* Vendor */}
          <select
            value={vendorFilter}
            onChange={e => setVendorFilter(e.target.value)}
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
              onChange={e => setDateFrom(e.target.value)}
              className="h-9 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {/* To date */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">To</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
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
              {filtered.length > 0 ? (
                filtered.map(r => (
                  <tr
                    key={r.request_id}
                    className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors cursor-pointer"
                    onClick={() => onOpenDetail(r.request_id)}
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
              ) : (
                <tr>
                  <td colSpan={11}>
                    <div className="py-16 text-center">
                      <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center mx-auto mb-4">
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
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

/*
  GAS INTEGRATION — TO IMPLEMENT IN PHASE 2
  
  Replace MOCK_SKU_REQUESTS with a real fetch:
  
  const GAS_URL = import.meta.env.VITE_GAS_URL;
  
  useEffect(() => {
    fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'getNewSkuRequests', filters: { ... } })
    })
    .then(r => r.json())
    .then(result => setData(result.data))
    .catch(err => console.error('GAS fetch error:', err));
  }, [statusFilter, vendorFilter, dateFrom, dateTo]);
  
  GAS function: getNewSkuRequests_(filters)
  Sheet: New_SKU_Requests
  Returns: array of SkuRequest objects
*/
