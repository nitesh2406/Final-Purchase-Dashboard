export interface InvoiceSplit {
  purchase: number;
  serviceCharge: number;
  totalMismatch: boolean;
  negativeService: boolean;
  needsOverride: boolean;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// Same rule the backend enforces in logCnfGoodsInvoice_: Base + GST must be
// within ₹1 of Total, and a negative service charge needs an override too.
export function computeInvoiceSplit(input: { lineAmounts: number[]; baseAmount: number; gst: number; total: number }): InvoiceSplit {
  const purchase = round2(input.lineAmounts.reduce((s, a) => s + (Number(a) || 0), 0));
  const serviceCharge = round2(input.baseAmount - purchase);
  const totalMismatch = Math.abs(input.baseAmount + input.gst - input.total) >= 1;
  const negativeService = serviceCharge < 0;
  return { purchase, serviceCharge, totalMismatch, negativeService, needsOverride: totalMismatch || negativeService };
}
