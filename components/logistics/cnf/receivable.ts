import type { CnfShipmentValue, CnfDraftInvoice } from '../../../types';

// What the Receivable from CNF table shows per shipment:
//   toBill    — what CNF's tax invoice should come to for this shipment.
//               With a batch draft invoice that is the draft total (goods +
//               CNF charge + GST + adjustment), allocated across the batch's
//               shipments in proportion to goods paid. Without a draft there
//               is no charge to expect, so it is the goods paid (as before).
//   billed    — what CNF has already invoiced. With a draft that is the full
//               invoice amount shared to the shipment (goods + GST); without,
//               the goods line only — so each pairs with its toBill basis.
//   remaining — toBill − billed, never below 0 (0 for an ineligible shipment).
//   hasDraft  — whether a draft drives the figures (controls the row's note).
export interface ReceivableFigures {
  toBill: number;
  billed: number;
  remaining: number;
  hasDraft: boolean;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

// Keyed by shipmentId. Allocation runs over every shipment of a drafted batch
// (not just the rows on screen) so the shares always sum to the draft total.
export function computeReceivableFigures(
  shipments: CnfShipmentValue[],
  drafts: CnfDraftInvoice[],
): Map<string, ReceivableFigures> {
  const draftByBatch = new Map(drafts.map(d => [d.batchId, d]));
  const byBatch = new Map<string, CnfShipmentValue[]>();
  shipments.forEach(s => {
    const list = byBatch.get(s.batchId) || [];
    list.push(s);
    byBatch.set(s.batchId, list);
  });

  const out = new Map<string, ReceivableFigures>();
  byBatch.forEach((rows, batchId) => {
    const draft = draftByBatch.get(batchId);
    const goods = rows.reduce((sum, s) => sum + s.paidInr, 0);
    if (!draft || !(draft.total > 0) || !(goods > 0)) {
      rows.forEach(s => out.set(s.shipmentId, {
        toBill: s.paidInr,
        billed: s.invoicedInr,
        remaining: s.eligible ? s.remainingInr : 0,
        hasDraft: false,
      }));
      return;
    }
    // Split the draft total by goods paid; the last row absorbs the rounding
    // remainder so the shares add up to the draft total exactly.
    let allocated = 0;
    rows.forEach((s, idx) => {
      const share = idx === rows.length - 1
        ? round2(draft.total - allocated)
        : round2(draft.total * s.paidInr / goods);
      if (idx !== rows.length - 1) allocated += share;
      out.set(s.shipmentId, {
        toBill: share,
        billed: s.invoicedTotalInr,
        remaining: s.eligible ? Math.max(0, round2(share - s.invoicedTotalInr)) : 0,
        hasDraft: true,
      });
    });
  });
  return out;
}
