export interface AmazonMMA {
  calculated: number;
  final: number;
  floorApplied: boolean;
  last7DaysSales: number;
  _buckets?: { total15: number; total30: number; total60: number; total90: number };
  _ads?: { ads15: number; ads30: number; ads60: number; ads90: number };
  _weightedADS?: number;
}

export interface AmazonInventory {
  fbaQty: number;
  reserved: number;
  inbound: number;
  pending: number;
  totalCoverage: number;
  docDays: number;
}

export interface AmazonReplenishment {
  docGap: number;
  calculatedQty: number;
  recommendedQty: number;
  velocityBand: 'slow' | 'medium' | 'fast';
}

export interface AmazonWarehouseCheck {
  eeWarehouseStock: number;
  shopifyMMA: number;
  shopifyReserve: number;
  yeioReserve: number;
  availableQty: number;
  totalDemandAcrossChannelSkus: number;
  canFulfill: boolean;
  splitRequired: boolean;
}

export interface AmazonAllocation {
  autoAllocatedQty: number;
  finalAllocatedQty: number;
  isManualOverride: boolean;
  overrideReason: string;
  shippingPlanQty: number;
}

export interface AmazonChannelSku {
  channelSKU: string;
  channelItemCode: string;
  masterSKU: string;
  productName: string;
  packSize: number;
  isCombo: boolean;
  cost: number;
  mrp: number;
  mma: AmazonMMA;
  amazonInventory: AmazonInventory;
  replenishment: AmazonReplenishment;
  warehouseCheck: AmazonWarehouseCheck;
  allocation: AmazonAllocation;
  needsReplenishment: boolean;
  hasListingIssue: boolean;
  listingIssueMsg: string | null;
  salesHistory90: { date: string; units: number }[];
  salesHistory30: { date: string; units: number }[];
}
