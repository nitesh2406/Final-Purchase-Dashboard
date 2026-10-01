# Batch Chargeable-Weight Override (partner batches, in the CNF draft modal) — Design

Date: 2026-10-01. Status: decisions taken in chat (persist the weight; show fee + GST).

## Problem

On CNF Agent → Batches, the Generate/Regenerate Draft Invoice modal shows a
Rate (₹/kg) + Weight (kg) pair only for KREIZ batches. For a batch shipped by
another partner it shows just a note ("CNF bills goods + GST only…"). The user
wants the same Rate + Weight fields on partner-shipped batches too, with the
partner's expected fee shown — good for UX — and wants the weight to **persist**
and feed the partner's Ledgers bill.

Constraint discovered: batch `total_weight_kg` is **derived** (Σ of each
shipment's actual/listed weight; 2026-09-30 spec, decisions 1–2). There is no
settable batch weight. Today the only persisted chargeable weight is on the
**partner bill** (`Shipping_Partner_Bills.Weight Kg`), entered when logging the
bill on Ledgers (pre-filled from the batch weight). So to persist a chargeable
weight from the draft modal we add a per-batch override that the partner bill
pre-fills from.

## Decisions

| # | Decision |
|---|---|
| 1 | Scope: **partner-shipped air batches only**. KREIZ unchanged (its weight already persists on the CNF draft and drives the CNF charge). Sea unchanged. |
| 2 | New per-batch **chargeable-weight override**, stored on the existing `Batch_Shipping_Partner` row (new column). Blank = no override. |
| 3 | Effective weight for the partner's expected fee and the partner-bill pre-fill = override when set (> 0), else the derived batch weight. Clearing (0/empty) falls back to the derived weight. |
| 4 | The CNF invoice for a partner batch is **unchanged**: goods + GST, no CNF charge. The chargeable weight never enters CNF's books or KREIZ's ledger. |
| 5 | In the draft modal (partner branch): keep the note; add Rate (₹/kg, pre-filled from the partner's Settings rate) and Weight (kg, pre-filled from `override ?? batchWeight`), both editable; show a **Partner fee estimate** block: fee = round2(rate × weight), GST = round2(fee × partnerGst% ÷ 100), total = fee + GST, labelled "billed by {partner} on the Ledgers screen — not part of this CNF invoice". |
| 6 | Only the **weight** persists (the user's choice). The rate field is what-if only; the partner bill uses the partner's Settings rate, as today. |
| 7 | One **Save draft** on a partner batch saves the CNF draft (as today) and, when the weight differs from the stored override, persists the override. Both are proxy-keyed writes. |
| 8 | Changing a batch's partner keeps the override (a physical weight). A batch switched to KREIZ ignores it (KREIZ uses its CNF-draft weight) but keeps it stored; switched back, it returns. |

## Backend (gas_clone)

- `shipping_partners.js`
  - `SP_ASSIGN_HEADERS_` gains `Chargeable Weight Kg` (5th column). `spSheet_`
    creates it with the header on first write; existing sheets gain the header
    and old rows read blank.
  - `readBatchPartnerAssignments_`: `chargeableWeightKg = Number(r[4]) || null`.
  - `getBatchShippingPartners_` assignment gains `chargeableWeightKg`.
  - `setBatchShippingPartner_`: when overwriting an existing row, **preserve**
    the stored chargeable weight (write it back in col 5); new rows write blank.
  - New `setBatchChargeableWeight_(payload)`: `{ batchId, weightKg, user_email }`.
    Batch must exist, be air, and have a partner set that is **not KREIZ**.
    `weightKg` ≥ 0; 0/empty/null clears. Writes col 5 on the assignment row
    (the row exists because a partner is set). Under the script lock, fresh
    re-read. Returns `{ status, batchId, chargeableWeightKg }`.
- `entry_points.js`: route `set_batch_chargeable_weight` → `setBatchChargeableWeight_`;
  add it to `PROXY_KEY_ALWAYS_` and require `user_email` (same as
  `set_batch_shipping_partner`). `get_batch_shipping_partners` already read-listed.

## Frontend

- `types.ts` / `services/shippingPartnerService.ts`: `BatchShippingPartner`
  gains `chargeableWeightKg: number | null`; new `setBatchChargeableWeight({
  batchId, weightKg })` (authed, clears on 0).
- `components/logistics/cnf/CnfDraftInvoiceModal.tsx`: new props
  `partnerRatePerKg: number | null`, `partnerGstPct: number`,
  `chargeableWeightKg: number | null`. Partner branch renders the Rate + Weight
  fields and the Partner fee estimate block (fee + GST), reusing
  `partnerBill.ts` for the figures. `save()` for a partner batch saves the draft
  and, when weight changed, calls `setBatchChargeableWeight`.
- `components/logistics/cnf/CnfBatchesView.tsx`: pass `partnerRatePerKg`
  (already computed per row), `partnerGstPct` (new: load `fetchPartnerGstRate`),
  and `chargeableWeightKg` (from the assignment) to the modal. Expected-CNF-
  charge note for a partner batch uses the effective weight.
- `components/finance/ledgers/PartnerLedgerView.tsx`: `buildWeights` uses
  `assignment.chargeableWeightKg ?? batch.total_weight_kg` so
  `LogPartnerBillModal` pre-fills the override.

## Tests

- Backend harness (`partners/`): set_batch_chargeable_weight — air+partner
  required, KREIZ refused, unknown batch refused, weight ≥ 0, 0 clears;
  get_batch_shipping_partners returns chargeableWeightKg; setBatchShippingPartner
  preserves the override on partner change; header added on first write, old rows
  blank.
- Frontend unit (`.mts`): effective-weight precedence; partner fee estimate =
  rate × weight (+ GST); partner Save calls both writes only when weight changed;
  LogPartnerBillModal prefill uses the override.
- `npx tsc --noEmit -p .` at its 2 known errors; all suites pass.

## Rollout (each with the user's go-ahead)

1. Backend deploy @443: `shipping_partners.js`, `entry_points.js`.
2. Read checks: `get_batch_shipping_partners` (chargeableWeightKg present),
   a keyless refusal check on `set_batch_chargeable_weight` (needs the key).
3. Frontend `vercel --prod --yes`; confirm the bundle changed.
4. User sets a chargeable weight on a partner batch, logs/updates the bill,
   confirms the prefill.

## Out of scope

- Persisting the rate (stays a Settings/what-if value).
- KREIZ batches (unchanged).
- Any change to CNF's invoice figures for partner batches.
