import React, { useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { saveShippingPartner } from '../../../services/shippingPartnerService';

// Same pattern as SP_GSTIN_RE_ in gas_clone/shipping_partners.js (the server re-checks).
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export interface PartnerFormValues { id: string; name: string; gstin: string; ratePerKg: number; active: boolean }

// Create a shipping partner (no `existing`) or edit one.
export const ShippingPartnerModal: React.FC<{
  existing?: PartnerFormValues;
  onClose: () => void;
  onSaved: () => void;
}> = ({ existing, onClose, onSaved }) => {
  const [name, setName] = useState(existing?.name ?? '');
  const [gstin, setGstin] = useState(existing?.gstin ?? '');
  const [rate, setRate] = useState(existing ? String(existing.ratePerKg) : '');
  const [active, setActive] = useState(existing?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const gstinUpper = gstin.trim().toUpperCase();
  const gstinOk = gstinUpper === '' || GSTIN_RE.test(gstinUpper);
  const rateNum = parseFloat(rate) || 0;
  const canSave = name.trim() !== '' && gstinOk && rateNum > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await saveShippingPartner({ id: existing?.id, name: name.trim(), gstin: gstinUpper, ratePerKg: rateNum, active });
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to save the partner');
    } finally {
      setSaving(false);
    }
  };

  const label = 'text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5';
  const input = 'w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-900';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-[200] p-4 overflow-y-auto">
      <Card className="p-6 space-y-4 w-full max-w-md my-8">
        <h3 className="text-lg font-semibold">{existing ? `Edit ${existing.name}` : 'Add shipping partner'}</h3>
        <div>
          <label className={label}>Name</label>
          <input aria-label="Partner name" value={name} onChange={e => setName(e.target.value)} className={input} />
        </div>
        <div>
          <label className={label}>GSTIN (optional)</label>
          <input aria-label="GSTIN" value={gstin} onChange={e => setGstin(e.target.value)} className={`${input} font-mono uppercase`} />
          {!gstinOk && <p className="text-xs text-red-500 mt-1">Not a valid 15-character GSTIN.</p>}
        </div>
        <div>
          <label className={label}>Rate (₹ per kg)</label>
          <input type="number" step="0.01" aria-label="Rate per kg" value={rate} onChange={e => setRate(e.target.value)} className={input} />
          {existing && <p className="text-xs text-slate-400 mt-1">A new rate applies to bills logged from now on; existing bills keep theirs.</p>}
        </div>
        {existing && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" aria-label="Active" checked={active} onChange={e => setActive(e.target.checked)} />
            Active (offered in the batch partner dropdown)
          </label>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!canSave}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </Card>
    </div>
  );
};
