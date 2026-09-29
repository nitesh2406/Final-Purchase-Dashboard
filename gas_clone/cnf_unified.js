// ─────────────────────────────────────────────────────────────
// CNF UNIFIED TAB — see docs/superpowers/specs/2026-09-28-cnf-unified-tab-design.md.
//
// Everything except CNF_Goods_Invoices is computed on read from the sheets
// vendor payments already write (PaymentLogs, SettlementLedger,
// PurchaseInvoices, Vendor_Shipments, Batches), so the CNF ledger can never
// drift from the payment log: an edit, a delete or a full relog shows up
// here automatically. Only direct payments (DP-) to non-INR vendors and
// payments to CNF itself (KREIZ) count as money paid to CNF; cross-vendor
// transfers (IDP-) only move money CNF already holds.
// ─────────────────────────────────────────────────────────────

var CNF_VENDOR_CODE_ = 'KREIZ';

function cnfRound2_(v) { return Math.round((Number(v) || 0) * 100) / 100; }

var CNF_INVOICES_SHEET_ = 'CNF_Goods_Invoices';
var CNF_INVOICE_HEADERS_ = [
  'ID', 'CNF Invoice No', 'Invoice Date', 'File URL', 'Shipment Lines',
  'Base Amount', 'Purchase Value', 'Service Charge', 'GST', 'Total',
  'Status', 'Override Reason', 'Submitted By', 'Decided By', 'Decided At',
  'Rejection Reason', 'Created At'
];
// 1-based column numbers of the fields written after an invoice is created.
// Decided By is followed by Decided At and Rejection Reason (columns 15, 16),
// which approve/reject write in the same setValues call.
var CNF_COL_STATUS_ = 11, CNF_COL_DECIDED_BY_ = 14;

// Sheet dates are stored as IST midnight (18:30Z the day before), so
// toISOString() reads them a day early. Always format in the script's zone.
function cnfYmd_(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  var d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function cnfFmtInr_(n) {
  var neg = (Number(n) || 0) < 0;
  var parts = Math.abs(cnfRound2_(n)).toFixed(2).split('.');
  var intPart = parts[0];
  var last3 = intPart.slice(-3);
  var rest = intPart.slice(0, -3);
  if (rest) last3 = ',' + last3;
  rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return (neg ? '-' : '') + '₹' + rest + last3 + '.' + parts[1];
}

function cnfReadSheet_(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) return null;
  var values = sheet.getDataRange().getValues();
  return { sheet: sheet, headers: values.length ? values[0] : [], values: values };
}

// Returns the CNF invoices sheet in the new column layout. Reads never write:
// with forWrite false, a missing sheet or an empty sheet still in the old
// layout comes back as null (no invoices). With forWrite true it is created
// or its header rewritten — but only while it holds no data rows. An old
// layout WITH data is refused on both paths rather than silently re-mapped.
function cnfInvoicesSheet_(forWrite) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CNF_INVOICES_SHEET_);
  if (!sheet) {
    if (!forWrite) return null;
    sheet = ss.insertSheet(CNF_INVOICES_SHEET_);
    sheet.appendRow(CNF_INVOICE_HEADERS_);
    return sheet;
  }
  var values = sheet.getDataRange().getValues();
  var headers = values[0] || [];
  var sameLayout = CNF_INVOICE_HEADERS_.every(function (h, i) { return String(headers[i] || '').trim() === h; });
  if (sameLayout) return sheet;
  var hasData = values.slice(1).some(function (r) { return r.some(function (c) { return c !== '' && c !== null; }); });
  if (hasData) {
    throw new Error('CNF_Goods_Invoices has rows in an older column layout. Move them to another sheet before using the CNF Invoices screen.');
  }
  if (!forWrite) return null;
  sheet.getRange(1, 1, 1, CNF_INVOICE_HEADERS_.length).setValues([CNF_INVOICE_HEADERS_]);
  return sheet;
}

// Column positions are fixed by cnfInvoicesSheet_, so rows are read by index.
function readCnfInvoices_() {
  var sheet = cnfInvoicesSheet_(false);
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[0]) continue;
    var lines = [];
    try { lines = r[4] ? JSON.parse(r[4]) : []; } catch (e) { lines = []; }
    out.push({
      id: String(r[0]),
      cnfInvoiceNo: String(r[1] || ''),
      invoiceDate: cnfYmd_(r[2]),
      fileUrl: String(r[3] || ''),
      lines: lines,
      baseAmount: Number(r[5]) || 0,
      purchaseValue: Number(r[6]) || 0,
      serviceCharge: Number(r[7]) || 0,
      gst: Number(r[8]) || 0,
      total: Number(r[9]) || 0,
      status: String(r[10] || ''),
      overrideReason: String(r[11] || ''),
      submittedBy: String(r[12] || ''),
      decidedBy: String(r[13] || ''),
      decidedAt: r[14] instanceof Date ? r[14].toISOString() : String(r[14] || ''),
      rejectionReason: String(r[15] || ''),
      createdAt: r[16] instanceof Date ? r[16].toISOString() : String(r[16] || ''),
      rowNumber: i + 1
    });
  }
  return out;
}

// invoice_no → { settledRmb, paidInr } from SettlementLedger. Counts the same
// rows the frontend's computeBatchSettlementStatus treats as invoice
// settlements: TxnType 'Invoice Settlement', or no TxnType and an
// invoice_no other than 'ADVANCE'. paidInr = Σ |RMB| × ER2 (the rate each
// payment actually settled at).
function cnfSettledByInvoice_() {
  var t = cnfReadSheet_('SettlementLedger');
  var out = {};
  if (!t || t.values.length < 2) return out;
  var invCol = findHeaderIndex_(t.headers, 'invoice_no');
  var rmbCol = findHeaderIndex_(t.headers, 'RMB');
  var er2Col = findHeaderIndex_(t.headers, 'ER2');
  var typeCol = findHeaderIndex_(t.headers, 'TxnType');
  for (var i = 1; i < t.values.length; i++) {
    var row = t.values[i];
    var inv = String(row[invCol] || '').trim();
    if (!inv || inv.toUpperCase() === 'ADVANCE') continue;
    var txnType = typeCol !== -1 ? String(row[typeCol] || '').trim() : '';
    if (txnType && txnType !== 'Invoice Settlement') continue;
    var rmb = Math.abs(Number(row[rmbCol]) || 0);
    var er2 = Number(row[er2Col]) || 0;
    var o = out[inv] || (out[inv] = { settledRmb: 0, paidInr: 0 });
    o.settledRmb += rmb;
    o.paidInr += rmb * er2;
  }
  return out;
}

// invoice_no → invoice RMB total, first row wins (same as the frontend's find()).
function cnfInvoiceRmbByNo_() {
  var t = cnfReadSheet_('PurchaseInvoices');
  var out = {};
  if (!t) return out;
  var invCol = findHeaderIndex_(t.headers, 'invoice_no');
  var rmbCol = findHeaderIndex_(t.headers, 'RMB');
  for (var i = 1; i < t.values.length; i++) {
    var inv = String(t.values[i][invCol] || '').trim();
    if (inv && !Object.prototype.hasOwnProperty.call(out, inv)) out[inv] = Number(t.values[i][rmbCol]) || 0;
  }
  return out;
}

// shipmentId → { goods, total } claimed by CNF invoices. goods = the line
// amounts (INR of goods); total = each invoice's Total shared across its
// lines in proportion to their amounts. Pending invoices count too, so the
// same value can't be logged twice while one awaits approval; a rejected
// invoice frees its value again.
function cnfInvoicedByShipment_(invoices) {
  var out = {};
  invoices.forEach(function (inv) {
    if (inv.status !== 'Pending Approval' && inv.status !== 'Approved') return;
    var lines = inv.lines || [];
    var goods = lines.reduce(function (s, l) { return s + (Number(l.amount) || 0); }, 0);
    lines.forEach(function (l) {
      var o = out[l.shipmentId] || (out[l.shipmentId] = { goods: 0, total: 0 });
      var amount = Number(l.amount) || 0;
      o.goods += amount;
      if (goods > 0) o.total += (Number(inv.total) || 0) * amount / goods;
    });
  });
  return out;
}

// One row per shipment of a non-INR vendor, whatever its batch status. A
// shipment can be CNF-invoiced once its batch is Delivered and its vendor
// invoice is fully paid; its value is the INR actually paid to the vendor.
// invoices is optional (defaults to the live CNF invoices).
function getCnfShipmentValues_(invoices) {
  var invoiced = cnfInvoicedByShipment_(invoices || readCnfInvoices_());
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var batchInfo = {};
  var bt = cnfReadSheet_('Batches');
  if (bt) {
    var bIdCol = bt.headers.indexOf('batch_id');
    var bStatusCol = bt.headers.indexOf('status');
    var bTypeCol = bt.headers.indexOf('batch_type');
    for (var i = 1; i < bt.values.length; i++) {
      var id = String(bt.values[i][bIdCol] || '').trim();
      if (!id) continue;
      batchInfo[id] = {
        status: String(bt.values[i][bStatusCol] || '').trim(),
        type: String(bt.values[i][bTypeCol] || '').toLowerCase().indexOf('air') !== -1 ? 'air' : 'sea'
      };
    }
  }

  var st = cnfReadSheet_('Vendor_Shipments');
  if (!st) return [];
  var sIdCol = st.headers.indexOf('shipment_id');
  var sBatchCol = st.headers.indexOf('batch_id');
  var sVendorCol = st.headers.indexOf('vendor_code');
  var sInvCol = st.headers.indexOf('invoice_no');
  var ships = [];
  var shipmentsPerInvoice = {};
  for (var r = 1; r < st.values.length; r++) {
    var row = st.values[r];
    var sid = String(row[sIdCol] || '').trim();
    var vendor = String(row[sVendorCol] || '').trim();
    if (!sid || !vendor || getVendorCurrency_(vendor) === 'INR') continue;
    var invNo = String(row[sInvCol] || '').trim();
    ships.push({ shipmentId: sid, batchId: String(row[sBatchCol] || '').trim(), vendorCode: vendor, invoiceNo: invNo });
    if (invNo) shipmentsPerInvoice[invNo] = (shipmentsPerInvoice[invNo] || 0) + 1;
  }

  var invoiceRmbByNo = cnfInvoiceRmbByNo_();
  var settled = cnfSettledByInvoice_();
  var names = getCachedVendorNameMap_(ss);

  return ships.map(function (s) {
    var b = batchInfo[s.batchId] || { status: '', type: 'sea' };
    var invoiceRmb = s.invoiceNo && Object.prototype.hasOwnProperty.call(invoiceRmbByNo, s.invoiceNo) ? invoiceRmbByNo[s.invoiceNo] : null;
    var paid = settled[s.invoiceNo] || { settledRmb: 0, paidInr: 0 };
    var fullyPaid = invoiceRmb !== null && invoiceRmb > 0 && invoiceRmb - paid.settledRmb < 0.01;
    var reason = '';
    if (b.status !== 'Delivered') reason = 'Batch not delivered';
    else if (!s.invoiceNo) reason = 'No vendor invoice on shipment';
    else if (shipmentsPerInvoice[s.invoiceNo] > 1) reason = 'Vendor invoice ' + s.invoiceNo + ' is shared by ' + shipmentsPerInvoice[s.invoiceNo] + ' shipments';
    else if (invoiceRmb === null) reason = 'Vendor invoice not in accounts yet';
    else if (!fullyPaid) reason = 'Vendor invoice not fully paid';
    var eligible = reason === '';
    var paidInr = cnfRound2_(paid.paidInr);
    var claimed = invoiced[s.shipmentId] || { goods: 0, total: 0 };
    var invoicedInr = cnfRound2_(claimed.goods);
    return {
      batchId: s.batchId,
      batchStatus: b.status,
      batchType: b.type,
      shipmentId: s.shipmentId,
      vendorCode: s.vendorCode,
      vendorName: names[s.vendorCode] || s.vendorCode,
      invoiceNo: s.invoiceNo,
      invoiceRmb: invoiceRmb,
      paidInr: paidInr,
      fullyPaid: fullyPaid,
      invoicedInr: invoicedInr,
      invoicedTotalInr: cnfRound2_(claimed.total),
      remainingInr: eligible ? cnfRound2_(Math.max(0, paidInr - invoicedInr)) : 0,
      invoiceStatus: invoicedInr < 0.01 ? 'Not invoiced' : (paidInr - invoicedInr < 1 ? 'Fully invoiced' : 'Part invoiced'),
      eligible: eligible,
      ineligibleReason: reason
    };
  });
}

function cnfRequireUser_(payload) {
  var who = String((payload && payload.user_email) || '').trim();
  if (!who) throw new Error('Your identity could not be verified. Sign in again and retry.');
  return who;
}

// payload: { cnfInvoiceNo, invoiceDate (yyyy-mm-dd), fileUrl, lines:
// [{ shipmentId, amount }], baseAmount, gst, total, overrideReason,
// user_email (stamped by the proxy) }. Everything is re-validated under the
// script lock against fresh sheet data; the screen's own caps are only a
// convenience.
function logCnfGoodsInvoice_(payload) {
  var p = payload || {};
  var submittedBy = cnfRequireUser_(p);
  var cnfInvoiceNo = String(p.cnfInvoiceNo || '').trim();
  var invoiceDate = String(p.invoiceDate || '').trim();
  var fileUrl = String(p.fileUrl || '').trim();
  var baseAmount = Number(p.baseAmount);
  var gst = Number(p.gst);
  var total = Number(p.total);
  var overrideReason = String(p.overrideReason || '').trim();
  var linesIn = Array.isArray(p.lines) ? p.lines : [];

  if (!cnfInvoiceNo) throw new Error('CNF invoice number is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) throw new Error('Invoice date must be yyyy-mm-dd');
  if (!fileUrl) throw new Error('Attach the CNF invoice file');
  if (!(baseAmount > 0)) throw new Error('Base amount must be a positive number');
  if (isNaN(gst) || gst < 0) throw new Error('GST must be zero or more');
  if (!(total > 0)) throw new Error('Total must be a positive number');
  if (linesIn.length === 0) throw new Error('Pick at least one shipment');

  var seen = {};
  var requested = linesIn.map(function (l, i) {
    var sid = String((l && l.shipmentId) || '').trim();
    var amount = cnfRound2_(l && l.amount);
    if (!sid) throw new Error('Line ' + (i + 1) + ' has no shipment');
    if (seen[sid]) throw new Error('Shipment ' + sid + ' is listed twice');
    seen[sid] = true;
    if (!(amount > 0)) throw new Error('Amount for shipment ' + sid + ' must be positive');
    return { shipmentId: sid, amount: amount };
  });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Another CNF invoice is being saved. Try again in a moment.');
  try {
    var sheet = cnfInvoicesSheet_(true);
    var existing = readCnfInvoices_();
    var duplicate = existing.some(function (inv) {
      return inv.status !== 'Rejected' && inv.cnfInvoiceNo.toLowerCase() === cnfInvoiceNo.toLowerCase();
    });
    if (duplicate) throw new Error('CNF invoice ' + cnfInvoiceNo + ' is already logged');

    var byShipment = {};
    getCnfShipmentValues_(existing).forEach(function (v) { byShipment[v.shipmentId] = v; });

    var lines = requested.map(function (l) {
      var v = byShipment[l.shipmentId];
      if (!v) throw new Error('Shipment ' + l.shipmentId + ' not found');
      if (!v.eligible) throw new Error('Shipment ' + l.shipmentId + " can't be CNF-invoiced: " + v.ineligibleReason);
      if (l.amount > v.remainingInr + 0.01) {
        throw new Error('Shipment ' + l.shipmentId + ' has only ' + cnfFmtInr_(v.remainingInr) + ' left to invoice');
      }
      return { batchId: v.batchId, shipmentId: v.shipmentId, vendorCode: v.vendorCode, invoiceNo: v.invoiceNo, amount: l.amount };
    });

    var purchaseValue = cnfRound2_(lines.reduce(function (s, l) { return s + l.amount; }, 0));
    var serviceCharge = cnfRound2_(baseAmount - purchaseValue);
    var totalMismatch = Math.abs(baseAmount + gst - total) >= 1;
    if (totalMismatch && !overrideReason) throw new Error("Base + GST doesn't match Total. Give an override reason to save anyway.");
    if (serviceCharge < 0 && !overrideReason) throw new Error('Service charge is negative (CNF billed less than the goods value). Give an override reason to save anyway.');

    // Row count keeps ids unique even for two saves in the same millisecond.
    var id = 'CGI-' + new Date().getTime() + '-' + (existing.length + 1);
    sheet.appendRow([
      id, cnfInvoiceNo, invoiceDate, fileUrl, JSON.stringify(lines),
      cnfRound2_(baseAmount), purchaseValue, serviceCharge, cnfRound2_(gst), cnfRound2_(total),
      'Pending Approval', overrideReason, submittedBy, '', '', '', new Date().toISOString()
    ]);
    return { status: 'success', id: id, purchaseValue: purchaseValue, serviceCharge: serviceCharge };
  } finally {
    lock.releaseLock();
  }
}

function cnfFindInvoiceForDecision_(payload) {
  var id = String((payload && payload.id) || '').trim();
  if (!id) throw new Error('id is required');
  var sheet = cnfInvoicesSheet_(true);
  var inv = readCnfInvoices_().filter(function (x) { return x.id === id; })[0];
  if (!inv) throw new Error('CNF invoice not found: ' + id);
  return { sheet: sheet, inv: inv };
}

function approveCnfGoodsInvoice_(payload) {
  var who = cnfRequireUser_(payload);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Another CNF invoice is being updated. Try again in a moment.');
  try {
    var found = cnfFindInvoiceForDecision_(payload);
    if (found.inv.status === 'Approved') return { status: 'success', id: found.inv.id, message: 'Already approved' };
    if (found.inv.status === 'Rejected') throw new Error("A rejected invoice can't be approved. Log it again instead.");
    found.sheet.getRange(found.inv.rowNumber, CNF_COL_STATUS_).setValue('Approved');
    found.sheet.getRange(found.inv.rowNumber, CNF_COL_DECIDED_BY_, 1, 2).setValues([[who, new Date().toISOString()]]);
    return { status: 'success', id: found.inv.id };
  } finally {
    lock.releaseLock();
  }
}

// No balance writes: what a shipment has left to invoice is derived from the
// non-rejected invoices, so flipping the status is enough to free it.
function rejectCnfGoodsInvoice_(payload) {
  var who = cnfRequireUser_(payload);
  var reason = String((payload && payload.rejectionReason) || '').trim();
  if (!reason) throw new Error('A rejection reason is required');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Another CNF invoice is being updated. Try again in a moment.');
  try {
    var found = cnfFindInvoiceForDecision_(payload);
    if (found.inv.status === 'Rejected') return { status: 'success', id: found.inv.id, message: 'Already rejected' };
    if (found.inv.status === 'Approved') throw new Error("An approved invoice can't be rejected.");
    found.sheet.getRange(found.inv.rowNumber, CNF_COL_STATUS_).setValue('Rejected');
    found.sheet.getRange(found.inv.rowNumber, CNF_COL_DECIDED_BY_, 1, 3).setValues([[who, new Date().toISOString(), reason]]);
    return { status: 'success', id: found.inv.id };
  } finally {
    lock.releaseLock();
  }
}

function cnfInvoiceDescription_(inv) {
  var parts = (inv.lines || []).map(function (l) { return l.batchId + '/' + l.shipmentId + ' ' + cnfFmtInr_(l.amount); });
  return 'CNF ' + inv.cnfInvoiceNo + ' · ' + parts.join(' + ') +
    ' · goods ' + cnfFmtInr_(inv.purchaseValue) + ' · service ' + cnfFmtInr_(inv.serviceCharge) + ' · GST ' + cnfFmtInr_(inv.gst);
}

// Bank-statement view of the account with CNF, in INR. Paid to CNF (+):
// direct payments (DP-) for non-INR vendors, and every payment logged under
// CNF's own vendor code. Billed by CNF (−): approved CNF invoice totals.
// openAdvance on a paid row = what is left of it after all approved billing
// (up to `to`, if given) is applied to paid rows oldest-first. Optional from/to (yyyy-mm-dd): rows
// before `from` fold into openingBalance; rows after `to` are left out.
function getCnfLedgerStatement_(payload) {
  var from = payload && payload.from ? String(payload.from).trim() : '';
  var to = payload && payload.to ? String(payload.to).trim() : '';
  var names = getCachedVendorNameMap_(SpreadsheetApp.getActiveSpreadsheet());
  var entries = [];

  var pay = cnfReadSheet_('PaymentLogs');
  if (pay && pay.values.length > 1) {
    var dateCol = findHeaderIndex_(pay.headers, 'Date');
    var idCol = findHeaderIndex_(pay.headers, 'Payment ID');
    var vendorCol = findHeaderIndex_(pay.headers, 'Vendor Code');
    var inrCol = findHeaderIndex_(pay.headers, 'INR Amount');
    if (inrCol === -1) inrCol = findHeaderIndex_(pay.headers, 'INR');
    for (var i = 1; i < pay.values.length; i++) {
      var row = pay.values[i];
      var paymentId = String(row[idCol] || '').trim();
      var vendor = String(row[vendorCol] || '').trim();
      var inr = cnfRound2_(row[inrCol]);
      if (!paymentId || !(inr > 0)) continue;
      var toCnf = vendor === CNF_VENDOR_CODE_;
      var direct = /^DP-/i.test(paymentId) && getVendorCurrency_(vendor) !== 'INR';
      if (!toCnf && !direct) continue;
      entries.push({
        date: cnfYmd_(row[dateCol]), order: 0,
        type: toCnf ? 'Payment to CNF' : 'Payment for vendor',
        reference: paymentId,
        description: toCnf ? paymentId + ' · payment to CNF' : paymentId + ' · for ' + vendor + ' (' + (names[vendor] || vendor) + ')',
        paid: inr, billed: 0
      });
    }
  }

  readCnfInvoices_().forEach(function (inv) {
    if (inv.status !== 'Approved') return;
    entries.push({
      date: inv.invoiceDate, order: 1, type: 'Tax invoice', reference: inv.cnfInvoiceNo,
      description: cnfInvoiceDescription_(inv), paid: 0, billed: cnfRound2_(inv.total)
    });
  });

  entries.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.order !== b.order) return a.order - b.order;
    return a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0;
  });

  // Only billing up to the To date can have used an advance shown in range.
  var billedLeft = entries.reduce(function (s, e) { return (to && e.date > to) ? s : s + e.billed; }, 0);
  entries.forEach(function (e) {
    if (e.paid > 0) {
      var used = Math.min(e.paid, billedLeft);
      billedLeft -= used;
      e.openAdvance = cnfRound2_(e.paid - used);
    } else {
      e.openAdvance = null;
    }
  });

  var opening = 0;
  var rows = [];
  entries.forEach(function (e) {
    if (to && e.date > to) return;
    if (from && e.date < from) { opening += e.paid - e.billed; return; }
    rows.push(e);
  });
  opening = cnfRound2_(opening);
  var running = opening, paidTotal = 0, billedTotal = 0;
  rows.forEach(function (e) {
    running = cnfRound2_(running + e.paid - e.billed);
    e.balance = running;
    paidTotal += e.paid;
    billedTotal += e.billed;
    delete e.order;
  });
  return {
    openingBalance: opening,
    rows: rows,
    closingBalance: running,
    totals: { paid: cnfRound2_(paidTotal), billed: cnfRound2_(billedTotal) }
  };
}

function getCnfGoodsInvoicesForApi_() {
  return readCnfInvoices_().map(function (inv) {
    var copy = {};
    Object.keys(inv).forEach(function (k) { if (k !== 'rowNumber') copy[k] = inv[k]; });
    return copy;
  });
}

// ─────────────────────────────────────────────────────────────
// DRAFT INVOICES — see docs/superpowers/specs/2026-09-29-cnf-draft-invoice-design.md.
// What CNF's invoice for a delivered, fully paid batch should come to:
// goods paid + CNF charge (chosen rate category, rate editable) + GST on
// both. One row per batch; saving again replaces it. Every figure is
// recomputed here — the screen's numbers are only a preview.
// ─────────────────────────────────────────────────────────────

var CNF_DRAFTS_SHEET_ = 'CNF_Draft_Invoices';
var CNF_DRAFT_HEADERS_ = ['Batch ID', 'Batch Type', 'Goods Value', 'Category ID', 'Category Label', 'Rate',
  'Weight Kg', 'CNF Charge', 'IGST Pct', 'GST', 'Expected Total', 'Shipments', 'Generated By', 'Generated At'];

// Same rule as components/logistics/cnf/draftInvoice.ts.
function cnfDraftFigures_(mode, goods, rate, weightKg, igstPct) {
  var charge = cnfRound2_(mode === 'air' ? rate * weightKg : goods * rate / 100);
  var gst = cnfRound2_((goods + charge) * igstPct / 100);
  return { charge: charge, gst: gst, total: cnfRound2_(goods + charge + gst) };
}

function readCnfDraftInvoices_() {
  var t = cnfReadSheet_(CNF_DRAFTS_SHEET_);
  var out = [];
  if (!t) return out;
  for (var i = 1; i < t.values.length; i++) {
    var r = t.values[i];
    if (!r[0]) continue;
    var shipments = [];
    try { shipments = r[11] ? JSON.parse(r[11]) : []; } catch (e) { shipments = []; }
    out.push({
      batchId: String(r[0]), batchType: String(r[1] || ''), goodsValue: Number(r[2]) || 0,
      categoryId: String(r[3] || ''), categoryLabel: String(r[4] || ''), rate: Number(r[5]) || 0,
      weightKg: r[6] === '' || r[6] === null ? null : Number(r[6]),
      charge: Number(r[7]) || 0, igstPct: Number(r[8]) || 0, gst: Number(r[9]) || 0, total: Number(r[10]) || 0,
      shipments: shipments, generatedBy: String(r[12] || ''),
      generatedAt: r[13] instanceof Date ? r[13].toISOString() : String(r[13] || ''),
      rowNumber: i + 1
    });
  }
  return out;
}

function getCnfDraftInvoices_() {
  return readCnfDraftInvoices_().map(function (d) {
    var copy = {};
    Object.keys(d).forEach(function (k) { if (k !== 'rowNumber') copy[k] = d[k]; });
    return copy;
  });
}

// payload: { batchId, categoryId, rate, weightKg (air), user_email (proxy) }.
function saveCnfDraftInvoice_(payload) {
  var p = payload || {};
  var who = cnfRequireUser_(p);
  var batchId = String(p.batchId || '').trim();
  var categoryId = String(p.categoryId || '').trim();
  var rate = Number(p.rate);
  var weight = p.weightKg === undefined || p.weightKg === null || p.weightKg === '' ? null : Number(p.weightKg);
  if (!batchId) throw new Error('batchId is required');
  if (!categoryId) throw new Error('Pick a rate category');
  if (!(rate > 0)) throw new Error('Rate must be above 0');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Another CNF save is in progress. Try again in a moment.');
  try {
    var ships = getCnfShipmentValues_().filter(function (s) { return s.batchId === batchId; });
    if (!ships.length) throw new Error('Batch ' + batchId + ' has no shipments from overseas vendors');
    if (ships[0].batchStatus !== 'Delivered') throw new Error('Batch ' + batchId + ' is not delivered yet');
    var unpaid = ships.filter(function (s) { return !s.eligible; });
    if (unpaid.length) {
      throw new Error('Batch ' + batchId + ' is not fully paid: ' + unpaid.map(function (s) { return s.shipmentId + ' (' + s.ineligibleReason + ')'; }).join(', '));
    }
    var mode = ships[0].batchType;
    var categories = mode === 'air' ? getCnfAirRateCategories_() : getCnfCommissionRates_();
    var category = categories.filter(function (c) { return c.id === categoryId; })[0];
    if (!category) throw new Error('Unknown ' + (mode === 'air' ? 'Air' : 'Sea') + ' rate category: ' + categoryId);
    if (mode === 'air' && !(weight > 0)) throw new Error('Enter the batch weight (kg)');

    var goods = cnfRound2_(ships.reduce(function (s, x) { return s + x.paidInr; }, 0));
    var igstPct = getIgstPercent_();
    var f = cnfDraftFigures_(mode, goods, rate, weight, igstPct);
    var draft = {
      batchId: batchId, batchType: mode, goodsValue: goods, categoryId: categoryId, categoryLabel: category.label,
      rate: rate, weightKg: mode === 'air' ? weight : null, charge: f.charge, igstPct: igstPct, gst: f.gst, total: f.total,
      shipments: ships.map(function (s) { return { shipmentId: s.shipmentId, paidInr: s.paidInr }; }),
      generatedBy: who, generatedAt: new Date().toISOString()
    };
    var row = [draft.batchId, draft.batchType, draft.goodsValue, draft.categoryId, draft.categoryLabel, draft.rate,
      draft.weightKg === null ? '' : draft.weightKg, draft.charge, draft.igstPct, draft.gst, draft.total,
      JSON.stringify(draft.shipments), draft.generatedBy, draft.generatedAt];

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CNF_DRAFTS_SHEET_);
    if (!sheet) { sheet = ss.insertSheet(CNF_DRAFTS_SHEET_); sheet.appendRow(CNF_DRAFT_HEADERS_); }
    var existing = readCnfDraftInvoices_().filter(function (d) { return d.batchId === batchId; })[0];
    if (existing) sheet.getRange(existing.rowNumber, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
    return { status: 'success', draft: draft };
  } finally {
    lock.releaseLock();
  }
}
