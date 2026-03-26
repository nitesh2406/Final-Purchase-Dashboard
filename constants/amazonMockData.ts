import { AmazonChannelSku } from '../types/amazon';

function generateHistory(days: number, avgMonthly: number, flatLast7 = false) {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    const daysFromEnd = days - 1 - i;
    if (flatLast7 && daysFromEnd < 7) return { date: d.toISOString().split('T')[0], units: 0 };
    const base = avgMonthly / 30;
    const variance = (Math.random() - 0.5) * base * 0.8;
    return {
      date: d.toISOString().split('T')[0],
      units: Math.max(0, Math.round(base + variance)),
    };
  });
}

export const MOCK_AMAZON_DATA: AmazonChannelSku[] = [
  // ── Master: 1030300 — 2 channel SKUs, split required ──
  {
    channelSKU: '1030300gp',
    channelItemCode: 'B08XXXX1',
    masterSKU: '1030300',
    productName: 'Cubelelo Drift 3M Plus v2',
    packSize: 6, isCombo: false, cost: 265, mrp: 1099,
    mma: {
      calculated: 45, final: 45, floorApplied: false, last7DaysSales: 12,
      _buckets: { total15: 22, total30: 45, total60: 38, total90: 30 },
      _ads: { ads15: 1.47, ads30: 1.5, ads60: 1.27, ads90: 1.0 }, _weightedADS: 1.35,
    },
    amazonInventory: { fbaQty: 80, reserved: 5, inbound: 0, pending: 0, totalCoverage: 85, docDays: 28 },
    replenishment: { docGap: 29, calculatedQty: 43, recommendedQty: 45, velocityBand: 'slow' },
    warehouseCheck: {
      eeWarehouseStock: 120, shopifyMMA: 30, shopifyReserve: 30, yeioReserve: 0,
      availableQty: 90, totalDemandAcrossChannelSkus: 135, canFulfill: false, splitRequired: true,
    },
    allocation: { autoAllocatedQty: 60, finalAllocatedQty: 60, isManualOverride: false, overrideReason: '', shippingPlanQty: 60 },
    needsReplenishment: true, hasListingIssue: false, listingIssueMsg: null,
    salesHistory90: generateHistory(90, 45),
    salesHistory30: generateHistory(30, 45),
  },
  {
    channelSKU: '1030300amz',
    channelItemCode: 'B08XXXX2',
    masterSKU: '1030300',
    productName: 'Cubelelo Drift 3M Plus v2',
    packSize: 6, isCombo: false, cost: 265, mrp: 1099,
    mma: {
      calculated: 30, final: 30, floorApplied: false, last7DaysSales: 8,
      _buckets: { total15: 14, total30: 30, total60: 25, total90: 20 },
      _ads: { ads15: 0.93, ads30: 1.0, ads60: 0.83, ads90: 0.67 }, _weightedADS: 0.9,
    },
    amazonInventory: { fbaQty: 80, reserved: 5, inbound: 0, pending: 0, totalCoverage: 85, docDays: 28 },
    replenishment: { docGap: 29, calculatedQty: 29, recommendedQty: 30, velocityBand: 'slow' },
    warehouseCheck: {
      eeWarehouseStock: 120, shopifyMMA: 30, shopifyReserve: 30, yeioReserve: 0,
      availableQty: 90, totalDemandAcrossChannelSkus: 135, canFulfill: false, splitRequired: true,
    },
    allocation: { autoAllocatedQty: 30, finalAllocatedQty: 30, isManualOverride: false, overrideReason: '', shippingPlanQty: 30 },
    needsReplenishment: true, hasListingIssue: false, listingIssueMsg: null,
    salesHistory90: generateHistory(90, 30),
    salesHistory30: generateHistory(30, 30),
  },

  // ── Master: 1060049 — 1 channel SKU, healthy, no replenishment ──
  {
    channelSKU: '1060049amz',
    channelItemCode: 'B09YYYY1',
    masterSKU: '1060049',
    productName: 'QiYi Warrior 6x6 Standard',
    packSize: 0, isCombo: false, cost: 420, mrp: 1799,
    mma: {
      calculated: 85, final: 85, floorApplied: false, last7DaysSales: 18,
      _buckets: { total15: 40, total30: 85, total60: 72, total90: 60 },
      _ads: { ads15: 2.67, ads30: 2.83, ads60: 2.4, ads90: 2.0 }, _weightedADS: 2.57,
    },
    amazonInventory: { fbaQty: 210, reserved: 10, inbound: 60, pending: 0, totalCoverage: 280, docDays: 55 },
    replenishment: { docGap: 0, calculatedQty: 0, recommendedQty: 0, velocityBand: 'medium' },
    warehouseCheck: {
      eeWarehouseStock: 400, shopifyMMA: 20, shopifyReserve: 20, yeioReserve: 0,
      availableQty: 380, totalDemandAcrossChannelSkus: 0, canFulfill: true, splitRequired: false,
    },
    allocation: { autoAllocatedQty: 0, finalAllocatedQty: 0, isManualOverride: false, overrideReason: '', shippingPlanQty: 0 },
    needsReplenishment: false, hasListingIssue: false, listingIssueMsg: null,
    salesHistory90: generateHistory(90, 85),
    salesHistory30: generateHistory(30, 85),
  },

  // ── Master: 1030651 — 1 channel SKU, listing issue flagged ──
  {
    channelSKU: '1030651gp',
    channelItemCode: 'B0CNXSVR8C',
    masterSKU: '1030651',
    productName: 'Drift 3M PLUS v2 Magnetic Speedcube',
    packSize: 0, isCombo: false, cost: 265, mrp: 1099,
    mma: {
      calculated: 3.8, final: 3, floorApplied: true, last7DaysSales: 0,
      _buckets: { total15: 0, total30: 0, total60: 3, total90: 32 },
      _ads: { ads15: 0, ads30: 0, ads60: 0.1, ads90: 1.07 }, _weightedADS: 0.13,
    },
    amazonInventory: { fbaQty: 0, reserved: 6, inbound: 120, pending: 0, totalCoverage: 126, docDays: 42 },
    replenishment: { docGap: 15, calculatedQty: 1.5, recommendedQty: 2, velocityBand: 'slow' },
    warehouseCheck: {
      eeWarehouseStock: 1730, shopifyMMA: 76, shopifyReserve: 76, yeioReserve: 0,
      availableQty: 1654, totalDemandAcrossChannelSkus: 2, canFulfill: true, splitRequired: false,
    },
    allocation: { autoAllocatedQty: 5, finalAllocatedQty: 5, isManualOverride: false, overrideReason: '', shippingPlanQty: 5 },
    needsReplenishment: true, hasListingIssue: true,
    listingIssueMsg: 'MMA = 3 but 0 sales in last 7 days. Possible listing issue.',
    salesHistory90: generateHistory(90, 3, true),
    salesHistory30: generateHistory(30, 3, true),
  },
];
