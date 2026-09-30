# Batch Weight From Shipments + One Air Rate Per Shipping Partner — Design

Date: 2026-09-30. Status: approved by the user in chat (option (a): a partner
other than KREIZ bills its own freight; CNF bills goods + GST only).

## Problem

- A batch's `total_weight_kg` is written to the Batches sheet only when a
  shipment's weight is confirmed at receiving (`syncBatchWeightAggregate_`).
  The backfill skips batches whose sum is 0, and a batch never synced shows a
  dash. Live on 2026-09-30, A-26019 (39 kg) and A-26020 (40 kg) have shipment
  weights but no batch weight.
- Air CNF charges use **Air Rate Categories**, picked per draft, with an
  optional carrier → category default. The user uses the categories as
  per-partner rates (live: "United Express" ₹1,175/kg, "KREIZ" ₹1,000/kg), and
  United Express also exists as shipping partner SP-001 at ₹1,175/kg. The
  user wants one ₹/kg rate per shipping partner, filled in automatically.

## Decisions

| # | Decision |
|---|---|
| 1 | Batch weight = Σ over its shipments of `actual_weight`, else `listed_weight`, else 0. Every batch has a number; no weight shows **0**. |
| 2 | `get_batches` and `get_cnf_eligible_batches` compute the weight on read from Vendor_Shipments (already read there). The stored `total_weight_kg` column follows the same rule, including writing 0; one backfill brings it in line. |
| 3 | Air rate is per shipping partner. KREIZ's rate is a new setting (Script Property `CNF_AIR_RATE_PER_KG`); other partners keep `ratePerKg` on their Shipping_Partners row. No air categories. |
| 4 | Until `CNF_AIR_RATE_PER_KG` is saved, KREIZ's rate reads from the Air category labelled "KREIZ" (live: ₹1,000). No write is needed to seed it. |
| 5 | Settings: one card, **Air rate per shipping partner (₹/kg)**, with KREIZ plus every partner. The Air Rate Categories and Shipment Partner Defaults cards are removed. Their sheets and backend actions stay untouched. |
| 6 | Draft invoice, air batch shipped by KREIZ: no category picker. Rate starts at KREIZ's rate (or the saved draft's own rate), weight at the batch weight; both editable. The server no longer needs a category for air; it stores label "KREIZ". |
| 7 | Air batch shipped by another partner: unchanged. The CNF draft is goods + GST with no charge; the partner bill form already fills the partner's ₹/kg. The Expected CNF charge cell shows ₹0 with the partner's expected fee (weight × partner rate) in its note. |
| 8 | Sea is unchanged, except its expected-charge default no longer looks at carrier defaults (the Settings UI could only point them at air categories). Sea's default category is the single Sea category when exactly one exists. |

## Backend (gas_clone)

- `accounting_logger.js`
  - `batchWeightsFromShipments_(shipValues)`: `{ batchId: kg }` rounded to
    2 dp, per decision 1.
  - `syncBatchWeightAggregate_` / `backfillBatchWeightAggregates_` use it and
    write 0 as well.
  - `getCnfAirRatePerKg_()` / `setCnfAirRatePerKg_(v)` (must be > 0).
- `PO+Shipment Codes.js`: `getBatches` and `getCnfEligibleBatches` take
  `total_weight_kg` from `batchWeightsFromShipments_`, not the stored column.
- `entry_points.js`: `get_cnf_air_rate` (read, bundle-safe) returns
  `{ ratePerKg: number | null }`. `save_cnf_air_rate` needs the proxy key
  (PROXY_KEY_ALWAYS_), like `save_partner_gst_rate`.
- `cnf_unified.js` `saveCnfDraftInvoice_`: an air batch shipped by KREIZ
  needs rate > 0 and weight > 0, with no category check; it stores
  categoryId '' and categoryLabel 'KREIZ'. Sea is unchanged.

## Frontend

- `services/cnfService.ts`: `CnfRateConfig` becomes
  `{ seaRates, kreizAirRate, igstPct }`, plus `fetchCnfAirRate` /
  `saveCnfAirRate` (authed).
- `expectedCharge.ts`:
  - `computeExpectedCnfCharge(batch, seaRates, air)`, where
    `air = { partnerId, kreizRatePerKg, partnerRatePerKg?, partnerName? }`.
  - `defaultSeaCategory(seaRates)` replaces `defaultCnfCategory`.
- `CnfBatchesView`, `CnfDraftInvoiceModal`, `LogCnfInvoiceModal` (partner
  from the shipments; partner-shipped → 0), and `ChargesConfig` follow the
  decisions above.
- Unused air-category and partner-default service functions and types are
  removed from the frontend.

## Rollout

1. The batch-ID repair (fix_vendor_shipment_batch_ids) goes first; weights and
   charges are only right once shipments sit on the right batches.
2. Deploy the backend, then run `backfill_batch_weight_aggregates` (after the
   user's go-ahead). It then writes every batch, 0 included.
3. Deploy the frontend to Vercel prod.
4. The user checks Settings (KREIZ ₹1,000, United Express ₹1,175) and saves
   KREIZ's rate once, so it no longer depends on the old category.

## Tests

- Backend harness:
  - Weight rule: actual over listed, 0 fallback, batch with no shipments.
  - `get_batches` / `get_cnf_eligible_batches` weights on read.
  - Sync and backfill write 0.
  - KREIZ rate: get with fallback, save with validation and the proxy key.
  - Air KREIZ draft saves without a category; partner draft unchanged; sea
    unchanged.
- Frontend unit tests: expected charge for sea, air-KREIZ (rate, 0 kg,
  missing rate), air-partner and air-unset.
- Browser e2e: Settings card (KREIZ + partner rows, save), draft modal (air
  KREIZ prefill with no category select), batches weight column shows 0.00.
