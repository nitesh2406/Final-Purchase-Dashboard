import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { callGas } from '../../services/gasApi';
import { InventoryValuationRow } from '../../types';
import { useQueryParam, useQueryParamFast } from '../../hooks/useQueryParam';
import { AggregatedRow, aggregateInventory, summarizeInventory, isZeroStock } from '../../utils/inventoryAggregation';
import { toCsv, downloadCsv } from '../../utils/csv';
import {
    ArchiveBoxIcon,
    CubeIcon,
    BanknotesIcon,
    MagnifyingGlassIcon,
    ArrowPathIcon,
    ChevronUpIcon,
    ChevronDownIcon,
    ExclamationTriangleIcon,
} from '../icons/Icons';

// What the backend snapshot says about the data behind the rows — when the
// sheet was last synced (not when this browser fetched it), and any warning
// from a degraded sync. All optional: an older backend returns none of it.
interface InventoryMeta {
    generatedAt: string | null;
    syncedAt: string | null;
    amazonSyncedAt: string | null;
    warning: string;
}

// Module-level cache, matching the pattern in ShipmentTracker.tsx — avoids
// refetching every time the user navigates back to this tab. It expires: the
// backend now serves a precomputed snapshot (cheap to re-fetch), and without a
// TTL a value cached at the wrong moment stayed on screen until Refresh.
const CACHE_TTL_MS = 10 * 60 * 1000;
// Sync normally runs daily; past this the numbers are worth a warning.
const STALE_AFTER_HOURS = 36;
// Reads can stall for minutes (measured 180s once); bound each attempt so the
// retries below actually get a chance instead of the spinner hanging.
const FETCH_TIMEOUT_MS = 45_000;

let inventoryCache: { rows: InventoryValuationRow[]; meta: InventoryMeta; fetchedAt: number } | null = null;

type SortColumn = 'sku' | 'name' | 'brand' | 'category' | 'in_stock' | 'inbound' | 'total_qty' | 'cost_inr' | 'cost_rmb' | 'valuation';
type SortDirection = 'asc' | 'desc';
type IssueFilter = 'All' | 'Unvalued' | 'Negative';

function getSortValue(row: AggregatedRow, column: SortColumn): string | number {
    switch (column) {
        case 'sku': return row.sku;
        case 'name': return row.name || '';
        case 'brand': return row.brand || '';
        case 'category': return row.category || '';
        case 'in_stock': return row.in_stock;
        case 'inbound': return row.inbound;
        case 'total_qty': return row.total_qty;
        case 'cost_inr': return row.cost_inr ?? -1;
        case 'cost_rmb': return row.cost_rmb ?? -1;
        case 'valuation': return row.valuation ?? -1;
        default: return '';
    }
}

const formatNumber = (n: number) => n.toLocaleString('en-IN');
const formatCurrency = (n: number | null) => n == null ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const formatRmb = (n: number | null) => n == null ? '—' : `¥${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const formatStamp = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const hoursSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3_600_000;

const SortableHeader: React.FC<{
    column: SortColumn;
    label: string;
    sortColumn: SortColumn;
    sortDirection: SortDirection;
    onSort: (column: SortColumn) => void;
    align?: 'left' | 'right';
}> = ({ column, label, sortColumn, sortDirection, onSort, align = 'left' }) => (
    <th
        onClick={() => onSort(column)}
        className={`px-4 py-3 cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-200 transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
        <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
            {label}
            {sortColumn === column && (
                sortDirection === 'asc' ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />
            )}
        </span>
    </th>
);

export const InventoryValuation: React.FC = () => {
    const [rawRows, setRawRows] = useState<InventoryValuationRow[]>(inventoryCache?.rows || []);
    const [meta, setMeta] = useState<InventoryMeta | null>(inventoryCache?.meta || null);
    const [fetchedAt, setFetchedAt] = useState<number | null>(inventoryCache?.fetchedAt || null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [search, setSearch] = useQueryParamFast('search', '');
    const [brand, setBrand] = useQueryParam<string>('brand', 'All');
    const [category, setCategory] = useQueryParam<string>('category', 'All');
    const [channel, setChannel] = useQueryParam<string>('channel', 'All');
    const [issues, setIssues] = useQueryParam<IssueFilter>('issues', 'All');
    // View preference, not a filter: 58% of SKUs hold no stock, so they're
    // hidden unless asked for. '1' = include them.
    const [includeZero, setIncludeZero] = useQueryParam<string>('zero', '0');

    // Column + direction live in one query param ("sku-asc") rather than two
    // separate useQueryParam hooks. Calling two react-router setSearchParams
    // setters synchronously in one click handler races — each computes its
    // update from the not-yet-committed previous URL, so only the second
    // call's change actually lands. One param, one setter, no race.
    const [sortState, setSortState] = useQueryParam<string>('sort', 'valuation-desc');
    const [sortColumn, sortDirection] = useMemo((): [SortColumn, SortDirection] => {
        const [col, dir] = sortState.split('-');
        return [(col || 'valuation') as SortColumn, dir === 'asc' ? 'asc' : 'desc'];
    }, [sortState]);

    // Raw access to the shared router search params, used only by
    // clearFilters below — same race as above would hit if it called
    // setBrand/setCategory/setChannel synchronously, so it clears them all
    // in one setSearchParams call instead.
    const [, setSearchParamsRaw] = useSearchParams();

    const fetchData = useCallback(async (forceRefresh = false) => {
        if (!forceRefresh && inventoryCache && Date.now() - inventoryCache.fetchedAt < CACHE_TTL_MS) {
            setRawRows(inventoryCache.rows);
            setMeta(inventoryCache.meta);
            setFetchedAt(inventoryCache.fetchedAt);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            // `force` makes the backend rebuild from the live sheets instead of
            // serving its snapshot (the Refresh button). Both are reads, so
            // they're safe to retry.
            const result = await callGas('get_inventory_valuation', forceRefresh ? { force: true } : {}, 2, FETCH_TIMEOUT_MS);
            if (result.status === 'success') {
                const newRows: InventoryValuationRow[] = result.records || [];
                const newMeta: InventoryMeta = {
                    generatedAt: result.generatedAt || null,
                    syncedAt: result.syncedAt || null,
                    amazonSyncedAt: result.amazonSyncedAt || null,
                    warning: result.warning || '',
                };
                const now = Date.now();
                setRawRows(newRows);
                setMeta(newMeta);
                setFetchedAt(now);
                inventoryCache = { rows: newRows, meta: newMeta, fetchedAt: now };
            } else {
                throw new Error(result.message || 'Failed to load inventory data');
            }
        } catch (err: any) {
            console.error('Fetch error:', err);
            setError(err.message || 'Network error');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(false); }, [fetchData]);

    const brandOptions = useMemo(() => {
        const set = new Set<string>();
        rawRows.forEach(r => r.brand && set.add(r.brand));
        return Array.from(set).sort();
    }, [rawRows]);

    const categoryOptions = useMemo(() => {
        const set = new Set<string>();
        rawRows.forEach(r => r.category && set.add(r.category));
        return Array.from(set).sort();
    }, [rawRows]);

    const channelOptions = useMemo(() => {
        const set = new Set<string>();
        rawRows.forEach(r => r.channel && set.add(r.channel));
        return Array.from(set).sort();
    }, [rawRows]);

    // Everything the filters act on, before any of them is applied — used for
    // the data-quality notice so it describes the whole picture for the
    // selected channel, not just whatever the current filters leave visible.
    const channelRows = useMemo(() => aggregateInventory(rawRows, channel), [rawRows, channel]);
    const dataIssues = useMemo(() => summarizeInventory(channelRows), [channelRows]);

    const aggregatedRows = useMemo<AggregatedRow[]>(() => {
        let result = channelRows;

        if (includeZero !== '1') result = result.filter(r => !isZeroStock(r));
        if (brand !== 'All') result = result.filter(r => r.brand === brand);
        if (category !== 'All') result = result.filter(r => r.category === category);
        if (issues === 'Unvalued') result = result.filter(r => r.unvalued);
        if (issues === 'Negative') result = result.filter(r => r.hasNegative);
        if (search) {
            const s = search.toLowerCase();
            result = result.filter(r =>
                r.sku.toLowerCase().includes(s) ||
                (r.name || '').toLowerCase().includes(s)
            );
        }

        const dir = sortDirection === 'asc' ? 1 : -1;
        return [...result].sort((a, b) => {
            const av = getSortValue(a, sortColumn);
            const bv = getSortValue(b, sortColumn);
            if (typeof av === 'string' && typeof bv === 'string') return dir * av.localeCompare(bv);
            return dir * ((av as number) - (bv as number));
        });
    }, [channelRows, includeZero, brand, category, issues, search, sortColumn, sortDirection]);

    const totals = useMemo(() => summarizeInventory(aggregatedRows), [aggregatedRows]);

    const handleSort = (column: SortColumn) => {
        if (sortColumn === column) {
            setSortState(`${column}-${sortDirection === 'asc' ? 'desc' : 'asc'}`);
        } else {
            setSortState(`${column}-desc`);
        }
    };

    const clearFilters = () => {
        setSearch('');
        setSearchParamsRaw(prev => {
            const params = new URLSearchParams(prev);
            params.delete('brand');
            params.delete('category');
            params.delete('channel');
            params.delete('issues');
            return params;
        }, { replace: true });
    };

    const hasActiveFilters = search !== '' || brand !== 'All' || category !== 'All' || channel !== 'All' || issues !== 'All';

    const handleExport = () => {
        const header = ['SKU', 'Name', 'Brand', 'Category', 'In Stock', 'Inbound', 'Total Qty', 'Landed Cost (INR)', 'Cost (RMB)', 'Valuation (INR)', 'Flags'];
        const body = aggregatedRows.map(r => [
            r.sku, r.name, r.brand, r.category, r.in_stock, r.inbound, r.total_qty, r.cost_inr, r.cost_rmb, r.valuation,
            [r.hasNegative && 'Negative stock (valued as 0)', r.unvalued && 'No cost (not in valuation)'].filter(Boolean).join('; '),
        ]);
        downloadCsv(`inventory_valuation_${new Date().toISOString().split('T')[0]}.csv`, toCsv([header, ...body]));
    };

    // ── Freshness ──
    const syncedAt = meta?.syncedAt || null;
    const isStale = !!syncedAt && hoursSince(syncedAt) > STALE_AFTER_HOURS;
    const amazonBehind = !!(syncedAt && meta?.amazonSyncedAt && meta.amazonSyncedAt !== syncedAt && !meta.warning);
    // A failed load with nothing on screen is "no data", not "zero inventory":
    // don't render 0 / ₹0 cards or a "nothing matches" message under the error.
    const loadFailedEmpty = !!error && rawRows.length === 0;

    return (
        <div className="p-6 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-24">
            <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Inventory</h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">Current stock position and landed-cost valuation across all channels</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleExport}
                        disabled={aggregatedRows.length === 0}
                        className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                    >
                        Export CSV
                    </button>
                    <button
                        onClick={() => fetchData(true)}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                    >
                        <ArrowPathIcon className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                        Refresh Data
                    </button>
                </div>
            </div>

            {(meta?.warning || isStale || amazonBehind) && (
                <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl p-4 mb-4 flex items-start gap-3">
                    <ExclamationTriangleIcon className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-800 dark:text-amber-300 space-y-1">
                        {meta?.warning && (
                            <p>
                                {meta.warning}
                                {meta.amazonSyncedAt && /Amazon/.test(meta.warning) && <> Last successful Amazon refresh: {formatStamp(meta.amazonSyncedAt)}.</>}
                            </p>
                        )}
                        {isStale && syncedAt && <p>Inventory was last synced {formatStamp(syncedAt)} — the numbers below may be out of date.</p>}
                        {amazonBehind && meta?.amazonSyncedAt && <p>Amazon figures are from {formatStamp(meta.amazonSyncedAt)}, older than the rest.</p>}
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {[
                    { label: includeZero === '1' ? 'Total SKUs' : 'SKUs In Stock', value: formatNumber(totals.totalSkus), icon: CubeIcon, color: 'text-blue-500' },
                    { label: 'Total Quantity', value: formatNumber(totals.totalQty), icon: ArchiveBoxIcon, color: 'text-indigo-500' },
                    { label: 'Total Valuation (landed cost)', value: formatCurrency(totals.totalValuation), icon: BanknotesIcon, color: 'text-emerald-500' },
                ].map((card, index) => {
                    const Icon = card.icon;
                    return (
                        <div key={index} className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-500 transition-colors shadow-sm">
                            <div className="flex items-center gap-2 mb-2">
                                <Icon className={`w-5 h-5 ${card.color}`} />
                                <span className="text-sm text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wide">{card.label}</span>
                            </div>
                            <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{loadFailedEmpty ? '—' : card.value}</div>
                        </div>
                    );
                })}
            </div>

            {(dataIssues.unvaluedSkus > 0 || dataIssues.negativeSkus > 0) && (
                <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                    {dataIssues.unvaluedSkus > 0 && (
                        <button
                            onClick={() => setIssues(issues === 'Unvalued' ? 'All' : 'Unvalued')}
                            className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 hover:underline"
                            title="Stocked SKUs with no cost in the EE Product Master (e.g. Discontinued / design categories). They count in Total Quantity but not in Total Valuation."
                        >
                            <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                            {formatNumber(dataIssues.unvaluedSkus)} SKU{dataIssues.unvaluedSkus !== 1 ? 's' : ''} ({formatNumber(dataIssues.unvaluedQty)} units) have no cost and are not in the valuation
                        </button>
                    )}
                    {dataIssues.negativeSkus > 0 && (
                        <button
                            onClick={() => setIssues(issues === 'Negative' ? 'All' : 'Negative')}
                            className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400 hover:underline"
                            title="A source row reports negative stock. The figure is shown as reported, but valued as 0."
                        >
                            <ExclamationTriangleIcon className="w-3.5 h-3.5" />
                            {formatNumber(dataIssues.negativeSkus)} SKU{dataIssues.negativeSkus !== 1 ? 's' : ''} with negative stock (valued as 0)
                        </button>
                    )}
                </div>
            )}

            <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 mb-6 shadow-sm">
                <div className="flex flex-col lg:flex-row gap-3">
                    <div className="flex-1 relative">
                        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
                        <input
                            type="text"
                            placeholder="Search by SKU or Name..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <select
                        value={brand}
                        onChange={(e) => setBrand(e.target.value)}
                        className="px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="All">All Brands</option>
                        {brandOptions.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                    <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="All">All Categories</option>
                        {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select
                        value={channel}
                        onChange={(e) => setChannel(e.target.value)}
                        className="px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="All">All Channels</option>
                        {channelOptions.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select
                        value={issues}
                        onChange={(e) => setIssues(e.target.value as IssueFilter)}
                        className="px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="All">All Data</option>
                        <option value="Unvalued">No cost only</option>
                        <option value="Negative">Negative stock only</option>
                    </select>
                </div>
                <label className="flex items-center gap-2 mt-3 text-xs text-slate-500 dark:text-slate-400 font-medium cursor-pointer select-none w-fit">
                    <input
                        type="checkbox"
                        checked={includeZero === '1'}
                        onChange={(e) => setIncludeZero(e.target.checked ? '1' : '0')}
                        className="rounded border-slate-300 dark:border-slate-600"
                    />
                    Include SKUs with no stock
                </label>
            </div>

            {error && (
                <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4 mb-6 flex items-center gap-3">
                    <ExclamationTriangleIcon className="w-5 h-5 text-red-500 shrink-0" />
                    <p className="text-red-600 dark:text-red-400 text-sm font-medium">{error}</p>
                    <button onClick={() => fetchData(true)} className="ml-auto text-xs text-red-500 hover:text-red-700 font-bold underline">Retry</button>
                </div>
            )}

            {!isLoading && !error && (
                <div className="mb-4 flex items-center justify-between">
                    <p className="text-[10px] text-slate-500 dark:text-slate-500 font-bold uppercase tracking-widest">
                        Showing {aggregatedRows.length} SKU{aggregatedRows.length !== 1 ? 's' : ''}
                    </p>
                    {(syncedAt || fetchedAt) && (
                        <span className="text-[9px] text-slate-400 dark:text-slate-500 italic">
                            {syncedAt
                                ? `Data as of ${formatStamp(syncedAt)}`
                                : `Fetched ${new Date(fetchedAt as number).toLocaleTimeString()}`}
                        </span>
                    )}
                </div>
            )}

            {isLoading && rawRows.length === 0 ? (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 animate-pulse h-64 shadow-sm" />
            ) : loadFailedEmpty ? null : aggregatedRows.length === 0 ? (
                <div className="text-center py-24 bg-white dark:bg-slate-800 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 shadow-sm">
                    <ArchiveBoxIcon className="w-16 h-16 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
                    <p className="text-lg text-slate-600 dark:text-slate-300 font-medium">No inventory matching your search</p>
                    <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">
                        Try adjusting your filters or clearing search query
                        {includeZero !== '1' && ' — SKUs with no stock are hidden'}
                    </p>
                    {hasActiveFilters && (
                        <button
                            className="mt-6 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors text-sm font-medium"
                            onClick={clearFilters}
                        >
                            Clear Filters
                        </button>
                    )}
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-900/50 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200 dark:border-slate-700">
                                    <SortableHeader column="sku" label="SKU" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                                    <SortableHeader column="name" label="Name" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                                    <SortableHeader column="brand" label="Brand" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                                    <SortableHeader column="category" label="Category" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} />
                                    <SortableHeader column="in_stock" label="In Stock" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} align="right" />
                                    <SortableHeader column="inbound" label="Inbound" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} align="right" />
                                    <SortableHeader column="total_qty" label="Total Qty" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} align="right" />
                                    <SortableHeader column="cost_inr" label="Landed Cost (INR)" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} align="right" />
                                    <SortableHeader column="cost_rmb" label="Cost (RMB)" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} align="right" />
                                    <SortableHeader column="valuation" label="Valuation" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} align="right" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                {aggregatedRows.map(row => (
                                    <tr key={row.sku} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                        <td className="px-4 py-3 font-mono text-xs font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">{row.sku}</td>
                                        <td className="px-4 py-3 text-sm text-slate-800 dark:text-slate-300">{row.name || '—'}</td>
                                        <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300 whitespace-nowrap">{row.brand || '—'}</td>
                                        <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300 whitespace-nowrap">{row.category || '—'}</td>
                                        <td className={`px-4 py-3 text-right text-sm ${row.in_stock < 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-slate-900 dark:text-slate-100'}`}>
                                            {row.hasNegative && (
                                                <span title="A source row reports negative stock. Shown as reported, valued as 0.">
                                                    <ExclamationTriangleIcon className="w-3.5 h-3.5 inline mr-1 -mt-0.5 text-red-500" />
                                                </span>
                                            )}
                                            {formatNumber(row.in_stock)}
                                        </td>
                                        <td className="px-4 py-3 text-right text-sm text-slate-900 dark:text-slate-100">{formatNumber(row.inbound)}</td>
                                        <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900 dark:text-slate-100">{formatNumber(row.total_qty)}</td>
                                        <td className="px-4 py-3 text-right text-sm text-slate-700 dark:text-slate-300">{formatCurrency(row.cost_inr)}</td>
                                        <td className="px-4 py-3 text-right text-sm text-slate-700 dark:text-slate-300">{formatRmb(row.cost_rmb)}</td>
                                        <td className="px-4 py-3 text-right text-sm font-bold text-emerald-600 dark:text-emerald-400">
                                            {row.unvalued ? (
                                                <span
                                                    title="No cost on file, so this stock is not in the valuation."
                                                    className="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                                                >
                                                    No cost
                                                </span>
                                            ) : formatCurrency(row.valuation)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};
