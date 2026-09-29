import type { BatchShippingPartner, PartnerBill } from '../../../types';

// A shipping partner's bill is its fee + 18% GST.
export const PARTNER_GST_PCT = 18;

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface PartnerBillCheck {
  expectedFee: number; // weight × the partner's ₹/kg
  defaultGst: number;  // 18% of the fee, what the GST field starts at
  feeOff: boolean;     // fee differs from expected by ₹1 or more
  totalOff: boolean;   // fee + GST differs from total by ₹1 or more
  needsOverride: boolean;
}

// Same rule as logPartnerBill_ in gas_clone/shipping_partners.js, which
// re-checks on save — this is the form's live preview.
export function checkPartnerBill(i: { weightKg: number; ratePerKg: number; fee: number; gst: number; total: number }): PartnerBillCheck {
  const expectedFee = round2(i.weightKg * i.ratePerKg);
  const defaultGst = round2(i.fee * PARTNER_GST_PCT / 100);
  const feeOff = Math.abs(i.fee - expectedFee) >= 1;
  const totalOff = Math.abs(i.fee + i.gst - i.total) >= 1;
  return { expectedFee, defaultGst, feeOff, totalOff, needsOverride: feeOff || totalOff };
}

// Same rule as logPartnerPayment_: amount > 0, TDS ≥ 0, amount + TDS ≤ balance.
export function paymentFits(balance: number, amount: number, tds: number): boolean {
  return amount > 0 && tds >= 0 && amount + tds <= balance + 0.01;
}

// This partner's batches that can take a new bill: assigned to it, with no
// pending or approved bill.
export function billableBatchIds(partnerId: string, assignments: BatchShippingPartner[], bills: Pick<PartnerBill, 'batchId' | 'status'>[]): string[] {
  const billed = new Set(bills.filter(b => b.status !== 'Rejected').map(b => b.batchId));
  return assignments.filter(a => a.partnerId === partnerId && !billed.has(a.batchId)).map(a => a.batchId).sort();
}

// Today's date in India time, yyyy-mm-dd (the default bill / payment date).
export const todayIst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
