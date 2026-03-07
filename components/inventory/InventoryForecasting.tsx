import React, { useState, useMemo, FC, KeyboardEvent, useEffect, useCallback, useRef } from 'react';
import { ForecastingSku } from '../../types';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { ArrowsUpDownIcon, ArrowPathIcon, ShipIcon, AirplaneIcon, ClockIcon, PencilIcon, ExclamationTriangleIcon, ArrowPathIcon as RetryIcon, CheckBadgeIcon, XMarkIcon } from '../icons/Icons';
import { SkuDetailModal } from './SkuDetailModal';
import { APPS_SCRIPT_URL, API_ACTIONS } from '../../App';
import { ViewType } from '../../App';

// Helper functions
const formatNumber = (num: number) => new Intl.NumberFormat('en-IN').format(num);
const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
const formatLakhs = (amount: number) => {
    if (amount >= 100000) {
        return `₹${(amount / 100000).toFixed(2)}L`;
    }
    return formatCurrency(amount);
};

// Module-level cache to persist data across tab switches
const forecastingCache: Record<string, ForecastingSku[]> = {};

// Status and Color Logic
// W2 FIX: Drive color from urgencyLevel to be consistent with status dot
const getDaysOfCoverColor = (urgencyLevel: string) => {
    if (urgencyLevel === 'critical') return 'text-red-500';
    if (urgencyLevel === 'warning') return 'text-yellow-500';
    return 'text-green-500';
};

const StatusIcon: FC<{ sku: ForecastingSku }> = ({ sku }) => {
    const isSoonInbound = sku.inTransit > 0 && sku.inboundETA && (new Date(sku.inboundETA).getTime() - Date.now()) / (1000 * 3600 * 24) <= 7;
    if (isSoonInbound) return <div title="Inbound arriving soon" className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center"><ClockIcon className="w-2.5 h-2.5 text-white" /></div>;
    switch (sku.urgencyLevel) {
        case 'critical': return <div title="Critical" className="w-4 h-4 rounded-full bg-red-500"></div>;
        case 'warning': return <div title="Warning" className="w-4 h-4 rounded-full bg-yellow-500"></div>;
        case 'healthy': return <div title="Healthy" className="w-4 h-4 rounded-full bg-green-500"></div>;
        default: return null;
    }
};

// Sub-components
const KpiCard: FC<{ title: string; value: string; }> = ({ title, value }) => (
    <Card className="p-3 sm:p-4">
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{title}</p>
        <p className="text-2xl font-semibold text-gray-800 dark:text-white mt-1">{value}</p>
    </Card>
);

// Main Component
type SortKey = keyof ForecastingSku;
type StatusFilter = 'All' | 'Urgent' | 'Low Stock' | 'Healthy' | 'Awaiting Inbound' | 'Stockout Gap';

interface DebugEntry {
    time: string;
    type: 'req' | 'res' | 'err';
    data: any;
}

// U1: Toast state type
interface ToastState {
    message: string;
    draftId?: string;
    type: 'success' | 'error';
}

interface InventoryForecastingProps {
    isSidebarCollapsed: boolean;
    onNavigate?: (view: ViewType) => void;
}

export const InventoryForecasting: FC<InventoryForecastingProps> = ({ isSidebarCollapsed, onNavigate }) => {
    const [skus, setSkus] = useState<ForecastingSku[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreatingDraft, setIsCreatingDraft] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [toast, setToast] = useState<ToastState | null>(null);
    const [activeMode, setActiveMode] = useState<'sea' | 'air'>('sea');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'daysOfCover', direction: 'asc' });
    const [selectedSku, setSelectedSku] = useState<ForecastingSku | null>(null);
    const [selectedSkuIds, setSelectedSkuIds] = useState<string[]>([]);
    const [editingQty, setEditingQty] = useState<Record<string, string>>({});
    const [showDebug, setShowDebug] = useState(false);
    const [debugLog, setDebugLog] = useState<DebugEntry[]>([]);

    const prevModeRef = useRef<'sea' | 'air' | null>(null);
    const latestModeRef = useRef(activeMode);

    const addDebugLog = useCallback((type: 'req' | 'res' | 'err', data: any) => {
        const now = new Date();
        const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
        setDebugLog(prev => [{ time, type, data }, ...prev].slice(0, 20));
    }, []);

    const fetchForecastingData = useCallback(async (forceRefresh = false) => {
        // Only trigger loading state if we are actually going to fetch
        if (!forceRefresh && forecastingCache[activeMode]) {
            setSkus(forecastingCache[activeMode]);
            setIsLoading(false);
            setError(null);
            return;
        }

        setIsLoading(true);
        setError(null);

        const url = `${APPS_SCRIPT_URL}?request=forecast&mode=${activeMode}`;
        addDebugLog('req', { method: 'GET', url });

        try {
            // REVERT: Using GET method as requested for the forecast data
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Network response was not ok, status: ${response.status}`);
            }
            const data = await response.json();
            addDebugLog('res', data);

            if (data.error) {
                throw new Error(data.error);
            }

            if (!Array.isArray(data)) {
                throw new Error("API returned invalid data format (expected an array).");
            }

            // Update cache and state
            forecastingCache[activeMode] = data;
            if (latestModeRef.current === activeMode) {
                setSkus(data);
            }

        } catch (e: any) {
            console.error("API Error:", e);
            addDebugLog('err', e.message);
            setError(e.message || "Unknown error occurred");
            setSkus([]);
        } finally {
            setIsLoading(false);
        }
    }, [activeMode]);

    // Handle load and tab switching logic
    useEffect(() => {
        latestModeRef.current = activeMode;
        const modeChanged = prevModeRef.current !== activeMode;

        // Only fetch if mode changed OR cache is completely missing
        // This handles initial load and tab switches efficiently
        if (modeChanged || !forecastingCache[activeMode]) {
            fetchForecastingData(false);
        } else {
            // Just update skus from cache if we already have it
            setSkus(forecastingCache[activeMode]);
            setIsLoading(false);
            setError(null);
        }

        prevModeRef.current = activeMode;
    }, [activeMode, fetchForecastingData]);

    const filteredSkus = useMemo(() => {
        return skus
            .filter(sku => {
                if (statusFilter === 'All') return true;
                if (statusFilter === 'Awaiting Inbound') return sku.inTransit > 0;
                if (statusFilter === 'Urgent') return sku.urgencyLevel === 'critical';
                if (statusFilter === 'Low Stock') return sku.urgencyLevel === 'warning';
                if (statusFilter === 'Healthy') return sku.urgencyLevel === 'healthy';
                if (statusFilter === 'Stockout Gap') return sku.stockoutGapDays > 0;
                return true;
            })
            .filter(sku =>
                String(sku.masterSKU || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                String(sku.productName || '').toLowerCase().includes(searchTerm.toLowerCase())
            );
    }, [skus, statusFilter, searchTerm, activeMode]);

    const sortedSkus = useMemo(() => {
        return [...filteredSkus].sort((a, b) => {
            const aVal = a[sortConfig.key];
            const bVal = b[sortConfig.key];
            if (typeof aVal === 'string' && typeof bVal === 'string') return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            if (typeof aVal === 'number' && typeof bVal === 'number') return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
            return 0;
        });
    }, [filteredSkus, sortConfig]);

    const selectionData = useMemo(() => {
        const selected = skus.filter(s => selectedSkuIds.includes(s.masterSKU));
        const totalQty = selected.reduce((sum, s) => sum + s.reorderQty, 0);
        const totalValue = selected.reduce((sum, s) => sum + (s.reorderQty * s.unitCost), 0);
        return { count: selected.length, totalQty, totalValue };
    }, [selectedSkuIds, skus]);

    const kpiData = useMemo(() => ({
        skusForOrder: sortedSkus.filter(s => s.reorderQty > 0).length,
        totalReorderQty: sortedSkus.reduce((sum, s) => sum + s.reorderQty, 0),
        totalOrderValue: sortedSkus.filter(s => s.reorderQty > 0).reduce((sum, s) => sum + (s.reorderQty * s.unitCost), 0),
    }), [sortedSkus]);

    const isSelectionActive = selectionData.count > 0;
    const summaryData = {
        count: isSelectionActive ? selectionData.count : kpiData.skusForOrder,
        qty: isSelectionActive ? selectionData.totalQty : kpiData.totalReorderQty,
        value: isSelectionActive ? selectionData.totalValue : kpiData.totalOrderValue,
    };

    const handleRowClick = (sku: ForecastingSku) => setSelectedSku(sku);
    const handleSort = (key: SortKey) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));

    const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSelectedSkuIds(e.target.checked ? sortedSkus.map(s => s.masterSKU) : []);
    };

    const handleSelectRow = (skuId: string) => {
        setSelectedSkuIds(prev => prev.includes(skuId) ? prev.filter(id => id !== skuId) : [...prev, skuId]);
    };

    const handleReorderQtyChange = (skuId: string, value: string) => {
        const newValue = parseInt(value, 10);
        setSkus(prev => prev.map(s =>
            s.masterSKU === skuId
                ? { ...s, reorderQty: isNaN(newValue) || newValue < 0 ? 0 : newValue }
                : s
        ));
    };

    const handleCreateDraft = async () => {
        if (summaryData.count === 0) return;
        setIsCreatingDraft(true);
        setError(null);

        const selectedRows = skus.filter(s => selectedSkuIds.includes(s.masterSKU));
        const payload = {
            action: API_ACTIONS.CREATE_DRAFT_FROM_FORECAST,
            forecastRunId: `RUN-${Date.now()}`,
            mode: activeMode.charAt(0).toUpperCase() + activeMode.slice(1),
            skus: selectedRows.map(s => ({
                sku: s.masterSKU,
                qty: s.reorderQty // Send reorderQty strictly as defined in forecast
            }))
        };

        addDebugLog('req', { method: 'POST', payload });

        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            addDebugLog('res', result);
            if (result.draftId) {
                // U1 FIX: Replace alert() with inline toast + View Draft CTA
                setToast({ message: `Draft ${result.draftId} created successfully.`, draftId: result.draftId, type: 'success' });
                setTimeout(() => setToast(null), 6000);
                setSelectedSkuIds([]);
            } else if (result.error) {
                throw new Error(result.error);
            }
        } catch (e: any) {
            console.error("Draft creation failed:", e);
            addDebugLog('err', e.message);
            setToast({ message: `Failed to create draft: ${e.message}`, type: 'error' });
            setTimeout(() => setToast(null), 8000);
        } finally {
            setIsCreatingDraft(false);
        }
    };

    const SortableHeader: FC<{ label: string; sortKey: SortKey; className?: string }> = ({ label, sortKey, className }) => (
        <th scope="col" onClick={() => handleSort(sortKey)} className={`px-3 py-3 text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer transition-colors ${sortConfig.key === sortKey ? 'bg-primary-100 dark:bg-primary-900/50' : 'hover:bg-gray-100 dark:hover:bg-gray-700'} ${className}`}>
            <div className={`flex items-center ${className?.includes('text-center') ? 'justify-center' : ''}`}>
                {label} <span className="ml-1 w-4 h-4">{sortConfig.key === sortKey ? (sortConfig.direction === 'asc' ? '▲' : '▼') : <ArrowsUpDownIcon className="w-4 h-4 opacity-30" />}</span>
            </div>
        </th>
    );

    const renderTableContent = () => {
        if (isLoading) {
            return (
                <div className="flex items-center justify-center h-full min-h-[300px]">
                    <ArrowPathIcon className="w-8 h-8 animate-spin text-primary-500" />
                    <span className="ml-2">Processing...</span>
                </div>
            );
        }

        if (error) {
            return (
                <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-red-500 text-center p-4">
                    <ExclamationTriangleIcon className="w-12 h-12 mb-2 opacity-50" />
                    <p className="font-semibold text-lg">Communication Error</p>
                    <div className="text-sm font-mono bg-red-50 dark:bg-red-900/20 p-3 rounded mt-2 border border-red-100 dark:border-red-800 select-all">
                        {error}
                    </div>
                    <Button variant="secondary" className="mt-4" onClick={() => fetchForecastingData(true)} icon={<RetryIcon className="w-4 h-4" />}>Retry Connection</Button>
                </div>
            );
        }

        if (sortedSkus.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                    <p className="text-lg font-medium">No Data Returned</p>
                    <p className="text-sm mb-4">The backend returned a successful response but the list is empty.</p>
                    <Button variant="secondary" className="mt-4" onClick={() => fetchForecastingData(true)} icon={<RetryIcon className="w-4 h-4" />}>Refresh</Button>
                </div>
            );
        }

        return (
            <table className="min-w-full divide-y-2 divide-transparent border-spacing-y-2">
                <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10">
                    <tr>
                        <th scope="col" className="px-3 py-3"><input type="checkbox" onChange={handleSelectAll} checked={sortedSkus.length > 0 && selectedSkuIds.length === sortedSkus.length} /></th>
                        <th scope="col" className="px-2 py-3"></th>
                        <SortableHeader label="SKU" sortKey="masterSKU" className="text-left" />
                        <SortableHeader label="Product Name" sortKey="productName" className="text-left" />
                        <SortableHeader label="15D Sale" sortKey="sale15Days" className="text-center" />
                        <SortableHeader label="30D Sale" sortKey="sale30Days" className="text-center" />
                        <SortableHeader label="90D Sale" sortKey="sale90Days" className="text-center" />
                        <SortableHeader label="MMA" sortKey="monthlyMovingAvg" className="text-center" />
                        {/* U3 FIX: Renamed 'In Stock' to 'Available' (excludes inbound/shipped) */}
                        <SortableHeader label="Available" sortKey="inStock" className="text-center" />
                        <SortableHeader label="In-Transit" sortKey="inTransit" className="text-center" />
                        <SortableHeader label="Days of Cover" sortKey="daysOfCover" className="text-center" />
                        <SortableHeader label="Reorder Qty" sortKey="reorderQty" className="text-center" />
                    </tr>
                </thead>
                <tbody className="bg-white dark:bg-slate-900">
                    {sortedSkus.map(sku => (
                        <tr key={sku.masterSKU} onClick={() => handleRowClick(sku)} className={`cursor-pointer group border-b border-slate-700/50 odd:bg-slate-900 even:bg-slate-800/50 ${selectedSkuIds.includes(sku.masterSKU) ? 'bg-primary-900/30' : 'hover:bg-slate-700/50'}`}>
                            <td className="px-3 py-3"><input type="checkbox" checked={selectedSkuIds.includes(sku.masterSKU)} onChange={() => handleSelectRow(sku.masterSKU)} onClick={e => e.stopPropagation()} /></td>
                            <td className="px-2 py-3">
                                <div className="flex items-center gap-2">
                                    <StatusIcon sku={sku} />
                                </div>
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap text-sm font-medium text-left">{sku.masterSKU}</td>
                            <td className="px-3 py-3 text-sm text-left max-w-[300px] overflow-x-auto whitespace-nowrap">{sku.productName}</td>
                            <td className="px-3 py-3 whitespace-nowrap text-base text-white text-center">{formatNumber(sku.sale15Days)}</td>
                            <td className="px-3 py-3 whitespace-nowrap text-base text-white text-center">{formatNumber(sku.sale30Days)}</td>
                            <td className="px-3 py-3 whitespace-nowrap text-base text-white text-center">{formatNumber(sku.sale90Days)}</td>
                            {/* U3 FIX: Math.round() instead of .toFixed(1) */}
                            <td className="px-3 py-3 whitespace-nowrap text-base text-white text-center">{Math.round(sku.monthlyMovingAvg)}</td>
                            <td className="px-3 py-3 whitespace-nowrap text-base font-semibold text-white text-center">{formatNumber(sku.inStock)}</td>
                            <td className="px-3 py-3 whitespace-nowrap text-sm text-center">
                                {sku.inTransit > 0 ? (
                                    <div className="flex flex-col items-center gap-1">
                                        <div>
                                            <span className="px-1.5 py-0.5 rounded bg-blue-200 text-blue-800 dark:bg-blue-900/70 dark:text-blue-200 font-semibold">{formatNumber(sku.inTransit)} units</span>
                                            {sku.inboundETA && <p className="text-xs text-gray-400 mt-1">ETA: {new Date(sku.inboundETA).toLocaleDateString('en-GB', { month: 'short', day: '2-digit' })}</p>}
                                        </div>
                                        {sku.inProduction > 0 && (
                                            <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-amber-200 text-amber-800 dark:bg-amber-900/70 dark:text-amber-400">
                                                🏭 {formatNumber(sku.inProduction)} in prod
                                            </span>
                                        )}
                                    </div>
                                ) : sku.inProduction > 0 ? (
                                    <div className="flex flex-col items-center gap-1">
                                        <span className="text-gray-400">-</span>
                                        <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-amber-200 text-amber-800 dark:bg-amber-900/70 dark:text-amber-400">
                                            🏭 {formatNumber(sku.inProduction)} in prod
                                        </span>
                                    </div>
                                ) : (
                                    <span className="text-gray-400">-</span>
                                )}
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap text-center">
                                {/* W2 FIX: Color driven by urgencyLevel, not hardcoded day thresholds */}
                                <div className={`text-base font-semibold ${getDaysOfCoverColor(sku.urgencyLevel)}`}>
                                    {isFinite(sku.daysOfCover) ? sku.daysOfCover.toFixed(0) : '∞'}
                                    {sku.stockoutGapDays > 0 && (
                                        <span className="ml-2 text-xs font-semibold text-orange-400 bg-orange-400/10 border border-orange-400/30 rounded px-1.5 py-0.5 whitespace-nowrap">
                                            ⚠ {sku.stockoutGapDays}d gap
                                        </span>
                                    )}
                                </div>
                                {/* Task 4: Show effectiveDaysOfCover if it's larger than on-hand */}
                                {sku.effectiveDaysOfCover !== undefined && sku.effectiveDaysOfCover > sku.daysOfCover && sku.effectiveDaysOfCover < 999 && (
                                    <div className="text-xs text-slate-400 mt-0.5">
                                        ↑ {sku.effectiveDaysOfCover.toFixed(0)}d with inbound
                                    </div>
                                )}
                                {sku.effectiveDaysOfCover !== undefined && sku.effectiveDaysOfCover > sku.daysOfCover && sku.effectiveDaysOfCover >= 999 && (
                                    <div className="text-xs text-slate-400 mt-0.5">
                                        ↑ 999d+ with inbound
                                    </div>
                                )}
                                {sku.outOfStock30Days > 0 && (
                                    <div className="text-xs text-red-500 mt-0.5" title={`Out of stock for ${sku.outOfStock30Days} days in last 30 days`}>
                                        (OOS: {sku.outOfStock30Days}d)
                                    </div>
                                )}
                            </td>
                            <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                                <div className="relative group w-24 mx-auto">
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        value={editingQty[sku.masterSKU] !== undefined ? editingQty[sku.masterSKU] : sku.reorderQty}
                                        onFocus={(e) => {
                                            e.target.select();
                                            setEditingQty(prev => ({ ...prev, [sku.masterSKU]: String(sku.reorderQty) }));
                                        }}
                                        onChange={(e) => setEditingQty(prev => ({ ...prev, [sku.masterSKU]: e.target.value }))}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Escape') setEditingQty(prev => { const n = { ...prev }; delete n[sku.masterSKU]; return n; });
                                            if (e.key === 'Enter') e.currentTarget.blur();
                                        }}
                                        onBlur={(e) => {
                                            const val = e.target.value;
                                            const num = val === '' ? 0 : parseInt(val, 10);
                                            handleReorderQtyChange(sku.masterSKU, isNaN(num) || num < 0 ? '0' : String(num));
                                            setEditingQty(prev => {
                                                const newEds = { ...prev };
                                                delete newEds[sku.masterSKU];
                                                return newEds;
                                            });
                                        }}
                                        className="w-full text-center text-base font-semibold text-primary-400 bg-slate-700 border border-slate-600 rounded-md p-1 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                                    />
                                    <PencilIcon className="w-3 h-3 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    };

    return (
        <div className="h-full flex flex-col space-y-4">
            <SkuDetailModal sku={selectedSku} onClose={() => setSelectedSku(null)} />

            {/* U1 FIX: Inline Toast notification */}
            {toast && (
                <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-xl shadow-2xl text-white text-sm font-medium animate-in slide-in-from-bottom-4 duration-300 ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
                    }`}>
                    <CheckBadgeIcon className="w-5 h-5 flex-shrink-0" />
                    <span>{toast.message}</span>
                    {toast.draftId && onNavigate && (
                        <button
                            onClick={() => { onNavigate('Draft Orders'); setToast(null); }}
                            className="ml-2 underline underline-offset-2 font-bold whitespace-nowrap"
                        >
                            View Draft →
                        </button>
                    )}
                    <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100">
                        <XMarkIcon className="w-4 h-4" />
                    </button>
                </div>
            )}

            <div className="flex flex-wrap justify-between items-center gap-4">
                <div className="flex items-center gap-4 flex-grow md:flex-grow-0 md:w-1/3">
                    <input type="text" placeholder="Search SKU or Product Name..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full p-2 border rounded-md dark:bg-gray-900 dark:border-gray-700 focus:ring-primary-500 focus:border-primary-500" />
                    {/* Manual Sync Button */}
                    <button
                        onClick={() => fetchForecastingData(true)}
                        disabled={isLoading}
                        title="Force refresh data from server"
                        className="p-2 rounded-md border border-slate-600 bg-slate-800 text-slate-400 hover:text-white hover:border-slate-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    >
                        <ArrowPathIcon className={`w-4 h-4 ${isLoading ? 'animate-spin text-primary-400' : ''}`} />
                    </button>
                    <button
                        onClick={() => setShowDebug(!showDebug)}
                        className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest transition-all border shrink-0 ${showDebug
                            ? 'bg-purple-600/20 text-purple-400 border-purple-500/30'
                            : 'bg-slate-800 text-slate-500 border-slate-700 hover:border-slate-600'
                            }`}
                        title="Toggle Debug Mode"
                    >
                        🐛
                    </button>
                </div>
                <div className="flex items-center p-1 bg-gray-200 dark:bg-gray-700 rounded-lg flex-shrink-0">
                    <button onClick={() => setActiveMode('sea')} className={`py-1 px-3 rounded-md text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${activeMode === 'sea' ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 dark:text-gray-300'}`}>
                        <ShipIcon className="w-4 h-4" /> SEA
                    </button>
                    <button onClick={() => setActiveMode('air')} className={`py-1 px-3 rounded-md text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${activeMode === 'air' ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-600 dark:text-gray-300'}`}>
                        <AirplaneIcon className="w-4 h-4" /> AIR
                    </button>
                </div>
            </div>

            {/* Debug Panel */}
            {showDebug && (
                <Card className="bg-slate-900 border-purple-500/30 p-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">API Activity Log</h3>
                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    navigator.clipboard.writeText(JSON.stringify(debugLog, null, 2));
                                }}
                                className="text-[9px] text-slate-400 hover:text-white underline underline-offset-2"
                            >
                                Copy JSON
                            </button>
                            <button
                                onClick={() => setDebugLog([])}
                                className="text-[9px] text-slate-400 hover:text-white underline underline-offset-2"
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                    <div className="space-y-2 max-h-60 overflow-y-auto font-mono text-[10px]">
                        {debugLog.length === 0 ? (
                            <p className="text-slate-600 italic py-4 text-center">No API calls yet.</p>
                        ) : (
                            debugLog.map((entry, i) => (
                                <div key={i} className="flex gap-3 items-start border-b border-slate-800 pb-2 last:border-0">
                                    <span className="text-slate-500 flex-shrink-0">{entry.time}</span>
                                    <span className={`px-1 rounded flex-shrink-0 font-bold ${entry.type === 'req' ? 'bg-blue-500/10 text-blue-400' :
                                        entry.type === 'res' ? 'bg-green-500/10 text-green-400' :
                                            'bg-red-500/10 text-red-400'
                                        }`}>
                                        {entry.type.toUpperCase()}
                                    </span>
                                    <span className="text-slate-400 break-all">{JSON.stringify(entry.data)}</span>
                                </div>
                            ))
                        )}
                    </div>
                </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard title={isSelectionActive ? "Selected SKUs" : "SKUs for Order"} value={formatNumber(summaryData.count)} />
                <KpiCard title={isSelectionActive ? "Selected Qty" : "Total Qty"} value={`${formatNumber(summaryData.qty)} units`} />
                <KpiCard title={isSelectionActive ? "Selected Value" : "Total Order Value"} value={formatLakhs(summaryData.value)} />
                <Button
                    className="w-full h-full text-lg font-bold"
                    disabled={summaryData.count === 0 || isLoading || isCreatingDraft}
                    onClick={handleCreateDraft}
                >
                    {isCreatingDraft ? 'CREATING DRAFT...' : 'CREATE DRAFT ORDER'}
                </Button>
            </div>

            <Card className="flex-grow flex flex-col overflow-hidden">
                <div className="flex items-center justify-between mb-4">
                    <p className="text-sm text-gray-500">{selectionData.count > 0 ? `${selectionData.count} items selected` : `${sortedSkus.length} results found for ${activeMode.toUpperCase()} mode`}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">Status:</span>
                        {(['All', 'Urgent', 'Low Stock', 'Healthy', 'Awaiting Inbound', 'Stockout Gap'] as const).map(s => (
                            <Button
                                key={s}
                                variant={statusFilter === s ? 'primary' : 'secondary'}
                                onClick={() => setStatusFilter(s)}
                                className={`text-xs py-1 px-3 capitalize ${s === 'Stockout Gap'
                                    ? (statusFilter === s
                                        ? 'bg-orange-500/20 border-orange-500/50 text-orange-400'
                                        : 'border-slate-600 text-slate-400')
                                    : ''
                                    }`}
                            >
                                {s}
                            </Button>
                        ))}
                    </div>
                </div>

                <div className="flex-grow overflow-auto">
                    {renderTableContent()}
                </div>
            </Card>
        </div>
    );
};