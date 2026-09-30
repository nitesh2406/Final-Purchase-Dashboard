import React, { useMemo, useState } from 'react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { saveCnfDraftInvoice } from '../../../services/cnfService';
import type { Batch, CnfCommissionRate, CnfDraftInvoice } from '../../../types';
import { computeDraftInvoice, computeDraftAdjustment, initialDraftCategoryId } from './draftInvoice';
import { defaultSeaCategory } from './expectedCharge';
import { fmtInr } from './cnfFormat';

// Generate / regenerate a batch's draft CNF invoice. The figures here are a
// preview; the backend recomputes and stores them on save. Sea: pick a Sea
// rate category (% of goods). Air shipped by KREIZ: KREIZ's ₹/kg from
// Settings × the batch weight, both editable. Air shipped by another
// partner: goods + GST only.
export const CnfDraftInvoiceModal: React.FC<{
  batch: Batch;
  goodsValue: number;
  igstPct: number;
  seaRates: CnfCommissionRate[];
  kreizAirRate: number | null; // Settings → Air rate per shipping partner (KREIZ)
  existing?: CnfDraftInvoice;
  partnerShipped?: boolean; // air batch shipped by a partner other than KREIZ
  partnerName?: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ batch, goodsValue, igstPct, seaRates, kreizAirRate, existing, partnerShipped, partnerName, onClose, onSaved }) => {
  const isAir = batch.batch_type === 'air';
  const rateOf = (id: string) => {
    const c = seaRates.find(x => x.id === id);
    return c ? String(c.ratePct) : '';
  };
  const initialId = isAir ? '' : initialDraftCategoryId(existing?.categoryId, seaRates, defaultSeaCategory(seaRates)?.id);
  const [categoryId, setCategoryId] = useState(initialId);
  // Sea keeps the draft's own (possibly edited) rate only while its category
  // still exists. Air (KREIZ) keeps a saved KREIZ draft's rate, else Settings'.
  // (Air drafts saved before shipping partners existed carry no partner id: KREIZ.)
  const keepAirRate = isAir && !!existing && (existing.shippingPartnerId || 'KREIZ') === 'KREIZ' && existing.rate > 0;
  const [rate, setRate] = useState(isAir
    ? (keepAirRate ? String(existing!.rate) : (kreizAirRate ? String(kreizAirRate) : ''))
    : (existing && initialId === existing.categoryId ? String(existing.rate) : rateOf(initialId)));
  const batchWeight = Number(batch.total_weight_kg) || 0;
  const [weight, setWeight] = useState(String(existing?.weightKg ?? (batchWeight > 0 ? batchWeight : '')));
  // Adjustment (₹, + or −) to match an invoice worked out by hand on an old
  // manual ER; a saved draft's own adjustment and reason are kept.
  const [adjustment, setAdjustment] = useState(existing?.adjustment ? String(existing.adjustment) : '');
  const [adjustmentReason, setAdjustmentReason] = useState(existing?.adjustment ? existing.adjustmentReason || '' : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const rateNum = parseFloat(rate) || 0;
  const weightNum = parseFloat(weight) || 0;
  // Shipped by another partner: KREIZ bills goods + GST only, no CNF charge.
  const figures = useMemo(
    () => computeDraftInvoice({ mode: isAir ? 'air' : 'sea', goods: goodsValue, rate: partnerShipped ? 0 : rateNum, weightKg: isAir && !partnerShipped ? weightNum : null, igstPct }),
    [isAir, goodsValue, rateNum, weightNum, igstPct, partnerShipped]
  );
  const adjText = adjustment.trim();
  const adjValid = adjText === '' || isFinite(Number(adjText));
  const adjNum = adjValid && adjText !== '' ? Math.round(Number(adjText) * 100) / 100 : 0;
  const adj = computeDraftAdjustment(goodsValue, figures.charge, figures.gst, adjNum);
  const adjustedTotal = Math.round((figures.total + adjNum) * 100) / 100;
  const adjProblem = !adjValid ? 'Enter the adjustment as a number, e.g. -1181.25' : adjustedTotal <= 0 ? 'The adjustment would take the total to 0 or below' : null;
  const canSave = !saving && !adjProblem && (!!partnerShipped || (isAir ? rateNum > 0 && weightNum > 0 : !!categoryId && rateNum > 0));

  const pick = (id: string) => { setCategoryId(id); setRate(rateOf(id)); };
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const adjustmentFields = { adjustment: adjNum, adjustmentReason: adjNum ? adjustmentReason.trim() : '' };
      await saveCnfDraftInvoice(partnerShipped
        ? { batchId: batch.batch_id, categoryId: '', rate: 0, weightKg: null, ...adjustmentFields }
        : { batchId: batch.batch_id, categoryId: isAir ? '' : categoryId, rate: rateNum, weightKg: isAir ? weightNum : null, ...adjustmentFields });
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to save the draft invoice');
    } finally {
      setSaving(false);
    }
  };

  const label = 'text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5';
  const input = 'w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-slate-900';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-[200] p-4 overflow-y-auto">
      <Card className="p-6 space-y-4 w-full max-w-lg my-8">
        <h3 className="text-lg font-semibold">{existing ? 'Regenerate' : 'Generate'} Draft Invoice · {batch.batch_id}</h3>
        <p className="text-xs text-slate-400">
          {partnerShipped
            ? "What CNF's tax invoice for this batch should come to: goods paid + GST on goods."
            : "What CNF's tax invoice for this batch should come to: goods paid + CNF charge + GST on both."}
        </p>
        {partnerShipped ? (
          <p className="text-sm text-slate-600 dark:text-slate-300" data-testid="cnf-draft-partner-note">
            Shipped by {partnerName}: CNF bills goods + GST only, with no CNF charge. {partnerName} bills its own fee on the Ledgers screen.
          </p>
        ) : isAir ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Rate (₹ per kg)</label>
              <input type="number" step="0.01" aria-label="Rate" value={rate} onChange={e => setRate(e.target.value)} className={input} />
              <p className="text-[10px] text-slate-400 mt-1" data-testid="cnf-draft-rate-source">
                {kreizAirRate ? `KREIZ's rate in Settings: ${fmtInr(kreizAirRate)}/kg` : 'No KREIZ air rate in Settings yet; enter it here.'}
              </p>
            </div>
            <div>
              <label className={label}>Weight (kg)</label>
              <input type="number" step="0.01" aria-label="Weight" value={weight} onChange={e => setWeight(e.target.value)} className={input} />
              <p className="text-[10px] text-slate-400 mt-1">Sum of the batch's shipment weights; change it to the chargeable weight.</p>
            </div>
          </div>
        ) : seaRates.length === 0 ? (
          <p className="text-sm text-amber-600">Add a Sea rate category in Settings first.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={label}>Rate category</label>
              <select aria-label="Rate category" value={categoryId} onChange={e => pick(e.target.value)} className={input}>
                <option value="">Choose…</option>
                {seaRates.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Rate (% of goods)</label>
              <input type="number" step="0.01" aria-label="Rate" value={rate} onChange={e => setRate(e.target.value)} className={input} />
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Adjustment (₹)</label>
            <input type="number" step="0.01" aria-label="Adjustment" placeholder="0" value={adjustment} onChange={e => setAdjustment(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Adjustment reason <span className="normal-case font-normal">(optional)</span></label>
            <input type="text" aria-label="Adjustment reason" placeholder="e.g. matches KR/123, manual ER" value={adjustmentReason} onChange={e => setAdjustmentReason(e.target.value)} className={input} disabled={!adjNum} />
          </div>
          <p className="col-span-2 text-[10px] text-slate-400 -mt-1">
            + or − on the total, e.g. to match an invoice worked out by hand on an old ER. Split in proportion between goods, charge and GST.
          </p>
          {adjProblem && <p className="col-span-2 text-xs text-red-500" data-testid="cnf-draft-adj-problem">{adjProblem}</p>}
        </div>
        {adjNum === 0 || adjProblem ? (
          <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 grid grid-cols-2 gap-2 text-sm" data-testid="cnf-draft-figures">
            <span className="text-slate-400">Goods paid</span><span className="text-right font-mono">{fmtInr(goodsValue)}</span>
            <span className="text-slate-400">CNF charge</span><span className="text-right font-mono">{fmtInr(figures.charge)}</span>
            <span className="text-slate-400">GST ({igstPct}% on goods{partnerShipped ? '' : ' + charge'})</span><span className="text-right font-mono">{fmtInr(figures.gst)}</span>
            <span className="font-semibold">Expected total</span><span className="text-right font-mono font-semibold">{fmtInr(figures.total)}</span>
          </div>
        ) : (
          <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 grid grid-cols-4 gap-x-3 gap-y-2 text-sm" data-testid="cnf-draft-figures">
            <span></span>
            <span className="text-right text-[10px] uppercase tracking-wider text-slate-400">Computed</span>
            <span className="text-right text-[10px] uppercase tracking-wider text-slate-400">Adjustment</span>
            <span className="text-right text-[10px] uppercase tracking-wider text-slate-400">Adjusted</span>
            {[
              ['Goods paid', goodsValue, adj.goods],
              ['CNF charge', figures.charge, adj.charge],
              [`GST (${igstPct}%)`, figures.gst, adj.gst],
            ].map(([name, base, delta]) => (
              <React.Fragment key={name as string}>
                <span className="text-slate-400">{name}</span>
                <span className="text-right font-mono">{fmtInr(base as number)}</span>
                <span className="text-right font-mono">{fmtInr(delta as number)}</span>
                <span className="text-right font-mono">{fmtInr((base as number) + (delta as number))}</span>
              </React.Fragment>
            ))}
            <span className="font-semibold">Expected total</span>
            <span className="text-right font-mono">{fmtInr(figures.total)}</span>
            <span className="text-right font-mono">{fmtInr(adjNum)}</span>
            <span className="text-right font-mono font-semibold">{fmtInr(adjustedTotal)}</span>
          </div>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!canSave}>{saving ? 'Saving…' : 'Save draft'}</Button>
        </div>
      </Card>
    </div>
  );
};
