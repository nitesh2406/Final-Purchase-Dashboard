import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    BoxIcon,
    BanknotesIcon,
    TruckIcon,
    ExclamationTriangleIcon,
    MagnifyingGlassIcon,
    ShipIcon,
    AirplaneIcon,
    ChevronRightIcon,
    ArrowPathIcon
} from '../icons/Icons';
import { Batch, BatchFilters, BatchMetrics } from '../../types';
import { APPS_SCRIPT_URL } from '../../constants';
import { Button } from '../ui/Button';
import { useQueryParam, useQueryParamFast } from '../../hooks/useQueryParam';

let trackerCache: {
    batches: Batch[];
    metrics: BatchMetrics | null;
    timestamp: number;
} | null = null;

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

const formatDate = (dateString: string | null) => {
    if (!dateString) return '—';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const DashboardCards: React.FC<{
    metrics: BatchMetrics | null;
    isLoading: boolean;
}> = ({ metrics, isLoading }) => {
    if (isLoading && !trackerCache) {
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

    const cards = [
        { label: 'Active Batches',     value: metrics?.activeBatches || 0,                                       icon: BoxIcon,                 color: 'text-blue-500' },
        { label: 'In-Transit Value',   value: `₹${((metrics?.inTransitValue || 0) / 100000).toFixed(2)}L`,       icon: BanknotesIcon,            color: 'text-emerald-500' },
        { label: 'Arriving This Week', value: metrics?.arrivingThisWeek || 0,                                     icon: TruckIcon,               color: 'text-yellow-500' },
        { label: 'Delayed Shipments',  value: metrics?.delayedShipments || 0,                                     icon: ExclamationTriangleIcon, color: 'text-red-500' },
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
                        <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">{card.value}</div>
                    </div>
                );
            })}
        </div>
    );
};

const FilterBar: React.FC<{
    filters: BatchFilters;
    setFilters: (filters: BatchFilters) => void;
}> = ({ filters, setFilters }) => {
    return (
        <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 mb-6 shadow-sm">
            <div className="flex flex-col lg:flex-row gap-4">
                <div className="flex-1">
                    <div className="relative">
                        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
                        <input
                            type="text"
                            placeholder="Search by Batch ID, Carrier, Tracking..."
                            value={filters.search}
                            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                </div>

                <select
                    value={filters.status}
                    onChange={(e) => setFilters({ ...filters, status: e.target.value as any })}
                    className="px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="All">All Statuses</option>
                    <option value="Shipped">Shipped</option>
                    <option value="In-Transit China">In-Transit China</option>
                    <option value="At Port China">At Port China</option>
                    <option value="In-Transit Ocean">In-Transit Ocean</option>
                    <option value="In-Transit Air">In-Transit Air</option>
                    <option value="Customs Clearance">Customs Clearance</option>
                    <option value="In-Transit India">In-Transit India</option>
                    <option value="Out for Delivery">Out for Delivery</option>
                    <option value="Delivered">Delivered</option>
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
        </div>
    );
};

const BatchCard: React.FC<{
    batch: Batch;
    onViewDetails: (id: string) => void;
}> = ({ batch, onViewDetails }) => {
    const sc = getStatusConfig(batch.status);
    const ModeIcon = batch.batch_type === 'sea' ? ShipIcon : AirplaneIcon;

    return (
        <div
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 hover:border-blue-500 hover:shadow-lg transition-all cursor-pointer shadow-sm group"
            onClick={() => onViewDetails(batch.batch_id)}
        >
            <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                    <ModeIcon className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                    <h3 className="text-lg font-bold font-mono text-slate-900 dark:text-slate-100">{batch.batch_id}</h3>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    ETA: {formatDate(batch.expected_delivery)}
                </span>
            </div>

            <div className="mb-4">
                <span className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${sc.badge}`}>
                    {sc.label}
                </span>
                {batch.is_delayed && (
                    <div className="flex items-center gap-1 mt-2 text-red-600 dark:text-red-400">
                        <ExclamationTriangleIcon className="w-4 h-4" />
                        <span className="text-xs font-bold">Delayed by {batch.delay_days} days</span>
                    </div>
                )}
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 my-4" />

            <div className="space-y-3 mb-6">
                <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <span className="font-bold">{batch.carrier || <span className="text-slate-400 dark:text-slate-500 font-normal italic">No carrier</span>}</span>
                    <span className="text-slate-300 dark:text-slate-600">•</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                        {batch.tracking_number || <span className="italic">No tracking</span>}
                    </span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                    {batch.total_vendors} Vendors • {batch.total_cartons} Cartons • {batch.total_units} Units
                </div>
            </div>

            <button className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-bold text-sm flex items-center justify-center gap-2 group-hover:shadow-md">
                View Details <ChevronRightIcon className="w-4 h-4" />
            </button>
        </div>
    );
};

interface ShipmentTrackerProps {
    onNavigateToBatch?: (id: string) => void;
}

export const ShipmentTracker: React.FC<ShipmentTrackerProps> = ({ onNavigateToBatch }) => {
    const [batches, setBatches] = useState<Batch[]>(trackerCache?.batches || []);
    const [metrics, setMetrics] = useState<BatchMetrics | null>(trackerCache?.metrics || null);
    // Filters persisted in the URL: free-text search via raw history.replaceState
    // (hot path, no history spam), status/mode via react-router's useSearchParams.
    const [search, setSearch] = useQueryParamFast('search', '');
    const [status, setStatus] = useQueryParam('status', 'All');
    const [mode, setMode] = useQueryParam('mode', 'All');
    const filters: BatchFilters = { search, status: status as any, mode: mode as any };
    const setFilters = useCallback((next: BatchFilters) => {
        if (next.search !== search) setSearch(next.search);
        if (next.status !== status) setStatus(next.status as any);
        if (next.mode !== mode) setMode(next.mode as any);
    }, [search, status, mode, setSearch, setStatus, setMode]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showDebug, setShowDebug] = useState(false);
    const [lastRequest, setLastRequest] = useState<any>(null);
    const [lastResponse, setLastResponse] = useState<any>(null);

    const fetchData = useCallback(async (forceRefresh = false) => {
        if (!forceRefresh && trackerCache) {
            setBatches(trackerCache.batches);
            setMetrics(trackerCache.metrics);
            return;
        }
        setIsLoading(true);
        setError(null);
        const payload = { action: 'get_batches' };
        setLastRequest(payload);
        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            setLastResponse(result);
            if (result.status === 'success') {
                const newBatches = result.batches || [];
                const newMetrics = result.metrics || null;
                setBatches(newBatches);
                setMetrics(newMetrics);
                trackerCache = { batches: newBatches, metrics: newMetrics, timestamp: Date.now() };
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

    const filteredBatches = useMemo(() => {
        let filtered = [...batches];
        if (filters.search) {
            const s = filters.search.toLowerCase();
            filtered = filtered.filter(b =>
                String(b.batch_id || '').toLowerCase().includes(s) ||
                String(b.tracking_number || '').toLowerCase().includes(s) ||
                String(b.carrier || '').toLowerCase().includes(s)
            );
        }
        if (filters.status !== 'All') filtered = filtered.filter(b => b.status === filters.status);
        if (filters.mode !== 'All') filtered = filtered.filter(b => b.batch_type === filters.mode);
        return filtered;
    }, [batches, filters]);

    const handleViewDetails = (batchId: string) => {
        if (onNavigateToBatch) onNavigateToBatch(batchId);
    };

    return (
        <div className="p-6 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-24">
            <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Shipment Tracker</h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1">Consolidated container tracking & landing reconciliation</p>
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
            <FilterBar filters={filters} setFilters={setFilters} />

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
                    {trackerCache && (
                        <span className="text-[9px] text-slate-400 dark:text-slate-500 italic">
                            Last synced: {new Date(trackerCache.timestamp).toLocaleTimeString()}
                        </span>
                    )}
                </div>
            )}

            {isLoading && !trackerCache ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                        <div key={i} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 animate-pulse h-64 shadow-sm" />
                    ))}
                </div>
            ) : filteredBatches.length === 0 ? (
                <div className="text-center py-24 bg-white dark:bg-slate-800 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 shadow-sm">
                    <BoxIcon className="w-16 h-16 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
                    <p className="text-lg text-slate-600 dark:text-slate-300 font-medium">No active batches matching your search</p>
                    <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Try adjusting your filters or clearing search query</p>
                    <button
                        className="mt-6 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors text-sm font-medium"
                        onClick={() => setFilters({ search: '', status: 'All', mode: 'All' })}
                    >
                        Clear Filters
                    </button>
                </div>
            ) : (
                <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
                    {filteredBatches.map(batch => (
                        <BatchCard key={batch.batch_id} batch={batch} onViewDetails={handleViewDetails} />
                    ))}
                </div>
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
