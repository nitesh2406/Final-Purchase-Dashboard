export interface DraftFigures { charge: number; gst: number; total: number }

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// Draft CNF invoice: CNF charge (Sea: % of goods; Air: ₹ per kg) + GST on
// goods + charge. Same rule as cnfDraftFigures_ in gas_clone/cnf_unified.js,
// which recomputes it on save — this is the form's live preview.
export function computeDraftInvoice(i: { mode: 'sea' | 'air'; goods: number; rate: number; weightKg: number | null; igstPct: number }): DraftFigures {
  const charge = round2(i.mode === 'air' ? (i.weightKg || 0) * i.rate : i.goods * i.rate / 100);
  const gst = round2((i.goods + charge) * i.igstPct / 100);
  return { charge, gst, total: round2(i.goods + charge + gst) };
}
