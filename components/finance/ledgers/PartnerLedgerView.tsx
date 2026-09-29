import React, { useEffect, useRef, useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { callGas, invalidateReadCache } from '../../../services/gasApi';
import {
  fetchShippingPartners, fetchBatchShippingPartners, fetchPartnerBills, fetchPartnerPayments,
  fetchPartnerLedgerStatement, approvePartnerBill, rejectPartnerBill, voidPartnerPayment,
} from '../../../services/shippingPartnerService';
import type { ShippingPartner, BatchShippingPartner, PartnerBill, PartnerPayment, PartnerLedgerStatement } from '../../../types';
import { fmtInr } from '../../logistics/cnf/cnfFormat';
import { billableBatchIds } from './partnerBill';
import { LogPartnerBillModal } from './LogPartnerBillModal';
import { RecordPartnerPaymentModal } from './RecordPartnerPaymentModal';

interface Loaded {
  partner: ShippingPartner;
  statement: PartnerLedgerStatement;
  bills: PartnerBill[];
  payments: PartnerPayment[];
  assignments: BatchShippingPartner[];
  weights: Record<string, number | null>;
}

const BILL_BADGE: Record<string, string> = {
  'Pending Approval': 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  'Approved': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  'Rejected': 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400',
};

// batchId → total_weight_kg, to pre-fill a new bill's weight.
async function loadWeights(): Promise<Record<string, number | null>> {
  const r = await callGas('get_batches', {}, 1);
  if (!r || r.status !== 'success') throw new Error((r && r.message) || 'Failed to load batches');
  const out: Record<string, number | null> = {};
  (r.batches || []).forEach((b: { batch_id: string; total_weight_kg?: number | null }) => { out[b.batch_id] = b.total_weight_kg ?? null; });
  return out;
}

// One shipping partner's ledger (statement with TDS) and its bills, with
// approve / reject, record payment and void.
export const PartnerLedgerView: React.FC<{ partnerId: string; refreshKey: number }> = ({ partnerId, refreshKey }) => {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<Loaded | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [logging, setLogging] = useState(false);
  const [payingBill, setPayingBill] = useState<PartnerBill | null>(null);
  const loadSeq = useRef(0);

  // Only the newest load may update the screen (a quick date change or a
  // write while one is in flight must not be overwritten by an older response).
  const load = async (force: boolean) => {
    const mine = ++loadSeq.current;
    if (force) invalidateReadCache();
    setIsLoading(true);
    setLoadError(null);
    try {
      const [partners, statement, bills, payments, assignments, weights] = await Promise.all([
        fetchShippingPartners(), fetchPartnerLedgerStatement(partnerId, { from, to }), fetchPartnerBills(partnerId),
        fetchPartnerPayments(partnerId), fetchBatchShippingPartners(), loadWeights(),
      ]);
      if (mine !== loadSeq.current) return;
      const partner = partners.find(x => x.id === partnerId);
      if (!partner) throw new Error(`Shipping partner ${partnerId} not found`);
      setData({ partner, statement, bills, payments, assignments, weights });
    } catch (err: any) {
      if (mine === loadSeq.current) setLoadError(err.message || 'Failed to load the ledger');
    } finally {
      if (mine === loadSeq.current) setIsLoading(false);
    }
  };

  useEffect(() => { load(refreshKey > 0); }, [refreshKey, partnerId, from, to]);

  const reasonFor = (key: string) => (reasons[key] || '').trim();
  const act = async (key: string, fn: () => Promise<void>) => {
    setBusyId(key);
    setActionError(null);
    try {
      await fn();
      await load(true);
    } catch (err: any) {
      setActionError(err.message || 'Action failed');
    } finally {
      setBusyId(null);
    }
  };
  const withReason = (key: string, what: string, fn: (reason: string) => Promise<void>) => {
    if (!reasonFor(key)) { setActionError(`Type a reason to ${what} first.`); return; }
    act(key, () => fn(reasonFor(key)));
  };
  const reasonInput = (key: string, label: string) => (
    <input aria-label={label} placeholder="Reason" value={reasons[key] || ''}
      onChange={e => setReasons(r => ({ ...r, [key]: e.target.value }))}
      className="px-2 py-1 border rounded text-xs bg-white dark:bg-slate-900 w-32" />
  );

  const dateInput = 'px-3 py-1.5 border rounded-lg text-xs bg-white dark:bg-slate-900';
  const th = 'px-4 py-3';
  const num = 'px-4 py-3 text-right font-mono';

  if (isLoading && !data) return <Card className="p-8 text-center text-slate-400">Loading…</Card>;

  const billable = data ? billableBatchIds(partnerId, data.assignments, data.bills) : [];

  return (
    <div className="space-y-4">
      {loadError && (
        <div className="flex items-center justify-between bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-4 py-3">
          <span className="text-sm text-red-600 dark:text-red-400">{loadError}{data ? ' (showing the last loaded copy)' : ''}</span>
          <Button variant="secondary" className="text-xs !py-1 !px-2.5" onClick={() => load(true)}>Retry</Button>
        </div>
      )}
      {actionError && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400" data-testid="partner-action-error">
          {actionError}
        </div>
      )}
      {data && (
        <>
          <Card className="p-4 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold" data-testid="partner-name">
                {data.partner.name}{!data.partner.active && <span className="ml-2 text-xs text-slate-400">(inactive)</span>}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                GSTIN {data.partner.gstin || '—'} · {fmtInr(data.partner.ratePerKg)}/kg · one bill per air batch: fee + 18% GST
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right text-sm" data-testid="partner-ledger-closing">
                <span className="text-slate-400 text-xs block">Closing balance</span>
                <span className={`font-mono font-semibold ${data.statement.closingBalance < 0 ? 'text-red-500' : ''}`}>{fmtInr(data.statement.closingBalance)}</span>
              </div>
              <span title={billable.length ? undefined : 'No batch of this partner is waiting for a bill. Set the partner on CNF Agent → Batches.'}>
                <Button onClick={() => setLogging(true)} disabled={billable.length === 0}>Log bill</Button>
              </span>
            </div>
          </Card>

          <div className="flex gap-3 items-end">
            <label className="text-xs text-slate-500">From<br /><input type="date" aria-label="From" value={from} onChange={e => setFrom(e.target.value)} className={dateInput} /></label>
            <label className="text-xs text-slate-500">To<br /><input type="date" aria-label="To" value={to} onChange={e => setTo(e.target.value)} className={dateInput} /></label>
            {(from || to) && <Button variant="secondary" className="text-xs !py-1 !px-2.5" onClick={() => { setFrom(''); setTo(''); }}>Clear</Button>}
          </div>

          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Ledger</h3>
              <p className="text-xs text-slate-400 mt-0.5">Billed: approved bills. Paid: active payments, with TDS deducted counted as paid. Negative balance = we owe {data.partner.name}.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900 text-slate-500 text-[11px] uppercase tracking-wider border-b">
                    <th className={th}>Date</th><th className={th}>Type</th><th className={th}>Description</th>
                    <th className={`${th} text-right`}>Paid</th><th className={`${th} text-right`}>TDS</th>
                    <th className={`${th} text-right`}>Billed</th><th className={`${th} text-right`}>Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr className="bg-slate-50/50 dark:bg-slate-900/50">
                    <td className="px-4 py-2 text-xs text-slate-400" colSpan={6}>Opening balance{from ? ` before ${from}` : ''}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmtInr(data.statement.openingBalance)}</td>
                  </tr>
                  {data.statement.rows.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No entries in this range.</td></tr>
                  ) : data.statement.rows.map((r, i) => (
                    <tr key={`${r.reference}-${i}`}>
                      <td className="px-4 py-3 whitespace-nowrap">{r.date}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{r.type}</td>
                      <td className="px-4 py-3 text-xs">{r.description}</td>
                      <td className={num}>{r.paid ? fmtInr(r.paid) : ''}</td>
                      <td className={num}>{r.tds ? fmtInr(r.tds) : ''}</td>
                      <td className={num}>{r.billed ? fmtInr(r.billed) : ''}</td>
                      <td className={`${num} ${r.balance < 0 ? 'text-red-500' : ''}`}>{fmtInr(r.balance)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="px-4 py-3" colSpan={3}>Totals</td>
                    <td className={num}>{fmtInr(data.statement.totals.paid)}</td>
                    <td className={num}>{fmtInr(data.statement.totals.tds)}</td>
                    <td className={num}>{fmtInr(data.statement.totals.billed)}</td>
                    <td className={num}>{fmtInr(data.statement.closingBalance)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Bills ({data.bills.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900 text-slate-500 text-[11px] uppercase tracking-wider border-b">
                    <th className={th}>Bill No</th><th className={th}>Batch</th><th className={th}>Date</th>
                    <th className={`${th} text-right`}>Weight</th><th className={`${th} text-right`}>Expected fee</th>
                    <th className={`${th} text-right`}>Fee</th><th className={`${th} text-right`}>GST</th>
                    <th className={`${th} text-right`}>Total</th><th className={th}>Status</th>
                    <th className={`${th} text-right`}>Settled</th><th className={`${th} text-right`}>Balance</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.bills.length === 0 ? (
                    <tr><td colSpan={12} className="px-4 py-8 text-center text-slate-400">No bills yet.</td></tr>
                  ) : data.bills.map(b => {
                    const pays = data.payments.filter(x => x.billId === b.id);
                    const hasActive = pays.some(x => x.status === 'Active');
                    const canReject = b.status === 'Pending Approval' || (b.status === 'Approved' && !hasActive);
                    return (
                      <React.Fragment key={b.id}>
                        <tr data-testid={`bill-row-${b.billNo}`}>
                          <td className="px-4 py-3 font-mono"><a href={b.fileUrl} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">{b.billNo}</a></td>
                          <td className="px-4 py-3 font-mono">{b.batchId}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{b.billDate}</td>
                          <td className={num}>{b.weightKg} kg</td>
                          <td className={num}>{fmtInr(b.expectedFee)}</td>
                          <td className={num}>{fmtInr(b.fee)}</td>
                          <td className={num}>{fmtInr(b.gst)}</td>
                          <td className={num}>{fmtInr(b.total)}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${BILL_BADGE[b.status] || ''}`}>{b.status}</span>
                          </td>
                          <td className={num}>{fmtInr(b.settled)}</td>
                          <td className={num}>{b.status === 'Rejected' ? '' : fmtInr(b.balance)}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              {b.status === 'Pending Approval' && (
                                <Button className="bg-emerald-600 hover:bg-emerald-700 text-xs !py-1 !px-2.5" disabled={busyId !== null}
                                  onClick={() => act(b.id, () => approvePartnerBill(b.id))}>Approve</Button>
                              )}
                              {b.status === 'Approved' && b.balance >= 0.01 && (
                                <Button className="text-xs !py-1 !px-2.5" disabled={busyId !== null} onClick={() => setPayingBill(b)}>Record payment</Button>
                              )}
                              {canReject && (
                                <>
                                  {reasonInput(b.id, `Rejection reason for ${b.billNo}`)}
                                  <button className="text-red-500 hover:text-red-600 text-xs font-bold px-2 disabled:opacity-50" disabled={busyId !== null}
                                    onClick={() => withReason(b.id, 'reject', r => rejectPartnerBill(b.id, r))}>Reject</button>
                                </>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 text-right mt-1">
                              by {b.submittedBy}{b.decidedBy && ` · ${b.status === 'Rejected' ? 'rejected' : 'approved'} by ${b.decidedBy}`}
                              {b.rejectionReason && <span className="text-red-500"> · {b.rejectionReason}</span>}
                              {b.overrideReason && <span className="text-amber-600"> · override: {b.overrideReason}</span>}
                            </div>
                          </td>
                        </tr>
                        {pays.map(pm => (
                          <tr key={pm.id} className="bg-slate-50/60 dark:bg-slate-900/40 text-xs" data-testid={`payment-row-${pm.id}`}>
                            <td className="px-4 py-2" />
                            <td className="px-4 py-2" colSpan={6}>
                              <span className={pm.status === 'Voided' ? 'line-through text-slate-400' : ''}>
                                Payment {pm.date} · {fmtInr(pm.amount)}{pm.tds ? ` + TDS ${fmtInr(pm.tds)}` : ''}{pm.reference ? ` · ref ${pm.reference}` : ''}
                              </span>
                              <span className="text-slate-400"> · by {pm.recordedBy}</span>
                              {pm.status === 'Voided' && <span className="text-red-500"> · voided by {pm.voidedBy}: {pm.voidReason}</span>}
                            </td>
                            <td className="px-4 py-2 text-right" colSpan={5}>
                              {pm.status === 'Active' && (
                                <div className="flex justify-end items-center gap-2">
                                  {reasonInput(pm.id, `Void reason for ${pm.id}`)}
                                  <button className="text-red-500 hover:text-red-600 text-xs font-bold px-2 disabled:opacity-50" disabled={busyId !== null}
                                    onClick={() => withReason(pm.id, 'void', r => voidPartnerPayment(pm.id, r))}>Void</button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {logging && (
            <LogPartnerBillModal partner={data.partner} batchIds={billable} weights={data.weights}
              onClose={() => setLogging(false)} onSaved={() => { setLogging(false); load(true); }} />
          )}
          {payingBill && (
            <RecordPartnerPaymentModal bill={payingBill} payments={data.payments.filter(x => x.billId === payingBill.id)}
              onClose={() => setPayingBill(null)} onSaved={() => { setPayingBill(null); load(true); }} />
          )}
        </>
      )}
    </div>
  );
};
