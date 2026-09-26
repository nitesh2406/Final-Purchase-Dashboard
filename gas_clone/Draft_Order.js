const SHEET_NAMES = {
  DRAFT_ORDERS: 'Draft_Orders',
  DRAFT_ORDER_LINES: 'Draft_Order_Lines',
  SKU_CUSTOMIZATION_MASTER: 'SKU_Customization_Master',
  EE_PRODUCT_MASTER: 'EE Product Master',
  VENDOR_MASTERS: 'Vendor Masters',


   // 🔹 NEW (PO Flow)
  PURCHASE_ORDERS: 'Purchase_Orders',
  PURCHASE_ORDER_LINES: 'Purchase_Order_Lines',
  PO_EMAIL_LOG: 'PO_Email_Log',
  VENDOR_SHIPMENTS: 'Vendor_Shipments',          
  VENDOR_SHIPMENT_LINES: 'Vendor_Shipment_Lines',
  BATCHES: 'Batches'                              
};

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`Sheet not found: ${name}`);
  return sheet;
}


function getHeaderMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, i) => {
    const key = String(h || '').trim();
    if (key) map[key] = i; // 0-based index
  });
  return map;
}



function generateDraftId_() {
  const sheet = getSheet_(SHEET_NAMES.DRAFT_ORDERS);
  const header = getHeaderMap_(sheet);

  if (header.draft_id === undefined) {
    throw new Error(`Missing required column 'draft_id' in sheet ${SHEET_NAMES.DRAFT_ORDERS}`);
  }

  const year = String(new Date().getFullYear()).slice(-2); // "25"
  const prefix = `DRAFT-${year}-`;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return `${prefix}001`; // only header exists

  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  let maxCounter = 0;
  const col = header.draft_id;

  for (let i = 0; i < data.length; i++) {
    const draftId = data[i][col];
    if (typeof draftId === 'string' && draftId.startsWith(prefix)) {
      const counter = parseInt(draftId.slice(prefix.length), 10);
      if (!isNaN(counter)) maxCounter = Math.max(maxCounter, counter);
    }
  }

  const nextCounter = String(maxCounter + 1).padStart(3, '0');
  return `${prefix}${nextCounter}`;
}

// Builds the row array without writing it — for callers that need to batch
// many rows into one setValues() call instead of one appendRow() per row.
function buildRowFromObject_(headerMap, obj) {
  const row = new Array(Object.keys(headerMap).length).fill('');
  for (const key in obj) {
    if (headerMap[key] !== undefined) {
      row[headerMap[key]] = obj[key];
    }
  }
  return row;
}

function appendRowFromObject_(sheet, headerMap, obj) {
  sheet.appendRow(buildRowFromObject_(headerMap, obj));
}

// Appends many rows with one setValues(). Rows are padded to the sheet's
// full width so the block is rectangular even if the header has gaps.
function appendRowsFromObjects_(sheet, headerMap, objs) {
  if (!objs.length) return;
  const width = sheet.getLastColumn();
  const rows = objs.map(obj => {
    const row = new Array(width).fill('');
    for (const key in obj) {
      if (headerMap[key] !== undefined) row[headerMap[key]] = obj[key];
    }
    return row;
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, width).setValues(rows);
}

// Groups sorted 0-based data indexes into runs of adjacent rows.
function indexRuns_(indexes) {
  const sorted = Array.from(new Set(indexes)).sort((a, b) => a - b);
  const runs = [];
  sorted.forEach(i => {
    const last = runs[runs.length - 1];
    if (last && i === last.start + last.count) last.count++;
    else runs.push({ start: i, count: 1 });
  });
  return runs;
}

// Writes back rows of `data` (0-based indexes, header = 0) that were changed
// in memory — one setValues per run of adjacent rows.
function writeRowRuns_(sheet, data, indexes) {
  indexRuns_(indexes).forEach(run => {
    const block = data.slice(run.start, run.start + run.count);
    sheet.getRange(run.start + 1, 1, block.length, block[0].length).setValues(block);
  });
}

// Deletes rows by 0-based data index, bottom-up so earlier indexes stay valid.
function deleteRowRuns_(sheet, indexes) {
  indexRuns_(indexes).reverse().forEach(run => {
    sheet.deleteRows(run.start + 1, run.count);
  });
}

// Serialises every write that creates drafts, changes their lines or turns
// them into POs: draft/PO ids are "highest existing + 1" and a save replaces
// the draft's line set, so overlapping requests could otherwise mint the
// same id or order the same lines twice.
function withDraftLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Another draft or PO update is in progress. Please try again in a moment.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// Draft_Orders.status, normalised. apiSubmitDraft_ used to write
// PARTIALLY_SUBMITTED while cancel checked for 'PARTIALLY SUBMITTED', so
// both spellings can be in the sheet.
function draftStatusKey_(status) {
  return String(status || '').trim().toUpperCase().replace(/\s+/g, '_');
}

function isDraftEditable_(status) {
  const key = draftStatusKey_(status);
  return key === 'DRAFT' || key === 'PARTIALLY_SUBMITTED';
}

// vendor_code → po_id for every PO already created from this draft. Those
// vendors' lines went out as they were and are frozen; the rest of the
// draft stays editable and can be submitted later.
function getSubmittedVendorsForDraft_(draftId) {
  const sheet = getSheet_(SHEET_NAMES.PURCHASE_ORDERS);
  const header = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][header.draft_id] || '').trim() !== draftId) continue;
    const vendor = String(data[i][header.vendor_code] || '').trim();
    if (vendor && !map[vendor]) map[vendor] = String(data[i][header.po_id] || '');
  }
  return map;
}

// EE Product Master fields a draft line needs. unit_price is RMB_Price, the
// vendor's RMB purchase price: it becomes Purchase_Order_Lines.unit_price_rmb
// and Vendor Shipments compares it against RMB invoices. Cost is the INR
// landed cost (duty, freight, margin; roughly 18x RMB) and is only passed on
// as landed_cost_inr for the editor's ₹ estimate. Reading Cost into
// unit_price was fixed on 2026-08-17 and then lost to a stale push.
function productFromMasterRow_(row, header) {
  return {
    sku_name: row[header['Product Name']] || '',
    unit_price: Number(row[header.RMB_Price]) || 0,
    landed_cost_inr: Number(row[header.Cost]) || 0
  };
}

// One read of the EE Product Master → { sku: product } (first row wins).
function loadDraftProductMap_() {
  const sheet = getSheet_(SHEET_NAMES.EE_PRODUCT_MASTER);
  const header = getHeaderMap_(sheet);
  if (header.RMB_Price === undefined) {
    throw new Error("EE Product Master has no 'RMB_Price' column, so draft lines can't be priced");
  }
  const data = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const sku = String(data[i][header.SKU] || '').trim();
    if (sku && !map[sku]) map[sku] = productFromMasterRow_(data[i], header);
  }
  return map;
}

function getProductBySku_(sku) {
  return loadDraftProductMap_()[String(sku || '').trim()] || null;
}

const DEFAULT_CUSTOMIZATION_ = {
  custom_logo: false,
  custom_packaging: false,
  solving_manual: false,
  opp_wrap: false,
  custom_remarks: '',
  customization_files: ''
};

// One read of SKU_Customization_Master → { sku: customization defaults }.
function loadCustomizationDefaultsMap_() {
  const sheet = getSheet_(SHEET_NAMES.SKU_CUSTOMIZATION_MASTER);
  const header = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const sku = String(data[i][header.sku] || '').trim();
    if (!sku || map[sku]) continue;
    map[sku] = {
      custom_logo: data[i][header.custom_logo],
      custom_packaging: data[i][header.custom_packaging],
      solving_manual: data[i][header.solving_manual],
      opp_wrap: data[i][header.opp_wrap],
      custom_remarks: data[i][header.custom_remarks],
      customization_files: data[i][header.customization_files]
    };
  }
  return map;
}

function getCustomizationDefaults_(sku) {
  return loadCustomizationDefaultsMap_()[String(sku || '').trim()] || Object.assign({}, DEFAULT_CUSTOMIZATION_);
}

// Customization columns from an editor line, which may use either the DB
// names (custom_logo, …) or the UI names (logo: 'Yes' | 'No', …).
function customizationFromLine_(line) {
  const pick = (a, b) => (a !== undefined ? a : b);
  const files = pick(line.customization_files, line.files);
  return {
    custom_logo: parseCustomizationValue_(pick(line.custom_logo, line.logo)),
    custom_packaging: parseCustomizationValue_(pick(line.custom_packaging, line.packaging)),
    solving_manual: parseCustomizationValue_(pick(line.solving_manual, line.manual)),
    opp_wrap: parseCustomizationValue_(pick(line.opp_wrap, line.wrap)),
    custom_remarks: String(pick(line.custom_remarks, line.remarks) || ''),
    customization_files: Array.isArray(files) ? files.join(', ') : String(files || '')
  };
}

function apiCreateDraftFromForecast(payload) {
  if (!payload || !Array.isArray(payload.skus)) {
    throw new Error('Invalid payload: skus missing');
  }

   // 🔄 Sync Drive links before reading customization data
  syncCustomizationDriveLinks();

  const mode = String(payload.mode || '').toUpperCase();
  const products = loadDraftProductMap_();
  const customizations = loadCustomizationDefaultsMap_();

  // Validate every SKU before writing anything — this used to throw on the
  // first unknown SKU after the header and earlier lines were already written.
  const missing = payload.skus.map(s => String(s.sku || '').trim()).filter(sku => !products[sku]);
  if (missing.length) {
    throw new Error(`SKU not found in Product Master: ${missing.join(', ')}`);
  }

  return withDraftLock_(() => {
    const draftSheet = getSheet_(SHEET_NAMES.DRAFT_ORDERS);
    const header = getHeaderMap_(draftSheet);

    const draftId = generateDraftId_();
    const now = new Date();
    const user = Session.getActiveUser().getEmail();

    appendRowFromObject_(draftSheet, header, {
      draft_id: draftId,
      status: 'DRAFT',
      planned_mode: mode,
      forecast_run_id: payload.forecastRunId || '',
      total_skus: payload.skus.length,
      total_qty: payload.skus.reduce((sum, s) => sum + Number(s.qty || 0), 0),
      created_by: user,
      created_at: now,
      updated_at: now
    });

    const lineSheet = getSheet_(SHEET_NAMES.DRAFT_ORDER_LINES);
    const lineHeader = getHeaderMap_(lineSheet);

    appendRowsFromObjects_(lineSheet, lineHeader, payload.skus.map(s => {
      const sku = String(s.sku).trim();
      const product = products[sku];
      return Object.assign({
        line_id: Utilities.getUuid(),
        draft_id: draftId,
        sku: sku,
        sku_name: product.sku_name,
        qty: Number(s.qty),
        vendor_code: resolveVendorForDraftLine_(sku, mode, String(s.vendor || '')),
        unit_price: product.unit_price,
        source: 'FORECAST',
        created_at: now,
        updated_at: now,
        customization_updated_at: now
      }, customizations[sku] || DEFAULT_CUSTOMIZATION_);
    }));

    return {
      status: 'success',
      draftId
    };
  });
}

function resolveVendorForDraftLine_(sku, mode, payloadVendor) {
  // AIR default — always Puzzle Wholesale
  if (mode === 'AIR') {
    return 'PW';
  }

  // SEA — use vendor from forecast payload (Supplier_Code from Product Master)
  if (payloadVendor && payloadVendor.trim() !== '' && payloadVendor.trim() !== 'N/A') {
    return payloadVendor.trim();
  }

  // SEA fallback — no vendor found
  return '';
}


function apiGetDraftById(draftId) {
  if (!draftId) {
    throw new Error('draftId is required');
  }

  // 1️⃣ Fetch draft header
  const draftSheet = getSheet_(SHEET_NAMES.DRAFT_ORDERS);
  const draftHeader = getHeaderMap_(draftSheet);
  const draftData = draftSheet.getDataRange().getValues();

  let draftRow = null;

  for (let i = 1; i < draftData.length; i++) {
    if (String(draftData[i][draftHeader.draft_id]).trim() === draftId) {
      draftRow = draftData[i];
      break;
    }
  }

  if (!draftRow) {
    throw new Error(`Draft not found: ${draftId}`);
  }

  // 2️⃣ Build raw draft object from sheet
  const draft = {};
  Object.keys(draftHeader).forEach(key => {
    draft[key] = draftRow[draftHeader[key]];
  });

  // ✅ 3️⃣ NORMALIZATION FOR UI (ADD THIS BLOCK)
  draft.id = draft.draft_id; // UI uses `draft.id`
  draft.total_items = Number(draft.total_qty || 0); // UI expects total_items

  // Normalize status casing (and the two spellings of partially submitted)
  const statusKey = draftStatusKey_(draft.status);
  draft.status = statusKey === 'DRAFT' ? 'Draft' : statusKey;

  // Vendors that already have a PO from this draft — the editor locks them.
  draft.submittedVendors = getSubmittedVendorsForDraft_(draftId);


  // 4️⃣ Fetch draft lines
  const lineSheet = getSheet_(SHEET_NAMES.DRAFT_ORDER_LINES);
  const lineHeader = getHeaderMap_(lineSheet);
  const lineData = lineSheet.getDataRange().getValues();
  const products = loadDraftProductMap_();

  const lines = [];

  for (let i = 1; i < lineData.length; i++) {
    if (String(lineData[i][lineHeader.draft_id]).trim() === draftId) {
      const line = {};
      Object.keys(lineHeader).forEach(key => {
        line[key] = lineData[i][lineHeader[key]];
      });

    // ✅ UI NORMALIZATION (place right before lines.push(line))

// 1) Vendor + item name (Edit table expects these exact keys)
line.vendor = line.vendor_code || '';
line.item_name = line.sku_name || '';

// 2) Convert customization values to UI format: 'Yes' | 'No'
const yesNo_ = (v) => (v === true || String(v).toLowerCase() === 'yes') ? 'Yes' : 'No';

line.logo = yesNo_(line.custom_logo);
line.packaging = yesNo_(line.custom_packaging);
line.manual = yesNo_(line.solving_manual);
line.wrap = yesNo_(line.opp_wrap);

// 3) Remarks + files
line.remarks = line.custom_remarks || '';

// UI expects files:any[]; your sheet stores string link → make it array
const filesRaw = line.customization_files || '';
line.files = filesRaw ? [filesRaw] : [];

// 4) Current INR landed cost per unit, for the editor's ₹ estimate only
const product = products[String(line.sku || '').trim()];
line.landed_cost_inr = product ? product.landed_cost_inr : 0;

      lines.push(line);
    }
  }

  // ✅ Ensure draft.vendors is accurate so DraftOrdersTable doesn't lose it after Edit fetch
const vendorSet = {};
lines.forEach(l => {
  const v = String(l.vendor_code || l.vendor || '').trim();
  if (v) vendorSet[v] = true;
});
draft.vendors = Object.keys(vendorSet).sort();




  // 5️⃣ Return response
  return {
    status: 'success',
    draft,
    lines
  };
}

function apiGetDraftOrders() {
  const draftSheet = getSheet_(SHEET_NAMES.DRAFT_ORDERS);
  const dh = getHeaderMap_(draftSheet);
  const draftRows = draftSheet.getDataRange().getValues();

  // Build vendors per draft_id (unique vendor_code list)
  const lineSheet = getSheet_(SHEET_NAMES.DRAFT_ORDER_LINES);
  const lh = getHeaderMap_(lineSheet);
  const lineRows = lineSheet.getDataRange().getValues();

  const vendorsByDraft = {};
  for (let i = 1; i < lineRows.length; i++) {
    const draftId = String(lineRows[i][lh.draft_id] || '').trim();
    if (!draftId) continue;
    const v = String(lineRows[i][lh.vendor_code] || '').trim();
    if (!vendorsByDraft[draftId]) vendorsByDraft[draftId] = new Set();
    if (v) vendorsByDraft[draftId].add(v);
  }

  const normalizeStatus_ = (s) => {
    const v = draftStatusKey_(s);
    if (v === 'DRAFT') return 'Draft';
    if (v === 'CANCELLED') return 'Cancelled';
    if (v === 'ORDER_PLACED') return 'Order Placed';
    if (v === 'PARTIALLY_SUBMITTED') return 'PARTIALLY_SUBMITTED';
    // fallback: keep original (but Title Case-ish)
    return s || 'Draft';
  };

  const drafts = [];

  for (let i = 1; i < draftRows.length; i++) {
    const row = draftRows[i];
    const draft_id = String(row[dh.draft_id] || '').trim();
    if (!draft_id) continue;

    const total_qty = Number(row[dh.total_qty] || 0);

    drafts.push({
      // ✅ UI expects these:
      id: draft_id,
      vendors: Array.from(vendorsByDraft[draft_id] || []).sort(),
      total_items: total_qty,

      // Keep your canonical fields too (harmless, useful)
      draft_id,
      status: normalizeStatus_(row[dh.status]),
      planned_mode: row[dh.planned_mode],
      forecast_run_id: row[dh.forecast_run_id],
      total_skus: Number(row[dh.total_skus] || 0),
      total_qty: total_qty,
      created_by: row[dh.created_by],
      created_at: row[dh.created_at],
      updated_at: row[dh.updated_at],

      // UI sorts by draft_date sometimes; it falls back to created_at anyway
      draft_date: row[dh.draft_date] || row[dh.created_at],
    });
  }

  return { status: 'success', drafts };
}


function apiCancelDraft(id) {
  if (!id) throw new Error('id is required');
  return withDraftLock_(() => cancelDraftUnlocked_(String(id).trim()));
}

function cancelDraftUnlocked_(id) {
  const draftSheet = getSheet_(SHEET_NAMES.DRAFT_ORDERS);
  const draftHeader = getHeaderMap_(draftSheet);
  const draftData = draftSheet.getDataRange().getValues();

  let currentStatus = null;
  for (let i = 1; i < draftData.length; i++) {
    if (String(draftData[i][draftHeader.draft_id]).trim() === id) {
      currentStatus = draftData[i][draftHeader.status];
      break;
    }
  }
  if (currentStatus === null) throw new Error('Draft not found: ' + id);
  if (!isDraftEditable_(currentStatus)) {
    throw new Error('Only drafts in DRAFT or PARTIALLY_SUBMITTED status can be cancelled (current: ' + draftStatusKey_(currentStatus) + ')');
  }

  const now = new Date();
  updateRowByKey_(draftSheet, draftHeader, 'draft_id', id, {
    status: 'CANCELLED',
    updated_at: now
  });

  logAuditEvent_('DRAFT_ORDER', 'CANCEL', id, 'Draft cancelled', 'SUCCESS', Session.getActiveUser().getEmail());

  return { success: true, id, message: 'Draft cancelled successfully' };
}

function apiBulkCancelDrafts(ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('ids array is required');

  const cancelled = [];
  const failed = [];
  withDraftLock_(() => {
    ids.forEach(id => {
      try {
        cancelDraftUnlocked_(String(id).trim());
        cancelled.push(id);
      } catch (err) {
        failed.push({ id, error: err.message });
      }
    });
  });

  return { success: true, cancelled, failed };
}

// Copies a draft's lines into a new DRAFT. Prices are re-read from the EE
// Product Master rather than copied: older drafts carry INR landed cost in
// unit_price (see productFromMasterRow_), and a stale price must not flow
// into new POs. Zero-quantity lines are dropped.
function apiDuplicateDraft(id) {
  if (!id) throw new Error('id is required');

  const source = apiGetDraftById(String(id).trim()); // throws if not found; also gives us normalized lines
  const sourceLines = source.lines.filter(l => Number(l.qty || 0) > 0);
  if (sourceLines.length === 0) throw new Error('Draft ' + id + ' has no lines with a quantity to copy');
  const products = loadDraftProductMap_();

  return withDraftLock_(() => {
    const newDraftId = generateDraftId_();
    const now = new Date();
    const user = Session.getActiveUser().getEmail();

    const draftSheet = getSheet_(SHEET_NAMES.DRAFT_ORDERS);
    const draftHeader = getHeaderMap_(draftSheet);
    const totalSkus = new Set(sourceLines.map(l => String(l.sku))).size;
    const totalQty = sourceLines.reduce((sum, l) => sum + Number(l.qty || 0), 0);

    appendRowFromObject_(draftSheet, draftHeader, {
      draft_id: newDraftId,
      status: 'DRAFT',
      planned_mode: source.draft.planned_mode || '',
      forecast_run_id: '', // duplicates start fresh, not tied to the original forecast run
      total_skus: totalSkus,
      total_qty: totalQty,
      created_by: user,
      created_at: now,
      updated_at: now
    });

    const lineSheet = getSheet_(SHEET_NAMES.DRAFT_ORDER_LINES);
    const lineHeader = getHeaderMap_(lineSheet);

    appendRowsFromObjects_(lineSheet, lineHeader, sourceLines.map(l => {
      const product = products[String(l.sku || '').trim()];
      return Object.assign({
        line_id: Utilities.getUuid(),
        draft_id: newDraftId,
        sku: l.sku,
        sku_name: (product && product.sku_name) || l.sku_name || '',
        qty: Number(l.qty || 0),
        vendor_code: l.vendor_code || '',
        unit_price: product ? product.unit_price : 0,
        source: 'DUPLICATE',
        created_at: now,
        updated_at: now,
        customization_updated_at: now
      }, customizationFromLine_({
        custom_logo: l.custom_logo,
        custom_packaging: l.custom_packaging,
        solving_manual: l.solving_manual,
        opp_wrap: l.opp_wrap,
        custom_remarks: l.custom_remarks,
        customization_files: l.customization_files
      }));
    }));

    logAuditEvent_('DRAFT_ORDER', 'DUPLICATE', newDraftId, 'Duplicated from ' + id, 'SUCCESS', user);

    // Shape matches apiGetDraftOrders()'s per-draft object — DraftOrdersTable.tsx
    // prepends this directly into its drafts list.
    const vendors = Array.from(new Set(sourceLines.map(l => String(l.vendor_code || '').trim()).filter(Boolean))).sort();
    return {
      success: true,
      newDraft: {
        id: newDraftId,
        vendors,
        total_items: totalQty,
        draft_id: newDraftId,
        status: 'Draft',
        planned_mode: source.draft.planned_mode || '',
        forecast_run_id: '',
        total_skus: totalSkus,
        total_qty: totalQty,
        created_by: user,
        created_at: now,
        updated_at: now,
        draft_date: now
      }
    };
  });
}

function updateRowByKey_(sheet, headerMap, keyColName, keyValue, updates) {
  const data = sheet.getDataRange().getValues();
  const keyCol = headerMap[keyColName];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][keyCol]).trim() === String(keyValue)) {
      Object.keys(updates).forEach(k => {
        if (headerMap[k] !== undefined) {
          data[i][headerMap[k]] = updates[k];
        }
      });
      sheet.getRange(i + 1, 1, 1, data[0].length).setValues([data[i]]);
      return true;
    }
  }
  return false;
}

// Saves the editor's full line set for a draft. The payload is the whole
// draft, not a patch:
//  - lines with a line_id are updated (qty, vendor, customization);
//  - lines without one are added, priced from the EE Product Master;
//  - lines of this draft missing from the payload are DELETED — this used
//    to be skipped, so a line removed in the editor stayed in the sheet and
//    was still ordered on submit.
// Lines whose vendor already has a PO from this draft are left exactly as
// ordered. Nothing is written unless every line validates. Returns the saved
// draft in apiGetDraftById's shape so the editor picks up the new line_ids
// (without them, the next save appended the same new lines again).
function apiSaveDraft(payload) {
  const draftId = String(payload.draftId || '').trim();
  const lines = Array.isArray(payload.lines) ? payload.lines : [];

  if (!draftId) {
    throw new Error('Missing draftId');
  }
  if (lines.length === 0) {
    throw new Error('A draft needs at least one line. Cancel the draft instead of removing every line.');
  }

  withDraftLock_(() => {
    // 1️⃣ Validate draft status
    const draftSheet = getSheet_(SHEET_NAMES.DRAFT_ORDERS);
    const draftHeader = getHeaderMap_(draftSheet);
    const draftData = draftSheet.getDataRange().getValues();

    let draftStatus = null;
    let draftUpdatedAt = null;
    for (let i = 1; i < draftData.length; i++) {
      if (String(draftData[i][draftHeader.draft_id]).trim() === draftId) {
        draftStatus = draftData[i][draftHeader.status];
        draftUpdatedAt = draftData[i][draftHeader.updated_at];
        break;
      }
    }
    if (draftStatus === null) {
      throw new Error(`Draft not found: ${draftId}`);
    }
    if (!isDraftEditable_(draftStatus)) {
      throw new Error(`Draft ${draftId} is ${draftStatusKey_(draftStatus)} and can no longer be edited`);
    }
    // A save replaces the whole line set, so saving from a stale screen would
    // silently undo someone else's changes. The editor sends the updated_at
    // it loaded; refuse if the draft has been saved since.
    if (payload.expected_updated_at && draftUpdatedAt && typeof draftUpdatedAt.getTime === 'function' &&
        new Date(payload.expected_updated_at).getTime() !== draftUpdatedAt.getTime()) {
      throw new Error(`Draft ${draftId} was changed by someone else after you opened it. Reload it and make your changes again.`);
    }

    const submitted = getSubmittedVendorsForDraft_(draftId);

    // 2️⃣ Index this draft's existing lines
    const lineSheet = getSheet_(SHEET_NAMES.DRAFT_ORDER_LINES);
    const lineHeader = getHeaderMap_(lineSheet);
    const lineData = lineSheet.getDataRange().getValues();
    const rowOf = {}; // line_id → index into lineData
    for (let i = 1; i < lineData.length; i++) {
      if (String(lineData[i][lineHeader.draft_id]).trim() === draftId) {
        rowOf[String(lineData[i][lineHeader.line_id]).trim()] = i;
      }
    }
    const vendorAt = i => String(lineData[i][lineHeader.vendor_code] || '').trim();

    // 3️⃣ Validate the payload and stage every change in memory
    const now = new Date();
    const seen = new Set();
    const changedRows = [];
    const newLines = [];
    let products = null; // read only if this save adds lines

    lines.forEach((line, idx) => {
      const sku = String(line.sku || '').trim();
      const qty = Number(line.qty);
      const vendor = String(line.vendor_code || line.vendor || '').trim();
      const lineId = line.line_id ? String(line.line_id).trim() : '';

      if (lineId) {
        if (rowOf[lineId] === undefined) {
          throw new Error(`The line for SKU ${sku || '?'} is not part of draft ${draftId}. Reload the draft and try again.`);
        }
        if (seen.has(lineId)) throw new Error(`The line for SKU ${sku} was sent twice`);
        seen.add(lineId);
        if (submitted[vendorAt(rowOf[lineId])]) return; // already ordered as it was
      }

      if (!sku) throw new Error(`SKU missing at line ${idx + 1}`);
      if (!(qty > 0)) throw new Error(`Quantity must be more than 0 for SKU ${sku}`);
      if (!vendor) throw new Error(`Vendor required for SKU ${sku}`);
      if (submitted[vendor]) {
        throw new Error(`${vendor} was already ordered on ${submitted[vendor]}, so SKU ${sku} can't be added to that vendor`);
      }

      const fields = Object.assign({
        qty: qty,
        vendor_code: vendor,
        updated_at: now,
        customization_updated_at: now
      }, customizationFromLine_(line));

      if (lineId) {
        const row = lineData[rowOf[lineId]];
        Object.keys(fields).forEach(k => {
          if (lineHeader[k] !== undefined) row[lineHeader[k]] = fields[k];
        });
        changedRows.push(rowOf[lineId]);
      } else {
        if (!products) products = loadDraftProductMap_();
        const product = products[sku];
        if (!product) throw new Error(`SKU ${sku} not found in EE Product Master`);
        newLines.push(Object.assign({
          line_id: Utilities.getUuid(),
          draft_id: draftId,
          sku: sku,
          sku_name: product.sku_name,
          unit_price: product.unit_price,
          source: 'MANUAL',
          created_at: now
        }, fields));
      }
    });

    // Lines not in the payload were removed in the editor (ordered ones stay).
    const removedRows = Object.keys(rowOf)
      .filter(id => !seen.has(id) && !submitted[vendorAt(rowOf[id])])
      .map(id => rowOf[id]);
    const removed = new Set(removedRows);

    // 4️⃣ Write: updates in place, then appends, then deletes (bottom-up)
    writeRowRuns_(lineSheet, lineData, changedRows);
    appendRowsFromObjects_(lineSheet, lineHeader, newLines);
    deleteRowRuns_(lineSheet, removedRows);

    // 5️⃣ Recalculate header totals from the draft's final line set
    const finalLines = Object.keys(rowOf)
      .map(id => rowOf[id])
      .filter(i => !removed.has(i))
      .map(i => ({ sku: lineData[i][lineHeader.sku], qty: lineData[i][lineHeader.qty] }))
      .concat(newLines);

    updateRowByKey_(draftSheet, draftHeader, 'draft_id', draftId, {
      total_skus: new Set(finalLines.map(l => String(l.sku))).size,
      total_qty: finalLines.reduce((sum, l) => sum + Number(l.qty || 0), 0),
      updated_at: now
    });
  });

  return Object.assign({ draftId }, apiGetDraftById(draftId));
}

function rowToObject_(row, headerMap) {
  const obj = {};
  Object.keys(headerMap).forEach(k => {
    obj[k] = row[headerMap[k]];
  });
  return obj;
}

function apiSearchSkuCatalog(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) {
    return { status: 'success', items: [] };
  }

  const sheet = getSheet_(SHEET_NAMES.EE_PRODUCT_MASTER);
  const header = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();

  const results = [];

  for (let i = 1; i < data.length; i++) {
    const sku = String(data[i][header.SKU] || '');
    const name = String(data[i][header['Product Name']] || '');

    if (
      sku.toLowerCase().includes(q) ||
      name.toLowerCase().includes(q)
    ) {
      const product = productFromMasterRow_(data[i], header);
      results.push({
        sku,
        sku_name: name,
        unit_price: product.unit_price, // RMB
        landed_cost_inr: product.landed_cost_inr
      });
    }

    if (results.length >= 20) break; // cap results
  }

  return {
    status: 'success',
    items: results
  };
}

// Was called from entry_points.js's doPost ('add_sku_to_draft' case,
// paired with the search_sku_catalog above) but never defined anywhere in
// the project — currently unreachable from the frontend (no caller found),
// but any future "add existing catalog SKU to this draft" UI built against
// search_sku_catalog would have hit a ReferenceError.
function apiAddSkuToDraft(draftId, sku, qty) {
  if (!draftId) throw new Error('draftId is required');
  if (!sku) throw new Error('sku is required');
  const qtyNum = Number(qty || 0);
  if (qtyNum <= 0) throw new Error('qty must be greater than 0');

  return withDraftLock_(() => addSkuToDraftUnlocked_(String(draftId).trim(), String(sku).trim(), qtyNum));
}

function addSkuToDraftUnlocked_(draftId, sku, qtyNum) {
  const draftSheet = getSheet_(SHEET_NAMES.DRAFT_ORDERS);
  const draftHeader = getHeaderMap_(draftSheet);
  const draftData = draftSheet.getDataRange().getValues();

  let draftRow = null;
  for (let i = 1; i < draftData.length; i++) {
    if (String(draftData[i][draftHeader.draft_id]).trim() === draftId) {
      draftRow = draftData[i];
      break;
    }
  }
  if (!draftRow) throw new Error('Draft not found: ' + draftId);
  if (!isDraftEditable_(draftRow[draftHeader.status])) {
    throw new Error('Draft is locked after submission');
  }

  const product = getProductBySku_(sku);
  if (!product) throw new Error('SKU not found in Product Master: ' + sku);

  const customization = getCustomizationDefaults_(sku);
  const now = new Date();

  const lineSheet = getSheet_(SHEET_NAMES.DRAFT_ORDER_LINES);
  const lineHeader = getHeaderMap_(lineSheet);

  appendRowFromObject_(lineSheet, lineHeader, {
    line_id: Utilities.getUuid(),
    draft_id: draftId,
    sku: sku,
    sku_name: product.sku_name,
    qty: qtyNum,
    vendor_code: '', // catalog add doesn't infer a vendor — user assigns one in the draft editor, same as other lines
    unit_price: product.unit_price,
    source: 'CATALOG',
    created_at: now,
    updated_at: now,
    custom_logo: customization.custom_logo,
    custom_packaging: customization.custom_packaging,
    solving_manual: customization.solving_manual,
    opp_wrap: customization.opp_wrap,
    custom_remarks: customization.custom_remarks,
    customization_files: customization.customization_files,
    customization_updated_at: now
  });

  // Recalculate header totals from the full line set (consistent with apiSaveDraft)
  const lineData = lineSheet.getDataRange().getValues();
  const seenSkus = new Set();
  let totalQty = 0;
  for (let i = 1; i < lineData.length; i++) {
    if (String(lineData[i][lineHeader.draft_id]).trim() === draftId) {
      seenSkus.add(String(lineData[i][lineHeader.sku]));
      totalQty += Number(lineData[i][lineHeader.qty] || 0);
    }
  }
  updateRowByKey_(draftSheet, draftHeader, 'draft_id', draftId, {
    total_skus: seenSkus.size,
    total_qty: totalQty,
    updated_at: now
  });

  return { success: true, draftId, sku, message: 'SKU added to draft' };
}

function apiGetVendorMasters() {
  const sheet = getSheet_(SHEET_NAMES.VENDOR_MASTERS);
  const header = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();

  const vendors = [];

  const vendorCodeCol = header.vendor_code;
  const vendorNameCol = header.vendor_name;
  const activeCol = header.active; // may be blank
  const supportsAirCol = header.Supports_Air;
  const currencyCol = header.Currency;

  for (let i = 1; i < data.length; i++) {
    const vendorCode = String(data[i][vendorCodeCol] || '').trim();
    const vendorName = String(data[i][vendorNameCol] || '').trim();
    if (!vendorCode) continue;

    const activeRaw = data[i][activeCol];

    // Only rows explicitly marked active (1/true/yes) are included; blank counts as inactive.
    const isActive =
      activeRaw === 1 ||
      activeRaw === '1' ||
      String(activeRaw).toLowerCase() === 'true' ||
      String(activeRaw).toLowerCase() === 'yes';

    if (!isActive) continue;

    vendors.push({
      vendor_code: vendorCode,
      vendor_name: vendorName || vendorCode,
      supports_air:
        supportsAirCol
          ? data[i][supportsAirCol] === true ||
            String(data[i][supportsAirCol]).toLowerCase() === 'true'
          : false,
      active: true,
      currency: String(data[i][currencyCol] || '').trim() || 'RMB'
    });
  }

  return {
    status: 'success',
    vendors
  };
}


function test_generateDraftId() {
  const id = generateDraftId_();
  Logger.log('Generated Draft ID: ' + id);
}

function test_apiCreateDraftFromForecast_headerOnly() {
  const result = apiCreateDraftFromForecast({
    forecastRunId: 'RUN-TEST-001',
    mode: 'Sea',
    skus: [
      { sku: 'SKU-1', qty: 10 },
      { sku: 'SKU-2', qty: 20 }
    ]
  });

  Logger.log(result);
}

function test_apiCreateDraftFromForecast_withLines() {
  const result = apiCreateDraftFromForecast({
    forecastRunId: 'RUN-TEST-002',
    mode: 'Air',
    skus: [
      { sku: '1030500', qty: 5 },
      { sku: '1030553', qty: 15 }
    ]
  });

  Logger.log(result);
}

function test_apiGetDraftById() {
  const result = apiGetDraftById('DRAFT-25-003');
  Logger.log(JSON.stringify(result, null, 2));
}

function test_saveDraft_updateLine() {
  apiSaveDraft({
    draftId: 'DRAFT-25-003',
    lines: [
      {
        line_id: '0963747b-7a01-4989-8098-3ba15b12cd8e',
        sku: '1030500',
        qty: 12,
        vendor_code: 'QiYi',
        custom_logo: true
      }
    ]
  });
}

function test_saveDraft_addManualSku() {
  apiSaveDraft({
    draftId: 'DRAFT-25-003',
    lines: [
      {
        sku: '1030601',
        sku_name: 'Test Manual SKU',
        qty: 5,
        vendor_code: 'Test Vendor',
        unit_price: 100,
        custom_logo: false
      }
    ]
  });
}

function test_apiGetDraftOrders() {
  const result = apiGetDraftOrders();
  Logger.log(JSON.stringify(result, null, 2));
}

function test_apiGetVendorMasters() {
  const res = apiGetVendorMasters();
  Logger.log(JSON.stringify(res, null, 2));
}
function debugVendorMasterHeaders() {
  const sheet = getSheet_(SHEET_NAMES.VENDOR_MASTERS);
  const header = getHeaderMap_(sheet);
  Logger.log(header);
}

function debugVendorMasterActiveSamples() {
  const sheet = getSheet_(SHEET_NAMES.VENDOR_MASTERS);
  const header = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();

  const activeCol = header.active;
  Logger.log('activeCol index = ' + activeCol);

  for (let i = 1; i <= Math.min(10, data.length - 1); i++) {
    const vCode = data[i][header.vendor_code];
    const a = data[i][activeCol];
    Logger.log(JSON.stringify({
      row: i + 1,
      vendor_code: vCode,
      active_value: a,
      active_type: typeof a
    }));
  }
}

//// -----------------------------Claude Code Starts Here------------------

/**
 * API: Create Manual Draft Order
 * Used for:
 * 1. Manual SKU add in Draft UI
 * 2. Create PO for unallocated items in Review tab
 */
function apiCreateManualDraft(payload) {
  const { mode, lines } = payload;

  if (!mode) throw new Error("Shipping mode is required");
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("At least one line item is required");
  }

  // Validate every line before writing anything. Prices come from the EE
  // Product Master (RMB_Price), not from the client.
  const products = loadDraftProductMap_();
  lines.forEach((line, idx) => {
    const sku = String(line.sku || '').trim();
    if (!sku) throw new Error(`SKU missing at line ${idx + 1}`);
    if (!String(line.vendor_code || '').trim()) throw new Error(`Vendor missing for SKU ${sku}`);
    if (!(Number(line.qty) > 0)) {
      throw new Error(`Invalid quantity for SKU ${sku}`);
    }
    if (!products[sku]) throw new Error(`SKU ${sku} not found in EE Product Master`);
  });

  const vendorNames = {};
  apiGetVendorMasters().vendors.forEach(v => { vendorNames[v.vendor_code] = v.vendor_name; });

  return withDraftLock_(() => {
    const now = new Date();
    const userEmail = Session.getActiveUser().getEmail();

    const draftSheet = getSheet_(SHEET_NAMES.DRAFT_ORDERS);
    const draftHeader = getHeaderMap_(draftSheet);

    const lineSheet = getSheet_(SHEET_NAMES.DRAFT_ORDER_LINES);
    const lineHeader = getHeaderMap_(lineSheet);

    const draftId = generateDraftId_();

    appendRowFromObject_(draftSheet, draftHeader, {
      draft_id: draftId,
      status: 'DRAFT',
      planned_mode: String(mode).toUpperCase(),
      forecast_run_id: '', // Empty for manual
      total_skus: new Set(lines.map(l => String(l.sku).trim())).size,
      total_qty: lines.reduce((sum, l) => sum + Number(l.qty || 0), 0),
      created_by: userEmail,
      created_at: now,
      updated_at: now
    });

    appendRowsFromObjects_(lineSheet, lineHeader, lines.map(line => {
      const sku = String(line.sku).trim();
      const vendorCode = String(line.vendor_code).trim();
      const product = products[sku];
      return Object.assign({
        line_id: Utilities.getUuid(),
        draft_id: draftId,
        sku: sku,
        sku_name: product.sku_name || line.sku_name || '',
        qty: Number(line.qty),
        vendor_code: vendorCode,
        vendor_name: vendorNames[vendorCode] || vendorCode,
        unit_price: product.unit_price,
        source: 'MANUAL',
        created_at: now,
        updated_at: now,
        customization_updated_at: now
      }, customizationFromLine_(line));
    }));

    return {
      status: 'success',
      draftId: draftId,
      draft_id: draftId,
      message: `Draft Order ${draftId} created successfully`
    };
  });
}

/**
 * Parse customization value to boolean
 * Handles: true/false, "Yes"/"No", 1/0
 */
function parseCustomizationValue_(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  
  const strValue = String(value || '').toLowerCase().trim();
  if (strValue === 'yes' || strValue === 'true') return true;
  
  return false;
}

function testCreateDraftFromForecast() {
  clearCache();
  const payload = {
    mode: 'air',
    forecastRunId: 'test-001',
    skus: [
      { sku: '1030590', qty: 19 }
    ]
  };

  try {
    const result = apiCreateDraftFromForecast(payload);
    Logger.log('Result: ' + JSON.stringify(result));
  } catch (err) {
    Logger.log('ERROR: ' + err.message + ' | Stack: ' + err.stack);
  }
}

function apiSaveCustomization(payload) {
  const sheet = getSheet_(SHEET_NAMES.SKU_CUSTOMIZATION_MASTER);
  const header = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();

  // Normalise field names — handle both 'logo' and 'custom_logo'
  const sku = payload.sku;
  const customLogo       = payload.custom_logo       ?? payload.logo       ?? false;
  const customPackaging  = payload.custom_packaging  ?? payload.packaging  ?? false;
  const solvingManual    = payload.solving_manual    ?? payload.manual     ?? false;
  const oppWrap          = payload.opp_wrap          ?? payload.wrap       ?? false;
  const customRemarks    = payload.custom_remarks    ?? payload.remarks    ?? '';
  const customFiles      = payload.customization_files                     ?? '';

  if (!sku) {
    return ContentService
      .createTextOutput(JSON.stringify({ 
        success: false, error: 'SKU is required' 
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][header.sku]).trim() === sku) {
      if (header.custom_logo !== undefined)
        sheet.getRange(i + 1, header.custom_logo + 1).setValue(customLogo);
      if (header.custom_packaging !== undefined)
        sheet.getRange(i + 1, header.custom_packaging + 1).setValue(customPackaging);
      if (header.solving_manual !== undefined)
        sheet.getRange(i + 1, header.solving_manual + 1).setValue(solvingManual);
      if (header.opp_wrap !== undefined)
        sheet.getRange(i + 1, header.opp_wrap + 1).setValue(oppWrap);
      if (header.custom_remarks !== undefined)
        sheet.getRange(i + 1, header.custom_remarks + 1).setValue(customRemarks);
      if (header.customization_files !== undefined)
        sheet.getRange(i + 1, header.customization_files + 1).setValue(customFiles);
      if (header.last_updated !== undefined)
        sheet.getRange(i + 1, header.last_updated + 1).setValue(new Date());

      SpreadsheetApp.flush();
      return ContentService
        .createTextOutput(JSON.stringify({ 
          success: true, sku: sku 
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  // SKU not found — append new row
  const newRow = new Array(Object.keys(header).length).fill('');
  newRow[header.sku]                 = sku;
  newRow[header.custom_logo]         = customLogo;
  newRow[header.custom_packaging]    = customPackaging;
  newRow[header.solving_manual]      = solvingManual;
  newRow[header.opp_wrap]            = oppWrap;
  newRow[header.custom_remarks]      = customRemarks;
  newRow[header.customization_files] = customFiles;
  if (header.last_updated !== undefined)
    newRow[header.last_updated]      = new Date();

  sheet.appendRow(newRow);
  SpreadsheetApp.flush();

  return ContentService
    .createTextOutput(JSON.stringify({ 
      success: true, sku: sku, created: true 
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

