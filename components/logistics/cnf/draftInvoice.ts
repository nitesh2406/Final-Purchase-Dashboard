export interface DraftFigures { charge: number; gst: number; total: number }

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// Draft CNF invoice: CNF charge (Sea: % of goods; Air: ₹ per kg) + GST on
// goods + charge. Same rule as cnfDraftFigures_ in gas_clone/cnf_unified.js,
// which recomputes it on save — this is the form's live preview.
// Why a saved draft no longer matches the batch (paid goods moved by ₹1 or
// more, or its shipments changed since it was generated), or null if current.
export function draftStaleness(
  draft: { goodsValue: number; shipments: { shipmentId: string }[] },
  current: { goods: number; shipmentIds: string[] }
): string | null {
  const was = draft.shipments.map(s => s.shipmentId).sort().join(',');
  if (was !== [...current.shipmentIds].sort().join(',')) return 'Out of date: the batch\'s shipments changed. Regenerate.';
  if (Math.abs(draft.goodsValue - current.goods) >= 1) {
    const now = `₹${current.goods.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `Out of date: goods paid is now ${now}. Regenerate.`;
  }
  return null;
}

// Category to start the form on: the draft's own, unless it has since been
// deleted in Settings, then the batch's default, else none.
export function initialDraftCategoryId(existingId: string | undefined, categories: { id: string }[], fallbackId: string | undefined): string {
  if (existingId && categories.some(c => c.id === existingId)) return existingId;
  return fallbackId ?? '';
}

export function computeDraftInvoice(i: { mode: 'sea' | 'air'; goods: number; rate: number; weightKg: number | null; igstPct: number }): DraftFigures {
  const charge = round2(i.mode === 'air' ? (i.weightKg || 0) * i.rate : i.goods * i.rate / 100);
  const gst = round2((i.goods + charge) * i.igstPct / 100);
  return { charge, gst, total: round2(i.goods + charge + gst) };
}
