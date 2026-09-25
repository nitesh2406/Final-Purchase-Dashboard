// ============================================================
// NewSkuApi.gs — New SKU Dashboard Backend
// Cubelelo B2B Procurement Dashboard
// ============================================================
// All functions follow the existing doPost() pattern.
// Add these cases to the existing switch in Code.gs / doPost():
//
//   case 'getNewSkuRequests':
//     result = apiGetNewSkuRequests(payload); break;
//   case 'getNewSkuRequestById':
//     result = apiGetNewSkuRequestById(payload); break;
//   case 'saveNewSkuDraft':
//     result = apiSaveNewSkuDraft(payload); break;
//   case 'getNextAvailableSku':
//     result = apiGetNextAvailableSku(payload); break;
//   case 'getPricingConfig':
//     result = apiGetPricingConfig(payload); break;
//   case 'getTagsByCategory':
//     result = apiGetTagsByCategory(payload); break;
//   case 'createSkuOnEasyEcom':
//     result = apiCreateSkuOnEasyEcom(payload); break;
//   case 'createSkuOnZoho':
//     result = apiCreateSkuOnZoho(payload); break;
//   case 'createSkuOnShopify':
//     result = apiCreateSkuOnShopify(payload); break;
//   case 'updateEePurchaseOrder':
//     result = apiUpdateEePurchaseOrder(payload); break;
//   case 'rejectSkuRequest':
//     result = apiRejectSkuRequest(payload); break;
//   case 'createManualSkuRequest':
//     result = apiCreateManualSkuRequest(payload); break;
// ============================================================


// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const NSR_SHEET      = 'New_SKU_Requests';
const EE_MASTER      = 'EE Product Master';
const TAGS_SHEET     = 'Shopify Collection & Tags';
const VS_SHEET       = 'Vendor_Shipments';
// Was a hardcoded literal — moved to Script Properties (same 'EASY_ECOM_API_KEY'
// key already used by amazon_api_code.js/EEcom_api_code.js) so it isn't sitting
// in plaintext source. Value unchanged; see credentials.js for the property list.
const EE_API_KEY     = PropertiesService.getScriptProperties().getProperty('EASY_ECOM_API_KEY');

// New_SKU_Requests column schema (0-based index)
// Existing columns: 0–17 | New columns: 18–42
const NSR_COL = {
  // ── Existing ──
  request_id:           0,
  shipment_id:          1,
  vendor_code:          2,
  factory_code:         3,
  ean:                  4,
  item_name:            5,
  color:                6,
  my_id:                7,
  invoice_qty:          8,
  unit_price:           9,
  requested_by:         10,
  requested_at:         11,
  status:               12,
  ee_sku:               13,
  ee_product_name:      14,
  notes:                15,
  resolved_at:          16,
  resolved_by:          17,
  // ── New columns ──
  suggested_sku:        18,
  listing_name:         19,
  variant:              20,
  listing_type:         21,
  parent_sku:           22,
  category:             23,
  brand:                24,
  mrp:                  25,
  shopify_selling_price:26,
  shopify_compare_price:27,
  pkg_height_cm:        28,
  pkg_length_cm:        29,
  pkg_width_cm:         30,
  pkg_weight_gm:        31,
  product_dims_mm:      32,
  nw_gm:                33,
  relevant_tags:        34,
  last_edited_at:       35,
  last_edited_by:       36,
  ee_api_response:      37,
  shopify_listing_url:  38,
  zoho_created_date:    39,
  fnsku:                40,
  fnsku_status_ee:      41,
  remark:               42,
  // ── Additional EE custom fields ──
  lead_time:            43,
  moq:                  44,
  threshold_qty:        45,
  supplier_code:        46,
  pack_size:            47,
  // ── Field-update requests (ID / Price / EAN update requests raised from
  //    the Vendor Shipment "ID / Price / EAN Review" tab) ──
  // request_type: 'NEW_SKU' (default/blank, existing rows) | 'UPDATE_ID' | 'UPDATE_PRICE' | 'UPDATE_EAN'
  // target_sku: the existing EasyEcom SKU the update applies to (blank for NEW_SKU requests)
  request_type:         48,
  target_sku:           49,
  // Sample SKU marker — set at creation time (Create SKU / manual entry),
  // editable later via Update SKU. No structural change to how a sample
  // is created — it goes through the exact same flow as any other SKU,
  // just carries this flag so it's filterable (currently: Update SKU
  // search) without needing a separate EAN scheme for samples.
  is_sample:            50,
};

const NSR_TOTAL_COLS = 51; // ensure sheet has at least this many columns
// NOTE: the live "New_SKU_Requests" Google Sheet must have header cells named
// exactly "request_type", "target_sku", and "is_sample" in columns 49/50/51
// (1-based) for these to be written — appendRowFromObject_ matches by header
// name, not by index.

// CLIENT_SECRET and REFRESH_TOKEN used to be hardcoded literals here — moved to
// Script Properties (ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN, read in
// fetchAccessToken_ below) since those two are real secrets, unlike CLIENT_ID
// (a public OAuth client identifier) and DC (not a secret at all).
const AUTH = {
  CLIENT_ID:     '1000.CKRD4QIVXGM2GO9H7PMY0LS2M151PN',   // <-- your Zoho OAuth client id
  DC:            'in',  // data center (accounts.zoho.in) → in, us, eu, au, jp
};


const CONFIG = {
  ORG_ID: '60032126274',

  //SOURCE_SHEET: 'EE Product Master All',
  //TARGET_SHEET: 'Zoho item',

  //ACTIVE_CATEGORIES: ['Active_SKUs', 'SAMPLES'],
  //STATUS_COL_NAME: 'Zoho Status',
  //ERROR_COL_NAME: 'Zoho Error Reason',

  /*REQUIRED_COLUMNS: [
    'SKU',
    'Product Name',
    'Cost',
    'MRP',
    'EAN',
    'EAN/UPC'
  ], */

  HSN_CODE: '95036090',
  UNIT: 'unit',
  PURCHASE_ACCOUNT_ID: '1975394000000000567',

  MAX_CREATE_PER_RUN: 100,
  DRY_RUN: false,
  MIN_VALID_CP: 10
};
// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

// Sheet: SKU_Config
// Columns: category | prefix | sample_sku | notes
// e.g.:   3x3      | 103    | 1030082    | Speed cubes

// Frontend-facing wrapper around getSkuPrefixMap_ — used by the Shipment
// Tracker's Item Type filter (categories sharing a prefix, e.g. Shape Mod /
// Skewb both under 113, are merged into one filter chip client-side).
function apiGetSkuCategories() {
  try {
    const map = getSkuPrefixMap_();
    const categories = Object.keys(map).map(category => ({
      category: category,
      prefix: map[category].prefix
    }));
    return successResponse_({ categories: categories });
  } catch (e) {
    return errorResponse_('Failed to load SKU categories: ' + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// SKU_Config LAYOUT
// ─────────────────────────────────────────────────────────────
// One tab holding several independent blocks. Each has a header row (row 1)
// and its data from row 2 down. They used to be stacked in the SAME columns
// (A:B — categories, then pricing keys, then VARIANT rows, then bracket rows),
// so anything reading "column A" saw config keys as categories: the Category
// dropdown listed CNY_CONV_RATE / VARIANT / CM1_BRACKET_* (83 "categories",
// 28 real), and the shipment prefix matcher was fed junk prefixes like "85" and
// "15.2". Each block now lives in its own columns and is read only from there:
//
//   A:E   categories   category | prefix | sample_sku | notes | floor_sku
//   G:H   pricing      KEY | value                     (I = description)
//   K:L   variants     'VARIANT' | value                (only L is read)
//   N:O   brackets     *_BRACKET_<floor> | value        (P = description)
//                      (GST_RATE currently sits here too — both G:H and N:O
//                       are read for scalar keys, G:H first)
//   R     shipment_partners  a flat list of Shipment Partner names, header
//                            row + data from row 2 down (only column read,
//                            same one-column-block convention as K:L) — see
//                            CNF Agent Accounting's Air Log Entry form.
//                            Maintained directly in the sheet, not from the app.
const SKU_CONFIG_SHEET = 'SKU_Config';
const SKU_CONFIG_COLS = {
  catKey: 1, catPrefix: 2, catFloor: 5,
  priceKey: 7, priceVal: 8,
  variantVal: 12,
  bracketKey: 14, bracketVal: 15,
  shipmentPartnerVal: 18,
};

function getSkuConfigSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SKU_CONFIG_SHEET);
  if (!sheet) throw new Error(SKU_CONFIG_SHEET + ' sheet not found');
  return sheet;
}

// Rows 2..last of a key/value column pair as [{ key, value, row }], blank keys
// dropped. `row` is the 1-based sheet row (used by the saver).
function readSkuConfigPairs_(sheet, keyCol, valCol) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const width = valCol - keyCol + 1;
  const out = [];
  sheet.getRange(2, keyCol, last - 1, width).getValues().forEach((r, i) => {
    const key = String(r[0]).trim();
    if (key) out.push({ key, value: r[width - 1], row: i + 2 });
  });
  return out;
}

// Categories: column A (name), B (prefix), E (floor_sku). A row is a category
// only if it has a name, a prefix AND a numeric floor_sku (0 for the alpha-
// prefix ones like Design/SERVICE). floor_sku is what separates a category
// row from any other row that happens to have text in A and B — config rows
// never have it — so the list stays right even while stray rows are still
// sitting in the column.
function getSkuPrefixMap_() {
  const sheet = getSkuConfigSheet_();
  const last  = sheet.getLastRow();
  if (last < 2) return {};

  const map = {};
  sheet.getRange(2, 1, last - 1, SKU_CONFIG_COLS.catFloor).getValues().forEach(r => {
    const category = String(r[SKU_CONFIG_COLS.catKey - 1]).trim();
    const prefix   = String(r[SKU_CONFIG_COLS.catPrefix - 1]).trim();
    const floorRaw = r[SKU_CONFIG_COLS.catFloor - 1];
    if (!category || !prefix) return;
    if (floorRaw === '' || floorRaw === null || isNaN(Number(floorRaw))) return;
    map[category] = { prefix, floorSku: Number(floorRaw) };
  });
  return map;
}

function getNsrSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(NSR_SHEET);
  if (!sheet) throw new Error(`Sheet "${NSR_SHEET}" not found`);
  return sheet;
}

function nsrRowToObject_(row) {
  // Convert a sheet row array to a structured object
  return {
    request_id:           String(row[NSR_COL.request_id]   || ''),
    shipment_id:          String(row[NSR_COL.shipment_id]  || ''),
    vendor_code:          String(row[NSR_COL.vendor_code]  || ''),
    factory_code:         String(row[NSR_COL.factory_code] || ''),
    ean:                  String(row[NSR_COL.ean]          || ''),
    item_name:            String(row[NSR_COL.item_name]    || ''),
    color:                String(row[NSR_COL.color]        || ''),
    my_id:                String(row[NSR_COL.my_id]        || ''),
    invoice_qty:          Number(row[NSR_COL.invoice_qty]  || 0),
    unit_price:           Number(row[NSR_COL.unit_price]   || 0),
    requested_by:         String(row[NSR_COL.requested_by] || ''),
    requested_at:         row[NSR_COL.requested_at] ? new Date(row[NSR_COL.requested_at]).toISOString() : '',
    status:               String(row[NSR_COL.status]       || 'PENDING'),
    ee_sku:               String(row[NSR_COL.ee_sku]       || ''),
    ee_product_name:      String(row[NSR_COL.ee_product_name] || ''),
    notes:                String(row[NSR_COL.notes]        || ''),
    resolved_at:          row[NSR_COL.resolved_at] ? new Date(row[NSR_COL.resolved_at]).toISOString() : '',
    resolved_by:          String(row[NSR_COL.resolved_by]  || ''),
    // New fields
    suggested_sku:        String(row[NSR_COL.suggested_sku]        || ''),
    listing_name:         String(row[NSR_COL.listing_name]         || ''),
    variant:              String(row[NSR_COL.variant]              || ''),
    listing_type:         String(row[NSR_COL.listing_type]         || ''),
    parent_sku:           String(row[NSR_COL.parent_sku]           || ''),
    category:             String(row[NSR_COL.category]             || ''),
    brand:                String(row[NSR_COL.brand]                || ''),
    mrp:                  Number(row[NSR_COL.mrp]                  || 0),
    shopify_selling_price:Number(row[NSR_COL.shopify_selling_price]|| 0),
    shopify_compare_price:Number(row[NSR_COL.shopify_compare_price]|| 0),
    pkg_height_cm:        Number(row[NSR_COL.pkg_height_cm]        || 0),
    pkg_length_cm:        Number(row[NSR_COL.pkg_length_cm]        || 0),
    pkg_width_cm:         Number(row[NSR_COL.pkg_width_cm]         || 0),
    pkg_weight_gm:        Number(row[NSR_COL.pkg_weight_gm]        || 0),
    product_dims_mm:      String(row[NSR_COL.product_dims_mm]      || ''),
    nw_gm:                Number(row[NSR_COL.nw_gm]                || 0),
    relevant_tags:        String(row[NSR_COL.relevant_tags]        || ''),
    last_edited_at:       row[NSR_COL.last_edited_at] ? new Date(row[NSR_COL.last_edited_at]).toISOString() : '',
    last_edited_by:       String(row[NSR_COL.last_edited_by]       || ''),
    ee_api_response:      String(row[NSR_COL.ee_api_response]      || ''),
    shopify_listing_url:  String(row[NSR_COL.shopify_listing_url]  || ''),
    zoho_created_date:    row[NSR_COL.zoho_created_date] ? new Date(row[NSR_COL.zoho_created_date]).toISOString() : '',
    fnsku:                String(row[NSR_COL.fnsku]                || ''),
    fnsku_status_ee:      String(row[NSR_COL.fnsku_status_ee]      || ''),
    remark:               String(row[NSR_COL.remark]               || ''),
    lead_time:            Number(row[NSR_COL.lead_time]            || 0),
    moq:                  Number(row[NSR_COL.moq]                  || 0),
    threshold_qty:        Number(row[NSR_COL.threshold_qty]        || 0),
    supplier_code:        String(row[NSR_COL.supplier_code]        || ''),
    pack_size:            Number(row[NSR_COL.pack_size]            || 0),
    request_type:         String(row[NSR_COL.request_type]         || 'NEW_SKU'),
    target_sku:           String(row[NSR_COL.target_sku]           || ''),
    is_sample:            row[NSR_COL.is_sample] === true || String(row[NSR_COL.is_sample]).toUpperCase() === 'TRUE',
    // Derived platform flags
    ee_done:      !!(row[NSR_COL.ee_sku]),
    zoho_done:    !!(row[NSR_COL.zoho_created_date]),
    shopify_done: !!(row[NSR_COL.shopify_listing_url]),
    ee_po_updated: String(row[NSR_COL.status]) === 'CREATED',
  };
}

/*function generateRequestId_() {
  const sheet = getNsrSheet_();
  const data = sheet.getDataRange().getValues();
  // Count existing NSR rows (skip header row 0)
  const count = data.slice(1).filter(r => String(r[NSR_COL.request_id]).startsWith('NSR-')).length;
  return 'NSR-' + String(count + 1).padStart(3, '0');
}*/
function generateRequestId_() {
  return 'NSR-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
}

function nowIso_() {
  return new Date().toISOString();
}

function okResult_(data) {
  return { success: true, data };
}

function errResult_(msg) {
  return { success: false, error: msg };
}

// True only for a genuine EasyEcom success. The message fallback used to be a
// bare `includes('success')`, which also matches failures such as "Product
// creation unsuccessful" — a rejected create/update could then be recorded as
// done. Negations and failure words are excluded explicitly; `code === 200`
// is still the primary signal.
function isEeSuccess_(resJson) {
  if (!resJson) return false;
  if (resJson.code === 200) return true;
  const msg = String(resJson.message || '').toLowerCase();
  if (!msg.includes('success')) return false;
  return !/(un|not\s+|non[-\s]?)success|fail|error|invalid|denied|reject/.test(msg);
}

// EasyEcom occasionally answers a SUCCESSFUL create with slightly broken JSON —
// one live row holds `{"code":200,"message":Product Created Successfully","data":…}`
// (opening quote missing). JSON.parse threw, the create was reported as failed
// although the product existed on EasyEcom, and the retry then hit "already
// exists". Falls back to pulling `code` and `message` out of the raw text.
// Returns null when not even a code can be found.
function parseEeResponse_(text) {
  try { return JSON.parse(text); } catch (e) { /* fall through */ }
  const raw  = String(text || '');
  const code = raw.match(/"code"\s*:\s*(\d+)/);
  if (!code) return null;
  const msg = raw.match(/"message"\s*:\s*"?([\s\S]*?)"?\s*(?:,\s*"[A-Za-z_]+"\s*:|\})/);
  return { code: Number(code[1]), message: msg ? msg[1].trim() : '', recovered: true };
}

// What a CreateMasterProduct answer means: 'created' | 'exists' | 'failed'.
// EasyEcom replies `code 200 "Product Already Exists"` for a SKU that is already
// taken — that is NOT a creation, and it used to be treated as one (10 live
// rows), after which the flow overwrote the existing product's identifiers.
function classifyEeCreate_(res) {
  if (!isEeSuccess_(res)) return 'failed';
  return /already\s+exist/i.test(String(res.message || '')) ? 'exists' : 'created';
}

// Is the product already sitting under `sku` on EasyEcom the same product this
// request describes? "Same" = the EE Product Master row for that SKU carries the
// request's Article Number. Returns { ok: true } or { ok: false, message }.
// The master sheet syncs daily, so a SKU created minutes ago may not be in it
// yet — that is reported as unverifiable, never guessed at.
function verifyExistingEeProduct_(sku, articleNumber) {
  const attachHint = 'If you are sure it is the same product, use "Attach Existing EasyEcom SKU"; ' +
                     'otherwise click Auto-assign SKU to get a free number. Nothing was changed.';
  const article = String(articleNumber || '').trim();
  if (!article) {
    return { ok: false, message:
      `SKU ${sku} already exists on EasyEcom, and this request has no Article Number, so I can't confirm it is ` +
      `the same product. ${attachHint}` };
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EE_MASTER);
  if (!sheet) return { ok: false, message: `SKU ${sku} already exists on EasyEcom, but the "${EE_MASTER}" sheet was not found to verify it. ${attachHint}` };
  const data    = sheet.getDataRange().getValues();
  const headers = data[0] || [];
  const skuCol  = headers.indexOf('SKU');
  const artCol  = headers.indexOf('Article Number');
  if (skuCol === -1 || artCol === -1) {
    return { ok: false, message: `SKU ${sku} already exists on EasyEcom, but ${EE_MASTER} has no SKU / Article Number column to verify it. ${attachHint}` };
  }
  const row = data.slice(1).find(r => String(r[skuCol]).trim() === String(sku).trim());
  if (!row) {
    return { ok: false, message:
      `SKU ${sku} already exists on EasyEcom but is not in ${EE_MASTER} yet (it syncs daily), so I can't confirm ` +
      `it is this product. ${attachHint}` };
  }
  const existing = String(row[artCol]).trim();
  if (existing.toLowerCase() !== article.toLowerCase()) {
    return { ok: false, message:
      `SKU ${sku} already belongs to a different product on EasyEcom (its Article Number is "${existing || 'blank'}", ` +
      `this request's is "${article}"). ${attachHint}` };
  }
  return { ok: true };
}

// Writes several cells of one New_SKU_Requests row in as few Sheets calls as
// possible. `colValues` maps a 0-based NSR_COL index to the value to write;
// consecutive columns are merged into one setValues() call, so a save that
// used to make ~33 setValue() round trips makes ~7. Only the columns named in
// `colValues` are ever written — cells outside the map are never re-written
// (re-writing them from a read-back copy could reformat text that merely
// looks numeric).
function writeNsrCells_(sheet, sheetRow, colValues) {
  const cols = Object.keys(colValues).map(Number).sort((a, b) => a - b);
  let i = 0;
  while (i < cols.length) {
    let j = i;
    while (j + 1 < cols.length && cols[j + 1] === cols[j] + 1) j++;
    const run = cols.slice(i, j + 1).map(c => colValues[c]);
    sheet.getRange(sheetRow, cols[i] + 1, 1, run.length).setValues([run]);
    i = j + 1;
  }
}

// Per-key "in flight" marker for long-running external calls (EasyEcom / Zoho
// / Shopify creates). Holding the script-wide lock for the whole external
// call would stall every other writer in the project for seconds; this holds
// it only long enough to test-and-set a CacheService marker, so two
// concurrent creates for the same request can't both run. The marker expires
// on its own (ttlSec) if the execution dies before release().
// Returns { ok: true, release } or { ok: false, reason: 'busy' | 'inflight' }.
function acquireInflight_(key, ttlSec) {
  const lock = LockService.getScriptLock();
  // Wait generously: another writer (e.g. an Update SKU save mid platform-push)
  // can hold the script lock for 10s+, and creation steps never used to take
  // the lock at all — a short wait here would surface as spurious "server
  // busy" failures on a step that used to just work.
  if (!lock.tryLock(20000)) return { ok: false, reason: 'busy' };
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get(key)) return { ok: false, reason: 'inflight' };
    cache.put(key, '1', ttlSec || 120);
    return {
      ok: true,
      release: function () { try { CacheService.getScriptCache().remove(key); } catch (e) {} }
    };
  } finally {
    lock.releaseLock();
  }
}

// Wraps a creation step so only one run per (step, request) executes at a
// time. `impl` is the original, unlocked function body.
function runCreateStepOnce_(step, payload, impl) {
  const gate = acquireInflight_('nsr_' + step + '_' + payload.request_id, 150);
  if (!gate.ok) {
    return errResult_(gate.reason === 'inflight'
      ? 'This step is already running for this request — please wait for it to finish.'
      : 'The server is busy — please try again in a moment.');
  }
  try {
    return impl(payload);
  } finally {
    gate.release();
  }
}

// ─────────────────────────────────────────────────────────────
// AUDIT LOG — shared append-only log for every change that touches
// EasyEcom, Zoho, Shopify, or the internal Purchase Order system.
// ─────────────────────────────────────────────────────────────
// channel: EASYECOM | ZOHO | SHOPIFY | PURCHASE_ORDER | IDENTIFIER_REMOVAL
//   (IDENTIFIER_REMOVAL is defined but nothing feeds it yet — depends on
//   the not-yet-built Sample SKU feature)
// status:  SUCCESS | FAILED

const AUDIT_LOG_SHEET = 'Audit_Log';
const AUDIT_LOG_HEADERS = ['timestamp', 'channel', 'action', 'entity_id', 'summary', 'status', 'actor', 'request_id', 'payload', 'response'];

function ensureAuditLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(AUDIT_LOG_SHEET);
  if (sheet) {
    // Migrate older sheets that predate the payload/response columns —
    // widen the header row in place so existing rows (which just read as
    // blank in the new columns) aren't touched.
    if (sheet.getLastColumn() < AUDIT_LOG_HEADERS.length) {
      const header = sheet.getRange(1, 1, 1, AUDIT_LOG_HEADERS.length);
      header.setValues([AUDIT_LOG_HEADERS]);
      header.setFontWeight('bold');
      header.setBackground('#1E293B');
      header.setFontColor('#FFFFFF');
    }
    return sheet;
  }

  sheet = ss.insertSheet(AUDIT_LOG_SHEET);
  sheet.appendRow(AUDIT_LOG_HEADERS);
  const header = sheet.getRange(1, 1, 1, AUDIT_LOG_HEADERS.length);
  header.setFontWeight('bold');
  header.setBackground('#1E293B');
  header.setFontColor('#FFFFFF');
  Logger.log('Audit_Log sheet created.');
  return sheet;
}

// Best-effort — never throws, so a logging hiccup can't break the real
// operation it's describing. No LockService lock: appendRow is called far
// too often across the app to share a lock with the writes it's logging,
// and row order isn't critical for an audit trail.
// payload/response are optional — the exact request sent to the platform
// and its raw response/error, so a failure can be root-caused from the
// sheet alone instead of needing Stackdriver access. Objects are
// JSON-stringified; strings pass through as-is.
function logAuditEvent_(channel, action, entityId, summary, status, actor, requestId, payload, response) {
  try {
    const sheet = ensureAuditLogSheet_();
    const stringify = v => (v === undefined || v === null || v === '') ? '' : (typeof v === 'string' ? v : JSON.stringify(v));
    sheet.appendRow([
      new Date(), channel, action, entityId || '', summary || '',
      status, actor || 'system', requestId || '', stringify(payload), stringify(response)
    ]);
  } catch(e) {
    Logger.log('logAuditEvent_ error (non-fatal): ' + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// SKU UPDATE REQUESTS — Article Number/Factory Code, RMB Price, and EAN
// correction requests flagged during Vendor Shipment Step 3 (ID / Price /
// EAN Review), reviewed and approved/rejected by an admin in the Update
// SKU → Review Requests subtab before anything touches EasyEcom.
// ─────────────────────────────────────────────────────────────
// status: PENDING | REJECTED | SYNCED | FAILED
//   (Approve and push happen in one action — there's no separate resting
//   "approved but not yet synced" state.)

const SKU_UPDATE_REQUESTS_SHEET = 'SKU_Update_Requests';
const SKU_UPDATE_REQUESTS_HEADERS = [
  'request_id', 'shipment_id', 'vendor_code', 'target_sku', 'item_name', 'color', 'my_id',
  'proposed_factory_code', 'proposed_ean', 'proposed_unit_price',
  'master_factory_code_snapshot', 'master_ean_snapshot', 'master_unit_price_snapshot',
  'status', 'requested_by', 'requested_at', 'resolved_by', 'resolved_at', 'sync_notes'
];

function ensureSkuUpdateRequestsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SKU_UPDATE_REQUESTS_SHEET);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SKU_UPDATE_REQUESTS_SHEET);
  sheet.appendRow(SKU_UPDATE_REQUESTS_HEADERS);
  const header = sheet.getRange(1, 1, 1, SKU_UPDATE_REQUESTS_HEADERS.length);
  header.setFontWeight('bold');
  header.setBackground('#1E293B');
  header.setFontColor('#FFFFFF');
  Logger.log('SKU_Update_Requests sheet created.');
  return sheet;
}


// ─────────────────────────────────────────────────────────────
// 1. GET ALL REQUESTS (with filters)
// ─────────────────────────────────────────────────────────────
// Payload: { action }
// Returns: { success, data: SkuRequest[] }
// Every request, unfiltered — the screens filter client-side. (The old status /
// vendor / date / search filter parameters were never sent by anything.)

function apiGetNewSkuRequests(payload) {
  try {
    const sheet = getNsrSheet_();
    const rows  = sheet.getDataRange().getValues().slice(1); // skip header

    const results = rows
      .filter(r => String(r[NSR_COL.request_id]).trim() !== '')
      .map(r => nsrRowToObject_(r));

    return okResult_(results);
  } catch(e) {
    Logger.log('apiGetNewSkuRequests error: ' + e.message);
    return errResult_(e.message);
  }
}


// ─────────────────────────────────────────────────────────────
// 2. GET SINGLE REQUEST BY ID
// ─────────────────────────────────────────────────────────────
// Payload: { action, request_id }
// Returns: { success, data: SkuRequest }

function apiGetNewSkuRequestById(payload) {
  try {
    const sheet = getNsrSheet_();
    const rows  = sheet.getDataRange().getValues().slice(1);
    const row   = rows.find(r => String(r[NSR_COL.request_id]) === payload.request_id);
    if (!row) return errResult_(`Request ${payload.request_id} not found`);
    return okResult_(nsrRowToObject_(row));
  } catch(e) {
    Logger.log('apiGetNewSkuRequestById error: ' + e.message);
    return errResult_(e.message);
  }
}


// ─────────────────────────────────────────────────────────────
// 3. SAVE DRAFT (write all editable fields to sheet)
// ─────────────────────────────────────────────────────────────
// Payload: { action, request_id, edited_by, form: { ...all editable fields },
//            source? }
//   source is optional and purely informational — the frontend's onBlur
//   save and its timed auto-save both call this same action/validation
//   path unchanged; source only distinguishes them in the Logger for
//   diagnostics.
// Returns: { success, data: { request_id, status } }
// Status transitions: PENDING → IN_PROGRESS on first save
//                     IN_PROGRESS stays unless all mandatory fields done
//
// A short script lock serializes writes to a given row so that rapid
// saves for the same request (e.g. an auto-save firing close to a blur
// save) can't interleave their reads/writes of the sheet and clobber
// each other; it does not change what gets validated or written.

function apiSaveNewSkuDraft(payload) {
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(10000)) {
      return errResult_('Another save is already in progress for this request. Please try again.');
    }

    const sheet = getNsrSheet_();
    const data  = sheet.getDataRange().getValues();
    const rows  = data.slice(1);

    // Find the row index (1-based for sheet, +2 to account for header)
    const rowIdx = rows.findIndex(
      r => String(r[NSR_COL.request_id]) === payload.request_id
    );
    if (rowIdx === -1) return errResult_(`Request ${payload.request_id} not found`);

    const sheetRow = rowIdx + 2; // 1-based + skip header
    const form     = payload.form || {};
    const now      = new Date();

    Logger.log(`apiSaveNewSkuDraft (${payload.source || 'blur'}): ${payload.request_id}`);

    // Every editable field lands in one map and is flushed with a handful of
    // range writes (see writeNsrCells_) instead of one setValue() per cell —
    // this whole function runs under the script-wide lock, so the old ~33
    // sequential calls held up every other writer in the project.
    const cells = {};
    cells[NSR_COL.suggested_sku]         = form.suggested_sku        || '';
    cells[NSR_COL.listing_name]          = form.listing_name         || '';
    cells[NSR_COL.variant]               = form.variant              || '';
    cells[NSR_COL.listing_type]          = form.listing_type         || '';
    cells[NSR_COL.parent_sku]            = form.parent_sku           || '';
    cells[NSR_COL.category]              = form.category             || '';
    cells[NSR_COL.brand]                 = form.brand                || '';
    cells[NSR_COL.mrp]                   = Number(form.mrp)          || '';
    cells[NSR_COL.shopify_selling_price] = Number(form.shopify_selling_price) || '';
    cells[NSR_COL.shopify_compare_price] = Number(form.shopify_compare_price) || '';
    cells[NSR_COL.pkg_height_cm]         = Number(form.pkg_height_cm)|| '';
    cells[NSR_COL.pkg_length_cm]         = Number(form.pkg_length_cm)|| '';
    cells[NSR_COL.pkg_width_cm]          = Number(form.pkg_width_cm) || '';
    cells[NSR_COL.pkg_weight_gm]         = Number(form.pkg_weight_gm)|| '';
    cells[NSR_COL.product_dims_mm]       = form.product_dims_mm      || '';
    cells[NSR_COL.nw_gm]                 = Number(form.nw_gm)        || '';
    cells[NSR_COL.relevant_tags]         = form.relevant_tags        || '';
    cells[NSR_COL.fnsku]                 = form.fnsku                || '';
    cells[NSR_COL.fnsku_status_ee]       = form.fnsku_status_ee      || '';
    cells[NSR_COL.remark]                = form.remark               || '';
    cells[NSR_COL.notes]                 = form.notes                || '';
    cells[NSR_COL.lead_time]             = Number(form.lead_time)    || '';
    cells[NSR_COL.moq]                   = Number(form.moq)          || '';
    cells[NSR_COL.threshold_qty]         = Number(form.threshold_qty)|| '';
    cells[NSR_COL.supplier_code]         = form.supplier_code        || '';
    cells[NSR_COL.pack_size]             = Number(form.pack_size)    || '';
    cells[NSR_COL.factory_code]          = form.factory_code         || '';
    cells[NSR_COL.ean]                   = form.ean                  || '';
    cells[NSR_COL.unit_price]            = Number(form.unit_price)   || '';
    cells[NSR_COL.is_sample]             = !!form.is_sample;

    // Audit trail
    cells[NSR_COL.last_edited_at] = now;
    cells[NSR_COL.last_edited_by] = payload.edited_by || '';

    // Status transition: PENDING → IN_PROGRESS on first save. Status is read
    // fresh (not from the `data` snapshot taken before the lock was won) —
    // the platform-creation steps move it to ACTION_REQ/CREATED without
    // taking this lock, and a stale 'PENDING' here would overwrite that.
    const currentStatus = String(sheet.getRange(sheetRow, NSR_COL.status + 1).getValue());
    if (currentStatus === 'PENDING') {
      cells[NSR_COL.status] = 'IN_PROGRESS';
    }

    writeNsrCells_(sheet, sheetRow, cells);
    SpreadsheetApp.flush();

    return okResult_({
      request_id: payload.request_id,
      status: currentStatus === 'PENDING' ? 'IN_PROGRESS' : currentStatus,
      last_edited_at: now.toISOString(),
    });
  } catch(e) {
    Logger.log('apiSaveNewSkuDraft error: ' + e.message);
    return errResult_(e.message);
  } finally {
    lock.releaseLock();
  }
}


// ─────────────────────────────────────────────────────────────
// 4. GET NEXT AVAILABLE SKU
// ─────────────────────────────────────────────────────────────
// Payload: { action, category, request_id? }
// Returns: { success, data: { suggested_sku, prefix, warning? } }
// Logic: find prefix from SKU_PREFIX_MAP → scan EE Product Master
//        for highest numeric SKU in that prefix → return highest + 1
//
// The scan counts every number already TAKEN: live on EasyEcom (master sheet),
// created through this screen (ee_sku), AND merely drafted on another open
// request (suggested_sku, rejected requests excluded). It used to look only at
// created SKUs, so a number drafted for one request was handed out again to the
// next one — 4 live requests ended up sharing a SKU that way. `request_id` (the
// request being assigned) is left out of the scan so re-clicking Auto-assign on
// the same request doesn't skip forward. When a request_id is given and its row
// exists, the chosen number is also written to that row before the lock is
// released, so two people assigning at the same moment can't get the same one.
function apiGetNextAvailableSku(payload) {
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    const category  = payload.category;
    const prefixMap = getSkuPrefixMap_();
    const entry     = prefixMap[category];

    if (!entry) {
      return errResult_(`No SKU prefix configured for category: ${category}`);
    }

    const { prefix, floorSku } = entry;
    const isNumericPrefix = /^\d+$/.test(prefix);

    if (!isNumericPrefix) {
      return okResult_({
        suggested_sku:   prefix,
        prefix,
        total_in_series: 0,
        warning: `Category "${category}" uses alpha prefix "${prefix}". ` +
                 `Auto-assignment not supported. Please enter SKU manually.`,
      });
    }

    if (!lock.tryLock(15000)) {
      return errResult_('Another SKU assignment is in progress. Please try again in a moment.');
    }
    locked = true;

    const ss          = SpreadsheetApp.getActiveSpreadsheet();
    const masterSheet = ss.getSheetByName(EE_MASTER);
    if (!masterSheet) return errResult_(`Sheet "${EE_MASTER}" not found`);

    const masterData = masterSheet.getDataRange().getValues();
    const headers    = masterData[0];
    const skuColIdx  = headers.indexOf('SKU');
    if (skuColIdx === -1) return errResult_(`"SKU" column not found in ${EE_MASTER}`);

    let maxNum      = floorSku - 1;
    let matchedSkus = [];

    // ── Scan EE Product Master (daily sync) ──
    for (let i = 1; i < masterData.length; i++) {
      const sku = String(masterData[i][skuColIdx]).trim();
      if (!sku || !/^\d{7}$/.test(sku)) continue;
      if (!sku.startsWith(prefix))       continue;
      const num = parseInt(sku, 10);
      if (num < floorSku) continue;
      matchedSkus.push(sku);
      if (num > maxNum) maxNum = num;
    }

    // ── Also scan New_SKU_Requests (real-time) ──
    // EE Product Master syncs daily — the NSR sheet has SKUs created today
    // (ee_sku) and numbers already reserved by open drafts (suggested_sku).
    const nsrSheet = ss.getSheetByName(NSR_SHEET);
    let ownRowNumber = -1;
    if (nsrSheet) {
      const nsrData = nsrSheet.getDataRange().getValues().slice(1);
      nsrData.forEach((row, i) => {
        const isOwn      = !!payload.request_id && String(row[NSR_COL.request_id]) === String(payload.request_id);
        const isRejected = String(row[NSR_COL.status]).trim() === 'REJECTED';
        if (isOwn) ownRowNumber = i + 2;
        const taken = [row[NSR_COL.ee_sku]];
        if (!isOwn && !isRejected) taken.push(row[NSR_COL.suggested_sku]);
        taken.forEach(v => {
          const recentSku = String(v || '').trim();
          if (!recentSku || !/^\d{7}$/.test(recentSku)) return;
          if (!recentSku.startsWith(prefix)) return;
          const num = parseInt(recentSku, 10);
          if (num < floorSku) return;
          if (!matchedSkus.includes(recentSku)) {
            matchedSkus.push(recentSku);
            Logger.log(`getNextAvailableSku: found recent SKU in NSR: ${recentSku}`);
          }
          if (num > maxNum) maxNum = num;
        });
      });
    }

    const suggestedSku = String(maxNum + 1);

    // Reserve it on the request's own row while still holding the lock — but
    // never on a request that is already live or closed (its SKU is settled).
    if (ownRowNumber > 0) {
      const ownStatus = String(nsrSheet.getRange(ownRowNumber, NSR_COL.status + 1).getValue()).trim();
      const ownEeSku  = String(nsrSheet.getRange(ownRowNumber, NSR_COL.ee_sku + 1).getValue()).trim();
      if (ownStatus !== 'REJECTED' && ownStatus !== 'CREATED' && !ownEeSku) {
        nsrSheet.getRange(ownRowNumber, NSR_COL.suggested_sku + 1).setValue(suggestedSku);
        SpreadsheetApp.flush();
      }
    }

    Logger.log(
      `getNextAvailableSku: category=${category}, prefix=${prefix}, ` +
      `floor=${floorSku}, maxNum=${maxNum}, suggested=${suggestedSku}, ` +
      `matched=${matchedSkus.length}`
    );

    return okResult_({
      suggested_sku:   suggestedSku,
      prefix,
      floor_sku:       floorSku,
      total_in_series: matchedSkus.length,
      warning:         null,
    });

  } catch(e) {
    Logger.log('apiGetNextAvailableSku error: ' + e.message);
    return errResult_(e.message);
  } finally {
    if (locked) lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────
// 5. GET PRICING CONFIG
// ─────────────────────────────────────────────────────────────
// Payload: { action }
// Returns: { success, data: { cny_conv_rate, shipping_factor,
//                             mrp_factor, margin_factor } }

function apiGetPricingConfig(payload) {
  try {
    const sheet = getSkuConfigSheet_();
    const configMap = readPricingConfigMap_(sheet);

    const getNum = (key, fallback) =>
      configMap[key] !== undefined && configMap[key] !== ''
        ? Number(configMap[key]) : fallback;

    // Parse bracket rows — prefix match e.g. CM1_BRACKET_*
    const parseBrackets = (prefix) => {
      const brackets = [];
      Object.keys(configMap).forEach(key => {
        if (!key.startsWith(prefix)) return;
        const floorStr = key.replace(prefix, '');
        // FIX: treat INF as a very large number instead of Infinity
        const floor = floorStr === 'INF' ? 999999 : Number(floorStr);
        brackets.push({ floor, value: Number(configMap[key]) });
      });
      return brackets.sort((a, b) => a.floor - b.floor);
    };
    return okResult_({
      // Scalar config
      cny_conv_rate:    getNum('CNY_CONV_RATE',    14.36),
      air_rate:         getNum('AIR_RATE',          1.6),
      sea_multiplier:   getNum('SEA_MULTIPLIER',    1.35),
      threshold:        getNum('THRESHOLD',         40),
      pick_pack:        getNum('PICK_PACK',         85),
      shopify_cost_pct: getNum('SHOPIFY_COST_PCT',  0.18),
      min_margin_pct:   getNum('MIN_MARGIN_PCT',    20),
      gst_rate:         getNum('GST_RATE',          0.05),
      // Bracket tables
      cm1_brackets:        parseBrackets('CM1_BRACKET_'),
      cm1_floor_brackets:  parseBrackets('CM1_FLOOR_BRACKET_'),
      cm3_target_brackets: parseBrackets('CM3_TARGET_BRACKET_'),
      cm3_floor_brackets:  parseBrackets('CM3_FLOOR_BRACKET_'),
      mrp_brackets:     parseBrackets('MRP_BRACKET_'),
      compare_brackets: parseBrackets('COMPARE_BRACKET_'),
    });
  } catch(e) {
    Logger.log('apiGetPricingConfig error: ' + e.message);
    return errResult_(e.message);
  }
}

// KEY -> value for every pricing setting: the pricing block (G:H) and the
// brackets block (N:O), the former winning if a key appears in both. (GST_RATE
// currently lives in N:O.)
function readPricingConfigMap_(sheet) {
  const map = {};
  [
    [SKU_CONFIG_COLS.priceKey,   SKU_CONFIG_COLS.priceVal],
    [SKU_CONFIG_COLS.bracketKey, SKU_CONFIG_COLS.bracketVal],
  ].forEach(([keyCol, valCol]) => {
    readSkuConfigPairs_(sheet, keyCol, valCol).forEach(p => {
      if (map[p.key] === undefined) map[p.key] = p.value;
    });
  });
  return map;
}

// Keys the Settings > Pricing Config screen may write. Anything else is
// rejected: this used to append whatever key a request named into the sheet.
const PRICING_SCALAR_KEYS_ = [
  'CNY_CONV_RATE', 'SEA_MULTIPLIER', 'PICK_PACK', 'MIN_MARGIN_PCT',
  'AIR_RATE', 'THRESHOLD', 'SHOPIFY_COST_PCT', 'GST_RATE',
];
const PRICING_BRACKET_KEY_RE_ = /^(CM1|CM1_FLOOR|CM3_TARGET|CM3_FLOOR|MRP|COMPARE)_BRACKET_\d+$/;

// Highest row that has anything in `col` (0 if none).
function lastFilledRowInColumn_(sheet, col) {
  const vals = sheet.getRange(1, col, Math.max(sheet.getLastRow(), 1), 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]).trim() !== '') return i + 1;
  }
  return 0;
}

// Writes { row: value } into one column using as few range writes as possible
// (consecutive rows merge into one setValues call). Only the listed cells are
// written.
function writeColumnCells_(sheet, col, rowValues) {
  const rows = Object.keys(rowValues).map(Number).sort((a, b) => a - b);
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1] === rows[j] + 1) j++;
    sheet.getRange(rows[i], col, j - i + 1, 1).setValues(rows.slice(i, j + 1).map(r => [rowValues[r]]));
    i = j + 1;
  }
}

// Settings > Pricing Config "Save". Payload: { config: { KEY: number, ... } }.
// Each key is updated where it already lives (G:H or N:O); a key that is not
// in the sheet yet is appended to the end of the matching block (bracket keys
// to N:O, everything else to G:H) — never to column A.
function apiSavePricingConfig(payload) {
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    if (!payload || !payload.config || typeof payload.config !== 'object') {
      throw new Error('Missing config payload');
    }
    const updates = payload.config;
    const keys = Object.keys(updates);

    const bad = keys.filter(k =>
      !(PRICING_SCALAR_KEYS_.indexOf(k) !== -1 || PRICING_BRACKET_KEY_RE_.test(k)) ||
      updates[k] === '' || updates[k] === null || !isFinite(Number(updates[k]))
    );
    if (bad.length) throw new Error('Invalid pricing config key/value: ' + bad.join(', '));

    if (!lock.tryLock(10000)) return errResult_('Another save is in progress. Please try again.');
    locked = true;

    const sheet = getSkuConfigSheet_();
    const blocks = [
      { keyCol: SKU_CONFIG_COLS.priceKey,   valCol: SKU_CONFIG_COLS.priceVal,   accepts: k => !PRICING_BRACKET_KEY_RE_.test(k) },
      { keyCol: SKU_CONFIG_COLS.bracketKey, valCol: SKU_CONFIG_COLS.bracketVal, accepts: k => PRICING_BRACKET_KEY_RE_.test(k) },
    ];

    const changes = blocks.map(() => ({}));      // per block: { row: value }
    const found = {};                            // key -> true once located in any block
    blocks.forEach((blk, bi) => {
      readSkuConfigPairs_(sheet, blk.keyCol, blk.valCol).forEach(p => {
        if (Object.prototype.hasOwnProperty.call(updates, p.key)) {
          changes[bi][p.row] = Number(updates[p.key]);
          found[p.key] = true;
        }
      });
    });

    // Keys not in the sheet yet -> append to the end of their block.
    const appended = blocks.map(() => []);
    keys.filter(k => !found[k]).forEach(k => {
      const bi = blocks.findIndex(b => b.accepts(k));
      appended[bi].push([k, Number(updates[k])]);
    });

    blocks.forEach((blk, bi) => {
      writeColumnCells_(sheet, blk.valCol, changes[bi]);
      if (appended[bi].length) {
        const start = lastFilledRowInColumn_(sheet, blk.keyCol) + 1;
        sheet.getRange(start, blk.keyCol, appended[bi].length, blk.valCol - blk.keyCol + 1).setValues(appended[bi]);
      }
    });

    SpreadsheetApp.flush();
    return okResult_({ updated: keys });
  } catch (e) {
    Logger.log('apiSavePricingConfig error: ' + e.message);
    return errResult_(e.message);
  } finally {
    if (locked) lock.releaseLock();
  }
}


// ─────────────────────────────────────────────────────────────
// 6. GET TAGS BY CATEGORY
// ─────────────────────────────────────────────────────────────
// Payload: { action, category }
// Returns: { success, data: { tags, collections } }
// Sheet: "Shopify Collection & Tags"
//   Col A = CATEGORY (numeric code e.g. 103)
//   Col B = Product Type (e.g. "3x3")
//   Col C = TAGS (comma-separated)
//   Col D = Collections (comma-separated)

function apiGetTagsByCategory(payload) {
  try {
    const category = payload.category; // e.g. "3x3"
    const ss       = SpreadsheetApp.getActiveSpreadsheet();
    const sheet    = ss.getSheetByName(TAGS_SHEET);
    if (!sheet) return errResult_(`Sheet "${TAGS_SHEET}" not found`);

    const rows = sheet.getDataRange().getValues().slice(1); // skip header

    // Match by Product Type (col B = index 1)
    const match = rows.find(r =>
      String(r[1]).trim().toLowerCase() === category.trim().toLowerCase()
    );

    if (!match) {
      return okResult_({ tags: '', collections: '', warning: `No tags found for category: ${category}` });
    }

    return okResult_({
      tags:        String(match[2] || '').trim(),
      collections: String(match[3] || '').trim(),
    });
  } catch(e) {
    Logger.log('apiGetTagsByCategory error: ' + e.message);
    return errResult_(e.message);
  }
}


// ─────────────────────────────────────────────────────────────
// 7. CREATE SKU ON EASYECOM
// ─────────────────────────────────────────────────────────────
// Payload: { action, request_id }
// Reads the full row from sheet, calls EE CreateMasterProduct,
// then updateCustomFieldsSmart, then SKU_EAN_UPDATE if EAN blank.
// Writes ee_sku, ee_product_name, ee_api_response back.
// On success: status → ACTION_REQ (zoho next)

function apiCreateSkuOnEasyEcom(payload) {
  return runCreateStepOnce_('ee', payload, createSkuOnEasyEcom_);
}

function createSkuOnEasyEcom_(payload) {
  try {
    const sheet  = getNsrSheet_();
    const data   = sheet.getDataRange().getValues();
    const rows   = data.slice(1);
    const rowIdx = rows.findIndex(
      r => String(r[NSR_COL.request_id]) === payload.request_id
    );
    if (rowIdx === -1) return errResult_(`Request ${payload.request_id} not found`);

    const row      = rows[rowIdx];
    const sheetRow = rowIdx + 2;
    const obj      = nsrRowToObject_(row);

    // Already created (a previous click, the dashboard's Retry action, or a
    // second browser tab got here first). Report it as done rather than
    // calling CreateMasterProduct again — the duplicate call would come back
    // as an EasyEcom error and overwrite the stored success response and
    // audit trail with a spurious FAILED entry.
    if (obj.ee_sku) {
      return okResult_({
        request_id:      payload.request_id,
        ee_sku:          obj.ee_sku,
        ee_product_name: obj.ee_product_name,
        status:          obj.status,
        already_created: true,
      });
    }

    if (!obj.parent_sku && payload.parent_sku) {
  obj.parent_sku = payload.parent_sku;
  }
  if (!obj.listing_type && payload.listing_type) {
  obj.listing_type = payload.listing_type;
  }

    // ── Validate mandatory fields ──
    // Item Weight (nw_gm), Size (pack_size), EAN/ID (ean), Pkg Weight
    // (pkg_weight_gm), and Pkg Size (pkg_height_cm/pkg_length_cm/pkg_width_cm)
    // are intentionally NOT required here — they can be filled in later
    // without blocking listing creation.
    const missing = [];
    if (!obj.suggested_sku) missing.push('suggested_sku');
    if (!obj.listing_name)  missing.push('listing_name');
    if (!obj.brand)         missing.push('brand');
    if (!obj.mrp)           missing.push('mrp');
    if (!obj.unit_price || obj.unit_price === 0) missing.push('unit_price (RMB cost)');
    if (missing.length > 0) {
      return errResult_(`Missing mandatory fields: ${missing.join(', ')}. Save draft first.`);
    }
    if (!obj.shopify_selling_price) 
      return errResult_('Selling Price is required. Save draft first.');
    if (!obj.mrp) 
      return errResult_('MRP is required. Save draft first.');

    const token = getEasyEcomToken();

    // ── EAN — omit entirely if blank ──
    const ean = obj.ean ? String(obj.ean).trim() : '';

    // ── Factory code split ──
    const factoryRaw       = String(obj.factory_code || '').trim();
    const hasPipe          = factoryRaw.includes('|');
    const factoryParts     = factoryRaw.split('|');
    const finalAccountingSKU = hasPipe ? factoryParts[0].trim() : '';
    const finalArticleNumber = hasPipe ? factoryParts[1].trim() : factoryRaw;

    // ── Pricing ──
    const pricingConfig = apiGetPricingConfig({}).data;
    const pricing = calculatePricing_(obj.unit_price, obj.pkg_weight_gm, pricingConfig);

    if (!pricing) {
      return errResult_(explainPricingFailure_(obj.unit_price, obj.pkg_weight_gm, pricingConfig));
    }

    // ── Model name ──
    const modelName = obj.variant
      ? `${obj.listing_name} ${obj.variant}`
      : obj.listing_name;

    // ── EE Payload ──
    const eePayload = {
      Sku:            obj.suggested_sku,
      ModelName:      modelName,
      Brand:          obj.brand,
      Category:       'Active_SKUs',
      Color:          obj.color || '',
      Cost:           pricing.landing,
      AccountingUnit: obj.mrp,
      AccountingSKU:  finalAccountingSKU,
      ModelNumber:    obj.fnsku || obj.suggested_sku,
      //Mrp:            obj.shopify_selling_price || pricing.final_sp,
      Mrp: obj.shopify_selling_price,
      Size:           obj.pack_size || '',
      TaxRate:        '5',
      itemType:       '0',
      materialType:   1,
      Height:         obj.pkg_height_cm,
      Length:         obj.pkg_length_cm,
      Width:          obj.pkg_width_cm,
      Weight:         obj.pkg_weight_gm,
      ProductTaxCode: '95036090',
      ...(ean ? { EANUPC: ean } : {}),
      customFields: {
        'Article Number': finalArticleNumber,
        'RMB_PRICE':      obj.unit_price,
        'Lead_Time':      obj.lead_time    || '',
        'MOQ':            obj.moq          || '',
        'Threshold_Qty':  obj.threshold_qty|| '',
        'Supplier_Code':  obj.supplier_code|| '',
        'Pack Size':      obj.pack_size    || '',
        'Remark':         obj.remark       || '',
        ...(ean ? { 'EAN': ean } : {}),
      }
    };

    const headers = {
      'Authorization': 'Bearer ' + token,
      'x-api-key':     EE_API_KEY,
      'Content-Type':  'application/json',
    };

    const response = UrlFetchApp.fetch(
      'https://api.easyecom.io/Products/CreateMasterProduct',
      { method: 'POST', headers, payload: JSON.stringify(eePayload),
        muteHttpExceptions: true }
    );

    const resText = response.getContentText();
    const resJson = parseEeResponse_(resText);
    Logger.log('EE CreateMasterProduct response: ' + resText);

    // Write API response regardless of outcome
    sheet.getRange(sheetRow, NSR_COL.ee_api_response + 1).setValue(resText);

    if (!resJson) {
      // Not even a status code in the answer: the product may or may not exist.
      SpreadsheetApp.flush();
      logAuditEvent_('EASYECOM', 'CREATE', obj.suggested_sku, 'Unreadable EasyEcom response', 'FAILED', payload.edited_by, payload.request_id);
      return errResult_(
        `EasyEcom sent back a response I could not read: "${resText.slice(0, 200).trim()}". ` +
        `The product may or may not have been created — check EasyEcom for SKU ${obj.suggested_sku} ` +
        `before retrying (if it is there, use "Attach Existing EasyEcom SKU").`
      );
    }

    const outcome = classifyEeCreate_(resJson);

    if (outcome === 'failed') {
      SpreadsheetApp.flush();
      logAuditEvent_('EASYECOM', 'CREATE', obj.suggested_sku, resJson.message || 'EE API error', 'FAILED', payload.edited_by, payload.request_id);
      return errResult_(`EE API error: ${resJson.message || resText}`);
    }

    // EasyEcom says the SKU is already taken. Only carry on if what is there is
    // THIS product (same Article Number); otherwise stop before touching it —
    // going on would overwrite the other product's Article Number / RMB price
    // and link this request to its Zoho and Shopify listings.
    if (outcome === 'exists') {
      const same = verifyExistingEeProduct_(obj.suggested_sku, finalArticleNumber);
      if (!same.ok) {
        SpreadsheetApp.flush();
        logAuditEvent_('EASYECOM', 'CREATE', obj.suggested_sku, 'SKU already exists — not confirmed as this product', 'FAILED', payload.edited_by, payload.request_id, null, resText);
        return errResult_(same.message);
      }
    }

    // ── Write back ──
    const eeSku = obj.suggested_sku;
    sheet.getRange(sheetRow, NSR_COL.ee_sku + 1).setValue(eeSku);
    sheet.getRange(sheetRow, NSR_COL.ee_product_name + 1).setValue(modelName);

    // Write SKU to Vendor_Shipment_Lines if shipment-based
    if (obj.shipment_id && obj.factory_code) {
      const written = writeSkuToShipmentLine_(
        obj.shipment_id, obj.factory_code, eeSku
      );
      Logger.log(`writeSkuToShipmentLine_: ${written ? '✅' : '⚠️ not written'}`);
    }

    // Verified as this same product already on EasyEcom: link it, like "Attach
    // Existing" does — no identifier overwrite, no master-sheet rewrite.
    if (outcome === 'exists') {
      sheet.getRange(sheetRow, NSR_COL.status + 1).setValue('ACTION_REQ');
      sheet.getRange(sheetRow, NSR_COL.last_edited_at + 1).setValue(new Date());
      SpreadsheetApp.flush();
      logAuditEvent_('EASYECOM', 'ATTACH', eeSku, `Already on EasyEcom (same Article Number) — linked "${modelName}"`, 'SUCCESS', payload.edited_by, payload.request_id);
      return okResult_({
        request_id:      payload.request_id,
        ee_sku:          eeSku,
        ee_product_name: modelName,
        status:          'ACTION_REQ',
        already_existed: true,
      });
    }

    // Update AccountingSKU + Article Number via dedicated function
    if (obj.factory_code) {
      setNewSkuFactoryFields_(eeSku, obj.factory_code, obj.unit_price);
    } else {
      updateCustomFieldsSmart([{
        sku:          eeSku,
        factory_code: '',
        rmb_price:    obj.unit_price,
      }]);
    }

    // Mirror into EE Product Master immediately — see upsertEeProductMasterRow_
    // for why (don't wait on the next scheduled EasyEcom resync). Best-effort:
    // the SKU is already live on EasyEcom at this point, so a hiccup here
    // shouldn't surface as a creation failure to the user.
    try {
      upsertEeProductMasterRow_({
        'SKU':                     eeSku,
        'Product Name':            modelName,
        'Brand':                   obj.brand,
        'Category Name':           'Active_SKUs',
        'Cost':                    pricing.landing,
        'POS Selling Price':       obj.shopify_selling_price,
        'Pack Size':               obj.pack_size || '',
        'Height':                  obj.pkg_height_cm || '',
        'Length':                  obj.pkg_length_cm || '',
        'Width':                   obj.pkg_width_cm || '',
        'Weight':                  obj.pkg_weight_gm || '',
        'MRP':                     obj.mrp,
        'EE Scan Identifier':      ean,
        'FNSKU':                   obj.fnsku || eeSku,
        'EAN':                     ean,
        'Article Number':          finalArticleNumber,
        'Other Factory Item Code': finalAccountingSKU,
        'Lead_Time':               obj.lead_time     || '',
        'MOQ':                     obj.moq           || '',
        'Threshold_Qty':           obj.threshold_qty || '',
        'Supplier_Code':           obj.supplier_code || '',
        'RMB_Price':               obj.unit_price,
      });
    } catch(syncErr) {
      Logger.log('apiCreateSkuOnEasyEcom: EE Product Master sync failed — ' + syncErr.message);
    }

    // Status → ACTION_REQ (Zoho next)
    sheet.getRange(sheetRow, NSR_COL.status + 1).setValue('ACTION_REQ');
    sheet.getRange(sheetRow, NSR_COL.last_edited_at + 1).setValue(new Date());
    SpreadsheetApp.flush();

    logAuditEvent_('EASYECOM', 'CREATE', eeSku, `Created "${modelName}"`, 'SUCCESS', payload.edited_by, payload.request_id);

    return okResult_({
      request_id:      payload.request_id,
      ee_sku:          eeSku,
      ee_product_name: modelName,
      status:          'ACTION_REQ',
    });

  } catch(e) {
    Logger.log('apiCreateSkuOnEasyEcom error: ' + e.message);
    logAuditEvent_('EASYECOM', 'CREATE', payload.request_id, e.message, 'FAILED', payload.edited_by, payload.request_id);
    return errResult_(e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// ATTACH EXISTING EASYECOM SKU — skip creation, link an SKU that
// already exists in EE Product Master (e.g. created through some
// other path) to this request instead of recreating it.
// ─────────────────────────────────────────────────────────────
// Payload: { action, request_id }
// Looks up this request's own suggested_sku (exact match only) in
// EE Product Master. Does NOT call the EasyEcom CreateMasterProduct
// API, and does NOT touch the existing product's custom fields
// (AccountingSKU / Article Number / RMB price) — those belong to
// whatever process created it originally.
// Writes back the same ee_sku / ee_product_name / status fields a
// real creation would, so platformStatus.ee reads true afterward and
// the Zoho step unlocks normally.
// Returns: { success, data: { request_id, ee_sku, ee_product_name, status } }

function apiAttachExistingEasyEcomSku(payload) {
  try {
    const sheet  = getNsrSheet_();
    const data   = sheet.getDataRange().getValues();
    const rows   = data.slice(1);
    const rowIdx = rows.findIndex(
      r => String(r[NSR_COL.request_id]) === payload.request_id
    );
    if (rowIdx === -1) return errResult_(`Request ${payload.request_id} not found`);

    const row      = rows[rowIdx];
    const sheetRow = rowIdx + 2;
    const obj      = nsrRowToObject_(row);

    if (!obj.suggested_sku) {
      return errResult_('Suggested SKU is required before attaching an existing EasyEcom SKU. Save draft first.');
    }
    if (obj.ee_sku) {
      return errResult_('An EasyEcom SKU is already attached to this request.');
    }

    const masterSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EE_MASTER);
    if (!masterSheet) return errResult_(`Sheet "${EE_MASTER}" not found`);

    const masterData = masterSheet.getDataRange().getValues();
    const headers     = masterData[0];
    const skuColIdx   = headers.indexOf('SKU');
    const nameColIdx  = headers.indexOf('Product Name');
    if (skuColIdx === -1)  return errResult_('"SKU" column not found in EE Product Master');
    if (nameColIdx === -1) return errResult_('"Product Name" column not found in EE Product Master');

    const matchRow = masterData.slice(1).find(
      r => String(r[skuColIdx]).trim() === obj.suggested_sku
    );
    if (!matchRow) {
      return errResult_(`SKU "${obj.suggested_sku}" was not found in EE Product Master. Create it normally, or double-check the Suggested SKU value.`);
    }

    const productName = String(matchRow[nameColIdx]).trim() || obj.listing_name;

    sheet.getRange(sheetRow, NSR_COL.ee_sku + 1).setValue(obj.suggested_sku);
    sheet.getRange(sheetRow, NSR_COL.ee_product_name + 1).setValue(productName);
    sheet.getRange(sheetRow, NSR_COL.status + 1).setValue('ACTION_REQ');
    sheet.getRange(sheetRow, NSR_COL.last_edited_at + 1).setValue(new Date());
    SpreadsheetApp.flush();

    logAuditEvent_('EASYECOM', 'ATTACH', obj.suggested_sku, `Attached existing EasyEcom SKU "${productName}"`, 'SUCCESS', payload.edited_by, payload.request_id);

    return okResult_({
      request_id:      payload.request_id,
      ee_sku:          obj.suggested_sku,
      ee_product_name: productName,
      status:          'ACTION_REQ',
    });
  } catch(e) {
    Logger.log('apiAttachExistingEasyEcomSku error: ' + e.message);
    logAuditEvent_('EASYECOM', 'ATTACH', payload.request_id, e.message, 'FAILED', payload.edited_by, payload.request_id);
    return errResult_(e.message);
  }
}

// Called immediately after CreateMasterProduct succeeds
// Sets AccountingSku and Article Number on the newly created SKU
// Uses UpdateMasterProduct endpoint directly — no sheet lookup needed

function setNewSkuFactoryFields_(sku, factoryCode, rmbPrice) {
  try {
    if (!sku) {
      Logger.log('setNewSkuFactoryFields_: missing sku');
      return false;
    }

    const factoryRaw    = String(factoryCode || '').trim();
    const hasPipe       = factoryRaw.includes('|');
    const parts         = factoryRaw.split('|');
    const accountingSku = hasPipe ? parts[0].trim() : '';
    const articleNumber = hasPipe ? parts[1].trim() : factoryRaw;

    const token = getEasyEcomToken();

    const payload = {
      sku:          sku,
      AccountingSKU: accountingSku,
      customFields: {
        'Article Number': articleNumber,
        'RMB_PRICE':      rmbPrice || '',
      }
    };

    Logger.log('setNewSkuFactoryFields_ payload: ' + JSON.stringify(payload));

    const response = UrlFetchApp.fetch(
      'https://api.easyecom.io/Products/UpdateMasterProduct',
      {
        method:          'post',
        headers: {
          'Authorization': 'Bearer ' + token,
          'x-api-key':     EE_API_KEY,
          'Content-Type':  'application/json',
        },
        payload:            JSON.stringify(payload),
        muteHttpExceptions: true,
      }
    );

    const resJson = JSON.parse(response.getContentText());
    Logger.log('setNewSkuFactoryFields_ response: ' + response.getContentText());

    if (isEeSuccess_(resJson)) {
      Logger.log(`setNewSkuFactoryFields_: ✅ ${sku} — ` +
                 `AccountingSKU="${accountingSku}", Article="${articleNumber}"`);
      return true;
    } else {
      Logger.log(`setNewSkuFactoryFields_: ❌ ${sku} — ${resJson.message}`);
      return false;
    }

  } catch(e) {
    Logger.log('setNewSkuFactoryFields_ error: ' + e.message);
    return false;
  }
}

// Mirrors a just-created SKU into the 'EE Product Master' sheet immediately,
// rather than waiting for the next scheduled full EasyEcom resync
// (writeEcomProductsToSheet in EEcom_api_code.js, which does a full
// clearContents()+rewrite on its own timer). Without this, a SKU created
// here — and anything that depends on EE Product Master being current, e.g.
// the EAN/Factory Code/Article Number duplicate check on the Update SKU
// screen (apiGetProductIdentifiers) — is invisible until that next resync
// runs. Upserts by SKU so a retry of this same creation call updates the
// row in place instead of appending a duplicate.
//
// rowData keys are the sheet's actual header names (see the `headers` array
// in EEcom_api_code.js's writeEcomProductsToSheet for the canonical list) —
// any key not present in the sheet's header row is silently ignored, and any
// header this row doesn't set is left blank, matching a real EasyEcom
// resync's own behavior for a brand-new SKU with no purchase/inventory
// history yet (Product ID, Inventory, Product Type aren't known here).
function upsertEeProductMasterRow_(rowData) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('EE Product Master');
    if (!sheet) {
      Logger.log('upsertEeProductMasterRow_: EE Product Master sheet not found');
      return false;
    }

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const skuCol  = headers.indexOf('SKU');
    if (skuCol === -1) {
      Logger.log('upsertEeProductMasterRow_: no SKU column in EE Product Master');
      return false;
    }

    const sku = String(rowData['SKU'] || '').trim();
    if (!sku) {
      Logger.log('upsertEeProductMasterRow_: missing SKU in rowData');
      return false;
    }

    const existingRowIdx = data.findIndex((r, i) => i > 0 && String(r[skuCol]).trim() === sku);
    if (existingRowIdx > 0) {
      // Merge into the existing row — only overwrite columns rowData
      // actually supplies, so fields this creation flow doesn't know about
      // (Product ID, Inventory, Product Type, etc., from a prior real
      // EasyEcom resync) survive instead of getting blanked.
      const merged = data[existingRowIdx].slice();
      headers.forEach((h, i) => {
        if (Object.prototype.hasOwnProperty.call(rowData, h)) merged[i] = rowData[h];
      });
      sheet.getRange(existingRowIdx + 1, 1, 1, merged.length).setValues([merged]);
      Logger.log(`upsertEeProductMasterRow_: updated existing row for ${sku}`);
    } else {
      const rowValues = headers.map(h =>
        Object.prototype.hasOwnProperty.call(rowData, h) ? rowData[h] : ''
      );
      sheet.appendRow(rowValues);
      Logger.log(`upsertEeProductMasterRow_: appended new row for ${sku}`);
    }
    SpreadsheetApp.flush();
    invalidateSheetCache_('EE Product Master');
    return true;
  } catch(e) {
    Logger.log('upsertEeProductMasterRow_ error: ' + e.message);
    return false;
  }
}

// Generalized EasyEcom update — used by the Update SKU screen. Same
// UpdateMasterProduct endpoint as setNewSkuFactoryFields_, but accepts
// arbitrary top-level fields (Cost, Mrp, Size, Height/Length/Width/Weight,
// EANUPC) plus customFields, so an edit only sends what changed.
// CAVEAT: UpdateMasterProduct has only ever been exercised here for
// AccountingSKU + 2 customFields — the full field set below is untested
// against the live API and should be verified before trusting it in
// production (see plan's Verification section).
function updateEasyEcomProduct_(sku, fields, customFields) {
  try {
    if (!sku) return { ok: false, message: 'sku is required' };

    const token = getEasyEcomToken();
    const payload = { sku: sku, ...fields };
    if (customFields && Object.keys(customFields).length > 0) {
      payload.customFields = customFields;
    }

    Logger.log('updateEasyEcomProduct_ payload: ' + JSON.stringify(payload));

    const response = UrlFetchApp.fetch(
      'https://api.easyecom.io/Products/UpdateMasterProduct',
      {
        method: 'post',
        headers: {
          'Authorization': 'Bearer ' + token,
          'x-api-key':     EE_API_KEY,
          'Content-Type':  'application/json',
        },
        payload:            JSON.stringify(payload),
        muteHttpExceptions: true,
      }
    );

    const resJson = JSON.parse(response.getContentText());
    Logger.log('updateEasyEcomProduct_ response: ' + response.getContentText());

    const ok = isEeSuccess_(resJson);
    return { ok, message: resJson.message || response.getContentText() };
  } catch(e) {
    Logger.log('updateEasyEcomProduct_ error: ' + e.message);
    return { ok: false, message: e.message };
  }
}

// Write newly created ee_sku back to Vendor_Shipment_Lines
// Matches by factory_code (col G, index 6)
// Updates sku column (col E, index 4)


function writeSkuToShipmentLine_(shipmentId, factoryCode, eeSku) {
  try {
    if (!shipmentId || !factoryCode || !eeSku) {
      Logger.log('writeSkuToShipmentLine_: missing params — skipping');
      return false;
    }

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Vendor_Shipment_Lines');
    if (!sheet) {
      Logger.log('writeSkuToShipmentLine_: Vendor_Shipment_Lines not found');
      return false;
    }

    const data = sheet.getDataRange().getValues();

    // Match full factory_code — no splitting
    // Both NSR and VSL store the full value e.g. "MYML112|MF8994"
    const factoryCodeClean = String(factoryCode).trim();

    let matchedRow = -1;
    for (let i = 1; i < data.length; i++) {
      const rowShipmentId  = String(data[i][0]).trim();
      const rowFactoryCode = String(data[i][6]).trim();

      if (rowShipmentId  === shipmentId.trim() &&
          rowFactoryCode === factoryCodeClean) {
        matchedRow = i + 1; // 1-based sheet row
        break;
      }
    }

    if (matchedRow === -1) {
      Logger.log(
        `writeSkuToShipmentLine_: no match found for ` +
        `shipment=${shipmentId}, factory_code=${factoryCodeClean}`
      );
      return false;
    }

    // Write ee_sku to col E (index 4, col 5 in 1-based)
    sheet.getRange(matchedRow, 5).setValue(eeSku);
    SpreadsheetApp.flush();

    Logger.log(
      `writeSkuToShipmentLine_: ✅ wrote ${eeSku} to row ${matchedRow} ` +
      `(shipment=${shipmentId}, factory_code=${factoryCodeClean})`
    );
    return true;

  } catch(e) {
    Logger.log('writeSkuToShipmentLine_ error: ' + e.message);
    return false;
  }
}

// Read all lines from Vendor_Shipment_Lines for a shipment
// Skips lines where SKU is empty (pending creation)
// Returns { lines, unpriced }: `lines` are the priced lines (INR landed cost),
// `unpriced` names every line with quantity that could NOT be priced. A line
// like that used to be sent to EasyEcom at its RMB price as if it were rupees
// (the same bug class as the Draft Order price bug) — the caller must refuse to
// send a PO while `unpriced` is non-empty. Errors are thrown, not swallowed: the
// old `return []` turned any failure into a misleading "no lines with SKU".

function getExistingPoLines_(shipmentId) {
  {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Vendor_Shipment_Lines');
    if (!sheet) throw new Error('Vendor_Shipment_Lines not found');

    // Get pricing config for landed cost calculation
    const pricingConfig = apiGetPricingConfig({}).data;
    if (!pricingConfig) throw new Error('The pricing config could not be loaded, so PO prices cannot be calculated. Please try again.');

    // Per-SKU weight, needed for AIR-mode landing cost — sourced from EE
    // Product Master since Vendor_Shipment_Lines doesn't carry it.
    const weightBySku = {};
    getSheetData_('EE Product Master').forEach(function (p) {
      const sku = String(p['SKU'] || '').trim();
      if (sku) weightBySku[sku] = Number(p['Weight']) || 0;
    });

    const data = sheet.getDataRange().getValues().slice(1);

    const allLines   = data.filter(r =>
      String(r[0]).trim() === shipmentId.trim()
    );
    const withSku    = allLines.filter(r => String(r[4]).trim() !== '');
    const withoutSku = allLines.filter(r => String(r[4]).trim() === '');

    Logger.log(
      `getExistingPoLines_: shipment=${shipmentId} | ` +
      `total=${allLines.length} | with_sku=${withSku.length} | ` +
      `pending_sku=${withoutSku.length}`
    );

    if (withoutSku.length > 0) {
      Logger.log(
        `⚠️  ${withoutSku.length} lines still pending SKU creation: ` +
        withoutSku.map(r => `factory_code=${r[6]}`).join(', ')
      );
    }

    const threshold = Number(pricingConfig.threshold) || 40;
    const lines     = [];
    const unpriced  = [];
    const skus      = [];   // every SKU with a quantity, priced or not
    withSku.forEach(r => {
      const quantity = Number(r[8]) || 0;
      if (quantity <= 0) return;
      const sku       = String(r[4]).trim();
      skus.push(sku);
      const rmbPrice  = Number(r[9]) || 0;
      const weightGm  = weightBySku[sku] || 0;
      const pricing   = calculatePricing_(rmbPrice, weightGm, pricingConfig);
      if (!pricing) {
        unpriced.push(`${sku} (${
          !rmbPrice ? 'no RMB price on the shipment line'
          : (rmbPrice <= threshold && !weightGm) ? 'no package weight on EasyEcom'
          : 'pricing failed'})`);
        return;
      }
      lines.push({
        sku:       sku,
        quantity:  quantity,
        unitPrice: pricing.landing,  // ← INR landed cost, not RMB
      });
    });
    return { lines, unpriced, skus };
  }
}

// ─────────────────────────────────────────────────────────────
// 8. CREATE SKU ON ZOHO
// ─────────────────────────────────────────────────────────────
// Payload: { action, request_id }
// Uses existing Zoho function from codebase.
// Writes zoho_created_date on success.
// Requires EE step done first (ee_sku must exist).

function apiCreateSkuOnZoho(payload) {
  return runCreateStepOnce_('zoho', payload, createSkuOnZoho_);
}

function createSkuOnZoho_(payload) {
  try {
    const sheet  = getNsrSheet_();
    const data   = sheet.getDataRange().getValues();
    const rows   = data.slice(1);
    const rowIdx = rows.findIndex(
      r => String(r[NSR_COL.request_id]) === payload.request_id
    );
    if (rowIdx === -1) return errResult_(`Request ${payload.request_id} not found`);

    const row      = rows[rowIdx];
    const sheetRow = rowIdx + 2;
    const obj      = nsrRowToObject_(row);

    if (!obj.ee_sku) {
      return errResult_('EasyEcom SKU must be created first before creating on Zoho.');
    }
    if (!obj.shopify_selling_price) 
      return errResult_('Selling Price is required. Save draft first.');
    if (!obj.mrp) 
      return errResult_('MRP is required. Save draft first.');

const pricingConfig = apiGetPricingConfig({}).data;
const pricing = calculatePricing_(obj.unit_price, obj.pkg_weight_gm, pricingConfig);
// Without this the payload below crashed on `pricing.landing` of null and the
// user only saw "Cannot read properties of null".
if (!pricing) {
  return errResult_(explainPricingFailure_(obj.unit_price, obj.pkg_weight_gm, pricingConfig));
}

const zohoPayload = {
  sku:              obj.suggested_sku,
  name:             obj.listing_name + (obj.variant ? ` ${obj.variant}` : ''),
  //purchase_rate:    pricing ? pricing.landing : obj.unit_price, // ← Landed cost INR
  purchase_rate: pricing.landing,         // ← only from calculatePricing_()
  rate:          obj.shopify_selling_price, // ← user's saved value
  label_rate:    obj.mrp,                  // ← user's saved value
  ean:              obj.ean || 0,
  brand:            obj.brand,
  category:         obj.category,
  unit:             'pcs',
};

    // Call existing Zoho SKU creation function
    // Replace 'createZohoItem_' with the actual function name in your codebase
    const zohoResult = createZohoItem_(zohoPayload); 

    /*if (!zohoResult || !zohoResult.success) {
      return errResult_(`Zoho creation failed: ${zohoResult ? zohoResult.error : 'unknown error'}`);
    }*/
    if (!zohoResult) {
      logAuditEvent_('ZOHO', 'CREATE', obj.suggested_sku, 'Zoho creation returned no response', 'FAILED', payload.edited_by, payload.request_id);
      return errResult_('Zoho creation returned no response');
    }
    if (!zohoResult.success) {
      logAuditEvent_('ZOHO', 'CREATE', obj.suggested_sku, zohoResult.error, 'FAILED', payload.edited_by, payload.request_id);
      return errResult_(`Zoho creation failed: ${zohoResult.error}`);
    }
    // If skipped (already exists), still count as done — proceed

    // Write zoho_created_date
    const now = new Date();
    sheet.getRange(sheetRow, NSR_COL.zoho_created_date + 1).setValue(now);
    sheet.getRange(sheetRow, NSR_COL.last_edited_at + 1).setValue(now);

    SpreadsheetApp.flush();

    logAuditEvent_('ZOHO', 'CREATE', obj.suggested_sku, zohoResult.skipped ? 'Already existed in Zoho' : `Created "${zohoPayload.name}"`, 'SUCCESS', payload.edited_by, payload.request_id);

    return okResult_({
      request_id:       payload.request_id,
      zoho_created_date: now.toISOString(),
    });
  } catch(e) {
    Logger.log('apiCreateSkuOnZoho error: ' + e.message);
    logAuditEvent_('ZOHO', 'CREATE', payload.request_id, e.message, 'FAILED', payload.edited_by, payload.request_id);
    return errResult_(e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// ATTACH EXISTING ZOHO ITEM — skip creation, link an item that
// already exists in Zoho (e.g. created through some other path) to
// this request instead of recreating it.
// ─────────────────────────────────────────────────────────────
// Payload: { action, request_id }
// There's no local synced sheet of Zoho items, so this looks the SKU
// up live via the same Zoho Items search endpoint createZohoItem_
// already uses internally (items?sku_contains=...), matched exactly
// against this request's own suggested_sku. Does NOT call the create
// endpoint. Writes back zoho_created_date the same way a real
// creation would, so platformStatus.zoho reads true afterward and
// the Shopify step unlocks normally.
// Returns: { success, data: { request_id, zoho_created_date, zoho_item_name } }

function apiAttachExistingZohoItem(payload) {
  try {
    const sheet  = getNsrSheet_();
    const data   = sheet.getDataRange().getValues();
    const rows   = data.slice(1);
    const rowIdx = rows.findIndex(
      r => String(r[NSR_COL.request_id]) === payload.request_id
    );
    if (rowIdx === -1) return errResult_(`Request ${payload.request_id} not found`);

    const row      = rows[rowIdx];
    const sheetRow = rowIdx + 2;
    const obj      = nsrRowToObject_(row);

    if (!obj.suggested_sku) {
      return errResult_('Suggested SKU is required before attaching an existing Zoho item. Save draft first.');
    }
    if (obj.zoho_created_date) {
      return errResult_('A Zoho item is already attached to this request.');
    }

    const token = fetchAccessToken_();
    const base  = getZohoApisBase_(AUTH.DC);
    const item  = findZohoItemBySku_(base, token, CONFIG.ORG_ID, obj.suggested_sku);

    if (!item) {
      return errResult_(`SKU "${obj.suggested_sku}" was not found in Zoho. Create it normally, or double-check the Suggested SKU value.`);
    }

    const now = new Date();
    sheet.getRange(sheetRow, NSR_COL.zoho_created_date + 1).setValue(now);
    sheet.getRange(sheetRow, NSR_COL.last_edited_at + 1).setValue(now);
    SpreadsheetApp.flush();

    logAuditEvent_('ZOHO', 'ATTACH', obj.suggested_sku, `Attached existing Zoho item "${item.name || ''}"`, 'SUCCESS', payload.edited_by, payload.request_id);

    return okResult_({
      request_id:        payload.request_id,
      zoho_created_date: now.toISOString(),
      zoho_item_name:    item.name || '',
    });
  } catch(e) {
    Logger.log('apiAttachExistingZohoItem error: ' + e.message);
    logAuditEvent_('ZOHO', 'ATTACH', payload.request_id, e.message, 'FAILED', payload.edited_by, payload.request_id);
    return errResult_(e.message);
  }
}

// Finds a Zoho item by exact SKU match (unlike itemExistsBySku_, which
// only returns a boolean, this returns the item itself so the caller
// can surface its name).
function findZohoItemBySku_(base, token, orgId, sku) {
  const r = UrlFetchApp.fetch(
    `${base}/items?organization_id=${orgId}&sku_contains=${sku}`,
    { headers: { Authorization: 'Zoho-oauthtoken ' + token } }
  );
  const j = JSON.parse(r.getContentText());
  return (j.items || []).find(it => it.sku === sku) || null;
}

// Updates an existing Zoho item. Mirrors postItem_'s auth/request shape,
// but PUTs only the fields actually provided — used by the Update SKU
// screen so an edit only touches what changed.
// zohoFields may include: name, rate, purchase_rate, label_rate, ean.
// NOTE: category/brand are intentionally NOT sent — createZohoItem_ never
// actually includes them in its outgoing payload either (checked against
// the real payload construction, not just its input shape), so there's
// nothing for an "update" to mirror there.
function updateZohoItem_(itemId, zohoFields) {
  try {
    const token = fetchAccessToken_();
    const base  = getZohoApisBase_(AUTH.DC);

    const r = UrlFetchApp.fetch(
      `${base}/items/${itemId}?organization_id=${CONFIG.ORG_ID}`,
      {
        method: 'put',
        headers: {
          Authorization: 'Zoho-oauthtoken ' + token,
          'Content-Type': 'application/json'
        },
        payload: JSON.stringify(zohoFields),
        muteHttpExceptions: true
      }
    );
    const body = JSON.parse(r.getContentText() || '{}');
    const ok = (r.getResponseCode() === 200 || r.getResponseCode() === 201) && body.code === 0;
    Logger.log(`updateZohoItem_ (${itemId}): ok=${ok}, msg=${body.message}`);
    return { ok, message: body.message || r.getContentText() };
  } catch(e) {
    Logger.log('updateZohoItem_ error: ' + e.message);
    return { ok: false, message: e.message };
  }
}

// ============================================================
// createZohoItem_()
// Called from apiCreateSkuOnZoho() in NewSkuApi.gs
// Uses the same auth, endpoint, and payload pattern as
// processZohoItemSheet() in the existing Zoho codebase.
// ============================================================

function createZohoItem_(itemPayload) {
  // itemPayload shape (from apiCreateSkuOnZoho):
  // {
  //   sku:           string  — suggested_sku
  //   name:          string  — listing_name + variant
  //   purchase_rate: number  — unit_price (CNY cost)
  //   mrp:           number  — mrp (INR)
  //   ean:           string  — ean (optional)
  //   brand:         string  — brand
  //   category:      string  — category
  //   unit:          string  — 'pcs'
  // }

  try {
    const token = fetchAccessToken_();   // existing OAuth function
    const base  = getZohoApisBase_(AUTH.DC); // existing base URL function

    const sku  = String(itemPayload.sku  || '').trim();
    const name = sanitizeName_(itemPayload.name || sku);

    if (!sku)  return { success: false, error: 'SKU is required for Zoho creation' };
    if (!name) return { success: false, error: 'Name is required for Zoho creation' };

    // ── Step 1: Check if SKU already exists in Zoho ──
    const alreadyExists = itemExistsBySku_(base, token, CONFIG.ORG_ID, sku);
    if (alreadyExists) {
      Logger.log(`createZohoItem_: SKU ${sku} already exists in Zoho — skipping`);
      return { success: true, skipped: true, message: 'SKU already exists in Zoho' };
    }

    // ── Step 2: Build payload (same structure as buildPayload_) ──
    const cp = Number(itemPayload.purchase_rate) || 0;

    const payload = {
      name:        name,
      sku:         sku,
      purchase_rate: Number(itemPayload.purchase_rate) || 0, // ← Landed cost
      rate:          Number(itemPayload.rate)       || 0, // ← Selling Price
       label_rate:    Number(itemPayload.label_rate) || 0, // ← MRP
      unit:        CONFIG.UNIT,                   // e.g. 'pcs'
      hsn_or_sac:  CONFIG.HSN_CODE,               // e.g. '95036090'
      item_type:   'sales_and_purchases',
    };

 const landedCost = Number(itemPayload.purchase_rate) || 0;
if (landedCost >= CONFIG.MIN_VALID_CP) {
  payload.purchase_rate       = landedCost;
  payload.purchase_account_id = CONFIG.PURCHASE_ACCOUNT_ID;
}

const ean = sanitizeEAN_(itemPayload.ean || '');
payload.ean = ean || 0;

    // ── Step 3: First attempt ──
    let resp = postItem_(base, token, payload);
    Logger.log(`createZohoItem_ attempt 1 — SKU: ${sku}, ok: ${resp.ok}, msg: ${resp.message}`);

    // ── Step 4: Retry without EAN if EAN field caused the error ──
    if (!resp.ok && payload.ean && looksLikeEANFieldError_(resp)) {
      Logger.log(`createZohoItem_: Retrying without EAN for SKU ${sku}`);
      delete payload.ean;
      resp = postItem_(base, token, payload);
      Logger.log(`createZohoItem_ attempt 2 (no EAN) — ok: ${resp.ok}, msg: ${resp.message}`);
    }

    // ── Step 5: Retry with trailing dot if name already exists ──
    if (!resp.ok && looksLikeItemNameExistsError_(resp)) {
      if (!payload.name.endsWith('.')) {
        payload.name = payload.name + '.';
      }
      Logger.log(`createZohoItem_: Retrying with modified name for SKU ${sku}`);
      resp = postItem_(base, token, payload);
      Logger.log(`createZohoItem_ attempt 3 (modified name) — ok: ${resp.ok}, msg: ${resp.message}`);
    }

    // ── Step 6: Return result ──
    if (resp.ok) {
      Logger.log(`createZohoItem_: ✅ Created SKU ${sku} in Zoho`);
      return { success: true, sku, message: resp.message };
    } else {
      Logger.log(`createZohoItem_: ❌ Failed SKU ${sku} — ${resp.message}`);
      return { success: false, error: resp.message };
    }

  } catch(e) {
    Logger.log(`createZohoItem_ ERROR for SKU ${itemPayload.sku}: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/***********************
 * ZOHO HELPERS
 ***********************/

function getZohoApisBase_(dc) {
  return dc === 'in'
    ? 'https://www.zohoapis.in/books/v3'
    : 'https://www.zohoapis.com/books/v3';
}

function fetchAccessToken_() {
  // Credentials go in the POST body, not the URL — a failed UrlFetchApp call
  // (network error, unreachable host) throws an exception whose message
  // includes the full request URL, which would otherwise leak client_secret
  // and refresh_token straight into a user-facing error alert.
  //
  // "Address unavailable" from UrlFetchApp is a transient connectivity blip
  // between Apps Script and Zoho, not a rejected-credentials error (that
  // comes back as a normal HTTP response, handled below via parsed.error) —
  // so a couple of short retries clears most of these automatically instead
  // of forcing the user to click Retry themselves.
  var attempts = 3;
  for (var attempt = 1; attempt <= attempts; attempt++) {
    var r;
    try {
      var zohoProps_ = PropertiesService.getScriptProperties();
      r = UrlFetchApp.fetch(`https://accounts.zoho.${AUTH.DC}/oauth/v2/token`, {
        method: 'post',
        payload: {
          grant_type: 'refresh_token',
          client_id: AUTH.CLIENT_ID,
          client_secret: zohoProps_.getProperty('ZOHO_CLIENT_SECRET'),
          refresh_token: zohoProps_.getProperty('ZOHO_REFRESH_TOKEN')
        },
        muteHttpExceptions: true
      });
    } catch (e) {
      Logger.log('fetchAccessToken_ attempt ' + attempt + ' network error: ' + e.message);
      if (attempt < attempts) { Utilities.sleep(800 * attempt); continue; }
      throw new Error('Could not reach Zoho to refresh the access token after ' + attempts + ' attempts (network error).');
    }

    var parsed;
    try {
      parsed = JSON.parse(r.getContentText());
    } catch (e) {
      throw new Error('Zoho token refresh returned an unexpected response (HTTP ' + r.getResponseCode() + ').');
    }
    if (!parsed.access_token) {
      // A real rejection (bad/revoked refresh token, wrong client) — retrying won't help.
      throw new Error('Zoho token refresh failed: ' + (parsed.error || 'no access_token in response') + '.');
    }
    return parsed.access_token;
  }
  // Unreachable — the loop above always returns or throws — but keep the
  // function's control flow explicit.
  throw new Error('Could not reach Zoho to refresh the access token.');
}

function itemExistsBySku_(base, token, orgId, sku) {
  const r = UrlFetchApp.fetch(
    `${base}/items?organization_id=${orgId}&sku_contains=${sku}`,
    { headers: { Authorization: 'Zoho-oauthtoken ' + token } }
  );
  const j = JSON.parse(r.getContentText());
  return (j.items || []).some(it => it.sku === sku);
}

function postItem_(base, token, payload) {
  const r = UrlFetchApp.fetch(
    `${base}/items?organization_id=${CONFIG.ORG_ID}`,
    {
      method: 'post',
      headers: {
        Authorization: 'Zoho-oauthtoken ' + token,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    }
  );
  const body = JSON.parse(r.getContentText() || '{}');
  return {
    ok: (r.getResponseCode() === 200 || r.getResponseCode() === 201) && body.code === 0,
    message: body.message || r.getContentText()
  };
}

function looksLikeEANFieldError_(resp) {
  return String(resp.message).toLowerCase().includes('ean');
}

function looksLikeItemNameExistsError_(resp) {
  const m = String(resp.message).toLowerCase();
  return m.includes('already exists') && m.includes('item');
}

/***********************
 * UTILS
 ***********************/
function sanitizeName_(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 100);
}
function sanitizeEAN_(s) {
  return String(s || '').replace(/[^0-9]/g, '');
}

// ─────────────────────────────────────────────────────────────
// 9. CREATE SKU ON SHOPIFY
// ─────────────────────────────────────────────────────────────
// Payload: { action, request_id }
// Handles two cases:
//   Case A — listing_type = 'New Product' → create new Shopify product
//   Case B — listing_type = 'Existing Variant' → add variant to parent
// Requires Zoho step done first.
// Writes shopify_listing_url on success.
// Status → CREATED if all steps done, else ACTION_REQ.

function apiCreateSkuOnShopify(payload) {
  return runCreateStepOnce_('shopify', payload, createSkuOnShopify_);
}

function createSkuOnShopify_(payload) {
  try {
    const sheet  = getNsrSheet_();
    const data   = sheet.getDataRange().getValues();
    const rows   = data.slice(1);
    const rowIdx = rows.findIndex(
      r => String(r[NSR_COL.request_id]) === payload.request_id
    );
    if (rowIdx === -1) return errResult_(`Request ${payload.request_id} not found`);

    const row      = rows[rowIdx];
    const sheetRow = rowIdx + 2;
    const obj      = nsrRowToObject_(row);

    if (!obj.zoho_created_date) {
      return errResult_('Zoho SKU must be created first before creating on Shopify.');
    }

    // Shopify auth — stored in Script Properties
    const props   = PropertiesService.getScriptProperties();
    const apiKey  = props.getProperty('SHOPIFY_API_KEY');
    const apiPass = props.getProperty('SHOPIFY_API_PASS');
    const storeUrl = 'https://cubelelo-cube-store.myshopify.com/admin/api/2021-07/products.json';

    const headers = {
      'Content-Type':  'application/json',
      'Authorization': 'Basic ' + Utilities.base64Encode(apiKey + ':' + apiPass),
    };

    // ── Idempotency guard — makes Retry safe ──
    // A retry (the detail page's button, the dashboard's Retry Create Listing,
    // or a second tab) must never create a SECOND Shopify listing for a SKU that
    // already has one. An earlier attempt may well have succeeded on Shopify's
    // side without this app ever hearing about it — an Apps Script timeout page,
    // a dropped connection, a failed write-back to the sheet. So look the SKU up
    // first and link to what is already there, like the Zoho step does with
    // itemExistsBySku_. If the lookup itself fails we cannot tell, so nothing is
    // created (the old code created unconditionally).
    const existing = findShopifyVariantBySku_(obj.suggested_sku);
    if (existing.status === 'error') {
      return errResult_(
        `Could not check whether SKU ${obj.suggested_sku} already exists on Shopify ` +
        `(${existing.message}). Nothing was created — please try again.`
      );
    }
    // "A request was sent" marker: Shopify's search index can lag a few seconds
    // behind a create, so right after an attempt whose outcome we never learned,
    // "not found" doesn't prove it wasn't created.
    const attemptKey   = 'nsr_shopify_sent_' + payload.request_id;
    const attemptCache = CacheService.getScriptCache();
    if (existing.status === 'found') {
      return recordShopifyDone_(sheet, sheetRow, obj, payload,
        `https://admin.shopify.com/store/cubelelo-cube-store/products/${existing.productId}`, true);
    }
    if (attemptCache.get(attemptKey)) {
      return errResult_(
        'A previous Shopify request for this SKU was sent a moment ago and may not be visible yet. ' +
        'Wait a minute or two, then retry — creating it again right now could duplicate the listing.'
      );
    }

    let shopifyPayload;
    let listingUrl;

    if (obj.listing_type === 'Existing Variant') {
      // ── Case B: Add variant to existing Shopify product ──
      // Look up parent product ID from EE Product Master by parent_sku
      const parentProductId = getShopifyProductIdBySku_(obj.parent_sku);
     // if (!parentProductId) {
     //   return errResult_(`Parent SKU "${obj.parent_sku}" not found in EE Product Master or has no Shopify product ID.`);
     // }
        if (!parentProductId) {
          return errResult_(
    `     Parent SKU "${obj.parent_sku}" not found on Shopify. ` +
          `Ensure the parent product exists and is published on Shopify before ` +
          `adding a variant.`
  );
}

      const variantPayload = {
        variant: {
          option1:          obj.variant || obj.color || 'Default',
          price:            obj.shopify_selling_price,
          ...(obj.shopify_compare_price ? { compare_at_price: obj.shopify_compare_price } : {}),
          sku:              obj.suggested_sku,
          barcode:          obj.ean || '',
          inventory_policy: 'deny',
          fulfillment_service: 'manual',
          requires_shipping: true,
          taxable:          true,
          inventory_management: 'shopify',
          weight:           obj.pkg_weight_gm / 1000, // convert gm to kg
          weight_unit:      'kg',
        }
      };

      const variantUrl = `https://cubelelo-cube-store.myshopify.com/admin/api/2021-07/products/${parentProductId}/variants.json`;
      attemptCache.put(attemptKey, String(Date.now()), 180);
      const varResponse = UrlFetchApp.fetch(variantUrl, {
        method: 'POST', headers,
        payload: JSON.stringify(variantPayload),
        muteHttpExceptions: true,
      });
      const varJson = JSON.parse(varResponse.getContentText());
      Logger.log('Shopify add variant response: ' + varResponse.getContentText());

      if (!varJson.variant) {
        attemptCache.remove(attemptKey);   // a clear rejection: nothing was created, retry freely
        logAuditEvent_('SHOPIFY', 'CREATE', obj.suggested_sku, 'Variant creation failed', 'FAILED', payload.edited_by, payload.request_id);
        return errResult_(`Shopify variant creation failed: ${varResponse.getContentText()}`);
      }

      listingUrl = `https://admin.shopify.com/store/cubelelo-cube-store/products/${parentProductId}`;

    } else {
      // ── Case A: Create new Shopify product ──
      shopifyPayload = {
        product: {
          title:        obj.listing_name,
          body_html:    obj.listing_name,
          vendor:       obj.brand,
          product_type: obj.category,
          tags:         obj.relevant_tags,
          template_suffix: 'active',        // ← add this
          status:       'draft',
          published:    true,
          variants: [{
            option1:          obj.variant || 'Default',
            price:            obj.shopify_selling_price,
            ...(obj.shopify_compare_price ? { compare_at_price: obj.shopify_compare_price } : {}),
            sku:              obj.suggested_sku,
            barcode:          obj.ean || '',
            inventory_policy: 'deny',
            fulfillment_service: 'manual',
            requires_shipping: true,
            taxable:          true,
            inventory_management: 'shopify',
            weight:           obj.pkg_weight_gm / 1000,
            weight_unit:      'kg',
          }],
          metafields: [
            { key: 'dimensions',      value: obj.product_dims_mm || '',
              value_type: 'string',   namespace: 'my_fields' },
            { key: 'package_weight',  value: Math.round(obj.pkg_weight_gm),
              value_type: 'integer',  namespace: 'my_fields' },
            { key: 'product_weight',  value: Math.round(obj.nw_gm || 0),
              value_type: 'integer',  namespace: 'my_fields' },
            { key: 'mrp',             value: obj.mrp,
              value_type: 'integer',  namespace: 'my_fields' },
          ],
          metafields_global_title_tag:
            `Buy ${obj.listing_name} Speed Cube Online | Cubelelo`,
          metafields_global_description_tag:
            `Buy ${obj.listing_name} Speed Cube Online. ` +
            `✓Secure Shopping ✓FREE Shipping ✓Reward Points ✓Best Prices.`,
        }
      };

      // Add options array if variant field is set
      if (obj.variant) {
        shopifyPayload.product.options = [{
          name:   'Variant',
          values: [obj.variant],
        }];
      }

      attemptCache.put(attemptKey, String(Date.now()), 180);
      const prodResponse = UrlFetchApp.fetch(storeUrl, {
        method: 'POST', headers,
        payload: JSON.stringify(shopifyPayload),
        muteHttpExceptions: true,
      });
      const prodJson = JSON.parse(prodResponse.getContentText());
      Logger.log('Shopify create product response: ' + prodResponse.getContentText());

      if (!prodJson.product) {
        attemptCache.remove(attemptKey);   // a clear rejection: nothing was created, retry freely
        logAuditEvent_('SHOPIFY', 'CREATE', obj.suggested_sku, 'Product creation failed', 'FAILED', payload.edited_by, payload.request_id);
        return errResult_(`Shopify product creation failed: ${prodResponse.getContentText()}`);
      }

      listingUrl = `https://admin.shopify.com/store/cubelelo-cube-store/products/${prodJson.product.id}`;
    }

    return recordShopifyDone_(sheet, sheetRow, obj, payload, listingUrl, false);
  } catch(e) {
    Logger.log('apiCreateSkuOnShopify error: ' + e.message);
    logAuditEvent_('SHOPIFY', 'CREATE', payload.request_id, e.message, 'FAILED', payload.edited_by, payload.request_id);
    return errResult_(e.message);
  }
}

// Marks the Shopify step done on the request row and logs it. Shared by a fresh
// create and by "already exists on Shopify" (a retry that found the listing).
function recordShopifyDone_(sheet, sheetRow, obj, payload, listingUrl, alreadyExisted) {
  // Write listing URL + check if all steps done → CREATED
  const isDone    = obj.ee_sku && obj.zoho_created_date; // + shopify just succeeded
  const newStatus = isDone && !obj.shipment_id
    ? 'CREATED'                                // manual entry, no PO step
    : 'ACTION_REQ';                            // PO update (or another step) still needed

  const cells = {};
  cells[NSR_COL.shopify_listing_url] = listingUrl;
  cells[NSR_COL.status]              = newStatus;
  cells[NSR_COL.last_edited_at]      = new Date();
  writeNsrCells_(sheet, sheetRow, cells);
  SpreadsheetApp.flush();

  // Outcome is known now — drop the "request in flight" marker.
  CacheService.getScriptCache().remove('nsr_shopify_sent_' + payload.request_id);

  logAuditEvent_('SHOPIFY', alreadyExisted ? 'ATTACH' : 'CREATE', obj.suggested_sku,
    alreadyExisted
      ? `Already on Shopify — linked the existing listing for "${obj.listing_name}"`
      : `Created "${obj.listing_name}"`,
    'SUCCESS', payload.edited_by, payload.request_id);

  return okResult_({
    request_id:          payload.request_id,
    shopify_listing_url: listingUrl,
    status:              newStatus,
    already_existed:     !!alreadyExisted,
  });
}

// Looks a SKU up on Shopify (GraphQL variant search, exact SKU match). The answer
// is one of
//   { status: 'found', productId, variantId }
//   { status: 'not_found' }
//   { status: 'error', message }      — the lookup itself failed, so it is UNKNOWN
// The old helpers below return null for both "not there" and "lookup failed",
// which is fine for reads but not for deciding whether it is safe to create.
function findShopifyVariantBySku_(sku) {
  try {
    const cleanSku = String(sku || '').trim();
    if (!cleanSku) return { status: 'error', message: 'no SKU to look up' };
    // The SKU goes into a GraphQL string literal — refuse anything that could break out of it.
    if (/["\\\r\n]/.test(cleanSku)) return { status: 'error', message: 'SKU contains characters that cannot be searched' };

    const props   = PropertiesService.getScriptProperties();
    const apiKey  = props.getProperty('SHOPIFY_API_KEY');
    const apiPass = props.getProperty('SHOPIFY_API_PASS');
    if (!apiKey || !apiPass) return { status: 'error', message: 'Shopify credentials are not configured' };

    const graphqlUrl = 'https://cubelelo-cube-store.myshopify.com' +
                       '/admin/api/2021-07/graphql.json';

    const query = `{
      productVariants(first: 5, query: "sku:${cleanSku}") {
        edges {
          node {
            id
            sku
            legacyResourceId
            product {
              id
              legacyResourceId
            }
          }
        }
      }
    }`;

    const response = UrlFetchApp.fetch(graphqlUrl, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Basic ' + Utilities.base64Encode(apiKey + ':' + apiPass),
      },
      payload:            JSON.stringify({ query }),
      muteHttpExceptions: true,
    });

    const code = response.getResponseCode();
    if (code !== 200) return { status: 'error', message: 'Shopify returned HTTP ' + code };

    const body = JSON.parse(response.getContentText());
    if (body.errors) {
      Logger.log('findShopifyVariantBySku_ GraphQL errors: ' + JSON.stringify(body.errors));
      return { status: 'error', message: 'Shopify search error: ' + JSON.stringify(body.errors).slice(0, 200) };
    }

    // "sku:X" can return partial matches, so require an exact one.
    const edges = (body.data && body.data.productVariants && body.data.productVariants.edges) || [];
    const match = edges.find(e => String(e.node.sku).trim() === cleanSku);
    if (!match) return { status: 'not_found' };

    // legacyResourceId is the numeric ID the REST API wants.
    return {
      status:    'found',
      productId: match.node.product.legacyResourceId,
      variantId: match.node.legacyResourceId,
    };
  } catch (e) {
    Logger.log('findShopifyVariantBySku_ error: ' + e.message);
    return { status: 'error', message: e.message };
  }
}

// Numeric Shopify product ID for a SKU, or null if it isn't there OR the lookup
// failed (use findShopifyVariantBySku_ when the difference matters).
function getShopifyProductIdBySku_(sku) {
  const r = findShopifyVariantBySku_(sku);
  if (r.status === 'error') Logger.log('getShopifyProductIdBySku_: ' + r.message);
  return r.status === 'found' ? r.productId : null;
}

// Like getShopifyProductIdBySku_, but also returns the variant's own numeric ID
// (needed for PUT /variants/{id}.json — product-level fields like
// title/vendor/tags/metafields use the product ID instead).
function getShopifyProductAndVariantIdBySku_(sku) {
  const r = findShopifyVariantBySku_(sku);
  if (r.status === 'error') Logger.log('getShopifyProductAndVariantIdBySku_: ' + r.message);
  return r.status === 'found' ? { productId: r.productId, variantId: r.variantId } : null;
}

// Updates an existing Shopify product/variant. Only sends the fields
// provided in productFields / variantFields (product-level: title,
// body_html, vendor, product_type, tags, metafields; variant-level:
// price, barcode, weight) — used by the Update SKU screen so an edit
// only touches what changed.
function updateShopifyProduct_(productId, variantId, productFields, variantFields) {
  const props   = PropertiesService.getScriptProperties();
  const apiKey  = props.getProperty('SHOPIFY_API_KEY');
  const apiPass = props.getProperty('SHOPIFY_API_PASS');
  const headers = {
    'Content-Type':  'application/json',
    'Authorization': 'Basic ' + Utilities.base64Encode(apiKey + ':' + apiPass),
  };

  const results = { product: null, variant: null };

  if (productFields && Object.keys(productFields).length > 0) {
    try {
      const url = `https://cubelelo-cube-store.myshopify.com/admin/api/2021-07/products/${productId}.json`;
      const resp = UrlFetchApp.fetch(url, {
        method: 'put', headers,
        payload: JSON.stringify({ product: { id: productId, ...productFields } }),
        muteHttpExceptions: true,
      });
      const body = JSON.parse(resp.getContentText() || '{}');
      results.product = { ok: !!body.product, message: body.errors ? JSON.stringify(body.errors) : 'ok' };
      Logger.log(`updateShopifyProduct_ product update (${productId}): ${resp.getContentText()}`);
    } catch(e) {
      results.product = { ok: false, message: e.message };
    }
  }

  if (variantFields && Object.keys(variantFields).length > 0 && variantId) {
    try {
      const url = `https://cubelelo-cube-store.myshopify.com/admin/api/2021-07/variants/${variantId}.json`;
      const resp = UrlFetchApp.fetch(url, {
        method: 'put', headers,
        payload: JSON.stringify({ variant: { id: variantId, ...variantFields } }),
        muteHttpExceptions: true,
      });
      const body = JSON.parse(resp.getContentText() || '{}');
      results.variant = { ok: !!body.variant, message: body.errors ? JSON.stringify(body.errors) : 'ok' };
      Logger.log(`updateShopifyProduct_ variant update (${variantId}): ${resp.getContentText()}`);
    } catch(e) {
      results.variant = { ok: false, message: e.message };
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// 10. UPDATE EE PURCHASE ORDER
// ─────────────────────────────────────────────────────────────
// Payload: { action, request_id }
// Looks up ee_po_reference from Vendor_Shipments using shipment_id.
// Calls EE CreatePurchaseOrder with createOrUpdate='U'.
// Skipped entirely if shipment_id is blank.
// Status → CREATED on success.

// Wrapped in runCreateStepOnce_ (an in-flight lock keyed on this request_id)
// so a double-click or an impatient retry-while-still-running can't race two
// executions at once — this step can now create a brand-new PO in EasyEcom
// (see the GRN-lock branch below), so a duplicate run means a duplicate real
// purchase order, not just a harmless resend.
function apiUpdateEePurchaseOrder(payload) {
  return runCreateStepOnce_('ee_po', payload, updateEePurchaseOrder_);
}

function updateEePurchaseOrder_(payload) {
  try {
    const sheet  = getNsrSheet_();
    const data   = sheet.getDataRange().getValues();
    const rows   = data.slice(1);
    const rowIdx = rows.findIndex(
      r => String(r[NSR_COL.request_id]) === payload.request_id
    );
    if (rowIdx === -1) return errResult_(`Request ${payload.request_id} not found`);

    const row      = rows[rowIdx];
    const sheetRow = rowIdx + 2;
    const obj      = nsrRowToObject_(row);

    // ── Already resolved — a retry after a success the client failed to
    // report cleanly (e.g. a dropped response) must NOT run the EE calls
    // again, since the GRN-lock branch below creates a real new PO each
    // time it runs. ──
    if (obj.status === 'CREATED') {
      return okResult_({
        request_id:   payload.request_id,
        status:       'CREATED',
        already_done: true,
        message:      'This request was already marked CREATED — no EE PO action taken.',
      });
    }

    // ── Skip if no shipment — manual entry, no PO to update ──
    if (!obj.shipment_id) {
      const now = new Date();
      sheet.getRange(sheetRow, NSR_COL.status + 1).setValue('CREATED');
      sheet.getRange(sheetRow, NSR_COL.resolved_at + 1).setValue(now);
      sheet.getRange(sheetRow, NSR_COL.resolved_by + 1)
        .setValue(payload.updated_by || '');
      SpreadsheetApp.flush();
      return okResult_({
        request_id: payload.request_id,
        status:     'CREATED',
        skipped:    true,
        message:    'No shipment_id — EE PO update skipped'
      });
    }

    if (!obj.ee_sku) {
      return errResult_('EasyEcom SKU must be created first.');
    }

    // ── Step 1: Look up ee_po_reference from Vendor_Shipments ──
    const ss      = SpreadsheetApp.getActiveSpreadsheet();
    const vsSheet = ss.getSheetByName(VS_SHEET);
    if (!vsSheet) return errResult_(`Sheet "${VS_SHEET}" not found`);

    const vsData    = vsSheet.getDataRange().getValues();
    const vsHeaders = vsData[0];
    const vsShipCol = vsHeaders.indexOf('shipment_id');
    const vsPoCol   = vsHeaders.indexOf('ee_po_reference');

    if (vsShipCol === -1 || vsPoCol === -1) {
      return errResult_(
        `Columns "shipment_id" or "ee_po_reference" not found in ${VS_SHEET}`
      );
    }

    const vsRow = vsData.slice(1).find(
      r => String(r[vsShipCol]).trim() === obj.shipment_id.trim()
    );
    if (!vsRow) {
      return errResult_(
        `Shipment ${obj.shipment_id} not found in ${VS_SHEET}`
      );
    }

    const eePoRef = String(vsRow[vsPoCol]).trim();
    if (!eePoRef) {
      return errResult_(
        `No ee_po_reference found for shipment ${obj.shipment_id}`
      );
    }

    // ── Step 2: Read all lines from Vendor_Shipment_Lines ──
    // Only include lines where SKU col E is populated
    // (empty = SKU not yet created on EE, skip those)
    const eeSkuKey = String(obj.ee_sku).trim();
    let poLines = getExistingPoLines_(obj.shipment_id);

    // This request's SKU has to be on a line of the shipment, or the PO would go
    // out WITHOUT it and the request would still be marked CREATED (it used to —
    // the miss was only logged). writeSkuToShipmentLine_ is what puts the SKU on
    // its line (matched by factory code); if that write-back missed earlier, try
    // it once more, then read the lines again.
    if (!poLines.skus.includes(eeSkuKey)) {
      writeSkuToShipmentLine_(obj.shipment_id, obj.factory_code, eeSkuKey);
      poLines = getExistingPoLines_(obj.shipment_id);
    }
    if (!poLines.skus.includes(eeSkuKey)) {
      return errResult_(
        `SKU ${eeSkuKey} is not on any line (with a quantity) of shipment ${obj.shipment_id}` +
        (obj.factory_code ? ` — no line matches factory code "${obj.factory_code}"` : '') +
        `, so the purchase order would go out without it. Check that shipment line's factory code, then retry.`
      );
    }

    // A line that cannot be priced must stop the update: sending it anyway put
    // the RMB figure into the PO as if it were rupees.
    if (poLines.unpriced.length > 0) {
      return errResult_(
        `The purchase order was NOT updated: ${poLines.unpriced.length} line(s) in shipment ${obj.shipment_id} ` +
        `cannot be priced — ${poLines.unpriced.join('; ')}. Fix those, then retry.`
      );
    }

    const allItems = poLines.lines;
    if (allItems.length === 0) {
      return errResult_(
        `No lines with SKU found in Vendor_Shipment_Lines ` +
        `for shipment: ${obj.shipment_id}. ` +
        `Ensure all SKUs are created on EasyEcom first.`
      );
    }

    Logger.log(`Lines to push: ${allItems.length}`);

    // ── Step 3: Build and send EE payload ──
    const token = getEasyEcomToken();

    const eePayload = {
      createOrUpdate: 'U',
      //referenceCode:  eePoRef,
      referenceCode:  obj.shipment_id,  // ← "VS-PW260506-1" format
      vendorId:       obj.vendor_code,
      items:          allItems,
    };

    const headers = {
      'Authorization': 'Bearer ' + token,
      'x-api-key':     EE_API_KEY,
      'Content-Type':  'application/json',
    };

    Logger.log('EE PO payload: ' + JSON.stringify(eePayload));

    const response = UrlFetchApp.fetch(
      'https://api.easyecom.io/WMS/Cart/CreatePurchaseOrder',
      {
        method:             'POST',
        headers,
        payload:            JSON.stringify(eePayload),
        muteHttpExceptions: true,
      }
    );

    const resJson = JSON.parse(response.getContentText());
    Logger.log('UpdateEEPO response: ' + response.getContentText());

    if (resJson.code !== 200) {
      const eeMsg = resJson.message || response.getContentText();
      logAuditEvent_('EASYECOM', 'UPDATE_PO', eePoRef, eeMsg || 'EE PO update failed', 'FAILED', payload.updated_by, payload.request_id);

      // EasyEcom locks a PO from further line edits once any GRN has been
      // posted against it (e.g. an earlier partial receipt). EasyEcom's own
      // documented behavior for this case (editing a PO after partial GRN
      // via their UI) is to leave the original PO as-is and auto-create a
      // new, linked PO for what's still outstanding — mirror that here:
      // start a standalone PO carrying just this SKU's own line, instead of
      // failing outright.
      if (/grn/i.test(eeMsg)) {
        const ownLine = allItems.find(i => i.sku === eeSkuKey);
        if (!ownLine) {
          return errResult_(
            `EasyEcom already has a GRN against PO ${eePoRef}, so it can't be edited, and this SKU's own line ` +
            `could not be found to start a new PO for it: ${eeMsg}`
          );
        }

        // Match the "{shipmentId}|{batchId}" suffix convention every other
        // PO reference in EasyEcom carries (see pushShipmentToEasyEcom_) —
        // without it, this split PO's batch can't be identified from its
        // reference code the way every other PO's can.
        const vsBatchCol = vsHeaders.indexOf('batch_id');
        const batchId    = vsBatchCol !== -1 ? String(vsRow[vsBatchCol] || '').trim() : '';
        const newPoRef   = batchId
          ? `${obj.shipment_id}-ADD-${eeSkuKey}|${batchId}`
          : `${obj.shipment_id}-ADD-${eeSkuKey}`;
        const expDate    = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
        const newPoPayload = {
          vendorId:        obj.vendor_code,
          referenceCode:   newPoRef,
          expDeliveryDate: Utilities.formatDate(expDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
          shippingCost:    0,
          createOrUpdate:  'I',
          isCancel:        0,
          items:           [ownLine],
        };

        Logger.log('EE split-PO payload (original locked by GRN): ' + JSON.stringify(newPoPayload));

        const splitResponse = UrlFetchApp.fetch(
          'https://api.easyecom.io/WMS/Cart/CreatePurchaseOrder',
          {
            method:             'POST',
            headers,
            payload:            JSON.stringify(newPoPayload),
            muteHttpExceptions: true,
          }
        );
        const splitResJson = JSON.parse(splitResponse.getContentText());
        Logger.log('EE split-PO response: ' + splitResponse.getContentText());

        if (splitResJson.code !== 200) {
          const splitMsg = splitResJson.message || splitResponse.getContentText();
          logAuditEvent_('EASYECOM', 'CREATE_PO', newPoRef, splitMsg || 'Split PO creation failed', 'FAILED', payload.updated_by, payload.request_id);
          return errResult_(
            `Original PO ${eePoRef} already has a GRN against it (${eeMsg}), and creating a new PO (${newPoRef}) ` +
            `for this SKU also failed: ${splitMsg}`
          );
        }

        const splitNow = new Date();
        sheet.getRange(sheetRow, NSR_COL.status + 1).setValue('CREATED');
        sheet.getRange(sheetRow, NSR_COL.resolved_at + 1).setValue(splitNow);
        sheet.getRange(sheetRow, NSR_COL.resolved_by + 1).setValue(payload.updated_by || '');
        sheet.getRange(sheetRow, NSR_COL.last_edited_at + 1).setValue(splitNow);
        SpreadsheetApp.flush();

        logAuditEvent_('EASYECOM', 'CREATE_PO', newPoRef, `1 line sent to new split PO (original ${eePoRef} locked by GRN)`, 'SUCCESS', payload.updated_by, payload.request_id);

        return okResult_({
          request_id:      payload.request_id,
          ee_po_ref:       newPoRef,
          original_po_ref: eePoRef,
          split_po:        true,
          lines_sent:      1,
          new_sku_found:   true,
          status:          'CREATED',
          resolved_at:     splitNow.toISOString(),
        });
      }

      return errResult_(
        `EE PO update failed: ${eeMsg}`
      );
    }

    // ── Step 4: Mark CREATED ──
    const now = new Date();
    sheet.getRange(sheetRow, NSR_COL.status + 1).setValue('CREATED');
    sheet.getRange(sheetRow, NSR_COL.resolved_at + 1).setValue(now);
    sheet.getRange(sheetRow, NSR_COL.resolved_by + 1)
      .setValue(payload.updated_by || '');
    sheet.getRange(sheetRow, NSR_COL.last_edited_at + 1).setValue(now);

    SpreadsheetApp.flush();

    logAuditEvent_('EASYECOM', 'UPDATE_PO', eePoRef, `${allItems.length} line(s) sent`, 'SUCCESS', payload.updated_by, payload.request_id);

    return okResult_({
      request_id:    payload.request_id,
      ee_po_ref:     eePoRef,
      lines_sent:    allItems.length,
      new_sku_found: true,
      status:        'CREATED',
      resolved_at:   now.toISOString(),
    });

  } catch(e) {
    // A thrown value without a .message (e.g. a raw object/string) used to
    // reach the client as a bare "undefined" — always fall back to
    // something displayable so a real failure is never silently swallowed.
    const msg = (e && e.message) ? e.message : String(e);
    Logger.log('apiUpdateEePurchaseOrder error: ' + msg);
    logAuditEvent_('EASYECOM', 'UPDATE_PO', payload.request_id, msg, 'FAILED', payload.updated_by, payload.request_id);
    return errResult_(msg);
  }
}


// ─────────────────────────────────────────────────────────────
// 11. REJECT SKU REQUEST
// ─────────────────────────────────────────────────────────────
// Payload: { action, request_id, remark, rejected_by }

function apiRejectSkuRequest(payload) {
  try {
    if (!payload.remark) return errResult_('Remark is required when rejecting a request.');

    const sheet  = getNsrSheet_();
    const data   = sheet.getDataRange().getValues();
    const rows   = data.slice(1);
    const rowIdx = rows.findIndex(
      r => String(r[NSR_COL.request_id]) === payload.request_id
    );
    if (rowIdx === -1) return errResult_(`Request ${payload.request_id} not found`);

    const sheetRow = rowIdx + 2;
    const now      = new Date();

    sheet.getRange(sheetRow, NSR_COL.status + 1).setValue('REJECTED');
    sheet.getRange(sheetRow, NSR_COL.remark + 1).setValue(payload.remark);
    sheet.getRange(sheetRow, NSR_COL.resolved_at + 1).setValue(now);
    sheet.getRange(sheetRow, NSR_COL.resolved_by + 1).setValue(payload.rejected_by || '');
    sheet.getRange(sheetRow, NSR_COL.last_edited_at + 1).setValue(now);

    SpreadsheetApp.flush();

    return okResult_({
      request_id:  payload.request_id,
      status:      'REJECTED',
      resolved_at: now.toISOString(),
    });
  } catch(e) {
    Logger.log('apiRejectSkuRequest error: ' + e.message);
    return errResult_(e.message);
  }
}


// ─────────────────────────────────────────────────────────────
// 11b. MARK SKU REQUEST COMPLETE
// ─────────────────────────────────────────────────────────────
// Payload: { action, request_id, completed_by }
// Force-completes a request stuck in ACTION_REQ (or any other non-terminal
// status) when no further platform action is actually needed — sets status
// straight to CREATED without touching ee_sku / zoho_created_date /
// shopify_listing_url, so whichever *_done flags already exist (derived
// from those columns in nsrRowToObject_) are left exactly as they are.

function apiMarkSkuComplete(payload) {
  try {
    const sheet  = getNsrSheet_();
    const data   = sheet.getDataRange().getValues();
    const rows   = data.slice(1);
    const rowIdx = rows.findIndex(
      r => String(r[NSR_COL.request_id]) === payload.request_id
    );
    if (rowIdx === -1) return errResult_(`Request ${payload.request_id} not found`);

    const currentStatus = String(rows[rowIdx][NSR_COL.status] || '');
    if (currentStatus === 'REJECTED') {
      return errResult_('Cannot mark a rejected request complete');
    }

    const sheetRow = rowIdx + 2;
    const now      = new Date();

    sheet.getRange(sheetRow, NSR_COL.status + 1).setValue('CREATED');
    sheet.getRange(sheetRow, NSR_COL.resolved_at + 1).setValue(now);
    sheet.getRange(sheetRow, NSR_COL.resolved_by + 1).setValue(payload.completed_by || '');
    sheet.getRange(sheetRow, NSR_COL.last_edited_at + 1).setValue(now);

    SpreadsheetApp.flush();

    return okResult_({
      request_id:  payload.request_id,
      status:      'CREATED',
      resolved_at: now.toISOString(),
    });
  } catch(e) {
    Logger.log('apiMarkSkuComplete error: ' + e.message);
    return errResult_(e.message);
  }
}


// ─────────────────────────────────────────────────────────────
// 12. CREATE MANUAL SKU REQUEST (standalone — no shipment)
// ─────────────────────────────────────────────────────────────
// Payload: { action, created_by, form: { item_name, category, 
//            brand, listing_name, ... } }
// Creates a new row in New_SKU_Requests with a new NSR-XXX ID.
// shipment_id, vendor_code, invoice_qty are left blank.

function apiCreateManualSkuRequest(payload) {
  try {
    const sheet    = getNsrSheet_();
    const newId    = generateRequestId_();
    const now      = new Date();
    const form     = payload.form || {};

    // Validate mandatory fields for manual entry
    const missing = [];
    if (!form.listing_name)  missing.push('listing_name');
    if (!form.category)      missing.push('category');
    if (!form.brand)         missing.push('brand');
    if (missing.length > 0) {
      return errResult_(`Missing mandatory fields: ${missing.join(', ')}`);
    }

    // Build a new row array sized to NSR_TOTAL_COLS
    const newRow = new Array(NSR_TOTAL_COLS).fill('');

    newRow[NSR_COL.request_id]    = newId;
    newRow[NSR_COL.shipment_id]   = ''; // blank — manual entry
    newRow[NSR_COL.vendor_code]   = form.vendor_code  || '';
    newRow[NSR_COL.factory_code]  = form.factory_code || '';
    newRow[NSR_COL.ean]           = form.ean          || '';
    newRow[NSR_COL.item_name]     = form.listing_name;  // use listing_name as item_name
    newRow[NSR_COL.color]         = form.color         || '';
    newRow[NSR_COL.invoice_qty]   = Number(form.invoice_qty)  || 0;
    newRow[NSR_COL.unit_price]    = Number(form.unit_price)   || 0;
    newRow[NSR_COL.requested_by]  = payload.created_by || '';
    newRow[NSR_COL.requested_at]  = now;
    newRow[NSR_COL.status]        = 'PENDING';
    newRow[NSR_COL.listing_name]  = form.listing_name || '';
    newRow[NSR_COL.category]      = form.category     || '';
    newRow[NSR_COL.brand]         = form.brand        || '';
    newRow[NSR_COL.is_sample]     = !!form.is_sample;
    newRow[NSR_COL.last_edited_at]= now;
    newRow[NSR_COL.last_edited_by]= payload.created_by || '';

    // ── Full-form fields (same as apiSaveNewSkuDraft writes) ──
    newRow[NSR_COL.suggested_sku]         = form.suggested_sku         || '';
    newRow[NSR_COL.variant]               = form.variant               || '';
    newRow[NSR_COL.listing_type]          = form.listing_type          || '';
    newRow[NSR_COL.parent_sku]            = form.parent_sku            || '';
    newRow[NSR_COL.mrp]                   = Number(form.mrp)                   || '';
    newRow[NSR_COL.shopify_selling_price] = Number(form.shopify_selling_price) || '';
    newRow[NSR_COL.shopify_compare_price] = Number(form.shopify_compare_price) || '';
    newRow[NSR_COL.pkg_height_cm]         = Number(form.pkg_height_cm)         || '';
    newRow[NSR_COL.pkg_length_cm]         = Number(form.pkg_length_cm)         || '';
    newRow[NSR_COL.pkg_width_cm]          = Number(form.pkg_width_cm)          || '';
    newRow[NSR_COL.pkg_weight_gm]         = Number(form.pkg_weight_gm)         || '';
    newRow[NSR_COL.product_dims_mm]       = form.product_dims_mm       || '';
    newRow[NSR_COL.nw_gm]                 = Number(form.nw_gm)                 || '';
    newRow[NSR_COL.relevant_tags]         = form.relevant_tags        || '';
    newRow[NSR_COL.fnsku]                 = form.fnsku                || '';
    newRow[NSR_COL.fnsku_status_ee]       = form.fnsku_status_ee      || '';
    newRow[NSR_COL.remark]                = form.remark               || '';
    newRow[NSR_COL.notes]                 = form.notes                || '';
    newRow[NSR_COL.lead_time]             = Number(form.lead_time)             || '';
    newRow[NSR_COL.moq]                   = Number(form.moq)                   || '';
    newRow[NSR_COL.threshold_qty]         = Number(form.threshold_qty)         || '';
    newRow[NSR_COL.supplier_code]         = form.supplier_code        || '';
    newRow[NSR_COL.pack_size]             = Number(form.pack_size)             || '';

    sheet.appendRow(newRow);
    SpreadsheetApp.flush();

    return okResult_({
      request_id:   newId,
      status:       'PENDING',
      requested_at: now.toISOString(),
    });
  } catch(e) {
    Logger.log('apiCreateManualSkuRequest error: ' + e.message);
    return errResult_(e.message);
  }
}




// The bracket tables the price calculation reads. A table that came back EMPTY
// (its rows missing or misplaced in SKU_Config) is not "unset": lookupBracket_
// reads brackets[0].value of nothing and throws. It must not fall through to the
// hardcoded default tables either — silently pricing from stale numbers is worse
// than refusing. `undefined` (no config at all) still uses the defaults.
// Returns the name of the first empty table, or undefined.
function emptyPricingTable_(config) {
  return ['cm1_brackets', 'cm3_target_brackets', 'mrp_brackets', 'compare_brackets']
    .find(k => Array.isArray(config[k]) && config[k].length === 0);
}

// Why calculatePricing_ returned null, in words a person can act on. Every step
// that needs a price used to say "check unit_price and config values" (EasyEcom)
// or crash on `pricing.landing` of null (Zoho) — whatever was actually wrong.
function explainPricingFailure_(unitPriceCny, weightGm, config) {
  if (!unitPriceCny) return 'Cost (RMB ¥) is required to price this SKU. Save the draft first.';
  if (!config)       return 'The pricing config could not be loaded, so prices cannot be calculated. Please try again.';
  const empty = emptyPricingTable_(config);
  if (empty) {
    return `The pricing brackets (${empty}) are missing or empty in the SKU_Config sheet, so prices cannot be calculated. ` +
           `Fix the sheet, then retry.`;
  }
  const threshold = Number(config.threshold) || 40;
  if (unitPriceCny <= threshold && !weightGm) {
    return `Package weight is required for items costing ¥${threshold} or less (they ship by air, charged per gram). ` +
           `Enter Pkg Weight, save, then retry.`;
  }
  return 'Pricing calculation failed — check the cost and the pricing config.';
}

// Returns full pricing breakdown matching frontend formula exactly

function calculatePricing_(unitPriceCny, weightGm, config) {
  if (!unitPriceCny || !config) return null;

  const emptyTable = emptyPricingTable_(config);
  if (emptyTable) {
    Logger.log('calculatePricing_: bracket table "' + emptyTable + '" is empty — check the SKU_Config brackets block (N:O).');
    return null;
  }

  const cnyRate      = config.cny_conv_rate  || 14.36;
  const airRate      = config.air_rate        || 1.6;
  const seaMult      = config.sea_multiplier  || 1.35;
  const threshold    = config.threshold       || 40;
  const pickPack     = config.pick_pack       || 85;
  const shopifyCost  = config.shopify_cost_pct|| 0.18;
  const gstRate      = config.gst_rate        != null ? config.gst_rate : 0.05;

  // Step 1: Landing Price — RMB price ABOVE threshold ships SEA (multiplier
  // on the converted cost); at/below threshold ships AIR (converted cost
  // plus per-gram air freight).
  let landing, mode;
  if (unitPriceCny > threshold) {
    mode    = 'SEA';
    landing = unitPriceCny * cnyRate * seaMult;
  } else {
    mode    = 'AIR';
    if (!weightGm || weightGm === 0) return null; // blocked until weight entered
    landing = (unitPriceCny * cnyRate) + (weightGm * airRate);
  }
  landing = Math.round(landing);

  // Step 2 (reference only): CM1 target — lookup by landing price
  // (floor-based). No longer feeds the Raw SP formula — shown in the UI for
  // analysis/simulation only. Kept alongside CM3 target as of the 2026-09
  // pricing-logic revision.
  const cm1Brackets = config.cm1_brackets ||
    [{floor:0,value:47},{floor:500,value:45},{floor:1250,value:41},
     {floor:2000,value:39},{floor:4000,value:41},{floor:6000,value:35}];
  const cm1Pct = lookupBracket_(landing, cm1Brackets) / 100;

  // Step 2: CM3 target — lookup by landing price (floor-based). Drives the
  // Raw SP formula as of the 2026-09 revision (replaces CM1 target).
  const cm3TargetBrackets = config.cm3_target_brackets ||
    [{floor:0,value:34},{floor:250,value:28},{floor:500,value:24},
     {floor:1000,value:20},{floor:1500,value:19},{floor:2000,value:18},
     {floor:3000,value:18},{floor:4000,value:19},{floor:6000,value:20}];
  const cm3TargetPct = lookupBracket_(landing, cm3TargetBrackets) / 100;

  // Step 2: Raw SP — landing + pick&pack marked up to cover CM3 target and
  // Shopify's cut, then grossed up for GST.
  const rawSP = (landing + pickPack) / (1 - cm3TargetPct - shopifyCost) * (1 + gstRate);

  // Step 3: Bucket SP — nearest ₹50 ending in 49 or 99
  const suggestedSP = Math.round(rawSP / 50) * 50 - 1;

  // Step 4: Raw MRP — lookup by SP (floor-based); value is "Discount off
  // MRP %" (e.g. 40 = 40% off), so Raw MRP = SP / (1 - discount%).
  const mrpBrackets = config.mrp_brackets ||
    [{floor:0,value:40},{floor:501,value:35},{floor:1001,value:30},
     {floor:1501,value:25},{floor:2001,value:20}];
  const mrpDiscount = lookupBracket_(suggestedSP, mrpBrackets) / 100;
  const rawMRP       = suggestedSP / (1 - mrpDiscount);

  // Step 5: Bucket MRP
  const mrp = Math.round(rawMRP / 50) * 50 - 1;

  // Step 6: Compare At Price — lookup by SP, markup % as whole number
  const compareBrackets = config.compare_brackets ||
    [{floor:0,value:15},{floor:501,value:12},{floor:1501,value:10},
     {floor:3001,value:8},{floor:5001,value:6}];
  const compareMarkup  = lookupBracket_(suggestedSP, compareBrackets) / 100;
  const rawCompare     = Math.min(suggestedSP * (1 + compareMarkup), mrp);
  const compareAtPrice = Math.round(rawCompare / 50) * 50 - 1;

  // Step 7: CM1 actual — Gross Margin = Net Sales (ex-GST) - COGS
  // (landing + pick&pack). CM1%/CM3% and the Shopify deduction are all
  // expressed against Net Sales, not gross (GST-inclusive) SP.
  const netSales  = suggestedSP / (1 + gstRate);
  const cm1Profit = netSales - landing - pickPack;
  const actualCM1 = (cm1Profit / netSales) * 100;

  // Step 8: CM3 actual — Net Margin = Gross Margin - indirect cost (Shopify).
  const cm3Profit = cm1Profit - (shopifyCost * netSales);
  const actualCM3 = (cm3Profit / netSales) * 100;

  return {
    mode,
    landing,
    cm1_target:       Math.round(cm1Pct * 100),
    cm3_target:       Math.round(cm3TargetPct * 100),
    raw_sp:           Math.round(rawSP),
    suggested_sp:     suggestedSP,
    raw_mrp:          Math.round(rawMRP),
    mrp,
    raw_compare_at_price: Math.round(rawCompare),
    compare_at_price: compareAtPrice,
    actual_cm1:       Math.round(actualCM1 * 100) / 100,
    cm3:              Math.round(cm3Profit),
    actual_cm3:       Math.round(actualCM3 * 100) / 100,
  };
}

// Bracket lookup — finds highest floor ≤ value, returns that bracket's value.
// A trailing sentinel floor (>=999999) represents an open-ended "greater
// than every real floor" bracket — it must only win when value exceeds the
// PREVIOUS real floor, not merely because the loop reached it. Applying it
// unconditionally (as an earlier version did) mis-bucketed any value that
// exactly equalled the last real floor (e.g. SP === 2000 for MRP brackets).
function lookupBracket_(value, brackets) {
  let result = brackets[0].value;
  for (let i = 0; i < brackets.length; i++) {
    const b = brackets[i];
    if (b.floor >= 999999) {
      if (i > 0 && value > brackets[i - 1].floor) result = b.value;
      break;
    }
    if (value >= b.floor) result = b.value;
    else break;
  }
  return result;
}
// New GAS function — add to NewSkuApi.gs
// Payload: { action, parent_sku }
// Looks up EE Product Master by SKU → returns product name
// Used when listing_type = 'Existing Variant'

function apiGetParentSkuDetails(payload) {
  try {
    const parentSku = String(payload.parent_sku || '').trim();
    if (!parentSku) return errResult_('parent_sku is required');

    const ss     = SpreadsheetApp.getActiveSpreadsheet();
    const sheet  = ss.getSheetByName(EE_MASTER);
    if (!sheet)  return errResult_(`Sheet "${EE_MASTER}" not found`);

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];

    // Col A = Product ID, Col B = SKU, Col C = Product Name
    const skuColIdx  = headers.indexOf('SKU');
    const nameColIdx = headers.indexOf('Product Name');
    const idColIdx   = headers.indexOf('Product ID');

    if (skuColIdx === -1)  return errResult_('"SKU" column not found in EE Product Master');
    if (nameColIdx === -1) return errResult_('"Product Name" column not found in EE Product Master');

    const row = data.slice(1).find(
      r => String(r[skuColIdx]).trim() === parentSku
    );

    if (row) {
      return okResult_({
        parent_sku:          parentSku,
        parent_product_name: String(row[nameColIdx]).trim(),
        parent_product_id:   String(row[idColIdx]).trim(),
      });
    }

    // EE Product Master syncs once a day — fall back to New_SKU_Requests
    // (real-time) for a SKU created earlier today, same pattern already
    // used for SKU auto-assignment (apiGetNextAvailableSku above).
    const nsrSheet = ss.getSheetByName(NSR_SHEET);
    if (nsrSheet) {
      const nsrRows = nsrSheet.getDataRange().getValues().slice(1);
      const nsrRow = nsrRows.find(r =>
        String(r[NSR_COL.suggested_sku]).trim() === parentSku ||
        String(r[NSR_COL.ee_sku]).trim() === parentSku
      );
      if (nsrRow) {
        const obj = nsrRowToObject_(nsrRow);
        return okResult_({
          parent_sku:          parentSku,
          parent_product_name: obj.listing_name || obj.item_name || '',
          parent_product_id:   '', // not yet in EE Product Master's daily sync
        });
      }
    }

    return errResult_(`Parent SKU "${parentSku}" not found in EE Product Master`);
  } catch(e) {
    Logger.log('apiGetParentSkuDetails error: ' + e.message);
    return errResult_(e.message);
  }
}
// ─────────────────────────────────────────────────────────────
// GET BRANDS — from Vendor_Masters sheet col A
// ─────────────────────────────────────────────────────────────
// Payload: { action }
// Returns: { success, data: string[] }

function apiGetBrands(payload) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Vendor Masters');
    if (!sheet) return errResult_('Vendor Masters sheet not found');

    const rows   = sheet.getDataRange().getValues().slice(1);
    // Col A (index 0) = Vendor/Brand name e.g. QiYi, MoYu, GAN
    const brands = rows
      .map(r => String(r[0]).trim())
      .filter(b => b && b !== '')
      .sort();

    return okResult_(brands);
  } catch(e) {
    Logger.log('apiGetBrands error: ' + e.message);
    return errResult_(e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// ADD BRAND — append a new brand to Vendor Masters sheet col A
// ─────────────────────────────────────────────────────────────
// Payload: { action, brand }
// Returns: { success, data: { brand, created } }
//
// Called when a user types a brand name in the Create SKU form that
// isn't already in the Brand dropdown. Appends it to col A only —
// vendor_code/vendor_name/active (used by apiGetVendorMasters for
// Draft Orders / PO vendor selection) are left blank, so the new row
// is picked up by apiGetBrands but skipped everywhere vendor_code is
// required. Idempotent: a brand already present (case-insensitive)
// is left untouched.

function apiAddBrand(payload) {
  const lock = LockService.getScriptLock();
  try {
    const brand = String(payload.brand || '').trim();
    if (!brand) return errResult_('Brand name is required');

    if (!lock.tryLock(10000)) {
      return errResult_('Another brand update is in progress. Please try again.');
    }

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Vendor Masters');
    if (!sheet) return errResult_('Vendor Masters sheet not found');

    const rows = sheet.getDataRange().getValues().slice(1);
    const exists = rows.some(r => String(r[0]).trim().toLowerCase() === brand.toLowerCase());
    if (exists) {
      return okResult_({ brand, created: false });
    }

    sheet.appendRow([brand]);
    SpreadsheetApp.flush();

    return okResult_({ brand, created: true });
  } catch(e) {
    Logger.log('apiAddBrand error: ' + e.message);
    return errResult_(e.message);
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────
// GET VARIANTS — from the SKU_Config sheet variants block (K:L)
// ─────────────────────────────────────────────────────────────
// Payload: { action }
// Returns: { success, data: string[] }

function apiGetVariants(payload) {
  try {
    const sheet = getSkuConfigSheet_();
    const last  = sheet.getLastRow();
    if (last < 2) return okResult_([]);

    // Variants block: K:L, values in L (K just holds the 'VARIANT' label).
    const variants = sheet.getRange(2, SKU_CONFIG_COLS.variantVal, last - 1, 1).getValues()
      .map(r => String(r[0]).trim())
      .filter(v => v && v !== '')
      // Deduplicate and sort (case-insensitive)
      .filter((v, i, arr) =>
        arr.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i
      )
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    return okResult_(variants);
  } catch(e) {
    Logger.log('apiGetVariants error: ' + e.message);
    return errResult_(e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// GET SHIPMENT PARTNERS — from the SKU_Config sheet's R column (see LAYOUT
// comment above) — used by CNF Agent Accounting's Air Log Entry form.
// ─────────────────────────────────────────────────────────────
// Payload: { action }
// Returns: { success, data: string[] }

function apiGetShipmentPartners_(payload) {
  try {
    const sheet = getSkuConfigSheet_();
    const last  = sheet.getLastRow();
    if (last < 2) return okResult_([]);

    const partners = sheet.getRange(2, SKU_CONFIG_COLS.shipmentPartnerVal, last - 1, 1).getValues()
      .map(r => String(r[0]).trim())
      .filter(v => v && v !== '')
      .filter((v, i, arr) =>
        arr.findIndex(x => x.toLowerCase() === v.toLowerCase()) === i
      )
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    return okResult_(partners);
  } catch(e) {
    Logger.log('apiGetShipmentPartners_ error: ' + e.message);
    return errResult_(e.message);
  }
}


// =================================================================
// UPDATE SKU SCREEN — search, provision, and per-platform field push
// for editing a SKU's details after the fact, independent of the
// creation-pipeline lock (canDoStep) in the Create SKU tab.
// =================================================================

// ─────────────────────────────────────────────────────────────
// SEARCH SKU FOR UPDATE
// ─────────────────────────────────────────────────────────────
// Payload: { action, query }
// First searches New_SKU_Requests (suggested_sku / listing_name /
// item_name / request_id, substring, case-insensitive). If nothing
// matches, falls back to EE Product Master (SKU / Product Name) for
// SKUs that were never entered through this dashboard — those come
// back with linked:false and no request_id; the frontend provisions
// a row for them on selection (see apiProvisionSkuForUpdate below).
// Returns: { success, data: Array<{ linked, request_id?, suggested_sku,
//            listing_name, status? }> }

function apiSearchSkuForUpdate(payload) {
  try {
    const query = String(payload.query || '').trim().toLowerCase();
    if (!query) return errResult_('A search query is required');
    const sampleOnly = !!payload.sample_only;

    const sheet = getNsrSheet_();
    const rows  = sheet.getDataRange().getValues().slice(1)
      .filter(r => String(r[NSR_COL.request_id]).trim() !== '');

    const nsrMatches = rows
      .map(r => nsrRowToObject_(r))
      .filter(obj =>
        obj.suggested_sku.toLowerCase().includes(query) ||
        obj.listing_name.toLowerCase().includes(query) ||
        obj.item_name.toLowerCase().includes(query) ||
        obj.request_id.toLowerCase().includes(query)
      )
      .filter(obj => !sampleOnly || obj.is_sample)
      .slice(0, 20)
      .map(obj => ({
        linked:        true,
        request_id:    obj.request_id,
        suggested_sku: obj.suggested_sku,
        listing_name:  obj.listing_name || obj.item_name,
        status:        obj.status,
        is_sample:     obj.is_sample,
      }));

    if (nsrMatches.length > 0) return okResult_(nsrMatches);
    // Samples only ever exist as NSR rows (they go through the same
    // creation flow as any other SKU) — nothing to fall back to.
    if (sampleOnly) return okResult_([]);

    // Fall back to EE Product Master for SKUs with no NSR row yet
    const masterSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EE_MASTER);
    if (!masterSheet) return okResult_([]);

    const masterData = masterSheet.getDataRange().getValues();
    const headers     = masterData[0];
    const skuColIdx   = headers.indexOf('SKU');
    const nameColIdx  = headers.indexOf('Product Name');
    if (skuColIdx === -1 || nameColIdx === -1) return okResult_([]);

    // Suggested SKUs already linked — exclude them from the "unlinked" list
    const linkedSkus = new Set(
      rows.map(r => String(r[NSR_COL.suggested_sku]).trim()).filter(Boolean)
    );

    const masterMatches = masterData.slice(1)
      .filter(r => {
        const sku  = String(r[skuColIdx]).trim();
        const name = String(r[nameColIdx]).trim();
        if (!sku || linkedSkus.has(sku)) return false;
        return sku.toLowerCase().includes(query) || name.toLowerCase().includes(query);
      })
      .slice(0, 20)
      .map(r => ({
        linked:        false,
        suggested_sku: String(r[skuColIdx]).trim(),
        listing_name:  String(r[nameColIdx]).trim(),
      }));

    return okResult_(masterMatches);
  } catch(e) {
    Logger.log('apiSearchSkuForUpdate error: ' + e.message);
    return errResult_(e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// GET PRODUCT IDENTIFIERS
// ─────────────────────────────────────────────────────────────
// Payload: { action }
// Returns { sku, ean, articleNumber, otherFactoryCode } for every live
// EE Product Master row — a lightweight client-side lookup so the Update
// SKU screen can warn on an EAN/Factory Code/Article Number that's
// already used by a DIFFERENT live SKU, the same "warn, don't block"
// pattern the Create SKU screen already runs against pending drafts.
function apiGetProductIdentifiers(payload) {
  try {
    const products = loadEEProductMaster_();
    const identifiers = products.map(p => ({
      sku:              p.sku,
      ean:              p.ean,
      articleNumber:    p.articleNumber,
      otherFactoryCode: p.otherFactoryCode,
    }));
    return okResult_(identifiers);
  } catch(e) {
    Logger.log('apiGetProductIdentifiers error: ' + e.message);
    return errResult_(e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// PROVISION SKU FOR UPDATE
// ─────────────────────────────────────────────────────────────
// Payload: { action, sku }
// Auto-creates a New_SKU_Requests row for a SKU found only on
// EasyEcom (via apiSearchSkuForUpdate's unlinked results), so the
// Update SKU screen — and every existing per-platform save function —
// has a normal row to work with. Live-checks Zoho and Shopify too, so
// platform status reflects reality immediately. Status is set straight
// to 'CREATED' so this row doesn't show up as pending work on the main
// Create SKU dashboard. Fields with no source anywhere (pkg dims,
// lead time, etc.) are left blank — that's exactly why they'd surface
// on the IMP review list afterward.
// Returns: { success, data: { request_id } }

function apiProvisionSkuForUpdate(payload) {
  try {
    const sku = String(payload.sku || '').trim();
    if (!sku) return errResult_('sku is required');

    const sheet = getNsrSheet_();
    const rows  = sheet.getDataRange().getValues().slice(1);

    const existing = rows.find(r => String(r[NSR_COL.suggested_sku]).trim() === sku);
    if (existing) {
      return okResult_({ request_id: String(existing[NSR_COL.request_id]) });
    }

    const masterSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EE_MASTER);
    if (!masterSheet) return errResult_(`Sheet "${EE_MASTER}" not found`);
    const masterData = masterSheet.getDataRange().getValues();
    const headers     = masterData[0];
    const skuColIdx   = headers.indexOf('SKU');
    const nameColIdx  = headers.indexOf('Product Name');
    const matchRow = masterData.slice(1).find(r => String(r[skuColIdx]).trim() === sku);
    if (!matchRow) return errResult_(`SKU "${sku}" was not found in EE Product Master`);

    const productName = String(matchRow[nameColIdx]).trim();

    // Live-check Zoho
    let zohoItem = null;
    try {
      const token = fetchAccessToken_();
      const base  = getZohoApisBase_(AUTH.DC);
      zohoItem = findZohoItemBySku_(base, token, CONFIG.ORG_ID, sku);
    } catch(e) {
      Logger.log('apiProvisionSkuForUpdate: Zoho check failed — ' + e.message);
    }

    // Live-check Shopify
    let shopifyIds = null;
    try {
      shopifyIds = getShopifyProductAndVariantIdBySku_(sku);
    } catch(e) {
      Logger.log('apiProvisionSkuForUpdate: Shopify check failed — ' + e.message);
    }

    // Re-check and append under the script lock. The "already provisioned"
    // check at the top and this append aren't atomic, and the Zoho/Shopify
    // lookups in between take seconds — a double-click or a second user could
    // both pass the check and append two rows for the same SKU. The lock is
    // taken only here, after the slow live checks, so it isn't held across them.
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return errResult_('Another request is in progress. Please try again.');
    try {
      const dup = sheet.getDataRange().getValues().slice(1)
        .find(r => String(r[NSR_COL.suggested_sku]).trim() === sku);
      if (dup) return okResult_({ request_id: String(dup[NSR_COL.request_id]) });

      const now   = new Date();
      const newId = generateRequestId_();
      const newRow = new Array(NSR_TOTAL_COLS).fill('');
      newRow[NSR_COL.request_id]     = newId;
      newRow[NSR_COL.item_name]      = productName;
      newRow[NSR_COL.requested_by]   = 'system (auto-provisioned)';
      newRow[NSR_COL.requested_at]   = now;
      newRow[NSR_COL.status]         = 'CREATED';
      newRow[NSR_COL.ee_sku]         = sku;
      newRow[NSR_COL.ee_product_name]= productName;
      newRow[NSR_COL.suggested_sku]  = sku;
      newRow[NSR_COL.listing_name]   = productName;
      if (zohoItem)   newRow[NSR_COL.zoho_created_date]   = now;
      if (shopifyIds) newRow[NSR_COL.shopify_listing_url] = `https://admin.shopify.com/store/cubelelo-cube-store/products/${shopifyIds.productId}`;
      newRow[NSR_COL.last_edited_at] = now;
      newRow[NSR_COL.last_edited_by] = 'system (auto-provisioned)';

      sheet.appendRow(newRow);
      SpreadsheetApp.flush();

      return okResult_({ request_id: newId });
    } finally {
      lock.releaseLock();
    }
  } catch(e) {
    Logger.log('apiProvisionSkuForUpdate error: ' + e.message);
    return errResult_(e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// UPDATE SKU FIELDS — batch save with per-platform push
// ─────────────────────────────────────────────────────────────
// Payload: { action, request_id, fields: { fieldName: value, ... } }
// Only `fields` actually present are written to the sheet and pushed
// onward — nothing here re-sends unchanged data. Field → platform
// mapping reverse-engineered from apiCreateSkuOnEasyEcom /
// apiCreateSkuOnZoho / apiCreateSkuOnShopify (see plan doc); notably
// category/brand are NOT sent to Zoho because createZohoItem_ never
// actually includes them in its outgoing payload either, and EE's
// Category is hardcoded at creation (not driven by the category field).
// Returns: { success, data: { fields_saved, platforms: {
//   easyecom: 'success'|'failed'|'skipped',
//   zoho:     'success'|'failed'|'skipped',
//   shopify:  'success'|'failed'|'skipped' } } }

// The only New_SKU_Requests columns apiUpdateSkuFields will write — mirrors
// the Update SKU form's editable fields (EDITABLE_FIELDS in UpdateSkuScreen.tsx)
// plus shopify_compare_price, which the platform push already handles.
const UPDATABLE_SKU_FIELDS_ = new Set([
  'listing_name', 'variant', 'brand', 'category', 'color',
  'mrp', 'shopify_selling_price', 'shopify_compare_price', 'ean',
  'pack_size', 'pkg_height_cm', 'pkg_length_cm', 'pkg_width_cm', 'pkg_weight_gm',
  'product_dims_mm', 'nw_gm', 'unit_price', 'fnsku', 'factory_code',
  'lead_time', 'moq', 'threshold_qty', 'supplier_code', 'remark',
  'relevant_tags', 'invoice_qty', 'vendor_code', 'notes', 'is_sample',
]);

function apiUpdateSkuFields(payload) {
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(10000)) {
      return errResult_('Another save is already in progress for this request. Please try again.');
    }

    const sheet  = getNsrSheet_();
    const data   = sheet.getDataRange().getValues();
    const rows   = data.slice(1);
    const rowIdx = rows.findIndex(r => String(r[NSR_COL.request_id]) === payload.request_id);
    if (rowIdx === -1) return errResult_(`Request ${payload.request_id} not found`);

    const sheetRow = rowIdx + 2;
    const before   = nsrRowToObject_(rows[rowIdx]);
    const fields   = payload.fields || {};

    // Only the fields the Update SKU form exposes may be written. suggested_sku
    // (the cross-platform identity key) is deliberately not in the list. This
    // used to `delete fields.suggested_sku` AFTER the key list was captured,
    // so a request that included it still reached the write loop — as a blank —
    // and any other New_SKU_Requests column (status, ee_sku, request_id…) was
    // equally writable.
    const fieldKeys = Object.keys(fields).filter(k => UPDATABLE_SKU_FIELDS_.has(k));
    if (fieldKeys.length === 0) return errResult_('No fields to save');

    // A price cleared to blank/0 would be pushed to EasyEcom/Zoho/Shopify as 0.
    const badPrice = ['mrp', 'shopify_selling_price', 'unit_price']
      .find(k => fieldKeys.includes(k) && !(Number(fields[k]) > 0));
    if (badPrice) return errResult_(`${badPrice} must be greater than 0`);

    // ── Write every provided field to the sheet ──
    const NUMERIC_FIELDS = new Set([
      'mrp', 'shopify_selling_price', 'shopify_compare_price',
      'pkg_height_cm', 'pkg_length_cm', 'pkg_width_cm', 'pkg_weight_gm',
      'nw_gm', 'unit_price', 'lead_time', 'moq', 'threshold_qty', 'pack_size',
    ]);
    const cells = {};
    fieldKeys.forEach(key => {
      cells[NSR_COL[key]] = NUMERIC_FIELDS.has(key) ? (Number(fields[key]) || '') : (fields[key] || '');
    });
    cells[NSR_COL.last_edited_at] = new Date();
    if (payload.updated_by) cells[NSR_COL.last_edited_by] = payload.updated_by;
    writeNsrCells_(sheet, sheetRow, cells);
    SpreadsheetApp.flush();

    // Merged view (old values + this save's changes) for computing
    // derived pricing and for building each platform's push payload.
    const after = { ...before, ...fields };
    const touched = key => fieldKeys.includes(key);

    const platforms = { easyecom: 'skipped', zoho: 'skipped', shopify: 'skipped' };
    // Exact outgoing payload + raw response/error per platform, keyed the
    // same as `platforms` — feeds the audit log so a failure can be
    // root-caused from the sheet alone (see logAuditEvent_).
    const platformDetails = { easyecom: {}, zoho: {}, shopify: {} };

    // ── EasyEcom ──
    const EE_FIELDS = ['listing_name', 'variant', 'mrp', 'shopify_selling_price',
      'pack_size', 'pkg_height_cm', 'pkg_length_cm', 'pkg_width_cm', 'pkg_weight_gm',
      'ean', 'fnsku', 'factory_code', 'lead_time', 'moq', 'threshold_qty',
      'supplier_code', 'remark', 'unit_price', 'color'];
    if (before.ee_sku && EE_FIELDS.some(touched)) {
      try {
        const pricingConfig = apiGetPricingConfig({}).data;
        const pricing = calculatePricing_(after.unit_price, after.pkg_weight_gm, pricingConfig);
        const eeFields = {};
        if (touched('listing_name') || touched('variant')) {
          eeFields.ModelName = after.variant ? `${after.listing_name} ${after.variant}` : after.listing_name;
        }
        if (touched('mrp')) eeFields.AccountingUnit = after.mrp;
        if (touched('shopify_selling_price')) eeFields.Mrp = after.shopify_selling_price;
        if (touched('pack_size')) eeFields.Size = after.pack_size || '';
        if (touched('pkg_height_cm')) eeFields.Height = after.pkg_height_cm;
        if (touched('pkg_length_cm')) eeFields.Length = after.pkg_length_cm;
        if (touched('pkg_width_cm'))  eeFields.Width  = after.pkg_width_cm;
        if (touched('pkg_weight_gm')) eeFields.Weight = after.pkg_weight_gm;
        if (touched('ean')) eeFields.EANUPC = after.ean || '';
        if (touched('fnsku')) eeFields.ModelNumber = after.fnsku || after.suggested_sku;
        if (touched('color')) eeFields.Color = after.color || '';
        if ((touched('unit_price') || touched('pkg_weight_gm')) && pricing) {
          eeFields.Cost = pricing.landing;
        }

        const eeCustomFields = {};
        if (touched('unit_price')) eeCustomFields.RMB_PRICE = after.unit_price;
        if (touched('lead_time')) eeCustomFields.Lead_Time = after.lead_time || '';
        if (touched('moq')) eeCustomFields.MOQ = after.moq || '';
        if (touched('threshold_qty')) eeCustomFields.Threshold_Qty = after.threshold_qty || '';
        if (touched('supplier_code')) eeCustomFields.Supplier_Code = after.supplier_code || '';
        if (touched('pack_size')) eeCustomFields['Pack Size'] = after.pack_size || '';
        if (touched('remark')) eeCustomFields.Remark = after.remark || '';
        if (touched('ean')) eeCustomFields.EAN = after.ean || '';
        if (touched('factory_code')) {
          // Same combined "AccountingSKU|ArticleNumber" shape apiSaveNewSkuDraft
          // already writes to the sheet — split it the same way apiCreateSkuOnEasyEcom does.
          const factoryRaw   = String(after.factory_code || '').trim();
          const hasPipe      = factoryRaw.includes('|');
          const parts        = factoryRaw.split('|');
          eeFields.AccountingSKU = hasPipe ? parts[0].trim() : '';
          eeCustomFields['Article Number'] = hasPipe ? parts[1].trim() : factoryRaw;
        }

        // Collision check — proposed Factory Code/EAN already used by a
        // DIFFERENT SKU. Same enforcement as the Review Requests approval
        // flow (apiResolveSkuUpdateRequest): strip the identifier from its
        // previous owner and log the removal either way, so a manual edit
        // here can't silently leave two SKUs sharing one identifier.
        if (eeCustomFields['Article Number'] || eeCustomFields['EAN']) {
          const collisionMaster = loadEEProductMaster_();
          if (eeCustomFields['Article Number']) {
            const proposedArticleNumber = eeCustomFields['Article Number'];
            const collision = collisionMaster.find(p => p.sku !== before.ee_sku && p.articleNumber === proposedArticleNumber);
            if (collision) {
              const strip = clearEasyEcomIdentifierField_(collision.sku, 'Article Number');
              logAuditEvent_('EASYECOM', 'IDENTIFIER_REMOVED', collision.sku,
                `Factory Code "${proposedArticleNumber}" removed from SKU "${collision.sku}" to allow reassignment to "${before.ee_sku}" via manual Update SKU edit`,
                strip.success ? 'SUCCESS' : 'FAILED', payload.updated_by, payload.request_id);
            }
          }
          if (eeCustomFields['EAN']) {
            const proposedEanVal = eeCustomFields['EAN'];
            const collision = collisionMaster.find(p => p.sku !== before.ee_sku && p.ean === proposedEanVal);
            if (collision) {
              const strip = clearEasyEcomIdentifierField_(collision.sku, 'EAN');
              logAuditEvent_('EASYECOM', 'IDENTIFIER_REMOVED', collision.sku,
                `EAN "${proposedEanVal}" removed from SKU "${collision.sku}" to allow reassignment to "${before.ee_sku}" via manual Update SKU edit`,
                strip.success ? 'SUCCESS' : 'FAILED', payload.updated_by, payload.request_id);
            }
          }
        }

        const result = updateEasyEcomProduct_(before.ee_sku, eeFields, eeCustomFields);
        platforms.easyecom = result.ok ? 'success' : 'failed';
        platformDetails.easyecom = { payload: { ...eeFields, customFields: eeCustomFields }, response: result.message || (result.ok ? 'OK' : '') };
        if (!result.ok) Logger.log('apiUpdateSkuFields: EasyEcom update failed — ' + result.message);
      } catch(e) {
        platforms.easyecom = 'failed';
        platformDetails.easyecom = { response: e.message };
        Logger.log('apiUpdateSkuFields: EasyEcom update error — ' + e.message);
      }
    }

    // ── Zoho ── (category/brand intentionally excluded — see header note)
    const ZOHO_FIELDS = ['listing_name', 'variant', 'unit_price', 'pkg_weight_gm',
      'shopify_selling_price', 'mrp', 'ean'];
    if (before.zoho_created_date && ZOHO_FIELDS.some(touched)) {
      try {
        const token = fetchAccessToken_();
        const base  = getZohoApisBase_(AUTH.DC);
        const item  = findZohoItemBySku_(base, token, CONFIG.ORG_ID, before.suggested_sku);
        if (!item) {
          platforms.zoho = 'failed';
          platformDetails.zoho = { response: 'Zoho item not found for SKU ' + before.suggested_sku };
          Logger.log('apiUpdateSkuFields: Zoho item not found for ' + before.suggested_sku);
        } else {
          const pricingConfig = apiGetPricingConfig({}).data;
          const pricing = calculatePricing_(after.unit_price, after.pkg_weight_gm, pricingConfig);
          const zohoFields = {};
          if (touched('listing_name') || touched('variant')) {
            zohoFields.name = after.variant ? `${after.listing_name} ${after.variant}` : after.listing_name;
          }
          if (touched('shopify_selling_price')) zohoFields.rate = after.shopify_selling_price;
          if (touched('mrp')) zohoFields.label_rate = after.mrp;
          if (touched('ean')) zohoFields.ean = after.ean || 0;
          if ((touched('unit_price') || touched('pkg_weight_gm')) && pricing) {
            zohoFields.purchase_rate = pricing.landing;
          }
          const result = updateZohoItem_(item.item_id, zohoFields);
          platforms.zoho = result.ok ? 'success' : 'failed';
          platformDetails.zoho = { payload: { item_id: item.item_id, ...zohoFields }, response: result.message || (result.ok ? 'OK' : '') };
          if (!result.ok) Logger.log('apiUpdateSkuFields: Zoho update failed — ' + result.message);
        }
      } catch(e) {
        platforms.zoho = 'failed';
        platformDetails.zoho = { response: e.message };
        Logger.log('apiUpdateSkuFields: Zoho update error — ' + e.message);
      }
    }

    // ── Shopify ──
    const SHOPIFY_FIELDS = ['listing_name', 'brand', 'category', 'relevant_tags',
      'variant', 'shopify_selling_price', 'shopify_compare_price', 'ean', 'pkg_weight_gm',
      'product_dims_mm', 'nw_gm', 'mrp'];
    if (before.shopify_listing_url && SHOPIFY_FIELDS.some(touched)) {
      try {
        const ids = getShopifyProductAndVariantIdBySku_(before.suggested_sku);
        if (!ids) {
          platforms.shopify = 'failed';
          platformDetails.shopify = { response: 'Shopify product not found for SKU ' + before.suggested_sku };
          Logger.log('apiUpdateSkuFields: Shopify product not found for ' + before.suggested_sku);
        } else {
          const productFields = {};
          if (touched('listing_name')) {
            productFields.title = after.listing_name;
            productFields.body_html = after.listing_name;
          }
          if (touched('brand')) productFields.vendor = after.brand;
          if (touched('category')) productFields.product_type = after.category;
          if (touched('relevant_tags')) productFields.tags = after.relevant_tags || '';
          if (touched('mrp') || touched('product_dims_mm') || touched('nw_gm')) {
            const metafields = [];
            if (touched('product_dims_mm')) metafields.push({ key: 'dimensions', value: after.product_dims_mm || '', value_type: 'string', namespace: 'my_fields' });
            if (touched('nw_gm')) metafields.push({ key: 'product_weight', value: Math.round(after.nw_gm || 0), value_type: 'integer', namespace: 'my_fields' });
            if (touched('mrp')) metafields.push({ key: 'mrp', value: after.mrp, value_type: 'integer', namespace: 'my_fields' });
            productFields.metafields = metafields;
          }

          const variantFields = {};
          if (touched('variant')) variantFields.option1 = after.variant || 'Default';
          if (touched('shopify_selling_price')) variantFields.price = after.shopify_selling_price;
          if (touched('shopify_compare_price')) variantFields.compare_at_price = after.shopify_compare_price || null;
          if (touched('ean')) variantFields.barcode = after.ean || '';
          if (touched('pkg_weight_gm')) variantFields.weight = (after.pkg_weight_gm || 0) / 1000;

          const result = updateShopifyProduct_(ids.productId, ids.variantId, productFields, variantFields);
          const productOk = !result.product || result.product.ok;
          const variantOk = !result.variant || result.variant.ok;
          platforms.shopify = (productOk && variantOk) ? 'success' : 'failed';
          platformDetails.shopify = {
            payload: { product: productFields, variant: variantFields },
            response: { product: result.product, variant: result.variant },
          };
          if (!productOk) Logger.log('apiUpdateSkuFields: Shopify product update failed — ' + JSON.stringify(result.product));
          if (!variantOk) Logger.log('apiUpdateSkuFields: Shopify variant update failed — ' + JSON.stringify(result.variant));
        }
      } catch(e) {
        platforms.shopify = 'failed';
        platformDetails.shopify = { response: e.message };
        Logger.log('apiUpdateSkuFields: Shopify update error — ' + e.message);
      }
    }

    // One audit row per platform actually touched — skips platforms this
    // save had nothing to do with, reusing the result this function
    // already computed rather than re-deriving anything.
    const changedFieldSummary = fieldKeys.join(', ');
    const CHANNEL_BY_PLATFORM = { easyecom: 'EASYECOM', zoho: 'ZOHO', shopify: 'SHOPIFY' };
    Object.keys(platforms).forEach(p => {
      if (platforms[p] === 'skipped') return;
      const det = platformDetails[p] || {};
      logAuditEvent_(
        CHANNEL_BY_PLATFORM[p], 'UPDATE', before.suggested_sku,
        `${changedFieldSummary} updated`,
        platforms[p] === 'success' ? 'SUCCESS' : 'FAILED',
        payload.updated_by, payload.request_id,
        det.payload, det.response
      );
    });

    // Fields whose platform push failed. The sheet already holds the new value
    // (it is written first), so the UI keeps these marked as unsaved-to-platform
    // and a second Save re-sends just them — otherwise a partial failure left
    // the sheet and the platform silently out of step with no way to retry.
    const PLATFORM_FIELDS = { easyecom: EE_FIELDS, zoho: ZOHO_FIELDS, shopify: SHOPIFY_FIELDS };
    const failedFieldSet = {};
    Object.keys(platforms).forEach(p => {
      if (platforms[p] === 'failed') PLATFORM_FIELDS[p].filter(touched).forEach(f => { failedFieldSet[f] = true; });
    });

    return okResult_({ fields_saved: fieldKeys, platforms, failed_fields: Object.keys(failedFieldSet) });
  } catch(e) {
    Logger.log('apiUpdateSkuFields error: ' + e.message);
    return errResult_(e.message);
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────
// GET AUDIT LOG
// ─────────────────────────────────────────────────────────────
// Payload: { action, channel?, date_from?, date_to?, search? }
// Returns: { success, data: Array<{timestamp, channel, action, entity_id,
//            summary, status, actor, request_id}> }, newest first, capped.

function apiGetAuditLog(payload) {
  try {
    const sheet = ensureAuditLogSheet_();
    const data  = sheet.getDataRange().getValues();
    if (data.length <= 1) return okResult_([]);

    const rows = data.slice(1).map(r => ({
      timestamp:  r[0] ? new Date(r[0]).toISOString() : '',
      channel:    String(r[1] || ''),
      action:     String(r[2] || ''),
      entity_id:  String(r[3] || ''),
      summary:    String(r[4] || ''),
      status:     String(r[5] || ''),
      actor:      String(r[6] || ''),
      request_id: String(r[7] || ''),
      payload:    String(r[8] || ''),
      response:   String(r[9] || ''),
    }));

    const f = payload || {};
    const filtered = rows.filter(row => {
      if (f.channel && f.channel !== 'ALL' && row.channel !== f.channel) return false;
      if (f.date_from && row.timestamp < f.date_from) return false;
      if (f.date_to) {
        const toDate = new Date(f.date_to);
        toDate.setDate(toDate.getDate() + 1);
        if (new Date(row.timestamp) > toDate) return false;
      }
      if (f.search) {
        const q = String(f.search).toLowerCase();
        const haystack = [row.entity_id, row.summary, row.request_id].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    // Newest first, capped like every other list endpoint in this file
    filtered.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    return okResult_(filtered.slice(0, 200));
  } catch(e) {
    Logger.log('apiGetAuditLog error: ' + e.message);
    return errResult_(e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// GET PENDING SKU UPDATE REQUESTS — Update SKU → Review Requests subtab
// ─────────────────────────────────────────────────────────────
// Payload: { action, status? }  (default: 'PENDING')
// Returns rows from SKU_Update_Requests, re-enriched with a FRESH read of
// EE Product Master (current_master_*) alongside the snapshot taken when
// the request was submitted (master_*_snapshot) — the review screen shows
// both so an admin can see if the master already moved since the request.

function apiGetPendingSkuUpdateRequests(payload) {
  try {
    const status = (payload && payload.status) || 'PENDING';
    const sheet = ensureSkuUpdateRequestsSheet_();
    const data  = sheet.getDataRange().getValues();
    if (data.length <= 1) return okResult_([]);

    const headers = data[0];
    const idx = name => headers.indexOf(name);

    const productMaster = loadEEProductMaster_();
    const masterBySku = {};
    productMaster.forEach(p => { masterBySku[p.sku] = p; });

    const rows = data.slice(1)
      .filter(r => status === 'ALL' || String(r[idx('status')] || '').trim() === status)
      .map(r => {
        const targetSku = String(r[idx('target_sku')] || '');
        const master = masterBySku[targetSku] || {};
        return {
          request_id:                    String(r[idx('request_id')] || ''),
          shipment_id:                   String(r[idx('shipment_id')] || ''),
          vendor_code:                   String(r[idx('vendor_code')] || ''),
          target_sku:                    targetSku,
          item_name:                     String(r[idx('item_name')] || ''),
          color:                         String(r[idx('color')] || ''),
          my_id:                         String(r[idx('my_id')] || ''),
          proposed_factory_code:         String(r[idx('proposed_factory_code')] || ''),
          proposed_ean:                  String(r[idx('proposed_ean')] || ''),
          proposed_unit_price:           Number(r[idx('proposed_unit_price')] || 0),
          master_factory_code_snapshot:  String(r[idx('master_factory_code_snapshot')] || ''),
          master_ean_snapshot:           String(r[idx('master_ean_snapshot')] || ''),
          master_unit_price_snapshot:    Number(r[idx('master_unit_price_snapshot')] || 0),
          current_master_factory_code:   master.articleNumber || '',
          current_master_ean:            master.ean || '',
          current_master_unit_price:     master.cost || 0,
          status:                        String(r[idx('status')] || ''),
          requested_by:                  String(r[idx('requested_by')] || ''),
          requested_at:                  r[idx('requested_at')] ? new Date(r[idx('requested_at')]).toISOString() : '',
          resolved_by:                   String(r[idx('resolved_by')] || ''),
          resolved_at:                   r[idx('resolved_at')] ? new Date(r[idx('resolved_at')]).toISOString() : '',
          sync_notes:                    String(r[idx('sync_notes')] || ''),
        };
      })
      .sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1));

    return okResult_(rows);
  } catch(e) {
    Logger.log('apiGetPendingSkuUpdateRequests error: ' + e.message);
    return errResult_(e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// RESOLVE SKU UPDATE REQUEST — approve (push to EasyEcom) or reject
// ─────────────────────────────────────────────────────────────
// Payload: { action, request_id, decision: 'APPROVE'|'REJECT', resolved_by }
// APPROVE re-validates against a fresh read of EE Product Master before
// pushing anything — target SKU must still exist, and the master's current
// value must not have already diverged from the snapshot taken at request
// time (someone else may have already changed it — that still fails with
// an explanatory note rather than overwriting blindly). If the proposed
// EAN/Factory Code already belongs to a DIFFERENT SKU, that's resolved by
// stripping the identifier from its previous owner (clearEasyEcomIdentifierField_)
// and logging an EASYECOM/IDENTIFIER_REMOVED audit event either way (success
// or failure of the strip itself) — so a blanked-out identifier is always
// traceable as "deliberately removed for reassignment", not indistinguishable
// from "never set" if it's later requested again as a routine gap-fill. If
// the strip itself fails, the whole approval fails rather than reassigning
// on top of an unresolved duplicate.
// Approve and push happen in one action — there is no separate resting
// "approved but not yet synced" status.
// Returns: { success, data: { request_id, status, sync_notes } }

function apiResolveSkuUpdateRequest(payload) {
  // Admin-only, enforced here rather than just by hiding the tab. `user_email`
  // is the session-verified email the Vercel proxy stamps onto the payload
  // (callGasAuthed) — the same trust model getBatches/updateShipmentFinance
  // use. It is also who gets recorded as resolver: the old client-sent
  // `resolved_by` was always the literal string 'user'.
  const actor = String(payload.user_email || '').trim();
  if (getUserRole_(actor) !== 'ADMIN') {
    return errResult_('Only admins can approve or reject SKU update requests.');
  }

  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(10000)) {
      return errResult_('Another resolution is already in progress. Please try again.');
    }

    const requestId = payload.request_id;
    const decision  = payload.decision;
    if (!requestId) return errResult_('request_id is required');
    if (decision !== 'APPROVE' && decision !== 'REJECT') return errResult_('decision must be APPROVE or REJECT');

    const sheet = ensureSkuUpdateRequestsSheet_();
    const data  = sheet.getDataRange().getValues();
    const headers = data[0];
    const idx = name => headers.indexOf(name);

    const rowIdx = data.slice(1).findIndex(r => String(r[idx('request_id')]) === requestId);
    if (rowIdx === -1) return errResult_(`Request ${requestId} not found`);
    const sheetRow = rowIdx + 2;
    const row = data[rowIdx + 1];

    // Only PENDING requests are actionable. The lock serializes two admins,
    // but it doesn't stop the second one acting on what the first already
    // resolved: a repeat Approve saw "master changed since snapshot" (the
    // first push had changed it) and overwrote SYNCED with FAILED; a Reject
    // flipped an already-synced request to REJECTED.
    const currentStatus = String(row[idx('status')] || '').trim();
    if (currentStatus !== 'PENDING') {
      return errResult_(`This request is already ${currentStatus || 'resolved'} — refresh to see its latest status.`);
    }

    const now = new Date();
    const write = (col, val) => sheet.getRange(sheetRow, idx(col) + 1).setValue(val);

    if (decision === 'REJECT') {
      write('status', 'REJECTED');
      write('resolved_by', actor);
      write('resolved_at', now);
      SpreadsheetApp.flush();
      return okResult_({ request_id: requestId, status: 'REJECTED', sync_notes: '' });
    }

    // ── APPROVE — validate against fresh master data first ──
    const targetSku          = String(row[idx('target_sku')] || '');
    const proposedFactoryCode = String(row[idx('proposed_factory_code')] || '');
    const proposedEan        = String(row[idx('proposed_ean')] || '');
    const proposedUnitPrice  = Number(row[idx('proposed_unit_price')] || 0);
    const snapFactoryCode    = String(row[idx('master_factory_code_snapshot')] || '');
    const snapEan            = String(row[idx('master_ean_snapshot')] || '');
    const snapUnitPrice      = Number(row[idx('master_unit_price_snapshot')] || 0);

    const productMaster = loadEEProductMaster_();
    const masterBySku = {};
    productMaster.forEach(p => { masterBySku[p.sku] = p; });

    const master = masterBySku[targetSku];
    const fail = (note) => {
      write('status', 'FAILED');
      write('resolved_by', actor);
      write('resolved_at', now);
      write('sync_notes', note);
      SpreadsheetApp.flush();
      return okResult_({ request_id: requestId, status: 'FAILED', sync_notes: note });
    };

    if (!master) {
      return fail(`SKU "${targetSku}" no longer exists in EE Product Master.`);
    }

    // Staleness check — master already changed since this request was queued.
    // This MUST run before the collision strip below: the strip is a live,
    // destructive EasyEcom write (it blanks an identifier on a different
    // SKU). Running it first meant a request that then failed staleness had
    // already wiped that other SKU's EAN/Factory Code for nothing.
    if (proposedFactoryCode && (master.articleNumber || '') !== snapFactoryCode) {
      return fail(`Master Factory Code changed since this request was submitted (was "${snapFactoryCode}", now "${master.articleNumber || ''}"). Please re-review.`);
    }
    if (proposedEan && (master.ean || '') !== snapEan) {
      return fail(`Master EAN changed since this request was submitted (was "${snapEan}", now "${master.ean || ''}"). Please re-review.`);
    }
    if (proposedUnitPrice && (master.cost || 0) !== snapUnitPrice) {
      return fail(`Master RMB Price changed since this request was submitted (was ${snapUnitPrice}, now ${master.cost || 0}). Please re-review.`);
    }

    // Collision check — proposed identifier already used by a DIFFERENT SKU.
    // Resolve by stripping it from the previous owner and logging the
    // removal (either outcome) rather than just blocking the request.
    const strippedNotes = [];
    if (proposedFactoryCode) {
      const collision = productMaster.find(p => p.sku !== targetSku && p.articleNumber === proposedFactoryCode);
      if (collision) {
        const strip = clearEasyEcomIdentifierField_(collision.sku, 'Article Number');
        logAuditEvent_('EASYECOM', 'IDENTIFIER_REMOVED', collision.sku,
          `Factory Code "${proposedFactoryCode}" removed from SKU "${collision.sku}" to allow reassignment to "${targetSku}" (SKU Update Request ${requestId})`,
          strip.success ? 'SUCCESS' : 'FAILED', actor, requestId);
        if (!strip.success) return fail(`Factory Code "${proposedFactoryCode}" is used by SKU "${collision.sku}" and could not be auto-removed: ${strip.message}`);
        strippedNotes.push(`Factory Code freed from ${collision.sku}`);
      }
    }
    if (proposedEan) {
      const collision = productMaster.find(p => p.sku !== targetSku && p.ean === proposedEan);
      if (collision) {
        const strip = clearEasyEcomIdentifierField_(collision.sku, 'EAN');
        logAuditEvent_('EASYECOM', 'IDENTIFIER_REMOVED', collision.sku,
          `EAN "${proposedEan}" removed from SKU "${collision.sku}" to allow reassignment to "${targetSku}" (SKU Update Request ${requestId})`,
          strip.success ? 'SUCCESS' : 'FAILED', actor, requestId);
        if (!strip.success) return fail(`EAN "${proposedEan}" is used by SKU "${collision.sku}" and could not be auto-removed: ${strip.message}`);
        strippedNotes.push(`EAN freed from ${collision.sku}`);
      }
    }

    // ── Validated — push via the existing update function ──
    const pushResults = updateCustomFieldsSmart([{
      sku: targetSku,
      factory_code: proposedFactoryCode || undefined,
      rmb_price: proposedUnitPrice || undefined,
      ean: proposedEan || undefined,
    }]);
    const result = (pushResults && pushResults[0]) || { success: false, message: 'No response from updateCustomFieldsSmart' };
    const finalNote = [result.message || '', ...strippedNotes].filter(Boolean).join(' | ');

    write('status', result.success ? 'SYNCED' : 'FAILED');
    write('resolved_by', actor);
    write('resolved_at', now);
    write('sync_notes', finalNote);
    SpreadsheetApp.flush();

    logAuditEvent_('EASYECOM', 'UPDATE', targetSku, `SKU Update Request ${requestId}: ${result.message || ''}`, result.success ? 'SUCCESS' : 'FAILED', actor);

    return okResult_({ request_id: requestId, status: result.success ? 'SYNCED' : 'FAILED', sync_notes: finalNote });
  } catch(e) {
    Logger.log('apiResolveSkuUpdateRequest error: ' + e.message);
    return errResult_(e.message);
  } finally {
    lock.releaseLock();
  }
}