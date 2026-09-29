import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { getSessionAuthHeaders } from '../../../services/authToken';
import { extractInvoiceAmount } from '../../../services/geminiService';
import { callGas } from '../../../services/gasApi';
import { logCnfGoodsInvoice, fetchCnfRateConfig } from '../../../services/cnfService';
import type { Batch, CnfShipmentValue } from '../../../types';
import { computeExpectedCnfCharge, ExpectedCnfCharge } from './expectedCharge';
import { computeInvoiceSplit } from './invoiceSplit';
import { fmtInr } from './cnfFormat';

// Same shared Drive uploader the old CNF bill flow used ("CNF Invoices" folder).
const UPLOAD_ENDPOINT = '/api/drive/upload-cnf-invoice';
const today = () => new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd, local

export const LogCnfInvoiceModal: React.FC<{
  shipments: CnfShipmentValue[]; // eligible with value left
  onClose: () => void;
  onSaved: () => void;
}> = ({ shipments, onClose, onSaved }) => {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [cnfInvoiceNo, setCnfInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [baseAmount, setBaseAmount] = useState('');
  const [gst, setGst] = useState('');
  const [total, setTotal] = useState('');
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [ocrNote, setOcrNote] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expectedByBatch, setExpectedByBatch] = useState<Record<string, ExpectedCnfCharge>>({});
  const fileToken = useRef(0);

  // Batch-level expected CNF charge, shown next to the service charge.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [batchesRes, rates] = await Promise.all([callGas('get_batches', {}, 1), fetchCnfRateConfig()]);
        if (cancelled || !batchesRes || batchesRes.status !== 'success') return;
        const map: Record<string, ExpectedCnfCharge> = {};
        (batchesRes.batches as Batch[] || []).forEach(b => { map[b.batch_id] = computeExpectedCnfCharge(b, rates.seaRates, rates.airCategories, rates.partnerDefaults); });
        setExpectedByBatch(map);
      } catch {
        // estimate only — the form works without it
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const byId = useMemo(() => new Map(shipments.map(s => [s.shipmentId, s])), [shipments]);
  const selectedIds = Object.keys(amounts);
  const parsed = (v: string) => parseFloat(v) || 0;
  const lineProblems = selectedIds.filter(id => {
    const a = parsed(amounts[id]);
    const s = byId.get(id);
    return !s || a <= 0 || a > s.remainingInr + 0.01;
  });

  const split = computeInvoiceSplit({
    lineAmounts: selectedIds.map(id => parsed(amounts[id])),
    baseAmount: parsed(baseAmount),
    gst: parsed(gst),
    total: parsed(total),
  });
  const amountsEntered = baseAmount !== '' && gst !== '' && total !== '';
  const selectedBatchIds = Array.from(new Set(selectedIds.map(id => byId.get(id)?.batchId).filter(Boolean))) as string[];

  const canSubmit =
    selectedIds.length > 0 && lineProblems.length === 0 &&
    cnfInvoiceNo.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) && !!fileUrl &&
    parsed(baseAmount) > 0 && gst !== '' && parsed(gst) >= 0 && parsed(total) > 0 &&
    (!split.needsOverride || overrideReason.trim() !== '');

  const toggle = (s: CnfShipmentValue) => {
    setAmounts(prev => {
      const next = { ...prev };
      if (next[s.shipmentId] !== undefined) delete next[s.shipmentId];
      else next[s.shipmentId] = String(s.remainingInr);
      return next;
    });
  };

  const handleFile = async (f: File | null) => {
    setError(null);
    setOcrNote(null);
    setFileUrl(null);
    if (!f) return;
    const token = ++fileToken.current;
    setIsUploading(true);
    const upload = (async () => {
      try {
        const form = new FormData();
        form.append('file', f);
        const resp = await fetch(UPLOAD_ENDPOINT, { method: 'POST', headers: getSessionAuthHeaders(), body: form });
        const data = await resp.json();
        if (token !== fileToken.current) return;
        if (data.success) setFileUrl(data.file.viewUrl);
        else setError(data.error || 'Failed to upload the invoice file');
      } catch (err: any) {
        if (token === fileToken.current) setError(err.message || 'Failed to upload the invoice file');
      } finally {
        if (token === fileToken.current) setIsUploading(false);
      }
    })();
    const ocr = (async () => {
      const { amount, rawText } = await extractInvoiceAmount(f);
      if (token !== fileToken.current) return;
      if (amount !== null) { setTotal(String(amount)); setOcrNote('Total read from the file — check it.'); }
      else setOcrNote(`Couldn't read the total automatically (${rawText}). Enter it by hand.`);
    })();
    await Promise.all([upload, ocr]);
  };

  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await logCnfGoodsInvoice({
        cnfInvoiceNo: cnfInvoiceNo.trim(),
        invoiceDate,
        fileUrl: fileUrl as string,
        lines: selectedIds.map(id => ({ shipmentId: id, amount: parsed(amounts[id]) })),
        baseAmount: parsed(baseAmount),
        gst: parsed(gst),
        total: parsed(total),
        overrideReason: split.needsOverride ? overrideReason.trim() : undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to log the CNF invoice');
    } finally {
      setIsSubmitting(false);
    }
  };

  const label = 'text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5';
  const input = 'w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-900';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-[200] p-4 overflow-y-auto">
      <Card className="p-6 space-y-4 w-full max-w-3xl my-8">
        <h3 className="text-lg font-semibold">Log CNF Invoice</h3>
        <p className="text-xs text-slate-400">
          Tick the shipments CNF's tax invoice covers. Each starts at its full value still to be invoiced; change it if CNF billed only part.
        </p>

        <div>
          <label className={label}>Shipments ({selectedIds.length} selected)</label>
          <div className="border rounded-lg max-h-56 overflow-y-auto divide-y">
            {shipments.length === 0 ? (
              <p className="text-sm text-slate-400 p-3">No delivered, fully paid shipments have value left to invoice.</p>
            ) : shipments.map(s => {
              const checked = amounts[s.shipmentId] !== undefined;
              const bad = checked && lineProblems.includes(s.shipmentId);
              return (
                <div key={s.shipmentId} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <input type="checkbox" aria-label={`Select ${s.shipmentId}`} checked={checked} onChange={() => toggle(s)} />
                  <span className="font-mono">{s.batchId}</span>
                  <span className="text-slate-400">/</span>
                  <span className="font-mono">{s.shipmentId}</span>
                  <span className="text-slate-400">{s.vendorName} ({s.vendorCode})</span>
                  <span className="text-slate-400 ml-auto">left {fmtInr(s.remainingInr)}</span>
                  {checked && (
                    <input
                      type="number" step="0.01" min={0} max={s.remainingInr}
                      aria-label={`Amount for ${s.shipmentId}`}
                      value={amounts[s.shipmentId]}
                      onChange={e => setAmounts(prev => ({ ...prev, [s.shipmentId]: e.target.value }))}
                      className={`w-32 px-2 py-1 border rounded text-xs text-right ${bad ? 'border-red-500' : ''}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {lineProblems.length > 0 && <p className="text-xs text-red-500 mt-1">Each amount must be above zero and no more than what's left on that shipment.</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>CNF Invoice No</label>
            <input aria-label="CNF Invoice No" value={cnfInvoiceNo} onChange={e => setCnfInvoiceNo(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Invoice Date</label>
            <input type="date" aria-label="Invoice Date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className={input} />
          </div>
        </div>

        <div>
          <label className={label}>CNF Invoice File</label>
          <input type="file" aria-label="CNF Invoice File" accept="application/pdf,image/*" onChange={e => handleFile(e.target.files?.[0] || null)} />
          {isUploading && <p className="text-xs text-slate-400 mt-1">Uploading…</p>}
          {fileUrl && !isUploading && <p className="text-xs text-emerald-600 mt-1">File attached.</p>}
          {ocrNote && <p className="text-xs text-slate-400 mt-1">{ocrNote}</p>}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={label}>Base Amount</label>
            <input type="number" step="0.01" aria-label="Base Amount" value={baseAmount} onChange={e => setBaseAmount(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>GST</label>
            <input type="number" step="0.01" aria-label="GST" value={gst} onChange={e => setGst(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Total</label>
            <input type="number" step="0.01" aria-label="Total" value={total} onChange={e => setTotal(e.target.value)} className={input} />
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 grid grid-cols-4 gap-3 text-sm" data-testid="cnf-split">
          <div><span className="text-slate-400 block text-xs">Purchase (goods paid)</span>{fmtInr(split.purchase)}</div>
          <div><span className="text-slate-400 block text-xs">Service charge</span><span className={split.negativeService ? 'text-red-500' : ''}>{fmtInr(split.serviceCharge)}</span></div>
          <div><span className="text-slate-400 block text-xs">GST</span>{fmtInr(parsed(gst))}</div>
          <div><span className="text-slate-400 block text-xs">Total</span>{fmtInr(parsed(total))}</div>
          {selectedBatchIds.length > 0 && (
            <div className="col-span-4 text-xs text-slate-500">
              Expected CNF charge (whole batch, estimate): {selectedBatchIds.map(b => {
                const e = expectedByBatch[b];
                return `${b} ${e && e.amount != null ? fmtInr(e.amount) : '—'}`;
              }).join(' · ')}
            </div>
          )}
        </div>

        {amountsEntered && split.needsOverride && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 rounded-lg p-3 space-y-2">
            {split.totalMismatch && <p className="text-sm text-amber-700 dark:text-amber-400">Base ({fmtInr(parsed(baseAmount))}) + GST ({fmtInr(parsed(gst))}) doesn't match Total ({fmtInr(parsed(total))}).</p>}
            {split.negativeService && <p className="text-sm text-amber-700 dark:text-amber-400">Service charge is negative: CNF billed less than the goods value paid.</p>}
            <input aria-label="Override reason" placeholder="Reason to save anyway (required)" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} className={input} />
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Saving…' : 'Save for approval'}</Button>
        </div>
      </Card>
    </div>
  );
};
