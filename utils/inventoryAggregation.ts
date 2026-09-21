import { InventoryValuationRow } from '../types';

// Pure aggregation for the Inventory tab, kept out of the component so the
// valuation rules can be tested on their own.

export interface AggregatedRow {
  sku: string;
  name: string | null;
  brand: string | null;
  category: string | null;
  in_stock: number;
  inbound: number;
  total_qty: number;
  cost_inr: number | null;
  cost_rmb: number | null;
  // Quantity that is actually valued: each source row's in_stock and inbound
  // are floored at 0 before summing. A negative stock figure (an artefact of
  // the Amazon sync's "Amazon minus EasyEcom" adjustment) can't be worth
  // negative money, and left in it dragged the total down (about ₹2.6L on the
  // live data). in_stock / inbound / total_qty stay RAW so the problem stays
  // visible in the table — only the valuation ignores it.
  valuation_qty: number;
  valuation: number | null;
  hasNegative: boolean;   // some source row has negative in_stock or inbound
  unvalued: boolean;      // holds stock but has no cost, so it's not in the total
}

// A SKU with nothing to value AND nothing wrong with it. Rows with a negative
// figure are never "zero stock" — hiding them would hide the data problem.
export const isZeroStock = (r: AggregatedRow): boolean => r.valuation_qty === 0 && !r.hasNegative;

const positive = (n: number) => (n > 0 ? n : 0);

// One row per SKU. `channel` filters BEFORE summing, so picking a channel
// re-aggregates using only that channel's rows ('All' sums every channel).
export function aggregateInventory(rows: InventoryValuationRow[], channel: string): AggregatedRow[] {
  const source = channel === 'All' ? rows : rows.filter(r => r.channel === channel);

  const bySku = new Map<string, AggregatedRow>();
  source.forEach(row => {
    const negative = row.in_stock < 0 || row.inbound < 0;
    const validQty = positive(row.in_stock) + positive(row.inbound);
    const existing = bySku.get(row.sku);
    if (existing) {
      existing.in_stock += row.in_stock;
      existing.inbound += row.inbound;
      existing.valuation_qty += validQty;
      existing.hasNegative = existing.hasNegative || negative;
    } else {
      bySku.set(row.sku, {
        sku: row.sku,
        name: row.name,
        brand: row.brand,
        category: row.category,
        in_stock: row.in_stock,
        inbound: row.inbound,
        total_qty: 0,
        cost_inr: row.cost_inr,
        cost_rmb: row.cost_rmb,
        valuation_qty: validQty,
        valuation: null,
        hasNegative: negative,
        unvalued: false,
      });
    }
  });

  return Array.from(bySku.values()).map(r => ({
    ...r,
    total_qty: r.in_stock + r.inbound,
    valuation: r.cost_inr == null ? null : r.valuation_qty * r.cost_inr,
    unvalued: r.cost_inr == null && r.valuation_qty > 0,
  }));
}

export interface InventoryTotals {
  totalSkus: number;
  totalQty: number;
  totalValuation: number;
  unvaluedSkus: number;     // stocked SKUs with no cost
  unvaluedQty: number;
  negativeSkus: number;
}

export function summarizeInventory(rows: AggregatedRow[]): InventoryTotals {
  const unvalued = rows.filter(r => r.unvalued);
  return {
    totalSkus: rows.length,
    totalQty: rows.reduce((sum, r) => sum + r.total_qty, 0),
    totalValuation: rows.reduce((sum, r) => sum + (r.valuation || 0), 0),
    unvaluedSkus: unvalued.length,
    unvaluedQty: unvalued.reduce((sum, r) => sum + r.valuation_qty, 0),
    negativeSkus: rows.filter(r => r.hasNegative).length,
  };
}
