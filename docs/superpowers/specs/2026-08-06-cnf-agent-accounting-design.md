# CNF Agent Accounting — Design

Date: 2026-08-06
Status: Approved by user, pending implementation plan

## Background

The user currently tracks their CNF (clearing & forwarding) agent's commission
manually in a Google Sheet ("Purchase Master" workbook). The agent, KREIZ,
handles customs/logistics on shipments and is paid a commission calculated on
the INR value actually disbursed to the goods vendor — not on any forex
gain/loss, since KREIZ is paid entirely in INR.

This design covers building that workflow into the app, for **Sea-mode
shipments only** in this round. Air-mode is a deliberately deferred later
phase.

## Scope

**In scope:**
- A new "CNF Agent Accounting" tab under the Logistics nav group.
- KREIZ as a real `Vendor` record (`type: 'Freight'`, new `currency: 'INR'`
  field), reusing the existing Purchases / Payment Ledger / Vendor Ledger UI
  rather than building a parallel one.
- An entry form that auto-populates from existing Batches / Vendor_Shipments /
  Vendor_Shipment_Lines data and computes the commission math.
- A consolidated-invoice workflow: select multiple ledger entries, upload the
  agent's actual bill, OCR-assist the billed amount, reconcile it against the
  computed total, and post to the Purchases ledger on approval.
- A restricted CNF agent-facing portal reusing the app's existing
  Google-login + `allowedTabs` mechanism (no new auth system).

**Out of scope (this round):**
- Air-mode shipments.
- Any vendor currency other than RMB or INR.

## Data Model

### `Vendor.currency` (extends existing `Vendor` in `types.ts`)

```ts
currency?: 'RMB' | 'INR'; // defaults to 'RMB' for all existing vendors
```

KREIZ is the first (and for now only) vendor with `currency: 'INR'`. No
migration needed — existing vendors are untouched by the optional field.

### `CnfLedgerEntry` (new)

One row per eligible batch/shipment, created via the entry form.

```ts
interface CnfLedgerEntry {
  id: string;
  batchId: string;           // Shipment ID, e.g. "S-24030"
  createdAt: string;         // Batches!I
  qty: number;                // Σ Vendor_Shipment_Lines qty for this batch
  cartons: number;             // Σ Vendor_Shipments cartons for this batch
  invoiceRmbTotal: number;    // Σ RMB across every invoice linked to this batch
  mode: 'sea';                 // 'air' excluded this round
  edd: string;                 // Batches!L
  carrier: string;             // Batches!O
  waybill: string;             // Batches!N
  rate: number;                 // RMB-weighted avg settlement rate (computed)
  category: string;             // links to a CnfCommissionRate.label
  chargesPct: number;           // from category, editable per row
  goodsValue: number;           // invoiceRmbTotal * rate
  charges: number;               // goodsValue * chargesPct
  shippingAmount: number;        // manual input, defaults 0
  taxableAmount: number;         // goodsValue + charges + shippingAmount
  igstPct: number;                // global config at time of entry
  igst: number;                    // taxableAmount * igstPct
  total: number;                    // taxableAmount + igst
  totalPayable: number;              // total - goodsValue
  invoiceBatchId?: string;           // set once bundled into a CnfInvoiceBatch
}
```

### `CnfCommissionRate` (new — Settings > Charges & Taxes)

```ts
interface CnfCommissionRate {
  id: string;
  label: string;   // "Wooden Toys", "Plastic Toys", user-extensible
  ratePct: number;
}
```

### IGST % (new — Settings > Charges & Taxes)

A single global percentage, stored and fetched with the same key-value
pattern as the existing Conversion Charge % (`fetchConversionCharge` /
`saveConversionCharge` in `services/settlementService.ts`). No new sheet
required — same config mechanism, new key.

### `CnfInvoiceBatch` (new — the agent's consolidated bill)

```ts
interface CnfInvoiceBatch {
  id: string;
  entryIds: string[];               // CnfLedgerEntry ids bundled into this bill
  billNo: string;
  billDate: string;
  billedAmount: number;              // OCR-suggested, always user-confirmed
  computedTotal: number;             // Σ totalPayable of entryIds, at submit time
  fileUrl?: string;                   // Google Drive URL of the uploaded invoice
  status: 'Pending Approval' | 'Approved' | 'Rejected';
  overrideReason?: string;            // required if billedAmount !== computedTotal
  submittedBy: string;                 // user or agent email
  approvedBy?: string;
  rejectionReason?: string;
}
```

## Eligibility Rule

A batch is eligible for CNF entry when:

1. `Batch.status === 'Delivered'` (landed at warehouse), **and**
2. Every invoice linked to any of the batch's `vendor_shipments`
   (`BatchVendorShipment.invoiceId`) has `PurchaseInvoice.balance === 0`
   (fully settled/disbursed to the vendor).

A batch can bundle multiple vendor invoices (multiple vendors' goods shipped
together); the batch only becomes eligible once **all** of them are fully
settled, not just some.

Already-logged batches (those with a `CnfLedgerEntry`) drop out of the
eligible pool.

## Calculation Logic

**Rate** is not stored per-invoice today — it must be computed from existing
`SettlementRecord`s. For a given batch, gather every `SettlementRecord` whose
`invoiceId` belongs to that batch's linked invoices, and compute:

```
Rate = Σ(amountRmb × exchangeRateSettlement) / Σ(amountRmb)
```

This uses `exchangeRateSettlement` (the actual RMB payment rate), **not**
the Conversion-Charge-adjusted rate used elsewhere for forex gain/loss. This
is a new helper function in `settlementService.ts` — no existing function
computes this today.

**Derived fields**, recalculated live as the user edits Category/Shipping
Amount:

```
Goods Value    = Invoice (Σ RMB) × Rate
Charges        = Goods Value × Charges %
Taxable Amount = Goods Value + Charges + Shipping Amount
IGST           = Taxable Amount × IGST %
Total          = Taxable Amount + IGST
Total Payable  = Total − Goods Value
```

`Total Payable` is what KREIZ is actually owed (commission + reimbursed
shipping + tax) — `Goods Value` itself was already paid directly to the
goods vendor and is not part of KREIZ's payable.

## Entry Workflow

1. User opens "Log CNF Entry" → a searchable picker of eligible Sea batches
   (per the eligibility rule above).
2. Selecting a batch auto-fills Created At, Shipment ID, Qty, Cartons,
   Invoice, Mode, EDD, Carrier, Waybill, and computes Rate.
3. User selects a Category (dropdown from `CnfCommissionRate` config), which
   auto-fills Charges % (editable for one-off overrides), and enters Shipping
   Amount (default 0).
4. Derived fields recompute live; user reviews and submits.
5. Submission writes one `CnfLedgerEntry` via `add_cnf_ledger_entry`.

## Ledger Tab Layout

The main "CNF Agent Accounting" tab (under Logistics) shows:
- **Logged ledger**: table of submitted `CnfLedgerEntry` rows, matching the
  spreadsheet's columns.
- **Pending queue**: a smaller list/counter of eligible-but-unlogged Sea
  batches, so nothing is missed without having to hunt through Shipment
  Tracker.
- **Approval queue**: `CnfInvoiceBatch` rows in `Pending Approval` status
  (from either the internal flow or the agent portal), for review.

## Consolidated Invoice & Reconciliation

1. From the logged ledger, multi-select entries not yet attached to an
   invoice batch (checkbox column). A running sum of selected `totalPayable`
   is shown live.
2. "Generate Bill": upload the agent's invoice file (PDF/image) → stored via
   the existing Google Drive refresh-token flow (same mechanism the Vendor
   Shipments wizard already uses for document uploads).
3. The uploaded file is sent through Gemini (extending
   `services/geminiService.ts` with a multimodal extraction call) to suggest
   a Billed Amount. This is **always an editable field** — never
   auto-submitted without review.
4. Bill No, Bill Date, and (confirmed) Billed Amount are required.
5. **Reconciliation check**: Billed Amount must equal
   `Σ(totalPayable)` of the selected entries, within a small rounding
   tolerance (e.g. ±₹1).
   - Match → submits immediately as `Pending Approval`.
   - Mismatch → blocked by default. An "Override" checkbox reveals a
     required reason field to force submission anyway.
6. On submit, a `CnfInvoiceBatch` is created and all selected
   `CnfLedgerEntry` rows are tagged with its id (removing them from the
   unbilled pool).
7. This same check must be **re-validated server-side** in
   `create_cnf_invoice_batch` — not trusted from the client alone, since this
   feeds a real financial posting.

## Agent Portal

- KREIZ's contact email is added to the backend user whitelist (the same
  sheet/mechanism the existing `verify_user` login action already checks),
  with a role and `allowedTabs` restricted to a single CNF portal view. No
  new auth system — this reuses `Sidebar.tsx`'s existing `allowedTabs`
  filtering.
- The portal shows the agent's own eligible-but-unbilled shipments (same
  eligibility rule as above) with live Total Payable per row, and a history
  of their own past `CnfInvoiceBatch` submissions and statuses.
- The agent can select shipments, upload their invoice, and go through the
  identical OCR-assisted reconciliation flow described above. Submitting
  creates a `CnfInvoiceBatch` in `Pending Approval` with `submittedBy` set to
  the agent — structurally identical to a staff-submitted one.

## Approval

- Nothing reaches the Purchases ledger without an internal approval step,
  regardless of whether the batch was submitted by staff or by the agent.
- Approving a `Pending Approval` batch posts it as a Purchase entry under
  vendor KREIZ (see below) and marks it `Approved`.
- Rejecting unlinks its entries (clearing their `invoiceBatchId`) so they
  return to the unbilled pool, with a `rejectionReason` visible to the agent
  in their portal.
- `approve_cnf_invoice_batch` needs an idempotency guard (in the same spirit
  as the `transferLegExists_` guard already added this session for the sync
  queue) so a retried/duplicated request cannot double-post or double-approve
  a batch.

## Integration into Existing Ledgers

- **Purchases**: an approved `CnfInvoiceBatch` posts as a normal invoice
  entry under vendor KREIZ, with the INR `billedAmount` populated directly
  into the value field — no ER1/EOD forex conversion step, since KREIZ is
  INR-native.
- **Payment Ledger**: existing entry flow (`components/finance/PaymentLedger.tsx`)
  gets a guard — when the selected vendor's `currency === 'INR'`, the
  exchange-rate input and forex-gain/loss calculation are hidden/skipped,
  and the entered amount posts straight through as INR, with
  `forexGainLoss` forced to `0`.
- **Vendor Ledger / Settlement Ledger / aging**: untouched otherwise — these
  already operate in INR terms; only the RMB↔INR conversion step is
  bypassed for INR-currency vendors.

## Settings Changes

- Rename the existing "Charges" settings tab to **"Charges & Taxes"**.
- Add a commission-rate-by-category table (`CnfCommissionRate[]`) — add/edit/
  remove rows — alongside the existing Conversion Charge % control.
- Add a single global **IGST %** field (currently 5%), using the same
  fetch/save pattern as the existing Conversion Charge % control in
  `components/settings/ChargesConfig.tsx`.

## Backend (Apps Script) Contract

Since Apps Script changes can't be deployed directly, this becomes exact code
handed to the user to paste in during implementation.

**New sheets:**
- `CNF_Ledger` — one row per `CnfLedgerEntry`.
- `CNF_Invoice_Batches` — one row per `CnfInvoiceBatch`.
- `CNF_Commission_Rates` — category/rate% rows.
- IGST % reuses the existing Conversion Charge % key-value config mechanism
  (new key, no new sheet).
- KREIZ's agent login gets one row in whatever sheet backs `verify_user`,
  with a restricted role/`allowedTabs`.

**New actions:**
- `get_cnf_ledger`, `add_cnf_ledger_entry`
- `get_cnf_commission_rates`, `save_cnf_commission_rates`
- `get_igst_rate`, `save_igst_rate`
- `create_cnf_invoice_batch`, `approve_cnf_invoice_batch`,
  `reject_cnf_invoice_batch`

**Idempotency:** `add_cnf_ledger_entry` and `approve_cnf_invoice_batch` need
idempotency keys, matching the pattern already used to fix this session's
sync-queue double-entry bug (`transferLegExists_`).

## Open Items for the Implementation Plan

- Exact Apps Script code for the new sheets/actions (to hand to the user).
- Exact shape of the multimodal Gemini call added to `geminiService.ts`
  (prompt, response parsing, error/fallback behavior when Gemini can't read
  the file).
- UI placement/wiring details for the checkbox multi-select in the ledger
  table (no existing multi-select pattern in `AccountsView.tsx` to follow —
  this is new).
