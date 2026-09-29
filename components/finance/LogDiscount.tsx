import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useSubmissionLock } from '../../hooks/useSubmissionLock';
import type { PaymentLog, PurchaseInvoice, SettlementRecord, VendorMaster } from '../../services/settlementService';
import { logVendorDiscount, DiscountServerError, VendorDiscountResult } from '../../services/discountService';
import { invoiceBalance, previewDiscount } from './discountPreview';

// Log Discount tab — a discount a vendor gives on one of its invoices after
// the fact. See docs/superpowers/specs/2026-09-29-vendor-discounts-design.md.
const fmtRmb = (n: number) => '¥' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInr = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const labelClass = 'block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5';
const inputClass = 'block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-950 dark:text-white px-3 py-2 text-sm';
const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export const LogDiscount: React.FC<{
  invoices: (PurchaseInvoice & { temp?: boolean })[];
  paymentLogs: PaymentLog[];
  settlementRecords: SettlementRecord[];
  vendors: VendorMaster[];
  onRefresh: () => Promise<void> | void;
}> = ({ invoices, paymentLogs, settlementRecords, vendors, onRefresh }) => {
  const [params] = useSearchParams();
  const [date, setDate] = useState(istToday);
  const [vendor, setVendor] = useState(params.get('vendor') || '');
  const [invoiceId, setInvoiceId] = useState(params.get('invoice') || '');
  const [amount, setAmount] = useState('');
  const [creditNoteNo, setCreditNoteNo] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VendorDiscountResult | null>(null);
  const { isSubmitting, withSubmissionGuard } = useSubmissionLock();

  const vendorInvoices = useMemo(() => invoices
    .filter(i => i.vendorCode === vendor && !i.temp)
    .sort((a, b) => String(b.date).localeCompare(String(a.date))), [invoices, vendor]);
  const invoice = vendorInvoices.find(i => i.invoiceId === invoiceId);
  const amountNum = parseFloat(amount) || 0;
  const preview = useMemo(
    () => (invoice && amountNum > 0 ? previewDiscount({ invoice, amount: amountNum, settlements: settlementRecords, payments: paymentLogs }) : null),
    [invoice, amountNum, settlementRecords, paymentLogs]
  );
  const canSave = !!invoice && amountNum > 0 && creditNoteNo.trim() !== '' && !isSubmitting;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || !invoice) return;
    withSubmissionGuard(async () => {
      setError(null);
      setResult(null);
      try {
        const r = await logVendorDiscount({ date, vendorCode: vendor, invoiceId: invoice.invoiceId, amountRmb: amountNum, creditNoteNo: creditNoteNo.trim(), notes: notes.trim() });
        setResult(r);
        setAmount('');
        setCreditNoteNo('');
        setNotes('');
        await onRefresh();
      } catch (err: any) {
        if (err instanceof DiscountServerError) setError(err.message);
        else setError(`${err?.message || 'The request failed.'} The discount may still have been saved: check Accounts View → Payment Entries for a DSC- row with this credit note before retrying. A retry with the same credit note is ignored.`);
      }
    });
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Vendor Discount Entry</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">A discount a vendor gives on one of its invoices. The part up to the unpaid balance clears the invoice; the rest becomes a credit at the rate the invoice was paid at and is used against the vendor's next open invoices.</p>
      </div>
      {result && (
        <Card className="p-4 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20" data-testid="discount-result">
          {result.duplicate ? (
            <p className="text-sm font-semibold">Already recorded as {result.discountId}: nothing changed.</p>
          ) : (
            <div className="text-sm space-y-1">
              <p className="font-semibold">Saved {result.discountId}</p>
              {(result.direct || 0) > 0 && <p>{fmtRmb(result.direct || 0)} cleared the invoice's balance.</p>}
              {(result.applied || []).map(a => <p key={a.invoiceId}>{fmtRmb(a.rmb)} of the credit applied to {a.invoiceId}.</p>)}
              {(result.unspentCredit || 0) > 0 && <p>{fmtRmb(result.unspentCredit || 0)} of credit is waiting for this vendor's next invoice.</p>}
            </div>
          )}
        </Card>
      )}
      <Card className="p-6">
        <form onSubmit={save} className="space-y-4">
          {error && <div role="alert" className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 rounded-lg text-rose-600 text-xs font-bold">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="dsc-date" className={labelClass}>Date *</label>
              <input id="dsc-date" type="date" required value={date} onChange={e => setDate(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="dsc-vendor" className={labelClass}>Vendor *</label>
              <select id="dsc-vendor" required value={vendor} onChange={e => { setVendor(e.target.value); setInvoiceId(''); }} className={inputClass}>
                <option value="">-- Select vendor --</option>
                {vendors.map(v => <option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name ? `${v.vendor_id} -- ${v.vendor_name}` : v.vendor_id}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="dsc-invoice" className={labelClass}>Invoice *</label>
            <select id="dsc-invoice" required value={invoiceId} onChange={e => setInvoiceId(e.target.value)} className={inputClass}>
              <option value="">-- Select invoice --</option>
              {vendorInvoices.map(i => (
                <option key={i.invoiceId} value={i.invoiceId}>
                  {`${i.invoiceId} · ${String(i.date).slice(0, 10)} · ${fmtRmb(i.rmb || 0)} · paid ${fmtRmb(Math.max(0, (i.rmb || 0) - invoiceBalance(i)))} · balance ${fmtRmb(invoiceBalance(i))}`}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="dsc-amount" className={labelClass}>Discount (RMB) *</label>
              <input id="dsc-amount" type="number" required min={0.01} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className={`${inputClass} font-mono`} />
            </div>
            <div>
              <label htmlFor="dsc-ref" className={labelClass}>Credit note / reference no. *</label>
              <input id="dsc-ref" type="text" required value={creditNoteNo} onChange={e => setCreditNoteNo(e.target.value)} className={`${inputClass} font-mono`} />
            </div>
          </div>
          <div>
            <label htmlFor="dsc-notes" className={labelClass}>Notes</label>
            <textarea id="dsc-notes" rows={2} maxLength={150} value={notes} onChange={e => setNotes(e.target.value)} className={inputClass} />
          </div>
          {preview && invoice && (
            <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3 text-sm space-y-1" data-testid="discount-preview">
              {preview.direct > 0 && <p>{fmtRmb(preview.direct)} clears {invoice.invoiceId}'s balance.</p>}
              {preview.credit > 0 && (preview.creditRate !== null
                ? <p>{fmtRmb(preview.credit)} becomes a credit at ₹{preview.creditRate.toFixed(4)} ({fmtInr(preview.creditInr || 0)}), applied to {vendor}'s next open invoices.</p>
                : <p className="text-amber-600">{fmtRmb(preview.credit)} would become a credit, but {invoice.invoiceId} has no payments to take a rate from.</p>)}
            </div>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={!canSave}>{isSubmitting ? 'Saving…' : 'Save discount'}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
