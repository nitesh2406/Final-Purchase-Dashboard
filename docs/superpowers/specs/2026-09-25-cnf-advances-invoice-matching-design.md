# CNF Advances & Goods Invoice Matching — Design

Date: 2026-09-25
Status: Draft — pending user approval before implementation

## Background

The CNF Agent Accounting work shipped over the last few days (Sea/Air split,
weight-based Air charges, shipment-level bill reconciliation — see
`docs/superpowers/specs/2026-09-24-cnf-air-shipment-recon-design.md`) was
built on an incomplete understanding of how CNF actually functions. A
hand-drawn diagram and follow-up conversation corrected the model:

- **CNF is a pure payment rail, not a balance-holder.** The business ("ME")
  never pays an overseas/RMB vendor directly. ME pays CNF, and instructs CNF
  which vendor to disburse to (including vendor-to-vendor reallocation). CNF
  holds no ledger of what's owed to which vendor — that tracking is entirely
  ours, and already works today (`PurchaseInvoices` / `PaymentLogs` /
  `VendorLedger`, FIFO-settled).
- **When ME pays CNF, that payment is booked as an advance to CNF** — not yet
  matched to a specific tax invoice.
- **CNF later issues a single tax invoice** covering the goods value of
  whichever shipment(s) it has both (a) received in the warehouse (GRN'd) and
  (b) already been paid for (via the advance above) — on CNF's own irregular
  cadence, which may bundle multiple shipments across multiple batches and
  vendors into one invoice, or split one shipment's value across several.
  CNF marks the goods price up to bake in its own service fee (not itemized
  separately) — e.g. goods worth ¥/₹X get invoiced at ₹(X + service fee), plus
  GST on top.
- **Two liabilities exist underneath one settlement document.** We
  conceptually owe (a) the vendor, for stock, and (b) CNF, for its service —
  but the CNF invoice is the single document that reconciles both: its
  goods-value portion nets against the advance already paid (no new cash
  movement), and only the service-charge + GST portion is a genuinely new
  liability, which gets paid to CNF separately.
- **All CNF-side entries (advances, invoices) are INR-denominated** — CNF is
  an Indian entity, GST applies, and ME pays CNF in INR regardless of the
  underlying vendor's RMB shipment value.
- **This only applies to overseas/RMB (import) vendors.** Domestic INR
  vendors are paid directly; no CNF involvement.

Reassuringly, this is not a teardown. Vendor-level payable tracking ("no
issue in that," per the user) stays exactly as it is today. The existing
`totalPayable` formula from the Sea/Air work (`total − goodsValue`, i.e.
charges + shipping + IGST-on-everything) already isolates a
goods-value-excluded residual — conceptually the same shape as what's needed
here. And the existing "CNF-eligible batch" gate (Delivered + Paid) already
encodes the real trigger CNF uses (GRN'd + already paid). What's missing is a
**reconciliation layer**: a real ledger of money advanced to CNF, and a way
to log CNF's actual invoices and match them against it.

## Scope

This spec covers **Sub-project 1** only: the CNF Advances ledger and Goods
Invoice logging/matching. It is scoped deliberately narrow and ships
**purely additively**.

**In scope:**
1. A new `CNF_Advances` ledger — one row per amount that actually settles an
   RMB vendor's payable (direct payment, cross-vendor reallocation, or
   wallet draw), created automatically, INR-denominated, drawn down as
   invoices match against it.
2. A new `CNF_Goods_Invoices` log — one row per CNF tax invoice received,
   covering a set of shipments (possibly spanning batches/vendors), matched
   against one or more advances, with the residual (service + GST) liability
   computed.
3. New screens: **CNF Advances** (the wallet, defaulted to outstanding
   balances), **Log CNF Invoice** (shipment picker + upload + OCR-assisted
   amount extraction + advance matching), **CNF Invoices** (approval queue),
   and a **Shipments Awaiting CNF Invoice** report (Delivered+Paid shipments
   not yet covered by any approved invoice).

**Explicitly out of scope (deferred to Sub-project 2):**
- Touching the existing CNF Agent Accounting screen, `CNF_Ledger`, rate
  categories (Sea %/Air ₹/kg), or the existing Bill Reconciliation /
  `CnfInvoiceBatch` flow in any way. That flow keeps running exactly as
  built. Its eventual role shifts from "the source of the liability" to "a
  verification aid for CNF's charged service rate" — and the Residual
  Liability this spec computes needs to be posted somewhere payable and
  settled — but neither of those rewires happens here.
- Manually logging an advance outside the automatic hook (e.g. correcting a
  missed one). Not needed for v1; can be added later if it comes up.
- Any change to `PurchaseInvoices` / `PaymentLogs` / `VendorLedger` / FIFO
  settlement logic itself. Vendor-level tracking is confirmed correct today
  and stays untouched — this spec only *reads* from and *hooks into* it.

## Data Model

### `types.ts`

```ts
export interface CnfAdvance {
  id: string;
  date: string;
  vendorCode: string;        // the vendor this advance ultimately funded
  linkedPaymentId: string;   // → PaymentLogs Payment ID, for traceability
  amount: number;            // INR
  balance: number;           // INR — drawn down as CNF_Goods_Invoices match against it
}

export interface CnfGoodsInvoice {
  id: string;
  date: string;
  fileUrl?: string;
  lineItems: { batchId: string; shipmentIds: string[] }[]; // shipments this invoice covers
  matchedAdvances: { advanceId: string; amountMatched: number }[]; // INR, many-to-many
  statedBaseAmount: number;  // INR — CNF's stated taxable/base amount. Already
                              // inflated with their service markup, not itemized —
                              // this is CNF's single "goods" line, as given.
  expectedGoodsValue: number; // INR — our own record of what the covered shipments
                              // are really worth (from matchedAdvances / shipment
                              // invoice values), for comparison — NOT sent by CNF.
  serviceCharge: number;     // INR, derived: statedBaseAmount − expectedGoodsValue
  gst: number;               // INR, as stated on CNF's invoice
  total: number;             // INR, as stated — statedBaseAmount + gst
  residualLiability: number; // INR — total − sum(matchedAdvances.amountMatched)
                              // (algebraically = serviceCharge + gst)
  status: 'Pending Approval' | 'Approved' | 'Rejected';
  overrideReason?: string;   // required if residualLiability's implied service
                              // charge doesn't match our own rate-config estimate
  submittedBy: string;
  approvedBy?: string;
  rejectionReason?: string;
}
```

### New sheets

**`CNF_Advances`**: `ID | Date | Vendor Code | Linked Payment ID | Amount | Balance`

**`CNF_Goods_Invoices`**: `ID | Date | File URL | Line Items | Matched Advances |
Stated Base Amount | Expected Goods Value | Service Charge | GST | Total |
Residual Liability | Status | Override Reason | Submitted By | Approved By |
Rejection Reason | Created At`
— `Line Items` and `Matched Advances` stored as JSON, same convention as
`CnfInvoiceBatch.lineItems` from the prior CNF work. `Service Charge` and
`Residual Liability` are computed at log time and stored (not recomputed on
read), same not-recomputed-on-read pattern used elsewhere in this codebase
(e.g. `paid_amount_inr`) — so a later change to matched advances or rate
config never silently reprices an already-logged invoice.

Status (Unmatched / Partially Matched / Fully Matched) is **derived** from
`Balance` vs `Amount`, not stored — avoids drift between a stored label and
the real number.

"Shipments awaiting CNF invoice" is also derived, not stored: every
Delivered+Paid shipment (same eligibility gate `getCnfEligibleBatches`
already uses) whose `shipment_id` doesn't appear in any **Approved**
`CNF_Goods_Invoices.lineItems`.

## Workflow

**1. Advance creation (automatic, invisible to the user)**

Every time money is actually applied to reduce an RMB/import vendor's
payable — a direct payment, a cross-vendor reallocation, or a wallet draw —
a `CNF_Advances` row is created for that vendor + amount. All three cases
already funnel through the same central settlement-application function
(`fifoLiquidate_` in `accounting_logger.js`), which is the intended single
hook point — gated on `getVendorCurrency_(vendorCode) !== 'INR'`, reusing the
existing helper. The exact insertion point will be confirmed during
implementation planning, but no new UI or user action is needed here: this
piggybacks on payment logging exactly as it works today.

`amount` is the INR value of the settled RMB amount (rmb × the settlement
ER2 already computed for that payment) — carried over for traceability, not
independently entered.

**2. Logging a CNF invoice**

New screen, used when a real CNF tax invoice arrives (off-system — email,
paper):
- Pick which shipments it covers (a picker spanning batches — the same
  shape as the shipment-picker deferred from the prior CNF phase).
- Upload the invoice file; OCR-assisted extraction of the Stated Base Amount
  and Total (reusing the extraction already built for the existing
  bill-upload flow).
- The system computes the `expectedGoodsValue` from the selected shipments'
  own invoice values, and suggests which `CNF_Advances` rows to draw down
  (FIFO by vendor, editable) to reach that amount.
- **Residual Liability** = CNF's stated Total − the matched advance amount
  (algebraically the same as Service Charge + GST — see Data Model).
- On submit: the matched advances' `Balance` is reduced immediately
  (reserved), and the invoice enters `Pending Approval` — mirrors the
  existing `createCnfInvoiceBatch_` pattern (reserve at submission time, not
  at approval), so two invoices can't double-claim the same advance balance
  while one is still pending approval.

**3. Approve / Reject**

- **Approve**: status → `Approved`. The covered shipments now count as
  "CNF-invoiced" (derived from `lineItems`, per above). No further
  liability-posting happens here — see Scope.
- **Reject**: the matched advances' balances are restored (undoing the
  reservation from step 2), status → `Rejected`.

**Reconciliation aid**: the existing Sea/Air rate config (untouched this
phase) can compute an *independently expected* service charge for the
selected shipments (rate × goods value, or weight-based for Air), shown
alongside the *derived* `serviceCharge` (statedBaseAmount −
expectedGoodsValue) computed above — flagging when the two disagree beyond
tolerance, same UX pattern as today's bill-upload tolerance check. Requiring
`overrideReason` when they disagree is optional polish; not a hard
requirement for v1.

## Backend (Apps Script) Contract

**New actions:**
- `get_cnf_advances` — reads `CNF_Advances`.
- `get_cnf_goods_invoices` — reads `CNF_Goods_Invoices`.
- `log_cnf_goods_invoice` — validates matched advances have sufficient
  combined balance, reserves (draws down) it, computes `residualLiability`,
  appends a `Pending Approval` row.
- `approve_cnf_goods_invoice` — flips status to `Approved`. No balance
  change (already reserved at log time).
- `reject_cnf_goods_invoice` — restores the matched advances' balances,
  flips status to `Rejected`.

**Changed:**
- `fifoLiquidate_` (or the appropriate settlement-application point,
  confirmed during implementation planning) — gains a side effect: append a
  `CNF_Advances` row when the settled vendor is non-INR.

**Untouched:** everything in the existing CNF Agent Accounting surface
(`CNF_Ledger`, `CNF_Commission_Rates`, `CNF_Air_Rate_Categories`,
`CNF_Shipment_Partner_Defaults`, `CNF_Shipment_Bill_Status`,
`CNF_Invoice_Batches`, and all their actions) — per Scope, this spec doesn't
read or write any of it.

## Frontend Structure

- New `components/logistics/CnfAdvances.tsx` (or a new tab within a
  logistics/finance area — exact placement TBD in implementation planning):
  the Advances wallet view, Log CNF Invoice form, CNF Invoices approval
  queue, and the Shipments Awaiting CNF Invoice report.
- `services/settlementService.ts` gains CRUD wrappers for the new actions
  above.
- `types.ts` gains `CnfAdvance` and `CnfGoodsInvoice` (above).

## Edge Cases

- CNF's stated total doesn't match matched-advances + our expected service
  charge → allow submission anyway with an override reason, same tolerance
  pattern as the existing bill-upload flow.
- One invoice spans multiple vendors/advances, or partially draws one
  advance (remainder matched by a later invoice) → handled by the
  many-to-many `matchedAdvances` + FIFO-style partial balance draw-down.
- An advance that never gets matched → stays visible indefinitely in
  Outstanding Advances (`Balance > 0`); no alerting/aging logic in v1.
- Rejecting an invoice after approval is not supported (matches the existing
  `CnfInvoiceBatch` pattern — approval is final).

## Testing / Rollout Notes

- Standard `npm run lint` (tsc --noEmit, must stay at the existing 2-error
  baseline) and a Vite build check before every commit, same as prior CNF
  phases.
- Given this touches real compliance/financial reconciliation, before
  broader rollout: reconcile one actual CNF invoice against real advances by
  hand, to sanity-check the matching math, before relying on it for the full
  vendor set.
- Standard fresh-`clasp pull`-then-diff workflow, explicit confirmation
  before `clasp push`/`deploy` and `vercel --prod`.
- No backfill/migration needed for this sub-project — it's purely additive
  and starts empty; historical advances/invoices before this ships are not
  retroactively reconstructed (out of scope — the existing `CNF_Ledger`
  history remains the record for anything already logged there).

## Sub-project 2 (separate future spec, not designed here)

Once this foundation is proven:
- Retire the existing CNF Agent Accounting "Log Entry" step as the source of
  the CNF liability — it becomes a verification aid (expected-charge
  estimate) instead.
- Wire `CnfGoodsInvoice.residualLiability`, once approved, into an actual
  payable — most likely posted into `PurchaseInvoices` under CNF's existing
  vendor code (as `approveCnfInvoiceBatch` already does for "KREIZ" today)
  and settled via the existing `PaymentLogs`/FIFO mechanism, as a payment
  specifically for CNF's own fee.
- Decide the fate of `CNF_Shipment_Bill_Status` / `CnfInvoiceBatch` — likely
  superseded by `CNF_Goods_Invoices`, but the migration path (if any
  in-flight data exists at that point) needs its own design pass.
