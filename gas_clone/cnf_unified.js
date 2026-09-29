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
  'Rejection Reason', 'Created At', 'Kind'
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
  var matches = function (list) { return list.every(function (h, i) { return String(headers[i] || '').trim() === h; }); };
  if (matches(CNF_INVOICE_HEADERS_)) return sheet;
  // Sheets from before the Kind column (17 columns): rows read as Goods; the
  // first write adds the header cell.
  if (matches(CNF_INVOICE_HEADERS_.slice(0, 17)) && !String(headers[17] || '').trim()) {
    if (forWrite) sheet.getRange(1, 18).setValue('Kind');
    return sheet;
  }
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
      kind: String(r[17] || '').trim() === 'Ancillary' ? 'Ancillary' : 'Goods',
      rowNumber: i + 1
    });
  }
  return out;
}

// invoice_no → { settledRmb, paidInr } from SettlementLedger. Counts the same
// rows the frontend's computeBatchSettlementStatus treats as invoice
// settlements: TxnType 'Invoice Settlement', or no TxnType and an
// invoice_no other than 'ADVANCE'. paidInr = Σ |RMB| × the actual rate of
// the row's payment (cnfActualRates_), falling back to the row's stored ER2.
// Vendor discounts (DSC-) count toward settledRmb (they can make an invoice
// fully paid) but not paidInr: CNF moved no money for them, so they carry no
// commission.
function cnfSettledByInvoice_() {
  var t = cnfReadSheet_('SettlementLedger');
  var out = {};
  if (!t || t.values.length < 2) return out;
  var rates = cnfActualRates_(t);
  var invCol = findHeaderIndex_(t.headers, 'invoice_no');
  var rmbCol = findHeaderIndex_(t.headers, 'RMB');
  var er2Col = findHeaderIndex_(t.headers, 'ER2');
  var typeCol = findHeaderIndex_(t.headers, 'TxnType');
  var pidCol = findHeaderIndex_(t.headers, 'Payment ID');
  var venCol = findHeaderIndex_(t.headers, 'Vendor Code');
  for (var i = 1; i < t.values.length; i++) {
    var row = t.values[i];
    var inv = String(row[invCol] || '').trim();
    if (!inv || inv.toUpperCase() === 'ADVANCE') continue;
    var txnType = typeCol !== -1 ? String(row[typeCol] || '').trim() : '';
    if (txnType && txnType !== 'Invoice Settlement') continue;
    var rmb = Math.abs(Number(row[rmbCol]) || 0);
    var er2 = Number(row[er2Col]) || 0;
    var pid = pidCol === -1 ? '' : String(row[pidCol] || '').trim();
    var o = out[inv] || (out[inv] = { settledRmb: 0, paidInr: 0 });
    o.settledRmb += rmb;
    // A vendor discount (DSC-) settles the invoice but moves no money through CNF.
    if (/^DSC-/i.test(pid)) continue;
    var actual = pid ? rates.rateFor(pid, venCol === -1 ? '' : row[venCol]) : null;
    o.paidInr += rmb * (actual === null ? er2 : actual);
  }
  return out;
}

// invoice_no → { rmb, er1, vendor, date, notes, type }, first row wins (same
// as the frontend's find()). type is 'Ancillary' only when the Invoice Type
// column says so; a blank or missing column is 'Goods'.
function cnfPurchaseInvoiceInfo_() {
  var t = cnfReadSheet_('PurchaseInvoices');
  var out = {};
  if (!t) return out;
  var h = t.headers;
  var noCol = findHeaderIndex_(h, 'invoice_no'), vendorCol = findHeaderIndex_(h, 'Vendor Code');
  var rmbCol = findHeaderIndex_(h, 'RMB'), er1Col = findHeaderIndex_(h, 'ER1');
  var notesCol = findHeaderIndex_(h, 'Notes'), typeCol = findHeaderIndex_(h, 'Invoice Type');
  for (var i = 1; i < t.values.length; i++) {
    var r = t.values[i];
    var no = String(r[noCol] || '').trim();
    if (!no || Object.prototype.hasOwnProperty.call(out, no)) continue;
    out[no] = {
      rmb: Number(r[rmbCol]) || 0,
      er1: er1Col === -1 ? 0 : Number(r[er1Col]) || 0,
      vendor: vendorCol === -1 ? '' : String(r[vendorCol] || '').trim(),
      date: cnfYmd_(r[0]),
      notes: notesCol === -1 ? '' : String(r[notesCol] || ''),
      type: typeCol !== -1 && String(r[typeCol] || '').trim() === 'Ancillary' ? 'Ancillary' : 'Goods'
    };
  }
  return out;
}

// The first shipment whose vendor invoice is invoiceNo, or ''.
function cnfShipmentForVendorInvoice_(invoiceNo) {
  var st = cnfReadSheet_('Vendor_Shipments');
  if (!st) return '';
  var sid = st.headers.indexOf('shipment_id'), inv = st.headers.indexOf('invoice_no');
  if (sid === -1 || inv === -1) return '';
  for (var i = 1; i < st.values.length; i++) {
    if (String(st.values[i][inv] || '').trim() === invoiceNo) return String(st.values[i][sid] || '').trim();
  }
  return '';
}

// The CNF invoice number of a Pending Approval or Approved CNF invoice with a
// line on vendor invoice invoiceNo (goods or ancillary), or ''.
function cnfLiveCnfInvoiceForVendorInvoice_(invoiceNo) {
  var hit = readCnfInvoices_().filter(function (inv) {
    return (inv.status === 'Pending Approval' || inv.status === 'Approved') &&
      (inv.lines || []).some(function (l) { return String(l.invoiceNo || '') === invoiceNo; });
  })[0];
  return hit ? hit.cnfInvoiceNo : '';
}

// What a payment actually cost per RMB — see
// docs/superpowers/specs/2026-09-29-ancillary-cnf-invoices-design.md.
// SettlementLedger keeps only the charge-adjusted rate; what we paid is the
// payment's own ER2. A cross-vendor wallet (IDP-) holds only an adjusted
// blend, so its cost is traced: the shortfall part through the settlements
// of its XFER-<id>-<vendor> invoice (unpaid shortfall at that invoice's ER1),
// the part drawn from the source's wallets scaled by the source's
// actual ÷ adjusted ratio on its DP- payments up to the transfer date.
// rateFor returns null when it can't tell; callers then keep the stored rate.
// ledger / info are optional pre-read tables (cnfReadSheet_ / cnfPurchaseInvoiceInfo_).
function cnfActualRates_(ledger, info) {
  ledger = ledger || cnfReadSheet_('SettlementLedger');
  info = info || cnfPurchaseInvoiceInfo_();
  var payments = {};
  var directs = [];
  var pay = cnfReadSheet_('PaymentLogs');
  if (pay && pay.values.length > 1) {
    var h = pay.headers;
    var c = {
      date: findHeaderIndex_(h, 'Date'), id: findHeaderIndex_(h, 'Payment ID'), vendor: findHeaderIndex_(h, 'Vendor Code'),
      rmb: findHeaderIndex_(h, 'RMB'), er2: findHeaderIndex_(h, 'ER2'), settled: findHeaderIndex_(h, 'Settled ER2'),
      inr: findHeaderIndex_(h, 'INR Amount') !== -1 ? findHeaderIndex_(h, 'INR Amount') : findHeaderIndex_(h, 'INR'),
      source: findHeaderIndex_(h, 'Source Vendor')
    };
    for (var i = 1; i < pay.values.length; i++) {
      var r = pay.values[i];
      var id = String(r[c.id] || '').trim();
      if (!id) continue;
      var p = {
        id: id, vendor: String(r[c.vendor] || '').trim(), date: cnfYmd_(r[c.date]),
        rmb: Number(r[c.rmb]) || 0, er2: Number(r[c.er2]) || 0,
        source: c.source === -1 ? '' : String(r[c.source] || '').trim()
      };
      var settledEr2 = c.settled === -1 || r[c.settled] === '' || r[c.settled] === null ? p.er2 : Number(r[c.settled]) || p.er2;
      p.inr = c.inr === -1 || r[c.inr] === '' || r[c.inr] === null ? p.rmb * p.er2 : Number(r[c.inr]) || 0;
      payments[id + '|' + p.vendor] = p;
      if (!payments[id]) payments[id] = p;
      if (/^DP-/i.test(id) && p.rmb > 0 && settledEr2 > 0) directs.push({ vendor: p.vendor, date: p.date, inr: p.rmb * p.er2, adj: p.rmb * settledEr2 });
    }
  }

  var xferRows = {};
  if (ledger && ledger.values.length > 1) {
    var invCol = findHeaderIndex_(ledger.headers, 'invoice_no'), pidCol = findHeaderIndex_(ledger.headers, 'Payment ID');
    var venCol = findHeaderIndex_(ledger.headers, 'Vendor Code'), rmbCol = findHeaderIndex_(ledger.headers, 'RMB');
    var er2Col = findHeaderIndex_(ledger.headers, 'ER2');
    for (var j = 1; j < ledger.values.length; j++) {
      var row = ledger.values[j];
      var inv = String(row[invCol] || '').trim();
      if (!/^XFER-/i.test(inv)) continue;
      (xferRows[inv] = xferRows[inv] || []).push({
        pid: String(row[pidCol] || '').trim(), vendor: venCol === -1 ? '' : String(row[venCol] || '').trim(),
        rmb: Math.abs(Number(row[rmbCol]) || 0), er2: Number(row[er2Col]) || 0
      });
    }
  }

  function factor(source, date) {
    var inr = 0, adj = 0;
    directs.forEach(function (d) {
      if ((source && d.vendor !== source) || d.date > date) return;
      inr += d.inr; adj += d.adj;
    });
    return adj > 0 ? inr / adj : 1 + getConversionChargePercent_() / 100;
  }

  var memo = {}, visiting = {};
  function rate(id, vendor, depth) {
    var p = payments[id + '|' + vendor] || payments[id];
    if (!p || !(p.rmb > 0)) return null;
    if (/^DP-/i.test(id)) return p.er2 > 0 ? p.er2 : null;
    if (!/^IDP-/i.test(id)) return null;
    var key = id + '|' + p.vendor;
    if (Object.prototype.hasOwnProperty.call(memo, key)) return memo[key];
    if (depth >= 5 || visiting[key]) return null;
    visiting[key] = true;
    var xferNo = 'XFER-' + id + '-' + p.vendor;
    var x = info[xferNo] || null;
    var shortRmb = x ? Math.min(x.rmb, p.rmb) : 0;
    var shortInr = 0;
    if (x) {
      var paidRmb = 0;
      (xferRows[xferNo] || []).forEach(function (s) {
        var sr = rate(s.pid, s.vendor, depth + 1);
        shortInr += s.rmb * (sr === null ? s.er2 : sr);
        paidRmb += s.rmb;
      });
      shortInr += Math.max(0, shortRmb - paidRmb) * x.er1;
    }
    var walletInr = 0;
    if (p.rmb - shortRmb > 0.005) {
      var adjInr = Math.max(0, p.inr - shortRmb * (x ? x.er1 : 0));
      walletInr = adjInr * factor(p.source || (x ? x.vendor : ''), p.date);
    }
    delete visiting[key];
    memo[key] = (shortInr + walletInr) / p.rmb;
    return memo[key];
  }

  return { rateFor: function (paymentId, vendorCode) { return rate(String(paymentId || '').trim(), String(vendorCode || '').trim(), 0); } };
}

// shipmentId → { goods, total } claimed by CNF invoices. goods = the line
// amounts (INR of goods); total = each invoice's Total shared across its
// lines in proportion to their amounts. Pending invoices count too, so the
// same value can't be logged twice while one awaits approval; a rejected
// invoice frees its value again.
function cnfInvoicedByShipment_(invoices) {
  var out = {};
  invoices.forEach(function (inv) {
    if (inv.kind === 'Ancillary') return;
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

// vendor invoice_no → INR claimed by Pending Approval / Approved ancillary CNF invoices.
function cnfInvoicedByVendorInvoice_(invoices) {
  var out = {};
  invoices.forEach(function (inv) {
    if (inv.kind !== 'Ancillary') return;
    if (inv.status !== 'Pending Approval' && inv.status !== 'Approved') return;
    (inv.lines || []).forEach(function (l) {
      var no = String(l.invoiceNo || '');
      out[no] = cnfRound2_((out[no] || 0) + (Number(l.amount) || 0));
    });
  });
  return out;
}

// One row per shipment of a non-INR vendor, whatever its batch status. A
// shipment can be CNF-invoiced once its batch is Delivered, an air batch has
// its shipping partner set, and its vendor invoice is fully paid; its value
// is the INR actually paid to the vendor. invoices is optional (defaults to
// the live CNF invoices).
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

  var info = cnfPurchaseInvoiceInfo_();
  var settled = cnfSettledByInvoice_();
  var names = getCachedVendorNameMap_(ss);
  var partnerByBatch = spPartnerByBatch_();

  return ships.map(function (s) {
    var b = batchInfo[s.batchId] || { status: '', type: 'sea' };
    var invoiceRmb = s.invoiceNo && Object.prototype.hasOwnProperty.call(info, s.invoiceNo) ? info[s.invoiceNo].rmb : null;
    var paid = settled[s.invoiceNo] || { settledRmb: 0, paidInr: 0 };
    var fullyPaid = invoiceRmb !== null && invoiceRmb > 0 && invoiceRmb - paid.settledRmb < 0.01;
    var partnerId = b.type === 'air' ? (partnerByBatch[s.batchId] || '') : '';
    var reason = '';
    if (b.status !== 'Delivered') reason = 'Batch not delivered';
    else if (b.type === 'air' && !partnerId) reason = "Set the batch's shipping partner first";
    else if (!s.invoiceNo) reason = 'No vendor invoice on shipment';
    else if (shipmentsPerInvoice[s.invoiceNo] > 1) reason = 'Vendor invoice ' + s.invoiceNo + ' is shared by ' + shipmentsPerInvoice[s.invoiceNo] + ' shipments';
    else if (invoiceRmb === null) reason = 'Vendor invoice not in accounts yet';
    else if (info[s.invoiceNo].type === 'Ancillary') reason = 'Vendor invoice ' + s.invoiceNo + ' is marked Ancillary';
    else if (!fullyPaid) reason = 'Vendor invoice not fully paid';
    var eligible = reason === '';
    var paidInr = cnfRound2_(paid.paidInr);
    var claimed = invoiced[s.shipmentId] || { goods: 0, total: 0 };
    var invoicedInr = cnfRound2_(claimed.goods);
    return {
      batchId: s.batchId,
      batchStatus: b.status,
      batchType: b.type,
      shippingPartnerId: partnerId,
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

// One row per Ancillary vendor invoice. CNF can bill one once it is fully
// paid, up to the INR actually paid for it; pending and approved ancillary
// CNF invoices count as billed. invoices is optional (defaults to the live ones).
function getCnfAncillaryValues_(invoices) {
  var invoiced = cnfInvoicedByVendorInvoice_(invoices || readCnfInvoices_());
  var info = cnfPurchaseInvoiceInfo_();
  var settled = cnfSettledByInvoice_();
  var names = getCachedVendorNameMap_(SpreadsheetApp.getActiveSpreadsheet());
  return Object.keys(info).filter(function (no) { return info[no].type === 'Ancillary'; }).map(function (no) {
    var i = info[no];
    var paid = settled[no] || { settledRmb: 0, paidInr: 0 };
    var fullyPaid = i.rmb > 0 && i.rmb - paid.settledRmb < 0.01;
    var eligible = fullyPaid;
    var paidInr = cnfRound2_(paid.paidInr);
    var invoicedInr = cnfRound2_(invoiced[no] || 0);
    return {
      invoiceNo: no, vendorCode: i.vendor, vendorName: names[i.vendor] || i.vendor, date: i.date, notes: i.notes,
      invoiceRmb: i.rmb, paidInr: paidInr, fullyPaid: fullyPaid, invoicedInr: invoicedInr,
      remainingInr: eligible ? cnfRound2_(Math.max(0, paidInr - invoicedInr)) : 0,
      invoiceStatus: invoicedInr < 0.01 ? 'Not invoiced' : (paidInr - invoicedInr < 1 ? 'Fully invoiced' : 'Part invoiced'),
      eligible: eligible,
      ineligibleReason: eligible ? '' : 'Vendor invoice not fully paid'
    };
  });
}

function cnfRequireUser_(payload) {
  var who = String((payload && payload.user_email) || '').trim();
  if (!who) throw new Error('Your identity could not be verified. Sign in again and retry.');
  return who;
}

// payload: { kind ('Goods' default | 'Ancillary'), cnfInvoiceNo, invoiceDate
// (yyyy-mm-dd), fileUrl, lines, baseAmount, gst, total, overrideReason,
// user_email (stamped by the proxy) }. Goods lines are [{ shipmentId, amount }];
// ancillary lines are [{ invoiceNo, amount }]. One kind per invoice.
// Everything is re-validated under the script lock against fresh sheet data;
// the screen's own caps are only a convenience.
function logCnfGoodsInvoice_(payload) {
  var p = payload || {};
  var submittedBy = cnfRequireUser_(p);
  var kind = p.kind === undefined || p.kind === null || p.kind === '' ? 'Goods' : String(p.kind);
  if (kind !== 'Goods' && kind !== 'Ancillary') throw new Error('kind must be Goods or Ancillary');
  var ancillary = kind === 'Ancillary';
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
  if (linesIn.length === 0) throw new Error(ancillary ? 'Pick at least one ancillary invoice' : 'Pick at least one shipment');

  var keyField = ancillary ? 'invoiceNo' : 'shipmentId';
  var what = ancillary ? 'Ancillary invoice ' : 'Shipment ';
  var seen = {};
  var requested = linesIn.map(function (l, i) {
    var key = String((l && l[keyField]) || '').trim();
    var amount = cnfRound2_(l && l.amount);
    if (!key) throw new Error('Line ' + (i + 1) + (ancillary ? ' has no vendor invoice' : ' has no shipment'));
    if (seen[key]) throw new Error(what + key + ' is listed twice');
    seen[key] = true;
    if (!(amount > 0)) throw new Error('Amount for ' + what.toLowerCase() + key + ' must be positive');
    return { key: key, amount: amount };
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

    var byKey = {};
    (ancillary ? getCnfAncillaryValues_(existing) : getCnfShipmentValues_(existing)).forEach(function (v) { byKey[v[keyField]] = v; });

    var lines = requested.map(function (l) {
      var v = byKey[l.key];
      if (!v) throw new Error(what + l.key + ' not found');
      if (!v.eligible) throw new Error(what + l.key + " can't be CNF-invoiced: " + v.ineligibleReason);
      if (l.amount > v.remainingInr + 0.01) {
        throw new Error(what + l.key + ' has only ' + cnfFmtInr_(v.remainingInr) + ' left to invoice');
      }
      return ancillary
        ? { invoiceNo: v.invoiceNo, vendorCode: v.vendorCode, amount: l.amount }
        : { batchId: v.batchId, shipmentId: v.shipmentId, vendorCode: v.vendorCode, invoiceNo: v.invoiceNo, amount: l.amount };
    });

    var purchaseValue = cnfRound2_(lines.reduce(function (s, l) { return s + l.amount; }, 0));
    var serviceCharge = cnfRound2_(baseAmount - purchaseValue);
    var need = function (msg) { if (!overrideReason) throw new Error(msg + ' Give an override reason to save anyway.'); };
    if (Math.abs(baseAmount + gst - total) >= 1) need("Base + GST doesn't match Total.");
    if (ancillary ? serviceCharge <= -1 : serviceCharge < 0) need('Service charge is negative (CNF billed less than the ' + (ancillary ? 'INR paid' : 'goods value') + ').');
    var gstPct = getIgstPercent_();
    var expectedGst = cnfRound2_(baseAmount * gstPct / 100);
    if (Math.abs(gst - expectedGst) >= 1) need('GST should be ' + gstPct + '% of the base (' + cnfFmtInr_(expectedGst) + '); billed ' + cnfFmtInr_(gst) + '.');
    if (ancillary) {
      if (serviceCharge >= 1) need('CNF charges no commission on ancillary invoices (billed ' + cnfFmtInr_(serviceCharge) + ').');
    } else {
      // KREIZ charges no commission on air batches another partner shipped.
      var partnerShippedOnly = lines.every(function (l) {
        var v = byKey[l.shipmentId];
        return v.batchType === 'air' && v.shippingPartnerId && v.shippingPartnerId !== CNF_VENDOR_CODE_;
      });
      if (partnerShippedOnly && serviceCharge >= 1) {
        need('These batches were shipped by another partner, so CNF should bill no service charge (billed ' + cnfFmtInr_(serviceCharge) + ').');
      }
    }

    // Row count keeps ids unique even for two saves in the same millisecond.
    var id = 'CGI-' + new Date().getTime() + '-' + (existing.length + 1);
    sheet.appendRow([
      id, cnfInvoiceNo, invoiceDate, fileUrl, JSON.stringify(lines),
      cnfRound2_(baseAmount), purchaseValue, serviceCharge, cnfRound2_(gst), cnfRound2_(total),
      'Pending Approval', overrideReason, submittedBy, '', '', '', new Date().toISOString(), kind
    ]);
    return { status: 'success', id: id, kind: kind, purchaseValue: purchaseValue, serviceCharge: serviceCharge };
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
  if (inv.kind === 'Ancillary') {
    var items = (inv.lines || []).map(function (l) { return l.invoiceNo + ' (' + l.vendorCode + ') ' + cnfFmtInr_(l.amount); });
    return 'CNF ' + inv.cnfInvoiceNo + ' · ancillary · ' + items.join(' + ') + ' · GST ' + cnfFmtInr_(inv.gst);
  }
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
      date: inv.invoiceDate, order: 1, type: inv.kind === 'Ancillary' ? 'Tax invoice (ancillary)' : 'Tax invoice', reference: inv.cnfInvoiceNo,
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
  'Weight Kg', 'CNF Charge', 'IGST Pct', 'GST', 'Expected Total', 'Shipments', 'Generated By', 'Generated At',
  'Shipping Partner'];

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
      shippingPartnerId: String(r[14] || ''),
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
// An air batch needs its shipping partner set. When that partner is not
// KREIZ, KREIZ bills goods + GST only: charge 0, and category / rate /
// weight are ignored (the partner bills its own fee).
function saveCnfDraftInvoice_(payload) {
  var p = payload || {};
  var who = cnfRequireUser_(p);
  var batchId = String(p.batchId || '').trim();
  var categoryId = String(p.categoryId || '').trim();
  var rate = Number(p.rate);
  var weight = p.weightKg === undefined || p.weightKg === null || p.weightKg === '' ? null : Number(p.weightKg);
  if (!batchId) throw new Error('batchId is required');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Another CNF save is in progress. Try again in a moment.');
  try {
    var ships = getCnfShipmentValues_().filter(function (s) { return s.batchId === batchId; });
    if (!ships.length) throw new Error('Batch ' + batchId + ' has no shipments from overseas vendors');
    if (ships[0].batchStatus !== 'Delivered') throw new Error('Batch ' + batchId + ' is not delivered yet');
    var mode = ships[0].batchType;
    var partnerId = ships[0].shippingPartnerId;
    if (mode === 'air' && !partnerId) throw new Error('Set the shipping partner of ' + batchId + ' first');
    var unpaid = ships.filter(function (s) { return !s.eligible; });
    if (unpaid.length) {
      throw new Error('Batch ' + batchId + ' is not fully paid: ' + unpaid.map(function (s) { return s.shipmentId + ' (' + s.ineligibleReason + ')'; }).join(', '));
    }
    var partnerShipped = mode === 'air' && partnerId !== CNF_VENDOR_CODE_;
    var category = null;
    if (!partnerShipped) {
      if (!categoryId) throw new Error('Pick a rate category');
      if (!(rate > 0)) throw new Error('Rate must be above 0');
      var categories = mode === 'air' ? getCnfAirRateCategories_() : getCnfCommissionRates_();
      category = categories.filter(function (c) { return c.id === categoryId; })[0];
      if (!category) throw new Error('Unknown ' + (mode === 'air' ? 'Air' : 'Sea') + ' rate category: ' + categoryId);
      if (mode === 'air' && !(weight > 0)) throw new Error('Enter the batch weight (kg)');
    }

    var goods = cnfRound2_(ships.reduce(function (s, x) { return s + x.paidInr; }, 0));
    var igstPct = getIgstPercent_();
    var f = cnfDraftFigures_(mode, goods, partnerShipped ? 0 : rate, partnerShipped ? 0 : weight, igstPct);
    var draft = {
      batchId: batchId, batchType: mode, goodsValue: goods,
      categoryId: partnerShipped ? '' : categoryId, categoryLabel: partnerShipped ? '' : category.label,
      rate: partnerShipped ? 0 : rate, weightKg: mode === 'air' && !partnerShipped ? weight : null,
      charge: f.charge, igstPct: igstPct, gst: f.gst, total: f.total,
      shipments: ships.map(function (s) { return { shipmentId: s.shipmentId, paidInr: s.paidInr }; }),
      generatedBy: who, generatedAt: new Date().toISOString(), shippingPartnerId: partnerId
    };
    var row = [draft.batchId, draft.batchType, draft.goodsValue, draft.categoryId, draft.categoryLabel, draft.rate,
      draft.weightKg === null ? '' : draft.weightKg, draft.charge, draft.igstPct, draft.gst, draft.total,
      JSON.stringify(draft.shipments), draft.generatedBy, draft.generatedAt, draft.shippingPartnerId];

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CNF_DRAFTS_SHEET_);
    if (!sheet) { sheet = ss.insertSheet(CNF_DRAFTS_SHEET_); sheet.appendRow(CNF_DRAFT_HEADERS_); }
    // Sheets created before the Shipping Partner column have a 14-column header.
    var lastCol = CNF_DRAFT_HEADERS_.length;
    if (String(sheet.getRange(1, lastCol).getValue() || '') !== CNF_DRAFT_HEADERS_[lastCol - 1]) {
      sheet.getRange(1, lastCol).setValue(CNF_DRAFT_HEADERS_[lastCol - 1]);
    }
    var existing = readCnfDraftInvoices_().filter(function (d) { return d.batchId === batchId; })[0];
    if (existing) sheet.getRange(existing.rowNumber, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
    return { status: 'success', draft: draft };
  } finally {
    lock.releaseLock();
  }
}
