import React, { useState, useEffect, useMemo, useRef } from 'react';
import { API_ACTIONS } from '../../constants';
import { callGas } from '../../services/gasApi';
import { getCurrentActor } from '../../services/authToken';
import { parseFactoryCode, serializeFactoryCode } from '../../utils/factoryCode';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { MarginGauge } from './MarginGauge';
import {
  ChevronRightIcon,
  ExclamationTriangleIcon,
  CheckBadgeIcon,
  ClockIcon,
  XMarkIcon,
  ArrowPathIcon,
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
  factory_code_other: string;  // Other Factory Item Code → AccountingSKU in EE
  article_number:     string;  // Article Number → customFields in EE
  // Section B — Product Identity
  suggested_sku: string;
  listing_name: string;
  variant: string;
  listing_type: 'New Product' | 'Existing Variant' | '';
  parent_sku: string;
  category: string;
  brand: string;
  is_sample: boolean;
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
  cny_conv_rate:    number;
  sea_multiplier:   number;
  air_rate:         number;
  threshold:        number;
  pick_pack:        number;
  shopify_cost_pct: number;
  min_margin_pct:   number;
  gst_rate:         number;
  cm1_brackets:        { floor: number; value: number }[];
  cm1_floor_brackets:  { floor: number; value: number }[];
  cm3_target_brackets: { floor: number; value: number }[];
  cm3_floor_brackets:  { floor: number; value: number }[];
  // value = "Discount off MRP %" (e.g. 40 = 40% off), not a divisor
  mrp_brackets:     { floor: number; value: number }[];
  compare_brackets: { floor: number; value: number }[];
}


interface ComboBoxProps {
  value:       string;
  onChange:    (val: string) => void;
  options:     string[];
  placeholder: string;
  id:          string;
  onBlur?:     () => void;
}

const ComboBox: React.FC<ComboBoxProps> = ({
  value, onChange, options, placeholder, id, onBlur
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
              onClick={() => { onChange(query); setOpen(false); setQuery(''); onBlur?.(); }}
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
                onClick={() => { onChange(opt); setOpen(false); setQuery(''); onBlur?.(); }}
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

// Fallback only — used until apiGetSkuCategories (SKU_Config sheet, see
// get_sku_categories) returns, and if that fetch fails outright. The live
// list is the source of truth: a category added to SKU_Config shows up
// here without a redeploy; this array does not need to be kept in sync.
const CATEGORIES = [
  '2x2','3x3','4x4','5x5','6x6','7x7',
  'Accessory','Big Cubes','Clock','Design',
  'Event Equipment','Events','Gift Box','Kreativity',
  'Learn','Lubricant','Megaminx','Mirror','Other',
  'Other Puzzles','Pyraminx','SERVICE','Shape Mod',
  'Skewb','Snake','Square-1','Timer and Mat',
];

// Module-level cache, same rationale as categoryCache in ShipmentTracker.tsx —
// shared across mounts of this screen within a session, not across the two
// files (each fetches independently since they're separate modules).
let skuCategoriesCache: string[] | null = null;

// Same idea for the brand / variant dropdown options: they used to be
// re-fetched (one after the other) on every open of this screen. Session-scoped
// — a brand typed in is persisted and added to these locally (handleNewBrand).
let brandOptionsCache: string[] | null = null;
let variantOptionsCache: string[] | null = null;

// The bracket tables the price calculation reads. All must be non-empty arrays.
const hasPricingBrackets = (c: Partial<PricingConfig> | null | undefined): boolean =>
  !!c && [c.cm1_brackets, c.cm3_target_brackets, c.mrp_brackets, c.compare_brackets]
    .every(b => Array.isArray(b) && b.length > 0);

// Raw get_pricing_config response -> the shape the price calculator uses.
// Shared by the copy App already holds and this screen's own fetch, so both
// paths apply identical defaults. The fallbacks mirror calculatePricing_ in
// NewSkuApi.js — keep the two in step.
const normalizePricingConfig = (d: any): PricingConfig => ({
  cny_conv_rate:    Number(d.cny_conv_rate)    || 14.36,
  sea_multiplier:   Number(d.sea_multiplier)   || 1.35,
  air_rate:         Number(d.air_rate)          || 1.6,
  threshold:        Number(d.threshold)         || 40,
  pick_pack:        Number(d.pick_pack)         || 85,
  shopify_cost_pct: Number(d.shopify_cost_pct)  || 0.18,
  min_margin_pct:   Number(d.min_margin_pct)    || 20,
  gst_rate:         d.gst_rate !== undefined && d.gst_rate !== null ? Number(d.gst_rate) : 0.05,
  cm1_brackets:        d.cm1_brackets,
  cm1_floor_brackets:  d.cm1_floor_brackets,
  cm3_target_brackets: d.cm3_target_brackets,
  cm3_floor_brackets:  d.cm3_floor_brackets,
  mrp_brackets:     d.mrp_brackets,
  compare_brackets: d.compare_brackets,
});

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
  // Already-fetched New SKU Requests list (from the dashboard's cache), used
  // for a client-side EAN/FC/AN duplicate check without a dedicated backend call.
  // May be empty/stale if this page was opened without visiting the
  // dashboard first — a fallback fetch below covers that case.
  cachedRequests?: any[];
  // The pricing config App already loaded for Settings (raw get_pricing_config
  // data). Used to render suggested prices immediately; this screen still
  // re-fetches in the background, because App's copy can be up to an hour old.
  pricingConfig?: any;
}> = ({ requestId, onBack, cachedRequests, pricingConfig: appPricingConfig }) => {
  const isNew = requestId === 'NEW';

  // Multi-listing (variant) support
  // listings[0] = primary, listings[1+] = added variants
  // Each listing has its own requestId and form state
  interface ListingTab {
    requestId: string;
    label: string;  // e.g. "Listing 1", "Variant 2"
  }
  const [listingTabs, setListingTabs] = useState<ListingTab[]>([
    { requestId: isNew ? 'NEW' : requestId, label: 'Listing 1' }
  ]);
  const [activeTab, setActiveTab] = useState(0);
  const [addingVariant, setAddingVariant] = useState(false);

  // Source data (read-only, from sheet row or blank for manual)
  const [sourceData, setSourceData] = useState<Partial<SkuRequest>>({});
  const [isLoadingSource, setIsLoadingSource] = useState(!isNew);

  // All editable form fields
  const [form, setForm] = useState<FormData>({
    ean:        '',
    unit_price: '',
    invoice_qty: '',
    vendor_code: '',
    factory_code_other: '',
    article_number: '',
    suggested_sku: '',
    listing_name: sourceData.item_name ?? '',
    variant: '',
    listing_type: '',
    parent_sku: '',
    category: sourceData.category ?? '',
    brand: '',
    is_sample: false,
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

  // Extracted so it can be called both on mount/tab-switch (the effect below)
  // and on demand from the manual refresh button in the listing tabs bar —
  // same request, same fields, no separate fetch path to keep in sync.
  const fetchSourceData = async () => {
    setIsLoadingSource(true);
    try {
      const result = await callGas(API_ACTIONS.GET_NEW_SKU_REQUEST_BY_ID, { request_id: requestId }, 2);
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
          ean:                   result.data.ean                  || '',
          unit_price:            result.data.unit_price           || '',
          suggested_sku:         result.data.suggested_sku        || '',
          listing_name:          result.data.listing_name         || result.data.item_name || '',
          variant:               result.data.variant              || '',
          listing_type:          result.data.listing_type         || '',
          parent_sku:            result.data.parent_sku           || '',
          category:              result.data.category             || '',
          brand:                 result.data.brand                || '',
          is_sample:             !!result.data.is_sample,
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
          // A value with no pipe is the Article Number (see utils/factoryCode.ts).
          factory_code_other: parseFactoryCode(result.data.factory_code).other,
          article_number:     parseFactoryCode(result.data.factory_code).article,
        }));
        return true;
      }
      return false;
    } catch (err) {
      console.error('fetchSourceData error:', err);
      return false;
    } finally {
      setIsLoadingSource(false);
    }
  };

  useEffect(() => {
    if (isNew) return;
    fetchSourceData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, isNew]);

  // Manual refresh — re-pulls this request's data from the sheet without
  // navigating away to the dashboard and back. Warns first if there are
  // unsaved edits, since a refresh overwrites local form state.
  const [isRefreshingTab, setIsRefreshingTab] = useState(false);
  const handleRefreshTab = async () => {
    if (isDirty && !window.confirm(
      'You have unsaved changes that will be lost. Refresh anyway?'
    )) {
      return;
    }
    setIsRefreshingTab(true);
    try {
      const ok = await fetchSourceData();
      if (ok) {
        dirtyRef.current = false;
        setIsDirty(false);
      }
    } finally {
      setIsRefreshingTab(false);
    }
  };

  // Pricing config (fetched from GAS in production)
  const [pricingConfig, setPricingConfig] = useState<PricingConfig | null>(
    () => appPricingConfig ? normalizePricingConfig(appPricingConfig) : null
  );
  const [pricingConfigLoaded, setPricingConfigLoaded] = useState(!!appPricingConfig);
  const [pricingConfigError, setPricingConfigError] = useState<string | null>(null);
  const [categoryOptions, setCategoryOptions] = useState<string[]>(skuCategoriesCache || CATEGORIES);

  useEffect(() => {
    if (skuCategoriesCache) return;
    const fetchCategories = async () => {
      try {
        const result = await callGas('get_sku_categories', {}, 2);
        if (result.status === 'success' && Array.isArray(result.categories)) {
          const names = result.categories.map((c: { category: string }) => c.category).filter(Boolean).sort();
          if (names.length > 0) {
            skuCategoriesCache = names;
            setCategoryOptions(names);
          }
        }
      } catch (err) {
        console.error('fetchCategories error:', err);
        // Falls back silently to the hardcoded CATEGORIES already in state.
      }
    };
    fetchCategories();
  }, []);

  useEffect(() => {
    const fetchPricingConfig = async () => {
      try {
        const result = await callGas(API_ACTIONS.GET_PRICING_CONFIG, {}, 2);
        if (result.success) {
          setPricingConfig(normalizePricingConfig(result.data));
          setPricingConfigLoaded(true);
          setPricingConfigError(null);
        } else if (!appPricingConfig) {
          // With App's copy already on screen a failed refresh isn't worth
          // an error banner — the suggested prices are still usable.
          setPricingConfigError('Failed to load pricing config from server.');
        }
      } catch (err) {
        console.error('fetchPricingConfig error:', err);
        if (!appPricingConfig) setPricingConfigError('Network error loading pricing config.');
      }
    };
    fetchPricingConfig();
    // Once per mount: App's copy (if any) only seeds the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Brands and variants are independent, so fetch them together (they were
  // awaited one after the other — two full Apps Script round trips in series)
  // and keep them for the session.
  useEffect(() => {
    if (brandOptionsCache && variantOptionsCache) return;
    (async () => {
      const [brands, variants] = await Promise.allSettled([
        callGas(API_ACTIONS.GET_BRANDS, {}, 2),
        callGas(API_ACTIONS.GET_VARIANTS, {}, 2),
      ]);
      if (brands.status === 'fulfilled' && brands.value.success) {
        brandOptionsCache = brands.value.data;
        setBrandOptions(brands.value.data);
      } else if (brands.status === 'rejected') {
        console.error('fetch brands error:', brands.reason);
      }
      if (variants.status === 'fulfilled' && variants.value.success) {
        variantOptionsCache = variants.value.data;
        setVariantOptions(variants.value.data);
      } else if (variants.status === 'rejected') {
        console.error('fetch variants error:', variants.reason);
      }
    })();
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
  const [skuAssignSuccess, setSkuAssignSuccess] = useState<string | null>(null);
  const [skuAssignError, setSkuAssignError] = useState<string | null>(null);

  // Dirty flag. `dirtyRef` / `formVersionRef` mirror it for code that runs after
  // an await and would otherwise read a stale render: every edit bumps the
  // version, and a save only marks the form clean if no edit happened while it
  // was in flight (it used to mark it clean regardless, silently dropping whatever
  // was typed during the save).
  const [isDirty, setIsDirty] = useState(false);
  const dirtyRef = useRef(false);
  const formVersionRef = useRef(0);

  // Save feedback
  const [showSaved, setShowSaved] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [savedRequestId, setSavedRequestId] = useState<string | null>(
    isNew ? null : requestId
  );
  // The request this screen is saving to: the opened request, or — for a brand-new
  // entry — the row created by its first save. Saves are chained so two never run
  // at once, and the ref is what a chained save reads (state would be stale).
  const savedRequestIdRef = useRef<string | null>(isNew ? null : requestId);
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const activeRequestId = isNew ? savedRequestId : requestId;

  // Reject UI
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);
  const [rejectRemark, setRejectRemark] = useState('');
  const isRejected = sourceData.status === 'REJECTED';
  const [showConfigPanel, setShowConfigPanel] = useState(false);

  // Mark as Complete UI
  const [showMarkCompleteConfirm, setShowMarkCompleteConfirm] = useState(false);
  const [markCompleteLoading, setMarkCompleteLoading] = useState(false);

  // Parent SKU lookup
  const [parentSkuDetails, setParentSkuDetails] = useState<{
    parent_product_name: string;
    parent_product_id:   string;
  } | null>(null);
  const [parentSkuLoading, setParentSkuLoading] = useState(false);
  const [parentSkuError, setParentSkuError]     = useState<string | null>(null);

  const [brandOptions, setBrandOptions]     = useState<string[]>(brandOptionsCache || []);
  const [variantOptions, setVariantOptions] = useState<string[]>(variantOptionsCache || []);

  // Debug mode (same localStorage key as list view)
  const [debugMode] = useState(
    () => localStorage.getItem('skuDebugMode') === 'true'
  );

  // Always the latest form, for saves that run after an await (see dirtyRef above).
  const formRef = useRef(form);
  formRef.current = form;

  // Helper to update a form field and mark dirty
  const updateField = (field: keyof FormData, value: any) => {
    setForm(f => ({ ...f, [field]: value }));
    formVersionRef.current += 1;
    dirtyRef.current = true;
    setIsDirty(true);
  };

  // ─── EAN/FC/AN duplicate check (warn, don't block) ───
  // Falls back to a one-time fetch of the same list the dashboard uses, in
  // case this page was opened directly (e.g. a bookmarked/typed link)
  // without the dashboard's cache ever being populated.
  const [fallbackRequests, setFallbackRequests] = useState<any[]>([]);
  useEffect(() => {
    if (cachedRequests && cachedRequests.length > 0) return;
    (async () => {
      try {
        const result = await callGas(API_ACTIONS.GET_NEW_SKU_REQUESTS, {}, 2);
        if (result.success) setFallbackRequests(result.data || []);
      } catch (err) {
        console.error('fallback getNewSkuRequests error:', err);
      }
    })();
    // Only ever needs to run once per mount — cachedRequests is a prop
    // snapshot, not expected to change while this page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [factoryDupWarning, setFactoryDupWarning] = useState<string | null>(null);
  const [articleDupWarning, setArticleDupWarning] = useState<string | null>(null);
  const [eanDupWarning, setEanDupWarning]         = useState<string | null>(null);

  const checkIdentifierDuplicates = () => {
    const source = (cachedRequests && cachedRequests.length > 0) ? cachedRequests : fallbackRequests;
    const others = source.filter(x => x.request_id !== requestId);

    const fc  = form.factory_code_other.trim();
    const an  = form.article_number.trim();
    const ean = form.ean.trim();

    const fcMatch = fc && others.find(x => parseFactoryCode(x.factory_code).other === fc);
    setFactoryDupWarning(fcMatch
      ? `Matches existing SKU request ${fcMatch.request_id}${fcMatch.listing_name ? ` (${fcMatch.listing_name})` : ''}`
      : null);

    const anMatch = an && others.find(x => parseFactoryCode(x.factory_code).article === an);
    setArticleDupWarning(anMatch
      ? `Matches existing SKU request ${anMatch.request_id}${anMatch.listing_name ? ` (${anMatch.listing_name})` : ''}`
      : null);

    const eanMatch = ean && others.find(x => String(x.ean || '').trim() === ean);
    setEanDupWarning(eanMatch
      ? `Matches existing SKU request ${eanMatch.request_id}${eanMatch.listing_name ? ` (${eanMatch.listing_name})` : ''}`
      : null);
  };

  // A Suggested SKU that another open request already holds. The sheet has had
  // several such collisions; creating the second one on EasyEcom would be refused
  // (or, before that was guarded, would have overwritten the first product), so
  // say so as soon as it shows on screen instead of at Create Listing. Derived —
  // recomputed whenever the SKU or the request list changes, no blur needed.
  const skuDupWarning = useMemo(() => {
    const sku = form.suggested_sku.trim();
    if (!sku) return null;
    const source = (cachedRequests && cachedRequests.length > 0) ? cachedRequests : fallbackRequests;
    const other = source.find(x =>
      x.request_id !== activeRequestId &&
      x.status !== 'REJECTED' &&
      (String(x.suggested_sku || '').trim() === sku || String(x.ee_sku || '').trim() === sku)
    );
    if (!other) return null;
    return `Also assigned to request ${other.request_id}${other.listing_name ? ` (${other.listing_name})` : ''} — use Auto-assign SKU for a free number`;
  }, [form.suggested_sku, cachedRequests, fallbackRequests, activeRequestId]);

  // ─── Derived pricing calculations ───
  // Bracket lookup — finds highest floor ≤ value, returns that bracket's
  // value. A trailing sentinel floor (>=999999) represents an open-ended
  // "greater than every real floor" bracket — it must only win when value
  // exceeds the PREVIOUS real floor, not merely because the loop reached
  // it. Applying it unconditionally (as an earlier version did) mis-
  // bucketed any value that exactly equalled the last real floor (e.g.
  // SP === 2000 for MRP brackets). Mirrors lookupBracket_ in NewSkuApi.js.
  const lookupBracket = (value: number, brackets: { floor: number; value: number }[]): number => {
    let result = brackets[0].value;
    for (let i = 0; i < brackets.length; i++) {
      const b = brackets[i];
      if (b.floor >= 999999) {
        if (i > 0 && value > brackets[i - 1].floor) result = b.value;
        break;
      }
      if (value >= b.floor) result = b.value;
      else break;
    }
    return result;
  };

  const calcPricing = (rmbPrice: number, weightGm: number, config: PricingConfig | null) => {
    if (!rmbPrice || !config) return null;
    if (!config.sea_multiplier || !config.air_rate || !config.cny_conv_rate) return null;
    // A bracket table that is missing or empty (its rows gone or misplaced in
    // SKU_Config) makes lookupBracket read brackets[0].value of nothing — a
    // TypeError inside this useMemo that white-screened the whole page. No
    // prices is the honest result; the banner below says why.
    if (!hasPricingBrackets(config)) return null;

    // Step 1: Landing — RMB price ABOVE threshold ships SEA; at/below ships AIR
    let landing: number, mode: string;
    if (rmbPrice > config.threshold) {
      mode    = 'SEA';
      landing = rmbPrice * config.cny_conv_rate * config.sea_multiplier;
    } else {
      mode = 'AIR';
      if (!weightGm || weightGm === 0) return { mode: 'AIR', needsWeight: true };
      landing = (rmbPrice * config.cny_conv_rate) + (weightGm * config.air_rate);
    }
    landing = Math.round(landing);

    // Step 2 (reference only): CM1 target by landing bracket — no longer
    // feeds the Raw SP formula, shown for analysis/simulation only.
    const cm1Pct = lookupBracket(landing, config.cm1_brackets) / 100;
    const cm1FloorPct = lookupBracket(landing, config.cm1_floor_brackets);

    // Step 2: CM3 target by landing bracket — drives the Raw SP formula as
    // of the 2026-09 pricing-logic revision (replaces CM1 target).
    const cm3TargetPct = lookupBracket(landing, config.cm3_target_brackets) / 100;
    const cm3FloorPct = lookupBracket(landing, config.cm3_floor_brackets);

    const gstRate = config.gst_rate != null ? config.gst_rate : 0.05;

    // Step 2: Raw SP — landing + pick&pack marked up to cover CM3 target
    // and Shopify's cut, then grossed up for GST.
    const rawSP = (landing + config.pick_pack) / (1 - cm3TargetPct - config.shopify_cost_pct) * (1 + gstRate);

    // Step 3: Bucket SP — nearest ₹50 ending in 49 or 99
    const suggestedSP = Math.round(rawSP / 50) * 50 - 1;

    // Step 4: Raw MRP — mrp_brackets value is "Discount off MRP %"
    const mrpDiscount = lookupBracket(suggestedSP, config.mrp_brackets) / 100;
    const rawMRP       = suggestedSP / (1 - mrpDiscount);

    // Step 5: Bucket MRP
    const mrp = Math.round(rawMRP / 50) * 50 - 1;

    // Step 6: Compare At Price — lookup by SP, markup % as whole number,
    // capped at MRP
    let compareAtPrice: number | null = null;
    let rawCompare: number | null = null;
    if (config.compare_brackets) {
      const compareMarkup = lookupBracket(suggestedSP, config.compare_brackets) / 100;
      rawCompare           = Math.min(suggestedSP * (1 + compareMarkup), mrp);
      compareAtPrice       = Math.round(rawCompare / 50) * 50 - 1;
    }

    // Step 7: CM1 actual — Gross Margin = Net Sales (ex-GST) - COGS
    // (landing + pick&pack). CM1%/CM3% and the Shopify deduction are all
    // expressed against Net Sales, not gross (GST-inclusive) SP.
    const netSales  = suggestedSP / (1 + gstRate);
    const cm1Profit = netSales - landing - config.pick_pack;
    const actualCM1 = (cm1Profit / netSales) * 100;

    // Step 8: CM3 actual — Net Margin = Gross Margin - indirect cost (Shopify).
    const cm3Profit = cm1Profit - (config.shopify_cost_pct * netSales);
    const actualCM3 = (cm3Profit / netSales) * 100;

    return {
      mode,
      needsWeight:      false,
      landing,
      cm1_target:       Math.round(cm1Pct * 100),
      cm1_floor:        cm1FloorPct,
      cm3_target:       Math.round(cm3TargetPct * 100),
      cm3_floor:        cm3FloorPct,
      raw_sp:           Math.round(rawSP),
      suggested_sp:     suggestedSP,
      raw_mrp:          Math.round(rawMRP),
      mrp,
      raw_compare_at_price: rawCompare != null ? Math.round(rawCompare) : null,
      compare_at_price: compareAtPrice,
      actual_cm1:       Math.round(actualCM1 * 100) / 100,
      cm3:              Math.round(cm3Profit),
      actual_cm3:       Math.round(actualCM3 * 100) / 100,
    };
  };

  const unitPrice = Number(form.unit_price) || 0;
  const weightGm  = Number(form.pkg_weight_gm) || 0;
  const pricing   = useMemo(
    () => calcPricing(unitPrice, weightGm, pricingConfig),
    [unitPrice, weightGm, pricingConfig]
  );

  // Tracks the last value we auto-wrote into mrp / shopify_selling_price /
  // shopify_compare_price, so this effect can tell "still showing what we
  // last computed" (safe to recompute on the next price/weight change)
  // apart from "the user has since typed something else" (must not clobber
  // it).
  const lastAutoMrp     = React.useRef<number | null>(null);
  const lastAutoSp      = React.useRef<number | null>(null);
  const lastAutoCompare = React.useRef<number | null>(null);

  useEffect(() => {
    if (!pricing || pricing.needsWeight) return;
    if (!pricingConfigLoaded) return;
    setForm(f => {
      const next = { ...f };
      if (f.mrp === '' || f.mrp === lastAutoMrp.current) next.mrp = pricing.mrp;
      if (f.shopify_selling_price === '' || f.shopify_selling_price === lastAutoSp.current) {
        next.shopify_selling_price = pricing.suggested_sp;
      }
      if (pricing.compare_at_price != null &&
          (f.shopify_compare_price === '' || f.shopify_compare_price === lastAutoCompare.current)) {
        next.shopify_compare_price = pricing.compare_at_price;
      }
      return next;
    });
    lastAutoMrp.current     = pricing.mrp;
    lastAutoSp.current      = pricing.suggested_sp;
    lastAutoCompare.current = pricing.compare_at_price;
  }, [pricing, pricingConfigLoaded]);

  // AIR-priced item (RMB cost at/below the threshold) with no package weight yet:
  // no landing cost, so EasyEcom and Zoho creation would be refused server-side.
  const needsWeight  = !!pricing?.needsWeight;

  const currentSP    = Number(form.shopify_selling_price) || 0;
  const currentMRP   = Number(form.mrp) || 0;
  const landedCost   = pricing?.landing || 0;
  const pickPack     = pricingConfig?.pick_pack || 85;

  // Discount simulation state
  const [discount, setDiscount] = useState(0);

  // CM1 & CM3 live — recalculated with discount. Net Sales (ex-GST,
  // post-discount) is the base for CM1/CM3 profit, both percentages, and
  // the Shopify deduction — not gross (GST-inclusive) SP.
  // CM1 (Gross Margin) = Net Sales - COGS (landing + pick&pack)
  // CM3 (Net Margin)   = CM1 - indirect cost (Shopify % of Net Sales)
  const liveGstRate = pricingConfig?.gst_rate != null ? pricingConfig.gst_rate : 0.05;
  const netSalesLive = currentSP * (1 - discount/100) / (1 + liveGstRate);
  const cm1Live     = netSalesLive - landedCost - pickPack;
  const cm3Live     = cm1Live - ((pricingConfig?.shopify_cost_pct || 0.18) * netSalesLive);
  const cm3PctLive  = netSalesLive > 0 ? (cm3Live / netSalesLive) * 100 : 0;
  const actualCM1Live = netSalesLive > 0
    ? (cm1Live / netSalesLive) * 100
    : (pricing?.actual_cm1 || 0);

  const marginWarning = actualCM1Live > 0 &&
    actualCM1Live < (pricingConfig?.min_margin_pct || 20);

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
        const result = await callGas(API_ACTIONS.GET_PARENT_SKU_DETAILS, { parent_sku: sku }, 2);
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
    setSkuAssignSuccess(null);
    setSkuAssignError(null);
    try {
      // Not auto-retried: with a request_id the backend also reserves the number on
      // that request's row, so a repeat call must not be fired blindly.
      const result = await callGas(API_ACTIONS.GET_NEXT_AVAILABLE_SKU, {
        category:   form.category,
        request_id: activeRequestId || undefined,
      });
      if (result.success) {
        updateField('suggested_sku', result.data.suggested_sku);
        setSkuAssignSuccess(result.data.suggested_sku);
        if (result.data.warning) alert(result.data.warning);
      } else {
        setSkuAssignError('SKU assignment failed: ' + result.error);
      }
    } catch (err) {
      console.error('handleAutoAssignSku error:', err);
      setSkuAssignError('Network error during SKU assignment');
    } finally {
      setSkuAssigning(false);
    }
  };

  useEffect(() => {
    if (!form.category) return;
    const fetchTags = async () => {
      try {
        const result = await callGas(API_ACTIONS.GET_TAGS_BY_CATEGORY, { category: form.category }, 2);
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

  // The form as the backend stores it. factory_code_other / article_number are
  // UI-only halves of the single pipe-separated factory_code column — the
  // backend splits it back at EasyEcom creation time (before | = AccountingSKU,
  // after | = Article Number). One builder for the manual save, the blur/auto
  // save and the create-new-entry call, which each used to assemble this on
  // their own (with two slightly different join rules).
  // Reads formRef, not the render's `form`: it is called from saves that run after
  // an await, which would otherwise send an older form than the one on screen.
  const buildDraftForm = () => ({
    ...formRef.current,
    factory_code: serializeFactoryCode(formRef.current.factory_code_other, formRef.current.article_number),
  });

  // The one place a draft is written. Every trigger — the Save Draft button, the
  // blur / timed auto-save, and the pre-flight before Create Listing and each
  // platform step — goes through here, one save at a time (chained), always
  // reading the latest form. A brand-new entry's first save creates its row
  // (CREATE_MANUAL_SKU writes the whole form in that one call); every later save
  // of that same entry updates that row. It used to create ANOTHER row on every
  // Save Draft click — the live sheet has one product three times over — and
  // never auto-saved after the first save.
  type SaveResult = { ok: boolean; error?: string };
  const persistDraft = (): Promise<SaveResult> => {
    const run = async (): Promise<SaveResult> => {
      const id = isNew ? savedRequestIdRef.current : requestId;
      if (id && !dirtyRef.current) return { ok: true };   // nothing to write
      const version = formVersionRef.current;
      const draft = buildDraftForm();
      setLoading(l => ({ ...l, save: true }));
      try {
        // Both calls write to the sheet — never auto-retried.
        if (!id) {
          const created = await callGas(API_ACTIONS.CREATE_MANUAL_SKU, { created_by: getCurrentActor(), form: draft });
          if (!created.success) return { ok: false, error: created.error || 'Failed to create the request' };
          savedRequestIdRef.current = created.data.request_id;
          setSavedRequestId(created.data.request_id);
        } else {
          const saved = await callGas(API_ACTIONS.SAVE_NEW_SKU_DRAFT, { request_id: id, edited_by: getCurrentActor(), form: draft });
          if (!saved.success) return { ok: false, error: saved.error || 'Save failed' };
        }
        if (formVersionRef.current === version) {
          dirtyRef.current = false;
          setIsDirty(false);
        }
        return { ok: true };
      } catch (err) {
        console.error('persistDraft error:', err);
        return { ok: false, error: 'Network error saving the draft' };
      } finally {
        setLoading(l => ({ ...l, save: false }));
      }
    };
    const result = saveChainRef.current.then(run);
    saveChainRef.current = result.catch(() => undefined);
    return result;
  };

  const handleSaveDraft = async () => {
    const result = await persistDraft();
    if (result.ok) {
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 2000);
    } else {
      alert('Save failed: ' + result.error);
    }
  };

  // Blur / timed auto-save. Only for a request that already has a row — a
  // brand-new entry's FIRST save is the explicit Save Draft (or Create Listing).
  const handleBlurSave = async () => {
    // A field-triggered save (blur or auto-save) makes any pending timer redundant.
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (!dirtyRef.current || !activeRequestId) return;
    const result = await persistDraft();
    if (result.ok) {
      setSaveError(false);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2000);
    } else {
      setSaveError(true);
    }
  };

  // Brand ComboBox commit — if the user typed/picked a brand that isn't in
  // the dropdown yet, persist it to the Vendor Masters sheet (the source
  // apiGetBrands reads from) so it's available next time. Takes the value
  // straight from ComboBox's onChange rather than reading form.brand, since
  // ComboBox calls onChange then onBlur synchronously in the same click
  // handler — form state from the enclosing render wouldn't reflect the
  // just-picked value yet.
  const handleNewBrand = async (val: string) => {
    const brand = val.trim();
    if (!brand || brandOptions.some(b => b.toLowerCase() === brand.toLowerCase())) return;
    try {
      const result = await callGas(API_ACTIONS.ADD_BRAND, { brand });
      if (result.success) {
        const next = brandOptions.some(b => b.toLowerCase() === brand.toLowerCase())
          ? brandOptions
          : [...brandOptions, brand].sort();
        brandOptionsCache = next;
        setBrandOptions(next);
      } else {
        console.error('handleNewBrand (addBrand) failed:', result.error);
      }
    } catch (err) {
      console.error('handleNewBrand (addBrand) error:', err);
    }
  };

  // Timed auto-save — while the user stays focused in a field, persist the
  // in-progress edit after a short pause in typing. Resets on every form
  // change and simply re-invokes the same handleBlurSave used on blur, so
  // it goes through the exact same request shape, validation, and backend
  // action as a normal save. On failure isDirty stays true, so the next
  // keystroke (new timer) or the eventual blur will retry automatically.
  useEffect(() => {
    if (!isDirty || !activeRequestId) return;
    autoSaveTimerRef.current = setTimeout(() => {
      handleBlurSave();
    }, 2500);
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, isDirty, activeRequestId]);

  const handleAddVariant = async () => {
    if (isNew || !savedRequestId && requestId === 'NEW') {
      alert('Save the current listing as a draft first before adding a variant.');
      return;
    }
    setAddingVariant(true);
    try {
      const result = await callGas(API_ACTIONS.CREATE_MANUAL_SKU, {
        created_by: getCurrentActor(),
        form: {
          listing_name:  form.listing_name,
          category:      form.category,
          brand:         form.brand,
          vendor_code:   form.vendor_code,
          unit_price:    form.unit_price,
          invoice_qty:   form.invoice_qty,
          listing_type:  'Existing Variant',
          parent_sku:    form.suggested_sku,  // current listing's EE SKU as parent
          is_sample:     form.is_sample,      // inherit from parent listing, editable after
          // leave blank — must be set per variant
          variant:       '',
          ean:           '',
          factory_code:  '',
        }
      });
      if (result.success) {
        const newTab: ListingTab = {
          requestId: result.data.request_id,
          label: `Variant ${listingTabs.length + 1}`,
        };
        setListingTabs(prev => [...prev, newTab]);
        setActiveTab(listingTabs.length); // switch to new tab
      } else {
        alert('Failed to create variant: ' + result.error);
      }
    } catch(err) {
      alert('Network error while adding variant');
    } finally {
      setAddingVariant(false);
    }
  };

  // STEP 1 — EasyEcom
  const handleCreateEE = async (requestIdOverride?: string): Promise<boolean> => {
    setLoading(l => ({ ...l, ee: true }));
    try {
      // Creates the SKU on EasyEcom — never auto-retried.
      const result = await callGas(API_ACTIONS.CREATE_SKU_ON_EE, {
        request_id: requestIdOverride || savedRequestId || requestId,
        edited_by:  getCurrentActor(),
      });
      if (result.success) {
        setPlatformStatus(p => ({ ...p, ee: true }));
        // Refresh source data to get ee_sku written back
        setSourceData(d => ({ ...d, ee_sku: result.data.ee_sku }));
        noteStepError('ee', null);
        return true;
      } else {
        noteStepError('ee', result.error || 'EasyEcom creation failed');
        alert('EasyEcom creation failed: ' + result.error);
        return false;
      }
    } catch (err) {
      noteStepError('ee', 'No response from the server — check EasyEcom before retrying.');
      alert('Network error');
      console.error(err);
      return false;
    } finally {
      setLoading(l => ({ ...l, ee: false }));
    }
  };

  // STEP 2 — Zoho
  const handleCreateZoho = async (requestIdOverride?: string): Promise<boolean> => {
    setLoading(l => ({ ...l, zoho: true }));
    try {
      // Creates the SKU on Zoho — never auto-retried.
      const result = await callGas(API_ACTIONS.CREATE_SKU_ON_ZOHO, {
        request_id: requestIdOverride || savedRequestId || requestId,
        edited_by:  getCurrentActor(),
      });
      if (result.success) {
        setPlatformStatus(p => ({ ...p, zoho: true }));
        noteStepError('zoho', null);
        return true;
      } else {
        noteStepError('zoho', result.error || 'Zoho creation failed');
        alert('Zoho creation failed: ' + result.error);
        return false;
      }
    } catch (err) {
      noteStepError('zoho', 'No response from the server — check Zoho before retrying.');
      alert('Network error');
      console.error(err);
      return false;
    } finally {
      setLoading(l => ({ ...l, zoho: false }));
    }
  };

  // Attach an existing EasyEcom SKU (already created through some other path)
  // instead of recreating it. Requires an exact match on this request's own
  // Suggested SKU — same success shape as handleCreateEE so it unlocks the
  // Zoho step normally.
  const handleAttachExistingEE = async (): Promise<boolean> => {
    setLoading(l => ({ ...l, ee: true }));
    try {
      const result = await callGas(API_ACTIONS.ATTACH_EXISTING_EE_SKU, {
        request_id: savedRequestId || requestId,
        edited_by:  getCurrentActor(),
      });
      if (result.success) {
        setPlatformStatus(p => ({ ...p, ee: true }));
        setSourceData(d => ({ ...d, ee_sku: result.data.ee_sku }));
        return true;
      } else {
        alert('Attach existing EasyEcom SKU failed: ' + result.error);
        return false;
      }
    } catch (err) {
      alert('Network error');
      console.error(err);
      return false;
    } finally {
      setLoading(l => ({ ...l, ee: false }));
    }
  };

  // Attach an existing Zoho item instead of recreating it. Requires an
  // exact match on this request's own Suggested SKU.
  const handleAttachExistingZoho = async (): Promise<boolean> => {
    setLoading(l => ({ ...l, zoho: true }));
    try {
      const result = await callGas(API_ACTIONS.ATTACH_EXISTING_ZOHO_ITEM, {
        request_id: savedRequestId || requestId,
        edited_by:  getCurrentActor(),
      });
      if (result.success) {
        setPlatformStatus(p => ({ ...p, zoho: true }));
        return true;
      } else {
        alert('Attach existing Zoho item failed: ' + result.error);
        return false;
      }
    } catch (err) {
      alert('Network error');
      console.error(err);
      return false;
    } finally {
      setLoading(l => ({ ...l, zoho: false }));
    }
  };

  // STEP 3 — Shopify
  const handleCreateShopify = async (requestIdOverride?: string): Promise<boolean> => {
    setLoading(l => ({ ...l, shopify: true }));
    noteStepError('shopify', null);
    try {
      // Creates the SKU on Shopify — never auto-retried by the app itself. A
      // MANUAL retry (the button under a failed/pending Shopify step) is safe:
      // the backend first looks the SKU up on Shopify and links the listing if
      // it is already there, rather than creating a second one.
      const result = await callGas(API_ACTIONS.CREATE_SKU_ON_SHOPIFY, {
        request_id:   requestIdOverride || savedRequestId || requestId,
        parent_sku:   form.parent_sku   || '',
        listing_type: form.listing_type || '',
        edited_by:    getCurrentActor(),
      });
      if (result.success) {
        setPlatformStatus(p => ({ ...p, shopify: true }));
        setStepNotes(n => ({ ...n, shopify: result.data.already_existed ? 'Already on Shopify — linked the existing listing (nothing was created).' : null }));
        if (result.data.shopify_listing_url) {
          setSourceData(d => ({
            ...d,
            shopify_listing_url: result.data.shopify_listing_url
          }));
        }
        return true;
      } else {
        noteStepError('shopify', result.error || 'Shopify creation failed');
        alert('Shopify creation failed: ' + result.error);
        return false;
      }
    } catch (err) {
      noteStepError('shopify', 'No response from the server — the listing may or may not have been created. Retry checks Shopify first, so it will not create a duplicate.');
      alert('Network error');
      console.error(err);
      return false;
    } finally {
      setLoading(l => ({ ...l, shopify: false }));
    }
  };

  // STEP 4 — Update EE PO
  const handleUpdateEEPO = async (requestIdOverride?: string): Promise<boolean> => {
    setLoading(l => ({ ...l, ee_po: true }));
    try {
      const result = await callGas(API_ACTIONS.UPDATE_EE_PO, {
        request_id: requestIdOverride || savedRequestId || requestId,
        updated_by: getCurrentActor(),
      });
      if (result.success) {
        setPlatformStatus(p => ({ ...p, ee_po: true }));
        noteStepError('ee_po', null);
        if (result.split_po) {
          alert(
            `Original PO ${result.original_po_ref} already had a receipt (GRN) against it, so this SKU was added ` +
            `to a new PO instead: ${result.ee_po_ref}`
          );
        }
        return true;
      } else {
        noteStepError('ee_po', result.error || 'EE PO update failed');
        alert('EE PO update failed: ' + result.error);
        return false;
      }
    } catch (err) {
      noteStepError('ee_po', 'No response from the server — check the EE purchase order before retrying.');
      alert('Network error');
      console.error(err);
      return false;
    } finally {
      setLoading(l => ({ ...l, ee_po: false }));
    }
  };

  // Orchestrator — runs EE, Zoho, Shopify (and EE PO update, when a shipment
  // exists) in sequence behind a single "Create Listing" action. Stops at
  // (and surfaces) the first failure so the user can retry just that step
  // without re-running the prior ones.
  const [creationStarted, setCreationStarted] = useState(false);
  const [stepFailed, setStepFailed] = useState({ ee: false, zoho: false, shopify: false, ee_po: false });
  // Why a step failed, kept on screen under its red "Failed" row — the alert()
  // that reports it vanishes, and someone deciding whether to retry needs the
  // reason. `stepNotes` carries the one positive edge case: a retry that found
  // the listing already on the platform and linked it instead of creating.
  type StepKey = 'ee' | 'zoho' | 'shopify' | 'ee_po';
  const [stepErrors, setStepErrors] = useState<Record<StepKey, string | null>>({ ee: null, zoho: null, shopify: null, ee_po: null });
  const [stepNotes, setStepNotes] = useState<Record<StepKey, string | null>>({ ee: null, zoho: null, shopify: null, ee_po: null });
  const noteStepError = (step: StepKey, message: string | null) => setStepErrors(e => ({ ...e, [step]: message }));
  // Lets the user reach the per-step list (to attach an existing EasyEcom
  // SKU / Zoho item) without triggering the full Create Listing sequence.
  const [manualStepsExpanded, setManualStepsExpanded] = useState(false);

  // Snapshot of how each step landed on the last "Create Listing" run, shown
  // in a summary popup once the sequence stops (either all steps attempted,
  // or halted at the first failure).
  type StepOutcome = { key: 'ee' | 'zoho' | 'shopify' | 'ee_po'; label: string; status: 'success' | 'failed' | 'skipped' };
  const [runSummary, setRunSummary] = useState<StepOutcome[] | null>(null);

  const handleCreateListing = async () => {
    // Store the form first. The platform steps read the SHEET, not this screen —
    // with a pending edit (auto-save waits 2.5s after typing) the product would be
    // created on EasyEcom / Zoho / Shopify from the previous values. For a manual
    // entry with no saved request yet this is also what creates its row, so the
    // steps below have a request_id to attach to.
    const flushed = await persistDraft();
    if (!flushed.ok) {
      alert('Your changes could not be saved, so nothing was created: ' + flushed.error);
      return;
    }
    const requestIdOverride: string | undefined = isNew ? (savedRequestIdRef.current || undefined) : undefined;

    setCreationStarted(true);
    setStepFailed({ ee: false, zoho: false, shopify: false, ee_po: false });
    setRunSummary(null);

    const steps: { key: 'ee' | 'zoho' | 'shopify' | 'ee_po'; label: string; alreadyDone: boolean; handler: () => Promise<boolean> }[] = [
      { key: 'ee',      label: 'EasyEcom',           alreadyDone: platformStatus.ee,      handler: () => handleCreateEE(requestIdOverride) },
      { key: 'zoho',    label: 'Zoho',               alreadyDone: platformStatus.zoho,    handler: () => handleCreateZoho(requestIdOverride) },
      { key: 'shopify', label: 'Shopify',            alreadyDone: platformStatus.shopify, handler: () => handleCreateShopify(requestIdOverride) },
      ...(sourceData.shipment_id
        ? [{ key: 'ee_po' as const, label: 'EE Purchase Order', alreadyDone: platformStatus.ee_po, handler: () => handleUpdateEEPO(requestIdOverride) }]
        : []),
    ];

    const results: StepOutcome[] = [];
    let stopped = false;
    for (const step of steps) {
      if (stopped) {
        results.push({ key: step.key, label: step.label, status: 'skipped' });
        continue;
      }
      if (step.alreadyDone) {
        results.push({ key: step.key, label: step.label, status: 'success' });
        continue;
      }
      const ok = await step.handler();
      if (ok) {
        results.push({ key: step.key, label: step.label, status: 'success' });
      } else {
        setStepFailed(f => ({ ...f, [step.key]: true }));
        results.push({ key: step.key, label: step.label, status: 'failed' });
        stopped = true;
      }
    }
    setRunSummary(results);
  };

  const retryPlatform = async (
    step: 'ee' | 'zoho' | 'shopify' | 'ee_po',
    handler: () => Promise<boolean>
  ) => {
    setStepFailed(f => ({ ...f, [step]: false }));
    // Same pre-flight as Create Listing: the step reads the stored row.
    const flushed = await persistDraft();
    if (!flushed.ok) {
      noteStepError(step, 'Your latest changes could not be saved first, so this step was not run: ' + flushed.error);
      setStepFailed(f => ({ ...f, [step]: true }));
      return;
    }
    const ok = await handler();
    if (!ok) setStepFailed(f => ({ ...f, [step]: true }));
  };

  // True once any platform step has actually created something live — a
  // request in this state can no longer be safely rejected, since Reject
  // only flips our internal tracking status and never touches
  // EasyEcom/Zoho/Shopify/the PO. Rejecting past this point would hide a
  // still-live duplicate listing instead of preventing one.
  const anyPlatformDone = platformStatus.ee || platformStatus.zoho || platformStatus.shopify || platformStatus.ee_po;

  const handleConfirmReject = async (remark: string) => {
    if (anyPlatformDone) return; // defense-in-depth — button is disabled, but guard the call too
    try {
      const result = await callGas(API_ACTIONS.REJECT_SKU_REQUEST, {
        request_id:  requestId,
        remark,
        rejected_by: getCurrentActor(),
      });
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

  const handleMarkComplete = async () => {
    setMarkCompleteLoading(true);
    try {
      const result = await callGas(API_ACTIONS.MARK_SKU_COMPLETE, {
        request_id:   requestId,
        completed_by: getCurrentActor(),
      });
      if (result.success) {
        setSourceData(d => ({ ...d, status: 'CREATED' }));
        setShowMarkCompleteConfirm(false);
      } else {
        alert('Mark as Complete failed: ' + result.error);
      }
    } catch (err) {
      alert('Network error');
      console.error(err);
    } finally {
      setMarkCompleteLoading(false);
    }
  };

  // Sequential lock check (debug mode overrides)
  const canDoStep = (step: 'ee' | 'zoho' | 'shopify' | 'ee_po'): boolean => {
    if (debugMode) return true;
    // For manual entry — must save first to get a real request_id
    if (isNew && !savedRequestId) return false;
    switch (step) {
      case 'ee':      return true;
      case 'zoho':    return platformStatus.ee;
      case 'shopify': return platformStatus.zoho;
      case 'ee_po':   return platformStatus.shopify;
      default:        return false;
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto p-6 flex flex-col h-screen overflow-hidden animate-in fade-in duration-500">

      {/* ─── SKU AUTO-ASSIGN STATUS BANNERS ─── */}
      <div className="fixed top-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
        {skuAssignSuccess && (
          <div className="bg-emerald-50 dark:bg-emerald-950/95 border border-emerald-500/55 rounded-xl p-4 text-emerald-800 dark:text-emerald-200 flex items-start justify-between shadow-xl animate-fade-in pointer-events-auto">
            <div className="flex gap-2 w-full">
              <CheckBadgeIcon className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <div className="text-sm font-semibold">
                SKU assigned successfully: <span className="font-bold">{skuAssignSuccess}</span>
              </div>
            </div>
            <button onClick={() => setSkuAssignSuccess(null)} className="text-emerald-500 hover:text-emerald-700 cursor-pointer shrink-0 ml-2">
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
        )}

        {skuAssignError && (
          <div className="bg-rose-50 dark:bg-rose-950/95 border border-rose-500/55 rounded-xl p-4 text-rose-800 dark:text-rose-200 flex items-start justify-between shadow-xl animate-fade-in pointer-events-auto overflow-hidden">
            <div className="flex gap-2 w-full">
              <ExclamationTriangleIcon className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <div className="text-sm font-semibold overflow-hidden text-ellipsis">{skuAssignError}</div>
            </div>
            <button onClick={() => setSkuAssignError(null)} className="text-rose-500 hover:text-rose-700 cursor-pointer shrink-0 ml-2">
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* ─── LISTING TABS ─── */}
      {!isNew && (
        <div className="flex items-center gap-2 mb-4 px-1">
          {listingTabs.map((tab, idx) => (
            <button
              key={tab.requestId}
              onClick={() => {
                setActiveTab(idx);
                // TODO: full tab switching requires onOpenDetail prop — wire in next session
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                activeTab === idx
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700/60 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <button
            onClick={handleAddVariant}
            disabled={addingVariant}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 dark:bg-gray-700/60 text-gray-500 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-600 dark:hover:text-blue-400 border border-dashed border-gray-300 dark:border-gray-600 transition-all disabled:opacity-50"
          >
            {addingVariant
              ? <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              : <span>+</span>
            }
            Add Variant
          </button>

          {/* Manual refresh — re-pull this tab's data from the sheet without
              leaving the page (e.g. after another user edits it elsewhere) */}
          <button
            onClick={handleRefreshTab}
            disabled={isRefreshingTab || isLoadingSource}
            title="Refresh this tab's data from the sheet"
            className="ml-auto flex items-center justify-center w-9 h-9 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 shadow-sm transition-all disabled:opacity-50"
          >
            <ArrowPathIcon className={`w-5 h-5 ${isRefreshingTab ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}

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
                <div>
                  <FieldLabel>Other Factory Code</FieldLabel>
                  <input
                    type="text"
                    className={inputClasses}
                    value={form.factory_code_other}
                    onChange={e => updateField('factory_code_other', e.target.value)}
                    onBlur={() => { checkIdentifierDuplicates(); handleBlurSave(); }}
                    placeholder="e.g. DSYH009"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    Maps to Accounting SKU in EasyEcom
                  </p>
                  {factoryDupWarning && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">⚠ {factoryDupWarning}</p>
                  )}
                </div>
                <div>
                  <FieldLabel>Article Number</FieldLabel>
                  <input
                    type="text"
                    className={inputClasses}
                    value={form.article_number}
                    onChange={e => updateField('article_number', e.target.value)}
                    onBlur={() => { checkIdentifierDuplicates(); handleBlurSave(); }}
                    placeholder="e.g. T220031MS"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    Maps to Article Number custom field in EasyEcom
                  </p>
                  {articleDupWarning && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">⚠ {articleDupWarning}</p>
                  )}
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
                    onBlur={() => { checkIdentifierDuplicates(); handleBlurSave(); }}
                    placeholder="e.g. 6954256109533"
                  />
                  {eanDupWarning && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">⚠ {eanDupWarning}</p>
                  )}
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
                    onBlur={handleBlurSave}
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
                    onBlur={handleBlurSave}
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
                    onBlur={handleBlurSave}
                    placeholder="e.g. PW, QY, MY"
                  />
                </div>
                <div>
                  <FieldLabel>Other Factory Code</FieldLabel>
                  <input
                    type="text"
                    className={inputClasses}
                    value={form.factory_code_other}
                    onChange={e => updateField('factory_code_other', e.target.value)}
                    onBlur={() => { checkIdentifierDuplicates(); handleBlurSave(); }}
                    placeholder="e.g. DSYH009"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    Maps to Accounting SKU in EasyEcom
                  </p>
                  {factoryDupWarning && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">⚠ {factoryDupWarning}</p>
                  )}
                </div>
                <div>
                  <FieldLabel>Article Number</FieldLabel>
                  <input
                    type="text"
                    className={inputClasses}
                    value={form.article_number}
                    onChange={e => updateField('article_number', e.target.value)}
                    onBlur={() => { checkIdentifierDuplicates(); handleBlurSave(); }}
                    placeholder="e.g. T220031MS"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    Maps to Article Number custom field in EasyEcom
                  </p>
                  {articleDupWarning && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">⚠ {articleDupWarning}</p>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* ─── SECTION B: Product Identity ─── */}
          <Card>
            <SectionHeader emoji="🏷️" title="Product Identity" />
            <div className="grid grid-cols-2 gap-4">
              {/* Sample marker — same creation flow as any other SKU, just
                  tagged so it's identifiable later (e.g. filterable in
                  Update SKU search) instead of relying on a separate EAN
                  scheme that collides once the real SKU is listed. */}
              <div className="col-span-2 flex items-center gap-2 -mb-1">
                <input
                  id="is-sample-checkbox"
                  type="checkbox"
                  checked={form.is_sample}
                  onChange={e => updateField('is_sample', e.target.checked)}
                  onBlur={handleBlurSave}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="is-sample-checkbox" className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                  This is a Sample
                </label>
              </div>

              {/* Row 1: Suggested SKU (full width) — Auto-assign action lives in the Actions panel */}
              <div className="col-span-2">
                <FieldLabel>Suggested SKU</FieldLabel>
                <input
                  className={inputClasses}
                  value={form.suggested_sku}
                  onChange={e => updateField('suggested_sku', e.target.value)}
                  onBlur={handleBlurSave}
                  placeholder="Auto-assigned or manual entry"
                />
                {skuDupWarning && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">⚠ {skuDupWarning}</p>
                )}
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
                    onBlur={handleBlurSave}
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
                  onBlur={handleBlurSave}
                >
                  <option value="">Select category...</option>
                  {categoryOptions.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>Brand</FieldLabel>
                <ComboBox
                  id="brand-combobox"
                  value={form.brand}
                  onChange={val => { updateField('brand', val); handleNewBrand(val); }}
                  onBlur={handleBlurSave}
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
                  onBlur={handleBlurSave}
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
                  onBlur={handleBlurSave}
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
                    onBlur={handleBlurSave}
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
                          onBlur={handleBlurSave}
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
                  onBlur={handleBlurSave}
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
                  onBlur={handleBlurSave}
                  placeholder="0.00"
                />
              </div>
              <div>
                <FieldLabel>Compare At Price (₹)</FieldLabel>
                <input
                  type="number"
                  className={inputClasses}
                  value={form.shopify_compare_price}
                  onChange={e => updateField('shopify_compare_price', e.target.value ? Number(e.target.value) : '')}
                  onBlur={handleBlurSave}
                  placeholder="0.00"
                />
                {pricing && !pricing.needsWeight && pricing.compare_at_price != null && (
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                    Suggested: ₹{pricing.compare_at_price}
                  </p>
                )}
              </div>
            </div>
            {pricing && !pricing.needsWeight && (
              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
                Based on ¥{unitPrice} × {pricingConfig?.cny_conv_rate} conv rate
                {pricing.mode === 'SEA'
                  ? ` × ${pricingConfig?.sea_multiplier} (SEA)`
                  : ` + ${weightGm}g × ₹${pricingConfig?.air_rate}/g (AIR)`
                }
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
                    onBlur={handleBlurSave}
                  />
                </div>
                <div>
                  <FieldLabel>Pkg Length (cm)</FieldLabel>
                  <input
                    type="number"
                    className={inputClasses}
                    value={form.pkg_length_cm}
                    onChange={e => updateField('pkg_length_cm', e.target.value ? Number(e.target.value) : '')}
                    onBlur={handleBlurSave}
                  />
                </div>
                <div>
                  <FieldLabel>Pkg Width (cm)</FieldLabel>
                  <input
                    type="number"
                    className={inputClasses}
                    value={form.pkg_width_cm}
                    onChange={e => updateField('pkg_width_cm', e.target.value ? Number(e.target.value) : '')}
                    onBlur={handleBlurSave}
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
                    onBlur={handleBlurSave}
                  />
                </div>
                <div>
                  <FieldLabel>Product Dims (mm)</FieldLabel>
                  <input
                    className={inputClasses}
                    value={form.product_dims_mm}
                    onChange={e => updateField('product_dims_mm', e.target.value)}
                    onBlur={handleBlurSave}
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
                    onBlur={handleBlurSave}
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
                  onBlur={handleBlurSave}
                />
              </div>
              <div>
                <FieldLabel>MOQ</FieldLabel>
                <input
                  type="number"
                  className={inputClasses}
                  value={form.moq}
                  onChange={e => updateField('moq', e.target.value ? Number(e.target.value) : '')}
                  onBlur={handleBlurSave}
                />
              </div>
              <div>
                <FieldLabel>Threshold Qty</FieldLabel>
                <input
                  type="number"
                  className={inputClasses}
                  value={form.threshold_qty}
                  onChange={e => updateField('threshold_qty', e.target.value ? Number(e.target.value) : '')}
                  onBlur={handleBlurSave}
                />
              </div>
              <div>
                <FieldLabel>Supplier Code</FieldLabel>
                <input
                  className={inputClasses}
                  value={form.supplier_code}
                  onChange={e => updateField('supplier_code', e.target.value)}
                  onBlur={handleBlurSave}
                />
              </div>
              <div>
                <FieldLabel>Pack Size</FieldLabel>
                <input
                  type="number"
                  className={inputClasses}
                  value={form.pack_size}
                  onChange={e => updateField('pack_size', e.target.value ? Number(e.target.value) : '')}
                  onBlur={handleBlurSave}
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
                  onBlur={handleBlurSave}
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
                    onBlur={handleBlurSave}
                  />
                </div>
                <div>
                  <FieldLabel>FNSKU Status on EE</FieldLabel>
                  <input
                    className={inputClasses}
                    value={form.fnsku_status_ee}
                    onChange={e => updateField('fnsku_status_ee', e.target.value)}
                    onBlur={handleBlurSave}
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
                  onBlur={handleBlurSave}
                />
              </div>
              <div>
                <FieldLabel>Notes</FieldLabel>
                <textarea
                  className={inputClasses}
                  rows={2}
                  value={form.notes}
                  onChange={e => updateField('notes', e.target.value)}
                  onBlur={handleBlurSave}
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
                    {JSON.stringify({ pricing, cm1Live, cm3Live }, null, 2)}
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

            {(pricingConfigError || (pricingConfigLoaded && !hasPricingBrackets(pricingConfig))) && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                <span>⚠️</span>
                <span>{pricingConfigError || 'Pricing brackets are missing or empty in the SKU_Config sheet, so suggested prices are unavailable. Enter MRP and selling price manually, or fix the sheet.'}</span>
              </div>
            )}
            {!pricingConfigLoaded && !pricingConfigError && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-gray-500/10 border border-gray-500/20 text-gray-400 text-xs flex items-center gap-2">
                <Spinner />
                <span>Loading pricing config...</span>
              </div>
            )}

            {!pricing ? (
              <p className="text-xs text-gray-400 text-center py-4">
                Enter RMB cost to calculate pricing
              </p>
            ) : (
              <>
                {pricing?.needsWeight && (
                  <div className="text-xs text-amber-500 flex items-center gap-1 mb-3">
                    ⚠️ Enter package weight to calculate AIR landing price
                  </div>
                )}

                {!pricing.needsWeight && (
                  <>
                    {[
                      { label: 'RMB Price',    value: `¥ ${unitPrice}`,             muted: true },
                      { label: 'Landing Cost', value: `₹ ${pricing.landing}`,       muted: false },
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

                    {/* Selling Price — shows user's actual value + the raw
                        pre-rounding figure it was bucketed from. A stored
                        value that predates a formula/config change won't
                        match the fresh suggestion — Recalculate pulls it in. */}
                    <div className="flex justify-between items-center py-2
                                    border-b border-gray-100 dark:border-gray-700">
                      <div>
                        <p className="text-sm font-bold text-gray-700 dark:text-gray-200">
                          Selling Price
                        </p>
                        {pricing && (
                          <p className="text-[10px] text-gray-400 flex items-center gap-1">
                            Raw: ₹{pricing.raw_sp}
                            {currentSP !== pricing.suggested_sp && (
                              <button
                                type="button"
                                title={`Reset to the current suggestion (₹${pricing.suggested_sp})`}
                                onClick={() => updateField('shopify_selling_price', pricing.suggested_sp)}
                                className="flex items-center gap-0.5 text-blue-500 hover:text-blue-600
                                           dark:text-blue-400 dark:hover:text-blue-300 font-semibold"
                              >
                                <ArrowPathIcon className="w-2.5 h-2.5" /> Recalculate
                              </button>
                            )}
                          </p>
                        )}
                      </div>
                      <span className="text-sm font-bold font-mono text-blue-600
                                       dark:text-blue-400">
                        ₹ {currentSP || pricing?.suggested_sp || '—'}
                      </span>
                    </div>

                    {/* MRP — shows user's actual value + the raw pre-rounding
                        figure it was bucketed from */}
                    <div className="flex justify-between items-center py-2
                                    border-b border-gray-100 dark:border-gray-700">
                      <div>
                        <p className="text-sm font-bold text-gray-700 dark:text-gray-200">
                          MRP
                        </p>
                        {pricing && (
                          <p className="text-[10px] text-gray-400 flex items-center gap-1">
                            Raw: ₹{pricing.raw_mrp}
                            {currentMRP !== pricing.mrp && (
                              <button
                                type="button"
                                title={`Reset to the current suggestion (₹${pricing.mrp})`}
                                onClick={() => updateField('mrp', pricing.mrp)}
                                className="flex items-center gap-0.5 text-blue-500 hover:text-blue-600
                                           dark:text-blue-400 dark:hover:text-blue-300 font-semibold"
                              >
                                <ArrowPathIcon className="w-2.5 h-2.5" /> Recalculate
                              </button>
                            )}
                          </p>
                        )}
                      </div>
                      <span className="text-sm font-bold font-mono
                                       text-gray-900 dark:text-white">
                        ₹ {currentMRP || pricing?.mrp || '—'}
                      </span>
                    </div>

                    {/* Compare At Price — shows user's actual value + the raw
                        pre-rounding figure it was bucketed from */}
                    {pricing.compare_at_price != null && (
                      <div className="flex justify-between items-center py-2
                                      border-b border-gray-100 dark:border-gray-700">
                        <div>
                          <p className="text-sm font-bold text-gray-700 dark:text-gray-200">
                            Compare At Price
                          </p>
                          {pricing.raw_compare_at_price != null && (
                            <p className="text-[10px] text-gray-400 flex items-center gap-1">
                              Raw: ₹{pricing.raw_compare_at_price}
                              {Number(form.shopify_compare_price) !== pricing.compare_at_price && (
                                <button
                                  type="button"
                                  title={`Reset to the current suggestion (₹${pricing.compare_at_price})`}
                                  onClick={() => updateField('shopify_compare_price', pricing.compare_at_price)}
                                  className="flex items-center gap-0.5 text-blue-500 hover:text-blue-600
                                             dark:text-blue-400 dark:hover:text-blue-300 font-semibold"
                                >
                                  <ArrowPathIcon className="w-2.5 h-2.5" /> Recalculate
                                </button>
                              )}
                            </p>
                          )}
                        </div>
                        <span className="text-sm font-bold font-mono
                                         text-gray-900 dark:text-white">
                          ₹ {Number(form.shopify_compare_price) || pricing.compare_at_price || '—'}
                        </span>
                      </div>
                    )}

                    {/* Discount simulation input */}
                    <div className="flex justify-between items-center py-2
                                    border-b border-gray-100 dark:border-gray-700">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Discount % (simulation)
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={discount}
                        onChange={e => setDiscount(Number(e.target.value) || 0)}
                        className="w-16 text-xs text-right font-mono bg-white dark:bg-gray-700
                                   border border-gray-200 dark:border-gray-600
                                   rounded px-2 py-1 text-gray-900 dark:text-white
                                   focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    {/* CM1/CM3 gauges — actual vs floor/target brackets */}
                    <div className="grid grid-cols-2 gap-2 py-3">
                      <MarginGauge
                        label="CM1"
                        value={actualCM1Live}
                        floor={pricing.cm1_floor}
                        target={pricing.cm1_target}
                        rupee={cm1Live}
                      />
                      <MarginGauge
                        label="CM3"
                        value={cm3PctLive}
                        floor={pricing.cm3_floor}
                        target={pricing.cm3_target}
                        rupee={cm3Live}
                      />
                    </div>
                    {marginWarning && (
                      <p className="text-xs text-red-500 font-semibold text-center -mt-1 mb-1">
                        ⚠️ CM1 below {pricingConfig?.min_margin_pct || 20}% minimum
                      </p>
                    )}
                  </>
                )}
              </>
            )}

            {/* ── Config in use ── */}
            <div className="mt-4 border-t border-gray-700/50 pt-3">
              <button
                onClick={() => setShowConfigPanel(p => !p)}
                className="w-full flex items-center justify-between text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
              >
                <span className="uppercase tracking-widest font-semibold">Config in use</span>
                <svg className={`w-3 h-3 transition-transform ${showConfigPanel ? 'rotate-180' : ''}`}
                     fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showConfigPanel && (
                <div className="mt-2 space-y-1.5">
                  {pricingConfig ? (
                    <>
                      {[
                        { label: 'CNY Rate',       value: pricingConfig.cny_conv_rate },
                        { label: 'AIR Rate (₹/gm)',value: pricingConfig.air_rate },
                        { label: 'SEA Multiplier', value: pricingConfig.sea_multiplier },
                        { label: 'Threshold (¥)',  value: pricingConfig.threshold },
                        { label: 'Pick & Pack',    value: `₹${pricingConfig.pick_pack}` },
                        { label: 'Shopify Cost',   value: `${(pricingConfig.shopify_cost_pct * 100).toFixed(0)}%` },
                        { label: 'GST Rate',       value: `${(pricingConfig.gst_rate * 100).toFixed(0)}%` },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex justify-between text-[10px]">
                          <span className="text-gray-500">{label}</span>
                          <span className="text-gray-300 font-medium">{value}</span>
                        </div>
                      ))}
                      <div className="mt-1.5 pt-1.5 border-t border-gray-700/40 text-[9px] text-gray-600">
                        CM1 brackets: {pricingConfig.cm1_brackets.map(b =>
                          `₹${b.floor === 999999 ? '∞' : b.floor}→${b.value}%`
                        ).join(' | ')}
                      </div>
                    </>
                  ) : (
                    <p className="text-[10px] text-gray-600">Config not loaded yet.</p>
                  )}
                </div>
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
              {/* Auto-assign SKU — precedes listing creation so a SKU is assigned first */}
              <Button
                variant="secondary"
                className="w-full text-xs"
                disabled={skuAssigning || !form.category}
                onClick={handleAutoAssignSku}
                title={!form.category ? 'Select a category first' : ''}
              >
                {skuAssigning ? <Spinner /> : <ChevronRightIcon className="w-4 h-4 mr-1" />}
                {skuAssigning ? 'Assigning...' : 'Auto-assign SKU'}
              </Button>

              {/* Divider */}
              <div className="border-t border-gray-100 dark:border-gray-700 my-3" />

              {/* Create Listing — single action, or per-step status once started */}
              {!creationStarted && !manualStepsExpanded && !platformStatus.ee && !platformStatus.zoho && !platformStatus.shopify && !platformStatus.ee_po ? (
                <>
                  <Button
                    variant="primary"
                    className="w-full text-xs"
                    disabled={loading.save || needsWeight}
                    title={needsWeight ? 'Enter the package weight first' : undefined}
                    onClick={handleCreateListing}
                  >
                    <ChevronRightIcon className="w-4 h-4 mr-1" />
                    Create Listing
                  </Button>
                  {needsWeight && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 -mt-1">
                      Enter Pkg Weight first — items costing ¥{pricingConfig?.threshold ?? 40} or less ship by air and are priced per gram.
                    </p>
                  )}
                  {canDoStep('ee') && (
                    <button
                      onClick={() => setManualStepsExpanded(true)}
                      className="w-full text-center text-xs text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 mt-1"
                    >
                      Already exists on EasyEcom or Zoho? Attach instead of creating →
                    </button>
                  )}
                </>
              ) : (
                <>
                  {([
                    { key: 'ee' as const,      label: 'EasyEcom',           actionLabel: 'Create on EasyEcom', handler: handleCreateEE,      attachActionLabel: 'Attach Existing EasyEcom SKU', attachHandler: handleAttachExistingEE, showPendingAction: false },
                    { key: 'zoho' as const,    label: 'Zoho',               actionLabel: 'Create on Zoho',     handler: handleCreateZoho,    attachActionLabel: 'Attach Existing Zoho Item',    attachHandler: handleAttachExistingZoho, showPendingAction: false },
                    // Shopify and the EE Purchase Order have no "attach existing" option, so
                    // their pending rows used to render NO button at all — after a reload
                    // (or coming back to a request whose step had failed) there was no way
                    // to run them from here. showPendingAction gives them a plain action
                    // button. Safe to press repeatedly: Shopify links an existing listing
                    // instead of duplicating it, and the PO call is an update ('U') that
                    // re-sends the same lines.
                    { key: 'shopify' as const, label: 'Shopify',            actionLabel: 'Create on Shopify',  handler: handleCreateShopify, attachActionLabel: null, attachHandler: null, showPendingAction: true },
                    ...(sourceData.shipment_id
                      ? [{ key: 'ee_po' as const, label: 'EE Purchase Order', actionLabel: 'Update EE PO', handler: handleUpdateEEPO, attachActionLabel: null, attachHandler: null, showPendingAction: true }]
                      : []),
                  ]).map(({ key, label, actionLabel, handler, attachActionLabel, attachHandler, showPendingAction }) => {
                    if (platformStatus[key]) {
                      return (
                        <div key={key} className="space-y-1">
                          <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-green-50 dark:bg-green-900/20">
                            <CheckBadgeIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
                            <span className="text-xs font-semibold text-green-600 dark:text-green-400">{label} — Done</span>
                          </div>
                          {stepNotes[key] && (
                            <p className="text-[11px] text-green-700 dark:text-green-400 px-1">{stepNotes[key]}</p>
                          )}
                        </div>
                      );
                    }
                    if (loading[key]) {
                      return (
                        <div key={key} className="flex items-center gap-2 py-2 px-3 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                          <Spinner />
                          <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">{label} — In Progress</span>
                        </div>
                      );
                    }
                    if (stepFailed[key]) {
                      return (
                        <div key={key} className="space-y-1">
                          <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-red-50 dark:bg-red-900/20">
                            <XMarkIcon className="w-4 h-4 text-red-600 dark:text-red-400" />
                            <span className="text-xs font-semibold text-red-600 dark:text-red-400">{label} — Failed</span>
                          </div>
                          {stepErrors[key] && (
                            <p className="text-[11px] text-red-600 dark:text-red-400 px-1 break-words">{String(stepErrors[key]).slice(0, 300)}</p>
                          )}
                          <Button
                            variant="primary"
                            className="w-full text-xs"
                            onClick={() => retryPlatform(key, handler)}
                          >
                            <ArrowPathIcon className="w-4 h-4 mr-1" />
                            Retry {label}
                          </Button>
                        </div>
                      );
                    }
                    return (
                      <div key={key} className="space-y-1">
                        <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-gray-50 dark:bg-gray-700/30">
                          <ClockIcon className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                          <span className="text-xs font-semibold text-gray-400 dark:text-gray-500">{label} — Pending</span>
                        </div>
                        {attachHandler && (
                          <div className="flex gap-2">
                            <Button
                              variant="primary"
                              className="flex-1 text-xs"
                              disabled={needsWeight}
                              title={needsWeight ? 'Enter the package weight first' : undefined}
                              onClick={() => retryPlatform(key, handler)}
                            >
                              {actionLabel}
                            </Button>
                            <Button
                              variant="secondary"
                              className="flex-1 text-xs"
                              onClick={() => retryPlatform(key, attachHandler)}
                              title={`Attaches this request's exact Suggested SKU — it must already exist on ${label}`}
                            >
                              {attachActionLabel}
                            </Button>
                          </div>
                        )}
                        {showPendingAction && !attachHandler && (
                          <Button
                            variant="primary"
                            className="w-full text-xs"
                            disabled={!canDoStep(key)}
                            onClick={() => retryPlatform(key, handler)}
                            title={!canDoStep(key) ? 'The previous step must be done first' : `Runs ${label} creation. If it already exists there it is linked, not duplicated.`}
                          >
                            <ChevronRightIcon className="w-4 h-4 mr-1" />
                            {actionLabel}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </>
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
              {/* Mark as Complete — for Action Required requests where no
                  further action is actually needed; forces status straight
                  to CREATED without running remaining platform steps. */}
              {!isNew && sourceData.status === 'ACTION_REQ' && (
                <>
                  <Button
                    variant="secondary"
                    className="w-full text-xs"
                    onClick={() => setShowMarkCompleteConfirm(prev => !prev)}
                  >
                    <CheckBadgeIcon className="w-4 h-4 mr-1" />
                    Mark as Complete
                  </Button>

                  {showMarkCompleteConfirm && (
                    <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800/50 space-y-2 animate-in slide-in-from-top-1 duration-200">
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Force-complete this request without running the remaining platform steps? Any steps not yet done will stay as they are.
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="primary"
                          className="text-xs flex-1"
                          onClick={handleMarkComplete}
                          disabled={markCompleteLoading}
                        >
                          {markCompleteLoading ? <Spinner /> : null}
                          Confirm Complete
                        </Button>
                        <button
                          onClick={() => setShowMarkCompleteConfirm(false)}
                          className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
              {/* Reject Request */}
              {!isNew && !isRejected && sourceData.status !== 'REJECTED' && (
                <>
                  <Button
                    variant="danger"
                    className="w-full text-xs"
                    disabled={anyPlatformDone}
                    title={anyPlatformDone ? 'Cannot reject — EasyEcom/Zoho/Shopify listing(s) already exist for this request.' : undefined}
                    onClick={() => setShowRejectConfirm(prev => !prev)}
                  >
                    <XMarkIcon className="w-4 h-4 mr-1" />
                    Reject Request
                  </Button>
                  {anyPlatformDone && (
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 -mt-1">
                      Cannot reject — EasyEcom/Zoho/Shopify listing(s) already exist for this request.
                    </p>
                  )}

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

              {/* Divider */}
              <div className="border-t border-gray-100 dark:border-gray-700 my-3" />

              {/* Done — always shown at the bottom of Actions; greyed out until
                  every applicable creation step has succeeded, then offers a
                  direct way back to the dashboard instead of only the header link */}
              {(() => {
                const allStepsDone =
                  platformStatus.ee && platformStatus.zoho && platformStatus.shopify &&
                  (!sourceData.shipment_id || platformStatus.ee_po);
                return (
                  <Button
                    variant="primary"
                    className="w-full text-xs"
                    disabled={!allStepsDone}
                    onClick={onBack}
                    title={allStepsDone
                      ? 'Returns you to the dashboard'
                      : 'Complete the listing creation process to enable this button'}
                  >
                    <CheckBadgeIcon className="w-4 h-4 mr-1" />
                    Done
                  </Button>
                );
              })()}
            </div>
          </Card>
        </div>
      </div>
      {(loading.save || saveError || savedToast) && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 bg-gray-900 dark:bg-gray-800 text-white text-xs font-semibold rounded-xl shadow-xl border border-gray-700 animate-in slide-in-from-bottom-2 duration-200">
          {loading.save ? (
            <>
              <Spinner />
              Saving...
            </>
          ) : saveError ? (
            <>
              <ExclamationTriangleIcon className="w-3.5 h-3.5 text-amber-400" />
              Save failed. Retrying...
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </>
          )}
        </div>
      )}

      {/* Create Listing run summary — shown once the sequence stops, either
          after all steps were attempted or at the first failure */}
      {runSummary && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
          onClick={() => setRunSummary(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                {runSummary.some(r => r.status === 'failed')
                  ? 'Listing creation — action needed'
                  : 'Listing creation complete'}
              </h3>
              <button
                onClick={() => setRunSummary(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-2">
              {runSummary.map(r => (
                <div key={r.key} className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-gray-700 dark:text-gray-300">{r.label}</span>
                  {r.status === 'success' && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                      <CheckBadgeIcon className="w-4 h-4" /> Success
                    </span>
                  )}
                  {r.status === 'failed' && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400">
                      <XMarkIcon className="w-4 h-4" /> Failed
                    </span>
                  )}
                  {r.status === 'skipped' && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-gray-400 dark:text-gray-500">
                      <ClockIcon className="w-4 h-4" /> Skipped
                    </span>
                  )}
                </div>
              ))}
              {runSummary.some(r => r.status === 'failed') && (
                <p className="text-xs text-gray-400 dark:text-gray-500 pt-1">
                  Use the retry button under the failed step to try again — steps already
                  marked Success won't be re-run.
                </p>
              )}
            </div>
            <div className="p-4 pt-0">
              <Button
                variant="secondary"
                className="w-full text-xs"
                onClick={() => setRunSummary(null)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
