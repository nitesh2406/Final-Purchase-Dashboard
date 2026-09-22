// =================================================================================
// VENDOR PORTAL — 22_vendor_portal.gs
//
// Serves the standalone template_vendor single-page portal.
// Entry points are registered in 0_entry_points.gs (doGet switch).
// This file adds NO new doGet / doPost — only helper functions prefixed vp*.
//
// =================================================================================


// ── Public API functions (called from 0_entry_points.gs) ─────────────────────

/**
 * GET ?action=get_vendor_ledger_filtered&vendorCode=QY&startDate=2024-01-01&endDate=2024-12-31
 * Returns VendorLedger rows for the given vendor and date range,
 * excluding the Transaction ID column.
 */
function vpGetLedger_(params) {
  try {
    const vendorCode = (params.vendorCode || '').toString().trim().toUpperCase();
    const startDate  = params.startDate ? new Date(params.startDate) : null;
    const endDate    = params.endDate   ? new Date(params.endDate)   : null;

    if (!vendorCode) return errorResponse_('vendorCode is required');

    const allRows = getSheetData_('VendorLedger');

    // startDate / endDate are already YYYY-MM-DD strings from the URL param
    const OUTPUT_COLS = ['vendor_code', 'Date', 'Particulars', 'ReferenceId', 'RMB', 'Running Balance'];

    const filtered = allRows
      .filter(function(row) {
        const code = String(row['vendor_code'] || '').trim().toUpperCase();
        if (code !== vendorCode) return false;

        // Compare as YYYY-MM-DD strings — no timezone issues
        const rowDateStr = vpDateString_(row['Date']);
        if (!rowDateStr) return true; // keep rows whose date can't be parsed
        if (params.startDate && rowDateStr < params.startDate) return false;
        if (params.endDate   && rowDateStr > params.endDate)   return false;
        return true;
      })
      .map(function(row) {
        const out = {};
        OUTPUT_COLS.forEach(function(col) {
          if (col === 'Date') {
            out[col] = vpDateString_(row[col]) || '';
          } else {
            const val = row[col];
            out[col] = val !== undefined && val !== null ? val : '';
          }
        });
        return out;
      });

    return successResponse_({ records: filtered, columns: OUTPUT_COLS });

  } catch (err) {
    Logger.log('vpGetLedger_ error: ' + err.message);
    return errorResponse_('vpGetLedger_: ' + err.message);
  }
}


// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Extract YYYY-MM-DD string from whatever the sheet stores.
 * Returns null only if the value is genuinely empty.
 * We compare strings (not Date objects) so timezone offsets are irrelevant.
 */
function vpDateString_(val) {
  if (!val && val !== 0) return null;

  // Apps Script returns Date objects for date-formatted cells
  if (val instanceof Date) {
    return vpFormatDate_(val);
  }

  var s = String(val).trim();
  if (!s) return null;

  // Already YYYY-MM-DD (possibly with time suffix)
  var isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[1] + '-' + isoMatch[2] + '-' + isoMatch[3];

  // DD/MM/YYYY HH:MM:SS  (the format shown in the sheet screenshot)
  var dmyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmyMatch) {
    return dmyMatch[3] + '-' + dmyMatch[2].padStart(2,'0') + '-' + dmyMatch[1].padStart(2,'0');
  }

  // MM/DD/YYYY (US format, defensive)
  var mdyMatch = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (mdyMatch) {
    return mdyMatch[3] + '-' + mdyMatch[1].padStart(2,'0') + '-' + mdyMatch[2].padStart(2,'0');
  }

  // ISO string from JSON cache: "2026-06-24T00:00:00.000Z" → already caught above
  return null;
}

function vpFormatDate_(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}


// ── Vendor config (approved vendor codes per portal vendor) ──────────────────

/**
 * GET ?action=get_vendor_config_list
 * Returns all vendor entries from template_vendor_config (for the admin link-generator page).
 */
function vpGetVendorConfigList_() {
  try {
    if (!vpTemplateVendorConfigSheetExists_()) return successResponse_({ vendors: [] });
    const rows = getSheetData_('template_vendor_config');
    const vendors = rows
      .filter(function(r) { return String(r['vendor_code'] || '').trim() !== ''; })
      .map(function(r) {
        var editable = [];
        try { editable = JSON.parse(String(r['editable_vendor'] || '[]')); } catch(_) {
          editable = String(r['editable_vendor'] || '').split(',').map(function(v){ return v.trim(); }).filter(Boolean);
        }
        const flag = String(r['is_active'] || '').trim().toUpperCase();
        return {
          vendor_code:     String(r['vendor_code'] || '').trim(),
          editable_vendor: editable,
          is_active:       flag === 'TRUE' || flag === 'YES' || flag === '1'
        };
      });
    return successResponse_({ vendors: vendors });
  } catch (err) {
    Logger.log('vpGetVendorConfigList_ error: ' + err.message);
    return errorResponse_('vpGetVendorConfigList_: ' + err.message);
  }
}

/**
 * GET ?action=get_vendor_config&vendorCode=KZ
 * Returns the approved_vendors array for the given vendor from template_vendor_config.
 * approved_vendors controls which vendor codes can appear in the portal tables
 * and in the ledger download selector.
 */
function vpGetVendorConfig_(vendorCode) {
  try {
    vendorCode = String(vendorCode || '').trim().toUpperCase();
    if (!vendorCode) return errorResponse_('vendorCode is required');

    if (!vpTemplateVendorConfigSheetExists_()) return errorResponse_('No config found for vendor: ' + vendorCode);
    const rows = getSheetData_('template_vendor_config');

    const row = rows.find(function(r) {
      return String(r['vendor_code'] || '').trim().toUpperCase() === vendorCode;
    });

    if (!row) return errorResponse_('No config found for vendor: ' + vendorCode);

    const flag = String(row['is_active'] || '').trim().toUpperCase();
    const active = flag === 'TRUE' || flag === 'YES' || flag === '1';
    if (!active) return errorResponse_('Vendor "' + vendorCode + '" is not active.');

    let editable = [];
    const raw = String(row['editable_vendor'] || '').trim();
    try {
      editable = JSON.parse(raw); // expect ["QY","DJJ"]
    } catch (_) {
      editable = raw.split(',').map(function(v) { return v.trim(); }).filter(Boolean);
    }

    return successResponse_({ editable_vendor: editable, vendor_code: vendorCode });
  } catch (err) {
    Logger.log('vpGetVendorConfig_ error: ' + err.message);
    return errorResponse_('vpGetVendorConfig_: ' + err.message);
  }
}

/**
 * Returns true if the template_vendor_config sheet already exists.
 * Never creates anything — safe to call from read-only GET routes so that
 * viewing the admin panel before any vendor has been added shows an empty
 * table instead of silently fabricating a sheet with seed data.
 */
function vpTemplateVendorConfigSheetExists_() {
  return !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName('template_vendor_config');
}

/**
 * Creates the template_vendor_config sheet (headers only, no seed rows) if
 * it doesn't exist, or migrates an existing sheet by adding portal_token
 * and last_accessed columns. Only call this from write paths (save/regenerate) —
 * never from read-only GET routes.
 */
function vpEnsureTemplateVendorConfigSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('template_vendor_config');

  if (!sheet) {
    sheet = ss.insertSheet('template_vendor_config');
    sheet.appendRow(['vendor_code', 'editable_vendor', 'is_active', 'portal_token', 'last_accessed']);
    var h = sheet.getRange(1, 1, 1, 5);
    h.setFontWeight('bold');
    h.setBackground('#1E293B');
    h.setFontColor('#FFFFFF');
    [140, 240, 100, 220, 160].forEach(function(w, i) { sheet.setColumnWidth(i + 1, w); });
    invalidateSheetCache_('template_vendor_config');
    Logger.log('template_vendor_config sheet created (empty).');
    return;
  }

  // Migrate: add portal_token and last_accessed if missing
  var numCols = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, numCols).getValues()[0].map(function(h) { return String(h).trim(); });
  var changed = false;

  if (headers.indexOf('portal_token') === -1) {
    numCols++;
    sheet.getRange(1, numCols).setValue('portal_token');
    sheet.setColumnWidth(numCols, 220);
    var lastRow = sheet.getLastRow();
    for (var i = 2; i <= lastRow; i++) {
      sheet.getRange(i, numCols).setValue(vpGenerateToken_());
    }
    headers.push('portal_token');
    changed = true;
    Logger.log('template_vendor_config: added portal_token column and generated tokens.');
  }

  if (headers.indexOf('last_accessed') === -1) {
    numCols++;
    sheet.getRange(1, numCols).setValue('last_accessed');
    sheet.setColumnWidth(numCols, 160);
    changed = true;
    Logger.log('template_vendor_config: added last_accessed column.');
  }

  if (changed) invalidateSheetCache_('template_vendor_config');
}


// ── Vendor entry submission ───────────────────────────────────────────────────

/**
 * POST { action: 'submit_vendor_entries', vendorCode, purchaseRows, paymentRows }
 * Appends rows to review_purchase_template and review_payment_template sheets.
 * submitted_by = the portal vendor (from ?v= URL param), vendor_code = column value filled by vendor.
 */
function vpSubmitEntries_(payload) {
  try {
    const submittedBy  = String(payload.vendorCode || '').trim();
    const purchaseRows = Array.isArray(payload.purchaseRows) ? payload.purchaseRows : [];
    const paymentRows  = Array.isArray(payload.paymentRows)  ? payload.paymentRows  : [];
    const submittedAt  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

    if (!purchaseRows.length && !paymentRows.length) {
      return errorResponse_('No data to submit.');
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (purchaseRows.length) {
      vpEnsurePurchaseSheet_();
      const sheet = ss.getSheetByName('review_purchase_template');
      purchaseRows.forEach(function(row) {
        sheet.appendRow([
          submittedAt,
          submittedBy,
          String(row.date        || ''),
          String(row.invoice_id  || ''),
          String(row.vendor_code || ''),
          row.amount_rmb !== '' ? parseFloat(row.amount_rmb) || 0 : ''
        ]);
      });
      invalidateSheetCache_('review_purchase_template');
    }

    if (paymentRows.length) {
      vpEnsurePaymentSheet_();
      const sheet = ss.getSheetByName('review_payment_template');
      paymentRows.forEach(function(row) {
        sheet.appendRow([
          submittedAt,
          submittedBy,
          String(row.date        || ''),
          String(row.vendor_code || ''),
          row.amount_rmb !== '' ? parseFloat(row.amount_rmb) || 0 : ''
        ]);
      });
      invalidateSheetCache_('review_payment_template');
    }

    return successResponse_({
      purchaseCount: purchaseRows.length,
      paymentCount:  paymentRows.length,
      message: 'Entries submitted successfully.'
    });

  } catch (err) {
    Logger.log('vpSubmitEntries_ error: ' + err.message);
    return errorResponse_('vpSubmitEntries_: ' + err.message);
  }
}

function vpEnsurePurchaseSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName('review_purchase_template')) return;

  const sheet = ss.insertSheet('review_purchase_template');
  sheet.appendRow(['submitted_at', 'submitted_by', 'purchase_date', 'invoice_id', 'vendor_code', 'amount_rmb']);

  const header = sheet.getRange(1, 1, 1, 6);
  header.setFontWeight('bold');
  header.setBackground('#1E293B');
  header.setFontColor('#FFFFFF');
  [160, 140, 120, 160, 120, 120].forEach(function(w, i) { sheet.setColumnWidth(i + 1, w); });

  invalidateSheetCache_('review_purchase_template');
  Logger.log('review_purchase_template sheet created.');
}

function vpEnsurePaymentSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName('review_payment_template')) return;

  const sheet = ss.insertSheet('review_payment_template');
  sheet.appendRow(['submitted_at', 'submitted_by', 'payment_date', 'vendor_code', 'amount_rmb']);

  const header = sheet.getRange(1, 1, 1, 5);
  header.setFontWeight('bold');
  header.setBackground('#1E293B');
  header.setFontColor('#FFFFFF');
  [160, 140, 120, 120, 120].forEach(function(w, i) { sheet.setColumnWidth(i + 1, w); });

  invalidateSheetCache_('review_payment_template');
  Logger.log('review_payment_template sheet created.');
}


// ── Vendor Access Management (admin panel) ────────────────────────────────────

/**
 * GET ?action=get_vendor_access_list
 * Returns all template_vendor_config rows for the admin panel table.
 */
function vpGetVendorAccessList_() {
  try {
    if (!vpTemplateVendorConfigSheetExists_()) return successResponse_({ vendors: [] });
    const rows = getSheetData_('template_vendor_config');
    const vendors = rows
      .filter(function(r) { return String(r['vendor_code'] || '').trim() !== ''; })
      .map(function(r) {
        var editable = [];
        try { editable = JSON.parse(String(r['editable_vendor'] || '[]')); } catch(_) {
          editable = String(r['editable_vendor'] || '').split(',').map(function(v) { return v.trim(); }).filter(Boolean);
        }
        const flag = String(r['is_active'] || '').trim().toUpperCase();
        return {
          vendor_code:     String(r['vendor_code']    || '').trim(),
          editable_vendor: editable,
          is_active:       flag === 'TRUE' || flag === 'YES' || flag === '1',
          portal_token:    String(r['portal_token']   || '').trim(),
          last_accessed:   String(r['last_accessed']  || '').trim()
        };
      });
    return successResponse_({ vendors: vendors });
  } catch (err) {
    Logger.log('vpGetVendorAccessList_ error: ' + err.message);
    return errorResponse_('vpGetVendorAccessList_: ' + err.message);
  }
}


/**
 * POST { action: 'save_vendor_access', vendor_code, editable_vendor, is_active }
 * Creates a new row (with auto-generated token) or updates editable_vendor / is_active
 * for an existing row. Never overwrites portal_token or last_accessed on update.
 */
function vpSaveVendorAccess_(payload) {
  try {
    const vendorCode = String(payload.vendor_code || '').trim().toUpperCase();
    if (!vendorCode) return errorResponse_('vendor_code is required.');

    var editable = payload.editable_vendor;
    if (typeof editable === 'string') {
      try { editable = JSON.parse(editable); } catch(_) {
        editable = editable.split(',').map(function(v) { return v.trim(); }).filter(Boolean);
      }
    }
    if (!Array.isArray(editable) || editable.length === 0) {
      return errorResponse_('At least one editable vendor must be selected.');
    }

    vpEnsureTemplateVendorConfigSheet_();
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('template_vendor_config');
    const numCols = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, numCols).getValues()[0].map(function(h) { return String(h).trim(); });
    const ci = {};
    headers.forEach(function(h, i) { ci[h] = i + 1; }); // 1-based column index

    const isActive  = payload.is_active === true || String(payload.is_active || '').toUpperCase() === 'TRUE';
    const editJson  = JSON.stringify(editable);

    // Find existing row
    const allData = sheet.getDataRange().getValues();
    var existingRow = -1;
    for (var i = 1; i < allData.length; i++) {
      if (String(allData[i][(ci['vendor_code'] || 1) - 1] || '').trim().toUpperCase() === vendorCode) {
        existingRow = i + 1;
        break;
      }
    }

    if (existingRow > 0) {
      if (ci['editable_vendor']) sheet.getRange(existingRow, ci['editable_vendor']).setValue(editJson);
      if (ci['is_active'])       sheet.getRange(existingRow, ci['is_active']).setValue(isActive ? 'TRUE' : 'FALSE');
    } else {
      const token  = vpGenerateUniqueToken_();
      const newRow = headers.map(function(h) {
        switch (h) {
          case 'vendor_code':     return vendorCode;
          case 'editable_vendor': return editJson;
          case 'is_active':       return isActive ? 'TRUE' : 'FALSE';
          case 'portal_token':    return token;
          case 'last_accessed':   return '';
          default:                return '';
        }
      });
      sheet.appendRow(newRow);
    }

    invalidateSheetCache_('template_vendor_config');
    return successResponse_({ message: 'Vendor access saved.', vendor_code: vendorCode });
  } catch (err) {
    Logger.log('vpSaveVendorAccess_ error: ' + err.message);
    return errorResponse_('vpSaveVendorAccess_: ' + err.message);
  }
}


/**
 * POST { action: 'regenerate_vendor_token', vendor_code }
 * Generates a new unique portal token for the vendor, invalidating the old URL.
 */
function vpRegenerateToken_(payload) {
  try {
    const vendorCode = String(payload.vendor_code || '').trim().toUpperCase();
    if (!vendorCode) return errorResponse_('vendor_code is required.');

    vpEnsureTemplateVendorConfigSheet_();
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('template_vendor_config');
    const numCols = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, numCols).getValues()[0].map(function(h) { return String(h).trim(); });
    const ci = {};
    headers.forEach(function(h, i) { ci[h] = i + 1; });

    if (!ci['portal_token']) return errorResponse_('portal_token column not found in sheet.');

    const allData = sheet.getDataRange().getValues();
    var targetRow = -1;
    for (var i = 1; i < allData.length; i++) {
      if (String(allData[i][ci['vendor_code'] - 1] || '').trim().toUpperCase() === vendorCode) {
        targetRow = i + 1;
        break;
      }
    }
    if (targetRow < 0) return errorResponse_('Vendor "' + vendorCode + '" not found.');

    const newToken = vpGenerateUniqueToken_();
    sheet.getRange(targetRow, ci['portal_token']).setValue(newToken);
    invalidateSheetCache_('template_vendor_config');

    return successResponse_({ vendor_code: vendorCode, portal_token: newToken });
  } catch (err) {
    Logger.log('vpRegenerateToken_ error: ' + err.message);
    return errorResponse_('vpRegenerateToken_: ' + err.message);
  }
}


/**
 * GET ?action=get_vendor_by_token&token=XXX
 * Resolves a portal token to vendor config; updates last_accessed as a side effect.
 * Called by index.html on portal load.
 */
function vpGetVendorByToken_(token) {
  try {
    token = String(token || '').trim();
    if (!token) return errorResponse_('token is required.');

    if (!vpTemplateVendorConfigSheetExists_()) return errorResponse_('Invalid or expired portal link.');
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('template_vendor_config');
    const numCols = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, numCols).getValues()[0].map(function(h) { return String(h).trim(); });
    const ci = {};
    headers.forEach(function(h, i) { ci[h] = i + 1; });

    if (!ci['portal_token']) return errorResponse_('portal_token column not found.');

    // Read sheet directly — bypass cache to get current token values
    const allData = sheet.getDataRange().getValues();
    var targetRow = -1;
    var rowData   = null;
    for (var i = 1; i < allData.length; i++) {
      if (String(allData[i][ci['portal_token'] - 1] || '').trim() === token) {
        targetRow = i + 1;
        rowData   = allData[i];
        break;
      }
    }

    if (targetRow < 0) return errorResponse_('Invalid or expired portal link.');

    const flag   = String(rowData[ci['is_active'] - 1] || '').trim().toUpperCase();
    const active = flag === 'TRUE' || flag === 'YES' || flag === '1';
    if (!active) return errorResponse_('This portal link has been deactivated. Please contact your administrator.');

    // Update last_accessed
    if (ci['last_accessed']) {
      const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
      sheet.getRange(targetRow, ci['last_accessed']).setValue(ts);
      invalidateSheetCache_('template_vendor_config');
    }

    var editable = [];
    try { editable = JSON.parse(String(rowData[ci['editable_vendor'] - 1] || '[]')); } catch(_) {
      editable = String(rowData[ci['editable_vendor'] - 1] || '').split(',').map(function(v) { return v.trim(); }).filter(Boolean);
    }

    return successResponse_({
      vendor_code:     String(rowData[ci['vendor_code'] - 1] || '').trim(),
      editable_vendor: editable
    });
  } catch (err) {
    Logger.log('vpGetVendorByToken_ error: ' + err.message);
    return errorResponse_('vpGetVendorByToken_: ' + err.message);
  }
}


// ── Token helpers ─────────────────────────────────────────────────────────────

/** Generates a 64-char hex token using SHA-256 of two UUIDs + timestamp. */
function vpGenerateToken_() {
  var seed  = Utilities.getUuid() + Date.now().toString() + Utilities.getUuid();
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed);
  return bytes.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

/** Generates a token guaranteed unique within template_vendor_config. */
function vpGenerateUniqueToken_() {
  for (var attempt = 0; attempt < 10; attempt++) {
    var token = vpGenerateToken_();
    var rows  = getSheetData_('template_vendor_config');
    var clash = rows.some(function(r) { return String(r['portal_token'] || '').trim() === token; });
    if (!clash) return token;
  }
  throw new Error('Could not generate a unique token after 10 attempts.');
}

