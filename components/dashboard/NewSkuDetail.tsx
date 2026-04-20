import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import {
  ChevronRightIcon,
  ExclamationTriangleIcon,
  CheckBadgeIcon,
  ClockIcon,
  XMarkIcon,
} from '../icons/Icons';

// ─────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────

type SkuStatus = 'PENDING' | 'IN_PROGRESS' | 'ACTION_REQ' | 'CREATED' | 'REJECTED';

interface SkuRequest {
  request_id: string;
  shipment_id: string;
  item_name: string;
  category: string;
  vendor_code: string;
  invoice_qty: number;
  unit_price: number;
  requested_by: string;
  requested_at: string;
  status: SkuStatus;
  ee_done: boolean;
  zoho_done: boolean;
  shopify_done: boolean;
  ee_po_updated: boolean;
  ee_sku: string;
  shopify_listing_url: string;
}

interface FormData {
  // Section B — Product Identity
  suggested_sku: string;
  listing_name: string;
  variant: string;
  listing_type: 'New Product' | 'Existing Variant' | '';
  parent_sku: string;
  category: string;
  brand: string;
  // Section C — Pricing
  mrp: number | '';
  shopify_selling_price: number | '';
  shopify_compare_price: number | '';
  // Section D — Physical Specs
  pkg_height_cm: number | '';
  pkg_length_cm: number | '';
  pkg_width_cm: number | '';
  pkg_weight_gm: number | '';
  product_dims_mm: string;
  nw_gm: number | '';
  // Section E — Additional EE Fields
  lead_time: number | '';
  moq: number | '';
  threshold_qty: number | '';
  supplier_code: string;
  pack_size: number | '';
  // Section E — Listing
  relevant_tags: string;
  fnsku: string;
  fnsku_status_ee: string;
  // Section F — Remarks
  remark: string;
  notes: string;
}

interface PricingConfig {
  cny_conv_rate: number;
  shipping_factor: number;
  mrp_factor: number;
  margin_factor: number;
}

const MOCK_PRICING_CONFIG: PricingConfig = {
  cny_conv_rate: 12.5,
  shipping_factor: 1.18,
  mrp_factor: 3.2,
  margin_factor: 0.55,
};

// SKU category prefix map
const SKU_CATEGORY_MAP: Record<string, string> = {
  '2x2': '102', '3x3': '103', '4x4': '104', '5x5': '105',
  '6x6': '106', '7x7': '107', 'Accessory': '140', 'Big Cubes': '108',
  'Clock': '153', 'Design': 'EMC', 'Event Equipment': '999',
  'Events': '802', 'Gift Box': '146', 'Kreativity': '400',
  'Learn': '990', 'Lubricant': '137', 'Megaminx': '129',
  'Mirror': '112', 'Other': '139', 'Other Puzzles': '163',
  'Pyraminx': '128', 'SERVICE': 'SER', 'Snake': '131',
  'Timer and Mat': '138', 'Shape Mod': '113', 'Skewb': '113',
  'Square-1': '115',
};

const CATEGORIES = Object.keys(SKU_CATEGORY_MAP);

// ─────────────────────────────────────────
// MOCK DATA (same as NewSkuDashboard)
// ─────────────────────────────────────────

const MOCK_SKU_REQUESTS: SkuRequest[] = [
  {
    request_id: 'NSR-001', shipment_id: 'VS-PW260401-4',
    item_name: 'MoYu RS3M 2021 Stickerless', category: '3x3', vendor_code: 'PW',
    invoice_qty: 500, unit_price: 48.50, requested_by: 'Nitesh',
    requested_at: '2026-04-10T09:30:00Z', status: 'CREATED',
    ee_done: true, zoho_done: true, shopify_done: true, ee_po_updated: true,
    ee_sku: 'CUBE-RS3M-STK-001', shopify_listing_url: 'https://cubelelo.com/products/moyu-rs3m-2021',
  },
  {
    request_id: 'NSR-002', shipment_id: 'VS-QY260402-1',
    item_name: 'QiYi MS Pyraminx', category: 'Pyraminx', vendor_code: 'QY',
    invoice_qty: 200, unit_price: 32.00, requested_by: 'Arjun',
    requested_at: '2026-04-11T11:15:00Z', status: 'IN_PROGRESS',
    ee_done: true, zoho_done: true, shopify_done: false, ee_po_updated: false,
    ee_sku: 'CUBE-QIYI-PYR-002', shopify_listing_url: '',
  },
  {
    request_id: 'NSR-003', shipment_id: 'VS-MY260403-2',
    item_name: 'GAN 12 M Leap', category: '3x3', vendor_code: 'MY',
    invoice_qty: 100, unit_price: 198.00, requested_by: 'Nitesh',
    requested_at: '2026-04-12T14:00:00Z', status: 'PENDING',
    ee_done: false, zoho_done: false, shopify_done: false, ee_po_updated: false,
    ee_sku: '', shopify_listing_url: '',
  },
  {
    request_id: 'NSR-004', shipment_id: '',
    item_name: 'YJ MGC Megaminx Magnetic', category: 'Megaminx', vendor_code: 'PW',
    invoice_qty: 150, unit_price: 85.00, requested_by: 'Priya',
    requested_at: '2026-04-13T08:45:00Z', status: 'ACTION_REQ',
    ee_done: true, zoho_done: false, shopify_done: false, ee_po_updated: false,
    ee_sku: 'CUBE-MGC-MEGA-004', shopify_listing_url: '',
  },
  {
    request_id: 'NSR-005', shipment_id: 'VS-QY260404-3',
    item_name: 'QiYi X-Man Tornado V3 Pioneer', category: '3x3', vendor_code: 'QY',
    invoice_qty: 300, unit_price: 72.50, requested_by: 'Arjun',
    requested_at: '2026-04-14T10:20:00Z', status: 'REJECTED',
    ee_done: false, zoho_done: false, shopify_done: false, ee_po_updated: false,
    ee_sku: '', shopify_listing_url: '',
  },
  {
    request_id: 'NSR-006', shipment_id: 'VS-PW260405-1',
    item_name: 'MoYu WeiLong WRM V10 MagLev', category: '3x3', vendor_code: 'PW',
    invoice_qty: 250, unit_price: 135.00, requested_by: 'Nitesh',
    requested_at: '2026-04-15T07:10:00Z', status: 'PENDING',
    ee_done: false, zoho_done: false, shopify_done: false, ee_po_updated: false,
    ee_sku: '', shopify_listing_url: '',
  },
  {
    request_id: 'NSR-007', shipment_id: '',
    item_name: 'QiYi Clock Magnetic', category: 'Clock', vendor_code: 'QY',
    invoice_qty: 120, unit_price: 55.00, requested_by: 'Priya',
    requested_at: '2026-04-16T13:30:00Z', status: 'IN_PROGRESS',
    ee_done: true, zoho_done: false, shopify_done: false, ee_po_updated: false,
    ee_sku: 'CUBE-QY-CLK-007', shopify_listing_url: '',
  },
  {
    request_id: 'NSR-008', shipment_id: 'VS-MY260406-5',
    item_name: 'MoYu AoYan Skewb M', category: 'Skewb', vendor_code: 'MY',
    invoice_qty: 180, unit_price: 42.00, requested_by: 'Arjun',
    requested_at: '2026-04-17T06:00:00Z', status: 'ACTION_REQ',
    ee_done: true, zoho_done: true, shopify_done: true, ee_po_updated: false,
    ee_sku: 'CUBE-AOYAN-SKW-008', shopify_listing_url: 'https://cubelelo.com/products/moyu-aoyan-skewb',
  },
];

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

const formatDate = (iso: string): string => {
  const d = new Date(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const SectionHeader: React.FC<{ emoji: string; title: string; note?: string }> = ({ emoji, title, note }) => (
  <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100 dark:border-gray-700">
    <span className="text-base">{emoji}</span>
    <h2 className="text-sm font-bold text-gray-800 dark:text-white uppercase tracking-wider">{title}</h2>
    {note && <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto">{note}</span>}
  </div>
);

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1 block">
    {children}
  </label>
);

const inputClasses = "w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all";

const readOnlyClasses = "text-sm text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2";

const Spinner: React.FC = () => (
  <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

// ─────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────

export const NewSkuDetail: React.FC<{
  requestId: string;
  onBack: () => void;
}> = ({ requestId, onBack }) => {
  const isNew = requestId === 'NEW';

  // Source data (read-only, from sheet row or blank for manual)
  const [sourceData] = useState<Partial<SkuRequest>>(
    isNew ? {} : MOCK_SKU_REQUESTS.find(r => r.request_id === requestId) ?? {}
  );

  // All editable form fields
  const [form, setForm] = useState<FormData>({
    suggested_sku: '',
    listing_name: sourceData.item_name ?? '',
    variant: '',
    listing_type: '',
    parent_sku: '',
    category: sourceData.category ?? '',
    brand: '',
    mrp: '',
    shopify_selling_price: '',
    shopify_compare_price: '',
    pkg_height_cm: '',
    pkg_length_cm: '',
    pkg_width_cm: '',
    pkg_weight_gm: '',
    product_dims_mm: '',
    nw_gm: '',
    lead_time: '',
    moq: '',
    threshold_qty: '',
    supplier_code: '',
    pack_size: '',
    relevant_tags: '',
    fnsku: '',
    fnsku_status_ee: '',
    remark: '',
    notes: '',
  });

  // Pricing config (fetched from GAS in production)
  const [pricingConfig] = useState<PricingConfig>(MOCK_PRICING_CONFIG);

  // Platform creation status
  const [platformStatus, setPlatformStatus] = useState({
    ee: sourceData.ee_done ?? false,
    zoho: sourceData.zoho_done ?? false,
    shopify: sourceData.shopify_done ?? false,
    ee_po: sourceData.ee_po_updated ?? false,
  });

  // Loading states per step button
  const [loading, setLoading] = useState({
    ee: false, zoho: false, shopify: false, ee_po: false, save: false,
  });

  // Dirty flag
  const [isDirty, setIsDirty] = useState(false);

  // Save feedback
  const [showSaved, setShowSaved] = useState(false);

  // Reject UI
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [rejectRemark, setRejectRemark] = useState('');
  const [isRejected, setIsRejected] = useState(sourceData.status === 'REJECTED');

  // Debug mode (same localStorage key as list view)
  const [debugMode] = useState(
    () => localStorage.getItem('skuDebugMode') === 'true'
  );

  // ─── Derived pricing calculations ───
  const unitPrice = Number(sourceData.unit_price) || 0;
  const landedCost = +(unitPrice * pricingConfig.cny_conv_rate * pricingConfig.shipping_factor).toFixed(2);
  const suggestedMrp = +(landedCost * pricingConfig.mrp_factor).toFixed(2);
  const suggestedSelling = +(landedCost / pricingConfig.margin_factor).toFixed(2);

  const currentSelling = Number(form.shopify_selling_price) || 0;
  const grossMarginPct = currentSelling > 0
    ? +((currentSelling - landedCost) / currentSelling * 100).toFixed(1)
    : 0;
  const profitPerUnit = +(currentSelling - landedCost).toFixed(2);
  const marginWarning = grossMarginPct > 0 && grossMarginPct < 20;

  // Auto-fill pricing when component mounts
  useEffect(() => {
    if (!form.mrp && suggestedMrp > 0) {
      setForm(f => ({
        ...f,
        mrp: suggestedMrp,
        shopify_selling_price: suggestedSelling,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedMrp, suggestedSelling]);

  // Helper to update a form field and mark dirty
  const updateField = (field: keyof FormData, value: any) => {
    setForm(f => ({ ...f, [field]: value }));
    setIsDirty(true);
  };

  // ─── MOCK HANDLERS ───

  // MOCK — replace with GAS: getNextAvailableSku_(category)
  const handleAutoAssignSku = () => {
    const prefix = SKU_CATEGORY_MAP[form.category] || '???';
    updateField('suggested_sku', `${prefix}XXXX (auto-assign pending)`);
  };

  // MOCK — replace with GAS: createSkuOnEasyEcom_(requestId)
  const handleCreateEE = async () => {
    setLoading(l => ({ ...l, ee: true }));
    await new Promise(r => setTimeout(r, 1500));
    setPlatformStatus(p => ({ ...p, ee: true }));
    setLoading(l => ({ ...l, ee: false }));
  };

  // MOCK — replace with GAS: createSkuOnZoho_(requestId)
  const handleCreateZoho = async () => {
    setLoading(l => ({ ...l, zoho: true }));
    await new Promise(r => setTimeout(r, 1500));
    setPlatformStatus(p => ({ ...p, zoho: true }));
    setLoading(l => ({ ...l, zoho: false }));
  };

  // MOCK — replace with GAS: createSkuOnShopify_(requestId)
  const handleCreateShopify = async () => {
    setLoading(l => ({ ...l, shopify: true }));
    await new Promise(r => setTimeout(r, 1500));
    setPlatformStatus(p => ({ ...p, shopify: true }));
    setLoading(l => ({ ...l, shopify: false }));
  };

  // MOCK — replace with GAS: updateEePurchaseOrder_(requestId)
  const handleUpdateEEPO = async () => {
    setLoading(l => ({ ...l, ee_po: true }));
    await new Promise(r => setTimeout(r, 1500));
    setPlatformStatus(p => ({ ...p, ee_po: true }));
    setLoading(l => ({ ...l, ee_po: false }));
  };

  // MOCK — replace with GAS: saveNewSkuDraft_(payload)
  const handleSaveDraft = async () => {
    setLoading(l => ({ ...l, save: true }));
    await new Promise(r => setTimeout(r, 800));
    setIsDirty(false);
    setLoading(l => ({ ...l, save: false }));
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  };

  // MOCK — replace with GAS: rejectSkuRequest_(requestId, remark)
  const handleReject = async () => {
    setIsRejected(true);
    setShowRejectConfirm(false);
    setRejectRemark('');
  };

  // Sequential lock check (debug mode overrides)
  const canDoStep = (step: 'ee' | 'zoho' | 'shopify' | 'ee_po'): boolean => {
    if (debugMode) return true;
    switch (step) {
      case 'ee': return true;
      case 'zoho': return platformStatus.ee;
      case 'shopify': return platformStatus.zoho;
      case 'ee_po': return platformStatus.shopify;
      default: return false;
    }
  };

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto p-6 animate-in fade-in duration-500">

      {/* ─── SECTION 3: PAGE HEADER ─── */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          ← Back to Requests
        </button>
        <span className="text-gray-300 dark:text-gray-600">/</span>
        <span className="text-sm font-semibold text-gray-900 dark:text-white">
          {isNew ? 'New SKU Request' : requestId}
        </span>
        {isDirty && (
          <span className="text-xs text-amber-500 dark:text-amber-400 font-medium ml-2">● Unsaved changes</span>
        )}
        {showSaved && (
          <span className="text-xs text-green-500 dark:text-green-400 font-semibold ml-2 animate-in fade-in duration-300">✓ Saved!</span>
        )}
      </div>

      {/* ─── SECTION 4: TWO-COLUMN LAYOUT ─── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* LEFT: Form sections — 2/3 width */}
        <div className="xl:col-span-2 space-y-6">

          {/* ─── SECTION A: Source Info (read-only) ─── */}
          {!isNew && (
            <Card>
              <SectionHeader emoji="📋" title="Source Info" />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Shipment ID</FieldLabel>
                  <div className={readOnlyClasses}>{sourceData.shipment_id || '—'}</div>
                </div>
                <div>
                  <FieldLabel>Vendor</FieldLabel>
                  <div className={readOnlyClasses}>{sourceData.vendor_code || '—'}</div>
                </div>
                <div>
                  <FieldLabel>Item Name (Invoice)</FieldLabel>
                  <div className={readOnlyClasses}>{sourceData.item_name || '—'}</div>
                </div>
                <div>
                  <FieldLabel>Category</FieldLabel>
                  <div className={readOnlyClasses}>{sourceData.category || '—'}</div>
                </div>
                <div>
                  <FieldLabel>Invoice Qty</FieldLabel>
                  <div className={readOnlyClasses}>{sourceData.invoice_qty ?? '—'}</div>
                </div>
                <div>
                  <FieldLabel>Cost (CNY)</FieldLabel>
                  <div className={readOnlyClasses}>
                    {sourceData.unit_price ? `¥ ${Number(sourceData.unit_price).toFixed(2)}` : '—'}
                  </div>
                </div>
                <div>
                  <FieldLabel>Requested By</FieldLabel>
                  <div className={readOnlyClasses}>{sourceData.requested_by || '—'}</div>
                </div>
                <div>
                  <FieldLabel>Requested At</FieldLabel>
                  <div className={readOnlyClasses}>
                    {sourceData.requested_at ? formatDate(sourceData.requested_at) : '—'}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* ─── SECTION B: Product Identity ─── */}
          <Card>
            <SectionHeader emoji="🏷️" title="Product Identity" />
            <div className="grid grid-cols-2 gap-4">
              {/* Row 1: Suggested SKU (full width) */}
              <div className="col-span-2">
                <FieldLabel>Suggested SKU</FieldLabel>
                <div className="flex gap-2">
                  <input
                    className={inputClasses}
                    value={form.suggested_sku}
                    onChange={e => updateField('suggested_sku', e.target.value)}
                    placeholder="Auto-assigned or manual entry"
                  />
                  <Button
                    variant="secondary"
                    className="text-xs whitespace-nowrap"
                    onClick={handleAutoAssignSku}
                  >
                    Auto-assign
                  </Button>
                </div>
                {form.suggested_sku && form.category && (
                  <p className="text-[10px] text-gray-400 mt-1">
                    Prefix: {SKU_CATEGORY_MAP[form.category] || '???'}
                  </p>
                )}
              </div>

              {/* Row 2: Listing Name (full width) */}
              <div className="col-span-2">
                <FieldLabel>Listing Name</FieldLabel>
                <input
                  className={inputClasses}
                  value={form.listing_name}
                  onChange={e => updateField('listing_name', e.target.value)}
                  placeholder="e.g. MoYu RS3M 2021 Stickerless"
                />
              </div>

              {/* Row 3: Category + Brand */}
              <div>
                <FieldLabel>Category</FieldLabel>
                <select
                  className={inputClasses}
                  value={form.category}
                  onChange={e => {
                    updateField('category', e.target.value);
                    // Auto-assign SKU prefix on category change
                    const prefix = SKU_CATEGORY_MAP[e.target.value] || '???';
                    setForm(f => ({
                      ...f,
                      category: e.target.value,
                      suggested_sku: f.suggested_sku || `${prefix}XXXX`,
                      relevant_tags: e.target.value ? `${e.target.value}, Cubelelo, Speed Cube, Puzzle` : '',
                    }));
                    setIsDirty(true);
                  }}
                >
                  <option value="">Select category...</option>
                  {CATEGORIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>Brand</FieldLabel>
                <input
                  className={inputClasses}
                  value={form.brand}
                  onChange={e => updateField('brand', e.target.value)}
                  placeholder="e.g. MoYu, QiYi, GAN"
                />
              </div>

              {/* Row 4: Listing Type + Variant */}
              <div>
                <FieldLabel>Listing Type</FieldLabel>
                <select
                  className={inputClasses}
                  value={form.listing_type}
                  onChange={e => updateField('listing_type', e.target.value as any)}
                >
                  <option value="">Select...</option>
                  <option value="New Product">New Product</option>
                  <option value="Existing Variant">Existing Variant</option>
                </select>
              </div>
              <div>
                <FieldLabel>Variant</FieldLabel>
                <input
                  className={inputClasses}
                  value={form.variant}
                  onChange={e => updateField('variant', e.target.value)}
                  placeholder="e.g. Stickerless, Black, Magnetic"
                />
              </div>

              {/* Row 5: Parent SKU (conditional) */}
              {form.listing_type === 'Existing Variant' && (
                <div className="col-span-2">
                  <FieldLabel>Parent SKU</FieldLabel>
                  <input
                    className={inputClasses}
                    value={form.parent_sku}
                    onChange={e => updateField('parent_sku', e.target.value)}
                    placeholder="Enter parent SKU code"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    Listing name will be inherited from parent SKU. Changing it updates all variants on Shopify.
                  </p>
                </div>
              )}
            </div>
          </Card>

          {/* ─── SECTION C: Pricing ─── */}
          <Card>
            <SectionHeader emoji="💰" title="Pricing" />
            <div className="grid grid-cols-3 gap-4">
              <div>
                <FieldLabel>MRP (₹)</FieldLabel>
                <input
                  type="number"
                  className={inputClasses}
                  value={form.mrp}
                  onChange={e => updateField('mrp', e.target.value ? Number(e.target.value) : '')}
                  placeholder="0.00"
                />
              </div>
              <div>
                <FieldLabel>Selling Price (₹)</FieldLabel>
                <input
                  type="number"
                  className={inputClasses}
                  value={form.shopify_selling_price}
                  onChange={e => updateField('shopify_selling_price', e.target.value ? Number(e.target.value) : '')}
                  placeholder="0.00"
                />
              </div>
              <div>
                <FieldLabel>Compare at Price (₹)</FieldLabel>
                <input
                  type="number"
                  className={inputClasses}
                  value={form.shopify_compare_price}
                  onChange={e => updateField('shopify_compare_price', e.target.value ? Number(e.target.value) : '')}
                  placeholder="0.00"
                />
              </div>
            </div>
            <p className="text-[10px] text-gray-400 mt-3">
              Based on ¥{unitPrice} × {pricingConfig.cny_conv_rate} × {pricingConfig.shipping_factor} × factor
            </p>
          </Card>

          {/* ─── SECTION D: Physical Specs ─── */}
          <Card>
            <SectionHeader emoji="📦" title="Physical Specs" />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel>Pkg Height (cm)</FieldLabel>
                <input
                  type="number"
                  className={inputClasses}
                  value={form.pkg_height_cm}
                  onChange={e => updateField('pkg_height_cm', e.target.value ? Number(e.target.value) : '')}
                />
              </div>
              <div>
                <FieldLabel>Pkg Length (cm)</FieldLabel>
                <input
                  type="number"
                  className={inputClasses}
                  value={form.pkg_length_cm}
                  onChange={e => updateField('pkg_length_cm', e.target.value ? Number(e.target.value) : '')}
                />
              </div>
              <div>
                <FieldLabel>Pkg Width (cm)</FieldLabel>
                <input
                  type="number"
                  className={inputClasses}
                  value={form.pkg_width_cm}
                  onChange={e => updateField('pkg_width_cm', e.target.value ? Number(e.target.value) : '')}
                />
              </div>
              <div>
                <FieldLabel>Pkg Weight (gm)</FieldLabel>
                <input
                  type="number"
                  className={inputClasses}
                  value={form.pkg_weight_gm}
                  onChange={e => updateField('pkg_weight_gm', e.target.value ? Number(e.target.value) : '')}
                />
              </div>
              <div>
                <FieldLabel>Product Dims (mm)</FieldLabel>
                <input
                  className={inputClasses}
                  value={form.product_dims_mm}
                  onChange={e => updateField('product_dims_mm', e.target.value)}
                  placeholder="e.g. 56×56×56"
                />
              </div>
              <div>
                <FieldLabel>Net Weight (gm)</FieldLabel>
                <input
                  type="number"
                  className={inputClasses}
                  value={form.nw_gm}
                  onChange={e => updateField('nw_gm', e.target.value ? Number(e.target.value) : '')}
                />
              </div>
            </div>
          </Card>

          {/* ─── SECTION E: Additional EE Fields ─── */}
          <Card>
            <SectionHeader emoji="⚙️" title="EasyEcom Additional Fields" note="(Optional — can be updated after SKU creation)" />
            <div className="grid grid-cols-3 gap-4">
              <div>
                <FieldLabel>Lead Time (days)</FieldLabel>
                <input
                  type="number"
                  className={inputClasses}
                  value={form.lead_time}
                  onChange={e => updateField('lead_time', e.target.value ? Number(e.target.value) : '')}
                />
              </div>
              <div>
                <FieldLabel>MOQ</FieldLabel>
                <input
                  type="number"
                  className={inputClasses}
                  value={form.moq}
                  onChange={e => updateField('moq', e.target.value ? Number(e.target.value) : '')}
                />
              </div>
              <div>
                <FieldLabel>Threshold Qty</FieldLabel>
                <input
                  type="number"
                  className={inputClasses}
                  value={form.threshold_qty}
                  onChange={e => updateField('threshold_qty', e.target.value ? Number(e.target.value) : '')}
                />
              </div>
              <div>
                <FieldLabel>Supplier Code</FieldLabel>
                <input
                  className={inputClasses}
                  value={form.supplier_code}
                  onChange={e => updateField('supplier_code', e.target.value)}
                />
              </div>
              <div>
                <FieldLabel>Pack Size</FieldLabel>
                <input
                  type="number"
                  className={inputClasses}
                  value={form.pack_size}
                  onChange={e => updateField('pack_size', e.target.value ? Number(e.target.value) : '')}
                />
              </div>
            </div>
          </Card>

          {/* ─── SECTION F: Listing & Content ─── */}
          <Card>
            <SectionHeader emoji="🏪" title="Listing & Content" />
            <div className="space-y-4">
              <div>
                <FieldLabel>Relevant Tags</FieldLabel>
                <textarea
                  className={inputClasses}
                  rows={3}
                  value={form.relevant_tags}
                  onChange={e => updateField('relevant_tags', e.target.value)}
                  placeholder="Tags auto-filled based on category. Edit as needed."
                />
                <p className="text-[10px] text-gray-400 mt-1">Separate with commas</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>FNSKU</FieldLabel>
                  <input
                    className={inputClasses}
                    value={form.fnsku}
                    onChange={e => updateField('fnsku', e.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel>FNSKU Status on EE</FieldLabel>
                  <input
                    className={inputClasses}
                    value={form.fnsku_status_ee}
                    onChange={e => updateField('fnsku_status_ee', e.target.value)}
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* ─── SECTION G: Remarks ─── */}
          <Card>
            <SectionHeader emoji="📝" title="Remarks & Notes" />
            <div className="space-y-4">
              <div>
                <FieldLabel>Internal Remark</FieldLabel>
                <textarea
                  className={inputClasses}
                  rows={2}
                  value={form.remark}
                  onChange={e => updateField('remark', e.target.value)}
                />
              </div>
              <div>
                <FieldLabel>Notes</FieldLabel>
                <textarea
                  className={inputClasses}
                  rows={2}
                  value={form.notes}
                  onChange={e => updateField('notes', e.target.value)}
                />
              </div>
            </div>
          </Card>
        </div>

        {/* ─── RIGHT COLUMN: Status panel — 1/3 width ─── */}
        <div className="xl:col-span-1 space-y-4">

          {/* ─── A: Margin Calculator ─── */}
          <Card>
            <SectionHeader emoji="💹" title="Margin Calculator" />
            <div className="space-y-0">
              <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700/50">
                <span className="text-xs text-gray-500 dark:text-gray-400">Landed Cost (INR)</span>
                <span className="text-sm font-mono text-gray-900 dark:text-white">₹{landedCost}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700/50">
                <span className="text-xs text-gray-500 dark:text-gray-400">MRP</span>
                <span className="text-sm font-mono text-gray-900 dark:text-white">₹{Number(form.mrp) || 0}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700/50">
                <span className="text-xs text-gray-500 dark:text-gray-400">Selling Price</span>
                <span className="text-sm font-mono text-gray-900 dark:text-white">₹{Number(form.shopify_selling_price) || 0}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700/50">
                <span className="text-xs text-gray-500 dark:text-gray-400">Profit / Unit</span>
                <span className={`text-sm font-mono font-semibold ${profitPerUnit > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                  ₹{profitPerUnit}
                </span>
              </div>
            </div>

            {/* Margin % display */}
            <div className={`mt-4 p-3 rounded-xl text-center ${marginWarning ? 'bg-red-50 dark:bg-red-900/20' : 'bg-green-50 dark:bg-green-900/20'}`}>
              <p className={`text-3xl font-bold ${marginWarning ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                {grossMarginPct}%
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Gross Margin</p>
              {marginWarning && (
                <p className="text-xs text-red-500 font-semibold mt-2 flex items-center justify-center gap-1">
                  <ExclamationTriangleIcon className="w-3 h-3" /> Below 20% minimum threshold
                </p>
              )}
            </div>
          </Card>

          {/* ─── B: Platform Status ─── */}
          <Card>
            <SectionHeader emoji="🏭" title="Creation Status" />
            <div className="space-y-0">
              {/* EasyEcom */}
              <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-700/50">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded">E</span>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">EasyEcom</span>
                </div>
                {platformStatus.ee ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                    <CheckBadgeIcon className="w-4 h-4" /> Done
                  </span>
                ) : (
                  <span className="text-xs text-gray-400 dark:text-gray-500">Pending</span>
                )}
              </div>
              {/* Zoho */}
              <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-700/50">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded">Z</span>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Zoho</span>
                </div>
                {platformStatus.zoho ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                    <CheckBadgeIcon className="w-4 h-4" /> Done
                  </span>
                ) : (
                  <span className="text-xs text-gray-400 dark:text-gray-500">Pending</span>
                )}
              </div>
              {/* Shopify */}
              <div className="flex items-center justify-between py-3 border-b border-gray-100 dark:border-gray-700/50">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded">S</span>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Shopify</span>
                </div>
                {platformStatus.shopify ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                    <CheckBadgeIcon className="w-4 h-4" /> Done
                  </span>
                ) : (
                  <span className="text-xs text-gray-400 dark:text-gray-500">Pending</span>
                )}
              </div>
              {/* EE PO — only if there's a shipment */}
              {sourceData.shipment_id && (
                <div className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded">PO</span>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">EE Purchase Order</span>
                  </div>
                  {platformStatus.ee_po ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                      <CheckBadgeIcon className="w-4 h-4" /> Done
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400 dark:text-gray-500">Pending</span>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* ─── C: Action Buttons ─── */}
          <Card>
            <SectionHeader emoji="⚡" title="Actions" />
            <div className="space-y-2">
              {/* Step 1: EasyEcom */}
              {platformStatus.ee ? (
                <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-green-50 dark:bg-green-900/20">
                  <CheckBadgeIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
                  <span className="text-xs font-semibold text-green-600 dark:text-green-400">EasyEcom — Done</span>
                </div>
              ) : (
                <Button
                  variant="primary"
                  className="w-full text-xs"
                  disabled={!canDoStep('ee') || loading.ee}
                  onClick={handleCreateEE}
                  title={!canDoStep('ee') ? 'Complete previous step first' : ''}
                >
                  {loading.ee ? <Spinner /> : <ChevronRightIcon className="w-4 h-4 mr-1" />}
                  Create on EasyEcom
                </Button>
              )}

              {/* Step 2: Zoho */}
              {platformStatus.zoho ? (
                <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-green-50 dark:bg-green-900/20">
                  <CheckBadgeIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
                  <span className="text-xs font-semibold text-green-600 dark:text-green-400">Zoho — Done</span>
                </div>
              ) : (
                <Button
                  variant="primary"
                  className={`w-full text-xs ${!canDoStep('zoho') && !loading.zoho ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={!canDoStep('zoho') || loading.zoho}
                  onClick={handleCreateZoho}
                  title={!canDoStep('zoho') ? 'Complete previous step first' : ''}
                >
                  {loading.zoho ? <Spinner /> : <ChevronRightIcon className="w-4 h-4 mr-1" />}
                  Create on Zoho
                </Button>
              )}

              {/* Step 3: Shopify */}
              {platformStatus.shopify ? (
                <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-green-50 dark:bg-green-900/20">
                  <CheckBadgeIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
                  <span className="text-xs font-semibold text-green-600 dark:text-green-400">Shopify — Done</span>
                </div>
              ) : (
                <Button
                  variant="primary"
                  className={`w-full text-xs ${!canDoStep('shopify') && !loading.shopify ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={!canDoStep('shopify') || loading.shopify}
                  onClick={handleCreateShopify}
                  title={!canDoStep('shopify') ? 'Complete previous step first' : ''}
                >
                  {loading.shopify ? <Spinner /> : <ChevronRightIcon className="w-4 h-4 mr-1" />}
                  Create on Shopify
                </Button>
              )}

              {/* Step 4: EE PO — only if shipment exists */}
              {sourceData.shipment_id && (
                platformStatus.ee_po ? (
                  <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-green-50 dark:bg-green-900/20">
                    <CheckBadgeIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
                    <span className="text-xs font-semibold text-green-600 dark:text-green-400">EE Purchase Order — Done</span>
                  </div>
                ) : (
                  <Button
                    variant="primary"
                    className={`w-full text-xs ${!canDoStep('ee_po') && !loading.ee_po ? 'opacity-50 cursor-not-allowed' : ''}`}
                    disabled={!canDoStep('ee_po') || loading.ee_po}
                    onClick={handleUpdateEEPO}
                    title={!canDoStep('ee_po') ? 'Complete previous step first' : ''}
                  >
                    {loading.ee_po ? <Spinner /> : <ChevronRightIcon className="w-4 h-4 mr-1" />}
                    Update EE PO
                  </Button>
                )
              )}

              {/* Divider */}
              <div className="border-t border-gray-100 dark:border-gray-700 my-3" />

              {/* Save Draft */}
              <Button
                variant="secondary"
                className="w-full text-xs"
                disabled={!isDirty || loading.save}
                onClick={handleSaveDraft}
              >
                {loading.save ? <Spinner /> : null}
                {isDirty ? 'Save Draft' : 'No Changes'}
              </Button>

              {/* Reject Request */}
              {!isNew && !isRejected && sourceData.status !== 'REJECTED' && (
                <>
                  <Button
                    variant="danger"
                    className="w-full text-xs"
                    onClick={() => setShowRejectConfirm(prev => !prev)}
                  >
                    <XMarkIcon className="w-4 h-4 mr-1" />
                    Reject Request
                  </Button>

                  {showRejectConfirm && (
                    <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800/50 space-y-2 animate-in slide-in-from-top-1 duration-200">
                      <textarea
                        className={`${inputClasses} !bg-white dark:!bg-gray-800`}
                        rows={2}
                        placeholder="Reason for rejection..."
                        value={rejectRemark}
                        onChange={e => setRejectRemark(e.target.value)}
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          variant="danger"
                          className="text-xs flex-1"
                          onClick={handleReject}
                          disabled={!rejectRemark.trim()}
                        >
                          Confirm Reject
                        </Button>
                        <button
                          onClick={() => { setShowRejectConfirm(false); setRejectRemark(''); }}
                          className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Rejected status */}
              {isRejected && (
                <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-red-50 dark:bg-red-900/20">
                  <XMarkIcon className="w-4 h-4 text-red-500" />
                  <span className="text-xs font-semibold text-red-600 dark:text-red-400">Request Rejected</span>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ─── SECTION 7: DEBUG PANEL ─── */}
      {debugMode && (
        <Card className="border-2 border-amber-400 dark:border-amber-600 !p-4">
          <div className="flex items-center gap-2 mb-3">
            <ExclamationTriangleIcon className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
              🐛 Debug Panel
            </span>
            <span className="text-[10px] text-amber-400 dark:text-amber-500 ml-auto">
              In debug mode, step buttons can be triggered regardless of sequential lock
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4 text-xs font-mono">
            <div>
              <p className="text-gray-500 dark:text-gray-400 mb-1">Form State:</p>
              <pre className="bg-gray-100 dark:bg-gray-900 rounded p-2 text-gray-700 dark:text-gray-300 text-[10px] overflow-auto max-h-48">
                {JSON.stringify(form, null, 2)}
              </pre>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400 mb-1">Platform Status:</p>
              <pre className="bg-gray-100 dark:bg-gray-900 rounded p-2 text-gray-700 dark:text-gray-300 text-[10px] overflow-auto max-h-24">
                {JSON.stringify(platformStatus, null, 2)}
              </pre>
              <p className="text-gray-500 dark:text-gray-400 mb-1 mt-2">Pricing:</p>
              <pre className="bg-gray-100 dark:bg-gray-900 rounded p-2 text-gray-700 dark:text-gray-300 text-[10px] overflow-auto max-h-24">
                {JSON.stringify({ landedCost, suggestedMrp, suggestedSelling, grossMarginPct, profitPerUnit }, null, 2)}
              </pre>
            </div>
            <div>
              <p className="text-gray-500 dark:text-gray-400 mb-1">Source Data:</p>
              <pre className="bg-gray-100 dark:bg-gray-900 rounded p-2 text-gray-700 dark:text-gray-300 text-[10px] overflow-auto max-h-48">
                {JSON.stringify(sourceData, null, 2)}
              </pre>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

/*
  GAS INTEGRATION — PHASE 2
  
  On mount: fetch({ action: 'getNewSkuRequestById', request_id: requestId })
  On category change: fetch({ action: 'getNextAvailableSku', 
                              product_type: form.category })
                      → sets form.suggested_sku
  On category change: fetch({ action: 'getTagsByProductType', 
                              product_type: form.category })
                      → sets form.relevant_tags
  On Save Draft: fetch({ action: 'saveNewSkuDraft', payload: { ...form } })
  Step 1: fetch({ action: 'createSkuOnEasyEcom', request_id: requestId })
  Step 2: fetch({ action: 'createSkuOnZoho', request_id: requestId })
  Step 3: fetch({ action: 'createSkuOnShopify', request_id: requestId })
  Step 4: fetch({ action: 'updateEePurchaseOrder', request_id: requestId })
  
  All: POST to VITE_GAS_URL, Content-Type: text/plain;charset=utf-8
  Pricing config: fetch({ action: 'getPricingConfig' }) on mount
*/
