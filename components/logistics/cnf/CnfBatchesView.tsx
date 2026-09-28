import React, { useEffect, useMemo, useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { useQueryParam } from '../../../hooks/useQueryParam';
import { callGasAuthed, invalidateReadCache } from '../../../services/gasApi';
import {
  fetchPurchaseInvoices,
  fetchSettlementRecords,
  fetchCnfCommissionRates,
  fetchCnfAirRateCategories,
  fetchShipmentPartnerDefaults,
  computeBatchSettlementStatus,
  PurchaseInvoice,
  SettlementRecord,
} from '../../../services/settlementService';
import { fetchCnfShipmentValues } from '../../../services/cnfService';
import type { Batch, CnfCommissionRate, CnfAirRateCategory, CnfShipmentPartnerDefault, CnfShipmentValue } from '../../../types';
import { computeExpectedCnfCharge } from './expectedCharge';
import { fmtInr, fmtRmb } from './cnfFormat';

type PaymentStatus = 'Paid' | 'Partial' | 'Unpaid' | 'Not Invoiced';
const PAYMENT_BADGE_CLASS: Record<PaymentStatus, string> = {
  'Paid': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  'Partial': 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  'Unpaid': 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  'Not Invoiced': 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};
type Filter = 'all' | 'deliveredPaid' | 'notFullyInvoiced';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'deliveredPaid', label: 'Delivered & Paid' },
  { key: 'notFullyInvoiced', label: 'Not fully CNF-invoiced' },
];
const dash = <span className="text-slate-300 dark:text-slate-600">—</span>;

interface LoadedData {
  batches: Batch[];
  shipments: CnfShipmentValue[];
  purchaseInvoices: PurchaseInvoice[];
  settlements: SettlementRecord[];
  seaRates: CnfCommissionRate[];
  airCategories: CnfAirRateCategory[];
  partnerDefaults: CnfShipmentPartnerDefault[];
}

export const CnfBatchesView: React.FC<{ refreshKey: number }> = ({ refreshKey }) => {
  const [mode, setMode] = useQueryParam<'sea' | 'air'>('cnfMode', 'sea');
  const [filter, setFilter] = useState<Filter>('all');
  const [data, setData] = useState<LoadedData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async (force: boolean) => {
    if (force) invalidateReadCache();
    setIsLoading(true);
    setLoadError(null);
    try {
      const [batchesRes, shipments, purchaseInvoices, settlements, seaRates, airCategories, partnerDefaults] = await Promise.all([
        callGasAuthed('get_batches', {}, 1),
        fetchCnfShipmentValues(),
        fetchPurchaseInvoices(),
        fetchSettlementRecords(),
        fetchCnfCommissionRates(),
        fetchCnfAirRateCategories(),
        fetchShipmentPartnerDefaults(),
      ]);
      if (!batchesRes || batchesRes.status !== 'success') throw new Error((batchesRes && batchesRes.message) || 'Failed to load batches');
      setData({ batches: batchesRes.batches || [], shipments, purchaseInvoices, settlements, seaRates, airCategories, partnerDefaults });
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load batches');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(refreshKey > 0); }, [refreshKey]);

  const rows = useMemo(() => {
    if (!data) return [];
    const shipmentsByBatch = new Map<string, CnfShipmentValue[]>();
    data.shipments.forEach(s => {
      const list = shipmentsByBatch.get(s.batchId) || [];
      list.push(s);
      shipmentsByBatch.set(s.batchId, list);
    });
    return data.batches
      .filter(b => b.batch_type === mode)
      .map(b => {
        const linkedInvoiceIds = (b.vendor_shipments || []).map(vs => vs.invoiceId || '');
        const paymentStatus: PaymentStatus = (b.payment_status as PaymentStatus | null | undefined)
          || computeBatchSettlementStatus(linkedInvoiceIds, data.purchaseInvoices, data.settlements).status;
        const eligible = (shipmentsByBatch.get(b.batch_id) || []).filter(s => s.eligible);
        const eligibleValue = eligible.reduce((sum, s) => sum + s.paidInr, 0);
        const invoiced = eligible.reduce((sum, s) => sum + s.invoicedInr, 0);
        const openToInvoice = eligible.some(s => s.remainingInr >= 1);
        const expected = computeExpectedCnfCharge(b, data.seaRates, data.airCategories, data.partnerDefaults);
        return { batch: b, paymentStatus, eligibleValue, invoiced, openToInvoice, expected };
      });
  }, [data, mode]);

  const visibleRows = rows.filter(r => {
    if (filter === 'deliveredPaid') return r.batch.status === 'Delivered' && r.paymentStatus === 'Paid';
    if (filter === 'notFullyInvoiced') return r.openToInvoice;
    return true;
  });

  const pillClass = (active: boolean) => `px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
    active ? 'bg-primary-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-gray-200'
  }`;

  return (
    <div className="space-y-4">
      {loadError && (
        <div className="flex items-center justify-between bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-4 py-3">
          <span className="text-sm text-red-600 dark:text-red-400">{loadError}</span>
          <Button variant="secondary" className="text-xs !py-1 !px-2.5" onClick={() => load(true)}>Retry</Button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg gap-1">
          {(['sea', 'air'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} className={`px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${
              mode === m ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}>{m === 'sea' ? 'Sea' : 'Air'}</button>
          ))}
        </div>
        <div className="flex gap-2">
          {FILTERS.map(f => <button key={f.key} onClick={() => setFilter(f.key)} className={pillClass(filter === f.key)}>{f.label}</button>)}
        </div>
      </div>
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">{mode === 'air' ? 'Air' : 'Sea'} Batches ({visibleRows.length})</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Expected CNF charge is an estimate from Settings rates, to sanity-check the service charge on CNF's invoice. "CNF invoiced" counts pending and approved CNF invoices against delivered, fully paid shipments.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900 text-slate-500 text-[11px] uppercase tracking-wider border-b">
                <th className="px-4 py-3">Batch ID</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Value (RMB)</th>
                <th className="px-4 py-3 text-right">Value (INR)</th>
                <th className="px-4 py-3 text-right">ER</th>
                {mode === 'air' && <th className="px-4 py-3 text-right">Weight (kg)</th>}
                <th className="px-4 py-3">Payment Status</th>
                <th className="px-4 py-3 text-right">Expected CNF Charge</th>
                <th className="px-4 py-3 text-right">CNF Invoiced</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading && !data ? (
                <tr><td colSpan={mode === 'air' ? 9 : 8} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : visibleRows.length === 0 ? (
                <tr><td colSpan={mode === 'air' ? 9 : 8} className="px-4 py-8 text-center text-slate-400">No batches match.</td></tr>
              ) : visibleRows.map(({ batch, paymentStatus, eligibleValue, invoiced, expected }) => (
                <tr key={batch.batch_id}>
                  <td className="px-4 py-3 font-mono">{batch.batch_id}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      batch.status === 'Delivered' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400'
                    }`}>{batch.status || 'Open'}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{fmtRmb(batch.total_value_rmb || 0)}</td>
                  <td className="px-4 py-3 text-right font-mono">{batch.paid_amount_inr != null ? fmtInr(batch.paid_amount_inr) : dash}</td>
                  <td className="px-4 py-3 text-right font-mono">{batch.blended_settlement_rate != null ? batch.blended_settlement_rate.toFixed(4) : dash}</td>
                  {mode === 'air' && (
                    <td className="px-4 py-3 text-right font-mono">
                      {batch.total_weight_kg != null ? batch.total_weight_kg.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : dash}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${PAYMENT_BADGE_CLASS[paymentStatus]}`}>{paymentStatus}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="font-mono">{expected.amount != null ? fmtInr(expected.amount) : dash}</div>
                    <div className="text-[10px] text-slate-400">{expected.categoryLabel ? `${expected.categoryLabel} · ` : ''}{expected.note}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {eligibleValue > 0 ? `${fmtInr(invoiced)} of ${fmtInr(eligibleValue)}` : dash}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
