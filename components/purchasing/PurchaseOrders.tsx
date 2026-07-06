import React, { useState, useMemo, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { 
    MagnifyingGlassIcon, EyeIcon, XMarkIcon, 
    AirplaneIcon, ShipIcon, ListBulletIcon,
    InformationCircleIcon, ArrowLeftIcon, FunnelIcon,
    LinkIcon, EnvelopeIcon, ArrowPathIcon, ExclamationTriangleIcon
} from '../icons/Icons';
import { APPS_SCRIPT_URL, API_ACTIONS } from '../../constants';
import { ViewType } from '../../types';
import { useQueryParam } from '../../hooks/useQueryParam';

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
}

interface PurchaseOrderUI {
    po_id: string;
    vendor_code: string;
    po_date: string;
    planned_mode: 'Sea' | 'Air';
    total_skus: number;
    total_qty: number;
    po_status: POStatus;
    last_updated: string;
    draft_id: string;
    total_value: number;
    lines: POLine[];
    email_status: EmailStatus;
    vendor_email: string;
    cc_emails?: string[];
}

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
    const [activeTab, setActiveTab] = useQueryParam<'All' | POStatus>('statusFilter', 'All');
    const [showCloseConfirm, setShowCloseConfirm] = useState(false);

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

    useEffect(() => {
        const handler = (e: any) => {
            // Refresh PO list
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
            const matchesStatus = activeTab === 'All' || po.po_status === activeTab;
            const matchesSearch = po.po_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                 po.vendor_code.toLowerCase().includes(searchTerm.toLowerCase());
            return matchesStatus && matchesSearch;
        });
    }, [searchTerm, activeTab, purchaseOrders]);

    const handleClosePo = () => {
        setShowCloseConfirm(false);
        setSelectedPo(null);
    };

    if (selectedPo || loadingDetails || detailsError) {
        return (
            <div className="flex flex-col h-full space-y-6 text-slate-850 dark:text-white p-6 bg-slate-50 dark:bg-slate-900 min-h-screen animate-in fade-in duration-300">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={() => { setSelectedPo(null); setDetailsError(null); }} 
                            className="p-2 -ml-2 text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-white transition-colors"
                        >
                            <ArrowLeftIcon className="w-6 h-6" />
                        </button>
                        <div>
                            <h2 className="text-2xl font-bold text-slate-800 dark:text-white flex items-center gap-3">
                                {loadingDetails ? 'Loading details...' : selectedPo ? <>Purchase Order: <span className="font-mono text-blue-500 dark:text-blue-400">{selectedPo.po_id}</span></> : 'Error'}
                                {selectedPo && <StatusBadge status={selectedPo.po_status} />}
                            </h2>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Full details and line item fulfillment status</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Button 
                            variant="secondary" 
                            onClick={() => { setSelectedPo(null); setDetailsError(null); }}
                            className="h-10 px-4 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
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
                            <Card className="bg-white dark:bg-slate-800/40 p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Vendor Code</p>
                                <p className="text-base font-bold text-slate-800 dark:text-white">{selectedPo.vendor_code}</p>
                            </Card>
                            <Card className="bg-white dark:bg-slate-800/40 p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Draft Reference</p>
                                <p className="text-base text-blue-500 dark:text-blue-400 font-mono font-medium">{selectedPo.draft_id}</p>
                            </Card>
                            <Card className="bg-white dark:bg-slate-800/40 p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">PO Date</p>
                                <p className="text-base text-slate-800 dark:text-white">{selectedPo.po_date}</p>
                            </Card>
                            <Card className="bg-white dark:bg-slate-800/40 p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Shipping Mode</p>
                                <div className="mt-1"><ModeBadge mode={selectedPo.planned_mode} /></div>
                            </Card>
                            <Card className="bg-white dark:bg-slate-800/40 p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Total Value</p>
                                <p className="text-lg font-bold text-green-600 dark:text-green-400">{formatCurrency(selectedPo.total_value)}</p>
                            </Card>
                            <Card className="bg-white dark:bg-slate-800/40 p-4 border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col justify-between">
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                                        <EnvelopeIcon className="w-3 h-3"/> Email Information
                                    </p>
                                    <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate" title={selectedPo.vendor_email}>{selectedPo.vendor_email || 'No email provided'}</p>
                                    <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                                        CC: {selectedPo.cc_emails && selectedPo.cc_emails.length > 0 ? selectedPo.cc_emails.join(', ') : 'None'}
                                    </p>
                                </div>
                                <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700/50">
                                    <EmailStatusBadge status={selectedPo.email_status} />
                                </div>
                            </Card>
                        </div>

                        {/* Line Items Table */}
                        <Card className="flex-grow p-0 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/20 overflow-hidden shadow-md dark:shadow-xl">
                            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/40">
                                <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Order Line Items</h3>
                                <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">{selectedPo.lines.length} SKUs Ordered</span>
                            </div>
                            <div className="overflow-x-auto min-w-[1000px]">
                                <table className="w-full text-left text-sm border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 dark:bg-slate-900/30 text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider border-b border-slate-200 dark:border-slate-700/50">
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
                                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700/30">
                                        {selectedPo.lines.map((line, idx) => (
                                            <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                                                <td className="px-6 py-4 font-mono text-xs text-blue-500 dark:text-blue-300">{line.sku}</td>
                                                <td className="px-6 py-4 font-medium text-slate-800 dark:text-white truncate text-xs">{line.name}</td>
                                                <td className="px-6 py-4 text-center font-bold text-slate-900 dark:text-white">{line.ordered_qty}</td>
                                                <td className="px-6 py-4 text-right text-slate-500 dark:text-slate-400 font-mono text-xs">₹{line.unit_price.toLocaleString()}</td>
                                                <td className="px-6 py-4">
                                                    <div className="flex justify-center gap-1">
                                                        <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${line.logo ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600'}`}>LOGO</span>
                                                        <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${line.packaging ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600'}`}>PKG</span>
                                                        <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${line.manual ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600'}`}>MAN</span>
                                                        <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${line.wrap ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600'}`}>WRP</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-center font-bold text-emerald-650 dark:text-emerald-400 bg-emerald-500/5">{line.fulfilled_qty}</td>
                                                <td className="px-6 py-4 text-center">
                                                    {line.folder_link ? (
                                                        <a 
                                                            href={line.folder_link} 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 bg-blue-600/10 text-blue-500 dark:text-blue-400 border border-blue-500/20 rounded hover:bg-blue-600 hover:text-white transition-all"
                                                        >
                                                            <LinkIcon className="w-3 h-3" /> OPEN FOLDER
                                                        </a>
                                                    ) : <span className="text-slate-400 dark:text-slate-600">—</span>}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                                        line.status === 'FULFILLED' ? 'text-emerald-500' : 
                                                        line.status === 'PARTIAL' ? 'text-orange-500' : 'text-slate-400 dark:text-slate-500'
                                                    }`}>
                                                        {line.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="p-6 bg-slate-50 dark:bg-slate-900/40 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-12">
                                <div className="text-right">
                                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Total Items</p>
                                    <p className="text-xl font-bold text-slate-850 dark:text-white">{selectedPo.total_qty}</p>
                                </div>
                                <div className="text-right pr-4">
                                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">PO Net Total</p>
                                    <p className="text-2xl font-bold text-blue-550 dark:text-blue-400">{formatCurrency(selectedPo.total_value)}</p>
                                </div>
                            </div>
                        </Card>

                        {/* Close PO Confirmation Dialog */}
                        {showCloseConfirm && (
                            <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-4">
                                <Card className="max-w-md w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xl p-8 text-center animate-in zoom-in-95 duration-200">
                                    <div className="w-16 h-16 bg-red-600/10 rounded-full flex items-center justify-center mx-auto mb-6">
                                        <InformationCircleIcon className="w-10 h-10 text-red-500" />
                                    </div>
                                    <h3 className="text-xl font-bold text-slate-850 dark:text-white mb-2">Close Purchase Order?</h3>
                                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-8 leading-relaxed">
                                        Closing <span className="text-slate-800 dark:text-white font-mono">{selectedPo?.po_id}</span> will mark it as complete. This will prevent further shipments from being matched.
                                    </p>
                                    <div className="flex gap-3">
                                        <Button 
                                            variant="secondary" 
                                            className="flex-1 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 h-11 bg-white dark:bg-slate-800" 
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
        <div className="flex flex-col h-full space-y-4 text-slate-800 dark:text-white p-6 bg-slate-50 dark:bg-slate-900 min-h-screen relative">
            {/* Header & Global Search */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-xl font-semibold text-slate-800 dark:text-white">Purchase Orders</h2>
                    <p className="text-sm text-slate-550 dark:text-slate-400 mt-1">Review finalized purchase agreements and track line-item fulfillment</p>
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <div className="relative w-full md:w-96">
                        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
                        <input 
                            type="text"
                            placeholder="Search by PO ID or Vendor Code..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm shadow-sm text-slate-850 dark:text-white"
                        />
                    </div>
                    <Button 
                        onClick={fetchPurchaseOrders} 
                        disabled={loading}
                        variant="secondary"
                        className="h-[42px] px-4 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-705 dark:text-slate-300 flex items-center gap-2"
                        icon={loading ? <ArrowPathIcon className="w-4 h-4 animate-spin"/> : undefined}
                    >
                        {loading ? 'Syncing...' : '🔄 Sync Purchase Orders'}
                    </Button>
                    <Button variant="secondary" className="h-[42px] px-4 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-705 dark:text-slate-300 flex items-center gap-2" icon={<FunnelIcon className="w-4 h-4"/>}>
                        Filters
                    </Button>
                </div>
            </div>

            {/* Status Tabs */}
            <div className="flex gap-8 border-b border-slate-205 dark:border-slate-800 px-1 mt-2">
                {(['All', 'OPEN', 'PARTIALLY_SHIPPED', 'CLOSED', 'CLOSED_CANCELLED'] as const).map(tab => {
                    const labels = {
                        'All': 'All POs',
                        'OPEN': 'Open',
                        'PARTIALLY_SHIPPED': 'Partially Shipped',
                        'CLOSED': 'Closed',
                        'CLOSED_CANCELLED': 'Closed (Cancelled)'
                    };
                    return (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`pb-3 text-sm font-medium transition-all relative ${
                                activeTab === tab ? 'text-blue-500 font-semibold' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                            }`}
                        >
                            {labels[tab]}
                            {activeTab === tab && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />}
                        </button>
                    );
                })}
            </div>

            {/* List View */}
            <Card className="flex-grow overflow-hidden p-0 flex flex-col bg-white dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-xl min-h-[400px]">
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
                            <h3 className="text-lg font-bold text-slate-850 dark:text-white mb-2">Sync Failed</h3>
                            <p className="text-slate-400 text-sm mb-6 max-w-md">{error}</p>
                            <Button onClick={fetchPurchaseOrders} className="bg-blue-600 hover:bg-blue-700 px-8">Retry Sync</Button>
                        </div>
                    </div>
                ) : (
                    <div className="overflow-x-auto min-w-[1100px]">
                        <table className="w-full text-left text-sm border-collapse">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                                    <th className="px-6 py-3 font-medium">PO ID</th>
                                    <th className="px-6 py-3 font-medium">Vendor Code</th>
                                    <th className="px-6 py-3 font-medium">PO Date</th>
                                    <th className="px-6 py-3 font-medium text-center">Mode</th>
                                    <th className="px-6 py-3 font-medium text-center">Total SKUs</th>
                                    <th className="px-6 py-3 font-medium text-center">Total Qty</th>
                                    <th className="px-6 py-3 font-medium">Email Status</th>
                                    <th className="px-6 py-3 font-medium">Status</th>
                                    <th className="px-6 py-3 font-medium text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                                {filteredPos.map((po) => (
                                    <tr 
                                        key={po.po_id} 
                                        onClick={() => fetchPurchaseOrderDetails(po.po_id)}
                                        className="group hover:bg-slate-100 dark:hover:bg-slate-700/40 transition-colors duration-150 cursor-pointer"
                                    >
                                        <td className="px-6 py-4 font-mono font-bold text-blue-500 dark:text-blue-400">{po.po_id}</td>
                                        <td className="px-6 py-4 text-slate-700 dark:text-slate-200 font-medium">{po.vendor_code}</td>
                                        <td className="px-6 py-4 text-slate-500 dark:text-slate-400 text-xs">
                                            {po.po_date}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <ModeBadge mode={po.planned_mode} />
                                        </td>
                                        <td className="px-6 py-4 text-center text-slate-600 dark:text-slate-300">{po.total_skus}</td>
                                        <td className="px-6 py-4 text-center text-slate-800 dark:text-white font-medium">{po.total_qty}</td>
                                        <td className="px-6 py-4">
                                            <EmailStatusBadge status={po.email_status} />
                                        </td>
                                        <td className="px-6 py-4">
                                            <StatusBadge status={po.po_status} />
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button className="p-2 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg text-slate-400 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-all">
                                                <EyeIcon className="w-5 h-5" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {filteredPos.length === 0 && (
                            <div className="py-24 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500">
                                <ListBulletIcon className="w-12 h-12 mb-4 opacity-30" />
                                <h3 className="text-lg font-medium">No purchase orders matching filters</h3>
                                <p className="text-sm mt-1">Try adjusting your search or filters.</p>
                            </div>
                        )}
                    </div>
                )}
            </Card>
        </div>
    );
};