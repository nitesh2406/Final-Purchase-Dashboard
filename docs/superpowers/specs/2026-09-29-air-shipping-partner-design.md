# Air Shipping Partner + Ledgers Screen — Design

Date: 2026-09-29
Status: Approved section-by-section by user; pending review of this document

Piece 3 of the finance program (piece 1: entry tabs; piece 2: vendor
discounts). Extends the CNF Agent tab (`2026-09-28-cnf-unified-tab-design.md`)
and the CNF draft invoice (`2026-09-29-cnf-draft-invoice-design.md`).

## Background

- Every air batch is shipped by a **shipping partner**: KREIZ (our CNF) or
  another logistics firm. Today the app has no such field. The batch
  `carrier` column is the domestic transporter (Om Logistics, Delhivery, …),
  and the old `SKU_Config!R` partner list and partner-defaults table are empty.
- For tax purposes our real counterparties are the parties that issue us tax
  invoices: KREIZ and the shipping partners. The overseas vendors in the main
  vendor books are not.
- Live on 2026-09-29: 22 air batches (16 Delivered), none with a recorded
  weight; one saved draft (S-26001, sea); no CNF invoices logged.

## Decisions (user, 2026-09-29)

| # | Decision |
|---|---|
| 1 | Air batch with **KREIZ** as partner: KREIZ bills as today: goods + charge (₹/kg × weight) + GST on both. |
| 2 | Air batch with **another partner**: KREIZ bills goods + GST only (no charge). The partner bills its fee + 18% GST. |
| 3 | Partners are paid **directly by Cubelelo**, never through KREIZ. Partner money never touches the CNF ledger. |
| 4 | Partner bills and payments live in **their own sheets**, not the main vendor books (`PurchaseInvoices`/`PaymentLogs`/FIFO are untouched). |
| 5 | New **Ledgers** screen: every tax-invoice party (KREIZ + partners) with its current balance; clicking a row opens its detailed ledger (same format as the CNF Ledger). The CNF Ledger sub-tab also stays in CNF Agent. |
| 6 | One partner bill covers **exactly one air batch**. |
| 7 | Each payment settles **one bill, in part or in full**. No advances. |
| 8 | Expected partner fee = **partner's ₹/kg rate × weight**, + 18% GST; the logged bill is compared with it. |
| 9 | Weight pre-fills from the batch weight and is **editable on the bill** (chargeable weight); it is saved with the bill. |
| 10 | Partner bills go through **Pending Approval → Approved / Rejected**, like CNF invoices. Only approved bills count and can be paid. |
| 11 | An air batch's partner starts **unset**. It is chosen on CNF Agent → Batches. No KREIZ draft, CNF invoice line or partner bill until it is set. |
| 12 | Partners are created and edited from the **Ledgers screen**: name, GSTIN (optional), ₹/kg rate, active. |
| 13 | Payments record **TDS** separately; amount + TDS settles the bill. |
| 14 | Implementation: new module `gas_clone/shipping_partners.js` with its own sheets (approach 1). |

## Data model

Four new sheets, each created with its header row on the first write. Reads
treat a missing sheet as empty.

**`Shipping_Partners`**
`ID | Name | GSTIN | Rate Per Kg | Active | Created By | Created At | Updated By | Updated At`
- ID `SP-001`, `SP-002`, … (next number after the highest existing), never changes.
- Name unique, compared case-insensitively with whitespace collapsed.
  `KREIZ` is reserved.
- GSTIN optional; when given it must match the 15-character GSTIN format
  (stored upper-case).
- Rate Per Kg > 0. Active is TRUE/FALSE.
- KREIZ is **not** a row. The code treats it as a built-in party with ID `KREIZ`.

**`Batch_Shipping_Partner`**
`Batch ID | Partner ID | Set By | Set At`
- One row per air batch whose partner has been set; setting again overwrites
  the row. Partner ID is `KREIZ` or an `SP-` ID.
- A batch is **locked** (partner can't change) while it has a CNF invoice line
  in a Pending Approval / Approved CNF invoice, or a Pending Approval /
  Approved partner bill.

**`Shipping_Partner_Bills`**
`ID | Partner ID | Batch ID | Bill No | Bill Date | File URL | Weight Kg | Rate Per Kg | Expected Fee | Fee | GST | Total | Override Reason | Status | Submitted By | Decided By | Decided At | Rejection Reason | Created At`
- ID `SPB-<ms>-<row count + 1>` (same scheme as `CGI-`).
- Rate Per Kg is copied from the partner when the bill is logged.
  Expected Fee = round2(Weight Kg × Rate Per Kg).
- Fee, GST, Total are the paper bill's figures. The form pre-fills GST as
  round2(Fee × 18 / 100).
- Override Reason is required when |Fee − Expected Fee| ≥ ₹1, or when
  |Fee + GST − Total| ≥ ₹1.
- Status: `Pending Approval` | `Approved` | `Rejected`.
- At most one non-rejected bill per batch. Bill No unique per partner among
  non-rejected bills (case-insensitive).

**`Shipping_Partner_Payments`**
`ID | Partner ID | Bill ID | Date | Amount | TDS | Reference | Notes | Status | Recorded By | Recorded At | Voided By | Voided At | Void Reason`
- ID `SPP-<ms>-<row count + 1>`.
- Only against an Approved bill. Amount > 0, TDS ≥ 0,
  Amount + TDS ≤ bill balance + ₹0.01.
- Status `Active` | `Voided`. Payments are voided with a reason, never deleted.

**Derived on read, never stored:** bill settled = Σ (Amount + TDS) of its
active payments; bill balance = Total − settled; party balances and ledgers.

`CNF_Draft_Invoices` gains a last column **`Shipping Partner`** (partner ID for
air drafts, blank for sea). Existing rows read it as blank.

## Backend

### New file `gas_clone/shipping_partners.js`, routed in `doPost`

| Action | Kind | Behaviour |
|---|---|---|
| `get_shipping_partners` | read | `{ partners: [{ id, name, gstin, ratePerKg, active, … }] }`, inactive included. |
| `get_batch_shipping_partners` | read | `{ assignments: [{ batchId, partnerId, partnerName, locked, lockReason }] }`. |
| `get_partner_bills` | read | `{ bills: [...] }` with derived `settled`, `balance`. Optional `partnerId`. |
| `get_partner_payments` | read | `{ payments: [...] }`, voided included. Optional `partnerId`. |
| `get_party_ledgers` | read | `{ parties: [...] }`: KREIZ first (balance = `getCnfLedgerStatement_({}).closingBalance`, billed/paid from its totals), then partners by name with billed (approved totals), paid, TDS, balance = paid + TDS − billed, `pendingBills`, `unpaidBills`, `active`. A party whose figures fail to compute carries `error` instead of numbers; the others still return. |
| `get_partner_ledger_statement` | read | `{ partnerId, from?, to? }` → `{ openingBalance, rows, closingBalance, totals: { paid, tds, billed } }`. Rows: approved bills (billed, dated by Bill Date) and active payments (paid + TDS, dated by payment Date), sorted by date then bills before payments on the same day then reference. Running balance = paid + TDS − billed. Rows before `from` fold into the opening balance; rows after `to` are left out. |
| `save_shipping_partner` | write | No `id` = create; `id` = edit name / GSTIN / rate / active. Validation as in the data model. |
| `set_batch_shipping_partner` | write | `{ batchId, partnerId }`. Batch must exist and be air. Partner must be `KREIZ` or an active partner. Refused while locked, naming the invoice or bill. |
| `log_partner_bill` | write | `{ partnerId, batchId, billNo, billDate, fileUrl, weightKg, fee, gst, total, overrideReason }`. The batch's assigned partner must be this partner (never KREIZ). Bill date yyyy-mm-dd, file required, weight > 0, fee > 0, GST ≥ 0, total > 0, override rules and duplicate checks as above. |
| `approve_partner_bill` | write | Pending → Approved; already approved returns success; rejected is refused. |
| `reject_partner_bill` | write | Reason required. Refused when approved bill has active payments ("void its payments first"). Pending or approved-without-payments → Rejected. |
| `log_partner_payment` | write | `{ billId, date, amount, tds, reference, notes }`, rules as above. |
| `void_partner_payment` | write | `{ paymentId, reason }`. Active → Voided. |

All writes: `user_email` required (stamped by the proxy; refused without it),
**proxy key required** (added to `PROXY_KEY_ALWAYS_`), run under the script
lock with a fresh re-read, and recompute every figure server-side. Reads are
added to the frontend's cacheable list; writes clear the read cache.

### Changes to `gas_clone/cnf_unified.js`

- **`getCnfShipmentValues_`**: each shipment gains `shippingPartnerId`
  (air only, `''` when unset). An air shipment whose batch has no partner is
  ineligible with reason `Set the batch's shipping partner first` (checked
  after "Batch not delivered"). Sea unchanged.
- **`saveCnfDraftInvoice_`**:
  - Air + KREIZ: unchanged (category, rate, weight required).
  - Air + other partner: category, rate and weight ignored and not required.
    Charge = 0, GST = round2(goods × IGST % / 100), total = goods + GST.
    Stored with blank Category ID/Label, Rate 0, blank weight.
  - The row's `Shipping Partner` column records the partner ID.
- **`logCnfGoodsInvoice_`**: when every line belongs to an air batch whose
  partner is not KREIZ, a service charge ≥ ₹1 requires an override reason.

## Frontend

**Navigation:** new `ViewType` `'Ledgers'`, route `/finance/ledgers`, sidebar
item in the Finance group after CNF Agent. It uses the normal tab-permission
check (admins see it; others need it in `allowedTabs`).

**`components/finance/ledgers/`**
- `Ledgers.tsx`: shell. `?party=<id>` selects a party; no param shows the list.
- `PartyLedgersList.tsx`: table (KREIZ first): Party · GSTIN · ₹/kg ·
  Billed · Paid + TDS · Balance · Pending approval · Unpaid bills · Active.
  Negative balance = we owe the party. "Add shipping partner" button; edit
  icon per partner row.
- `ShippingPartnerModal.tsx`: create/edit name, GSTIN, rate, active.
- KREIZ detail: the existing `CnfLedgerView`, unchanged.
- `PartnerLedgerView.tsx`: date range, opening/closing balance, statement
  with a TDS column; below it a Bills table (bill no · batch · date · weight ·
  expected fee · fee · GST · total · status · settled · balance · file) with
  Approve / Reject (pending), Record payment (approved, balance > 0), each
  bill's payments listed with Void; "Log bill" button.
- `LogPartnerBillModal.tsx`: batch picker (this partner's air batches with no
  live bill), weight pre-filled from `total_weight_kg` and editable, rate
  read-only, preview of expected fee / fee / GST (18%, editable) / total,
  file upload (same uploader as the CNF invoice modal), override reason shown
  only when needed.
- `RecordPartnerPaymentModal.tsx`: date, amount, TDS, reference, notes;
  shows the bill's balance and its latest payments; live check
  amount + TDS ≤ balance.
- `partnerBill.ts`: pure helpers shared by the modals: `computePartnerBill`
  (expected fee, default GST, override needed) and `paymentFits`.

**CNF Agent → Batches (air rows)**
- New **Shipping partner** column: dropdown (— Not set —, KREIZ, active
  partners) when unlocked; name + lock icon with the lock reason when locked.
- Expected CNF charge: "Set shipping partner" when unset; "₹0 (partner-shipped)"
  for a non-KREIZ partner; unchanged for KREIZ.
- Generate Draft Invoice for a non-KREIZ partner: no category/rate/weight
  fields; shows goods, GST at IGST %, total.
- Draft staleness gains "shipping partner changed, regenerate".
- Under CNF invoiced: "Partner bill: ₹X · Approved / Pending" or "not billed".

**Services / types:** `services/shippingPartnerService.ts`; `types.ts` gains
`ShippingPartner`, `BatchShippingPartner`, `PartnerBill`, `PartnerPayment`,
`PartyLedgerSummary`, `PartnerLedgerStatement`; `CnfShipmentValue.shippingPartnerId`;
`CnfDraftInvoice.shippingPartnerId`.

## Error handling

- Server refusals appear inside the open modal; it stays open.
- A failed load shows the existing retry banner, never an empty table or ₹0.
- A party whose figures fail shows "couldn't load, retry" in its row; others show.
- The server is the source of truth; modal figures are previews.
- Partner change after a KREIZ draft → draft shown as out of date.
- Deactivating a partner with unpaid bills is allowed; it only leaves the
  batch dropdown. Assigned batches keep it.
- Rate edits affect only bills logged afterwards.
- Money rounded to 2 dp at each step. Balance checks allow ₹0.01; fee-vs-expected
  and fee + GST vs total allow ₹1.
- A write that returns Google's "server took too long" page: the modal says it
  may have saved and to refresh before retrying. Bill duplicates are caught by
  bill-number checks; the payment modal lists the bill's latest payments so a
  duplicate payment is visible before resubmitting.

## Testing

- **Backend harness** `scratchpad/partners/` on the CNF harness's in-memory
  sheets: partner create/edit (unique name, KREIZ reserved, GSTIN, rate,
  deactivate); set partner (sea refused, unknown/inactive refused, lock by CNF
  invoice line, lock by bill, released on reject); log bill (wrong partner,
  duplicate per batch, duplicate bill no, both override cases, rate snapshot);
  approve/reject (reject refused with active payments); payments (unapproved
  bill, over-balance, TDS counts, void stops counting); statement (running and
  opening balance, TDS, `get_party_ledgers` totals); CNF hooks (air without
  partner ineligible, non-KREIZ draft = goods + GST, partner change stales
  draft, CNF invoice service-charge override).
- **Regression**: `run_all.js`, `run_pr.js`, DSC suites pass; air fixtures that
  now need a partner are listed explicitly.
- **Frontend**: unit checks for `partnerBill.ts`; browser e2e against a new
  mock server on Vite :5299 (Ledgers list → partner ledger → log bill →
  approve → record payment → void; Batches partner dropdown and lock).
- `npx tsc --noEmit -p .` at exactly its 2 known errors; `npm run build` clean.

## Rollout

Each step with the user's go-ahead:
1. Backend: clasp clone, diff against @437, copy changed files, push, deploy
   to the existing deployment ID.
2. Read checks: `get_shipping_partners`, `get_party_ledgers` (KREIZ balance =
   CNF ledger closing balance), `get_cnf_shipment_values` (air shows "Set the
   batch's shipping partner first").
3. Frontend: `vercel --prod --yes`.
4. User creates the first partner, sets partners on air batches, logs one real bill.

**Side effect:** until partners are set, all 22 air batches (16 delivered)
can't get a KREIZ draft or be picked in Log CNF Invoice. No CNF invoices
exist, so nothing logged is affected. No backfill: sheets are created on the
first write.

## Out of scope

- Partner advances (payments before a bill).
- Bills covering several batches or part of a batch.
- A default TDS % per partner.
- Partner spend in Finance Accounts / Reports.
- Recording batch weights (Receive Shipment already does this).
- Piece 4 (ancillary service invoices through CNF).
