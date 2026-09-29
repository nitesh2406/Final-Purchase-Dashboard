// CNF unified tab backend calls — see docs/superpowers/specs/2026-09-28-cnf-unified-tab-design.md.
// Reads go direct (and through gasApi's shared read cache); writes go
// through the authenticated proxy so the backend records the verified user.
import { callGas, callGasAuthed } from './gasApi';
import type {
  CnfShipmentValue, CnfGoodsInvoice, CnfLedgerStatement, CnfDraftInvoice,
  CnfCommissionRate, CnfAirRateCategory, CnfShipmentPartnerDefault,
} from '../types';

function ensureOk(response: any, what: string): any {
  if (!response || response.status !== 'success') {
    throw new Error((response && response.message) || `Failed to ${what}`);
  }
  return response;
}

export async function fetchCnfShipmentValues(): Promise<CnfShipmentValue[]> {
  const r = ensureOk(await callGas('get_cnf_shipment_values', {}, 1), 'load CNF shipment values');
  return r.shipments || [];
}

export async function fetchCnfGoodsInvoices(): Promise<CnfGoodsInvoice[]> {
  const r = ensureOk(await callGas('get_cnf_goods_invoices', {}, 1), 'load CNF invoices');
  return r.invoices || [];
}

export async function fetchCnfLedgerStatement(range: { from?: string; to?: string } = {}): Promise<CnfLedgerStatement> {
  const payload: Record<string, string> = {};
  if (range.from) payload.from = range.from;
  if (range.to) payload.to = range.to;
  const r = ensureOk(await callGas('get_cnf_ledger_statement', payload, 1), 'load the CNF ledger');
  return { openingBalance: r.openingBalance, rows: r.rows || [], closingBalance: r.closingBalance, totals: r.totals };
}

export interface LogCnfInvoiceInput {
  cnfInvoiceNo: string;
  invoiceDate: string;
  fileUrl: string;
  lines: { shipmentId: string; amount: number }[];
  baseAmount: number;
  gst: number;
  total: number;
  overrideReason?: string;
}

export async function logCnfGoodsInvoice(input: LogCnfInvoiceInput): Promise<{ id: string }> {
  const r = ensureOk(await callGasAuthed('log_cnf_goods_invoice', { ...input }), 'log the CNF invoice');
  return { id: r.id };
}

export async function approveCnfGoodsInvoice(id: string): Promise<void> {
  ensureOk(await callGasAuthed('approve_cnf_goods_invoice', { id }), 'approve the CNF invoice');
}

export async function rejectCnfGoodsInvoice(id: string, rejectionReason: string): Promise<void> {
  ensureOk(await callGasAuthed('reject_cnf_goods_invoice', { id, rejectionReason }), 'reject the CNF invoice');
}

export interface CnfRateConfig {
  seaRates: CnfCommissionRate[];
  airCategories: CnfAirRateCategory[];
  partnerDefaults: CnfShipmentPartnerDefault[];
  igstPct: number;
}

// Settings the CNF tab computes with. Unlike the settlementService fetchers
// (which fall back to [] / 5% so the Settings screen still opens), a failure
// here throws: a silent empty list showed a false "set up Settings" hint, and
// a silent 5% IGST made the draft preview disagree with what the server saves.
export async function fetchCnfRateConfig(): Promise<CnfRateConfig> {
  const [sea, air, defaults, igst] = await Promise.all([
    callGas('get_cnf_commission_rates', {}, 1),
    callGas('get_cnf_air_rate_categories', {}, 1),
    callGas('get_shipment_partner_defaults', {}, 1),
    callGas('get_igst_rate', {}, 1),
  ]);
  const igstPct = Number(ensureOk(igst, 'load the IGST rate').igstPercent);
  if (!(igstPct >= 0)) throw new Error('Failed to load the IGST rate');
  return {
    seaRates: ensureOk(sea, 'load the Sea rate categories').rates || [],
    airCategories: ensureOk(air, 'load the Air rate categories').categories || [],
    partnerDefaults: ensureOk(defaults, 'load the carrier defaults').defaults || [],
    igstPct,
  };
}

export async function fetchCnfDraftInvoices(): Promise<CnfDraftInvoice[]> {
  const r = ensureOk(await callGas('get_cnf_draft_invoices', {}, 1), 'load CNF draft invoices');
  return r.drafts || [];
}

export async function saveCnfDraftInvoice(input: { batchId: string; categoryId: string; rate: number; weightKg: number | null }): Promise<CnfDraftInvoice> {
  const r = ensureOk(await callGasAuthed('save_cnf_draft_invoice', { ...input }), 'save the draft invoice');
  return r.draft;
}
