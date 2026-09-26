/**
 * BarcodeAppStore.gs — Google Sheets as the app's database.
 *
 * The Master Barcode Suite backend (api/_lib/*Store.ts) used to keep scan counts,
 * weights, Drive links, production-order matches and settings in Supabase. It now
 * keeps them in the Google Sheet itself, through the actions in this file.
 *
 * ── SETUP ────────────────────────────────────────────────────────────────────
 * 1. Add this file to every Apps Script project the app calls:
 *      - APP_SCRIPTS_URL            (Vendor_Shipment_* + Purchase_Order_Lines tabs) → shipment + PO-line actions
 *      - MASTER_BARCODE_SCRIPTS_URL (product master / production orders) → code-match + settings actions
 *    Every action only touches the spreadsheet the project is bound to, so it is
 *    fine (and simplest) to paste the whole file into each project.
 *    For a standalone (non-container-bound) project, set BS_SPREADSHEET_ID below.
 * 2. At the very top of that project's existing doPost(e), add:
 *        var handled = barcodeStoreHandle_(e);
 *        if (handled) return handled;
 * 3. Deploy → Manage deployments → edit the existing web app → New version → Deploy.
 *    (Keep the same deployment so the URL in your Vercel env vars stays valid.)
 *
 * ── SHEET LAYOUT ASSUMPTIONS ────────────────────────────────────────────────
 * - Row 1 of each tab is the header row. Columns are found BY HEADER NAME
 *   (case/space/punctuation-insensitive: "Shipment ID" == "shipment_id"), so column
 *   order doesn't matter.
 * - Columns the app writes are appended at the end of the tab if missing:
 *     Vendor_Shipment_Lines : scanned_qty   (already exists in your sheet)
 *     Vendor_Shipments      : listed_weight, actual_weight, drive_link
 * - Production-order matches live in their own tab "App_Code_Match" (created on
 *   first use) because the production-order tab is generated from another source.
 */

var BS_SPREADSHEET_ID = ''; // leave empty for a container-bound project

var BS_TABS = {
  batches:   ['Batches', 'Vendor_Shipment_Batches', 'Vendor_Batches', 'Shipment_Batches'],
  shipments: ['Vendor_Shipments', 'Shipments'],
  lines:     ['Vendor_Shipment_Lines', 'Shipment_Lines'],
  poLines:   ['Purchase_Order_Lines'],
};
// The column the pre-existing write-back already used for scan counts.
var BS_SCANNED_COLUMN = 'scanned_qty';
var BS_CODE_MATCH_TAB = 'App_Code_Match';
var BS_LOCK_WAIT_MS = 30000;

// ── Router ──────────────────────────────────────────────────────────────────

/** Returns a ContentService output if `e` is one of this file's actions, else null. */
function barcodeStoreHandle_(e) {
  var payload;
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return null; // not JSON → not ours
  }
  var handlers = {
    get_vendor_shipment_data:   bsGetVendorShipmentData_,
    get_purchase_order_lines_raw: bsGetPurchaseOrderLines_,
    increment_scanned_quantity: bsIncrementScannedQuantity_,
    update_shipment_weights:    bsUpdateShipmentWeights_,
    update_shipment_drive_link: bsUpdateShipmentDriveLink_,
    get_code_matches:           bsGetCodeMatches_,
    set_code_match:             bsSetCodeMatch_,
    get_setting:                bsGetSetting_,
    set_setting:                bsSetSetting_,
  };
  var fn = payload && handlers[payload.action];
  if (!fn) return null;

  try {
    return bsJson_(Object.assign({ success: true }, fn(payload)));
  } catch (err) {
    return bsJson_({ success: false, error: String(err && err.message || err) });
  }
}

function bsJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ── Sheet helpers ───────────────────────────────────────────────────────────

function bsSpreadsheet_() {
  return BS_SPREADSHEET_ID ? SpreadsheetApp.openById(BS_SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

/** "Shipment ID" / "shipment_id" / "Shipment-Id" → "shipment_id" */
function bsNorm_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function bsFindSheet_(candidates) {
  var ss = bsSpreadsheet_();
  var sheets = ss.getSheets();
  var wanted = candidates.map(bsNorm_);
  for (var i = 0; i < sheets.length; i++) {
    if (wanted.indexOf(bsNorm_(sheets[i].getName())) !== -1) return sheets[i];
  }
  throw new Error('No tab named any of [' + candidates.join(', ') + ']. Tabs in this spreadsheet: ' +
    sheets.map(function (s) { return s.getName(); }).join(', '));
}

function bsCell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return v;
}

/** Header-name → 1-based column index. */
function bsHeaderMap_(sheet) {
  var lastCol = sheet.getLastColumn();
  var map = {};
  if (lastCol < 1) return map;
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var c = 0; c < headers.length; c++) {
    var key = bsNorm_(headers[c]);
    if (key && !map[key]) map[key] = c + 1;
  }
  return map;
}

/** Column for `name`, appending a new header cell at the end if it doesn't exist yet. */
function bsEnsureColumn_(sheet, name) {
  var map = bsHeaderMap_(sheet);
  var key = bsNorm_(name);
  if (map[key]) return map[key];
  var col = Math.max(sheet.getLastColumn(), 0) + 1;
  sheet.getRange(1, col).setValue(name);
  return col;
}

/** Whole tab → array of {normalizedHeader: value} objects (blank rows skipped). */
function bsReadObjects_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var keys = values[0].map(bsNorm_);
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var obj = {}, any = false;
    for (var c = 0; c < keys.length; c++) {
      if (!keys[c]) continue;
      var v = bsCell_(row[c]);
      if (v !== '' && v != null) any = true;
      obj[keys[c]] = v;
    }
    if (any) out.push(obj);
  }
  return out;
}

/** Last 1-based row whose key columns equal `wanted` (last-wins, like the app's dedupe). */
function bsFindRow_(sheet, colsByName, wanted) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var names = Object.keys(wanted);
  var cols = names.map(function (n) {
    var c = colsByName[bsNorm_(n)];
    if (!c) throw new Error('Tab "' + sheet.getName() + '" has no "' + n + '" column.');
    return sheet.getRange(2, c, lastRow - 1, 1).getValues();
  });
  for (var i = lastRow - 2; i >= 0; i--) {
    var ok = true;
    for (var k = 0; k < names.length; k++) {
      if (String(cols[k][i][0]).trim() !== String(wanted[names[k]]).trim()) { ok = false; break; }
    }
    if (ok) return i + 2;
  }
  return -1;
}

/**
 * The shipments project caches whole-sheet reads under "gsd_<tab name>" (see
 * invalidateSheetCache_ in its entry_points) and every writer there clears that key
 * after writing. Other apps sharing these sheets read through that cache, so do the
 * same — otherwise they'd keep showing pre-write values until the cache expires.
 * Removing a key that doesn't exist (e.g. in the master project) is harmless.
 */
function bsBustCache_(sheet) {
  // That cache is now split across several keys (see putChunkedCache_ in the
  // shipments project's entry_points.js), so removing the bare 'gsd_' key alone
  // would no longer clear it — go through invalidateSheetCache_ when this
  // project has it, and fall back to the bare key elsewhere.
  try {
    if (typeof invalidateSheetCache_ === 'function') invalidateSheetCache_(sheet.getName());
    else CacheService.getScriptCache().remove('gsd_' + sheet.getName());
  } catch (err) {}
}

function bsWithLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(BS_LOCK_WAIT_MS);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ── Shipment actions (Vendor_Shipment_* tabs) ───────────────────────────────

/** Purchase_Order_Lines rows (po_id, sku, ordered_qty, fulfilled_qty, unit_price_rmb, …) for the Receiving Sheet join. */
function bsGetPurchaseOrderLines_() {
  return { lines: bsReadObjects_(bsFindSheet_(BS_TABS.poLines)) };
}

function bsGetVendorShipmentData_() {
  return {
    batches:   bsReadObjects_(bsFindSheet_(BS_TABS.batches)),
    shipments: bsReadObjects_(bsFindSheet_(BS_TABS.shipments)),
    lines:     bsReadObjects_(bsFindSheet_(BS_TABS.lines)),
  };
}

/** { shipment_id, sku, delta? } → adds delta (default 1) to scanned_quantity atomically. */
function bsIncrementScannedQuantity_(p) {
  if (!p.shipment_id || !p.sku) throw new Error('shipment_id and sku are required.');
  var delta = p.delta == null ? 1 : Number(p.delta);
  return bsWithLock_(function () {
    var sheet = bsFindSheet_(BS_TABS.lines);
    var map = bsHeaderMap_(sheet);
    var row = bsFindRow_(sheet, map, { shipment_id: p.shipment_id, sku: p.sku });
    if (row === -1) throw new Error('Line not found: ' + p.shipment_id + ' / ' + p.sku);
    var col = bsEnsureColumn_(sheet, BS_SCANNED_COLUMN);
    var cell = sheet.getRange(row, col);
    var next = (Number(cell.getValue()) || 0) + delta;
    cell.setValue(next);
    bsBustCache_(sheet);
    return { scanned_quantity: next };
  });
}

function bsUpdateShipmentRow_(shipmentId, fields) {
  if (!shipmentId) throw new Error('shipment_id is required.');
  return bsWithLock_(function () {
    var sheet = bsFindSheet_(BS_TABS.shipments);
    var row = bsFindRow_(sheet, bsHeaderMap_(sheet), { shipment_id: shipmentId });
    if (row === -1) throw new Error('Shipment not found: ' + shipmentId);
    Object.keys(fields).forEach(function (name) {
      sheet.getRange(row, bsEnsureColumn_(sheet, name)).setValue(fields[name]);
    });
    bsBustCache_(sheet);
    return {};
  });
}

function bsUpdateShipmentWeights_(p) {
  var result = bsUpdateShipmentRow_(p.shipment_id, {
    listed_weight: Number(p.listed_weight),
    actual_weight: Number(p.actual_weight),
  });
  // Keep the batch's aggregated weight (CNF Agent Accounting's Air tab) in
  // sync at the moment a shipment's weight is actually confirmed, rather
  // than recomputed on every read — see syncBatchWeightAggregate_ in
  // accounting_logger.js. Guarded by typeof: this file is also pasted into
  // the separate Master Barcode Suite project, which has no
  // accounting_logger.js and never receives shipment-weight writes anyway.
  if (typeof syncBatchWeightAggregate_ === 'function') {
    try {
      var sheet = bsFindSheet_(BS_TABS.shipments);
      var map = bsHeaderMap_(sheet);
      var batchCol = map[bsNorm_('batch_id')];
      var row = bsFindRow_(sheet, map, { shipment_id: p.shipment_id });
      if (row !== -1 && batchCol) {
        syncBatchWeightAggregate_(String(sheet.getRange(row, batchCol).getValue() || '').trim());
      }
    } catch (e) {}
  }
  return result;
}

function bsUpdateShipmentDriveLink_(p) {
  return bsUpdateShipmentRow_(p.shipment_id, { drive_link: String(p.drive_link || '') });
}

// ── Production-order code-match actions ─────────────────────────────────────

function bsCodeMatchSheet_() {
  var ss = bsSpreadsheet_();
  var sheet = ss.getSheetByName(BS_CODE_MATCH_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(BS_CODE_MATCH_TAB);
    sheet.getRange(1, 1, 1, 5).setValues([['key', 'reference_code_original', 'sku', 'code_match', 'updated_at']]);
  }
  return sheet;
}

function bsGetCodeMatches_() {
  return {
    matches: bsReadObjects_(bsCodeMatchSheet_()).map(function (r) {
      return { reference_code_original: String(r.reference_code_original), sku: String(r.sku), code_match: r.code_match === true || String(r.code_match).toUpperCase() === 'TRUE' };
    }),
  };
}

function bsSetCodeMatch_(p) {
  if (!p.reference_code_original || !p.sku) throw new Error('reference_code_original and sku are required.');
  return bsWithLock_(function () {
    var sheet = bsCodeMatchSheet_();
    var key = p.reference_code_original + '::' + p.sku;
    var row = bsFindRow_(sheet, bsHeaderMap_(sheet), { key: key });
    var values = [key, p.reference_code_original, p.sku, !!p.code_match, new Date().toISOString()];
    if (row === -1) sheet.appendRow(values);
    else sheet.getRange(row, 1, 1, values.length).setValues([values]);
    return {};
  });
}

// ── Settings (Script Properties) ────────────────────────────────────────────

function bsGetSetting_(p) {
  var raw = PropertiesService.getScriptProperties().getProperty('barcode_setting_' + p.key);
  return { value: raw == null ? null : JSON.parse(raw) };
}

function bsSetSetting_(p) {
  if (!p.key) throw new Error('key is required.');
  PropertiesService.getScriptProperties().setProperty('barcode_setting_' + p.key, JSON.stringify(p.value));
  return {};
}
