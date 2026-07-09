
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

export const MOCK_INVOICES: Invoice[] = [
  { id: 'INV-2024-001', vendor: 'GAN Cubes', invoiceDate: '2024-05-05', dueDate: '2024-06-04', status: 'Paid', type: 'Regular', currency: 'USD', amount: 25500, paidAmount: 25500, balance: 0, poNumber: 'PO-2024-001', lineItems: [], costBreakdown: { baseAmount: 25500 }, payments: [{ id: 'PAY-001', date: '2024-05-20', amount: 25500, method: 'Wire Transfer', reference: 'TXN12345', recordedBy: 'Alex Doe' }], documents: [], activityLog: [], notes: 'Payment for PO-2024-001' },
  { id: 'INV-2024-002', vendor: 'MoYu', invoiceDate: '2024-05-18', dueDate: '2024-07-02', status: 'Pending', type: 'Regular', currency: 'USD', amount: 16000, paidAmount: 0, balance: 16000, poNumber: 'PO-2024-002', lineItems: [], costBreakdown: { baseAmount: 16000 }, payments: [], documents: [], activityLog: [], notes: 'Awaiting shipment arrival' },
  { id: 'INV-2024-003', vendor: 'Global Shipping Co', invoiceDate: '2024-05-12', dueDate: '2024-05-27', status: 'Overdue', type: 'Freight', currency: 'USD', amount: 1500, paidAmount: 0, balance: 1500, shipments: ['SHP-001'], lineItems: [], costBreakdown: { baseAmount: 1500 }, payments: [], documents: [], activityLog: [], notes: 'Invoice for SHP-001 sea freight' },
  { id: 'INV-2024-004', vendor: 'QiYi', invoiceDate: '2024-05-22', dueDate: '2024-06-21', status: 'Partially Paid', type: 'Regular', currency: 'USD', amount: 4750, paidAmount: 2000, balance: 2750, poNumber: 'PO-2024-003', lineItems: [], costBreakdown: { baseAmount: 4750 }, payments: [{ id: 'PAY-002', date: '2024-05-25', amount: 2000, method: 'Credit Card', reference: 'CHG67890', recordedBy: 'Alex Doe' }], documents: [], activityLog: [], notes: '' },
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
export const MOCK_ADDITIONAL_CHARGES: AdditionalCharge[] = [];
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
export const MOCK_ROLES_PERMISSIONS: Role[] = [];
export const MOCK_NOTIFICATION_RULES: NotificationRule[] = [];
export const MOCK_VENDOR_REPORT_DATA: VendorReportData[] = [];

const now = new Date();
export const MOCK_NOTIFICATIONS: Notification[] = [
    {
        id: '1',
        type: 'overdue',
        message: 'INV-2024-003 overdue',
        relatedId: 'INV-2024-003',
        amount: 1500,
        timestamp: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
        read: false,
    },
    {
        id: '2',
        type: 'due_soon',
        message: '5 invoices due in 3 days',
        relatedId: 'summary',
        amount: 250000,
        timestamp: new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
        read: false,
    },
    {
        id: '3',
        type: 'payment_success',
        message: 'Payment recorded for INV-2024-001',
        relatedId: 'INV-2024-001',
        amount: 25500,
        timestamp: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
        read: false,
    },
    {
        id: '4',
        type: 'new_invoice',
        message: 'New invoice INV-2024-004 received',
        relatedId: 'INV-2024-004',
        amount: 4750,
        timestamp: new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString(), // 5 hours ago
        read: true,
    },
     {
        id: '5',
        type: 'overdue',
        message: 'Invoice from QiYi is overdue',
        relatedId: 'INV-2024-004',
        amount: 2750,
        timestamp: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
        read: false,
    },
];


const generateForecastingSkus = (): ForecastingSku[] => {
  const skus: ForecastingSku[] = [];
  const productBases = ['T-Shirt', 'Hoodie', 'Jeans', 'Sneakers', 'Watch', 'Backpack', 'Cap', 'Socks', 'Jacket', 'Shorts'];
  const colors = ['Red', 'Blue', 'Green', 'Black', 'White', 'Gray', 'Yellow', 'Purple', 'Orange'];
  const sizes = ['S', 'M', 'L', 'XL'];

  for (let i = 1; i <= 50; i++) {
    const base = productBases[i % productBases.length];
    const color = colors[i % colors.length];
    const size = sizes[i % sizes.length];
    const productName = `${color} ${base} ${size}`;
    const masterSKU = `${color.substring(0,3).toUpperCase()}-${base.substring(0,4).toUpperCase()}-${size}-${i}`;

    const avgDailySales = parseFloat((Math.random() * 15 + 2).toFixed(1));
    const monthlyMovingAvg = avgDailySales; // For simplicity, MMA is avg daily sales

    const salesHistory90: { date: string; units: number }[] = [];
    let peakSalesDay = { date: '', units: 0 };

    for (let day = 89; day >= 0; day--) {
        const date = new Date();
        date.setDate(date.getDate() - day);
        const dayOfWeek = date.getDay();
        
        let seasonality = 1.0;
        if (dayOfWeek === 6 || dayOfWeek === 0) seasonality = 1.25;
        else if (dayOfWeek === 1) seasonality = 0.85;
        
        const noise = (Math.random() - 0.5) * 0.6; // +/- 30% noise
        const trend = (90 - day) / 90 * 0.2 - 0.1; // small trend over 90 days
        let unitsSold = Math.round(avgDailySales * seasonality * (1 + noise + trend));
        unitsSold = Math.max(0, unitsSold);
        
        const dateString = date.toISOString().split('T')[0];
        salesHistory90.push({ date: dateString, units: unitsSold });

        if (unitsSold > peakSalesDay.units) {
            peakSalesDay = { date: date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }), units: unitsSold };
        }
    }

    const salesHistory30 = salesHistory90.slice(-30);
    const sale15Days = salesHistory90.slice(-15).reduce((sum, item) => sum + item.units, 0);
    const total90dSales = salesHistory90.reduce((sum, item) => sum + item.units, 0);
    const total30dSales = salesHistory30.reduce((sum, item) => sum + item.units, 0);

    const sale30Days = total30dSales;
    const sale90Days = total90dSales;

    const inStock = Math.floor(Math.random() * (avgDailySales * 25)) + Math.round(avgDailySales * 5); // 5 to 30 days of stock
    const safetyStockLevel = Math.ceil(avgDailySales * (Math.random() * 5 + 7)); // Safety stock between 7-12 days
    const unitCost = parseFloat((Math.random() * 50 + 5).toFixed(2));
    
    const daysOfCover = avgDailySales > 0 ? inStock / avgDailySales : 999;
    
    let urgencyLevel: 'critical' | 'warning' | 'healthy';
    if (daysOfCover < 7 || inStock < safetyStockLevel) {
      urgencyLevel = 'critical';
    } else if (daysOfCover <= 14) {
      urgencyLevel = 'warning';
    } else {
      urgencyLevel = 'healthy';
    }
    
    const inTransit = Math.random() > 0.3 ? Math.floor(Math.random() * (avgDailySales * 30)) : 0;
    const inboundETA = inTransit > 0 ? new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null;

    const modeOptions: ForecastingSku['mode'][] = ["Sea", "Air", "Both", "Both", "Both"];
    const mode = modeOptions[i % modeOptions.length];
    const leadTimeAir = 10 + Math.floor(Math.random() * 6); // 10-15 days
    const leadTimeSea = 30 + Math.floor(Math.random() * 16); // 30-45 days
    
    let reorderQty = 0;
    if (urgencyLevel !== 'healthy') {
      const leadTime = mode === 'Air' ? leadTimeAir : leadTimeSea; // Default to sea for initial calc
      const targetStock = avgDailySales * (leadTime + 15); // lead time + 15 days buffer
      const effectiveStock = inStock;
      const needed = targetStock - effectiveStock - inTransit;
      reorderQty = Math.max(0, Math.ceil(needed / 10) * 10); // round up to nearest 10
    }

    // Channel Split
    const p1 = Math.random() * 60 + 20; // 20-80
    const p2 = Math.random() * (100 - p1);
    const p3 = Math.random() * (100 - p1 - p2);
    const p4 = 100 - p1 - p2 - p3;
    const percentages = [p1,p2,p3,p4].sort((a,b) => b-a);
    
    const channelSplit = {
        amazon: { percentage: parseFloat(percentages[0].toFixed(1)), units: Math.round(total90dSales * (percentages[0]/100)) },
        flipkart: { percentage: parseFloat(percentages[1].toFixed(1)), units: Math.round(total90dSales * (percentages[1]/100)) },
        website: { percentage: parseFloat(percentages[2].toFixed(1)), units: Math.round(total90dSales * (percentages[2]/100)) },
        bulk: { percentage: parseFloat(percentages[3].toFixed(1)), units: Math.round(total90dSales * (percentages[3]/100)) }
    };

    // Stock by location
    const s1 = Math.random();
    const s2 = Math.random() * (1-s1);
    const s3 = 1 - s1 - s2;
    const stockByLocation = {
        amazonFBA: Math.round(inStock * s1),
        flipkartWH: Math.round(inStock * s2),
        myWarehouse: Math.round(inStock * s3)
    };

    const businessRules = {
        safetyStock: safetyStockLevel,
        moq: [50, 100, 150, 200][i % 4],
        supplier: ['ABC Corp', 'Global Imports', 'Speedy Supplies', 'CubeMasters'][i % 4],
        unitCost: unitCost,
        lastOrderDate: new Date(Date.now() - (Math.random() * 60 + 15) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    };

    const newSku: ForecastingSku = {
      masterSKU,
      productName,
      sale15Days,
      sale30Days,
      sale90Days,
      monthlyMovingAvg,
      inStock,
      inTransit,
      inboundETA,
      daysOfCover,
      reorderQty,
      unitCost,
      urgencyLevel,
      mode,
      leadTimeAir,
      leadTimeSea,
      // new detailed fields
      salesHistory90,
      salesHistory30,
      avgDailySales,
      salesVelocity: parseFloat(((Math.random() - 0.4) * 30).toFixed(1)), // -12% to +18%
      peakSalesDay,
      total90dSales,
      total30dSales,
      channelSplit,
      stockByLocation,
      reservedQty: Math.floor(Math.random() * (inStock * 0.2)), // up to 20% reserved
      businessRules,
      outOfStock30Days: 0,
      outOfStock90Days: 0,
      lastStockoutEnd: null,
      lastStockoutStart: null,
      stockoutGapDays: Math.random() > 0.8 ? Math.floor(Math.random() * 15) + 1 : 0,
      SS_BULK: Math.floor(Math.random() * 100),
    };

    // Add in-transit POs conditionally
    if (Math.random() > 0.4) { // 60% chance of having in-transit POs
      newSku.inTransitPOs = [];
      const poCount = Math.random() > 0.7 ? 2 : 1;
      for (let j = 0; j < poCount; j++) {
        const isDelayed = Math.random() > 0.8;
        const etaDate = new Date();
        const daysRemaining = Math.floor(Math.random() * 30) + 1;
        etaDate.setDate(etaDate.getDate() + daysRemaining);

        newSku.inTransitPOs.push({
          poId: `PO-2024-${Math.floor(Math.random() * 100) + 100 + j}`,
          qty: Math.round((avgDailySales * (Math.random() * 15 + 10)) / 10) * 10,
          status: (["Shipped", "In Customs", "In Production"] as const)[Math.floor(Math.random() * 3)],
          transportMode: Math.random() > 0.5 ? "Air" : "Sea",
          etaDate: etaDate.toISOString().split('T')[0],
          daysRemaining: daysRemaining,
          isDelayed: isDelayed,
          // FIX: Changed delayDays to delay_days to match interface in types.ts
          delay_days: isDelayed ? Math.floor(Math.random() * 5) + 1 : 0,
        });
      }
    }

    // Add PO History
    const poHistory = [];
    const historyCount = Math.floor(Math.random() * 3) + 3; // 3 to 5 history items
    let lastReceivedDate = new Date();
    for (let k = 0; k < historyCount; k++) {
      const transportMode = Math.random() > 0.5 ? "Air" : "Sea";
      const leadTime = transportMode === 'Air' ? Math.floor(Math.random() * 11) + 10 : Math.floor(Math.random() * 21) + 25; // Air: 10-20, Sea: 25-45
      
      lastReceivedDate.setDate(lastReceivedDate.getDate() - (leadTime + Math.floor(Math.random() * 20) + 10)); // Gap between orders
      const receivedDate = new Date(lastReceivedDate);
      const orderDate = new Date(receivedDate);
      orderDate.setDate(orderDate.getDate() - leadTime);

      poHistory.push({
        poId: `PO-2023-${Math.floor(Math.random() * 100) + 100 + k}`,
        qty: Math.round((avgDailySales * (Math.random() * 20 + 20)) / 10) * 10,
        orderDate: orderDate.toISOString().split('T')[0],
        receivedDate: receivedDate.toISOString().split('T')[0],
        transportMode: transportMode,
        actualLeadTime: leadTime,
      });
    }
    newSku.poHistory = poHistory.sort((a, b) => new Date(b.receivedDate).getTime() - new Date(a.receivedDate).getTime());

    // Add Combo Usage conditionally
    if (Math.random() > 0.7) { // 30% chance of being in a combo
      const comboCount = Math.random() > 0.8 ? 2 : 1;
      const combos = [];
      for (let l = 0; l < comboCount; l++) {
        combos.push({
          comboSKU: `COMBO-${base.substring(0,3)}-${l+1}`,
          comboName: `${l+2}-Pack ${base} Bundle`,
          qtyPerCombo: l+2,
        });
      }
      newSku.comboUsage = combos;
      newSku.comboImpactPercent = Math.floor(Math.random() * 15) + 10; // 10-25%
    }

    // Add Forecast Alert
    const riskMap = { "critical": "high", "warning": "medium", "healthy": "low" } as const;
    const stockoutDate = new Date();
    stockoutDate.setDate(stockoutDate.getDate() + Math.floor(newSku.daysOfCover));
    
    const reorderLeadTime = newSku.leadTimeSea; // default to sea
    const reorderDate = new Date(stockoutDate);
    reorderDate.setDate(reorderDate.getDate() - reorderLeadTime - 7); // 7 day buffer

    newSku.forecast = {
      stockoutDate: stockoutDate.toISOString().split('T')[0],
      recommendedReorderDate: reorderDate.toISOString().split('T')[0],
      riskLevel: riskMap[newSku.urgencyLevel],
      daysOfCoverRemaining: Math.floor(newSku.daysOfCover),
    };

    // Add Out of Stock Data
    if (Math.random() > 0.6) { // 40% chance of stockout
        newSku.outOfStock30Days = Math.floor(Math.random() * 7) + 1; // 1-7 days
        newSku.outOfStock90Days = newSku.outOfStock30Days + Math.floor(Math.random() * 10); // 30-day is a subset of 90-day
        
        const stockoutEnd = new Date();
        stockoutEnd.setDate(stockoutEnd.getDate() - (Math.floor(Math.random() * 25) + 2)); // 2-27 days ago
        const stockoutStart = new Date(stockoutEnd);
        const duration = Math.random() > 0.5 ? 0 : Math.floor(Math.random() * 3) + 1; // 0-3 days duration
        stockoutStart.setDate(stockoutStart.getDate() - duration);

        newSku.lastStockoutStart = stockoutStart.toISOString().split('T')[0];
        newSku.lastStockoutEnd = stockoutEnd.toISOString().split('T')[0];

    }


    skus.push(newSku);
  }
  return skus;
};

export const MOCK_FORECASTING_SKUS: ForecastingSku[] = generateForecastingSkus();
