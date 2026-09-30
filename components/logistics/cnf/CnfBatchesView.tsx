import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { useQueryParam } from '../../../hooks/useQueryParam';
import { callGas, invalidateReadCache } from '../../../services/gasApi';
import {
  fetchPurchaseInvoices,
  fetchSettlementRecords,
  computeBatchSettlementStatus,
  PurchaseInvoice,
  SettlementRecord,
} from '../../../services/settlementService';
import { fetchCnfShipmentValues, fetchCnfDraftInvoices, fetchCnfRateConfig } from '../../../services/cnfService';
import { fetchShippingPartners, fetchBatchShippingPartners, fetchPartnerBills, setBatchShippingPartner } from '../../../services/shippingPartnerService';
import type {
  Batch, CnfCommissionRate, CnfShipmentValue, CnfDraftInvoice,
  ShippingPartner, BatchShippingPartner, PartnerBill,
} from '../../../types';
import { LockClosedIcon } from '../../icons/Icons';
import { CnfDraftInvoiceModal } from './CnfDraftInvoiceModal';
import { computeExpectedCnfCharge, ExpectedCnfCharge } from './expectedCharge';
import { draftStaleness } from './draftInvoice';
import { fmtInr, fmtRmb, fmtIstDate } from './cnfFormat';
import { readViewCache, writeViewCache } from './viewCache';

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
  kreizAirRate: number | null; // KREIZ's air ₹/kg; other partners carry ratePerKg
  drafts: CnfDraftInvoice[];
  igstPct: number;
  partners: ShippingPartner[];
  assignments: BatchShippingPartner[];
  partnerBills: PartnerBill[];
}

// get_batches takes no caller identity (see entry_points.js), so it goes
// direct like the other CNF reads and joins their get_bundle — one fewer
// request in flight. Several at once is what makes Google drop results.
async function loadBatchesPart(): Promise<Pick<LoadedData, 'batches' | 'purchaseInvoices' | 'settlements'>> {
  const batchesRes = await callGas('get_batches', {}, 1);
  if (!batchesRes || batchesRes.status !== 'success') throw new Error((batchesRes && batchesRes.message) || 'Failed to load batches');
  const batches: Batch[] = batchesRes.batches || [];
  // Batches carry a stored payment_status, kept current by the settlement
  // code. Only a batch without one needs the full PurchaseInvoices and
  // SettlementLedger to work it out, so those are fetched only then.
  const needStatus = batches.some(b => !b.payment_status);
  const [purchaseInvoices, settlements] = needStatus
    ? await Promise.all([fetchPurchaseInvoices(), fetchSettlementRecords()])
    : [[] as PurchaseInvoice[], [] as SettlementRecord[]];
  return { batches, purchaseInvoices, settlements };
}

// Shipping partners, which air batch has which, and their bills — for the
// partner column and the partner-bill line under CNF invoiced.
async function loadPartnersPart(): Promise<Pick<LoadedData, 'partners' | 'assignments' | 'partnerBills'>> {
  const [partners, assignments, partnerBills] = await Promise.all([fetchShippingPartners(), fetchBatchShippingPartners(), fetchPartnerBills()]);
  return { partners, assignments, partnerBills };
}

export const CnfBatchesView: React.FC<{ refreshKey: number; onDataChanged: () => void }> = ({ refreshKey, onDataChanged }) => {
  const [mode, setMode] = useQueryParam<'sea' | 'air'>('cnfMode', 'sea');
  const [filter, setFilter] = useState<Filter>('all');
  const [data, setData] = useState<LoadedData | null>(() => readViewCache<LoadedData>('batches') ?? null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [settingPartner, setSettingPartner] = useState<string | null>(null);
  const [partnerError, setPartnerError] = useState<{ batchId: string; message: string } | null>(null);
  const loadSeq = useRef(0);
  const dataRef = useRef(data);

  // The five parts load independently: one failing (e.g. Google dropping the
  // slow get_batches result) no longer discards the others, so a new Settings
  // category still shows up. A failed part keeps its last loaded copy.
  // Only the newest load may update the screen (a Refresh while one is in
  // flight must not be overwritten by the older response).
  const load = async (force: boolean) => {
    const mine = ++loadSeq.current;
    if (force) invalidateReadCache();
    setIsLoading(true);
    setLoadError(null);
    const [batchesR, shipmentsR, ratesR, draftsR, partnersR] = await Promise.allSettled([
      loadBatchesPart(),
      fetchCnfShipmentValues(),
      fetchCnfRateConfig(),
      fetchCnfDraftInvoices(),
      loadPartnersPart(),
    ]);
    if (mine !== loadSeq.current) return;
    const prev = dataRef.current;
    const failed: { label: string; message: string }[] = [];
    const pick = <T,>(r: PromiseSettledResult<T>, label: string, fallback: T | undefined): T | undefined => {
      if (r.status === 'fulfilled') return r.value;
      failed.push({ label, message: (r.reason && r.reason.message) || 'Request failed' });
      return fallback;
    };
    const batchesPart = pick(batchesR, 'batches', prev ? { batches: prev.batches, purchaseInvoices: prev.purchaseInvoices, settlements: prev.settlements } : undefined);
    const shipments = pick(shipmentsR, 'CNF shipment values', prev?.shipments);
    const rates = pick(ratesR, 'CNF settings', prev ? { seaRates: prev.seaRates, kreizAirRate: prev.kreizAirRate ?? null, igstPct: prev.igstPct } : undefined);
    const drafts = pick(draftsR, 'draft invoices', prev?.drafts);
    const partnersPart = pick(partnersR, 'shipping partners', prev ? { partners: prev.partners, assignments: prev.assignments, partnerBills: prev.partnerBills } : undefined);
    if (batchesPart && shipments && rates && drafts && partnersPart) {
      const loaded: LoadedData = { ...batchesPart, shipments, ...rates, drafts, ...partnersPart };
      dataRef.current = loaded;
      writeViewCache('batches', loaded);
      setData(loaded);
    }
    if (failed.length) {
      setLoadError(`Couldn't load ${failed.map(f => f.label).join(', ')}${prev ? ' (showing the last loaded copy)' : ''}: ${failed[0].message}`);
    }
    setIsLoading(false);
  };

  useEffect(() => { load(refreshKey > 0); }, [refreshKey]);

  const changePartner = async (batchId: string, partnerId: string) => {
    if (!partnerId) return;
    setSettingPartner(batchId);
    setPartnerError(null);
    try {
      await setBatchShippingPartner(batchId, partnerId);
      onDataChanged();
    } catch (err: any) {
      setPartnerError({ batchId, message: err.message || 'Failed to set the shipping partner' });
    } finally {
      setSettingPartner(null);
    }
  };

  const rows = useMemo(() => {
    if (!data) return [];
    const shipmentsByBatch = new Map<string, CnfShipmentValue[]>();
    data.shipments.forEach(s => {
      const list = shipmentsByBatch.get(s.batchId) || [];
      list.push(s);
      shipmentsByBatch.set(s.batchId, list);
    });
    const draftsByBatch = new Map(data.drafts.map(d => [d.batchId, d]));
    const assignmentByBatch = new Map(data.assignments.map(a => [a.batchId, a]));
    const liveBillByBatch = new Map(data.partnerBills.filter(pb => pb.status !== 'Rejected').map(pb => [pb.batchId, pb]));
    return data.batches
      .filter(b => b.batch_type === mode)
      .map(b => {
        const linkedInvoiceIds = (b.vendor_shipments || []).map(vs => vs.invoiceId || '');
        const paymentStatus: PaymentStatus = (b.payment_status as PaymentStatus | null | undefined)
          || computeBatchSettlementStatus(linkedInvoiceIds, data.purchaseInvoices, data.settlements).status;
        const batchShipments = shipmentsByBatch.get(b.batch_id) || [];
        const eligible = batchShipments.filter(s => s.eligible);
        const eligibleValue = eligible.reduce((sum, s) => sum + s.paidInr, 0);
        const invoiced = eligible.reduce((sum, s) => sum + s.invoicedInr, 0);
        const invoicedTotal = batchShipments.reduce((sum, s) => sum + (s.invoicedTotalInr || 0), 0);
        const openToInvoice = eligible.some(s => s.remainingInr >= 1);
        const assignment = assignmentByBatch.get(b.batch_id);
        const partnerId = b.batch_type === 'air' ? (assignment?.partnerId || '') : '';
        const partnerShipped = partnerId !== '' && partnerId !== 'KREIZ';
        const partner = partnerShipped ? data.partners.find(p => p.id === partnerId) : undefined;
        const expected: ExpectedCnfCharge = computeExpectedCnfCharge(b, data.seaRates, {
          partnerId, kreizRatePerKg: data.kreizAirRate ?? null,
          partnerRatePerKg: partner?.ratePerKg ?? null, partnerName: partner?.name || assignment?.partnerName,
        });
        // Same test save_cnf_draft_invoice applies on the server.
        const canDraft = b.status === 'Delivered' && batchShipments.length > 0 && batchShipments.every(s => s.eligible);
        const draft = draftsByBatch.get(b.batch_id);
        const stale = draft ? draftStaleness(draft, { goods: eligibleValue, shipmentIds: batchShipments.map(s => s.shipmentId), shippingPartnerId: partnerId }) : null;
        return { batch: b, paymentStatus, eligibleValue, invoiced, invoicedTotal, openToInvoice, expected, canDraft, draft, stale,
          assignment, partnerId, partnerShipped, partnerBill: liveBillByBatch.get(b.batch_id) };
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
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">
            {mode === 'air' ? 'Air' : 'Sea'} Batches ({visibleRows.length})
            {isLoading && data && <span className="ml-2 normal-case tracking-normal font-semibold text-primary-600 animate-pulse" data-testid="cnf-batches-refreshing">Refreshing…</span>}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Expected CNF charge is an estimate from Settings rates. "CNF invoiced" compares CNF's invoice totals (pending and approved) with the batch's saved draft invoice; without a draft it compares goods only.
            {mode === 'air' && ' Air: set each batch\'s shipping partner; a batch shipped by another partner gets no CNF charge (the partner bills its fee on the Ledgers screen).'}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900 text-slate-500 text-[11px] uppercase tracking-wider border-b">
                <th className="px-4 py-3">Batch ID</th>
                <th className="px-4 py-3">Status</th>
                {mode === 'air' && <th className="px-4 py-3">Shipping Partner</th>}
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
                <tr><td colSpan={mode === 'air' ? 10 : 8} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : visibleRows.length === 0 ? (
                <tr><td colSpan={mode === 'air' ? 10 : 8} className="px-4 py-8 text-center text-slate-400">No batches match.</td></tr>
              ) : visibleRows.map(({ batch, paymentStatus, eligibleValue, invoiced, invoicedTotal, expected, canDraft, draft, stale, assignment, partnerId, partnerShipped, partnerBill }) => (
                <tr key={batch.batch_id}>
                  <td className="px-4 py-3 font-mono">{batch.batch_id}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      batch.status === 'Delivered' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400'
                    }`}>{batch.status || 'Open'}</span>
                  </td>
                  {mode === 'air' && (
                    <td className="px-4 py-3">
                      {assignment?.locked ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold" title={`Partner locked: ${assignment.lockReason}`}>
                          <LockClosedIcon className="w-3.5 h-3.5" />{assignment.partnerName}
                        </span>
                      ) : (
                        <select aria-label={`Shipping partner for ${batch.batch_id}`} value={partnerId} disabled={settingPartner !== null}
                          onChange={e => changePartner(batch.batch_id, e.target.value)}
                          className="px-2 py-1 border rounded text-xs bg-white dark:bg-slate-900">
                          <option value="" disabled>— Not set —</option>
                          <option value="KREIZ">KREIZ</option>
                          {data!.partners.filter(p => p.active || p.id === partnerId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      )}
                      {settingPartner === batch.batch_id && <div className="text-[10px] text-slate-400">Saving…</div>}
                      {partnerError?.batchId === batch.batch_id && <div className="text-[10px] text-red-500">{partnerError.message}</div>}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right font-mono">{fmtRmb(batch.total_value_rmb || 0)}</td>
                  <td className="px-4 py-3 text-right font-mono">{batch.paid_amount_inr != null ? fmtInr(batch.paid_amount_inr) : dash}</td>
                  <td className="px-4 py-3 text-right font-mono">{batch.blended_settlement_rate != null ? batch.blended_settlement_rate.toFixed(4) : dash}</td>
                  {mode === 'air' && (
                    <td className="px-4 py-3 text-right font-mono">
                      {(Number(batch.total_weight_kg) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${PAYMENT_BADGE_CLASS[paymentStatus]}`}>{paymentStatus}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="font-mono">{expected.amount != null ? fmtInr(expected.amount) : dash}</div>
                    <div className="text-[10px] text-slate-400">{expected.categoryLabel ? `${expected.categoryLabel} · ` : ''}{expected.note}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {draft ? (
                      <>
                        <div className="font-mono">{fmtInr(invoicedTotal)} of {fmtInr(draft.total)}</div>
                        <div className="text-[10px] text-slate-400">
                          goods {fmtInr(draft.goodsValue)} · charge {fmtInr(draft.charge)} · GST {fmtInr(draft.gst)} · draft by {draft.generatedBy}, {fmtIstDate(draft.generatedAt)}
                        </div>
                        {stale && <div className="text-[10px] font-semibold text-amber-600" data-testid={`draft-stale-${batch.batch_id}`}>{stale}</div>}
                      </>
                    ) : eligibleValue > 0 ? (
                      <>
                        <div className="font-mono">{fmtInr(invoiced)} of {fmtInr(eligibleValue)}</div>
                        <div className="text-[10px] text-slate-400">goods only</div>
                      </>
                    ) : dash}
                    {canDraft && (
                      <button className="mt-1 text-[11px] font-bold text-primary-600 hover:underline" onClick={() => setDraftFor(batch.batch_id)}>
                        {draft ? 'Regenerate' : 'Generate Draft Invoice'}
                      </button>
                    )}
                    {partnerShipped && (
                      <div className="text-[10px] text-slate-500 mt-1" data-testid={`partner-bill-${batch.batch_id}`}>
                        {partnerBill ? `Partner bill ${fmtInr(partnerBill.total)} · ${partnerBill.status}` : 'Partner bill: not billed'}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {draftFor && data && (() => {
        const row = rows.find(r => r.batch.batch_id === draftFor);
        if (!row) return null;
        return (
          <CnfDraftInvoiceModal
            batch={row.batch}
            goodsValue={row.eligibleValue}
            igstPct={data.igstPct}
            seaRates={data.seaRates}
            kreizAirRate={data.kreizAirRate ?? null}
            existing={row.draft}
            partnerShipped={row.partnerShipped}
            partnerName={row.assignment?.partnerName}
            onClose={() => setDraftFor(null)}
            onSaved={() => { setDraftFor(null); onDataChanged(); }}
          />
        );
      })()}
    </div>
  );
};
