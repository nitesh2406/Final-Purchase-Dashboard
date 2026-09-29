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

// ── Batch → partner ─────────────────────────────────────────

function readBatchPartnerAssignments_() {
  return spRows_(SP_ASSIGN_SHEET_).map(function (x) {
    return { batchId: String(x.r[0]).trim(), partnerId: String(x.r[1] || '').trim(), setBy: String(x.r[2] || ''), setAt: spIso_(x.r[3]), rowNumber: x.rowNumber };
  });
}

// batchId → partnerId ('KREIZ' or 'SP-…') for every air batch whose partner is set.
function spPartnerByBatch_() {
  var out = {};
  readBatchPartnerAssignments_().forEach(function (a) { if (a.partnerId) out[a.batchId] = a.partnerId; });
  return out;
}

function readPartnerBills_() {
  return spRows_(SP_BILLS_SHEET_).map(function (x) {
    var r = x.r;
    return {
      id: String(r[0]), partnerId: String(r[1] || ''), batchId: String(r[2] || ''), billNo: String(r[3] || ''),
      billDate: cnfYmd_(r[4]), fileUrl: String(r[5] || ''), weightKg: Number(r[6]) || 0, ratePerKg: Number(r[7]) || 0,
      expectedFee: Number(r[8]) || 0, fee: Number(r[9]) || 0, gst: Number(r[10]) || 0, total: Number(r[11]) || 0,
      overrideReason: String(r[12] || ''), status: String(r[13] || ''), submittedBy: String(r[14] || ''),
      decidedBy: String(r[15] || ''), decidedAt: spIso_(r[16]), rejectionReason: String(r[17] || ''),
      createdAt: spIso_(r[18]), rowNumber: x.rowNumber
    };
  });
}

// Why a batch's partner can't change, or '' if it can: a pending or approved
// CNF invoice has a line for it, or a pending or approved partner bill is for it.
function spBatchLockReason_(batchId, cnfInvoices, bills) {
  var inv = cnfInvoices.filter(function (i) {
    return (i.status === 'Pending Approval' || i.status === 'Approved') &&
      (i.lines || []).some(function (l) { return l.batchId === batchId; });
  })[0];
  if (inv) return 'CNF invoice ' + inv.cnfInvoiceNo + ' includes this batch';
  var bill = bills.filter(function (b) { return b.batchId === batchId && b.status !== 'Rejected'; })[0];
  if (bill) return 'Partner bill ' + bill.billNo + ' is logged for this batch';
  return '';
}

function getBatchShippingPartners_() {
  var names = spPartnerNames_();
  var invoices = readCnfInvoices_();
  var bills = readPartnerBills_();
  return readBatchPartnerAssignments_().filter(function (a) { return a.partnerId; }).map(function (a) {
    var reason = spBatchLockReason_(a.batchId, invoices, bills);
    return {
      batchId: a.batchId, partnerId: a.partnerId, partnerName: names[a.partnerId] || a.partnerId,
      locked: reason !== '', lockReason: reason, setBy: a.setBy, setAt: a.setAt
    };
  });
}

// payload: { batchId, partnerId ('KREIZ' or 'SP-…'), user_email (proxy) }.
function setBatchShippingPartner_(payload) {
  var p = payload || {};
  var who = cnfRequireUser_(p);
  var batchId = String(p.batchId || '').trim();
  var partnerId = String(p.partnerId || '').trim();
  if (!batchId) throw new Error('batchId is required');
  if (!partnerId) throw new Error('Pick a shipping partner');

  var lock = spLock_('shipping partner');
  try {
    var type = spBatchTypes_()[batchId];
    if (!type) throw new Error('Batch ' + batchId + ' not found');
    if (type !== 'air') throw new Error('Batch ' + batchId + ' is not an air batch; only air batches have a shipping partner');
    if (partnerId !== CNF_VENDOR_CODE_) {
      var partner = readShippingPartners_().filter(function (x) { return x.id === partnerId; })[0];
      if (!partner) throw new Error('Shipping partner not found: ' + partnerId);
      if (!partner.active) throw new Error(partner.name + ' is inactive');
    }
    var current = readBatchPartnerAssignments_().filter(function (a) { return a.batchId === batchId; })[0];
    if (current && current.partnerId === partnerId) return { status: 'success', batchId: batchId, partnerId: partnerId, message: 'Unchanged' };
    var reason = spBatchLockReason_(batchId, readCnfInvoices_(), readPartnerBills_());
    if (reason) throw new Error('The shipping partner of ' + batchId + ' is locked: ' + reason);
    var sheet = spSheet_(SP_ASSIGN_SHEET_, SP_ASSIGN_HEADERS_, true);
    var row = [batchId, partnerId, who, new Date().toISOString()];
    if (current) sheet.getRange(current.rowNumber, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
    return { status: 'success', batchId: batchId, partnerId: partnerId };
  } finally {
    lock.releaseLock();
  }
}

// ── Bills ───────────────────────────────────────────────────

function readPartnerPayments_() {
  return spRows_(SP_PAYMENTS_SHEET_).map(function (x) {
    var r = x.r;
    return {
      id: String(r[0]), partnerId: String(r[1] || ''), billId: String(r[2] || ''), date: cnfYmd_(r[3]),
      amount: Number(r[4]) || 0, tds: Number(r[5]) || 0, reference: String(r[6] || ''), notes: String(r[7] || ''),
      status: String(r[8] || ''), recordedBy: String(r[9] || ''), recordedAt: spIso_(r[10]),
      voidedBy: String(r[11] || ''), voidedAt: spIso_(r[12]), voidReason: String(r[13] || ''), rowNumber: x.rowNumber
    };
  });
}

// Bills with settled (active payments + their TDS) and balance (total − settled).
function spBillsWithBalance_(bills, payments) {
  var settled = {};
  payments.forEach(function (p) {
    if (p.status === 'Active') settled[p.billId] = (settled[p.billId] || 0) + p.amount + p.tds;
  });
  return bills.map(function (b) {
    var s = cnfRound2_(settled[b.id] || 0);
    return Object.assign({}, b, { settled: s, balance: cnfRound2_(b.total - s) });
  });
}

// payload: { partnerId, batchId, billNo, billDate (yyyy-mm-dd), fileUrl, weightKg,
// fee, gst, total, overrideReason?, user_email (proxy) }. The rate is the
// partner's at logging time and is stored on the bill.
function logPartnerBill_(payload) {
  var p = payload || {};
  var who = cnfRequireUser_(p);
  var partnerId = String(p.partnerId || '').trim();
  var batchId = String(p.batchId || '').trim();
  var billNo = String(p.billNo || '').trim();
  var billDate = String(p.billDate || '').trim();
  var fileUrl = String(p.fileUrl || '').trim();
  var overrideReason = String(p.overrideReason || '').trim();
  var weight = Number(p.weightKg), fee = Number(p.fee), gst = Number(p.gst), total = Number(p.total);
  if (partnerId === CNF_VENDOR_CODE_) throw new Error("KREIZ's bills are logged as CNF invoices, not partner bills");
  if (!partnerId) throw new Error('partnerId is required');
  if (!batchId) throw new Error('Pick the batch this bill is for');
  if (!billNo) throw new Error('Bill number is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(billDate)) throw new Error('Bill date must be yyyy-mm-dd');
  if (!fileUrl) throw new Error('Attach the bill file');
  if (!(weight > 0)) throw new Error('Weight must be above 0');
  if (!(fee > 0)) throw new Error('Fee must be above 0');
  if (isNaN(gst) || gst < 0) throw new Error('GST must be zero or more');
  if (!(total > 0)) throw new Error('Total must be above 0');

  var lock = spLock_('partner bill');
  try {
    var partner = readShippingPartners_().filter(function (x) { return x.id === partnerId; })[0];
    if (!partner) throw new Error('Shipping partner not found: ' + partnerId);
    var assigned = spPartnerByBatch_()[batchId];
    if (!assigned) throw new Error('Batch ' + batchId + "'s shipping partner is not set. Set it on CNF Agent → Batches first.");
    if (assigned !== partnerId) {
      throw new Error('Batch ' + batchId + "'s shipping partner is " + (spPartnerNames_()[assigned] || assigned) + ', not ' + partner.name);
    }
    var bills = readPartnerBills_();
    var live = bills.filter(function (b) { return b.status !== 'Rejected'; });
    var sameBatch = live.filter(function (b) { return b.batchId === batchId; })[0];
    if (sameBatch) throw new Error('Batch ' + batchId + ' already has bill ' + sameBatch.billNo + ' (' + sameBatch.status + ')');
    var sameNo = live.filter(function (b) { return b.partnerId === partnerId && b.billNo.toLowerCase() === billNo.toLowerCase(); })[0];
    if (sameNo) throw new Error('Bill ' + sameNo.billNo + ' from ' + partner.name + ' is already logged');

    var expectedFee = cnfRound2_(weight * partner.ratePerKg);
    var feeOff = Math.abs(fee - expectedFee) >= 1;
    var totalOff = Math.abs(fee + gst - total) >= 1;
    if ((feeOff || totalOff) && !overrideReason) {
      throw new Error((feeOff
        ? 'Fee ' + cnfFmtInr_(fee) + ' differs from the expected ' + cnfFmtInr_(expectedFee) + ' (' + weight + ' kg × ₹' + partner.ratePerKg + '/kg)'
        : "Fee + GST doesn't match Total") + '. Give an override reason to save anyway.');
    }

    var sheet = spSheet_(SP_BILLS_SHEET_, SP_BILL_HEADERS_, true);
    // Row count keeps ids unique even for two saves in the same millisecond.
    var id = 'SPB-' + new Date().getTime() + '-' + (bills.length + 1);
    sheet.appendRow([id, partnerId, batchId, billNo, billDate, fileUrl, weight, partner.ratePerKg, expectedFee,
      cnfRound2_(fee), cnfRound2_(gst), cnfRound2_(total), overrideReason, 'Pending Approval', who, '', '', '',
      new Date().toISOString()]);
    return { status: 'success', id: id, expectedFee: expectedFee };
  } finally {
    lock.releaseLock();
  }
}

function spFindBill_(payload) {
  var id = String((payload && payload.id) || '').trim();
  if (!id) throw new Error('id is required');
  var bill = readPartnerBills_().filter(function (b) { return b.id === id; })[0];
  if (!bill) throw new Error('Partner bill not found: ' + id);
  return bill;
}

function approvePartnerBill_(payload) {
  var who = cnfRequireUser_(payload);
  var lock = spLock_('partner bill');
  try {
    var bill = spFindBill_(payload);
    if (bill.status === 'Approved') return { status: 'success', id: bill.id, message: 'Already approved' };
    if (bill.status === 'Rejected') throw new Error("A rejected bill can't be approved. Log it again instead.");
    var sheet = spSheet_(SP_BILLS_SHEET_, SP_BILL_HEADERS_, true);
    sheet.getRange(bill.rowNumber, SP_BILL_COL_STATUS_).setValue('Approved');
    sheet.getRange(bill.rowNumber, SP_BILL_COL_DECIDED_BY_, 1, 2).setValues([[who, new Date().toISOString()]]);
    return { status: 'success', id: bill.id };
  } finally {
    lock.releaseLock();
  }
}

// Unlike a CNF invoice, an approved bill can still be rejected (to correct
// it) as long as no active payment is recorded against it.
function rejectPartnerBill_(payload) {
  var who = cnfRequireUser_(payload);
  var reason = String((payload && payload.rejectionReason) || '').trim();
  if (!reason) throw new Error('A rejection reason is required');
  var lock = spLock_('partner bill');
  try {
    var bill = spFindBill_(payload);
    if (bill.status === 'Rejected') return { status: 'success', id: bill.id, message: 'Already rejected' };
    var paid = readPartnerPayments_().filter(function (x) { return x.billId === bill.id && x.status === 'Active'; });
    if (paid.length) throw new Error('Bill ' + bill.billNo + ' has ' + paid.length + ' payment(s) recorded; void them first');
    var sheet = spSheet_(SP_BILLS_SHEET_, SP_BILL_HEADERS_, true);
    sheet.getRange(bill.rowNumber, SP_BILL_COL_STATUS_).setValue('Rejected');
    sheet.getRange(bill.rowNumber, SP_BILL_COL_DECIDED_BY_, 1, 3).setValues([[who, new Date().toISOString(), reason]]);
    return { status: 'success', id: bill.id };
  } finally {
    lock.releaseLock();
  }
}
