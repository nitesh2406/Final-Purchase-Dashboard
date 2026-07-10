
import { Sku, PurchaseOrder, Shipment, Invoice, Vendor, TaxSlab, HsnCode, FreightAgent, FreightRate, AdditionalCharge, PaymentTerm, ApprovalRule, User, Role, NotificationRule, VendorReportData, Notification, ForecastingSku } from './types';

export const APPS_SCRIPT_URL = (import.meta as any).env.VITE_APPS_SCRIPT_URL;

// Dev/testing only: when true, Vendor Shipment finalization skips the Apps
// Script write (no Sheets data changes) and only exercises the Drive upload.
export const DEV_MODE_SKIP_SHIPMENT_WRITE = (import.meta as any).env.VITE_DEV_MODE_SKIP_SHIPMENT_WRITE === 'true';

export const API_ACTIONS = {
    // Draft Operations
    GET_DRAFTS: 'get_drafts',
    GET_DRAFT_BY_ID: 'get_draft_by_id',
    CREATE_DRAFT_FROM_FORECAST: 'create_draft_from_forecast',
    SAVE_DRAFT: 'save_draft',
    CREATE_DRAFT: 'create_draft',
    SUBMIT_DRAFT: 'submit_draft',
    CANCEL_DRAFT: 'cancel_draft',
    DUPLICATE_DRAFT: 'duplicate_draft',
    SAVE_CUSTOMIZATION: 'save_customization',
    // Purchase Order Operations
    CREATE_PO_DIRECT: 'create_po_direct',
    GET_PURCHASE_ORDERS: 'get_pos',
    GET_PURCHASE_ORDER_DETAILS: 'get_purchase_order_details',
    CLOSE_PO: 'close_po',
    GET_PENDING_LINES: 'get_pending_lines',
    GET_SKU_HISTORY: 'get_sku_history',
    // Catalog Operations
    SEARCH_SKU_CATALOG: 'search_sku_catalog',
    ADD_SKU: 'add_sku',
    // Vendor Operations
    GET_VENDOR_MASTERS: 'get_vendor_masters',
    // Shipment Operations
    UPLOAD_SHIPMENT_DOCS: 'upload_shipment_docs',
    SHIPMENT_RERUN_MATCHING: 'shipment_rerun_matching',
    SHIPMENT_GET_ALLOCATION: 'shipment_get_allocation',
    SHIPMENT_CREATE: 'shipment_create',
    GET_OPEN_BATCHES: 'get_open_batches',
    UPDATE_SHIPMENT_DRIVE_DOCS: 'update_shipment_drive_docs',
    // Finance Operations
    GET_BATCHES_FINANCE: 'get_batches_finance',
    GET_BATCH_FINANCE_DETAIL: 'get_batch_finance_detail',
    UPDATE_BATCH_TRACKING: 'update_batch_tracking',
    UPDATE_SHIPMENT_FINANCE: 'update_shipment_finance',
    UPDATE_BATCH_CURRENCY: 'update_batch_currency',
    GET_FX_RATES: 'get_fx_rates',
    GET_VENDOR_ACCOUNTS: 'get_vendor_accounts',
    LOG_PAYMENT: 'log_payment',
    GET_PAYMENTS: 'get_payments',
    GET_AGENT_INVOICES: 'get_agent_invoices',
    LOG_AGENT_INVOICE: 'log_agent_invoice',
    MAP_INVOICE_SHIPMENTS: 'map_invoice_shipments',
    GET_PURCHASE_INVOICES: 'get_purchase_invoices',
    GET_PAYMENT_LOGS: 'get_payment_logs',
    GET_SETTLEMENT_LEDGER: 'get_settlement_ledger',
    GET_VENDOR_LEDGER: 'get_vendor_ledger',
    // Amazon Operations
    GET_AMAZON_FORECAST:          'get_amazon_forecast',
    CONFIRM_AMAZON_SHIPMENT_PLAN: 'confirm_amazon_shipment_plan',
    GET_AMAZON_CONFIG:            'get_amazon_config',
    SAVE_AMAZON_CONFIG:           'save_amazon_config',
    // New SKU Operations
    GET_NEW_SKU_REQUESTS:      'getNewSkuRequests',
    GET_NEW_SKU_REQUEST_BY_ID: 'getNewSkuRequestById',
    SAVE_NEW_SKU_DRAFT:        'saveNewSkuDraft',
    GET_NEXT_AVAILABLE_SKU:    'getNextAvailableSku',
    GET_PRICING_CONFIG:        'getPricingConfig',
    GET_TAGS_BY_CATEGORY:      'getTagsByCategory',
    CREATE_SKU_ON_EE:          'createSkuOnEasyEcom',
    ATTACH_EXISTING_EE_SKU:    'attachExistingEasyEcomSku',
    CREATE_SKU_ON_ZOHO:        'createSkuOnZoho',
    ATTACH_EXISTING_ZOHO_ITEM: 'attachExistingZohoItem',
    GET_PARENT_SKU_DETAILS:    'getParentSkuDetails',
    CREATE_SKU_ON_SHOPIFY:     'createSkuOnShopify',
    UPDATE_EE_PO:              'updateEePurchaseOrder',
    REJECT_SKU_REQUEST:        'rejectSkuRequest',
    CREATE_MANUAL_SKU:         'createManualSkuRequest',
    GET_BRANDS:                'getBrands',
    ADD_BRAND:                 'addBrand',
    GET_VARIANTS:              'getVariants',
    SEARCH_SKU_FOR_UPDATE:     'searchSkuForUpdate',
    PROVISION_SKU_FOR_UPDATE:  'provisionSkuForUpdate',
    UPDATE_SKU_FIELDS:         'updateSkuFields',
    GET_AUDIT_LOG:             'getAuditLog',
    GET_PENDING_SKU_UPDATE_REQUESTS: 'getPendingSkuUpdateRequests',
    RESOLVE_SKU_UPDATE_REQUEST:      'resolveSkuUpdateRequest',
};

export const MOCK_SKUS: Sku[] = [
  { id: 'SKU-001', name: 'GAN 11 M Pro', finalItemName: 'GAN 11 M Pro 3x3 Magnetic Speed Cube', category: '3x3 Cubes', supplier: 'GAN Cubes', ean: '1234567890123', cost: 25.50, mrp: 4500, shopifyPrice: 4200, stockOnHand: 150, stockInTransit: 50, stockOnOrder: 100, salesVelocity: 10.5, taxRate: 18, hsnCode: '950300' },
  { id: 'SKU-002', name: 'MoYu RS3M 2020', finalItemName: 'MoYu RS3M 2020 3x3 Magnetic Speed Cube', category: '3x3 Cubes', supplier: 'MoYu', ean: '2345678901234', cost: 8.00, mrp: 900, shopifyPrice: 850, stockOnHand: 300, stockInTransit: 100, stockOnOrder: 200, salesVelocity: 25.2, taxRate: 18, hsnCode: '950300' },
  { id: 'SKU-003', name: 'QiYi MS 4x4', finalItemName: 'QiYi MS 4x4 Magnetic Speed Cube', category: '4x4 Cubes', supplier: 'QiYi', ean: '3456789012345', cost: 9.50, mrp: 1200, shopifyPrice: 1100, stockOnHand: 80, stockInTransit: 0, stockOnOrder: 50, salesVelocity: 5.1, taxRate: 18, hsnCode: '950300' },
  { id: 'SKU-004', name: 'YJ MGC 5x5', finalItemName: 'YJ MGC 5x5 Magnetic Speed Cube', category: '5x5 Cubes', supplier: 'YJ', ean: '4567890123456', cost: 15.00, mrp: 2000, shopifyPrice: 1850, stockOnHand: 60, stockInTransit: 20, stockOnOrder: 30, salesVelocity: 3.8, taxRate: 18, hsnCode: '950300' },
  { id: 'SKU-005', name: 'Dayan TengYun V1', finalItemName: 'Dayan TengYun V1 3x3 Magnetic Speed Cube', category: '3x3 Cubes', supplier: 'Dayan', ean: '5678901234567', cost: 22.00, mrp: 3800, shopifyPrice: 3500, stockOnHand: 40, stockInTransit: 10, stockOnOrder: 0, salesVelocity: 2.1, taxRate: 18, hsnCode: '950300' },
];

export const MOCK_PURCHASE_ORDERS: PurchaseOrder[] = [
  { id: 'PO-2024-001', vendor: 'GAN Cubes', createdDate: '2024-05-01', status: 'Completed', pipelineStatus: 'Out for Delivery', items: [{ skuId: 'SKU-001', quantity: 100, unitCost: 25.50 }], totalQty: 100, customLogo: true, customPackaging: false, emailSent: '2024-05-02', lastUpdated: '2024-05-28' },
  { id: 'PO-2024-002', vendor: 'MoYu', createdDate: '2024-05-15', status: 'Approved', pipelineStatus: 'In Transit to India', items: [{ skuId: 'SKU-002', quantity: 200, unitCost: 8.00 }], totalQty: 200, customLogo: false, customPackaging: false, emailSent: '2024-05-16', lastUpdated: '2024-05-25' },
  { id: 'PO-2024-003', vendor: 'QiYi', createdDate: '2024-05-20', status: 'Pending Approval', pipelineStatus: 'PO Placed', items: [{ skuId: 'SKU-003', quantity: 50, unitCost: 9.50 }], totalQty: 50, customLogo: true, customPackaging: true, emailSent: undefined, lastUpdated: '2024-05-22' },
];

export const MOCK_SHIPMENTS: Shipment[] = [
    { id: 'SHP-001', status: 'In-Transit India', createdAt: '2024-05-10', edd: '2024-06-15', mode: 'Sea', carrier: 'Maersk', waybill: 'MAEU1234567', origin: 'Shanghai, CN', destination: 'Mumbai, IN', totalQty: 1000, cartons: 50, invoiceAmount: 22000, daysInTransit: 18, lastUpdated: '2024-05-28',
      items: [{ skuId: 'SKU-001', name: 'GAN 11 M Pro', quantity: 400, unitCost: 25, totalCost: 10000, totalWeight: 200 }, { skuId: 'SKU-002', name: 'MoYu RS3M 2020', quantity: 600, unitCost: 20, totalCost: 12000, totalWeight: 300 }],
      trackingHistory: [{ timestamp: '2024-05-28', location: 'Singapore', status: 'In Transit', description: 'Departed from port' }],
      documents: [{ type: 'Bill of Lading', fileName: 'bol_shp001.pdf', size: '1.2MB', uploadDate: '2024-05-11' }],
      financials: { invoiceAmount: 22000, shippingCost: 1500, insurance: 200, customsDuty: 3000, portHandling: 500, otherCharges: 100, totalLandedCost: 27300, paymentStatus: 'Paid', invoiceCurrency: 'USD', homeCurrency: 'INR', exchangeRate: 83.5 }
    },
    { id: 'SHP-002', status: 'Delivered', createdAt: '2024-04-20', edd: '2024-05-05', mode: 'Air', carrier: 'DHL', waybill: 'DHL-7890123', origin: 'Shenzhen, CN', destination: 'Delhi, IN', totalQty: 200, cartons: 10, invoiceAmount: 8500, daysInTransit: 15, lastUpdated: '2024-05-06',
      items: [{ skuId: 'SKU-004', name: 'YJ MGC 5x5', quantity: 200, unitCost: 42.5, totalCost: 8500, totalWeight: 100 }],
      trackingHistory: [{ timestamp: '2024-05-05', location: 'Delhi, IN', status: 'Delivered', description: 'Package delivered' }],
      documents: [],
      financials: { invoiceAmount: 8500, shippingCost: 1200, insurance: 100, customsDuty: 1500, portHandling: 200, otherCharges: 50, totalLandedCost: 11550, paymentStatus: 'Paid', invoiceCurrency: 'USD', homeCurrency: 'INR', exchangeRate: 83.2 }
    }
];

export const MOCK_VENDORS: Vendor[] = [
  { id: 'V-001', name: 'GAN Cubes', contactPerson: 'Li Wei', email: 'li.wei@gancube.com', phone: '123-456-7890', address: '123 Speed St, Shanghai', type: 'Regular', status: 'Active', paymentTerms: 'Net 30', creditLimit: 50000 },
  { id: 'V-002', name: 'MoYu', contactPerson: 'Chen Yi', email: 'chen.yi@moyucube.com', phone: '234-567-8901', address: '456 Puzzle Ave, Shenzhen', type: 'Regular', status: 'Active', paymentTerms: 'Net 45', creditLimit: 75000 },
  { id: 'V-003', name: 'QiYi', contactPerson: 'Zhang Min', email: 'zhang.min@qiyimofangge.com', phone: '345-678-9012', address: '789 Cube Rd, Guangzhou', type: 'Regular', status: 'Active', paymentTerms: 'Net 30' },
  { id: 'V-004', name: 'Global Shipping Co', contactPerson: 'David Chen', email: 'david@gsc.com', phone: '456-789-0123', address: '1 Shipping Plaza, Hong Kong', type: 'Freight', status: 'Active', paymentTerms: 'On Receipt' },
  { id: 'V-005', name: 'AsiaCubeSource', contactPerson: 'Ankit Sharma', email: 'ankit@asiacubesource.com', phone: '567-890-1234', address: '10 Trade Tower, Delhi', type: 'Aggregator', status: 'Active', paymentTerms: 'Net 60', children: ['V-002', 'V-003'] },
];

export const MOCK_TAX_SLABS: TaxSlab[] = [
    { id: 'slab-1', name: 'GST @ 5%', rate: 5, description: 'Low-rate goods', itemCount: 0 },
    { id: 'slab-2', name: 'GST @ 12%', rate: 12, description: 'Standard-I goods', itemCount: 0 },
    { id: 'slab-3', name: 'GST @ 18%', rate: 18, description: 'Standard-II goods', itemCount: MOCK_SKUS.length },
    { id: 'slab-4', name: 'GST @ 28%', rate: 28, description: 'Luxury goods', itemCount: 0 },
];
export const MOCK_HSN_CODES: HsnCode[] = [
    { id: 'hsn-1', code: '950300', description: 'Toys, puzzles and other games', defaultTaxRate: 18, itemCount: MOCK_SKUS.length },
    { id: 'hsn-2', code: '490110', description: 'Printed books and brochures', defaultTaxRate: 5, itemCount: 0 },
];
export const MOCK_FREIGHT_AGENTS: FreightAgent[] = [
    // FIX: Removed 'trackingNumberPrefix' property as it is not defined in the FreightAgent interface.
    { id: 'fa-1', name: 'Global Shipping Co', contactPerson: 'David Chen', email: 'david@gsc.com', phone: '456-789-0123', services: ['Sea', 'Air'], activeSince: '2022-01-15', routeCount: 12, rating: 4.5, status: 'Active' },
    { id: 'fa-2', name: 'FastTrack Logistics', contactPerson: 'Jane Doe', email: 'jane@fasttrack.com', phone: '987-654-3210', services: ['Air'], activeSince: '2023-03-01', routeCount: 5, rating: 4.8, status: 'Active' },
    { id: 'fa-3', name: 'OceanLiners Inc.', contactPerson: 'Mike Ross', email: 'mike@oceanliners.com', phone: '111-222-3333', services: ['Sea'], activeSince: '2021-08-20', routeCount: 8, rating: 4.2, status: 'Inactive' },
];
export const MOCK_FREIGHT_RATES: FreightRate[] = [
    { id: 'fr-1', agentId: 'fa-1', mode: 'Sea', origin: 'Shanghai', destination: 'Mumbai', containerType: '20ft', rate: 2500, unit: 'per container', leadTime: '30-45 days', effectiveDate: '2024-01-01' },
    { id: 'fr-2', agentId: 'fa-2', mode: 'Air', origin: 'Shenzhen', destination: 'Delhi', rate: 4.5, unit: 'per kg', leadTime: '5-7 days', minWeight: 100, effectiveDate: '2024-03-01' },
];
export const MOCK_PAYMENT_TERMS: PaymentTerm[] = [
    { id: 'pt-1', name: 'Net 30', days: 30, description: 'Payment due 30 days from invoice date', vendorCount: 3 },
    { id: 'pt-2', name: 'Net 45', days: 45, description: 'Payment due 45 days from invoice date', vendorCount: 1 },
    { id: 'pt-3', name: 'On Receipt', days: 0, description: 'Payment due upon receipt of invoice', vendorCount: 1 },
];
export const MOCK_APPROVAL_RULES: ApprovalRule[] = [
    { id: 'ar-1', name: 'Invoice over 50k', type: 'Invoice', condition: 'amount > 50000', approvers: ['Manager', 'Finance Head'], status: 'Active' },
    { id: 'ar-2', name: 'PO over 100k', type: 'PO', condition: 'total > 100000', approvers: ['Manager', 'CEO'], status: 'Active' },
];
export const MOCK_USERS: User[] = [
    { id: 'usr-1', name: 'Alex Doe', email: 'alex.doe@example.com', role: 'Admin', department: 'Management', status: 'Active', lastLogin: '2024-05-28' },
    { id: 'usr-2', name: 'Jane Smith', email: 'jane.smith@example.com', role: 'Finance User', department: 'Finance', status: 'Active', lastLogin: '2024-05-27' },
];

