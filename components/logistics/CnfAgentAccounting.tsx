import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
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
  PurchaseInvoice,
  SettlementRecord
} from '../../services/settlementService';
import { CnfEligibleBatch, CnfLedgerEntry, CnfCommissionRate } from '../../types';

export const CnfAgentAccounting: React.FC = () => {
  const [eligibleBatches, setEligibleBatches] = useState<CnfEligibleBatch[]>([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState<PurchaseInvoice[]>([]);
  const [settlementRecords, setSettlementRecords] = useState<SettlementRecord[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<CnfLedgerEntry[]>([]);
  const [commissionRates, setCommissionRates] = useState<CnfCommissionRate[]>([]);
  const [igstPct, setIgstPct] = useState<number>(5);
  const [isLoading, setIsLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const loadAll = async () => {
    setIsLoading(true);
    const [batches, invoices, settlements, entries, rates, igst] = await Promise.all([
      fetchCnfEligibleBatches(),
      fetchPurchaseInvoices(),
      fetchSettlementRecords(),
      fetchCnfLedgerEntries(),
      fetchCnfCommissionRates(),
      fetchIgstRate()
    ]);
    setEligibleBatches(batches);
    setPurchaseInvoices(invoices);
    setSettlementRecords(settlements);
    setLedgerEntries(entries);
    setCommissionRates(rates);
    setIgstPct(igst);
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

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900 text-slate-500 text-[11px] uppercase tracking-wider border-b">
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
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : ledgerEntries.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No CNF entries logged yet.</td></tr>
              ) : ledgerEntries.map(entry => (
                <tr key={entry.id}>
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
