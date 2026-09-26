import React, { useState, useMemo, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { 
    MagnifyingGlassIcon, EyeIcon, XMarkIcon, 
    AirplaneIcon, ShipIcon, ListBulletIcon,
    InformationCircleIcon, ArrowLeftIcon,
    LinkIcon, EnvelopeIcon, ArrowPathIcon, ExclamationTriangleIcon
} from '../icons/Icons';
import { API_ACTIONS } from '../../constants';
import { callGas } from '../../services/gasApi';
import { getCurrentActor } from '../../services/authToken';
import { ViewType } from '../../types';
import { useQueryParam } from '../../hooks/useQueryParam';

type POStatus = 'OPEN' | 'PARTIALLY_SHIPPED' | 'CLOSED' | 'CLOSED_CANCELLED';
type EmailStatus = 'NOT_SENT' | 'SENT' | 'FAILED';

interface POLine {
    po_line_id: string;
    sku: string;
    name: string;
    ordered_qty: number;
    unit_price: number;       // unit_price_rmb as stored on the PO line
    master_rmb_price: number; // current RMB_Price of the SKU (0 = none in master)
    logo: boolean;
    packaging: boolean;
    manual: boolean;
    wrap: boolean;
    fulfilled_qty: number;
    status: 'PENDING' | 'PARTIAL' | 'FULFILLED' | 'CLOSED';
    close_reason?: string;
    folder_link?: string;
}

// A line still waiting for goods: not received in full and not closed. (A
// short line marked FULFILLED by hand in the sheet counts as closed.)
const isLinePending = (l: POLine) => l.status === 'PENDING' || l.status === 'PARTIAL';

// Drafts were priced from INR landed cost until 2026-09-26, so older PO lines
// hold INR in unit_price_rmb. Flag a price far above the SKU's RMB price.
const looksLikeInr = (l: POLine) => l.master_rmb_price > 0 && l.unit_price > l.master_rmb_price * 6;

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

interface PendingLine {
    po_line_id: string;
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
    const normalized = String(mode || '').toUpperCase();
    const isAir = normalized === 'AIR';
    const isSea = normalized === 'SEA';
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold rounded border transition-colors ${
            isAir ? 'bg-sky-600/20 text-sky-400 border-sky-600/30' : isSea ? 'bg-blue-600/20 text-blue-400 border-blue-600/30' : 'bg-slate-500/10 text-slate-400 border-slate-500/30'
        }`}>
            {isAir && <AirplaneIcon className="w-3 h-3" />}
            {isSea && <ShipIcon className="w-3 h-3" />}
            {normalized || '—'}
        </span>
    );
};

// PO line prices are RMB (Purchase_Order_Lines.unit_price_rmb).
const formatRmb = (amount: number) =>
    '¥' + Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// Confirmation for closing a PO or one of its lines: whatever hasn't arrived
// is written off, so it stops counting as incoming stock.
const CloseDialog: React.FC<{
    title: string;
    detail: React.ReactNode;
    busy: boolean;
    error: string | null;
    onCancel: () => void;
    onConfirm: (reason: string) => void;
}> = ({ title, detail, busy, error, onCancel, onConfirm }) => {
    const [reason, setReason] = useState('');
    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-4">
            <Card className="max-w-md w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xl p-8 text-center animate-in zoom-in-95 duration-200">
                <div className="w-16 h-16 bg-red-600/10 rounded-full flex items-center justify-center mx-auto mb-6">
                    <InformationCircleIcon className="w-10 h-10 text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-slate-850 dark:text-white mb-2">{title}</h3>
                <div className="text-slate-500 dark:text-slate-400 text-sm mb-5 leading-relaxed">{detail}</div>
                <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason (optional), e.g. vendor discontinued"
                    className="w-full mb-5 px-3 py-2 text-sm bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white focus:ring-2 focus:ring-red-500 focus:outline-none"
                />
                {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
                <div className="flex gap-3">
                    <Button
                        variant="secondary"
                        className="flex-1 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 h-11 bg-white dark:bg-slate-800"
                        onClick={onCancel}
                        disabled={busy}
                    >
                        Keep Open
                    </Button>
                    <Button
                        className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold h-11 disabled:opacity-60"
                        onClick={() => onConfirm(reason.trim())}
                        disabled={busy}
                    >
                        {busy ? 'Closing...' : 'Close'}
                    </Button>
                </div>
            </Card>
        </div>
    );
};

interface PurchaseOrdersProps {
    onNavigate?: (view: ViewType) => void;
}

// Module-level, not React state, so switching tabs and back shows the last
// list instantly. It is only a first paint: the list is re-read every time
// the screen opens, because POs change from other screens (draft submit,
// shipment finalize) whose refresh event can't reach an unmounted screen.
let poListCache: { purchaseOrders: PurchaseOrderUI[]; timestamp: number } | null = null;

type CloseTarget =
    | { kind: 'po'; poId: string; pendingQty: number; pendingLines: number }
    | { kind: 'line'; poId: string; line: POLine };

export const PurchaseOrders: React.FC<PurchaseOrdersProps> = ({ onNavigate }) => {
    const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderUI[]>(poListCache?.purchaseOrders || []);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedPo, setSelectedPo] = useState<PurchaseOrderUI | null>(null);
    const [lastPoId, setLastPoId] = useState<string | null>(null);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [detailsError, setDetailsError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useQueryParam<'All' | POStatus>('statusFilter', 'All');
    const [closeTarget, setCloseTarget] = useState<CloseTarget | null>(null);
    const [closing, setClosing] = useState(false);
    const [closeError, setCloseError] = useState<string | null>(null);
    const [resending, setResending] = useState(false);
    const [resendMessage, setResendMessage] = useState<{ ok: boolean; text: string } | null>(null);
    const [mainView, setMainView] = useQueryParam<'po_list' | 'pending_lines' | 'sku_history'>('poView', 'po_list');

    const mapLineToUi = (l: any): POLine => {
        const ordered = Number(l.ordered_qty ?? 0);
        const fulfilled = Number(l.fulfilled_qty ?? 0);
        const lineStatus = String(l.line_status ?? '').toUpperCase();
        let status: POLine["status"] = "PENDING";
        if (fulfilled >= ordered && ordered > 0) status = "FULFILLED";
        else if (lineStatus === 'CLOSED' || lineStatus === 'FULFILLED') status = "CLOSED";
        else if (fulfilled > 0 && fulfilled < ordered) status = "PARTIAL";

        return {
            po_line_id: String(l.po_line_id ?? ""),
            sku: String(l.sku ?? ""),
            name: String(l.sku_name ?? l.name ?? ""),
            ordered_qty: ordered,
            unit_price: Number(l.unit_price_rmb ?? l.unit_price ?? 0),
            master_rmb_price: Number(l.master_rmb_price ?? 0),
            logo: Boolean(l.custom_logo ?? l.logo ?? false),
            packaging: Boolean(l.custom_packaging ?? l.packaging ?? false),
            manual: Boolean(l.solving_manual ?? l.manual ?? false),
            wrap: Boolean(l.opp_wrap ?? l.wrap ?? false),
            fulfilled_qty: fulfilled,
            status,
            close_reason: l.line_close_reason || undefined,
            folder_link: l.customization_files || undefined,
        };
    };

    // `force` bypasses the shared read cache (explicit Sync / after a write).
    const fetchPurchaseOrders = async (force = false) => {
        setLoading(true);
        setError(null);

        try {
            const result = await callGas(API_ACTIONS.GET_PURCHASE_ORDERS, {}, 2, undefined, { force });
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
            poListCache = { purchaseOrders: normalized, timestamp: Date.now() };
        } catch (err: any) {
            setError(err.message);
            console.error("PO fetch error:", err);
        } finally {
            setLoading(false);
        }
    };

    const fetchPurchaseOrderDetails = async (poId: string) => {
        setLastPoId(poId);
        setLoadingDetails(true);
        setDetailsError(null);
        setResendMessage(null);

        try {
            const result = await callGas(API_ACTIONS.GET_PURCHASE_ORDER_DETAILS, { po_id: poId }, 2);

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
            // Something just changed server-side (PO closed, draft submitted).
            fetchPurchaseOrders(true);

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

    const openClosePo = () => {
        if (!selectedPo) return;
        const pending = selectedPo.lines.filter(isLinePending);
        setCloseError(null);
        setCloseTarget({
            kind: 'po',
            poId: selectedPo.po_id,
            pendingLines: pending.length,
            pendingQty: pending.reduce((s, l) => s + (l.ordered_qty - l.fulfilled_qty), 0)
        });
    };

    const handleConfirmClose = async (reason: string) => {
        if (!closeTarget) return;
        setClosing(true);
        setCloseError(null);
        try {
            const result = closeTarget.kind === 'po'
                ? await callGas(API_ACTIONS.CLOSE_PO, { po_id: closeTarget.poId, reason, closed_by: getCurrentActor() })
                : await callGas('close_po_line', { po_line_id: closeTarget.line.po_line_id, reason, closed_by: getCurrentActor() });
            if (!result || result.success !== true) {
                throw new Error(result?.message || result?.error || 'Failed to close');
            }
            const poId = closeTarget.poId;
            setCloseTarget(null);
            await fetchPurchaseOrderDetails(poId);
            window.dispatchEvent(new CustomEvent('po:refresh', { detail: { po_id: poId } }));
        } catch (err: any) {
            setCloseError(err.message || 'Failed to close');
        } finally {
            setClosing(false);
        }
    };

    const handleResendEmail = async () => {
        if (!selectedPo) return;
        setResending(true);
        setResendMessage(null);
        try {
            const result = await callGas('resend_po_email', { po_id: selectedPo.po_id, sent_by: getCurrentActor() });
            if (!result || result.success !== true) {
                throw new Error(result?.message || result?.error || 'Resend failed');
            }
            await fetchPurchaseOrderDetails(selectedPo.po_id);
            setResendMessage({ ok: true, text: result.message || 'Email sent' });
            fetchPurchaseOrders(true);
        } catch (err: any) {
            await fetchPurchaseOrderDetails(selectedPo.po_id);
            setResendMessage({ ok: false, text: err.message || 'Resend failed' });
        } finally {
            setResending(false);
        }
    };

    if (selectedPo || loadingDetails || detailsError) {
        const isPoActive = !!selectedPo && (selectedPo.po_status === 'OPEN' || selectedPo.po_status === 'PARTIALLY_SHIPPED');
        const pendingLineCount = selectedPo ? selectedPo.lines.filter(isLinePending).length : 0;
        const inrLineCount = selectedPo ? selectedPo.lines.filter(looksLikeInr).length : 0;
        const goBack = () => { setSelectedPo(null); setDetailsError(null); setCloseTarget(null); };
        return (
            <div className="flex flex-col h-full space-y-6 text-slate-850 dark:text-white p-6 bg-slate-50 dark:bg-slate-900 min-h-screen animate-in fade-in duration-300">
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={goBack}
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
                            onClick={goBack}
                            className="h-10 px-4 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                        >
                            Back to List
                        </Button>
                        {isPoActive && !loadingDetails && (
                            <Button
                                className="bg-red-600/10 text-red-500 border border-red-500/20 hover:bg-red-600 hover:text-white h-10 font-bold"
                                onClick={openClosePo}
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
                            <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-2">Fetch Failed</h3>
                            <p className="text-slate-400 text-sm mb-6">{detailsError}</p>
                            <Button onClick={() => { if (lastPoId) fetchPurchaseOrderDetails(lastPoId); }} className="bg-red-600 hover:bg-red-700">Retry Fetch</Button>
                        </Card>
                    </div>
                ) : selectedPo ? (
                    <>
                        {/* Header Info Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                            <Card className="bg-white dark:bg-slate-800/40 p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Vendor</p>
                                <p className="text-base font-bold text-slate-800 dark:text-white">{selectedPo.vendor_code}</p>
                                {(selectedPo as any).vendor_name && <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{(selectedPo as any).vendor_name}</p>}
                            </Card>
                            <Card className="bg-white dark:bg-slate-800/40 p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Draft Reference</p>
                                <p className="text-base text-blue-500 dark:text-blue-400 font-mono font-medium">{selectedPo.draft_id || '—'}</p>
                            </Card>
                            <Card className="bg-white dark:bg-slate-800/40 p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">PO Date</p>
                                <p className="text-base text-slate-800 dark:text-white">{formatPoDate(selectedPo.po_date)}</p>
                            </Card>
                            <Card className="bg-white dark:bg-slate-800/40 p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Shipping Mode</p>
                                <div className="mt-1"><ModeBadge mode={selectedPo.planned_mode} /></div>
                            </Card>
                            <Card className="bg-white dark:bg-slate-800/40 p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Total Value (RMB)</p>
                                <p className="text-lg font-bold text-green-600 dark:text-green-400">{formatRmb(selectedPo.total_value)}</p>
                            </Card>
                            <Card className="bg-white dark:bg-slate-800/40 p-4 border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col justify-between">
                                <div>
                                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                                        <EnvelopeIcon className="w-3 h-3"/> Email Information
                                    </p>
                                    <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate" title={selectedPo.vendor_email}>{selectedPo.vendor_email || 'No email in Vendor Masters'}</p>
                                    <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                                        CC: {selectedPo.cc_emails && selectedPo.cc_emails.length > 0 ? selectedPo.cc_emails.join(', ') : 'None'}
                                    </p>
                                </div>
                                <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700/50 flex items-center justify-between gap-2">
                                    <EmailStatusBadge status={selectedPo.email_status} />
                                    {selectedPo.email_status === 'FAILED' && (
                                        <button
                                            onClick={handleResendEmail}
                                            disabled={resending}
                                            className="text-[10px] font-bold px-2 py-0.5 rounded border border-blue-500/30 text-blue-500 hover:bg-blue-600 hover:text-white disabled:opacity-50 transition-colors"
                                        >
                                            {resending ? 'Sending...' : 'Resend email'}
                                        </button>
                                    )}
                                </div>
                                {resendMessage && (
                                    <p className={`text-[10px] mt-1 ${resendMessage.ok ? 'text-emerald-500' : 'text-red-500'}`}>{resendMessage.text}</p>
                                )}
                            </Card>
                        </div>

                        {inrLineCount > 0 && (
                            <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-2">
                                <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
                                <span>{inrLineCount} line{inrLineCount === 1 ? '' : 's'} on this PO {inrLineCount === 1 ? 'has' : 'have'} a price that looks like INR landed cost, not RMB (drafts were priced in INR before 26 Sep 2026). Totals include them as stored.</span>
                            </div>
                        )}

                        {/* Line Items Table */}
                        <Card className="flex-grow p-0 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/20 overflow-hidden shadow-md dark:shadow-xl">
                            <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-900/40">
                                <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Order Line Items</h3>
                                <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">{selectedPo.lines.length} SKUs Ordered{pendingLineCount > 0 ? ` • ${pendingLineCount} still pending` : ''}</span>
                            </div>
                            <div className="overflow-x-auto min-w-[1000px]">
                                <table className="w-full text-left text-sm border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 dark:bg-slate-900/30 text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider border-b border-slate-200 dark:border-slate-700/50">
                                            <th className="px-6 py-3 font-medium w-[12%]">SKU</th>
                                            <th className="px-6 py-3 font-medium w-[20%]">Item Name</th>
                                            <th className="px-6 py-3 font-medium text-center">Ordered</th>
                                            <th className="px-6 py-3 font-medium text-right">Unit Price (RMB)</th>
                                            <th className="px-6 py-3 font-medium text-center">Logo/Pkg/Man/Wrp</th>
                                            <th className="px-6 py-3 font-medium text-center">Fulfilled</th>
                                            <th className="px-6 py-3 font-medium text-center">Customization</th>
                                            <th className="px-6 py-3 font-medium text-right">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700/30">
                                        {selectedPo.lines.map((line, idx) => (
                                            <tr key={line.po_line_id || idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                                                <td className="px-6 py-4 font-mono text-xs text-blue-500 dark:text-blue-300">{line.sku}</td>
                                                <td className="px-6 py-4 font-medium text-slate-800 dark:text-white truncate text-xs">{line.name}</td>
                                                <td className="px-6 py-4 text-center font-bold text-slate-900 dark:text-white">{line.ordered_qty}</td>
                                                <td className="px-6 py-4 text-right font-mono text-xs">
                                                    <span className={looksLikeInr(line) ? 'text-amber-500' : 'text-slate-500 dark:text-slate-400'}>{formatRmb(line.unit_price)}</span>
                                                    {looksLikeInr(line) && (
                                                        <span className="block text-[9px] font-sans font-semibold text-amber-500" title={`Current RMB price: ${formatRmb(line.master_rmb_price)}`}>
                                                            looks like INR (RMB {formatRmb(line.master_rmb_price)})
                                                        </span>
                                                    )}
                                                </td>
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
                                                    <div className="flex items-center justify-end gap-2">
                                                        <span
                                                            title={line.status === 'CLOSED' ? `${line.ordered_qty - line.fulfilled_qty} written off${line.close_reason ? `: ${line.close_reason}` : ''}` : undefined}
                                                            className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                                                line.status === 'FULFILLED' ? 'text-emerald-500' :
                                                                line.status === 'PARTIAL' ? 'text-orange-500' :
                                                                line.status === 'CLOSED' ? 'text-red-400' : 'text-slate-400 dark:text-slate-500'
                                                            }`}
                                                        >
                                                            {line.status === 'CLOSED' ? `CLOSED (−${Math.max(0, line.ordered_qty - line.fulfilled_qty)})` : line.status}
                                                        </span>
                                                        {isPoActive && isLinePending(line) && line.po_line_id && (
                                                            <button
                                                                onClick={() => { setCloseError(null); setCloseTarget({ kind: 'line', poId: selectedPo.po_id, line }); }}
                                                                className="text-[10px] font-bold px-2 py-0.5 rounded border border-red-500/30 text-red-500 hover:bg-red-600 hover:text-white transition-colors"
                                                                title="Close the rest of this line"
                                                            >
                                                                Close
                                                            </button>
                                                        )}
                                                    </div>
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
                                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">PO Net Total (RMB)</p>
                                    <p className="text-2xl font-bold text-blue-550 dark:text-blue-400">{formatRmb(selectedPo.total_value)}</p>
                                </div>
                            </div>
                        </Card>

                        {closeTarget && (
                            <CloseDialog
                                title={closeTarget.kind === 'po' ? 'Close Purchase Order?' : `Close ${closeTarget.line.sku}?`}
                                detail={closeTarget.kind === 'po' ? (
                                    <>Closes <span className="font-mono text-slate-800 dark:text-white">{closeTarget.poId}</span>.{' '}
                                        {closeTarget.pendingQty > 0
                                            ? <>The {closeTarget.pendingQty} unit(s) still pending on {closeTarget.pendingLines} line(s) are written off: they stop counting as incoming stock and no further shipments will be matched to them.</>
                                            : <>Nothing is pending on it.</>}
                                    </>
                                ) : (
                                    <>{closeTarget.line.fulfilled_qty} of {closeTarget.line.ordered_qty} received on <span className="font-mono text-slate-800 dark:text-white">{closeTarget.poId}</span>.
                                        The remaining <b>{closeTarget.line.ordered_qty - closeTarget.line.fulfilled_qty}</b> are written off: they stop counting as incoming stock and no further shipments will be matched to this line.</>
                                )}
                                busy={closing}
                                error={closeError}
                                onCancel={() => { setCloseTarget(null); setCloseError(null); }}
                                onConfirm={handleConfirmClose}
                            />
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
                        onClick={() => fetchPurchaseOrders(true)}
                        disabled={loading}
                        variant="secondary"
                        className="h-[42px] px-4 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-705 dark:text-slate-300 flex items-center gap-2"
                        icon={loading ? <ArrowPathIcon className="w-4 h-4 animate-spin"/> : undefined}
                    >
                        {loading ? 'Syncing...' : '🔄 Sync Purchase Orders'}
                    </Button>
                </div>
            </div>

            {/* Main View Tabs */}
            <div className="flex gap-8 border-b border-slate-205 dark:border-slate-800 px-1 mt-2">
                {([
                    { key: 'po_list', label: 'PO List' },
                    { key: 'pending_lines', label: 'Pending Lines' },
                    { key: 'sku_history', label: 'SKU History' }
                ] as const).map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setMainView(tab.key)}
                        className={`pb-3 text-sm font-semibold transition-all relative ${
                            mainView === tab.key ? 'text-blue-500' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
                        }`}
                    >
                        {tab.label}
                        {mainView === tab.key && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />}
                    </button>
                ))}
            </div>

            {/* Status Tabs (only shown within PO List) */}
            {mainView === 'po_list' && (
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
            )}

            {/* List View */}
            {mainView === 'po_list' && (
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
                            <Button onClick={() => fetchPurchaseOrders(true)} className="bg-blue-600 hover:bg-blue-700 px-8">Retry Sync</Button>
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
                                            {formatPoDate(po.po_date)}
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
            )}

            {mainView === 'pending_lines' && (
                <PendingLinesView onPoClick={fetchPurchaseOrderDetails} />
            )}

            {mainView === 'sku_history' && (
                <SKUHistoryView onPoClick={fetchPurchaseOrderDetails} />
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

// Module-level cache — same rationale as poListCache above (first paint only;
// the lines are re-read every time this sub-tab opens). Also preserves the
// vendor filter/sort choices, which used to reset every time it remounted.
let pendingLinesCache: {
    pendingLines: PendingLine[];
    vendorFilter: string;
    sortKey: keyof PendingLine;
    sortDir: 'asc' | 'desc';
} | null = null;

const PendingLinesView: React.FC<PendingLinesViewProps> = ({ onPoClick }) => {
    const [pendingLines, setPendingLines] = useState<PendingLine[]>(pendingLinesCache?.pendingLines || []);
    const [loadingPending, setLoadingPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pendingVendorFilter, setPendingVendorFilter] = useState<string>(pendingLinesCache?.vendorFilter || 'All');
    const [pendingSortKey, setPendingSortKey] = useState<keyof PendingLine>(pendingLinesCache?.sortKey || 'days_pending');
    const [pendingSortDir, setPendingSortDir] = useState<'asc' | 'desc'>(pendingLinesCache?.sortDir || 'desc');
    const [closeLine, setCloseLine] = useState<PendingLine | null>(null);
    const [closing, setClosing] = useState(false);
    const [closeError, setCloseError] = useState<string | null>(null);

    // Keeps the cache in sync with filter/sort changes so they survive a remount too.
    // Guarded on an existing cache so this doesn't fire on initial mount (before the
    // first fetch completes) and short-circuit fetchPendingLines with an empty stub.
    useEffect(() => {
        if (pendingLinesCache) {
            pendingLinesCache = { pendingLines, vendorFilter: pendingVendorFilter, sortKey: pendingSortKey, sortDir: pendingSortDir };
        }
    }, [pendingLines, pendingVendorFilter, pendingSortKey, pendingSortDir]);

    const fetchPendingLines = async () => {
        setLoadingPending(true);
        setError(null);
        try {
            const result = await callGas(API_ACTIONS.GET_PENDING_LINES, {}, 2);
            if (result && result.success === true) {
                const data = result.data || [];
                setPendingLines(data);
                pendingLinesCache = { pendingLines: data, vendorFilter: pendingVendorFilter, sortKey: pendingSortKey, sortDir: pendingSortDir };
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

    const handleCloseLine = async (reason: string) => {
        if (!closeLine) return;
        setClosing(true);
        setCloseError(null);
        try {
            const result = await callGas('close_po_line', { po_line_id: closeLine.po_line_id, reason, closed_by: getCurrentActor() });
            if (!result || result.success !== true) {
                throw new Error(result?.message || result?.error || 'Failed to close line');
            }
            const poId = closeLine.po_id;
            setCloseLine(null);
            await fetchPendingLines();
            window.dispatchEvent(new CustomEvent('po:refresh', { detail: { po_id: poId } }));
        } catch (err: any) {
            setCloseError(err.message || 'Failed to close line');
        } finally {
            setClosing(false);
        }
    };

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
                className={`px-4 py-3 font-semibold text-[11px] uppercase tracking-wider cursor-pointer hover:text-slate-800 dark:hover:text-white transition-colors ${center ? 'text-center' : 'text-left'}`}
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
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <div className="flex items-center gap-3">
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white">Pending PO Lines</h3>
                    <span className="bg-blue-600/20 text-blue-500 dark:text-blue-400 text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-500/20">
                        {sortedAndFilteredLines.length} Lines
                    </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Vendor:</span>
                        <select
                            value={pendingVendorFilter}
                            onChange={(e) => setPendingVendorFilter(e.target.value)}
                            className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-xs text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none font-semibold"
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
                        className="h-8 text-xs px-3 border-slate-200 dark:border-slate-700 flex items-center gap-1.5 bg-white dark:bg-slate-800"
                    >
                        📤 Export CSV
                    </Button>
                    <Button
                        onClick={() => fetchPendingLines()}
                        disabled={loadingPending}
                        variant="secondary"
                        className="h-8 text-xs px-3 border-slate-200 dark:border-slate-700 flex items-center gap-1.5 bg-white dark:bg-slate-800"
                        icon={<ArrowPathIcon className={`w-3.5 h-3.5 ${loadingPending ? 'animate-spin' : ''}`} />}
                    >
                        Refresh
                    </Button>
                </div>
            </div>

            <Card className="overflow-hidden p-0 flex flex-col bg-white dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-xl min-h-[400px]">
                {loadingPending && pendingLines.length === 0 ? (
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
                            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Failed to load Pending Lines</h3>
                            <p className="text-slate-400 text-sm mb-6">{error}</p>
                            <Button onClick={() => fetchPendingLines()} className="bg-blue-600 hover:bg-blue-700 px-6">Retry</Button>
                        </div>
                    </div>
                ) : (
                    <div className="overflow-x-auto min-w-[1100px]">
                        <table className="w-full text-left text-sm border-collapse">
                            <thead>
                                <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                    <SortHeader label="PO ID" field="po_id" />
                                    <SortHeader label="Vendor" field="vendor_code" />
                                    <SortHeader label="SKU" field="sku" />
                                    <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider text-left">SKU Name</th>
                                    <SortHeader label="Ordered" field="ordered_qty" center />
                                    <SortHeader label="Fulfilled" field="fulfilled_qty" center />
                                    <SortHeader label="Pending" field="pending_qty" center />
                                    <SortHeader label="Days Pending" field="days_pending" center />
                                    <SortHeader label="Mode" field="planned_mode" center />
                                    <th className="px-4 py-3 font-semibold text-[11px] uppercase tracking-wider text-center">Customization</th>
                                    <SortHeader label="PO Date" field="po_date" />
                                    <th className="px-4 py-3" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                                {sortedAndFilteredLines.map((line, idx) => {
                                    let daysBadgeClass = "bg-emerald-500/20 text-emerald-500 dark:text-emerald-400";
                                    if (line.days_pending > 60) {
                                        daysBadgeClass = "bg-red-500/20 text-red-500 dark:text-red-400";
                                    } else if (line.days_pending >= 30) {
                                        daysBadgeClass = "bg-amber-500/20 text-amber-500 dark:text-amber-400";
                                    }

                                    return (
                                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                                            <td className="px-4 py-3 font-mono font-bold">
                                                <button
                                                    onClick={() => onPoClick(line.po_id)}
                                                    className="text-blue-500 dark:text-blue-400 hover:underline text-left transition-colors"
                                                >
                                                    {line.po_id}
                                                </button>
                                            </td>
                                            <td className="px-4 py-3 text-slate-700 dark:text-slate-200 font-medium">{line.vendor_code}</td>
                                            <td className="px-4 py-3 font-mono text-xs text-blue-500 dark:text-blue-300">{line.sku}</td>
                                            <td className="px-4 py-3 max-w-[200px] truncate text-slate-600 dark:text-slate-300 text-xs" title={line.sku_name}>
                                                {line.sku_name}
                                            </td>
                                            <td className="px-4 py-3 text-center text-slate-500 dark:text-slate-400 font-mono text-xs">{line.ordered_qty}</td>
                                            <td className="px-4 py-3 text-center text-slate-500 dark:text-slate-400 font-mono text-xs">{line.fulfilled_qty}</td>
                                            <td className="px-4 py-3 text-center text-slate-800 dark:text-white font-bold font-mono text-sm">{line.pending_qty}</td>
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
                                                    {line.custom_logo && <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-blue-500/20 text-blue-500 dark:text-blue-400">LOGO</span>}
                                                    {line.custom_packaging && <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-blue-500/20 text-blue-500 dark:text-blue-400">PKG</span>}
                                                    {line.solving_manual && <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-blue-500/20 text-blue-500 dark:text-blue-400">MAN</span>}
                                                    {line.opp_wrap && <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-blue-500/20 text-blue-500 dark:text-blue-400">WRP</span>}
                                                    {!line.custom_logo && !line.custom_packaging && !line.solving_manual && !line.opp_wrap && <span className="text-slate-400 dark:text-slate-600">—</span>}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">
                                                {formatPoDate(line.po_date)}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {line.po_line_id && (
                                                    <button
                                                        onClick={() => { setCloseError(null); setCloseLine(line); }}
                                                        className="text-[10px] font-bold px-2 py-0.5 rounded border border-red-500/30 text-red-500 hover:bg-red-600 hover:text-white transition-colors"
                                                        title="Close the rest of this line"
                                                    >
                                                        Close
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {sortedAndFilteredLines.length === 0 && (
                            <div className="py-24 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500">
                                <ListBulletIcon className="w-12 h-12 mb-4 opacity-30" />
                                <h3 className="text-lg font-medium">No pending lines found</h3>
                            </div>
                        )}
                    </div>
                )}
            </Card>

            {closeLine && (
                <CloseDialog
                    title={`Close ${closeLine.sku}?`}
                    detail={<>{closeLine.fulfilled_qty} of {closeLine.ordered_qty} received on <span className="font-mono text-slate-800 dark:text-white">{closeLine.po_id}</span>.
                        The remaining <b>{closeLine.pending_qty}</b> are written off: they stop counting as incoming stock and no further shipments will be matched to this line.</>}
                    busy={closing}
                    error={closeError}
                    onCancel={() => { setCloseLine(null); setCloseError(null); }}
                    onConfirm={handleCloseLine}
                />
            )}
        </div>
    );
};

// ==========================================
// SKUHistoryView Component
// ==========================================
interface SKUHistoryViewProps {
    onPoClick: (poId: string) => void;
}

// This view only ever fetches on explicit user search (no mount-time
// auto-fetch), so the only thing that used to reset on remount was the
// user's last search and its results — forcing a re-type and re-search
// every time they switched away and back to this sub-tab.
let skuHistoryCache: { skuQuery: string; skuResults: SKUHistoryLine[]; skuSearched: string } | null = null;

const SKUHistoryView: React.FC<SKUHistoryViewProps> = ({ onPoClick }) => {
    const [skuQuery, setSkuQuery] = useState(skuHistoryCache?.skuQuery || '');
    const [skuResults, setSkuResults] = useState<SKUHistoryLine[]>(skuHistoryCache?.skuResults || []);
    const [loadingSKU, setLoadingSKU] = useState(false);
    const [skuSearched, setSkuSearched] = useState(skuHistoryCache?.skuSearched || '');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        skuHistoryCache = { skuQuery, skuResults, skuSearched };
    }, [skuQuery, skuResults, skuSearched]);

    const handleSearch = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!skuQuery.trim()) return;

        setLoadingSKU(true);
        setError(null);
        setSkuSearched('');
        try {
            const result = await callGas(API_ACTIONS.GET_SKU_HISTORY, { sku: skuQuery.trim() }, 2);
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
            <form onSubmit={handleSearch} className="flex gap-2 bg-white dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <div className="relative flex-1">
                    <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
                    <input
                        type="text"
                        placeholder="Enter SKU to search history..."
                        value={skuQuery}
                        onChange={(e) => setSkuQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm text-slate-800 dark:text-white"
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
                <Card className="flex items-center justify-center min-h-[350px] bg-white dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700">
                    <div className="flex flex-col items-center gap-3">
                        <ArrowPathIcon className="w-10 h-10 animate-spin text-blue-500" />
                        <p className="text-slate-400 text-sm font-medium">Searching PO history for SKU...</p>
                    </div>
                </Card>
            ) : error ? (
                <Card className="flex items-center justify-center min-h-[350px] bg-white dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700">
                    <div className="text-center p-8">
                        <ExclamationTriangleIcon className="w-12 h-12 text-red-500 mx-auto mb-4" />
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-2">Search Failed</h3>
                        <p className="text-slate-400 text-sm mb-6">{error}</p>
                        <Button onClick={() => handleSearch()} className="bg-blue-600 hover:bg-blue-700 px-6">Retry</Button>
                    </div>
                </Card>
            ) : !skuSearched ? (
                <Card className="flex flex-col items-center justify-center min-h-[350px] bg-white dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700 py-24 text-center">
                    <ListBulletIcon className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-4 opacity-70" />
                    <h3 className="text-lg font-medium text-slate-500 dark:text-slate-400">Search a SKU to see its full order history</h3>
                    <p className="text-slate-400 dark:text-slate-500 text-sm mt-1 max-w-sm">Type a product SKU above and search to visualize average lead times and fulfillment trends.</p>
                </Card>
            ) : skuResults.length === 0 ? (
                <Card className="flex flex-col items-center justify-center min-h-[350px] bg-white dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700 py-24 text-center">
                    <InformationCircleIcon className="w-12 h-12 text-slate-300 dark:text-slate-600 mb-4 opacity-70" />
                    <h3 className="text-lg font-medium text-slate-500 dark:text-slate-400">No PO history found for SKU: <span className="font-mono text-blue-500 dark:text-blue-400 font-bold">{skuSearched}</span></h3>
                </Card>
            ) : (
                <div className="space-y-4">
                    {/* Summary Row */}
                    {stats && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-white dark:bg-slate-800/20 border border-slate-200 dark:border-slate-700/50 p-4 rounded-xl shadow-sm">
                            <div className="text-center md:text-left border-r border-slate-200 dark:border-slate-700/50 last:border-0">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Total Orders</p>
                                <p className="text-lg font-bold text-slate-800 dark:text-white">{stats.totalOrders}</p>
                            </div>
                            <div className="text-center md:text-left border-r border-slate-200 dark:border-slate-700/50 last:border-0 md:pl-4">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Total Ordered</p>
                                <p className="text-lg font-bold text-slate-800 dark:text-white">{stats.totalOrdered.toLocaleString()} units</p>
                            </div>
                            <div className="text-center md:text-left border-r border-slate-200 dark:border-slate-700/50 last:border-0 md:pl-4">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Total Fulfilled</p>
                                <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{stats.totalFulfilled.toLocaleString()} units</p>
                            </div>
                            <div className="text-center md:text-left last:border-0 md:pl-4">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">Avg Fulfillment Time</p>
                                <p className="text-lg font-bold text-blue-500 dark:text-blue-400">{stats.avgDays} {stats.avgDays !== '—' ? 'days' : ''}</p>
                            </div>
                        </div>
                    )}

                    {/* Results Table */}
                    <Card className="overflow-hidden p-0 flex flex-col bg-white dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-xl">
                        <div className="overflow-x-auto min-w-[1000px]">
                            <table className="w-full text-left text-sm border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 text-[11px] uppercase tracking-wider font-semibold">
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
                                <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                                    {skuResults.map((line, idx) => (
                                        <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                                            <td className="px-6 py-4 font-mono font-bold">
                                                <button
                                                    onClick={() => onPoClick(line.po_id)}
                                                    className="text-blue-500 dark:text-blue-400 hover:underline text-left transition-colors"
                                                >
                                                    {line.po_id}
                                                </button>
                                            </td>
                                            <td className="px-6 py-4 text-slate-700 dark:text-slate-200 font-medium">{line.vendor_code}</td>
                                            <td className="px-6 py-4 text-slate-500 dark:text-slate-400 text-xs">{formatPoDate(line.po_date)}</td>
                                            <td className="px-6 py-4 text-center">
                                                <ModeBadge mode={line.planned_mode as any} />
                                            </td>
                                            <td className="px-6 py-4 text-center text-slate-600 dark:text-slate-300 font-mono text-xs">{line.ordered_qty}</td>
                                            <td className="px-6 py-4 text-center text-slate-600 dark:text-slate-300 font-mono text-xs">{line.fulfilled_qty}</td>
                                            <td className="px-6 py-4 text-center text-slate-500 dark:text-slate-400 font-mono text-xs">{line.pending_qty}</td>
                                            <td className="px-6 py-4 text-center">
                                                <LineStatusBadge status={line.line_status} />
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                {line.fulfillment_days !== null && line.fulfillment_days !== undefined ? (
                                                    <span className={`px-2 py-0.5 rounded text-xs font-bold font-mono ${
                                                        line.fulfillment_days <= 30 ? 'bg-emerald-500/20 text-emerald-500 dark:text-emerald-400' :
                                                        line.fulfillment_days <= 60 ? 'bg-amber-500/20 text-amber-500 dark:text-amber-400' :
                                                        'bg-red-500/20 text-red-500 dark:text-red-400'
                                                    }`}>
                                                        {line.fulfillment_days} d
                                                    </span>
                                                ) : <span className="text-slate-400 dark:text-slate-600">—</span>}
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
        'OPEN': 'bg-blue-600/20 text-blue-500 dark:text-blue-400 border border-blue-500/30',
        'PARTIAL': 'bg-amber-600/20 text-amber-500 dark:text-amber-400 border border-amber-500/30',
        'FULFILLED': 'bg-emerald-600/20 text-emerald-500 dark:text-emerald-400 border border-emerald-500/30',
        'CLOSED': 'bg-slate-500/20 text-slate-500 dark:text-slate-400 border border-slate-500/30',
    };
    const norm = String(status).toUpperCase();
    const style = config[norm] || 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-350 border border-slate-300 dark:border-slate-650';
    return (
        <span className={`px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider whitespace-nowrap ${style}`}>
            {status}
        </span>
    );
};