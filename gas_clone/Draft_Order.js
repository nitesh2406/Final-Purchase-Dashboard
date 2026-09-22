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

function apiCreateDraftFromForecast(payload) {
  if (!payload || !Array.isArray(payload.skus)) {
    throw new Error('Invalid payload: skus missing');
  }

   // 🔄 Sync Drive links before reading customization data
  syncCustomizationDriveLinks();

  const draftSheet = getSheet_(SHEET_NAMES.DRAFT_ORDERS);
  const header = getHeaderMap_(draftSheet);

  const draftId = generateDraftId_();
  const now = new Date();
  const user = Session.getActiveUser().getEmail();

  const totalSkus = payload.skus.length;
  const totalQty = payload.skus.reduce((sum, s) => sum + Number(s.qty || 0), 0);

  appendRowFromObject_(draftSheet, header, {
    draft_id: draftId,
    status: 'DRAFT',
    planned_mode: String(payload.mode || '').toUpperCase(),
    forecast_run_id: payload.forecastRunId || '',
    total_skus: totalSkus,
    total_qty: totalQty,
    created_by: user,
    created_at: now,
    updated_at: now
  });

    // 🔹 CREATE DRAFT ORDER LINES
  const lineSheet = getSheet_(SHEET_NAMES.DRAFT_ORDER_LINES);
  const lineHeader = getHeaderMap_(lineSheet);

  payload.skus.forEach(s => {
    const product = getProductBySku_(s.sku);
    if (!product) {
      throw new Error(`SKU not found in Product Master: ${s.sku}`);
    }

    const customization = getCustomizationDefaults_(s.sku);
    //const vendorCode = resolveVendorForDraftLine_(s.sku, String(payload.mode).toUpperCase());
    const vendorCode = resolveVendorForDraftLine_(
      s.sku,
      String(payload.mode).toUpperCase(),
      s.vendor || ''  // ← passed from frontend payload
      );

    appendRowFromObject_(lineSheet, lineHeader, {
      line_id: Utilities.getUuid(),
      draft_id: draftId,
      sku: s.sku,
      sku_name: product.sku_name,
      qty: Number(s.qty),
      vendor_code: vendorCode,
      unit_price: product.unit_price,
      source: 'FORECAST',
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
  });

  return {
    status: 'success',
    draftId
  };
}

function getProductBySku_(sku) {
  const sheet = getSheet_(SHEET_NAMES.EE_PRODUCT_MASTER);
  const header = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][header.SKU]).trim() === sku) {
      return {
        sku_name: data[i][header['Product Name']],
        unit_price: Number(data[i][header.Cost]) || 0
      };
    }
  }
  return null;
}

function getCustomizationDefaults_(sku) {
  const sheet = getSheet_(SHEET_NAMES.SKU_CUSTOMIZATION_MASTER);
  const header = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][header.sku]).trim() === sku) {
      return {
        custom_logo: data[i][header.custom_logo],
        custom_packaging: data[i][header.custom_packaging],
        solving_manual: data[i][header.solving_manual],
        opp_wrap: data[i][header.opp_wrap],
        custom_remarks: data[i][header.custom_remarks],
        customization_files: data[i][header.customization_files]
      };
    }
  }

  // default fallback
  return {
    custom_logo: false,
    custom_packaging: false,
    solving_manual: false,
    opp_wrap: false,
    custom_remarks: '',
    customization_files: ''
  };
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

  // Normalize status casing
  if (String(draft.status).toUpperCase() === 'DRAFT') {
    draft.status = 'Draft';
  }

  
  // 4️⃣ Fetch draft lines
  const lineSheet = getSheet_(SHEET_NAMES.DRAFT_ORDER_LINES);
  const lineHeader = getHeaderMap_(lineSheet);
  const lineData = lineSheet.getDataRange().getValues();

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
    const v = String(s || '').trim().toUpperCase();
    if (v === 'DRAFT') return 'Draft';
    if (v === 'CANCELLED') return 'Cancelled';
    if (v === 'ORDER PLACED') return 'Order Placed';
    if (v === 'PARTIALLY SUBMITTED') return 'Partially Submitted';
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


// Was called from entry_points.js's doPost ('cancel_draft' case) but never
// defined anywhere in the project — every cancel-draft click has been
// throwing a ReferenceError, caught and returned as a generic error.
function apiCancelDraft(id) {
  if (!id) throw new Error('id is required');

  const draftSheet = getSheet_(SHEET_NAMES.DRAFT_ORDERS);
  const draftHeader = getHeaderMap_(draftSheet);
  const draftData = draftSheet.getDataRange().getValues();

  let currentStatus = null;
  for (let i = 1; i < draftData.length; i++) {
    if (String(draftData[i][draftHeader.draft_id]).trim() === id) {
      currentStatus = String(draftData[i][draftHeader.status] || '').trim().toUpperCase();
      break;
    }
  }
  if (currentStatus === null) throw new Error('Draft not found: ' + id);
  if (currentStatus !== 'DRAFT' && currentStatus !== 'PARTIALLY SUBMITTED') {
    throw new Error('Only drafts in DRAFT or PARTIALLY SUBMITTED status can be cancelled (current: ' + currentStatus + ')');
  }

  const now = new Date();
  updateRowByKey_(draftSheet, draftHeader, 'draft_id', id, {
    status: 'CANCELLED',
    updated_at: now
  });

  logAuditEvent_('DRAFT_ORDER', 'CANCEL', id, 'Draft cancelled', 'SUCCESS', Session.getActiveUser().getEmail());

  return { success: true, id, message: 'Draft cancelled successfully' };
}

// Was wired to a real "Cancel N Selected" bulk-select UI (checkboxes already
// built in DraftOrdersTable.tsx) with no backend case at all until now.
function apiBulkCancelDrafts(ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('ids array is required');

  const cancelled = [];
  const failed = [];
  ids.forEach(id => {
    try {
      apiCancelDraft(id);
      cancelled.push(id);
    } catch (err) {
      failed.push({ id, error: err.message });
    }
  });

  return { success: true, cancelled, failed };
}

// Was referenced by the frontend (API_ACTIONS.DUPLICATE_DRAFT, a real wired
// "Duplicate" button) with no backend case at all until now.
function apiDuplicateDraft(id) {
  if (!id) throw new Error('id is required');

  const source = apiGetDraftById(id); // throws if not found; also gives us normalized lines
  const newDraftId = generateDraftId_();
  const now = new Date();
  const user = Session.getActiveUser().getEmail();

  const draftSheet = getSheet_(SHEET_NAMES.DRAFT_ORDERS);
  const draftHeader = getHeaderMap_(draftSheet);
  const totalSkus = source.lines.length;
  const totalQty = source.lines.reduce((sum, l) => sum + Number(l.qty || 0), 0);

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

  source.lines.forEach(l => {
    appendRowFromObject_(lineSheet, lineHeader, {
      line_id: Utilities.getUuid(),
      draft_id: newDraftId,
      sku: l.sku,
      sku_name: l.sku_name || '',
      qty: Number(l.qty || 0),
      vendor_code: l.vendor_code || '',
      unit_price: Number(l.unit_price || 0),
      source: 'DUPLICATE',
      created_at: now,
      updated_at: now,
      custom_logo: l.custom_logo || false,
      custom_packaging: l.custom_packaging || false,
      solving_manual: l.solving_manual || false,
      opp_wrap: l.opp_wrap || false,
      custom_remarks: l.custom_remarks || '',
      customization_files: l.customization_files || '',
      customization_updated_at: now
    });
  });

  logAuditEvent_('DRAFT_ORDER', 'DUPLICATE', newDraftId, 'Duplicated from ' + id, 'SUCCESS', user);

  // Shape matches apiGetDraftOrders()'s per-draft object — DraftOrdersTable.tsx
  // prepends this directly into its drafts list.
  const vendors = Array.from(new Set(source.lines.map(l => String(l.vendor_code || '').trim()).filter(Boolean))).sort();
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

/*
function apiSaveDraft(payload) {
  const draftId = payload.draftId;
  const lines = payload.lines || [];

  if (!draftId) {
    throw new Error('Missing draftId');
  }

  // 1️⃣ Validate draft status
  const draftSheet = getSheet_(SHEET_NAMES.DRAFT_ORDERS);
  const draftHeader = getHeaderMap_(draftSheet);
  const draftData = draftSheet.getDataRange().getValues();

  let draftRowIndex = -1;
  let draftStatus = null;

  for (let i = 1; i < draftData.length; i++) {
    if (String(draftData[i][draftHeader.draft_id]).trim() === draftId) {
      draftRowIndex = i + 1;
      draftStatus = draftData[i][draftHeader.status];
      break;
    }
  }

  if (draftRowIndex === -1) {
    throw new Error(`Draft not found: ${draftId}`);
  }

  if (draftStatus !== 'DRAFT') {
    throw new Error('Draft is locked after submission');
  }

  // 2️⃣ Prepare line sheet
  const lineSheet = getSheet_(SHEET_NAMES.DRAFT_ORDER_LINES);
  const lineHeader = getHeaderMap_(lineSheet);
  const now = new Date();

  const seenSkus = new Set();
  let totalQty = 0;

  lines.forEach(line => {
    const qty = Number(line.qty || 0);
    if (qty <= 0) return;

    totalQty += qty;
    seenSkus.add(String(line.sku));

    // Existing line → update
    // Existing line → update
      if (line.line_id) {

     const updates = {
    qty: qty,
    updated_at: now,

    custom_logo: line.custom_logo,
    custom_packaging: line.custom_packaging,
    solving_manual: line.solving_manual,
    opp_wrap: line.opp_wrap,
    custom_remarks: line.custom_remarks || '',
    customization_files: line.customization_files || '',
    customization_updated_at: now
  };

  // 🔒 IMPORTANT: only update vendor if explicitly provided
  // 🔁 Accept vendor edit from UI
const incomingVendor =
  line.vendor_code !== undefined && line.vendor_code !== ''
    ? line.vendor_code
    : line.vendor !== undefined && line.vendor !== ''
    ? line.vendor
    : null;

// 🔒 Update vendor ONLY if explicitly provided
if (incomingVendor !== null) {
  updates.vendor_code = incomingVendor;
}


  // 🔁 Map UI customization fields → DB columns
if (line.logo !== undefined) {
  updates.custom_logo = line.logo === 'Yes';
}
if (line.packaging !== undefined) {
  updates.custom_packaging = line.packaging === 'Yes';
}
if (line.manual !== undefined) {
  updates.solving_manual = line.manual === 'Yes';
}
if (line.wrap !== undefined) {
  updates.opp_wrap = line.wrap === 'Yes';
}
if (line.remarks !== undefined) {
  updates.custom_remarks = line.remarks || '';
}
if (line.files !== undefined) {
  updates.customization_files = Array.isArray(line.files)
    ? line.files.join(', ')
    : line.files;
}
  
  updateRowByKey_(
    lineSheet,
    lineHeader,
    'line_id',
    line.line_id,
    updates
  );
      }

    // New line → manual SKU add
    else {
      if (!line.vendor_code) {
        throw new Error(`Vendor required for manual SKU: ${line.sku}`);
      }

      appendRowFromObject_(lineSheet, lineHeader, {
        line_id: Utilities.getUuid(),
        draft_id: draftId,
        sku: line.sku,
        sku_name: line.sku_name || '',
        qty: qty,
        vendor_code: line.vendor_code,
        unit_price: Number(line.unit_price || 0),
        source: 'MANUAL',
        created_at: now,
        updated_at: now,

        custom_logo: line.custom_logo || false,
        custom_packaging: line.custom_packaging || false,
        solving_manual: line.solving_manual || false,
        opp_wrap: line.opp_wrap || false,
        custom_remarks: line.custom_remarks || '',
        customization_files: line.customization_files || '',
        customization_updated_at: now
      });
    }
  });

  // 3️⃣ Recalculate & update header
  const totalSkus = seenSkus.size;

  updateRowByKey_(draftSheet, draftHeader, 'draft_id', draftId, {
    total_skus: totalSkus,
    total_qty: totalQty,
    updated_at: now
  });

  return {
    status: 'success',
    draftId
  };
}

*/

function apiSaveDraft(payload) {
  const draftId = payload.draftId;
  const lines = payload.lines || [];

  if (!draftId) {
    throw new Error('Missing draftId');
  }

  // 1️⃣ Validate draft status
  const draftSheet = getSheet_(SHEET_NAMES.DRAFT_ORDERS);
  const draftHeader = getHeaderMap_(draftSheet);
  const draftData = draftSheet.getDataRange().getValues();

  let draftRowIndex = -1;
  let draftStatus = null;

  for (let i = 1; i < draftData.length; i++) {
    if (String(draftData[i][draftHeader.draft_id]).trim() === draftId) {
      draftRowIndex = i + 1;
      draftStatus = draftData[i][draftHeader.status];
      break;
    }
  }

  if (draftRowIndex === -1) {
    throw new Error(`Draft not found: ${draftId}`);
  }

  if (draftStatus !== 'DRAFT') {
    throw new Error('Draft is locked after submission');
  }

  // 2️⃣ Prepare line sheet
  const lineSheet = getSheet_(SHEET_NAMES.DRAFT_ORDER_LINES);
  const lineHeader = getHeaderMap_(lineSheet);
  const now = new Date();

  const seenSkus = new Set();
  let totalQty = 0;

  lines.forEach(line => {
    const qty = Number(line.qty || 0);
    if (qty <= 0) return;

    totalQty += qty;
    seenSkus.add(String(line.sku));

    // Existing line → update
    // Existing line → update
      if (line.line_id) {

     const updates = {
    qty: qty,
    updated_at: now,

    custom_logo: line.custom_logo,
    custom_packaging: line.custom_packaging,
    solving_manual: line.solving_manual,
    opp_wrap: line.opp_wrap,
    custom_remarks: line.custom_remarks || '',
    customization_files: line.customization_files || '',
    customization_updated_at: now
  };



  // 🔒 IMPORTANT: only update vendor if explicitly provided
  // 🔁 Accept vendor edit from UI
const incomingVendor =
  line.vendor_code !== undefined && line.vendor_code !== ''
    ? line.vendor_code
    : line.vendor !== undefined && line.vendor !== ''
    ? line.vendor
    : null;

// 🔒 Update vendor ONLY if explicitly provided
if (incomingVendor !== null) {
  updates.vendor_code = incomingVendor;
}


  // 🔁 Map UI customization fields → DB columns
if (line.logo !== undefined) {
  updates.custom_logo = line.logo === 'Yes';
}
if (line.packaging !== undefined) {
  updates.custom_packaging = line.packaging === 'Yes';
}
if (line.manual !== undefined) {
  updates.solving_manual = line.manual === 'Yes';
}
if (line.wrap !== undefined) {
  updates.opp_wrap = line.wrap === 'Yes';
}
if (line.remarks !== undefined) {
  updates.custom_remarks = line.remarks || '';
}
if (line.files !== undefined) {
  updates.customization_files = Array.isArray(line.files)
    ? line.files.join(', ')
    : line.files;
}
  
  
  updateRowByKey_(
    lineSheet,
    lineHeader,
    'line_id',
    line.line_id,
    updates
  );
      }

    // New line → manual SKU add
    else {
      if (!line.vendor_code) {
        throw new Error(`Vendor required for manual SKU: ${line.sku}`);
      }

      appendRowFromObject_(lineSheet, lineHeader, {
        line_id: Utilities.getUuid(),
        draft_id: draftId,
        sku: line.sku,
        sku_name: line.sku_name || line.item_name || '',
        qty: qty,
        vendor_code: line.vendor_code,
        unit_price: Number(line.unit_price || 0),
        source: 'MANUAL',
        created_at: now,
        updated_at: now,

        custom_logo: line.custom_logo || false,
        custom_packaging: line.custom_packaging || false,
        solving_manual: line.solving_manual || false,
        opp_wrap: line.opp_wrap || false,
        custom_remarks: line.custom_remarks || '',
        customization_files: line.customization_files || '',
        customization_updated_at: now
      });
    }
  });

  // 3️⃣ Recalculate & update header
  const totalSkus = seenSkus.size;

  updateRowByKey_(draftSheet, draftHeader, 'draft_id', draftId, {
    total_skus: totalSkus,
    total_qty: totalQty,
    updated_at: now
  });

  return {
    status: 'success',
    draftId
  };
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
      results.push({
        sku,
        sku_name: name,
        unit_price: Number(data[i][header.Cost] || 0)
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
  if (String(draftRow[draftHeader.status] || '').trim().toUpperCase() !== 'DRAFT') {
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
  
  // Validate all lines have required fields
  lines.forEach((line, idx) => {
    if (!line.sku) throw new Error(`SKU missing at line ${idx + 1}`);
    if (!line.vendor_code) throw new Error(`Vendor missing for SKU ${line.sku}`);
    if (!line.qty || Number(line.qty) <= 0) {
      throw new Error(`Invalid quantity for SKU ${line.sku}`);
    }
  });
  
  const now = new Date();
  const userEmail = Session.getActiveUser().getEmail();
  
  // Get sheets
  const draftSheet = getSheet_(SHEET_NAMES.DRAFT_ORDERS);
  const draftHeader = getHeaderMap_(draftSheet);
  
  const lineSheet = getSheet_(SHEET_NAMES.DRAFT_ORDER_LINES);
  const lineHeader = getHeaderMap_(lineSheet);
  
  // Generate draft ID
  const draftId = generateDraftId_();
  
  // Calculate totals
  const uniqueSkus = new Set(lines.map(l => l.sku));
  const totalQty = lines.reduce((sum, l) => sum + Number(l.qty || 0), 0);
  
  // Create draft header
  appendRowFromObject_(draftSheet, draftHeader, {
    draft_id: draftId,
    status: 'DRAFT',
    planned_mode: String(mode).toUpperCase(),
    forecast_run_id: '', // Empty for manual
    total_skus: uniqueSkus.size,
    total_qty: totalQty,
    created_by: userEmail,
    created_at: now,
    updated_at: now
  });
  
  // Create draft lines
  lines.forEach(line => {
    const sku = String(line.sku).trim();
    const qty = Number(line.qty);
    const unitPrice = Number(line.unit_price || 0);
    
    // Get product details from EE Product Master
    const productDetails = getProductDetailsForDraft_(sku);
    
    // Get vendor name
    const vendorName = getVendorName_(line.vendor_code);
    
    // Parse customization from line
    const customLogo = parseCustomizationValue_(line.custom_logo || line.logo);
    const customPackaging = parseCustomizationValue_(line.custom_packaging || line.packaging);
    const solvingManual = parseCustomizationValue_(line.solving_manual || line.manual);
    const oppWrap = parseCustomizationValue_(line.opp_wrap || line.wrap);
    
    appendRowFromObject_(lineSheet, lineHeader, {
      line_id: Utilities.getUuid(),
      draft_id: draftId,
      sku: sku,
      sku_name: line.sku_name || productDetails.sku_name || '',
      qty: qty,
      vendor_code: line.vendor_code,
      vendor_name: vendorName,
      unit_price: unitPrice || productDetails.unit_price || 0,
      source: 'MANUAL',
      created_at: now,
      updated_at: now,
      
      // Customization
      custom_logo: customLogo,
      custom_packaging: customPackaging,
      solving_manual: solvingManual,
      opp_wrap: oppWrap,
      custom_remarks: line.custom_remarks || line.remarks || '',
      customization_files: line.customization_files || (Array.isArray(line.files) ? line.files.join(', ') : line.files || ''),
      customization_updated_at: now,
      
      // Financial
      line_total_rmb: qty * (unitPrice || productDetails.unit_price || 0),
      
      // Additional fields from EE Product Master
      Lead_TimeMOQ: productDetails.lead_time_moq || '',
      Threshold_Qty: productDetails.threshold_qty || '',
      Supplier_Code: productDetails.supplier_code || line.vendor_code || '',
      
      // Empty fields
      line_close_reason: ''
    });
  });
  
  return {
    status: 'success',
    draft_id: draftId,
    message: `Draft Order ${draftId} created successfully`
  };
}

/**
 * Get product details from EE Product Master including extra fields
 */
function getProductDetailsForDraft_(sku) {
  const sheet = getSheet_(SHEET_NAMES.EE_PRODUCT_MASTER);
  const header = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][header.SKU]).trim() === sku) {
      return {
        sku_name: data[i][header['Product Name']] || '',
        unit_price: Number(data[i][header.Cost]) || 0,
        lead_time_moq: data[i][header.Lead_TimeMOQ] || '',
        threshold_qty: data[i][header.Threshold_Qty] || '',
        supplier_code: data[i][header.Supplier_Code] || ''
      };
    }
  }
  
  // Return defaults if not found
  return {
    sku_name: '',
    unit_price: 0,
    lead_time_moq: '',
    threshold_qty: '',
    supplier_code: ''
  };
}

/**
 * Get vendor name from vendor code
 */
function getVendorName_(vendorCode) {
  if (!vendorCode) return '';
  
  const sheet = getSheet_(SHEET_NAMES.VENDOR_MASTERS);
  const header = getHeaderMap_(sheet);
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][header.vendor_code]).trim() === vendorCode) {
      return data[i][header.vendor_name] || vendorCode;
    }
  }
  
  return vendorCode; // Fallback to code if name not found
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

