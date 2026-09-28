// ─────────────────────────────────────────────────────────────
// PAYMENT RESET & REPLAY — see docs/superpowers/specs/2026-09-28-payment-reset-replay-design.md.
// Admin tooling called with curl (never from the UI): back up the five sheets
// payments write, clear every payment and settlement consistently, re-enter
// the payments from the backup through the normal code paths (addPaymentLog /
// addAdjustmentEntry, original IDs, backup row order), and verify the result
// against the backup. Restore puts the backup back.
// ─────────────────────────────────────────────────────────────

var PR_SHEETS_ = ['PaymentLogs', 'SettlementLedger', 'PurchaseInvoices', 'VendorLedger', 'Batches'];
var PR_PROP_ = 'PAYMENT_RESET_BACKUP';
var PR_BATCH_AGG_COLS_ = ['paid_amount_inr', 'blended_settlement_rate', 'settlement_synced_at', 'payment_status'];

function prRound2_(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function prToday_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function prTabName_(prefix, sheetName) { return prefix + ' ' + sheetName; }

function prBackupPrefix_() {
  var p = PropertiesService.getScriptProperties().getProperty(PR_PROP_);
  if (!p) throw new Error('No payment-reset backup recorded. Run payment_reset_backup first.');
  return p;
}

function prBackupValues_(sheetName) {
  var name = prTabName_(prBackupPrefix_(), sheetName);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Backup tab missing: ' + name);
  return sheet.getDataRange().getValues();
}

function paymentResetBackup_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var prefix = 'BAK-' + prToday_();
  PR_SHEETS_.forEach(function (n) {
    if (!ss.getSheetByName(n)) throw new Error('Sheet not found: ' + n);
    if (ss.getSheetByName(prTabName_(prefix, n))) {
      throw new Error('Backup tab already exists: ' + prTabName_(prefix, n) + '. Delete today\'s backup tabs first if you really want a new backup.');
    }
  });
  var tabs = PR_SHEETS_.map(function (n) {
    var copy = ss.getSheetByName(n).copyTo(ss);
    copy.setName(prTabName_(prefix, n));
    return { sheet: n, tab: copy.getName(), rows: copy.getLastRow() };
  });
  var file = DriveApp.getFileById(ss.getId()).makeCopy('App Building Sheets — before payment reset ' + prToday_());
  PropertiesService.getScriptProperties().setProperty(PR_PROP_, prefix);
  return { status: 'success', prefix: prefix, tabs: tabs, driveCopyUrl: file.getUrl() };
}

// Rewrites the data rows of a sheet as keptRows (row 2 onward), clearing the
// rest. Always leaves at least one (blank) data row: Sheets refuses to delete
// every non-frozen row, and a blank row is ignored by every reader here.
function prRewriteRows_(sheet, width, keptRows, originalDataRows) {
  if (originalDataRows > 0) sheet.getRange(2, 1, originalDataRows, width).clearContent();
  if (keptRows.length) sheet.getRange(2, 1, keptRows.length, width).setValues(keptRows);
  var extra = originalDataRows - Math.max(keptRows.length, 1);
  if (extra > 0) sheet.deleteRows(2 + Math.max(keptRows.length, 1), extra);
}

function prPlanClear_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var prefix = prBackupPrefix_();
  if (prefix !== 'BAK-' + prToday_()) throw new Error('The backup (' + prefix + ') is not from today. Take a fresh backup first.');
  var live = {};
  PR_SHEETS_.forEach(function (n) { live[n] = ss.getSheetByName(n).getDataRange().getValues(); });
  var backupPayments = prBackupValues_('PaymentLogs');
  if (backupPayments.length !== live.PaymentLogs.length) {
    throw new Error('PaymentLogs changed since the backup (' + (backupPayments.length - 1) + ' rows in the backup, ' + (live.PaymentLogs.length - 1) + ' now). Take a fresh backup first.');
  }

  var pi = live.PurchaseInvoices, piH = pi[0];
  var piInv = findHeaderIndex_(piH, 'invoice_no'), piRmb = findHeaderIndex_(piH, 'RMB');
  var piSettled = findHeaderIndex_(piH, 'Settled Amount'), piBal = findHeaderIndex_(piH, 'Balance');
  if (piInv === -1 || piRmb === -1 || piSettled === -1 || piBal === -1) throw new Error('PurchaseInvoices is missing invoice_no / RMB / Settled Amount / Balance');
  var invoices = [], xferDeleted = 0, invoicesReset = 0;
  pi.slice(1).forEach(function (r) {
    var no = String(r[piInv] || '').trim();
    if (no.indexOf('XFER-') === 0) { xferDeleted++; return; }
    var row = r.slice();
    if (no) { row[piSettled] = 0; row[piBal] = Number(row[piRmb]) || 0; invoicesReset++; }
    invoices.push(row);
  });

  // VendorLedger is positional (see logToVendorLedger_): [1] vendor,
  // [3] particulars, [5] RMB, [6] running balance — cumulative per vendor.
  var vl = live.VendorLedger;
  var ledger = [], vlDeleted = 0, running = {};
  vl.slice(1).forEach(function (r) {
    var particulars = String(r[3] || '').trim();
    if (particulars === 'Payment' || particulars.indexOf('Adjustment') === 0) { vlDeleted++; return; }
    var row = r.slice();
    var vendor = String(row[1] || '').trim();
    if (vendor) { running[vendor] = prRound2_((running[vendor] || 0) + (Number(row[5]) || 0)); row[6] = running[vendor]; }
    ledger.push(row);
  });

  var bh = live.Batches[0];
  var aggCols = PR_BATCH_AGG_COLS_.map(function (c) { return bh.indexOf(c); }).filter(function (i) { return i !== -1; });

  return {
    live: live, invoices: invoices, ledger: ledger, aggCols: aggCols,
    counts: {
      paymentLogs: live.PaymentLogs.length - 1,
      settlementRows: live.SettlementLedger.length - 1,
      xferInvoicesDeleted: xferDeleted,
      invoicesReset: invoicesReset,
      vendorLedgerDeleted: vlDeleted,
      vendorLedgerKept: ledger.filter(function (r) { return String(r[1] || '').trim(); }).length,
      batchesCleared: live.Batches.length - 1
    }
  };
}

function paymentResetClear_(payload) {
  var dryRun = !(payload && payload.dry_run === false);
  var plan = prPlanClear_();
  if (dryRun) return { status: 'success', dry_run: true, counts: plan.counts };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var live = plan.live;
  prRewriteRows_(ss.getSheetByName('PaymentLogs'), live.PaymentLogs[0].length, [], live.PaymentLogs.length - 1);
  prRewriteRows_(ss.getSheetByName('SettlementLedger'), live.SettlementLedger[0].length, [], live.SettlementLedger.length - 1);
  prRewriteRows_(ss.getSheetByName('PurchaseInvoices'), live.PurchaseInvoices[0].length, plan.invoices, live.PurchaseInvoices.length - 1);
  prRewriteRows_(ss.getSheetByName('VendorLedger'), live.VendorLedger[0].length, plan.ledger, live.VendorLedger.length - 1);
  var batches = ss.getSheetByName('Batches');
  var nBatches = live.Batches.length - 1;
  if (nBatches > 0) {
    var blankCol = [];
    for (var i = 0; i < nBatches; i++) blankCol.push(['']);
    plan.aggCols.forEach(function (c) { batches.getRange(2, c + 1, nBatches, 1).setValues(blankCol); });
  }
  PR_SHEETS_.forEach(function (n) { invalidateSheetCache_(n); });
  bumpBatchDataVersion_();
  return { status: 'success', dry_run: false, counts: plan.counts };
}

function prParseResponse_(out) {
  try { return JSON.parse(out.getContent()); } catch (e) { return { status: 'error', message: 'Unreadable response: ' + e.message }; }
}

function prReplayEntries_() {
  var rows = prBackupValues_('PaymentLogs'), h = rows[0];
  var col = function (n) { return findHeaderIndex_(h, n); };
  var c = { date: col('Date'), id: col('Payment ID'), vendor: col('Vendor Code'), rmb: col('RMB'), er2: col('ER2'),
            settled: col('Settled ER2'), mode: col('Payment Mode'), ref: col('Reference No'), source: col('Source Vendor') };
  if (c.id === -1 || c.vendor === -1 || c.rmb === -1 || c.date === -1) throw new Error('Backup PaymentLogs is missing Date / Payment ID / Vendor Code / RMB');
  var entries = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var id = String(r[c.id] || '').trim();
    if (!id) continue;
    var kind = /^DP-/i.test(id) ? 'DP' : /^IDP-/i.test(id) ? 'IDP' : null;
    if (!kind) throw new Error('Backup row ' + (i + 1) + ': unexpected payment id ' + id);
    var e = {
      index: entries.length, paymentId: id, kind: kind, date: cnfYmd_(r[c.date]),
      vendorCode: String(r[c.vendor] || '').trim(), rmb: Number(r[c.rmb]) || 0,
      er2: c.er2 !== -1 ? Number(r[c.er2]) || 0 : 0, settledEr2: c.settled !== -1 ? Number(r[c.settled]) || 0 : 0,
      mode: c.mode !== -1 ? String(r[c.mode] || '') : '', ref: c.ref !== -1 ? String(r[c.ref] || '') : '',
      sourceVendor: c.source !== -1 ? String(r[c.source] || '').trim() : ''
    };
    if (kind === 'IDP' && !e.sourceVendor) throw new Error('Backup row ' + (i + 1) + ': transfer ' + id + ' has no Source Vendor');
    entries.push(e);
  }
  return entries;
}

// Charge implied by the backup's direct payments (ER2 vs stored Settled ER2),
// median so a rounding outlier can't skew it. null if there are none.
function prImpliedChargePct_(entries) {
  var v = entries.filter(function (e) { return e.kind === 'DP' && e.er2 > 0 && e.settledEr2 > 0; })
    .map(function (e) { return (e.er2 / e.settledEr2 - 1) * 100; }).sort(function (a, b) { return a - b; });
  if (!v.length) return null;
  return Math.round(v[Math.floor(v.length / 2)] * 1000) / 1000;
}

function paymentResetReplay_(payload) {
  var p = payload || {};
  var dryRun = p.dry_run !== false;
  var limit = Number(p.limit) > 0 ? Number(p.limit) : 100000;
  var budgetMs = Number(p.budget_ms) > 0 ? Number(p.budget_ms) : 270000;
  var entries = prReplayEntries_();
  var implied = prImpliedChargePct_(entries);
  var current = getConversionChargePercent_();
  var preflight = { impliedChargePct: implied, currentChargePct: current, ok: implied === null || Math.abs(implied - current) <= 0.1 };
  if (dryRun) {
    return { status: 'success', dry_run: true, preflight: preflight, total: entries.length, entries: entries };
  }
  if (!preflight.ok) {
    throw new Error('Conversion charge is ' + current + '% now but the payments were logged at about ' + implied + '%. Set it back before replaying.');
  }

  var live = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('PaymentLogs').getDataRange().getValues();
  var lh = live[0], lId = findHeaderIndex_(lh, 'Payment ID'), lVendor = findHeaderIndex_(lh, 'Vendor Code');
  var present = {};
  for (var i = 1; i < live.length; i++) present[String(live[i][lId] || '').trim() + '|' + String(live[i][lVendor] || '').trim()] = true;

  var start = new Date().getTime(), processed = 0, skipped = 0;
  for (var k = 0; k < entries.length; k++) {
    var e = entries[k];
    if (present[e.paymentId + '|' + e.vendorCode]) { skipped++; continue; }
    if (processed >= limit || new Date().getTime() - start > budgetMs) {
      return { status: 'success', dry_run: false, done: false, processed: processed, skipped: skipped, nextIndex: k, remaining: entries.length - k };
    }
    var res = e.kind === 'DP'
      ? prParseResponse_(addPaymentLog({ record: { paymentId: e.paymentId, date: e.date, vendorCode: e.vendorCode, rmb: e.rmb, er2: e.er2, paymentMode: e.mode, referenceNo: e.ref } }))
      : prParseResponse_(addAdjustmentEntry({ record: { txnType: 'Transfer', paymentId: e.paymentId, sourceVendor: e.sourceVendor, targetVendor: e.vendorCode, amountRmb: e.rmb, date: e.date } }));
    if (!res || res.status !== 'success') {
      return { status: 'error', message: 'Replay stopped at #' + e.index + ' ' + e.paymentId + ': ' + ((res && res.message) || 'no response'), stoppedAt: e, processed: processed, skipped: skipped };
    }
    processed++;
  }
  backfillBatchSettlementAggregates_();
  PR_SHEETS_.forEach(function (n) { invalidateSheetCache_(n); });
  bumpBatchDataVersion_();
  return { status: 'success', dry_run: false, done: true, processed: processed, skipped: skipped, total: entries.length };
}
