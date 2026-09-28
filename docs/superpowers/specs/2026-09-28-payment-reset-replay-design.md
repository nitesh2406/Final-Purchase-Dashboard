# Payment Reset & Replay — Design

Date: 2026-09-28
Status: Approved section-by-section by user; pending review of this document

Piece B of the Finance-group work (piece A: `2026-09-28-cnf-unified-tab-design.md`,
live at @431). Goal: wipe every vendor payment and settlement, then re-enter
all of them through the normal code paths, so the new computed CNF ledger and
the rest of the payment logic can be checked end to end against the user's
books.

## Decisions (user, 2026-09-28)

| # | Decision |
|---|---|
| 1 | The script replays the payments from a backup (not re-typed by hand). |
| 2 | Replay **everything exactly as it was**, TEST-INR entries included. |
| 3 | **Simple replay**: no change to settlement logic. Invoices that originally arrived after the paying wallet are settled at payment time on replay (label "FIFO Settlement" instead of "Auto-Settlement Advance Match", dated at the payment). Totals per invoice are unchanged. |
| 4 | Run as backend admin actions that Claude calls (like the @430 data repairs): dry run by default, one user go-ahead for the whole sequence, stop on any surprise. |

## What payments write (live, 2026-09-28)

| Sheet | Written by payments | Count |
|---|---|---|
| PaymentLogs | every payment (DP-) and cross-vendor transfer (IDP-) | 68 (19 DP, 49 IDP) |
| SettlementLedger | every settlement row | 115 (107 FIFO, 8 auto-settlement) |
| PurchaseInvoices | `Settled Amount` / `Balance` on every invoice; **`XFER-<IDP>-<vendor>` shortfall invoices created by transfers** | 88 invoices, 29 of them `XFER-` |
| VendorLedger | `Payment` and `Adjustment (…)` rows (running `Running Balance` per vendor) | 19 + 106 (10 `Purchase` rows are invoice-side, kept) |
| Batches | `paid_amount_inr`, `blended_settlement_rate`, `settlement_synced_at`, `payment_status` | all batches |

Facts that shape the replay:
- Payment and transfer IDs are derived from the sheet (max suffix + 1), and both
  `addPaymentLog` and `addAdjustmentEntry` accept a supplied ID, so the replay
  keeps the original IDs (DP-00001 … IDP-00049) and the `XFER-` ids they
  produce.
- The conversion charge (`CONVERSION_CHARGE_PCT`) was 2% for every payment
  (implied from stored ER2 vs Settled ER2), so settled rates reproduce if it
  is still 2%.
- PaymentLogs is **not** in date order (backdated transfers). Settlement
  depends on the order entries were made, so the replay follows **sheet row
  order**, not dates.
- No payment was split across vendors at entry: the only same-day DP + IDPs
  from the same payer (DP-00017 → IDP-00046/47) were separate transfers made
  after the payment (IDP-00047 needed a shortfall, only possible if DP-00017
  had already been spent). Every IDP is replayed as its own transfer.
- No "Settle Invoice" (invoice-targeted) transfers exist; all settlements are
  FIFO or auto-settlement.
- Known risk: an `XFER-` shortfall invoice is priced by
  `getHistoricalClosingRate_(date)`, falling back to the live rate when the
  historical lookup fails. If a lookup fell back originally, or does on
  replay, that invoice's ER1/INR can differ. Verify compares `XFER-` ER1/INR
  explicitly, so any such case is reported, not hidden.

## Actions

All live in a new file `gas_clone/payment_reset.js`, routed in `doPost`.
Each is Admin tooling called by Claude with curl; none is exposed in the UI.
The backup name (`BAK-yyyy-MM-dd`) is stored in Script Property
`PAYMENT_RESET_BACKUP` by the backup step and read by the others.

### 1. `payment_reset_backup`
Only adds, so no dry run.
- For each of PaymentLogs, SettlementLedger, PurchaseInvoices, VendorLedger,
  Batches: `sheet.copyTo(ss)` renamed `BAK-yyyy-MM-dd <Sheet>` (values and
  formats). Refuses if a tab with that name already exists.
- Full file copy in Drive: `DriveApp.getFileById(ss.getId()).makeCopy('App Building Sheets — before payment reset yyyy-MM-dd')`.
- Returns tab names, row counts per tab, the Drive copy's URL.

### 2. `payment_reset_clear` (dry run by default)
Refuses unless today's backup exists and its PaymentLogs tab has the same
number of rows as live PaymentLogs (nothing logged since the backup).
- PaymentLogs: delete all data rows (header kept).
- SettlementLedger: delete all data rows.
- PurchaseInvoices: delete rows whose invoice no starts `XFER-`; on every other
  row set `Settled Amount` = 0 and `Balance` = `RMB`.
- VendorLedger: delete rows whose `Particulars` is `Payment` or starts with
  `Adjustment`; recompute `Running Balance` per vendor, in row order, over the
  remaining rows.
- Batches: blank `paid_amount_inr`, `blended_settlement_rate`,
  `settlement_synced_at`, `payment_status`.
- `invalidateSheetCache_` for each sheet; `bumpBatchDataVersion_()`.
- Dry run returns the counts per line above; the real run returns the same
  counts as done. Untouched: invoice ER1/INR/ER Status, CNF_Goods_Invoices, CNF
  rate config, POs, shipments, all other sheets.

### 3. `payment_reset_replay` (dry run by default)
Source: the backup PaymentLogs tab, in row order.
- Preflight: `getConversionChargePercent_()` must equal the charge implied by
  the backup (2, within 0.1); otherwise refuse and report both values.
- DP- row → `addPaymentLog({ paymentId, date, vendorCode, rmb, er2, paymentMode, referenceNo })`.
- IDP- row → `addAdjustmentEntry({ txnType: 'Transfer', paymentId, sourceVendor, targetVendor, amountRmb, date })`
  (`sourceVendor` = backup `Source Vendor`, `targetVendor` = backup vendor code).
- `date` is the backup date formatted `yyyy-MM-dd` in the script time zone
  (IST), never `toISOString()`.
- Both functions return ContentService output; the replay parses it and
  **stops at the first `status: 'error'`**, returning the entry and message.
- Chunked: processes entries until ~270 s have elapsed or `limit` is reached,
  then returns `{ done, processed, nextIndex, remaining }`. Entries already in
  live PaymentLogs are skipped (the functions' own duplicate guards also make
  a repeat safe), so calling again resumes.
- After the last entry: `backfillBatchSettlementAggregates_()` so every batch's
  paid INR / rate / payment status is recomputed, then cache invalidation.
- Dry run returns the ordered list (index, ID, type, vendor, source, RMB, date)
  and the preflight result.

### 4. `payment_reset_verify` (read-only)
Compares live against the backup tabs, tolerance ¥0.01 / ₹1:
- PaymentLogs: same set of IDs; per ID `RMB`, `INR Amount`, `Settled ER2`, `Balance`.
- PurchaseInvoices: per invoice no `Settled Amount`, `Balance`; for `XFER-`
  rows also `RMB`, `ER1`, `INR`; same set of invoice nos.
- SettlementLedger: per invoice no Σ|RMB| and Σ|RMB|×ER2 (row counts, labels
  and dates may differ — reported as expected, not as differences).
- VendorLedger: last `Running Balance` per vendor.
- Batches: `paid_amount_inr`, `blended_settlement_rate`, `payment_status`.
- CNF ledger: `getCnfLedgerStatement_({}).totals.paid` equal before/after
  (before = computed from the backup PaymentLogs with the same rule).
Returns matched counts per area and the list of differences.

### 5. `payment_reset_restore` (dry run by default)
Copies each backup tab's values over the live sheet (clear contents, then
`setValues` of the backup range, same dimensions), then cache invalidation.
For use only if verify shows a problem. Backup tabs stay until the user
deletes them by hand.

## Run sequence

1. Deploy (fresh `clasp pull` + diff first, as usual). Ask the ops team not to
   log payments or sync vendor invoices for ~15 minutes.
2. Dry runs of clear and replay (after a real backup) → show the user the
   counts and the ordered list → **one go-ahead** for backup → clear → replay
   → verify.
3. Stop and report if a real-run count differs from its dry run, any replay
   entry fails, or verify lists differences beyond the expected label/date
   changes.

## Testing (before anything touches live)

Scratchpad harness (same fake-spreadsheet pattern as the CNF tests), seeded
from today's live PaymentLogs, SettlementLedger, PurchaseInvoices, VendorLedger,
Vendor Masters and batch/shipment data:
- backup → clear (dry run counts = expected) → clear → replay → verify reports
  **zero differences** apart from the expected settlement label/date changes;
- restore after a deliberate corruption returns every live sheet identical to
  its backup;
- clear refuses without a backup / when PaymentLogs changed after the backup;
- replay refuses when the conversion charge differs; stops on an injected
  failing entry and resumes cleanly afterwards; a repeat call adds nothing.
- `node --check` on every gas_clone file; existing CNF / PO / Draft Orders
  harnesses still pass.
