import React, { useState, useMemo, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import {
    PencilIcon, TrashIcon, MagnifyingGlassIcon,
    EyeIcon, ChevronDownIcon, ChevronUpIcon, LockClosedIcon,
    BoxIcon, ExclamationTriangleIcon, XMarkIcon,
    ArrowLeftIcon, ArrowPathIcon, CheckBadgeIcon,
    AirplaneIcon, ShipIcon, ClockIcon, FolderOpenIcon
} from '../icons/Icons';
import { DraftOrder, VendorMaster } from '../../types';
import { CustomizationModal } from './CustomizationModal';
import { SelectiveSubmitModal } from './SelectiveSubmitModal';
import { API_ACTIONS } from '../../constants';
import { callGas } from '../../services/gasApi';

interface LineItem {
    id: string;
    line_id?: string | number;
    sku: string;
    vendor: string;
    vendor_code?: string;
    vendor_name?: string;
    item_name: string;
    qty: number;
    unit_price: number;       // RMB (EE Product Master RMB_Price)
    landed_cost_inr: number;  // INR landed cost per unit (EE Product Master Cost) — estimate only
    logo: 'Yes' | 'No';
    packaging: 'Yes' | 'No';
    manual: 'Yes' | 'No';
    wrap: 'Yes' | 'No';
    remarks: string;
    customization_files: string;
    source: 'FORECAST' | 'MANUAL';
}

interface DraftOrderEditProps {
    draft: DraftOrder | null;
    initialMode?: 'SEA' | 'AIR';
    onBack: () => void;
    // Called after a successful save/create so the list re-reads drafts.
    onDraftSaved?: () => void;
    // Called after POs were created; the list refreshes and shows `message`.
    onOrdersSubmitted?: (message: string) => void;
    vendorMasters: VendorMaster[];
}

const formatInr = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);

const formatRmb = (amount: number) =>
    '¥' + Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// One line from get_draft_by_id / save_draft (or a draft's cached items) in
// the editor's shape.
const normalizeLine = (line: any): LineItem => {
    const yesNo = (ui: any, db: any): 'Yes' | 'No' =>
        ui === 'Yes' || ui === 'No' ? ui : (db === true || String(db).toLowerCase() === 'yes' || String(db).toLowerCase() === 'true') ? 'Yes' : 'No';
    return {
        id: line.line_id ? String(line.line_id) : (line.id || `ITEM-${Date.now()}-${Math.random()}`),
        line_id: line.line_id ? String(line.line_id) : undefined,
        sku: String(line.sku ?? ''),
        item_name: line.item_name || line.sku_name || line.name || line.productName || '',
        vendor: line.vendor_code || line.vendor || '',
        vendor_code: line.vendor_code || line.vendor || '',
        vendor_name: line.vendor_name || line.vendor || '',
        qty: Number(line.qty || 0),
        unit_price: Number(line.unit_price || 0),
        landed_cost_inr: Number(line.landed_cost_inr || 0),
        logo: yesNo(line.logo, line.custom_logo),
        packaging: yesNo(line.packaging, line.custom_packaging),
        manual: yesNo(line.manual, line.solving_manual),
        wrap: yesNo(line.wrap, line.opp_wrap),
        remarks: line.remarks || line.custom_remarks || '',
        customization_files: line.customization_files || '',
        source: line.source || 'FORECAST'
    };
};

// Draft status as one key: the backend has used 'Draft', 'DRAFT',
// 'PARTIALLY_SUBMITTED' and 'PARTIALLY SUBMITTED' for the same states.
const statusKeyOf = (status?: string) => String(status || 'DRAFT').trim().toUpperCase().replace(/\s+/g, '_');

const ModeBadge: React.FC<{ mode?: string }> = ({ mode }) => {
    if (!mode) return null;
    const normalized = String(mode).toUpperCase();
    const isAir = normalized === 'AIR';
    const isSea = normalized === 'SEA';
    return (
        <div className={`inline-flex items-center gap-1.5 px-3 h-[38px] text-sm font-semibold rounded border transition-colors ${isAir
            ? 'bg-sky-600/20 text-sky-400 border-sky-600/30'
            : isSea ? 'bg-blue-600/20 text-blue-400 border-blue-600/30' : 'bg-slate-800 text-slate-400'
            }`}>
            {isAir && <AirplaneIcon className="w-4 h-4" />}
            {isSea && <ShipIcon className="w-4 h-4" />}
            {mode}
        </div>
    );
};

export const DraftOrderEdit: React.FC<DraftOrderEditProps> = ({ draft, initialMode, onBack, onDraftSaved, onOrdersSubmitted, vendorMasters }) => {
    const statusKey = statusKeyOf(draft?.status);
    const isSubmittedReadOnly = statusKey === 'SUBMITTED' || statusKey === 'ORDER_PLACED';
    const isViewOnly = isSubmittedReadOnly || statusKey === 'CANCELLED';
    const isCreateMode = !draft;

    const shippingMode = (draft?.mode || draft?.planned_mode || initialMode || '') as 'SEA' | 'AIR' | '';
    const displayMode = String(draft?.planned_mode || draft?.mode || initialMode || shippingMode || '').toUpperCase() as 'SEA' | 'AIR' | '';

    const [items, setItems] = useState<LineItem[]>(() => (draft?.items || []).map(normalizeLine));
    // updated_at of the version on screen; save_draft refuses if the draft has
    // been saved by someone else since (a save replaces the whole line set).
    const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string | undefined>((draft as any)?.updated_at);

    const [searchQuery, setSearchQuery] = useState('');
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [catalogResults, setCatalogResults] = useState<any[]>([]);
    const [isSearchingCatalog, setIsSearchingCatalog] = useState(false);

    const [errorToast, setErrorToast] = useState<string | null>(null);
    const [successToast, setSuccessToast] = useState<string | null>(null);

    const [customizationItem, setCustomizationItem] = useState<LineItem | null>(null);
    const [isSubmitModalOpen, setSubmitModalOpen] = useState(false);

    useEffect(() => {
        if (searchQuery.length < 2) {
            setCatalogResults([]);
            return;
        }

        const timer = setTimeout(async () => {
            setIsSearchingCatalog(true);
            try {
                const result = await callGas(API_ACTIONS.SEARCH_SKU_CATALOG, { query: searchQuery }, 2);

                const rawItems = result.items || result.skus || result.data || [];
                const normalized = rawItems.map((item: any) => ({
                    sku: item.sku || item.master_sku || item.masterSKU,
                    item_name: item.item_name || item.sku_name || item.name || item.productName,
                    vendor: item.vendor_code || item.vendor || item.supplier || '',
                    vendor_code: item.vendor_code || item.vendor || item.supplier || '',
                    vendor_name: item.vendor_name || item.vendor || item.supplier || '',
                    unit_price: Number(item.unit_price || 0),
                    landed_cost_inr: Number(item.landed_cost_inr || 0),
                    qty: Number(item.qty !== undefined ? item.qty : (item.reorderQty !== undefined ? item.reorderQty : 0)),
                    category: item.category || '',
                    brand: item.brand || ''
                }));

                setCatalogResults(normalized);
            } catch (err) {
                console.error("Search failed:", err);
                setCatalogResults([]);
            } finally {
                setIsSearchingCatalog(false);
            }
        }, 400);

        return () => clearTimeout(timer);
    }, [searchQuery]);

    const vendorGroups = useMemo<Record<string, { items: LineItem[], total: number, isSubmitted: boolean, poId?: string }>>(() => {
        const groups: Record<string, { items: LineItem[], total: number, isSubmitted: boolean, poId?: string }> = {};
        items.forEach(item => {
            const vKey = item.vendor_code || item.vendor || 'Unknown Vendor';
            if (!groups[vKey]) {
                groups[vKey] = {
                    items: [],
                    total: 0,
                    isSubmitted: !!draft?.submittedVendors?.[vKey] || isViewOnly,
                    poId: draft?.submittedVendors?.[vKey]
                };
            }
            groups[vKey].items.push(item);
            groups[vKey].total += Number(item.qty) * Number(item.unit_price || 0);
        });
        return groups;
    }, [items, draft?.submittedVendors, isViewOnly]);

    const stats = useMemo(() => {
        const totalItems = items.reduce((sum, item) => sum + Number(item.qty), 0);
        const totalRmb = items.reduce((sum, item) => sum + (Number(item.qty) * Number(item.unit_price || 0)), 0);
        const estLandedInr = items.reduce((sum, item) => sum + (Number(item.qty) * Number(item.landed_cost_inr || 0)), 0);
        const missingRmb = items.filter(item => !(Number(item.unit_price) > 0)).length;
        const vendors = Object.keys(vendorGroups);
        return { totalItems, totalRmb, estLandedInr, missingRmb, vendorsCount: vendors.length };
    }, [items, vendorGroups]);

    const handleSelectCatalogItem = (catalogItem: any) => {
        const itemVendorCode = catalogItem.vendor_code || catalogItem.vendor || '';
        const itemVendorName = catalogItem.vendor_name || catalogItem.vendor || '';
        const poId = itemVendorCode ? draft?.submittedVendors?.[itemVendorCode] : null;
        if (poId) {
            setErrorToast(`Cannot add items for ${itemVendorName} - already submitted to ${poId}`);
            return;
        }

        const newItem: LineItem = {
            id: `ITEM-${Date.now()}-${Math.random()}`,
            sku: String(catalogItem.sku),
            item_name: catalogItem.item_name || '',
            vendor: itemVendorCode,
            vendor_code: itemVendorCode,
            vendor_name: itemVendorName,
            qty: Number(catalogItem.qty || catalogItem.reorderQty || 0),
            unit_price: Number(catalogItem.unit_price || 0),
            landed_cost_inr: Number(catalogItem.landed_cost_inr || 0),
            logo: 'No',
            packaging: 'No',
            manual: 'No',
            wrap: 'No',
            remarks: '',
            customization_files: '',
            source: 'MANUAL'
        };
        setItems(prev => [...prev, newItem]);
        setSearchQuery('');
    };

    const handleSaveDraft = async () => {
        if (isSubmittedReadOnly) return;

        if (!shippingMode && !displayMode) {
            alert('Please select shipping mode');
            return;
        }

        if (items.length === 0) {
            alert('Please add at least one item');
            return;
        }

        const itemsWithoutVendor = items.filter(item => !item.vendor && !item.vendor_code);
        if (itemsWithoutVendor.length > 0) {
            alert('Please select vendor for all items');
            return;
        }

        const itemsWithoutQty = items.filter(item => !item.qty || Number(item.qty) <= 0);
        if (itemsWithoutQty.length > 0) {
            alert('Please enter quantity for all items');
            return;
        }

        setIsSaving(true);
        setErrorToast(null);
        setSuccessToast(null);

        try {
            // The whole line set is sent: lines left out are deleted server-side.
            const lines = items.map(item => ({
                line_id: item.line_id ? String(item.line_id) : null,
                sku: item.sku,
                sku_name: item.item_name,
                qty: Number(item.qty),
                vendor_code: item.vendor || item.vendor_code,
                unit_price: Number(item.unit_price || 0),

                custom_logo: item.logo === 'Yes',
                custom_packaging: item.packaging === 'Yes',
                solving_manual: item.manual === 'Yes',
                opp_wrap: item.wrap === 'Yes',

                custom_remarks: item.remarks || '',
                customization_files: item.customization_files || ''
            }));

            // Creates/updates a draft order — never auto-retried, since a
            // garbled response can't tell us whether the write already landed.
            const result = isCreateMode
                ? await callGas('create_manual_draft', { mode: displayMode || shippingMode, lines })
                : await callGas(API_ACTIONS.SAVE_DRAFT, { draftId: draft!.id, expected_updated_at: loadedUpdatedAt, lines });

            if (result.status !== 'success') {
                throw new Error(result.message || result.error || 'Failed to save draft');
            }

            if (isCreateMode) {
                alert(`Draft Order ${result.draftId || result.draft_id} created successfully!`);
                onDraftSaved?.();
                onBack();
                return result;
            }

            // Adopt the saved lines: new lines get their line_id here, so the
            // next save updates them instead of adding them again.
            if (Array.isArray(result.lines)) setItems(result.lines.map(normalizeLine));
            if (result.draft?.updated_at) setLoadedUpdatedAt(result.draft.updated_at);
            setSuccessToast('Draft saved successfully');
            setTimeout(() => setSuccessToast(null), 3000);
            onDraftSaved?.();
            return result;
        } catch (err: any) {
            setErrorToast(err.message || 'Failed to save draft');
            throw err;
        } finally {
            setIsSaving(false);
        }
    };

    const handleSubmitClick = async () => {
        try {
            await handleSaveDraft();
            setSubmitModalOpen(true);
        } catch {
            // handleSaveDraft already shows the reason
        }
    };

    const handleSubmitDraft = async (selectedVendors: string[]) => {
        if (!draft) return;

        setIsSubmitting(true);
        setErrorToast(null);
        setSuccessToast(null);

        try {
            // Creates Purchase Orders from this draft — never auto-retried.
            const result = await callGas(API_ACTIONS.SUBMIT_DRAFT, { draftId: draft.id, vendors: selectedVendors });

            if (!result || result.success !== true) {
                throw new Error(result?.message || result?.error || "Submit failed");
            }

            setSubmitModalOpen(false);

            const createdPOs: string[] = result.newPOs || [];
            window.dispatchEvent(new CustomEvent("po:refresh", createdPOs.length > 0 ? { detail: { po_id: createdPOs[0] } } : undefined));

            onOrdersSubmitted?.(result.message || `${createdPOs.length} Purchase Order(s) created`);
        } catch (err: any) {
            setErrorToast(err.message || 'Submission failed');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSaveCustomization = async (data: any) => {
        if (!customizationItem) return;

        setItems(prev => prev.map(i => i.id === customizationItem.id ? { ...i, ...data } : i));

        try {
            const result = await callGas('save_customization', {
                payload: {
                    sku: customizationItem.sku,
                    ...data
                }
            });
            if (!result || result.success !== true) {
                throw new Error(result?.message || result?.error || "Sync failed");
            }

            setSuccessToast(`Master data for ${customizationItem.sku} updated!`);
        } catch (err: any) {
            console.error('Customization sync error:', err);
            setErrorToast(`Sync Failed: ${err.message}. Changes kept for this draft.`);
        }
    };

    const getCustomVal = (val: 'Yes' | 'No' | null | undefined | string): 'Yes' | 'No' | 'NA' => {
        if (val === null || val === undefined || val === 'NA' || val === '') return 'NA';
        return val as 'Yes' | 'No';
    };

    const Tooltip: React.FC<{ label: string; text: string }> = ({ label, text }) => (
        <th className="group relative px-1 py-3 font-medium text-center w-[5%] cursor-help border-r border-slate-250 dark:border-slate-700/30 max-w-[50px]">
            {label}
            <span className="invisible group-hover:visible absolute -top-10 left-1/2 -translate-x-1/2 bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-[10px] px-2 py-1.5 rounded whitespace-nowrap z-50 shadow-xl border border-slate-200 dark:border-slate-700 pointer-events-none">
                {text}
                <span className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-white dark:border-t-slate-900" />
            </span>
        </th>
    );

    return (
        <div className="flex flex-col min-h-screen space-y-4 text-slate-800 dark:text-white pb-32 relative bg-slate-50 dark:bg-slate-900 p-6">

            {isViewOnly && (
                <div className="flex items-center gap-3 bg-amber-900/30 border border-amber-700 rounded-xl px-4 py-3 text-amber-300 text-sm font-medium mb-2 animate-in fade-in duration-300">
                    <LockClosedIcon className="w-4 h-4 flex-shrink-0" />
                    <span>{statusKey === 'CANCELLED' ? 'This draft was cancelled and cannot be edited.' : 'This draft has been submitted and cannot be edited.'}</span>
                </div>
            )}
            {statusKey === 'PARTIALLY_SUBMITTED' && (
                <div className="flex items-center gap-3 bg-amber-900/20 border border-amber-700/60 rounded-xl px-4 py-3 text-amber-300 text-sm font-medium mb-2">
                    <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
                    <span>Some vendors have already been ordered and are locked. The remaining vendors can still be edited and submitted.</span>
                </div>
            )}

            {errorToast && (
                <div className="fixed top-24 right-8 z-[110] animate-in slide-in-from-right-8 duration-300">
                    <div className="bg-red-600 text-white px-4 py-3 rounded-lg shadow-2xl flex items-center gap-3">
                        <ExclamationTriangleIcon className="w-5 h-5" />
                        <span className="text-sm font-medium">{errorToast}</span>
                        <button onClick={() => setErrorToast(null)} className="ml-2 hover:bg-red-700 rounded p-1"><XMarkIcon className="w-4 h-4" /></button>
                    </div>
                </div>
            )}

            {successToast && (
                <div className="fixed top-24 right-8 z-[110] animate-in slide-in-from-right-8 duration-300">
                    <div className="bg-emerald-600 text-white px-4 py-3 rounded-lg shadow-2xl flex items-center gap-3">
                        <CheckBadgeIcon className="w-5 h-5" />
                        <span className="text-sm font-medium">{successToast}</span>
                        <button onClick={() => setSuccessToast(null)} className="ml-2 hover:bg-emerald-700 rounded p-1"><XMarkIcon className="w-4 h-4" /></button>
                    </div>
                </div>
            )}

            {isSubmitting && (
                <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center">
                    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-2xl flex flex-col items-center gap-4">
                        <ArrowPathIcon className="w-10 h-10 animate-spin text-blue-500" />
                        <p className="text-white font-bold animate-pulse">Processing Order Submission...</p>
                    </div>
                </div>
            )}

            <CustomizationModal
                isOpen={!!customizationItem}
                onClose={() => setCustomizationItem(null)}
                onSave={isViewOnly ? () => { } : handleSaveCustomization}
                skuData={customizationItem ? {
                    sku: customizationItem.sku,
                    itemName: customizationItem.item_name,
                    logo: customizationItem.logo,
                    packaging: customizationItem.packaging,
                    manual: customizationItem.manual,
                    wrap: customizationItem.wrap,
                    remarks: customizationItem.remarks,
                    customization_files: customizationItem.customization_files,
                    source: customizationItem.source
                } : null}
            />

            {isSubmitModalOpen && (
                <SelectiveSubmitModal
                    isOpen={true}
                    onClose={() => setSubmitModalOpen(false)}
                    onConfirm={handleSubmitDraft}
                    vendorGroups={(Object.entries(vendorGroups) as any[]).map(([v, data]) => ({
                        vendorCode: v,
                        vendorName: vendorMasters.find(vm => vm.vendor_code === v)?.vendor_name || v,
                        skuCount: data.items.length,
                        itemCount: data.items.reduce((s: any, i: any) => s + Number(i.qty), 0),
                        totalAmount: data.total,
                        isLocked: data.isSubmitted,
                        poRef: data.poId,
                        hasAllFiles: true
                    }))}
                />
            )}

            <div className="flex justify-between items-end px-1 mb-4">
                <div>
                    <div className="flex items-center gap-3 mb-1">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            isSubmittedReadOnly ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' :
                            statusKey === 'CANCELLED' ? 'bg-red-600/20 text-red-400 border border-red-500/30' :
                            statusKey === 'PARTIALLY_SUBMITTED' ? 'bg-amber-600/20 text-amber-400 border border-amber-500/30' :
                            'bg-slate-600/20 text-slate-400 border border-slate-500/30'
                        }`}>
                            {statusKey.replace(/_/g, ' ')}
                        </span>
                        <h2 className="text-2xl font-black tracking-tight text-slate-800 dark:text-white">
                            {isCreateMode ? 'Drafting New Order' : `Order Draft: ${draft?.id}`}
                        </h2>
                    </div>
                    <p className="text-xs text-slate-500 font-medium ml-0.5">
                        {isCreateMode ? 'Build a new multi-vendor purchase order draft' : `Created on ${new Date(draft?.created_at || '').toLocaleDateString()}${loadedUpdatedAt ? ` • Modified ${new Date(loadedUpdatedAt).toLocaleDateString()}` : ''}`}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="secondary" onClick={onBack} className="h-10 px-4 border-slate-700" icon={<ArrowLeftIcon className="w-4 h-4" />}>Back</Button>
                    {!isViewOnly && !isSubmittedReadOnly && (
                        <>
                            <Button
                                onClick={handleSaveDraft}
                                disabled={isSaving || (!displayMode && !shippingMode) || items.length === 0}
                                className="h-10 px-6 bg-blue-600 hover:bg-blue-700 font-bold shadow-lg shadow-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                            >
                                {isSaving ? 'Saving...' : 'Save Draft'}
                            </Button>
                            {!isCreateMode && (
                                <Button
                                    onClick={handleSubmitClick}
                                    disabled={isSaving || isSubmitting}
                                    className="h-10 px-6 bg-indigo-600 hover:bg-indigo-700 font-bold shadow-lg shadow-indigo-900/20 transition-all active:scale-95"
                                >
                                    {isSaving ? 'Saving...' : 'Submit to Vendor'}
                                </Button>
                            )}
                        </>
                    )}
                </div>
            </div>

            <div className={`bg-white dark:bg-slate-800 rounded-lg p-4 mb-2 shadow-sm border border-slate-200 dark:border-slate-700/50 w-full max-w-[320px] ${(isViewOnly || isSubmittedReadOnly) ? 'opacity-80' : ''}`}>
                <div className="flex flex-col gap-4">
                    <div className="space-y-1.5">
                        <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-0.5">
                            <ClockIcon className="w-3 h-3" /> Created
                        </label>
                        {/* POs are dated the day they are submitted (the PO number encodes it). */}
                        <p className="text-sm text-slate-800 dark:text-white px-0.5">
                            {isCreateMode ? 'Today (on save)' : new Date(draft?.created_at || '').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </p>
                    </div>
                    <div className="space-y-1.5">
                        <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-0.5">
                            <ShipIcon className="w-3 h-3" /> Shipping Mode
                        </label>
                        <ModeBadge mode={displayMode || shippingMode} />
                    </div>
                </div>
            </div>

            {!displayMode && !shippingMode && items.length > 0 && !isViewOnly && !isSubmittedReadOnly && (
                <div className="flex items-center gap-2 text-yellow-400 text-xs mb-4 px-1 animate-pulse">
                    <ExclamationTriangleIcon className="w-4 h-4" />
                    <span>No shipping mode set for this draft</span>
                </div>
            )}

            {!isViewOnly && !isSubmittedReadOnly && (
                <div className="flex flex-col space-y-3 mt-2">
                    <div className="relative group">
                        <MagnifyingGlassIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
                        <input
                            type="text"
                            placeholder="Search SKU or Item Name in Catalog..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-11 pr-4 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-slate-500 text-sm shadow-inner"
                        />
                        {searchQuery.length >= 2 && (
                            <div className="absolute top-full left-0 right-0 z-[60] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-b-lg shadow-2xl mt-1 overflow-hidden animate-in slide-in-from-top-1 duration-150">
                                {catalogResults.length > 0 ? catalogResults.map(res => {
                                    const poId = res.vendor_code ? draft?.submittedVendors?.[res.vendor_code] : null;
                                    return (
                                        <div key={res.sku} onClick={() => !poId && handleSelectCatalogItem(res)} className={`p-4 border-b border-slate-100 dark:border-slate-700/50 last:border-0 transition-colors ${poId ? 'opacity-50 cursor-not-allowed bg-slate-50 dark:bg-slate-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer'}`}>
                                            <div className="flex justify-between items-center">
                                                <span className="text-sm font-bold text-slate-800 dark:text-white">{res.sku} | {res.item_name}</span>
                                                {!poId && <span className="text-xs text-blue-500 font-bold">Add to Draft</span>}
                                            </div>
                                            <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                                                <span>
                                                    {Number(res.unit_price) > 0 ? `Price: ${formatRmb(res.unit_price)}` : 'No RMB price'}
                                                    {Number(res.landed_cost_inr) > 0 && ` • Est. landed ${formatInr(res.landed_cost_inr)}`}
                                                    {(res.vendor_name || res.vendor_code) && ` • Vendor: ${res.vendor_name || res.vendor_code}`}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                }) : !isSearchingCatalog && (
                                    <div className="p-6 text-center text-slate-500 text-sm">No items found</div>
                                )}
                                {isSearchingCatalog && (
                                    <div className="p-6 text-center text-slate-400 text-sm animate-pulse italic">Searching SKU master...</div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="space-y-4 pt-2">
                {items.length === 0 ? (
                    <div className="border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl py-24 flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-800/10">
                        <BoxIcon className="w-12 h-12 text-slate-400 dark:text-slate-700 mb-4" />
                        <h3 className="text-lg font-medium text-slate-500">No items in this draft yet</h3>
                    </div>
                ) : (Object.entries(vendorGroups) as any[]).map(([v, data]) => (
                    <Card key={v} className={`bg-white dark:bg-slate-800/20 border border-slate-200 dark:border-slate-700 p-0 overflow-hidden shadow-lg transition-all ${data.isSubmitted ? 'opacity-90 ring-1 ring-blue-500/20' : ''}`}>
                        <div onClick={() => setCollapsedGroups(prev => ({ ...prev, [v]: !prev[v] }))} className={`px-4 py-3 flex justify-between items-center border-b border-slate-200 dark:border-slate-700/50 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors ${data.isSubmitted ? 'bg-slate-100 dark:bg-slate-900/40' : 'bg-slate-50 dark:bg-slate-900/60'}`}>
                            <div className="flex items-center gap-3">
                                {collapsedGroups[v] ? <ChevronDownIcon className="w-4 h-4 text-slate-400 dark:text-slate-500" /> : <ChevronUpIcon className="w-4 h-4 text-slate-400 dark:text-slate-500" />}
                                <div className="flex items-center gap-2">
                                    <span className="font-bold text-sm tracking-wide text-slate-800 dark:text-white">
                                        {vendorMasters.find(vm => vm.vendor_code === v)?.vendor_name || v}
                                    </span>
                                    {data.isSubmitted && data.poId && <span className="bg-blue-600/20 text-blue-400 text-[10px] px-2 py-0.5 rounded font-mono border border-blue-500/30">Submitted to {data.poId}</span>}
                                </div>
                            </div>
                            <div className="text-xs font-semibold text-slate-500 flex items-center gap-6">
                                <span className="bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded text-[10px] text-slate-600 dark:text-slate-400 uppercase tracking-tighter">{data.items.length} SKUs</span>
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-400">Subtotal:</span>
                                    <span className="text-base font-bold text-slate-800 dark:text-white">{formatRmb(data.total)}</span>
                                </div>
                            </div>
                        </div>

                        {!collapsedGroups[v] && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm border-collapse table-fixed">
                                    <thead>
                                        <tr className="bg-slate-50 dark:bg-slate-900/30 text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider border-b border-slate-200 dark:border-slate-700/50">
                                            <th className="px-4 py-3 font-medium w-[10%]">SKU</th>
                                            <th className="px-4 py-3 font-medium w-[15%]">Vendor</th>
                                            <th className="px-4 py-3 font-medium w-[18%]">Item Name</th>
                                            <th className="px-4 py-3 font-medium text-center w-[8%] border-x border-slate-200 dark:border-slate-700">Qty</th>
                                            <th className="px-4 py-3 font-medium text-right w-[8%]">Price (RMB)</th>
                                            <th className="px-4 py-3 font-medium text-right w-[10%] border-r border-slate-200 dark:border-r-slate-700/30">Total (RMB)</th>
                                            <Tooltip label="LOGO" text="Custom Logo (Click to Toggle)" />
                                            <Tooltip label="PKG" text="Custom Packaging (Click to Toggle)" />
                                            <Tooltip label="MAN" text="Solving Manual (Click to Toggle)" />
                                            <Tooltip label="WRAP" text="OPP Wrap (Click to Toggle)" />
                                            <th className="px-1 py-3 font-medium text-center w-[4%] border-r border-slate-200 dark:border-slate-700/30">Files</th>
                                            <th className="px-4 py-3 font-medium text-right w-[10%]">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700/40">
                                        {data.items.map((item: any) => (
                                            <tr key={item.id} className={`transition-colors duration-150 ${data.isSubmitted ? 'opacity-60 bg-slate-50 dark:bg-slate-800/30' : 'hover:bg-slate-100 dark:hover:bg-slate-700/20'}`}>
                                                <td className="px-4 py-3 font-mono text-[11px] text-slate-500 truncate">{item.sku}</td>
                                                <td className="px-4 py-3">
                                                    {(data.isSubmitted || isSubmittedReadOnly) ? (
                                                        <span className="text-[11px] text-slate-800 dark:text-white">
                                                            {vendorMasters.find(vm => vm.vendor_code === (item.vendor_code || item.vendor))?.vendor_name || (item.vendor_name || item.vendor)}
                                                        </span>
                                                    ) : (
                                                        <select
                                                            value={item.vendor_code || item.vendor || ""}
                                                            onChange={(e) => {
                                                                const newVendorCode = e.target.value;
                                                                const vm = vendorMasters.find(m => m.vendor_code === newVendorCode);
                                                                const newVendorName = vm?.vendor_name || newVendorCode;

                                                                const targetVendorGroup = vendorGroups[newVendorCode];
                                                                if (targetVendorGroup?.isSubmitted) {
                                                                    setErrorToast(`Cannot assign to ${newVendorName} - already submitted to ${targetVendorGroup.poId}`);
                                                                    return;
                                                                }

                                                                setItems(prev => prev.map(i =>
                                                                    i.id === item.id ? {
                                                                        ...i,
                                                                        vendor: newVendorCode,
                                                                        vendor_code: newVendorCode,
                                                                        vendor_name: newVendorName
                                                                    } : i
                                                                ));
                                                            }}
                                                            className="w-full bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded px-2 py-1 text-[11px] text-slate-800 dark:text-white focus:ring-1 focus:ring-blue-500 focus:outline-none font-medium truncate"
                                                        >
                                                            <option value="" disabled className="text-slate-500">Select Vendor...</option>
                                                            {item.vendor && !vendorMasters.find(vm => vm.vendor_code === (item.vendor_code || item.vendor)) && (
                                                                <option value={item.vendor_code || item.vendor}>{item.vendor_name || item.vendor}</option>
                                                            )}
                                                            {vendorMasters.map(vm => {
                                                                const vendorGroup = vendorGroups[vm.vendor_code];
                                                                const isSubmitted = vendorGroup?.isSubmitted;
                                                                return (
                                                                    <option
                                                                        key={vm.vendor_code}
                                                                        value={vm.vendor_code}
                                                                        disabled={isSubmitted}
                                                                    >
                                                                        {vm.vendor_name} {isSubmitted ? `(PO Placed: ${vendorGroup.poId})` : ""}
                                                                    </option>
                                                                );
                                                            })}
                                                        </select>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 font-medium text-slate-800 dark:text-white truncate text-xs" title={item.item_name}>
                                                    {item.item_name}
                                                </td>
                                                <td className="px-4 py-3 text-center border-x border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                                                    {isSubmittedReadOnly ? (
                                                        <span className="font-black text-blue-600 dark:text-blue-400 text-sm">{item.qty}</span>
                                                    ) : (
                                                        <input
                                                            type="number"
                                                            disabled={data.isSubmitted}
                                                            value={item.qty}
                                                            onChange={(e) => setItems(prev => prev.map(i => i.id === item.id ? { ...i, qty: Number(e.target.value) } : i))}
                                                            className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded p-1 text-center font-bold text-blue-600 dark:text-blue-400 text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
                                                        />
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    {Number(item.unit_price) > 0 ? (
                                                        <div className="text-right text-slate-500 dark:text-slate-400 text-xs font-mono font-medium" title={item.landed_cost_inr > 0 ? `Est. landed ${formatInr(item.landed_cost_inr)} / unit` : undefined}>
                                                            {formatRmb(item.unit_price)}
                                                        </div>
                                                    ) : (
                                                        <div className="text-right text-amber-500 text-[10px] font-semibold" title="No RMB_Price in EE Product Master for this SKU">
                                                            No RMB price
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-white border-r border-slate-200 dark:border-r-slate-700/30 text-xs truncate">
                                                    {Number(item.unit_price) > 0 ? formatRmb(Number(item.qty) * Number(item.unit_price)) : '—'}
                                                </td>

                                                {(['logo', 'packaging', 'manual', 'wrap'] as const).map(field => {
                                                    const rawVal = (item as any)[field];
                                                    const val = getCustomVal(rawVal);
                                                    const isNA = val === 'NA';
                                                    const isDisabled = isNA || data.isSubmitted || isViewOnly || isSubmittedReadOnly;
                                                    return (
                                                        <td key={field} className="px-1 py-3 text-center border-r border-slate-200 dark:border-slate-700/30">
                                                            {isNA ? (
                                                                <span className="text-slate-400 dark:text-slate-500 text-sm font-medium">—</span>
                                                            ) : (
                                                                <button
                                                                    disabled={isDisabled}
                                                                    onClick={() => !isDisabled && setItems(prev => prev.map(i => i.id === item.id ? { ...i, [field]: i[field] === 'Yes' ? 'No' : 'Yes' } : i))}
                                                                    className={`text-[9px] px-1.5 py-0.5 rounded font-black transition-all ${val === 'Yes' ? 'bg-green-600/20 text-green-400' : 'bg-slate-200 dark:bg-slate-700 text-slate-500'} ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                                                                >
                                                                    {val}
                                                                </button>
                                                            )}
                                                        </td>
                                                    );
                                                })}

                                                <td className="px-1 py-3 text-center border-r border-slate-200 dark:border-slate-700/30">
                                                    {item.customization_files ? (
                                                        <a
                                                            href={item.customization_files}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex p-1 bg-blue-600/20 text-blue-400 rounded hover:bg-blue-600/40 transition-colors"
                                                            title="View Assets on Drive"
                                                        >
                                                            <FolderOpenIcon className="w-3.5 h-3.5" />
                                                        </a>
                                                    ) : (
                                                        <span className="text-[10px] text-slate-400 dark:text-slate-700">—</span>
                                                    )}
                                                </td>

                                                <td className="px-4 py-3 text-right">
                                                    <div className="flex justify-end gap-1.5">
                                                        {!isSubmittedReadOnly && (
                                                            <button onClick={() => setCustomizationItem(item)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-600 rounded text-slate-500 hover:text-blue-400 transition-all">
                                                                {isViewOnly ? <EyeIcon className="w-3.5 h-3.5" /> : <PencilIcon className="w-3.5 h-3.5" />}
                                                            </button>
                                                        )}
                                                        {!data.isSubmitted && !isViewOnly && !isSubmittedReadOnly && (
                                                            <button onClick={() => setItems(prev => prev.filter(i => i.id !== item.id))} className="p-1 hover:bg-red-500/20 rounded text-slate-500 hover:text-red-500 transition-all">
                                                                <TrashIcon className="w-3.5 h-3.5" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </Card>
                ))}
            </div>

            <div className="fixed bottom-0 right-0 left-0 sm:left-64 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-4 shadow-2xl z-40 transition-all duration-300">
                <div className="max-w-[1600px] mx-auto flex flex-wrap sm:flex-nowrap justify-between items-center gap-6">
                    <div className="flex gap-8">
                        <div>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Inventory</p>
                            <p className="text-lg font-bold text-slate-800 dark:text-white">{stats.totalItems} <span className="text-xs font-normal text-slate-500 dark:text-slate-400">Items ({items.length} SKUs)</span></p>
                        </div>
                        <div className="w-px h-10 bg-slate-200 dark:bg-slate-800"></div>
                        <div>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Vendors</p>
                            <p className="text-lg font-bold text-slate-800 dark:text-white">{stats.vendorsCount} <span className="text-xs font-normal text-slate-500 dark:text-slate-400">Distribution</span></p>
                        </div>
                    </div>
                    <div className="flex items-center gap-8">
                        <div className="text-right">
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Est. Landed (INR)</p>
                            <p className="text-lg font-bold text-slate-800 dark:text-white" title="Quantity × current landed cost (EE Product Master Cost). An estimate for budgeting, not what the vendor is paid.">{formatInr(stats.estLandedInr)}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Order Value (RMB)</p>
                            <p className="text-3xl font-bold text-green-600 dark:text-green-400">{formatRmb(stats.totalRmb)}</p>
                            {stats.missingRmb > 0 && (
                                <p className="text-[10px] font-semibold text-amber-500">{stats.missingRmb} line{stats.missingRmb === 1 ? '' : 's'} without an RMB price not included</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
