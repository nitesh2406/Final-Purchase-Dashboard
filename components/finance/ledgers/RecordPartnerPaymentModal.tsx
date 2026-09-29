import React, { useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { logPartnerPayment } from '../../../services/shippingPartnerService';
import type { PartnerBill, PartnerPayment } from '../../../types';
import { fmtInr } from '../../logistics/cnf/cnfFormat';
import { paymentFits, todayIst } from './partnerBill';
import { mayHaveSaved } from './LogPartnerBillModal';

const num = (s: string) => parseFloat(s) || 0;

// Record a payment against one approved bill: amount + TDS up to its balance.
// The bill's existing payments are listed so a retry after a lost response
// doesn't record the same payment twice unnoticed.
export const RecordPartnerPaymentModal: React.FC<{
  bill: PartnerBill;
  payments: PartnerPayment[]; // this bill's payments
  onClose: () => void;
  onSaved: () => void;
}> = ({ bill, payments, onClose, onSaved }) => {
  const [date, setDate] = useState(todayIst());
  const [amount, setAmount] = useState(String(bill.balance));
  const [tds, setTds] = useState('0');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fits = paymentFits(bill.balance, num(amount), num(tds));
  const canSave = fits && /^\d{4}-\d{2}-\d{2}$/.test(date) && !saving;
  const after = Math.round((bill.balance - num(amount) - num(tds)) * 100) / 100;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await logPartnerPayment({ billId: bill.id, date, amount: num(amount), tds: num(tds), reference: reference.trim(), notes: notes.trim() });
      onSaved();
    } catch (err: any) {
      setError(mayHaveSaved(err.message || 'Failed to record the payment'));
    } finally {
      setSaving(false);
    }
  };

  const label = 'text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5';
  const input = 'w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-900';
  const recent = [...payments].sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1)).slice(0, 5);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-[200] p-4 overflow-y-auto">
      <Card className="p-6 space-y-4 w-full max-w-md my-8">
        <h3 className="text-lg font-semibold">Record payment · bill {bill.billNo}</h3>
        <p className="text-sm text-slate-500">Balance on this bill: <span className="font-mono font-semibold">{fmtInr(bill.balance)}</span> of {fmtInr(bill.total)}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Date</label>
            <input type="date" aria-label="Payment date" value={date} onChange={e => setDate(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Amount paid</label>
            <input type="number" step="0.01" aria-label="Amount" value={amount} onChange={e => setAmount(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>TDS deducted</label>
            <input type="number" step="0.01" aria-label="TDS" value={tds} onChange={e => setTds(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Reference (UTR)</label>
            <input aria-label="Reference" value={reference} onChange={e => setReference(e.target.value)} className={input} />
          </div>
          <div className="col-span-2">
            <label className={label}>Notes</label>
            <input aria-label="Notes" value={notes} onChange={e => setNotes(e.target.value)} className={input} />
          </div>
        </div>
        {fits ? (
          <p className="text-xs text-slate-500">Left on the bill after this: <span className="font-mono">{fmtInr(after)}</span></p>
        ) : (
          <p className="text-xs text-red-500">Amount must be above 0, TDS 0 or more, and together no more than the balance.</p>
        )}
        {recent.length > 0 && (
          <div className="text-xs text-slate-500 border-t pt-3">
            <div className="font-semibold mb-1">Already recorded on this bill</div>
            {recent.map(pm => (
              <div key={pm.id} className={pm.status === 'Voided' ? 'line-through text-slate-400' : ''}>
                {pm.date} · {fmtInr(pm.amount)}{pm.tds ? ` + TDS ${fmtInr(pm.tds)}` : ''}{pm.reference ? ` · ${pm.reference}` : ''}
              </div>
            ))}
          </div>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!canSave}>{saving ? 'Saving…' : 'Save payment'}</Button>
        </div>
      </Card>
    </div>
  );
};
