import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useQueryParam } from '../../hooks/useQueryParam';
import { useSubmissionLock } from '../../hooks/useSubmissionLock';
import { ArrowPathIcon, CreditCardIcon, ListBulletIcon, DocumentTextIcon } from '../icons/Icons';
import {
  fetchCnfAdvances,
  fetchCnfGoodsInvoices,
  fetchCnfEligibleBatches,
  fetchPurchaseInvoices,
  fetchSettlementRecords,
  computeBatchSettlementStatus,
  approveCnfGoodsInvoice,
  rejectCnfGoodsInvoice,
  PurchaseInvoice,
  SettlementRecord,
} from '../../services/settlementService';
import { CnfAdvance, CnfGoodsInvoice, CnfEligibleBatch } from '../../types';
import { LogCnfGoodsInvoiceModal, CnfShipmentOption } from './LogCnfGoodsInvoiceModal';

type CnfAdvancesTab = 'advances' | 'awaiting' | 'invoices';

const fmtInr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const CnfAdvances: React.FC = () => {
  const [activeTab, setActiveTab] = useQueryParam<CnfAdvancesTab>('cnfAdvTab', 'advances');
  const [advances, setAdvances] = useState<CnfAdvance[]>([]);
  const [invoices, setInvoices] = useState<CnfGoodsInvoice[]>([]);
  const [eligibleBatches, setEligibleBatches] = useState<CnfEligibleBatch[]>([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState<PurchaseInvoice[]>([]);
  const [settlementRecords, setSettlementRecords] = useState<SettlementRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);

  const loadAll = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [advList, invList, batches, pInvoices, settlements] = await Promise.all([
        fetchCnfAdvances(),
        fetchCnfGoodsInvoices(),
        fetchCnfEligibleBatches(),
        fetchPurchaseInvoices(),
        fetchSettlementRecords(),
      ]);
      setAdvances(advList);
      setInvoices(invList);
      setEligibleBatches(batches);
      setPurchaseInvoices(pInvoices);
      setSettlementRecords(settlements);
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load CNF Advances data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const outstandingAdvances = useMemo(() => advances.filter(a => a.balance > 0.01), [advances]);

  // Same Delivered+Paid eligibility CNF Agent Accounting already uses.
  const paidBatches = useMemo(() => {
    return eligibleBatches.filter(b => {
      const linkedInvoiceIds = b.vendor_shipments.map(vs => vs.invoiceId || '');
      return computeBatchSettlementStatus(linkedInvoiceIds, purchaseInvoices, settlementRecords).status === 'Paid';
    });
  }, [eligibleBatches, purchaseInvoices, settlementRecords]);

  const invoicedShipmentIds = useMemo(() => {
    const set = new Set<string>();
    invoices.filter(inv => inv.status === 'Approved').forEach(inv => {
      inv.lineItems.forEach(li => li.shipmentIds.forEach(sid => set.add(sid)));
    });
    return set;
  }, [invoices]);

  const shipmentsAwaitingInvoice = useMemo<CnfShipmentOption[]>(() => {
    const rows: CnfShipmentOption[] = [];
    paidBatches.forEach(b => {
      b.vendor_shipments.forEach(vs => {
        if (!invoicedShipmentIds.has(vs.shipment_id)) {
          rows.push({ batchId: b.batch_id, shipmentId: vs.shipment_id, vendorCode: vs.vendor_code, vendorName: vs.vendor_name });
        }
      });
    });
    return rows;
  }, [paidBatches, invoicedShipmentIds]);

  const pendingApprovalInvoices = useMemo(() => invoices.filter(i => i.status === 'Pending Approval'), [invoices]);
  const decidedInvoices = useMemo(() => invoices.filter(i => i.status !== 'Pending Approval'), [invoices]);

  const { withSubmissionGuard } = useSubmissionLock();
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [rejectReasonDraft, setRejectReasonDraft] = useState<Record<string, string>>({});
  const [activeAction, setActiveAction] = useState<{ id: string; type: 'approve' | 'reject' } | null>(null);

  const handleApprove = (id: string) => {
    withSubmissionGuard(async () => {
      setActiveAction({ id, type: 'approve' });
      setApprovalError(null);
      try {
        await approveCnfGoodsInvoice(id, 'internal-admin');
        await loadAll();
      } catch (err: any) {
        setApprovalError(err.message || 'Failed to approve');
      } finally {
        setActiveAction(null);
      }
    });
  };

  const handleReject = (id: string) => {
    const reason = rejectReasonDraft[id]?.trim();
    if (!reason) {
      setApprovalError('A rejection reason is required.');
      return;
    }
    withSubmissionGuard(async () => {
      setActiveAction({ id, type: 'reject' });
      setApprovalError(null);
      try {
        await rejectCnfGoodsInvoice(id, reason);
        setRejectReasonDraft(prev => { const next = { ...prev }; delete next[id]; return next; });
        await loadAll();
      } catch (err: any) {
        setApprovalError(err.message || 'Failed to reject');
      } finally {
        setActiveAction(null);
      }
    });
  };

  const tabButtonClass = (tab: CnfAdvancesTab) =>
    `flex-1 md:flex-initial min-w-[180px] px-5 py-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2.5 ${
      activeTab === tab
        ? 'bg-primary-600 text-white shadow-md font-black'
        : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800/40'
    }`;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-white">CNF Advances</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Money paid to CNF to settle overseas vendor balances, matched against CNF's own tax invoices as they arrive.
          </p>
        </div>
        <Button variant="secondary" onClick={loadAll} disabled={isLoading} icon={<ArrowPathIcon className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />}>
          Refresh Data
        </Button>
      </div>

      {loadError && (
        <div className="flex items-center justify-between bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-4 py-3">
          <span className="text-sm text-red-600 dark:text-red-400">{loadError}</span>
          <Button variant="secondary" className="text-xs !py-1 !px-2.5" onClick={loadAll}>Retry</Button>
        </div>
      )}

      <div className="flex border-b border-gray-200 dark:border-gray-750 bg-slate-100/50 dark:bg-slate-900/50 p-1.5 rounded-xl gap-1 max-w-full overflow-x-auto shadow-sm">
        <button onClick={() => setActiveTab('advances')} className={tabButtonClass('advances')}>
          <CreditCardIcon className="w-4 h-4" /><span>Outstanding Advances</span>
        </button>
        <button onClick={() => setActiveTab('awaiting')} className={tabButtonClass('awaiting')}>
          <ListBulletIcon className="w-4 h-4" /><span>Awaiting CNF Invoice</span>
          {shipmentsAwaitingInvoice.length > 0 && (
            <span className={`px-2 py-0.5 text-[10px] font-black font-mono rounded-full ${activeTab === 'awaiting' ? 'bg-primary-700 text-white' : 'bg-gray-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'}`}>
              {shipmentsAwaitingInvoice.length}
            </span>
          )}
        </button>
        <button onClick={() => setActiveTab('invoices')} className={tabButtonClass('invoices')}>
          <DocumentTextIcon className="w-4 h-4" /><span>CNF Invoices</span>
          {pendingApprovalInvoices.length > 0 && (
            <span className={`px-2 py-0.5 text-[10px] font-black font-mono rounded-full ${activeTab === 'invoices' ? 'bg-primary-700 text-white' : 'bg-gray-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'}`}>
              {pendingApprovalInvoices.length}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'advances' && (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Outstanding Advances ({outstandingAdvances.length})</h3>
            <p className="text-xs text-slate-400 mt-0.5">Created automatically whenever a payment settles an overseas vendor's balance.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900 text-slate-500 text-[11px] uppercase tracking-wider border-b">
                  <th className="px-4 py-3">Advance ID</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
                ) : outstandingAdvances.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No outstanding advances.</td></tr>
                ) : outstandingAdvances.map(a => (
                  <tr key={a.id}>
                    <td className="px-4 py-3 font-mono">{a.id}</td>
                    <td className="px-4 py-3">{a.date.slice(0, 10)}</td>
                    <td className="px-4 py-3">{a.vendorCode}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmtInr(a.amount)}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">{fmtInr(a.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeTab === 'awaiting' && (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Shipments Awaiting CNF Invoice ({shipmentsAwaitingInvoice.length})</h3>
              <p className="text-xs text-slate-400 mt-0.5">Delivered, paid shipments with no approved CNF goods invoice yet.</p>
            </div>
            <Button onClick={() => setIsLogModalOpen(true)} disabled={shipmentsAwaitingInvoice.length === 0}>Log CNF Invoice</Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900 text-slate-500 text-[11px] uppercase tracking-wider border-b">
                  <th className="px-4 py-3">Batch ID</th>
                  <th className="px-4 py-3">Shipment</th>
                  <th className="px-4 py-3">Vendor</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
                ) : shipmentsAwaitingInvoice.length === 0 ? (
                  <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400">Nothing awaiting invoice.</td></tr>
                ) : shipmentsAwaitingInvoice.map(row => (
                  <tr key={row.shipmentId}>
                    <td className="px-4 py-3 font-mono">{row.batchId}</td>
                    <td className="px-4 py-3 font-mono">{row.shipmentId}</td>
                    <td className="px-4 py-3">{row.vendorName} ({row.vendorCode})</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeTab === 'invoices' && (
        <div className="space-y-6">
          {approvalError && <p className="text-sm text-red-500">{approvalError}</p>}
          {pendingApprovalInvoices.length > 0 && (
            <Card className="p-4 space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Pending Approval ({pendingApprovalInvoices.length})</h3>
              {pendingApprovalInvoices.map(inv => {
                const isApprovingThis = activeAction?.id === inv.id && activeAction.type === 'approve';
                const isRejectingThis = activeAction?.id === inv.id && activeAction.type === 'reject';
                const isBusy = activeAction !== null;
                const shipmentCount = inv.lineItems.reduce((sum, li) => sum + li.shipmentIds.length, 0);
                return (
                  <div key={inv.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold">{inv.id} — {fmtInr(inv.total)}</p>
                        <p className="text-xs text-slate-400">
                          {shipmentCount} shipment{shipmentCount === 1 ? '' : 's'} · Residual {fmtInr(inv.residualLiability)} · Submitted by {inv.submittedBy}
                          {inv.overrideReason && <span className="text-amber-500"> · Override: {inv.overrideReason}</span>}
                        </p>
                        {inv.fileUrl && <a href={inv.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-500 underline">View uploaded invoice</a>}
                      </div>
                      <Button onClick={() => handleApprove(inv.id)} disabled={isBusy} className="bg-emerald-600 hover:bg-emerald-700">
                        {isApprovingThis ? 'Approving…' : 'Approve'}
                      </Button>
                    </div>
                    <div className="flex gap-2 items-center">
                      <input
                        type="text" placeholder="Rejection reason"
                        value={rejectReasonDraft[inv.id] || ''}
                        onChange={e => setRejectReasonDraft(prev => ({ ...prev, [inv.id]: e.target.value }))}
                        disabled={isBusy}
                        className="flex-1 px-3 py-1.5 border rounded-lg text-xs"
                      />
                      <button onClick={() => handleReject(inv.id)} disabled={isBusy} className="text-red-500 hover:text-red-600 text-xs font-bold px-2 disabled:opacity-50 disabled:cursor-not-allowed">
                        {isRejectingThis ? 'Rejecting…' : 'Reject'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </Card>
          )}

          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">All CNF Invoices ({invoices.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900 text-slate-500 text-[11px] uppercase tracking-wider border-b">
                    <th className="px-4 py-3">Invoice ID</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Residual Liability</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
                  ) : invoices.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No CNF invoices logged yet.</td></tr>
                  ) : [...pendingApprovalInvoices, ...decidedInvoices].map(inv => (
                    <tr key={inv.id}>
                      <td className="px-4 py-3 font-mono">{inv.id}</td>
                      <td className="px-4 py-3">{inv.date.slice(0, 10)}</td>
                      <td className="px-4 py-3 text-right font-mono">{fmtInr(inv.total)}</td>
                      <td className="px-4 py-3 text-right font-mono">{fmtInr(inv.residualLiability)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          inv.status === 'Approved' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' :
                          inv.status === 'Rejected' ? 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400' :
                          'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
                        }`}>
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {isLogModalOpen && (
        <LogCnfGoodsInvoiceModal
          shipmentOptions={shipmentsAwaitingInvoice}
          outstandingAdvances={outstandingAdvances}
          submittedBy="internal-admin"
          onClose={() => setIsLogModalOpen(false)}
          onSuccess={() => { setIsLogModalOpen(false); loadAll(); }}
        />
      )}
    </div>
  );
};
