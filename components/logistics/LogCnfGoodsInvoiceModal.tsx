import React, { useState, useRef, useMemo } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { getSessionAuthHeaders } from '../../services/authToken';
import { logCnfGoodsInvoice } from '../../services/settlementService';
import { extractInvoiceAmount } from '../../services/geminiService';
import { CnfAdvance } from '../../types';

const fmtInr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface CnfShipmentOption {
  batchId: string;
  shipmentId: string;
  vendorCode: string;
  vendorName: string;
}

// Reuses the same generic Drive uploader CnfAgentAccounting.tsx's
// GenerateBillModal already uses for CNF commission bills — it accepts any
// invoice file and stores it in the same shared "CNF Invoices" Drive folder;
// batchId in the form data is optional (naming only), so passing this
// modal's own generated id (once logged) isn't required here.
const UPLOAD_ENDPOINT = '/api/drive/upload-cnf-invoice';

export const LogCnfGoodsInvoiceModal: React.FC<{
  shipmentOptions: CnfShipmentOption[];
  outstandingAdvances: CnfAdvance[];
  submittedBy: string;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ shipmentOptions, outstandingAdvances, submittedBy, onClose, onSuccess }) => {
  const [selectedShipmentIds, setSelectedShipmentIds] = useState<Set<string>>(new Set());
  const [selectedAdvances, setSelectedAdvances] = useState<Record<string, string>>({});
  const [statedBaseAmount, setStatedBaseAmount] = useState('');
  const [gst, setGst] = useState('');
  const [total, setTotal] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
  const [overrideChecked, setOverrideChecked] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileSelectionRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const toggleShipment = (shipmentId: string) => {
    setSelectedShipmentIds(prev => {
      const next = new Set(prev);
      if (next.has(shipmentId)) next.delete(shipmentId); else next.add(shipmentId);
      return next;
    });
  };

  // Vendors present in the selected shipments — the advances picker only
  // shows advances for these vendors, oldest-first (a simple date sort
  // stands in for "FIFO by vendor": staff still reviews and edits amounts).
  const relevantVendorCodes = useMemo(() => {
    const codes = new Set<string>();
    shipmentOptions.forEach(s => { if (selectedShipmentIds.has(s.shipmentId)) codes.add(s.vendorCode); });
    return codes;
  }, [shipmentOptions, selectedShipmentIds]);

  const availableAdvances = useMemo(
    () => outstandingAdvances
      .filter(a => relevantVendorCodes.has(a.vendorCode))
      .sort((a, b) => a.date.localeCompare(b.date)),
    [outstandingAdvances, relevantVendorCodes]
  );

  const toggleAdvance = (advance: CnfAdvance) => {
    setSelectedAdvances(prev => {
      const next = { ...prev };
      if (next[advance.id] !== undefined) {
        delete next[advance.id];
      } else {
        next[advance.id] = String(advance.balance);
      }
      return next;
    });
  };

  const expectedGoodsValue = useMemo(
    () => Object.values(selectedAdvances).reduce((sum, v) => sum + (parseFloat(v) || 0), 0),
    [selectedAdvances]
  );

  const handleFileChange = async (f: File | null) => {
    setError(null);
    setUploadedFileUrl(null);
    if (!f) return;
    const selectionToken = ++fileSelectionRef.current;
    try {
      await Promise.all([
        (async () => {
          setIsUploading(true);
          try {
            const formData = new FormData();
            formData.append('file', f);
            const uploadResp = await fetch(UPLOAD_ENDPOINT, { method: 'POST', headers: getSessionAuthHeaders(), body: formData });
            const uploadData = await uploadResp.json();
            if (selectionToken !== fileSelectionRef.current) return;
            if (uploadData.success) {
              setUploadedFileUrl(uploadData.file.viewUrl);
            } else {
              setError(uploadData.error || 'Failed to upload invoice file');
            }
          } catch (err: any) {
            if (selectionToken !== fileSelectionRef.current) return;
            setError(err.message || 'Failed to upload invoice file');
          } finally {
            if (selectionToken === fileSelectionRef.current) setIsUploading(false);
          }
        })(),
        (async () => {
          setIsExtracting(true);
          try {
            const { amount, rawText } = await extractInvoiceAmount(f);
            if (selectionToken !== fileSelectionRef.current) return;
            if (amount !== null) {
              setTotal(String(amount));
            } else {
              setError(`Could not read a total from the file automatically (${rawText}). Enter it manually.`);
            }
          } finally {
            if (selectionToken === fileSelectionRef.current) setIsExtracting(false);
          }
        })()
      ]);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const parsedBase = parseFloat(statedBaseAmount) || 0;
  const parsedGst = parseFloat(gst) || 0;
  const parsedTotal = parseFloat(total) || 0;
  const impliedServiceCharge = parsedBase - expectedGoodsValue;
  const residualLiability = parsedTotal - expectedGoodsValue;
  const totalTolerable = Math.abs((parsedBase + parsedGst) - parsedTotal) < 1;

  const canSubmit =
    selectedShipmentIds.size > 0 &&
    Object.keys(selectedAdvances).length > 0 &&
    !!statedBaseAmount && !!gst && !!total && !!uploadedFileUrl &&
    (totalTolerable || (overrideChecked && overrideReason.trim().length > 0));

  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const byBatch: Record<string, string[]> = {};
      shipmentOptions.forEach(s => {
        if (selectedShipmentIds.has(s.shipmentId)) {
          (byBatch[s.batchId] = byBatch[s.batchId] || []).push(s.shipmentId);
        }
      });
      const lineItems = Object.keys(byBatch).map(batchId => ({ batchId, shipmentIds: byBatch[batchId] }));
      const matchedAdvances = Object.entries(selectedAdvances).map(([advanceId, amt]) => ({
        advanceId,
        amountMatched: parseFloat(amt) || 0
      }));

      await logCnfGoodsInvoice({
        lineItems,
        matchedAdvances,
        fileUrl: uploadedFileUrl || undefined,
        statedBaseAmount: parsedBase,
        gst: parsedGst,
        total: parsedTotal,
        overrideReason: totalTolerable ? undefined : overrideReason.trim(),
        submittedBy,
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to log CNF goods invoice');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-[200] p-4 overflow-y-auto">
      <Card className="p-6 space-y-4 w-full max-w-3xl my-8">
        <h3 className="text-lg font-semibold">Log CNF Goods Invoice</h3>
        <p className="text-xs text-slate-400">
          CNF's tax invoice for goods received — their price already includes their own service
          markup. Pick every shipment it covers, then which outstanding CNF advances fund it.
        </p>

        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">
            Shipments covered ({selectedShipmentIds.size} selected)
          </label>
          <div className="border rounded-lg max-h-48 overflow-y-auto divide-y">
            {shipmentOptions.length === 0 ? (
              <p className="text-sm text-slate-400 p-3">No paid, uninvoiced shipments found.</p>
            ) : shipmentOptions.map(s => (
              <label key={s.shipmentId} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
                <input type="checkbox" checked={selectedShipmentIds.has(s.shipmentId)} onChange={() => toggleShipment(s.shipmentId)} />
                <span className="font-mono">{s.batchId}</span>
                <span className="text-slate-400">/</span>
                <span className="font-mono">{s.shipmentId}</span>
                <span className="text-slate-400 ml-auto">{s.vendorName} ({s.vendorCode})</span>
              </label>
            ))}
          </div>
        </div>

        {relevantVendorCodes.size > 0 && (
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">
              Match against outstanding CNF advances — expected goods value {fmtInr(expectedGoodsValue)}
            </label>
            <div className="border rounded-lg max-h-40 overflow-y-auto divide-y">
              {availableAdvances.length === 0 ? (
                <p className="text-sm text-slate-400 p-3">No outstanding advances for these vendors.</p>
              ) : availableAdvances.map(a => (
                <div key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <input type="checkbox" checked={selectedAdvances[a.id] !== undefined} onChange={() => toggleAdvance(a)} />
                  <span className="font-mono">{a.id}</span>
                  <span className="text-slate-400">{a.vendorCode} · {a.date.slice(0, 10)}</span>
                  <span className="text-slate-400 ml-auto">balance {fmtInr(a.balance)}</span>
                  {selectedAdvances[a.id] !== undefined && (
                    <input
                      type="number" step="0.01" max={a.balance}
                      value={selectedAdvances[a.id]}
                      onChange={e => setSelectedAdvances(prev => ({ ...prev, [a.id]: e.target.value }))}
                      className="w-28 px-2 py-1 border rounded text-xs text-right"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">CNF Invoice File</label>
          <input ref={fileInputRef} type="file" accept="application/pdf,image/*" onChange={e => handleFileChange(e.target.files?.[0] || null)} />
          {isUploading && <p className="text-xs text-slate-400 mt-1">Uploading…</p>}
          {isExtracting && <p className="text-xs text-slate-400 mt-1">Reading total from file…</p>}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Stated Base Amount</label>
            <input type="number" step="0.01" value={statedBaseAmount} onChange={e => setStatedBaseAmount(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">GST</label>
            <input type="number" step="0.01" value={gst} onChange={e => setGst(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">
              Total {isExtracting ? '(reading from file…)' : '(from file — review before submitting)'}
            </label>
            <input type="number" step="0.01" value={total} onChange={e => setTotal(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-slate-400 block text-xs">Implied Service Charge</span>{fmtInr(impliedServiceCharge)}</div>
          <div><span className="text-slate-400 block text-xs">Residual Liability (what's newly owed)</span><span className="font-bold text-emerald-600">{fmtInr(residualLiability)}</span></div>
        </div>

        {statedBaseAmount && gst && total && !totalTolerable && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 rounded-lg p-3 space-y-2">
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Base ({fmtInr(parsedBase)}) + GST ({fmtInr(parsedGst)}) doesn't match Total ({fmtInr(parsedTotal)}).
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={overrideChecked} onChange={e => setOverrideChecked(e.target.checked)} />
              Override and submit anyway
            </label>
            {overrideChecked && (
              <input
                type="text"
                placeholder="Reason for override (required)"
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? 'Submitting…' : 'Submit'}
          </Button>
        </div>
      </Card>
    </div>
  );
};
