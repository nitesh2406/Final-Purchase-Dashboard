import React, { useMemo, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '../ui/Button';
import { useSubmissionLock } from '../../hooks/useSubmissionLock';
import {
  submitPurchaseInvoice,
  submitVendorAccount,
  IS_DEVELOPMENT_MODE,
  PurchaseInvoice,
  VendorMaster,
} from '../../services/settlementService';

// The one invoice entry form (Log Invoice tab). Was duplicated in AccountsView
// and SettlementLedger modals until 2026-09-29. Writes go through the sync
// queue (submitPurchaseInvoice); the backend prices the invoice (ER1/INR) and
// applies any unspent vendor payment when it lands.
interface InvoiceEntryFormProps {
  invoices: (PurchaseInvoice & { temp?: boolean })[];
  vendors: VendorMaster[];
  setPurchaseInvoices: React.Dispatch<React.SetStateAction<(PurchaseInvoice & { temp?: boolean })[]>>;
  onRefresh: () => Promise<void> | void;
}

const emptyForm = () => ({
  invoiceType: 'Goods' as 'Goods' | 'Ancillary',
  date: new Date().toISOString().split('T')[0],
  invoiceId: '',
  vendorCode: '',
  customVendorCode: '',
  customVendorName: '',
  rmb: '',
  notes: '',
});

const labelClass = 'block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5';
const inputClass = 'block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-950 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500';

export const InvoiceEntryForm: React.FC<InvoiceEntryFormProps> = ({ invoices, vendors, setPurchaseInvoices, onRefresh }) => {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { isSubmitting, withSubmissionGuard } = useSubmissionLock();
  const set = (k: keyof ReturnType<typeof emptyForm>) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  // Ancillary invoices are services paid through CNF, so only overseas (non-INR) vendors.
  const isAnc = form.invoiceType === 'Ancillary';
  const vendorOptions = useMemo(() => vendors
    .filter(v => !isAnc || v.currency !== 'INR')
    .map(v => ({
      code: v.vendor_id,
      displayText: v.vendor_name ? `${v.vendor_id} -- ${v.vendor_name}` : v.vendor_id,
    })), [vendors, isAnc]);

  const setType = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const invoiceType = e.target.value as 'Goods' | 'Ancillary';
    setForm(prev => {
      const vendor = vendors.find(v => v.vendor_id === prev.vendorCode);
      const clear = invoiceType === 'Ancillary' && vendor && vendor.currency === 'INR';
      return { ...prev, invoiceType, vendorCode: clear ? '' : prev.vendorCode };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    withSubmissionGuard(async () => {
      setError(null);
      setSuccess(null);

      const actualVendorCode = form.vendorCode === 'CUSTOM' ? form.customVendorCode.trim().toUpperCase() : form.vendorCode;
      const actualInvoiceId = form.invoiceId.trim().toUpperCase();
      if (!actualInvoiceId) { setError('Please provide a unique, descriptive Invoice ID.'); return; }
      if (!actualVendorCode) { setError('Vendor code cannot be empty.'); return; }
      const rmbValue = parseFloat(form.rmb);
      if (isNaN(rmbValue) || rmbValue <= 0) { setError('Amount in RMB must be a positive number.'); return; }
      if (form.invoiceType === 'Ancillary' && !form.notes.trim()) { setError('Say what the service was (Notes) for an ancillary invoice.'); return; }
      if (invoices.some(i => i.invoiceId.trim().toUpperCase() === actualInvoiceId)) {
        setError(`Invoice ID "${actualInvoiceId}" already exists database record.`);
        return;
      }

      if (form.vendorCode === 'CUSTOM') {
        const customName = form.customVendorName.trim();
        if (!actualVendorCode || !customName) { setError('Vendor ID and Vendor Name are required for custom manual input.'); return; }
        const exists = vendors.some(v => v.vendor_id.trim().toLowerCase() === actualVendorCode.toLowerCase());
        if (!exists) {
          try {
            const res = await submitVendorAccount({ vendor_id: actualVendorCode, vendor_name: customName });
            if (!res.success) { setError(`Failed to auto-register custom vendor: ${res.message}`); return; }
            await onRefresh();
          } catch (verr: any) {
            setError(`Vendor registration error: ${verr.message || verr}`);
            return;
          }
        }
      }

      const tempInvoice = {
        date: form.date,
        invoiceId: actualInvoiceId,
        vendorCode: actualVendorCode,
        rmb: rmbValue,
        notes: form.notes.trim() || undefined,
        invoiceType: form.invoiceType,
        status: 'Pending EOD' as const,
        settledAmount: 0,
        balance: rmbValue,
        id: actualInvoiceId,
        vendor: actualVendorCode,
        currency: 'CNY' as const,
      };
      const previousInvoices = [...invoices];

      if (!IS_DEVELOPMENT_MODE) {
        setPurchaseInvoices(prev => {
          const byId = new Map<string, PurchaseInvoice & { temp?: boolean }>();
          [{ ...tempInvoice, temp: true, createdAtTimestamp: Date.now() }, ...prev].forEach(item => {
            if (item && item.invoiceId) byId.set(String(item.invoiceId).trim().toLowerCase(), item);
          });
          return Array.from(byId.values());
        });
        setForm(emptyForm());
      }

      try {
        const response = await submitPurchaseInvoice({
          date: tempInvoice.date,
          invoiceId: tempInvoice.invoiceId,
          vendorCode: tempInvoice.vendorCode,
          rmb: tempInvoice.rmb,
          notes: tempInvoice.notes,
          invoiceType: tempInvoice.invoiceType,
        });
        if (!response.success) throw new Error(response.message || 'Invoice save propagation aborted.');
        setSuccess(`Invoice "${tempInvoice.invoiceId}" submitted — queued and syncing to the centralized ledger pipeline.`);
        if (IS_DEVELOPMENT_MODE) setForm(emptyForm());
        await onRefresh();
      } catch (err) {
        console.error('Invoice registration write error: ', err);
        if (!IS_DEVELOPMENT_MODE) setPurchaseInvoices(previousInvoices);
        setError('Sync Failure: Transaction could not be written to Google Sheets. Please check your connection and try again.');
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div role="alert" className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-lg text-rose-600 dark:text-rose-400 text-xs font-bold">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 rounded-lg text-emerald-700 dark:text-emerald-300 text-xs font-bold">
          {success}
        </div>
      )}
      <div>
        <label htmlFor="inv-type" className={labelClass}>Invoice type *</label>
        <select id="inv-type" value={form.invoiceType} onChange={setType} className={inputClass}>
          <option value="Goods">Goods</option>
          <option value="Ancillary">Ancillary (service paid through CNF)</option>
        </select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="inv-date" className={labelClass}>Invoice Date *</label>
          <input id="inv-date" type="date" required value={form.date} onChange={set('date')} className={inputClass} />
        </div>
        <div>
          <label htmlFor="inv-id" className={labelClass}>Invoice ID *</label>
          <input id="inv-id" type="text" required maxLength={30} placeholder="e.g. INV-2026-621" value={form.invoiceId} onChange={set('invoiceId')} className={`${inputClass} font-mono uppercase`} />
        </div>
      </div>
      <div>
        <label htmlFor="inv-vendor" className={labelClass}>Vendor *</label>
        <select id="inv-vendor" required value={form.vendorCode} onChange={set('vendorCode')} className={inputClass}>
          <option value="">-- Select vendor --</option>
          {vendorOptions.map(v => <option key={v.code} value={v.code}>{v.displayText}</option>)}
          <option value="CUSTOM">[ New vendor ]</option>
        </select>
      </div>
      {form.vendorCode === 'CUSTOM' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-3">
          <div>
            <label htmlFor="inv-new-code" className={labelClass}>New vendor code *</label>
            <input id="inv-new-code" type="text" required placeholder="e.g. ABC" value={form.customVendorCode} onChange={set('customVendorCode')} className={`${inputClass} font-mono uppercase`} />
          </div>
          <div>
            <label htmlFor="inv-new-name" className={labelClass}>New vendor name *</label>
            <input id="inv-new-name" type="text" required placeholder="e.g. ABC Sourcing" value={form.customVendorName} onChange={set('customVendorName')} className={inputClass} />
          </div>
        </div>
      )}
      <div>
        <label htmlFor="inv-rmb" className={labelClass}>Amount (RMB) *</label>
        <input id="inv-rmb" type="number" required min={0.01} step="0.01" max={99999999} placeholder="e.g. 145000" value={form.rmb} onChange={set('rmb')} className={`${inputClass} font-mono font-bold`} />
      </div>
      <div>
        <label htmlFor="inv-notes" className={labelClass}>{isAnc ? 'What was the service? *' : 'Notes'}</label>
        <textarea id="inv-notes" rows={2} maxLength={150} required={isAnc} value={form.notes} onChange={set('notes')} className={inputClass} />
      </div>
      <div className="bg-amber-50 dark:bg-slate-900 p-3.5 rounded-xl border border-amber-200/60 dark:border-slate-800 flex items-start gap-2 text-slate-500 dark:text-slate-400">
        <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <span className="text-[11px] leading-relaxed">
          {isAnc
            ? 'Paid through CNF. CNF bills the INR paid + CNF GST, no commission. Only overseas vendors can have ancillary invoices.'
            : "ER1 and INR are filled in automatically from the invoice date's rate, and any unspent payment to this vendor is applied to the invoice."}
        </span>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving Invoice...' : 'Publish Invoice'}</Button>
      </div>
    </form>
  );
};
