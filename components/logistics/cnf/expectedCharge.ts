import type { Batch, CnfCommissionRate } from '../../../types';

export interface ExpectedCnfCharge {
  amount: number | null;
  categoryLabel: string | null;
  note: string;
}

type BatchForCharge = Pick<Batch, 'batch_type' | 'total_value_rmb' | 'blended_settlement_rate' | 'total_weight_kg'>;

// Who ships an air batch and at what ₹/kg. partnerId '' = not set yet,
// 'KREIZ' = CNF ships it at kreizRatePerKg (Settings → Air rate per shipping
// partner), anything else = that partner at partnerRatePerKg.
export interface AirChargeContext {
  partnerId: string;
  kreizRatePerKg: number | null;
  partnerRatePerKg?: number | null;
  partnerName?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const kg = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// The Sea category a draft starts on: the only one, when exactly one exists.
export function defaultSeaCategory(seaRates: CnfCommissionRate[]): CnfCommissionRate | undefined {
  return seaRates.length === 1 ? seaRates[0] : undefined;
}

// Estimate of CNF's service charge for a batch (pre-GST, excluding goods),
// from Settings. Only a sanity check next to the service charge on CNF's
// actual invoice. Sea: % of goods for the single Sea category. Air: weight ×
// KREIZ's ₹/kg when KREIZ ships it; ₹0 when another partner does (that
// partner bills its own fee, shown in the note).
export function computeExpectedCnfCharge(batch: BatchForCharge, seaRates: CnfCommissionRate[], air: AirChargeContext): ExpectedCnfCharge {
  const weight = Number(batch.total_weight_kg) || 0;
  if (batch.batch_type === 'air') {
    if (!air.partnerId) return { amount: null, categoryLabel: null, note: 'Set shipping partner' };
    if (air.partnerId !== 'KREIZ') {
      const rate = Number(air.partnerRatePerKg) || 0;
      const fee = weight > 0 && rate > 0 ? ` · ${air.partnerName || air.partnerId} fee ≈ ${inr(round2(weight * rate))} (${kg(weight)} kg × ${inr(rate)}/kg)` : '';
      return { amount: 0, categoryLabel: null, note: `partner-shipped: no CNF charge${fee}` };
    }
    if (!(Number(air.kreizRatePerKg) > 0)) return { amount: null, categoryLabel: 'KREIZ', note: 'Set the KREIZ air rate in Settings' };
    const rate = Number(air.kreizRatePerKg);
    if (!(weight > 0)) return { amount: null, categoryLabel: 'KREIZ', note: `Weight not recorded yet (0 kg × ${inr(rate)}/kg)` };
    return { amount: round2(weight * rate), categoryLabel: 'KREIZ', note: `${kg(weight)} kg × ${inr(rate)}/kg` };
  }
  const cat = defaultSeaCategory(seaRates);
  if (!cat) return { amount: null, categoryLabel: null, note: seaRates.length ? 'Sea category is picked on the draft invoice' : 'Add a Sea rate category in Settings' };
  if (batch.blended_settlement_rate == null) return { amount: null, categoryLabel: cat.label, note: 'Known once the batch is paid' };
  const goodsInr = (batch.total_value_rmb || 0) * batch.blended_settlement_rate;
  return { amount: round2(goodsInr * cat.ratePct / 100), categoryLabel: cat.label, note: `${cat.ratePct}% of goods value` };
}
