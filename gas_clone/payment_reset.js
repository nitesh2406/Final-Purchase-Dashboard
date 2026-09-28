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
