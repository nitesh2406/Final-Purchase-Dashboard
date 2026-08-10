import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { getSessionAuthHeaders } from '../../services/authToken';
import {
  fetchCnfEligibleBatches,
  fetchPurchaseInvoices,
  fetchSettlementRecords,
  fetchCnfLedgerEntries,
  addCnfLedgerEntry,
  fetchCnfCommissionRates,
  fetchIgstRate,
  isBatchFullySettled,
  computeCnfBatchRate,
  createCnfInvoiceBatch,
  fetchCnfInvoiceBatches,
  approveCnfInvoiceBatch,
  rejectCnfInvoiceBatch,
  PurchaseInvoice,
  SettlementRecord
} from '../../services/settlementService';
import { extractInvoiceAmount } from '../../services/geminiService';
import { CnfEligibleBatch, CnfLedgerEntry, CnfCommissionRate, CnfInvoiceBatch } from '../../types';
import { useSubmissionLock } from '../../hooks/useSubmissionLock';

export const CnfAgentAccounting: React.FC = () => {
  const [eligibleBatches, setEligibleBatches] = useState<CnfEligibleBatch[]>([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState<PurchaseInvoice[]>([]);
  const [settlementRecords, setSettlementRecords] = useState<SettlementRecord[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<CnfLedgerEntry[]>([]);
  const [commissionRates, setCommissionRates] = useState<CnfCommissionRate[]>([]);
  const [igstPct, setIgstPct] = useState<number>(5);
  const [invoiceBatches, setInvoiceBatches] = useState<CnfInvoiceBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [isBillModalOpen, setIsBillModalOpen] = useState(false);

  const loadAll = async () => {
    setIsLoading(true);
    const [batches, invoices, settlements, entries, rates, igst, invoiceBatchList] = await Promise.all([
      fetchCnfEligibleBatches(),
      fetchPurchaseInvoices(),
      fetchSettlementRecords(),
      fetchCnfLedgerEntries(),
      fetchCnfCommissionRates(),
      fetchIgstRate(),
      fetchCnfInvoiceBatches()
    ]);
    setEligibleBatches(batches);
    setPurchaseInvoices(invoices);
    setSettlementRecords(settlements);
    setLedgerEntries(entries);
    setCommissionRates(rates);
    setIgstPct(igst);
    setInvoiceBatches(invoiceBatchList);
    setIsLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  // Pending queue: Delivered+settled batches with no CNF entry yet.
  const loggedBatchIds = useMemo(() => new Set(ledgerEntries.map(e => e.batchId)), [ledgerEntries]);

  const pendingBatches = useMemo(() => {
    return eligibleBatches.filter(
      b => !loggedBatchIds.has(b.batch_id) && isBatchFullySettled(b, purchaseInvoices, settlementRecords)
    );
  }, [eligibleBatches, loggedBatchIds, purchaseInvoices, settlementRecords]);

  const unbilledEntries = useMemo(() => ledgerEntries.filter(e => !e.invoiceBatchId), [ledgerEntries]);

  const selectedEntries = useMemo(
    () => unbilledEntries.filter(e => selectedEntryIds.has(e.id)),
    [unbilledEntries, selectedEntryIds]
  );

  const selectedTotalPayable = useMemo(
    () => selectedEntries.reduce((sum, e) => sum + e.totalPayable, 0),
    [selectedEntries]
  );

  const toggleEntrySelection = (id: string) => {
    setSelectedEntryIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const pendingApprovalBatches = useMemo(
    () => invoiceBatches.filter(b => b.status === 'Pending Approval'),
    [invoiceBatches]
  );

  const { withSubmissionGuard: withApprovalGuard } = useSubmissionLock();
  const [rejectReasonDraft, setRejectReasonDraft] = useState<Record<string, string>>({});
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [activeApprovalAction, setActiveApprovalAction] = useState<{ batchId: string; type: 'approve' | 'reject' } | null>(null);

  const handleApprove = (batchId: string) => {
    withApprovalGuard(async () => {
      setActiveApprovalAction({ batchId, type: 'approve' });
      setApprovalError(null);
      try {
        // Phase 6 note: agent-submitted batches are still approved by staff here, using the
        // real logged-in admin's email once this component has access to it (see Task 4).
        await approveCnfInvoiceBatch(batchId, 'internal-admin');
        await loadAll();
      } catch (err: any) {
        setApprovalError(err.message || 'Failed to approve');
      } finally {
        setActiveApprovalAction(null);
      }
    });
  };

  const handleReject = (batchId: string) => {
    const reason = rejectReasonDraft[batchId]?.trim();
    if (!reason) {
      setApprovalError('A rejection reason is required.');
      return;
    }
    withApprovalGuard(async () => {
      setActiveApprovalAction({ batchId, type: 'reject' });
      setApprovalError(null);
      try {
        await rejectCnfInvoiceBatch(batchId, reason);
        setRejectReasonDraft(prev => {
          const next = { ...prev };
          delete next[batchId];
          return next;
        });
        await loadAll();
      } catch (err: any) {
        setApprovalError(err.message || 'Failed to reject');
      } finally {
        setActiveApprovalAction(null);
      }
    });
  };

  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [chargesPctOverride, setChargesPctOverride] = useState<string>('');
  const [shippingAmount, setShippingAmount] = useState<string>('0');

  const selectedBatch = useMemo(
    () => pendingBatches.find(b => b.batch_id === selectedBatchId) || null,
    [pendingBatches, selectedBatchId]
  );

  const invoiceRmbTotal = useMemo(() => {
    if (!selectedBatch) return 0;
    const linkedIds = new Set(selectedBatch.vendor_shipments.map(vs => (vs.invoiceId || '').trim()));
    return purchaseInvoices
      .filter(inv => linkedIds.has((inv.invoiceId || '').trim()))
      .reduce((sum, inv) => sum + (inv.rmb || 0), 0);
  }, [selectedBatch, purchaseInvoices]);

  const rate = useMemo(() => {
    if (!selectedBatch) return 0;
    return computeCnfBatchRate(selectedBatch, settlementRecords);
  }, [selectedBatch, settlementRecords]);

  const selectedCategory = useMemo(
    () => commissionRates.find(r => r.id === categoryId) || null,
    [commissionRates, categoryId]
  );

  const chargesPct = useMemo(() => {
    if (chargesPctOverride !== '') return parseFloat(chargesPctOverride) || 0;
    return selectedCategory ? selectedCategory.ratePct : 0;
  }, [chargesPctOverride, selectedCategory]);

  const goodsValue = invoiceRmbTotal * rate;
  const charges = goodsValue * (chargesPct / 100);
  const shippingAmt = parseFloat(shippingAmount) || 0;
  const taxableAmount = goodsValue + charges + shippingAmt;
  const igst = taxableAmount * (igstPct / 100);
  const total = taxableAmount + igst;
  const totalPayable = total - goodsValue;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!selectedBatch || !selectedCategory || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await addCnfLedgerEntry({
        batchId: selectedBatch.batch_id,
        createdAt: selectedBatch.created_at,
        qty: selectedBatch.qty,
        cartons: selectedBatch.cartons,
        invoiceRmbTotal,
        mode: 'sea',
        edd: selectedBatch.expected_delivery,
        carrier: selectedBatch.carrier,
        waybill: selectedBatch.waybill,
        rate,
        category: selectedCategory.label,
        chargesPct,
        goodsValue,
        charges,
        shippingAmount: shippingAmt,
        taxableAmount,
        igstPct,
        igst,
        total,
        totalPayable
      });
      setIsFormOpen(false);
      setSelectedBatchId('');
      setCategoryId('');
      setChargesPctOverride('');
      setShippingAmount('0');
      await loadAll();
    } catch (err: any) {
      setSubmitError(err.message || 'Failed to log CNF entry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-white">CNF Agent Accounting</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {pendingBatches.length} shipment{pendingBatches.length === 1 ? '' : 's'} eligible and not yet logged
          </p>
        </div>
        <Button onClick={() => { setIsFormOpen(true); setSubmitError(null); }} disabled={pendingBatches.length === 0}>
          Log CNF Entry
        </Button>
      </div>

      {pendingApprovalBatches.length > 0 && (
        <Card className="p-4 space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">
            Pending Approval ({pendingApprovalBatches.length})
          </h3>
          {approvalError && <p className="text-sm text-red-500">{approvalError}</p>}
          {pendingApprovalBatches.map(batch => {
            const isApprovingThis = activeApprovalAction?.batchId === batch.id && activeApprovalAction.type === 'approve';
            const isRejectingThis = activeApprovalAction?.batchId === batch.id && activeApprovalAction.type === 'reject';
            const isBatchBusy = activeApprovalAction !== null;
            return (
              <div key={batch.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">{batch.billNo} — ₹{batch.billedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    <p className="text-xs text-slate-400">
                      {batch.entryIds.length} shipment{batch.entryIds.length === 1 ? '' : 's'} · Submitted by {batch.submittedBy}
                      {batch.overrideReason && <span className="text-amber-500"> · Override: {batch.overrideReason}</span>}
                    </p>
                    {batch.fileUrl && <a href={batch.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-500 underline">View uploaded invoice</a>}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleApprove(batch.id)}
                      disabled={isBatchBusy}
                      className="bg-emerald-600 hover:bg-emerald-700"
                    >
                      {isApprovingThis ? 'Approving…' : 'Approve'}
                    </Button>
                  </div>
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    placeholder="Rejection reason"
                    value={rejectReasonDraft[batch.id] || ''}
                    onChange={e => setRejectReasonDraft(prev => ({ ...prev, [batch.id]: e.target.value }))}
                    disabled={isBatchBusy}
                    className="flex-1 px-3 py-1.5 border rounded-lg text-xs"
                  />
                  <button
                    onClick={() => handleReject(batch.id)}
                    disabled={isBatchBusy}
                    className="text-red-500 hover:text-red-600 text-xs font-bold px-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isRejectingThis ? 'Rejecting…' : 'Reject'}
                  </button>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {isFormOpen && (
        <Card className="p-6 space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Shipment</label>
            <select
              value={selectedBatchId}
              onChange={e => setSelectedBatchId(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value="">-- Select an eligible shipment --</option>
              {pendingBatches.map(b => (
                <option key={b.batch_id} value={b.batch_id}>{b.batch_id}</option>
              ))}
            </select>
          </div>

          {selectedBatch && (
            <>
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div><span className="text-slate-400 block text-xs">Created At</span>{selectedBatch.created_at}</div>
                <div><span className="text-slate-400 block text-xs">EDD</span>{selectedBatch.expected_delivery}</div>
                <div><span className="text-slate-400 block text-xs">Carrier</span>{selectedBatch.carrier}</div>
                <div><span className="text-slate-400 block text-xs">Waybill</span>{selectedBatch.waybill}</div>
                <div><span className="text-slate-400 block text-xs">Invoice (RMB)</span>¥{invoiceRmbTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div><span className="text-slate-400 block text-xs">Rate</span>{rate.toFixed(4)}</div>
                <div><span className="text-slate-400 block text-xs">Goods Value</span>₹{goodsValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Category</label>
                <select
                  value={categoryId}
                  onChange={e => { setCategoryId(e.target.value); setChargesPctOverride(''); }}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">-- Select category --</option>
                  {commissionRates.map(r => (
                    <option key={r.id} value={r.id}>{r.label} ({r.ratePct}%)</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Charges % (override)</label>
                  <input
                    type="number" step="0.01"
                    placeholder={selectedCategory ? String(selectedCategory.ratePct) : '0'}
                    value={chargesPctOverride}
                    onChange={e => setChargesPctOverride(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Shipping Amount</label>
                  <input
                    type="number" step="0.01"
                    value={shippingAmount}
                    onChange={e => setShippingAmount(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 grid grid-cols-3 gap-3 text-sm">
                <div><span className="text-slate-400 block text-xs">Charges</span>₹{charges.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div><span className="text-slate-400 block text-xs">Taxable Amount</span>₹{taxableAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div><span className="text-slate-400 block text-xs">IGST ({igstPct}%)</span>₹{igst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div><span className="text-slate-400 block text-xs">Total</span>₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div className="col-span-2"><span className="text-slate-400 block text-xs">Total Payable</span><span className="font-bold text-emerald-600">₹{totalPayable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
              </div>

              {submitError && <p className="text-sm text-red-500">{submitError}</p>}

              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => { setIsFormOpen(false); setSubmitError(null); }}>Cancel</Button>
                <Button onClick={handleSubmit} disabled={!categoryId || isSubmitting}>
                  {isSubmitting ? 'Logging…' : 'Log Entry'}
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {isBillModalOpen && (
        <GenerateBillModal
          selectedEntries={selectedEntries}
          computedTotal={selectedTotalPayable}
          submittedBy="internal-admin"
          onClose={() => setIsBillModalOpen(false)}
          onSuccess={() => { setIsBillModalOpen(false); setSelectedEntryIds(new Set()); loadAll(); }}
        />
      )}

      {selectedEntryIds.size > 0 && (
        <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg px-4 py-3">
          <span className="text-sm">
            {selectedEntryIds.size} entr{selectedEntryIds.size === 1 ? 'y' : 'ies'} selected — running total ₹{selectedTotalPayable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <Button onClick={() => setIsBillModalOpen(true)}>Generate Bill</Button>
        </div>
      )}

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900 text-slate-500 text-[11px] uppercase tracking-wider border-b">
                <th className="px-4 py-3 w-8"></th>
                <th className="px-4 py-3">Shipment</th>
                <th className="px-4 py-3">Created At</th>
                <th className="px-4 py-3 text-right">Rate</th>
                <th className="px-4 py-3 text-right">Goods Value</th>
                <th className="px-4 py-3 text-right">Total Payable</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : ledgerEntries.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No CNF entries logged yet.</td></tr>
              ) : ledgerEntries.map(entry => (
                <tr key={entry.id}>
                  <td className="px-4 py-3">
                    {!entry.invoiceBatchId && (
                      <input
                        type="checkbox"
                        checked={selectedEntryIds.has(entry.id)}
                        onChange={() => toggleEntrySelection(entry.id)}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono">{entry.batchId}</td>
                  <td className="px-4 py-3">{entry.createdAt}</td>
                  <td className="px-4 py-3 text-right">{entry.rate.toFixed(4)}</td>
                  <td className="px-4 py-3 text-right">₹{entry.goodsValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-right font-semibold">₹{entry.totalPayable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3">{entry.invoiceBatchId ? 'Billed' : 'Unbilled'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export const GenerateBillModal: React.FC<{
  selectedEntries: CnfLedgerEntry[];
  computedTotal: number;
  submittedBy: string;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ selectedEntries, computedTotal, submittedBy, onClose, onSuccess }) => {
  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(new Date().toISOString().split('T')[0]);
  const [billedAmount, setBilledAmount] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
  const [overrideChecked, setOverrideChecked] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileSelectionRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = async (f: File | null) => {
    setError(null);
    setFile(f);
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
            const uploadResp = await fetch('/api/drive/upload-cnf-invoice', { method: 'POST', headers: getSessionAuthHeaders(), body: formData });
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
              setBilledAmount(String(amount));
            } else {
              setError(`Could not read an amount from the file automatically (${rawText}). Enter it manually.`);
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

  const parsedAmount = parseFloat(billedAmount) || 0;
  const withinTolerance = Math.abs(parsedAmount - computedTotal) < 1;
  const canSubmit = billNo.trim() && billedAmount && uploadedFileUrl && (withinTolerance || (overrideChecked && overrideReason.trim()));

  const handleSubmit = async () => {
    if (!canSubmit || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await createCnfInvoiceBatch({
        entryIds: selectedEntries.map(e => e.id),
        billNo: billNo.trim(),
        billDate,
        billedAmount: parsedAmount,
        fileUrl: uploadedFileUrl || undefined,
        overrideReason: withinTolerance ? undefined : overrideReason.trim(),
        submittedBy,
      });
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to create invoice batch');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[200] p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-2xl w-full max-w-lg p-6 space-y-4">
        <h3 className="text-lg font-semibold">Generate Consolidated Bill</h3>
        <p className="text-sm text-slate-500">
          {selectedEntries.length} shipment{selectedEntries.length === 1 ? '' : 's'} — computed total ₹{computedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>

        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Agent Invoice File</label>
          <input ref={fileInputRef} type="file" accept="application/pdf,image/*" onChange={e => handleFileChange(e.target.files?.[0] || null)} />
          {isUploading && <p className="text-xs text-slate-400 mt-1">Uploading…</p>}
          {isExtracting && <p className="text-xs text-slate-400 mt-1">Reading amount from file…</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Bill No</label>
            <input type="text" value={billNo} onChange={e => setBillNo(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Bill Date</label>
            <input type="date" value={billDate} onChange={e => setBillDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">
            Billed Amount {isExtracting ? '(reading from file…)' : '(from file — review before submitting)'}
          </label>
          <input type="number" step="0.01" value={billedAmount} onChange={e => setBilledAmount(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
        </div>

        {billedAmount && !withinTolerance && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 rounded-lg p-3 space-y-2">
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Billed amount ₹{parsedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} doesn't match computed total ₹{computedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.
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
      </div>
    </div>
  );
};
