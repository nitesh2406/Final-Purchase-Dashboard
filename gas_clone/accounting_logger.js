/**
 * PURCHASE & SETTLEMENT ERP — code.gs
 *
 * doGet and doPost have been merged into Inventory_Forecasting.gs.
 * This file contains all finance helper functions, write routines,
 * and utilities that are called from the shared doPost router.
 *
 * All functions here are globally accessible to all .gs files
 * in this Apps Script project.
 */

// ─────────────────────────────────────────────────────────────
// RESPONSE HELPERS — defined once, in entry_points.js. Do not redeclare here.
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// DATA ACCESS HELPERS
// ─────────────────────────────────────────────────────────────

// getSheetData_ moved to entry_points.js (this file's blank-row filtering
// behavior was preserved there — see the comment on that function).

function findHeaderIndex_(headers, target) {
  const normalize = (s) => s.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalizedTarget = normalize(target);
  // Aliases for renamed columns: 'Invoice ID' → 'invoice_no'
  const aliases = { 'invoiceid': 'invoiceno', 'invoiceno': 'invoiceid' };
  const normalizedAlias = aliases[normalizedTarget];
  for (let i = 0; i < headers.length; i++) {
    const h = normalize(headers[i]);
    if (h === normalizedTarget || (normalizedAlias && h === normalizedAlias)) return i;
  }
  if (normalizedTarget === 'notes') {
    for (let i = 0; i < headers.length; i++) {
      if (normalize(headers[i]) === 'note') return i;
    }
  }
  return -1;
}

// Returns the 0-based column index for headerName, appending a new header cell for it
// (once) if the sheet doesn't have one yet — used for columns added after a sheet was
// already in use (e.g. PaymentLogs' 'Source Vendor', needed once cross-vendor wallets
// started being materialized as real rows instead of just a rate).
function ensureHeaderColumn_(sheet, headerName) {
  const headers = sheet.getDataRange().getValues()[0] || [];
  const idx = findHeaderIndex_(headers, headerName);
  if (idx !== -1) return idx;
  const newIdx = headers.length;
  sheet.getRange(1, newIdx + 1).setValue(headerName);
  return newIdx;
}

function getValue_(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return obj[key];
  }
  return '';
}

// These two gate actual writes (duplicate-Payment-ID / duplicate-settlement
// checks), so they can't trust getSheetData_'s 5-minute cache — a stale
// "doesn't exist yet" read here is exactly how the same payment gets
// written/settled twice (e.g. from two deployments hitting the sheet close
// together). Force a fresh read every time instead.
function recordExists_(sheetName, columnName, value) {
  invalidateSheetCache_(sheetName);
  return getSheetData_(sheetName).some(row =>
    String(row[columnName] || '').trim() === String(value).trim()
  );
}

function settlementExists_(paymentId, invoiceId) {
  invalidateSheetCache_('SettlementLedger');
  return getSheetData_('SettlementLedger').some(row =>
    String(row['Payment ID'] || '').trim() === String(paymentId).trim() &&
    String(row['invoice_no'] || row['Invoice ID'] || '').trim() === String(invoiceId).trim()
  );
}

function generateTxnId_() {
  return 'TXN-' + Utilities.getUuid();
}

// Header-based (not positional) max-suffix scan for a given ID prefix in PaymentLogs —
// robust to DP-/IDP- rows being interleaved in date order rather than one prefix always
// being the sheet's last row (which a simple "read the last row" approach would get wrong).
function generateSequentialIdWithPrefix_(sheetName, idHeaderName, prefix) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return prefix + '00001';
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return prefix + '00001';
  const idIdx = findHeaderIndex_(data[0], idHeaderName);
  if (idIdx === -1) return prefix + '00001';
  let maxNum = 0;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][idIdx] || '').trim();
    if (id.indexOf(prefix) === 0) {
      const num = parseInt(id.slice(prefix.length), 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  }
  return prefix + (maxNum + 1).toString().padStart(5, '0');
}

// Direct payment (an actual bank transfer to the invoiced vendor) — "DP-00001" series.
function generateSequentialDirectPayId() {
  return generateSequentialIdWithPrefix_('PaymentLogs', 'Payment ID', 'DP-');
}

// Indirect/cross-vendor payment (a wallet created by transferring another vendor's
// existing credit) — "IDP-00001" series, replacing the old "ADJ-YYYYMMDD-NNN-CODE" format.
function generateSequentialIndirectPayId() {
  return generateSequentialIdWithPrefix_('PaymentLogs', 'Payment ID', 'IDP-');
}

function generateSequentialSettlementId() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SettlementLedger');
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return 'SET-00001';
  const lastId = data[data.length - 1][1];
  if (typeof lastId === 'string' && lastId.startsWith('SET-')) {
    const num = parseInt(lastId.split('-')[1].replace(/[A-Z]/g, '')) + 1;
    return 'SET-' + num.toString().padStart(5, '0');
  }
  return 'SET-00001';
}

// ─────────────────────────────────────────────────────────────
// DATA INGESTION & SYNC ENGINE
// ─────────────────────────────────────────────────────────────

function syncShipmentsToInvoices_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shipSheet   = ss.getSheetByName('Vendor_Shipments');
  const invSheet    = ss.getSheetByName('PurchaseInvoices');
  // 'VendorAccounts' was the sheet's old name — it no longer exists (renamed to
  // 'Vendor Masters' at some point), which silently no-op'd this entire function
  // since the guard below returns without erroring. Every shipment invoice
  // submitted since that rename never got its PurchaseInvoices row created.
  const vendorSheet = ss.getSheetByName('Vendor Masters');
  if (!shipSheet || !invSheet || !vendorSheet) return;

  const shipData  = getSheetData_('Vendor_Shipments');
  const invValues = invSheet.getDataRange().getValues();
  const invHeaders = invValues[0];
  const invIdIdx   = findHeaderIndex_(invHeaders, 'Invoice ID');
  const rmbIdx     = findHeaderIndex_(invHeaders, 'RMB');
  const settledIdx = findHeaderIndex_(invHeaders, 'Settled Amount');
  const balanceIdx = findHeaderIndex_(invHeaders, 'Balance');
  const inrIdx     = findHeaderIndex_(invHeaders, 'INR');
  const er1Idx     = findHeaderIndex_(invHeaders, 'ER1');
  const statusIdx  = findHeaderIndex_(invHeaders, 'Status');

  const invIdSet = {};
  if (invIdIdx !== -1) {
    for (let i = 1; i < invValues.length; i++) {
      const id = (invValues[i][invIdIdx] || '').toString().trim().toUpperCase();
      if (id) invIdSet[id] = true;
    }
  }

  const vendorData = getSheetData_('Vendor Masters');
  // 'vendor_code' is Vendor Masters' actual column; the rest are kept as fallbacks
  // for compatibility with the old VendorAccounts schema this used to read.
  const existingVendorIds = new Set(
    vendorData.map(v => String(getValue_(v, ['vendor_code', 'vendor_id', 'Vendor ID', 'account_id', 'Vendor Code', 'VendorCode'])).trim())
  );

  shipData.forEach(ship => {
    const invId = String(getValue_(ship, ['invoice_no', 'invoiceId', 'Invoice ID', 'InvoiceId'])).trim().toUpperCase();
    if (!invId || invId === 'UNDEFINED' || invId === 'NULL') return;
    if (invIdSet[invId]) return;

    const vCode = String(getValue_(ship, ['VendorCode', 'Vendor Code', 'vendor_code', 'vendorCode'])).trim();
    const rmb   = parseFloat(getValue_(ship, ['total_amount', 'RMB', 'rmb'])) || 0;
    const date  = getValue_(ship, ['invoice_date', 'Invoice Date', 'Date']) || new Date().toISOString().split('T')[0];

    if (vCode && !existingVendorIds.has(vCode)) {
      // Use header-based mapping so vendor_code goes to the correct column.
      // Vendor Masters' real headers are vendor_code/vendor_name/currency/active —
      // the old vendor_id/is_active names are kept as fallbacks only.
      const vHeaders = vendorSheet.getDataRange().getValues()[0];
      const vidIdx   = findHeaderIndex_(vHeaders, 'vendor_code') !== -1 ? findHeaderIndex_(vHeaders, 'vendor_code') : findHeaderIndex_(vHeaders, 'vendor_id');
      const vnmIdx   = findHeaderIndex_(vHeaders, 'vendor_name') !== -1 ? findHeaderIndex_(vHeaders, 'vendor_name') : findHeaderIndex_(vHeaders, 'Vendor Name');
      const curIdx   = findHeaderIndex_(vHeaders, 'currency')    !== -1 ? findHeaderIndex_(vHeaders, 'currency')    : findHeaderIndex_(vHeaders, 'Currency');
      const actIdx   = findHeaderIndex_(vHeaders, 'active')      !== -1 ? findHeaderIndex_(vHeaders, 'active')      : findHeaderIndex_(vHeaders, 'is_active');
      const newRow   = new Array(Math.max(vHeaders.length, 6)).fill('');
      if (vidIdx !== -1) newRow[vidIdx] = vCode; else newRow[0] = vCode;
      if (vnmIdx !== -1) newRow[vnmIdx] = vCode;  // code as placeholder name
      if (curIdx !== -1) newRow[curIdx] = 'RMB';
      if (actIdx !== -1) newRow[actIdx] = true;
      vendorSheet.appendRow(newRow);
      existingVendorIds.add(vCode);
    }

    const rowToAppend = new Array(Math.max(invHeaders.length, 10)).fill('');
    rowToAppend[0] = date;
    if (invIdIdx !== -1) rowToAppend[invIdIdx] = invId;
    const vCodeIdx = findHeaderIndex_(invHeaders, 'Vendor Code');
    if (vCodeIdx  !== -1) rowToAppend[vCodeIdx]  = vCode;
    if (rmbIdx    !== -1) rowToAppend[rmbIdx]    = rmb;
    const notesIdx = findHeaderIndex_(invHeaders, 'Notes');
    if (notesIdx  !== -1) rowToAppend[notesIdx]  = '';
    if (er1Idx    !== -1) rowToAppend[er1Idx]    = '';
    if (inrIdx    !== -1) rowToAppend[inrIdx]    = '';
    if (settledIdx !== -1) rowToAppend[settledIdx] = 0;
    if (balanceIdx !== -1) rowToAppend[balanceIdx] = rmb;
    if (statusIdx !== -1) rowToAppend[statusIdx] = 'Pending EOD';
    else rowToAppend[9] = 'Pending EOD';

    invSheet.appendRow(rowToAppend);
    invIdSet[invId] = true;
    logToVendorLedger_(vCode, date, 'Purchase', invId, -Math.abs(rmb));
    invalidateSheetCache_('PurchaseInvoices');
    // Auto-EOD this one invoice immediately (see runEodForInvoice_) — replaces the old
    // manual "Run EOD Loop" button; scoped to just the invoice appended this iteration,
    // not a backfill of every other still-pending row.
    runEodForInvoice_(invId);
  });

  // A payment settled within the 5-minute getSheetData_ cache window after
  // this runs would otherwise miss any invoice just appended here (see
  // fifoLiquidate_ for the full explanation of this cache class of bug).
  invalidateSheetCache_('PurchaseInvoices');
}

function getLiveRate_() {
  try {
    const ss       = SpreadsheetApp.getActiveSpreadsheet();
    const sheet    = ss.getSheets()[0];
    const tempCell = sheet.getRange('Z1');
    tempCell.setFormula('=GOOGLEFINANCE("CURRENCY:CNYINR")');
    SpreadsheetApp.flush();
    const liveRate = parseFloat(tempCell.getValue());
    tempCell.clearContent();
    return (!isNaN(liveRate) && liveRate > 0) ? liveRate : 0;
  } catch(e) {
    Logger.log('Error in getLiveRate_: ' + e.toString());
    return 11.5;
  }
}

function getHistoricalFxRates_(payload) {
  try {
    const dates = Array.isArray(payload.dates) ? payload.dates : [];
    const uniqueDates = Array.from(new Set(dates.filter(Boolean)));
    const results = {};
    uniqueDates.forEach(function(d) {
      results[d] = getHistoricalClosingRate_(d);
    });
    return successResponse_({ rates: results });
  } catch (e) {
    return errorResponse_(e.toString());
  }
}

// ─────────────────────────────────────────────────────────────
// VENDOR CURRENCY LOOKUP
// ─────────────────────────────────────────────────────────────

function getVendorCurrency_(vendorCode) {
  const sheet = getSheet_(SHEET_NAMES.VENDOR_MASTERS);
  const header = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();
  const vendorCodeCol = header.vendor_code;
  const currencyCol = header.Currency;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][vendorCodeCol] || '').trim() === String(vendorCode).trim()) {
      return String(data[i][currencyCol] || '').trim() || 'RMB';
    }
  }
  return 'RMB';
}


// ─────────────────────────────────────────────────────────────
// CONVERSION CHARGE CONFIG
// ─────────────────────────────────────────────────────────────

function getConversionChargePercent_() {
  const v = PropertiesService.getScriptProperties().getProperty('CONVERSION_CHARGE_PCT');
  const pct = parseFloat(v);
  return (v !== null && !isNaN(pct) && pct >= 0) ? pct : 0;
}

function setConversionChargePercent_(pct) {
  const val = parseFloat(pct);
  if (isNaN(val) || val < 0) throw new Error('chargePercent must be a non-negative number');
  PropertiesService.getScriptProperties().setProperty('CONVERSION_CHARGE_PCT', String(val));
  return val;
}

// ─────────────────────────────────────────────────────────────
// IGST % CONFIG
// ─────────────────────────────────────────────────────────────

function getIgstPercent_() {
  const v = PropertiesService.getScriptProperties().getProperty('IGST_PERCENT');
  const pct = parseFloat(v);
  return (v !== null && !isNaN(pct) && pct >= 0) ? pct : 5;
}

function setIgstPercent_(pct) {
  const val = parseFloat(pct);
  if (isNaN(val) || val < 0) throw new Error('igstPercent must be a non-negative number');
  PropertiesService.getScriptProperties().setProperty('IGST_PERCENT', String(val));
  return val;
}

// ─────────────────────────────────────────────────────────────
// CNF COMMISSION RATES
// ─────────────────────────────────────────────────────────────

function getCnfCommissionRates_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CNF_Commission_Rates');
  if (!sheet) throw new Error("Sheet 'CNF_Commission_Rates' not found. Create it with header row: ID | Label | RatePct");
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    rows.push({ id: String(data[i][0]), label: String(data[i][1]), ratePct: Number(data[i][2]) || 0 });
  }
  return rows;
}

function setCnfCommissionRates_(rates) {
  if (!Array.isArray(rates)) {
    throw new Error('Invalid payload: rates must be an array.');
  }
  rates.forEach(function (r, i) {
    if (!r || !r.id) {
      throw new Error('Invalid rate entry at index ' + i + ': id is required.');
    }
  });

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CNF_Commission_Rates');
  if (!sheet) throw new Error("Sheet 'CNF_Commission_Rates' not found. Create it with header row: ID | Label | RatePct");
  sheet.clearContents();
  sheet.appendRow(['ID', 'Label', 'RatePct']);
  rates.forEach(function (r) {
    sheet.appendRow([r.id, r.label, Number(r.ratePct) || 0]);
  });
  return getCnfCommissionRates_();
}

// ─────────────────────────────────────────────────────────────
// CNF AIR RATE CATEGORIES — weight-based (₹/kg) categories for Air CNF
// entries, kept as a separate table from CNF_Commission_Rates (Sea's %
// categories) so the two rate bases can never be cross-selected by mistake.
// See docs/superpowers/specs/2026-09-24-cnf-air-shipment-recon-design.md.
// ─────────────────────────────────────────────────────────────

function getCnfAirRateCategoriesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('CNF_Air_Rate_Categories');
  if (!sheet) {
    sheet = ss.insertSheet('CNF_Air_Rate_Categories');
    sheet.appendRow(['ID', 'Label', 'Rate Per Kg']);
  }
  return sheet;
}

function getCnfAirRateCategories_() {
  const sheet = getCnfAirRateCategoriesSheet_();
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    rows.push({ id: String(data[i][0]), label: String(data[i][1]), ratePerKg: Number(data[i][2]) || 0 });
  }
  return rows;
}

function setCnfAirRateCategories_(categories) {
  if (!Array.isArray(categories)) {
    throw new Error('Invalid payload: categories must be an array.');
  }
  categories.forEach(function (c, i) {
    if (!c || !c.id) {
      throw new Error('Invalid category entry at index ' + i + ': id is required.');
    }
  });

  const sheet = getCnfAirRateCategoriesSheet_();
  sheet.clearContents();
  sheet.appendRow(['ID', 'Label', 'Rate Per Kg']);
  categories.forEach(function (c) {
    sheet.appendRow([c.id, c.label, Number(c.ratePerKg) || 0]);
  });
  return getCnfAirRateCategories_();
}

// ─────────────────────────────────────────────────────────────
// SHIPMENT PARTNER DEFAULTS — each Shipment Partner's default Air Rate
// Category. The partner NAME list itself is not stored here — it's read
// live from SKU_Config!R (see apiGetShipmentPartners_ in NewSkuApi.js) so a
// name removed from the sheet naturally drops out of the dropdown.
// ─────────────────────────────────────────────────────────────

function getShipmentPartnerDefaultsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('CNF_Shipment_Partner_Defaults');
  if (!sheet) {
    sheet = ss.insertSheet('CNF_Shipment_Partner_Defaults');
    sheet.appendRow(['Partner', 'Default Category ID']);
  }
  return sheet;
}

function getShipmentPartnerDefaults_() {
  const sheet = getShipmentPartnerDefaultsSheet_();
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    rows.push({ partner: String(data[i][0]), defaultCategoryId: String(data[i][1] || '') });
  }
  return rows;
}

function setShipmentPartnerDefaults_(defaults) {
  if (!Array.isArray(defaults)) {
    throw new Error('Invalid payload: defaults must be an array.');
  }
  defaults.forEach(function (d, i) {
    if (!d || !d.partner) {
      throw new Error('Invalid default entry at index ' + i + ': partner is required.');
    }
  });

  const sheet = getShipmentPartnerDefaultsSheet_();
  sheet.clearContents();
  sheet.appendRow(['Partner', 'Default Category ID']);
  defaults.forEach(function (d) {
    sheet.appendRow([d.partner, d.defaultCategoryId || '']);
  });
  return getShipmentPartnerDefaults_();
}

// Prefers a payment row's persisted, charge-adjusted Settled ER2 (locked in at the
// moment that payment was logged). Falls back to the raw ER2 for rows logged before
// the Settled ER2 column existed, so historical payments aren't broken.
function resolveSettledRate_(paymentRow) {
  const settled = parseFloat(paymentRow['Settled ER2']);
  if (!isNaN(settled) && settled > 0) return settled;
  return parseFloat(paymentRow.ER2 || paymentRow.fxRate || paymentRow.fx_rate || '0') || 0;
}

// Appends one new liability row directly to PurchaseInvoices, already priced (ER1 known
// up front — used by settleViaWalletTransfer_'s shortfall case, where the historical rate
// was already resolved to price the transfer itself, so there's no separate EOD step to run).
// This is the "liability wallet" record (balance, ER1/INR) only — it does NOT post to
// VendorLedger itself. The caller (settleViaWalletTransfer_) does that, labeling it as an
// 'Adjustment (Paid to X)' rather than a 'Purchase': from the ledger's perspective this is
// a payment/transfer event, not a goods purchase, even though PurchaseInvoices tracks it
// as a real liability underneath.
function appendPricedPurchaseInvoice_(invoiceId, vendorCode, rmb, dateStr, er1, notes) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('PurchaseInvoices');
  if (!sheet) return;
  const headers    = sheet.getDataRange().getValues()[0];
  const idIdx      = findHeaderIndex_(headers, 'Invoice ID');
  const vCodeIdx   = findHeaderIndex_(headers, 'Vendor Code');
  const rmbIdx     = findHeaderIndex_(headers, 'RMB');
  const notesIdx   = findHeaderIndex_(headers, 'Notes');
  const er1Idx     = findHeaderIndex_(headers, 'ER1');
  const inrIdx     = findHeaderIndex_(headers, 'INR');
  const settledIdx = findHeaderIndex_(headers, 'Settled Amount');
  const balanceIdx = findHeaderIndex_(headers, 'Balance');
  const statusIdx  = findHeaderIndex_(headers, 'Status');
  const round2 = v => Math.round(v * 100) / 100;

  const row = new Array(Math.max(headers.length, 10)).fill('');
  row[0] = dateStr;
  if (idIdx      !== -1) row[idIdx]      = invoiceId;
  if (vCodeIdx   !== -1) row[vCodeIdx]   = vendorCode;
  if (rmbIdx     !== -1) row[rmbIdx]     = round2(rmb);
  if (notesIdx   !== -1) row[notesIdx]   = notes || '';
  if (er1Idx     !== -1) row[er1Idx]     = round2(er1);
  if (inrIdx     !== -1) row[inrIdx]     = round2(rmb * er1);
  if (settledIdx !== -1) row[settledIdx] = 0;
  if (balanceIdx !== -1) row[balanceIdx] = round2(rmb);
  if (statusIdx  !== -1) row[statusIdx]  = 'Processed'; else row[9] = 'Processed';
  sheet.appendRow(row);
  invalidateSheetCache_('PurchaseInvoices');
}

// A payment ID is a "wallet" of unspent RMB at its own Settled ER2. A cross-vendor transfer
// draws down the paying vendor's own unspent wallets oldest-first, and MATERIALIZES the
// result as a brand-new wallet row for the receiving vendor (Payment ID = refId, an IDP-
// series id) rather than just returning a rate — so every cross-vendor credit is a real,
// FIFO-settleable PaymentLogs row like any direct payment.
//
// If the paying vendor's own wallets don't cover the full transfer amount, the shortfall is
// priced at that day's GOOGLEFINANCE closing rate and recorded as a PurchaseInvoices row
// (invoice id "XFER-<refId>") — the durable "liability wallet" for balance/ER1/INR tracking.
// This function itself then mirrors that shortfall into VendorLedger as an
// 'Adjustment (Paid to X)' row (NOT 'Purchase' — no goods changed hands, this is a
// payment/transfer event), on top of whichever 'Adjustment (Paid to X)' row the caller logs
// for the wallet-funded portion. Returns walletFundedAmount/shortfallAmount (summing to
// amountRmb) so the caller knows how much it still needs to log itself.
function settleViaWalletTransfer_(sourceVendor, targetVendor, amountRmb, dateStr, refId) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('PaymentLogs');
  if (!sheet) return { rate: getLiveRate_() || 11.5, walletPaymentId: refId, walletFundedAmount: 0, shortfallAmount: amountRmb };

  const headers    = sheet.getDataRange().getValues()[0];
  const balanceIdx = findHeaderIndex_(headers, 'Balance');

  const wallets = getSheetData_('PaymentLogs')
    .map((pay, idx) => ({ ...pay, sheetRow: idx + 2 }))
    .filter(pay => {
      // PaymentLogs' actual header is 'vendor_code' (snake_case) — getValue_ does exact
      // key matching, no normalization, so this MUST include the literal header text or
      // every row silently fails the match. Without 'vendor_code' here, this filter always
      // returned zero wallets regardless of real balance, forcing every cross-vendor
      // transfer into a 100% shortfall (confirmed: every XFER-IDP-* invoice in
      // PurchaseInvoices has Balance === RMB, i.e. never drew from an existing wallet).
      const v = String(getValue_(pay, ['vendor_code', 'Vendor Code', 'vendorCode', 'VendorCode', 'Vendor ID'])).trim();
      if (v !== String(sourceVendor).trim()) return false;
      const b = parseFloat(pay.Balance);
      return !isNaN(b) && b > 0.01;
    })
    .sort((a, b) => new Date(a.Date || a.date).getTime() - new Date(b.Date || b.date).getTime());

  let remaining   = amountRmb;
  let weightedSum = 0;
  const round2 = v => Math.round(v * 100) / 100;

  for (const wallet of wallets) {
    if (remaining <= 0.01) break;
    const available = parseFloat(wallet.Balance) || 0;
    if (available <= 0) continue;
    const draw = Math.min(remaining, available);
    const rate = resolveSettledRate_(wallet);
    weightedSum += draw * rate;
    remaining -= draw;
    if (balanceIdx !== -1) {
      sheet.getRange(wallet.sheetRow, balanceIdx + 1).setValue(round2(available - draw));
    }
  }
  // Two cross-vendor transfers from the same source vendor within the cache
  // window would otherwise double-draw the same wallet row (same bug class
  // as fifoLiquidate_).
  invalidateSheetCache_('PaymentLogs');

  const walletFundedAmount = round2(Math.max(0, amountRmb - remaining));
  const shortfallAmount    = round2(Math.max(0, remaining));

  let shortfallInvoiceId = null;
  if (remaining > 0.01) {
    const historical   = getHistoricalClosingRate_(dateStr);
    const fallbackRate = (historical.success && historical.rate > 0) ? historical.rate : (getLiveRate_() || 11.5);
    weightedSum += remaining * fallbackRate;

    // Includes targetVendor, not just refId: a multi-recipient Cross-Vendor Settlement
    // batch shares one refId across several different-vendor allocations (by design —
    // see the duplicate-submission guard in addAdjustmentEntry). If more than one
    // allocation in that batch needs a shortfall, 'XFER-' + refId alone would collide —
    // multiple PurchaseInvoices rows with the identical invoice_no, which then confuses
    // fifoLiquidate_'s (paymentId, invoiceId) duplicate guard into treating one row's
    // settlement as if it also covered the other, silently skipping real open balance.
    shortfallInvoiceId = 'XFER-' + refId + '-' + targetVendor;
    appendPricedPurchaseInvoice_(
      shortfallInvoiceId, sourceVendor, remaining, dateStr, fallbackRate,
      'Cross-vendor transfer shortfall — funded ' + targetVendor + ' beyond ' + sourceVendor + '\'s own wallet balance (ref ' + refId + ')'
    );
    logToVendorLedger_(sourceVendor, dateStr, 'Adjustment (Paid to ' + targetVendor + ')', shortfallInvoiceId, -Math.abs(remaining));
  }

  const blendedRate = amountRmb > 0 ? weightedSum / amountRmb : 0;

  // Materialize the receiving vendor's new wallet.
  const payIdIdx = findHeaderIndex_(headers, 'Payment ID');
  const vCodeIdx = findHeaderIndex_(headers, 'Vendor Code') !== -1 ? findHeaderIndex_(headers, 'Vendor Code') : findHeaderIndex_(headers, 'Vendor ID');
  const dateIdx  = findHeaderIndex_(headers, 'Date');
  const rmbIdx   = findHeaderIndex_(headers, 'RMB Amount') !== -1 ? findHeaderIndex_(headers, 'RMB Amount') : findHeaderIndex_(headers, 'RMB');
  const er2Idx   = findHeaderIndex_(headers, 'ER2');
  const settledEr2Idx = findHeaderIndex_(headers, 'Settled ER2');
  const inrIdx   = findHeaderIndex_(headers, 'INR Amount') !== -1 ? findHeaderIndex_(headers, 'INR Amount') : findHeaderIndex_(headers, 'INR');
  const modeIdx  = findHeaderIndex_(headers, 'Payment Mode');
  const refIdx   = findHeaderIndex_(headers, 'Reference No');
  const balIdx   = findHeaderIndex_(headers, 'Balance');

  // 'Source Vendor' records who actually funded this wallet — without it, VendorLedger's
  // Transfer Out/In pair is the ONLY place this pairing exists, which is fragile (see the
  // 2026-08-27 migration that had to reconstruct this from VendorLedger after the fact).
  const sourceVendorIdx = ensureHeaderColumn_(sheet, 'Source Vendor');

  const newWalletRow = new Array(Math.max(headers.length, sourceVendorIdx + 1, 9)).fill('');
  if (dateIdx  !== -1) newWalletRow[dateIdx]  = dateStr;
  if (payIdIdx !== -1) newWalletRow[payIdIdx] = refId;
  if (vCodeIdx !== -1) newWalletRow[vCodeIdx] = targetVendor;
  if (rmbIdx   !== -1) newWalletRow[rmbIdx]   = round2(amountRmb);
  if (er2Idx   !== -1) newWalletRow[er2Idx]   = round2(blendedRate);
  if (settledEr2Idx !== -1) newWalletRow[settledEr2Idx] = round2(blendedRate);
  if (inrIdx   !== -1) newWalletRow[inrIdx]   = round2(amountRmb * blendedRate);
  if (modeIdx  !== -1) newWalletRow[modeIdx]  = 'Cross-Vendor Transfer';
  if (refIdx   !== -1) newWalletRow[refIdx]   = refId;
  if (balIdx   !== -1) newWalletRow[balIdx]   = round2(amountRmb);
  newWalletRow[sourceVendorIdx] = sourceVendor;
  sheet.appendRow(newWalletRow);
  invalidateSheetCache_('PaymentLogs');

  return {
    rate: blendedRate,
    walletPaymentId: refId,
    shortfallInvoiceId: shortfallInvoiceId,
    walletFundedAmount: walletFundedAmount,
    shortfallAmount: shortfallAmount
  };
}

// Idempotency guard for SettlementLedger writes: a retry of an already-succeeded
// submission (e.g. after a false-failure from a flaky response) resends the exact
// same Payment ID + vendor + signed RMB amount. Detect that so callers can no-op
// instead of writing a duplicate row/pair of rows.
function transferLegExists_(paymentId, vendorCode, signedRmb) {
  invalidateSheetCache_('SettlementLedger');
  return getSheetData_('SettlementLedger').some(row =>
    String(row['Payment ID'] || '').trim() === String(paymentId).trim() &&
    String(getValue_(row, ['Vendor Code', 'Vendor ID', 'vendor_code', 'VendorCode', 'VendorID'])).trim() === String(vendorCode).trim() &&
    Math.abs((parseFloat(getValue_(row, ['RMB', 'rmb'])) || 0) - signedRmb) < 0.01
  );
}

// A multi-recipient Cross-Vendor Settlement batch (CrossVendorSettlement.tsx)
// intentionally shares one Payment ID across every allocation row so the whole
// batch groups under one reference — so a plain "does this Payment ID already
// exist in PaymentLogs" check (matching recordExists_ above) wrongly flags row
// 2, 3, ... of a legitimate batch as a duplicate of row 1. Match on vendor +
// amount too, same compound-key approach as transferLegExists_ above.
function paymentLogsWalletRowExists_(paymentId, vendorCode, rmb) {
  invalidateSheetCache_('PaymentLogs');
  return getSheetData_('PaymentLogs').some(row =>
    String(row['Payment ID'] || '').trim() === String(paymentId).trim() &&
    String(getValue_(row, ['Vendor Code', 'Vendor ID', 'vendor_code', 'VendorCode', 'VendorID'])).trim() === String(vendorCode).trim() &&
    Math.abs((parseFloat(getValue_(row, ['RMB Amount', 'RMB', 'rmb'])) || 0) - rmb) < 0.01
  );
}

// Raw existence check ignoring vendor/amount — used to detect a true id COLLISION
// (this exact Payment ID already belongs to someone else's wallet), as opposed to
// paymentLogsWalletRowExists_'s narrower "is this a retry of THIS SAME transfer" check.
// Root cause: generateSequentialIndirectPayId (services/settlementService.ts) computes
// "next" IDP- id from the client's locally-cached PaymentLogs state, non-atomically —
// two transfer submissions close together (from AccountsView's Settle Invoice modal
// and/or CrossVendorSettlement's batch page) can independently compute the same id
// before either write is reflected in the other's cached view. When that happens and
// the ids don't match on vendor+amount (so aren't a legitimate retry), minting a fresh
// id here — under this function's existing script lock, from a live re-read — is
// race-free because every other writer is serialized behind the same lock.
function paymentIdExistsAnywhere_(paymentId) {
  invalidateSheetCache_('PaymentLogs');
  return getSheetData_('PaymentLogs').some(row => String(row['Payment ID'] || '').trim() === String(paymentId).trim());
}

function getHistoricalClosingRate_(dateStr) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheets()[0];
  const cell  = sheet.getRange('Z1');

  try {
    let cursor = new Date(dateStr + 'T00:00:00');
    if (isNaN(cursor.getTime())) return { rate: 0, resolvedDate: dateStr, success: false };

    for (let attempt = 0; attempt < 10; attempt++) {
      const y = cursor.getFullYear(), m = cursor.getMonth() + 1, d = cursor.getDate();
      const formula = '=IFERROR(GOOGLEFINANCE("CURRENCY:CNYINR","close",DATE(' + y + ',' + m + ',' + d + '))," ")';

      cell.setFormula(formula);
      SpreadsheetApp.flush();
      Utilities.sleep(1200);

      // Single-date "close" lookups spill as [Date, Close] — read column AA (index 1)
      // specifically, and sanity-bound it so a stray date serial can never be mistaken
      // for a rate (CNY/INR will never be anywhere near the thousands).
      const block = sheet.getRange('Z1:AA3').getValues();
      let found = 0;
      for (let r = 0; r < block.length; r++) {
        const v = block[r][1];
        if (typeof v === 'number' && v > 0.01 && v < 1000) { found = v; break; }
      }

      if (found) {
        sheet.getRange('Z1:AA3').clearContent();
        const resolvedDateStr = Utilities.formatDate(cursor, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
        return { rate: found, resolvedDate: resolvedDateStr, success: true };
      }

      cursor.setDate(cursor.getDate() - 1);
    }

    sheet.getRange('Z1:AA3').clearContent();
    return { rate: 0, resolvedDate: dateStr, success: false };
  } catch (e) {
    try { sheet.getRange('Z1:AA3').clearContent(); } catch (clearErr) {}
    Logger.log('getHistoricalClosingRate_ error for ' + dateStr + ': ' + e.toString());
    return { rate: 0, resolvedDate: dateStr, success: false };
  }
}


// ─────────────────────────────────────────────────────────────
// CORE WRITE ROUTINES
// ─────────────────────────────────────────────────────────────

// Locked end-to-end (duplicate check through the append/update) so two
// near-simultaneous calls for the same Invoice ID — a double-click, a
// sync-queue retry firing while the original request is still in flight,
// two browser tabs — can't both pass the "no existing row" check before
// either has written anything. Without this, both calls read the sheet,
// both see no match, and both append — producing exact duplicate rows.
// Mirrors the same fix already applied to addPaymentLog/addAdjustmentEntry.
// Prices one PurchaseInvoices row immediately (ER1/INR/Status) and auto-settles it against
// the vendor's existing unspent wallets — the auto-run-on-log replacement for the old
// manual "Run EOD Loop" button, scoped to just the one invoice being logged (no backfill).
function runEodForInvoice_(invoiceId) {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const invSheet = ss.getSheetByName('PurchaseInvoices');
  if (!invSheet) return;

  const values  = invSheet.getDataRange().getValues();
  const headers = values[0];
  const idIdx     = findHeaderIndex_(headers, 'Invoice ID');
  const vCodeIdx  = findHeaderIndex_(headers, 'Vendor Code');
  const rmbIdx    = findHeaderIndex_(headers, 'RMB');
  const er1Idx    = findHeaderIndex_(headers, 'ER1');
  const inrIdx    = findHeaderIndex_(headers, 'INR');
  const statusIdx = findHeaderIndex_(headers, 'Status');
  if (idIdx === -1) return;

  let rowIdx = -1, vCode = '', rmb = 0, rawDate = null;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIdx] || '').trim().toUpperCase() === String(invoiceId).trim().toUpperCase()) {
      rowIdx  = i + 1;
      vCode   = vCodeIdx !== -1 ? String(values[i][vCodeIdx] || '').trim() : '';
      rmb     = rmbIdx   !== -1 ? (parseFloat(values[i][rmbIdx]) || 0) : 0;
      rawDate = values[i][0];
      break;
    }
  }
  if (rowIdx === -1) return;

  const dateStr = (rawDate instanceof Date) ? rawDate.toISOString().split('T')[0] : String(rawDate || '').split('T')[0];
  const round2  = v => Math.round(v * 100) / 100;

  const isInrVendor = getVendorCurrency_(vCode) === 'INR';
  let rate;
  if (isInrVendor) {
    rate = 1;
  } else {
    const historical = getHistoricalClosingRate_(dateStr);
    rate = (historical.success && historical.rate > 0) ? historical.rate : (getLiveRate_() || 11.5);
  }

  if (er1Idx    !== -1) invSheet.getRange(rowIdx, er1Idx + 1).setValue(round2(rate));
  if (inrIdx    !== -1) invSheet.getRange(rowIdx, inrIdx + 1).setValue(round2(rmb * rate));
  if (statusIdx !== -1) invSheet.getRange(rowIdx, statusIdx + 1).setValue('Processed');
  invalidateSheetCache_('PurchaseInvoices');

  autoSettleAdvanceFromInvoice_(vCode, dateStr, invoiceId, rmb);
}

function addPurchaseInvoice(data) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('PurchaseInvoices');
  if (!sheet) return errorResponse_('PurchaseInvoices sheet not found');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return errorResponse_('Another invoice is currently being logged. Please try again in a moment.');
  }

  try {
    const record = data.record || data;
    const invId  = (record.invoiceId || '').trim().toUpperCase();
    const vCode  = (record.vendorCode || '').trim();
    const rmb    = parseFloat(record.rmb) || 0;
    const date   = record.date || new Date().toISOString().split('T')[0];

    const dataValues = sheet.getDataRange().getValues();
    const headers    = dataValues[0];
    const idIdx      = findHeaderIndex_(headers, 'Invoice ID');
    const rmbIdx     = findHeaderIndex_(headers, 'RMB');
    const settledIdx = findHeaderIndex_(headers, 'Settled Amount');
    const balanceIdx = findHeaderIndex_(headers, 'Balance');
    const inrIdx     = findHeaderIndex_(headers, 'INR');
    const er1Idx     = findHeaderIndex_(headers, 'ER1');
    const statusIdx  = findHeaderIndex_(headers, 'Status');

    let existingRowIdx = -1;
    if (idIdx !== -1) {
      for (let i = 1; i < dataValues.length; i++) {
        if (dataValues[i][idIdx].toString().trim().toUpperCase() === invId) {
          existingRowIdx = i + 1; break;
        }
      }
    }

    const round2 = v => Math.round(v * 100) / 100;

    if (existingRowIdx === -1) {
      const rowToAppend = new Array(Math.max(headers.length, 10)).fill('');
      rowToAppend[0] = date;
      if (idIdx    !== -1) rowToAppend[idIdx]    = invId;
      const vCodeIdx = findHeaderIndex_(headers, 'Vendor Code');
      if (vCodeIdx !== -1) rowToAppend[vCodeIdx] = vCode;
      if (rmbIdx   !== -1) rowToAppend[rmbIdx]   = round2(rmb);
      const notesIdx = findHeaderIndex_(headers, 'Notes');
      if (notesIdx !== -1) rowToAppend[notesIdx] = record.notes || '';
      if (er1Idx   !== -1) rowToAppend[er1Idx]   = '';
      if (inrIdx   !== -1) rowToAppend[inrIdx]   = '';
      if (settledIdx !== -1) rowToAppend[settledIdx] = 0;
      if (balanceIdx !== -1) rowToAppend[balanceIdx] = round2(rmb);
      if (statusIdx !== -1) rowToAppend[statusIdx] = 'Pending EOD';
      else rowToAppend[9] = 'Pending EOD';
      sheet.appendRow(rowToAppend);
      logToVendorLedger_(vCode, date, 'Purchase', invId, -Math.abs(rmb));
    } else {
      const settled  = parseFloat(dataValues[existingRowIdx - 1][settledIdx]) || 0;
      const vCodeIdx = findHeaderIndex_(headers, 'Vendor Code');
      const notesIdx = findHeaderIndex_(headers, 'Notes');
      sheet.getRange(existingRowIdx, 1).setValue(date);
      if (vCodeIdx  !== -1) sheet.getRange(existingRowIdx, vCodeIdx  + 1).setValue(vCode);
      if (rmbIdx    !== -1) sheet.getRange(existingRowIdx, rmbIdx    + 1).setValue(rmb);
      if (notesIdx  !== -1) sheet.getRange(existingRowIdx, notesIdx  + 1).setValue(record.notes || '');
      if (er1Idx    !== -1) sheet.getRange(existingRowIdx, er1Idx    + 1).setValue('');
      if (inrIdx    !== -1) sheet.getRange(existingRowIdx, inrIdx    + 1).setValue('');
      if (balanceIdx !== -1) sheet.getRange(existingRowIdx, balanceIdx + 1).setValue(rmb - settled);
      if (statusIdx  !== -1) sheet.getRange(existingRowIdx, statusIdx  + 1).setValue('Pending EOD');
    }
    // getSheetData_('PurchaseInvoices') is cached 5 minutes — without this, a
    // payment settled within that window against a just-created/just-updated
    // invoice would read a stale pre-write snapshot (see fifoLiquidate_).
    invalidateSheetCache_('PurchaseInvoices');

    // Auto-EOD this one invoice immediately — both branches above just reset ER1/INR to
    // blank and Status to 'Pending EOD', so this always has pricing work to do. Replaces
    // the old manual "Run EOD Loop" button; scoped to only the invoice just logged.
    runEodForInvoice_(invId);

    return successResponse_({ message: 'Purchase Invoice upserted successfully', invoiceId: invId });
  } catch (e) {
    return errorResponse_(e.toString());
  } finally {
    lock.releaseLock();
  }
}

function addVendorAccount(data) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('VendorAccounts');
  if (!sheet) return errorResponse_('VendorAccounts sheet not found');
  try {
    const record       = data.record || data;
    const vendorId     = (record.vendor_id || record.vendor_code || '').trim();
    const vendorName   = (record.vendor_name || '').trim();
    const currency     = record.currency     || 'USD';
    const country      = record.country      || 'China';
    const paymentTerms = record.payment_terms || 'Net 30';
    const isActive     = record.hasOwnProperty('is_active') ? record.is_active : 'TRUE';

    if (!vendorId)   return errorResponse_('vendor_id cannot be empty');
    if (!vendorName) return errorResponse_('vendor_name cannot be empty');

    const dataValues = sheet.getDataRange().getValues();
    const headers    = dataValues[0];
    const idIdx      = findHeaderIndex_(headers, 'Vendor ID')   !== -1 ? findHeaderIndex_(headers, 'Vendor ID')   : findHeaderIndex_(headers, 'vendor_id');
    const nameIdx    = findHeaderIndex_(headers, 'Vendor Name') !== -1 ? findHeaderIndex_(headers, 'Vendor Name') : findHeaderIndex_(headers, 'vendor_name');
    const currIdx    = findHeaderIndex_(headers, 'Currency')    !== -1 ? findHeaderIndex_(headers, 'Currency')    : findHeaderIndex_(headers, 'currency');
    const countryIdx = findHeaderIndex_(headers, 'Country')     !== -1 ? findHeaderIndex_(headers, 'Country')     : findHeaderIndex_(headers, 'country');
    const termsIdx   = findHeaderIndex_(headers, 'payment_terms') !== -1 ? findHeaderIndex_(headers, 'payment_terms') : findHeaderIndex_(headers, 'Payment Terms');
    const activeIdx  = findHeaderIndex_(headers, 'is_active')   !== -1 ? findHeaderIndex_(headers, 'is_active')   : findHeaderIndex_(headers, 'Is Active');

    const targetIdx = idIdx !== -1 ? idIdx : 0;
    let existingRowIdx = -1;
    for (let i = 1; i < dataValues.length; i++) {
      if (String(dataValues[i][targetIdx]).trim().toLowerCase() === vendorId.toLowerCase()) {
        existingRowIdx = i + 1; break;
      }
    }

    if (existingRowIdx === -1) {
      const rowToAppend = new Array(Math.max(headers.length, 6)).fill('');
      if (idIdx      !== -1) rowToAppend[idIdx]      = vendorId;
      if (nameIdx    !== -1) rowToAppend[nameIdx]    = vendorName;
      if (currIdx    !== -1) rowToAppend[currIdx]    = currency;
      if (countryIdx !== -1) rowToAppend[countryIdx] = country;
      if (termsIdx   !== -1) rowToAppend[termsIdx]   = paymentTerms;
      if (activeIdx  !== -1) rowToAppend[activeIdx]  = isActive;
      sheet.appendRow(rowToAppend);
      return successResponse_({ message: 'Vendor added successfully', vendor_id: vendorId, vendor_name: vendorName });
    } else {
      if (nameIdx !== -1 && !dataValues[existingRowIdx - 1][nameIdx]) {
        sheet.getRange(existingRowIdx, nameIdx + 1).setValue(vendorName);
      }
      return successResponse_({ message: 'Vendor already exists', vendor_id: vendorId, vendor_name: vendorName });
    }
  } catch (e) {
    return errorResponse_(e.toString());
  }
}

// ─────────────────────────────────────────────────────────────
// SYNC PAYMENTS → PAYMENT LOGS (real writes, not a display merge)
// ─────────────────────────────────────────────────────────────
// Any row in 'Payments' that has no matching 'Payment ID' in
// 'PaymentLogs' yet (seeded/pre-existing data, or a row added directly
// in the sheet, or one that predates the logPayment() mirror) gets
// pushed through the REAL addPaymentLog() — same function a normal
// payment log entry goes through — so it actually appears in
// PaymentLogs AND triggers the same VendorLedger entry + FIFO invoice
// liquidation (fifoLiquidate_) that any other payment log does. This is
// not a read-time display trick; it's a real write with real financial
// side effects, run once per Payment ID (addPaymentLog's own duplicate
// check makes repeat calls for already-synced rows a no-op).
// Returns { synced: [...paymentIds], failed: [{paymentId, message}] }.
function syncPaymentsIntoPaymentLogs_() {
  const paymentLogs = getSheetData_('PaymentLogs');
  const payments     = getSheetData_('Payments');

  const existingIds = new Set(
    paymentLogs.map(r => String(r['Payment ID'] || '').trim()).filter(Boolean)
  );

  const pending = payments.filter(p => {
    const id = String(p.payment_id || '').trim();
    return id && !existingIds.has(id);
  });

  const synced = [];
  const failed = [];

  pending.forEach(p => {
    const paymentId = String(p.payment_id || '').trim();
    try {
      const response = addPaymentLog({
        record: {
          'Date':          p.payment_date || '',
          'Payment ID':    paymentId,
          'Vendor Code':   p.vendor_id || '',
          'RMB Amount':    Number(p.amount_foreign) || 0,
          'ER2':           Number(p.day_fx_rate) || 0,
          'INR Amount':    Number(p.amount_inr) || 0,
          'Payment Mode':  p.payment_mode || '',
          'Reference No':  p.reference_no || '',
        }
      });
      const parsed = JSON.parse(response.getContent());
      if (parsed.status === 'error') {
        failed.push({ paymentId, message: parsed.message });
        Logger.log('syncPaymentsIntoPaymentLogs_: failed for ' + paymentId + ' — ' + parsed.message);
      } else {
        synced.push(paymentId);
      }
    } catch (e) {
      failed.push({ paymentId, message: e.message });
      Logger.log('syncPaymentsIntoPaymentLogs_: threw for ' + paymentId + ' — ' + e.message);
    }
  });

  if (synced.length > 0) invalidateSheetCache_('PaymentLogs');

  return { synced, failed };
}

// Payment Entries tab (Accounts View) calls this to read PaymentLogs —
// first syncing any not-yet-processed Payments rows for real (see
// syncPaymentsIntoPaymentLogs_ above), then returning the up-to-date sheet.
function getLinkedPaymentLogs_() {
  syncPaymentsIntoPaymentLogs_();
  return getSheetData_('PaymentLogs');
}

// Locked end-to-end (duplicate check through the FIFO settlement writes)
// so two near-simultaneous calls for the same Payment ID — e.g. from two
// deployments, or two browser tabs both refreshing Payment Entries at
// once — can't both pass the duplicate check before either has written
// anything. The second call waits for the lock, then its own fresh
// recordExists_ check (see above) correctly finds the first call's row
// and rejects as a duplicate instead of double-writing/double-settling.
function addPaymentLog(data) {
  const ss           = SpreadsheetApp.getActiveSpreadsheet();
  const paymentSheet = ss.getSheetByName('PaymentLogs');
  if (!paymentSheet) return errorResponse_('PaymentLogs sheet not found');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return errorResponse_('Another payment is currently being logged. Please try again in a moment.');
  }

  try {
    const record    = data.record || data;
    const date      = record['Date'] || record.date || record['Payment Date'] || new Date().toISOString().split('T')[0];
    const passedPayId = record['Payment ID'] || record.paymentId || record.PaymentID;
    const payId     = passedPayId ? String(passedPayId).trim() : generateSequentialDirectPayId();
    const vCode     = record['Vendor Code'] || record.vendorCode || record.VendorCode || record['Vendor ID'] || record.vendor_id || '';
    let rmb  = parseFloat(record['RMB Amount'] || record.rmbAmount || record.rmb  || record.RMB  || '0') || 0;
    let er2  = parseFloat(record.ER2 || record.fxRate || record.fx_rate || record.er2 || '0') || 0;
    let inr  = parseFloat(record['INR Amount'] || record.inrAmount || record.inr  || record.INR  || '0') || 0;
    const mode = record['Payment Mode'] || record.paymentMode || record.payment_mode || '';
    const ref  = record['Reference No']  || record.referenceNo  || record.reference_no  || '';

    if (rmb && er2 && !inr)       inr = rmb * er2;
    else if (inr && er2 && !rmb)  rmb = inr / er2;
    else if (rmb && inr && !er2)  er2 = inr / rmb;
    if (rmb && er2) inr = Math.round(rmb * er2 * 100) / 100;

    const balance = parseFloat(record['Balance'] || record.balance || rmb) || rmb;

    if (!payId)   return errorResponse_('Validation Error: Payment ID cannot be blank');
    if (!vCode)   return errorResponse_('Validation Error: Vendor Code cannot be blank');
    if (rmb <= 0) return errorResponse_('Validation Error: Payment amount (RMB) must be greater than 0');
    if (er2 <= 0) return errorResponse_('Validation Error: Exchange rate (ER2) must be greater than 0');
    // The frontend sync queue assigns a Payment ID up front and reuses it verbatim
    // across retries so writes are safely idempotent (see services/syncQueue.ts) —
    // a client cold-start/timeout can lose the success response for a write that
    // actually landed, and the queue will then retry the exact same Payment ID.
    // Treating that as an error (as this used to) meant the retry could never
    // succeed, permanently stranding the queue item as "failed" even though the
    // payment was already correctly logged and settled. Match the existing
    // idiom used by transferLegExists_ / addVendorAccount's own duplicate
    // checks: a duplicate submission is a no-op success, not a failure.
    if (recordExists_('PaymentLogs', 'Payment ID', payId)) {
      return successResponse_({ message: 'Payment already logged (duplicate submission ignored)', paymentId: payId });
    }

    // Settled ER2 is ER2 adjusted for the conversion/payment charge baked into a manual
    // money-transfer rate. Computed once, here, and persisted — every later settlement
    // against this payment (direct FIFO below, or a cross-vendor wallet draw much later)
    // always uses this stored value, so a later change to the charge % never retroactively
    // reprices an already-logged payment. INR-native vendors have no real money-transfer
    // conversion happening — this charge only makes sense for actual RMB currency
    // conversion — so they're exempted entirely, keeping ER2 (already 1.0 for these
    // vendors) unadjusted and forexGainLoss at exactly 0.
    const chargePct      = getConversionChargePercent_();
    const vendorCurrency = getVendorCurrency_(vCode);
    const settledEr2     = (chargePct > 0 && vendorCurrency !== 'INR') ? er2 / (1 + chargePct / 100) : er2;

    const headers  = paymentSheet.getDataRange().getValues()[0];
    const dateIdx  = findHeaderIndex_(headers, 'Date');
    const payIdIdx = findHeaderIndex_(headers, 'Payment ID');
    const vCodeIdx = findHeaderIndex_(headers, 'Vendor Code') !== -1 ? findHeaderIndex_(headers, 'Vendor Code') : findHeaderIndex_(headers, 'Vendor ID');
    const rmbIdx   = findHeaderIndex_(headers, 'RMB Amount')  !== -1 ? findHeaderIndex_(headers, 'RMB Amount')  : findHeaderIndex_(headers, 'RMB');
    const er2Idx   = findHeaderIndex_(headers, 'ER2');
    const settledEr2Idx = findHeaderIndex_(headers, 'Settled ER2');
    const inrIdx   = findHeaderIndex_(headers, 'INR Amount')  !== -1 ? findHeaderIndex_(headers, 'INR Amount')  : findHeaderIndex_(headers, 'INR');
    const modeIdx  = findHeaderIndex_(headers, 'Payment Mode');
    const refIdx   = findHeaderIndex_(headers, 'Reference No');
    const balIdx   = findHeaderIndex_(headers, 'Balance');

    const round2 = v => Math.round(v * 100) / 100;
    const rowToAppend = new Array(Math.max(headers.length, 9)).fill('');
    if (dateIdx  !== -1) rowToAppend[dateIdx]  = date;
    if (payIdIdx !== -1) rowToAppend[payIdIdx] = payId;
    if (vCodeIdx !== -1) rowToAppend[vCodeIdx] = vCode;
    if (rmbIdx   !== -1) rowToAppend[rmbIdx]   = round2(rmb);
    if (er2Idx   !== -1) rowToAppend[er2Idx]   = er2;
    if (settledEr2Idx !== -1) rowToAppend[settledEr2Idx] = round2(settledEr2);
    if (inrIdx   !== -1) rowToAppend[inrIdx]   = round2(inr);
    if (modeIdx  !== -1) rowToAppend[modeIdx]  = mode;
    if (refIdx   !== -1) rowToAppend[refIdx]   = ref;
    if (balIdx   !== -1) rowToAppend[balIdx]   = round2(balance);
    paymentSheet.appendRow(rowToAppend);
    // Without this, a same-batch EOD advance-match (autoSettleAdvanceFromInvoice_
    // reads PaymentLogs via the cached getSheetData_) run within the next 5
    // minutes would miss this payment entirely — same bug class as fifoLiquidate_.
    invalidateSheetCache_('PaymentLogs');

    logToVendorLedger_(vCode, date, 'Payment', payId, Math.abs(rmb));

    if (record.isCrossVendor && record.allocations && record.allocations.length > 0) {
      // Two distinct logs, direct first: the DP- wallet just created above (full rmb) is
      // the payer's own money; each cross-vendor allocation is a separate IDP- wallet
      // drawn from it (and, transitively, any of the payer's other unspent wallets —
      // settleViaWalletTransfer_ drains FIFO across all of them, not just this one).
      for (const alloc of record.allocations) {
        if (alloc.vendorCode !== vCode && alloc.amount > 0) {
          const idpId = generateSequentialIndirectPayId();
          // Same split as addAdjustmentEntry's Transfer branch: wallet-funded portion is
          // an Adjustment, shortfall portion is a Purchase (posted by settleViaWalletTransfer_
          // itself) — never both for the same RMB.
          const xfer = settleViaWalletTransfer_(vCode, alloc.vendorCode, alloc.amount, date, idpId);
          if (xfer.walletFundedAmount > 0.01) {
            logToVendorLedger_(vCode, date, 'Adjustment (Paid to ' + alloc.vendorCode + ')', idpId, -Math.abs(xfer.walletFundedAmount));
          }
          logToVendorLedger_(alloc.vendorCode, date, 'Adjustment (Received from ' + vCode + ')', idpId, Math.abs(alloc.amount));
          fifoLiquidate_(alloc.vendorCode, date, idpId, alloc.amount, xfer.rate);
        }
      }
      const ownAlloc = record.allocations.find(a => a.vendorCode === vCode);
      if (ownAlloc && ownAlloc.amount > 0) {
        fifoLiquidate_(vCode, date, payId, ownAlloc.amount, settledEr2);
      }
    } else {
      fifoLiquidate_(vCode, date, payId, rmb, settledEr2);
    }

    return successResponse_({ status: 'success', paymentId: payId });
  } catch (e) {
    return errorResponse_(e.toString());
  } finally {
    lock.releaseLock();
  }
}

function addAdjustmentEntry(data) {
  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const ledgerSheet = ss.getSheetByName('SettlementLedger');
  if (!ledgerSheet) return errorResponse_('SettlementLedger sheet not found');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return errorResponse_('Another adjustment is currently being logged. Please try again in a moment.');
  }

  try {
    const record  = data.record || data;
    const txnType = record.txnType || 'Adjustment';
    const date    = record.date    || new Date().toISOString().split('T')[0];
    const notes   = record.notes   || '';
    const round2  = v => Math.round(v * 100) / 100;

    if (txnType === 'Transfer') {
      const sourceVendor = record.sourceVendor;
      const targetVendor = record.targetVendor;
      const amountRmb    = parseFloat(record.amountRmb) || 0;
      const invoiceId    = record.invoiceId || '';
      // Every cross-vendor transfer is an "indirect payment" wallet — IDP-00001 series,
      // replacing the old ADJ-YYYYMMDD-NNN-XXXX format. The frontend pre-generates this
      // (same idempotency pattern as addPaymentLog's Payment ID) so a retry reuses the
      // same id; generateSequentialIndirectPayId() is only the fallback for a caller that
      // didn't supply one.
      const refId = record.paymentId || generateSequentialIndirectPayId();

      // Duplicate-submission guard, matched on target vendor + amount too (not Payment ID
      // alone) — a single multi-recipient Cross-Vendor Settlement batch legitimately shares
      // one Payment ID across several different-vendor rows; matching on Payment ID alone
      // would silently drop every row after the first.
      if (paymentLogsWalletRowExists_(refId, targetVendor, round2(Math.abs(amountRmb)))) {
        return successResponse_({ message: 'Transfer already logged (duplicate submission ignored)', id: refId });
      }

      // refId exists but didn't match the retry check above (different vendor and/or
      // amount) — this is a genuine id COLLISION with an unrelated transfer, not a retry
      // of this one (see paymentIdExistsAnywhere_ for how this happens). Mint a fresh id
      // right here, under this function's lock and from a live re-read, so it's
      // guaranteed unique instead of trusting the client's possibly-stale guess.
      let finalRefId = refId;
      if (paymentIdExistsAnywhere_(refId)) {
        finalRefId = generateSequentialIndirectPayId();
        Logger.log('addAdjustmentEntry: Payment ID collision on ' + refId + ' (client-supplied) — reassigned to ' + finalRefId);
      }

      // Materializes the IDP- wallet for targetVendor (draining sourceVendor's own wallets
      // FIFO for the rate, creating a shortfall liability wallet against sourceVendor if
      // their wallets don't cover the full amount). Run this FIRST so the Adjustment below
      // can be split correctly: the wallet-funded portion becomes an Adjustment, the
      // shortfall portion becomes a Purchase (posted inside settleViaWalletTransfer_ via
      // appendPricedPurchaseInvoice_) — never both for the same RMB.
      const transferResult = settleViaWalletTransfer_(sourceVendor, targetVendor, amountRmb, date, finalRefId);
      const settledRate    = transferResult.rate;

      if (transferResult.walletFundedAmount > 0.01) {
        logToVendorLedger_(sourceVendor, date, 'Adjustment (Paid to ' + targetVendor + ')', finalRefId, -Math.abs(transferResult.walletFundedAmount));
      }
      logToVendorLedger_(targetVendor, date, 'Adjustment (Received from ' + sourceVendor + ')', finalRefId, Math.abs(amountRmb));

      if (invoiceId) {
        // "Settle Invoice" modal (AccountsView.tsx) — this transfer is earmarked to pay
        // down one *specific* invoice, not just top up the vendor's wallet for generic
        // FIFO later. Apply the new IDP- wallet directly against that named invoice.
        let er1 = 0, forexGainLoss = 0;
        const invSheet2   = ss.getSheetByName('PurchaseInvoices');
        const invValues2  = invSheet2 ? invSheet2.getDataRange().getValues() : [];
        const invHeaders2 = invValues2[0] || [];
        const invIdIdx2      = findHeaderIndex_(invHeaders2, 'Invoice ID');
        const invSettledIdx2 = findHeaderIndex_(invHeaders2, 'Settled Amount');
        const invBalanceIdx2 = findHeaderIndex_(invHeaders2, 'Balance');
        const invRmbIdx2     = findHeaderIndex_(invHeaders2, 'RMB');
        const invEr1Idx2     = findHeaderIndex_(invHeaders2, 'ER1');

        if (invSheet2 && invIdIdx2 !== -1 && invSettledIdx2 !== -1 && invBalanceIdx2 !== -1) {
          for (let i = 1; i < invValues2.length; i++) {
            if (String(invValues2[i][invIdIdx2] || '').trim() === String(invoiceId).trim()) {
              const invEr1 = parseFloat(invValues2[i][invEr1Idx2]) || 0;
              const currentSettled = parseFloat(invValues2[i][invSettledIdx2]) || 0;
              const rawBalance = invValues2[i][invBalanceIdx2];
              const currentBalance = (rawBalance !== '' && rawBalance !== undefined && rawBalance !== null)
                ? parseFloat(rawBalance) : parseFloat(invValues2[i][invRmbIdx2]);
              const settleAmt = Math.min(Math.abs(amountRmb), Math.max(0, currentBalance));

              if (invEr1 > 0) {
                er1 = invEr1;
                // Scaled to settleAmt, not the full transfer amount — matches the
                // SettlementLedger row below, which only records settleAmt too (the
                // portion actually applied here, when the invoice balance is smaller
                // than the transfer).
                forexGainLoss = round2(settleAmt * (er1 - settledRate));
              }

              invSheet2.getRange(i + 1, invSettledIdx2 + 1).setValue(round2(currentSettled + settleAmt));
              invSheet2.getRange(i + 1, invBalanceIdx2 + 1).setValue(round2(Math.max(0, currentBalance - settleAmt)));
              invalidateSheetCache_('PurchaseInvoices');

              // The wallet keeps whatever wasn't needed for this invoice (settleAmt <
              // amountRmb) as genuinely unspent Balance — matches settleViaWalletTransfer_'s
              // wallet row, which was created with Balance = the full amountRmb.
              if (settleAmt > 0.01) {
                const paymentSheetForBal = ss.getSheetByName('PaymentLogs');
                const payValsForBal = paymentSheetForBal.getDataRange().getValues();
                const payHeadersForBal = payValsForBal[0];
                const payIdColForBal = findHeaderIndex_(payHeadersForBal, 'Payment ID');
                const payVendorColForBal = findHeaderIndex_(payHeadersForBal, 'Vendor Code');
                const payBalColForBal = findHeaderIndex_(payHeadersForBal, 'Balance');
                for (let r = 1; r < payValsForBal.length; r++) {
                  // Matched on Payment ID AND vendor — a shared batch id can legitimately
                  // have rows for other vendors too (see the collision-guard comment
                  // above); matching id alone risks draining an unrelated vendor's wallet
                  // instead of targetVendor's, if any stale duplicate id still exists.
                  if (String(payValsForBal[r][payIdColForBal] || '').trim() === finalRefId &&
                      String(payVendorColForBal !== -1 ? payValsForBal[r][payVendorColForBal] : '').trim() === String(targetVendor).trim()) {
                    const walletBal = parseFloat(payValsForBal[r][payBalColForBal]) || 0;
                    paymentSheetForBal.getRange(r + 1, payBalColForBal + 1).setValue(round2(Math.max(0, walletBal - settleAmt)));
                    invalidateSheetCache_('PaymentLogs');
                    break;
                  }
                }
              }

              const settlementId = generateSequentialSettlementId();
              ledgerSheet.appendRow([date, settlementId, finalRefId, targetVendor, invoiceId,
                round2(-Math.abs(settleAmt)), er1, round2(settledRate), forexGainLoss,
                notes ? ('Settle Invoice: ' + notes) : 'Settle Invoice (Cross-Vendor Transfer)']);
              break;
            }
          }
        }
      } else {
        // Plain vendor-to-vendor top-up (Cross-Vendor Settlement page) — the new IDP-
        // wallet just gets FIFO-applied against targetVendor's open invoices like a
        // direct payment. No SettlementLedger row here directly; fifoLiquidate_ writes
        // its own rows for whatever it actually matches.
        fifoLiquidate_(targetVendor, date, finalRefId, Math.abs(amountRmb), settledRate);
      }

      return successResponse_({ message: 'Transfer logged', id: finalRefId, settledRate: round2(settledRate) });

    } else {
      const vendorNo  = record.vendorNo || '';
      const amountRmb = parseFloat(record.amountRmb) || 0;
      const er2       = parseFloat(record.ER2 || record.fxRate) || 0;
      const paymentId = record.paymentId || 'ADJ';

      if (transferLegExists_(paymentId, vendorNo, round2(amountRmb))) {
        return successResponse_({ message: txnType + ' already logged (duplicate submission ignored)', id: paymentId });
      }

      const settlementId = generateSequentialSettlementId();
      ledgerSheet.appendRow([date, settlementId, paymentId, vendorNo, record.invoiceId || '', amountRmb, 0, er2, 0, txnType + ': ' + notes]);
      logToVendorLedger_(vendorNo, date, txnType, paymentId, amountRmb);
      return successResponse_({ message: txnType + ' logged', id: settlementId });
    }
  } catch (e) {
    return errorResponse_(e.toString());
  } finally {
    lock.releaseLock();
  }
}

function updatePurchaseInvoice_(data) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('PurchaseInvoices');
  if (!sheet) return errorResponse_('Sheet not found');
  const r          = data.record;
  const values     = sheet.getDataRange().getValues();
  const headers    = values[0];
  const idIdx      = findHeaderIndex_(headers, 'Invoice ID');
  const settledIdx = findHeaderIndex_(headers, 'Settled Amount');
  const balanceIdx = findHeaderIndex_(headers, 'Balance');
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIdx]).trim().toUpperCase() === String(r.invoiceId).trim().toUpperCase()) {
      if (r.settledAmount !== undefined) sheet.getRange(i + 1, settledIdx + 1).setValue(r.settledAmount);
      if (r.balance       !== undefined) sheet.getRange(i + 1, balanceIdx  + 1).setValue(r.balance);
      invalidateSheetCache_('PurchaseInvoices');
      return successResponse_({ message: 'Invoice updated' });
    }
  }
  return errorResponse_('Invoice not found');
}

function updatePaymentLog_(data) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('PaymentLogs');
  if (!sheet) return errorResponse_('Sheet not found');
  const r          = data.record;
  const values     = sheet.getDataRange().getValues();
  const headers    = values[0];
  const idIdx      = findHeaderIndex_(headers, 'Payment ID');
  const balanceIdx = findHeaderIndex_(headers, 'Balance');
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIdx]).trim() === String(r.paymentId).trim()) {
      if (r.balance !== undefined) sheet.getRange(i + 1, balanceIdx + 1).setValue(r.balance);
      invalidateSheetCache_('PaymentLogs');
      return successResponse_({ message: 'Payment log updated' });
    }
  }
  return errorResponse_('Payment log not found');
}

function commitEodEngine_(data) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('PurchaseInvoices');
  if (!sheet) return errorResponse_('PurchaseInvoices sheet not found');

  const logs    = data.logs    || '';
  const updates = data.updates || [];

  const pattern = /\[EOD Engine\] Successfully processed (\d+) uncalculated transaction\(s\)\./;
  const match   = logs.match(pattern);
  if (!match) return errorResponse_('EOD Engine signature match failed. Logs do not indicate successful completion of processed transactions. Refusing update.');

  const processedCount = parseInt(match[1], 10);
  if (isNaN(processedCount) || processedCount <= 0) return errorResponse_('Validated processed transactions count is zero or invalid.');
  if (updates.length !== processedCount) return errorResponse_('Pre-update verification failed: Misaligned transaction counts between EOD log (' + processedCount + ') and payload updates (' + updates.length + ').');

  const values  = sheet.getDataRange().getValues();
  if (values.length <= 1) return errorResponse_('No rows present in PurchaseInvoices to update.');

  const headers  = values[0];
  const idIdx    = findHeaderIndex_(headers, 'Invoice ID');
  const er1Idx   = findHeaderIndex_(headers, 'ER1');
  const inrIdx   = findHeaderIndex_(headers, 'INR');
  const rmbIdx   = findHeaderIndex_(headers, 'RMB');
  const statusIdx = findHeaderIndex_(headers, 'Status');
  const vCodeIdx  = findHeaderIndex_(headers, 'Vendor Code');
  if (idIdx === -1 || er1Idx === -1 || inrIdx === -1 || rmbIdx === -1) return errorResponse_('Error: Missing required columns in PurchaseInvoices header mapping.');

  const updateMap = {};
  updates.forEach(u => { if (u.invoiceId) updateMap[String(u.invoiceId).trim()] = parseFloat(u.er1) || 0; });

  let updatedCount = 0;
  const updatedInvoicesForSettlement = [];

  for (let i = 1; i < values.length; i++) {
    const rawInvId = String(values[i][idIdx]).trim();
    if (updateMap.hasOwnProperty(rawInvId)) {
      const er1Val = updateMap[rawInvId];
      if (er1Val > 0) {
        const rmbVal = parseFloat(values[i][rmbIdx]) || 0;
        const inrVal = Math.round(rmbVal * er1Val * 100) / 100;
        values[i][er1Idx] = er1Val;
        values[i][inrIdx] = inrVal;
        if (statusIdx !== -1) values[i][statusIdx] = 'Processed';
        updatedCount++;
        let vCode = vCodeIdx !== -1 ? String(values[i][vCodeIdx]).trim() : '';
        if (!vCode) {
          const vIdIdx = findHeaderIndex_(headers, 'Vendor ID');
          if (vIdIdx !== -1) vCode = String(values[i][vIdIdx]).trim();
        }
        updatedInvoicesForSettlement.push({ vendorCode: vCode, date: values[i][0], invoiceId: rawInvId, rmb: rmbVal });
      }
    }
  }

  if (updatedCount > 0) {
    sheet.getRange(1, 1, values.length, headers.length).setValues(values);
    invalidateSheetCache_('PurchaseInvoices');
    updatedInvoicesForSettlement.forEach(inv => {
      if (inv.vendorCode && inv.invoiceId) autoSettleAdvanceFromInvoice_(inv.vendorCode, inv.date, inv.invoiceId, inv.rmb);
    });
    return successResponse_({ message: 'Transactional batch update successful. Synchronized ' + updatedCount + ' calculation changes in PurchaseInvoices.', updatedCount });
  }
  return successResponse_({ message: 'Finished post-processing validation safely. No direct matches identified to apply updates.', updatedCount: 0 });
}

function deleteRowByUniqueId_(tableName, idColumnName, targetId) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(tableName);
  if (!sheet) return errorResponse_('Sheet not found: ' + tableName);
  const data   = sheet.getDataRange().getValues();
  const idIdx  = findHeaderIndex_(data[0], idColumnName);
  if (idIdx === -1) return errorResponse_('ID Column not found: ' + idColumnName);
  let deletedCount = 0;
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][idIdx] === targetId) { sheet.deleteRow(i + 1); deletedCount++; }
  }
  return deletedCount > 0
    ? successResponse_({ message: 'Deleted ' + deletedCount + ' row(s) from ' + tableName })
    : errorResponse_('Record ID not found: ' + targetId);
}

// ─────────────────────────────────────────────────────────────
// FIFO ENGINE & LEDGER
// ─────────────────────────────────────────────────────────────

function fifoLiquidate_(vendorCode, date, paymentId, amountRmb, er2) {
  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const invSheet    = ss.getSheetByName('PurchaseInvoices');
  const ledgerSheet = ss.getSheetByName('SettlementLedger');
  if (!invSheet || !ledgerSheet) return;

  const invoices = getSheetData_('PurchaseInvoices')
    .map((inv, idx) => ({ ...inv, sheetRow: idx + 2 }))
    .filter(inv => {
      if ((inv['vendor_code'] || inv['Vendor Code'] || inv['VendorCode']) !== vendorCode) return false;
      const b = inv.Balance !== undefined && inv.Balance !== '' ? inv.Balance : inv.RMB;
      return parseFloat(b) > 0.01;
    })
    .sort((a, b) => new Date(a.Date).getTime() - new Date(b.Date).getTime());

  let remainingPayment = amountRmb;
  const round2 = v => Math.round(v * 100) / 100;
  // Invoice ids this call actually settles (appended a SettlementLedger row
  // for) — used below to refresh each affected batch's cached paid_amount_inr
  // / blended_settlement_rate. See syncBatchSettlementAggregate_.
  const settledInvoiceIds_ = [];

  // Was a full getDataRange().getValues() re-read of PurchaseInvoices on
  // EVERY loop iteration, purely to get header indices that never change
  // across iterations — hoisted out to a single read. Same values, same
  // columns, just one round trip instead of one per invoice a payment
  // settles against.
  const invHeaders_ = invSheet.getDataRange().getValues()[0];
  const settledIdx = findHeaderIndex_(invHeaders_, 'Settled Amount');
  const balanceIdx = findHeaderIndex_(invHeaders_, 'Balance');

  for (const inv of invoices) {
    if (remainingPayment <= 0) break;
    const invoiceId = inv['invoice_no'] || inv['Invoice ID'] || inv['invoiceId'];
    if (settlementExists_(paymentId, invoiceId)) continue;
    const b = inv.Balance !== undefined && inv.Balance !== '' ? inv.Balance : inv.RMB;
    const currentBalance = parseFloat(b);
    if (isNaN(currentBalance) || currentBalance <= 0) continue;
    const settledAmount = Math.min(remainingPayment, currentBalance);
    const er1 = parseFloat(inv.ER1) || er2;
    const newSettled = (parseFloat(inv['Settled Amount']) || 0) + settledAmount;
    const newBalance = currentBalance - settledAmount;
    if (settledIdx !== -1) invSheet.getRange(inv.sheetRow, settledIdx + 1).setValue(round2(newSettled));
    if (balanceIdx !== -1) invSheet.getRange(inv.sheetRow, balanceIdx + 1).setValue(round2(newBalance));
    ledgerSheet.appendRow([
      date, 'SET-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      paymentId, vendorCode, invoiceId,
      round2(-Math.abs(settledAmount)), er1, er2,
      round2(Math.abs(settledAmount) * (er1 - er2)), 'FIFO Settlement'
    ]);
    settledInvoiceIds_.push(invoiceId);
    remainingPayment -= settledAmount;
  }

  // Any leftover payment after every open invoice is covered is NOT a settlement — it's
  // just unspent wallet balance (visible via PaymentLogs.Balance, summed as "advance" on
  // the frontend). SettlementLedger only ever records actual invoice settlements now.

  // Decrement the originating wallet's own Balance by whatever actually got applied here
  // (amountRmb - remainingPayment). Without this, a wallet fully spent against its own
  // vendor's invoices via this exact path would still show its full original Balance
  // forever — wrong for the "unused wallet balance = advance" metric, and dangerous for
  // settleViaWalletTransfer_, which trusts Balance to decide what's still free to draw
  // from for a later cross-vendor transfer (double-spending already-consumed money).
  const appliedAmount = amountRmb - remainingPayment;
  if (appliedAmount > 0.01) {
    const paymentSheet = ss.getSheetByName('PaymentLogs');
    if (paymentSheet) {
      const payValues  = paymentSheet.getDataRange().getValues();
      const payHeaders = payValues[0];
      const payIdIdx   = findHeaderIndex_(payHeaders, 'Payment ID');
      const payVendorIdx = findHeaderIndex_(payHeaders, 'Vendor Code');
      const payBalIdx  = findHeaderIndex_(payHeaders, 'Balance');
      if (payIdIdx !== -1 && payBalIdx !== -1) {
        for (let r = 1; r < payValues.length; r++) {
          // Matched on Payment ID AND vendorCode — a multi-recipient Cross-Vendor
          // Settlement batch legitimately shares one Payment ID across several
          // different-vendor wallet rows (see paymentIdExistsAnywhere_'s comment).
          // Matching id alone hits whichever row for that id appears first in the
          // sheet — draining an unrelated vendor's own wallet to 0 instead of the
          // vendor this payment actually just settled invoices for.
          if (String(payValues[r][payIdIdx] || '').trim() === String(paymentId).trim() &&
              String(payVendorIdx !== -1 ? payValues[r][payVendorIdx] : '').trim() === String(vendorCode).trim()) {
            const currentWalletBal = parseFloat(payValues[r][payBalIdx]) || 0;
            paymentSheet.getRange(r + 1, payBalIdx + 1).setValue(round2(Math.max(0, currentWalletBal - appliedAmount)));
            invalidateSheetCache_('PaymentLogs');
            break;
          }
        }
      }
    }
  }

  // CNF Advances (see docs/superpowers/specs/2026-09-25-cnf-advances-invoice-matching-design.md):
  // mirror the applied amount into CNF_Advances for overseas/RMB vendors —
  // this is the "paid CNF to settle a vendor's balance" event. Skipped for
  // INR (domestic) vendors, who are paid directly with no CNF involved.
  if (appliedAmount > 0.01 && getVendorCurrency_(vendorCode) !== 'INR') {
    createCnfAdvance_(vendorCode, paymentId, round2(appliedAmount * er2), date);
  }

  // getSheetData_('PurchaseInvoices') is cached for 5 minutes (see
  // entry_points.js), but this function writes directly to Settled Amount /
  // Balance via setValue() above without ever invalidating that cache. Two
  // fifoLiquidate_ calls for the same vendor within that window — two real
  // payments submitted close together, or a scripted replay — would each
  // read the same stale pre-write snapshot and silently overwrite each
  // other's settlement instead of accumulating it. Invalidate on every exit
  // path so the very next call (however soon) always reads fresh.
  invalidateSheetCache_('PurchaseInvoices');

  if (settledInvoiceIds_.length > 0) {
    syncBatchSettlementAggregatesForInvoices_(settledInvoiceIds_);
  }
}

/**
 * Given invoice ids that were just settled (SettlementLedger rows written for
 * them in this same execution), finds every distinct batch they belong to
 * (Vendor_Shipments.invoice_no -> batch_id) and refreshes each one's cached
 * settlement aggregate. See syncBatchSettlementAggregate_ for what gets written
 * and why.
 */
function syncBatchSettlementAggregatesForInvoices_(invoiceIds) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shipmentsSheet = ss.getSheetByName('Vendor_Shipments');
  if (!shipmentsSheet) return;
  const shipValues = shipmentsSheet.getDataRange().getValues();
  const shipHeaders = shipValues[0];
  const invCol = shipHeaders.indexOf('invoice_no');
  const batchCol = shipHeaders.indexOf('batch_id');
  if (invCol === -1 || batchCol === -1) return;

  const wantedInvoiceIds = {};
  invoiceIds.forEach(function (id) { if (id) wantedInvoiceIds[String(id).trim()] = true; });

  const batchIds = {};
  for (let i = 1; i < shipValues.length; i++) {
    const inv = String(shipValues[i][invCol] || '').trim();
    if (wantedInvoiceIds[inv]) {
      const b = String(shipValues[i][batchCol] || '').trim();
      if (b) batchIds[b] = true;
    }
  }
  Object.keys(batchIds).forEach(syncBatchSettlementAggregate_);
}

/**
 * Recomputes a batch's total settled amount in INR and its RMB-weighted
 * blended settlement rate from the authoritative SettlementLedger rows for
 * every invoice under that batch (joined via Vendor_Shipments), and writes
 * both onto the batch's own Batches row (paid_amount_inr,
 * blended_settlement_rate, settlement_synced_at — columns auto-created via
 * ensureHeaderColumn_ on first use). getBatches() then just reads these
 * columns directly like any other Batches field — no join, no recomputation,
 * on every page load.
 *
 * This is a FULL recompute every time, never an incremental add, so it can
 * never drift from the true sum of SettlementLedger rows no matter how many
 * times or in what order it runs. It mirrors the same math the frontend
 * already computes live in services/settlementService.ts
 * (computeBatchSettlementStatus / computeWeightedSettlementRate) — this just
 * persists the result at payment time instead of re-joining 3 sheets on
 * every read.
 *
 * Deliberately NOT the same thing as the blended-FX-rate-per-batch approach
 * removed from getBatchDetails (see that function's comment, above): that old
 * approach used one generic MONTHLY rate off a separate FXRates sheet,
 * applied uniformly regardless of when each shipment/invoice actually
 * settled. This instead sums the REAL per-settlement rate (SettlementLedger's
 * own ER2) actually used at the moment each invoice was really paid — the
 * same authoritative numbers the frontend's live computation already trusts.
 *
 * Reads SettlementLedger/Vendor_Shipments via raw getDataRange() rather than
 * the cached getSheetData_ helper — this can run immediately after
 * fifoLiquidate_/autoSettleAdvanceFromInvoice_ append new SettlementLedger
 * rows in the SAME execution, and neither of those invalidates
 * SettlementLedger's own read cache after writing.
 */
function syncBatchSettlementAggregate_(batchId) {
  if (!batchId) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shipmentsSheet = ss.getSheetByName('Vendor_Shipments');
  const ledgerSheet = ss.getSheetByName('SettlementLedger');
  const batchesSheet = ss.getSheetByName('Batches');
  const invoicesSheet = ss.getSheetByName('PurchaseInvoices');
  if (!shipmentsSheet || !ledgerSheet || !batchesSheet) return;

  const shipValues = shipmentsSheet.getDataRange().getValues();
  const shipHeaders = shipValues[0];
  const shipBatchCol = shipHeaders.indexOf('batch_id');
  const shipInvCol = shipHeaders.indexOf('invoice_no');
  if (shipBatchCol === -1 || shipInvCol === -1) return;

  const invoiceIds = {};
  for (let i = 1; i < shipValues.length; i++) {
    if (String(shipValues[i][shipBatchCol] || '').trim() === String(batchId).trim()) {
      const inv = String(shipValues[i][shipInvCol] || '').trim();
      if (inv) invoiceIds[inv] = true;
    }
  }

  const batchValues = batchesSheet.getDataRange().getValues();
  const batchHeaders = batchValues[0];
  const batchIdCol = batchHeaders.indexOf('batch_id');
  if (batchIdCol === -1) return;
  let rowIndex = -1;
  for (let k = 1; k < batchValues.length; k++) {
    if (String(batchValues[k][batchIdCol] || '').trim() === String(batchId).trim()) { rowIndex = k + 1; break; }
  }
  if (rowIndex === -1) return;

  const paymentStatusCol = ensureHeaderColumn_(batchesSheet, 'payment_status');

  if (!Object.keys(invoiceIds).length) {
    batchesSheet.getRange(rowIndex, paymentStatusCol + 1).setValue('Not Invoiced');
    invalidateSheetCache_('Batches');
    return;
  }

  const ledgerValues = ledgerSheet.getDataRange().getValues();
  const ledgerHeaders = ledgerValues[0];
  const colInvoiceId = findHeaderIndex_(ledgerHeaders, 'Invoice ID');
  const colRmb = ledgerHeaders.indexOf('RMB');
  const colEr2 = ledgerHeaders.indexOf('ER2');
  if (colInvoiceId === -1 || colRmb === -1 || colEr2 === -1) return;

  let totalRmb = 0, totalInr = 0;
  const settledRmbByInvoice = {};
  for (let j = 1; j < ledgerValues.length; j++) {
    const invId = String(ledgerValues[j][colInvoiceId] || '').trim();
    if (!invoiceIds[invId]) continue;
    const rmb = Math.abs(Number(ledgerValues[j][colRmb]) || 0);
    const er2 = Number(ledgerValues[j][colEr2]) || 0;
    settledRmbByInvoice[invId] = (settledRmbByInvoice[invId] || 0) + rmb;
    if (!rmb || !er2) continue;
    totalRmb += rmb;
    totalInr += rmb * er2;
  }

  // Payment Status — same per-invoice clamped-outstanding algorithm as
  // computeBatchSettlementStatus (services/settlementService.ts), kept in
  // lockstep deliberately so this persisted status never disagrees with
  // what that live function would compute.
  let paymentStatus = 'Not Invoiced';
  if (invoicesSheet) {
    const invValues = invoicesSheet.getDataRange().getValues();
    const invHeaders = invValues[0];
    const invIdCol = findHeaderIndex_(invHeaders, 'Invoice ID');
    const invRmbCol = findHeaderIndex_(invHeaders, 'RMB');
    if (invIdCol !== -1 && invRmbCol !== -1) {
      let invoicedRmbTotal = 0, outstandingRmb = 0, anyMatched = false;
      for (let m = 1; m < invValues.length; m++) {
        const id = String(invValues[m][invIdCol] || '').trim();
        if (!invoiceIds[id]) continue;
        anyMatched = true;
        const invoicedRmb = Number(invValues[m][invRmbCol]) || 0;
        const settledRmb = settledRmbByInvoice[id] || 0;
        invoicedRmbTotal += invoicedRmb;
        outstandingRmb += Math.max(0, invoicedRmb - settledRmb);
      }
      if (anyMatched) {
        paymentStatus = outstandingRmb < 0.01 ? 'Paid'
          : outstandingRmb < invoicedRmbTotal - 0.01 ? 'Partial'
          : 'Unpaid';
      }
    }
  }

  const round2 = v => Math.round(v * 100) / 100;
  const blendedRate = totalRmb > 0 ? totalInr / totalRmb : 0;

  const paidInrCol = ensureHeaderColumn_(batchesSheet, 'paid_amount_inr');
  const blendedRateCol = ensureHeaderColumn_(batchesSheet, 'blended_settlement_rate');
  const syncedAtCol = ensureHeaderColumn_(batchesSheet, 'settlement_synced_at');

  batchesSheet.getRange(rowIndex, paidInrCol + 1).setValue(round2(totalInr));
  batchesSheet.getRange(rowIndex, blendedRateCol + 1).setValue(totalRmb > 0 ? Math.round(blendedRate * 10000) / 10000 : '');
  batchesSheet.getRange(rowIndex, syncedAtCol + 1).setValue(new Date().toISOString());
  batchesSheet.getRange(rowIndex, paymentStatusCol + 1).setValue(paymentStatus);
  invalidateSheetCache_('Batches');
}

// One-pass backfill for every batch's paid_amount_inr / blended_settlement_rate
// / payment_status. Reads Vendor_Shipments, PurchaseInvoices, SettlementLedger
// and Batches exactly ONCE and builds in-memory lookup maps, unlike calling
// syncBatchSettlementAggregate_ in a loop (which re-reads all of those sheets
// per batch — fine for one batch at real settlement time, far too slow across
// every batch at once). Same algorithm as syncBatchSettlementAggregate_ —
// kept in lockstep deliberately.
function backfillBatchSettlementAggregates_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shipmentsSheet = ss.getSheetByName('Vendor_Shipments');
  const ledgerSheet = ss.getSheetByName('SettlementLedger');
  const batchesSheet = ss.getSheetByName('Batches');
  const invoicesSheet = ss.getSheetByName('PurchaseInvoices');
  if (!shipmentsSheet || !ledgerSheet || !batchesSheet || !invoicesSheet) {
    throw new Error('One or more required sheets not found (Vendor_Shipments / SettlementLedger / Batches / PurchaseInvoices)');
  }

  const shipValues = shipmentsSheet.getDataRange().getValues();
  const shipHeaders = shipValues[0];
  const shipBatchCol = shipHeaders.indexOf('batch_id');
  const shipInvCol = shipHeaders.indexOf('invoice_no');
  if (shipBatchCol === -1 || shipInvCol === -1) throw new Error('Vendor_Shipments missing batch_id/invoice_no column');

  const invoiceIdsByBatch = {};
  for (let i = 1; i < shipValues.length; i++) {
    const bId = String(shipValues[i][shipBatchCol] || '').trim();
    const invId = String(shipValues[i][shipInvCol] || '').trim();
    if (!bId || !invId) continue;
    if (!invoiceIdsByBatch[bId]) invoiceIdsByBatch[bId] = {};
    invoiceIdsByBatch[bId][invId] = true;
  }

  const invValues = invoicesSheet.getDataRange().getValues();
  const invHeaders = invValues[0];
  const invIdCol = findHeaderIndex_(invHeaders, 'Invoice ID');
  const invRmbCol = findHeaderIndex_(invHeaders, 'RMB');
  const invoicedRmbByInvoice = {};
  if (invIdCol !== -1 && invRmbCol !== -1) {
    for (let m = 1; m < invValues.length; m++) {
      const id = String(invValues[m][invIdCol] || '').trim();
      if (id) invoicedRmbByInvoice[id] = Number(invValues[m][invRmbCol]) || 0;
    }
  }

  const ledgerValues = ledgerSheet.getDataRange().getValues();
  const ledgerHeaders = ledgerValues[0];
  const colInvoiceId = findHeaderIndex_(ledgerHeaders, 'Invoice ID');
  const colRmb = ledgerHeaders.indexOf('RMB');
  const colEr2 = ledgerHeaders.indexOf('ER2');
  const settledRmbByInvoice = {};
  const settledInrByInvoice = {};
  if (colInvoiceId !== -1 && colRmb !== -1 && colEr2 !== -1) {
    for (let j = 1; j < ledgerValues.length; j++) {
      const lInvId = String(ledgerValues[j][colInvoiceId] || '').trim();
      if (!lInvId) continue;
      const rmb = Math.abs(Number(ledgerValues[j][colRmb]) || 0);
      const er2 = Number(ledgerValues[j][colEr2]) || 0;
      settledRmbByInvoice[lInvId] = (settledRmbByInvoice[lInvId] || 0) + rmb;
      if (rmb && er2) settledInrByInvoice[lInvId] = (settledInrByInvoice[lInvId] || 0) + rmb * er2;
    }
  }

  const batchValues = batchesSheet.getDataRange().getValues();
  const batchHeaders = batchValues[0];
  const batchIdCol = batchHeaders.indexOf('batch_id');
  if (batchIdCol === -1) throw new Error('Batches sheet missing batch_id column');

  const paidInrCol = ensureHeaderColumn_(batchesSheet, 'paid_amount_inr');
  const blendedRateCol = ensureHeaderColumn_(batchesSheet, 'blended_settlement_rate');
  const syncedAtCol = ensureHeaderColumn_(batchesSheet, 'settlement_synced_at');
  const paymentStatusCol = ensureHeaderColumn_(batchesSheet, 'payment_status');

  const round2 = v => Math.round(v * 100) / 100;
  const now = new Date().toISOString();
  let updated = 0, skippedNoInvoices = 0;

  for (let k = 1; k < batchValues.length; k++) {
    const batchId = String(batchValues[k][batchIdCol] || '').trim();
    if (!batchId) continue;
    const invIds = invoiceIdsByBatch[batchId];
    const rowIndex = k + 1;

    if (!invIds || !Object.keys(invIds).length) {
      batchesSheet.getRange(rowIndex, paymentStatusCol + 1).setValue('Not Invoiced');
      skippedNoInvoices++;
      continue;
    }

    let totalRmb = 0, totalInr = 0, invoicedRmbTotal = 0, outstandingRmb = 0, anyMatched = false;
    Object.keys(invIds).forEach(function (invId) {
      const settledRmb = settledRmbByInvoice[invId] || 0;
      const settledInr = settledInrByInvoice[invId] || 0;
      totalRmb += settledRmb;
      totalInr += settledInr;
      if (invId in invoicedRmbByInvoice) {
        anyMatched = true;
        const invoicedRmb = invoicedRmbByInvoice[invId] || 0;
        invoicedRmbTotal += invoicedRmb;
        outstandingRmb += Math.max(0, invoicedRmb - settledRmb);
      }
    });

    const paymentStatus = !anyMatched ? 'Not Invoiced'
      : outstandingRmb < 0.01 ? 'Paid'
      : outstandingRmb < invoicedRmbTotal - 0.01 ? 'Partial'
      : 'Unpaid';

    const blendedRate = totalRmb > 0 ? totalInr / totalRmb : 0;

    batchesSheet.getRange(rowIndex, paidInrCol + 1).setValue(round2(totalInr));
    batchesSheet.getRange(rowIndex, blendedRateCol + 1).setValue(totalRmb > 0 ? Math.round(blendedRate * 10000) / 10000 : '');
    batchesSheet.getRange(rowIndex, syncedAtCol + 1).setValue(now);
    batchesSheet.getRange(rowIndex, paymentStatusCol + 1).setValue(paymentStatus);
    updated++;
  }

  invalidateSheetCache_('Batches');
  return { status: 'success', updated: updated, skippedNoInvoices: skippedNoInvoices, totalBatches: batchValues.length - 1 };
}

// Recomputes a batch's total weight (kg) — for CNF Agent Accounting's Air
// tab, which bills by weight rather than % of goods value — from
// Vendor_Shipments' actual_weight per shipment (falling back to
// listed_weight when a shipment's weight hasn't been confirmed at receiving
// yet), and writes it onto the batch's own Batches row (total_weight_kg).
// Called at the moment a shipment's weight is actually confirmed (see
// bsUpdateShipmentWeights_ in BarcodeAppStore.js) — same write-at-source,
// never-recomputed-on-read pattern as syncBatchSettlementAggregate_ above.
function syncBatchWeightAggregate_(batchId) {
  if (!batchId) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shipmentsSheet = ss.getSheetByName('Vendor_Shipments');
  const batchesSheet = ss.getSheetByName('Batches');
  if (!shipmentsSheet || !batchesSheet) return;

  const shipValues = shipmentsSheet.getDataRange().getValues();
  const shipHeaders = shipValues[0];
  const shipBatchCol = shipHeaders.indexOf('batch_id');
  const listedWeightCol = shipHeaders.indexOf('listed_weight');
  const actualWeightCol = shipHeaders.indexOf('actual_weight');
  if (shipBatchCol === -1) return;

  let totalWeight = 0;
  for (let i = 1; i < shipValues.length; i++) {
    if (String(shipValues[i][shipBatchCol] || '').trim() !== String(batchId).trim()) continue;
    const actual = actualWeightCol !== -1 ? Number(shipValues[i][actualWeightCol]) || 0 : 0;
    const listed = listedWeightCol !== -1 ? Number(shipValues[i][listedWeightCol]) || 0 : 0;
    totalWeight += actual || listed;
  }

  const batchValues = batchesSheet.getDataRange().getValues();
  const batchHeaders = batchValues[0];
  const batchIdCol = batchHeaders.indexOf('batch_id');
  if (batchIdCol === -1) return;
  let rowIndex = -1;
  for (let k = 1; k < batchValues.length; k++) {
    if (String(batchValues[k][batchIdCol] || '').trim() === String(batchId).trim()) { rowIndex = k + 1; break; }
  }
  if (rowIndex === -1) return;

  const weightCol = ensureHeaderColumn_(batchesSheet, 'total_weight_kg');
  batchesSheet.getRange(rowIndex, weightCol + 1).setValue(Math.round(totalWeight * 100) / 100);
  invalidateSheetCache_('Batches');
}

// One-pass backfill for every batch's total_weight_kg, same
// read-everything-once-then-loop shape as backfillBatchSettlementAggregates_
// above (a plain loop calling syncBatchWeightAggregate_ per batch would
// re-read the whole Vendor_Shipments sheet once per batch).
function backfillBatchWeightAggregates_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shipmentsSheet = ss.getSheetByName('Vendor_Shipments');
  const batchesSheet = ss.getSheetByName('Batches');
  if (!shipmentsSheet || !batchesSheet) {
    throw new Error('One or more required sheets not found (Vendor_Shipments / Batches)');
  }

  const shipValues = shipmentsSheet.getDataRange().getValues();
  const shipHeaders = shipValues[0];
  const shipBatchCol = shipHeaders.indexOf('batch_id');
  const listedWeightCol = shipHeaders.indexOf('listed_weight');
  const actualWeightCol = shipHeaders.indexOf('actual_weight');
  if (shipBatchCol === -1) throw new Error('Vendor_Shipments missing batch_id column');

  const weightByBatch = {};
  for (let i = 1; i < shipValues.length; i++) {
    const bId = String(shipValues[i][shipBatchCol] || '').trim();
    if (!bId) continue;
    const actual = actualWeightCol !== -1 ? Number(shipValues[i][actualWeightCol]) || 0 : 0;
    const listed = listedWeightCol !== -1 ? Number(shipValues[i][listedWeightCol]) || 0 : 0;
    weightByBatch[bId] = (weightByBatch[bId] || 0) + (actual || listed);
  }

  const batchValues = batchesSheet.getDataRange().getValues();
  const batchHeaders = batchValues[0];
  const batchIdCol = batchHeaders.indexOf('batch_id');
  if (batchIdCol === -1) throw new Error('Batches sheet missing batch_id column');

  const weightCol = ensureHeaderColumn_(batchesSheet, 'total_weight_kg');
  const round2 = v => Math.round(v * 100) / 100;
  let updated = 0;

  for (let k = 1; k < batchValues.length; k++) {
    const batchId = String(batchValues[k][batchIdCol] || '').trim();
    if (!batchId || !weightByBatch[batchId]) continue;
    batchesSheet.getRange(k + 1, weightCol + 1).setValue(round2(weightByBatch[batchId]));
    updated++;
  }

  invalidateSheetCache_('Batches');
  return { status: 'success', updated: updated, totalBatches: batchValues.length - 1 };
}

function logToVendorLedger_(vendorCode, date, particulars, refId, rmb) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('VendorLedger');
  if (!sheet) return;

  // Ensure header row exists (sheet may have been created without headers)
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) {
    sheet.appendRow(['Transaction ID', 'Vendor Code', 'Date', 'Particulars', 'Reference ID', 'RMB', 'Balance']);
  } else {
    const firstCell = String(sheet.getRange(1, 1).getValue() || '').trim();
    if (firstCell !== 'Transaction ID') {
      sheet.insertRowsBefore(1, 1);
      sheet.getRange(1, 1, 1, 7).setValues([['Transaction ID', 'Vendor Code', 'Date', 'Particulars', 'Reference ID', 'RMB', 'Balance']]);
    }
  }

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (
      String(data[i][1] || '').trim() === String(vendorCode).trim() &&
      String(data[i][4] || '').trim() === String(refId).trim() &&
      String(data[i][3] || '').trim() === String(particulars).trim() &&
      Math.abs((parseFloat(data[i][5]) || 0) - rmb) < 0.01
    ) return;
  }
  let lastBalance = 0;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][1]) === String(vendorCode)) { lastBalance = parseFloat(data[i][6]) || 0; break; }
  }
  sheet.appendRow([generateTxnId_(), vendorCode, date, particulars, refId, rmb, lastBalance + rmb]);
}


function autoSettleAdvanceFromInvoice_(vendorCode, date, invoiceId, amountRmb) {
  const ss           = SpreadsheetApp.getActiveSpreadsheet();
  const paymentSheet = ss.getSheetByName('PaymentLogs');
  const invSheet     = ss.getSheetByName('PurchaseInvoices');
  const ledgerSheet  = ss.getSheetByName('SettlementLedger');
  if (!paymentSheet || !invSheet || !ledgerSheet) return;

  const invData    = invSheet.getDataRange().getValues();
  if (invData.length <= 1) return;
  const invHeaders  = invData[0];
  const invIdIdx    = findHeaderIndex_(invHeaders, 'Invoice ID')      !== -1 ? findHeaderIndex_(invHeaders, 'Invoice ID')      : findHeaderIndex_(invHeaders, 'invoiceId');
  const invSettledIdx = findHeaderIndex_(invHeaders, 'Settled Amount') !== -1 ? findHeaderIndex_(invHeaders, 'Settled Amount') : findHeaderIndex_(invHeaders, 'settledAmount');
  const invBalanceIdx = findHeaderIndex_(invHeaders, 'Balance')        !== -1 ? findHeaderIndex_(invHeaders, 'Balance')        : findHeaderIndex_(invHeaders, 'balance');
  const invEr1Idx   = findHeaderIndex_(invHeaders, 'ER1');

  let invoiceRow = -1;
  for (let i = 1; i < invData.length; i++) {
    if (String(invData[i][invIdIdx] || '').trim() === String(invoiceId).trim()) { invoiceRow = i + 1; break; }
  }
  if (invoiceRow === -1) return;

  const currentInvBalVal = invBalanceIdx !== -1 ? invData[invoiceRow - 1][invBalanceIdx] : amountRmb;
  const initialInvoiceBalance = parseFloat(currentInvBalVal !== undefined && currentInvBalVal !== '' ? currentInvBalVal : amountRmb);
  let remainingInvoiceBalance = initialInvoiceBalance;
  if (isNaN(remainingInvoiceBalance) || remainingInvoiceBalance <= 0) return;

  const payData = getSheetData_('PaymentLogs')
    .map((pay, idx) => ({ ...pay, sheetRow: idx + 2 }))
    .filter(pay => {
      const v = String(pay['vendor_code'] || pay['Vendor Code'] || pay['VendorCode'] || pay['Vendor ID'] || '').trim();
      if (v !== String(vendorCode).trim()) return false;
      const b = parseFloat(pay.Balance !== undefined && pay.Balance !== '' ? pay.Balance : (pay.RMB !== undefined && pay.RMB !== '' ? pay.RMB : pay['RMB Amount']));
      return !isNaN(b) && b > 0.01;
    })
    .sort((a, b) => new Date(a.Date || a.date).getTime() - new Date(b.Date || b.date).getTime());

  if (payData.length === 0) return;

  const paySheetValues = paymentSheet.getDataRange().getValues();
  if (paySheetValues.length <= 1) return;
  const payHeaders  = paySheetValues[0];
  const payBalanceIdx = findHeaderIndex_(payHeaders, 'Balance') !== -1 ? findHeaderIndex_(payHeaders, 'Balance') : findHeaderIndex_(payHeaders, 'balance');
  const round2 = v => Math.round(v * 100) / 100;

  // The invoice row's ER1, Settled Amount, and Balance were each read and
  // (for settled/balance) written via individual getRange().getValue()/
  // setValue() calls INSIDE this loop — up to ~6 round trips per matched
  // payment, all against the exact same cells every time (nothing else
  // touches this row mid-loop, so accumulating locally and writing once
  // after the loop produces identical final values). ER1 never changes
  // here at all, so it's a straight hoist from the already-loaded invData.
  const invoiceEr1Val = invEr1Idx !== -1 ? invData[invoiceRow - 1][invEr1Idx] : '';
  let invSettledAccum = invSettledIdx !== -1 ? (parseFloat(invData[invoiceRow - 1][invSettledIdx]) || 0) : 0;
  let invSettledTouched = false;

  for (const pay of payData) {
    if (remainingInvoiceBalance <= 0.01) break;
    if (settlementExists_(pay['Payment ID'] || pay.paymentId, invoiceId)) continue;
    const b = parseFloat(pay.Balance !== undefined && pay.Balance !== '' ? pay.Balance : (pay.RMB !== undefined && pay.RMB !== '' ? pay.RMB : pay['RMB Amount']));
    if (isNaN(b) || b <= 0) continue;
    const settledAmount = Math.min(remainingInvoiceBalance, b);
    const newPayBalance = Math.max(0, b - settledAmount);
    if (payBalanceIdx !== -1) paymentSheet.getRange(pay.sheetRow, payBalanceIdx + 1).setValue(round2(newPayBalance));
    const er2           = resolveSettledRate_(pay);
    const er1           = parseFloat(invoiceEr1Val) || er2;
    if (invSettledIdx !== -1) {
      invSettledAccum += settledAmount;
      invSettledTouched = true;
    }
    ledgerSheet.appendRow([
      date, 'SET-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      pay['Payment ID'] || pay.paymentId, vendorCode, invoiceId,
      round2(-Math.abs(settledAmount)), er1, er2,
      round2(Math.abs(settledAmount) * (er1 - er2)), 'Auto-Settlement Advance Match'
    ]);
    remainingInvoiceBalance -= settledAmount;
  }

  if (invSettledTouched) {
    invSheet.getRange(invoiceRow, invSettledIdx + 1).setValue(round2(invSettledAccum));
  }
  if (invBalanceIdx !== -1 && remainingInvoiceBalance !== initialInvoiceBalance) {
    invSheet.getRange(invoiceRow, invBalanceIdx + 1).setValue(round2(Math.max(0, remainingInvoiceBalance)));
  }

  // commitEodEngine_ calls this once per updated invoice in a single batch —
  // multiple invoices for the same vendor can draw against the same
  // PaymentLogs wallet rows in that same run. Without invalidating here, the
  // next invoice's getSheetData_('PaymentLogs') read (line ~1091) would see
  // the pre-write balance and double-draw the same payment wallet (same bug
  // class as fifoLiquidate_ — see the comment there).
  invalidateSheetCache_('PaymentLogs');
  invalidateSheetCache_('PurchaseInvoices');

  if (invSettledTouched) {
    syncBatchSettlementAggregatesForInvoices_([invoiceId]);
  }
}

// ─────────────────────────────────────────────────────────────
// ONE-TIME MIGRATION — run this BEFORE clearing/wiping VendorLedger, not after. A
// PaymentLogs cross-vendor wallet row only ever recorded the RECEIVING vendor — the
// pairing of who actually PAID is only preserved in VendorLedger's own Transfer Out/In
// rows. If VendorLedger gets wiped before that pairing is captured elsewhere, it is gone
// permanently — no script can reconstruct it afterward.
//
// This scans VendorLedger for every Transfer Out/In pair (matching "Transfer Out"/"Paid
// to" against "Transfer In"/"Received from" by shared Reference ID), and for each one:
//   - If a PaymentLogs wallet row already exists for that reference, backfills its new
//     'Source Vendor' column (added here if the column doesn't exist yet).
//   - If no PaymentLogs row exists at all (the old pre-rewrite code paths — the old
//     invoice-tied "Settle Invoice" flow, and the old cross-vendor split inside
//     addPaymentLog — never created a wallet row for these), materializes one: Balance = 0
//     (historically fully-applied, nothing left to redraw), Source Vendor + receiving
//     Vendor Code + amount captured from the VendorLedger pair, then cascades the (possibly
//     newly-assigned IDP- id) back into VendorLedger's Reference ID for both legs.
// After this runs, VendorLedger can be safely wiped and rebuilt from PurchaseInvoices +
// PaymentLogs alone (see ONE_TIME_rebuildVendorLedger) — nothing is lost.
// ─────────────────────────────────────────────────────────────
function ONE_TIME_migrateVendorLedgerTransfersToPaymentLogs() {
  const ss           = SpreadsheetApp.getActiveSpreadsheet();
  const vendorLedger = ss.getSheetByName('VendorLedger');
  const paymentSheet = ss.getSheetByName('PaymentLogs');
  if (!vendorLedger || !paymentSheet) {
    Logger.log('Missing VendorLedger or PaymentLogs sheet — aborting.');
    return;
  }

  const vlValues       = vendorLedger.getDataRange().getValues();
  const vlHeaders      = vlValues[0];
  const refIdx         = findHeaderIndex_(vlHeaders, 'Reference ID');
  const vlVCodeIdx     = findHeaderIndex_(vlHeaders, 'Vendor Code');
  const particularsIdx = findHeaderIndex_(vlHeaders, 'Particulars');
  const amountIdx      = findHeaderIndex_(vlHeaders, 'RMB');
  const vlDateIdx      = findHeaderIndex_(vlHeaders, 'Date');
  if (refIdx === -1 || vlVCodeIdx === -1 || particularsIdx === -1) {
    Logger.log('VendorLedger missing a required column (Reference ID / Vendor Code / Particulars) — aborting.');
    return;
  }

  const groups = {};
  for (let i = 1; i < vlValues.length; i++) {
    const particulars = String(vlValues[i][particularsIdx] || '');
    const isOut = particulars.indexOf('Transfer Out') !== -1 || particulars.indexOf('Paid to') !== -1;
    const isIn  = particulars.indexOf('Transfer In')  !== -1 || particulars.indexOf('Received from') !== -1;
    if (!isOut && !isIn) continue;
    const ref = String(vlValues[i][refIdx] || '').trim();
    if (!ref) continue;
    if (!groups[ref]) groups[ref] = { ref: ref, date: vlDateIdx !== -1 ? vlValues[i][vlDateIdx] : null };
    if (isOut) {
      groups[ref].outVendor = String(vlValues[i][vlVCodeIdx] || '').trim();
      groups[ref].amount = Math.abs(parseFloat(vlValues[i][amountIdx]) || 0);
    }
    if (isIn) {
      groups[ref].inVendor = String(vlValues[i][vlVCodeIdx] || '').trim();
    }
  }

  const sourceVendorIdx = ensureHeaderColumn_(paymentSheet, 'Source Vendor');

  const payValues   = paymentSheet.getDataRange().getValues();
  const payHeaders  = payValues[0];
  const payIdIdx    = findHeaderIndex_(payHeaders, 'Payment ID');
  const payVCodeIdx = findHeaderIndex_(payHeaders, 'Vendor Code') !== -1 ? findHeaderIndex_(payHeaders, 'Vendor Code') : findHeaderIndex_(payHeaders, 'Vendor ID');
  const payRmbIdx   = findHeaderIndex_(payHeaders, 'RMB Amount') !== -1 ? findHeaderIndex_(payHeaders, 'RMB Amount') : findHeaderIndex_(payHeaders, 'RMB');
  const payDateIdx  = findHeaderIndex_(payHeaders, 'Date');
  const payModeIdx  = findHeaderIndex_(payHeaders, 'Payment Mode');
  const payBalIdx   = findHeaderIndex_(payHeaders, 'Balance');
  const payRefNoIdx = findHeaderIndex_(payHeaders, 'Reference No');

  const existingRowByPayId = {};
  let maxIdpSeq = 0;
  for (let i = 1; i < payValues.length; i++) {
    const id = String(payValues[i][payIdIdx] || '').trim();
    if (id) existingRowByPayId[id] = i + 1;
    if (id.indexOf('IDP-') === 0) {
      const n = parseInt(id.slice(4), 10);
      if (!isNaN(n) && n > maxIdpSeq) maxIdpSeq = n;
    }
  }

  let backfilled = 0, created = 0, renamedRefCells = 0, skippedIncomplete = 0;
  const renameMap = {};

  Object.keys(groups).forEach(ref => {
    const g = groups[ref];
    if (!g.outVendor || !g.inVendor || !(g.amount > 0)) { skippedIncomplete++; return; }

    const existingRow = existingRowByPayId[ref];
    if (existingRow) {
      const currentSource = String(payValues[existingRow - 1][sourceVendorIdx] || '').trim();
      if (!currentSource) {
        paymentSheet.getRange(existingRow, sourceVendorIdx + 1).setValue(g.outVendor);
        backfilled++;
      }
      return;
    }

    const newId = ref.indexOf('IDP-') === 0 ? ref : ('IDP-' + (++maxIdpSeq).toString().padStart(5, '0'));
    if (newId !== ref) renameMap[ref] = newId;

    const dateStr = (g.date instanceof Date) ? g.date.toISOString().split('T')[0] : String(g.date || '');
    const row = new Array(Math.max(payHeaders.length, sourceVendorIdx + 1)).fill('');
    if (payDateIdx  !== -1) row[payDateIdx]  = dateStr;
    if (payIdIdx    !== -1) row[payIdIdx]    = newId;
    if (payVCodeIdx !== -1) row[payVCodeIdx] = g.inVendor;
    if (payRmbIdx   !== -1) row[payRmbIdx]   = g.amount;
    if (payModeIdx  !== -1) row[payModeIdx]  = 'Cross-Vendor Transfer (historical)';
    if (payBalIdx   !== -1) row[payBalIdx]   = 0;
    if (payRefNoIdx !== -1) row[payRefNoIdx] = ref;
    row[sourceVendorIdx] = g.outVendor;
    paymentSheet.appendRow(row);
    existingRowByPayId[newId] = paymentSheet.getLastRow();
    created++;
  });

  if (Object.keys(renameMap).length > 0) {
    const freshVl = vendorLedger.getDataRange().getValues();
    for (let i = 1; i < freshVl.length; i++) {
      const ref = String(freshVl[i][refIdx] || '').trim();
      if (renameMap[ref]) {
        vendorLedger.getRange(i + 1, refIdx + 1).setValue(renameMap[ref]);
        renamedRefCells++;
      }
    }
  }

  invalidateSheetCache_('PaymentLogs');

  Logger.log(
    'ONE_TIME_migrateVendorLedgerTransfersToPaymentLogs complete. Backfilled Source Vendor on ' +
    backfilled + ' existing wallet(s). Created ' + created + ' historical (Balance=0) wallet ' +
    'row(s) for transfers that never had one. Renamed ' + renamedRefCells + ' VendorLedger ' +
    'reference cell(s) to match. Skipped ' + skippedIncomplete + ' incomplete/unpaired group(s) ' +
    '(missing an Out or In leg, or zero amount) — review these manually before wiping VendorLedger.'
  );
}

// ─────────────────────────────────────────────────────────────
// ONE-TIME MIGRATION — run manually once from the Apps Script editor, and ONLY after:
//   1. SettlementLedger has been fully cleared of rows (header row only left)
//   2. PurchaseInvoices' Settled Amount column has been zeroed for every row
//   3. PaymentLogs' Balance column has been reset to each row's full RMB/RMB Amount
// Renames every existing PaymentLogs Payment ID into the DP-/IDP- scheme (cascading the
// rename into VendorLedger's Reference ID column so traceability survives), then rebuilds
// SettlementLedger from scratch: FIFO-matches every vendor's invoices (oldest date first,
// only ones that already have an ER1) against their now-reset wallets (oldest date first),
// writing fresh settlement rows and updating Settled Amount/Balance/wallet Balance in place.
// Invoices still 'Pending EOD' (no ER1 yet) are left alone — they'll price and auto-settle
// themselves the next time they're touched, via runEodForInvoice_.
// ─────────────────────────────────────────────────────────────
function ONE_TIME_rebuildSettlementsAndIds() {
  const ss            = SpreadsheetApp.getActiveSpreadsheet();
  const paymentSheet  = ss.getSheetByName('PaymentLogs');
  const invSheet      = ss.getSheetByName('PurchaseInvoices');
  const ledgerSheet   = ss.getSheetByName('SettlementLedger');
  const vendorLedger  = ss.getSheetByName('VendorLedger');
  if (!paymentSheet || !invSheet || !ledgerSheet) {
    Logger.log('Missing required sheet(s) (PaymentLogs / PurchaseInvoices / SettlementLedger) — aborting.');
    return;
  }

  const round2 = v => Math.round(v * 100) / 100;

  // ---- Step 1: rename every PaymentLogs Payment ID into DP-/IDP-, oldest date first ----
  const payValues  = paymentSheet.getDataRange().getValues();
  const payHeaders = payValues[0];
  const payIdIdx   = findHeaderIndex_(payHeaders, 'Payment ID');
  const payDateIdx = findHeaderIndex_(payHeaders, 'Date');
  const payModeIdx = findHeaderIndex_(payHeaders, 'Payment Mode');
  if (payIdIdx === -1 || payDateIdx === -1) {
    Logger.log('PaymentLogs missing Payment ID or Date column — aborting.');
    return;
  }

  const rows = [];
  for (let i = 1; i < payValues.length; i++) {
    rows.push({
      sheetRow: i + 1,
      date: payValues[i][payDateIdx],
      oldId: String(payValues[i][payIdIdx] || '').trim(),
      mode: payModeIdx !== -1 ? String(payValues[i][payModeIdx] || '').trim() : ''
    });
  }
  rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Idempotent reruns: an id already in the correct DP-NNNNN / IDP-NNNNN shape is left
  // untouched — only ids still in an old format (PAY-, ADJ-, anything else) get assigned a
  // fresh number. Without this, a rerun after new rows were added elsewhere (e.g. by
  // ONE_TIME_migrateVendorLedgerTransfersToPaymentLogs) would renumber EVERY row by date
  // from scratch, potentially reassigning a different number than what's already been
  // cascaded into VendorLedger references.
  const isWellFormedDp  = id => /^DP-\d{5,}$/.test(id);
  const isWellFormedIdp = id => /^IDP-\d{5,}$/.test(id);

  let dpSeq = 0, idpSeq = 0;
  rows.forEach(r => {
    if (isWellFormedDp(r.oldId))  { const n = parseInt(r.oldId.slice(3), 10);  if (n > dpSeq)  dpSeq  = n; }
    if (isWellFormedIdp(r.oldId)) { const n = parseInt(r.oldId.slice(4), 10);  if (n > idpSeq) idpSeq = n; }
  });

  const idMap = {};
  rows.forEach(r => {
    if (isWellFormedDp(r.oldId) || isWellFormedIdp(r.oldId)) return; // already correct
    const isIndirect = r.mode === 'Cross-Vendor Transfer' || r.oldId.indexOf('ADJ-') === 0;
    let newId;
    if (isIndirect) { idpSeq++; newId = 'IDP-' + idpSeq.toString().padStart(5, '0'); }
    else            { dpSeq++;  newId = 'DP-'  + dpSeq.toString().padStart(5, '0'); }
    if (r.oldId) idMap[r.oldId] = newId;
    paymentSheet.getRange(r.sheetRow, payIdIdx + 1).setValue(newId);
  });

  // ---- Step 2: cascade the rename into VendorLedger's Reference ID column ----
  if (vendorLedger) {
    const vlValues  = vendorLedger.getDataRange().getValues();
    const vlHeaders = vlValues[0];
    const refIdx    = findHeaderIndex_(vlHeaders, 'Reference ID');
    if (refIdx !== -1) {
      for (let i = 1; i < vlValues.length; i++) {
        const ref = String(vlValues[i][refIdx] || '').trim();
        if (idMap[ref]) vendorLedger.getRange(i + 1, refIdx + 1).setValue(idMap[ref]);
      }
    }
  }

  invalidateSheetCache_('PaymentLogs');

  // ---- Step 3: rebuild SettlementLedger via FIFO, per vendor ----
  const invValues     = invSheet.getDataRange().getValues();
  const invHeaders    = invValues[0];
  const invIdIdx      = findHeaderIndex_(invHeaders, 'Invoice ID');
  const invVCodeIdx   = findHeaderIndex_(invHeaders, 'Vendor Code');
  const invRmbIdx     = findHeaderIndex_(invHeaders, 'RMB');
  const invEr1Idx     = findHeaderIndex_(invHeaders, 'ER1');
  const invSettledIdx = findHeaderIndex_(invHeaders, 'Settled Amount');
  const invBalanceIdx = findHeaderIndex_(invHeaders, 'Balance');

  const payValues2      = paymentSheet.getDataRange().getValues();
  const payHeaders2     = payValues2[0];
  const payIdIdx2       = findHeaderIndex_(payHeaders2, 'Payment ID');
  const payVCodeIdx2    = findHeaderIndex_(payHeaders2, 'Vendor Code') !== -1 ? findHeaderIndex_(payHeaders2, 'Vendor Code') : findHeaderIndex_(payHeaders2, 'Vendor ID');
  const payDateIdx2     = findHeaderIndex_(payHeaders2, 'Date');
  const payBalIdx2      = findHeaderIndex_(payHeaders2, 'Balance');
  const payEr2Idx2      = findHeaderIndex_(payHeaders2, 'ER2');
  const paySettledEr2Idx2 = findHeaderIndex_(payHeaders2, 'Settled ER2');

  const vendorInvoices = {};
  for (let i = 1; i < invValues.length; i++) {
    const vCode = String(invValues[i][invVCodeIdx] || '').trim();
    if (!vCode) continue;
    (vendorInvoices[vCode] = vendorInvoices[vCode] || []).push({
      sheetRow: i + 1,
      invoiceId: String(invValues[i][invIdIdx] || '').trim(),
      date: invValues[i][0],
      er1: parseFloat(invValues[i][invEr1Idx]) || 0,
      balance: parseFloat(invValues[i][invBalanceIdx]) || 0,
      settled: parseFloat(invValues[i][invSettledIdx]) || 0
    });
  }

  const vendorWallets = {};
  for (let i = 1; i < payValues2.length; i++) {
    const vCode = String(payValues2[i][payVCodeIdx2] || '').trim();
    if (!vCode) continue;
    (vendorWallets[vCode] = vendorWallets[vCode] || []).push({
      sheetRow: i + 1,
      paymentId: String(payValues2[i][payIdIdx2] || '').trim(),
      date: payValues2[i][payDateIdx2],
      balance: parseFloat(payValues2[i][payBalIdx2]) || 0,
      er2: parseFloat(payValues2[i][payEr2Idx2]) || 0,
      settledEr2: paySettledEr2Idx2 !== -1 ? (parseFloat(payValues2[i][paySettledEr2Idx2]) || 0) : 0
    });
  }

  let vendorsProcessed = 0, invoicesSettled = 0, totalRmbMatched = 0;
  const settlementRows = [];

  Object.keys(vendorInvoices).forEach(vCode => {
    const invoices = vendorInvoices[vCode]
      .filter(inv => inv.balance > 0.01 && inv.er1 > 0)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const wallets = (vendorWallets[vCode] || [])
      .filter(w => w.balance > 0.01)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (invoices.length === 0 || wallets.length === 0) return;

    vendorsProcessed++;
    let walletCursor = 0;

    invoices.forEach(inv => {
      let remaining = inv.balance;
      while (remaining > 0.01 && walletCursor < wallets.length) {
        const wallet = wallets[walletCursor];
        if (wallet.balance <= 0.01) { walletCursor++; continue; }
        const draw = Math.min(remaining, wallet.balance);
        const er2  = wallet.settledEr2 > 0 ? wallet.settledEr2 : wallet.er2;
        settlementRows.push([
          inv.date, 'SET-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
          wallet.paymentId, vCode, inv.invoiceId,
          round2(-Math.abs(draw)), inv.er1, er2,
          round2(Math.abs(draw) * (inv.er1 - er2)), 'FIFO Settlement (rebuild)'
        ]);
        inv.settled += draw;
        inv.balance -= draw;
        wallet.balance -= draw;
        remaining -= draw;
        totalRmbMatched += draw;
        if (wallet.balance <= 0.01) walletCursor++;
      }
      if (inv.settled > 0) {
        invSheet.getRange(inv.sheetRow, invSettledIdx + 1).setValue(round2(inv.settled));
        invSheet.getRange(inv.sheetRow, invBalanceIdx + 1).setValue(round2(inv.balance));
        invoicesSettled++;
      }
    });

    wallets.forEach(w => {
      paymentSheet.getRange(w.sheetRow, payBalIdx2 + 1).setValue(round2(Math.max(0, w.balance)));
    });
  });

  if (settlementRows.length > 0) {
    ledgerSheet.getRange(ledgerSheet.getLastRow() + 1, 1, settlementRows.length, settlementRows[0].length).setValues(settlementRows);
  }

  invalidateSheetCache_('PurchaseInvoices');
  invalidateSheetCache_('PaymentLogs');
  invalidateSheetCache_('SettlementLedger');

  Logger.log(
    'ONE_TIME_rebuildSettlementsAndIds complete. Renamed ' + rows.length + ' PaymentLogs IDs (' +
    dpSeq + ' DP-, ' + idpSeq + ' IDP-). Vendors processed: ' + vendorsProcessed +
    '. Invoices settled: ' + invoicesSettled + '. Total RMB matched: ' + round2(totalRmbMatched) +
    '. Settlement rows written: ' + settlementRows.length + '.'
  );
}

// ─────────────────────────────────────────────────────────────
// ONE-TIME REBUILD — run manually once, AFTER:
//   1. ONE_TIME_migrateVendorLedgerTransfersToPaymentLogs has already run (so every
//      cross-vendor wallet's Source Vendor is known)
//   2. VendorLedger has been cleared down to just its header row
// Regenerates VendorLedger from scratch, purely from PurchaseInvoices and PaymentLogs: one
// 'Purchase' entry per invoice (-RMB), one 'Payment' entry per direct (DP-) wallet (+RMB),
// and one Adjustment pair per cross-vendor (IDP-) wallet — 'Adjustment (Paid to X)' on the
// source vendor, 'Adjustment (Received from X)' on the receiving vendor. Every event across
// every vendor is processed in one global date order, with each vendor's own running
// Balance tracked independently (a vendor's Balance column only ever depends on that
// vendor's own prior rows, never another vendor's).
// ─────────────────────────────────────────────────────────────
function ONE_TIME_rebuildVendorLedger() {
  const ss           = SpreadsheetApp.getActiveSpreadsheet();
  const vendorLedger = ss.getSheetByName('VendorLedger');
  const invSheet     = ss.getSheetByName('PurchaseInvoices');
  const paymentSheet = ss.getSheetByName('PaymentLogs');
  if (!vendorLedger || !invSheet || !paymentSheet) {
    Logger.log('Missing required sheet(s) — aborting.');
    return;
  }

  // Refuse to run against a VendorLedger that still has data rows, to avoid silently
  // duplicating entries on top of whatever's already there.
  if (vendorLedger.getLastRow() > 1) {
    Logger.log('VendorLedger still has ' + (vendorLedger.getLastRow() - 1) + ' data row(s) — clear it down to the header row first, then rerun. Aborting to avoid duplicate entries.');
    return;
  }

  const invValues    = invSheet.getDataRange().getValues();
  const invHeaders   = invValues[0];
  const invIdIdx     = findHeaderIndex_(invHeaders, 'Invoice ID');
  const invVCodeIdx  = findHeaderIndex_(invHeaders, 'Vendor Code');
  const invRmbIdx    = findHeaderIndex_(invHeaders, 'RMB');

  const payValues       = paymentSheet.getDataRange().getValues();
  const payHeaders      = payValues[0];
  const payIdIdx        = findHeaderIndex_(payHeaders, 'Payment ID');
  const payVCodeIdx     = findHeaderIndex_(payHeaders, 'Vendor Code') !== -1 ? findHeaderIndex_(payHeaders, 'Vendor Code') : findHeaderIndex_(payHeaders, 'Vendor ID');
  const payRmbIdx       = findHeaderIndex_(payHeaders, 'RMB Amount')  !== -1 ? findHeaderIndex_(payHeaders, 'RMB Amount')  : findHeaderIndex_(payHeaders, 'RMB');
  const payDateIdx      = findHeaderIndex_(payHeaders, 'Date');
  const payModeIdx      = findHeaderIndex_(payHeaders, 'Payment Mode');
  const sourceVendorIdx = findHeaderIndex_(payHeaders, 'Source Vendor');

  const events = [];
  let skippedNoSourceVendor = 0;

  for (let i = 1; i < invValues.length; i++) {
    const vCode = String(invValues[i][invVCodeIdx] || '').trim();
    const rmb   = parseFloat(invValues[i][invRmbIdx]) || 0;
    const invId = String(invValues[i][invIdIdx] || '').trim();
    if (!vCode || !invId || rmb === 0) continue;
    events.push({ date: invValues[i][0], vendorCode: vCode, particulars: 'Purchase', refId: invId, amount: -Math.abs(rmb) });
  }

  for (let i = 1; i < payValues.length; i++) {
    const payId = String(payValues[i][payIdIdx] || '').trim();
    const vCode = String(payValues[i][payVCodeIdx] || '').trim();
    const rmb   = parseFloat(payValues[i][payRmbIdx]) || 0;
    const date  = payValues[i][payDateIdx];
    const mode  = payModeIdx !== -1 ? String(payValues[i][payModeIdx] || '').trim() : '';
    const sourceVendor = sourceVendorIdx !== -1 ? String(payValues[i][sourceVendorIdx] || '').trim() : '';
    if (!payId || !vCode || rmb === 0) continue;

    const isCrossVendor = mode.indexOf('Cross-Vendor Transfer') === 0;
    if (isCrossVendor) {
      if (!sourceVendor) { skippedNoSourceVendor++; continue; }
      events.push({ date: date, vendorCode: sourceVendor, particulars: 'Adjustment (Paid to ' + vCode + ')', refId: payId, amount: -Math.abs(rmb) });
      events.push({ date: date, vendorCode: vCode, particulars: 'Adjustment (Received from ' + sourceVendor + ')', refId: payId, amount: Math.abs(rmb) });
    } else {
      events.push({ date: date, vendorCode: vCode, particulars: 'Payment', refId: payId, amount: Math.abs(rmb) });
    }
  }

  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const round2 = v => Math.round(v * 100) / 100;
  const runningBalance = {};
  const rowsToWrite = events.map(e => {
    const prevBal = runningBalance[e.vendorCode] || 0;
    const newBal  = round2(prevBal + e.amount);
    runningBalance[e.vendorCode] = newBal;
    const dateStr = (e.date instanceof Date) ? e.date.toISOString().split('T')[0] : String(e.date || '');
    return [generateTxnId_(), e.vendorCode, dateStr, e.particulars, e.refId, round2(e.amount), newBal];
  });

  if (rowsToWrite.length > 0) {
    vendorLedger.getRange(2, 1, rowsToWrite.length, 7).setValues(rowsToWrite);
  }
  invalidateSheetCache_('VendorLedger');

  Logger.log(
    'ONE_TIME_rebuildVendorLedger complete. Wrote ' + rowsToWrite.length + ' VendorLedger row(s) from ' +
    (invValues.length - 1) + ' invoice(s) and ' + (payValues.length - 1) + ' PaymentLogs row(s). ' +
    'Vendors with a final balance: ' + Object.keys(runningBalance).length + '. Skipped ' +
    skippedNoSourceVendor + ' cross-vendor wallet(s) with no Source Vendor set — run ' +
    'ONE_TIME_migrateVendorLedgerTransfersToPaymentLogs first if this is nonzero, then clear ' +
    'VendorLedger and rerun this.'
  );
}

// ─────────────────────────────────────────────────────────────
// READ-ONLY DIAGNOSTIC — makes no writes, safe to run anytime. For every vendor, checks an
// accounting identity that must always hold, regardless of transaction order or how FIFO
// happened to match things:
//
//     VendorLedger's final running Balance  ==  (sum of that vendor's PaymentLogs.Balance)
//                                              - (sum of that vendor's PurchaseInvoices.Balance)
//
// Why: VendorLedger's balance is a running sum of every Purchase (-), Payment (+), and
// Adjustment (±) ever logged for that vendor, which always nets out to exactly (total ever
// received) - (total ever purchased). PurchaseInvoices.Balance is what's still unpaid of
// what was purchased; PaymentLogs.Balance is what's still unspent of what was received.
// The difference between those two remainders is algebraically forced to equal the
// ledger's own cumulative total — this is a debits-equal-credits identity, not a
// heuristic. A mismatch means a write is missing or duplicated somewhere, a real bug.
// ─────────────────────────────────────────────────────────────
function diagnosticReconcileVendorLedger() {
  const ss           = SpreadsheetApp.getActiveSpreadsheet();
  const vendorLedger = ss.getSheetByName('VendorLedger');
  const invSheet     = ss.getSheetByName('PurchaseInvoices');
  const paymentSheet = ss.getSheetByName('PaymentLogs');
  if (!vendorLedger || !invSheet || !paymentSheet) {
    Logger.log('Missing required sheet(s) — aborting.');
    return;
  }

  const vlValues   = vendorLedger.getDataRange().getValues();
  const vlHeaders  = vlValues[0];
  const vlVCodeIdx = findHeaderIndex_(vlHeaders, 'Vendor Code');
  const vlBalIdx   = findHeaderIndex_(vlHeaders, 'Balance');

  // Assumes each vendor's own rows are written in chronological order (true both for live
  // logToVendorLedger_ appends and ONE_TIME_rebuildVendorLedger's output) — so the
  // last-seen row for a vendor IS their final balance.
  const finalBalance = {};
  for (let i = 1; i < vlValues.length; i++) {
    const vCode = String(vlValues[i][vlVCodeIdx] || '').trim();
    if (!vCode) continue;
    finalBalance[vCode] = parseFloat(vlValues[i][vlBalIdx]) || 0;
  }

  const invValues      = invSheet.getDataRange().getValues();
  const invHeaders     = invValues[0];
  const invVCodeIdx    = findHeaderIndex_(invHeaders, 'Vendor Code');
  const invBalanceIdx  = findHeaderIndex_(invHeaders, 'Balance');
  const invRmbIdx      = findHeaderIndex_(invHeaders, 'RMB');
  const invBalanceByVendor = {};
  for (let i = 1; i < invValues.length; i++) {
    const vCode = String(invValues[i][invVCodeIdx] || '').trim();
    if (!vCode) continue;
    const rawBal = invValues[i][invBalanceIdx];
    const bal = (rawBal !== '' && rawBal !== undefined && rawBal !== null) ? parseFloat(rawBal) : parseFloat(invValues[i][invRmbIdx]);
    invBalanceByVendor[vCode] = (invBalanceByVendor[vCode] || 0) + (isNaN(bal) ? 0 : bal);
  }

  const payValues   = paymentSheet.getDataRange().getValues();
  const payHeaders  = payValues[0];
  const payVCodeIdx = findHeaderIndex_(payHeaders, 'Vendor Code') !== -1 ? findHeaderIndex_(payHeaders, 'Vendor Code') : findHeaderIndex_(payHeaders, 'Vendor ID');
  const payBalIdx   = findHeaderIndex_(payHeaders, 'Balance');
  const payBalanceByVendor = {};
  for (let i = 1; i < payValues.length; i++) {
    const vCode = String(payValues[i][payVCodeIdx] || '').trim();
    if (!vCode) continue;
    const bal = parseFloat(payValues[i][payBalIdx]) || 0;
    payBalanceByVendor[vCode] = (payBalanceByVendor[vCode] || 0) + bal;
  }

  const allVendors = new Set([].concat(Object.keys(finalBalance), Object.keys(invBalanceByVendor), Object.keys(payBalanceByVendor)));
  const round2 = v => Math.round(v * 100) / 100;

  let mismatchCount = 0;
  const lines = [];
  allVendors.forEach(vCode => {
    const ledgerBal = round2(finalBalance[vCode] || 0);
    const expected  = round2((payBalanceByVendor[vCode] || 0) - (invBalanceByVendor[vCode] || 0));
    const diff      = round2(ledgerBal - expected);
    if (Math.abs(diff) > 0.5) {
      mismatchCount++;
      lines.push(vCode + ': VendorLedger=' + ledgerBal + ', expected=' + expected +
        ' (wallet balance ' + round2(payBalanceByVendor[vCode] || 0) + ' - unpaid invoice balance ' +
        round2(invBalanceByVendor[vCode] || 0) + '), diff=' + diff);
    }
  });

  if (mismatchCount === 0) {
    Logger.log('diagnosticReconcileVendorLedger: all ' + allVendors.size + ' vendor(s) reconcile cleanly.');
  } else {
    Logger.log('diagnosticReconcileVendorLedger: ' + mismatchCount + ' of ' + allVendors.size + ' vendor(s) MISMATCH:\n' + lines.join('\n'));
  }
}

// ─────────────────────────────────────────────────────────────
// SUPERSEDED by ONE_TIME_migrateVendorLedgerTransfersToPaymentLogs — that migration also
// materializes a PaymentLogs wallet row for orphaned transfers (with Source Vendor set),
// which this older script never did. Left here only for reference; don't run this anymore.
// ─────────────────────────────────────────────────────────────
function ONE_TIME_renameOrphanVendorLedgerAdjIds() {
  const ss           = SpreadsheetApp.getActiveSpreadsheet();
  const vendorLedger = ss.getSheetByName('VendorLedger');
  const paymentSheet = ss.getSheetByName('PaymentLogs');
  if (!vendorLedger || !paymentSheet) {
    Logger.log('Missing VendorLedger or PaymentLogs sheet — aborting.');
    return;
  }

  const vlValues  = vendorLedger.getDataRange().getValues();
  const vlHeaders = vlValues[0];
  const refIdx    = findHeaderIndex_(vlHeaders, 'Reference ID');
  const dateIdx   = findHeaderIndex_(vlHeaders, 'Date');
  if (refIdx === -1) {
    Logger.log('VendorLedger missing Reference ID column — aborting.');
    return;
  }

  const payValues = paymentSheet.getDataRange().getValues();
  const payHeaders = payValues[0];
  const payIdIdx  = findHeaderIndex_(payHeaders, 'Payment ID');
  const existingPayIds = new Set();
  let maxIdpSeq = 0;
  for (let i = 1; i < payValues.length; i++) {
    const id = String(payValues[i][payIdIdx] || '').trim();
    if (id) existingPayIds.add(id);
    if (id.indexOf('IDP-') === 0) {
      const n = parseInt(id.slice(4), 10);
      if (!isNaN(n) && n > maxIdpSeq) maxIdpSeq = n;
    }
  }

  const orphanRows = [];
  for (let i = 1; i < vlValues.length; i++) {
    const ref = String(vlValues[i][refIdx] || '').trim();
    if (ref.indexOf('ADJ-') === 0 && !existingPayIds.has(ref)) {
      orphanRows.push({ ref: ref, date: dateIdx !== -1 ? vlValues[i][dateIdx] : null });
    }
  }

  const uniqueOrphans = [];
  const seen = new Set();
  orphanRows
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .forEach(r => {
      if (!seen.has(r.ref)) { seen.add(r.ref); uniqueOrphans.push(r.ref); }
    });

  const startSeq = maxIdpSeq;
  const idMap = {};
  uniqueOrphans.forEach(oldRef => {
    maxIdpSeq++;
    idMap[oldRef] = 'IDP-' + maxIdpSeq.toString().padStart(5, '0');
  });

  let replaced = 0;
  for (let i = 1; i < vlValues.length; i++) {
    const ref = String(vlValues[i][refIdx] || '').trim();
    if (idMap[ref]) {
      vendorLedger.getRange(i + 1, refIdx + 1).setValue(idMap[ref]);
      replaced++;
    }
  }

  Logger.log(
    'ONE_TIME_renameOrphanVendorLedgerAdjIds complete. Found ' + uniqueOrphans.length +
    ' orphaned ADJ- reference(s) with no PaymentLogs wallet, renamed to IDP-' +
    (startSeq + 1).toString().padStart(5, '0') + ' through IDP-' + maxIdpSeq.toString().padStart(5, '0') +
    '. Cells updated: ' + replaced + '.'
  );
}

// ─────────────────────────────────────────────────────────────
// ONE-TIME CLEANUP — run manually once from the Apps Script editor
// to fix VendorAccounts rows that were inserted with wrong column
// mapping (vCode in account_id instead of vendor_id) and remove
// duplicate rows.
// ─────────────────────────────────────────────────────────────
function fixVendorAccountsSheet() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('VendorAccounts');
  if (!sheet) { Logger.log('VendorAccounts sheet not found'); return; }

  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const aidIdx  = findHeaderIndex_(headers, 'account_id');
  const vidIdx  = findHeaderIndex_(headers, 'vendor_id')   !== -1 ? findHeaderIndex_(headers, 'vendor_id')   : findHeaderIndex_(headers, 'Vendor ID');
  const vnmIdx  = findHeaderIndex_(headers, 'vendor_name') !== -1 ? findHeaderIndex_(headers, 'vendor_name') : findHeaderIndex_(headers, 'Vendor Name');
  const curIdx  = findHeaderIndex_(headers, 'currency')    !== -1 ? findHeaderIndex_(headers, 'currency')    : findHeaderIndex_(headers, 'Currency');
  const actIdx  = findHeaderIndex_(headers, 'is_active')   !== -1 ? findHeaderIndex_(headers, 'is_active')   : findHeaderIndex_(headers, 'Is Active');

  const seen    = new Set();
  const toDelete = [];

  for (let i = 1; i < data.length; i++) {
    const row     = data[i];
    const vid     = String(vidIdx !== -1 ? row[vidIdx] : '').trim();
    const aid     = String(aidIdx !== -1 ? row[aidIdx] : '').trim();
    const code    = vid || aid; // prefer vendor_id, fall back to account_id

    if (!code) { toDelete.push(i + 1); continue; } // blank row
    if (seen.has(code)) { toDelete.push(i + 1); continue; } // duplicate
    seen.add(code);

    // Fix: if vendor_id is empty but account_id has the code, copy it over
    if (!vid && aid && vidIdx !== -1) {
      sheet.getRange(i + 1, vidIdx + 1).setValue(aid);
    }
    // Fix: if vendor_name is empty, use the code as a placeholder
    const vnm = String(vnmIdx !== -1 ? row[vnmIdx] : '').trim();
    if (!vnm && vnmIdx !== -1) {
      sheet.getRange(i + 1, vnmIdx + 1).setValue(code);
    }
    // Fix: if currency column has 'RMB' but it's actually in the wrong column (vendor_name), correct it
    if (vnmIdx !== -1 && String(row[vnmIdx]).trim() === 'RMB' && curIdx !== -1) {
      sheet.getRange(i + 1, vnmIdx + 1).setValue(code); // restore name to code
      if (!row[curIdx]) sheet.getRange(i + 1, curIdx + 1).setValue('RMB');
    }
    // Ensure is_active is set
    const act = actIdx !== -1 ? row[actIdx] : '';
    if (!act && actIdx !== -1) sheet.getRange(i + 1, actIdx + 1).setValue(true);
  }

  // Delete duplicate/blank rows from bottom up
  for (let j = toDelete.length - 1; j >= 0; j--) {
    sheet.deleteRow(toDelete[j]);
  }

  Logger.log('fixVendorAccountsSheet complete. Deleted ' + toDelete.length + ' rows. Remaining vendors: ' + seen.size);
}

// ─────────────────────────────────────────────────────────────
// CNF LEDGER
// ─────────────────────────────────────────────────────────────

// Header row is documented once here — both functions below reference it in
// their error messages. Trailing 4 columns (Rate Basis onward) are Air-only
// (see docs/superpowers/specs/2026-09-24-cnf-air-shipment-recon-design.md);
// absent/blank on any row logged before they existed reads back as 'pct'/
// undefined below, matching Sea's pre-existing behavior — no migration needed.
var CNF_LEDGER_HEADER_ROW_ = 'ID | Batch ID | Created At | Qty | Cartons | Invoice RMB Total | Mode | EDD | Carrier | Waybill | Rate | Category | Charges Pct | Goods Value | Charges | Shipping Amount | Taxable Amount | IGST Pct | IGST | Total | Total Payable | Invoice Batch ID | Bill Requested At | Bill Requested By | Rate Basis | Shipment Partner | Weight Kg | Rate Per Kg';

function getCnfLedgerEntries_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CNF_Ledger');
  if (!sheet) throw new Error("Sheet 'CNF_Ledger' not found. Create it with header row: " + CNF_LEDGER_HEADER_ROW_);
  var data = sheet.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    rows.push({
      id: String(data[i][0]), batchId: String(data[i][1]), createdAt: String(data[i][2]),
      qty: Number(data[i][3]) || 0, cartons: Number(data[i][4]) || 0,
      invoiceRmbTotal: Number(data[i][5]) || 0, mode: String(data[i][6]),
      edd: String(data[i][7]), carrier: String(data[i][8]), waybill: String(data[i][9]),
      rate: Number(data[i][10]) || 0, category: String(data[i][11]),
      chargesPct: Number(data[i][12]) || 0, goodsValue: Number(data[i][13]) || 0,
      charges: Number(data[i][14]) || 0, shippingAmount: Number(data[i][15]) || 0,
      taxableAmount: Number(data[i][16]) || 0, igstPct: Number(data[i][17]) || 0,
      igst: Number(data[i][18]) || 0, total: Number(data[i][19]) || 0,
      totalPayable: Number(data[i][20]) || 0,
      invoiceBatchId: data[i][21] ? String(data[i][21]) : undefined,
      billRequestedAt: data[i][22] ? String(data[i][22]) : undefined,
      billRequestedBy: data[i][23] ? String(data[i][23]) : undefined,
      rateBasis: data[i][24] ? String(data[i][24]) : 'pct',
      shipmentPartner: data[i][25] ? String(data[i][25]) : undefined,
      weightKg: data[i][26] !== '' && data[i][26] != null ? Number(data[i][26]) || 0 : undefined,
      ratePerKg: data[i][27] !== '' && data[i][27] != null ? Number(data[i][27]) || 0 : undefined
    });
  }
  return { status: 'success', entries: rows };
}

function addCnfLedgerEntry_(payload) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CNF_Ledger');
  if (!sheet) throw new Error("Sheet 'CNF_Ledger' not found. Create it with header row: " + CNF_LEDGER_HEADER_ROW_);
  var entry = payload.entry;
  if (!entry || !entry.batchId) throw new Error("payload.entry.batchId is required");

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Another CNF ledger entry is currently being logged. Please try again in a moment.');
  }

  try {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][1]).trim() === String(entry.batchId).trim()) {
        return { status: 'success', message: 'Entry already logged for this batch (duplicate submission ignored)', id: String(data[i][0]) };
      }
    }

    var id = 'CNF-' + new Date().getTime();
    sheet.appendRow([
      id, entry.batchId, entry.createdAt, entry.qty, entry.cartons, entry.invoiceRmbTotal,
      entry.mode, entry.edd, entry.carrier, entry.waybill, entry.rate, entry.category,
      entry.chargesPct, entry.goodsValue, entry.charges, entry.shippingAmount,
      entry.taxableAmount, entry.igstPct, entry.igst, entry.total, entry.totalPayable, '', '', '',
      entry.rateBasis || 'pct', entry.shipmentPartner || '', entry.weightKg != null ? entry.weightKg : '',
      entry.ratePerKg != null ? entry.ratePerKg : ''
    ]);
    // Seed shipment-level bill-status tracking for this batch (see design
    // doc) — one CNF_Shipment_Bill_Status row per vendor_shipment.
    ensureCnfShipmentBillStatusRowsForBatch_(entry.batchId);
    return { status: 'success', id: id };
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────
// CNF SHIPMENT BILL STATUS — shipment-level bill reconciliation (one row per
// batch+shipment for every batch that has a CnfLedgerEntry). This is the
// authoritative read path for bill-reconciliation status going forward.
// CNF_Ledger's own billRequestedAt/billRequestedBy/Invoice Batch ID columns
// are left in place as a frozen audit trail — requestCnfBill_ and
// createCnfInvoiceBatch_ below no longer write to them.
// See docs/superpowers/specs/2026-09-24-cnf-air-shipment-recon-design.md.
// ─────────────────────────────────────────────────────────────

function getCnfShipmentBillStatusSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('CNF_Shipment_Bill_Status');
  if (!sheet) {
    sheet = ss.insertSheet('CNF_Shipment_Bill_Status');
    sheet.appendRow(['Batch ID', 'Shipment ID', 'Bill Requested At', 'Bill Requested By', 'Invoice Batch ID']);
  }
  return sheet;
}

function getCnfShipmentBillStatusRows_() {
  var sheet = getCnfShipmentBillStatusSheet_();
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var batchIdCol = findHeaderIndex_(headers, 'Batch ID');
  var shipmentIdCol = findHeaderIndex_(headers, 'Shipment ID');
  var requestedAtCol = findHeaderIndex_(headers, 'Bill Requested At');
  var requestedByCol = findHeaderIndex_(headers, 'Bill Requested By');
  var invoiceBatchIdCol = findHeaderIndex_(headers, 'Invoice Batch ID');
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][batchIdCol] || !data[i][shipmentIdCol]) continue;
    rows.push({
      batchId: String(data[i][batchIdCol]),
      shipmentId: String(data[i][shipmentIdCol]),
      billRequestedAt: data[i][requestedAtCol] ? String(data[i][requestedAtCol]) : undefined,
      billRequestedBy: data[i][requestedByCol] ? String(data[i][requestedByCol]) : undefined,
      invoiceBatchId: data[i][invoiceBatchIdCol] ? String(data[i][invoiceBatchIdCol]) : undefined
    });
  }
  return rows;
}

// Reads Vendor_Shipments directly (not buildVendorShipmentsForBatch_, which
// is logistics-only and doesn't carry total_amount) for the raw shipment_id
// list and per-shipment RMB invoice value of a batch — used both to seed
// CNF_Shipment_Bill_Status rows and to prorate a bill across shipments.
function getVendorShipmentsRawForBatch_(batchId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Vendor_Shipments');
  if (!sheet) throw new Error("Sheet 'Vendor_Shipments' not found");
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var batchIdCol = findHeaderIndex_(headers, 'batch_id');
  var shipmentIdCol = findHeaderIndex_(headers, 'shipment_id');
  var totalAmountCol = findHeaderIndex_(headers, 'total_amount');
  var result = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][batchIdCol]).trim() === String(batchId).trim()) {
      var shipmentId = String(data[i][shipmentIdCol] || '').trim();
      if (!shipmentId) continue;
      result.push({
        shipmentId: shipmentId,
        totalAmount: totalAmountCol !== -1 ? (Number(data[i][totalAmountCol]) || 0) : 0
      });
    }
  }
  return result;
}

// Idempotently creates a blank CNF_Shipment_Bill_Status row for every
// vendor_shipment in batchId that doesn't already have one. Called when a
// CnfLedgerEntry is logged — safe to call more than once for the same batch.
function ensureCnfShipmentBillStatusRowsForBatch_(batchId) {
  var shipments = getVendorShipmentsRawForBatch_(batchId);
  if (shipments.length === 0) return;

  var sheet = getCnfShipmentBillStatusSheet_();
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var batchIdCol = findHeaderIndex_(headers, 'Batch ID');
  var shipmentIdCol = findHeaderIndex_(headers, 'Shipment ID');

  var existing = {};
  for (var i = 1; i < data.length; i++) {
    existing[String(data[i][batchIdCol]) + '||' + String(data[i][shipmentIdCol])] = true;
  }

  shipments.forEach(function (s) {
    var key = String(batchId) + '||' + s.shipmentId;
    if (!existing[key]) {
      sheet.appendRow([batchId, s.shipmentId, '', '', '']);
    }
  });
}

// ONE-TIME — run manually from the Apps Script editor before the
// shipment-level reconciliation UI ships. Seeds CNF_Shipment_Bill_Status for
// every batch that already has a CnfLedgerEntry, inheriting that entry's
// existing billRequestedAt/billRequestedBy/Invoice Batch ID onto every one
// of that batch's shipments (since nothing has been split by shipment yet).
// Skips any (batchId, shipmentId) pair that already has a row, so it's safe
// to re-run. DO NOT RUN without explicit user confirmation, separate from
// code-deploy confirmation — this writes real billing-status data.
function backfillCnfShipmentBillStatus_() {
  var entries = getCnfLedgerEntries_().entries || [];

  var sheet = getCnfShipmentBillStatusSheet_();
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var batchIdCol = findHeaderIndex_(headers, 'Batch ID');
  var shipmentIdCol = findHeaderIndex_(headers, 'Shipment ID');
  var existing = {};
  for (var i = 1; i < data.length; i++) {
    existing[String(data[i][batchIdCol]) + '||' + String(data[i][shipmentIdCol])] = true;
  }

  var seeded = 0, skipped = 0, batchesProcessed = 0;
  entries.forEach(function (entry) {
    var shipments = getVendorShipmentsRawForBatch_(entry.batchId);
    if (shipments.length === 0) return;
    batchesProcessed++;
    shipments.forEach(function (s) {
      var key = String(entry.batchId) + '||' + s.shipmentId;
      if (existing[key]) { skipped++; return; }
      existing[key] = true;
      sheet.appendRow([
        entry.batchId, s.shipmentId,
        entry.billRequestedAt || '', entry.billRequestedBy || '', entry.invoiceBatchId || ''
      ]);
      seeded++;
    });
  });

  var summary = 'backfillCnfShipmentBillStatus_ complete. Ledger entries: ' + entries.length +
    ', batches with shipments: ' + batchesProcessed + ', rows seeded: ' + seeded + ', already present (skipped): ' + skipped + '.';
  Logger.log(summary);
  return { status: 'success', message: summary, seeded: seeded, skipped: skipped };
}

// Marks selected shipments of a logged batch as "bill requested" — the ask
// has gone out to the agent (tracked internally only, no email/notification
// this round). Writes CNF_Shipment_Bill_Status, not CNF_Ledger — entryId is
// only used to resolve which batch this request is for. shipmentIds is
// optional and defaults to every shipment in the batch (the common
// single-shipment case is still a single click).
function requestCnfBill_(payload) {
  var entryId = String(payload.entryId || '').trim();
  var requestedBy = String(payload.requestedBy || '').trim();
  var requestedShipmentIds = Array.isArray(payload.shipmentIds)
    ? payload.shipmentIds.map(function (x) { return String(x).trim(); }).filter(Boolean)
    : null;
  if (!entryId) throw new Error('payload.entryId is required');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Another CNF request is in progress. Please try again in a moment.');
  }

  try {
    var ledgerSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CNF_Ledger');
    if (!ledgerSheet) throw new Error("Sheet 'CNF_Ledger' not found");
    var ledgerData = ledgerSheet.getDataRange().getValues();
    var batchId = null;
    for (var i = 1; i < ledgerData.length; i++) {
      if (String(ledgerData[i][0]).trim() === entryId) { batchId = String(ledgerData[i][1]).trim(); break; }
    }
    if (!batchId) throw new Error('CNF ledger entry not found: ' + entryId);

    // Safety net — should already exist from add_cnf_ledger_entry (or the
    // one-time backfill), but never block a request on that ordering.
    ensureCnfShipmentBillStatusRowsForBatch_(batchId);

    var allShipmentIds = getVendorShipmentsRawForBatch_(batchId).map(function (s) { return s.shipmentId; });
    if (allShipmentIds.length === 0) throw new Error('No vendor shipments found for batch ' + batchId);

    var targetIds = requestedShipmentIds && requestedShipmentIds.length > 0 ? requestedShipmentIds : allShipmentIds;
    var uniqueTargetIds = targetIds.filter(function (v, idx) { return targetIds.indexOf(v) === idx; });
    var allSet = {};
    allShipmentIds.forEach(function (id) { allSet[id] = true; });
    uniqueTargetIds.forEach(function (id) {
      if (!allSet[id]) throw new Error('Shipment ' + id + ' does not belong to batch ' + batchId);
    });

    var sheet = getCnfShipmentBillStatusSheet_();
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var batchIdCol = findHeaderIndex_(headers, 'Batch ID');
    var shipmentIdCol = findHeaderIndex_(headers, 'Shipment ID');
    var requestedAtCol = findHeaderIndex_(headers, 'Bill Requested At');
    var requestedByCol = findHeaderIndex_(headers, 'Bill Requested By');

    var now = new Date();
    var updated = [];
    uniqueTargetIds.forEach(function (shipmentId) {
      for (var r = 1; r < data.length; r++) {
        if (String(data[r][batchIdCol]).trim() === batchId && String(data[r][shipmentIdCol]).trim() === shipmentId) {
          var existingRequestedAt = data[r][requestedAtCol];
          if (existingRequestedAt) {
            // Idempotent: a retried click just returns what's already there.
            updated.push({
              shipmentId: shipmentId,
              billRequestedAt: String(existingRequestedAt),
              billRequestedBy: data[r][requestedByCol] ? String(data[r][requestedByCol]) : ''
            });
          } else {
            sheet.getRange(r + 1, requestedAtCol + 1).setValue(now);
            sheet.getRange(r + 1, requestedByCol + 1).setValue(requestedBy);
            updated.push({ shipmentId: shipmentId, billRequestedAt: now.toISOString(), billRequestedBy: requestedBy });
          }
          break;
        }
      }
    });

    return {
      status: 'success',
      batchId: batchId,
      updated: updated,
      // Back-compat for callers reading a single billRequestedAt/By off the
      // response — still correct for the common single-shipment-batch case.
      billRequestedAt: updated[0] ? updated[0].billRequestedAt : undefined,
      billRequestedBy: updated[0] ? updated[0].billRequestedBy : undefined
    };
  } finally {
    lock.releaseLock();
  }
}

function getCnfInvoiceBatches_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CNF_Invoice_Batches');
  if (!sheet) return { status: 'success', batches: [] };

  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idCol = headers.indexOf('ID');
  var lineItemsCol = headers.indexOf('Line Items'); // -1 on a sheet that predates Phase 3 — falls back below
  var billNoCol = headers.indexOf('Bill No');
  var billDateCol = headers.indexOf('Bill Date');
  var billedAmountCol = headers.indexOf('Billed Amount');
  var computedTotalCol = headers.indexOf('Computed Total');
  var fileUrlCol = headers.indexOf('File URL');
  var statusCol = headers.indexOf('Status');
  var overrideReasonCol = headers.indexOf('Override Reason');
  var submittedByCol = headers.indexOf('Submitted By');
  var approvedByCol = headers.indexOf('Approved By');
  var rejectionReasonCol = headers.indexOf('Rejection Reason');
  if (idCol === -1 || billNoCol === -1 || billDateCol === -1 ||
      billedAmountCol === -1 || computedTotalCol === -1 || statusCol === -1) {
    throw new Error("Sheet 'CNF_Invoice_Batches' is missing required column(s). Expected: ID | Bill No | Bill Date | Billed Amount | Computed Total | File URL | Status | Override Reason | Submitted By | Approved By | Rejection Reason | Created At");
  }

  // Group every CNF_Shipment_Bill_Status row by Invoice Batch ID, so
  // lineItems can be derived for legacy batches (created before the 'Line
  // Items' column existed) once backfillCnfShipmentBillStatus_ has inherited
  // their old single-batch billing state onto their shipments.
  var shipmentsByInvoiceBatch = {}; // invoiceBatchId -> { batchId -> [shipmentId, ...] }
  getCnfShipmentBillStatusRows_().forEach(function (row) {
    if (!row.invoiceBatchId) return;
    if (!shipmentsByInvoiceBatch[row.invoiceBatchId]) shipmentsByInvoiceBatch[row.invoiceBatchId] = {};
    var byBatch = shipmentsByInvoiceBatch[row.invoiceBatchId];
    if (!byBatch[row.batchId]) byBatch[row.batchId] = [];
    byBatch[row.batchId].push(row.shipmentId);
  });

  var batches = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][idCol]) continue;
    var id = String(data[i][idCol]);

    var lineItems = [];
    var storedRaw = lineItemsCol !== -1 ? data[i][lineItemsCol] : '';
    if (storedRaw) {
      try { lineItems = JSON.parse(storedRaw); } catch (e) { lineItems = []; }
    }
    if (lineItems.length === 0 && shipmentsByInvoiceBatch[id]) {
      var byBatch = shipmentsByInvoiceBatch[id];
      lineItems = Object.keys(byBatch).map(function (batchId) {
        return { batchId: batchId, shipmentIds: byBatch[batchId] };
      });
    }

    batches.push({
      id: id,
      lineItems: lineItems,
      billNo: String(data[i][billNoCol]),
      billDate: String(data[i][billDateCol]),
      billedAmount: Number(data[i][billedAmountCol]) || 0,
      computedTotal: Number(data[i][computedTotalCol]) || 0,
      fileUrl: fileUrlCol !== -1 && data[i][fileUrlCol] ? String(data[i][fileUrlCol]) : undefined,
      status: String(data[i][statusCol]),
      overrideReason: overrideReasonCol !== -1 && data[i][overrideReasonCol] ? String(data[i][overrideReasonCol]) : undefined,
      submittedBy: submittedByCol !== -1 ? String(data[i][submittedByCol]) : '',
      approvedBy: approvedByCol !== -1 && data[i][approvedByCol] ? String(data[i][approvedByCol]) : undefined,
      rejectionReason: rejectionReasonCol !== -1 && data[i][rejectionReasonCol] ? String(data[i][rejectionReasonCol]) : undefined
    });
  }
  return { status: 'success', batches: batches };
}

// lineItems: [{batchId, shipmentIds}] — can span multiple batches. Each
// batch's own CnfLedgerEntry.totalPayable is prorated across its selected
// shipments by RMB invoice value (Vendor_Shipments.total_amount), summed
// into computedTotal. Writes Invoice Batch ID onto the selected
// CNF_Shipment_Bill_Status rows — CNF_Ledger's own Invoice Batch ID column
// is legacy/frozen and is no longer touched here (see design doc).
function createCnfInvoiceBatch_(payload) {
  var entry = (payload && payload.entry) || {};
  var id = String(entry.id || '').trim();
  var lineItemsInput = Array.isArray(entry.lineItems) ? entry.lineItems : [];
  var billNo = String(entry.billNo || '').trim();
  var billDate = String(entry.billDate || '').trim();
  var billedAmount = Number(entry.billedAmount);
  var fileUrl = entry.fileUrl ? String(entry.fileUrl).trim() : '';
  var overrideReason = entry.overrideReason ? String(entry.overrideReason).trim() : '';
  var submittedBy = String(entry.submittedBy || '').trim();

  if (!id) throw new Error('Missing entry.id');
  if (lineItemsInput.length === 0) throw new Error('lineItems must be a non-empty array');

  var lineItems = [];
  var seenPairs = {};
  lineItemsInput.forEach(function (li, idx) {
    var batchId = String((li && li.batchId) || '').trim();
    if (!batchId) throw new Error('lineItems[' + idx + '] is missing batchId');
    var shipmentIds = Array.isArray(li && li.shipmentIds)
      ? li.shipmentIds.map(function (x) { return String(x).trim(); }).filter(Boolean)
      : [];
    var uniqueShipmentIds = shipmentIds.filter(function (v, i) { return shipmentIds.indexOf(v) === i; });
    if (uniqueShipmentIds.length === 0) throw new Error('lineItems[' + idx + '] (batch ' + batchId + ') must include at least one shipmentId');
    uniqueShipmentIds.forEach(function (sid) {
      var pairKey = batchId + '||' + sid;
      if (seenPairs[pairKey]) throw new Error('Shipment ' + sid + ' (batch ' + batchId + ') is listed more than once');
      seenPairs[pairKey] = true;
    });
    lineItems.push({ batchId: batchId, shipmentIds: uniqueShipmentIds });
  });

  if (!billNo) throw new Error('Bill No is required');
  if (!billDate) throw new Error('Bill Date is required');
  if (isNaN(billedAmount) || billedAmount <= 0) throw new Error('Billed Amount must be a positive number');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Another invoice batch is currently being created. Please try again in a moment.');
  }

  try {
    var ledgerSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CNF_Ledger');
    if (!ledgerSheet) throw new Error("Sheet 'CNF_Ledger' not found");
    var ledgerValues = ledgerSheet.getDataRange().getValues();
    var ledgerHeaders = ledgerValues[0];
    var ledgerBatchIdCol = ledgerHeaders.indexOf('Batch ID');
    var ledgerTotalPayableCol = ledgerHeaders.indexOf('Total Payable');
    if (ledgerBatchIdCol === -1) throw new Error("CNF_Ledger sheet is missing a 'Batch ID' column");
    if (ledgerTotalPayableCol === -1) throw new Error("CNF_Ledger sheet is missing a 'Total Payable' column");

    var billStatusSheet = getCnfShipmentBillStatusSheet_();
    var billStatusData = billStatusSheet.getDataRange().getValues();
    var billStatusHeaders = billStatusData[0];
    var bsBatchIdCol = findHeaderIndex_(billStatusHeaders, 'Batch ID');
    var bsShipmentIdCol = findHeaderIndex_(billStatusHeaders, 'Shipment ID');
    var bsInvoiceBatchIdCol = findHeaderIndex_(billStatusHeaders, 'Invoice Batch ID');

    var computedTotal = 0;
    var rowsToStamp = []; // 0-indexed rows into billStatusData

    lineItems.forEach(function (li) {
      var totalPayable = null;
      for (var r = 1; r < ledgerValues.length; r++) {
        if (String(ledgerValues[r][ledgerBatchIdCol] || '').trim() === li.batchId) {
          var payableRaw = ledgerValues[r][ledgerTotalPayableCol];
          var payableNum = Number(payableRaw);
          if (payableRaw === '' || payableRaw === null || isNaN(payableNum)) {
            throw new Error('Batch ' + li.batchId + ' has a non-numeric Total Payable value: ' + payableRaw);
          }
          totalPayable = payableNum;
          break;
        }
      }
      if (totalPayable === null) throw new Error('No CNF ledger entry found for batch: ' + li.batchId);

      var shipments = getVendorShipmentsRawForBatch_(li.batchId);
      var batchTotalRmb = shipments.reduce(function (sum, s) { return sum + s.totalAmount; }, 0);
      if (batchTotalRmb <= 0) throw new Error('Batch ' + li.batchId + ' has zero total invoice value — cannot prorate a bill across its shipments.');
      var rmbByShipmentId = {};
      shipments.forEach(function (s) { rmbByShipmentId[s.shipmentId] = s.totalAmount; });

      li.shipmentIds.forEach(function (shipmentId) {
        if (!(shipmentId in rmbByShipmentId)) {
          throw new Error('Shipment ' + shipmentId + ' does not belong to batch ' + li.batchId);
        }
        var foundRow = -1;
        for (var r2 = 1; r2 < billStatusData.length; r2++) {
          if (String(billStatusData[r2][bsBatchIdCol]).trim() === li.batchId && String(billStatusData[r2][bsShipmentIdCol]).trim() === shipmentId) {
            foundRow = r2;
            break;
          }
        }
        if (foundRow === -1) throw new Error('No CNF_Shipment_Bill_Status row for shipment ' + shipmentId + ' (batch ' + li.batchId + ') — log the CNF entry for this batch first.');
        var existingInvoiceBatchId = String(billStatusData[foundRow][bsInvoiceBatchIdCol] || '').trim();
        if (existingInvoiceBatchId) {
          throw new Error('Shipment ' + shipmentId + ' (batch ' + li.batchId + ') is already billed under invoice batch ' + existingInvoiceBatchId);
        }

        var shipmentShare = rmbByShipmentId[shipmentId] / batchTotalRmb;
        computedTotal += totalPayable * shipmentShare;
        rowsToStamp.push(foundRow);
      });
    });

    computedTotal = Math.round(computedTotal * 100) / 100;

    rowsToStamp.forEach(function (rowIndex) {
      billStatusSheet.getRange(rowIndex + 1, bsInvoiceBatchIdCol + 1).setValue(id);
    });
    SpreadsheetApp.flush();

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var batchSheet = ss.getSheetByName('CNF_Invoice_Batches');
    var expectedHeaders = ['ID', 'Entry IDs', 'Bill No', 'Bill Date', 'Billed Amount', 'Computed Total',
      'File URL', 'Status', 'Override Reason', 'Submitted By', 'Approved By', 'Rejection Reason', 'Created At'];
    if (!batchSheet) {
      batchSheet = ss.insertSheet('CNF_Invoice_Batches');
      batchSheet.appendRow(expectedHeaders);
    }
    ensureHeaderColumn_(batchSheet, 'Line Items');
    var batchHeaderRow = batchSheet.getRange(1, 1, 1, Math.max(batchSheet.getLastColumn(), 1)).getValues()[0];
    var batchHeaderMap = {};
    for (var h = 0; h < batchHeaderRow.length; h++) {
      var name = String(batchHeaderRow[h] || '').trim();
      if (name) batchHeaderMap[name] = h;
    }
    var missingBatchHeaders = expectedHeaders.filter(function (name) { return !(name in batchHeaderMap); });
    if (missingBatchHeaders.length > 0) {
      throw new Error('CNF_Invoice_Batches sheet is missing column(s): ' + missingBatchHeaders.join(', '));
    }

    var newRow = new Array(Object.keys(batchHeaderMap).length).fill('');
    newRow[batchHeaderMap['ID']] = id;
    newRow[batchHeaderMap['Line Items']] = JSON.stringify(lineItems);
    newRow[batchHeaderMap['Bill No']] = billNo;
    newRow[batchHeaderMap['Bill Date']] = billDate;
    newRow[batchHeaderMap['Billed Amount']] = billedAmount;
    newRow[batchHeaderMap['Computed Total']] = computedTotal;
    newRow[batchHeaderMap['File URL']] = fileUrl;
    newRow[batchHeaderMap['Status']] = 'Pending Approval';
    newRow[batchHeaderMap['Override Reason']] = overrideReason;
    newRow[batchHeaderMap['Submitted By']] = submittedBy;
    newRow[batchHeaderMap['Approved By']] = '';
    newRow[batchHeaderMap['Rejection Reason']] = '';
    newRow[batchHeaderMap['Created At']] = new Date().toISOString();
    batchSheet.appendRow(newRow);

    return { status: 'success', id: id, computedTotal: computedTotal };
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────
// PASTE INTO: accounting_logger.js, right after createCnfInvoiceBatch_'s closing brace
// ─────────────────────────────────────────────────────────────

function cnfInvoiceBatchAlreadyApproved_(batchId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CNF_Invoice_Batches');
  if (!sheet) return false;
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return false;
  var headers = data[0];
  var idCol = headers.indexOf('ID');
  var statusCol = headers.indexOf('Status');
  if (idCol === -1 || statusCol === -1) return false;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol] || '').trim() === String(batchId).trim() &&
        String(data[i][statusCol] || '').trim() === 'Approved') {
      return true;
    }
  }
  return false;
}

function approveCnfInvoiceBatch(payload) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { status: 'error', message: 'Could not acquire lock — try again' };
  }
  try {
    var batchId = payload && payload.batchId;
    var approvedBy = (payload && payload.approvedBy) || '';
    if (!batchId) return { status: 'error', message: 'batchId is required' };

    if (cnfInvoiceBatchAlreadyApproved_(batchId)) {
      return {
        status: 'success',
        message: 'Batch already approved (duplicate submission ignored)',
        id: batchId,
        purchaseInvoiceId: 'CNF-' + batchId
      };
    }

    var batchSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CNF_Invoice_Batches');
    if (!batchSheet) return { status: 'error', message: "Sheet 'CNF_Invoice_Batches' not found" };

    var data = batchSheet.getDataRange().getValues();
    if (data.length <= 1) return { status: 'error', message: 'Invoice batch not found: ' + batchId };
    var headers = data[0];
    var idCol           = headers.indexOf('ID');
    var billNoCol        = headers.indexOf('Bill No');
    var billDateCol      = headers.indexOf('Bill Date');
    var billedAmountCol  = headers.indexOf('Billed Amount');
    var statusCol        = headers.indexOf('Status');
    var approvedByCol    = headers.indexOf('Approved By');

    if (idCol === -1 || billNoCol === -1 || billDateCol === -1 || billedAmountCol === -1 ||
        statusCol === -1 || approvedByCol === -1) {
      return {
        status: 'error',
        message: "CNF_Invoice_Batches sheet is missing required column(s). Expected at least: ID | Bill No | Bill Date | Billed Amount | Status | Approved By"
      };
    }

    var rowIdx = -1;
    var batchRow = null;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idCol] || '').trim() === String(batchId).trim()) {
        rowIdx = i + 1;
        batchRow = data[i];
        break;
      }
    }
    if (rowIdx === -1) {
      return { status: 'error', message: 'Invoice batch not found: ' + batchId };
    }

    var currentStatus = String(batchRow[statusCol] || '').trim();
    if (currentStatus === 'Rejected') {
      return {
        status: 'error',
        message: 'Cannot approve batch ' + batchId + ' — it was already rejected and its ledger entries were returned to the unbilled pool. Create a new batch instead.'
      };
    }

    var billedAmountRaw = batchRow[billedAmountCol];
    var billedAmountNum = Number(billedAmountRaw);
    if (billedAmountRaw === '' || billedAmountRaw === null || isNaN(billedAmountNum)) {
      return {
        status: 'error',
        message: 'Batch ' + batchId + ' has a non-numeric Billed Amount (' + billedAmountRaw + ') — refusing to post a purchase invoice or approve. Fix the Billed Amount and retry.'
      };
    }

    var cnfInvoiceId = 'CNF-' + batchId;
    var invoiceResponse = addPurchaseInvoice({
      record: {
        invoiceId: cnfInvoiceId,
        vendorCode: 'KREIZ',
        rmb: billedAmountNum,
        date: batchRow[billDateCol],
        notes: 'CNF consolidated bill ' + batchRow[billNoCol]
      }
    });

    var parsedInvoiceResponse;
    try {
      parsedInvoiceResponse = JSON.parse(invoiceResponse.getContent());
    } catch (parseErr) {
      return { status: 'error', message: 'Could not parse addPurchaseInvoice response — batch NOT marked approved: ' + parseErr.message };
    }
    var invoicePostFailed = (parsedInvoiceResponse.status === 'error') || (parsedInvoiceResponse.success === false);
    if (invoicePostFailed) {
      var failureMessage = parsedInvoiceResponse.message || parsedInvoiceResponse.error || 'Unknown error posting purchase invoice';
      return { status: 'error', message: 'Failed to post purchase invoice — batch NOT marked approved: ' + failureMessage };
    }

    batchSheet.getRange(rowIdx, statusCol + 1).setValue('Approved');
    batchSheet.getRange(rowIdx, approvedByCol + 1).setValue(approvedBy);

    invalidateSheetCache_('PurchaseInvoices');
    invalidateSheetCache_('CNF_Invoice_Batches');

    return { status: 'success', id: batchId, purchaseInvoiceId: cnfInvoiceId };
  } finally {
    lock.releaseLock();
  }
}

function rejectCnfInvoiceBatch(payload) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { status: 'error', message: 'Could not acquire lock — try again' };
  }
  try {
    var batchId = payload && payload.batchId;
    var reason = (payload && payload.rejectionReason) || '';
    if (!batchId) return { status: 'error', message: 'batchId is required' };

    var batchSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CNF_Invoice_Batches');
    if (!batchSheet) return { status: 'error', message: "Sheet 'CNF_Invoice_Batches' not found" };

    var data = batchSheet.getDataRange().getValues();
    if (data.length <= 1) return { status: 'error', message: 'Invoice batch not found: ' + batchId };
    var headers = data[0];
    var idCol        = headers.indexOf('ID');
    var statusCol    = headers.indexOf('Status');
    var reasonCol    = headers.indexOf('Rejection Reason');
    var entryIdsCol  = headers.indexOf('Entry IDs');

    if (idCol === -1 || statusCol === -1 || reasonCol === -1 || entryIdsCol === -1) {
      return {
        status: 'error',
        message: "CNF_Invoice_Batches sheet is missing required column(s). Expected at least: ID | Status | Rejection Reason | Entry IDs"
      };
    }

    var rowIdx = -1;
    var entryIds = [];
    var currentStatus = '';
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idCol] || '').trim() === String(batchId).trim()) {
        rowIdx = i + 1;
        currentStatus = String(data[i][statusCol] || '').trim();
        try {
          var raw = data[i][entryIdsCol];
          entryIds = raw ? JSON.parse(raw) : [];
        } catch (e) {
          entryIds = [];
        }
        break;
      }
    }
    if (rowIdx === -1) {
      return { status: 'error', message: 'Invoice batch not found: ' + batchId };
    }
    if (currentStatus === 'Approved') {
      return { status: 'error', message: 'Cannot reject an already-approved batch' };
    }
    if (currentStatus === 'Rejected') {
      return { status: 'success', message: 'Batch already rejected (duplicate submission ignored)', id: batchId };
    }

    batchSheet.getRange(rowIdx, statusCol + 1).setValue('Rejected');
    batchSheet.getRange(rowIdx, reasonCol + 1).setValue(reason);

    var ledgerSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CNF_Ledger');
    if (ledgerSheet && entryIds.length > 0) {
      var ledgerData = ledgerSheet.getDataRange().getValues();
      if (ledgerData.length > 1) {
        var ledgerHeaders = ledgerData[0];
        var ledgerIdCol = ledgerHeaders.indexOf('ID');
        var invoiceBatchIdCol = ledgerHeaders.indexOf('Invoice Batch ID');
        if (ledgerIdCol !== -1 && invoiceBatchIdCol !== -1) {
          entryIds.forEach(function (entryId) {
            for (var j = 1; j < ledgerData.length; j++) {
              if (String(ledgerData[j][ledgerIdCol] || '').trim() === String(entryId).trim()) {
                var currentInvoiceBatchId = String(ledgerData[j][invoiceBatchIdCol] || '').trim();
                if (currentInvoiceBatchId === String(batchId).trim()) {
                  ledgerSheet.getRange(j + 1, invoiceBatchIdCol + 1).setValue('');
                }
                break;
              }
            }
          });
        }
      }
    }

    // Shipment-level reconciliation (see design doc) — clear Invoice Batch
    // ID on every CNF_Shipment_Bill_Status row this batch had claimed, so
    // those shipments become billable again. Queried by Invoice Batch ID
    // directly rather than via entryIds, so this covers both new-style
    // batches (which never touch CNF_Ledger's own Invoice Batch ID above)
    // and legacy batches once backfillCnfShipmentBillStatus_ has run.
    var billStatusSheet = getCnfShipmentBillStatusSheet_();
    var billStatusData = billStatusSheet.getDataRange().getValues();
    if (billStatusData.length > 1) {
      var bsHeaders = billStatusData[0];
      var bsInvoiceBatchIdCol = findHeaderIndex_(bsHeaders, 'Invoice Batch ID');
      if (bsInvoiceBatchIdCol !== -1) {
        for (var bs = 1; bs < billStatusData.length; bs++) {
          if (String(billStatusData[bs][bsInvoiceBatchIdCol] || '').trim() === String(batchId).trim()) {
            billStatusSheet.getRange(bs + 1, bsInvoiceBatchIdCol + 1).setValue('');
          }
        }
      }
    }

    invalidateSheetCache_('CNF_Invoice_Batches');
    invalidateSheetCache_('CNF_Ledger');

    return { status: 'success', id: batchId };
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────
// CNF ADVANCES — money paid to CNF to settle an overseas/RMB vendor's
// balance, tracked as an advance until CNF's own tax invoice matches
// against it. See docs/superpowers/specs/2026-09-25-cnf-advances-invoice-matching-design.md.
// Purely additive — does not read or write CNF_Ledger, CNF_Invoice_Batches,
// or CNF_Shipment_Bill_Status.
// ─────────────────────────────────────────────────────────────

function getCnfAdvancesSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('CNF_Advances');
  if (!sheet) {
    sheet = ss.insertSheet('CNF_Advances');
    sheet.appendRow(['ID', 'Date', 'Vendor Code', 'Linked Payment ID', 'Amount', 'Balance']);
  }
  return sheet;
}

function getCnfAdvances_() {
  var sheet = getCnfAdvancesSheet_();
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idCol = findHeaderIndex_(headers, 'ID');
  var dateCol = findHeaderIndex_(headers, 'Date');
  var vendorCodeCol = findHeaderIndex_(headers, 'Vendor Code');
  var linkedPaymentIdCol = findHeaderIndex_(headers, 'Linked Payment ID');
  var amountCol = findHeaderIndex_(headers, 'Amount');
  var balanceCol = findHeaderIndex_(headers, 'Balance');
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][idCol]) continue;
    var rawDate = data[i][dateCol];
    rows.push({
      id: String(data[i][idCol]),
      date: rawDate instanceof Date ? rawDate.toISOString() : String(rawDate || ''),
      vendorCode: String(data[i][vendorCodeCol] || ''),
      linkedPaymentId: String(data[i][linkedPaymentIdCol] || ''),
      amount: Number(data[i][amountCol]) || 0,
      balance: Number(data[i][balanceCol]) || 0
    });
  }
  return rows;
}

// Called from fifoLiquidate_ whenever money actually settles a non-INR
// (overseas/RMB) vendor's payable. One row per fifoLiquidate_ call, for
// the INR value of whatever portion of that call's payment actually
// applied against an open invoice (never the unspent leftover, which
// stays as ordinary PaymentLogs wallet balance, untouched by this).
function createCnfAdvance_(vendorCode, linkedPaymentId, amountInr, dateStr) {
  if (amountInr <= 0.01) return;
  var sheet = getCnfAdvancesSheet_();
  var id = 'ADV-' + new Date().getTime();
  var round2 = function (v) { return Math.round(v * 100) / 100; };
  sheet.appendRow([id, dateStr, vendorCode, linkedPaymentId, round2(amountInr), round2(amountInr)]);
}

// ─────────────────────────────────────────────────────────────
// CNF GOODS INVOICES — CNF's real tax invoice (goods value, already
// inflated with its service markup, GST on top), matched against
// outstanding CNF_Advances. See docs/superpowers/specs/2026-09-25-cnf-advances-invoice-matching-design.md.
// ─────────────────────────────────────────────────────────────

function getCnfGoodsInvoicesSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('CNF_Goods_Invoices');
  if (!sheet) {
    sheet = ss.insertSheet('CNF_Goods_Invoices');
    sheet.appendRow([
      'ID', 'Date', 'File URL', 'Line Items', 'Matched Advances',
      'Stated Base Amount', 'Expected Goods Value', 'Service Charge', 'GST', 'Total',
      'Residual Liability', 'Status', 'Override Reason', 'Submitted By', 'Approved By',
      'Rejection Reason', 'Created At'
    ]);
  }
  return sheet;
}

function getCnfGoodsInvoices_() {
  var sheet = getCnfGoodsInvoicesSheet_();
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var col = function (name) { return findHeaderIndex_(headers, name); };
  var idCol = col('ID'), dateCol = col('Date'), fileUrlCol = col('File URL'),
      lineItemsCol = col('Line Items'), matchedAdvancesCol = col('Matched Advances'),
      statedBaseCol = col('Stated Base Amount'), expectedGoodsCol = col('Expected Goods Value'),
      serviceChargeCol = col('Service Charge'), gstCol = col('GST'), totalCol = col('Total'),
      residualCol = col('Residual Liability'), statusCol = col('Status'),
      overrideReasonCol = col('Override Reason'), submittedByCol = col('Submitted By'),
      approvedByCol = col('Approved By'), rejectionReasonCol = col('Rejection Reason');

  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][idCol]) continue;
    var lineItems = [];
    try { lineItems = data[i][lineItemsCol] ? JSON.parse(data[i][lineItemsCol]) : []; } catch (e) { lineItems = []; }
    var matchedAdvances = [];
    try { matchedAdvances = data[i][matchedAdvancesCol] ? JSON.parse(data[i][matchedAdvancesCol]) : []; } catch (e) { matchedAdvances = []; }
    var rawDate = data[i][dateCol];

    rows.push({
      id: String(data[i][idCol]),
      date: rawDate instanceof Date ? rawDate.toISOString() : String(rawDate || ''),
      fileUrl: data[i][fileUrlCol] ? String(data[i][fileUrlCol]) : undefined,
      lineItems: lineItems,
      matchedAdvances: matchedAdvances,
      statedBaseAmount: Number(data[i][statedBaseCol]) || 0,
      expectedGoodsValue: Number(data[i][expectedGoodsCol]) || 0,
      serviceCharge: Number(data[i][serviceChargeCol]) || 0,
      gst: Number(data[i][gstCol]) || 0,
      total: Number(data[i][totalCol]) || 0,
      residualLiability: Number(data[i][residualCol]) || 0,
      status: String(data[i][statusCol] || ''),
      overrideReason: data[i][overrideReasonCol] ? String(data[i][overrideReasonCol]) : undefined,
      submittedBy: String(data[i][submittedByCol] || ''),
      approvedBy: data[i][approvedByCol] ? String(data[i][approvedByCol]) : undefined,
      rejectionReason: data[i][rejectionReasonCol] ? String(data[i][rejectionReasonCol]) : undefined
    });
  }
  return rows;
}

// payload.entry: { lineItems: [{batchId, shipmentIds}], matchedAdvances:
// [{advanceId, amountMatched}], fileUrl, statedBaseAmount, gst, total,
// overrideReason, submittedBy }. Validates every matched advance has
// sufficient balance, then reserves (draws down) it immediately — before
// approval — so a second invoice can't also claim the same advance balance
// while this one is still Pending Approval. expectedGoodsValue is derived
// as sum(matchedAdvances.amountMatched), never independently computed.
function logCnfGoodsInvoice_(payload) {
  var entry = (payload && payload.entry) || {};
  var lineItemsInput = Array.isArray(entry.lineItems) ? entry.lineItems : [];
  var matchedAdvancesInput = Array.isArray(entry.matchedAdvances) ? entry.matchedAdvances : [];
  var fileUrl = entry.fileUrl ? String(entry.fileUrl).trim() : '';
  var statedBaseAmount = Number(entry.statedBaseAmount);
  var gst = Number(entry.gst);
  var total = Number(entry.total);
  var overrideReason = entry.overrideReason ? String(entry.overrideReason).trim() : '';
  var submittedBy = String(entry.submittedBy || '').trim();

  if (lineItemsInput.length === 0) throw new Error('lineItems must be a non-empty array');
  if (matchedAdvancesInput.length === 0) throw new Error('matchedAdvances must be a non-empty array');
  if (isNaN(statedBaseAmount) || statedBaseAmount <= 0) throw new Error('Stated Base Amount must be a positive number');
  if (isNaN(gst) || gst < 0) throw new Error('GST must be a non-negative number');
  if (isNaN(total) || total <= 0) throw new Error('Total must be a positive number');
  if (!submittedBy) throw new Error('submittedBy is required');

  var lineItems = lineItemsInput.map(function (li, idx) {
    var batchId = String((li && li.batchId) || '').trim();
    if (!batchId) throw new Error('lineItems[' + idx + '] is missing batchId');
    var shipmentIds = Array.isArray(li && li.shipmentIds)
      ? li.shipmentIds.map(function (x) { return String(x).trim(); }).filter(Boolean)
      : [];
    if (shipmentIds.length === 0) throw new Error('lineItems[' + idx + '] (batch ' + batchId + ') must include at least one shipmentId');
    return { batchId: batchId, shipmentIds: shipmentIds };
  });

  var seenAdvanceIds = {};
  var matchedAdvances = matchedAdvancesInput.map(function (m, idx) {
    var advanceId = String((m && m.advanceId) || '').trim();
    var amountMatched = Number(m && m.amountMatched);
    if (!advanceId) throw new Error('matchedAdvances[' + idx + '] is missing advanceId');
    if (isNaN(amountMatched) || amountMatched <= 0) throw new Error('matchedAdvances[' + idx + '] must have a positive amountMatched');
    // Reject duplicates outright rather than trying to sum them during
    // validation below — the balance check there reads each advance's
    // current balance once, so two entries for the same advanceId would
    // each be validated against the same stale balance and could together
    // over-draw it.
    if (seenAdvanceIds[advanceId]) throw new Error('Advance ' + advanceId + ' is listed more than once in matchedAdvances');
    seenAdvanceIds[advanceId] = true;
    return { advanceId: advanceId, amountMatched: Math.round(amountMatched * 100) / 100 };
  });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Another CNF invoice is currently being logged. Please try again in a moment.');
  }

  try {
    var advancesSheet = getCnfAdvancesSheet_();
    var advancesData = advancesSheet.getDataRange().getValues();
    var advancesHeaders = advancesData[0];
    var advIdCol = findHeaderIndex_(advancesHeaders, 'ID');
    var advBalanceCol = findHeaderIndex_(advancesHeaders, 'Balance');

    var rowByAdvanceId = {};
    for (var r = 1; r < advancesData.length; r++) {
      var advId = String(advancesData[r][advIdCol] || '').trim();
      if (advId) rowByAdvanceId[advId] = r;
    }

    var round2 = function (v) { return Math.round(v * 100) / 100; };
    var expectedGoodsValue = 0;

    matchedAdvances.forEach(function (m) {
      var rowIdx = rowByAdvanceId[m.advanceId];
      if (rowIdx === undefined) throw new Error('CNF advance not found: ' + m.advanceId);
      var currentBalance = Number(advancesData[rowIdx][advBalanceCol]) || 0;
      if (m.amountMatched > currentBalance + 0.01) {
        throw new Error('Advance ' + m.advanceId + ' has balance ' + currentBalance + ', cannot match ' + m.amountMatched);
      }
      expectedGoodsValue += m.amountMatched;
    });
    expectedGoodsValue = round2(expectedGoodsValue);

    matchedAdvances.forEach(function (m) {
      var rowIdx = rowByAdvanceId[m.advanceId];
      var currentBalance = Number(advancesData[rowIdx][advBalanceCol]) || 0;
      advancesSheet.getRange(rowIdx + 1, advBalanceCol + 1).setValue(round2(currentBalance - m.amountMatched));
    });

    var serviceCharge = round2(statedBaseAmount - expectedGoodsValue);
    var residualLiability = round2(total - expectedGoodsValue);

    var id = 'CGI-' + new Date().getTime();
    var sheet = getCnfGoodsInvoicesSheet_();
    var nowIso = new Date().toISOString();
    sheet.appendRow([
      id, nowIso, fileUrl, JSON.stringify(lineItems), JSON.stringify(matchedAdvances),
      statedBaseAmount, expectedGoodsValue, serviceCharge, gst, total,
      residualLiability, 'Pending Approval', overrideReason, submittedBy, '', '', nowIso
    ]);

    return {
      status: 'success', id: id, expectedGoodsValue: expectedGoodsValue,
      serviceCharge: serviceCharge, residualLiability: residualLiability
    };
  } finally {
    lock.releaseLock();
  }
}

function approveCnfGoodsInvoice_(payload) {
  var id = payload && payload.id;
  var approvedBy = (payload && payload.approvedBy) || '';
  if (!id) throw new Error('id is required');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Another CNF invoice approval is in progress. Please try again in a moment.');
  }
  try {
    var sheet = getCnfGoodsInvoicesSheet_();
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idCol = findHeaderIndex_(headers, 'ID');
    var statusCol = findHeaderIndex_(headers, 'Status');
    var approvedByCol = findHeaderIndex_(headers, 'Approved By');

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idCol] || '').trim() === String(id).trim()) {
        var currentStatus = String(data[i][statusCol] || '').trim();
        if (currentStatus === 'Approved') {
          return { status: 'success', message: 'Already approved (duplicate submission ignored)', id: id };
        }
        if (currentStatus === 'Rejected') {
          throw new Error('Cannot approve an already-rejected invoice');
        }
        sheet.getRange(i + 1, statusCol + 1).setValue('Approved');
        sheet.getRange(i + 1, approvedByCol + 1).setValue(approvedBy);
        return { status: 'success', id: id };
      }
    }
    throw new Error('CNF goods invoice not found: ' + id);
  } finally {
    lock.releaseLock();
  }
}

// Restores the balances reserved at log time (see logCnfGoodsInvoice_) —
// rejection is the only way an advance's reservation gets undone.
function rejectCnfGoodsInvoice_(payload) {
  var id = payload && payload.id;
  var reason = (payload && payload.rejectionReason) || '';
  if (!id) throw new Error('id is required');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    throw new Error('Another CNF invoice rejection is in progress. Please try again in a moment.');
  }
  try {
    var sheet = getCnfGoodsInvoicesSheet_();
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var idCol = findHeaderIndex_(headers, 'ID');
    var statusCol = findHeaderIndex_(headers, 'Status');
    var reasonCol = findHeaderIndex_(headers, 'Rejection Reason');
    var matchedAdvancesCol = findHeaderIndex_(headers, 'Matched Advances');

    var rowIdx = -1, currentStatus = '', matchedAdvances = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idCol] || '').trim() === String(id).trim()) {
        rowIdx = i;
        currentStatus = String(data[i][statusCol] || '').trim();
        try { matchedAdvances = data[i][matchedAdvancesCol] ? JSON.parse(data[i][matchedAdvancesCol]) : []; } catch (e) { matchedAdvances = []; }
        break;
      }
    }
    if (rowIdx === -1) throw new Error('CNF goods invoice not found: ' + id);
    if (currentStatus === 'Approved') throw new Error('Cannot reject an already-approved invoice');
    if (currentStatus === 'Rejected') {
      return { status: 'success', message: 'Already rejected (duplicate submission ignored)', id: id };
    }

    var advancesSheet = getCnfAdvancesSheet_();
    var advancesData = advancesSheet.getDataRange().getValues();
    var advancesHeaders = advancesData[0];
    var advIdCol = findHeaderIndex_(advancesHeaders, 'ID');
    var advBalanceCol = findHeaderIndex_(advancesHeaders, 'Balance');
    var round2 = function (v) { return Math.round(v * 100) / 100; };

    matchedAdvances.forEach(function (m) {
      for (var r = 1; r < advancesData.length; r++) {
        if (String(advancesData[r][advIdCol] || '').trim() === String(m.advanceId).trim()) {
          var currentBalance = Number(advancesData[r][advBalanceCol]) || 0;
          advancesSheet.getRange(r + 1, advBalanceCol + 1).setValue(round2(currentBalance + (Number(m.amountMatched) || 0)));
          break;
        }
      }
    });

    sheet.getRange(rowIdx + 1, statusCol + 1).setValue('Rejected');
    sheet.getRange(rowIdx + 1, reasonCol + 1).setValue(reason);
    return { status: 'success', id: id };
  } finally {
    lock.releaseLock();
  }
}

