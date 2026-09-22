import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    BoxIcon,
    BanknotesIcon,
    TruckIcon,
    ClockIcon,
    ExclamationTriangleIcon,
    MagnifyingGlassIcon,
    ShipIcon,
    AirplaneIcon,
    ArrowPathIcon,
    PencilIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    CheckIcon,
    XMarkIcon,
    LinkIcon,
    CloudArrowUpIcon
} from '../icons/Icons';
import { Batch, BatchFilters, BatchMetrics, BatchVendorShipment, BatchLineItem, SkuCategory } from '../../types';
import { callGasAuthed } from '../../services/gasApi';
import { Button } from '../ui/Button';
import { useQueryParam, useQueryParamFast } from '../../hooks/useQueryParam';
import { useSearchParams } from 'react-router-dom';
import { EditBatchTrackingModal } from './EditBatchTrackingModal';
import { UploadShipmentDocsModal } from './UploadShipmentDocsModal';

// Module-level cache — survives switching tabs and back.
let batchListCache: {
    batches: Batch[];
    metrics: BatchMetrics | null;
    timestamp: number;
} | null = null;

let categoryCache: SkuCategory[] | null = null;

// Every status gets its own hue family (not just a lighter/darker shade of a
// neighbor) so no two are confusable at a glance — In-Transit India and Out
// for Delivery used to both read as "green".
const STATUS_CONFIG: Record<string, { label: string; badge: string }> = {
    'OPEN':              { label: 'Open',              badge: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
    'Shipped':           { label: 'Shipped',           badge: 'bg-purple-100 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400' },
    'In-Transit China':  { label: 'In-Transit China',  badge: 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400' },
    'At Port China':     { label: 'At Port China',     badge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-400' },
    'In-Transit Ocean':  { label: 'In-Transit Ocean',  badge: 'bg-teal-100 text-teal-700 dark:bg-teal-500/10 dark:text-teal-400' },
    'In-Transit Air':    { label: 'In-Transit Air',    badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400' },
    'Customs Clearance': { label: 'Customs Clearance', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' },
    'In-Transit India':  { label: 'In-Transit India',  badge: 'bg-lime-100 text-lime-700 dark:bg-lime-500/10 dark:text-lime-400' },
    'Out for Delivery':  { label: 'Out for Delivery',  badge: 'bg-pink-100 text-pink-700 dark:bg-pink-500/10 dark:text-pink-400' },
    'Delivered':         { label: 'Delivered',         badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' },
};

const getStatusConfig = (status: string) =>
    STATUS_CONFIG[status] || { label: status, badge: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' };

const formatDate = (dateString: string | null) => {
    if (!dateString) return '—';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

// Groups SKU_Config categories that share one prefix (Shape Mod / Skewb both
// share '113') into a single filter option, per the Item Type filter spec.
function buildItemTypeOptions(categories: SkuCategory[]): { prefix: string; label: string }[] {
    const byPrefix: Record<string, string[]> = {};
    categories.forEach(c => {
        if (!byPrefix[c.prefix]) byPrefix[c.prefix] = [];
        byPrefix[c.prefix].push(c.category);
    });
    return Object.keys(byPrefix)
        .map(prefix => ({
            prefix,
            label: byPrefix[prefix].length > 1
                ? `${byPrefix[prefix].join(' / ')} (${prefix})`
                : `${byPrefix[prefix][0]} (${prefix})`
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

// ── Sortable columns — click a header to sort by it, click again to flip
// direction. A new column defaults to descending (same convention as the
// Inventory tab's handleSort). expected_delivery is the initial page sort.
type SortColumn = BatchFilters['sortBy'];
// String() first, not just `|| ''` — a tracking number that's all digits can
// come back from Sheets as a JS number (e.g. 123456789), and `(a || '')`
// only coerces falsy values; a truthy number passes through untouched and
// crashes `.localeCompare` (not a function on Number.prototype).
const cmpStr = (a: string, b: string) => String(a || '').localeCompare(String(b || ''));
const cmpNum = (a: number, b: number) => a - b;

// Shared by the batch-list filter (does this batch contain a matching line?)
// and the expanded accordion (which line matched, so it can be highlighted).
const lineMatchesTerm = (li: BatchLineItem, term: string) =>
    String(li.sku || '').toLowerCase().includes(term) || String(li.item_name || '').toLowerCase().includes(term);
const COLUMN_COMPARATORS: Record<SortColumn, (a: Batch, b: Batch) => number> = {
    batch_id: (a, b) => cmpStr(a.batch_id, b.batch_id),
    mode: (a, b) => cmpStr(a.batch_type, b.batch_type),
    status: (a, b) => cmpStr(a.status, b.status),
    ee_status: (a, b) => cmpStr(a.ee_status || '', b.ee_status || ''),
    expected_delivery: (a, b) => {
        // No ETA always sorts last, regardless of direction — a batch with an
        // unknown ETA isn't "earliest", it's unscheduled.
        if (!a.expected_delivery && !b.expected_delivery) return 0;
        if (!a.expected_delivery) return 1;
        if (!b.expected_delivery) return -1;
        return new Date(a.expected_delivery).getTime() - new Date(b.expected_delivery).getTime();
    },
    delay: (a, b) => cmpNum(a.is_delayed ? a.delay_days : 0, b.is_delayed ? b.delay_days : 0),
    carrier: (a, b) => cmpStr(a.carrier, b.carrier),
    tracking_number: (a, b) => cmpStr(a.tracking_number, b.tracking_number),
    vendors: (a, b) => cmpNum(a.total_vendors, b.total_vendors),
    cartons: (a, b) => cmpNum(a.total_cartons, b.total_cartons),
    units: (a, b) => cmpNum(a.total_units, b.total_units),
};

const COLUMN_LABELS: Record<SortColumn, string> = {
    batch_id: 'Batch ID', mode: 'Mode', status: 'Status', ee_status: 'EE PO',
    expected_delivery: 'Expected Delivery', delay: 'Delay', carrier: 'Carrier',
    tracking_number: 'Tracking Number', vendors: 'Vendors', cartons: 'Cartons', units: 'Units'
};

const SortableHeader: React.FC<{
    column: SortColumn;
    sortBy: SortColumn;
    sortDir: 'asc' | 'desc';
    onSort: (col: SortColumn) => void;
    align?: 'left' | 'right';
}> = ({ column, sortBy, sortDir, onSort, align = 'left' }) => {
    const active = sortBy === column;
    return (
        <th
            onClick={() => onSort(column)}
            className={`px-4 py-3 cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200 ${align === 'right' ? 'text-right' : 'text-left'}`}
        >
            {COLUMN_LABELS[column]}
            <span className={`ml-1 text-[9px] ${active ? 'text-blue-500' : 'opacity-30'}`}>
                {active ? (sortDir === 'asc' ? '▲' : '▼') : '▲▼'}
            </span>
        </th>
    );
};

const DashboardCards: React.FC<{
    metrics: BatchMetrics | null;
    isLoading: boolean;
}> = ({ metrics, isLoading }) => {
    if (isLoading && !batchListCache) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {[1, 2, 3, 4].map(i => (
                    <div key={i} className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700 animate-pulse shadow-sm">
                        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-24 mb-2" />
                        <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-16" />
                    </div>
                ))}
            </div>
        );
    }

    const transitTimeValue = (() => {
        const air = metrics?.avgTransitTimeAirDays;
        const sea = metrics?.avgTransitTimeSeaDays;
        if (air == null && sea == null) return '—';
        return `Air: ${air != null ? air + 'd' : '—'} · Sea: ${sea != null ? sea + 'd' : '—'}`;
    })();

    const cards = [
        { label: 'In-Transit Value (RMB)', value: `¥${((metrics?.inTransitValue || 0) / 1000).toFixed(1)}k`, icon: BanknotesIcon, color: 'text-emerald-500' },
        { label: 'Arriving This Week',     value: metrics?.arrivingThisWeek || 0,                              icon: TruckIcon,      color: 'text-yellow-500' },
        { label: "This Week's New Shipments", value: metrics?.newShipmentsThisWeek || 0,                       icon: BoxIcon,        color: 'text-blue-500' },
        { label: 'Avg Transit Time',       value: transitTimeValue,                                            icon: ClockIcon,      color: 'text-indigo-500' },
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {cards.map((card, index) => {
                const Icon = card.icon;
                return (
                    <div key={index} className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-500 transition-colors shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <Icon className={`w-5 h-5 ${card.color}`} />
                            <span className="text-sm text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wide">{card.label}</span>
                        </div>
                        <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{card.value}</div>
                    </div>
                );
            })}
        </div>
    );
};

const FilterBar: React.FC<{
    filters: BatchFilters;
    setFilters: (filters: BatchFilters) => void;
    vendorOptions: string[];
    carrierOptions: string[];
    itemTypeOptions: { prefix: string; label: string }[];
}> = ({ filters, setFilters, vendorOptions, carrierOptions, itemTypeOptions }) => {
    return (
        <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 mb-6 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px] relative">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
                    <input
                        type="text"
                        placeholder="Search by Batch ID, Tracking, SKU, or Item Name..."
                        value={filters.search}
                        onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                        className="w-full pl-10 pr-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>

                <select
                    value={filters.status}
                    onChange={(e) => setFilters({ ...filters, status: e.target.value as any })}
                    className="px-2.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[168px]"
                >
                    <option value="All">All Status</option>
                    {Object.keys(STATUS_CONFIG).map(s => <option key={s} value={s}>{getStatusConfig(s).label}</option>)}
                </select>

                <select
                    value={filters.vendor}
                    onChange={(e) => setFilters({ ...filters, vendor: e.target.value })}
                    className="px-2.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[130px]"
                >
                    <option value="All">All Vendors</option>
                    {vendorOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>

                <select
                    value={filters.carrier}
                    onChange={(e) => setFilters({ ...filters, carrier: e.target.value })}
                    className="px-2.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[130px]"
                >
                    <option value="All">All Carriers</option>
                    {carrierOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                <select
                    value={filters.itemTypePrefix}
                    onChange={(e) => setFilters({ ...filters, itemTypePrefix: e.target.value })}
                    className="px-2.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[140px]"
                >
                    <option value="All">All Item Types</option>
                    {itemTypeOptions.map(o => <option key={o.prefix} value={o.prefix}>{o.label}</option>)}
                </select>

                <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 shrink-0">
                    {(['All', 'sea', 'air'] as const).map(mode => (
                        <button
                            key={mode}
                            onClick={() => setFilters({ ...filters, mode })}
                            title={mode === 'All' ? 'All modes' : mode === 'sea' ? 'Sea' : 'Air'}
                            className={`px-3 py-1.5 rounded-md font-bold text-xs transition-all uppercase ${filters.mode === mode
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                }`}
                        >
                            {mode === 'All' ? 'ALL' : mode === 'sea' ? '🚢' : '✈️'}
                        </button>
                    ))}
                </div>

                <label className="flex items-center gap-1.5 px-1 text-xs font-bold text-slate-500 dark:text-slate-400 cursor-pointer select-none shrink-0 whitespace-nowrap">
                    <input
                        type="checkbox"
                        checked={filters.showDelivered}
                        onChange={(e) => setFilters({ ...filters, showDelivered: e.target.checked })}
                        className="w-3.5 h-3.5 accent-blue-600"
                    />
                    Delivered
                </label>
            </div>
        </div>
    );
};

const CheckCell: React.FC<{
    value: boolean;
    isAdmin: boolean;
    onToggle?: () => void;
    isSaving?: boolean;
}> = ({ value, isAdmin, onToggle, isSaving }) => {
    if (!isAdmin) {
        return value
            ? <CheckIcon className="w-4 h-4 text-green-500 mx-auto" />
            : <XMarkIcon className="w-4 h-4 text-slate-300 dark:text-slate-600 mx-auto" />;
    }
    return (
        <input
            type="checkbox"
            checked={value}
            disabled={isSaving}
            onChange={(e) => { e.stopPropagation(); onToggle && onToggle(); }}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 mx-auto block accent-blue-600 disabled:opacity-50 cursor-pointer"
        />
    );
};

// One shipment's SKU line items — always shown when the shipment row is
// expanded (no further nesting; there's nothing useful to collapse below a
// SKU row).
const ShipmentLineTable: React.FC<{
    lineItems: BatchLineItem[];
    isAdmin: boolean;
    onToggleFlag: (lineId: string, flag: 'logo' | 'packaging' | 'manual' | 'opp_wrap', value: boolean) => void;
    savingKey: string | null;
    highlightTerm: string;
}> = ({ lineItems, isAdmin, onToggleFlag, savingKey, highlightTerm }) => (
    <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-4">
        <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
                <thead>
                    <tr className="border-b border-slate-300 dark:border-slate-700">
                        {['SKU', 'Item Name', 'Incoming', 'Logo', 'Pkg', 'Manual', 'OPP'].map((label, i) => (
                            <th
                                key={label}
                                className={`py-2.5 px-3 text-[10px] font-bold text-slate-500 dark:text-slate-500 uppercase tracking-wider ${i < 2 ? 'text-left' : i === 2 ? 'text-right' : 'text-center'}`}
                            >
                                {label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {lineItems.map(item => {
                        const isMatch = !!highlightTerm && lineMatchesTerm(item, highlightTerm);
                        return (
                        <tr key={item.line_id} className={`hover:bg-slate-100/60 dark:hover:bg-slate-800/50 transition-colors ${isMatch ? 'bg-yellow-100/70 dark:bg-yellow-400/10' : ''}`}>
                            <td className="py-2.5 px-3 font-mono text-xs font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">{item.sku}</td>
                            <td className="py-2.5 px-3 text-slate-800 dark:text-slate-300 whitespace-nowrap">{item.item_name}</td>
                            <td className="py-2.5 px-3 text-right font-bold text-slate-900 dark:text-white">{item.incoming_qty}</td>
                            {(['logo', 'packaging', 'manual', 'opp_wrap'] as const).map(flag => {
                                const value = flag === 'logo' ? !!item.has_logo : flag === 'packaging' ? !!item.has_packaging : flag === 'manual' ? !!item.has_manual : !!item.has_opp_wrap;
                                const key = `${item.line_id}:${flag}`;
                                return (
                                    <td key={flag} className="py-2.5 px-3">
                                        <CheckCell
                                            value={value}
                                            isAdmin={isAdmin}
                                            isSaving={savingKey === key}
                                            onToggle={() => onToggleFlag(item.line_id, flag, !value)}
                                        />
                                    </td>
                                );
                            })}
                        </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    </div>
);

const ShipmentRow: React.FC<{
    vendor: BatchVendorShipment;
    batchId: string;
    isExpanded: boolean;
    onToggle: () => void;
    isAdmin: boolean;
    onToggleFlag: (lineId: string, flag: 'logo' | 'packaging' | 'manual' | 'opp_wrap', value: boolean) => void;
    savingKey: string | null;
    onUpload: () => void;
    highlightTerm: string;
}> = ({ vendor, isExpanded, onToggle, isAdmin, onToggleFlag, savingKey, onUpload, highlightTerm }) => {
    const ChevronIcon = isExpanded ? ChevronDownIcon : ChevronRightIcon;
    return (
        <div className="border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 overflow-hidden">
            {/* A real <button> can't contain the nested Upload/View Documents
                buttons (invalid HTML — button-in-button), so this is a div
                with button semantics instead. */}
            <div
                role="button"
                tabIndex={0}
                onClick={onToggle}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
                className="w-full px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors flex items-center justify-between gap-3 flex-wrap text-left cursor-pointer"
            >
                <div className="flex items-center gap-3 flex-wrap">
                    <ChevronIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <span className="font-bold text-sm text-slate-900 dark:text-slate-100 uppercase tracking-tight">{vendor.vendor_code}</span>
                    <span className="text-slate-300 dark:text-slate-600">|</span>
                    <span className="text-sm text-slate-700 dark:text-slate-300">{vendor.vendor_name}</span>
                    <span className="text-slate-300 dark:text-slate-600">|</span>
                    <span className="text-xs text-slate-500">Invoice {vendor.invoiceId || '—'}</span>
                    {vendor.ee_po_status === 'FAILED' && (
                        <span
                            title={vendor.ee_push_error || 'EasyEcom PO push failed'}
                            className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-400/10"
                        >
                            ⚠ EE PO Failed
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-4 flex-wrap">
                    <span className="text-xs text-slate-500">{vendor.carton_count} cartons · {vendor.total_units} units</span>
                    {vendor.drive_folder_url ? (
                        <a
                            href={vendor.drive_folder_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                        >
                            <LinkIcon className="w-3.5 h-3.5" /> View Documents
                        </a>
                    ) : (
                        <span className="text-xs text-slate-400 dark:text-slate-600 italic">No documents yet</span>
                    )}
                    {isAdmin && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onUpload(); }}
                            className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                        >
                            <CloudArrowUpIcon className="w-3.5 h-3.5" /> {vendor.drive_folder_url ? 'Add More' : 'Upload Documents'}
                        </button>
                    )}
                </div>
            </div>
            {isExpanded && (
                <ShipmentLineTable
                    lineItems={vendor.line_items}
                    isAdmin={isAdmin}
                    onToggleFlag={onToggleFlag}
                    savingKey={savingKey}
                    highlightTerm={highlightTerm}
                />
            )}
        </div>
    );
};

interface ShipmentTrackerProps {
    isAdmin?: boolean;
}

export const ShipmentTracker: React.FC<ShipmentTrackerProps> = ({ isAdmin = false }) => {
    const [batches, setBatches] = useState<Batch[]>(batchListCache?.batches || []);
    const [metrics, setMetrics] = useState<BatchMetrics | null>(batchListCache?.metrics || null);
    const [categories, setCategories] = useState<SkuCategory[]>(categoryCache || []);

    // Filters persisted in the URL: free-text search via raw history.replaceState
    // (hot path, no history spam), everything else via react-router's useSearchParams.
    const [search, setSearch] = useQueryParamFast('search', '');
    const [status, setStatus] = useQueryParam<string>('status', 'All');
    const [mode, setMode] = useQueryParam<string>('mode', 'All');
    const [vendor, setVendor] = useQueryParam<string>('vendor', 'All');
    const [carrier, setCarrier] = useQueryParam<string>('carrier', 'All');
    const [itemTypePrefix, setItemTypePrefix] = useQueryParam<string>('itemType', 'All');
    const [showDeliveredStr, setShowDeliveredStr] = useQueryParam<string>('delivered', '0');
    // Column + direction share one query param ("expected_delivery-asc") rather
    // than two separate useQueryParam hooks — calling two react-router
    // setSearchParams setters synchronously in one click races (each computes
    // its update from the not-yet-committed previous URL), so only the second
    // call's change would land. One param, one setter, no race (same fix as
    // the Inventory tab's sort state).
    const [sortState, setSortState] = useQueryParam<string>('sort', 'expected_delivery-asc');
    const [sortBy, sortDir] = useMemo((): [SortColumn, 'asc' | 'desc'] => {
        const [col, dir] = sortState.split('-') as [SortColumn, string];
        return [(col || 'expected_delivery') as SortColumn, dir === 'desc' ? 'desc' : 'asc'];
    }, [sortState]);

    // Raw access to the shared router search params, used only by
    // clearFilters below — calling setSearch/setStatus/... synchronously in
    // one click handler has the same race described above, so clearFilters
    // resets them all in one setSearchParams call instead.
    const [, setSearchParamsRaw] = useSearchParams();

    const filters: BatchFilters = {
        search, status: status as any, mode: mode as any, vendor, carrier,
        itemTypePrefix, showDelivered: showDeliveredStr === '1', sortBy, sortDir
    };
    const setFilters = useCallback((next: BatchFilters) => {
        if (next.search !== search) setSearch(next.search);
        if (next.status !== status) setStatus(next.status as any);
        if (next.mode !== mode) setMode(next.mode as any);
        if (next.vendor !== vendor) setVendor(next.vendor);
        if (next.carrier !== carrier) setCarrier(next.carrier);
        if (next.itemTypePrefix !== itemTypePrefix) setItemTypePrefix(next.itemTypePrefix);
        const nextDeliveredStr = next.showDelivered ? '1' : '0';
        if (nextDeliveredStr !== showDeliveredStr) setShowDeliveredStr(nextDeliveredStr);
    }, [search, status, mode, vendor, carrier, itemTypePrefix, showDeliveredStr,
        setSearch, setStatus, setMode, setVendor, setCarrier, setItemTypePrefix, setShowDeliveredStr]);

    const handleSort = useCallback((column: SortColumn) => {
        if (sortBy === column) {
            setSortState(`${column}-${sortDir === 'asc' ? 'desc' : 'asc'}`);
        } else {
            setSortState(`${column}-desc`);
        }
    }, [sortBy, sortDir, setSortState]);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showDebug, setShowDebug] = useState(false);
    const [lastRequest, setLastRequest] = useState<any>(null);
    const [lastResponse, setLastResponse] = useState<any>(null);
    const [editingBatch, setEditingBatch] = useState<Batch | null>(null);

    // Accordion state: only one batch open at a time, only one shipment
    // within it open at a time — switching batches always resets the
    // shipment selection.
    const [openBatchId, setOpenBatchId] = useState<string | null>(null);
    const [openShipmentId, setOpenShipmentId] = useState<string | null>(null);
    const [uploadTarget, setUploadTarget] = useState<{ batchId: string; vendor: BatchVendorShipment } | null>(null);
    const [savingFlagKey, setSavingFlagKey] = useState<string | null>(null);

    const fetchData = useCallback(async (forceRefresh = false) => {
        if (!forceRefresh && batchListCache) {
            setBatches(batchListCache.batches);
            setMetrics(batchListCache.metrics);
            return;
        }
        setIsLoading(true);
        setError(null);
        const payload = { action: 'get_batches' };
        setLastRequest(payload);
        try {
            const result = await callGasAuthed('get_batches');
            setLastResponse(result);
            if (result.status === 'success') {
                const newBatches = result.batches || [];
                const newMetrics = result.metrics || null;
                setBatches(newBatches);
                setMetrics(newMetrics);
                batchListCache = { batches: newBatches, metrics: newMetrics, timestamp: Date.now() };
            } else {
                throw new Error(result.message || 'Failed to load batches');
            }
        } catch (err: any) {
            console.error('Fetch error:', err);
            setError(err.message || 'Network Failure');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(false); }, [fetchData]);

    useEffect(() => {
        if (categoryCache) { setCategories(categoryCache); return; }
        callGasAuthed('get_sku_categories')
            .then(result => {
                if (result.status === 'success') {
                    categoryCache = result.categories || [];
                    setCategories(categoryCache);
                }
            })
            .catch(err => console.error('get_sku_categories failed:', err));
    }, []);

    const itemTypeOptions = useMemo(() => buildItemTypeOptions(categories), [categories]);
    const vendorOptions = useMemo(() => {
        const set = new Set<string>();
        batches.forEach(b => (b.vendor_shipments || []).forEach(v => v.vendor_code && set.add(v.vendor_code)));
        return Array.from(set).sort();
    }, [batches]);
    const carrierOptions = useMemo(() => {
        const set = new Set<string>();
        batches.forEach(b => b.carrier && set.add(b.carrier));
        return Array.from(set).sort();
    }, [batches]);

    const filteredBatches = useMemo(() => {
        let filtered = [...batches];
        // Delivered batches are the bulk of the sheet and not what ops needs
        // to watch day to day — hidden unless explicitly asked for (either
        // the "Show Delivered" toggle, or picking Delivered in the Status
        // filter itself).
        if (!filters.showDelivered && filters.status !== 'Delivered') {
            filtered = filtered.filter(b => b.status !== 'Delivered');
        }
        if (filters.search) {
            const s = filters.search.toLowerCase();
            filtered = filtered.filter(b =>
                String(b.batch_id || '').toLowerCase().includes(s) ||
                String(b.tracking_number || '').toLowerCase().includes(s) ||
                (b.vendor_shipments || []).some(v => v.line_items.some(li => lineMatchesTerm(li, s)))
            );
        }
        if (filters.status !== 'All') filtered = filtered.filter(b => b.status === filters.status);
        if (filters.mode !== 'All') filtered = filtered.filter(b => b.batch_type === filters.mode);
        if (filters.vendor !== 'All') filtered = filtered.filter(b => (b.vendor_shipments || []).some(v => v.vendor_code === filters.vendor));
        if (filters.carrier !== 'All') filtered = filtered.filter(b => b.carrier === filters.carrier);
        if (filters.itemTypePrefix !== 'All') filtered = filtered.filter(b => (b.item_type_prefixes || []).includes(filters.itemTypePrefix));

        const cmp = COLUMN_COMPARATORS[filters.sortBy] || COLUMN_COMPARATORS.expected_delivery;
        const dir = filters.sortDir === 'asc' ? 1 : -1;
        return [...filtered].sort((a, b) => dir * cmp(a, b));
    }, [batches, filters]);

    const handleRowClick = (batch: Batch) => {
        setOpenBatchId(prev => {
            const next = prev === batch.batch_id ? null : batch.batch_id;
            if (next) {
                // Opening while a SKU/item search is active: jump straight to
                // the shipment containing the match instead of making the
                // user re-find it by hand among possibly several shipments.
                const term = filters.search.trim().toLowerCase();
                const matchedShipment = term
                    ? (batch.vendor_shipments || []).find(v => v.line_items.some(li => lineMatchesTerm(li, term)))
                    : null;
                setOpenShipmentId(matchedShipment ? matchedShipment.shipment_id : null);
            } else {
                setOpenShipmentId(null);
            }
            return next;
        });
    };

    const handleToggleShipment = (shipmentId: string) => {
        setOpenShipmentId(prev => (prev === shipmentId ? null : shipmentId));
    };

    // Applies a saved tracking edit to the in-memory batch list directly,
    // instead of re-running the full get_batches computation (every batch,
    // every shipment, every line item) just to reflect the handful of fields
    // the modal just changed — that refetch is what made "Save" feel slow.
    const handleTrackingSaved = useCallback((updates: Partial<Batch> & { batch_id: string }) => {
        const today = new Date();
        setBatches(prev => {
            const next = prev.map(b => {
                if (b.batch_id !== updates.batch_id) return b;
                const merged = { ...b, ...updates };
                if (merged.expected_delivery && !merged.actual_delivery) {
                    const expectedDate = new Date(merged.expected_delivery);
                    merged.is_delayed = today > expectedDate;
                    merged.delay_days = merged.is_delayed ? Math.floor((today.getTime() - expectedDate.getTime()) / 86400000) : 0;
                } else {
                    merged.is_delayed = false;
                    merged.delay_days = 0;
                }
                return merged;
            });
            if (batchListCache) batchListCache = { ...batchListCache, batches: next };
            return next;
        });
    }, []);

    const handleToggleFlag = useCallback(async (
        batchId: string, lineId: string, flag: 'logo' | 'packaging' | 'manual' | 'opp_wrap', value: boolean
    ) => {
        const key = `${lineId}:${flag}`;
        setSavingFlagKey(key);
        try {
            const result = await callGasAuthed('update_shipment_line_flag', { line_id: lineId, flag, value });
            if (result.status !== 'success') {
                alert(result.message || 'Failed to update');
                return;
            }
            const fieldName = flag === 'logo' ? 'has_logo' : flag === 'packaging' ? 'has_packaging' : flag === 'manual' ? 'has_manual' : 'has_opp_wrap';
            setBatches(prev => {
                const next = prev.map(b => {
                    if (b.batch_id !== batchId) return b;
                    return {
                        ...b,
                        vendor_shipments: (b.vendor_shipments || []).map(vs => ({
                            ...vs,
                            line_items: vs.line_items.map(li => li.line_id === lineId ? { ...li, [fieldName]: value } : li)
                        }))
                    };
                });
                if (batchListCache) batchListCache = { ...batchListCache, batches: next };
                return next;
            });
        } catch (err: any) {
            console.error('Flag toggle failed:', err);
            alert('Network error updating flag');
        } finally {
            setSavingFlagKey(null);
        }
    }, []);

    const clearFilters = () => {
        setSearch('');
        setSearchParamsRaw(prev => {
            const params = new URLSearchParams(prev);
            ['status', 'mode', 'vendor', 'carrier', 'itemType', 'delivered', 'sort'].forEach(k => params.delete(k));
            return params;
        }, { replace: true });
    };

    return (
        <div className="p-6 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-24">
            <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                        Shipment Tracker
                        {isAdmin && <span className="ml-2 px-2 py-0.5 bg-red-500/20 text-red-500 border border-red-500/30 rounded text-[10px] font-bold uppercase tracking-widest align-middle">Admin</span>}
                    </h1>
                </div>
                <Button
                    variant="secondary"
                    onClick={() => fetchData(true)}
                    disabled={isLoading}
                    icon={<ArrowPathIcon className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />}
                >
                    Refresh Data
                </Button>
            </div>

            <DashboardCards metrics={metrics} isLoading={isLoading} />
            <FilterBar
                filters={filters}
                setFilters={setFilters}
                vendorOptions={vendorOptions}
                carrierOptions={carrierOptions}
                itemTypeOptions={itemTypeOptions}
            />

            {error && (
                <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4 mb-6 flex items-center gap-3">
                    <ExclamationTriangleIcon className="w-5 h-5 text-red-500 shrink-0" />
                    <p className="text-red-600 dark:text-red-400 text-sm font-medium">{error}</p>
                    <button onClick={() => fetchData(true)} className="ml-auto text-xs text-red-500 hover:text-red-700 font-bold underline">Retry</button>
                </div>
            )}

            {!isLoading && (
                <div className="mb-4 flex items-center justify-between">
                    <p className="text-[10px] text-slate-500 dark:text-slate-500 font-bold uppercase tracking-widest">
                        Showing {filteredBatches.length} of {batches.length} batches
                    </p>
                    {batchListCache && (
                        <span className="text-[9px] text-slate-400 dark:text-slate-500 italic">
                            Last synced: {new Date(batchListCache.timestamp).toLocaleTimeString()}
                        </span>
                    )}
                </div>
            )}

            {isLoading && !batchListCache ? (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 animate-pulse h-64 shadow-sm" />
            ) : filteredBatches.length === 0 ? (
                <div className="text-center py-24 bg-white dark:bg-slate-800 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 shadow-sm">
                    <BoxIcon className="w-16 h-16 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
                    <p className="text-lg text-slate-600 dark:text-slate-300 font-medium">No batches matching your search</p>
                    <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Try adjusting your filters or clearing search query</p>
                    <button
                        className="mt-6 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors text-sm font-medium"
                        onClick={clearFilters}
                    >
                        Clear Filters
                    </button>
                </div>
            ) : (
                <div className={`bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-900/50 text-[10px] font-bold text-slate-500 dark:text-slate-500 uppercase tracking-widest border-b border-slate-200 dark:border-slate-700">
                                    <SortableHeader column="batch_id" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                    <SortableHeader column="mode" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                    <SortableHeader column="status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                    <SortableHeader column="ee_status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                    <SortableHeader column="expected_delivery" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                    <SortableHeader column="delay" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                    <SortableHeader column="carrier" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                    <SortableHeader column="tracking_number" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                    <SortableHeader column="vendors" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="right" />
                                    <SortableHeader column="cartons" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="right" />
                                    <SortableHeader column="units" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="right" />
                                    {isAdmin && <th className="px-4 py-3 text-center">Edit</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                {filteredBatches.map(batch => {
                                    const sc = getStatusConfig(batch.status);
                                    const ModeIcon = batch.batch_type === 'sea' ? ShipIcon : AirplaneIcon;
                                    const isOpen = openBatchId === batch.batch_id;
                                    return (
                                        <React.Fragment key={batch.batch_id}>
                                            <tr
                                                onClick={() => handleRowClick(batch)}
                                                className={`hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors cursor-pointer ${isOpen ? 'bg-blue-50/60 dark:bg-blue-500/5' : ''}`}
                                            >
                                                <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                                                    <span className={`inline-block w-3 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span> {batch.batch_id}
                                                </td>
                                                <td className="px-4 py-3"><ModeIcon className="w-4 h-4 text-slate-400 dark:text-slate-500" /></td>
                                                <td className="px-4 py-3">
                                                    <span className={`inline-block px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${sc.badge}`}>{sc.label}</span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    {batch.ee_status === 'FAILED' ? (
                                                        <span
                                                            title={batch.ee_push_error || 'EasyEcom PO push failed'}
                                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider whitespace-nowrap text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-400/10"
                                                        >
                                                            <ExclamationTriangleIcon className="w-3 h-3" /> Failed
                                                        </span>
                                                    ) : batch.ee_status === 'PUSHED' ? (
                                                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider whitespace-nowrap text-emerald-600 bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-400/10">
                                                            Pushed
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-400 dark:text-slate-600 text-xs">—</span>
                                                    )}
                                                </td>
                                                <td className={`px-4 py-3 text-sm whitespace-nowrap ${batch.is_delayed ? 'text-red-500 dark:text-red-400 font-semibold' : 'text-slate-700 dark:text-slate-300'}`}>
                                                    {formatDate(batch.expected_delivery)}
                                                </td>
                                                <td className="px-4 py-3 text-sm">
                                                    {batch.is_delayed ? (
                                                        <span className="flex items-center gap-1 text-red-500 dark:text-red-400 font-bold whitespace-nowrap">
                                                            <ExclamationTriangleIcon className="w-3.5 h-3.5" /> {batch.delay_days}d
                                                        </span>
                                                    ) : <span className="text-slate-400">—</span>}
                                                </td>
                                                <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300 whitespace-nowrap">{batch.carrier || <span className="italic text-slate-400">No carrier</span>}</td>
                                                <td className="px-4 py-3 text-xs font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">{batch.tracking_number || <span className="italic">No tracking</span>}</td>
                                                <td className="px-4 py-3 text-right text-sm text-slate-700 dark:text-slate-300">{batch.total_vendors}</td>
                                                <td className="px-4 py-3 text-right text-sm text-slate-700 dark:text-slate-300">{batch.total_cartons}</td>
                                                <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900 dark:text-slate-100">{batch.total_units}</td>
                                                {isAdmin && (
                                                    <td className="px-4 py-3 text-center">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setEditingBatch(batch); }}
                                                            className="p-1.5 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 dark:hover:text-blue-400 transition-colors"
                                                            title="Edit tracking details"
                                                        >
                                                            <PencilIcon className="w-4 h-4" />
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                            {isOpen && (
                                                <tr>
                                                    <td colSpan={isAdmin ? 12 : 11} className="p-0 border-t-0">
                                                        <div className="bg-slate-100/70 dark:bg-slate-900/40 border-t border-b-2 border-blue-500/60 px-4 py-4 space-y-2">
                                                            {(batch.vendor_shipments || []).length === 0 ? (
                                                                <p className="text-sm text-slate-500 dark:text-slate-400 italic px-2">
                                                                    This batch is still OPEN — no vendor shipments added yet.
                                                                </p>
                                                            ) : batch.vendor_shipments!.map(vendorShipment => (
                                                                <ShipmentRow
                                                                    key={vendorShipment.shipment_id}
                                                                    vendor={vendorShipment}
                                                                    batchId={batch.batch_id}
                                                                    isExpanded={openShipmentId === vendorShipment.shipment_id}
                                                                    onToggle={() => handleToggleShipment(vendorShipment.shipment_id)}
                                                                    isAdmin={isAdmin}
                                                                    savingKey={savingFlagKey}
                                                                    onToggleFlag={(lineId, flag, value) => handleToggleFlag(batch.batch_id, lineId, flag, value)}
                                                                    onUpload={() => setUploadTarget({ batchId: batch.batch_id, vendor: vendorShipment })}
                                                                    highlightTerm={filters.search.trim().toLowerCase()}
                                                                />
                                                            ))}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {editingBatch && (
                <EditBatchTrackingModal
                    batch={editingBatch}
                    onClose={() => setEditingBatch(null)}
                    onSaved={handleTrackingSaved}
                />
            )}

            {uploadTarget && (
                <UploadShipmentDocsModal
                    batchId={uploadTarget.batchId}
                    shipmentId={uploadTarget.vendor.shipment_id}
                    vendorCode={uploadTarget.vendor.vendor_code}
                    onClose={() => setUploadTarget(null)}
                    onUploaded={() => fetchData(true)}
                />
            )}

            <div className="mt-12 pt-8 border-t border-slate-200 dark:border-slate-800">
                <button
                    onClick={() => setShowDebug(!showDebug)}
                    className="text-[10px] font-bold text-slate-400 hover:text-blue-500 uppercase tracking-widest transition-colors flex items-center gap-2"
                >
                    <ArrowPathIcon className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                    {showDebug ? 'Hide Network Info' : 'Show Network Debug'}
                </button>
                {showDebug && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4 animate-in slide-in-from-bottom-2 duration-200">
                        <div className="space-y-1">
                            <span className="text-[9px] font-bold text-slate-500 uppercase">Last Request</span>
                            <pre className="bg-slate-900 border border-slate-800 p-4 rounded-lg text-[10px] font-mono text-slate-400 overflow-auto max-h-[300px]">
                                {lastRequest ? JSON.stringify(lastRequest, null, 2) : '// No request recorded'}
                            </pre>
                        </div>
                        <div className="space-y-1">
                            <span className="text-[9px] font-bold text-slate-500 uppercase">Last Response</span>
                            <pre className="bg-slate-900 border border-slate-800 p-4 rounded-lg text-[10px] font-mono text-slate-400 overflow-auto max-h-[300px]">
                                {lastResponse ? JSON.stringify(lastResponse, null, 2) : '// No response recorded'}
                            </pre>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
