import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { APPS_SCRIPT_URL } from '../../constants';
import { InventoryValuationRow } from '../../types';
import { useQueryParam, useQueryParamFast } from '../../hooks/useQueryParam';
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

// Module-level cache, matching the pattern in ShipmentTracker.tsx — avoids
// refetching every time the user navigates back to this tab.
let inventoryCache: { rows: InventoryValuationRow[]; timestamp: number } | null = null;

type SortColumn = 'sku' | 'name' | 'brand' | 'category' | 'in_stock' | 'inbound' | 'total_qty' | 'cost_inr' | 'cost_rmb' | 'valuation';
type SortDirection = 'asc' | 'desc';

interface AggregatedRow {
    sku: string;
    name: string | null;
    brand: string | null;
    category: string | null;
    in_stock: number;
    inbound: number;
    total_qty: number;
    cost_inr: number | null;
    cost_rmb: number | null;
    valuation: number | null;
}

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
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [search, setSearch] = useQueryParamFast('search', '');
    const [brand, setBrand] = useQueryParam<string>('brand', 'All');
    const [category, setCategory] = useQueryParam<string>('category', 'All');
    const [channel, setChannel] = useQueryParam<string>('channel', 'All');

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
    // setBrand/setCategory/setChannel synchronously, so it clears all three
    // in one setSearchParams call instead.
    const [, setSearchParamsRaw] = useSearchParams();

    const fetchData = useCallback(async (forceRefresh = false) => {
        if (!forceRefresh && inventoryCache) {
            setRawRows(inventoryCache.rows);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'get_inventory_valuation' })
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const result = await response.json();
            if (result.status === 'success') {
                const newRows: InventoryValuationRow[] = result.records || [];
                setRawRows(newRows);
                inventoryCache = { rows: newRows, timestamp: Date.now() };
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

    const aggregatedRows = useMemo<AggregatedRow[]>(() => {
        // Channel filter changes what gets summed, not just which rows show —
        // "All" sums every channel's qty into one row per SKU; picking a
        // channel re-aggregates using only that channel's rows.
        const channelFiltered = channel === 'All' ? rawRows : rawRows.filter(r => r.channel === channel);

        const bySku = new Map<string, AggregatedRow>();
        channelFiltered.forEach(row => {
            const existing = bySku.get(row.sku);
            if (existing) {
                existing.in_stock += row.in_stock;
                existing.inbound += row.inbound;
            } else {
                bySku.set(row.sku, {
                    sku: row.sku,
                    name: row.name,
                    brand: row.brand,
                    category: row.category,
                    in_stock: row.in_stock,
                    inbound: row.inbound,
                    total_qty: 0,
                    cost_inr: row.cost_inr,
                    cost_rmb: row.cost_rmb,
                    valuation: null,
                });
            }
        });

        let result: AggregatedRow[] = Array.from(bySku.values()).map(r => {
            const total_qty = r.in_stock + r.inbound;
            return {
                ...r,
                total_qty,
                valuation: r.cost_inr == null ? null : total_qty * r.cost_inr,
            };
        });

        if (brand !== 'All') result = result.filter(r => r.brand === brand);
        if (category !== 'All') result = result.filter(r => r.category === category);
        if (search) {
            const s = search.toLowerCase();
            result = result.filter(r =>
                r.sku.toLowerCase().includes(s) ||
                (r.name || '').toLowerCase().includes(s)
            );
        }

        const dir = sortDirection === 'asc' ? 1 : -1;
        result.sort((a, b) => {
            const av = getSortValue(a, sortColumn);
            const bv = getSortValue(b, sortColumn);
            if (typeof av === 'string' && typeof bv === 'string') return dir * av.localeCompare(bv);
            return dir * ((av as number) - (bv as number));
        });

        return result;
    }, [rawRows, channel, brand, category, search, sortColumn, sortDirection]);

    const totals = useMemo(() => {
        const totalSkus = aggregatedRows.length;
        const totalQty = aggregatedRows.reduce((sum, r) => sum + r.total_qty, 0);
        const totalValuation = aggregatedRows.reduce((sum, r) => sum + (r.valuation || 0), 0);
        return { totalSkus, totalQty, totalValuation };
    }, [aggregatedRows]);

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
            return params;
        }, { replace: true });
    };

    const hasActiveFilters = search !== '' || brand !== 'All' || category !== 'All' || channel !== 'All';

    return (
        <div className="p-6 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-24">
            <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Inventory</h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">Current stock position and retail valuation across all channels</p>
                </div>
                <button
                    onClick={() => fetchData(true)}
                    disabled={isLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                    <ArrowPathIcon className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    Refresh Data
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {[
                    { label: 'Total SKUs', value: formatNumber(totals.totalSkus), icon: CubeIcon, color: 'text-blue-500' },
                    { label: 'Total Quantity', value: formatNumber(totals.totalQty), icon: ArchiveBoxIcon, color: 'text-indigo-500' },
                    { label: 'Total Valuation', value: formatCurrency(totals.totalValuation), icon: BanknotesIcon, color: 'text-emerald-500' },
                ].map((card, index) => {
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
                </div>
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
                    {inventoryCache && (
                        <span className="text-[9px] text-slate-400 dark:text-slate-500 italic">
                            Last synced: {new Date(inventoryCache.timestamp).toLocaleTimeString()}
                        </span>
                    )}
                </div>
            )}

            {isLoading && !inventoryCache ? (
                <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 animate-pulse h-64 shadow-sm" />
            ) : aggregatedRows.length === 0 ? (
                <div className="text-center py-24 bg-white dark:bg-slate-800 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 shadow-sm">
                    <ArchiveBoxIcon className="w-16 h-16 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
                    <p className="text-lg text-slate-600 dark:text-slate-300 font-medium">No inventory matching your search</p>
                    <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Try adjusting your filters or clearing search query</p>
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
                                    <SortableHeader column="cost_inr" label="Cost (INR)" sortColumn={sortColumn} sortDirection={sortDirection} onSort={handleSort} align="right" />
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
                                        <td className="px-4 py-3 text-right text-sm text-slate-900 dark:text-slate-100">{formatNumber(row.in_stock)}</td>
                                        <td className="px-4 py-3 text-right text-sm text-slate-900 dark:text-slate-100">{formatNumber(row.inbound)}</td>
                                        <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900 dark:text-slate-100">{formatNumber(row.total_qty)}</td>
                                        <td className="px-4 py-3 text-right text-sm text-slate-700 dark:text-slate-300">{formatCurrency(row.cost_inr)}</td>
                                        <td className="px-4 py-3 text-right text-sm text-slate-700 dark:text-slate-300">{formatRmb(row.cost_rmb)}</td>
                                        <td className="px-4 py-3 text-right text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(row.valuation)}</td>
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
