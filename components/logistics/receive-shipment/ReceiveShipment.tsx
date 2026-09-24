import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    BoxIcon, ShipIcon, AirplaneIcon, ArrowPathIcon, MagnifyingGlassIcon,
    ChevronDownIcon, ChevronRightIcon, ArrowLeftIcon, CheckIcon, XCircleIcon,
    ExclamationTriangleIcon, LockClosedIcon, LockOpenIcon, SparklesIcon,
    ClipboardDocumentCheckIcon, Cog6ToothIcon, DocumentArrowDownIcon,
} from '../../icons/Icons';
import { Batch, BatchVendorShipment, BarcodeProduct } from '../../../types';
import { callGasAuthed } from '../../../services/gasApi';
import { Button } from '../../ui/Button';
import { WeightConfirmationCard } from './WeightConfirmationCard';
import { DuplicateEanModal } from './DuplicateEanModal';
import { EanAlertSettingsModal } from './EanAlertSettingsModal';
import { BarcodeLabel } from './BarcodeLabel';
import {
    isEANUPCSelected, checkEANDuplicate, recordSessionDuplicate,
    hasSessionDuplicates, sendSessionDuplicateEmail,
} from '../../../services/eanDuplicateService';

interface ScanLine {
    sku: string;
    item_name: string;
    ordered: number;
    received: number;
}
interface ScanTapeEntry {
    sku: string;
    name: string;
    timestamp: string;
    isExcess: boolean;
}
interface NoProductEntry {
    value: string;
    timestamp: string;
    reason: string;
}
type ScanStatus = { type: 'idle' | 'success' | 'warning' | 'error' | 'processing'; message: string };
type View = 'browse' | 'scanning' | 'locked';

let batchListCache: Batch[] | null = null;

interface ReceiveShipmentProps {
    isAdmin?: boolean;
}

export const ReceiveShipment: React.FC<ReceiveShipmentProps> = ({ isAdmin = false }) => {
    // ── Browse state ──────────────────────────────────────────────────────
    const [batches, setBatches] = useState<Batch[]>(batchListCache || []);
    const [loadingBatches, setLoadingBatches] = useState(false);
    const [batchError, setBatchError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState<'All' | 'sea' | 'air'>('All');
    const [openBatchId, setOpenBatchId] = useState<string | null>(null);
    const [openShipmentId, setOpenShipmentId] = useState<string | null>(null);
    const [startingShipmentId, setStartingShipmentId] = useState<string | null>(null);

    const fetchBatches = useCallback(async (force = false) => {
        if (!force && batchListCache) { setBatches(batchListCache); return; }
        setLoadingBatches(true);
        setBatchError(null);
        try {
            const result = await callGasAuthed('get_batches');
            if (result.status !== 'success') throw new Error(result.message || 'Failed to load batches');
            batchListCache = result.batches || [];
            setBatches(batchListCache);
        } catch (err: any) {
            setBatchError(err.message || 'Network failure');
        } finally {
            setLoadingBatches(false);
        }
    }, []);
    useEffect(() => { fetchBatches(false); }, [fetchBatches]);

    const filteredBatches = useMemo(() => {
        let list = batches.filter(b => (b.vendor_shipments || []).length > 0);
        if (typeFilter !== 'All') list = list.filter(b => b.batch_type === typeFilter);
        const q = search.trim().toLowerCase();
        if (q) {
            list = list.filter(b =>
                b.batch_id.toLowerCase().includes(q) ||
                (b.vendor_shipments || []).some(v =>
                    v.shipment_id.toLowerCase().includes(q) ||
                    v.line_items.some(li => li.sku.toLowerCase().includes(q) || li.item_name.toLowerCase().includes(q))));
        }
        return list;
    }, [batches, typeFilter, search]);

    // ── Active session state ─────────────────────────────────────────────
    const [view, setView] = useState<View>('browse');
    const [activeBatch, setActiveBatch] = useState<Batch | null>(null);
    const [activeShipment, setActiveShipment] = useState<BatchVendorShipment | null>(null);
    const [activeLines, setActiveLines] = useState<ScanLine[]>([]);
    const [existingWeights, setExistingWeights] = useState<{ listed: number | null; actual: number | null }>({ listed: null, actual: null });
    const [weightsConfirmed, setWeightsConfirmed] = useState(false);
    const scanningLocked = activeBatch?.batch_type === 'air' && !weightsConfirmed;

    const [scanMode, setScanMode] = useState<'autofocus' | 'manual'>(() => {
        const v = localStorage.getItem('receive_shipment_scan_mode');
        return v === 'manual' ? 'manual' : 'autofocus';
    });
    useEffect(() => { localStorage.setItem('receive_shipment_scan_mode', scanMode); }, [scanMode]);

    const [barcodeInput, setBarcodeInput] = useState('');
    const [scanStatus, setScanStatus] = useState<ScanStatus>({ type: 'idle', message: 'Select a shipment to begin scanning.' });
    const [scanTape, setScanTape] = useState<ScanTapeEntry[]>([]);
    const [noProductData, setNoProductData] = useState<NoProductEntry[]>([]);
    const [excessFrequency, setExcessFrequency] = useState<Record<string, number>>({});
    const [productCache, setProductCache] = useState<Record<string, BarcodeProduct>>({});
    const [printQueue, setPrintQueue] = useState<BarcodeProduct[]>([]);
    const [pendingSyncs, setPendingSyncs] = useState(0);
    const [syncErrors, setSyncErrors] = useState(0);

    const [duplicateModal, setDuplicateModal] = useState<{ ean: string; products: BarcodeProduct[] } | null>(null);
    const [sessionHasDuplicates, setSessionHasDuplicates] = useState(hasSessionDuplicates());
    const [emailRecipients, setEmailRecipients] = useState<string[]>([]);
    const [showSettingsModal, setShowSettingsModal] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const autoScanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        fetch('/api/barcode/settings').then(r => r.json()).then(d => setEmailRecipients(d.eanDuplicateEmails || [])).catch(() => {});
    }, []);

    // Auto-focus the scanner input while idle in scanning view (autofocus mode)
    useEffect(() => {
        if (view !== 'scanning' || scanningLocked || scanMode !== 'autofocus') return;
        const interval = setInterval(() => {
            if (document.activeElement !== inputRef.current && inputRef.current) inputRef.current.focus();
        }, 1500);
        return () => clearInterval(interval);
    }, [view, scanningLocked, scanMode]);

    // Auto-trigger scan shortly after keystrokes stop (autofocus mode — a USB
    // scanner types fast and doesn't press Enter)
    useEffect(() => {
        if (scanMode !== 'autofocus' || !barcodeInput.trim()) {
            if (autoScanTimeoutRef.current) { clearTimeout(autoScanTimeoutRef.current); autoScanTimeoutRef.current = null; }
            return;
        }
        if (autoScanTimeoutRef.current) clearTimeout(autoScanTimeoutRef.current);
        autoScanTimeoutRef.current = setTimeout(() => {
            const val = barcodeInput.trim();
            if (val) { setBarcodeInput(''); executeScan(val); }
        }, 200);
        return () => { if (autoScanTimeoutRef.current) clearTimeout(autoScanTimeoutRef.current); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [barcodeInput, scanMode]);

    // Auto-print whenever a label is queued
    useEffect(() => {
        if (!printQueue.length) return;
        const timer = setTimeout(() => {
            window.print();
            setTimeout(() => setPrintQueue([]), 800);
        }, 500);
        return () => clearTimeout(timer);
    }, [printQueue]);

    const handleRowClick = (batch: Batch) => {
        setOpenBatchId(prev => {
            const next = prev === batch.batch_id ? null : batch.batch_id;
            setOpenShipmentId(null);
            return next;
        });
    };

    const startScanning = async (batch: Batch, shipment: BatchVendorShipment) => {
        setStartingShipmentId(shipment.shipment_id);
        try {
            const result = await callGasAuthed('get_vendor_shipment_data');
            if (result.status !== 'success' && result.success !== true) throw new Error(result.message || 'Failed to load scan progress');
            const lines: any[] = result.lines || [];
            const shipments: any[] = result.shipments || [];
            const scannedBySku: Record<string, number> = {};
            lines.forEach(l => {
                if (String(l.shipment_id) === shipment.shipment_id) scannedBySku[String(l.sku)] = Number(l.scanned_qty) || 0;
            });
            const shipmentRow = shipments.find(s => String(s.shipment_id) === shipment.shipment_id);

            setActiveBatch(batch);
            setActiveShipment(shipment);
            setActiveLines(shipment.line_items.map(li => ({
                sku: li.sku, item_name: li.item_name, ordered: li.incoming_qty, received: scannedBySku[li.sku] || 0,
            })));
            setExistingWeights({
                listed: shipmentRow?.listed_weight ? Number(shipmentRow.listed_weight) : null,
                actual: shipmentRow?.actual_weight ? Number(shipmentRow.actual_weight) : null,
            });
            setWeightsConfirmed(false);
            setScanTape([]);
            setNoProductData([]);
            setExcessFrequency({});
            setPendingSyncs(0);
            setSyncErrors(0);
            setScanStatus({ type: 'idle', message: `Shipment "${shipment.shipment_id}" loaded — ${shipment.line_items.length} SKU(s). Ready to scan.` });
            setView('scanning');
        } catch (err: any) {
            alert(err.message || 'Failed to start scanning session');
        } finally {
            setStartingShipmentId(null);
        }
    };

    const backToBrowse = () => {
        setView('browse');
        setActiveBatch(null);
        setActiveShipment(null);
    };

    const resetSession = () => {
        setScanTape([]);
        setNoProductData([]);
        setExcessFrequency({});
        setPrintQueue([]);
        setPendingSyncs(0);
        setSyncErrors(0);
        setActiveLines(prev => prev.map(l => ({ ...l, received: 0 })));
        setView('scanning');
        setScanStatus({ type: 'idle', message: `Shipment "${activeShipment?.shipment_id}" reset. Ready to scan.` });
    };

    const executeScan = async (rawValue: string) => {
        if (!rawValue || !activeShipment) return;
        if (scanningLocked) {
            setScanStatus({ type: 'error', message: 'Confirm carton weights above before scanning this air shipment.' });
            return;
        }
        setScanStatus({ type: 'processing', message: `Querying: "${rawValue}"` });

        try {
            const res = await fetch('/api/barcode/search', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: rawValue }),
            });
            if (res.status === 404) {
                const inShipment = activeLines.some(l => l.sku.toLowerCase() === rawValue.toLowerCase());
                const reason = inShipment ? 'Missing Product Master Data' : 'Unknown SKU';
                setNoProductData(prev => [{ value: rawValue, timestamp: new Date().toLocaleTimeString(), reason }, ...prev]);
                setScanStatus({ type: 'error', message: `${reason}: "${rawValue}" — cannot print label.` });
                return;
            }
            if (!res.ok) throw new Error(`Server error HTTP ${res.status}`);
            const product: BarcodeProduct = await res.json();
            setProductCache(prev => ({ ...prev, [product.sku]: product }));

            if (isEANUPCSelected(product.EANUPC)) {
                try {
                    const { isDuplicate, products } = await checkEANDuplicate(product.sku);
                    if (isDuplicate) {
                        recordSessionDuplicate({
                            ean: product.EANUPC!.trim(),
                            affectedProducts: products.map(p => ({ sku: p.sku, productName: p.product_name })),
                            timestamp: new Date().toISOString(),
                            module: 'Receive Shipment',
                        });
                        setSessionHasDuplicates(true);
                        setDuplicateModal({ ean: product.EANUPC!.trim(), products });
                        setScanStatus({ type: 'error', message: `BLOCKED: Duplicate EAN [${product.EANUPC!.trim()}] on SKU "${product.sku}". Printing blocked.` });
                        return;
                    }
                } catch {
                    setScanStatus({ type: 'error', message: 'EAN duplicate check failed — scan blocked for safety. Check connection.' });
                    return;
                }
            }

            const line = activeLines.find(l => l.sku.toLowerCase() === product.sku.toLowerCase());
            if (line) {
                const nextCount = line.received + 1;
                setActiveLines(prev => prev.map(l => (l.sku === line.sku ? { ...l, received: nextCount } : l)));
                setPendingSyncs(n => n + 1);
                callGasAuthed('increment_scanned_quantity', { shipment_id: activeShipment.shipment_id, sku: product.sku, delta: 1 })
                    .then(r => { if (r.status !== 'success' && r.success !== true) setSyncErrors(n => n + 1); })
                    .catch(() => setSyncErrors(n => n + 1))
                    .finally(() => setPendingSyncs(n => Math.max(0, n - 1)));

                const isExcess = nextCount > line.ordered;
                setScanTape(prev => [{ sku: product.sku, name: product.product_name, timestamp: new Date().toLocaleTimeString(), isExcess }, ...prev]);
                setPrintQueue([product]);
                setScanStatus({
                    type: isExcess ? 'warning' : 'success',
                    message: isExcess
                        ? `EXCESS: [${product.sku}] ${product.product_name} — received ${nextCount}, expected ${line.ordered}. Label printed.`
                        : `RECEIVED: [${product.sku}] ${product.product_name}. Label sent to printer.`,
                });
            } else {
                setExcessFrequency(prev => ({ ...prev, [product.sku]: (prev[product.sku] || 0) + 1 }));
                setScanTape(prev => [{ sku: product.sku, name: product.product_name, timestamp: new Date().toLocaleTimeString(), isExcess: true }, ...prev]);
                setPrintQueue([product]);
                setScanStatus({ type: 'warning', message: `UNEXPECTED: [${product.sku}] ${product.product_name} not in active shipment. Treating as excess — label printed.` });
            }
        } catch (err: any) {
            setScanStatus({ type: 'error', message: `Query failed: ${err.message || 'Server unavailable'}` });
        }
    };

    const handleManualSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const val = barcodeInput.trim();
        if (!val) return;
        setBarcodeInput('');
        executeScan(val);
    };

    const handleEndSession = async () => {
        if (!window.confirm('Finished scanning? This will lock the session and show the excess summary.')) return;
        if (sessionHasDuplicates) {
            await sendSessionDuplicateEmail('Receive Shipment');
            setSessionHasDuplicates(false);
        }
        setView('locked');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Printable pre-receiving checklist for a shipment — opened in a new tab
    // (not window.print() in this tab) so it gets its own document and isn't
    // affected by the barcode-label @page rule in index.css (fixed at
    // 50mm x 30mm for that flow). The print dialog's "Save as PDF" is what
    // makes this a "downloadable PDF" without adding a PDF library.
    const escapeHtml = (s: string) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

    const handleDownloadReceivingSheet = (batch: Batch, shipment: BatchVendorShipment) => {
        const totalUnits = shipment.line_items.reduce((sum, li) => sum + li.incoming_qty, 0);
        const rows = shipment.line_items.map(li => `
            <tr>
                <td>${escapeHtml(li.sku)}</td>
                <td>${escapeHtml(li.item_name)}</td>
                <td class="num">${li.incoming_qty}</td>
                <td class="blank"></td>
                <td class="blank"></td>
            </tr>`).join('');

        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Receiving Sheet - ${escapeHtml(shipment.shipment_id)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { font-size: 11px; color: #666; margin-bottom: 18px; }
  .meta { display: flex; flex-wrap: wrap; gap: 22px; margin-bottom: 20px; padding: 12px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
  .meta div { min-width: 130px; font-size: 12px; font-weight: bold; }
  .meta span { display: block; font-size: 9px; font-weight: normal; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 1px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
  th { background: #f1f5f9; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: bold; }
  td.blank { min-width: 70px; }
  .sign { margin-top: 44px; display: flex; gap: 50px; font-size: 11px; }
  .sign div { flex: 1; border-top: 1px solid #333; padding-top: 4px; }
</style>
</head>
<body>
  <h1>Receiving Sheet</h1>
  <div class="sub">Generated ${new Date().toLocaleString()}</div>
  <div class="meta">
    <div><span>Batch ID</span>${escapeHtml(batch.batch_id)}</div>
    <div><span>Shipment ID</span>${escapeHtml(shipment.shipment_id)}</div>
    <div><span>Vendor</span>${escapeHtml(shipment.vendor_code)} - ${escapeHtml(shipment.vendor_name)}</div>
    <div><span>Mode</span>${batch.batch_type === 'air' ? 'AIR' : 'SEA'}</div>
    <div><span>Cartons</span>${shipment.carton_count}</div>
    <div><span>Total Units</span>${totalUnits}</div>
  </div>
  <table>
    <thead>
      <tr><th>SKU</th><th>Item Name</th><th>Expected Qty</th><th>Received Qty</th><th>Notes</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="sign">
    <div>Received By</div>
    <div>Checked By</div>
    <div>Date</div>
  </div>
</body>
</html>`;

        const w = window.open('', '_blank');
        if (!w) { alert('Please allow pop-ups for this site to download the receiving sheet.'); return; }
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.onload = () => { w.focus(); w.print(); };
    };

    const handleExportWmsReport = () => {
        const rows: string[][] = [['Section', 'SKU', 'Product Name', 'Expected Qty', 'Received Qty', 'Excess Qty', 'Notes']];
        for (const line of activeLines) {
            const excess = Math.max(0, line.received - line.ordered);
            if (line.received > 0 || excess > 0) {
                const name = productCache[line.sku]?.product_name || line.item_name || '';
                rows.push(['SHIPMENT LINE', line.sku, `"${name.replace(/"/g, '""')}"`, String(line.ordered), String(line.received), String(excess), '']);
            }
        }
        for (const sku of Object.keys(excessFrequency)) {
            if (activeLines.some(l => l.sku.toLowerCase() === sku.toLowerCase())) continue;
            const name = productCache[sku]?.product_name || 'Unexpected SKU';
            rows.push(['UNEXPECTED', sku, `"${name.replace(/"/g, '""')}"`, '0', '0', String(excessFrequency[sku]), 'Not in active shipment']);
        }
        for (const entry of noProductData) {
            rows.push(['NO PRODUCT DATA', `"${entry.value.replace(/"/g, '""')}"`, '"—"', '0', '0', '0', `"${entry.reason} @ ${entry.timestamp}"`]);
        }
        const csv = 'data:text/csv;charset=utf-8,' + rows.map(r => r.join(',')).join('\n');
        const a = document.createElement('a');
        a.href = encodeURI(csv);
        a.download = `WMS_Report_${activeShipment?.shipment_id || 'SHIPMENT'}_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    };

    const activeRows = activeLines.filter(l => l.received > 0);
    const linesCompleted = activeLines.filter(l => l.received >= l.ordered).length;
    const allExcessEntries = Object.keys(excessFrequency).map(sku => ({
        sku, excessQty: excessFrequency[sku],
        productName: productCache[sku]?.product_name || activeLines.find(l => l.sku === sku)?.item_name || sku,
    }));

    // ══════════════════════════════════════════════════════════════════════
    // Browse view
    // ══════════════════════════════════════════════════════════════════════
    if (view === 'browse') {
        return (
            <div className="p-6 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-24">
                <div className="mb-6 flex items-center justify-between">
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                        Receive Shipment
                        {isAdmin && <span className="ml-2 px-2 py-0.5 bg-red-500/20 text-red-500 border border-red-500/30 rounded text-[10px] font-bold uppercase tracking-widest align-middle">Admin</span>}
                    </h1>
                    <Button variant="secondary" onClick={() => fetchBatches(true)} disabled={loadingBatches} icon={<ArrowPathIcon className={`w-4 h-4 ${loadingBatches ? 'animate-spin' : ''}`} />}>
                        Refresh Data
                    </Button>
                </div>

                <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 mb-6 shadow-sm flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[200px] relative">
                        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
                        <input
                            type="text" value={search} onChange={e => setSearch(e.target.value)}
                            placeholder="Search by Batch ID, Shipment ID, SKU, or Item Name…"
                            className="w-full pl-10 pr-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 shrink-0">
                        {(['All', 'air', 'sea'] as const).map(mode => (
                            <button key={mode} onClick={() => setTypeFilter(mode)}
                                className={`px-3 py-1.5 rounded-md font-bold text-xs transition-all uppercase ${typeFilter === mode ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
                                {mode === 'All' ? 'All' : mode === 'air' ? '✈ Air' : '🚢 Sea'}
                            </button>
                        ))}
                    </div>
                </div>

                {batchError && (
                    <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4 mb-6 flex items-center gap-3">
                        <ExclamationTriangleIcon className="w-5 h-5 text-red-500 shrink-0" />
                        <p className="text-red-600 dark:text-red-400 text-sm font-medium">{batchError}</p>
                        <button onClick={() => fetchBatches(true)} className="ml-auto text-xs text-red-500 hover:text-red-700 font-bold underline">Retry</button>
                    </div>
                )}

                {loadingBatches && !batchListCache ? (
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 animate-pulse h-64 shadow-sm" />
                ) : filteredBatches.length === 0 ? (
                    <div className="text-center py-24 bg-white dark:bg-slate-800 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 shadow-sm">
                        <BoxIcon className="w-16 h-16 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
                        <p className="text-lg text-slate-600 dark:text-slate-300 font-medium">No shipments to receive</p>
                        <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Try adjusting your search or filters.</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {filteredBatches.map(batch => {
                            const isOpen = openBatchId === batch.batch_id;
                            const ModeIcon = batch.batch_type === 'sea' ? ShipIcon : AirplaneIcon;
                            return (
                                <div key={batch.batch_id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm">
                                    <div
                                        role="button" tabIndex={0} onClick={() => handleRowClick(batch)}
                                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowClick(batch); } }}
                                        className="w-full px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors flex items-center gap-3 flex-wrap cursor-pointer"
                                    >
                                        {isOpen ? <ChevronDownIcon className="w-4 h-4 text-slate-400" /> : <ChevronRightIcon className="w-4 h-4 text-slate-400" />}
                                        <ModeIcon className="w-4 h-4 text-slate-400" />
                                        <span className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100">{batch.batch_id}</span>
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-purple-100 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400">{batch.status}</span>
                                        {batch.is_delayed && (
                                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400 flex items-center gap-1">
                                                <ExclamationTriangleIcon className="w-3 h-3" /> Delayed {batch.delay_days}d
                                            </span>
                                        )}
                                        <div className="flex-1" />
                                        <span className="text-xs text-slate-500">{(batch.vendor_shipments || []).length} shipment(s)</span>
                                        <span className="text-xs text-slate-500">{batch.total_units} units</span>
                                    </div>
                                    {isOpen && (
                                        <div className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3 space-y-2">
                                            {(batch.vendor_shipments || []).map(shipment => {
                                                const isShipOpen = openShipmentId === shipment.shipment_id;
                                                const receivedTotal = shipment.line_items.reduce((sum, li) => sum + li.incoming_qty, 0);
                                                return (
                                                    <div key={shipment.shipment_id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                                                        <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
                                                            <button onClick={() => setOpenShipmentId(prev => prev === shipment.shipment_id ? null : shipment.shipment_id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                                                                {isShipOpen ? <ChevronDownIcon className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRightIcon className="w-3.5 h-3.5 text-slate-400" />}
                                                                <span className="font-bold text-xs uppercase text-slate-900 dark:text-slate-100">{shipment.vendor_code}</span>
                                                                <span className="text-slate-300 dark:text-slate-600">|</span>
                                                                <span className="text-xs text-slate-600 dark:text-slate-300">{shipment.vendor_name}</span>
                                                                <span className="text-xs text-slate-400 ml-2">{shipment.carton_count} ctn · {receivedTotal} units</span>
                                                            </button>
                                                            <Button
                                                                variant="secondary"
                                                                onClick={() => handleDownloadReceivingSheet(batch, shipment)}
                                                                icon={<DocumentArrowDownIcon className="w-4 h-4" />}
                                                                className="text-xs !py-1.5 !px-3"
                                                                title="Download a printable receiving sheet for this shipment"
                                                            >
                                                                Sheet
                                                            </Button>
                                                            <Button
                                                                onClick={() => startScanning(batch, shipment)}
                                                                disabled={startingShipmentId === shipment.shipment_id}
                                                                icon={<ClipboardDocumentCheckIcon className="w-4 h-4" />}
                                                                className="text-xs !py-1.5 !px-3"
                                                            >
                                                                {startingShipmentId === shipment.shipment_id ? 'Loading…' : 'Scan'}
                                                            </Button>
                                                        </div>
                                                        {isShipOpen && (
                                                            <div className="border-t border-slate-100 dark:border-slate-700 px-4 py-3 overflow-x-auto">
                                                                <table className="w-full text-left border-collapse min-w-[420px]">
                                                                    <thead>
                                                                        <tr className="text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                                                                            <th className="py-2 pr-3">SKU</th>
                                                                            <th className="py-2 pr-3">Item Name</th>
                                                                            <th className="py-2 pr-3 text-right">Incoming</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                                                        {shipment.line_items.map(li => (
                                                                            <tr key={li.line_id}>
                                                                                <td className="py-2 pr-3 font-mono text-xs font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">{li.sku}</td>
                                                                                <td className="py-2 pr-3 text-sm text-slate-700 dark:text-slate-300">{li.item_name}</td>
                                                                                <td className="py-2 pr-3 text-right text-sm font-bold text-slate-900 dark:text-slate-100">{li.incoming_qty}</td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════════════
    // Scanning view
    // ══════════════════════════════════════════════════════════════════════
    if (view === 'scanning' && activeShipment && activeBatch) {
        return (
            <div className="p-6 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-24 flex flex-col gap-4">
                <div className="flex items-center justify-between bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-5 py-3 shadow-sm flex-wrap gap-3">
                    <div className="flex items-center gap-3 flex-wrap">
                        <button onClick={backToBrowse} className="flex items-center gap-1 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100 text-xs font-bold">
                            <ArrowLeftIcon className="w-3.5 h-3.5" /> Batches
                        </button>
                        <span className="w-px h-4 bg-slate-200 dark:bg-slate-700" />
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">Inbound</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400 font-mono">{activeShipment.shipment_id}</span>
                        <h1 className="text-base font-bold text-slate-900 dark:text-slate-100">Receive Shipment — Scanning</h1>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        {syncErrors > 0 && <span className="text-[10px] font-bold text-red-600 dark:text-red-400">{syncErrors} sync error(s)</span>}
                        {pendingSyncs > 0 && <span className="text-[10px] text-blue-600 dark:text-blue-400 flex items-center gap-1"><ArrowPathIcon className="w-3 h-3 animate-spin" /> Syncing…</span>}
                        {pendingSyncs === 0 && syncErrors === 0 && scanTape.length > 0 && <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><CheckIcon className="w-3 h-3" /> Synced</span>}
                        <span className="text-[10px] text-slate-500">{linesCompleted}/{activeLines.length} lines done</span>
                        {isAdmin && (
                            <button onClick={() => setShowSettingsModal(true)} className="flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
                                <Cog6ToothIcon className="w-3.5 h-3.5" /> EAN Alert Settings
                            </button>
                        )}
                    </div>
                </div>

                {activeBatch.batch_type === 'air' && (
                    <WeightConfirmationCard
                        key={activeShipment.shipment_id}
                        shipmentId={activeShipment.shipment_id}
                        batchId={activeBatch.batch_id}
                        vendorCode={activeShipment.vendor_code}
                        existingListedWeight={existingWeights.listed}
                        existingActualWeight={existingWeights.actual}
                        onCompletionChange={setWeightsConfirmed}
                    />
                )}

                <div className={`relative bg-blue-600 rounded-2xl p-4 shadow-xl space-y-2.5 transition-opacity ${scanningLocked ? 'opacity-50 grayscale' : ''}`}>
                    {scanningLocked && <div className="absolute inset-0 z-10 cursor-not-allowed" title="Confirm carton weights above to unlock scanning" />}
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <h2 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                            <ClipboardDocumentCheckIcon className="w-4 h-4" /> Barcode Scanner
                        </h2>
                        <div className="inline-flex rounded-lg bg-blue-700 p-0.5">
                            {(['autofocus', 'manual'] as const).map(m => (
                                <button key={m} type="button" onClick={() => setScanMode(m)} disabled={scanningLocked}
                                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition disabled:cursor-not-allowed ${scanMode === m ? 'bg-white text-blue-700 shadow' : 'text-blue-200 hover:text-white'}`}>
                                    {m === 'autofocus' ? '🎯 Auto-Focus' : '✏ Manual'}
                                </button>
                            ))}
                        </div>
                    </div>
                    <form onSubmit={handleManualSubmit} className="relative">
                        <input
                            ref={inputRef} type="text" value={barcodeInput} onChange={e => setBarcodeInput(e.target.value)} disabled={scanningLocked}
                            placeholder={scanningLocked ? '🔒 CONFIRM CARTON WEIGHTS ABOVE TO UNLOCK SCANNING' : scanMode === 'autofocus' ? '🎯 AUTO-FOCUS ACTIVE — SCAN BARCODES DIRECTLY...' : '✏ TYPE SKU OR SCAN — PRESS ENTER TO SUBMIT...'}
                            className="w-full bg-blue-800 border-2 border-white/30 focus:border-white rounded-xl px-4 py-3.5 text-sm font-mono tracking-widest text-white placeholder-blue-200/70 focus:outline-none focus:ring-2 focus:ring-white/20 transition text-center uppercase caret-white disabled:cursor-not-allowed"
                        />
                        {scanMode === 'manual' && (
                            <button type="submit" disabled={scanningLocked} className="absolute right-3 top-1/2 -translate-y-1/2 py-1.5 px-3 bg-white hover:bg-blue-50 text-blue-700 rounded-lg text-[10px] font-bold disabled:cursor-not-allowed">Scan</button>
                        )}
                    </form>
                    <div className={`px-3 py-2 rounded-lg border text-xs flex items-center gap-2 ${
                        scanStatus.type === 'error' ? 'bg-red-500/20 border-red-300/20 text-red-100' :
                        scanStatus.type === 'success' ? 'bg-emerald-500/20 border-emerald-300/20 text-emerald-100' :
                        scanStatus.type === 'warning' ? 'bg-amber-500/20 border-amber-300/20 text-amber-100' :
                        scanStatus.type === 'processing' ? 'bg-blue-500/30 border-blue-300/20 text-blue-50' :
                        'bg-blue-700/50 border-blue-400/20 text-blue-100'
                    }`}>
                        <span className="font-medium">{scanStatus.message}</span>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    <div className="lg:col-span-8 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
                        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2 mb-3">
                            <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">Active Shipment</h2>
                            {activeLines.length > 0 && <span className="text-[10px] font-bold text-slate-500">{activeRows.length} / {activeLines.length} scanned</span>}
                        </div>
                        {activeRows.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                                <BoxIcon className="w-7 h-7 text-slate-300 dark:text-slate-600" />
                                <p className="text-xs text-slate-400">Awaiting first scan</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse min-w-[480px]">
                                    <thead>
                                        <tr className="border-b border-slate-200 dark:border-slate-700 text-[10px] uppercase font-bold text-slate-500">
                                            <th className="py-2 px-3">SKU</th>
                                            <th className="py-2 px-3 text-right">Ordered</th>
                                            <th className="py-2 px-3 text-right">Pending</th>
                                            <th className="py-2 px-3 text-right">Received</th>
                                            <th className="py-2 px-3 text-center">Status</th>
                                            <th className="py-2 px-3 text-right">Excess</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 text-xs">
                                        {activeRows.map(line => {
                                            const pending = Math.max(0, line.ordered - line.received);
                                            const excess = Math.max(0, line.received - line.ordered);
                                            return (
                                                <tr key={line.sku}>
                                                    <td className="py-2 px-3 font-mono font-bold text-blue-600 dark:text-blue-400">{line.sku}</td>
                                                    <td className="py-2 px-3 text-right font-mono text-slate-500">{line.ordered}</td>
                                                    <td className="py-2 px-3 text-right font-mono text-slate-500">{pending}</td>
                                                    <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">{line.received}</td>
                                                    <td className="py-2 px-3 text-center">
                                                        {excess > 0 ? (
                                                            <span className="bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded text-[9px] font-bold uppercase">Excess</span>
                                                        ) : line.received >= line.ordered ? (
                                                            <span className="bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded text-[9px] font-bold uppercase">Done</span>
                                                        ) : (
                                                            <span className="bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded text-[9px] font-bold uppercase">Pending</span>
                                                        )}
                                                    </td>
                                                    <td className={`py-2 px-3 text-right font-mono font-bold ${excess > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-300 dark:text-slate-700'}`}>{excess > 0 ? `+${excess}` : '—'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    <div className="lg:col-span-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
                        <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700 pb-2 mb-3">Live Scan Tape</h2>
                        {scanTape.length === 0 && noProductData.length === 0 ? (
                            <div className="flex flex-col items-center justify-center text-center py-10 text-slate-400 text-[11px] gap-2">Awaiting first scan.</div>
                        ) : (
                            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
                                {scanTape.map((log, i) => (
                                    <div key={i} className={`p-2.5 rounded-xl border text-[10.5px] leading-snug space-y-0.5 ${log.isExcess ? 'bg-amber-50 dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/20' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800'}`}>
                                        <div className="flex justify-between items-center">
                                            <span className="font-mono text-[10px] text-slate-400">{log.timestamp}</span>
                                            <span className={`font-bold uppercase tracking-wider text-[9px] ${log.isExcess ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{log.isExcess ? 'Excess' : 'OK'}</span>
                                        </div>
                                        <div className="font-bold font-mono text-blue-600 dark:text-blue-400">{log.sku}</div>
                                        <p className="truncate text-slate-700 dark:text-slate-200">{log.name}</p>
                                    </div>
                                ))}
                                {noProductData.map((log, i) => (
                                    <div key={`miss-${i}`} className="p-2.5 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/5 text-[10.5px] leading-snug space-y-0.5">
                                        <div className="flex justify-between items-center">
                                            <span className="font-mono text-[10px] text-slate-400">{log.timestamp}</span>
                                            <span className="font-bold text-red-600 dark:text-red-400 uppercase tracking-wider text-[9px]">Error</span>
                                        </div>
                                        <div className="font-bold font-mono text-red-600 dark:text-red-400">"{log.value}"</div>
                                        <p className="text-red-500 dark:text-red-300">{log.reason}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex justify-end items-center gap-3">
                    {sessionHasDuplicates && <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold">Duplicate EANs queued — email will send on End Session</span>}
                    <button onClick={handleEndSession} className="bg-red-700 hover:bg-red-600 text-white text-xs font-bold uppercase tracking-wider py-2.5 px-6 rounded-xl flex items-center gap-2 shadow-lg">
                        <LockClosedIcon className="w-3.5 h-3.5" /> End Session
                    </button>
                </div>

                {duplicateModal && (
                    <DuplicateEanModal ean={duplicateModal.ean} products={duplicateModal.products} emailRecipients={emailRecipients} onClose={() => setDuplicateModal(null)} />
                )}
                {showSettingsModal && (
                    <EanAlertSettingsModal initialEmails={emailRecipients} onClose={() => setShowSettingsModal(false)} onSaved={setEmailRecipients} />
                )}

                {printQueue.length > 0 && typeof document !== 'undefined' && createPortal(
                    <div id="print-only-area" style={{ backgroundColor: '#ffffff' }}>
                        {printQueue.map((product, i) => (
                            <div key={i} className="print-label-item">
                                <BarcodeLabel product={product} batchNo={activeBatch.batch_id} />
                            </div>
                        ))}
                    </div>,
                    document.body
                )}
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════════════
    // Locked / summary view
    // ══════════════════════════════════════════════════════════════════════
    return (
        <div className="p-6 max-w-[1400px] mx-auto animate-in fade-in duration-500 pb-24 space-y-6">
            <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-6 rounded-2xl flex flex-col sm:flex-row items-center gap-5 shadow-sm">
                <div className="bg-red-600 text-white p-4 rounded-full shrink-0">
                    <LockClosedIcon className="w-7 h-7" />
                </div>
                <div className="space-y-1 text-center sm:text-left flex-grow">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Session Locked — {activeShipment?.shipment_id}</h2>
                    <p className="text-xs text-red-600 dark:text-red-300 max-w-2xl">Scanning is closed. Review excess quantities below, export the WMS report, or begin a new session.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                    <Button variant="secondary" onClick={backToBrowse} icon={<ArrowLeftIcon className="w-3.5 h-3.5" />}>Select Shipment</Button>
                    <Button variant="secondary" onClick={resetSession} icon={<LockOpenIcon className="w-4 h-4" />}>Begin New Session</Button>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm space-y-4">
                <div className="border-b border-slate-200 dark:border-slate-700 pb-3">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 uppercase tracking-widest flex items-center gap-2">
                        <SparklesIcon className="w-4 h-4 text-amber-500" /> Excess Quantity Summary
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-1">Items received beyond ordered quantity, or scanned items not in this shipment. Labels were already printed automatically on each scan.</p>
                </div>
                {allExcessEntries.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-slate-500 gap-2">
                        <CheckIcon className="w-8 h-8 text-emerald-500" />
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">No Excess — Perfect Reconciliation</span>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-700 text-[10.5px] uppercase font-bold text-slate-500">
                                    <th className="py-2.5 px-3">SKU</th>
                                    <th className="py-2.5 px-3 text-right">Excess Qty</th>
                                    <th className="py-2.5 px-3">Product Name</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                                {allExcessEntries.map(({ sku, excessQty, productName }) => (
                                    <tr key={sku}>
                                        <td className="py-2.5 px-3 font-mono font-bold text-blue-600 dark:text-blue-400">{sku}</td>
                                        <td className="py-2.5 px-3 text-right"><span className="bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-bold font-mono px-2 py-0.5 rounded">+{excessQty}</span></td>
                                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300 truncate max-w-[300px]">{productName}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm space-y-4 opacity-90">
                <div className="border-b border-slate-200 dark:border-slate-700 pb-3">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-widest flex items-center gap-2">
                        <ExclamationTriangleIcon className="w-4 h-4 text-slate-400" /> Unresolved Scans (No Product Data)
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-1">Scanned codes that could not be matched in the product master.</p>
                </div>
                {noProductData.length === 0 ? (
                    <p className="text-center py-6 text-slate-500 text-xs italic">No unresolved scans this session.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-700 text-[10.5px] uppercase font-bold text-slate-500">
                                    <th className="py-2.5 px-3">Scanned Value</th>
                                    <th className="py-2.5 px-3">Time</th>
                                    <th className="py-2.5 px-3">Reason</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-600 dark:text-slate-400">
                                {noProductData.map((entry, i) => (
                                    <tr key={i}>
                                        <td className="py-2.5 px-3 font-mono text-red-600 dark:text-red-400 font-bold">{entry.value}</td>
                                        <td className="py-2.5 px-3 font-mono text-slate-400">{entry.timestamp}</td>
                                        <td className="py-2.5 px-3"><span className="text-[10px] font-bold bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500 px-2 py-0.5 rounded uppercase">{entry.reason}</span></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-6 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
                <div className="flex items-center gap-3 text-xs text-slate-500">
                    <ClipboardDocumentCheckIcon className="w-5 h-5 text-blue-500" /> Export the WMS report or start a new session.
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
                    <Button variant="secondary" onClick={handleExportWmsReport} icon={<DocumentArrowDownIcon className="w-4 h-4" />}>Export WMS Report</Button>
                    <Button onClick={resetSession} icon={<LockOpenIcon className="w-4 h-4" />}>Begin New Session</Button>
                </div>
            </div>
        </div>
    );
};
