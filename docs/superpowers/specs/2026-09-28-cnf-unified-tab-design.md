# CNF Unified Tab — Design

Date: 2026-09-28
Status: Approved section-by-section by user; pending review of this document

Supersedes, for the CNF area: `2026-09-25-cnf-advances-invoice-matching-design.md`
(per-advance matching) and the commission-bill parts of
`2026-09-24-cnf-agent-tab-rework-design.md` / `2026-08-06-cnf-agent-accounting-design.md`.

## Background

The business never pays an overseas (RMB) vendor directly. It pays CNF in INR,
and CNF pays the vendor. Later CNF issues its own GST tax invoice covering the
goods of one or more delivered shipments, with its commission baked into the
goods price (one combined base amount + GST — not itemised).

From the books' point of view CNF is a vendor (code **KREIZ**). Money sent to
CNF is an advance; CNF's tax invoices are purchases that use it up. The user
wants one CNF screen that shows this as a bank-statement-style running balance
that tallies with their books.

Today this is split across two tabs (CNF Agent, CNF Advances) and two
overlapping models (per-batch commission bills; per-advance invoice matching).
Live data at design time: 0 CNF advances, 0 CNF goods invoices, 0 commission
bills, 1 old `CNF_Ledger` entry (S-26001), 19 direct payments (DP-), 49
cross-vendor transfers (IDP-).

## Decisions (user, 2026-09-28)

| # | Decision |
|---|---|
| 1 | Only **direct payments** (DP-) to overseas vendors count as money paid to CNF. Cross-vendor transfers (IDP-) move money already with CNF and are excluded. |
| 2 | CNF invoices show one combined amount + GST. We split it: **Purchase** = INR actually paid to the vendor for the covered shipments; **Service charge** = CNF base amount − Purchase. |
| 3 | In the ledger a CNF invoice is **one row for its total**; the split lives in the description. |
| 4 | **Retire** the old commission-bill flow. The batch view keeps an *expected* CNF charge from the rate config, used only as a sanity check. |
| 5 | A CNF invoice covers whole shipments by default; the amount per shipment is editable; any remainder stays open for a later invoice. |
| 6 | **Approach 1**: the CNF ledger and shipment balances are *computed on read* from existing data. No stored advance rows. |
| 7 | A shipment can be invoiced only when its **batch is Delivered** and its **vendor invoice is fully paid**. |
| 8 | KREIZ is CNF's vendor code. Payments logged under KREIZ are payments to CNF. |
| 9 | Approved CNF invoices are **not** posted into Accounts View / PurchaseInvoices in this piece. |

## Scope

**In scope (this spec, "piece A"):** the merged CNF Agent tab (3 sub-tabs),
the CNF invoice log/approve/reject flow on shipment lines, the computed CNF
ledger, and retiring the superseded flows.

**Separate pieces, own specs:**
- **B — payment reset and relog.** Backup, then consistently clear payments and
  settlements (PaymentLogs, SettlementLedger, VendorLedger payment rows,
  PurchaseInvoices Settled Amount/Balance, Batches paid aggregates) with a dry
  run; user relogs payments and enters past CNF invoices. Must run after A is
  live. **Do not clear PaymentLogs by hand** — it would leave every invoice
  still marked paid.
- **C — rename Payment Ledger to a payment-entry tab; make Settlement Ledger an
  entry-only tab** (the ledger view already exists in Accounts View).

**Unchanged:** all vendor payment, settlement, FIFO and wallet logic; Accounts
View; Cross-Vendor Settlement; Settings rate config (Sea %, Air ₹/kg, shipment
partner defaults).

## Calculations (backend, computed on read)

All dates are returned as `yyyy-mm-dd` strings formatted in the script time
zone (Asia/Kolkata), never via `toISOString()` — avoids the one-day-early bug
seen elsewhere (sheet dates are IST midnight = 18:30Z the previous day).

### Shipment value

A shipment is a `Vendor_Shipments` row (`shipment_id`, `batch_id`,
`vendor_code`, `invoice_no`).

- **Vendor invoice fully paid**: recomputed from `SettlementLedger`, the same
  way `computeBatchSettlementStatus` does it on the frontend — sum of
  `|RMB|` over rows for that `invoice_no` that are invoice settlements
  (`TxnType` = 'Invoice Settlement', or no `TxnType` and invoice_no ≠
  'ADVANCE'), compared with the invoice's `RMB` in `PurchaseInvoices`.
  Fully paid when outstanding < ¥0.01. `PurchaseInvoices.Balance` is not
  trusted (documented drift).
- **Paid value (INR)** = Σ `|RMB| × ER2` over those same settlement rows.
- **Eligible** = batch `status` is `Delivered` AND vendor invoice fully paid AND
  vendor currency is not INR. A shipment with no `invoice_no`, or whose
  invoice isn't in PurchaseInvoices yet, is not eligible.
- **Invoiced value** = Σ line amounts for this shipment across CNF invoices
  with status **Pending Approval or Approved** (pending counts so the same
  value can't be claimed twice; Rejected frees it).
- **Remaining** = Paid value − Invoiced value.
- **Status**: Not invoiced (invoiced = 0) / Part invoiced / Fully invoiced
  (remaining < ₹1).

### Expected CNF charge (batch, estimate only)

Reuses the existing formula from the retired Log Entry form, charges part only
(pre-GST, excluding goods), so it compares directly with the invoice's service
charge:
- Sea: batch goods INR (`total_value_rmb` × the persisted RMB-weighted
  `blended_settlement_rate`) × category `ratePct` / 100.
- Air: batch `total_weight_kg` × category `ratePerKg`.
- Category = the batch carrier's shipment-partner default (carrier and
  partner compared case-insensitively, spaces collapsed); if there is no
  matching default and exactly one category exists for the mode, that one is
  used. Otherwise shown as "—" with a hint to set a default in Settings.
  (Live at design time: no partner defaults, one Sea category, no Air
  categories, carriers spelled several ways.)

### CNF ledger (INR)

| Row type | Source | Column |
|---|---|---|
| Payment for vendor | `PaymentLogs` rows whose Payment ID starts `DP-` and whose vendor currency ≠ INR; full `INR Amount` | Paid to CNF (+) |
| Payment to CNF | `PaymentLogs` rows with vendor code `KREIZ`; `INR Amount` | Paid to CNF (+) |
| Tax invoice | `CNF_Goods_Invoices` rows with status Approved; `Total` | Billed by CNF (−) |

- KREIZ is an INR vendor, so its payments never match the first rule even
  when their ID starts `DP-`; no payment is counted twice.
- Sorted by date, then created order. Running balance = Σ paid − Σ billed
  (positive = CNF holds our money; negative = we owe CNF).
- **Open advance** on each paid row: total approved billing applied to paid
  rows oldest-first; each paid row shows its unconsumed remainder.
- Optional `from`/`to` date filter; rows before `from` fold into an
  **Opening balance** row.
- Description: payment rows = `<Payment ID> · for <vendor code> (<vendor
  name>)` / `<Payment ID> · payment to CNF`. Invoice rows =
  `CNF <invoice no> · <batch>/<shipment> ₹<amount> + … · goods ₹X · service
  ₹Y · GST ₹Z`.

## Data model

`CNF_Goods_Invoices` is empty live, so its header row is redefined. On first
use the backend rewrites the header **only if the sheet has no data rows**;
if it has data rows with the old header it refuses with a clear error (never
silently re-maps).

`ID | CNF Invoice No | Invoice Date | File URL | Shipment Lines | Base Amount |
Purchase Value | Service Charge | GST | Total | Status | Override Reason |
Submitted By | Decided By | Decided At | Rejection Reason | Created At`

- `Shipment Lines`: JSON `[{ batchId, shipmentId, vendorCode, invoiceNo, amount }]`.
- `Purchase Value` = Σ line amounts; `Service Charge` = Base − Purchase. Both
  stored at log time (not recomputed on read).
- Status: `Pending Approval` | `Approved` | `Rejected`.

`types.ts`: `CnfGoodsInvoice` reshaped to the above; new `CnfShipmentValue`,
`CnfLedgerRow`. `CnfAdvance` removed.

## Backend actions

| Action | Change |
|---|---|
| `get_cnf_shipment_values` | New. One row per shipment of an RMB vendor, whatever its batch status, with the fields in *Shipment value* plus batch mode, vendor name, an `eligible` flag and a reason when ineligible (e.g. "batch not delivered", "vendor invoice part paid"). The Batches sub-tab and the CNF Invoices sub-tab both read it. |
| `get_cnf_ledger_statement` | New. `{ openingBalance, rows[], closingBalance }` per *CNF ledger*; optional `from`, `to`. |
| `get_cnf_goods_invoices` | Returns the new shape. |
| `log_cnf_goods_invoice` | New shape: `{ cnfInvoiceNo, invoiceDate, fileUrl, lines[{shipmentId, amount}], baseAmount, gst, total, overrideReason }`. Under the script lock re-reads and validates: invoice no present and not already logged (non-rejected); every shipment eligible; each amount > 0 and ≤ that shipment's remaining; Base + GST vs Total within ₹1 or override reason given; Service Charge < 0 needs an override reason. Appends a Pending Approval row. `Submitted By` = proxy-stamped `user_email`. |
| `approve_cnf_goods_invoice` | Status → Approved, `Decided By` = `user_email`, `Decided At`. Idempotent; refuses a Rejected invoice. |
| `reject_cnf_goods_invoice` | Reason required. Status → Rejected, `Decided By` = `user_email`, `Decided At`. No balance writes (values are derived). Refuses an Approved invoice. |
| `get_cnf_advances` | Removed. |
| `fifoLiquidate_` | The `createCnfAdvance_` call is removed. Nothing else changes. |
| Old commission-bill actions (`add_cnf_ledger_entry`, `request_cnf_bill`, CNF invoice-batch create/approve/reject, shipment bill status) | Unrouted from the UI; backend code left in place for this piece so history stays readable. |

All writes clear the relevant read caches, same as other write actions in
`doPost`. Writes go through `callGasAuthed` so `user_email` is the
proxy-stamped identity.

## Frontend

Sidebar: one **CNF Agent** entry (Finance group). `CNF Advances` removed from
`Sidebar.tsx`, `routes.ts`, `types.ts` `ViewType`, and `App.tsx`; the old
`/finance/cnf-advances` URL redirects to the CNF Agent tab. Access rule
unchanged (`shipments` permission).

`components/logistics/CnfAgentAccounting.tsx` becomes a thin shell with a
`useQueryParam` sub-tab switch; each sub-tab is its own file under
`components/logistics/cnf/`:

1. **`CnfBatchesView.tsx` — Batches.** Today's Batch Overview (Sea/Air toggle,
   Batch ID, Status, Value RMB/INR, ER, Weight for Air, Payment Status). The
   CNF Total Payable, Bill Status and Action columns are replaced by
   **Expected CNF charge** and **CNF invoiced** ("₹X of ₹Y" of the batch's
   eligible paid value). Filters: All / Delivered & paid / Not fully invoiced.
2. **`CnfInvoicesView.tsx` — CNF Invoices.** Top: shipment summary from
   `get_cnf_shipment_values` (batch, vendor, paid value, invoiced, remaining,
   status), default filter "Not fully invoiced". **Log CNF Invoice** button.
   Below: logged invoices (invoice no, date, shipments, base, purchase,
   service, GST, total, file link, status, rejection reason) with
   Approve / Reject (reason required) on pending ones.
3. **`LogCnfInvoiceModal.tsx`** (replaces `LogCnfGoodsInvoiceModal.tsx`).
   Only eligible shipments with remaining value; tick → amount pre-filled with
   remaining, editable, capped at remaining. Fields: CNF invoice no, invoice
   date, file (upload + OCR prefill of what it can read), base, GST, total.
   Live split: Purchase, Service charge, GST, Total, plus the batches'
   expected CNF charge for comparison. Override checkbox + reason when
   Base + GST ≠ Total (±₹1) or Service charge < 0. Server errors shown inline.
4. **`CnfLedgerView.tsx` — CNF Ledger.** Statement table (date, type,
   reference, description, paid to CNF, billed by CNF, balance), open advance
   on paid rows, date-range filter with opening balance, CSV export.

Removed: `components/logistics/CnfAdvances.tsx`,
`LogCnfGoodsInvoiceModal.tsx`, the Bill Reconciliation sub-tab and Log Entry /
Request Bill / Generate Bill UI, and the bill-submission part of
`CnfAgentPortal.tsx` (the portal isn't live for the agent yet). Related
`settlementService.ts` wrappers for removed actions are deleted; new wrappers
added for the new actions.

## Error handling

- Every read throws on failure and the screen shows a retry banner (existing
  pattern) — never a silent empty list.
- Log/approve/reject errors from the server are shown inline in the modal or
  row; the list re-reads after every write.
- Server is the source of truth for eligibility and remaining value; the
  modal's caps are convenience only.

## Testing

- **Backend harness** (scratchpad, real GAS code on a fake spreadsheet, same
  pattern as `po_harness.js`): eligibility (delivered × fully paid × RMB
  vendor); partly paid excluded; paid INR from settlement rows × ER2; pending
  invoice blocks double-claim; reject frees value; over-remaining refused;
  duplicate invoice no refused; ledger includes DP for RMB vendors and KREIZ,
  excludes IDP and INR vendors; running balance and oldest-first open advance;
  opening balance with a `from` date; IST dates don't shift; header rewrite
  only on an empty sheet; `fifoLiquidate_` no longer writes CNF_Advances.
- **Frontend**: real browser against a mock backend — three sub-tabs render,
  log → approve → ledger row appears; reject → shipment value returns.
- `npm run lint` at the 2-error baseline; `npm run build` clean.
- **After deploy (read-only)**: ledger paid-to-CNF total equals the sum of
  live DP- payments for RMB vendors plus KREIZ payments; shipment summary
  eligible count matches a hand check of Delivered + fully-paid shipments.

## Rollout

1. Fresh `clasp pull` + diff vs last deployed commit, then deploy backend and
   frontend together (the invoice shape changes on both sides).
2. Piece B (reset + relog) after A is live.
3. Piece C whenever convenient.
