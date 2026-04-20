
export interface Sku {
  id: string;
  name: string;
  finalItemName: string;
  category: string;
  supplier: string;
  ean?: string;
  cost: number;
  mrp: number;
  shopifyPrice: number;
  stockOnHand: number;
  stockInTransit: number;
  stockOnOrder: number;
  salesVelocity: number; // units per day
  taxRate?: number;
  hsnCode?: string;
}

export interface PurchaseOrderItem {
  skuId: string;
  quantity: number;
  unitCost: number;
}

export type PipelineStatus = 'PO in Planning' | 'PO Placed' | 'PO Confirmed' | 'PO Dispatched' | 'In Transit to India' | 'Out for Delivery';

export interface PurchaseOrder {
  id: string;
  vendor: string;
  createdDate: string;
  expectedDeliveryDate?: string;
  status: 'Draft' | 'Placed' | 'Partially Dispatched' | 'Fully Dispatched' | 'Completed' | 'Cancelled' | 'Pending Approval' | 'Approved';
  pipelineStatus?: PipelineStatus;
  items: PurchaseOrderItem[];
  totalQty: number;
  customLogo?: boolean;
  customPackaging?: boolean;
  emailSent?: string; // date string or status
  lastUpdated: string;
  amount?: number; // Added for list view convenience
}

export type DraftStatus = 'DRAFT' | 'PARTIALLY_SUBMITTED' | 'SUBMITTED' | 'CANCELLED';

export interface DraftOrder {
  id: string;
  vendors: string[];
  submittedVendors?: Record<string, string>; // Maps vendor name to PO ID
  mode: string;
  planned_mode?: string; // FIX 9: Added fallback field from backend
  draft_date?: string;
  created_at?: string;
  expected_delivery?: string;
  notes: string;
  totalSkus?: number;
  totalItems?: number;
  total_skus?: number;
  total_items?: number;
  status: DraftStatus;
  items?: any[];
  submittedAt?: string;
  submittedBy?: string;
  cancelledAt?: string;
}

export interface VendorMaster {
  vendor_code: string;
  vendor_name: string;
}

export interface ShipmentItem {
  skuId: string;
  name: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  totalWeight: number;
}

export interface TrackingHistory {
  timestamp: string;
  location: string;
  status: string;
  description: string;
}

export interface ShipmentDocument {
  type: 'Bill of Lading' | 'Packing List' | 'Commercial Invoice' | 'Certificate of Origin';
  fileName: string;
  size: string;
  uploadDate: string;
}

export interface FinancialDetails {
  invoiceAmount: number;
  shippingCost: number;
  insurance: number;
  customsDuty: number;
  portHandling: number;
  otherCharges: number;
  totalLandedCost: number;
  paymentStatus?: 'Paid' | 'Pending' | 'Partially Paid';
  paymentTerms?: string;
  advancePaid?: { amount: number; date: string };
  balanceDue?: number;
  paymentMethod?: string;
  invoiceCurrency: 'USD' | 'INR' | 'CNY';
  homeCurrency: 'INR';
  exchangeRate: number;
}

export interface Comment {
  id: string;
  user: string;
  timestamp: string;
  text: string;
}

export type ShipmentStatus = 'In-Transit China' | 'In-Transit India' | 'Awaiting Clearance' | 'Out for Delivery' | 'Delivered' | 'Shipment Lost';

export interface Shipment {
  id: string;
  status: ShipmentStatus;
  createdAt: string;
  edd: string; // Estimated Delivery Date
  mode: 'Sea' | 'Air';
  carrier: string;
  waybill: string;
  origin: string;
  destination: string;
  totalQty: number;
  cartons: number;
  invoiceAmount: number;
  daysInTransit: number;
  lastUpdated: string;
  items: ShipmentItem[];
  trackingHistory: TrackingHistory[];
  documents: ShipmentDocument[];
  financials: FinancialDetails;
  communication?: {
    comments: Comment[];
  };
  notes?: string;
}

export interface Vendor {
  id: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  type: 'Regular' | 'Aggregator' | 'Freight' | 'Child';
  status: 'Active' | 'Inactive';
  paymentTerms: string;
  children?: string[]; // IDs of child vendors for aggregators
  creditLimit?: number;
  bankingInfo?: {
    bankName: string;
    accountNumber: string;
    ifscCode: string;
  };
}

export interface InvoiceLineItem {
  description: string;
  amount: number;
  taxRate: number;
  taxAmount: number;
}

export type InvoiceStatus = 'Paid' | 'Pending' | 'Overdue' | 'Partially Paid' | 'Draft' | 'Cancelled';

export interface InvoiceDocument {
  type: 'Invoice PDF' | 'Receipt' | 'Credit Note';
  fileName: string;
  uploadDate: string;
  size: string;
  uploadedBy: string;
}

export interface Payment {
  id: string;
  date: string;
  amount: number;
  method: 'Wire Transfer' | 'Credit Card' | 'Cash' | 'UPI' | 'Check';
  reference: string;
  recordedBy: string;
  isAggregatorPayment?: boolean;
  aggregatorPaymentId?: string;
  exchangeRate?: number;
  conversionCharge?: number;
  bankCharge?: number;
  otherCharge?: number;
  baseAmountInHomeCurrency?: number;
  actualPaidInHomeCurrency?: number;
}

export interface ActivityLogEntry {
  timestamp: string;
  user: string;
  activity: string;
  details: string;
}

export interface Invoice {
  id: string;
  vendor: string;
  invoiceDate: string;
  dueDate: string;
  status: InvoiceStatus;
  type: 'Regular' | 'Consolidated' | 'Freight';
  currency: 'INR' | 'USD' | 'CNY';
  amount: number;
  paidAmount: number;
  balance: number;
  poNumber?: string;
  shipments?: string[];
  lineItems: InvoiceLineItem[];
  costBreakdown: {
    baseAmount: number;
    cgst?: number;
    sgst?: number;
  };
  payments: Payment[];
  documents: InvoiceDocument[];
  activityLog: ActivityLogEntry[];
  notes: string;
  paymentTerms?: string;
}

export interface TaxSlab {
  id: string;
  name: string;
  rate: number;
  description: string;
  itemCount: number;
}

export interface HsnCode {
  id: string;
  code: string;
  description: string;
  defaultTaxRate: number;
  itemCount: number;
}

export interface FreightAgent {
  id: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  services: ('Sea' | 'Air')[];
  activeSince: string;
  routeCount: number;
  rating: number;
  status: 'Active' | 'Inactive';
}

export interface FreightRate {
  id: string;
  agentId: string;
  mode: 'Sea' | 'Air';
  origin: string;
  destination: string;
  containerType?: '20ft' | '40ft' | 'LCL';
  rate: number;
  unit: 'per container' | 'per kg' | 'per CBM';
  leadTime: string; // e.g., "30-45 days"
  minWeight?: number;
  effectiveDate: string;
  isExpired?: boolean;
  history?: { rate: number; dateRange: string }[];
}

export interface AdditionalCharge {
  id: string;
  type: string;
  amount: number;
  unit: 'fixed' | 'percentage' | 'per kg';
  applicableTo: string;
}

export interface PaymentTerm {
  id: string;
  name: string;
  days: number;
  description: string;
  vendorCount: number;
}

export interface ApprovalRule {
  id: string;
  name: string;
  type: 'Invoice' | 'Payment' | 'PO';
  condition: string;
  approvers: string[];
  status: 'Active' | 'Inactive';
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'Manager' | 'Finance User' | 'Inventory User' | 'Viewer';
  department: 'Management' | 'Finance' | 'Inventory' | 'Logistics';
  status: 'Active' | 'Inactive';
  lastLogin: string;
}

export interface Permission {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  approve: boolean;
}

export interface Role {
  id: 'Admin' | 'Manager' | 'Finance User' | 'Inventory User' | 'Viewer';
  permissions: {
    [module: string]: Permission;
  };
}

export interface NotificationRule {
  event: string;
  email: boolean;
  inApp: boolean;
  frequency: 'Daily' | 'Instant';
  recipients: string;
}

export interface VendorReportData {
  vendorId: string;
  vendorName: string;
  invoiceCount: number;
  totalAmount: number;
  totalPaid: number;
  pendingAmount: number;
  overdueAmount: number;
  lastPaymentDate: string;
  paymentTerms: string;
}

export interface Notification {
  id: string;
  type: 'overdue' | 'due_soon' | 'payment_success' | 'new_invoice';
  message: string;
  relatedId: string; // e.g., Invoice ID
  amount?: number;
  timestamp: string; // ISO string
  read: boolean;
}

export interface ForecastingSku {
  // Fields for main table view
  masterSKU: string;
  productName: string;
  sale15Days: number;
  sale30Days: number;
  sale90Days: number;
  monthlyMovingAvg: number;
  inStock: number;
  inTransit: number;
  inboundETA: string | null;
  daysOfCover: number;
  reorderQty: number;
  rawReorderQty?: number; // Pre-MOQ recommendation value
  unitCost: number;
  urgencyLevel: "critical" | "warning" | "healthy";
  mode: "Sea" | "Air" | "Both";
  leadTimeSea: number;
  leadTimeAir: number;

  // New detailed fields for the modal
  salesHistory90: { date: string; units: number }[];
  salesHistory30: { date: string; units: number }[];
  avgDailySales: number;
  salesVelocity: number; // percentage change
  peakSalesDay: { date: string; units: number };
  total90dSales: number;
  total30dSales: number;
  channelSplit: {
    amazon: { percentage: number; units: number };
    flipkart: { percentage: number; units: number };
    website: { percentage: number; units: number };
    bulk: { percentage: number; units: number };
  };
  stockByLocation: {
    amazonFBA: number;
    flipkartWH: number;
    myWarehouse: number;
  };
  reservedQty: number;
  businessRules: {
    safetyStock: number;
    moq: number;
    supplier: string;
    unitCost: number;
    lastOrderDate: string;
  };
  inTransitPOs?: Array<{
    poId: string;
    qty: number;
    status: "In Production" | "Shipped" | "In Customs";
    transportMode: "Air" | "Sea";
    etaDate: string;
    daysRemaining: number;
    isDelayed: boolean;
    delay_days: number;
  }>;
  // New backend fields
  inProductionPOs?: Array<{
    poId: string;
    qty: number;
    status: string;
  }>;
  inProduction?: number;
  effectiveDaysOfCover?: number;
  b2bRegularUnits?: number;
  bulkUnits?: number;
  bulkOrders?: number;
  suggestBulkSs?: boolean;
  salesHistory90B2C?: { date: string; units: number }[];
  poHistory?: Array<{
    poId: string;
    qty: number;
    orderDate: string;
    receivedDate: string;
    transportMode: "Air" | "Sea";
    actualLeadTime: number;
  }>;
  comboUsage?: Array<{
    comboSKU: string;
    comboName: string;
    qtyPerCombo: number;
    unitsSold90Days?: number;
  }>;
  comboImpactPercent?: number;
  forecast?: {
    stockoutDate: string;
    recommendedReorderDate: string;
    riskLevel: "high" | "medium" | "low";
    daysOfCoverRemaining: number;
  };
  outOfStock90Days: number;
  outOfStock30Days: number;
  lastStockoutStart: string | null;
  lastStockoutEnd: string | null;
  stockoutGapDays: number;
  SS_BULK: number;
  kitStockContribution?: number;
}

// ==========================================
// SHIPMENT TRACKER TYPES
// ==========================================

// Batch (Container/Consolidated Shipment)
export interface Batch {
  batch_id: string;
  batch_type: 'sea' | 'air';
  status: BatchStatus;
  total_shipments: number;
  total_vendors: number;
  total_cartons: number;
  total_units: number;
  created_at: string;
  created_by: string;
  shipped_at: string;
  expected_delivery: string;
  actual_delivery: string | null;
  tracking_number: string;
  carrier: string;
  notes: string;
  is_delayed: boolean;
  delay_days: number;
  vendor_shipments?: BatchVendorShipment[];
  vendor_summary?: any[];

  // Financial reconciliation fields
  original_amount_rmb: number;
  duty_charges_inr: number;
  landing_charges_inr: number;
  final_total_inr: number;
}

export type BatchStatus =
  | 'Shipped'
  | 'In-Transit China'
  | 'At Port China'
  | 'In-Transit Ocean'
  | 'In-Transit Air'
  | 'Customs Clearance'
  | 'In-Transit India'
  | 'Out for Delivery'
  | 'Delivered';

// Vendor Shipment within a Batch
export interface BatchVendorShipment {
  shipment_id: string;
  vendor_code: string;
  vendor_name: string;
  invoice_no: string;
  invoice_date: string;
  total_units: number;
  total_amount?: number; // compat
  carton_count: number;
  remarks: string;
  line_items: BatchLineItem[];
}

// Line Item with Inventory Context
export interface BatchLineItem {
  line_id: string;
  sku: string;
  item_name: string;
  factory_code: string;
  ean: string;
  incoming_qty: number;

  // Compatibility fields
  invoice_qty?: number;
  unit_price?: number;
  total_price?: number;

  // Inventory placeholders
  current_stock: number | null;
  future_stock: number | null;
  mma: number | null;
  doc_after_arrival: number | null;

  // Product specs placeholders
  has_logo: boolean | null;
  has_packaging: boolean | null;
  has_manual: boolean | null;
  has_opp_wrap: boolean | null;
}

// Filters
export interface BatchFilters {
  search: string;
  status: BatchStatus | 'All';
  mode: 'All' | 'sea' | 'air';
}

// Dashboard metrics
export interface BatchMetrics {
  activeBatches: number;
  inTransitValue: number;
  arrivingThisWeek: number;
  delayedShipments: number;
}

// ==========================================
// FINANCE MODULE TYPES
// ==========================================

export interface BatchFinance extends Batch {
  total_currency: 'RMB' | 'USD';
  payment_status: 'Unpaid' | 'Partial' | 'Paid';
  total_amount: number;
  amount_inr?: number;
  blended_rate?: number;
  rate_period?: string;
}

export interface ShipmentFinanceData {
  shipment_id: string;
  batch_id: string;
  vendor_code: string;
  vendor_name?: string;
  invoice_no: string;
  total_amount: number;
  currency: 'RMB' | 'USD';
  amount_inr?: number;
  payment_status: 'Unpaid' | 'Partial' | 'Paid';
  account_type?: 'Trade' | 'Pool';
}
