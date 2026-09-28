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
