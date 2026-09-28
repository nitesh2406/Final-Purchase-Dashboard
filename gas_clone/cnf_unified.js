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
var CNF_COL_STATUS_ = 11, CNF_COL_DECIDED_BY_ = 14, CNF_COL_DECIDED_AT_ = 15, CNF_COL_REJECTION_ = 16;

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

// shipmentId → INR already claimed by CNF invoices. Pending invoices count
// too, so the same value can't be logged twice while one awaits approval;
// a rejected invoice frees its value again.
function cnfInvoicedByShipment_(invoices) {
  var out = {};
  invoices.forEach(function (inv) {
    if (inv.status !== 'Pending Approval' && inv.status !== 'Approved') return;
    (inv.lines || []).forEach(function (l) {
      out[l.shipmentId] = (out[l.shipmentId] || 0) + (Number(l.amount) || 0);
    });
  });
  return out;
}

// One row per shipment of a non-INR vendor, whatever its batch status. A
// shipment can be CNF-invoiced once its batch is Delivered and its vendor
// invoice is fully paid; its value is the INR actually paid to the vendor.
// invoicedByShipment is optional (defaults to the live CNF invoices).
function getCnfShipmentValues_(invoicedByShipment) {
  var invoiced = invoicedByShipment || cnfInvoicedByShipment_(readCnfInvoices_());
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
    var invoicedInr = cnfRound2_(invoiced[s.shipmentId] || 0);
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
      remainingInr: eligible ? cnfRound2_(Math.max(0, paidInr - invoicedInr)) : 0,
      invoiceStatus: invoicedInr < 0.01 ? 'Not invoiced' : (paidInr - invoicedInr < 1 ? 'Fully invoiced' : 'Part invoiced'),
      eligible: eligible,
      ineligibleReason: reason
    };
  });
}
