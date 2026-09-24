# CNF Agent Tab Rework — Design

Date: 2026-09-24
Status: Approved by user, pending implementation plan

## Background

The original CNF Agent Accounting design (`2026-08-06-cnf-agent-accounting-design.md`)
shipped in phases through 2026-09-23: `CnfLedgerEntry` (goods value / charges /
IGST / total-payable computation), an "All Shipments" overview table (batch
RMB/INR/ER, joined to any logged ledger entry), a `CnfInvoiceBatch` bill-upload
+ OCR-assist + reconciliation flow, and an internal approval queue. It is
currently one flat page, restricted to Sea-mode batches only (Air was
explicitly deferred).

This round restructures that single page into two tabs and closes three gaps
found while resuming the tab-review pass on this screen:

1. No column shows whether the batch has actually been **paid** to the goods
   vendor (only "Delivered"/"Open" shipment status) — the real gating
   condition for requesting a CNF bill.
2. There's no "we've asked the agent for a bill" state — today a `CnfLedgerEntry`
   goes straight from "Logged" to "Billed" the moment staff uploads the
   agent's actual invoice. Nothing tracks the ask itself.
3. Air-mode batches can't be logged into the CNF ledger at all, even though
   the invoicing formula is identical to Sea — the agent-facilitated air
   freight cost some shipments carry is paid/settled entirely outside this
   ledger and never enters the taxable-value computation.

## Scope

**In scope:**
- Split `CnfAgentAccounting.tsx` into two tabs: **Batch Overview** and **Bill
  Reconciliation**, using the same `useQueryParam` tab pattern already used by
  `AccountsView.tsx`.
- A batch-level **Payment Status** (Unpaid / Partial / Paid / Not Invoiced),
  computed client-side via the existing `computeBatchSettlementStatus()`
  (already shared with Shipment Tracker — no new status logic).
- A new **Bill Requested** state, sitting between "Logged" and "Bill
  Received" in the CNF lifecycle, with a **Request Bill** action.
- A **funnel view** on the reconciliation tab: Eligible → Bill Generated →
  Bill Received, each with batch count and ₹ Total Payable, plus a combined
  "Total Pending" summary.
- Opening CNF ledger logging to **Air-mode batches**, with no new fields —
  the formula is unchanged from Sea.

**Out of scope (this round):**
- Any change to the goods-value/charges/IGST/total-payable formula itself.
- Any change to the agent portal (`CnfAgentPortal.tsx`) — it already lets the
  agent submit their own bill; "Request Bill" is a staff-side-only action for
  now (the agent isn't notified — see Eligibility & Lifecycle below).
- Emailing/notifying the agent when a bill is requested (confirmed
  internal-only tracking for this round).
- Any new field for the agent-facilitated air-freight cost — the user
  confirmed it's paid/tracked entirely outside this ledger.

## CNF Lifecycle (new)

A batch's CNF status is derived, never stored as a single enum — it's read
off which of these fields are populated:

```
Not Logged → Logged → Bill Requested → Bill Received → Approved
             (CnfLedgerEntry   (billRequestedAt   (invoiceBatchId   (CnfInvoiceBatch
              exists)           set)               set)              .status === 'Approved')
```

- **Not Logged**: no `CnfLedgerEntry` for this `batchId` yet.
- **Logged**: entry exists, `billRequestedAt` unset.
- **Bill Requested**: `billRequestedAt` set, `invoiceBatchId` unset.
- **Bill Received**: `invoiceBatchId` set (a `CnfInvoiceBatch` was created —
  status `Pending Approval` or `Approved`).
- **Approved**: that `CnfInvoiceBatch`'s status is `Approved`.

Rejecting a `CnfInvoiceBatch` already clears `invoiceBatchId` on its entries
(existing behavior) — a rejected entry falls back to "Bill Requested"
automatically, no new logic needed.

## Data Model Changes

### `types.ts`

```ts
export interface CnfLedgerEntry {
  // ...unchanged fields...
  mode: 'sea' | 'air';              // was: 'sea'
  billRequestedAt?: string;          // new
  billRequestedBy?: string;          // new
}

export interface CnfEligibleBatch {
  // ...unchanged fields...
  batch_type: 'sea' | 'air';        // was: 'sea'
}
```

No other type changes. `Batch.vendor_shipments[].invoiceId` and the existing
`purchaseInvoices` / `settlementRecords` already fetched by `loadAll()` are
sufficient to compute Payment Status client-side — no new fetch.

### `CNF_Ledger` sheet

Two new trailing columns appended after `Invoice Batch ID`:

```
... | Invoice Batch ID | Bill Requested At | Bill Requested By
```

Existing rows read as unset for both — no migration needed. Both read/write
functions' header-mismatch error strings (`getCnfLedgerEntries_`,
`addCnfLedgerEntry_`) get the two new column names appended.

## Tab 1 — Batch Overview

Today's "All Shipments" table, with two columns added and a new Action column:

| Batch ID | Status | Value (RMB) | Value (INR) | ER | **Payment Status** | CNF Category | Total Payable | **Bill Status** | **Action** |
|---|---|---|---|---|---|---|---|---|---|

- **Payment Status**: `computeBatchSettlementStatus(batch.vendor_shipments.map(vs => vs.invoiceId), purchaseInvoices, settlementRecords).status` — Paid (bg-emerald) / Partial (bg-amber) / Unpaid (bg-slate) / Not Invoiced (bg-slate, muted).
- **Bill Status**: one of the 5 lifecycle states above, as a badge.
- **Action**, one of:
  - Not Logged + `status === 'Delivered'` + Payment Status `Paid` → **Log Entry** button, opens the existing entry form pre-selected to that batch.
  - Logged, `billRequestedAt` unset → **Request Bill** button, calls new `request_cnf_bill` action.
  - Anything else → no action shown (managed from Tab 2).

The existing "Log CNF Entry" button + form (pending-to-log dropdown, category/
charges/shipping inputs, live-computed derived fields) stays on this tab
unchanged, except the dropdown now includes Air batches and the submitted
`mode` is `selectedBatch.batch_type` instead of the hardcoded `'sea'`.

## Tab 2 — Bill Reconciliation

**Funnel cards** (count + ₹ Total Payable each):
- **Eligible** — logged, `billRequestedAt` unset. (Same underlying state as
  Tab 1's "Logged" badge — "Eligible" here means "ready to request a bill
  for", i.e. the funnel's name for that state, not a different condition.)
- **Bill Generated** — `billRequestedAt` set, `invoiceBatchId` unset.
- **Bill Received** — `invoiceBatchId` set.

**Total Pending** — Eligible + Bill Generated combined (count and ₹), shown
as a standalone summary above or beside the three cards.

Below the cards, unchanged from today except scoped to "Bill Generated"
entries only (since a bill can no longer be generated before it's requested):
- **Generate Bill** flow (checkbox-select → upload agent invoice → Gemini
  OCR-assist → reconcile against computed total → submit).
- **Pending Approval** queue (approve/reject).

The entry-logging form, the "pending to log" dropdown, and the flat logged-
entries table move entirely to Tab 1 — Tab 2 is exclusively about the bill's
lifecycle once an entry already exists.

## Backend (Apps Script) Contract

**New action:** `request_cnf_bill`
- Payload: `{ entry: { id, requested_by } }`
- Finds the `CNF_Ledger` row by `id`. If `Bill Requested At` is already set,
  returns success with the existing timestamp/by (idempotent — no
  double-stamp on a retried click). Otherwise sets `Bill Requested At` =
  now, `Bill Requested By` = `requested_by`.
- Registered in `entry_points.js` as `case 'request_cnf_bill'`.

**Changed:** `getCnfEligibleBatches()` (`PO+Shipment Codes.js`)
- Remove the `looksLikeSea` filter (the `batchTypeRaw.indexOf('sea') !== -1 ||
  batchId.indexOf('S-') === 0` check and its `continue`).
- Replace the hardcoded `batch_type: 'sea'` in the pushed result with the
  actual `batchTypeRaw` value (normalized to `'sea' | 'air'`, defaulting to
  `'sea'` if unrecognized, matching the existing default elsewhere in this
  file).

**Changed:** `getCnfLedgerEntries_` / `addCnfLedgerEntry_` (`accounting_logger.js`)
- Read/write the two new trailing columns (`billRequestedAt`, `billRequestedBy`).
- `addCnfLedgerEntry_`'s `appendRow` call gets two more trailing empty-string
  args for the new columns.

## Frontend Structure

- `CnfAgentAccounting.tsx` gains `const [activeTab, setActiveTab] = useQueryParam<'overview' | 'reconciliation'>('cnfTab', 'overview')`, matching `AccountsView.tsx`'s existing tab-switcher pattern (button row + conditional panel render) — no new UI primitive introduced.
- `services/settlementService.ts` gains `requestCnfBill(entryId: string, requestedBy: string): Promise<void>`, calling the new action the same way `approveCnfInvoiceBatch`/`rejectCnfInvoiceBatch` already do.
- All existing exported helpers (`computeBatchSettlementStatus`, `computeCnfBatchRate`, `isBatchFullySettled`) are reused as-is — no changes to their signatures or logic.

## Testing Notes

- This is an Apps Script (`gas_clone`) + frontend change together — needs the
  standard fresh-`clasp pull`-then-diff workflow before pushing, and explicit
  confirmation before `clasp push`/`deploy` and `vercel --prod`, per this
  project's standing rules.
- No existing CNF ledger entries carry `billRequestedAt`/`billRequestedBy` —
  every already-logged entry will show as "Eligible" (not yet requested) on
  first load after this ships, which is correct (nothing has actually been
  requested from the agent for them yet).
- Air-mode eligibility needs a live check against a real Delivered+Paid Air
  batch once deployed, since no Air batch has gone through
  `getCnfEligibleBatches()` before.
