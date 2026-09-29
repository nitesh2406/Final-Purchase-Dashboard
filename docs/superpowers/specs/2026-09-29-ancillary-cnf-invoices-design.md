# Ancillary Invoices Through CNF + Actual-Rate CNF Values — Design

Date: 2026-09-29
Status: Approved section-by-section by user; pending review of this document

Piece 4 of the finance program (piece 1: entry tabs; piece 2: vendor
discounts; piece 3: air shipping partner + Ledgers). Extends the Log Invoice
form (`2026-09-29-finance-entry-tabs-design.md`), the CNF Agent tab
(`2026-09-28-cnf-unified-tab-design.md`) and the shipping partner bills
(`2026-09-29-air-shipping-partner-design.md`).

## Background

- **Ancillary invoices** are bills from China-side service providers that are
  not goods vendors (QC/inspection firms, sample couriers, certification labs).
  We pay them through CNF (KREIZ) in RMB, like goods vendors. CNF then bills
  us the INR it moved plus GST, with no commission.
- Today CNF tax invoices can only list shipments, so an ancillary invoice paid
  through CNF would sit on the CNF ledger forever as an open advance that CNF
  can never bill.
- **The INR value of a payment is taken at the wrong rate today.** A DP-
  payment stores `ER2` (the actual rate, `INR Amount ÷ RMB`) and `Settled ER2`
  (`ER2 ÷ (1 + conversion charge %)`). SettlementLedger stores only the
  adjusted rate, and CNF `paidInr` is built from it.
  - Across the 46 live DP- settlement rows, CNF goods value is ₹2,13,31,193.
    At the actual rate it is ₹2,17,57,838, so ₹4,26,645 (2%) is missing.
  - IDP- wallets carry only an adjusted rate (`ER2 = Settled ER2`), blended
    from the source's adjusted wallet rates and/or the market rate of a
    shortfall. That is 36% of settled RMB (¥8.53L of ¥23.45L).
  - The charge has always been 2%: all 19 DP- payments have
    `ER2 ÷ Settled ER2 = 1.020` (±2-dp rounding).
- Live on 2026-09-29:
  - No ancillary invoices exist. The 31 PurchaseInvoices rows not linked to a
    shipment are 2 opening balances and 29 `XFER-IDP-…` transfer shortfalls.
  - No CNF invoices are logged. One draft is saved (S-26001, goods
    ₹4,35,396.73, paid entirely through IDP-00008 / IDP-00012 from LEO).
  - IDP- funding: 21 fully by shortfall (¥3.87L), 20 fully from source
    wallets (¥2.55L), 8 mixed (¥2.53L). Sources: LEO (47), MY (2). Every
    `XFER-` invoice is fully settled, almost entirely by DP-.
  - SettlementLedger payment IDs are only DP- (46) and IDP- (72). No IDP- ID
    is shared across vendors.
- Replay of the new valuation on a live snapshot (2026-09-29, before deploy):
  - Total CNF goods value rises from ₹1,87,84,039 to ₹1,93,69,678
    (+₹5,85,640, +3.12%). No shipment decreases. The CNF ledger closing
    balance is unchanged.
  - Shipments paid through a shortfall-funded transfer rise by more than 2%
    (up to +7.5%). The old value priced the shortfall at the market rate on
    the transfer day, while LEO later paid it at its actual DP- rate. For
    example, IDP-00037 was priced at 14.12, but DP-00014 paid it at 15.18.

## Decisions (user, 2026-09-29)

| # | Decision |
|---|---|
| 1 | Ancillary invoices come from **separate service providers** (not goods vendors), with their own vendor codes. |
| 2 | CNF bills an ancillary invoice as **paid INR + GST on top**, no commission (paid ₹10,000 → base ₹10,000 + GST). |
| 3 | "INR actually paid" uses the **actual rate** (`ER2`), not the charge-adjusted `Settled ER2`. This applies to **both goods and ancillary** CNF values. |
| 4 | A CNF tax invoice is **all goods or all ancillary**, never mixed. |
| 5 | **CNF GST is 5%** for every invoice CNF raises (goods and ancillary). **Shipping partner GST is 18%.** Both are configurable in Settings. |
| 6 | An ancillary invoice becomes CNF-billable only when **fully paid**. It may be split across several CNF invoices, up to its paid INR. |
| 7 | Approach **1A**: actual rates are derived on read, nothing persisted or backfilled. |
| 8 | Approach **2A**: ancillary CNF invoices live in `CNF_Goods_Invoices` with a new `Kind` column. |
| 9 | Batch `paid_amount_inr` / `blended_settlement_rate` and SettlementLedger forex gain/loss stay on the adjusted rate (out of scope). |

## Data model

### `PurchaseInvoices`: new column `Invoice Type`

- Values `Goods` or `Ancillary`. Blank reads as `Goods`, so all existing rows
  are goods.
- Added with `ensureHeaderColumn_` on the first write only. Reads never create it.

### `CNF_Goods_Invoices`: new 18th column `Kind`

- Values `Goods` or `Ancillary`. Blank reads as `Goods`.
- `CNF_INVOICE_HEADERS_` gains `Kind`. `cnfInvoicesSheet_` accepts a header
  equal to the old 17 columns. On `forWrite` it writes the `Kind` header
  cell. On read it treats the missing column as blank.
- `Shipment Lines` JSON by kind:
  - Goods (unchanged): `[{ batchId, shipmentId, vendorCode, invoiceNo, amount }]`
  - Ancillary: `[{ invoiceNo, vendorCode, amount }]`
- `Purchase Value` = Σ line amounts for both kinds.

### Script properties

- `IGST_PERCENT`: unchanged key, relabelled **CNF GST %** in the UI (default 5).
- `SP_GST_PERCENT`: new, **Shipping partner GST %** (default 18).

## Backend

### Actual rate: `cnfActualRates_()` in `gas_clone/cnf_unified.js`

Reads PaymentLogs, SettlementLedger and PurchaseInvoices once each. It returns
`rate(paymentId, vendorCode)`, the actual INR per RMB for money that payment
settled:

- **DP-**: the payment's own `ER2`.
- **IDP-** for vendor V, funded by source S, amount R:
  - Shortfall invoice `XFER-<id>-<V>` (if present), shortfall amount Rs = its RMB:
    - Settled part: Σ over SettlementLedger rows of that invoice of
      |RMB| × `rate(row payment, S)`, computed recursively.
    - Unsettled part (Rs − settled RMB): valued at the XFER invoice's ER1.
  - Wallet-drawn part, Rw = R − Rs:
    - Adjusted INR = IDP `INR Amount` − Rs × XFER ER1.
    - Actual INR = adjusted INR × factor(S, IDP date).
    - factor(S, d) = Σ `INR Amount` ÷ Σ (RMB × `Settled ER2`) over S's DP-
      payments dated ≤ d.
    - With no such payment: 1 + current conversion charge %.
  - rate = (shortfall INR + wallet INR) ÷ R.
- **DSC-**: not cash; excluded from `paidInr` as today.
- **Anything else, or when recursion reaches depth 5 or a repeated ID**: the
  SettlementLedger row's own stored `ER2`.

`cnfSettledByInvoice_` changes `paidInr += rmb × er2` to
`paidInr += rmb × rate(paymentId, row vendor)`, falling back to the row's `ER2`.
`settledRmb` is unchanged. Everything built on it moves to the actual rate
automatically: shipment eligibility, the amount left to invoice, draft goods
value, and the caps checked when logging a CNF invoice. `getCnfLedgerStatement_`'s
paid side already uses `INR Amount` and does not change.

### Ancillary invoices in the vendor books

`addPurchaseInvoice` accepts `invoiceType` (`Goods` default | `Ancillary`) and
writes it to `Invoice Type`. Ancillary is refused when:
- the vendor's currency is INR: *"Ancillary invoices are paid through CNF;
  <vendor> is an INR vendor"*;
- notes are empty: *"Say what the service was in Notes"*;
- a `Vendor_Shipments` row has this `invoice_no`: *"<inv> is linked to
  shipment <id>; it can't be ancillary"*.

When an update to an existing invoice has no `invoiceType` (old frontend, or
a retry), the stored type is left as it is, never reset to Goods. Updating an
existing invoice's type (Goods ↔ Ancillary) is refused while any
Pending Approval or Approved CNF invoice lists it, as a shipment line's
invoice or as an ancillary line.

### Ancillary CNF values: `getCnfAncillaryValues_(invoices)`

One row per `Ancillary` PurchaseInvoice:

`{ invoiceNo, vendorCode, vendorName, date, notes, invoiceRmb, paidInr, fullyPaid, invoicedInr, remainingInr, invoiceStatus, eligible, ineligibleReason }`

- `paidInr` comes from `cnfSettledByInvoice_` (actual rate).
- `fullyPaid` means `invoiceRmb − settledRmb < 0.01`.
- `invoicedInr` = Σ amounts on Pending Approval or Approved Ancillary CNF
  invoices (`cnfInvoicedByVendorInvoice_`). Rejected invoices free their amount.
- `remainingInr` = `max(0, paidInr − invoicedInr)` when eligible, else 0.
- `invoiceStatus`: Not / Part / Fully invoiced (same thresholds as shipments).
- `ineligibleReason`: `Vendor invoice not fully paid`.

Route: `get_cnf_ancillary_values` → `{ ancillary: [...] }` (a read, no key).

### Goods side guard

`cnfInvoicedByShipment_` counts only `Goods` invoices. `getCnfShipmentValues_`
marks a shipment ineligible with the reason *"Vendor invoice <inv> is marked
Ancillary"* when its vendor invoice is Ancillary. This check comes after the
not-delivered and partner checks, and before the payment checks.

### Logging a CNF invoice: `logCnfGoodsInvoice_` with `kind`

The action name (`log_cnf_goods_invoice`) and proxy-key gate stay the same.
The payload gains `kind` (`Goods` default | `Ancillary`). For Ancillary, lines
are `[{ invoiceNo, amount }]`.

Shared by both kinds:
- The duplicate CNF invoice number check (non-rejected, either kind).
- Base > 0, GST ≥ 0, Total > 0, and the file is required.
- Each of these needs an override reason:
  - Base + GST differs from Total by ₹1 or more.
  - Negative service charge (≤ −₹1 for ancillary; < 0 for goods as today).
  - **New: |GST − Base × CNF GST %| ≥ ₹1**, *"GST should be <pct>% of the
    base (₹x); billed ₹y"*.

Goods only:
- Existing shipment eligibility and caps.
- The partner-shipped no-charge rule.

Ancillary only:
- Every line is an eligible ancillary invoice and within its `remainingInr`
  (+₹0.01).
- No duplicate lines.
- Service charge = Base − Σ lines. **Service charge ≥ ₹1 needs an override
  reason**: *"CNF charges no commission on ancillary invoices (billed ₹x)"*.
- Lines are stored as `{ invoiceNo, vendorCode, amount }`, and `Kind =
  Ancillary`.

Approve and reject are unchanged: they flip status, and the amount left to
invoice is derived.

### CNF ledger

- Approved ancillary invoices are billed (−) like goods.
- `type` is `Tax invoice (ancillary)`.
- `cnfInvoiceDescription_` for ancillary:
  `CNF <no> · ancillary · <inv> (<vendor>) ₹a + … · GST ₹g`.
- The KREIZ balance on the Ledgers screen comes from this statement, so it is
  unchanged in method.

### Partner GST setting

- `getPartnerGstPercent_()` / `setPartnerGstPercent_()` on `SP_GST_PERCENT`
  (default 18, ≥ 0).
- Routes `get_partner_gst_rate` (read) and `save_partner_gst_rate` (admin
  write; needs the proxy key, unlike the older settings saves, because it
  feeds a money check).
- `logPartnerBill_` gains the matching check: |GST − Fee × partner GST %|
  ≥ ₹1 needs an override reason.

## Frontend

- **Log Invoice (`components/finance/InvoiceEntryForm.tsx`)**
  - **Invoice type** select at the top: Goods (default) or Ancillary.
  - With Ancillary chosen:
    - The vendor list shows only non-INR vendors (and New vendor).
    - Notes are required, labelled *"What was the service?"*.
    - The info line reads *"Paid through CNF. CNF bills the INR paid + CNF
      GST, no commission."*.
  - `invoiceType` flows through `submitPurchaseInvoice` → sync queue →
    `add_purchase_invoice`.
  - The `PurchaseInvoice` type gains `invoiceType?: 'Goods' | 'Ancillary'`,
    mapped from `Invoice Type`.
- **Accounts View**: an **Ancillary** badge on ancillary invoice rows, styled
  like the Discount badge.
- **CNF Agent → CNF Invoices (`CnfInvoicesView.tsx`)**
  - Two buttons, **Log goods invoice** and **Log ancillary invoice**, each
    enabled when something of that kind is open.
  - A new **Open ancillary** table: invoice, vendor, date, service note, paid
    INR, invoiced, remaining, status, and the ineligible reason.
  - The logged-invoices table gains a **Kind** column.
- **Log CNF Invoice modal (`LogCnfInvoiceModal.tsx`)**
  - Takes `kind`. Ancillary mode:
    - lists eligible ancillary invoices, with amounts pre-filled from
      `remainingInr`;
    - shows the expected amount (Σ lines, + CNF GST %, = total);
    - hides the expected-CNF-charge line.
  - It loads the CNF GST % with the other rates.
- **`invoiceSplit.ts`**
  - `computeInvoiceSplit` takes `{ kind, gstPct, partnerShippedOnly }` and
    returns a flag per server rule: `totalMismatch`, `negativeService`,
    `ancillaryCharge`, `partnerCharge`, `gstOff`.
  - `needsOverride` is set when any flag is set, so the override field
    appears whenever the server would require a reason.
- **CNF Ledger view**: renders the new type label. No other change.
- **Settings → Charges (`ChargesConfig.tsx`)**
  - IGST % is relabelled **CNF GST %**.
  - New **Shipping partner GST %** field with its own save.
- **Partner bills**
  - `LogPartnerBillModal` fills GST from the setting instead of the
    `PARTNER_GST_PCT` constant.
  - The partner ledger header prints the current rate.
- **`services/cnfService.ts`**: `getCnfAncillaryValues`, `kind` on
  `logCnfGoodsInvoice`, and `kind` on `CnfGoodsInvoice`.
- **`services/shippingPartnerService.ts`**: get/save partner GST.

## Error handling

- All ancillary and CNF rules are re-checked on the server under the script
  lock against fresh data. The modal's flags are a preview only.
- Invoice-type refusals come back through the sync queue's existing failure
  path on Log Invoice.
- A missing `Invoice Type` or `Kind` column never breaks a read: blank means
  Goods.
- The actual-rate helper never throws on odd data. Anything it can't trace
  falls back to the stored settlement `ER2`.

## Testing

A new scratchpad folder, `ancillary/`, loads the real gas files like `cnf_lib`.

- **`t_actual_rate.js`**, one case each:
  - DP-;
  - IDP- funded entirely by shortfall;
  - IDP- drawn entirely from wallets;
  - mixed IDP-;
  - an XFER invoice settled by another IDP- (recursive);
  - an unsettled shortfall valued at ER1;
  - a source with no earlier DP- (charge-% fallback);
  - DSC- excluded;
  - the cycle / depth-5 fallback.
- **`t_ancillary.js`**:
  - invoice-type rules (INR vendor, notes, shipment-linked, type change
    blocked);
  - ancillary values and eligibility;
  - shipments whose invoice is ancillary become ineligible;
  - ancillary CNF logging (each override rule, caps, a pending invoice holding
    its amount, a rejected one freeing it, the kinds kept separate);
  - the GST check on both kinds;
  - the partner bill GST check;
  - ledger rows and the KREIZ party balance;
  - the 17-column header upgrading.
- **`fe_split.mts`**: every `computeInvoiceSplit` flag for both kinds.
- **Browser e2e (mock server)**:
  - Log Invoice Ancillary: vendor filter, required notes, payload;
  - CNF Invoices: both buttons, the ancillary table and modal, an override
    appearing;
  - Settings: partner GST save;
  - partner bill GST fills from the setting.
- **Live-data replay**:
  - Export PaymentLogs, SettlementLedger and PurchaseInvoices through the
    read endpoints.
  - Run the helper offline.
  - Produce a per-shipment table of old vs new `paidInr`, plus the new S-26001
    goods value.
  - The user reviews it before deploy.
- **Existing suites stay green**:
  - `cnf/run_all.js`, `fe_test`, `fe_draft`, `fe_review`, `e2e_draft`;
  - `partners/run_sp.js`, `fe_partner`, `e2e_partner`;
  - `pr/run_pr.js`;
  - `dsc/t_dsc*.js`;
  - `entry/fe_routes.mts`;
  - `tsc` at its 2 known errors.

## Rollout

Each step needs the user's go-ahead.

1. **Backend**
   - Fresh `clasp clone`.
   - Drift-check against 259b650 (@438).
   - Copy the changed files, then `clasp push --force` and `clasp deploy`
     to the existing deployment ID.
   - Old frontend requests still work: no `kind` or `invoiceType` means Goods.
2. **Read checks**
   - `get_cnf_shipment_values` matches the replay table.
   - `get_cnf_ancillary_values` is empty.
   - The `get_cnf_ledger_statement` closing balance is unchanged.
   - KREIZ in `get_party_ledgers` equals that closing balance.
   - `get_partner_gst_rate` = 18.
   - An unkeyed `save_partner_gst_rate` is refused.
3. **Frontend**: `vercel --prod --yes`, then confirm the bundle hash. No
   `.env` files except `.env.example`.
4. **User, hands-on**
   - Adjust the GST settings if needed.
   - Log a real ancillary invoice and pay it.
   - Log and approve a CNF ancillary invoice.
   - Regenerate the S-26001 draft.
   - Then a read-only verification.

## Out of scope

- Batch `paid_amount_inr` / `blended_settlement_rate` and SettlementLedger
  forex gain/loss (still on the adjusted rate).
- Draft invoices for ancillary.
- Ancillary invoices from INR vendors.
- Ancillary invoices billed by shipping partners (partners bill only their
  per-batch fee).
