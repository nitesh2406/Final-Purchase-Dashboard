import React, { useState, useEffect } from 'react';
import { APPS_SCRIPT_URL, API_ACTIONS } from '../../constants';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { ReviewRequestsTab } from './ReviewRequestsTab';
import {
  MagnifyingGlassIcon,
  CheckBadgeIcon,
  XMarkIcon,
  ClockIcon,
  ExclamationTriangleIcon,
} from '../icons/Icons';

// ─────────────────────────────────────────
// Update SKU — search any SKU (by SKU, name, or request ID), edit any
// field regardless of the Create SKU tab's platform-lock state, and on
// save push only the changed fields to whichever platform(s) they
// actually belong to (EasyEcom / Zoho / Shopify). See
// apiSearchSkuForUpdate / apiProvisionSkuForUpdate / apiUpdateSkuFields
// in AppBuilding/18_newskuapi.gs for the backend side of this screen.
// ─────────────────────────────────────────

interface SearchResult {
  linked: boolean;
  request_id?: string;
  suggested_sku: string;
  listing_name: string;
  status?: string;
  is_sample?: boolean;
}

interface SkuRecord {
  request_id: string;
  suggested_sku: string;
  status: string;
  ee_sku: string;
  zoho_created_date: string;
  shopify_listing_url: string;
  listing_name: string;
  variant: string;
  brand: string;
  category: string;
  color: string;
  mrp: number;
  shopify_selling_price: number;
  ean: string;
  pack_size: number;
  pkg_height_cm: number;
  pkg_length_cm: number;
  pkg_width_cm: number;
  pkg_weight_gm: number;
  product_dims_mm: string;
  nw_gm: number;
  unit_price: number;
  fnsku: string;
  factory_code: string;
  lead_time: number;
  moq: number;
  threshold_qty: number;
  supplier_code: string;
  remark: string;
  relevant_tags: string;
  invoice_qty: number;
  vendor_code: string;
  notes: string;
  is_sample: boolean;
}

const EDITABLE_FIELDS: (keyof SkuRecord)[] = [
  'listing_name', 'variant', 'brand', 'category', 'color',
  'mrp', 'shopify_selling_price', 'ean',
  'pack_size', 'pkg_height_cm', 'pkg_length_cm', 'pkg_width_cm', 'pkg_weight_gm',
  'product_dims_mm', 'nw_gm', 'unit_price', 'fnsku', 'factory_code',
  'lead_time', 'moq', 'threshold_qty', 'supplier_code', 'remark',
  'relevant_tags', 'invoice_qty', 'vendor_code', 'notes', 'is_sample',
];

const NUMERIC_FIELDS = new Set<keyof SkuRecord>([
  'mrp', 'shopify_selling_price', 'pack_size',
  'pkg_height_cm', 'pkg_length_cm', 'pkg_width_cm', 'pkg_weight_gm',
  'nw_gm', 'unit_price', 'lead_time', 'moq', 'threshold_qty', 'invoice_qty',
]);

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1 block">
    {children}
  </label>
);

const inputClasses = "w-full text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all";

const SectionHeader: React.FC<{ emoji: string; title: string }> = ({ emoji, title }) => (
  <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100 dark:border-gray-700">
    <span className="text-base">{emoji}</span>
    <h2 className="text-sm font-bold text-gray-800 dark:text-white uppercase tracking-wider">{title}</h2>
  </div>
);

export const UpdateSkuScreen: React.FC<{
  onBack: () => void;
  initialSku?: string;
  isAdmin?: boolean;
}> = ({ onBack, initialSku, isAdmin = false }) => {
  const [activeTab, setActiveTab] = useState<'search' | 'review'>('search');
  const [query, setQuery] = useState(initialSku || '');
  const [sampleOnly, setSampleOnly] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);

  const [loadingRecord, setLoadingRecord] = useState(false);
  const [original, setOriginal] = useState<SkuRecord | null>(null);
  const [form, setForm] = useState<SkuRecord | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveSummary, setSaveSummary] = useState<{
    fields_saved: string[];
    platforms: { easyecom: string; zoho: string; shopify: string };
  } | null>(null);

  const runSearch = async (q: string, sampleOnlyOverride?: boolean) => {
    if (!q.trim()) return;
    setSearching(true);
    setSearchError(null);
    setResults(null);
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: API_ACTIONS.SEARCH_SKU_FOR_UPDATE, query: q.trim(), sample_only: sampleOnlyOverride ?? sampleOnly })
      });
      const result = await response.json();
      if (result.success) {
        setResults(result.data);
      } else {
        setSearchError(result.error || 'Search failed');
      }
    } catch (err) {
      setSearchError('Network error while searching');
      console.error('runSearch error:', err);
    } finally {
      setSearching(false);
    }
  };

  // Deep-link support — e.g. the "Needs Attention" review list on the
  // Create SKU dashboard links here with ?sku=..., so auto-run the search
  // once on mount instead of requiring the user to press Search again.
  useEffect(() => {
    if (initialSku) runSearch(initialSku);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRecord = async (requestId: string) => {
    setLoadingRecord(true);
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: API_ACTIONS.GET_NEW_SKU_REQUEST_BY_ID, request_id: requestId })
      });
      const result = await response.json();
      if (result.success) {
        const rec: SkuRecord = {
          request_id:            result.data.request_id,
          suggested_sku:         result.data.suggested_sku || '',
          status:                result.data.status || '',
          ee_sku:                result.data.ee_sku || '',
          zoho_created_date:     result.data.zoho_created_date || '',
          shopify_listing_url:   result.data.shopify_listing_url || '',
          listing_name:          result.data.listing_name || result.data.item_name || '',
          variant:               result.data.variant || '',
          brand:                 result.data.brand || '',
          category:              result.data.category || '',
          color:                 result.data.color || '',
          mrp:                   result.data.mrp || 0,
          shopify_selling_price: result.data.shopify_selling_price || 0,
          ean:                   result.data.ean || '',
          pack_size:             result.data.pack_size || 0,
          pkg_height_cm:         result.data.pkg_height_cm || 0,
          pkg_length_cm:         result.data.pkg_length_cm || 0,
          pkg_width_cm:          result.data.pkg_width_cm || 0,
          pkg_weight_gm:         result.data.pkg_weight_gm || 0,
          product_dims_mm:       result.data.product_dims_mm || '',
          nw_gm:                 result.data.nw_gm || 0,
          unit_price:            result.data.unit_price || 0,
          fnsku:                 result.data.fnsku || '',
          factory_code:          result.data.factory_code || '',
          lead_time:             result.data.lead_time || 0,
          moq:                   result.data.moq || 0,
          threshold_qty:         result.data.threshold_qty || 0,
          supplier_code:         result.data.supplier_code || '',
          remark:                result.data.remark || '',
          relevant_tags:         result.data.relevant_tags || '',
          invoice_qty:           result.data.invoice_qty || 0,
          vendor_code:           result.data.vendor_code || '',
          notes:                 result.data.notes || '',
          is_sample:             !!result.data.is_sample,
        };
        setOriginal(rec);
        setForm(rec);
        setSaveSummary(null);
      } else {
        setSearchError(result.error || 'Failed to load SKU');
      }
    } catch (err) {
      setSearchError('Network error while loading SKU');
      console.error('loadRecord error:', err);
    } finally {
      setLoadingRecord(false);
    }
  };

  const selectResult = async (r: SearchResult) => {
    if (r.linked && r.request_id) {
      await loadRecord(r.request_id);
      return;
    }
    // Unlinked — provision a backing row first, then load it.
    setLoadingRecord(true);
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: API_ACTIONS.PROVISION_SKU_FOR_UPDATE, sku: r.suggested_sku })
      });
      const result = await response.json();
      if (result.success) {
        await loadRecord(result.data.request_id);
      } else {
        setSearchError(result.error || 'Failed to provision SKU for editing');
        setLoadingRecord(false);
      }
    } catch (err) {
      setSearchError('Network error while provisioning SKU');
      setLoadingRecord(false);
      console.error('selectResult error:', err);
    }
  };

  const updateField = (field: keyof SkuRecord, value: any) => {
    setForm(f => f ? { ...f, [field]: value } : f);
  };

  const isDirty = !!(form && original && EDITABLE_FIELDS.some(f => form[f] !== original[f]));

  const handleSave = async () => {
    if (!form || !original) return;
    const changed: Record<string, any> = {};
    EDITABLE_FIELDS.forEach(f => {
      if (form[f] !== original[f]) changed[f] = form[f];
    });
    if (Object.keys(changed).length === 0) return;

    setSaving(true);
    setSaveSummary(null);
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action:     API_ACTIONS.UPDATE_SKU_FIELDS,
          request_id: form.request_id,
          fields:     changed,
        })
      });
      const result = await response.json();
      if (result.success) {
        setOriginal(form);
        setSaveSummary(result.data);
      } else {
        alert('Save failed: ' + result.error);
      }
    } catch (err) {
      alert('Network error while saving');
      console.error('handleSave error:', err);
    } finally {
      setSaving(false);
    }
  };

  const renderTextField = (field: keyof SkuRecord, label: string, placeholder = '') => (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        type={NUMERIC_FIELDS.has(field) ? 'number' : 'text'}
        className={inputClasses}
        value={form ? (form[field] as any) : ''}
        onChange={e => updateField(
          field,
          NUMERIC_FIELDS.has(field) ? (e.target.value ? Number(e.target.value) : 0) : e.target.value
        )}
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <div className="max-w-[1200px] mx-auto p-6 space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          ← Back to Requests
        </button>
        <span className="text-gray-300 dark:text-gray-600">/</span>
        <span className="text-sm font-semibold text-gray-900 dark:text-white">Update SKU</span>
      </div>

      {/* Tab strip — Review Requests only shown/usable for admins, since
          approving a request pushes live to EasyEcom master data */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setActiveTab('search')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
            activeTab === 'search'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          }`}
        >
          Search &amp; Edit
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab('review')}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              activeTab === 'review'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            Review Requests
          </button>
        )}
      </div>

      {activeTab === 'review' && isAdmin ? (
        <ReviewRequestsTab />
      ) : (
      <>

      {/* Search */}
      <Card>
        <SectionHeader emoji="🔍" title="Search" />
        <div className="flex gap-2">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runSearch(query); }}
              placeholder="Search by SKU, product name, or request ID..."
              className={`${inputClasses} pl-9`}
            />
          </div>
          <Button variant="primary" onClick={() => runSearch(query)} disabled={searching || !query.trim()}>
            {searching ? 'Searching...' : 'Search'}
          </Button>
        </div>

        <label className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={sampleOnly}
            onChange={e => {
              setSampleOnly(e.target.checked);
              if (query.trim()) runSearch(query, e.target.checked);
            }}
            className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Samples only
        </label>

        {searchError && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs">
            <ExclamationTriangleIcon className="w-4 h-4" />
            {searchError}
          </div>
        )}

        {results && results.length === 0 && !searchError && (
          <p className="mt-3 text-xs text-gray-400 text-center py-4">No SKUs found matching "{query}"</p>
        )}

        {results && results.length > 0 && (
          <div className="mt-3 space-y-1">
            {results.map(r => (
              <button
                key={r.request_id || r.suggested_sku}
                onClick={() => selectResult(r)}
                disabled={loadingRecord}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 border border-gray-100 dark:border-gray-700 transition-colors disabled:opacity-50"
              >
                <div>
                  <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">{r.suggested_sku}</span>
                  <span className="ml-2 text-gray-600 dark:text-gray-300">{r.listing_name}</span>
                  {r.is_sample && (
                    <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      Sample
                    </span>
                  )}
                </div>
                {r.linked ? (
                  <span className="text-[10px] font-semibold text-gray-400 uppercase">{r.status}</span>
                ) : (
                  <span className="text-[10px] font-semibold text-amber-500 uppercase">Not yet in dashboard</span>
                )}
              </button>
            ))}
          </div>
        )}
      </Card>

      {loadingRecord && (
        <div className="text-center py-8 text-sm text-gray-400">Loading SKU...</div>
      )}

      {form && !loadingRecord && (
        <>
          {/* Identity — read-only, except the Sample marker */}
          <Card>
            <SectionHeader emoji="🏷️" title="Identity" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <FieldLabel>Suggested SKU</FieldLabel>
                <p className="text-sm font-mono font-semibold text-gray-900 dark:text-white">{form.suggested_sku}</p>
              </div>
              <div>
                <FieldLabel>Sample</FieldLabel>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_sample}
                    onChange={e => updateField('is_sample', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{form.is_sample ? 'Yes' : 'No'}</span>
                </label>
              </div>
              <div>
                <FieldLabel>EasyEcom</FieldLabel>
                {form.ee_sku ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                    <CheckBadgeIcon className="w-4 h-4" /> Live
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-gray-400"><ClockIcon className="w-4 h-4" /> Not created</span>
                )}
              </div>
              <div>
                <FieldLabel>Zoho</FieldLabel>
                {form.zoho_created_date ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                    <CheckBadgeIcon className="w-4 h-4" /> Live
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-gray-400"><ClockIcon className="w-4 h-4" /> Not created</span>
                )}
              </div>
              <div>
                <FieldLabel>Shopify</FieldLabel>
                {form.shopify_listing_url ? (
                  <span className="flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                    <CheckBadgeIcon className="w-4 h-4" /> Live
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-gray-400"><ClockIcon className="w-4 h-4" /> Not created</span>
                )}
              </div>
            </div>
          </Card>

          {/* Basic Info */}
          <Card>
            <SectionHeader emoji="📋" title="Basic Info" />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {renderTextField('listing_name', 'Listing Name')}
              {renderTextField('variant', 'Variant')}
              {renderTextField('brand', 'Brand')}
              {renderTextField('category', 'Category')}
              {renderTextField('color', 'Color')}
            </div>
          </Card>

          {/* Pricing */}
          <Card>
            <SectionHeader emoji="💰" title="Pricing" />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {renderTextField('unit_price', 'Cost (RMB ¥)')}
              {renderTextField('mrp', 'MRP (₹)')}
              {renderTextField('shopify_selling_price', 'Selling Price (₹)')}
            </div>
          </Card>

          {/* Physical Specs — the 5 IMP-flaggable fields live here */}
          <Card>
            <SectionHeader emoji="📦" title="Physical Specs" />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {renderTextField('ean', 'EAN / ID')}
              {renderTextField('pack_size', 'Size (Pack Size)')}
              {renderTextField('pkg_weight_gm', 'Pkg Weight (gm)')}
              {renderTextField('pkg_height_cm', 'Pkg Height (cm)')}
              {renderTextField('pkg_length_cm', 'Pkg Length (cm)')}
              {renderTextField('pkg_width_cm', 'Pkg Width (cm)')}
              {renderTextField('product_dims_mm', 'Product Dims (mm)')}
              {renderTextField('nw_gm', 'Item Weight / Net Weight (gm)')}
            </div>
          </Card>

          {/* EasyEcom Additional Fields */}
          <Card>
            <SectionHeader emoji="⚙️" title="EasyEcom Additional Fields" />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {renderTextField('fnsku', 'FNSKU')}
              {renderTextField('factory_code', 'Factory Code (AccountingSKU|ArticleNumber)')}
              {renderTextField('lead_time', 'Lead Time (days)')}
              {renderTextField('moq', 'MOQ')}
              {renderTextField('threshold_qty', 'Threshold Qty')}
              {renderTextField('supplier_code', 'Supplier Code')}
            </div>
          </Card>

          {/* Shopify */}
          <Card>
            <SectionHeader emoji="🏪" title="Listing & Content" />
            <div className="grid grid-cols-1 gap-4">
              {renderTextField('relevant_tags', 'Relevant Tags')}
            </div>
          </Card>

          {/* Dashboard-only fields (no platform push) */}
          <Card>
            <SectionHeader emoji="📝" title="Internal (not pushed to any platform)" />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {renderTextField('vendor_code', 'Vendor Code')}
              {renderTextField('invoice_qty', 'Invoice Qty')}
              {renderTextField('remark', 'Internal Remark')}
              {renderTextField('notes', 'Notes')}
            </div>
          </Card>

          {/* Save */}
          <Card>
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400">
                {isDirty ? 'Unsaved changes — save pushes only the fields you edited to their platform(s).' : 'No changes yet.'}
              </p>
              <Button variant="primary" onClick={handleSave} disabled={!isDirty || saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </Card>
        </>
      )}

      {/* Save result popup */}
      {saveSummary && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
          onClick={() => setSaveSummary(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-sm font-bold text-gray-900 dark:text-white">Save result</h3>
              <button onClick={() => setSaveSummary(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-2">
              {(['easyecom', 'zoho', 'shopify'] as const).map(p => (
                <div key={p} className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">{p === 'easyecom' ? 'EasyEcom' : p}</span>
                  {saveSummary.platforms[p] === 'success' && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                      <CheckBadgeIcon className="w-4 h-4" /> Success
                    </span>
                  )}
                  {saveSummary.platforms[p] === 'failed' && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400">
                      <XMarkIcon className="w-4 h-4" /> Failed
                    </span>
                  )}
                  {saveSummary.platforms[p] === 'skipped' && (
                    <span className="flex items-center gap-1 text-xs font-semibold text-gray-400 dark:text-gray-500">
                      <ClockIcon className="w-4 h-4" /> Not affected
                    </span>
                  )}
                </div>
              ))}
              <p className="text-xs text-gray-400 pt-1">
                {saveSummary.fields_saved.length} field{saveSummary.fields_saved.length === 1 ? '' : 's'} saved to the sheet regardless of platform result.
              </p>
            </div>
            <div className="p-4 pt-0">
              <Button variant="secondary" className="w-full text-xs" onClick={() => setSaveSummary(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
};
