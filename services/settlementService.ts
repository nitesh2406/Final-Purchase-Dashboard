import { APPS_SCRIPT_URL } from '../constants.ts';
import { SyncQueueManager } from './syncQueue.ts';
import type { VendorMaster, CnfCommissionRate, CnfLedgerEntry, CnfEligibleBatch, CnfInvoiceBatch } from '../types';
export type { VendorMaster } from '../types';

export const IS_DEVELOPMENT_MODE = true;


// Resolve the Apps Script deployment URL - exported centrally from constants.ts
const appsScriptUrl = APPS_SCRIPT_URL;

/**
 * Helper to send table-scoped requests directly to Apps Script via client-side HTTP.
 * Meets requirements to not use proxies.
 */
export async function executeAppsScriptProxy<T = any>(
  appsScriptUrl: string,
  action: string,
  table: string,
  innerMethod: string = 'POST',
  payload?: any
): Promise<T> {
  const requestBody = {
    action,
    table,
    ...(payload || {})
  };

  try {
    const resp = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(requestBody)
    });

    const text = await resp.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (e) {
      parsed = text;
    }

    if (!resp.ok) {
      console.error('[AppsScript] Direct fetch responded with non-OK status', {
        status: resp.status,
        statusText: resp.statusText,
        requestBody,
        bodyText: text
      });
      throw new Error(`Apps Script responded with status ${resp.status}`);
    }

    return parsed as T;
  } catch (err: any) {
    console.error('[AppsScript] Direct network or request error', { requestBody }, err);
    throw err;
  }
}

/**
 * Fetches the canonical vendor list from the 'Vendor Masters' sheet.
 * Maps vendor_code → vendor_id so the VendorMaster type is satisfied.
 */
export async function fetchVendorMasters(): Promise<VendorMaster[]> {
  try {
    const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'get_vendor_masters', 'VendorMasters', 'POST');
    if (response && response.status === 'success' && Array.isArray(response.vendors)) {
      return response.vendors
        .filter((v: any) => v.vendor_code || v.vendor_id)
        .filter((v: any) => v.active === 1 || v.active === '1' || v.active === true)
        .map((v: any) => ({
          vendor_id: v.vendor_code || v.vendor_id || '',
          vendor_name: v.vendor_name || v.vendor_code || '',
          vendor_code: v.vendor_code || '',
          currency: (v.currency === 'INR' ? 'INR' : 'RMB') as 'RMB' | 'INR',
          is_active: true
        }));
    }
  } catch (err) {
    console.error('Failed to fetch vendor masters:', err);
  }
  return [];
}

/**
 * Inserts a new Vendor Master row into the VendorAccounts sheet.
 */
export async function submitVendorAccount(record: {
  vendor_id: string;
  vendor_name: string;
  currency?: string;
  country?: string;
  payment_terms?: string;
}): Promise<{ success: boolean; status: string; message: string }> {
  try {
    SyncQueueManager.add(record.vendor_id, 'vendor_create', record);
    return { success: true, status: 'success', message: 'Vendor creation queued for sync.' };
  } catch (err: any) {
    console.error('Failed to submit vendor account:', err);
    return { success: false, status: 'error', message: err.message || 'Error queueing vendor account' };
  }
}

/**
 * Executes a sync of Vendor_Shipments to PurchaseInvoices on the backend.
 */
export async function syncInvoicesFromShipments(): Promise<void> {
  try {
    await executeAppsScriptProxy(appsScriptUrl, 'sync_shipments', 'Vendor_Shipments', 'POST');
  } catch (err) {
    console.error('Failed to sync shipments:', err);
  }
}

export function getVendorName(vendorCode: string): string {
  return vendorCode || 'Unknown Vendor';
}

export interface SettlementRecord {
  id: string;
  date: string;
  invoiceId: string;
  vendorNo: string;
  vendorName: string;
  txnType: 'Invoice Settlement' | 'Advance Payment' | 'Forex Adjustment' | 'Refund Adjustment' | 'Transfer' | string;
  amountRmb: number;
  amountInr: number;
  exchangeRatePrimary: number;
  exchangeRateSettlement: number;
  forexGainLoss: number;
  notes?: string;
  paymentId?: string;
}

export interface VendorLedgerEntry {
  TransactionId: string;
  VendorCode: string;
  Date: string;
  Particulars: string;
  ReferenceId: string;
  RMB: number;
  Balance: number;
}

export const INITIAL_SETTLEMENT_RECORDS: SettlementRecord[] = [
  {
    id: 'SET-2026-009',
    date: '2026-05-29',
    invoiceId: 'INV-2024-009',
    vendorNo: 'V-003',
    vendorName: 'Guangzhou Sourcing Ltd',
    txnType: 'Advance Payment',
    amountRmb: 32000,
    amountInr: 368000,
    exchangeRatePrimary: 11.50,
    exchangeRateSettlement: 11.50,
    forexGainLoss: 0,
    notes: 'Custom trim sample advance'
  },
];

// Explicit Column Schema for PurchaseInvoices matching DB
export interface PurchaseInvoice {
  date: string;          // DATE
  invoiceId: string;     // VARCHAR / Unique tracker (PrimaryKey)
  vendorCode: string;    // VARCHAR
  rmb: number;           // DECIMAL
  notes?: string;        // TEXT / Nullable (retains user notes)
  er1?: number;          // DECIMAL / Nullable - Exchange Rate 1 (EOD)
  inr?: number;          // DECIMAL / Nullable - Base currency valuation (EOD)
  status: 'Pending EOD' | 'Processed';
  settledAmount?: number; // Tracks cumulative settled amount
  balance?: number;       // Tracks active running balance
}

// Initial mock records to seed PurchaseInvoices DB
const INITIAL_PURCHASE_INVOICES: PurchaseInvoice[] = [
  {
    date: '2026-05-25',
    invoiceId: 'INV-2026-501',
    vendorCode: 'V-001',
    rmb: 85000,
    notes: 'Q2 Raw plastic pellets purchase clearing',
    er1: 11.524,
    inr: 979540,
    status: 'Processed',
    settledAmount: 0,
    balance: 85000
  },
  {
    date: '2026-05-29',
    invoiceId: 'INV-2026-502',
    vendorCode: 'V-003',
    rmb: 42000,
    notes: 'Custom tooling dye molds prepayment batch',
    er1: 11.492,
    inr: 482664,
    status: 'Processed',
    settledAmount: 0,
    balance: 42000
  },
  {
    date: '2026-05-31', // Sunday - will need weekend fallback to May 29
    invoiceId: 'INV-2026-503',
    vendorCode: 'V-004',
    rmb: 120000,
    notes: 'Carton boxing bulk production - EOD demo specimen',
    status: 'Pending EOD',
    settledAmount: 0,
    balance: 120000
  },
  {
    date: '2026-06-01', // New holiday bank spec / weekday
    invoiceId: 'INV-2026-504',
    vendorCode: 'V-002',
    rmb: 65000,
    notes: 'Micro-controller chipsets batch-04 clearing',
    status: 'Pending EOD',
    settledAmount: 0,
    balance: 65000
  }
];


export interface HistoricalFxRate {
  rate: number;
  resolvedDate: string;
  success: boolean;
}

/**
 * Fetches real historical CNY/INR closing rates for a batch of dates from the Apps Script
 * backend (GOOGLEFINANCE-backed, with server-side weekend/holiday cascade to the nearest
 * prior trading day). Keyed by the exact date strings passed in.
 */
export async function fetchHistoricalFxRates(dates: string[]): Promise<Record<string, HistoricalFxRate>> {
  const uniqueDates = Array.from(new Set(dates.filter(Boolean)));
  if (!appsScriptUrl || uniqueDates.length === 0) return {};
  try {
    const response = await executeAppsScriptProxy<any>(
      appsScriptUrl,
      'get_historical_fx_rates',
      'PurchaseInvoices',
      'POST',
      { dates: uniqueDates }
    );
    if (response && response.status === 'success' && response.rates) {
      return response.rates;
    }
  } catch (err) {
    console.error('Failed to fetch historical FX rates:', err);
  }
  return {};
}

let purchaseInvoicesMemory: PurchaseInvoice[] = [];

/**
 * Submits a new Invoice Entry payload strictly targeting the 'PurchaseInvoices' schema.
 * Respects guardrails, but commits to client-side localStorage state for immediate high-fidelity rendering.
 */
export async function submitPurchaseInvoice(payload: {
  date: string;
  invoiceId: string;
  vendorCode: string;
  rmb: number;
  notes?: string;
}): Promise<{ success: boolean; status: string; message: string; data?: PurchaseInvoice }> {
  // Construct the targeted schema payload
  const tableRecord: PurchaseInvoice = {
    date: payload.date,
    invoiceId: payload.invoiceId,
    vendorCode: payload.vendorCode,
    rmb: payload.rmb,
    notes: payload.notes || undefined,
    status: 'Pending EOD',
    settledAmount: 0,
    balance: payload.rmb
  };

  try {
    SyncQueueManager.add(payload.invoiceId, 'purchase', payload);
    return {
      success: true,
      status: 'success',
      message: 'Invoice Entry queued for sync.',
      data: tableRecord
    };
  } catch (err: any) {
    console.error('Failed to queue invoice:', err);
    return {
      success: false,
      status: 'error',
      message: err.message || 'Error queueing invoice'
    };
  }
}

/**
 * Retrieves the PurchaseInvoices state from LocalStorage or memory in development mode.
 */
export function getPurchaseInvoices(): PurchaseInvoice[] {
  if (typeof window === 'undefined') return [];
  if (IS_DEVELOPMENT_MODE) {
    const raw = localStorage.getItem('purchase_invoices_table');
    return raw ? JSON.parse(raw) : [];
  }
  const raw = localStorage.getItem('purchase_invoices_table');
  if (!raw) {
    localStorage.setItem('purchase_invoices_table', JSON.stringify(INITIAL_PURCHASE_INVOICES));
    return INITIAL_PURCHASE_INVOICES;
  }
  return JSON.parse(raw);
}

let lastInvoicesRequestSequence = 0;
let completedInvoicesRequestSequence = 0;

/**
 * Fetches live PurchaseInvoices records from Google Apps Script with fallback to localStorage.
 */
export async function fetchPurchaseInvoices(): Promise<PurchaseInvoice[]> {
  const requestId = ++lastInvoicesRequestSequence;
  console.log("[Invoices] Request Start", requestId);
  try {
    if (!appsScriptUrl) {
      console.warn("Configuration Error: Apps Script URL is missing from system setup. Please verify your environment configurations.");
      console.log("[Invoices] Request End (No API URL)", requestId);
      return getPurchaseInvoices();
    }

    const payload = { 
      action: 'get_purchase_invoices', 
      table: 'PurchaseInvoices'
    };
    const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'get_purchase_invoices', 'PurchaseInvoices', 'POST', payload);
    
    if (requestId < completedInvoicesRequestSequence) {
      console.log("[Invoices] Request End (OUTDATED - Discarded)", requestId);
      return getPurchaseInvoices();
    }
    completedInvoicesRequestSequence = requestId;
    console.log("[Invoices] Request End (ACTIVE)", requestId);

    if (response && response.status === 'success' && Array.isArray(response.records)) {
      const mappedRecords: PurchaseInvoice[] = response.records.map((row: any) => ({
        date: row.Date || row.date || row['Invoice Date'] || row['Date'] || '',
        invoiceId: row.invoice_no || row.InvoiceID || row.invoiceId || row['Invoice ID'] || row['Invoice ID String'] || '',
        vendorCode: row.vendor_code || row.VendorCode || row.vendorCode || row['Vendor Code'] || '',
        rmb: parseFloat(row.RMB || row.rmb || row['RMB Amount'] || row['Amount RMB'] || '0') || 0,
        notes: row.Notes || row.notes || row['Notes'] || row['Reference'] || '',
        er1: row.ER1 !== undefined && row.ER1 !== null && row.ER1 !== '' ? parseFloat(row.ER1) :
             row.Er1 !== undefined && row.Er1 !== null && row.Er1 !== '' ? parseFloat(row.Er1) :
             row.er1 !== undefined && row.er1 !== null && row.er1 !== '' ? parseFloat(row.er1) :
             row['Exchange Rate'] !== undefined && row['Exchange Rate'] !== null && row['Exchange Rate'] !== '' ? parseFloat(row['Exchange Rate']) :
             row['ER'] !== undefined && row['ER'] !== null && row['ER'] !== '' ? parseFloat(row['ER']) : undefined,
        inr: row.INR !== undefined && row.INR !== null && row.INR !== '' ? parseFloat(row.INR) :
             row.inr !== undefined && row.inr !== null && row.inr !== '' ? parseFloat(row.inr) :
             row['INR Amount'] !== undefined && row['INR Amount'] !== null && row['INR Amount'] !== '' ? parseFloat(row['INR Amount']) :
             row['Amount INR'] !== undefined && row['Amount INR'] !== null && row['Amount INR'] !== '' ? parseFloat(row['Amount INR']) : undefined,
        status: row.Status || row.status || 'Pending EOD',
        settledAmount: parseFloat(row['Settled Amount'] || row.settledAmount || '0') || 0,
        // row.Balance/row.balance may legitimately be 0 (fully settled) — `||` treats 0 as
        // falsy and would wrongly fall through to the full RMB amount, reporting a settled
        // invoice as still fully outstanding. Explicit presence checks avoid that.
        balance: row['Balance'] !== undefined && row['Balance'] !== null && row['Balance'] !== '' ? parseFloat(row['Balance']) :
                 row.balance !== undefined && row.balance !== null && row.balance !== '' ? parseFloat(row.balance) :
                 parseFloat(row.RMB || row.rmb || '0') || 0
      }));

      purchaseInvoicesMemory = mappedRecords;
      localStorage.setItem('purchase_invoices_table', JSON.stringify(mappedRecords));
      return mappedRecords;
    }
    return getPurchaseInvoices();
  } catch (error) {
    console.warn('Could not fetch live purchase invoices from Apps Script, using local fallback:', error);
    return getPurchaseInvoices();
  }
}

/**
 * Fetches all Settlement Records from Google Apps Script.
 */
export async function fetchSettlementRecords(): Promise<SettlementRecord[]> {
  try {
    const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'get_settlement_records', 'SettlementLedger', 'POST');
    
    if (response && response.status === 'success' && Array.isArray(response.records)) {
      const mappedRecords: SettlementRecord[] = response.records.map((row: any) => {
        // The SettlementLedger sheet has no TxnType column, so the invoiceId is the
        // only signal for distinguishing an advance payment row (invoiceId === 'ADVANCE')
        // from a regular invoice settlement. Resolve it once so both fields agree —
        // checking row.InvoiceID here (rather than the resolved invoiceId) previously
        // missed every real row, since the sheet's header is 'Invoice ID' with a space.
        const invoiceId = row.invoice_no || row.InvoiceID || row['Invoice ID'] || row.invoiceId || row.invoiceNo || '';
        const vendorNo = row.vendor_code || row.VendorID || row['Vendor ID'] || row['Vendor Code'] || row.VendorCode || row.vendorCode || row.vendorNo || '';
        return {
          id: row.id || row.ID || `SET-MOCK-${Date.now()}-${Math.random()}`,
          date: row.Date || row.date || '',
          invoiceId,
          vendorNo,
          vendorName: row.VendorName || row.vendorName || getVendorName(vendorNo),
          txnType: row.TxnType || row.txnType || (String(invoiceId).trim().toUpperCase() === 'ADVANCE' ? 'Advance Payment' : 'Invoice Settlement'),
          amountRmb: parseFloat(row.RMB || row.amountRmb || '0') || 0,
          amountInr: parseFloat(row.AmountINR || row.amountInr || '0') || 0,
          exchangeRatePrimary: parseFloat(row.ER1 || row.exchangeRatePrimary || '0') || 0,
          exchangeRateSettlement: parseFloat(row.ER2 || row.exchangeRateSettlement || '0') || 0,
          forexGainLoss: parseFloat(row['Forex Gain / Loss'] || row['Forex Gain/Loss'] || row.forexGainLoss || '0') || 0,
          notes: row.Notes || row.notes || '',
          paymentId: row['Payment ID'] || row.paymentId || ''
        };
      });
      localStorage.setItem('settlement_records_table', JSON.stringify(mappedRecords));
      return mappedRecords;
    }
  } catch (error) {
    console.warn('Could not fetch settlement records from Apps Script, using local fallback:', error);
  }
  
  return getSettlementRecordsLocal();
}

/**
 * Fetches Vendor Ledger records from Google Apps Script.
 */
export async function fetchVendorLedger(): Promise<VendorLedgerEntry[]> {
  try {
    const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'get_vendor_ledger', 'VendorLedger', 'POST');
    
    if (response && response.status === 'success' && Array.isArray(response.records)) {
      return response.records.map((row: any) => ({
        TransactionId: row['Transaction ID'] || row.TransactionId || row.txnId || row.id || row.txn_id || '',
        VendorCode: row['Vendor Code'] || row.VendorCode || row.vendorCode || row.vendor_code || '',
        Date: row.Date || row.date || '',
        Particulars: row.Particulars || row.particulars || '',
        ReferenceId: row['Reference ID'] || row.ReferenceId || row.referenceId || row['Reference Id'] || row.ref_id || '',
        RMB: parseFloat(row.RMB || row.rmb || '0') || 0,
        Balance: parseFloat(row.Balance || row.balance || '0') || 0
      }));
    }
  } catch (error) {
    console.warn('Could not fetch vendor ledger from Apps Script:', error);
  }
  return [];
}

/**
 * Logs a new settlement transaction, executing through our protective middleware.
 */
export async function logSettlementRecord(record: Omit<SettlementRecord, 'id'>): Promise<any> {
  return executeAppsScriptProxy<any>(appsScriptUrl, 'log_settlement_record', 'SettlementLedger', 'POST', { record });
}

/**
 * Fetches the global Conversion Charge % applied when deriving a payment's Settled ER2
 * from its raw entered rate.
 */
export async function fetchConversionCharge(): Promise<number> {
  try {
    const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'get_conversion_charge', 'Config', 'POST');
    if (response && response.status === 'success' && typeof response.chargePercent === 'number') {
      return response.chargePercent;
    }
  } catch (error) {
    console.warn('Could not fetch conversion charge %:', error);
  }
  return 0;
}

/**
 * Saves the global Conversion Charge %. Applies to payments logged going forward only —
 * already-logged payments keep the Settled ER2 that was computed at the time they were made.
 */
export async function saveConversionCharge(chargePercent: number): Promise<number> {
  const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'save_conversion_charge', 'Config', 'POST', { chargePercent });
  if (!response || response.status !== 'success') {
    throw new Error((response && response.message) || 'Failed to save conversion charge %');
  }
  return response.chargePercent;
}

/**
 * Fetches the global IGST % applied to CNF agent commission invoices' Taxable Amount.
 */
export async function fetchIgstRate(): Promise<number> {
  try {
    const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'get_igst_rate', 'Config', 'POST');
    if (response && response.status === 'success' && typeof response.igstPercent === 'number') {
      return response.igstPercent;
    }
  } catch (error) {
    console.warn('Could not fetch IGST %:', error);
  }
  return 5;
}

/**
 * Saves the global IGST %. Applies to CNF ledger entries logged going forward only.
 */
export async function saveIgstRate(igstPercent: number): Promise<number> {
  const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'save_igst_rate', 'Config', 'POST', { igstPercent });
  if (!response || response.status !== 'success') {
    throw new Error((response && response.message) || 'Failed to save IGST %');
  }
  return response.igstPercent;
}

/**
 * Fetches the CNF agent commission-rate-by-category table (Settings > Charges & Taxes).
 */
export async function fetchCnfCommissionRates(): Promise<CnfCommissionRate[]> {
  try {
    const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'get_cnf_commission_rates', 'CNF_Commission_Rates', 'POST');
    if (response && response.status === 'success' && Array.isArray(response.rates)) {
      return response.rates;
    }
  } catch (error) {
    console.warn('Could not fetch CNF commission rates:', error);
  }
  return [];
}

/**
 * Saves the full CNF commission-rate table (full replace, not incremental).
 */
export async function saveCnfCommissionRates(rates: CnfCommissionRate[]): Promise<CnfCommissionRate[]> {
  const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'save_cnf_commission_rates', 'CNF_Commission_Rates', 'POST', { rates });
  if (!response || response.status !== 'success') {
    throw new Error((response && response.message) || 'Failed to save commission rates');
  }
  return response.rates;
}

/**
 * Fetches all CNF-eligible batches (batches that have completed vendor shipments and are
 * candidates for a CNF ledger entry). Mirrors ShipmentTracker.tsx's plain-fetch pattern for
 * get_batches/get_batch_details, keeping this new action consistent with its sibling actions
 * rather than the executeAppsScriptProxy style used elsewhere in this file.
 */
export async function fetchCnfEligibleBatches(): Promise<CnfEligibleBatch[]> {
  if (!appsScriptUrl) return [];
  try {
    const response = await fetch(appsScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'get_cnf_eligible_batches' })
    });
    const result = await response.json();
    if (result.status === 'success' && Array.isArray(result.batches)) {
      return result.batches;
    }
  } catch (err) {
    console.error('Failed to fetch CNF-eligible batches:', err);
  }
  return [];
}

/**
 * Returns true if every invoice linked to this batch's vendor_shipments is fully
 * settled — recomputed from raw SettlementRecords (txnType === 'Invoice Settlement'),
 * not from PurchaseInvoice.balance/.status, which don't reliably reflect real payment
 * state (see components/finance/SettlementLedger.tsx's getOutstandingBalance for the
 * same technique applied to a single invoice).
 */
export function isBatchFullySettled(
  batch: CnfEligibleBatch,
  purchaseInvoices: PurchaseInvoice[],
  settlementRecords: SettlementRecord[]
): boolean {
  const linkedInvoiceIds = batch.vendor_shipments.map(vs => (vs.invoiceId || '').trim()).filter(Boolean);
  if (linkedInvoiceIds.length === 0) return false;

  return linkedInvoiceIds.every(invoiceId => {
    const invoice = purchaseInvoices.find(inv => (inv.invoiceId || '').trim() === invoiceId);
    if (!invoice) return false;
    // FIFO-settlement rows are stored as negative debits against the vendor's wallet;
    // cross-vendor Adjustment Transfer In rows are stored positive. Use magnitude, not
    // signed value, so both count as money applied against the invoice.
    const settledRmb = settlementRecords
      .filter(r => (r.invoiceId || '').trim() === invoiceId && r.txnType === 'Invoice Settlement')
      .reduce((sum, r) => sum + Math.abs(r.amountRmb), 0);
    const outstanding = Math.max(0, (invoice.rmb || 0) - settledRmb);
    return outstanding < 0.01; // same rounding tolerance as PaymentLedger.tsx's balanced-allocation check
  });
}

/**
 * RMB-weighted average of exchangeRateSettlement across every 'Invoice Settlement'
 * SettlementRecord tied to any invoice linked to this batch. This is the actual RMB
 * payment rate (exchangeRateSettlement, i.e. ER2), not the Conversion-Charge-adjusted
 * rate used elsewhere for forex gain/loss — see Settings > Charges & Taxes for that
 * distinction. No prior function in this codebase computes this.
 */
export function computeCnfBatchRate(
  batch: CnfEligibleBatch,
  settlementRecords: SettlementRecord[]
): number {
  const linkedInvoiceIds = new Set(batch.vendor_shipments.map(vs => (vs.invoiceId || '').trim()).filter(Boolean));
  const relevant = settlementRecords.filter(
    r => linkedInvoiceIds.has((r.invoiceId || '').trim()) && r.txnType === 'Invoice Settlement'
  );
  // Weight by magnitude, not signed value — FIFO-settlement rows are stored as negative
  // debits while cross-vendor Adjustment Transfer In rows are positive, and a batch can
  // mix both kinds across its linked invoices.
  const totalRmb = relevant.reduce((sum, r) => sum + Math.abs(r.amountRmb), 0);
  if (totalRmb === 0) return 0;
  const weightedSum = relevant.reduce((sum, r) => sum + Math.abs(r.amountRmb) * r.exchangeRateSettlement, 0);
  return weightedSum / totalRmb;
}

/**
 * Fetches all logged CNF ledger entries.
 */
export async function fetchCnfLedgerEntries(): Promise<CnfLedgerEntry[]> {
  try {
    const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'get_cnf_ledger', 'CNF_Ledger', 'POST');
    if (response && response.status === 'success' && Array.isArray(response.entries)) {
      return response.entries;
    }
  } catch (err) {
    console.error('Failed to fetch CNF ledger:', err);
  }
  return [];
}

/**
 * Logs a new CNF ledger entry.
 */
export async function addCnfLedgerEntry(entry: Omit<CnfLedgerEntry, 'id'>): Promise<CnfLedgerEntry> {
  const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'add_cnf_ledger_entry', 'CNF_Ledger', 'POST', { entry });
  if (!response || response.status !== 'success') {
    throw new Error((response && response.message) || 'Failed to log CNF entry');
  }
  return { ...entry, id: response.id };
}

function generateCnfInvoiceBatchId(): string {
  return 'CNFBATCH-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
}

/**
 * Creates a new CNF invoice batch, reconciling the billed amount against the
 * computed total of the selected ledger entries server-side.
 */
export async function createCnfInvoiceBatch(entry: {
  entryIds: string[];
  billNo: string;
  billDate: string;
  billedAmount: number;
  fileUrl?: string;
  overrideReason?: string;
  submittedBy: string;
}): Promise<{ id: string; computedTotal: number }> {
  const id = generateCnfInvoiceBatchId();
  const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'create_cnf_invoice_batch', 'CNF_Invoice_Batches', 'POST', {
    entry: { id, ...entry }
  });
  if (!response || response.status !== 'success') {
    throw new Error((response && response.message) || 'Failed to create invoice batch');
  }
  return { id: response.id, computedTotal: response.computedTotal };
}

/**
 * Fetches all CNF invoice batches.
 */
export async function fetchCnfInvoiceBatches(): Promise<CnfInvoiceBatch[]> {
  try {
    const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'get_cnf_invoice_batches', 'CNF_Invoice_Batches', 'POST');
    if (response && response.status === 'success' && Array.isArray(response.batches)) {
      return response.batches;
    }
  } catch (err) {
    console.error('Failed to fetch CNF invoice batches:', err);
  }
  return [];
}

/**
 * Approves a CNF invoice batch, triggering server-side creation of the corresponding
 * Purchase Invoice. Direct awaited call (not SyncQueueManager) — same shape as
 * createCnfInvoiceBatch, consistent with logAdjustmentTransfer's pattern for single,
 * backend-authoritative writes.
 */
export async function approveCnfInvoiceBatch(batchId: string, approvedBy: string): Promise<{ purchaseInvoiceId: string }> {
  const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'approve_cnf_invoice_batch', 'CNF_Invoice_Batches', 'POST', {
    batchId, approvedBy
  });
  if (!response || response.status !== 'success') {
    throw new Error((response && response.message) || 'Failed to approve invoice batch');
  }
  return { purchaseInvoiceId: response.purchaseInvoiceId };
}

/**
 * Rejects a CNF invoice batch, recording the rejection reason server-side.
 */
export async function rejectCnfInvoiceBatch(batchId: string, rejectionReason: string): Promise<void> {
  const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'reject_cnf_invoice_batch', 'CNF_Invoice_Batches', 'POST', {
    batchId, rejectionReason
  });
  if (!response || response.status !== 'success') {
    throw new Error((response && response.message) || 'Failed to reject invoice batch');
  }
}

/**
 * Logs a vendor-to-vendor transfer directly (awaited, not queued) via the same backend
 * action Cross-Vendor Settlement uses (add_adjustment_entry), which — unlike
 * logSettlementRecord — mirrors both sides into VendorLedger so the paying and receiving
 * vendors' live balances actually move. Used for "Settle Invoice" (a single transfer, so a
 * direct awaited call is safe and gives the modal a real success/failure signal without the
 * queue-processing overhead a multi-line batch would carry).
 */
export async function logAdjustmentTransfer(record: {
  paymentId: string;
  sourceVendor: string;
  targetVendor: string;
  amountRmb: number;
  date: string;
  notes?: string;
  invoiceId?: string;
}): Promise<any> {
  return executeAppsScriptProxy<any>(appsScriptUrl, 'add_adjustment_entry', 'SettlementLedger', 'POST', {
    record: { txnType: 'Transfer', ...record }
  });
}

/**
 * Submits an adjustment entry (Forex, Refund, or Transfer).
 */
export async function submitAdjustmentEntry(record: any): Promise<any> {
  try {
    const queueId = record.id || record.invoiceId || 'ADJ-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    if (!record.id) {
      record.id = queueId;
    }
    SyncQueueManager.add(queueId, 'adjustment', record);
    return { status: 'success', success: true, message: 'Adjustment entry queued for sync.' };
  } catch (err: any) {
    console.error('Failed to queue adjustment:', err);
    throw err;
  }
}

/**
 * Next sequential IDP-NNNNN id for a cross-vendor ("indirect payment") transfer —
 * replaces the old ADJ-YYYYMMDD-NNN-XXXX format. Shared by every screen that creates
 * Transfer adjustment entries so there's a single place to fix sequencing bugs instead
 * of drifting copies. Scans PaymentLogs (every cross-vendor transfer materializes a real
 * wallet row there — see settleViaWalletTransfer_ backend-side), not SettlementLedger,
 * since a plain top-up transfer no longer writes any SettlementLedger row at all.
 */
// `floor` lets a caller avoid colliding with an id it already handed out this session but
// that hasn't round-tripped through a refresh into `paymentLogs` yet (e.g. "Log Another"
// on the Cross-Vendor Settlement page, submitted before onRefresh() completes) — pass the
// numeric suffix of the last id you generated, or 0 the first time.
export function generateSequentialIndirectPayId(paymentLogs: PaymentLog[], floor: number = 0): string {
  let maxSeq = floor;
  paymentLogs.forEach(log => {
    if (log.paymentId && log.paymentId.startsWith('IDP-')) {
      const seqVal = parseInt(log.paymentId.replace('IDP-', ''), 10);
      if (!isNaN(seqVal) && seqVal > maxSeq) maxSeq = seqVal;
    }
  });
  return `IDP-${(maxSeq + 1).toString().padStart(5, '0')}`;
}

/**
 * Merges a freshly-fetched list with any local optimistic ("temp") records not yet
 * reflected in it, so an in-flight optimistic insert survives a refresh that lands
 * before the backend write is visible on read-back. A temp record is a client-side
 * placeholder with a generated id that can never equal the real backend-assigned id,
 * so matching by key alone would let it persist forever once the real record has
 * actually arrived under a different id — maxAgeMs bounds that lifetime so a stale
 * temp record eventually drops out even without ever being matched.
 */
export function reconcileTempRecords<T extends { temp?: boolean; createdAtTimestamp?: number }>(
  prev: T[],
  fresh: T[],
  getKey: (record: T) => string,
  maxAgeMs: number = 20000
): T[] {
  const remoteKeys = new Set(fresh.map(r => getKey(r).trim().toLowerCase()));
  const now = Date.now();
  const remainingTemp = prev.filter(r =>
    r.temp &&
    !remoteKeys.has(getKey(r).trim().toLowerCase()) &&
    (now - (r.createdAtTimestamp || 0)) < maxAgeMs
  );
  return [...remainingTemp, ...fresh];
}

export interface CompiledLedgerRow {
  date: string;
  particulars: 'Purchase' | 'Payment' | string;
  referenceId: string;
  amount: number;
  balance?: number;
  sourceRecord: any;
  TransactionId?: string;
}

export interface VendorLedgerSourceData {
  invoices?: PurchaseInvoice[];
  paymentLogs?: PaymentLog[];
  settlementRecords?: SettlementRecord[];
  vendorLedger?: VendorLedgerEntry[];
  vendors?: VendorMaster[];
}

/**
 * Compiles a vendor's full ledger row-by-row (with running RMB balance: positive =
 * advance credit owed to them, negative = outstanding liability) from live vendor-ledger
 * rows when available, falling back to reconstructing it from raw invoices/payment
 * logs/settlement records. Shared by every screen that renders or previews a vendor's
 * ledger/balance so the sign/allocation rules only live once.
 */
export function compileVendorLedgerRows(
  vendorCode: string,
  data: VendorLedgerSourceData
): CompiledLedgerRow[] {
  if (!vendorCode) return [];
  const { invoices, paymentLogs, settlementRecords, vendorLedger, vendors } = data;
  try {
    if (vendorLedger && vendorLedger.length > 0) {
      const filteredLive = vendorLedger.filter(row => row.VendorCode === vendorCode);
      if (filteredLive.length > 0) {
        const compiled: CompiledLedgerRow[] = filteredLive.map(row => {
          const isPurchase = row.Particulars === 'Purchase';
          const isPayment = row.Particulars === 'Payment';
          const isTransferOut = row.Particulars?.includes('Transfer Out');
          const isTransferIn = row.Particulars?.includes('Transfer In');
          const isRefund = row.Particulars?.includes('Refund');
          const isForex = row.Particulars?.includes('Forex');
          const isAdjustmentPaid = row.Particulars?.includes('Adjustment (Paid to');
          const isAdjustmentReceived = row.Particulars?.includes('Adjustment (Received from');

          // From company perspective:
          // Purchase/Liability: Negative
          // Payment/Remittance: Positive
          // Transfer Out: Negative
          // Transfer In: Positive
          // Refund Adjustment: Positive
          // Forex Adjustment: Negative (if it matches old sign direction)
          // Adjustment (Paid to X): Negative (cross-vendor wallet transfer, source side)
          // Adjustment (Received from X): Positive (cross-vendor wallet transfer, target side)
          let amount = parseFloat(String(row.RMB)) || 0;
          if (isPurchase) {
            amount = -Math.abs(amount);
          } else if (isPayment) {
            amount = Math.abs(amount);
          } else if (isTransferOut) {
            amount = -Math.abs(amount);
          } else if (isTransferIn) {
            amount = Math.abs(amount);
          } else if (isRefund) {
            amount = Math.abs(amount);
          } else if (isForex) {
            amount = -amount;
          } else if (isAdjustmentPaid) {
            amount = -Math.abs(amount);
          } else if (isAdjustmentReceived) {
            amount = Math.abs(amount);
          } else {
            // Unrecognized Particulars string — was silently flipping sign
            // with no record of it. A typo'd or new transaction-type label
            // would go the wrong direction in every balance calculation
            // with nothing to flag it. Not throwing (a live ledger render
            // shouldn't hard-fail on one odd row), but this needs eyes.
            console.warn(`[compileVendorLedgerRows] Unrecognized Particulars "${row.Particulars}" for vendor ${vendorCode} — sign-flipped by fallback, verify this is correct.`);
            amount = -amount;
          }

          return {
            date: row.Date || '',
            particulars: row.Particulars || '',
            referenceId: row.ReferenceId || '',
            amount: amount,
            TransactionId: row.TransactionId || '',
            sourceRecord: null
          };
        });

        // The VendorLedger sheet only gets a row when specific backend paths mirror
        // an invoice into it — some PurchaseInvoices rows never make it there. Union
        // in any invoice for this vendor not already represented so the ledger
        // reflects the full PurchaseInvoices sheet, not just what got mirrored.
        const representedInvoiceIds = new Set(
          filteredLive
            .filter(row => row.Particulars === 'Purchase')
            .map(row => row.ReferenceId)
        );
        const safeInvoicesForLive = invoices || [];
        safeInvoicesForLive
          .filter(inv => inv.vendorCode === vendorCode && !representedInvoiceIds.has(inv.invoiceId))
          .forEach(inv => {
            compiled.push({
              date: inv.date || '',
              particulars: 'Purchase',
              referenceId: inv.invoiceId || '',
              amount: -(parseFloat(String(inv.rmb)) || 0),
              sourceRecord: inv
            });
          });

        // Sort combined dataset globally by Date in absolute ascending order
        compiled.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

        // Compute running balance dynamically
        let runningBalance = 0;
        compiled.forEach(row => {
          runningBalance += row.amount;
          row.balance = runningBalance;
        });

        return compiled;
      }
    }

    const rows: CompiledLedgerRow[] = [];

    // 1. Data Mapping Stream A (From 'PurchaseInvoices' Table)
    // Amount -> Represents liability to pay -> Negative (-RMB)
    const safeInvoices = invoices || [];
    safeInvoices.filter(inv => inv.vendorCode === vendorCode).forEach(inv => {
      rows.push({
        date: inv.date || '',
        particulars: 'Purchase',
        referenceId: inv.invoiceId || '',
        amount: -(parseFloat(String(inv.rmb)) || 0),
        sourceRecord: inv
      });
    });

    // 2. Data Mapping Stream B (From 'PaymentLogs' Table)
    // Amount -> Represents payment made to reduce liability -> Positive (+RMB)
    const safePaymentLogs = paymentLogs || [];
    safePaymentLogs.forEach(log => {
      const isPrimary = log.vendorCode === vendorCode;
      const hasAllocations = log.allocations && log.allocations.length > 0;

      if (isPrimary) {
        if (hasAllocations) {
          // Log the overall payment positive rmb for this primary vendor
          rows.push({
            date: log.date || '',
            particulars: 'Payment',
            referenceId: log.paymentId || '',
            amount: parseFloat(String(log.rmbAmount)) || 0,
            sourceRecord: log
          });

          // Adjust positive rmb as per cross-vendor list: Transfer Out (Negative)
          log.allocations?.forEach(alloc => {
            if (alloc.vendorCode !== vendorCode) {
              rows.push({
                date: log.date || '',
                particulars: 'Adjustment (Transfer Out)',
                referenceId: alloc.vendorCode || '',
                amount: -(parseFloat(String(alloc.amount)) || 0),
                sourceRecord: log
              });
            }
          });
        } else {
          // Normal payment without allocations
          rows.push({
            date: log.date || '',
            particulars: 'Payment',
            referenceId: log.paymentId || '',
            amount: parseFloat(String(log.rmbAmount)) || 0,
            sourceRecord: log
          });
        }
      } else if (hasAllocations) {
        // If the active vendor is NOT primary, but receives allocated credit: Transfer In (Positive)
        const allocs = log.allocations?.filter(a => a.vendorCode === vendorCode) || [];
        allocs.forEach(alloc => {
          const refId = log.paymentId || '';
          const isMatch = (refId === log.vendorCode);
          const particulars = isMatch ? 'Payment' : 'Adjustment (Transfer In)';

          rows.push({
            date: log.date || '',
            particulars: particulars,
            referenceId: refId,
            amount: parseFloat(String(alloc.amount)) || 0,
            sourceRecord: log
          });
        });
      }
    });

    // 3. Data Mapping Stream C (From 'SettlementLedger' Table - Dual-Sided Adjustment / Direct adjustment)
    // Source View (A transfers to B): Transfer Out -> Negative (-RMB)
    // Target View (Mirror Entry): Transfer In -> Positive (+RMB)
    const safeSettlementRecords = settlementRecords || [];
    safeSettlementRecords.forEach(rec => {
      // Custom vendor codes (e.g. "GZSOURCE") don't start with "V-", so without
      // this fallback their cross-vendor transfers were silently missing here.
      const isSource = rec.vendorNo === vendorCode && rec.invoiceId ? (rec.invoiceId.startsWith('V-') || vendors?.some(v => v.vendor_id === rec.invoiceId)) : false;
      const isTarget = rec.invoiceId === vendorCode && rec.vendorNo ? (rec.vendorNo.startsWith('V-') || vendors?.some(v => v.vendor_id === rec.vendorNo)) : false;

      if (isSource) {
        rows.push({
          date: rec.date || '',
          particulars: 'Adjustment (Transfer Out)',
          referenceId: rec.invoiceId, // Target vendor code
          amount: -(parseFloat(String(rec.amountRmb)) || 0),
          sourceRecord: rec
        });
      } else if (isTarget) {
        rows.push({
          date: rec.date || '',
          particulars: 'Adjustment (Transfer In)',
          referenceId: rec.vendorNo, // Source vendor code
          amount: parseFloat(String(rec.amountRmb)) || 0,
          sourceRecord: rec
        });
      } else if (rec.vendorNo === vendorCode) {
        // Direct vendor adjustments
        if (rec.txnType === 'Forex Adjustment') {
          rows.push({
            date: rec.date || '',
            particulars: 'Forex Adjustment',
            referenceId: rec.invoiceId || 'N/A',
            amount: -(parseFloat(String(rec.amountRmb)) || 0),
            sourceRecord: rec
          });
        } else if (rec.txnType === 'Refund' || rec.txnType === 'Refund Adjustment') {
          rows.push({
            date: rec.date || '',
            particulars: 'Refund Adjustment',
            referenceId: rec.invoiceId || 'N/A',
            amount: parseFloat(String(rec.amountRmb)) || 0,
            sourceRecord: rec
          });
        }
      }
    });

    // --- GLOBAL CHRONOLOGICAL SORTING & RUNNING BALANCE CALCULATION ---
    // Step 2: Sort combined dataset globally by Date in absolute ascending order
    rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Step 3: Compute running balance dynamically
    let runningBalance = 0;
    rows.forEach(row => {
      runningBalance += row.amount;
      row.balance = runningBalance;
    });

    return rows;
  } catch (e) {
    console.error(`Error compiling ledger for vendor ${vendorCode}:`, e);
    return [];
  }
}

/**
 * Computes a vendor's running RMB balance — the balance of the last compiled
 * ledger row. See compileVendorLedgerRows for the underlying row-by-row logic.
 */
export function computeVendorBalance(
  vendorCode: string,
  data: VendorLedgerSourceData
): number {
  if (!vendorCode) return 0;
  const compiled = compileVendorLedgerRows(vendorCode, data);
  return compiled.length > 0 ? (compiled[compiled.length - 1].balance || 0) : 0;
}

// --- PAYMENT LOG SYSTEM INTEGRATION ---

export interface PaymentLogAllocation {
  vendorCode: string;
  amount: number;
}

export interface PaymentLog {
  paymentId: string;     // PAY-xxxxx
  date: string;          // Mapped to 'Date'
  vendorCode: string;    // Extract and map only the isolated 'Vendor Code' segment to 'Vendor Code' column (VARCHAR)
  rmbAmount: number;     // Mapped to 'RMB Amount' (DECIMAL)
  fxRate: number;        // Mapped to 'ER2' (DECIMAL)
  inrAmount: number;     // Mapped to 'INR Amount' (DECIMAL)
  paymentMode?: string;  // Payment Mode / Optional selection
  referenceNo?: string;  // Reference No / Optional text input
  allocations?: PaymentLogAllocation[]; // Optional allocation panel distribution
  isCrossVendor?: boolean; // Flag to indicate if this payment spans multiple vendors
  balance?: number;      // Tracks active unspent balance
}

const INITIAL_PAYMENT_LOGS: PaymentLog[] = [
  {
    paymentId: 'PAY-00001',
    date: '2026-05-26',
    vendorCode: 'V-001',
    rmbAmount: 50000,
    fxRate: 11.45,
    inrAmount: 572500,
    paymentMode: 'Bank Transfer',
    referenceNo: 'UTR987654321',
    allocations: [{ vendorCode: 'V-001', amount: 50000 }],
    balance: 50000
  }
];

export function getPaymentLogs(): PaymentLog[] {
  if (typeof window === 'undefined') return [];
  if (IS_DEVELOPMENT_MODE) {
    const raw = localStorage.getItem('payment_logs_table');
    return raw ? JSON.parse(raw) : [];
  }
  const raw = localStorage.getItem('payment_logs_table');
  if (!raw) {
    const seededPayments = INITIAL_PAYMENT_LOGS.map(pay => ({
      ...pay,
      balance: pay.rmbAmount
    }));
    localStorage.setItem('payment_logs_table', JSON.stringify(seededPayments));
    return seededPayments;
  }
  return JSON.parse(raw);
}

export async function fetchPaymentLogs(): Promise<PaymentLog[]> {
  try {
    if (!appsScriptUrl) {
      console.warn("Configuration Error: Apps Script URL is missing from system setup. Please verify your environment configurations.");
      return getPaymentLogs();
    }

    const payload = { 
      action: 'get_payment_logs', 
      table: 'PaymentLogs'
    };
    const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'get_payment_logs', 'PaymentLogs', 'POST', payload);
    
    if (response && response.status === 'success' && Array.isArray(response.records)) {
      const mappedRecords: PaymentLog[] = response.records.map((row: any) => ({
        paymentId: row['Payment ID'] || row.paymentId || row.PaymentID || '',
        date: row.Date || row.date || row['Payment Date'] || '',
        vendorCode: row.vendor_code || row['Vendor Code'] || row.vendorCode || row.VendorCode || '',
        rmbAmount: parseFloat(row['RMB Amount'] || row.RMB || row.rmbAmount || row.rmb || '0') || 0,
        fxRate: parseFloat(row.ER2 || row.fxRate || row.fx_rate || '0') || 0,
        inrAmount: parseFloat(row['INR Amount'] || row.INR || row.inrAmount || row.inr || '0') || 0,
        paymentMode: row['Payment Mode'] || row.paymentMode || '',
        referenceNo: row['Reference No'] || row.referenceNo || '',
        allocations: row.Allocations ? (typeof row.Allocations === 'string' ? JSON.parse(row.Allocations) : row.Allocations) : undefined,
        // row.Balance may legitimately be 0 (wallet fully consumed) — `||` treats 0 as
        // falsy and would wrongly fall through to the full RMB amount, reporting a spent
        // wallet as still fully active. Explicit presence checks avoid that.
        balance: row.Balance !== undefined && row.Balance !== null && row.Balance !== '' ? parseFloat(row.Balance) :
                 row.balance !== undefined && row.balance !== null && row.balance !== '' ? parseFloat(row.balance) :
                 parseFloat(row['RMB Amount'] || row.RMB || row.rmbAmount || row.rmb || '0') || 0
      }));
      const validRecords = mappedRecords.filter(r => r.paymentId);
      localStorage.setItem('payment_logs_table', JSON.stringify(validRecords));
      return validRecords;
    }
    return getPaymentLogs();
  } catch (error) {
    console.warn('Could not fetch live payment logs from Apps Script, using local fallback:', error);
    return getPaymentLogs();
  }
}

export async function submitPaymentLog(payload: PaymentLog): Promise<{ success: boolean; status: string; message: string; data?: PaymentLog }> {
  // Construct the targeted payload with default balance
  const tableRecord: PaymentLog = {
    ...payload,
    balance: payload.rmbAmount // Initially full amount
  };

  try {
    SyncQueueManager.add(payload.paymentId, 'payment', payload);
    return {
      success: true,
      status: 'success',
      message: 'Payment Log entry queued for sync.',
      data: tableRecord
    };
  } catch (err: any) {
    console.error('Failed to queue payment:', err);
    return {
      success: false,
      status: 'error',
      message: err.message || 'Error queueing payment'
    };
  }
}

export function getSettlementRecordsLocal(): SettlementRecord[] {
  if (typeof window === 'undefined') return [];
  if (IS_DEVELOPMENT_MODE) {
    const raw = localStorage.getItem('settlement_records_table');
    return raw ? JSON.parse(raw) : [];
  }
  const raw = localStorage.getItem('settlement_records_table');
  if (!raw) {
    localStorage.setItem('settlement_records_table', JSON.stringify(INITIAL_SETTLEMENT_RECORDS));
    return INITIAL_SETTLEMENT_RECORDS;
  }
  return JSON.parse(raw);
}

// Seed the database to localStorage if empty (moved to bottom to avoid hosting ReferenceError)
function initializeTableInMemory() {
  if (typeof window !== 'undefined') {
    if (IS_DEVELOPMENT_MODE) {
      return; // Skip seeding entirely when running in development mode
    }
    const existing = localStorage.getItem('purchase_invoices_table');
    if (!existing) {
      localStorage.setItem('purchase_invoices_table', JSON.stringify(INITIAL_PURCHASE_INVOICES));
    }
    const existingPayments = localStorage.getItem('payment_logs_table');
    if (!existingPayments) {
      const seededPayments = INITIAL_PAYMENT_LOGS.map(pay => ({
        ...pay,
        balance: pay.rmbAmount
      }));
      localStorage.setItem('payment_logs_table', JSON.stringify(seededPayments));
    }
    const existingSettlements = localStorage.getItem('settlement_records_table');
    if (!existingSettlements) {
      localStorage.setItem('settlement_records_table', JSON.stringify(INITIAL_SETTLEMENT_RECORDS));
    }
  }
}
initializeTableInMemory();

// --- FIFO QUEUE SETTLEMENT AND REAL-TIME COMPUTATION ENGINES ---
//
// A client-side "Logic 1 & 2" (runFIFOLiquidationForPayment) used to live
// here, mirroring fifoLiquidate_ in the Apps Script backend against the
// local dev-mode mock store. It was dead code (zero callers) — and rightly
// so: the backend's addPaymentLog already calls fifoLiquidate_ on every
// real payment insert, so wiring this up would have double-settled every
// payment, not filled a gap. Removed rather than connected.
//
// "Logic 3" (runFIFOReverseSweepForInvoice) and its caller, executeEODExchangeRateEngine
// (the "Run EOD Loop" button's client-side pricing engine), are also removed. Both were a
// localStorage-only duplicate of what the backend now does authoritatively and
// synchronously: addPurchaseInvoice / syncShipmentsToInvoices_ call runEodForInvoice_ on
// every invoice the moment it's logged (server-side historical-rate resolution + real
// autoSettleAdvanceFromInvoice_ writes to the actual sheet), not a client sweep run later
// against a browser-local snapshot that a failed refetch could leave stuck out of sync
// with the real Google Sheet.


