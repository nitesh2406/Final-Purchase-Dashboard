# Supabase migration — pilot tab: Inventory Valuation

**Date:** 2026-10-03
**Status:** Proposal / build contract for the Central DBMS window
**Author:** drafted with Claude (Opus 4.8)

## Why this document
Moving the Purchase Dashboard's backend off Google Apps Script-over-Sheets onto
Supabase/Postgres, to get the ops team a 1–2s frontend sync instead of the
current multi-second GAS round-trip (worsened by the googleusercontent
result-fetch 404s under concurrency).

**Scope decision:** migrate everything to Central DBMS, eventually. The whole
app repo is synced to the Central DBMS device and the migration is built there
(single repo, no split). This doc is the **build contract** that window works
from, and the permanent record of the flow's logic.

**Approach:** read-only consumer tabs first (data already in Supabase), then the
app-authored accounting graph (PO → shipment → invoice → settlement → CNF) as a
connected set with a single production cut-over. Inventory Valuation is the
pilot because its source data is already in Central DBMS, so it proves the
Express→Supabase read path with (almost) no data migration.

Per-tab method (applies to every tab after this one):
1. **Scope** — the tab, its GAS action(s), the sheet(s), read-only vs authored.
2. **Schema** — the Supabase table(s)/columns/keys/grain, or confirm reuse.
3. **Logic doc** — this document: the full flow + every non-obvious rule, so the
   flow is verified correct *before* data moves.
4. **Backfill + automation** — one-time history load, then the ongoing path,
   gated by a shadow-compare against the live GAS/Sheets numbers.

---

## 1. Scope
- **Tab:** Inventory (Inventory Valuation), `components/inventory/InventoryValuation.tsx`.
- **GAS action:** `get_inventory_valuation` → `apiGetInventoryValuation_`
  (gas_clone/Inventory_Valuation.js).
- **Type:** read-only. Source data is already synced into Central DBMS daily.
  No writes, no accounting side-effects.

## 2. Backend ↔ frontend contract (must be preserved exactly)
The frontend does all aggregation itself in a **pure util**
(`utils/inventoryAggregation.ts`). The only thing the backend owes it is a flat
list of rows + a small meta block. Keep this identical and the frontend change
is a one-line fetch swap.

**Row type** (`types.ts` → `InventoryValuationRow`), **one row per (channel × master SKU):**
```ts
{
  sku: string;            // master SKU
  name: string | null;    // product name
  brand: string | null;
  category: string | null;
  channel: string;        // 'EASY ECOM' | 'AMAZON'  (exact strings)
  in_stock: number;       // fulfillable; RAW (may be negative for Amazon — keep it)
  inbound: number;        // Amazon: shipped+working+receiving; EasyEcom: 0
  cost_inr: number | null; // INR landed cost
  cost_rmb: number | null; // RMB unit price  ← the one gap today (see Q1)
}
```

**Response envelope** (what `apiGetInventoryValuation_` returns, mirror it):
```jsonc
{
  "status": "success",
  "records": [ /* InventoryValuationRow[] */ ],
  "generatedAt": "ISO",   // when this payload was built
  "syncedAt": "ISO|null", // when the underlying data was last refreshed
  "amazonSyncedAt": "ISO|null", // when Amazon rows were last actually fetched
  "warning": "",          // non-empty when the data is degraded/stale
  "source": "snapshot|live"
}
```
Downstream use (do not reimplement server-side — listed so you can see what the
numbers feed): `aggregateInventory` makes one row per SKU, filters by channel
**before** summing, floors `in_stock`/`inbound` at 0 **for valuation only**, and
computes `valuation = valuation_qty × cost_inr`. Negative stock and unvalued
SKUs are surfaced deliberately, so **rows must pass through RAW** — no clamping,
no dropping, no pre-aggregation on the server.

## 3. How the data is produced today (the logic to reproduce)
Two sheets, joined by SKU.

**Sheet `Inventory Data`** — 10 columns (`INVENTORY_DATA_HEADERS_`):
`Channel Name, Channel Item Code, Channel SKU, Master SKU, InStock (Fulfillable),
Reserved (Total), Inbound (Shipped), Inbound (Pending), XQJX, Strict (Pending)`.
The valuation reader only uses **Channel Name, Master SKU, InStock (Fulfillable),
Inbound (Shipped)**. Rows are written by the inventory sync:
- **EasyEcom rows** (`buildEasyEcomInventoryRows_`, EEcom_api_code.js): channel
  `EASY ECOM`, `InStock = item.inventory` (EasyEcom's reported available),
  combo products excluded, **Inbound and all other quantity columns = 0**.
- **Amazon rows** (`buildAmazonInventoryRows_`, amazon_api_code.js:364): channel
  `AMAZON`, with the adjustment below.

**Sheet `EE Product Master`** — the valuation reader uses **SKU, Product Name,
Brand, Category Name, Cost (INR landed), RMB_Price**.

**Join** (`buildInventoryValuationRecords_`, Inventory_Valuation.js:59): for each
Inventory Data row, look up `EE Product Master` by `Master SKU`; emit the row
type above. `cost_inr ← Cost`, `cost_rmb ← RMB_Price`; name/brand/category from
the product, null when the SKU isn't in the master.

**Meta** comes from Script Properties the sync stamps: `syncedAt`,
`amazonSyncedAt`, `warning` (`buildInventorySnapshot_`).

### Parity rules — these change the numbers, reproduce them exactly
1. **Amazon fulfillable is reduced by EasyEcom qty** (amazon_api_code.js:382–383):
   ```
   adjustedFulfillable = amazon_globalFulfillable − easyEcomQty(masterSku)
   ```
   Raipur (`en27701274969`) **is** Amazon's XQJX fulfilment centre — one physical
   pool reported by both systems. Without the subtraction the shared stock is
   double-counted. `easyEcomQty` is the per-master-SKU EasyEcom quantity (the
   same figure that becomes the EasyEcom row's `InStock`). The result **can go
   negative** and must be kept as-is.
2. **Amazon seller SKU → master SKU mapping** (`skuToMasterSkuMap`): Amazon rows
   are keyed by master SKU after mapping `sellerSku → masterSku`. Central DBMS
   has flagged this mapping as **NOT yet verified** — it's the top parity risk;
   trustworthy Amazon valuation depends on settling it (Q3).
3. **Amazon inbound** = `inboundShipped + inboundWorking + inboundReceiving`
   (amazon_api_code.js:395).
4. **EasyEcom inbound = 0** (static in the sheet). Keep 0 unless we deliberately
   start surfacing it.
5. **"Current" = the latest daily snapshot** (00:00 IST opening stock) — matches
   the sheet, which refreshes at 00:00 IST.
6. **Combo/kit products are excluded** from the EasyEcom side.

## 4. Proposed Supabase mapping (bind to real columns)
No new tables — read existing Central DBMS tables. Column names below are the
*intent*; the Central DBMS window binds them to the real schema (please paste
`\d easyecom_inventory_daily`, `\d amazon_inventory`, `\d easyecom_products` and
adjust).

| Contract field | Source | Binding / rule |
|---|---|---|
| channel `EASY ECOM` rows | `easyecom_inventory_daily` latest `snapshot_date` | one row per master SKU (see Q2 on location grain) |
| `in_stock` (EASY ECOM) | `…fulfillable` | EasyEcom available; combos excluded |
| `inbound` (EASY ECOM) | — | 0 |
| channel `AMAZON` rows | `amazon_inventory` latest snapshot | keyed by **master** SKU via the mapping (Q3) |
| `in_stock` (AMAZON) | `amazon_fulfillable − easyEcomQty(masterSku)` | parity rule 1; keep negatives |
| `inbound` (AMAZON) | shipped+working+receiving | parity rule 3 |
| `name`/`brand`/`category` | `easyecom_products` | by SKU; null if absent |
| `cost_inr` | `easyecom_products.cost` | INR landed cost |
| `cost_rmb` | **gap** — `RMB_Price` custom field not captured | null until Q1 |
| `syncedAt` / `amazonSyncedAt` | latest snapshot `synced_at` / `snapshot_date` | |
| `warning` | derive (e.g. snapshot older than 36h) | matches `STALE_AFTER_HOURS` on the client |

Delivery: a Postgres **view** (or a function) returning the flat rows, consumed
by a new Express route (`GET /api/inventory/valuation`) over the **transaction
pooler (port 6543)** with a read-only credential. The Express route shapes the
view rows into the envelope above.

## 5. Backfill + automation
- **Backfill:** none for the pilot — the data already lands daily
  (`easyecom_inventory_daily` first snapshot 30 Sep 2026, `amazon_inventory`
  likewise). The view reads the latest snapshot.
- **Automation:** the existing daily EasyEcom/Amazon syncs already keep the
  tables current; nothing new to schedule for this tab.
- The only "automation" work is the Express route + the frontend repoint.

## 6. Validation / rollout (the gate)
1. Build the view + Express route; **don't** switch the frontend yet.
2. **Shadow-compare** against the live GAS snapshot captured at the same time:
   `POST get_inventory_valuation {force:true}` vs the new endpoint. Join on
   `(channel, sku)` and diff `in_stock`, `inbound`, `cost_inr`, and the summed
   `valuation`. Expected diffs only where a gap/decision is known: `cost_rmb`
   null, and any rows exposed by the Amazon-mapping question (Q3). Investigate
   everything else to zero.
3. Flip the frontend behind a flag for one or two users; confirm 1–2s and
   parity in real use.
4. Remove the flag; keep GAS `get_inventory_valuation` as a fallback briefly,
   then retire it.

No accounting-tab exceptions apply (this tab writes nothing); `sync_run_id` /
retention decisions are deferred to the accounting phase.

## 7. Open questions
- **Q1 — cost_rmb / EE custom fields:** add `RMB_Price` (and the other fields the
  app needs: Lead_Time, MOQ, Threshold_Qty, Supplier_Code, Article Number,
  factory code, FNSKU, pack size) to the EasyEcom sync into `easyecom_products`
  **now** — which also unblocks Create/Update SKU + EE Master later — or ship
  Inventory v1 with `cost_rmb = null` and backfill? (Recommend: add now, for the
  leverage.)
- **Q2 — EasyEcom stock grain:** does the sheet's EasyEcom `InStock` sum all 13
  locations or just Raipur? The view must match. Confirm against
  `easyecom_inventory_daily`.
- **Q3 — Amazon↔master SKU mapping:** who verifies it and where it lives
  (table vs derived). Blocks trustworthy Amazon valuation.
- **Q4 — connection/auth:** confirm the Express server uses the pooler (6543)
  with a read-only credential; PostgREST exposure of a new schema isn't needed
  here (server-side Postgres connection).
- **Q5 — freshness:** the GAS path offers a `force` live recompute; on Supabase
  "live" is the latest daily snapshot. Is daily freshness fine for this tab, or
  do we need an intraday refresh?

## 8. App-side touch points (for when work syncs back here)
- New: `server/app.ts` route `GET /api/inventory/valuation` (+ its Supabase
  client/pooler config).
- Change: `components/inventory/InventoryValuation.tsx` line ~135 — swap
  `callGas('get_inventory_valuation', …)` for the new fetch, behind a flag.
- Unchanged: `utils/inventoryAggregation.ts` (reused as-is), the row type,
  the whole table UI.
- Gate before deploy here: `tsc` (2 known errors: ean, strictPending) + clean
  `npm run build`; Vercel prod deploy from this device.
