// ─────────────────────────────────────────────────────────────
// AIR SHIPPING PARTNERS + LEDGERS — see
// docs/superpowers/specs/2026-09-29-air-shipping-partner-design.md.
//
// Each air batch is shipped by KREIZ (our CNF) or another logistics firm (a
// "shipping partner"). A partner bills its fee + 18% GST for one batch and is
// paid directly by us, bill by bill (part payments allowed, TDS recorded).
// None of this touches the vendor books (PurchaseInvoices / PaymentLogs /
// FIFO): partners live only in the four sheets below, and every balance is
// computed on read. KREIZ is a built-in party, not a row in Shipping_Partners.
// ─────────────────────────────────────────────────────────────

var SP_PARTNERS_SHEET_ = 'Shipping_Partners';
var SP_PARTNER_HEADERS_ = ['ID', 'Name', 'GSTIN', 'Rate Per Kg', 'Active', 'Created By', 'Created At', 'Updated By', 'Updated At'];
var SP_ASSIGN_SHEET_ = 'Batch_Shipping_Partner';
var SP_ASSIGN_HEADERS_ = ['Batch ID', 'Partner ID', 'Set By', 'Set At'];
var SP_BILLS_SHEET_ = 'Shipping_Partner_Bills';
var SP_BILL_HEADERS_ = ['ID', 'Partner ID', 'Batch ID', 'Bill No', 'Bill Date', 'File URL', 'Weight Kg', 'Rate Per Kg',
  'Expected Fee', 'Fee', 'GST', 'Total', 'Override Reason', 'Status', 'Submitted By', 'Decided By', 'Decided At',
  'Rejection Reason', 'Created At'];
var SP_PAYMENTS_SHEET_ = 'Shipping_Partner_Payments';
var SP_PAYMENT_HEADERS_ = ['ID', 'Partner ID', 'Bill ID', 'Date', 'Amount', 'TDS', 'Reference', 'Notes', 'Status',
  'Recorded By', 'Recorded At', 'Voided By', 'Voided At', 'Void Reason'];
// 1-based columns written after a row is created. Decided By is followed by
// Decided At and Rejection Reason; Voided By by Voided At and Void Reason.
var SP_BILL_COL_STATUS_ = 14, SP_BILL_COL_DECIDED_BY_ = 16;
var SP_PAY_COL_STATUS_ = 9, SP_PAY_COL_VOIDED_BY_ = 12;
var SP_GSTIN_RE_ = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// The sheet, created with its header row when forWrite and missing.
function spSheet_(name, headers, forWrite) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet && forWrite) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

// Data rows of a sheet this module created (fixed column order) with their
// 1-based row numbers. A missing sheet has none.
function spRows_(name) {
  var t = cnfReadSheet_(name);
  var out = [];
  if (!t) return out;
  for (var i = 1; i < t.values.length; i++) {
    if (t.values[i][0] !== '' && t.values[i][0] !== null) out.push({ r: t.values[i], rowNumber: i + 1 });
  }
  return out;
}

function spIso_(v) { return v instanceof Date ? v.toISOString() : String(v || ''); }
function spNormName_(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
function spBool_(v) { return v === true || String(v).trim().toUpperCase() === 'TRUE'; }

function spStrip_(o) {
  var copy = {};
  Object.keys(o).forEach(function (k) { if (k !== 'rowNumber') copy[k] = o[k]; });
  return copy;
}

function spLock_(what) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Another ' + what + ' is being saved. Try again in a moment.');
  return lock;
}

// batchId → 'air' | 'sea' from the Batches sheet (same test as getCnfShipmentValues_).
function spBatchTypes_() {
  var out = {};
  var bt = cnfReadSheet_('Batches');
  if (!bt) return out;
  var idCol = bt.headers.indexOf('batch_id');
  var typeCol = bt.headers.indexOf('batch_type');
  for (var i = 1; i < bt.values.length; i++) {
    var id = String(bt.values[i][idCol] || '').trim();
    if (id) out[id] = String(bt.values[i][typeCol] || '').toLowerCase().indexOf('air') !== -1 ? 'air' : 'sea';
  }
  return out;
}

// ── Partners ────────────────────────────────────────────────

function readShippingPartners_() {
  return spRows_(SP_PARTNERS_SHEET_).map(function (x) {
    var r = x.r;
    return {
      id: String(r[0]).trim(), name: String(r[1] || ''), gstin: String(r[2] || ''), ratePerKg: Number(r[3]) || 0,
      active: spBool_(r[4]), createdBy: String(r[5] || ''), createdAt: spIso_(r[6]),
      updatedBy: String(r[7] || ''), updatedAt: spIso_(r[8]), rowNumber: x.rowNumber
    };
  });
}

// partnerId → display name, KREIZ included.
function spPartnerNames_() {
  var names = {};
  names[CNF_VENDOR_CODE_] = CNF_VENDOR_CODE_;
  readShippingPartners_().forEach(function (p) { names[p.id] = p.name; });
  return names;
}

// payload: { id? (edit), name, gstin?, ratePerKg, active?, user_email (proxy) }.
function saveShippingPartner_(payload) {
  var p = payload || {};
  var who = cnfRequireUser_(p);
  var id = String(p.id || '').trim();
  var name = String(p.name || '').trim().replace(/\s+/g, ' ');
  var gstin = String(p.gstin || '').trim().toUpperCase();
  var rate = Number(p.ratePerKg);
  var active = p.active === undefined ? true : p.active === true;
  if (!name) throw new Error('Partner name is required');
  if (spNormName_(name) === spNormName_(CNF_VENDOR_CODE_)) throw new Error('KREIZ is built in; pick another name');
  if (gstin && !SP_GSTIN_RE_.test(gstin)) throw new Error('GSTIN ' + gstin + ' is not a valid 15-character GSTIN');
  if (!(rate > 0)) throw new Error('Rate per kg must be above 0');

  var lock = spLock_('shipping partner');
  try {
    var partners = readShippingPartners_();
    var clash = partners.filter(function (x) { return x.id !== id && spNormName_(x.name) === spNormName_(name); })[0];
    if (clash) throw new Error('A partner named ' + clash.name + ' already exists');
    var now = new Date().toISOString();
    var sheet = spSheet_(SP_PARTNERS_SHEET_, SP_PARTNER_HEADERS_, true);
    if (id) {
      var existing = partners.filter(function (x) { return x.id === id; })[0];
      if (!existing) throw new Error('Shipping partner not found: ' + id);
      sheet.getRange(existing.rowNumber, 2, 1, 4).setValues([[name, gstin, rate, active]]);
      sheet.getRange(existing.rowNumber, 8, 1, 2).setValues([[who, now]]);
    } else {
      var max = partners.reduce(function (m, x) {
        var n = parseInt(String(x.id).replace(/^SP-/, ''), 10);
        return n > m ? n : m;
      }, 0);
      id = 'SP-' + String(max + 1).padStart(3, '0');
      sheet.appendRow([id, name, gstin, rate, active, who, now, '', '']);
    }
    var saved = readShippingPartners_().filter(function (x) { return x.id === id; })[0];
    return { status: 'success', partner: spStrip_(saved) };
  } finally {
    lock.releaseLock();
  }
}
