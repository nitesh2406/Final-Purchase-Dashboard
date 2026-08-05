import { APPS_SCRIPT_URL } from '../constants.ts';
import { SyncQueueManager } from './syncQueue.ts';
import type { VendorMaster } from '../types';
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
          is_active: true
        }));
    }
  } catch (err) {
    console.error('Failed to fetch vendor masters:', err);
  }
  return [];
}

/**
 * Fetches vendor finance accounts from the VendorAccounts sheet.
 * Used for payment account selectors (trade/pool). Not for vendor dropdowns.
 */
export async function fetchVendorAccounts(): Promise<VendorMaster[]> {
  try {
    const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'get_vendor_accounts', 'VendorAccounts', 'POST');
    if (response && response.status === 'success' && Array.isArray(response.accounts)) {
      return response.accounts.map((row: any) => ({
        vendor_id: row.vendor_id || row['Vendor ID'] || row.account_id || row.vendorCode || '',
        vendor_name: row.vendor_name || row['Vendor Name'] || row.vendorName || '',
        currency: row.currency || '',
        country: row.country || '',
        payment_terms: row.payment_terms || '',
        is_active: row.is_active === true || row.is_active === 'TRUE'
      }));
    }
  } catch (err) {
    console.error('Failed to fetch vendor accounts:', err);
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

/**
 * Deletes a record from a specific table by unique ID.
 */
export async function deleteRecordByUniqueId(table: string, idColumn: string, targetId: string): Promise<any> {
  try {
    return await executeAppsScriptProxy(appsScriptUrl, 'delete_row', table, 'POST', {
      idColumn,
      targetId
    });
  } catch (err) {
    console.error(`Failed to delete record ${targetId} from ${table}:`, err);
    throw err;
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

/**
 * Centrally executes Apps Script web requests and transparently forwards all HTTP methods to the target Apps Script URL.
 * Production mode: all write operations are committed directly to Google Sheets.
 */
export async function executeAppsScriptRequest<T = any>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  try {
    const proxyUrl = '/api/apps-script-proxy';
    const response = await fetch(proxyUrl, {
      method: 'POST',
      redirect: "follow",
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        method: options.method || 'GET',
        headers: options.headers,
        body: options.body
      })
    });
    if (!response.ok) {
      throw new Error(`Proxy responded with status ${response.status}`);
    }
    return await response.json();
  } catch (proxyError) {
    console.warn('[Proxy Fallback] Server-side Apps Script proxy failed, trying front-end direct fetch:', proxyError);
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  }
}

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
        balance: parseFloat(row['Balance'] || row.balance || (row.RMB || row.rmb || '0')) || 0
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
 * Triggers the End-of-Day (EOD) calculation and write-back.
 * Accepts an immediate UI update callback to render values before sheet write completes.
 */
export async function executeEODExchangeRateEngine(
  currentInvoices?: PurchaseInvoice[],
  onImmediateUIUpdate?: (updated: PurchaseInvoice[]) => void
): Promise<{
  processedCount: number;
  logs: string[];
  updatedRecords: PurchaseInvoice[];
}> {
  const logs: string[] = [];
  logs.push(`[EOD Engine] Starting sequential lookup processing at ${new Date().toLocaleTimeString()}...`);

  const records = currentInvoices && currentInvoices.length > 0 ? currentInvoices : getPurchaseInvoices();
  const normalizeDate = (d: string) => (d || '').split('T')[0];

  // Resolve every needed date's real closing rate in one batched backend round-trip,
  // rather than one call per invoice.
  const uncalculatedDates = records
    .filter(rec => rec.status === 'Pending EOD' || !rec.er1 || !rec.inr)
    .map(rec => normalizeDate(rec.date));
  const rateMap = await fetchHistoricalFxRates(uncalculatedDates);

  let count = 0;
  const updatesList: { invoiceId: string; er1: number }[] = [];
  const updatedRecordsForSweep: PurchaseInvoice[] = [];

  const updated = records.map(rec => {
    // Treat invoice as uncalculated if status is 'Pending EOD' or missing ER1/INR valuation
    if (rec.status === 'Pending EOD' || !rec.er1 || !rec.inr) {
      logs.push(`\nProcessing Invoice: ${rec.invoiceId} (Date: ${rec.date}, RMB: ¥${rec.rmb})`);

      const dateKey = normalizeDate(rec.date);
      const resolved = rateMap[dateKey];
      const rate = resolved && resolved.success ? resolved.rate : 11.50;

      if (resolved && resolved.success) {
        if (resolved.resolvedDate !== dateKey) {
          logs.push(`  ↳ ${dateKey} had no trading data. Cascaded back to nearest prior trading day: ${resolved.resolvedDate}.`);
        }
        logs.push(`  ↳ Resolved closing exchange rate on ${resolved.resolvedDate}: ${rate} INR/RMB (via GOOGLEFINANCE historical lookup)`);
      } else {
        logs.push(`  ↳ Historical rate lookup failed for ${dateKey}. Defaulted to fallback rate ${rate}.`);
      }

      const inr = rec.rmb * rate;
      logs.push(`  ↳ Calculated Settlement valuation: ₹${inr.toLocaleString('en-IN', { maximumFractionDigits: 2 })} INR`);
      
      count++;
      updatesList.push({
        invoiceId: rec.invoiceId,
        er1: rate
      });
      const newRec = {
        ...rec,
        er1: rate,
        inr: inr,
        status: 'Processed' as const,
        settledAmount: rec.settledAmount ?? 0,
        balance: rec.balance ?? rec.rmb,
        temp: false
      };
      updatedRecordsForSweep.push(newRec);
      return newRec;
    }
    return rec;
  });

  if (count > 0) {
    // Trigger immediate UI state rendering before starting server write-back
    if (onImmediateUIUpdate) {
      onImmediateUIUpdate(updated);
    }

    // Update local in-memory store and localStorage immediately to ensure subsequent reads get the calculated rates
    purchaseInvoicesMemory = updated;
    localStorage.setItem('purchase_invoices_table', JSON.stringify(updated));
    localStorage.setItem('last_eod_success_time', Date.now().toString());

    // Execute Reverse Sweep for each invoice that just got an ER1 assigned
    updatedRecordsForSweep.forEach(rec => runFIFOReverseSweepForInvoice(rec));

    logs.push(`\n[EOD Engine] Successfully processed ${count} uncalculated transaction(s).`);

    // Synchronous backend write to fully ensure reliable pipeline state
    try {
      if (appsScriptUrl) {
        console.log(`[EOD Engine] Committing ${count} batch update(s) to production sheet...`);
        const result = await executeAppsScriptProxy<any>(
          appsScriptUrl,
          'commit_eod_engine',
          'PurchaseInvoices',
          'POST',
          {
            logs: logs.join('\n'),
            updates: updatesList
          }
        );
        if (result && result.status === 'success') {
          console.log(`[EOD Engine] Synchronized with Apps Script successfully:`, result.message);
          
          // Force a fresh refetch of all related tables to synchronize auto-settlement changes
          // triggered downstream by the EOD engine.
          try {
             await Promise.all([
               fetchPurchaseInvoices(),
               fetchPaymentLogs(),
               fetchSettlementRecords()
             ]);
          } catch(syncErr) {
             console.warn('[EOD Engine] Late-fetch sync warning:', syncErr);
          }
        } else {
          console.warn(`[EOD Engine] Warning: Apps Script backend rejected transactional commit:`, result?.message);
          throw new Error(result?.message || 'Apps Script transaction rejected');
        }
      }
    } catch (err: any) {
      console.error(`[EOD Engine] Database sheet write-back failed:`, err);
      throw err;
    }
  } else {
    logs.push(`\n[EOD Engine] Scan complete. No uncalculated rows require correction.`);
  }

  return {
    processedCount: count,
    logs,
    updatedRecords: updated
  };
}

/**
 * Resets local database to seed state for testing/demo calculations.
 */
export function resetPurchaseInvoicesDb(): PurchaseInvoice[] {
  purchaseInvoicesMemory = [...INITIAL_PURCHASE_INVOICES];
  if (typeof window !== 'undefined') {
    localStorage.setItem('purchase_invoices_table', JSON.stringify(INITIAL_PURCHASE_INVOICES));
  }
  return INITIAL_PURCHASE_INVOICES;
}

/**
 * Fetches all Settlement Records from Google Apps Script.
 */
export async function fetchSettlementRecords(): Promise<SettlementRecord[]> {
  try {
    const response = await executeAppsScriptProxy<any>(appsScriptUrl, 'get_settlement_records', 'SettlementLedger', 'POST');
    
    if (response && response.status === 'success' && Array.isArray(response.records)) {
      const mappedRecords: SettlementRecord[] = response.records.map((row: any) => ({
        id: row.id || row.ID || `SET-MOCK-${Date.now()}-${Math.random()}`,
        date: row.Date || row.date || '',
        invoiceId: row.invoice_no || row.InvoiceID || row['Invoice ID'] || row.invoiceId || row.invoiceNo || '',
        vendorNo: row.vendor_code || row.VendorID || row['Vendor ID'] || row['Vendor Code'] || row.VendorCode || row.vendorCode || row.vendorNo || '',
        vendorName: row.VendorName || row.vendorName || getVendorName(row.vendor_code || row.VendorID || row['Vendor ID'] || row['Vendor Code'] || row.VendorCode || row.vendorCode || row.vendorNo),
        txnType: row.TxnType || row.txnType || (row.InvoiceID === 'ADVANCE' ? 'Advance Payment' : 'Invoice Settlement'),
        amountRmb: parseFloat(row.RMB || row.amountRmb || '0') || 0,
        amountInr: parseFloat(row.AmountINR || row.amountInr || '0') || 0,
        exchangeRatePrimary: parseFloat(row.ER1 || row.exchangeRatePrimary || '0') || 0,
        exchangeRateSettlement: parseFloat(row.ER2 || row.exchangeRateSettlement || '0') || 0,
        forexGainLoss: parseFloat(row['Forex Gain / Loss'] || row['Forex Gain/Loss'] || row.forexGainLoss || '0') || 0,
        notes: row.Notes || row.notes || '',
        paymentId: row['Payment ID'] || row.paymentId || ''
      }));
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
  fxRate: number;
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
 * Next sequential ADJ-YYYYMMDD-NNN reference ID for a cross-vendor settlement/adjustment
 * batch, scoped to today's date. Shared by every screen that creates adjustment entries so
 * there's a single place to fix sequencing bugs instead of drifting copies.
 */
export function generateAdjustmentId(allRecords: SettlementRecord[]): string {
  const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const prefix = `ADJ-${todayStr}`;
  const matches = allRecords.filter(r => (r.paymentId || r.id || '').startsWith(prefix));
  const seqs = matches.map(r => {
    const parts = (r.paymentId || r.id || '').split('-');
    const lastPart = parseInt(parts[parts.length - 1], 10);
    return isNaN(lastPart) ? 0 : lastPart;
  });
  const nextSeq = seqs.length > 0 ? Math.max(...seqs) + 1 : 1;
  return `${prefix}-${String(nextSeq).padStart(3, '0')}`;
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

/**
 * Computes a vendor's running RMB balance (positive = advance credit owed to them,
 * negative = outstanding liability) from live vendor-ledger rows when available, falling
 * back to reconstructing it from raw invoices/payment logs/settlement records. Shared by
 * every screen that previews a vendor's balance so the sign/allocation rules only live once.
 */
export function computeVendorBalance(
  vendorCode: string,
  data: {
    invoices?: PurchaseInvoice[];
    paymentLogs?: PaymentLog[];
    settlementRecords?: SettlementRecord[];
    vendorLedger?: VendorLedgerEntry[];
    vendors?: VendorMaster[];
  }
): number {
  if (!vendorCode) return 0;
  const { invoices, paymentLogs, settlementRecords, vendorLedger, vendors } = data;
  try {
    if (vendorLedger && vendorLedger.length > 0) {
      const filteredLive = vendorLedger.filter(row => row.VendorCode === vendorCode);
      if (filteredLive.length > 0) {
        const compiled = filteredLive.map(row => {
          const isPurchase = row.Particulars === 'Purchase';
          const isPayment = row.Particulars === 'Payment';
          const isTransferOut = row.Particulars?.includes('Transfer Out');
          const isTransferIn = row.Particulars?.includes('Transfer In');
          const isRefund = row.Particulars?.includes('Refund');
          const isForex = row.Particulars?.includes('Forex');

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
          } else {
            amount = -amount;
          }

          return { date: row.Date || '', amount };
        });

        // Union in any invoice for this vendor not already mirrored into VendorLedger
        // (see matching fix in VendorLedgerTab.compileLedger for why this is necessary).
        const representedInvoiceIds = new Set(
          filteredLive
            .filter(row => row.Particulars === 'Purchase')
            .map(row => row.ReferenceId)
        );
        const safeInvoicesForLive = invoices || [];
        safeInvoicesForLive
          .filter(inv => inv.vendorCode === vendorCode && !representedInvoiceIds.has(inv.invoiceId))
          .forEach(inv => {
            compiled.push({ date: inv.date || '', amount: -(parseFloat(String(inv.rmb)) || 0) });
          });

        compiled.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        return compiled.reduce((running, row) => running + row.amount, 0);
      }
    }

    const rows: { date: string; amount: number }[] = [];

    const safeInvoices = invoices || [];
    safeInvoices.filter(inv => inv.vendorCode === vendorCode).forEach(inv => {
      rows.push({ date: inv.date || '', amount: -(parseFloat(String(inv.rmb)) || 0) });
    });

    const safePaymentLogs = paymentLogs || [];
    safePaymentLogs.forEach(log => {
      const isPrimary = log.vendorCode === vendorCode;
      const hasAllocations = log.allocations && log.allocations.length > 0;

      if (isPrimary) {
        if (hasAllocations) {
          rows.push({ date: log.date || '', amount: parseFloat(String(log.rmbAmount)) || 0 });
          log.allocations?.forEach(alloc => {
            if (alloc.vendorCode !== vendorCode) {
              rows.push({ date: log.date || '', amount: -(parseFloat(String(alloc.amount)) || 0) });
            }
          });
        } else {
          rows.push({ date: log.date || '', amount: parseFloat(String(log.rmbAmount)) || 0 });
        }
      } else if (hasAllocations) {
        const allocs = log.allocations?.filter(a => a.vendorCode === vendorCode) || [];
        allocs.forEach(alloc => {
          rows.push({ date: log.date || '', amount: parseFloat(String(alloc.amount)) || 0 });
        });
      }
    });

    const safeSettlementRecords = settlementRecords || [];
    safeSettlementRecords.forEach(rec => {
      const isSource = rec.vendorNo === vendorCode && rec.invoiceId ? (rec.invoiceId.startsWith('V-') || vendors?.some(v => v.vendor_id === rec.invoiceId)) : false;
      const isTarget = rec.invoiceId === vendorCode && rec.vendorNo ? (rec.vendorNo.startsWith('V-') || vendors?.some(v => v.vendor_id === rec.vendorNo)) : false;

      if (isSource) {
        rows.push({ date: rec.date || '', amount: -(parseFloat(String(rec.amountRmb)) || 0) });
      } else if (isTarget) {
        rows.push({ date: rec.date || '', amount: parseFloat(String(rec.amountRmb)) || 0 });
      } else if (rec.vendorNo === vendorCode) {
        if (rec.txnType === 'Forex Adjustment') {
          rows.push({ date: rec.date || '', amount: -(parseFloat(String(rec.amountRmb)) || 0) });
        } else if (rec.txnType === 'Refund' || rec.txnType === 'Refund Adjustment') {
          rows.push({ date: rec.date || '', amount: parseFloat(String(rec.amountRmb)) || 0 });
        }
      }
    });

    rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    return rows.reduce((running, r) => running + r.amount, 0);
  } catch (e) {
    console.error('Error calculating vendor balance:', e);
    return 0;
  }
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
        balance: parseFloat(row.Balance || row.balance || (row['RMB Amount'] || row.RMB || row.rmbAmount || row.rmb || '0')) || 0
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

/**
 * SETTLEMENT ENGINE LOGIC 1 & 2:
 * Standard FIFO allocation of payments to open invoices, and advance overflow tracking.
 */
export function runFIFOLiquidationForPayment(payment: PaymentLog) {
  if (typeof window === 'undefined') return;

  const payments = getPaymentLogs();
  const payIndex = payments.findIndex(p => p.paymentId === payment.paymentId);
  if (payIndex === -1) return;

  const targetPayment = payments[payIndex];
  
  // Define allocations array. If cross-vendor, use the allocations array; otherwise, use a single allocation matching the primary vendor
  const allocationsToProcess = targetPayment.allocations && targetPayment.allocations.length > 0
    ? targetPayment.allocations
    : [{ vendorCode: targetPayment.vendorCode, amount: targetPayment.rmbAmount }];

  const invoices = getPurchaseInvoices();
  const settlements = getSettlementRecordsLocal();
  const newSettlementRecords: SettlementRecord[] = [];

  let totalRemainingUnspent = 0;

  for (const alloc of allocationsToProcess) {
    let remainingPaymentRmb = alloc.amount;

    // Locate all rows in the PurchaseInvoices sheet for that specific vendor code where Balance > 0 and eligible for settlement
    const vendorInvoices = invoices
      .filter(i => 
        i.vendorCode === alloc.vendorCode && 
        (i.balance === undefined ? i.rmb : i.balance) > 0 &&
        i.er1 !== undefined && i.er1 !== null && String(i.er1).trim() !== "" &&
        i.inr !== undefined && i.inr !== null && String(i.inr).trim() !== "" &&
        i.status !== "Pending EOD"
      )
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); // Sort chronologically

    for (const invoice of vendorInvoices) {
      if (remainingPaymentRmb <= 0) break;

      if (invoice.settledAmount === undefined) invoice.settledAmount = 0;
      if (invoice.balance === undefined) invoice.balance = invoice.rmb;

      const settlementRmb = Math.min(remainingPaymentRmb, invoice.balance);

      // Update invoice in-place
      invoice.settledAmount += settlementRmb;
      invoice.balance -= settlementRmb;

      // Update in master list
      const invIndex = invoices.findIndex(i => i.invoiceId === invoice.invoiceId);
      if (invIndex !== -1) {
        invoices[invIndex] = { ...invoice };
      }

      // Resolve ER1 Directly from Invoice
      const er1 = invoice.er1 || 0; // Require ER1 from invoice, or 0 if missing
      const amountInr = settlementRmb * targetPayment.fxRate;
      const forexGainLoss = settlementRmb * er1 - settlementRmb * targetPayment.fxRate;

      const totalRecords = settlements.length + newSettlementRecords.length;
      const newRecordId = `SET-${(1001 + totalRecords).toString()}`;

      const settlementRecord: SettlementRecord = {
        id: newRecordId,
        date: targetPayment.date, // Payment Date
        invoiceId: invoice.invoiceId,
        vendorNo: alloc.vendorCode,
        vendorName: getVendorName(alloc.vendorCode),
        txnType: 'Invoice Settlement',
        amountRmb: settlementRmb,
        amountInr: amountInr,
        exchangeRatePrimary: er1,
        exchangeRateSettlement: targetPayment.fxRate,
        forexGainLoss: forexGainLoss,
        notes: `FIFO payment settlement of Invoice ${invoice.invoiceId} using Payment ${targetPayment.paymentId}`,
        paymentId: targetPayment.paymentId
      };

      newSettlementRecords.push(settlementRecord);

      remainingPaymentRmb -= settlementRmb;

      // Backend Code.gs already handles these updates during insert_payment_log,
      // so we do not send redundant update_purchase_invoice or log_settlement_record commands from the frontend.
    }

    // If leftover amount remains, it is an Advance!
    if (remainingPaymentRmb > 0) {
      totalRemainingUnspent += remainingPaymentRmb;

      const totalRecords = settlements.length + newSettlementRecords.length;
      const newRecordId = `SET-${(1001 + totalRecords).toString()}`;
      const amountInr = remainingPaymentRmb * targetPayment.fxRate;

      const advanceRecord: SettlementRecord = {
        id: newRecordId,
        date: targetPayment.date,
        invoiceId: 'ADVANCE', // Tracked as ADVANCE inside SettlementLedger
        vendorNo: alloc.vendorCode,
        vendorName: getVendorName(alloc.vendorCode),
        txnType: 'Advance Payment',
        amountRmb: remainingPaymentRmb,
        amountInr: amountInr,
        exchangeRatePrimary: targetPayment.fxRate,
        exchangeRateSettlement: targetPayment.fxRate,
        forexGainLoss: 0,
        notes: `Unallotted cash advance: Payment ID ${targetPayment.paymentId}`,
        paymentId: targetPayment.paymentId
      };

      newSettlementRecords.push(advanceRecord);

      // Backend Code.gs already handles these updates during insert_payment_log
    }
  }

  // Update target payment's unspent balance in-place
  targetPayment.balance = totalRemainingUnspent;
  payments[payIndex] = { ...targetPayment };

  // Trigger Apps Script update for payment balance via local proxy
  {
    executeAppsScriptProxy(appsScriptUrl, 'update_payment_log', 'PaymentLogs', 'POST', {
      record: {
        paymentId: targetPayment.paymentId,
        balance: targetPayment.balance
      }
    }).catch((err) => {
      console.error('[AppsProxy] update_payment_log failed', {
        paymentId: targetPayment.paymentId,
        balance: targetPayment.balance
      }, err);
    });
  }

  const round2 = (val: number | undefined) => val === undefined ? undefined : Math.round(val * 100) / 100;
  
  const roundedInvoices = invoices.map(i => ({ 
    ...i, 
    settledAmount: round2(i.settledAmount), 
    balance: round2(i.balance) 
  }));
  const roundedPayments = payments.map(p => ({
    ...p,
    balance: round2(p.balance)
  }));
  const roundedSettlements = [...newSettlementRecords, ...settlements].map(s => ({
    ...s,
    amountInr: round2(s.amountInr),
    forexGainLoss: round2(s.forexGainLoss),
    amountRmb: round2(s.amountRmb)
  }));

  // Save to localStorage
  localStorage.setItem('purchase_invoices_table', JSON.stringify(roundedInvoices));
  localStorage.setItem('payment_logs_table', JSON.stringify(roundedPayments));
  localStorage.setItem('settlement_records_table', JSON.stringify(roundedSettlements));
}


/**
 * SETTLEMENT ENGINE LOGIC 3:
 * Reverse-FIFO sweep of new invoices against open unspent advances pool.
 */
export function runFIFOReverseSweepForInvoice(invoice: PurchaseInvoice) {
  if (typeof window === 'undefined') return;

  const invoices = getPurchaseInvoices();
  const invIndex = invoices.findIndex(i => i.invoiceId === invoice.invoiceId);
  if (invIndex === -1) return;

  const targetInvoice = invoices[invIndex];

  // Check if invoice itself is eligible for settlement calculations
  if (
    targetInvoice.status === 'Pending EOD' ||
    targetInvoice.er1 === undefined || targetInvoice.er1 === null || String(targetInvoice.er1).trim() === '' ||
    targetInvoice.inr === undefined || targetInvoice.inr === null || String(targetInvoice.inr).trim() === ''
  ) {
    return;
  }

  if (targetInvoice.settledAmount === undefined) targetInvoice.settledAmount = 0;
  if (targetInvoice.balance === undefined) targetInvoice.balance = targetInvoice.rmb;

  const payments = getPaymentLogs();
  // Sort all open advances chronologically by date
  const openAdvances = payments
    .filter(p => p.vendorCode === targetInvoice.vendorCode && p.balance && p.balance > 0)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (openAdvances.length === 0) return;

  const settlements = getSettlementRecordsLocal();
  const newSettlementRecords: SettlementRecord[] = [];

  // The guard clause above already returned early if er1 were missing, so it's always set here.
  const er1 = targetInvoice.er1 as number;

  for (const advance of openAdvances) {
    if (targetInvoice.balance <= 0) break;

    const settlementRmb = Math.min(targetInvoice.balance, advance.balance || 0);

    // Update target invoice in-place
    targetInvoice.settledAmount += settlementRmb;
    targetInvoice.balance -= settlementRmb;

    // Update advance in-place
    advance.balance = (advance.balance || 0) - settlementRmb;

    const advanceIdx = payments.findIndex(p => p.paymentId === advance.paymentId);
    if (advanceIdx !== -1) {
      payments[advanceIdx].balance = advance.balance;
    }

    const totalRecords = settlements.length + newSettlementRecords.length;
    const newRecordId = `SET-${(1001 + totalRecords).toString()}`;
    const amountInr = settlementRmb * advance.fxRate;
    const forexGainLoss = settlementRmb * er1 - settlementRmb * advance.fxRate;

    const settlementRecord: SettlementRecord = {
      id: newRecordId,
      date: targetInvoice.date,
      invoiceId: targetInvoice.invoiceId,
      vendorNo: targetInvoice.vendorCode,
      vendorName: getVendorName(targetInvoice.vendorCode),
      txnType: 'Invoice Settlement',
      amountRmb: settlementRmb,
      amountInr: amountInr,
      exchangeRatePrimary: er1,
      exchangeRateSettlement: advance.fxRate,
      forexGainLoss: forexGainLoss,
      notes: `Reverse FIFO sweep match of Invoice ${targetInvoice.invoiceId} against Advance ${advance.paymentId}`,
      paymentId: advance.paymentId
    };

    newSettlementRecords.push(settlementRecord);
  }

  const round2 = (val: number | undefined) => val === undefined ? undefined : Math.round(val * 100) / 100;
  
  const roundedInvoices = invoices.map(i => ({ 
    ...i, 
    settledAmount: round2(i.settledAmount), 
    balance: round2(i.balance) 
  }));
  const roundedPayments = payments.map(p => ({
    ...p,
    balance: round2(p.balance)
  }));
  const roundedSettlements = [...newSettlementRecords, ...settlements].map(s => ({
    ...s,
    amountInr: round2(s.amountInr),
    forexGainLoss: round2(s.forexGainLoss),
    amountRmb: round2(s.amountRmb)
  }));

  // Save to LocalStorage
  localStorage.setItem('purchase_invoices_table', JSON.stringify(roundedInvoices));
  localStorage.setItem('payment_logs_table', JSON.stringify(roundedPayments));
  localStorage.setItem('settlement_records_table', JSON.stringify(roundedSettlements));
}

