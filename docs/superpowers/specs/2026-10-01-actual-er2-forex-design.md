# Forex at the Actual ER2 (Remove the 2% Conversion Charge) — Design

Date: 2026-10-01. Status: approved by the user in chat. The user chose option
(a): a transfer's shortfall keeps its market rate.

## Problem

Every payment stored **Settled ER2 = ER2 ÷ (1 + conversion charge %)**, with
the charge at 2% (Settings → Conversion Charge). That adjusted rate drove:

- forex gain/loss on every SettlementLedger row (`RMB × (ER1 − Settled ER2)`);
- each cross-vendor transfer's (IDP-) rate, blended from the source's adjusted
  wallet rates plus the shortfall at that day's market rate;
- batch paid INR / ER (`paid_amount_inr`, `blended_settlement_rate`).

KREIZ / CNF values already used the actual rate (piece 4, `cnfActualRates_`,
which scales an adjusted wallet part by the source's ER2 ÷ Settled ER2). The
user wants all forex on the actual ER2, KREIZ consistent with it, and the
history corrected.

## Decisions

| # | Decision |
|---|---|
| 1 | New payments settle at their actual ER2: `addPaymentLog` stores Settled ER2 = ER2. The Settled ER2 column stays, so every reader keeps working. |
| 2 | The Conversion Charge setting is removed: the Settings card goes, `get_conversion_charge` returns 0 and `save_conversion_charge` is refused. Log Payment shows "Rate used for forex gain/loss (actual ER2)". |
| 3 | History is corrected with the existing `payment_reset_resettle` (backup → resettle → verify, restore if needed). |
| 4 | A DP- re-settles at its own ER2, and its Settled ER2 is set to ER2. INR Amount is unchanged. |
| 5 | An IDP- keeps its **historical make-up**. The shortfall part stays at the market rate it was priced at (its XFER- invoice). The wallet-drawn part (INR − shortfall × market) is scaled by the source's ER2 ÷ Settled ER2 ratio on its DP- payments up to the transfer date (1.02). An all-shortfall transfer keeps its rate. This is exactly the scaling `cnfActualRates_` applies, so KREIZ values do not move. |
| 6 | Re-pricing from replayed wallet draws was rejected. Replaying today picks different wallets than were open when each transfer was logged (e.g. IDP-00020 drew a 14.55 wallet; a replay finds a 14.25 wallet still open), which would re-price transfers for reasons unrelated to the 2%. |
| 7 | Rates are worked out from the backup, so every resume chunk gets the same rates and the dry run lists them all up front. |
| 8 | `payment_reset_verify` gains `scope: 'rmb'`, which compares only the RMB side (balances, settled amounts, vendor ledger, payment status, XFER- invoices, total paid to CNF) and returns a before/after summary of rates, INR and forex. |
| 9 | `cnfActualRates_` keeps its scaling as a guard. After the run the ratio is 1, so CNF values come straight from the actual-rate settlement rows. Its no-DP fallback is 1 instead of 1 + charge %. |
| 10 | Clear + replay (needed only when DSC- discounts exist) also settles DPs at the actual ER2. Its IDP rates come from replay-order wallet draws, not decision 5. Resettle is the route for this correction (live has no DSC-). |

## Replay on the live snapshot (2026-09-30, harness)

- Total forex gain/loss: −₹11,70,066.41 → **−₹16,96,485.77** (−₹5,26,419.36).
- 19 DPs at their own ER2; 28 IDPs re-priced (+0.2% to +2.0%); 21 all-shortfall
  IDPs unchanged.
- RMB side identical: every wallet and invoice balance, settled amount, vendor
  ledger and payment status. The one exception is A-26023's stale stored
  status, which is recomputed.
- KREIZ: CNF paid INR per shipment within ₹1.94 of before (−₹4.43 across all
  shipments), which is 2-dp storage rounding.
- Control run: given the old ÷1.02 rates, the same code rebuilds every live
  IDP rate exactly, and total forex lands within ₹16 of the predicted 2-dp
  rounding effect.

## Rollout

1. Deploy the backend.
2. `payment_reset_backup` (proxy key).
3. `payment_reset_resettle` dry run, then the real run (proxy key), in chunks.
4. `payment_reset_verify` with `scope: 'rmb'`; restore from the backup if it
   isn't clean.
5. Deploy the frontend.
