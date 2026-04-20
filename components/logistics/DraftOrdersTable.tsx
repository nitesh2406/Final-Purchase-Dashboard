import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import {
    PlusIcon, MagnifyingGlassIcon, FunnelIcon, PencilIcon, TrashIcon,
    EyeIcon, CheckBadgeIcon, DocumentDuplicateIcon, ExclamationTriangleIcon,
    XMarkIcon, ListBulletIcon, ChevronLeftIcon,
    ChevronRightIcon, ArrowsUpDownIcon, ArrowPathIcon, AirplaneIcon, ShipIcon
} from '../icons/Icons';
import { DraftOrderEdit } from './DraftOrderEdit';
import { CancelDraftModal } from './CancelDraftModal';
import { PurchaseOrder, DraftOrder, Sku, DraftStatus, Vendor, VendorMaster } from '../../types';
import { APPS_SCRIPT_URL, API_ACTIONS, ViewType } from '../../App';

const StatusBadge: React.FC<{ status: DraftStatus }> = ({ status }) => {
    const config: Record<string, string> = {
        'DRAFT': 'bg-slate-600 text-white',
        'PARTIALLY_SUBMITTED': 'bg-amber-600 text-white',
        'SUBMITTED': 'bg-blue-600 text-white',
        'CANCELLED': 'bg-red-600 text-white',
    };
    const labels: Record<string, string> = {
        'DRAFT': 'Draft',
        'PARTIALLY_SUBMITTED': 'Partially Submitted',
        'SUBMITTED': 'Submitted',
        'CANCELLED': 'Cancelled',
    };
    return (
        <span className={`px-2 py-1 text-[11px] font-bold rounded uppercase tracking-wider ${config[status] || 'bg-slate-600 text-white'}`}>
            {labels[status] || status}
        </span>
    );
};

const ModeBadge: React.FC<{ mode?: string }> = ({ mode }) => {
    if (!mode) return null;
    const normalized = String(mode).toUpperCase();
    const isAir = normalized === 'AIR';
    const isSea = normalized === 'SEA';

    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold rounded border transition-colors ${isAir
            ? 'bg-sky-600/20 text-sky-400 border-sky-600/30'
            : isSea ? 'bg-blue-600/20 text-blue-400 border-blue-600/30' : 'bg-slate-800 text-slate-400'
            }`}>
            {isAir && <AirplaneIcon className="w-3 h-3" />}
            {isSea && <ShipIcon className="w-3 h-3" />}
            {mode}
        </span>
    );
};

interface DraftOrdersTableProps {
    purchaseOrders: PurchaseOrder[];
    setPurchaseOrders: React.Dispatch<React.SetStateAction<PurchaseOrder[]>>;
    drafts: DraftOrder[];
    setDrafts: React.Dispatch<React.SetStateAction<DraftOrder[]>>;
    skus: Sku[];
    addSku: (newSku: Omit<Sku, 'id'>) => Sku;
    vendors: Vendor[];
    vendorMasters: VendorMaster[];
    onNavigate?: (view: ViewType) => void;
    onRefreshPOs?: () => void;
    highlightDraftId: string | null;
    setHighlightDraftId: (id: string | null) => void;
    onRefreshDrafts: () => void;
}

export const DraftOrdersTable: React.FC<DraftOrdersTableProps> = ({
    purchaseOrders,
    setPurchaseOrders,
    drafts,
    setDrafts,
    skus,
    addSku,
    vendors,
    vendorMasters,
    onNavigate,
    onRefreshPOs,
    highlightDraftId,
    setHighlightDraftId,
    onRefreshDrafts
}) => {
    const [view, setView] = useState<'list' | 'edit' | 'create'>('list');
    const [highlightedId, setHighlightedId] = useState<string | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState<'All' | DraftStatus>('DRAFT');
    const [cancelModalDraft, setCancelModalDraft] = useState<DraftOrder | null>(null);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [isMutating, setIsMutating] = useState(false);
    const [isFetchingDetails, setIsFetchingDetails] = useState(false);

    // ISSUE 7: Prefetch cache for DRAFT lines
    const [draftLinesCache, setDraftLinesCache] = useState<Map<string, any[]>>(new Map());
    const [lastPrefetchTime, setLastPrefetchTime] = useState<string>('');
    const prefetchedRef = useRef(false);

    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'id', direction: 'desc' });
    const [currentPage, setCurrentPage] = useState(1);
    const rowsPerPage = 10;

    const handleRefresh = async () => {
        setIsRefreshing(true);
        await onRefreshDrafts();
        prefetchedRef.current = false; // Re-trigger prefetch after refresh
        setIsRefreshing(false);
    };

    // ISSUE 7: Prefetch all DRAFT lines on load
    const prefetchDraftLines = useCallback(async () => {
        const draftItems = drafts.filter(d => d.status === 'DRAFT');
        if (draftItems.length === 0) return;

        const newCache = new Map<string, any[]>();
        const CONCURRENCY = 5;

        // Process in batches of CONCURRENCY
        for (let i = 0; i < draftItems.length; i += CONCURRENCY) {
            const batch = draftItems.slice(i, i + CONCURRENCY);
            const results = await Promise.all(
                batch.map(async (draft) => {
                    try {
                        const response = await fetch(APPS_SCRIPT_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                            body: JSON.stringify({ action: API_ACTIONS.GET_DRAFT_BY_ID, draftId: draft.id })
                        });
                        const result = await response.json();
                        if (result.status === 'success' && result.lines) {
                            return { id: draft.id, lines: result.lines, draft: result.draft };
                        }
                    } catch (err) {
                        console.error(`Prefetch failed for draft ${draft.id}:`, err);
                    }
                    return null;
                })
            );
            results.forEach(r => {
                if (r) newCache.set(r.id, r.lines);
            });
        }

        setDraftLinesCache(newCache);
        setLastPrefetchTime(new Date().toLocaleTimeString());
    }, [drafts]);

    // Trigger prefetch when drafts are loaded
    useEffect(() => {
        if (drafts.length > 0 && !prefetchedRef.current) {
            prefetchedRef.current = true;
            prefetchDraftLines();
        }
    }, [drafts, prefetchDraftLines]);

    const filteredDrafts = useMemo(() => {
        const lowerQuery = searchQuery.toLowerCase();
        return drafts.filter(d => {
            const matchesTab = activeTab === 'All' || d.status === activeTab;
            const matchesSearch = d.id.toLowerCase().includes(lowerQuery) ||
                (d.vendors && d.vendors.some(v => v.toLowerCase().includes(lowerQuery)));
            return matchesTab && matchesSearch;
        });
    }, [drafts, activeTab, searchQuery]);

    const sortedDrafts = useMemo(() => {
        return [...filteredDrafts].sort((a, b) => {
            const aVal = (a as any)[sortConfig.key];
            const bVal = (b as any)[sortConfig.key];
            if (aVal === bVal) return 0;
            if (aVal === undefined) return 1;
            if (bVal === undefined) return -1;

            const modifier = sortConfig.direction === 'asc' ? 1 : -1;
            return aVal < bVal ? -1 * modifier : 1 * modifier;
        });
    }, [filteredDrafts, sortConfig]);

    // ISSUE 4: Handle highlight and scroll
    useEffect(() => {
        if (highlightDraftId) {
            // Find the page containing this draft
            const draftIndex = sortedDrafts.findIndex(d => d.id === highlightDraftId);
            if (draftIndex !== -1) {
                const targetPage = Math.floor(draftIndex / rowsPerPage) + 1;
                setCurrentPage(targetPage);
                setHighlightedId(highlightDraftId);

                // Reset after 3 seconds
                const timer = setTimeout(() => {
                    setHighlightedId(null);
                    setHighlightDraftId(null);
                }, 3000);

                return () => clearTimeout(timer);
            }
        }
    }, [highlightDraftId, sortedDrafts, rowsPerPage, setHighlightDraftId]);

    // Scroll highlighted row into view
    useEffect(() => {
        if (highlightedId) {
            const element = document.getElementById(`draft-row-${highlightedId}`);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [highlightedId]);

    const paginatedDrafts = useMemo(() => {
        const start = (currentPage - 1) * rowsPerPage;
        return sortedDrafts.slice(start, start + rowsPerPage);
    }, [sortedDrafts, currentPage]);

    const totalPages = Math.ceil(sortedDrafts.length / rowsPerPage);

    const handleSort = (key: string) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    const handleCancelDraft = async () => {
        if (!cancelModalDraft) return;
        setIsMutating(true);
        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: API_ACTIONS.CANCEL_DRAFT, id: cancelModalDraft.id })
            });
            const result = await response.json();
            if (result.success) {
                setDrafts(prev => prev.map(d => d.id === cancelModalDraft.id ? {
                    ...d, status: 'CANCELLED' as const, cancelledAt: new Date().toISOString()
                } : d));
                showToast(`Draft order ${cancelModalDraft.id} cancelled`, 'success');
            } else {
                throw new Error(result.error || "Failed to cancel draft");
            }
        } catch (err: any) {
            showToast(err.message, 'error');
        } finally {
            setCancelModalDraft(null);
            setIsMutating(false);
        }
    };

    const handleBulkCancel = async () => {
        const affected = drafts.filter(d => selectedIds.includes(d.id) && ['DRAFT', 'PARTIALLY_SUBMITTED'].includes(d.status));
        if (affected.length === 0) return;
        if (confirm(`Cancel ${affected.length} selected draft orders?`)) {
            setIsMutating(true);
            try {
                const response = await fetch(APPS_SCRIPT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ action: 'bulk_cancel_drafts', ids: affected.map(a => a.id) })
                });
                const result = await response.json();
                if (result.success) {
                    setDrafts(prev => prev.map(d => selectedIds.includes(d.id) && ['DRAFT', 'PARTIALLY_SUBMITTED'].includes(d.status)
                        ? { ...d, status: 'CANCELLED' as const, cancelledAt: new Date().toISOString() }
                        : d));
                    showToast(`${affected.length} drafts cancelled`, 'success');
                    setSelectedIds([]);
                } else {
                    throw new Error(result.error);
                }
            } catch (err: any) {
                showToast(err.message, 'error');
            } finally {
                setIsMutating(false);
            }
        }
    };

    const handleEdit = async (id: string) => {
        if (isFetchingDetails || !id) return;

        // ISSUE 7: Check prefetch cache first
        const cachedLines = draftLinesCache.get(id);
        if (cachedLines) {
            const draft = drafts.find(d => d.id === id);
            if (draft) {
                setDrafts(prev => prev.map(d => d.id === id ? { ...d, items: cachedLines } : d));
                setSelectedDraftId(id);
                setView('edit');
                return;
            }
        }

        setIsFetchingDetails(true);
        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: API_ACTIONS.GET_DRAFT_BY_ID, draftId: id })
            });
            const result = await response.json();

            if (result.status === 'success' && result.draft) {
                setDrafts(prev => prev.map(d => d.id === id ? { ...d, ...result.draft, items: result.lines || [] } : d));
                setSelectedDraftId(id);
                setView('edit');
            } else {
                throw new Error(result.message || 'Draft not found or failed to fetch details');
            }
        } catch (err: any) {
            showToast(err.message, 'error');
        } finally {
            setIsFetchingDetails(false);
        }
    };

    const handleCreateNew = () => {
        setView('create');
    };

    const handleDuplicate = async (draft: DraftOrder) => {
        setIsMutating(true);
        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: API_ACTIONS.DUPLICATE_DRAFT, id: draft.id })
            });
            const result = await response.json();
            if (result.newDraft) {
                setDrafts(prev => [result.newDraft, ...prev]);
                handleEdit(result.newDraft.id);
                showToast(`Draft duplicated as ${result.newDraft.id}`, 'success');
            } else {
                throw new Error(result.error);
            }
        } catch (err: any) {
            showToast(err.message, 'error');
        } finally {
            setIsMutating(false);
        }
    };

    const showToast = (message: string, type: 'success' | 'error') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    };

    const formatDateString = (dateStr?: string) => {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '-';
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const toggleSelectAll = () => {
        setSelectedIds(selectedIds.length === paginatedDrafts.length ? [] : paginatedDrafts.map(d => d.id));
    };

    const SortIcon = ({ column }: { column: string }) => (
        <ArrowsUpDownIcon className={`w-3.5 h-3.5 ml-1 inline-block transition-colors ${sortConfig.key === column ? 'text-blue-500' : 'text-slate-600'}`} />
    );

    if ((view === 'edit' && selectedDraftId) || view === 'create') {
        const draft = view === 'create' ? null : drafts.find(d => d.id === selectedDraftId);
        return (
            <DraftOrderEdit
                draft={draft}
                onBack={() => setView('list')}
                setDrafts={setDrafts}
                onSave={async (updated) => {
                    setIsMutating(true);
                    try {
                        const isEdit = view === 'edit';
                        const action = isEdit ? API_ACTIONS.SAVE_DRAFT : API_ACTIONS.CREATE_DRAFT;
                        const payload = isEdit
                            ? { action, draftId: updated.id, ...updated, lines: updated.items }
                            : { action, draft: updated };

                        const response = await fetch(APPS_SCRIPT_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                            body: JSON.stringify(payload)
                        });
                        const result = await response.json();

                        if (result.status === 'success' || result.draftId) {
                            if (view === 'create') {
                                setSelectedDraftId(result.draftId || result.draft?.id);
                                setView('edit');
                            }
                            showToast(`Draft ${view === 'create' ? 'created' : 'updated'}`, 'success');
                        } else {
                            throw new Error(result.error || result.message || "Failed to persist draft");
                        }
                        return result;
                    } catch (err: any) {
                        showToast(err.message, 'error');
                        throw err;
                    } finally {
                        setIsMutating(false);
                    }
                }}
                onOrdersSubmitted={(updated, newPos, msg) => {
                    if (updated) setDrafts(prev => prev.map(d => d.id === updated.id ? updated : d));
                    setPurchaseOrders(prev => [...newPos, ...prev]);
                    showToast(msg, 'success');
                }}
                onRefreshPOs={onRefreshPOs}
                existingPoCount={purchaseOrders.length}
                skus={skus}
                addSkuToCatalog={addSku}
                vendorMasters={vendorMasters}
            />
        );
    }

    return (
        <div className="flex flex-col h-full space-y-4 text-gray-900 dark:text-white relative p-6 bg-gray-50 dark:bg-[#0f172a] min-h-screen">
            {(toast || isMutating || isFetchingDetails) && (
                <div className="fixed top-24 right-8 z-[150] flex flex-col gap-2">
                    {(isMutating || isFetchingDetails) && (
                        <div className="bg-blue-600/90 text-white px-4 py-3 rounded-lg shadow-2xl flex items-center gap-3 border border-blue-500/50 backdrop-blur-sm animate-pulse">
                            <ArrowPathIcon className="w-5 h-5 animate-spin" />
                            <span className="text-sm font-medium">{isFetchingDetails ? 'Fetching draft details...' : 'Syncing with backend...'}</span>
                        </div>
                    )}
                    {toast && (
                        <div className={`${toast.type === 'success' ? 'bg-emerald-600 border-emerald-500/50' : 'bg-red-600 border-red-500/50'} text-white px-4 py-3 rounded-lg shadow-2xl flex items-center gap-3 border animate-in slide-in-from-right-8 duration-300`}>
                            {toast.type === 'success' ? <CheckBadgeIcon className="w-5 h-5" /> : <ExclamationTriangleIcon className="w-5 h-5" />}
                            <span className="text-sm font-medium">{toast.message}</span>
                            <button onClick={() => setToast(null)} className="ml-2 hover:bg-black/10 rounded p-1"><XMarkIcon className="w-4 h-4" /></button>
                        </div>
                    )}
                </div>
            )}

            <div className="flex items-center gap-3 px-1 h-10 mb-2">
                <div className="relative flex-1">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                        type="text"
                        placeholder="Search by Draft PO number, vendor, or item..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-slate-500 text-sm text-gray-900 dark:text-white"
                    />
                </div>

                <Button variant="secondary" className="border-slate-700 h-10 px-4 whitespace-nowrap" icon={<FunnelIcon className="w-4 h-4" />}>Filters</Button>

                <button
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                    className="p-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-white transition-all shadow-lg"
                    title="Refresh Drafts"
                >
                    <ArrowPathIcon className={`w-5 h-5 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
                </button>

                <Button onClick={handleCreateNew} className="bg-blue-600 hover:bg-blue-700 h-10 px-4 whitespace-nowrap shadow-lg shadow-blue-900/20" icon={<PlusIcon className="w-4 h-4" />}>Create Draft PO</Button>
            </div>

            {drafts.length > 0 ? (
                <>
                    <div className="space-y-3">
                        <div className="flex gap-8 border-b border-slate-800 px-1">
                            {([
                                { key: 'All' as const, label: 'All' },
                                { key: 'DRAFT' as const, label: 'Draft' },
                                { key: 'PARTIALLY_SUBMITTED' as const, label: 'Partially Submitted' },
                                { key: 'SUBMITTED' as const, label: 'Submitted' },
                                { key: 'CANCELLED' as const, label: 'Cancelled' },
                            ]).map(({ key: tab, label }) => (
                                <button
                                    key={tab}
                                    onClick={() => { setActiveTab(tab); setCurrentPage(1); }}
                                    className={`pb-3 text-sm font-medium transition-all relative ${activeTab === tab ? 'text-blue-500' : 'text-slate-500 hover:text-slate-300'
                                        }`}
                                >
                                    {label}
                                    {activeTab === tab && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />}
                                </button>
                            ))}
                        </div>
                    </div>

                    <Card className="bg-white dark:bg-slate-800/30 border-gray-200 dark:border-slate-700 p-0 overflow-hidden flex flex-col flex-grow shadow-xl">
                        <div className="overflow-x-auto min-w-[1000px]">
                            {paginatedDrafts.length > 0 ? (
                                <table className="w-full text-left text-sm border-collapse">
                                    <thead>
                                        <tr className="bg-gray-50 dark:bg-slate-900/50 text-gray-500 dark:text-slate-400 text-[11px] uppercase tracking-wider border-b border-gray-200 dark:border-slate-700">
                                            <th className="px-4 py-3 w-10">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.length === paginatedDrafts.length && paginatedDrafts.length > 0}
                                                    onChange={toggleSelectAll}
                                                    className="rounded border-slate-600 bg-slate-800"
                                                />
                                            </th>
                                            <th className="px-4 py-3 font-semibold cursor-pointer hover:text-gray-900 dark:hover:text-white text-sm text-gray-600 dark:text-slate-300" onClick={() => handleSort('id')}>Draft PO Number <SortIcon column="id" /></th>
                                            <th className="px-4 py-3 font-semibold text-sm text-gray-600 dark:text-slate-300">Vendor(s)</th>
                                            <th className="px-4 py-3 font-semibold text-xs text-gray-500 dark:text-slate-400 uppercase">Mode</th>
                                            <th className="px-4 py-3 font-semibold cursor-pointer hover:text-gray-900 dark:hover:text-white text-sm text-gray-600 dark:text-slate-300" onClick={() => handleSort('draft_date')}>PO Date <SortIcon column="draft_date" /></th>
                                            <th className="px-4 py-3 font-semibold text-center cursor-pointer hover:text-gray-900 dark:hover:text-white text-sm text-gray-600 dark:text-slate-300" onClick={() => handleSort('total_skus')}>Total SKUs <SortIcon column="total_skus" /></th>
                                            <th className="px-4 py-3 font-semibold text-center cursor-pointer hover:text-gray-900 dark:hover:text-white text-sm text-gray-600 dark:text-slate-300" onClick={() => handleSort('total_items')}>Total Items <SortIcon column="total_items" /></th>
                                            <th className="px-4 py-3 font-semibold cursor-pointer hover:text-gray-900 dark:hover:text-white text-sm text-gray-600 dark:text-slate-300" onClick={() => handleSort('status')}>Status <SortIcon column="status" /></th>
                                            <th className="px-4 py-3 font-semibold text-right text-sm text-gray-600 dark:text-slate-300">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700/50">
                                        {paginatedDrafts.map((draft) => (
                                            <tr
                                                key={draft.id}
                                                id={`draft-row-${draft.id}`}
                                                onClick={() => handleEdit(draft.id)}
                                                className={`group hover:bg-gray-50 dark:hover:bg-slate-700/40 transition-all duration-300 cursor-pointer ${draft.status === 'CANCELLED' ? 'opacity-50' : ''} ${highlightedId === draft.id ? 'ring-4 ring-blue-500/50 bg-blue-900/20 z-10' : ''}`}
                                            >
                                                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedIds.includes(draft.id)}
                                                        onChange={() => setSelectedIds(prev => prev.includes(draft.id) ? prev.filter(rowId => rowId !== draft.id) : [...prev, draft.id])}
                                                        className="rounded border-slate-600 bg-slate-800"
                                                    />
                                                </td>
                                                <td className="px-4 py-3 font-bold text-blue-400 text-base">{draft.id}</td>
                                                <td className="px-4 py-3 text-gray-800 dark:text-slate-100 text-base">
                                                    <div className="flex flex-col leading-tight">
                                                        {draft.vendors && draft.vendors.slice(0, 2).map((v, i) => <span key={i}>{v}</span>)}
                                                        {draft.vendors && draft.vendors.length > 2 && <span className="text-xs text-slate-400 mt-1">+ {draft.vendors.length - 2} more</span>}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <ModeBadge mode={draft.mode || draft.planned_mode} />
                                                </td>
                                                <td className="px-4 py-3 text-gray-500 dark:text-slate-400 text-sm">
                                                    {formatDateString(draft.draft_date || draft.created_at)}
                                                </td>
                                                <td className="px-4 py-3 text-center text-gray-800 dark:text-slate-100 text-base">{draft.total_skus || draft.totalSkus || 0}</td>
                                                <td className="px-4 py-3 text-center text-gray-900 dark:text-white font-bold text-base">{draft.total_items || draft.totalItems || 0}</td>
                                                <td className="px-4 py-3"><StatusBadge status={draft.status} /></td>
                                                <td className="px-4 py-3 text-right">
                                                    <div className="flex justify-end gap-1.5" onClick={e => e.stopPropagation()}>
                                                        <button onClick={() => handleEdit(draft.id)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-600 rounded text-gray-400 dark:text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors duration-150" title="Edit">
                                                            {['DRAFT', 'PARTIALLY_SUBMITTED'].includes(draft.status) ? <PencilIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                                                        </button>
                                                        <button onClick={() => handleDuplicate(draft)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-slate-600 rounded text-gray-400 dark:text-slate-400 hover:text-gray-800 dark:hover:text-white transition-colors duration-150" title="Duplicate">
                                                            <DocumentDuplicateIcon className="w-4 h-4" />
                                                        </button>
                                                        {['DRAFT', 'PARTIALLY_SUBMITTED'].includes(draft.status) && (
                                                            <button onClick={() => setCancelModalDraft(draft)} className="p-1.5 hover:bg-red-500/20 rounded text-gray-400 dark:text-slate-400 hover:text-red-500 transition-colors duration-150" title="Cancel">
                                                                <TrashIcon className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="py-20 flex flex-col items-center justify-center text-slate-500">
                                    <MagnifyingGlassIcon className="w-12 h-12 mb-4 opacity-20" />
                                    <h3 className="text-lg font-medium">No matches found</h3>
                                    <p className="text-sm">Try adjusting your filters or search query.</p>
                                </div>
                            )}
                        </div>

                        {totalPages > 1 && (
                            <div className="p-4 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/30 flex items-center justify-between">
                                <span className="text-xs text-gray-500 dark:text-slate-500">
                                    Showing {(currentPage - 1) * rowsPerPage + 1}-{Math.min(currentPage * rowsPerPage, sortedDrafts.length)} of {sortedDrafts.length} drafts
                                </span>
                                <div className="flex gap-1">
                                    <button
                                        disabled={currentPage === 1}
                                        onClick={() => setCurrentPage(prev => prev - 1)}
                                        className="p-2 rounded hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                    >
                                        <ChevronLeftIcon className="w-4 h-4" />
                                    </button>
                                    {[...Array(totalPages)].map((_, i) => (
                                        <button
                                            key={i}
                                            onClick={() => setCurrentPage(i + 1)}
                                            className={`w-8 h-8 rounded text-xs font-medium transition-all ${currentPage === i + 1 ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-900 dark:hover:text-white'}`}
                                        >
                                            {i + 1}
                                        </button>
                                    ))}
                                    <button
                                        disabled={currentPage === totalPages}
                                        onClick={() => setCurrentPage(prev => prev + 1)}
                                        className="p-2 rounded hover:bg-gray-100 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                    >
                                        <ChevronRightIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </Card>
                </>
            ) : (
                <div className="border-2 border-dashed border-slate-700 rounded-2xl py-24 flex flex-col items-center justify-center bg-slate-800/20 text-center px-6">
                    <ListBulletIcon className="w-12 h-12 text-slate-600 mb-6" />
                    <h3 className="text-xl font-semibold text-slate-300">No draft orders yet</h3>
                    <p className="text-slate-500 mt-2 max-w-sm">Create your first draft order to start planning and managing purchase orders across multiple vendors.</p>
                    <Button onClick={handleCreateNew} className="mt-8 bg-blue-600 hover:bg-blue-700 h-11 px-8 font-bold text-white shadow-xl shadow-blue-900/30 transition-all duration-150 active:scale-95" icon={<PlusIcon className="w-4 h-4" />}>
                        Create Draft PO
                    </Button>
                </div>
            )}

            {cancelModalDraft && (
                <CancelDraftModal
                    isOpen={!!cancelModalDraft}
                    onClose={() => setCancelModalDraft(null)}
                    onConfirm={handleCancelDraft}
                    draftId={cancelModalDraft.id}
                    status={cancelModalDraft.status}
                />
            )}
        </div>
    );
};