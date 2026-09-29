import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { getSessionAuthHeaders } from '../../../services/authToken';
import { extractInvoiceAmount } from '../../../services/geminiService';
import { callGas } from '../../../services/gasApi';
import { logCnfGoodsInvoice, fetchCnfRateConfig } from '../../../services/cnfService';
import type { Batch, CnfShipmentValue, CnfAncillaryValue } from '../../../types';
import { computeExpectedCnfCharge, ExpectedCnfCharge } from './expectedCharge';
import { computeInvoiceSplit } from './invoiceSplit';
import { fmtInr } from './cnfFormat';

// Same shared Drive uploader the old CNF bill flow used ("CNF Invoices" folder).
const UPLOAD_ENDPOINT = '/api/drive/upload-cnf-invoice';
const today = () => new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd, local
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// One CNF tax invoice: either goods (shipment lines, commission allowed) or
// ancillary (vendor invoices for services paid through CNF: paid INR + GST,
// no commission). The figures are a preview; the backend re-checks all of it.
export const LogCnfInvoiceModal: React.FC<{
  kind: 'Goods' | 'Ancillary';
  shipments: CnfShipmentValue[];   // Goods: eligible with value left
  ancillary: CnfAncillaryValue[];  // Ancillary: eligible with value left
  onClose: () => void;
  onSaved: () => void;
}> = ({ kind, shipments, ancillary, onClose, onSaved }) => {
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
  const [gstPct, setGstPct] = useState<number | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const fileToken = useRef(0);
  const isAnc = kind === 'Ancillary';

  // CNF GST % (both kinds) and, for goods, the batch-level expected CNF charge.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rates = await fetchCnfRateConfig();
        if (cancelled) return;
        setGstPct(rates.igstPct);
        if (isAnc) return;
        const batchesRes = await callGas('get_batches', {}, 1);
        if (cancelled || !batchesRes || batchesRes.status !== 'success') return;
        const map: Record<string, ExpectedCnfCharge> = {};
        (batchesRes.batches as Batch[] || []).forEach(b => { map[b.batch_id] = computeExpectedCnfCharge(b, rates.seaRates, rates.airCategories, rates.partnerDefaults); });
        setExpectedByBatch(map);
      } catch (err: any) {
        if (!cancelled) setRateError(`Couldn't load the CNF GST % (${err.message || err}). Close and try again.`);
      }
    })();
    return () => { cancelled = true; };
  }, [isAnc]);

  // One list for both kinds: key = shipmentId (goods) or vendor invoice (ancillary).
  const items = useMemo(() => isAnc
    ? ancillary.map(a => ({ key: a.invoiceNo, remaining: a.remainingInr, batchId: '', partnerShipped: false,
        title: a.invoiceNo, sub: `${a.vendorName} (${a.vendorCode}) · ${a.notes}` }))
    : shipments.map(s => ({ key: s.shipmentId, remaining: s.remainingInr, batchId: s.batchId,
        partnerShipped: s.batchType === 'air' && !!s.shippingPartnerId && s.shippingPartnerId !== 'KREIZ',
        title: `${s.batchId} / ${s.shipmentId}`, sub: `${s.vendorName} (${s.vendorCode})` })), [isAnc, ancillary, shipments]);
  type Item = typeof items[number];

  const byId = useMemo(() => new Map(items.map(i => [i.key, i])), [items]);
  const selectedIds = Object.keys(amounts);
  const parsed = (v: string) => parseFloat(v) || 0;
  const lineProblems = selectedIds.filter(id => {
    const a = parsed(amounts[id]);
    const i = byId.get(id);
    return !i || a <= 0 || a > i.remaining + 0.01;
  });

  const partnerShippedOnly = !isAnc && selectedIds.length > 0 && selectedIds.every(id => byId.get(id)?.partnerShipped);
  const split = computeInvoiceSplit({
    kind, gstPct: gstPct ?? undefined, partnerShippedOnly,
    lineAmounts: selectedIds.map(id => parsed(amounts[id])),
    baseAmount: parsed(baseAmount),
    gst: parsed(gst),
    total: parsed(total),
  });
  const amountsEntered = baseAmount !== '' && gst !== '' && total !== '';
  const selectedBatchIds = Array.from(new Set(selectedIds.map(id => byId.get(id)?.batchId).filter(Boolean))) as string[];
  const expectedAncGst = round2(split.purchase * (gstPct ?? 0) / 100);

  const canSubmit =
    gstPct !== null &&
    selectedIds.length > 0 && lineProblems.length === 0 &&
    cnfInvoiceNo.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) && !!fileUrl &&
    parsed(baseAmount) > 0 && gst !== '' && parsed(gst) >= 0 && parsed(total) > 0 &&
    (!split.needsOverride || overrideReason.trim() !== '');

  const toggle = (i: Item) => {
    setAmounts(prev => {
      const next = { ...prev };
      if (next[i.key] !== undefined) delete next[i.key];
      else next[i.key] = String(i.remaining);
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
        kind,
        cnfInvoiceNo: cnfInvoiceNo.trim(),
        invoiceDate,
        fileUrl: fileUrl as string,
        lines: selectedIds.map(id => (isAnc ? { invoiceNo: id, amount: parsed(amounts[id]) } : { shipmentId: id, amount: parsed(amounts[id]) })),
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
  const warn = 'text-sm text-amber-700 dark:text-amber-400';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-[200] p-4 overflow-y-auto">
      <Card className="p-6 space-y-4 w-full max-w-3xl my-8">
        <h3 className="text-lg font-semibold">{isAnc ? 'Log CNF Ancillary Invoice' : 'Log CNF Goods Invoice'}</h3>
        <p className="text-xs text-slate-400">
          {isAnc
            ? `Tick the ancillary invoices CNF's tax invoice covers. CNF bills the INR paid + ${gstPct ?? '…'}% GST, with no commission.`
            : "Tick the shipments CNF's tax invoice covers. Each starts at its full value still to be invoiced; change it if CNF billed only part."}
        </p>

        <div>
          <label className={label}>{isAnc ? 'Ancillary invoices' : 'Shipments'} ({selectedIds.length} selected)</label>
          <div className="border rounded-lg max-h-56 overflow-y-auto divide-y">
            {items.length === 0 ? (
              <p className="text-sm text-slate-400 p-3">
                {isAnc ? 'No fully paid ancillary invoices have value left to invoice.' : 'No delivered, fully paid shipments have value left to invoice.'}
              </p>
            ) : items.map(i => {
              const checked = amounts[i.key] !== undefined;
              const bad = checked && lineProblems.includes(i.key);
              return (
                <div key={i.key} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <input type="checkbox" aria-label={`Select ${i.key}`} checked={checked} onChange={() => toggle(i)} />
                  <span className="font-mono">{i.title}</span>
                  <span className="text-slate-400 truncate">{i.sub}</span>
                  <span className="text-slate-400 ml-auto whitespace-nowrap">left {fmtInr(i.remaining)}</span>
                  {checked && (
                    <input
                      type="number" step="0.01" min={0} max={i.remaining}
                      aria-label={`Amount for ${i.key}`}
                      value={amounts[i.key]}
                      onChange={e => setAmounts(prev => ({ ...prev, [i.key]: e.target.value }))}
                      className={`w-32 px-2 py-1 border rounded text-xs text-right ${bad ? 'border-red-500' : ''}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {lineProblems.length > 0 && <p className="text-xs text-red-500 mt-1">Each amount must be above zero and no more than what's left on that {isAnc ? 'invoice' : 'shipment'}.</p>}
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
          <div><span className="text-slate-400 block text-xs">{isAnc ? 'Paid (INR)' : 'Purchase (goods paid)'}</span>{fmtInr(split.purchase)}</div>
          <div><span className="text-slate-400 block text-xs">Service charge</span><span className={split.negativeService || split.ancillaryCharge ? 'text-red-500' : ''}>{fmtInr(split.serviceCharge)}</span></div>
          <div><span className="text-slate-400 block text-xs">GST</span>{fmtInr(parsed(gst))}</div>
          <div><span className="text-slate-400 block text-xs">Total</span>{fmtInr(parsed(total))}</div>
          {isAnc && selectedIds.length > 0 && gstPct !== null && (
            <div className="col-span-4 text-xs text-slate-500">
              Expected: {fmtInr(split.purchase)} + {gstPct}% GST {fmtInr(expectedAncGst)} = {fmtInr(round2(split.purchase + expectedAncGst))}
            </div>
          )}
          {!isAnc && selectedBatchIds.length > 0 && (
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
            {split.totalMismatch && <p className={warn}>Base ({fmtInr(parsed(baseAmount))}) + GST ({fmtInr(parsed(gst))}) doesn't match Total ({fmtInr(parsed(total))}).</p>}
            {split.negativeService && <p className={warn}>Service charge is negative: CNF billed less than the {isAnc ? 'INR paid' : 'goods value paid'}.</p>}
            {split.gstOff && <p className={warn}>GST should be {gstPct}% of the base ({fmtInr(split.expectedGst ?? 0)}); this invoice has {fmtInr(parsed(gst))}.</p>}
            {split.ancillaryCharge && <p className={warn}>CNF charges no commission on ancillary invoices, but the base is {fmtInr(split.serviceCharge)} above the INR paid.</p>}
            {split.partnerCharge && <p className={warn}>These batches were shipped by another partner, so CNF should bill no service charge ({fmtInr(split.serviceCharge)} billed).</p>}
            <input aria-label="Override reason" placeholder="Reason to save anyway (required)" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} className={input} />
          </div>
        )}

        {rateError && <p className="text-sm text-red-500">{rateError}</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || isSubmitting}>{isSubmitting ? 'Saving…' : 'Save for approval'}</Button>
        </div>
      </Card>
    </div>
  );
};
