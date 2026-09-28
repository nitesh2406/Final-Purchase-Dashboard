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
