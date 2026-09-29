import { callGasAuthed } from './gasApi';

export interface VendorDiscountResult {
  discountId: string;
  duplicate?: boolean;
  direct?: number;
  credit?: number;
  creditRate?: number;
  applied?: { invoiceId: string; rmb: number }[];
  unspentCredit?: number;
}

// The server answered and refused (bad input) — nothing was saved. Any other
// error is transport: the discount may or may not have been saved.
export class DiscountServerError extends Error {}

export async function logVendorDiscount(input: { date: string; vendorCode: string; invoiceId: string; amountRmb: number; creditNoteNo: string; notes: string }): Promise<VendorDiscountResult> {
  const r = await callGasAuthed('log_vendor_discount', { ...input });
  if (!r || r.status !== 'success') throw new DiscountServerError((r && r.message) || 'The discount was not saved');
  return r as VendorDiscountResult;
}
