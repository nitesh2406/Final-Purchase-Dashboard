import type { PaymentLog, PurchaseInvoice, SettlementRecord } from '../../services/settlementService';

// Preview of a vendor discount for the Log Discount tab. Same rules as
// applyVendorDiscount_ in gas_clone/vendor_discounts.js; the backend
// recomputes and its figures are the ones stored.

const round2 = (n: number) => Math.round(n * 100) / 100;

// An invoice's unpaid RMB, as the backend reads it (its Balance column).
export function invoiceBalance(inv: Pick<PurchaseInvoice, 'rmb' | 'settledAmount' | 'balance'>): number {
  if (typeof inv.balance === 'number' && !isNaN(inv.balance)) return Math.max(0, inv.balance);
  return Math.max(0, (inv.rmb || 0) - (inv.settledAmount || 0));
}

// RMB-weighted settlement rate (ER2) of the rows that settled the invoice,
// leaving out the direct part of discounts on this same invoice. null when
// nothing has been paid on it.
export function invoicePaidRate(invoiceId: string, settlements: SettlementRecord[], payments: Pick<PaymentLog, 'paymentId' | 'sourceInvoice'>[]): number | null {
  const own = new Set(payments.filter(p => /^DSC-/i.test(p.paymentId || '') && (p.sourceInvoice || '') === invoiceId).map(p => p.paymentId));
  let rmb = 0, inr = 0;
  settlements.forEach(s => {
    if ((s.invoiceId || '').trim() !== invoiceId) return;
    if (s.paymentId && own.has(s.paymentId)) return;
    const r = Math.abs(s.amountRmb || 0), e = s.exchangeRateSettlement || 0;
    if (r > 0 && e > 0) { rmb += r; inr += r * e; }
  });
  return rmb > 0 ? inr / rmb : null;
}

export interface DiscountPreview { direct: number; credit: number; creditRate: number | null; creditInr: number | null }

export function previewDiscount(a: { invoice: PurchaseInvoice; amount: number; settlements: SettlementRecord[]; payments: Pick<PaymentLog, 'paymentId' | 'sourceInvoice'>[] }): DiscountPreview {
  const direct = round2(Math.min(a.amount, invoiceBalance(a.invoice)));
  const credit = round2(a.amount - direct);
  const creditRate = credit > 0 ? invoicePaidRate(a.invoice.invoiceId, a.settlements, a.payments) : null;
  return { direct, credit, creditRate, creditInr: creditRate !== null ? round2(credit * creditRate) : null };
}
