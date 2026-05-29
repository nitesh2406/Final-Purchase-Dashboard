import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { 
    MagnifyingGlassIcon, EyeIcon, XMarkIcon, 
    AirplaneIcon, ShipIcon, ListBulletIcon,
    InformationCircleIcon, ArrowLeftIcon, FunnelIcon,
    LinkIcon, EnvelopeIcon, ArrowPathIcon, ExclamationTriangleIcon
} from '../icons/Icons';
import { ViewType, APPS_SCRIPT_URL, API_ACTIONS } from '../../App';

type POStatus = 'OPEN' | 'PARTIALLY_SHIPPED' | 'CLOSED' | 'CLOSED_CANCELLED';
type EmailStatus = 'NOT_SENT' | 'SENT' | 'FAILED';

interface POLine {
    sku: string;
    name: string;
    ordered_qty: number;
    unit_price: number;
    logo: boolean;
    packaging: boolean;
    manual: boolean;
    wrap: boolean;
    fulfilled_qty: number;
    status: 'PENDING' | 'PARTIAL' | 'FULFILLED';
    folder_link?: string;
    sku_name?: string;
    unit_price_rmb?: number;
    custom_logo?: boolean;
    custom_packaging?: boolean;
    solving_manual?: boolean;
    opp_wrap?: boolean;
}

interface PurchaseOrderUI {
    po_id: string;
    vendor_code: string;
    po_date: string;
    planned_mode: 'Sea' | 'Air';
    total_skus: number;
    total_qty: number;
    total_ordered_qty: number;
    total_fulfilled_qty: number;
    po_status: POStatus;
    last_updated: string;
    draft_id: string;
    total_value: number;
    lines: POLine[];
    email_status: EmailStatus;
    vendor_email: string;
    cc_emails?: string[];
}

interface PendingLine {
    po_id: string;
    vendor_code: string;
    sku: string;
    sku_name: string;
    ordered_qty: number;
    fulfilled_qty: number;
    pending_qty: number;
    days_pending: number;
    po_date: string;
    planned_mode: string;
    custom_logo: boolean;
    custom_packaging: boolean;
    solving_manual: boolean;
    opp_wrap: boolean;
    unit_price_rmb: number;
}

interface SKUHistoryLine {
    po_line_id: string;
    po_id: string;
    vendor_code: string;
    po_date: string;
    planned_mode: string;
    po_status: string;
    ordered_qty: number;
    fulfilled_qty: number;
    pending_qty: number;
    line_status: string;
    unit_price_rmb: number;
    fulfillment_days: number | null;
    updated_at: string;
}

const formatPoDate = (dateStr: string): string => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const StatusBadge: React.FC<{ status: POStatus }> = ({ status }) => {
    const config = {
        'OPEN': 'bg-blue-600/20 text-blue-400 border border-blue-500/30',
        'PARTIALLY_SHIPPED': 'bg-orange-600/20 text-orange-400 border border-orange-500/30',
        'CLOSED': 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30',
        'CLOSED_CANCELLED': 'bg-red-600/20 text-red-400 border border-red-500/30',
    };
    const labels = {
        'OPEN': 'OPEN',
        'PARTIALLY_SHIPPED': 'PARTIALLY SHIPPED',
        'CLOSED': 'CLOSED',
        'CLOSED_CANCELLED': 'CLOSED (CANCELLED)',
    };
    return (
        <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider whitespace-nowrap ${config[status]}`}>
            {labels[status]}
        </span>
    );
};

const EmailStatusBadge: React.FC<{ status: EmailStatus }> = ({ status }) => {
    const config = {
        'NOT_SENT': { style: 'bg-slate-700 text-slate-400 border-slate-600', label: 'NOT SENT', tooltip: 'Email not sent yet' },
        'SENT': { style: 'bg-emerald-600/20 text-emerald-400 border-emerald-500/30', label: 'SENT', tooltip: 'Email sent to vendor' },
        'FAILED': { style: 'bg-red-600/20 text-red-400 border-red-500/30', label: 'FAILED', tooltip: 'Email failed. Check logs.' },
    };
    const item = config[status] || config['NOT_SENT'];
    return (
        <span 
            title={item.tooltip}
            className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider border cursor-help ${item.style}`}
        >
            {item.label}
        </span>
    );
};

const ModeBadge: React.FC<{ mode: 'Sea' | 'Air' }> = ({ mode }) => {
    const isAir = String(mode).toUpperCase() === 'AIR';
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold rounded border transition-colors ${
            isAir ? 'bg-sky-600/20 text-sky-400 border-sky-600/30' : 'bg-blue-600/20 text-blue-400 border-blue-600/30'
        }`}>
            {isAir ? <AirplaneIcon className="w-3 h-3" /> : <ShipIcon className="w-3 h-3" />}
            {String(mode).toUpperCase()}
        </span>
    );
};

const FulfillmentBar: React.FC<{ ordered: number; fulfilled: number }> = ({ ordered, fulfilled }) => {
    if (ordered === 0) return <span className="text-slate-500">—</span>;
    const pct = ordered > 0 ? Math.round((fulfilled / ordered) * 100) : 0;
    const colorClass = pct === 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-500' : 'bg-slate-600';
    const textColorClass = pct === 100 ? 'text-emerald-500' : pct > 0 ? 'text-amber-500' : 'text-slate-400';

    return (
        <div className="flex items-center gap-2 min-w-[100px]">
            <div className="flex-1 bg-slate-700 rounded-full h-1.5 overflow-hidden">
                <div 
                    className={`h-full rounded-full transition-all duration-300 ${colorClass}`} 
                    style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                />
            </div>
            <span className={`text-xs font-bold font-mono ${textColorClass}`}>{pct}%</span>
        </div>
    );
};

const formatCurrency = (amount: number) => 
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);

interface PurchaseOrdersProps {
    onNavigate?: (view: ViewType) => void;
}

export const PurchaseOrders: React.FC<PurchaseOrdersProps> = ({ onNavigate }) => {
    const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderUI[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedPo, setSelectedPo] = useState<PurchaseOrderUI | null>(null);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [detailsError, setDetailsError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState<'All' | POStatus>('OPEN');
    const [showCloseConfirm, setShowCloseConfirm] = useState(false);

    // States for Filters and Tabs
    const [mainView, setMainView] = useState<'po_list' | 'pending_lines' | 'sku_history'>('po_list');
    const [showFilters, setShowFilters] = useState(false);
    const [filterVendors, setFilterVendors] = useState<string[]>([]);
    const [filterMode, setFilterMode] = useState<'All' | 'Sea' | 'Air'>('All');
    const [filterDateFrom, setFilterDateFrom] = useState('');
    const [filterDateTo, setFilterDateTo] = useState('');

    // Prefetch cache for OPEN PO lines
    const [poLinesCache, setPoLinesCache] = useState<Map<string, POLine[]>>(new Map());
    const [lastPrefetchTime, setLastPrefetchTime] = useState<string>('');
    const prefetchedRef = useRef(false);

    const uniqueVendors = useMemo(() => {
        const vendorsSet = new Set<string>();
        purchaseOrders.forEach(po => {
            if (po.vendor_code) vendorsSet.add(po.vendor_code);
        });
        return Array.from(vendorsSet).sort();
    }, [purchaseOrders]);

    const mapLineToUi = (l: any): POLine => {
        const ordered = Number(l.ordered_qty ?? 0);
        const fulfilled = Number(l.fulfilled_qty ?? 0);
        let status: POLine["status"] = "PENDING";
        if (fulfilled >= ordered && ordered > 0) status = "FULFILLED";
        else if (fulfilled > 0 && fulfilled < ordered) status = "PARTIAL";

        return {
            sku: String(l.sku ?? ""),
            name: String(l.sku_name ?? l.name ?? ""),
            ordered_qty: ordered,
            unit_price: Number(l.unit_price_rmb ?? l.unit_price ?? 0),
            logo: Boolean(l.custom_logo ?? l.logo ?? false),
            packaging: Boolean(l.custom_packaging ?? l.packaging ?? false),
            manual: Boolean(l.solving_manual ?? l.manual ?? false),
            wrap: Boolean(l.opp_wrap ?? l.wrap ?? false),
            fulfilled_qty: fulfilled,
            status,
            folder_link: l.customization_files || undefined,
            sku_name: String(l.sku_name ?? l.name ?? ""),
            unit_price_rmb: Number(l.unit_price_rmb ?? l.unit_price ?? 0),
            custom_logo: Boolean(l.custom_logo ?? l.logo ?? false),
            custom_packaging: Boolean(l.custom_packaging ?? l.packaging ?? false),
            solving_manual: Boolean(l.solving_manual ?? l.manual ?? false),
            opp_wrap: Boolean(l.opp_wrap ?? l.wrap ?? false),
        };
    };

    const fetchPurchaseOrders = async () => {
        setLoading(true);
        setError(null);
        const payload = {
            action: API_ACTIONS.GET_PURCHASE_ORDERS
        };

        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            if (!result || result.success !== true) {
                throw new Error(result?.message || "Failed to load POs");
            }
            const normalized = (result.data || []).map((po: any) => ({
                ...po,
                lines: [], // Not returned in list view
                total_skus: po.total_skus || 0,
                total_qty: po.total_qty || 0,
                total_ordered_qty: po.total_ordered_qty || 0,
                total_fulfilled_qty: po.total_fulfilled_qty || 0,
                email_status: po.email_status // Source of truth from backend
            }));
            setPurchaseOrders(normalized);
        } catch (err: any) {
            setError(err.message);
            console.error("PO fetch error:", err);
        } finally {
            setLoading(false);
        }
    };

    const fetchPurchaseOrderDetails = async (poId: string) => {
        setLoadingDetails(true);
        setDetailsError(null);

        const action = API_ACTIONS.GET_PURCHASE_ORDER_DETAILS || "get_purchase_order_details";
        const payload = { action, po_id: poId };

        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: "POST",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify(payload),
            });
            const result = await response.json();

            if (!result || result.success !== true) {
                throw new Error(result?.message || "Failed to load PO details");
            }

            const po = result.po || {};
            const lines = (result.lines || []).map(mapLineToUi);
            const total_value = lines.reduce((s, x) => s + (x.ordered_qty * x.unit_price), 0);

            setSelectedPo({
                ...po,
                lines,
                total_value,
                vendor_email: po.vendor_email ?? "",
                cc_emails: po.cc_emails ?? [],
                email_status: po.email_status // Source of truth from backend
            } as PurchaseOrderUI);

        } catch (err: any) {
            setDetailsError(err.message || "PO detail fetch failed");
            console.error("PO details error:", err);
        } finally {
            setLoadingDetails(false);
        }
    };

    useEffect(() => {
        fetchPurchaseOrders();
    }, []);

    // Prefetch all OPEN PO lines sequentially with delay
    const prefetchOpenPoLines = useCallback(async () => {
        const openPos = purchaseOrders.filter(po => String(po.po_status).toUpperCase() === 'OPEN');
        if (openPos.length === 0) return;

        const newCache = new Map<string, POLine[]>();
        const action = API_ACTIONS.GET_PURCHASE_ORDER_DETAILS || 'get_purchase_order_details';

        for (const po of openPos) {
            try {
                const response = await fetch(APPS_SCRIPT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ action, po_id: po.po_id })
                });
                const result = await response.json();
                if (result && result.success === true) {
                    const lines = (result.lines || []).map(mapLineToUi);
                    newCache.set(po.po_id, lines);
                }
            } catch (err) {
                console.error(`Prefetch failed for PO ${po.po_id}:`, err);
            }
            await new Promise(r => setTimeout(r, 300));
        }

        setPoLinesCache(newCache);
        setLastPrefetchTime(new Date().toLocaleTimeString());
    }, [purchaseOrders]);

    // Trigger prefetch when POs load
    useEffect(() => {
        if (purchaseOrders.length > 0 && !prefetchedRef.current) {
            prefetchedRef.current = true;
            prefetchOpenPoLines();
        }
    }, [purchaseOrders, prefetchOpenPoLines]);

    useEffect(() => {
        const handler = (e: any) => {
            // Refresh PO list
            prefetchedRef.current = false; // Re-trigger prefetch on refresh
            fetchPurchaseOrders();

            // If a PO is currently open, refresh its details too
            const poId = e?.detail?.po_id;
            if (poId && selectedPo?.po_id === poId) {
                fetchPurchaseOrderDetails(poId);
            }
        };

        window.addEventListener("po:refresh", handler);
        return () => window.removeEventListener("po:refresh", handler);
    }, [selectedPo]);

    const filteredPos = useMemo(() => {
        return purchaseOrders.filter(po => {
            const matchesStatus = activeTab === 'All' || String(po.po_status).toUpperCase() === activeTab;
            const matchesSearch = po.po_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                 po.vendor_code.toLowerCase().includes(searchTerm.toLowerCase());
            
            // Apply new filters
            const matchesVendors = filterVendors.length === 0 || filterVendors.includes(po.vendor_code);
            const matchesMode = filterMode === 'All' || String(po.planned_mode).toUpperCase() === filterMode.toUpperCase();
            
            let matchesDate = true;
            if (po.po_date) {
                const poDateObj = new Date(po.po_date);
                poDateObj.setHours(0,0,0,0);
                const poTime = poDateObj.getTime();

                if (filterDateFrom) {
                    const fromDateObj = new Date(filterDateFrom);
                    fromDateObj.setHours(0,0,0,0);
                    if (poTime < fromDateObj.getTime()) matchesDate = false;
                }
                if (filterDateTo) {
                    const toDateObj = new Date(filterDateTo);
                    toDateObj.setHours(0,0,0,0);
                    if (poTime > toDateObj.getTime()) matchesDate = false;
                }
            } else if (filterDateFrom || filterDateTo) {
                matchesDate = false;
            }

            return matchesStatus && matchesSearch && matchesVendors && matchesMode && matchesDate;
        });
    }, [searchTerm, activeTab, purchaseOrders, filterVendors, filterMode, filterDateFrom, filterDateTo]);

    // Enhanced click handler — use cache if available
    const handlePoClick = (poId: string) => {
        const cachedLines = poLinesCache.get(poId);
        if (cachedLines) {
            const po = purchaseOrders.find(p => p.po_id === poId);
            if (po) {
                const total_value = cachedLines.reduce((s, x) => s + (x.ordered_qty * x.unit_price), 0);
                setSelectedPo({
                    ...po,
                    lines: cachedLines,
                    total_value,
                } as PurchaseOrderUI);
                return;
            }
        }
        // Fallback to full API fetch
        fetchPurchaseOrderDetails(poId);
    };

    const handleClosePo = async () => {
        if (!selectedPo) return;
        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'close_po', po_id: selectedPo.po_id })
            });
            const result = await response.json();
            if (!result || result.success !== true) throw new Error(result?.message || 'Failed to close PO');
            setShowCloseConfirm(false);
            setSelectedPo(null);
            prefetchedRef.current = false;
            fetchPurchaseOrders();
        } catch (err: any) {
            alert('Close PO failed: ' + err.message);
            setShowCloseConfirm(false);
        }
    };

    const handleDownloadPoCSV = () => {
        if (!selectedPo) return;
        const lines = poLinesCache.get(selectedPo.po_id) || selectedPo.lines || [];
        
        const headers = [
            'PO ID', 'SKU', 'SKU Name', 'Ordered Qty', 'Fulfilled Qty',
            'Pending Qty', 'Unit Price (RMB)', 'Logo', 'Packaging', 'Manual', 'OPP Wrap'
        ];
        
        const rows = lines.map(line => [
            selectedPo.po_id,
            line.sku,
            `"${(line.sku_name || '').replace(/"/g, '""')}"`,
            line.ordered_qty,
            line.fulfilled_qty || 0,
            (line.ordered_qty || 0) - (line.fulfilled_qty || 0),
            line.unit_price_rmb || 0,
            line.custom_logo ? 'Yes' : 'No',
            line.custom_packaging ? 'Yes' : 'No',
            line.solving_manual ? 'Yes' : 'No',
            line.opp_wrap ? 'Yes' : 'No'
        ]);
        
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selectedPo.po_id}_lines.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (selectedPo || loadingDetails || detailsError) {
        return (
        <div className="flex flex-col h-full overflow-y-auto space-y-6 text-gray-900 dark:text-white p-6 bg-gray-50 dark:bg-[#0f172a] animate-in fade-in duration-300">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={() => { setSelectedPo(null); setDetailsError(null); }} 
                            className="p-2 -ml-2 text-slate-400 hover:text-white transition-colors"
                        >
                            <ArrowLeftIcon className="w-6 h-6" />
                        </button>
                        <div>
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                                {loadingDetails ? 'Loading details...' : selectedPo ? <>Purchase Order: <span className="font-mono text-blue-400">{selectedPo.po_id}</span></> : 'Error'}
                                {selectedPo && <StatusBadge status={selectedPo.po_status} />}
                            </h2>
                            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Full details and line item fulfillment status</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {selectedPo && (
                            <button
                                onClick={handleDownloadPoCSV}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                                           bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg
                                           border border-slate-600 transition-colors"
                            >
                                ⬇ Download CSV
                            </button>
                        )}
                        <Button 
                            variant="secondary" 
                            onClick={() => { setSelectedPo(null); setDetailsError(null); }}
                            className="h-10 px-4 border-slate-700 bg-slate-800/50 hover:bg-slate-800"
                        >
                            Back to List
                        </Button>
                        {selectedPo && selectedPo.po_status === 'OPEN' && (
                            <Button 
                                className="bg-red-600/10 text-red-500 border border-red-500/20 hover:bg-red-600 hover:text-white h-10 font-bold"
                                onClick={() => setShowCloseConfirm(true)}
                            >
                                Close PO
                            </Button>
                        )}
                    </div>
                </div>

                {loadingDetails ? (
                    <div className="flex-grow flex items-center justify-center min-h-[400px]">
                        <div className="flex flex-col items-center gap-3">
                            <ArrowPathIcon className="w-12 h-12 animate-spin text-blue-500" />
                            <p className="text-slate-400 font-medium">Fetching PO details and line items...</p>
                        </div>
                    </div>
                ) : detailsError ? (
                    <div className="flex-grow flex items-center justify-center min-h-[400px]">
                        <Card className="max-w-md p-8 text-center bg-red-500/5 border-red-500/20">
                            <ExclamationTriangleIcon className="w-12 h-12 text-red-500 mx-auto mb-4" />
                            <h3 className="text-xl font-bold text-white mb-2">Fetch Failed</h3>
                            <p className="text-slate-400 text-sm mb-6">{detailsError}</p>
                            <Button onClick={() => { if(selectedPo) fetchPurchaseOrderDetails(selectedPo.po_id); }} className="bg-red-600 hover:bg-red-700">Retry Fetch</Button>
                        </Card>
                    </div>
                ) : selectedPo ? (
                    <>
                        {/* Header Info Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                            <Card className="bg-white dark:bg-slate-800/40 p-4 border-gray-200 dark:border-slate-700">
                                <p className="text-[10px] font-bold text-gray-500 dark:text-slate-500 uppercase tracking-widest mb-1">Vendor Code</p>
                                <p className="text-base font-bold text-gray-900 dark:text-white">{selectedPo.vendor_code}</p>
                            </Card>
                            <Card className="bg-white dark:bg-slate-800/40 p-4 border-gray-200 dark:border-slate-700">
                                <p className="text-[10px] font-bold text-gray-500 dark:text-slate-500 uppercase tracking-widest mb-1">Draft Reference</p>
                                <p className="text-base text-blue-400 font-mono font-medium">{selectedPo.draft_id}</p>
                            </Card>
                            <Card className="bg-white dark:bg-slate-800/40 p-4 border-gray-200 dark:border-slate-700">
                                <p className="text-[10px] font-bold text-gray-500 dark:text-slate-500 uppercase tracking-widest mb-1">PO Date</p>
                                <p className="text-base text-gray-900 dark:text-white">{formatPoDate(selectedPo.po_date)}</p>
                            </Card>
                            <Card className="bg-white dark:bg-slate-800/40 p-4 border-gray-200 dark:border-slate-700">
                                <p className="text-[10px] font-bold text-gray-500 dark:text-slate-500 uppercase tracking-widest mb-1">Shipping Mode</p>
                                <div className="mt-1"><ModeBadge mode={selectedPo.planned_mode} /></div>
                            </Card>
                            <Card className="bg-white dark:bg-slate-800/40 p-4 border-gray-200 dark:border-slate-700">
                                <p className="text-[10px] font-bold text-gray-500 dark:text-slate-500 uppercase tracking-widest mb-1">Total Value</p>
                                <p className="text-lg font-bold text-green-400">{formatCurrency(selectedPo.total_value)}</p>
                            </Card>
                            <Card className="bg-white dark:bg-slate-800/40 p-4 border-gray-200 dark:border-slate-700 flex flex-col justify-between">
                                <div>
                                    <p className="text-[10px] font-bold text-gray-500 dark:text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                                        <EnvelopeIcon className="w-3 h-3"/> Email Information
                                    </p>
                                    <p className="text-[11px] text-slate-300 truncate" title={selectedPo.vendor_email}>{selectedPo.vendor_email || 'No email provided'}</p>
                                    <p className="text-[9px] text-slate-500 mt-0.5 truncate">
                                        CC: {selectedPo.cc_emails && selectedPo.cc_emails.length > 0 ? selectedPo.cc_emails.join(', ') : 'None'}
                                    </p>
                                </div>
                                <div className="mt-2 pt-2 border-t border-slate-700/50">
                                    <EmailStatusBadge status={selectedPo.email_status} />
                                </div>
                            </Card>
                        </div>

                        {/* Line Items Table */}
                        <Card className="flex-grow p-0 border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/20 overflow-hidden shadow-xl">
                            <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex justify-between items-center bg-gray-50 dark:bg-slate-900/40">
                                <h3 className="text-sm font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">Order Line Items</h3>
                                <span className="text-xs text-gray-500 dark:text-slate-500 font-medium">{selectedPo.lines.length} SKUs Ordered</span>
                            </div>
                        <div className="overflow-x-auto overflow-y-auto max-h-[60vh]">
                                <table className="w-full text-left text-sm border-collapse">
                                    <thead>
                                        <tr className="bg-gray-50 dark:bg-slate-900/30 text-gray-500 dark:text-slate-400 text-[10px] uppercase tracking-wider border-b border-gray-200 dark:border-slate-700/50">
                                            <th className="px-6 py-3 font-medium w-[12%]">SKU</th>
                                            <th className="px-6 py-3 font-medium w-[20%]">Item Name</th>
                                            <th className="px-6 py-3 font-medium text-center">Ordered</th>
                                            <th className="px-6 py-3 font-medium text-right">Unit Price</th>
                                            <th className="px-6 py-3 font-medium text-center">Logo/Pkg/Man/Wrp</th>
                                            <th className="px-6 py-3 font-medium text-center">Fulfilled</th>
                                            <th className="px-6 py-3 font-medium text-center">Customization</th>
                                            <th className="px-6 py-3 font-medium text-right">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700/30">
                                        {selectedPo.lines.map((line, idx) => (
                                            <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-slate-700/20 transition-colors">
                                                <td className="px-6 py-4 font-mono text-xs text-blue-300">{line.sku}</td>
                                                <td className="px-6 py-4 font-medium text-gray-900 dark:text-white truncate text-xs">{line.name}</td>
                                                <td className="px-6 py-4 text-center font-bold">{line.ordered_qty}</td>
                                                <td className="px-6 py-4 text-right text-gray-500 dark:text-slate-400 font-mono text-xs">₹{line.unit_price.toLocaleString()}</td>
                                                <td className="px-6 py-4">
                                                    <div className="flex justify-center gap-1">
                                                        <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${line.logo ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-800 text-slate-600'}`}>LOGO</span>
                                                        <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${line.packaging ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-800 text-slate-600'}`}>PKG</span>
                                                        <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${line.manual ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-800 text-slate-600'}`}>MAN</span>
                                                        <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${line.wrap ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-800 text-slate-600'}`}>WRP</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-center font-bold text-emerald-400 bg-emerald-500/5">{line.fulfilled_qty}</td>
                                                <td className="px-6 py-4 text-center">
                                                    {line.folder_link ? (
                                                        <a 
                                                            href={line.folder_link} 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 bg-blue-600/10 text-blue-400 border border-blue-500/20 rounded hover:bg-blue-600 hover:text-white transition-all"
                                                        >
                                                            <LinkIcon className="w-3 h-3" /> OPEN FOLDER
                                                        </a>
                                                    ) : <span className="text-slate-600">—</span>}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                                        line.status === 'FULFILLED' ? 'text-emerald-500' : 
                                                        line.status === 'PARTIAL' ? 'text-orange-500' : 'text-slate-500'
                                                    }`}>
                                                        {line.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="p-6 bg-slate-900/40 border-t border-slate-700 flex justify-end gap-12">
                                <div className="text-right">
                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total Items</p>
                                    <p className="text-xl font-bold text-white">{selectedPo.total_qty}</p>
                                </div>
                                <div className="text-right pr-4">
                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">PO Net Total</p>
                                    <p className="text-2xl font-bold text-blue-400">{formatCurrency(selectedPo.total_value)}</p>
                                </div>
                            </div>
                        </Card>

                        {/* Close PO Confirmation Dialog */}
                        {showCloseConfirm && (
                            <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-4">
                                <Card className="max-w-md w-full bg-[#1e293b] border-slate-700 shadow-2xl p-8 text-center animate-in zoom-in-95 duration-200">
                                    <div className="w-16 h-16 bg-red-600/10 rounded-full flex items-center justify-center mx-auto mb-6">
                                        <InformationCircleIcon className="w-10 h-10 text-red-500" />
                                    </div>
                                    <h3 className="text-xl font-bold text-white mb-2">Close Purchase Order?</h3>
                                    <p className="text-slate-400 text-sm mb-8 leading-relaxed">
                                        Closing <span className="text-white font-mono">{selectedPo?.po_id}</span> will mark it as complete. This will prevent further shipments from being matched.
                                    </p>
                                    <div className="flex gap-3">
                                        <Button 
                                            variant="secondary" 
                                            className="flex-1 border-slate-700 text-slate-300 h-11 bg-slate-800/50 hover:bg-slate-800" 
                                            onClick={() => setShowCloseConfirm(false)}
                                        >
                                            Keep Open
                                        </Button>
                                        <Button 
                                            className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold h-11"
                                            onClick={handleClosePo}
                                        >
                                            Close PO
                                        </Button>
                                    </div>
                                </Card>
                            </div>
                        )}
                    </>
                ) : null}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full space-y-4 text-gray-900 dark:text-white p-6 bg-gray-50 dark:bg-[#0f172a] min-h-screen relative">
            {/* Header & Global Search */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-xl font-semibold">Purchase Orders</h2>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Review finalized purchase agreements and track line-item fulfillment</p>
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <div className="relative w-full md:w-96">
                        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <input 
                            type="text"
                            placeholder="Search by PO ID or Vendor Code..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-slate-500 text-sm shadow-sm text-gray-900 dark:text-white"
                        />
                    </div>
                    <Button 
                        onClick={fetchPurchaseOrders} 
                        disabled={loading}
                        variant="secondary"
                        className="h-[42px] px-4 border-slate-700 flex items-center gap-2 bg-slate-800/50 hover:bg-slate-800"
                        icon={loading ? <ArrowPathIcon className="w-4 h-4 animate-spin"/> : undefined}
                    >
                        {loading ? 'Syncing...' : '🔄 Sync Purchase Orders'}
                    </Button>
                    <Button 
                        onClick={() => setShowFilters(!showFilters)} 
                        variant="secondary" 
                        className={`h-[42px] px-4 border-slate-700 flex items-center gap-2 ${showFilters ? 'bg-slate-700 text-white' : 'bg-slate-800/50 hover:bg-slate-800'}`}
                        icon={<FunnelIcon className="w-4 h-4"/>}
                    >
                        Filters
                    </Button>
                </div>
            </div>

            {/* Filter Panel (Slide down when showFilters is true) */}
            {showFilters && (
                <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 space-y-4 animate-in slide-in-from-top duration-200">
                    {/* Row 1: Vendor multi-select */}
                    <div className="space-y-1.5">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Vendors</span>
                        <div className="flex flex-wrap gap-2">
                            {uniqueVendors.map(vendor => {
                                const isSelected = filterVendors.includes(vendor);
                                return (
                                    <button
                                        key={vendor}
                                        onClick={() => {
                                            if (isSelected) {
                                                setFilterVendors(prev => prev.filter(v => v !== vendor));
                                            } else {
                                                setFilterVendors(prev => [...prev, vendor]);
                                            }
                                        }}
                                        className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                            isSelected 
                                                ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-md shadow-blue-900/30' 
                                                : 'bg-slate-700 text-slate-350 hover:bg-slate-600'
                                        }`}
                                    >
                                        {vendor}
                                    </button>
                                );
                            })}
                            {uniqueVendors.length === 0 && (
                                <span className="text-xs text-slate-500 italic">No vendors available</span>
                            )}
                        </div>
                    </div>

                    {/* Row 2: Mode toggle */}
                    <div className="space-y-1.5">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Shipping Mode</span>
                        <div className="flex gap-2">
                            {(['All', 'Sea', 'Air'] as const).map(mode => {
                                const isSelected = filterMode === mode;
                                return (
                                    <button
                                        key={mode}
                                        onClick={() => setFilterMode(mode)}
                                        className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                            isSelected 
                                                ? 'bg-blue-600 text-white hover:bg-blue-500 shadow-md shadow-blue-900/30' 
                                                : 'bg-slate-700 text-slate-350 hover:bg-slate-650'
                                        }`}
                                    >
                                        {mode}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Row 3: Date range */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">From Date</label>
                            <input
                                type="date"
                                value={filterDateFrom}
                                onChange={(e) => setFilterDateFrom(e.target.value)}
                                className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-white focus:ring-2 focus:ring-blue-500 focus:outline-none w-full"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">To Date</label>
                            <input
                                type="date"
                                value={filterDateTo}
                                onChange={(e) => setFilterDateTo(e.target.value)}
                                className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-white focus:ring-2 focus:ring-blue-500 focus:outline-none w-full"
                            />
                        </div>
                    </div>

                    {/* Row 4: Clear Filters */}
                    <div className="flex justify-end pt-2 border-t border-slate-700/50">
                        <button
                            onClick={() => {
                                setFilterVendors([]);
                                setFilterMode('All');
                                setFilterDateFrom('');
                                setFilterDateTo('');
                            }}
                            className="text-xs text-slate-400 hover:text-white font-medium transition-all"
                        >
                            Clear Filters
                        </button>
                    </div>
                </div>
            )}

            {/* Main View Tabs (Row 1) */}
            <div className="flex gap-8 border-b border-slate-800 px-1 mt-2">
                {([
                    { key: 'po_list', label: 'PO List' },
                    { key: 'pending_lines', label: 'Pending Lines' },
                    { key: 'sku_history', label: 'SKU History' }
                ] as const).map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setMainView(tab.key)}
                        className={`pb-3 text-sm font-semibold transition-all relative ${
                            mainView === tab.key ? 'text-blue-500' : 'text-slate-500 hover:text-slate-350'
                        }`}
                    >
                        {tab.label}
                        {mainView === tab.key && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />}
                    </button>
                ))}
            </div>

            {/* Status Filter Tabs (Row 2, only shown when mainView === 'po_list') */}
            {mainView === 'po_list' && (
                <div className="flex gap-8 border-b border-slate-800 px-1 mt-2">
                    {(['All', 'OPEN', 'PARTIALLY_SHIPPED', 'CLOSED', 'CLOSED_CANCELLED'] as const).map(tab => {
                        const labels: Record<string, string> = {
                            'All': 'All POs',
                            'OPEN': 'Open',
                            'PARTIALLY_SHIPPED': 'Partially Shipped',
                            'CLOSED': 'Completed',
                            'CLOSED_CANCELLED': 'Cancelled'
                        };
                        return (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`pb-3 text-sm font-medium transition-all relative ${
                                    activeTab === tab ? 'text-blue-500' : 'text-slate-500 hover:text-slate-300'
                                }`}
                            >
                                {labels[tab]}
                                {activeTab === tab && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Main Content Area */}
            {mainView === 'po_list' && (
                <Card className="flex-grow overflow-hidden p-0 flex flex-col bg-white dark:bg-slate-800/30 border-gray-200 dark:border-slate-700 shadow-xl min-h-[400px]">
                    {loading && purchaseOrders.length === 0 ? (
                        <div className="flex-grow flex items-center justify-center">
                            <div className="flex flex-col items-center gap-3">
                                <ArrowPathIcon className="w-10 h-10 animate-spin text-blue-500" />
                                <p className="text-slate-400 text-sm font-medium">Fetching Purchase Orders...</p>
                            </div>
                        </div>
                    ) : error ? (
                        <div className="flex-grow flex items-center justify-center">
                            <div className="text-center p-8">
                                <ExclamationTriangleIcon className="w-12 h-12 text-red-500 mx-auto mb-4" />
                                <h3 className="text-lg font-bold text-white mb-2">Sync Failed</h3>
                                <p className="text-slate-400 text-sm mb-6 max-w-md">{error}</p>
                                <Button onClick={fetchPurchaseOrders} className="bg-blue-600 hover:bg-blue-700 px-8">Retry Sync</Button>
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-x-auto min-w-[1100px]">
                            <table className="w-full text-left text-sm border-collapse">
                                <thead>
                                    <tr className="bg-gray-50 dark:bg-slate-900/50 text-gray-500 dark:text-slate-400 text-[11px] uppercase tracking-wider border-b border-gray-200 dark:border-slate-700">
                                        <th className="px-6 py-3 font-medium">PO ID</th>
                                        <th className="px-6 py-3 font-medium">Vendor Code</th>
                                        <th className="px-6 py-3 font-medium">PO Date</th>
                                        <th className="px-6 py-3 font-medium text-center">Mode</th>
                                        <th className="px-6 py-3 font-medium text-center">Total SKUs</th>
                                        <th className="px-6 py-3 font-medium text-center">Total Qty</th>
                                        <th className="px-6 py-3 font-medium text-center">FULFILLED</th>
                                        <th className="px-6 py-3 font-medium">Email Status</th>
                                        <th className="px-6 py-3 font-medium">Status</th>
                                        <th className="px-6 py-3 font-medium text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700/50">
                                    {filteredPos.map((po) => (
                                        <tr 
                                            key={po.po_id} 
                                            onClick={() => handlePoClick(po.po_id)}
                                            className="group hover:bg-gray-50 dark:hover:bg-slate-700/40 transition-colors duration-150 cursor-pointer"
                                        >
                                            <td className="px-6 py-4 font-mono font-bold text-blue-400">{po.po_id}</td>
                                            <td className="px-6 py-4 text-slate-200 font-medium">{po.vendor_code}</td>
                                            <td className="px-6 py-4 text-slate-400 text-xs">
                                                {formatPoDate(po.po_date)}
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <ModeBadge mode={po.planned_mode} />
                                            </td>
                                            <td className="px-6 py-4 text-center text-slate-300">{po.total_skus}</td>
                                            <td className="px-6 py-4 text-center text-white font-medium">{po.total_qty}</td>
                                            <td className="px-6 py-4">
                                                <FulfillmentBar ordered={po.total_ordered_qty} fulfilled={po.total_fulfilled_qty} />
                                            </td>
                                            <td className="px-6 py-4">
                                                <EmailStatusBadge status={po.email_status} />
                                            </td>
                                            <td className="px-6 py-4">
                                                <StatusBadge status={po.po_status} />
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button className="p-2 hover:bg-slate-600 rounded-lg text-slate-400 group-hover:text-blue-400 transition-all">
                                                    <EyeIcon className="w-5 h-5" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {filteredPos.length === 0 && (
                                <div className="py-24 flex flex-col items-center justify-center text-slate-500">
                                    <ListBulletIcon className="w-12 h-12 mb-4 opacity-20" />
                                    <h3 className="text-lg font-medium">No purchase orders matching filters</h3>
                                    <p className="text-sm mt-1">Try adjusting your search or filters.</p>
                                </div>
                            )}
                        </div>
                    )}
                </Card>
            )}

            {mainView === 'pending_lines' && (
                <PendingLinesView onPoClick={handlePoClick} />
            )}

            {mainView === 'sku_history' && (
                <SKUHistoryView onPoClick={handlePoClick} />
            )}
        </div>
    );
};

// ==========================================
// PendingLinesView Component
// ==========================================
interface PendingLinesViewProps {
    onPoClick: (poId: string) => void;
}

const PendingLinesView: React.FC<PendingLinesViewProps> = ({ onPoClick }) => {
    const [pendingLines, setPendingLines] = useState<PendingLine[]>([]);
    const [loadingPending, setLoadingPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pendingVendorFilter, setPendingVendorFilter] = useState<string>('All');
    const [pendingSortKey, setPendingSortKey] = useState<keyof PendingLine>('days_pending');
    const [pendingSortDir, setPendingSortDir] = useState<'asc' | 'desc'>('desc');

    const fetchPendingLines = async () => {
        setLoadingPending(true);
        setError(null);
        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: API_ACTIONS.GET_PENDING_LINES })
            });
            const result = await response.json();
            if (result && result.success === true) {
                setPendingLines(result.data || []);
            } else {
                throw new Error(result?.message || 'Failed to load pending lines');
            }
        } catch (err: any) {
            setError(err.message || 'Error loading pending lines');
        } finally {
            setLoadingPending(false);
        }
    };

    useEffect(() => {
        fetchPendingLines();
    }, []);

    const uniqueVendors = useMemo(() => {
        const set = new Set<string>();
        pendingLines.forEach(line => {
            if (line.vendor_code) set.add(line.vendor_code);
        });
        return Array.from(set).sort();
    }, [pendingLines]);

    const handleSort = (key: keyof PendingLine) => {
        if (pendingSortKey === key) {
            setPendingSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setPendingSortKey(key);
            setPendingSortDir('desc');
        }
    };

    const sortedAndFilteredLines = useMemo(() => {
        let result = [...pendingLines];
        if (pendingVendorFilter !== 'All') {
            result = result.filter(line => line.vendor_code === pendingVendorFilter);
        }
        result.sort((a, b) => {
            const aVal = a[pendingSortKey];
            const bVal = b[pendingSortKey];
            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return pendingSortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            }
            const aNum = Number(aVal ?? 0);
            const bNum = Number(bVal ?? 0);
            return pendingSortDir === 'asc' ? aNum - bNum : bNum - aNum;
        });
        return result;
    }, [pendingLines, pendingVendorFilter, pendingSortKey, pendingSortDir]);

    const handleExportCSV = () => {
        const headers = [
            'PO ID', 'Vendor', 'SKU', 'SKU Name', 'Ordered', 'Fulfilled', 'Pending', 
            'Days Pending', 'Mode', 'Logo', 'Packaging', 'Manual', 'OPP Wrap', 'PO Date'
        ];
        const csvRows = [headers.join(',')];
        for (const line of sortedAndFilteredLines) {
            const values = [
                line.po_id,
                line.vendor_code,
                line.sku,
                `"${(line.sku_name || '').replace(/"/g, '""')}"`,
                line.ordered_qty,
                line.fulfilled_qty,
                line.pending_qty,
                line.days_pending,
                line.planned_mode,
                line.custom_logo ? 'Yes' : 'No',
                line.custom_packaging ? 'Yes' : 'No',
                line.solving_manual ? 'Yes' : 'No',
                line.opp_wrap ? 'Yes' : 'No',
                line.po_date || ''
            ];
            csvRows.push(values.join(','));
        }
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `pending_po_lines_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const SortHeader: React.FC<{ label: string; field: keyof PendingLine; center?: boolean }> = ({ label, field, center }) => {
        const isSorted = pendingSortKey === field;
        return (
            <th 
                className={`px-4 py-3 font-semibold text-[11px] uppercase tracking-wider cursor-pointer hover:text-white transition-colors border-b border-slate-700 ${center ? 'text-center' : 'text-left'}`}
                onClick={() => handleSort(field)}
            >
                <div className={`flex items-center gap-1 ${center ? 'justify-center' : 'justify-start'}`}>
                    <span>{label}</span>
                    {isSorted && (
                        <span className="text-[10px]">{pendingSortDir === 'asc' ? '▲' : '▼'}</span>
                    )}
                </div>
            </th>
        );
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-slate-800/40 p-4 rounded-xl border border-slate-700">
                <div className="flex items-center gap-3">
                    <h3 className="text-lg font-bold text-white">Pending PO Lines</h3>
                    <span className="bg-blue-600/20 text-blue-400 text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-500/20">
                        {sortedAndFilteredLines.length} Lines
                    </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Vendor:</span>
                        <select
                            value={pendingVendorFilter}
                            onChange={(e) => setPendingVendorFilter(e.target.value)}
                            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-white focus:ring-2 focus:ring-blue-500 focus:outline-none font-semibold"
                        >
                            <option value="All">All Vendors</option>
                            {uniqueVendors.map(v => (
                                <option key={v} value={v}>{v}</option>
                            ))}
                        </select>
                    </div>
                    <Button 
                        onClick={handleExportCSV}
                        disabled={sortedAndFilteredLines.length === 0}
                        variant="secondary"
                        className="h-8 text-xs px-3 border-slate-700 flex items-center gap-1.5 bg-slate-800/50 hover:bg-slate-800"
                    >
                        📤 Export CSV
                    </Button>
                </div>
            </div>

            <Card className="overflow-hidden p-0 flex flex-col bg-white dark:bg-slate-800/30 border-gray-200 dark:border-slate-700 shadow-xl min-h-[400px]">
                {loadingPending ? (
                    <div className="flex-grow flex items-center justify-center min-h-[350px]">
                        <div className="flex flex-col items-center gap-3">
                            <ArrowPathIcon className="w-10 h-10 animate-spin text-blue-500" />
                            <p className="text-slate-400 text-sm font-medium">Loading pending lines...</p>
                        </div>
                    </div>
                ) : error ? (
                    <div className="flex-grow flex items-center justify-center min-h-[350px]">
                        <div className="text-center p-8">
                            <ExclamationTriangleIcon className="w-12 h-12 text-red-500 mx-auto mb-4" />
                            <h3 className="text-lg font-bold text-white mb-2">Failed to load Pending Lines</h3>
                            <p className="text-slate-400 text-sm mb-6">{error}</p>
                            <Button onClick={fetchPendingLines} className="bg-blue-600 hover:bg-blue-700 px-6">Retry</Button>
                        </div>
                    </div>
                ) : (
                    <div className="overflow-x-auto min-w-[1100px]">
                        <table className="w-full text-left text-sm border-collapse">
                            <thead>
                                <tr className="bg-gray-50 dark:bg-slate-900/50 text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                                    <SortHeader label="PO ID" field="po_id" />
                                    <SortHeader label="Vendor" field="vendor_code" />
                                    <SortHeader label="SKU" field="sku" />
                                    <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider text-left border-b border-slate-700">SKU Name</th>
                                    <SortHeader label="Ordered" field="ordered_qty" center />
                                    <SortHeader label="Fulfilled" field="fulfilled_qty" center />
                                    <SortHeader label="Pending" field="pending_qty" center />
                                    <SortHeader label="Days Pending" field="days_pending" center />
                                    <SortHeader label="Mode" field="planned_mode" center />
                                    <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider text-center border-b border-slate-700">Customization</th>
                                    <SortHeader label="PO Date" field="po_date" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/50">
                                {sortedAndFilteredLines.map((line, idx) => {
                                    let daysBadgeClass = "bg-emerald-500/20 text-emerald-400";
                                    if (line.days_pending > 60) {
                                        daysBadgeClass = "bg-red-500/20 text-red-400";
                                    } else if (line.days_pending >= 30) {
                                        daysBadgeClass = "bg-amber-500/20 text-amber-400";
                                    }

                                    return (
                                        <tr key={idx} className="hover:bg-slate-700/20 transition-colors">
                                            <td className="px-4 py-3 font-mono font-bold">
                                                <button
                                                    onClick={() => onPoClick(line.po_id)}
                                                    className="text-blue-400 hover:text-blue-300 hover:underline text-left transition-colors"
                                                >
                                                    {line.po_id}
                                                </button>
                                            </td>
                                            <td className="px-4 py-3 text-slate-200 font-medium">{line.vendor_code}</td>
                                            <td className="px-4 py-3 font-mono text-xs text-blue-300">{line.sku}</td>
                                            <td className="px-4 py-3 max-w-[200px] truncate text-slate-300 text-xs" title={line.sku_name}>
                                                {line.sku_name}
                                            </td>
                                            <td className="px-4 py-3 text-center text-slate-400 font-mono text-xs">{line.ordered_qty}</td>
                                            <td className="px-4 py-3 text-center text-slate-400 font-mono text-xs">{line.fulfilled_qty}</td>
                                            <td className="px-4 py-3 text-center text-white font-bold font-mono text-sm">{line.pending_qty}</td>
                                            <td className="px-4 py-3 text-center">
                                                <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono ${daysBadgeClass}`}>
                                                    {line.days_pending} d
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <ModeBadge mode={line.planned_mode as any} />
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex justify-center gap-1">
                                                    {line.custom_logo && <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-blue-500/20 text-blue-400">LOGO</span>}
                                                    {line.custom_packaging && <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-blue-500/20 text-blue-400">PKG</span>}
                                                    {line.solving_manual && <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-blue-500/20 text-blue-400">MAN</span>}
                                                    {line.opp_wrap && <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-blue-500/20 text-blue-400">WRP</span>}
                                                    {!line.custom_logo && !line.custom_packaging && !line.solving_manual && !line.opp_wrap && <span className="text-slate-600">—</span>}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-slate-400 text-xs">
                                                {formatPoDate(line.po_date)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {sortedAndFilteredLines.length === 0 && (
                            <div className="py-24 flex flex-col items-center justify-center text-slate-500">
                                <ListBulletIcon className="w-12 h-12 mb-4 opacity-20" />
                                <h3 className="text-lg font-medium">No pending lines found</h3>
                            </div>
                        )}
                    </div>
                )}
            </Card>
        </div>
    );
};

// ==========================================
// SKUHistoryView Component
// ==========================================
interface SKUHistoryViewProps {
    onPoClick: (poId: string) => void;
}

const SKUHistoryView: React.FC<SKUHistoryViewProps> = ({ onPoClick }) => {
    const [skuQuery, setSkuQuery] = useState('');
    const [skuResults, setSkuResults] = useState<SKUHistoryLine[]>([]);
    const [loadingSKU, setLoadingSKU] = useState(false);
    const [skuSearched, setSkuSearched] = useState('');
    const [error, setError] = useState<string | null>(null);

    const handleSearch = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!skuQuery.trim()) return;

        setLoadingSKU(true);
        setError(null);
        setSkuSearched('');
        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ 
                    action: API_ACTIONS.GET_SKU_HISTORY,
                    sku: skuQuery.trim()
                })
            });
            const result = await response.json();
            if (result && result.success === true) {
                setSkuResults(result.data || []);
                setSkuSearched(skuQuery.trim());
            } else {
                throw new Error(result?.message || 'Failed to search history');
            }
        } catch (err: any) {
            setError(err.message || 'Error executing search');
        } finally {
            setLoadingSKU(false);
        }
    };

    const stats = useMemo(() => {
        if (skuResults.length === 0) return null;
        const totalOrders = new Set(skuResults.map(r => r.po_id)).size;
        const totalOrdered = skuResults.reduce((sum, r) => sum + Number(r.ordered_qty || 0), 0);
        const totalFulfilled = skuResults.reduce((sum, r) => sum + Number(r.fulfilled_qty || 0), 0);
        
        const fulfilledLines = skuResults.filter(r => r.fulfillment_days !== null && r.fulfillment_days !== undefined);
        const avgDays = fulfilledLines.length > 0
            ? Math.round(fulfilledLines.reduce((sum, r) => sum + Number(r.fulfillment_days), 0) / fulfilledLines.length)
            : '—';

        return { totalOrders, totalOrdered, totalFulfilled, avgDays };
    }, [skuResults]);

    return (
        <div className="space-y-4">
            {/* Search Bar */}
            <form onSubmit={handleSearch} className="flex gap-2 bg-slate-800/40 p-4 rounded-xl border border-slate-700">
                <div className="relative flex-1">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                        type="text"
                        placeholder="Enter SKU to search history..."
                        value={skuQuery}
                        onChange={(e) => setSkuQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-slate-700 border border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm text-white"
                    />
                </div>
                <Button 
                    type="submit"
                    disabled={loadingSKU || !skuQuery.trim()}
                    className="bg-blue-600 hover:bg-blue-700 px-6 text-sm h-10 font-bold"
                >
                    Search
                </Button>
            </form>

            {loadingSKU ? (
                <Card className="flex items-center justify-center min-h-[350px] bg-slate-800/30 border-slate-700">
                    <div className="flex flex-col items-center gap-3">
                        <ArrowPathIcon className="w-10 h-10 animate-spin text-blue-500" />
                        <p className="text-slate-400 text-sm font-medium">Searching PO history for SKU...</p>
                    </div>
                </Card>
            ) : error ? (
                <Card className="flex items-center justify-center min-h-[350px] bg-slate-800/30 border-slate-700">
                    <div className="text-center p-8">
                        <ExclamationTriangleIcon className="w-12 h-12 text-red-500 mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-white mb-2">Search Failed</h3>
                        <p className="text-slate-400 text-sm mb-6">{error}</p>
                        <Button onClick={() => handleSearch()} className="bg-blue-600 hover:bg-blue-700 px-6">Retry</Button>
                    </div>
                </Card>
            ) : !skuSearched ? (
                <Card className="flex flex-col items-center justify-center min-h-[350px] bg-slate-800/30 border-slate-700 py-24 text-center">
                    <ListBulletIcon className="w-12 h-12 text-slate-600 mb-4 opacity-35" />
                    <h3 className="text-lg font-medium text-slate-400">Search a SKU to see its full order history</h3>
                    <p className="text-slate-500 text-sm mt-1 max-w-sm">Type a product SKU above and search to visualize average lead times and fulfillment trends.</p>
                </Card>
            ) : skuResults.length === 0 ? (
                <Card className="flex flex-col items-center justify-center min-h-[350px] bg-slate-800/30 border-slate-700 py-24 text-center">
                    <InformationCircleIcon className="w-12 h-12 text-slate-600 mb-4 opacity-35" />
                    <h3 className="text-lg font-medium text-slate-400">No PO history found for SKU: <span className="font-mono text-blue-400 font-bold">{skuSearched}</span></h3>
                </Card>
            ) : (
                <div className="space-y-4">
                    {/* Summary Row */}
                    {stats && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-800/20 border border-slate-700/50 p-4 rounded-xl">
                            <div className="text-center md:text-left border-r border-slate-700/50 last:border-0">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total Orders</p>
                                <p className="text-lg font-bold text-white">{stats.totalOrders}</p>
                            </div>
                            <div className="text-center md:text-left border-r border-slate-700/50 last:border-0 md:pl-4">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total Ordered</p>
                                <p className="text-lg font-bold text-white">{stats.totalOrdered.toLocaleString()} units</p>
                            </div>
                            <div className="text-center md:text-left border-r border-slate-700/50 last:border-0 md:pl-4">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total Fulfilled</p>
                                <p className="text-lg font-bold text-emerald-400">{stats.totalFulfilled.toLocaleString()} units</p>
                            </div>
                            <div className="text-center md:text-left last:border-0 md:pl-4">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Avg Fulfillment Time</p>
                                <p className="text-lg font-bold text-blue-400">{stats.avgDays} {stats.avgDays !== '—' ? 'days' : ''}</p>
                            </div>
                        </div>
                    )}

                    {/* Results Table */}
                    <Card className="overflow-hidden p-0 flex flex-col bg-white dark:bg-slate-800/30 border-gray-200 dark:border-slate-700 shadow-xl">
                        <div className="overflow-x-auto min-w-[1000px]">
                            <table className="w-full text-left text-sm border-collapse">
                                <thead>
                                    <tr className="bg-gray-50 dark:bg-slate-900/50 text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700 text-[11px] uppercase tracking-wider font-semibold">
                                        <th className="px-6 py-3">PO ID</th>
                                        <th className="px-6 py-3">Vendor</th>
                                        <th className="px-6 py-3">PO Date</th>
                                        <th className="px-6 py-3 text-center">Mode</th>
                                        <th className="px-6 py-3 text-center">Ordered</th>
                                        <th className="px-6 py-3 text-center">Fulfilled</th>
                                        <th className="px-6 py-3 text-center">Pending</th>
                                        <th className="px-6 py-3 text-center">Line Status</th>
                                        <th className="px-6 py-3 text-center">Fulfillment Days</th>
                                        <th className="px-6 py-3">PO Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-700/50">
                                    {skuResults.map((line, idx) => (
                                        <tr key={idx} className="hover:bg-slate-700/20 transition-colors">
                                            <td className="px-6 py-4 font-mono font-bold">
                                                <button
                                                    onClick={() => onPoClick(line.po_id)}
                                                    className="text-blue-400 hover:text-blue-300 hover:underline text-left transition-colors"
                                                >
                                                    {line.po_id}
                                                </button>
                                            </td>
                                            <td className="px-6 py-4 text-slate-200 font-medium">{line.vendor_code}</td>
                                            <td className="px-6 py-4 text-slate-400 text-xs">{formatPoDate(line.po_date)}</td>
                                            <td className="px-6 py-4 text-center">
                                                <ModeBadge mode={line.planned_mode as any} />
                                            </td>
                                            <td className="px-6 py-4 text-center text-slate-300 font-mono text-xs">{line.ordered_qty}</td>
                                            <td className="px-6 py-4 text-center text-slate-300 font-mono text-xs">{line.fulfilled_qty}</td>
                                            <td className="px-6 py-4 text-center text-slate-400 font-mono text-xs">{line.pending_qty}</td>
                                            <td className="px-6 py-4 text-center">
                                                <LineStatusBadge status={line.line_status} />
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                {line.fulfillment_days !== null && line.fulfillment_days !== undefined ? (
                                                    <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono ${
                                                        line.fulfillment_days <= 30 ? 'bg-emerald-500/20 text-emerald-400' :
                                                        line.fulfillment_days <= 60 ? 'bg-amber-500/20 text-amber-400' :
                                                        'bg-red-500/20 text-red-400'
                                                    }`}>
                                                        {line.fulfillment_days} d
                                                    </span>
                                                ) : <span className="text-slate-600">—</span>}
                                            </td>
                                            <td className="px-6 py-4">
                                                <StatusBadge status={line.po_status as any} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
};

const LineStatusBadge: React.FC<{ status: string }> = ({ status }) => {
    const config: Record<string, string> = {
        'OPEN': 'bg-blue-600/20 text-blue-400 border border-blue-500/30',
        'PARTIAL': 'bg-amber-600/20 text-amber-400 border border-amber-500/30',
        'FULFILLED': 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30',
        'CLOSED': 'bg-slate-600/20 text-slate-400 border border-slate-500/30',
    };
    const norm = String(status).toUpperCase();
    const style = config[norm] || 'bg-slate-700 text-slate-350 border border-slate-650';
    return (
        <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider whitespace-nowrap ${style}`}>
            {status}
        </span>
    );
};