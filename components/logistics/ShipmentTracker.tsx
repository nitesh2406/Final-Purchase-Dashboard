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
    PencilIcon
} from '../icons/Icons';
import { Batch, BatchFilters, BatchMetrics, SkuCategory } from '../../types';
import { callGasAuthed } from '../../services/gasApi';
import { Button } from '../ui/Button';
import { useQueryParam, useQueryParamFast } from '../../hooks/useQueryParam';
import { EditBatchTrackingModal } from './EditBatchTrackingModal';

// Module-level cache — one shared cache now that Tracker and Finance are a
// single screen (previously each had its own, which is what made an edit on
// one screen look "stale" on the other until its own Refresh was clicked).
let batchListCache: {
    batches: Batch[];
    metrics: BatchMetrics | null;
    timestamp: number;
} | null = null;

let categoryCache: SkuCategory[] | null = null;

const STATUS_CONFIG: Record<string, { label: string; badge: string }> = {
    'Shipped':           { label: 'Shipped',           badge: 'bg-purple-100 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400' },
    'In-Transit China':  { label: 'In-Transit China',  badge: 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400' },
    'At Port China':     { label: 'At Port China',     badge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-400' },
    'In-Transit Ocean':  { label: 'In-Transit Ocean',  badge: 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400' },
    'In-Transit Air':    { label: 'In-Transit Air',    badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400' },
    'Customs Clearance': { label: 'Customs Clearance', badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400' },
    'In-Transit India':  { label: 'In-Transit India',  badge: 'bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400' },
    'Out for Delivery':  { label: 'Out for Delivery',  badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
    'Delivered':         { label: 'Delivered',         badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' },
    'OPEN':              { label: 'Open',              badge: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};

const getStatusConfig = (status: string) =>
    STATUS_CONFIG[status] || { label: status, badge: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' };

const PAYMENT_STATUS_BADGE: Record<string, string> = {
    'Paid': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
    'Partial': 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
    'Unpaid': 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400',
};

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
    isAdmin: boolean;
}> = ({ filters, setFilters, vendorOptions, carrierOptions, itemTypeOptions, isAdmin }) => {
    return (
        <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 mb-6 shadow-sm space-y-3">
            <div className="flex flex-col lg:flex-row lg:flex-wrap gap-3">
                <div className="flex-1 min-w-[220px]">
                    <div className="relative">
                        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
                        <input
                            type="text"
                            placeholder="Search by Batch ID, Tracking..."
                            value={filters.search}
                            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                </div>

                <select
                    value={filters.status}
                    onChange={(e) => setFilters({ ...filters, status: e.target.value as any })}
                    className="px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="All">All Statuses</option>
                    {Object.keys(STATUS_CONFIG).filter(s => s !== 'OPEN').map(s => <option key={s} value={s}>{s}</option>)}
                </select>

                <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                    {(['All', 'sea', 'air'] as const).map(mode => (
                        <button
                            key={mode}
                            onClick={() => setFilters({ ...filters, mode })}
                            className={`px-4 py-1.5 rounded-md font-bold text-xs transition-all uppercase ${filters.mode === mode
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                }`}
                        >
                            {mode === 'All' ? 'ALL' : mode === 'sea' ? '🚢 SEA' : '✈️ AIR'}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-col lg:flex-row lg:flex-wrap gap-3">
                <select
                    value={filters.vendor}
                    onChange={(e) => setFilters({ ...filters, vendor: e.target.value })}
                    className="flex-1 min-w-[140px] px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="All">All Vendors</option>
                    {vendorOptions.map(v => <option key={v} value={v}>{v}</option>)}
                </select>

                <select
                    value={filters.carrier}
                    onChange={(e) => setFilters({ ...filters, carrier: e.target.value })}
                    className="flex-1 min-w-[140px] px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="All">All Carriers</option>
                    {carrierOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>

                <select
                    value={filters.itemTypePrefix}
                    onChange={(e) => setFilters({ ...filters, itemTypePrefix: e.target.value })}
                    className="flex-1 min-w-[140px] px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="All">All Item Types</option>
                    {itemTypeOptions.map(o => <option key={o.prefix} value={o.prefix}>{o.label}</option>)}
                </select>

                <div className="flex items-center gap-2 flex-wrap">
                    <input
                        type="date"
                        value={filters.dateFrom}
                        onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                        className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        title="Shipped from"
                    />
                    <span className="text-slate-400 text-xs">to</span>
                    <input
                        type="date"
                        value={filters.dateTo}
                        onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                        className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        title="Shipped to"
                    />
                </div>

                {isAdmin && (
                    <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
                        {(['All', 'Unpaid', 'Partial', 'Paid'] as const).map(p => (
                            <button
                                key={p}
                                onClick={() => setFilters({ ...filters, paymentStatus: p })}
                                className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${
                                    (filters.paymentStatus || 'All') === p ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                }`}
                            >
                                {p}
                            </button>
                        ))}
                    </div>
                )}

                <select
                    value={filters.sortBy}
                    onChange={(e) => setFilters({ ...filters, sortBy: e.target.value as any })}
                    className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="expected_delivery">Sort: Expected Delivery</option>
                    <option value="batch_id">Sort: Batch ID</option>
                    <option value="shipped_at">Sort: Shipped Date</option>
                    <option value="total_value">Sort: Total Value</option>
                </select>
            </div>
        </div>
    );
};

interface ShipmentTrackerProps {
    onNavigateToBatch?: (id: string) => void;
    isAdmin?: boolean;
}

export const ShipmentTracker: React.FC<ShipmentTrackerProps> = ({ onNavigateToBatch, isAdmin = false }) => {
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
    const [dateFrom, setDateFrom] = useQueryParam<string>('dateFrom', '');
    const [dateTo, setDateTo] = useQueryParam<string>('dateTo', '');
    const [itemTypePrefix, setItemTypePrefix] = useQueryParam<string>('itemType', 'All');
    const [sortBy, setSortBy] = useQueryParam<BatchFilters['sortBy']>('sortBy', 'expected_delivery');
    const [paymentStatus, setPaymentStatus] = useQueryParam<NonNullable<BatchFilters['paymentStatus']>>('paymentStatus', 'All');

    const filters: BatchFilters = {
        search, status: status as any, mode: mode as any, vendor, carrier,
        dateFrom, dateTo, itemTypePrefix, sortBy, paymentStatus
    };
    const setFilters = useCallback((next: BatchFilters) => {
        if (next.search !== search) setSearch(next.search);
        if (next.status !== status) setStatus(next.status as any);
        if (next.mode !== mode) setMode(next.mode as any);
        if (next.vendor !== vendor) setVendor(next.vendor);
        if (next.carrier !== carrier) setCarrier(next.carrier);
        if (next.dateFrom !== dateFrom) setDateFrom(next.dateFrom);
        if (next.dateTo !== dateTo) setDateTo(next.dateTo);
        if (next.itemTypePrefix !== itemTypePrefix) setItemTypePrefix(next.itemTypePrefix);
        if (next.sortBy !== sortBy) setSortBy(next.sortBy);
        if (next.paymentStatus !== paymentStatus) setPaymentStatus(next.paymentStatus || 'All');
    }, [search, status, mode, vendor, carrier, dateFrom, dateTo, itemTypePrefix, sortBy, paymentStatus,
        setSearch, setStatus, setMode, setVendor, setCarrier, setDateFrom, setDateTo, setItemTypePrefix, setSortBy, setPaymentStatus]);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showDebug, setShowDebug] = useState(false);
    const [lastRequest, setLastRequest] = useState<any>(null);
    const [lastResponse, setLastResponse] = useState<any>(null);
    const [editingBatchId, setEditingBatchId] = useState<string | null>(null);

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
        batches.forEach(b => (b.vendor_summary || []).forEach(v => v.vendor_code && set.add(v.vendor_code)));
        return Array.from(set).sort();
    }, [batches]);
    const carrierOptions = useMemo(() => {
        const set = new Set<string>();
        batches.forEach(b => b.carrier && set.add(b.carrier));
        return Array.from(set).sort();
    }, [batches]);

    const filteredBatches = useMemo(() => {
        let filtered = [...batches];
        if (filters.search) {
            const s = filters.search.toLowerCase();
            filtered = filtered.filter(b =>
                String(b.batch_id || '').toLowerCase().includes(s) ||
                String(b.tracking_number || '').toLowerCase().includes(s)
            );
        }
        if (filters.status !== 'All') filtered = filtered.filter(b => b.status === filters.status);
        if (filters.mode !== 'All') filtered = filtered.filter(b => b.batch_type === filters.mode);
        if (filters.vendor !== 'All') filtered = filtered.filter(b => (b.vendor_summary || []).some(v => v.vendor_code === filters.vendor));
        if (filters.carrier !== 'All') filtered = filtered.filter(b => b.carrier === filters.carrier);
        if (filters.itemTypePrefix !== 'All') filtered = filtered.filter(b => (b.item_type_prefixes || []).includes(filters.itemTypePrefix));
        if (filters.dateFrom) filtered = filtered.filter(b => b.shipped_at && b.shipped_at.slice(0, 10) >= filters.dateFrom);
        if (filters.dateTo) filtered = filtered.filter(b => b.shipped_at && b.shipped_at.slice(0, 10) <= filters.dateTo);
        if (isAdmin && filters.paymentStatus && filters.paymentStatus !== 'All') {
            filtered = filtered.filter(b => b.payment_status === filters.paymentStatus);
        }

        const sorted = [...filtered];
        switch (filters.sortBy) {
            case 'batch_id':
                sorted.sort((a, b) => a.batch_id.localeCompare(b.batch_id));
                break;
            case 'shipped_at':
                sorted.sort((a, b) => new Date(b.shipped_at || 0).getTime() - new Date(a.shipped_at || 0).getTime());
                break;
            case 'total_value':
                sorted.sort((a, b) => (b.total_value_rmb || 0) - (a.total_value_rmb || 0));
                break;
            case 'expected_delivery':
            default:
                sorted.sort((a, b) => {
                    if (!a.expected_delivery) return 1;
                    if (!b.expected_delivery) return -1;
                    return new Date(a.expected_delivery).getTime() - new Date(b.expected_delivery).getTime();
                });
        }
        return sorted;
    }, [batches, filters, isAdmin]);

    const handleViewDetails = (batchId: string) => {
        if (onNavigateToBatch) onNavigateToBatch(batchId);
    };

    const clearFilters = () => setFilters({
        search: '', status: 'All', mode: 'All', vendor: 'All', carrier: 'All',
        dateFrom: '', dateTo: '', itemTypePrefix: 'All', sortBy: 'expected_delivery', paymentStatus: 'All'
    });

    return (
        <div className="p-6 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-24">
            <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Shipment Tracker</h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">
                        Consolidated container tracking & landing reconciliation
                        {isAdmin && <span className="ml-2 px-2 py-0.5 bg-red-500/20 text-red-500 border border-red-500/30 rounded text-[10px] font-bold uppercase tracking-widest align-middle">Admin</span>}
                    </p>
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
                isAdmin={isAdmin}
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
                                    <th className="px-4 py-3">Batch ID</th>
                                    <th className="px-4 py-3">Mode</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3">Expected Delivery</th>
                                    <th className="px-4 py-3">Delay</th>
                                    <th className="px-4 py-3">Carrier</th>
                                    <th className="px-4 py-3">Tracking Number</th>
                                    <th className="px-4 py-3 text-right">Vendors</th>
                                    <th className="px-4 py-3 text-right">Cartons</th>
                                    <th className="px-4 py-3 text-right">Units</th>
                                    {isAdmin && <th className="px-4 py-3">Payment Status</th>}
                                    {isAdmin && <th className="px-4 py-3 text-right">Total Amount (RMB)</th>}
                                    {isAdmin && <th className="px-4 py-3 text-right">INR Equivalent</th>}
                                    {isAdmin && <th className="px-4 py-3 text-center">Edit</th>}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                {filteredBatches.map(batch => {
                                    const sc = getStatusConfig(batch.status);
                                    const ModeIcon = batch.batch_type === 'sea' ? ShipIcon : AirplaneIcon;
                                    return (
                                        <tr
                                            key={batch.batch_id}
                                            onClick={() => handleViewDetails(batch.batch_id)}
                                            className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors cursor-pointer"
                                        >
                                            <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">{batch.batch_id}</td>
                                            <td className="px-4 py-3"><ModeIcon className="w-4 h-4 text-slate-400 dark:text-slate-500" /></td>
                                            <td className="px-4 py-3">
                                                <span className={`inline-block px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${sc.badge}`}>{sc.label}</span>
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
                                                <td className="px-4 py-3">
                                                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${PAYMENT_STATUS_BADGE[batch.payment_status || 'Unpaid']}`}>
                                                        {batch.payment_status || 'Unpaid'}
                                                    </span>
                                                </td>
                                            )}
                                            {isAdmin && (
                                                <td className="px-4 py-3 text-right text-sm text-slate-700 dark:text-slate-300 whitespace-nowrap">
                                                    {batch.total_currency} {batch.total_amount?.toLocaleString()}
                                                </td>
                                            )}
                                            {isAdmin && (
                                                <td className="px-4 py-3 text-right text-sm font-semibold whitespace-nowrap">
                                                    {batch.amount_inr != null
                                                        ? <span className="text-blue-600 dark:text-blue-400">₹{batch.amount_inr.toLocaleString()}</span>
                                                        : <span className="text-amber-600 dark:text-amber-500 text-xs">Rate N/A</span>}
                                                </td>
                                            )}
                                            {isAdmin && (
                                                <td className="px-4 py-3 text-center">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setEditingBatchId(batch.batch_id); }}
                                                        className="p-1.5 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 dark:hover:text-blue-400 transition-colors"
                                                        title="Edit tracking details"
                                                    >
                                                        <PencilIcon className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {editingBatchId && (
                <EditBatchTrackingModal
                    batchId={editingBatchId}
                    onClose={() => setEditingBatchId(null)}
                    onSaved={() => fetchData(true)}
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
