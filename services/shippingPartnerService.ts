// Air shipping partners + Ledgers screen backend calls — see
// docs/superpowers/specs/2026-09-29-air-shipping-partner-design.md.
// Reads go direct (and through gasApi's shared read cache); writes go
// through the authenticated proxy, which stamps the verified user and adds
// the proxy key these actions need.
import { callGas, callGasAuthed } from './gasApi';
import type {
  ShippingPartner, BatchShippingPartner, PartnerBill, PartnerPayment, PartyLedgerSummary, PartnerLedgerStatement,
} from '../types';

function ensureOk(response: any, what: string): any {
  if (!response || response.status !== 'success') {
    throw new Error((response && response.message) || `Failed to ${what}`);
  }
  return response;
}

export async function fetchShippingPartners(): Promise<ShippingPartner[]> {
  return ensureOk(await callGas('get_shipping_partners', {}, 1), 'load shipping partners').partners || [];
}

export async function fetchBatchShippingPartners(): Promise<BatchShippingPartner[]> {
  return ensureOk(await callGas('get_batch_shipping_partners', {}, 1), 'load batch shipping partners').assignments || [];
}

export async function fetchPartnerBills(partnerId?: string): Promise<PartnerBill[]> {
  return ensureOk(await callGas('get_partner_bills', partnerId ? { partnerId } : {}, 1), 'load partner bills').bills || [];
}

export async function fetchPartnerPayments(partnerId?: string): Promise<PartnerPayment[]> {
  return ensureOk(await callGas('get_partner_payments', partnerId ? { partnerId } : {}, 1), 'load partner payments').payments || [];
}

export async function fetchPartyLedgers(): Promise<PartyLedgerSummary[]> {
  return ensureOk(await callGas('get_party_ledgers', {}, 1), 'load the ledgers').parties || [];
}

export async function fetchPartnerLedgerStatement(partnerId: string, range: { from?: string; to?: string } = {}): Promise<PartnerLedgerStatement> {
  const payload: Record<string, string> = { partnerId };
  if (range.from) payload.from = range.from;
  if (range.to) payload.to = range.to;
  const r = ensureOk(await callGas('get_partner_ledger_statement', payload, 1), 'load the partner ledger');
  return { partnerId: r.partnerId, openingBalance: r.openingBalance, rows: r.rows || [], closingBalance: r.closingBalance, totals: r.totals };
}

export interface SaveShippingPartnerInput { id?: string; name: string; gstin: string; ratePerKg: number; active: boolean }

export async function saveShippingPartner(input: SaveShippingPartnerInput): Promise<ShippingPartner> {
  return ensureOk(await callGasAuthed('save_shipping_partner', { ...input }), 'save the shipping partner').partner;
}

export async function setBatchShippingPartner(batchId: string, partnerId: string): Promise<void> {
  ensureOk(await callGasAuthed('set_batch_shipping_partner', { batchId, partnerId }), 'set the shipping partner');
}

export interface LogPartnerBillInput {
  partnerId: string;
  batchId: string;
  billNo: string;
  billDate: string;
  fileUrl: string;
  weightKg: number;
  fee: number;
  gst: number;
  total: number;
  overrideReason?: string;
}

export async function logPartnerBill(input: LogPartnerBillInput): Promise<{ id: string }> {
  const r = ensureOk(await callGasAuthed('log_partner_bill', { ...input }), 'log the bill');
  return { id: r.id };
}

export async function approvePartnerBill(id: string): Promise<void> {
  ensureOk(await callGasAuthed('approve_partner_bill', { id }), 'approve the bill');
}

export async function rejectPartnerBill(id: string, rejectionReason: string): Promise<void> {
  ensureOk(await callGasAuthed('reject_partner_bill', { id, rejectionReason }), 'reject the bill');
}

export interface LogPartnerPaymentInput { billId: string; date: string; amount: number; tds: number; reference: string; notes: string }

export async function logPartnerPayment(input: LogPartnerPaymentInput): Promise<{ id: string; balance: number }> {
  const r = ensureOk(await callGasAuthed('log_partner_payment', { ...input }), 'record the payment');
  return { id: r.id, balance: r.balance };
}

export async function voidPartnerPayment(paymentId: string, reason: string): Promise<void> {
  ensureOk(await callGasAuthed('void_partner_payment', { paymentId, reason }), 'void the payment');
}

// Shipping partner GST % (Settings → Charges & Taxes). Throws on failure so a
// silent default can't make the bill form disagree with the server.
export async function fetchPartnerGstRate(): Promise<number> {
  const pct = Number(ensureOk(await callGas('get_partner_gst_rate', {}, 1), 'load the shipping partner GST %').partnerGstPercent);
  if (!(pct >= 0)) throw new Error('Failed to load the shipping partner GST %');
  return pct;
}

export async function savePartnerGstRate(partnerGstPercent: number): Promise<number> {
  return Number(ensureOk(await callGasAuthed('save_partner_gst_rate', { partnerGstPercent }), 'save the shipping partner GST %').partnerGstPercent);
}
