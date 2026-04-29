import React, { useState, useEffect, useMemo } from 'react';
import { APPS_SCRIPT_URL, API_ACTIONS } from '../../App';
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
  // Source Info (manual entry)
  ean:        string;
  unit_price: number | '';
  invoice_qty: number | '';
  vendor_code: string;
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
  cny_conv_rate:      number;
  sea_multiplier:     number;
  air_multiplier:     number;
  pick_pack:          number;
  min_margin_pct:     number;
  marketing_cost_pct: number;
}

const MOCK_PRICING_CONFIG: PricingConfig = {
  cny_conv_rate:      12.5,
  sea_multiplier:     1.33,
  air_multiplier:     1.25,
  pick_pack:          75,
  min_margin_pct:     20,
  marketing_cost_pct: 26,
};

interface ComboBoxProps {
  value:       string;
  onChange:    (val: string) => void;
  options:     string[];
  placeholder: string;
  id:          string;
}

const ComboBox: React.FC<ComboBoxProps> = ({
  value, onChange, options, placeholder, id
}) => {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const containerRef      = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current &&
          !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = query
    ? options.filter(o => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          id={id}
          type="text"
          value={open ? query : value}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); setQuery(''); }}
          placeholder={placeholder}
          className="w-full text-sm bg-white dark:bg-gray-700
                     border border-gray-200 dark:border-gray-600
                     rounded-lg px-3 py-2 pr-8 text-gray-900
                     dark:text-white focus:outline-none
                     focus:ring-2 focus:ring-blue-500 transition-all" />
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="absolute right-2 top-2.5 text-gray-400
                     hover:text-gray-600 dark:hover:text-gray-300">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24"
               stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round"
                  strokeWidth={2}
                  d={open ? "M5 15l7-7 7 7" : "M19 9l-7 7-7-7"} />
          </svg>
        </button>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-52
                        overflow-y-auto bg-white dark:bg-gray-800
                        border border-gray-200 dark:border-gray-700
                        rounded-lg shadow-lg">
          {query && !options.find(
            o => o.toLowerCase() === query.toLowerCase()
          ) && (
            <button
              type="button"
              onClick={() => { onChange(query); setOpen(false); setQuery(''); }}
              className="w-full text-left px-3 py-2 text-sm
                         text-blue-600 dark:text-blue-400
                         hover:bg-gray-50 dark:hover:bg-gray-700
                         border-b border-gray-100 dark:border-gray-700">
              + Use "{query}"
            </button>
          )}
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">No options found</p>
          ) : (
            filtered.map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => { onChange(opt); setOpen(false); setQuery(''); }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors
                            ${value === opt
                              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-semibold'
                              : 'text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700'
                            }`}>
                {opt}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const CATEGORIES = [
  '2x2','3x3','4x4','5x5','6x6','7x7',
  'Accessory','Big Cubes','Clock','Design',
  'Event Equipment','Events','Gift Box','Kreativity',
  'Learn','Lubricant','Megaminx','Mirror','Other',
  'Other Puzzles','Pyraminx','SERVICE','Shape Mod',
  'Skewb','Snake','Square-1','Timer and Mat',
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
  const [sourceData, setSourceData] = useState<Partial<SkuRequest>>({});
  const [isLoadingSource, setIsLoadingSource] = useState(!isNew);

  // All editable form fields
  const [form, setForm] = useState<FormData>({
    ean:        '',
    unit_price: '',
    invoice_qty: '',
    vendor_code: '',
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

  useEffect(() => {
    if (isNew) return;
    const fetchRequest = async () => {
      setIsLoadingSource(true);
      try {
        const response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: API_ACTIONS.GET_NEW_SKU_REQUEST_BY_ID,
            request_id: requestId
          })
        });
        const result = await response.json();
        if (result.success) {
          setSourceData(result.data);
          // Pre-fill platform status from loaded data
          setPlatformStatus({
            ee:       !!result.data.ee_sku,
            zoho:     !!result.data.zoho_created_date,
            shopify:  !!result.data.shopify_listing_url,
            ee_po:    result.data.status === 'CREATED',
          });
          // Pre-fill editable form fields from saved data
          setForm(f => ({
            ...f,
            suggested_sku:         result.data.suggested_sku        || '',
            listing_name:          result.data.listing_name         || result.data.item_name || '',
            variant:               result.data.variant              || '',
            listing_type:          result.data.listing_type         || '',
            parent_sku:            result.data.parent_sku           || '',
            category:              result.data.category             || '',
            brand:                 result.data.brand                || '',
            mrp:                   result.data.mrp                  || '',
            shopify_selling_price: result.data.shopify_selling_price|| '',
            shopify_compare_price: result.data.shopify_compare_price|| '',
            pkg_height_cm:         result.data.pkg_height_cm        || '',
            pkg_length_cm:         result.data.pkg_length_cm        || '',
            pkg_width_cm:          result.data.pkg_width_cm         || '',
            pkg_weight_gm:         result.data.pkg_weight_gm        || '',
            product_dims_mm:       result.data.product_dims_mm      || '',
            nw_gm:                 result.data.nw_gm                || '',
            relevant_tags:         result.data.relevant_tags        || '',
            fnsku:                 result.data.fnsku                || '',
            fnsku_status_ee:       result.data.fnsku_status_ee      || '',
            remark:                result.data.remark               || '',
            notes:                 result.data.notes                || '',
            lead_time:             result.data.lead_time            || '',
            moq:                   result.data.moq                  || '',
            threshold_qty:         result.data.threshold_qty        || '',
            supplier_code:         result.data.supplier_code        || '',
            pack_size:             result.data.pack_size            || '',
          }));
        }
      } catch (err) {
        console.error('fetchRequest error:', err);
      } finally {
        setIsLoadingSource(false);
      }
    };
    fetchRequest();
  }, [requestId, isNew]);

  // Pricing config (fetched from GAS in production)
  const [pricingConfig, setPricingConfig] = useState<PricingConfig>(MOCK_PRICING_CONFIG);

  useEffect(() => {
    const fetchPricingConfig = async () => {
      try {
        const response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: API_ACTIONS.GET_PRICING_CONFIG })
        });
        const result = await response.json();
        if (result.success) {
          // Reset auto-fill flag so pricing recalculates
          // with real config values from sheet
          pricingAutoFilled.current = false;
          setPricingConfig({ ...MOCK_PRICING_CONFIG, ...result.data });
        }
      } catch (err) {
        console.error('fetchPricingConfig error:', err);
      }
    };
    fetchPricingConfig();
  }, []);

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const bRes = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: API_ACTIONS.GET_BRANDS })
        });
        const bResult = await bRes.json();
        if (bResult.success) setBrandOptions(bResult.data);

        const vRes = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: API_ACTIONS.GET_VARIANTS })
        });
        const vResult = await vRes.json();
        if (vResult.success) setVariantOptions(vResult.data);
      } catch(err) {
        console.error('fetchOptions error:', err);
      }
    };
    fetchOptions();
  }, []);

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
  const [skuAssigning, setSkuAssigning] = useState(false);

  // Dirty flag
  const [isDirty, setIsDirty] = useState(false);

  // Save feedback
  const [showSaved, setShowSaved] = useState(false);

  // Reject UI
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [rejectRemark, setRejectRemark] = useState('');
  const [isRejected, setIsRejected] = useState(sourceData.status === 'REJECTED');

  // Parent SKU lookup
  const [parentSkuDetails, setParentSkuDetails] = useState<{
    parent_product_name: string;
    parent_product_id:   string;
  } | null>(null);
  const [parentSkuLoading, setParentSkuLoading] = useState(false);
  const [parentSkuError, setParentSkuError]     = useState<string | null>(null);

  const [brandOptions, setBrandOptions]     = useState<string[]>([]);
  const [variantOptions, setVariantOptions] = useState<string[]>([]);

  // Debug mode (same localStorage key as list view)
  const [debugMode] = useState(
    () => localStorage.getItem('skuDebugMode') === 'true'
  );

  // Helper to update a form field and mark dirty
  const updateField = (field: keyof FormData, value: any) => {
    setForm(f => ({ ...f, [field]: value }));
    setIsDirty(true);
  };

  // ─── Derived pricing calculations ───
  const calcPricing = (rmbPrice: number, config: PricingConfig) => {
    if (!rmbPrice || !config) return null;

    // Guard — if config keys are missing return null not NaN
    if (!config.sea_multiplier || !config.air_multiplier ||
        !config.cny_conv_rate) return null;

    // Step 1: Landing — SEA if RMB ≤ 30, AIR if RMB > 30
    const multiplier = rmbPrice <= 30
      ? config.sea_multiplier
      : config.air_multiplier;
    const landing = rmbPrice * config.cny_conv_rate * multiplier;

    // Step 2: CM1 target based on landing price
    let cm1: number;
    if      (landing <= 500)  cm1 = 0.50;
    else if (landing <= 1250) cm1 = 0.47;
    else if (landing <= 2000) cm1 = 0.44;
    else                      cm1 = 0.41;

    // Step 3: Raw selling price
    const rawSP = (landing / (1 - cm1)) * 1.05 + config.pick_pack;

    // Step 4: Bucket SP — nearest ₹100 ending in 99
    const bucketSP = Math.round(rawSP / 100) * 100 - 1;

    // Step 5: Floor SP — minimum price at 40% CM1
    const floorSP = (landing / 0.6) * 1.05 + config.pick_pack;

    // Step 6: Final SP — max of bucket and floor
    const finalSP = Math.max(bucketSP, Math.ceil(floorSP));

    // Step 7: MRP from final SP using discount bracket logic
    let mrp: number;
    if      (finalSP <= 500)  mrp = finalSP / 0.6;
    else if (finalSP <= 1000) mrp = finalSP / 0.65;
    else if (finalSP <= 1500) mrp = finalSP / 0.7;
    else if (finalSP <= 2000) mrp = finalSP / 0.75;
    else                      mrp = finalSP / 0.8;
    // Round to nearest 50, subtract 1 → ends in 49 or 99
    // Examples: 1383 → 1400-1 = 1399, 1325 → 1350-1 = 1349
    mrp = Math.round(mrp / 50) * 50 - 1;

    // Step 8: Actual CM1
    const netSales  = finalSP / 1.05;
    const actualCM1 = ((netSales - landing) / netSales) * 100;

    return {
      landing:    Math.round(landing),
      cm1_target: Math.round(cm1 * 100),
      raw_sp:     Math.round(rawSP),
      bucket_sp:  Math.round(bucketSP),
      floor_sp:   Math.ceil(floorSP),
      final_sp:   Math.round(finalSP),
      mrp,
      actual_cm1: Math.round(actualCM1 * 100) / 100,
      mode:       rmbPrice <= 30 ? 'SEA' : 'AIR',
    };
  };

  const unitPrice = isNew
    ? Number(form.unit_price) || 0
    : Number(sourceData.unit_price) || 0;
  const pricing   = useMemo(
    () => calcPricing(unitPrice, pricingConfig),
    [unitPrice, pricingConfig]
  );

  // Track whether we have auto-filled pricing already
  const pricingAutoFilled = React.useRef(false);

  useEffect(() => {
    if (!pricing) return;
    // Only auto-fill once — on first successful pricing calculation
    // After that, user's manual overrides are preserved
    if (pricingAutoFilled.current) return;
    pricingAutoFilled.current = true;
    setForm(f => ({
      ...f,
      mrp:                   pricing.mrp,
      shopify_selling_price: pricing.final_sp,
    }));
  }, [pricing]);

  const currentSP    = Number(form.shopify_selling_price) || 0;
  const currentMRP   = Number(form.mrp) || 0;
  const landedCost   = pricing?.landing || 0;
  const marketingPct = pricingConfig.marketing_cost_pct || 26;
  const pickPack     = pricingConfig.pick_pack || 75;

  // CM1 — Gross margin after landing cost (ex-GST)
  const netSales      = currentSP > 0 ? currentSP / 1.05 : 0;
  const cm1Profit     = netSales - landedCost;
  const actualCM1Live = netSales > 0
    ? (cm1Profit / netSales) * 100
    : (pricing?.actual_cm1 || 0);

  // CM2 — After marketing cost (% of Selling Price)
  const marketingCost = currentSP * (marketingPct / 100);
  const cm2Profit     = cm1Profit - marketingCost;
  const actualCM2     = netSales > 0 ? (cm2Profit / netSales) * 100 : 0;

  // CM3 — After pick & pack
  const cm3Profit = cm2Profit - pickPack;
  const actualCM3 = netSales > 0 ? (cm3Profit / netSales) * 100 : 0;

  const marginWarning = actualCM1Live > 0 &&
    actualCM1Live < (pricingConfig.min_margin_pct || 20);

  const lastLookedUpSku = React.useRef<string>('');

  useEffect(() => {
    const sku = form.parent_sku?.trim();

    // Clear state if conditions not met
    if (!sku || form.listing_type !== 'Existing Variant') {
      setParentSkuDetails(null);
      setParentSkuError(null);
      lastLookedUpSku.current = '';
      return;
    }

    // Skip if we already looked up this exact SKU
    if (lastLookedUpSku.current === sku) return;

    const fetchParent = async () => {
      setParentSkuLoading(true);
      setParentSkuError(null);
      try {
        const response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action:     API_ACTIONS.GET_PARENT_SKU_DETAILS,
            parent_sku: sku
          })
        });
        const result = await response.json();
        if (result.success) {
          lastLookedUpSku.current = sku; // mark as looked up
          setParentSkuDetails(result.data);
          // Directly update form state — bypass updateField
          // to avoid triggering isDirty on auto-fill
          setForm(f => ({
            ...f,
            listing_name: result.data.parent_product_name
          }));
        } else {
          setParentSkuError(result.error);
          setParentSkuDetails(null);
        }
      } catch(err) {
        setParentSkuError('Network error');
      } finally {
        setParentSkuLoading(false);
      }
    };

    const timer = setTimeout(fetchParent, 600);
    return () => clearTimeout(timer);
  }, [form.parent_sku, form.listing_type]);

  // ─── HANDLERS ───

  const handleAutoAssignSku = async () => {
    if (!form.category) return;
    setSkuAssigning(true);
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action:   API_ACTIONS.GET_NEXT_AVAILABLE_SKU,
          category: form.category
        })
      });
      const result = await response.json();
      if (result.success) {
        updateField('suggested_sku', result.data.suggested_sku);
        if (result.data.warning) alert(result.data.warning);
      } else {
        alert('SKU assignment failed: ' + result.error);
      }
    } catch (err) {
      console.error('handleAutoAssignSku error:', err);
      alert('Network error during SKU assignment');
    } finally {
      setSkuAssigning(false);
    }
  };

  useEffect(() => {
    if (!form.category) return;
    const fetchTags = async () => {
      try {
        const response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action:   API_ACTIONS.GET_TAGS_BY_CATEGORY,
            category: form.category
          })
        });
        const result = await response.json();
        if (result.success && result.data.tags) {
          // Only pre-fill if tags field is currently empty
          if (!form.relevant_tags) {
            updateField('relevant_tags', result.data.tags);
          }
        }
      } catch (err) {
        console.error('fetchTags error:', err);
      }
    };
    fetchTags();
  }, [form.category]);

  const handleSaveDraft = async () => {
    setLoading(l => ({ ...l, save: true }));
    try {
      const requestIdToUse = isNew
        ? await handleCreateManualFirst()
        : requestId;
      if (!requestIdToUse) return;

      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action:     API_ACTIONS.SAVE_NEW_SKU_DRAFT,
          request_id: requestIdToUse,
          edited_by:  'user', // replace with user?.name if passed as prop
          form,
        })
      });
      const result = await response.json();
      if (result.success) {
        setIsDirty(false);
        console.log('Draft saved:', result.data);
        setShowSaved(true);
        setTimeout(() => setShowSaved(false), 2000);
      } else {
        alert('Save failed: ' + result.error);
      }
    } catch (err) {
      console.error('handleSaveDraft error:', err);
      alert('Network error saving draft');
    } finally {
      setLoading(l => ({ ...l, save: false }));
    }
  };

  // Helper: create manual request first if this is a new entry
  const handleCreateManualFirst = async (): Promise<string | null> => {
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action:     API_ACTIONS.CREATE_MANUAL_SKU,
          created_by:  'user',
          form,
        })
      });
      const result = await response.json();
      if (result.success) return result.data.request_id;
      alert('Failed to create request: ' + result.error);
      return null;
    } catch (err) {
      console.error('handleCreateManualFirst error:', err);
      return null;
    }
  };

  // STEP 1 — EasyEcom
  const handleCreateEE = async () => {
    setLoading(l => ({ ...l, ee: true }));
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action:     API_ACTIONS.CREATE_SKU_ON_EE,
          request_id: requestId
        })
      });
      const result = await response.json();
      if (result.success) {
        setPlatformStatus(p => ({ ...p, ee: true }));
        // Refresh source data to get ee_sku written back
        setSourceData(d => ({ ...d, ee_sku: result.data.ee_sku }));
      } else {
        alert('EasyEcom creation failed: ' + result.error);
      }
    } catch (err) {
      alert('Network error');
      console.error(err);
    } finally {
      setLoading(l => ({ ...l, ee: false }));
    }
  };

  // STEP 2 — Zoho
  const handleCreateZoho = async () => {
    setLoading(l => ({ ...l, zoho: true }));
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action:     API_ACTIONS.CREATE_SKU_ON_ZOHO,
          request_id: requestId
        })
      });
      const result = await response.json();
      if (result.success) {
        setPlatformStatus(p => ({ ...p, zoho: true }));
      } else {
        alert('Zoho creation failed: ' + result.error);
      }
    } catch (err) {
      alert('Network error');
      console.error(err);
    } finally {
      setLoading(l => ({ ...l, zoho: false }));
    }
  };

  // STEP 3 — Shopify
  const handleCreateShopify = async () => {
    setLoading(l => ({ ...l, shopify: true }));
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action:     API_ACTIONS.CREATE_SKU_ON_SHOPIFY,
          request_id: requestId
        })
      });
      const result = await response.json();
      if (result.success) {
        setPlatformStatus(p => ({ ...p, shopify: true }));
        if (result.data.shopify_listing_url) {
          setSourceData(d => ({ 
            ...d, 
            shopify_listing_url: result.data.shopify_listing_url 
          }));
        }
      } else {
        alert('Shopify creation failed: ' + result.error);
      }
    } catch (err) {
      alert('Network error');
      console.error(err);
    } finally {
      setLoading(l => ({ ...l, shopify: false }));
    }
  };

  // STEP 4 — Update EE PO
  const handleUpdateEEPO = async () => {
    setLoading(l => ({ ...l, ee_po: true }));
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action:     API_ACTIONS.UPDATE_EE_PO,
          request_id: requestId,
          updated_by: 'user'
        })
      });
      const result = await response.json();
      if (result.success) {
        setPlatformStatus(p => ({ ...p, ee_po: true }));
      } else {
        alert('EE PO update failed: ' + result.error);
      }
    } catch (err) {
      alert('Network error');
      console.error(err);
    } finally {
      setLoading(l => ({ ...l, ee_po: false }));
    }
  };

  const handleConfirmReject = async (remark: string) => {
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action:      API_ACTIONS.REJECT_SKU_REQUEST,
          request_id:  requestId,
          remark,
          rejected_by: 'user'
        })
      });
      const result = await response.json();
      if (result.success) {
        setSourceData(d => ({ ...d, status: 'REJECTED' }));
        onBack(); // navigate back to list
      } else {
        alert('Reject failed: ' + result.error);
      }
    } catch (err) {
      alert('Network error');
      console.error(err);
    }
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
    <div className="max-w-[1600px] mx-auto p-6 flex flex-col h-screen overflow-hidden animate-in fade-in duration-500">

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
      <div className="flex gap-6 h-[calc(100vh-120px)]">

        {/* LEFT column — independently scrollable */}
        <div className="flex-1 overflow-y-auto pr-2 space-y-6 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600">

          {/* ─── SECTION A: Source Info ─── */}
          {!isNew ? (
            // ── Shipment-based: read-only Source Info ──
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
                    {sourceData.unit_price
                      ? `¥ ${Number(sourceData.unit_price).toFixed(2)}`
                      : '—'}
                  </div>
                </div>
                <div>
                  <FieldLabel>EAN / UPC</FieldLabel>
                  <div className={readOnlyClasses}>{sourceData.ean || '—'}</div>
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
          ) : (
            // ── Manual entry: editable Source Info ──
            <Card>
              <SectionHeader emoji="📋" title="Basic Info" />
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
                Fill in the basic product details. These will be saved to the
                SKU request sheet as a reference.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>EAN / UPC</FieldLabel>
                  <input
                    type="text"
                    className={inputClasses}
                    value={form.ean}
                    onChange={e => updateField('ean', e.target.value)}
                    placeholder="e.g. 6954256109533"
                  />
                </div>
                <div>
                  <FieldLabel>Cost (RMB ¥)</FieldLabel>
                  <input
                    type="number"
                    className={inputClasses}
                    value={form.unit_price}
                    onChange={e => updateField('unit_price',
                      e.target.value ? Number(e.target.value) : ''
                    )}
                    placeholder="e.g. 48.50"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    Used to calculate landing cost and suggested pricing
                  </p>
                </div>
                <div>
                  <FieldLabel>Invoice Qty</FieldLabel>
                  <input
                    type="number"
                    className={inputClasses}
                    value={form.invoice_qty ?? 0}
                    onChange={e => updateField('invoice_qty',
                      e.target.value ? Number(e.target.value) : 0
                    )}
                    placeholder="0"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    Set to 0 if no shipment yet
                  </p>
                </div>
                <div>
                  <FieldLabel>Vendor (optional)</FieldLabel>
                  <input
                    type="text"
                    className={inputClasses}
                    value={form.vendor_code ?? ''}
                    onChange={e => updateField('vendor_code', e.target.value)}
                    placeholder="e.g. PW, QY, MY"
                  />
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
                  <button
                    onClick={handleAutoAssignSku}
                    disabled={skuAssigning || !form.category}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold
                                transition-all flex items-center gap-2
                                ${skuAssigning || !form.category
                                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                                  : 'bg-blue-600 hover:bg-blue-700 text-white'
                                }`}>
                    {skuAssigning ? (
                      <>
                        <svg className="w-3.5 h-3.5 animate-spin"
                             fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10"
                                  stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Assigning...
                      </>
                    ) : (
                      'Auto-assign'
                    )}
                  </button>
                </div>
              </div>

              {/* Row 2: Listing Name (full width) — hidden for Existing Variant when parent is found (shown below parent SKU instead) */}
              {!(form.listing_type === 'Existing Variant' && parentSkuDetails) && (
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-gray-500
                                    dark:text-gray-400 uppercase tracking-wider
                                    mb-1 block">
                    Listing Name
                  </label>
                  <input
                    value={form.listing_name}
                    onChange={e => updateField('listing_name', e.target.value)}
                    placeholder="e.g. MoYu RS3M 2021 Stickerless"
                    className="w-full text-sm bg-white dark:bg-gray-700
                               border border-gray-200 dark:border-gray-600
                               rounded-lg px-3 py-2 text-gray-900 dark:text-white
                               focus:outline-none focus:ring-2 focus:ring-blue-500
                               transition-all" />
                </div>
              )}

              {/* Row 3: Category + Brand */}
              <div>
                <FieldLabel>Category</FieldLabel>
                <select
                  className={inputClasses}
                  value={form.category}
                  // Auto-assign SKU logic moved to server-side
                  onChange={e => {
                    updateField('category', e.target.value);
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
                <ComboBox
                  id="brand-combobox"
                  value={form.brand}
                  onChange={val => updateField('brand', val)}
                  options={brandOptions}
                  placeholder="Select or type brand..." />
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
                <ComboBox
                  id="variant-combobox"
                  value={form.variant}
                  onChange={val => updateField('variant', val)}
                  options={variantOptions}
                  placeholder="Select or type variant..." />
              </div>

              {/* Row 5: Parent SKU (conditional) */}
              {form.listing_type === 'Existing Variant' && (
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-gray-500
                                    dark:text-gray-400 uppercase tracking-wider
                                    mb-1 block">
                    Parent SKU
                  </label>
                  <input
                    value={form.parent_sku}
                    onChange={e => updateField('parent_sku', e.target.value)}
                    placeholder="e.g. 1030082"
                    className="w-full text-sm bg-white dark:bg-gray-700
                               border border-gray-200 dark:border-gray-600
                               rounded-lg px-3 py-2 text-gray-900 dark:text-white
                               focus:outline-none focus:ring-2 focus:ring-blue-500" />

                  {parentSkuLoading && (
                    <p className="text-[10px] text-gray-400 mt-1">
                      🔍 Looking up SKU...
                    </p>
                  )}
                  {parentSkuDetails && !parentSkuLoading && (
                    <div className="mt-2 space-y-2">
                      {/* Confirmation badge */}
                      <div className="px-3 py-2 bg-green-50 dark:bg-green-900/20
                                      border border-green-200 dark:border-green-800
                                      rounded-lg">
                        <p className="text-[10px] font-semibold text-green-700
                                      dark:text-green-400">
                          ✓ Parent product found
                        </p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          Changing the listing name below will affect
                          all variants of this product on Shopify.
                        </p>
                      </div>

                      {/* Editable Listing Name — shown here for variant context */}
                      <div>
                        <label className="text-xs font-semibold text-gray-500
                                          dark:text-gray-400 uppercase tracking-wider
                                          mb-1 block">
                          Listing Name
                          <span className="ml-2 text-[10px] font-normal
                                           text-amber-500 normal-case">
                            Inherited from parent — editable
                          </span>
                        </label>
                        <input
                          value={form.listing_name}
                          onChange={e => updateField('listing_name', e.target.value)}
                          placeholder="Inherited from parent SKU"
                          className="w-full text-sm bg-white dark:bg-gray-700
                                     border border-amber-300 dark:border-amber-600
                                     rounded-lg px-3 py-2 text-gray-900 dark:text-white
                                     focus:outline-none focus:ring-2 focus:ring-amber-500
                                     transition-all" />
                      </div>
                    </div>
                  )}
                  {parentSkuError && !parentSkuLoading && (
                    <p className="text-[10px] text-red-500 mt-1">
                      ✗ {parentSkuError}
                    </p>
                  )}
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
            {pricing && (
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
                Based on ¥{unitPrice} × {pricingConfig.cny_conv_rate} conv rate
                × {pricing.mode === 'SEA'
                    ? pricingConfig.sea_multiplier + ' (SEA)'
                    : pricingConfig.air_multiplier + ' (AIR)'
                  } multiplier
                = ₹{pricing.landing} landed cost
              </p>
            )}
          </Card>

          {/* ─── SECTION D: Physical Specs ─── */}
          <Card>
            <SectionHeader emoji="📦" title="Physical Specs" />
            <div className="space-y-4">
              {/* H / L / W in one row */}
              <div className="grid grid-cols-3 gap-4">
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
              </div>
              {/* Weight + dims row */}
              <div className="grid grid-cols-2 gap-4">
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
              </div>
              {/* Net weight */}
              <div className="grid grid-cols-2 gap-4">
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
          {/* ─── SECTION 7: DEBUG PANEL (inside left column) ─── */}
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
                    {JSON.stringify({ pricing, cm1Profit, cm2Profit, cm3Profit }, null, 2)}
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

        {/* RIGHT column — sticky, does NOT scroll with left */}
        <div className="w-80 xl:w-96 flex-shrink-0 overflow-y-auto space-y-4 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600">

          {/* ─── A: Margin Calculator ─── */}
          <Card>
            <div className="flex items-center gap-2 mb-4 pb-3
                            border-b border-gray-100 dark:border-gray-700">
              <span className="text-base">💹</span>
              <h2 className="text-sm font-bold text-gray-800 dark:text-white
                             uppercase tracking-wider">Margin Calculator</h2>
              {pricing && (
                <span className={`ml-auto text-xs font-mono px-2 py-0.5 rounded
                                 ${pricing.mode === 'SEA'
                                   ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                   : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                 }`}>
                  {pricing.mode}
                </span>
              )}
            </div>

            {!pricing ? (
              <p className="text-xs text-gray-400 text-center py-4">
                Enter RMB cost to calculate pricing
              </p>
            ) : (
              <>
                {[
                  { label: 'RMB Price',    value: `¥ ${unitPrice}`,             muted: true },
                  { label: 'Landing Cost', value: `₹ ${pricing.landing}`,       muted: false },
                  { label: 'CM1 Target',   value: `${pricing.cm1_target}%`,     muted: true },
                  { label: 'Raw SP',       value: `₹ ${pricing.raw_sp}`,        muted: true },
                  { label: 'Bucket SP',    value: `₹ ${pricing.bucket_sp}`,     muted: true },
                  { label: 'Floor SP',     value: `₹ ${pricing.floor_sp}`,      muted: true },
                ].map(({ label, value, muted }) => (
                  <div key={label}
                       className="flex justify-between items-center py-1.5
                                  border-b border-gray-50 dark:border-gray-700/30">
                    <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
                    <span className={`text-xs font-mono ${
                      muted
                        ? 'text-gray-500 dark:text-gray-400'
                        : 'text-gray-900 dark:text-white font-semibold'
                    }`}>{value}</span>
                  </div>
                ))}

                {/* Final SP — shows user's actual value vs suggested */}
                <div className="flex justify-between items-center py-2
                                border-b border-gray-100 dark:border-gray-700">
                  <div>
                    <p className="text-sm font-bold text-gray-700 dark:text-gray-200">
                      Selling Price
                    </p>
                    {pricing && currentSP !== pricing.final_sp && (
                      <p className="text-[10px] text-gray-400">
                        Suggested: ₹{pricing.final_sp}
                      </p>
                    )}
                  </div>
                  <span className="text-sm font-bold font-mono text-blue-600
                                   dark:text-blue-400">
                    ₹ {currentSP || pricing?.final_sp || '—'}
                  </span>
                </div>

                {/* MRP — shows user's actual value vs suggested */}
                <div className="flex justify-between items-center py-2
                                border-b border-gray-100 dark:border-gray-700">
                  <div>
                    <p className="text-sm font-bold text-gray-700 dark:text-gray-200">
                      MRP
                    </p>
                    {pricing && currentMRP !== pricing.mrp && (
                      <p className="text-[10px] text-gray-400">
                        Suggested: ₹{pricing.mrp}
                      </p>
                    )}
                  </div>
                  <span className="text-sm font-bold font-mono
                                   text-gray-900 dark:text-white">
                    ₹ {currentMRP || pricing?.mrp || '—'}
                  </span>
                </div>

                {/* CM Breakdown — 3 rows */}
                {[
                  {
                    label:    'CM1 (Gross)',
                    sublabel: 'Net Sales − Landing',
                    value:    cm1Profit,
                    pct:      actualCM1Live,
                    color:    actualCM1Live >= (pricingConfig.min_margin_pct || 20)
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-red-500',
                  },
                  {
                    label:    'CM2 (After Mktg)',
                    sublabel: `−${marketingPct}% of SP = ₹${Math.round(marketingCost)}`,
                    value:    cm2Profit,
                    pct:      actualCM2,
                    color:    cm2Profit > 0
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-red-500',
                  },
                  {
                    label:    'CM3 (After P&P)',
                    sublabel: `−₹${pickPack} pick & pack`,
                    value:    cm3Profit,
                    pct:      actualCM3,
                    color:    cm3Profit > 0
                                ? 'text-purple-600 dark:text-purple-400'
                                : 'text-red-500',
                  },
                ].map(({ label, sublabel, value, pct, color }) => (
                  <div key={label}
                       className="flex justify-between items-center py-2
                                  border-b border-gray-100 dark:border-gray-700/50
                                  last:border-0">
                    <div>
                      <p className="text-xs font-semibold text-gray-700
                                    dark:text-gray-300">{label}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{sublabel}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold font-mono ${color}`}>
                        ₹{Math.round(value)}
                      </p>
                      <p className={`text-[10px] font-mono ${color}`}>
                        {pct.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                ))}

                {/* Large CM3 display — final profit */}
                <div className={`mt-3 p-3 rounded-xl text-center ${
                  cm3Profit > 0
                    ? 'bg-purple-50 dark:bg-purple-900/20'
                    : 'bg-red-50 dark:bg-red-900/20'
                }`}>
                  <p className={`text-3xl font-bold ${
                    cm3Profit > 0
                      ? 'text-purple-600 dark:text-purple-400'
                      : 'text-red-500'
                  }`}>
                    {actualCM3.toFixed(1)}%
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    CM3 — Actual Margin
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    CM1: {actualCM1Live.toFixed(1)}%
                    · CM2: {actualCM2.toFixed(1)}%
                  </p>
                  {marginWarning && (
                    <p className="text-xs text-red-500 font-semibold mt-2">
                      ⚠️ CM1 below {pricingConfig.min_margin_pct}% minimum
                    </p>
                  )}
                </div>
              </>
            )}
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
                          onClick={() => handleConfirmReject(rejectRemark)}
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
