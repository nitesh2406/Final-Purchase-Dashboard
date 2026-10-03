import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { invalidateReadCache } from '../../../services/gasApi';
import { fetchCnfShipmentValues, fetchCnfGoodsInvoices, fetchCnfAncillaryValues, fetchCnfDraftInvoices, approveCnfGoodsInvoice, rejectCnfGoodsInvoice } from '../../../services/cnfService';
import type { CnfShipmentValue, CnfGoodsInvoice, CnfAncillaryValue, CnfDraftInvoice } from '../../../types';
import { LogCnfInvoiceModal } from './LogCnfInvoiceModal';
import { computeReceivableFigures } from './receivable';
import { fmtInr } from './cnfFormat';
import { readViewCache, writeViewCache } from './viewCache';

const STATUS_BADGE: Record<string, string> = {
  'Not invoiced': 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  'Part invoiced': 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  'Fully invoiced': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  'Pending Approval': 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  'Approved': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  'Rejected': 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  'Goods': 'bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-300',
  'Ancillary': 'bg-violet-100 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400',
};
const badge = (s: string) => `px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[s] || 'bg-slate-100 text-slate-500'}`;

type CachedView = { shipments: CnfShipmentValue[]; invoices: CnfGoodsInvoice[]; ancillary?: CnfAncillaryValue[]; drafts?: CnfDraftInvoice[] };

export const CnfInvoicesView: React.FC<{ refreshKey: number; onDataChanged: () => void }> = ({ refreshKey, onDataChanged }) => {
  const cached = readViewCache<CachedView>('invoices');
  const [shipments, setShipments] = useState<CnfShipmentValue[]>(cached?.shipments ?? []);
  const [invoices, setInvoices] = useState<CnfGoodsInvoice[]>(cached?.invoices ?? []);
  const [ancillary, setAncillary] = useState<CnfAncillaryValue[]>(cached?.ancillary ?? []);
  const [drafts, setDrafts] = useState<CnfDraftInvoice[]>(cached?.drafts ?? []);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [modalKind, setModalKind] = useState<null | 'Goods' | 'Ancillary'>(null);
  const [rejectDraft, setRejectDraft] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadSeq = useRef(0);

  // Only the newest load may update the screen.
  const load = async (force: boolean) => {
    const mine = ++loadSeq.current;
    if (force) invalidateReadCache();
    setIsLoading(true);
    setLoadError(null);
    try {
      const [s, i, a, d] = await Promise.all([fetchCnfShipmentValues(), fetchCnfGoodsInvoices(), fetchCnfAncillaryValues(), fetchCnfDraftInvoices()]);
      if (mine !== loadSeq.current) return;
      writeViewCache('invoices', { shipments: s, invoices: i, ancillary: a, drafts: d });
      setShipments(s);
      setInvoices(i);
      setAncillary(a);
      setDrafts(d);
    } catch (err: any) {
      if (mine === loadSeq.current) setLoadError(err.message || 'Failed to load CNF invoices');
    } finally {
      if (mine === loadSeq.current) setIsLoading(false);
    }
  };

  useEffect(() => { load(refreshKey > 0); }, [refreshKey]);

  // Per-shipment "to be billed / billed / remaining" against the batch draft
  // invoice when one exists (goods + CNF charge + GST), else goods only.
  const receivable = useMemo(() => computeReceivableFigures(shipments, drafts), [shipments, drafts]);
  const delivered = useMemo(() => shipments.filter(s => s.batchStatus === 'Delivered'), [shipments]);
  const openToInvoice = useMemo(() => delivered.filter(s => s.eligible && s.remainingInr >= 1), [delivered]);
  const summaryRows = showAll ? delivered : openToInvoice;
  const openAncillary = useMemo(() => ancillary.filter(a => a.eligible && a.remainingInr >= 1), [ancillary]);
  const ancillaryRows = showAll ? ancillary : ancillary.filter(a => a.invoiceStatus !== 'Fully invoiced');
  const ordered = useMemo(() => {
    const rank = (s: string) => (s === 'Pending Approval' ? 0 : 1);
    return [...invoices].sort((a, b) => rank(a.status) - rank(b.status) || b.createdAt.localeCompare(a.createdAt));
  }, [invoices]);

  const decide = async (inv: CnfGoodsInvoice, kind: 'approve' | 'reject') => {
    const reason = (rejectDraft[inv.id] || '').trim();
    if (kind === 'reject' && !reason) { setActionError('Type a rejection reason first.'); return; }
    setBusyId(inv.id);
    setActionError(null);
    try {
      if (kind === 'approve') await approveCnfGoodsInvoice(inv.id);
      else await rejectCnfGoodsInvoice(inv.id, reason);
      onDataChanged();
    } catch (err: any) {
      setActionError(err.message || `Failed to ${kind}`);
    } finally {
      setBusyId(null);
    }
  };

  const th = 'px-4 py-3';
  return (
    <div className="space-y-6">
      {loadError && (
        <div className="flex items-center justify-between bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg px-4 py-3">
          <span className="text-sm text-red-600 dark:text-red-400">{loadError}</span>
          <Button variant="secondary" className="text-xs !py-1 !px-2.5" onClick={() => load(true)}>Retry</Button>
        </div>
      )}

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Receivable from CNF ({summaryRows.length})</h3>
            <p className="text-xs text-slate-400 mt-0.5">Delivered shipments whose vendor invoice is fully paid. "To be billed" is the batch's draft invoice (goods + CNF charge + GST) when one exists, else goods only.</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> Show all
            </label>
            <Button onClick={() => setModalKind('Goods')} disabled={openToInvoice.length === 0}>Log goods invoice</Button>
            <Button onClick={() => setModalKind('Ancillary')} disabled={openAncillary.length === 0}>Log ancillary invoice</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900 text-slate-500 text-[11px] uppercase tracking-wider border-b">
                <th className={th}>Batch</th>
                <th className={th}>Shipment</th>
                <th className={th}>Vendor</th>
                <th className={`${th} text-right`}>To be billed</th>
                <th className={`${th} text-right`}>Billed</th>
                <th className={`${th} text-right`}>Remaining</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading && shipments.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : summaryRows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Nothing waiting for a CNF invoice.</td></tr>
              ) : summaryRows.map(s => {
                const r = receivable.get(s.shipmentId) ?? { toBill: s.paidInr, billed: s.invoicedInr, remaining: s.eligible ? s.remainingInr : 0, hasDraft: false };
                return (
                <tr key={s.shipmentId}>
                  <td className="px-4 py-3 font-mono">{s.batchId}</td>
                  <td className="px-4 py-3 font-mono">{s.shipmentId}</td>
                  <td className="px-4 py-3">{s.vendorName} ({s.vendorCode})</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {fmtInr(r.toBill)}
                    <div className="text-[10px] font-sans text-slate-400">{r.hasDraft ? 'incl. CNF charge + GST' : 'goods only'}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{fmtInr(r.billed)}</td>
                  <td className="px-4 py-3 text-right font-mono">{s.eligible ? fmtInr(r.remaining) : '—'}</td>
                  <td className="px-4 py-3">
                    {s.eligible ? <span className={badge(s.invoiceStatus)}>{s.invoiceStatus}</span> : <span className="text-xs text-slate-400">{s.ineligibleReason}</span>}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Open ancillary ({ancillaryRows.length})</h3>
          <p className="text-xs text-slate-400 mt-0.5">Service invoices paid through CNF. CNF bills the INR paid + GST, no commission.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900 text-slate-500 text-[11px] uppercase tracking-wider border-b">
                <th className={th}>Invoice</th>
                <th className={th}>Vendor</th>
                <th className={th}>Date</th>
                <th className={th}>Service</th>
                <th className={`${th} text-right`}>Paid (INR)</th>
                <th className={`${th} text-right`}>CNF Invoiced</th>
                <th className={`${th} text-right`}>Remaining</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading && ancillary.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : ancillaryRows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">No ancillary invoices open. Log one in Finance → Log Invoice with type Ancillary.</td></tr>
              ) : ancillaryRows.map(a => (
                <tr key={a.invoiceNo} data-testid={`anc-row-${a.invoiceNo}`}>
                  <td className="px-4 py-3 font-mono">{a.invoiceNo}</td>
                  <td className="px-4 py-3">{a.vendorName} ({a.vendorCode})</td>
                  <td className="px-4 py-3 whitespace-nowrap">{a.date}</td>
                  <td className="px-4 py-3">{a.notes}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtInr(a.paidInr)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtInr(a.invoicedInr)}</td>
                  <td className="px-4 py-3 text-right font-mono">{a.eligible ? fmtInr(a.remainingInr) : '—'}</td>
                  <td className="px-4 py-3">
                    {a.eligible ? <span className={badge(a.invoiceStatus)}>{a.invoiceStatus}</span> : <span className="text-xs text-slate-400">{a.ineligibleReason}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">CNF Invoices ({invoices.length})</h3>
          {actionError && <p className="text-sm text-red-500 mt-1">{actionError}</p>}
        </div>
        {ordered.length === 0 ? (
          <p className="px-4 py-8 text-center text-slate-400 text-sm">No CNF invoices logged yet.</p>
        ) : (
          <div className="divide-y">
            {ordered.map(inv => (
              <div key={inv.id} className="px-4 py-3 space-y-2 text-sm" data-testid={`cnf-invoice-${inv.cnfInvoiceNo}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold">{inv.cnfInvoiceNo}</span>
                  <span className="text-slate-400">{inv.invoiceDate}</span>
                  <span className={badge(inv.status)}>{inv.status}</span>
                  <span className={badge(inv.kind)}>{inv.kind}</span>
                  {inv.fileUrl && <a href={inv.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-500 underline">File</a>}
                  <span className="ml-auto font-mono">{fmtInr(inv.total)}</span>
                </div>
                <div className="text-xs text-slate-500">
                  {inv.lines.map(l => (l.shipmentId ? `${l.batchId}/${l.shipmentId}` : `${l.invoiceNo} (${l.vendorCode})`) + ` ${fmtInr(l.amount)}`).join(' + ')}
                </div>
                <div className="text-xs text-slate-500">
                  Base {fmtInr(inv.baseAmount)} · {inv.kind === 'Ancillary' ? 'Paid' : 'Purchase'} {fmtInr(inv.purchaseValue)} · Service {fmtInr(inv.serviceCharge)} · GST {fmtInr(inv.gst)}
                  {inv.overrideReason && <span className="text-amber-600"> · Override: {inv.overrideReason}</span>}
                </div>
                <div className="text-xs text-slate-400">
                  Submitted by {inv.submittedBy}{inv.decidedBy && ` · ${inv.status === 'Rejected' ? 'Rejected' : 'Approved'} by ${inv.decidedBy}`}
                  {inv.rejectionReason && <span className="text-red-500"> · Reason: {inv.rejectionReason}</span>}
                </div>
                {inv.status === 'Pending Approval' && (
                  <div className="flex gap-2 items-center">
                    <Button className="bg-emerald-600 hover:bg-emerald-700 text-xs !py-1 !px-2.5" disabled={busyId !== null} onClick={() => decide(inv, 'approve')}>
                      {busyId === inv.id ? 'Working…' : 'Approve'}
                    </Button>
                    <input
                      aria-label={`Rejection reason for ${inv.cnfInvoiceNo}`}
                      placeholder="Rejection reason"
                      value={rejectDraft[inv.id] || ''}
                      onChange={e => setRejectDraft(prev => ({ ...prev, [inv.id]: e.target.value }))}
                      disabled={busyId !== null}
                      className="flex-1 px-3 py-1.5 border rounded-lg text-xs bg-white dark:bg-slate-900"
                    />
                    <button className="text-red-500 hover:text-red-600 text-xs font-bold px-2 disabled:opacity-50" disabled={busyId !== null} onClick={() => decide(inv, 'reject')}>
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {modalKind && (
        <LogCnfInvoiceModal
          kind={modalKind}
          shipments={openToInvoice}
          ancillary={openAncillary}
          onClose={() => setModalKind(null)}
          onSaved={() => { setModalKind(null); onDataChanged(); }}
        />
      )}
    </div>
  );
};
