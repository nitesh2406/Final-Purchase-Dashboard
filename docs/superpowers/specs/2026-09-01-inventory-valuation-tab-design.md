# Inventory Valuation Tab — Design

Date: 2026-09-01
Status: Approved by user, pending implementation plan

## Background

Current inventory data lives only in the raw Google Sheet ("Inventory Data",
one row per SKU+channel, driven off channel/marketplace feeds) with brand,
category, and MRP mappings in a separate sheet ("EE Product Master"). There is
no single place in the app to see overall inventory position and its retail
valuation across brands/categories/channels. (Note: `components/inventory/
InventoryAnalytics.tsx` exists but is a `wip`-flagged stub built entirely on
`MOCK_SKUS` fixture data — unrelated to this feature and out of scope to
touch.)

This design adds a new "Inventory" tab giving a sortable, filterable view of
current inventory with valuation, sourced live from the two sheets above.

## Scope

**In scope:**
- New GAS backend action that joins Inventory Data + EE Product Master and
  returns the full per-SKU-per-channel dataset.
- New frontend tab ("Inventory") under the Sidebar's **Main** group, gated by
  the existing `forecasting` permission tab.
- Client-side aggregation, filtering (Brand / Category / Channel / free-text
  search), and click-to-sort on every column.

**Out of scope:**
- Any changes to `InventoryAnalytics.tsx` (the existing mock-data stub).
- Editing inventory data from this tab (read-only view).
- Historical/trend valuation — current snapshot only.
- Per-channel breakdown display when no channel filter is applied (rows show
  an aggregated total in that case; see Data Flow).

## Data Sources

### Inventory Data sheet
One row per SKU+channel:
| Column | Field |
|---|---|
| D | Master SKU |
| — | Channel Name |
| — | InStock (Fulfillable) |
| — | Inbound (Shipped) |

### EE Product Master sheet
| Column | Field |
|---|---|
| B | SKU |
| — | Name |
| — | Brand |
| — | Category Name |
| — | MRP |

Join key: `Inventory Data.Master SKU` = `EE Product Master.SKU`.

(The user gave header names, not column letters, for the non-SKU fields above.
Implementation reads by header name via the existing sheet-reading helpers
where possible, or resolves the letters from the live sheet header row —
either way, no design ambiguity here, just a lookup step.)

## Backend

New GAS action, `get_inventory_valuation`, added to the
`doPost` switch in `entry_points.js`, implemented in a new or existing backend
file. Behavior:

1. Read all rows of Inventory Data (Master SKU, Channel Name, InStock,
   Inbound).
2. Read all rows of EE Product Master (SKU, Name, Brand, Category Name, MRP)
   into a lookup map keyed by SKU.
3. For each Inventory Data row, join in Name/Brand/Category/MRP by Master SKU.
   Rows with no match still get returned — with `name`/`brand`/`category`/
   `mrp` left null/blank — rather than being dropped, so mapping gaps stay
   visible instead of silently vanishing from totals.
4. Return the full per-SKU-per-channel array. No server-side filtering,
   sorting, or aggregation — that all happens client-side (see Data Flow).
   This mirrors the existing `ShipmentTracker`/`VendorShipments` pattern of
   fetching the complete dataset once and deriving views from it in-memory.

Response row shape (approximate):
```ts
interface InventoryValuationRow {
  sku: string;
  name: string | null;
  brand: string | null;
  category: string | null;
  channel: string;
  in_stock: number;
  inbound: number;
  mrp: number | null;
}
```

## Frontend

**New file**: `components/inventory/InventoryValuation.tsx`.

**Wiring:**
- `types.ts`: add `'Inventory'` to `ViewType`.
- `Sidebar.tsx`: add `{ name: 'Inventory', icon: ..., group: 'Main' }` to
  `navItems`, and a `checkAllowed` branch: `if (name === 'Inventory') return
  tabs.includes('forecasting');`
- `App.tsx`: add `case 'Inventory': return <InventoryValuation />;` and the
  import.

**Data fetching**: on mount, call the new action via `callGasAuthed` (same
pattern as `SkuSearchScreen.tsx`), store the raw `InventoryValuationRow[]` in
state. Loading spinner while in flight; inline error banner with retry on
failure.

**Layout:**
1. Summary cards (dashboard-card style): Total SKUs, Total Quantity
   (In Stock + Inbound), Total Valuation — computed from the currently
   filtered/aggregated rows (so they reflect active filters).
2. Filter bar (native `<select>`, matching `ShipmentTracker`'s `FilterBar`):
   Brand, Category, Channel — single-select, options derived from distinct
   values in the fetched data, default "All". Plus a free-text search box
   matching against SKU and Name.
3. Table with clickable sortable headers: SKU, Name, Brand, Category,
   In Stock, Inbound, Total Qty, MRP, Valuation. Click a header to sort
   ascending; click again to reverse; small arrow glyph shows active
   column/direction. One sort column active at a time. Numeric columns
   right-aligned.

**Row computation** — single `useMemo` keyed on `[rawRows, channelFilter,
brandFilter, categoryFilter, search, sortColumn, sortDirection]`:
1. Filter `rawRows` to the active Channel (or keep all if "All").
2. Group by SKU, summing In Stock and Inbound across the (already
   channel-filtered) rows. Brand/Category/Name/MRP come from the first row
   for that SKU (they're constant per SKU — from the Product Master join).
3. Compute `Total Qty = In Stock + Inbound` and `Valuation = Total Qty × MRP`
   (or `null`/"—" display if MRP is null/blank — blank MRP is not treated as
   0, to avoid masking a data problem as zero-value stock).
4. Apply Brand filter, Category filter, and search (on SKU/Name) to the
   grouped rows.
5. Sort by the active column/direction.

**Empty state**: if no rows match filters, show the same
dashed-border/icon/"Clear Filters" pattern used in `ShipmentTracker.tsx`.

## Edge Cases

- SKU in Inventory Data with no Product Master match → row shown with SKU
  only; Name/Brand/Category/MRP/Valuation render as "—"; still counted in
  Total SKUs and Total Quantity, but excluded from Total Valuation (since
  there's no MRP to value it at).
- Blank/non-numeric MRP on a matched SKU → same "—" valuation treatment as
  above.
- Blank/non-numeric InStock or Inbound cells → treated as 0 in the sum.
- Duplicate SKU+Channel rows in the source sheet (if any) → summed, not
  de-duplicated — reflects whatever total actually exists in the sheet.

## Testing Plan

- `npm run lint` must stay at exactly the 2 known baseline errors
  (`NewSkuDetail.tsx:1516`, `AmazonForecasting.tsx:706`).
- Backend: call the new action directly (through the existing authed proxy)
  before wiring the frontend, and spot-check a handful of returned rows
  against the raw sheet values (Inventory Data + EE Product Master).
- Frontend, manually in the live app:
  - Totals look sane against the raw sheet for a couple of spot-checked SKUs.
  - Each filter (Brand, Category, Channel) individually and combined with
    others and with search.
  - Confirm switching the Channel filter correctly re-aggregates quantities
    (not just restricting rows).
  - Click-sort on several columns, including reversing direction.
  - Empty-state and "Clear Filters" flow.
  - An unmatched-SKU row (if one exists in live data) renders the "—"
    fallbacks correctly without breaking the table.
- Deploy discipline per CLAUDE.md: backend `clasp push --force` then `clasp
  deploy` (confirm first), frontend commit/push then `vercel --prod` (confirm
  first), verify each live before declaring done.
