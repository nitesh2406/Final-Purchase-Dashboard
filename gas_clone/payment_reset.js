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
