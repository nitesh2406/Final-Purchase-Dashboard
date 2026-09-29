# Vendor discounts on past invoices

Date: 2026-09-29. Status: design approved in conversation, awaiting spec review.
Piece 2 of 4 in the finance program (see `2026-09-29-finance-entry-tabs-design.md`, piece 1, live).

## Problem

Vendors give discounts on invoices after the fact. Often the invoice is already fully paid through CNF by then. The app has no way to record them.

The user's rules:

- Unpaid invoice: the discount reduces what we owe on it.
- Paid invoice: the discount becomes a credit with that vendor, at the exchange rate we paid the invoice at. The credit is used against the vendor's next open invoice, so we send less through CNF for that invoice and CNF earns less commission.

## Decisions (from the design conversation)

1. **Split, don't refuse.** `direct = min(discount, invoice unpaid balance)` clears the invoice. `credit = discount − direct` becomes a credit. One rule covers unpaid, partly paid and fully paid invoices.
2. **Credit rate** = the weighted average of the settlement rates (SettlementLedger ER2) of the rows that settled the invoice, weighted by |RMB|. Example: ¥6,000 @ 12.20 + ¥4,000 @ 12.50 → ₹12.32. The direct part of earlier discounts on the same invoice is left out: it settled at the invoice's own ER1, which is not a rate anyone paid. The direct part is recorded at the invoice's own ER1, so it creates no forex gain or loss.
3. **Entry points:** a standalone **Log Discount** tab, plus an **Add discount** button on each Accounts View purchase-invoice row that opens the tab pre-filled.
4. **Mechanism:** the discount is a new wallet type in PaymentLogs (`DSC-` series), reusing the settlement engine. There is no separate discount sheet and no negative invoices.
5. **No commission on discounts:** `DSC-` rows are not cash through CNF. They are left out of CNF goods paid and batch paid INR. They still count toward settled RMB and payment status.
6. **No edit or cancel in v1.** Corrections go through the admin payment-reset path, which learns about `DSC-` rows.

## Backend: `log_vendor_discount` (new, `gas_clone/vendor_discounts.js`)

Money-changing: add it to `PROXY_KEY_ALWAYS_` in entry_points.js. It runs under the script lock.

Payload: `date` (yyyy-mm-dd), `vendorCode`, `invoiceId`, `amountRmb`, `creditNoteNo` (required), `notes` (optional).

Steps:

1. **Validate.**
   - The invoice exists and its vendor matches.
   - `amountRmb > 0`.
   - The sum of this invoice's existing discounts plus `amountRmb` does not exceed the invoice RMB.
   - `creditNoteNo` is not blank.
2. **Idempotency.** If a `DSC-` row already exists with the same vendor, Source Invoice and Reference No (the credit-note number), return success with that row's ID and change nothing.
3. **Rate.** Compute the invoice's weighted-average settled rate from its SettlementLedger rows. If `credit > 0` and the invoice has no settlement rows, that can't happen: `credit > 0` only when the balance is 0, which means it was settled. Guard anyway: refuse with a clear message.
4. **Wallet row.** Append a PaymentLogs row `DSC-NNNNN` (a new sequential generator, like DP-/IDP-) with:
   - Date; Vendor Code; RMB Amount = amountRmb.
   - ER2 = INR ÷ RMB; Settled ER2 = the credit rate (or ER1 when there is no credit part).
   - INR Amount = direct × ER1 + credit × credit rate.
   - Payment Mode = `Vendor Discount`; Reference No = creditNoteNo.
   - Balance = amountRmb, drawn down in steps 5-6.
   - New columns, created with `ensureHeaderColumn_`: `Source Invoice` = invoiceId, `Notes` = notes.
5. **Direct part.** If `direct > 0`:
   - Append a SettlementLedger row (DSC id, vendor, invoiceId, −direct, ER1, ER2 = ER1, forex 0, notes `Vendor Discount <creditNoteNo>`).
   - Update the invoice's Settled Amount / Balance, and reduce the wallet row's Balance by `direct`.
6. **Credit part.** If `credit > 0`, run `fifoLiquidate_(vendor, date, dscId, credit, creditRate)`, the same call a payment makes. It settles the vendor's oldest open invoices, writes forex against each invoice's ER1, and draws down the wallet Balance. Anything left stays unspent. The existing new-invoice wallet draw (`autoSettleAdvanceFromInvoice_`) uses it up when the vendor's next invoice is logged.
7. **Vendor ledger.** `logToVendorLedger_(vendor, date, 'Discount', dscId, amountRmb)`.
8. **Batch aggregates.** Re-sync every batch whose invoices got a settlement row: the discounted invoice's batch plus any batch `fifoLiquidate_` touched. `fifoLiquidate_` already syncs the batches it touches.
9. **Response.** Return `{ discountId, direct, credit, creditRate, applied: [{ invoiceId, rmb }], unspentCredit }`.

## Backend: existing code that must treat `DSC-` as non-cash

- `cnfSettledByInvoice_` (cnf_unified.js): `settledRmb` includes DSC rows (eligibility: invoice fully paid); `paidInr` excludes them (what CNF moved; base for commission and draft goods value).
- `syncBatchSettlementAggregate_` (accounting_logger.js): `settledRmbByInvoice` (payment status) includes DSC rows; `totalRmb` / `totalInr` (`paid_amount_inr`, `blended_settlement_rate`) exclude them.
- `payment_reset.js`: backup includes the new PaymentLogs columns. Replay re-logs `DSC-` rows in sheet order, keeping their IDs, through the discount function. `DSC-` rows are not treated as payments to replay via `addPaymentLog`. Verify compares the discount rows' results like any other.
- **Unchanged on purpose:**
  - Vendor balances: a DSC wallet reduces what we owe, like a payment.
  - The CNF ledger statement: it counts only `DP-` rows and KREIZ.
  - Cross-vendor transfers: they may draw a DSC credit like any unspent wallet.

Known consequence: batch paid INR is cash through CNF. A batch whose invoice was later discounted keeps its full cash figure, and the next batch's figure reflects only the cash it needed. The total across batches equals total cash, with no double counting.

## Frontend

- **Log Discount tab.** `/finance/log-discount`, sidebar Finance group between Log Payment and Log Settlement. `ViewType` 'Log Discount'. Page title "Vendor Discount Entry".
  - Fields: date, vendor, invoice (all of the vendor's invoices, labelled `INV · date · ¥amount · paid ¥x · balance ¥y`), discount RMB, credit-note / reference no. (required), notes.
  - Preview, before saving: the direct/credit split, the credit rate and INR value, where the credit will go. It uses the same weighted-average rule on the loaded settlement records, in a pure helper `components/finance/discountPreview.ts`. The backend's figures are the ones stored.
  - After saving: show the DSC id and the backend's `applied` list.
  - Pre-fill from `?vendor=&invoice=`.
  - Saves with `callGasAuthed('log_vendor_discount', …)` (proxy key), not the sync queue. On a transport error the message says the discount may have been saved: check Accounts View before retrying. A retry with the same credit note is a no-op anyway.
- **Accounts View → Purchase Entries:** an "Add discount" button per invoice row, opening Log Discount pre-filled.
- **Accounts View → Payment Entries:** `DSC-` rows show a "Discount" badge and the source invoice.
- **Frontend sums of "INR paid" to a vendor or batch** exclude `DSC-` rows by the same rule (e.g. `computeCnfBatchRate`); the plan lists each one. `computeBatchSettlementStatus` keeps counting them, to stay in lockstep with the backend payment status.

## Testing

- **Backend harness** (real gas_clone code on test sheets):
  - unpaid invoice fully cleared;
  - part-paid split;
  - fully paid → all credit → applied to the next open invoice, with correct forex;
  - no open invoice → the credit waits, and a newly logged invoice uses it up;
  - weighted-average rate;
  - over-discount refused;
  - idempotent retry;
  - CNF paid INR excludes the discount while eligibility includes it;
  - batch aggregates;
  - no proxy key → refused;
  - payment-reset backup/replay/verify round trip with DSC rows.
- **Frontend:** a unit test for `discountPreview.ts`; a browser test of Log Discount (preview, save, success panel) and the Accounts View button.
- The existing CNF, payment-reset and entry-tab suites still pass. Type check / lint stay at the 2 known errors.

## Deploy

Backend first: a fresh clasp pull, a drift check against the last deployed commit (993e911, @436), `clasp push --force`, `clasp deploy --deploymentId <prod>`. Then `vercel --prod`. After the user logs the first real discount, check it read-only: the PaymentLogs DSC row, the settlement rows, CNF shipment values and the batch aggregates.
