import React, { useMemo, useRef, useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { getSessionAuthHeaders } from '../../../services/authToken';
import { logPartnerBill } from '../../../services/shippingPartnerService';
import type { ShippingPartner } from '../../../types';
import { fmtInr } from '../../logistics/cnf/cnfFormat';
import { checkPartnerBill, PARTNER_GST_PCT, todayIst } from './partnerBill';

// Same shared Drive uploader as the CNF invoice modal ("CNF Invoices" folder).
const UPLOAD_ENDPOINT = '/api/drive/upload-cnf-invoice';
const num = (s: string) => parseFloat(s) || 0;
// Google sometimes drops a finished write's result ("server took too long").
export const mayHaveSaved = (msg: string) =>
  /took too long/i.test(msg) ? `${msg} It may still have saved: close this, refresh and check before trying again.` : msg;

// Log a partner's bill for one of its air batches. The figures are a
// preview; the backend re-checks everything and stores the partner's rate.
export const LogPartnerBillModal: React.FC<{
  partner: ShippingPartner;
  batchIds: string[]; // this partner's batches without a live bill
  weights: Record<string, number | null>; // batch weight from Receive Shipment, if recorded
  onClose: () => void;
  onSaved: () => void;
}> = ({ partner, batchIds, weights, onClose, onSaved }) => {
  const weightOf = (id: string) => (weights[id] != null ? String(weights[id]) : '');
  const [batchId, setBatchId] = useState(batchIds[0] ?? '');
  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(todayIst());
  const [weight, setWeight] = useState(weightOf(batchIds[0] ?? ''));
  const [fee, setFee] = useState('');
  const [gst, setGst] = useState<string | null>(null);     // null = follow 18% of the fee
  const [total, setTotal] = useState<string | null>(null); // null = follow fee + GST
  const [overrideReason, setOverrideReason] = useState('');
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileToken = useRef(0);

  const gstValue = gst ?? (fee ? String(Math.round(num(fee) * PARTNER_GST_PCT) / 100) : '');
  const totalValue = total ?? (fee ? String(Math.round((num(fee) + num(gstValue)) * 100) / 100) : '');
  const check = useMemo(
    () => checkPartnerBill({ weightKg: num(weight), ratePerKg: partner.ratePerKg, fee: num(fee), gst: num(gstValue), total: num(totalValue) }),
    [weight, partner.ratePerKg, fee, gstValue, totalValue]
  );
  const canSave = !!batchId && billNo.trim() !== '' && /^\d{4}-\d{2}-\d{2}$/.test(billDate) && !!fileUrl && !isUploading &&
    num(weight) > 0 && num(fee) > 0 && num(gstValue) >= 0 && num(totalValue) > 0 &&
    (!check.needsOverride || overrideReason.trim() !== '') && !saving;

  const pickBatch = (id: string) => { setBatchId(id); setWeight(weightOf(id)); };

  const handleFile = async (f: File | null) => {
    setError(null);
    setFileUrl(null);
    if (!f) return;
    const token = ++fileToken.current;
    setIsUploading(true);
    try {
      const form = new FormData();
      form.append('file', f);
      const resp = await fetch(UPLOAD_ENDPOINT, { method: 'POST', headers: getSessionAuthHeaders(), body: form });
      const data = await resp.json();
      if (token !== fileToken.current) return;
      if (data.success) setFileUrl(data.file.viewUrl);
      else setError(data.error || 'Failed to upload the bill file');
    } catch (err: any) {
      if (token === fileToken.current) setError(err.message || 'Failed to upload the bill file');
    } finally {
      if (token === fileToken.current) setIsUploading(false);
    }
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await logPartnerBill({
        partnerId: partner.id, batchId, billNo: billNo.trim(), billDate, fileUrl: fileUrl as string,
        weightKg: num(weight), fee: num(fee), gst: num(gstValue), total: num(totalValue),
        overrideReason: overrideReason.trim() || undefined,
      });
      onSaved();
    } catch (err: any) {
      setError(mayHaveSaved(err.message || 'Failed to log the bill'));
    } finally {
      setSaving(false);
    }
  };

  const label = 'text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5';
  const input = 'w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-900';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-[200] p-4 overflow-y-auto">
      <Card className="p-6 space-y-4 w-full max-w-lg my-8">
        <h3 className="text-lg font-semibold">Log bill · {partner.name}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={label}>Air batch</label>
            <select aria-label="Batch" value={batchId} onChange={e => pickBatch(e.target.value)} className={input}>
              {batchIds.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Bill number</label>
            <input aria-label="Bill number" value={billNo} onChange={e => setBillNo(e.target.value)} className={`${input} font-mono`} />
          </div>
          <div>
            <label className={label}>Bill date</label>
            <input type="date" aria-label="Bill date" value={billDate} onChange={e => setBillDate(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Weight (kg)</label>
            <input type="number" step="0.01" aria-label="Weight" value={weight} onChange={e => setWeight(e.target.value)} className={input} />
            <p className="text-[10px] text-slate-400 mt-1">From the batch; change it to the chargeable weight on the bill.</p>
          </div>
          <div>
            <label className={label}>Rate (₹ per kg)</label>
            <div className="px-3 py-2 text-sm font-mono">{fmtInr(partner.ratePerKg)}</div>
          </div>
          <div>
            <label className={label}>Fee</label>
            <input type="number" step="0.01" aria-label="Fee" value={fee} onChange={e => setFee(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>GST ({PARTNER_GST_PCT}% of fee)</label>
            <input type="number" step="0.01" aria-label="GST" value={gstValue} onChange={e => setGst(e.target.value)} className={input} />
          </div>
          <div className="col-span-2">
            <label className={label}>Total on the bill</label>
            <input type="number" step="0.01" aria-label="Total" value={totalValue} onChange={e => setTotal(e.target.value)} className={input} />
          </div>
          <div className="col-span-2">
            <label className={label}>Bill file</label>
            <input type="file" aria-label="Bill file" accept="application/pdf,image/*" onChange={e => handleFile(e.target.files?.[0] ?? null)} className="text-sm" />
            {isUploading && <p className="text-xs text-slate-400 mt-1">Uploading…</p>}
            {fileUrl && !isUploading && <p className="text-xs text-emerald-600 mt-1">File attached.</p>}
          </div>
        </div>
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 grid grid-cols-2 gap-2 text-sm" data-testid="partner-bill-check">
          <span className="text-slate-400">Expected fee ({num(weight)} kg × {fmtInr(partner.ratePerKg)})</span>
          <span className="text-right font-mono">{fmtInr(check.expectedFee)}</span>
          <span className="text-slate-400">Fee on the bill</span>
          <span className="text-right font-mono">{fmtInr(num(fee))}</span>
        </div>
        {check.feeOff && num(fee) > 0 && <p className="text-xs text-amber-600">The fee differs from the expected fee by ₹1 or more.</p>}
        {check.totalOff && num(fee) > 0 && <p className="text-xs text-amber-600">Fee + GST doesn't match the total.</p>}
        {check.needsOverride && num(fee) > 0 && (
          <div>
            <label className={label}>Override reason</label>
            <textarea aria-label="Override reason" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} className={input} rows={2} />
          </div>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!canSave}>{saving ? 'Saving…' : 'Save bill'}</Button>
        </div>
      </Card>
    </div>
  );
};
