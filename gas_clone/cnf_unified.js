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
