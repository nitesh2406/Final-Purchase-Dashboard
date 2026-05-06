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
  qcommMMA: number;         // Combined QC channel MMA
  qcommReserve: number;     // QC reserve deducted from available
  availableQty: number;
  totalDemandAcrossChannelSkus: number;
  canFulfill: boolean;
  splitRequired: boolean;
}

export interface AmazonInTransitWarning {
  hasWarning: boolean;
  etaDays: number | null;
  qty: number;
  poId: string | null;
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
  alternateSKU?: string;
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
  inTransitWarning: AmazonInTransitWarning;
  salesHistory90: { date: string; units: number }[];
  salesHistory30: { date: string; units: number }[];
  isExcluded: boolean;
}

export interface AmazonPOItem {
  poId: string;
  qty: number;
  status: string;
  transportMode: string;
  etaDate?: string | null;
  daysRemaining?: number | null;
  isDelayed?: boolean;
}

export interface AmazonSupplyChain {
  inProduction: number;
  inTransit: number;
  inProductionPOs: AmazonPOItem[];
  inTransitPOs: AmazonPOItem[];
}
