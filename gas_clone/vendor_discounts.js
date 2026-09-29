// ─────────────────────────────────────────────────────────────
// VENDOR DISCOUNTS — see docs/superpowers/specs/2026-09-29-vendor-discounts-design.md.
// A discount a vendor gives on one of its invoices after the fact is a wallet
// in PaymentLogs (DSC- series). The part up to the invoice's unpaid balance
// settles that invoice at its own ER1 (no forex). The rest is a credit at the
// rate the invoice was actually paid at; fifoLiquidate_ applies it to the
// vendor's open invoices now, and the next invoice logged draws any remainder
// (autoSettleAdvanceFromInvoice_). DSC- rows are never cash through CNF — see
// cnfSettledByInvoice_ and the batch aggregates.
// ─────────────────────────────────────────────────────────────

function dscRound2_(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function dscRound4_(v) { return Math.round((Number(v) || 0) * 10000) / 10000; }

function generateSequentialDiscountId_() {
  return generateSequentialIdWithPrefix_('PaymentLogs', 'Payment ID', 'DSC-');
}

// Fresh read of one PurchaseInvoices row, or null.
function dscFindInvoice_(invoiceId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('PurchaseInvoices');
  var v = sheet.getDataRange().getValues(), h = v[0];
  var c = { id: findHeaderIndex_(h, 'Invoice ID'), vendor: findHeaderIndex_(h, 'Vendor Code'), rmb: findHeaderIndex_(h, 'RMB'),
            er1: findHeaderIndex_(h, 'ER1'), settled: findHeaderIndex_(h, 'Settled Amount'), balance: findHeaderIndex_(h, 'Balance') };
  if (c.id === -1 || c.vendor === -1 || c.rmb === -1 || c.settled === -1 || c.balance === -1) {
    throw new Error('PurchaseInvoices is missing Invoice ID / Vendor Code / RMB / Settled Amount / Balance');
  }
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][c.id] || '').trim() !== invoiceId) continue;
    var rmb = Number(v[i][c.rmb]) || 0, rawBal = v[i][c.balance];
    return {
      sheet: sheet, row: i + 1, cols: c, vendor: String(v[i][c.vendor] || '').trim(), rmb: rmb,
      er1: c.er1 !== -1 ? Number(v[i][c.er1]) || 0 : 0, settled: Number(v[i][c.settled]) || 0,
      balance: rawBal === '' || rawBal === null || rawBal === undefined ? rmb : Number(rawBal) || 0
    };
  }
  return null;
}

// RMB-weighted settlement rate (ER2) of the rows that settled an invoice,
// leaving out the direct part of discounts on this same invoice (settled at
// its own ER1, not a rate anyone paid). 0 when nothing was paid.
function dscPaidRate_(invoiceId, ownDiscountIds) {
  var v = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SettlementLedger').getDataRange().getValues(), h = v[0];
  var c = { inv: findHeaderIndex_(h, 'Invoice ID'), pid: findHeaderIndex_(h, 'Payment ID'), rmb: findHeaderIndex_(h, 'RMB'), er2: findHeaderIndex_(h, 'ER2') };
  var rmbSum = 0, inrSum = 0;
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][c.inv] || '').trim() !== invoiceId) continue;
    if (ownDiscountIds[String(v[i][c.pid] || '').trim()]) continue;
    var r = Math.abs(Number(v[i][c.rmb]) || 0), e = Number(v[i][c.er2]) || 0;
    if (r > 0 && e > 0) { rmbSum += r; inrSum += r * e; }
  }
  return rmbSum > 0 ? inrSum / rmbSum : 0;
}

// The discount itself, with no lock or identity check. Also called by
// paymentResetReplay_ with the original id (forcedId). Throws on bad input.
function applyVendorDiscount_(p, forcedId) {
  var date = String(p.date || '').trim();
  var vendor = String(p.vendorCode || '').trim();
  var invoiceId = String(p.invoiceId || '').trim();
  var amount = dscRound2_(p.amountRmb);
  var ref = String(p.creditNoteNo || '').trim();
  var notes = String(p.notes || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date must be yyyy-mm-dd');
  if (!vendor) throw new Error('Pick the vendor');
  if (!invoiceId) throw new Error('Pick the invoice');
  if (!(amount > 0)) throw new Error('Discount must be above 0');
  if (!ref) throw new Error('Enter the credit note / reference number');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pay = ss.getSheetByName('PaymentLogs');
  ['Settled ER2', 'Payment Mode', 'Reference No', 'Source Invoice', 'Notes'].forEach(function (n) { ensureHeaderColumn_(pay, n); });
  var pv = pay.getDataRange().getValues(), ph = pv[0];
  var col = function (a, b) { var i = findHeaderIndex_(ph, a); return i !== -1 || !b ? i : findHeaderIndex_(ph, b); };
  var pc = { date: col('Date'), id: col('Payment ID'), vendor: col('Vendor Code'), rmb: col('RMB Amount', 'RMB'), er2: col('ER2'),
             settled: col('Settled ER2'), inr: col('INR Amount', 'INR'), mode: col('Payment Mode'), ref: col('Reference No'),
             bal: col('Balance'), source: col('Source Invoice'), notes: col('Notes') };

  var own = {}, discounted = 0;
  for (var i = 1; i < pv.length; i++) {
    var pid = String(pv[i][pc.id] || '').trim();
    if (!/^DSC-/i.test(pid) || String(pv[i][pc.source] || '').trim() !== invoiceId) continue;
    if (String(pv[i][pc.vendor] || '').trim() === vendor && String(pv[i][pc.ref] || '').trim() === ref) {
      return { status: 'success', duplicate: true, discountId: pid };
    }
    own[pid] = true;
    discounted += Number(pv[i][pc.rmb]) || 0;
  }

  var inv = dscFindInvoice_(invoiceId);
  if (!inv) throw new Error('Invoice ' + invoiceId + ' not found');
  if (inv.vendor !== vendor) throw new Error('Invoice ' + invoiceId + ' belongs to ' + inv.vendor + ', not ' + vendor);
  if (discounted + amount > inv.rmb + 0.01) {
    throw new Error('Discounts on ' + invoiceId + ' would total ¥' + dscRound2_(discounted + amount) + ', more than the invoice (¥' + dscRound2_(inv.rmb) + ')');
  }
  var direct = dscRound2_(Math.min(amount, Math.max(0, inv.balance)));
  var credit = dscRound2_(amount - direct);
  if (direct > 0 && !(inv.er1 > 0)) throw new Error('Invoice ' + invoiceId + ' has no ER1 yet (still awaiting its rate). Try again once it is priced.');
  var creditRate = credit > 0 ? dscPaidRate_(invoiceId, own) : 0;
  if (credit > 0 && !(creditRate > 0)) throw new Error('Invoice ' + invoiceId + ' has no payment rate to price the credit at');

  var id = forcedId || generateSequentialDiscountId_();
  var inr = dscRound2_(direct * inv.er1 + credit * creditRate);
  var row = new Array(ph.length).fill('');
  row[pc.date] = date; row[pc.id] = id; row[pc.vendor] = vendor; row[pc.rmb] = amount;
  if (pc.er2 !== -1) row[pc.er2] = dscRound4_(inr / amount);
  row[pc.settled] = dscRound4_(credit > 0 ? creditRate : inv.er1);
  if (pc.inr !== -1) row[pc.inr] = inr;
  row[pc.mode] = 'Vendor Discount'; row[pc.ref] = ref; row[pc.source] = invoiceId; row[pc.notes] = notes;
  if (pc.bal !== -1) row[pc.bal] = credit;
  pay.appendRow(row);
  invalidateSheetCache_('PaymentLogs');

  var ledger = ss.getSheetByName('SettlementLedger');
  if (direct > 0) {
    inv.sheet.getRange(inv.row, inv.cols.settled + 1).setValue(dscRound2_(inv.settled + direct));
    inv.sheet.getRange(inv.row, inv.cols.balance + 1).setValue(dscRound2_(inv.balance - direct));
    invalidateSheetCache_('PurchaseInvoices');
    ledger.appendRow([date, generateSequentialSettlementId(), id, vendor, invoiceId, -direct, inv.er1, inv.er1, 0, 'Vendor Discount ' + ref]);
    invalidateSheetCache_('SettlementLedger');
    syncBatchSettlementAggregatesForInvoices_([invoiceId]);
  }
  if (credit > 0) fifoLiquidate_(vendor, date, id, credit, creditRate);
  invalidateSheetCache_('SettlementLedger');
  logToVendorLedger_(vendor, date, 'Discount', id, amount);

  var applied = [], lv = ledger.getDataRange().getValues(), lh = lv[0];
  var lc = { pid: findHeaderIndex_(lh, 'Payment ID'), inv: findHeaderIndex_(lh, 'Invoice ID'), rmb: findHeaderIndex_(lh, 'RMB') };
  for (var j = 1; j < lv.length; j++) {
    var linv = String(lv[j][lc.inv] || '').trim();
    if (String(lv[j][lc.pid] || '').trim() !== id || (linv === invoiceId && direct > 0)) continue;
    applied.push({ invoiceId: linv, rmb: dscRound2_(Math.abs(Number(lv[j][lc.rmb]) || 0)) });
  }
  var unspent = dscRound2_(credit - applied.reduce(function (s, a) { return s + a.rmb; }, 0));
  return { status: 'success', discountId: id, direct: direct, credit: credit, creditRate: dscRound4_(creditRate),
           applied: applied, unspentCredit: unspent };
}

// log_vendor_discount — money-changing (PROXY_KEY_ALWAYS_), identity from the proxy.
function logVendorDiscount_(payload) {
  var p = payload || {};
  cnfRequireUser_(p);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Another payment or discount is being saved. Try again in a moment.');
  try {
    return applyVendorDiscount_(p, null);
  } finally {
    lock.releaseLock();
  }
}
