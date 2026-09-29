export interface InvoiceSplit {
  purchase: number;
  serviceCharge: number;
  expectedGst: number | null; // base × CNF GST %, when the % is known
  totalMismatch: boolean;
  negativeService: boolean;
  gstOff: boolean;
  ancillaryCharge: boolean;  // a service charge on an ancillary invoice
  partnerCharge: boolean;    // a service charge on partner-shipped goods
  needsOverride: boolean;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// Same rules the backend enforces in logCnfGoodsInvoice_: each flag needs an
// override reason to save. gstPct is the CNF GST % (Settings); without it the
// GST check is skipped (the server still makes it).
export function computeInvoiceSplit(input: {
  lineAmounts: number[]; baseAmount: number; gst: number; total: number;
  kind?: 'Goods' | 'Ancillary'; gstPct?: number; partnerShippedOnly?: boolean;
}): InvoiceSplit {
  const ancillary = input.kind === 'Ancillary';
  const purchase = round2(input.lineAmounts.reduce((s, a) => s + (Number(a) || 0), 0));
  const serviceCharge = round2(input.baseAmount - purchase);
  const expectedGst = input.gstPct === undefined ? null : round2(input.baseAmount * input.gstPct / 100);
  const totalMismatch = Math.abs(input.baseAmount + input.gst - input.total) >= 1;
  const negativeService = ancillary ? serviceCharge <= -1 : serviceCharge < 0;
  const gstOff = expectedGst !== null && Math.abs(input.gst - expectedGst) >= 1;
  const ancillaryCharge = ancillary && serviceCharge >= 1;
  const partnerCharge = !ancillary && !!input.partnerShippedOnly && serviceCharge >= 1;
  return {
    purchase, serviceCharge, expectedGst, totalMismatch, negativeService, gstOff, ancillaryCharge, partnerCharge,
    needsOverride: totalMismatch || negativeService || gstOff || ancillaryCharge || partnerCharge,
  };
}
