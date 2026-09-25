import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { getSessionAuthHeaders } from '../../services/authToken';
import { useQueryParam } from '../../hooks/useQueryParam';
import { ListBulletIcon, DocumentTextIcon, ArrowPathIcon } from '../icons/Icons';
import {
  fetchCnfEligibleBatches,
  fetchPurchaseInvoices,
  fetchSettlementRecords,
  fetchCnfLedgerEntries,
  addCnfLedgerEntry,
  fetchCnfCommissionRates,
  fetchCnfAirRateCategories,
  fetchShipmentPartners,
  fetchShipmentPartnerDefaults,
  fetchIgstRate,
  computeCnfBatchRate,
  computeBatchSettlementStatus,
  createCnfInvoiceBatch,
  fetchCnfInvoiceBatches,
  approveCnfInvoiceBatch,
  rejectCnfInvoiceBatch,
  requestCnfBill,
  PurchaseInvoice,
  SettlementRecord
} from '../../services/settlementService';
import { extractInvoiceAmount } from '../../services/geminiService';
import { CnfEligibleBatch, CnfLedgerEntry, CnfCommissionRate, CnfAirRateCategory, CnfShipmentPartnerDefault, CnfInvoiceBatch, Batch } from '../../types';
import { useSubmissionLock } from '../../hooks/useSubmissionLock';
import { callGasAuthed } from '../../services/gasApi';

type CnfTab = 'overview' | 'reconciliation';

// Derived (never stored) bill lifecycle for a batch's CNF ledger entry.
type CnfLifecycle = 'Not Logged' | 'Logged' | 'Bill Requested' | 'Bill Received' | 'Approved';

function cnfLifecycle(entry: CnfLedgerEntry | null, invoiceBatchById: Map<string, CnfInvoiceBatch>): CnfLifecycle {
  if (!entry) return 'Not Logged';
  if (!entry.invoiceBatchId) return entry.billRequestedAt ? 'Bill Requested' : 'Logged';
  const invBatch = invoiceBatchById.get(entry.invoiceBatchId);
  return invBatch?.status === 'Approved' ? 'Approved' : 'Bill Received';
}

const LIFECYCLE_BADGE_CLASS: Record<CnfLifecycle, string> = {
  'Not Logged': 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 italic',
  'Logged': 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  'Bill Requested': 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  'Bill Received': 'bg-purple-100 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400',
  'Approved': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
};

type PaymentStatus = 'Paid' | 'Partial' | 'Unpaid' | 'Not Invoiced';

const PAYMENT_BADGE_CLASS: Record<PaymentStatus, string> = {
  'Paid': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  'Partial': 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  'Unpaid': 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  'Not Invoiced': 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

const fmtInr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtRmb = (n: number) => `¥${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Module-level cache (same pattern as ShipmentTracker.tsx's batchListCache /
// ReceiveShipment.tsx's batchListCache) — survives this component unmounting
// when the user switches sidebar tabs and back, so returning to this screen
// doesn't re-run all 8 loadAll() round trips against Apps Script every time.
// Only a forced refresh (post-write, the Retry banner, or the Refresh button)
// bypasses it.
let cnfDataCache: {
  eligibleBatches: CnfEligibleBatch[];
  allBatches: Batch[];
  purchaseInvoices: PurchaseInvoice[];
  settlementRecords: SettlementRecord[];
  ledgerEntries: CnfLedgerEntry[];
  commissionRates: CnfCommissionRate[];
  airCategories: CnfAirRateCategory[];
  shipmentPartners: string[];
  partnerDefaults: CnfShipmentPartnerDefault[];
  igstPct: number;
  invoiceBatches: CnfInvoiceBatch[];
  timestamp: number;
} | null = null;

export const CnfAgentAccounting: React.FC = () => {
  const [activeTab, setActiveTab] = useQueryParam<CnfTab>('cnfTab', 'overview');

  const [eligibleBatches, setEligibleBatches] = useState<CnfEligibleBatch[]>(cnfDataCache?.eligibleBatches || []);
  const [allBatches, setAllBatches] = useState<Batch[]>(cnfDataCache?.allBatches || []);
  const [purchaseInvoices, setPurchaseInvoices] = useState<PurchaseInvoice[]>(cnfDataCache?.purchaseInvoices || []);
  const [settlementRecords, setSettlementRecords] = useState<SettlementRecord[]>(cnfDataCache?.settlementRecords || []);
  const [ledgerEntries, setLedgerEntries] = useState<CnfLedgerEntry[]>(cnfDataCache?.ledgerEntries || []);
  const [commissionRates, setCommissionRates] = useState<CnfCommissionRate[]>(cnfDataCache?.commissionRates || []);
  const [airCategories, setAirCategories] = useState<CnfAirRateCategory[]>(cnfDataCache?.airCategories || []);
  const [shipmentPartners, setShipmentPartners] = useState<string[]>(cnfDataCache?.shipmentPartners || []);
  const [partnerDefaults, setPartnerDefaults] = useState<CnfShipmentPartnerDefault[]>(cnfDataCache?.partnerDefaults || []);
  const [igstPct, setIgstPct] = useState<number>(cnfDataCache?.igstPct ?? 5);
  const [invoiceBatches, setInvoiceBatches] = useState<CnfInvoiceBatch[]>(cnfDataCache?.invoiceBatches || []);
  const [isLoading, setIsLoading] = useState(!cnfDataCache);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [isBillModalOpen, setIsBillModalOpen] = useState(false);
  const [overviewFilter, setOverviewFilter] = useState<'all' | 'unbilled' | 'paidDelivered'>('all');
  const [overviewMode, setOverviewMode] = useQueryParam<'sea' | 'air'>('cnfMode', 'sea');

  const loadAll = async (forceRefresh = false) => {
    if (!forceRefresh && cnfDataCache) {
      setEligibleBatches(cnfDataCache.eligibleBatches);
      setAllBatches(cnfDataCache.allBatches);
      setPurchaseInvoices(cnfDataCache.purchaseInvoices);
      setSettlementRecords(cnfDataCache.settlementRecords);
      setLedgerEntries(cnfDataCache.ledgerEntries);
      setCommissionRates(cnfDataCache.commissionRates);
      setAirCategories(cnfDataCache.airCategories);
      setShipmentPartners(cnfDataCache.shipmentPartners);
      setPartnerDefaults(cnfDataCache.partnerDefaults);
      setIgstPct(cnfDataCache.igstPct);
      setInvoiceBatches(cnfDataCache.invoiceBatches);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const [batches, batchesResult, invoices, settlements, entries, rates, airRates, partners, partnerDefaultsList, igst, invoiceBatchList] = await Promise.all([
        fetchCnfEligibleBatches(),
        callGasAuthed('get_batches', {}, 1),
        fetchPurchaseInvoices(),
        fetchSettlementRecords(),
        fetchCnfLedgerEntries(),
        fetchCnfCommissionRates(),
        fetchCnfAirRateCategories(),
        fetchShipmentPartners(),
        fetchShipmentPartnerDefaults(),
        fetchIgstRate(),
        fetchCnfInvoiceBatches()
      ]);
      // get_batches already returns paid_amount_inr/blended_settlement_rate
      // straight off the Batches sheet (see accounting_logger.js's
      // syncBatchSettlementAggregate_) — no join/recompute needed here.
      const resolvedAllBatches = batchesResult.status === 'success' ? (batchesResult.batches || []) : [];
      setEligibleBatches(batches);
      setAllBatches(resolvedAllBatches);
      setPurchaseInvoices(invoices);
      setSettlementRecords(settlements);
      setLedgerEntries(entries);
      setCommissionRates(rates);
      setAirCategories(airRates);
      setShipmentPartners(partners);
      setPartnerDefaults(partnerDefaultsList);
      setIgstPct(igst);
      setInvoiceBatches(invoiceBatchList);
      cnfDataCache = {
        eligibleBatches: batches,
        allBatches: resolvedAllBatches,
        purchaseInvoices: invoices,
        settlementRecords: settlements,
        ledgerEntries: entries,
        commissionRates: rates,
        airCategories: airRates,
        shipmentPartners: partners,
        partnerDefaults: partnerDefaultsList,
        igstPct: igst,
        invoiceBatches: invoiceBatchList,
        timestamp: Date.now()
      };
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load CNF Agent data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  // Batch overview: every batch, joined against its CNF ledger entry (if
  // logged). RMB value comes straight from get_batches (total_value_rmb); the
  // INR value and ER are pre-computed server-side at vendor-settlement time
  // (paid_amount_inr / blended_settlement_rate), never recomputed here.
  const ledgerEntryByBatchId = useMemo(() => {
    const map = new Map<string, CnfLedgerEntry>();
    ledgerEntries.forEach(e => map.set(e.batchId, e));
    return map;
  }, [ledgerEntries]);

  const invoiceBatchById = useMemo(() => {
    const map = new Map<string, CnfInvoiceBatch>();
    invoiceBatches.forEach(b => map.set(b.id, b));
    return map;
  }, [invoiceBatches]);

  // Payment Status is persisted server-side at settlement time (see
  // syncBatchSettlementAggregate_ in accounting_logger.js) — this falls back
  // to the live computeBatchSettlementStatus join only for a batch that
  // hasn't synced yet (payment_status still null, e.g. before the one-time
  // backfill has run), so correctness never depends on backfill timing.
  const resolvePaymentStatus = (
    persisted: PaymentStatus | null | undefined,
    linkedInvoiceIds: string[]
  ): PaymentStatus => {
    if (persisted) return persisted;
    return computeBatchSettlementStatus(linkedInvoiceIds, purchaseInvoices, settlementRecords).status;
  };

  // Pending queue: Delivered+settled batches with no CNF entry yet. Also used
  // to gate the per-row "Log Entry" action on Tab 1.
  const loggedBatchIds = useMemo(() => new Set(ledgerEntries.map(e => e.batchId)), [ledgerEntries]);

  const pendingBatches = useMemo(() => {
    return eligibleBatches.filter(b => {
      if (loggedBatchIds.has(b.batch_id)) return false;
      const linkedInvoiceIds = b.vendor_shipments.map(vs => vs.invoiceId || '');
      return resolvePaymentStatus(b.payment_status, linkedInvoiceIds) === 'Paid';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleBatches, loggedBatchIds, purchaseInvoices, settlementRecords]);

  const pendingBatchIds = useMemo(() => new Set(pendingBatches.map(b => b.batch_id)), [pendingBatches]);

  const batchOverviewRows = useMemo(() => {
    return allBatches.map(b => {
      const linkedInvoiceIds = (b.vendor_shipments || []).map(vs => vs.invoiceId || '');
      const paymentStatus = resolvePaymentStatus(b.payment_status, linkedInvoiceIds);
      const ledgerEntry = ledgerEntryByBatchId.get(b.batch_id) || null;
      return {
        batch: b,
        ledgerEntry,
        paymentStatus,
        lifecycle: cnfLifecycle(ledgerEntry, invoiceBatchById),
        canLog: !ledgerEntry && pendingBatchIds.has(b.batch_id),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allBatches, ledgerEntryByBatchId, purchaseInvoices, settlementRecords, invoiceBatchById, pendingBatchIds]);

  // Sea/Air sub-tabs — Sea keeps today's table/form/formula untouched; Air
  // gets its own Weight (kg) column (see design doc) on top of the same base
  // columns. Scoped before the quick filters below so "All"/"Unbilled"/
  // "Paid & Delivered" always operate within the selected mode's batches.
  const modeScopedRows = useMemo(
    () => batchOverviewRows.filter(r => r.batch.batch_type === overviewMode),
    [batchOverviewRows, overviewMode]
  );

  // Quick filters above the Batch Overview table. "Unbilled" = no CNF ledger
  // entry logged yet (lifecycle 'Not Logged'); "Paid & Delivered" = Delivered
  // batches whose payment status resolves to Paid, regardless of log state.
  const filteredOverviewRows = useMemo(() => {
    if (overviewFilter === 'unbilled') return modeScopedRows.filter(r => r.lifecycle === 'Not Logged');
    if (overviewFilter === 'paidDelivered') return modeScopedRows.filter(r => r.batch.status === 'Delivered' && r.paymentStatus === 'Paid');
    return modeScopedRows;
  }, [modeScopedRows, overviewFilter]);

  // Reconciliation funnel (Tab 2) — three mutually exclusive buckets derived
  // from billRequestedAt / invoiceBatchId, plus a combined "pending" view.
  const eligibleEntries = useMemo(() => ledgerEntries.filter(e => !e.billRequestedAt && !e.invoiceBatchId), [ledgerEntries]);
  const generatedEntries = useMemo(() => ledgerEntries.filter(e => e.billRequestedAt && !e.invoiceBatchId), [ledgerEntries]);
  const receivedEntries = useMemo(() => ledgerEntries.filter(e => !!e.invoiceBatchId), [ledgerEntries]);
  const sumPayable = (list: CnfLedgerEntry[]) => list.reduce((sum, e) => sum + e.totalPayable, 0);
  const totalPendingCount = eligibleEntries.length + generatedEntries.length;
  const totalPendingValue = sumPayable(eligibleEntries) + sumPayable(generatedEntries);

  // Entries visible in Tab 2's table — anything past "Logged" (i.e. a bill
  // has at least been requested). Checkbox selection (for Generate Bill) is
  // further scoped to "Bill Generated" only, since a bill can't be uploaded
  // before it's been requested.
  const postRequestEntries = useMemo(() => ledgerEntries.filter(e => !!e.billRequestedAt), [ledgerEntries]);

  const selectedEntries = useMemo(
    () => generatedEntries.filter(e => selectedEntryIds.has(e.id)),
    [generatedEntries, selectedEntryIds]
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
        await loadAll(true);
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
        await loadAll(true);
      } catch (err: any) {
        setApprovalError(err.message || 'Failed to reject');
      } finally {
        setActiveApprovalAction(null);
      }
    });
  };

  const [requestingBillFor, setRequestingBillFor] = useState<string | null>(null);
  const [requestBillError, setRequestBillError] = useState<string | null>(null);

  const handleRequestBill = async (entryId: string) => {
    setRequestingBillFor(entryId);
    setRequestBillError(null);
    try {
      await requestCnfBill(entryId, 'internal-admin');
      await loadAll(true);
    } catch (err: any) {
      setRequestBillError(err.message || 'Failed to request bill');
    } finally {
      setRequestingBillFor(null);
    }
  };

  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [chargesPctOverride, setChargesPctOverride] = useState<string>('');
  const [shippingAmount, setShippingAmount] = useState<string>('0');
  // Air-only fields — see docs/superpowers/specs/2026-09-24-cnf-air-shipment-recon-design.md.
  const [shipmentPartner, setShipmentPartner] = useState<string>('');
  const [weightKgOverride, setWeightKgOverride] = useState<string>('');
  const [ratePerKgOverride, setRatePerKgOverride] = useState<string>('');

  const resetLogEntryForm = () => {
    setSelectedBatchId('');
    setCategoryId('');
    setChargesPctOverride('');
    setShippingAmount('0');
    setShipmentPartner('');
    setWeightKgOverride('');
    setRatePerKgOverride('');
  };

  const selectedBatch = useMemo(
    () => pendingBatches.find(b => b.batch_id === selectedBatchId) || null,
    [pendingBatches, selectedBatchId]
  );
  const isAirEntry = selectedBatch?.batch_type === 'air';

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

  // Sea's %-based categories and Air's ₹/kg categories are separate tables
  // (see design doc) — categoryId is shared UI state, but which list it's
  // resolved against depends on the selected batch's mode.
  const selectedSeaCategory = useMemo(
    () => commissionRates.find(r => r.id === categoryId) || null,
    [commissionRates, categoryId]
  );
  const selectedAirCategory = useMemo(
    () => airCategories.find(c => c.id === categoryId) || null,
    [airCategories, categoryId]
  );

  const chargesPct = useMemo(() => {
    if (chargesPctOverride !== '') return parseFloat(chargesPctOverride) || 0;
    return selectedSeaCategory ? selectedSeaCategory.ratePct : 0;
  }, [chargesPctOverride, selectedSeaCategory]);

  // Weight defaults from the batch's synced total_weight_kg (see
  // syncBatchWeightAggregate_) but stays editable — same override pattern
  // as chargesPct above.
  const weightKg = useMemo(() => {
    if (weightKgOverride !== '') return parseFloat(weightKgOverride) || 0;
    return selectedBatch?.total_weight_kg || 0;
  }, [weightKgOverride, selectedBatch]);

  const ratePerKg = useMemo(() => {
    if (ratePerKgOverride !== '') return parseFloat(ratePerKgOverride) || 0;
    return selectedAirCategory ? selectedAirCategory.ratePerKg : 0;
  }, [ratePerKgOverride, selectedAirCategory]);

  const goodsValue = invoiceRmbTotal * rate;
  const charges = isAirEntry ? weightKg * ratePerKg : goodsValue * (chargesPct / 100);
  const shippingAmt = parseFloat(shippingAmount) || 0;
  const taxableAmount = goodsValue + charges + shippingAmt;
  const igst = taxableAmount * (igstPct / 100);
  const total = taxableAmount + igst;
  const totalPayable = total - goodsValue;

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const openLogEntryForm = (batchId: string) => {
    setActiveTab('overview');
    setSelectedBatchId(batchId);
    setIsFormOpen(true);
    setSubmitError(null);
  };

  // Picking a Shipment Partner pre-fills its configured default Category
  // (on top of that Category pre-filling its own rate) — only when the
  // partner actually has one configured (Settings > Shipment Partner
  // Defaults), and only overwrites a category the user hasn't already
  // picked by hand for this same partner selection.
  const handleSelectShipmentPartner = (partner: string) => {
    setShipmentPartner(partner);
    const defaultCategoryId = partnerDefaults.find(d => d.partner === partner)?.defaultCategoryId;
    if (defaultCategoryId) {
      setCategoryId(defaultCategoryId);
      setRatePerKgOverride('');
    }
  };

  const handleSubmit = async () => {
    const selectedCategory = isAirEntry ? selectedAirCategory : selectedSeaCategory;
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
        mode: selectedBatch.batch_type,
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
        totalPayable,
        rateBasis: isAirEntry ? 'perKg' : 'pct',
        ...(isAirEntry ? { shipmentPartner, weightKg, ratePerKg } : {})
      });
      setIsFormOpen(false);
      resetLogEntryForm();
      await loadAll(true);
    } catch (err: any) {
      setSubmitError(err.message || 'Failed to log CNF entry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const tabButtonClass = (tab: CnfTab) =>
    `flex-1 md:flex-initial min-w-[200px] px-5 py-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2.5 ${
      activeTab === tab
        ? 'bg-primary-600 text-white shadow-md font-black'
        : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800/40'
    }`;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-white">CNF Agent Accounting</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {pendingBatches.length} shipment{pendingBatches.length === 1 ? '' : 's'} eligible and not yet logged
          </p>
          {cnfDataCache && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 italic mt-0.5">
              Last synced: {new Date(cnfDataCache.timestamp).toLocaleTimeString()}
            </p>
          )}
        </div>
        <Button
          variant="secondary"
          onClick={() => loadAll(true)}
          disabled={isLoading}
          icon={<ArrowPathIcon className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />}
        >
          Refresh Data
        </Button>
      </div>

      {loadError && (
        <div className="flex items-center justify-between bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-4 py-3">
          <span className="text-sm text-red-600 dark:text-red-400">{loadError}</span>
          <Button variant="secondary" className="text-xs !py-1 !px-2.5" onClick={() => loadAll(true)}>Retry</Button>
        </div>
      )}

      <div className="flex border-b border-gray-200 dark:border-gray-750 bg-slate-100/50 dark:bg-slate-900/50 p-1.5 rounded-xl gap-1 max-w-full overflow-x-auto shadow-sm">
        <button onClick={() => setActiveTab('overview')} className={tabButtonClass('overview')}>
          <ListBulletIcon className="w-4 h-4" />
          <span>Batch Overview</span>
        </button>
        <button onClick={() => setActiveTab('reconciliation')} className={tabButtonClass('reconciliation')}>
          <DocumentTextIcon className="w-4 h-4" />
          <span>Bill Reconciliation</span>
          {(eligibleEntries.length + generatedEntries.length) > 0 && (
            <span className={`px-2 py-0.5 text-[10px] font-black font-mono rounded-full ${
              activeTab === 'reconciliation' ? 'bg-primary-700 text-white' : 'bg-gray-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
            }`}>
              {eligibleEntries.length + generatedEntries.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-lg">
              {([
                { key: 'sea', label: 'Sea' },
                { key: 'air', label: 'Air' },
              ] as const).map(m => (
                <button
                  key={m.key}
                  onClick={() => setOverviewMode(m.key)}
                  className={`px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${
                    overviewMode === m.key
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              {([
                { key: 'all', label: 'All' },
                { key: 'unbilled', label: 'Unbilled' },
                { key: 'paidDelivered', label: 'Paid & Delivered' },
              ] as const).map(f => (
                <button
                  key={f.key}
                  onClick={() => setOverviewFilter(f.key)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                    overviewFilter === f.key
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-gray-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">
                {overviewMode === 'air' ? 'Air' : 'Sea'} Shipments ({filteredOverviewRows.length})
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                INR value and ER are only ever synced when a vendor payment settles — never recalculated on load.
              </p>
            </div>
            {requestBillError && <p className="text-sm text-red-500 px-4 pt-3">{requestBillError}</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900 text-slate-500 text-[11px] uppercase tracking-wider border-b">
                    <th className="px-4 py-3">Batch ID</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Value (RMB)</th>
                    <th className="px-4 py-3 text-right">Value (INR)</th>
                    <th className="px-4 py-3 text-right">ER</th>
                    {overviewMode === 'air' && <th className="px-4 py-3 text-right">Weight (kg)</th>}
                    <th className="px-4 py-3">Payment Status</th>
                    <th className="px-4 py-3">CNF Category</th>
                    <th className="px-4 py-3 text-right">CNF Total Payable</th>
                    <th className="px-4 py-3">Bill Status</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    <tr><td colSpan={overviewMode === 'air' ? 11 : 10} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
                  ) : filteredOverviewRows.length === 0 ? (
                    <tr><td colSpan={overviewMode === 'air' ? 11 : 10} className="px-4 py-8 text-center text-slate-400">No shipments found.</td></tr>
                  ) : filteredOverviewRows.map(({ batch, ledgerEntry, paymentStatus, lifecycle, canLog }) => (
                    <tr key={batch.batch_id}>
                      <td className="px-4 py-3 font-mono">{batch.batch_id}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          batch.status === 'Delivered'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                        }`}>
                          {batch.status === 'Delivered' ? 'Delivered' : 'Open'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{fmtRmb(batch.total_value_rmb || 0)}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {batch.paid_amount_inr != null ? fmtInr(batch.paid_amount_inr) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {batch.blended_settlement_rate != null ? batch.blended_settlement_rate.toFixed(4) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                      {overviewMode === 'air' && (
                        <td className="px-4 py-3 text-right font-mono">
                          {batch.total_weight_kg != null ? batch.total_weight_kg.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${PAYMENT_BADGE_CLASS[paymentStatus]}`}>
                          {paymentStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3">{ledgerEntry?.category || <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {ledgerEntry ? fmtInr(ledgerEntry.totalPayable) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${LIFECYCLE_BADGE_CLASS[lifecycle]}`}>
                          {lifecycle}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {canLog && (
                          <Button variant="secondary" className="text-xs !py-1 !px-2.5" onClick={() => openLogEntryForm(batch.batch_id)}>
                            Log Entry
                          </Button>
                        )}
                        {ledgerEntry && !ledgerEntry.billRequestedAt && (
                          <Button
                            variant="secondary"
                            className="text-xs !py-1 !px-2.5"
                            disabled={requestingBillFor === ledgerEntry.id}
                            onClick={() => handleRequestBill(ledgerEntry.id)}
                          >
                            {requestingBillFor === ledgerEntry.id ? 'Requesting…' : 'Request Bill'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {isFormOpen && (
            <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-[200] p-4 overflow-y-auto">
            <Card className="p-6 space-y-4 w-full max-w-2xl my-8">
              <h3 className="text-lg font-semibold">Log CNF Entry</h3>
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Shipment</label>
                <select
                  value={selectedBatchId}
                  onChange={e => setSelectedBatchId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">-- Select an eligible shipment --</option>
                  {pendingBatches.map(b => (
                    <option key={b.batch_id} value={b.batch_id}>{b.batch_id} ({b.batch_type.toUpperCase()})</option>
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
                    <div><span className="text-slate-400 block text-xs">Invoice (RMB)</span>{fmtRmb(invoiceRmbTotal)}</div>
                    <div><span className="text-slate-400 block text-xs">Rate</span>{rate.toFixed(4)}</div>
                    <div><span className="text-slate-400 block text-xs">Goods Value</span>{fmtInr(goodsValue)}</div>
                  </div>

                  {isAirEntry && (
                    <div>
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Shipment Partner</label>
                      <select
                        value={shipmentPartner}
                        onChange={e => handleSelectShipmentPartner(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      >
                        <option value="">-- Select shipment partner --</option>
                        {shipmentPartners.map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Category</label>
                    <select
                      value={categoryId}
                      onChange={e => { setCategoryId(e.target.value); setChargesPctOverride(''); setRatePerKgOverride(''); }}
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                    >
                      <option value="">-- Select category --</option>
                      {isAirEntry
                        ? airCategories.map(c => (
                            <option key={c.id} value={c.id}>{c.label} (₹{c.ratePerKg}/kg)</option>
                          ))
                        : commissionRates.map(r => (
                            <option key={r.id} value={r.id}>{r.label} ({r.ratePct}%)</option>
                          ))}
                    </select>
                  </div>

                  {isAirEntry ? (
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Weight (kg, override)</label>
                        <input
                          type="number" step="0.01"
                          placeholder={selectedBatch.total_weight_kg != null ? String(selectedBatch.total_weight_kg) : '0'}
                          value={weightKgOverride}
                          onChange={e => setWeightKgOverride(e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Rate ₹/kg (override)</label>
                        <input
                          type="number" step="0.01"
                          placeholder={selectedAirCategory ? String(selectedAirCategory.ratePerKg) : '0'}
                          value={ratePerKgOverride}
                          onChange={e => setRatePerKgOverride(e.target.value)}
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
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Charges % (override)</label>
                        <input
                          type="number" step="0.01"
                          placeholder={selectedSeaCategory ? String(selectedSeaCategory.ratePct) : '0'}
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
                  )}

                  <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 grid grid-cols-3 gap-3 text-sm">
                    <div><span className="text-slate-400 block text-xs">Charges</span>{fmtInr(charges)}</div>
                    <div><span className="text-slate-400 block text-xs">Taxable Amount</span>{fmtInr(taxableAmount)}</div>
                    <div><span className="text-slate-400 block text-xs">IGST ({igstPct}%)</span>{fmtInr(igst)}</div>
                    <div><span className="text-slate-400 block text-xs">Total</span>{fmtInr(total)}</div>
                    <div className="col-span-2"><span className="text-slate-400 block text-xs">Total Payable</span><span className="font-bold text-emerald-600">{fmtInr(totalPayable)}</span></div>
                  </div>

                  {submitError && <p className="text-sm text-red-500">{submitError}</p>}

                  <div className="flex gap-3">
                    <Button variant="secondary" onClick={() => { setIsFormOpen(false); resetLogEntryForm(); setSubmitError(null); }}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={!categoryId || isSubmitting}>
                      {isSubmitting ? 'Logging…' : 'Log Entry'}
                    </Button>
                  </div>
                </>
              )}
            </Card>
            </div>
          )}
        </div>
      )}

      {activeTab === 'reconciliation' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Total Pending</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{totalPendingCount}</p>
              <p className="text-sm text-slate-500 mt-1">{fmtInr(totalPendingValue)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Eligible</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{eligibleEntries.length}</p>
              <p className="text-sm text-slate-500 mt-1">{fmtInr(sumPayable(eligibleEntries))}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Bill Generated</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{generatedEntries.length}</p>
              <p className="text-sm text-slate-500 mt-1">{fmtInr(sumPayable(generatedEntries))}</p>
            </Card>
            <Card className="p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Bill Received</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{receivedEntries.length}</p>
              <p className="text-sm text-slate-500 mt-1">{fmtInr(sumPayable(receivedEntries))}</p>
            </Card>
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
                        <p className="font-semibold">{batch.billNo} — {fmtInr(batch.billedAmount)}</p>
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

          {isBillModalOpen && (
            <GenerateBillModal
              selectedEntries={selectedEntries}
              computedTotal={selectedTotalPayable}
              submittedBy="internal-admin"
              onClose={() => setIsBillModalOpen(false)}
              onSuccess={() => { setIsBillModalOpen(false); setSelectedEntryIds(new Set()); loadAll(true); }}
            />
          )}

          {selectedEntryIds.size > 0 && (
            <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg px-4 py-3">
              <span className="text-sm">
                {selectedEntryIds.size} entr{selectedEntryIds.size === 1 ? 'y' : 'ies'} selected — running total {fmtInr(selectedTotalPayable)}
              </span>
              <Button onClick={() => setIsBillModalOpen(true)}>Generate Bill</Button>
            </div>
          )}

          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">
                Requested / Received Entries ({postRequestEntries.length})
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Only entries a bill has already been requested for. Logged-but-not-yet-requested entries live on the Batch Overview tab.
              </p>
            </div>
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
                  ) : postRequestEntries.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No bills requested yet.</td></tr>
                  ) : postRequestEntries.map(entry => {
                    const lifecycle = cnfLifecycle(entry, invoiceBatchById);
                    return (
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
                        <td className="px-4 py-3 text-right">{fmtInr(entry.goodsValue)}</td>
                        <td className="px-4 py-3 text-right font-semibold">{fmtInr(entry.totalPayable)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${LIFECYCLE_BADGE_CLASS[lifecycle]}`}>
                            {lifecycle}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
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
          {selectedEntries.length} shipment{selectedEntries.length === 1 ? '' : 's'} — computed total {fmtInr(computedTotal)}
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
              Billed amount {fmtInr(parsedAmount)} doesn't match computed total {fmtInr(computedTotal)}.
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
