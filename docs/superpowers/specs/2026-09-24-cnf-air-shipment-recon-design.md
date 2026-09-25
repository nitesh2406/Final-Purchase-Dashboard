# CNF Agent — Air/Sea Split, Weight-Based Air Charges, Shipment-Level Reconciliation — Design

Date: 2026-09-24
Status: Draft — pending user approval before implementation

## Background

`CnfAgentAccounting.tsx` (post the 2026-09-24 tab-rework, commit `21a2291`) has
two tabs: **Batch Overview** (every batch, joined to its CNF ledger entry) and
**Bill Reconciliation** (funnel + Generate Bill + approval queue). Air-mode
batches were opened up for logging in that round, but using the exact same
%-of-goods-value charge formula as Sea. In practice:

- Air CNF charges are actually billed by weight, not as a % of goods value,
  and the agent handling an air shipment (the "Shipment Partner") varies
  per shipment.
- The agent's real paper bill doesn't reliably line up with "one batch" — it
  can cover a subset of a batch's shipments, or bundle shipments from several
  different batches into one invoice. Today's model can only request/bill an
  entry's *entire* batch at once.

This round: splits the Batch Overview table into Sea/Air sub-tabs, gives Air
its own weight-based charge inputs, and reworks bill reconciliation to track
status per shipment (rolled up to batch level for the overview), not just
per batch.

## Scope

**In scope:**
1. Batch Overview → **Sea** / **Air** sub-tabs. Sea keeps today's table,
   form, and % based charge formula completely unchanged.
2. Air tab: adds a **Weight (kg)** column (sum of `actual_weight` — falling
   back to `listed_weight` if not yet confirmed — across the batch's
   `Vendor_Shipments` rows, the same field already captured by Receive
   Shipment's weight-confirmation step).
3. Air Log Entry form: two new fields —
   - **Shipment Partner** — dropdown sourced from `SKU_Config` column R.
   - **Category** — Air's own weight-based rate category (₹/kg), replacing
     Sea's %-of-goods-value category for this mode only.
   Selecting a Partner pre-fills its configured default Category; selecting
   a Category pre-fills its ₹/kg rate; both the rate and the weight are then
   free-text overridable in the form, mirroring today's "Charges %
   (override)" pattern.
4. New Settings section: **Air Rate Categories** (label + ₹/kg, same CRUD
   shape as today's Charges & Taxes categories) and **Shipment Partner
   Defaults** (read-only partner names from the sheet, each assigned a
   default Category).
5. Shipment-level bill reconciliation: "Request Bill" and "Generate Bill"
   can each be scoped to a subset of a batch's shipments, and can bundle
   shipments from different batches into one agent bill. Bill status is
   shown per shipment (Batch Overview's Bill Status column becomes an
   aggregate — "Bill Requested", "Partially Billed", etc. — with a
   shipment-level breakdown available) and per shipment in Bill
   Reconciliation.

**Out of scope (this round):**
- Any change to Sea's charge formula, fields, or table.
- IGST/taxable-amount formula shape for Air — unchanged from Sea (goods
  value + charges + shipping, IGST on top); only how `charges` itself is
  computed differs (weight × rate instead of goods value × %).
- Notifying/emailing the agent about a partial-shipment bill request —
  stays internal-tracking-only, same as the existing Request Bill action.
- Editing `SKU_Config` column R's partner list from within the app — that
  list is maintained directly in the sheet, per your instruction. The app
  only reads it and lets staff assign each name a default Category.

## Data Model Changes

### `types.ts`

```ts
export interface CnfLedgerEntry {
  // ...unchanged fields...
  shipmentPartner?: string;    // Air only
  weightKg?: number;           // Air only — the weight actually billed against
  rateBasis: 'pct' | 'perKg';  // 'pct' for Sea (today's behavior), 'perKg' for Air
  ratePerKg?: number;          // Air only — mirrors chargesPct's role for Sea
}

export interface CnfAirRateCategory {
  id: string;
  label: string;
  ratePerKg: number;
}

export interface CnfShipmentPartnerDefault {
  partner: string;         // must match a name from SKU_Config!R
  defaultCategoryId: string; // FK into CnfAirRateCategory
}

// One row per (batch_id, shipment_id) for every batch that has a
// CnfLedgerEntry — the authoritative source for bill-reconciliation status,
// replacing CnfLedgerEntry.billRequestedAt/billRequestedBy/invoiceBatchId
// as the read path (those three fields stay on the row for audit/history —
// see Migration below — but the UI reads CnfShipmentBillStatus exclusively).
export interface CnfShipmentBillStatus {
  batchId: string;
  shipmentId: string;
  billRequestedAt?: string;
  billRequestedBy?: string;
  invoiceBatchId?: string;
}
```

`CnfEligibleBatch` and `Batch` gain a computed `total_weight_kg: number`
(server-computed, same way `paid_amount_inr`/`blended_settlement_rate`
already attach to the `Batches` sheet row — see below).

`CnfInvoiceBatch.entryIds: string[]` is replaced by:

```ts
export interface CnfInvoiceBatch {
  // ...unchanged fields (id, billNo, billDate, billedAmount, computedTotal,
  // fileUrl, status, overrideReason, submittedBy, approvedBy, rejectionReason)...
  lineItems: { batchId: string; shipmentIds: string[] }[]; // was: entryIds: string[]
}
```

Each `lineItem` references shipments directly (not a `CnfLedgerEntry` id) —
the batch's own `CnfLedgerEntry` supplies the per-shipment-prorated payable
amount (see Computation below).

### New sheets

**`CNF_Air_Rate_Categories`**: `ID | Label | Rate Per Kg` — same shape as
`CNF_Commission_Rates`, separate table so Sea's % categories and Air's ₹/kg
categories can never be cross-selected by mistake.

**`CNF_Shipment_Partner_Defaults`**: `Partner | Default Category ID` —
staff-maintained via the new Settings UI. The *list of valid partner names*
itself is not stored here — it's read live from `SKU_Config!R` each time, so
a name typo'd or removed from the sheet naturally drops out of the dropdown
without a separate cleanup step.

**`CNF_Shipment_Bill_Status`**: `Batch ID | Shipment ID | Bill Requested At |
Bill Requested By | Invoice Batch ID` — one row per shipment under every
logged batch. Populated automatically when a `CnfLedgerEntry` is created
(one row per `vendor_shipment` in that batch), plus a one-time backfill (same
pattern as `backfillBatchSettlementAggregates_`) for batches already logged
before this ships.

### `SKU_Config` sheet

New column **R**: a flat list of Shipment Partner names, header row + data
from row 2 down (same convention as the existing K:L variants block) — you
populate this directly in the sheet.

### `Batches` sheet

New column `total_weight_kg`, written by the same
`syncBatchSettlementAggregate_`-style sync (triggered at the same point
`paid_amount_inr` is — i.e., recomputed when a shipment's weight is
confirmed, not live on every load), summing `actual_weight` (falling back to
`listed_weight`) across that batch's `Vendor_Shipments` rows.

## Computation — Air charges

```
goodsValue   = invoiceRmbTotal × rate           // unchanged from Sea
charges      = weightKg × ratePerKg             // NEW basis for Air
                                                  // (Sea keeps: goodsValue × chargesPct / 100)
taxableAmount = goodsValue + charges + shippingAmount   // unchanged
igst          = taxableAmount × igstPct / 100           // unchanged
total         = taxableAmount + igst                    // unchanged
totalPayable  = total − goodsValue                       // unchanged
```

`weightKg` and `ratePerKg` are pre-filled (from the batch's `total_weight_kg`
and the selected Category's rate respectively) but both stay editable inputs
in the form, exactly like today's Charges % override.

## Reconciliation — shipment-level status

**Lifecycle per shipment** (read from `CNF_Shipment_Bill_Status`):
`Not Requested → Bill Requested → Bill Received → Approved` (same 4 states
as today, minus "Logged" which is now implicitly true — a row only exists
once the parent batch is logged).

**Batch Overview's Bill Status column** becomes a rollup of its shipments:
- All shipments in the same state → show that state directly (today's
  single-badge behavior is unchanged for the common single-shipment-batch
  case).
- Mixed states → **"Partially Billed"** badge with an `n/m` fraction
  (e.g. "2/3 Requested"), expandable to see each shipment's own state.

**Request Bill** (Batch Overview action) opens a small shipment picker when
a batch has more than one shipment (defaulting to "all", one click for the
common case); writes `Bill Requested At/By` onto the selected shipments'
`CNF_Shipment_Bill_Status` rows.

**Generate Bill** (Bill Reconciliation) selection moves from "check which
logged batches" to "check which requested *shipments*" — able to span
multiple batches in one submission, same OCR-assist/reconcile-against-
computed-total flow as today, except the computed total is now the sum of
each selected shipment's *prorated* share of its batch's `totalPayable`
(`totalPayable × (that shipment's units ÷ batch's total units)` — simplest
defensible proration given today's data; flag if you want a different basis,
e.g. by RMB value instead of units).

## Backend (Apps Script) Contract

**New actions:**
- `get_shipment_partners` — reads `SKU_Config!R`, same shape as
  `apiGetVariants`.
- `get_cnf_air_rate_categories` / `save_cnf_air_rate_categories` — mirrors
  `get_cnf_commission_rates` / `save_cnf_commission_rates`.
- `get_shipment_partner_defaults` / `save_shipment_partner_defaults`.

**Changed:**
- `add_cnf_ledger_entry` — accepts the four new Air fields; writes the
  corresponding `CNF_Shipment_Bill_Status` rows (one per `vendor_shipment`
  in the batch).
- `request_cnf_bill` — accepts an optional `shipmentIds` array (defaults to
  "all shipments in the batch"); writes to `CNF_Shipment_Bill_Status`
  instead of `CNF_Ledger`.
- `create_cnf_invoice_batch` — accepts `lineItems: [{batchId, shipmentIds}]`
  instead of `entryIds`; writes `Invoice Batch ID` onto the selected
  `CNF_Shipment_Bill_Status` rows; computes the billed total via the
  proration above.
- `get_cnf_eligible_batches` / `get_batches` — attach `total_weight_kg`.
- One-time backfill function `backfillCnfShipmentBillStatus_` — seeds
  `CNF_Shipment_Bill_Status` from every existing `CNF_Ledger` row's current
  `billRequestedAt`/`billRequestedBy`/`Invoice Batch ID` (each existing
  batch's shipments all inherit that one shared state, since nothing has
  been split yet).

## Frontend Structure

- `CnfAgentAccounting.tsx`: Batch Overview gains a second-level tab switch
  (`useQueryParam<'sea'|'air'>('cnfMode', 'sea')`), filtering
  `batchOverviewRows` by `batch.batch_type`. The Log Entry form branches its
  fields/computation on the selected batch's `batch_type`.
- New `components/settings/AirRateCategoriesConfig.tsx` +
  `ShipmentPartnerDefaultsConfig.tsx` (or folded into the existing
  `ChargesConfig.tsx` as two more sections) — CRUD UI for the two new
  Settings tables.
- `services/settlementService.ts` gains the CRUD wrappers for the new
  actions above.

## Migration / Rollout Notes

- Existing `CNF_Ledger` rows' `billRequestedAt`/`billRequestedBy`/`Invoice
  Batch ID` columns are left in place (audit trail) but stop being the read
  path — `backfillCnfShipmentBillStatus_` must run before the new UI ships,
  or every already-logged batch will show "Not Requested" regardless of its
  real history.
- No existing Air batch has ever been logged (Air logging only opened up in
  the prior round) — the new weight/partner/category fields have no legacy
  data to reconcile.
- Needs the standard fresh-`clasp pull`-then-diff workflow, explicit
  confirmation before `clasp push`/`deploy` and `vercel --prod`, and a live
  check against a real Air batch once deployed (weight aggregation,
  partner dropdown, category rate math).

## Suggested Implementation Phases

Given the size, I'd split this into separate confirm-then-ship rounds rather
than one giant change:

1. **Sea/Air tab split** + Weight column + `total_weight_kg` sync (no
   reconciliation changes yet — lowest risk, immediately visible).
2. **Air Log Entry fields**: Shipment Partner + Category (weight-based) +
   Settings CRUD for both new tables.
3. **Shipment-level reconciliation**: the `CNF_Shipment_Bill_Status` sheet,
   backfill, and the Request Bill / Generate Bill / Batch Overview UI
   rework — the largest and highest-stakes piece (touches real billing
   status), best done last and reviewed carefully before deploy.

Let me know if this matches what you had in mind, or if any piece (especially
the proration basis in Generate Bill, or the phase split) should change
before I start on Phase 1.
