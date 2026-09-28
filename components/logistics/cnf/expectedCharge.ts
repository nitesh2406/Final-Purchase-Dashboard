import type { Batch, CnfCommissionRate, CnfAirRateCategory, CnfShipmentPartnerDefault } from '../../../types';

export interface ExpectedCnfCharge {
  amount: number | null;
  categoryLabel: string | null;
  note: string;
}

type BatchForCharge = Pick<Batch, 'batch_type' | 'carrier' | 'total_value_rmb' | 'blended_settlement_rate' | 'total_weight_kg'>;

const norm = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const round2 = (n: number) => Math.round(n * 100) / 100;

// Estimate of CNF's service charge for a batch (pre-GST, excluding goods),
// from Settings > CNF rates. Only a sanity check next to the service charge
// on CNF's actual invoice. Category: the carrier's shipment-partner default;
// failing that, the only category for the mode if exactly one exists.
export function computeExpectedCnfCharge(
  batch: BatchForCharge,
  seaRates: CnfCommissionRate[],
  airCategories: CnfAirRateCategory[],
  partnerDefaults: CnfShipmentPartnerDefault[]
): ExpectedCnfCharge {
  const isAir = batch.batch_type === 'air';
  const pool: { id: string; label: string }[] = isAir ? airCategories : seaRates;
  const carrier = norm(batch.carrier || '');
  const def = carrier ? partnerDefaults.find(d => norm(d.partner) === carrier) : undefined;
  const category = (def && pool.find(c => c.id === def.defaultCategoryId)) || (pool.length === 1 ? pool[0] : undefined);
  if (!category) {
    return { amount: null, categoryLabel: null, note: `Set a ${isAir ? 'Air' : 'Sea'} default category for this carrier in Settings` };
  }
  if (isAir) {
    const cat = category as CnfAirRateCategory;
    if (batch.total_weight_kg == null) return { amount: null, categoryLabel: cat.label, note: 'Weight not recorded yet' };
    return { amount: round2(batch.total_weight_kg * cat.ratePerKg), categoryLabel: cat.label, note: `${batch.total_weight_kg} kg × ₹${cat.ratePerKg}/kg` };
  }
  const cat = category as CnfCommissionRate;
  if (batch.blended_settlement_rate == null) return { amount: null, categoryLabel: cat.label, note: 'Known once the batch is paid' };
  const goodsInr = (batch.total_value_rmb || 0) * batch.blended_settlement_rate;
  return { amount: round2(goodsInr * cat.ratePct / 100), categoryLabel: cat.label, note: `${cat.ratePct}% of goods value` };
}
