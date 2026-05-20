import React, { useState, useMemo, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import {
    PencilIcon, TrashIcon, MagnifyingGlassIcon, PlusIcon,
    EyeIcon, ChevronDownIcon, ChevronUpIcon, LockClosedIcon,
    ClipboardDocumentIcon, BoxIcon, ExclamationTriangleIcon, XMarkIcon,
    DocumentDuplicateIcon, ArrowLeftIcon, ArrowPathIcon, CheckBadgeIcon,
    AirplaneIcon, ShipIcon, ClipboardDocumentCheckIcon, ClockIcon, FolderOpenIcon
} from '../icons/Icons';
import { DraftOrder, Sku, PurchaseOrder, VendorMaster } from '../../types';
import { CustomizationModal } from './CustomizationModal';
import { SelectiveSubmitModal } from './SelectiveSubmitModal';
import { AddNewSKUModal } from './AddNewSKUModal';
import { APPS_SCRIPT_URL, API_ACTIONS } from '../../App';

interface LineItem {
    id: string;
    line_id?: string | number; // Match backend identifier
    sku: string;
    vendor: string; // Used for UI binding (mapped to vendor_code)
    vendor_code?: string; // Actual code for backend
    vendor_name?: string; // Display name for UI
    item_name: string; // Bind to backend item_name
    qty: number;
    unit_price: number;
    logo: 'Yes' | 'No';
    packaging: 'Yes' | 'No';
    manual: 'Yes' | 'No';
    wrap: 'Yes' | 'No';
    remarks: string;
    customization_files: string; // Drive link string
    source: 'FORECAST' | 'MANUAL'; // Source of the SKU
}

interface DraftOrderEditProps {
    draft: DraftOrder | null;
    initialMode?: 'SEA' | 'AIR';
    onBack: () => void;
    setDrafts: React.Dispatch<React.SetStateAction<DraftOrder[]>>;
    onSave: (updatedDraft: DraftOrder) => Promise<any>;
    onOrdersSubmitted?: (updatedDraft: DraftOrder | null, newPos: PurchaseOrder[], message: string) => void;
    onRefreshPOs?: () => void;
    existingPoCount?: number;
    skus: Sku[];
    addSkuToCatalog: (newSku: Omit<Sku, 'id'>) => Sku;
    vendorMasters: VendorMaster[];
}

const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);

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

export const DraftOrderEdit: React.FC<DraftOrderEditProps> = ({ draft, initialMode, onBack, setDrafts, onSave, onOrdersSubmitted, onRefreshPOs, existingPoCount = 0, skus, addSkuToCatalog, vendorMasters }) => {
    const isViewOnly = draft?.status === 'SUBMITTED' || draft?.status === 'CANCELLED';
    // ISSUE 3: Full read-only for submitted/order_placed drafts
    const isSubmittedReadOnly = draft?.status === 'SUBMITTED';
    const isCreateMode = !draft;

    // ISSUE 8: Auto-populate PO Date with today if empty
    const todayStr = new Date().toISOString().split('T')[0];
    const [poDate, setPoDate] = useState(draft?.draft_date || draft?.created_at || todayStr);
    // Removed: expectedDelivery state (ISSUE 8 — field removed)
    // ISSUE 8: shippingMode is now read-only, derived from draft.planned_mode or initialMode for create
    const shippingMode = (draft?.mode || draft?.planned_mode || initialMode || '') as 'SEA' | 'AIR' | '';
    const displayMode = String(draft?.planned_mode || draft?.mode || initialMode || shippingMode || '').toUpperCase() as 'SEA' | 'AIR' | '';

    const [items, setItems] = useState<LineItem[]>(() => {
        if (!draft?.items) return [];
        return draft.items.map((item: any) => ({
            ...item,
            item_name: item.item_name || item.sku_name || item.name || item.productName || '',
            vendor: item.vendor_code || item.vendor || '',
            vendor_code: item.vendor_code || item.vendor || '',
            vendor_name: item.vendor_name || item.vendor || '',
            id: item.line_id ? String(item.line_id) : (item.id || `ITEM-${Date.now()}-${Math.random()}`),
            source: item.source || 'FORECAST',
            customization_files: item.customization_files || '',
            remarks: item.remarks || item.custom_remarks || ''
        }));
    });

    const notes = draft?.notes || '';
    const [searchQuery, setSearchQuery] = useState('');
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);

    const [catalogResults, setCatalogResults] = useState<any[]>([]);
    const [isSearchingCatalog, setIsSearchingCatalog] = useState(false);

    const [errorToast, setErrorToast] = useState<string | null>(null);
    const [successToast, setSuccessToast] = useState<string | null>(null);

    const [customizationItem, setCustomizationItem] = useState<LineItem | null>(null);
    const [isSubmitModalOpen, setSubmitModalOpen] = useState(false);
    const [isAddNewSkuModalOpen, setIsAddNewSkuModalOpen] = useState(false);

    // Debug Panel State
    const [showDebug, setShowDebug] = useState(false);
    const [lastRequest, setLastRequest] = useState<any>(null);
    const [lastResponse, setLastResponse] = useState<any>(null);
    const [lastError, setLastError] = useState<string | null>(null);
    const [lastTimestamp, setLastTimestamp] = useState<string | null>(null);
    const [lastCustomizationData, setLastCustomizationData] = useState<any>(null);

    // Derived Stats for Debug
    const vendorCoverage = useMemo(() => {
        const withVendor = items.filter(i => i.vendor_code || i.vendor).length;
        return { count: withVendor, percent: items.length > 0 ? (withVendor / items.length * 100).toFixed(0) : '0' };
    }, [items]);

    const driveLinkStats = useMemo(() => {
        const withLink = items.filter(i => i.customization_files && i.customization_files.trim() !== '').length;
        return { count: withLink, percent: items.length > 0 ? (withLink / items.length * 100).toFixed(0) : '0' };
    }, [items]);

    useEffect(() => {
        if (searchQuery.length < 2) {
            setCatalogResults([]);
            return;
        }

        const timer = setTimeout(async () => {
            setIsSearchingCatalog(true);
            try {
                const response = await fetch(APPS_SCRIPT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({
                        action: API_ACTIONS.SEARCH_SKU_CATALOG,
                        query: searchQuery
                    })
                });
                const result = await response.json();

                const rawItems = result.items || result.skus || result.data || [];
                const normalized = rawItems.map((item: any) => ({
                    sku: item.sku || item.master_sku || item.masterSKU,
                    item_name: item.item_name || item.sku_name || item.name || item.productName,
                    vendor: item.vendor_code || item.vendor || item.supplier || '',
                    vendor_code: item.vendor_code || item.vendor || item.supplier || '',
                    vendor_name: item.vendor_name || item.vendor || item.supplier || '',
                    unit_price: Number(item.unit_price || item.cost || 0),
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
        const grandTotal = items.reduce((sum, item) => sum + (Number(item.qty) * Number(item.unit_price || 0)), 0);
        const vendors = Object.keys(vendorGroups);
        const submittedCount = vendors.filter(v => vendorGroups[v].isSubmitted).length;
        const pendingCount = vendors.length - submittedCount;
        return { totalItems, grandTotal, vendorsCount: vendors.length, submittedCount, pendingCount };
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
        // ISSUE 3: Block save for read-only submitted drafts
        if (isSubmittedReadOnly) return;

        // Validation
        if (!shippingMode && !displayMode) {
            alert('Please select shipping mode');
            return;
        }

        if (items.length === 0) {
            alert('Please add at least one item');
            return;
        }

        // Check all items have vendor
        const itemsWithoutVendor = items.filter(item => !item.vendor && !item.vendor_code);
        if (itemsWithoutVendor.length > 0) {
            alert('Please select vendor for all items');
            return;
        }

        // Check all items have qty > 0
        const itemsWithoutQty = items.filter(item => !item.qty || Number(item.qty) <= 0);
        if (itemsWithoutQty.length > 0) {
            alert('Please enter quantity for all items');
            return;
        }

        setIsSaving(true);
        setIsProcessing(true);
        setErrorToast(null);
        setSuccessToast(null);
        setLastError(null);

        try {
            // Transform items to match backend expected format
            const lines = items.map(item => ({
                line_id: (item.line_id && !item.line_id.startsWith('ITEM-')) ? item.line_id : null,  // null = new row (backend creates), real ID = update existing
                sku: item.sku,
                sku_name: item.item_name || (item as any).sku_name,
                qty: Number(item.qty),
                vendor_code: item.vendor || item.vendor_code,
                unit_price: Number(item.unit_price || 0),

                // Map UI customization fields to backend format
                custom_logo: item.logo === 'Yes' || (item as any).custom_logo === true,
                custom_packaging: item.packaging === 'Yes' || (item as any).custom_packaging === true,
                solving_manual: item.manual === 'Yes' || (item as any).solving_manual === true,
                opp_wrap: item.wrap === 'Yes' || (item as any).opp_wrap === true,

                custom_remarks: item.remarks || (item as any).custom_remarks || '',
                customization_files: item.customization_files || ''
            }));

            console.log('Lines payload:', lines);
            console.log('Lines with real line_id (UPDATE):', lines.filter(l => l.line_id !== null).length);
            console.log('Lines with null line_id (CREATE NEW):', lines.filter(l => l.line_id === null).length);

            const payload = {
                action: isCreateMode ? 'create_manual_draft' : API_ACTIONS.SAVE_DRAFT,
                mode: displayMode || shippingMode,
                draft_date: poDate,
                notes: notes,
                lines: lines,
                ...(draft?.id ? { draftId: draft.id } : {})
            };

            const timestamp = new Date().toISOString();
            setLastTimestamp(timestamp);
            setLastRequest(payload);

            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            setLastResponse(result);

            if (result.status === 'success' || result.draftId) {
                if (isCreateMode) {
                    alert(`Draft Order ${result.draftId} created successfully!`);
                    onBack(); // Navigate back to list
                } else {
                    setSuccessToast('Draft saved successfully');
                    setTimeout(() => setSuccessToast(null), 3000);
                }

                if (result.lines) {
                    const normalizedLinesFromBackend = result.lines.map((line: any) => ({
                        id: String(line.line_id),
                        line_id: String(line.line_id),
                        sku: line.sku,
                        item_name: line.sku_name || line.item_name || '',
                        vendor: line.vendor_code || line.vendor || '',
                        vendor_code: line.vendor_code || line.vendor || '',
                        vendor_name: line.vendor_name || line.vendor || '',
                        qty: line.qty,
                        unit_price: line.unit_price,
                        logo: line.custom_logo ? 'Yes' : 'No',
                        packaging: line.custom_packaging ? 'Yes' : 'No',
                        manual: line.solving_manual ? 'Yes' : 'No',
                        wrap: line.opp_wrap ? 'Yes' : 'No',
                        remarks: line.custom_remarks || '',
                        customization_files: line.customization_files || '',
                        source: line.source || 'FORECAST'
                    }));
                    setItems(normalizedLinesFromBackend);
                }
            } else {
                throw new Error(result.message || 'Failed to save draft');
            }
            return result;
        } catch (err: any) {
            const msg = err.message || 'Failed to save draft';
            setErrorToast(msg);
            setLastError(msg);
            setLastResponse({ error: msg });
            throw err;
        } finally {
            setIsSaving(false);
            setIsProcessing(false);
        }
    };

    const handleSubmitClick = async () => {
        setIsSaving(true);
        try {
            await handleSaveDraft();
            setSubmitModalOpen(true);
        } catch (err) {
            setErrorToast("Please save changes before submitting");
        } finally {
            setIsSaving(false);
        }
    };

    const handleSubmitDraft = async (selectedVendors: string[]) => {
        if (!draft) return;

        const payload = {
            action: API_ACTIONS.SUBMIT_DRAFT,
            draftId: draft.id,
            vendors: selectedVendors
        };

        setIsSubmitting(true);
        setErrorToast(null);
        setSuccessToast(null);
        setLastError(null);
        setLastTimestamp(new Date().toISOString());
        setLastRequest(payload);

        try {
            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            setLastResponse(result);

            if (!result || result.success !== true) {
                throw new Error(result?.message || result?.error || "Submit failed");
            }

            // On success
            const poCount = result.newPOs?.length || 0;
            const successMsg = `${poCount} Purchase Order(s) created successfully`;
            setSuccessToast(successMsg);

            // Close modal
            setSubmitModalOpen(false);

            if (onOrdersSubmitted) {
                onOrdersSubmitted(result.updatedDraft, result.newPOs, successMsg);
            }

            // Trigger PO refresh via custom event
            const createdPOs = result.newPOs || [];
            if (createdPOs.length > 0) {
                window.dispatchEvent(new CustomEvent("po:refresh", {
                    detail: { po_id: createdPOs[0] }
                }));
            } else {
                window.dispatchEvent(new CustomEvent("po:refresh"));
            }

            // Trigger PO list refresh via legacy callback
            onRefreshPOs?.();
        } catch (err: any) {
            const msg = err.message || 'Submission failed';
            setErrorToast(msg);
            setLastError(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSaveCustomization = async (data: any) => {
        if (!customizationItem) return;

        // Update local state immediately for responsiveness
        setItems(prev => prev.map(i => i.id === customizationItem.id ? { ...i, ...data } : i));
        setLastCustomizationData({
            sku: customizationItem.sku,
            ...data,
            timestamp: new Date().toLocaleTimeString()
        });

        // Sync to backend catalog
        try {
            const payload = {
                action: API_ACTIONS.SAVE_CUSTOMIZATION,
                payload: {
                    sku: customizationItem.sku,
                    ...data
                }
            };

            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            if (!result || result.success !== true) {
                throw new Error(result?.message || result?.error || "Sync failed");
            }

            setSuccessToast(`Master data for ${customizationItem.sku} updated!`);
        } catch (err: any) {
            console.error('Customization sync error:', err);
            setErrorToast(`Sync Failed: ${err.message}. Changes kept for this draft.`);
        }
    };

    const inputClasses = `bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none w-full transition-all ${(isViewOnly || isSubmittedReadOnly) ? 'cursor-not-allowed opacity-80' : ''}`;
    const displayOnlyClasses = `bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700/50 rounded-lg px-3 py-2 text-sm text-gray-500 dark:text-slate-400 w-full cursor-default`;

    // ISSUE 6: Helper — determine NA vs Yes/No for customization badges
    const getCustomVal = (val: 'Yes' | 'No' | null | undefined | string): 'Yes' | 'No' | 'NA' => {
        if (val === null || val === undefined || val === 'NA' || val === '') return 'NA';
        return val as 'Yes' | 'No';
    };

    const Tooltip: React.FC<{ label: string; text: string }> = ({ label, text }) => (
        <th className="group relative px-1 py-3 font-bold text-center w-[5%] cursor-help border-r border-slate-700 max-w-[50px]">
            {label}
            <span className="invisible group-hover:visible absolute -top-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[11px] px-2 py-1.5 rounded whitespace-nowrap z-50 shadow-xl border border-slate-700 pointer-events-none font-medium">
                {text}
                <span className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-900" />
            </span>
        </th>
    );

    return (
        <div className="flex flex-col min-h-screen space-y-4 text-gray-900 dark:text-white pb-32 relative bg-gray-50 dark:bg-[#0f172a] p-6">

            {/* ISSUE 3: Read-only banner for SUBMITTED/ORDER_PLACED */}
            {isSubmittedReadOnly && (
                <div className="flex items-center gap-3 bg-amber-900/30 border border-amber-700 rounded-xl px-4 py-3 text-amber-300 text-sm font-medium mb-2 animate-in fade-in duration-300">
                    <LockClosedIcon className="w-4 h-4 flex-shrink-0" />
                    <span>This draft has been submitted and cannot be edited.</span>
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
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${draft?.status === 'SUBMITTED' ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' :
                            draft?.status === 'CANCELLED' ? 'bg-red-600/20 text-red-400 border border-red-500/30' :
                            draft?.status === 'PARTIALLY_SUBMITTED' ? 'bg-amber-600/20 text-amber-400 border border-amber-500/30' :
                                'bg-slate-600/20 text-slate-400 border border-slate-500/30'
                            }`}>
                            {draft?.status || 'DRAFT'}
                        </span>
                        <h2 className="text-2xl font-black tracking-tight text-white">
                            {isCreateMode ? 'Drafting New Order' : `Order Draft: ${draft?.id}`}
                        </h2>
                    </div>
                    <p className="text-xs text-slate-500 font-medium ml-0.5">
                        {isCreateMode ? 'Build a new multi-vendor purchase order draft' : `Created on ${new Date(draft?.created_at || '').toLocaleDateString()} • Modified ${new Date().toLocaleDateString()}`}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="secondary" onClick={onBack} className="h-10 px-4 border-slate-700 bg-slate-800/50 hover:bg-slate-800" icon={<ArrowLeftIcon className="w-4 h-4" />}>Back</Button>
                    {/* ISSUE 3: Hide Save/Submit for submitted-read-only drafts */}
                    {!isViewOnly && !isSubmittedReadOnly && (
                        <>
                            <Button
                                onClick={handleSaveDraft}
                                disabled={isSaving || (!displayMode && !shippingMode) || items.length === 0}
                                className="h-10 px-6 bg-blue-600 hover:bg-blue-700 font-bold shadow-lg shadow-blue-900/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                            >
                                {isSaving ? 'Saving...' : 'Save Draft'}
                            </Button>
                            {!isCreateMode && (
                                <Button
                                    onClick={handleSubmitClick}
                                    disabled={isSaving || isSubmitting}
                                    className="h-10 px-6 bg-indigo-600 hover:bg-indigo-700 font-bold shadow-lg shadow-indigo-900/40 transition-all active:scale-95"
                                >
                                    {isSaving ? 'Saving...' : 'Submit to Vendor'}
                                </Button>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* ISSUE 8: Compact Header Block — max-w-[280px], left-aligned, no Expected Delivery, no Internal Notes, Shipping Mode as read-only badge */}
            <div className={`bg-white dark:bg-slate-800/40 rounded-xl p-4 mb-2 shadow-xl border border-gray-200 dark:border-slate-700/50 backdrop-blur-md w-full max-w-[320px] ${(isViewOnly || isSubmittedReadOnly) ? 'opacity-80' : ''}`}>
                <div className="flex flex-col gap-4">
                    <div className="space-y-1.5">
                        <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-0.5">
                            <ClockIcon className="w-3 h-3" /> PO Date
                        </label>
                        <input
                            type="date"
                            value={poDate}
                            onChange={(e) => !isSubmittedReadOnly && setPoDate(e.target.value)}
                            disabled={isViewOnly || isSubmittedReadOnly}
                            className="bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none w-full transition-all outline-none"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-0.5">
                            <ShipIcon className="w-3 h-3" /> Shipping Mode
                        </label>
                        {/* ISSUE 8: Read-only badge instead of dropdown */}
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

            {/* ISSUE 3: Hide search bar for submitted-read-only drafts */}
            {!isViewOnly && !isSubmittedReadOnly && (
                <div className="flex flex-col space-y-3 mt-2">
                    <div className="relative group">
                        <MagnifyingGlassIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <input
                            type="text"
                            placeholder="Search SKU or Item Name in Catalog..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-11 pr-4 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-slate-600 text-sm shadow-inner text-gray-900 dark:text-white"
                        />
                        {searchQuery.length >= 2 && (
                            <div className="absolute top-full left-0 right-0 z-[60] bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-b-lg shadow-2xl mt-1 overflow-hidden animate-in slide-in-from-top-1 duration-150">
                                {catalogResults.length > 0 ? catalogResults.map(res => {
                                    const poId = res.vendor_code ? draft?.submittedVendors?.[res.vendor_code] : null;
                                    return (
                                        <div key={res.sku} onClick={() => !poId && handleSelectCatalogItem(res)} className={`p-4 border-b border-slate-700/50 last:border-0 transition-colors ${poId ? 'opacity-50 cursor-not-allowed bg-slate-900/30' : 'hover:bg-slate-700 cursor-pointer'}`}>
                                            <div className="flex justify-between items-center">
                                                <span className="text-sm font-bold text-white">{res.sku} | {res.item_name}</span>
                                                {!poId && <span className="text-xs text-blue-500 font-bold">Add to Draft</span>}
                                            </div>
                                            <div className="flex justify-between text-xs text-slate-500 mt-1.5">
                                                <span>Price: ₹{Number(res.unit_price).toFixed(2)} • Vendor: {res.vendor_name || res.vendor_code}</span>
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
                    <div className="border-2 border-dashed border-slate-800 rounded-xl py-24 flex flex-col items-center justify-center bg-slate-800/10">
                        <BoxIcon className="w-12 h-12 text-slate-700 mb-4" />
                        <h3 className="text-lg font-medium text-slate-500">No items in this draft yet</h3>
                    </div>
                ) : (Object.entries(vendorGroups) as any[]).map(([v, data]) => (
                    <Card key={v} className={`bg-white dark:bg-slate-800/20 border-gray-200 dark:border-slate-700 p-0 overflow-hidden shadow-lg transition-all ${data.isSubmitted ? 'opacity-90 ring-1 ring-blue-500/20' : ''}`}>
                        <div onClick={() => setCollapsedGroups(prev => ({ ...prev, [v]: !prev[v] }))} className={`px-4 py-3 flex justify-between items-center border-b border-gray-100 dark:border-slate-700/50 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/20 transition-colors ${data.isSubmitted ? 'bg-gray-50 dark:bg-slate-900/40' : 'bg-gray-100/50 dark:bg-slate-900/60'}`}>
                            <div className="flex items-center gap-3">
                                {collapsedGroups[v] ? <ChevronDownIcon className="w-4 h-4 text-slate-500" /> : <ChevronUpIcon className="w-4 h-4 text-slate-500" />}
                                <div className="flex items-center gap-2">
                                    <span className="font-bold text-sm tracking-wide text-white">
                                        {vendorMasters.find(vm => vm.vendor_code === v)?.vendor_name || v}
                                    </span>
                                    {data.isSubmitted && <span className="bg-blue-600/20 text-blue-400 text-[10px] px-2 py-0.5 rounded font-mono border border-blue-500/30">Submitted to {data.poId}</span>}
                                </div>
                            </div>
                            <div className="text-xs font-semibold text-slate-400 flex items-center gap-6">
                                <span className="bg-slate-800/80 px-2 py-0.5 rounded text-[10px] text-slate-500 uppercase tracking-tighter">{data.items.length} SKUs</span>
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-500">Subtotal:</span>
                                    <span className="text-base font-bold text-white">₹{data.total.toLocaleString()}</span>
                                </div>
                            </div>
                        </div>

                        {!collapsedGroups[v] && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm border-collapse table-fixed">
                                    <thead>
                                        <tr className="bg-gray-50 dark:bg-slate-900 text-gray-600 dark:text-slate-100 text-[11px] font-bold uppercase tracking-wider border-b-2 border-gray-200 dark:border-slate-700">
                                            <th className="px-4 py-3 w-[10%]">SKU</th>
                                            <th className="px-4 py-3 w-[15%]">Vendor</th>
                                            <th className="px-4 py-3 w-[18%]">Item Name</th>
                                            <th className="px-4 py-3 text-center w-[8%] border-x border-slate-700">Qty</th>
                                            <th className="px-4 py-3 text-right w-[8%]">Price</th>
                                            <th className="px-4 py-3 text-right w-[10%] border-r border-slate-700">Total</th>
                                            <Tooltip label="LOGO" text="Custom Logo (Click to Toggle)" />
                                            <Tooltip label="PKG" text="Custom Packaging (Click to Toggle)" />
                                            <Tooltip label="MAN" text="Solving Manual (Click to Toggle)" />
                                            <Tooltip label="WRAP" text="OPP Wrap (Click to Toggle)" />
                                            <th className="px-1 py-3 text-center w-[4%] border-r border-slate-700">Files</th>
                                            <th className="px-4 py-3 text-right w-[10%]">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700/40">
                                        {data.items.map((item: any) => (
                                            <tr key={item.id} className={`transition-colors duration-150 ${data.isSubmitted ? 'opacity-60 bg-gray-50 dark:bg-slate-800/30' : 'hover:bg-gray-50 dark:hover:bg-slate-700/20'}`}>
                                                <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-slate-400 font-bold truncate">{item.sku}</td>
                                                <td className="px-4 py-3">
                                                    {/* ISSUE 3: Show plain text vendor for submitted-read-only; ISSUE 6: vendor as text when submitted */}
                                                    {(data.isSubmitted || isSubmittedReadOnly) ? (
                                                        <span className="text-xs text-white font-medium">
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
                                                            className="w-full bg-gray-100 dark:bg-slate-700/50 border border-gray-200 dark:border-slate-600 rounded px-2 py-1 text-[11px] text-gray-900 dark:text-white focus:ring-1 focus:ring-blue-500 focus:outline-none font-medium truncate"
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
                                                <td className="px-4 py-3 font-bold text-white truncate text-xs" title={item.item_name}>
                                                    {item.item_name}
                                                </td>
                                                <td className="px-4 py-3 text-center border-x border-slate-700 bg-slate-900/40">
                                                    {/* ISSUE 3: Show plain text for submitted-read-only drafts */}
                                                    {isSubmittedReadOnly ? (
                                                        <span className="font-black text-blue-400 text-sm">{item.qty}</span>
                                                    ) : (
                                                        <input
                                                            type="number"
                                                            disabled={data.isSubmitted}
                                                            value={item.qty}
                                                            onChange={(e) => setItems(prev => prev.map(i => i.id === item.id ? { ...i, qty: Number(e.target.value) } : i))}
                                                            className="w-full bg-transparent border-0 p-1 text-center font-black text-blue-400 text-sm focus:ring-0 focus:outline-none"
                                                        />
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <div className="text-right text-slate-400 text-xs font-mono font-medium">
                                                        ₹{Number(item.unit_price || 0).toLocaleString()}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-right font-black text-white border-r border-slate-700 text-xs truncate">₹{(Number(item.qty) * Number(item.unit_price || 0)).toLocaleString()}</td>

                                                {/* ISSUE 6: Inline Customization Toggles — NA state shows dash, not clickable */}
                                                {(['logo', 'packaging', 'manual', 'wrap'] as const).map(field => {
                                                    const rawVal = (item as any)[field];
                                                    const val = getCustomVal(rawVal);
                                                    const isNA = val === 'NA';
                                                    const isDisabled = isNA || data.isSubmitted || isViewOnly || isSubmittedReadOnly;
                                                    return (
                                                        <td key={field} className="px-1 py-3 text-center border-r border-slate-700/50">
                                                            {isNA ? (
                                                                <span className="text-slate-500 text-sm font-medium">—</span>
                                                            ) : (
                                                                <button
                                                                    disabled={isDisabled}
                                                                    onClick={() => !isDisabled && setItems(prev => prev.map(i => i.id === item.id ? { ...i, [field]: i[field] === 'Yes' ? 'No' : 'Yes' } : i))}
                                                                    className={`text-[9px] px-1.5 py-0.5 rounded font-black transition-all ${val === 'Yes' ? 'bg-green-600 text-white shadow-sm shadow-green-900/20' : 'bg-slate-700/50 text-slate-500 hover:bg-slate-700'} ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                                                                >
                                                                    {val}
                                                                </button>
                                                            )}
                                                        </td>
                                                    );
                                                })}

                                                {/* Files Column */}
                                                <td className="px-1 py-3 text-center border-r border-slate-700/50">
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
                                                        <span className="text-[10px] text-slate-700">—</span>
                                                    )}
                                                </td>

                                                <td className="px-4 py-3 text-right">
                                                    <div className="flex justify-end gap-1.5">
                                                        {/* ISSUE 3: Hide pencil edit in submitted-read-only; show eye only */}
                                                        {!isSubmittedReadOnly && (
                                                            <button onClick={() => setCustomizationItem(item)} className="p-1 hover:bg-slate-600 rounded text-slate-500 hover:text-blue-400 transition-all">
                                                                {isViewOnly ? <EyeIcon className="w-3.5 h-3.5" /> : <PencilIcon className="w-3.5 h-3.5" />}
                                                            </button>
                                                        )}
                                                        {/* ISSUE 3: Hide delete button for submitted-read-only */}
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
                ))
                }
            </div >

            <div className="fixed bottom-0 right-0 left-0 sm:left-64 bg-slate-900 border-t border-slate-800 p-4 shadow-2xl z-40 transition-all duration-300">
                <div className="max-w-[1600px] mx-auto flex flex-wrap sm:flex-nowrap justify-between items-center gap-6">
                    <div className="flex gap-8">
                        <div>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Inventory</p>
                            <p className="text-lg font-bold text-white">{stats.totalItems} <span className="text-xs font-normal text-slate-400">Items ({items.length} SKUs)</span></p>
                        </div>
                        <div className="w-px h-10 bg-slate-800"></div>
                        <div>
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Vendors</p>
                            <p className="text-lg font-bold text-white">{stats.vendorsCount} <span className="text-xs font-normal text-slate-400">Distribution</span></p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setShowDebug(!showDebug)}
                            className="text-[10px] uppercase tracking-widest font-bold text-slate-500 hover:text-blue-400 transition-colors"
                        >
                            {showDebug ? 'Hide Debug Info' : '🐛 Show Debug Info'}
                        </button>
                        <div className="text-right">
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Session Value</p>
                            <p className="text-3xl font-bold text-green-400">{formatCurrency(stats.grandTotal)}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Debug JSON Panel */}
            {
                showDebug && (
                    <div className="mt-8 mb-24 space-y-6 border-t border-slate-800 pt-8 animate-in slide-in-from-bottom-4 duration-300">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                            <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Current Mode</p>
                                <p className="text-sm font-mono text-white flex items-center gap-2">
                                    {(displayMode || shippingMode) === 'AIR' ? <AirplaneIcon className="w-4 h-4 text-sky-400" /> : <ShipIcon className="w-4 h-4 text-blue-400" />}
                                    {displayMode || shippingMode || 'NOT SELECTED'}
                                </p>
                            </div>
                            {/* DEBUG: Draft status (ISSUE debug additions) */}
                            <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Draft Status</p>
                                <p className="text-sm font-mono text-amber-400">
                                    {draft?.status || 'DRAFT'}
                                </p>
                            </div>
                            <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Read-Only Mode</p>
                                <p className="text-sm font-mono text-orange-400">
                                    {isSubmittedReadOnly ? '🔒 SUBMITTED LOCK' : isViewOnly ? 'VIEW ONLY' : '✏️ EDITABLE'}
                                </p>
                            </div>
                            <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Vendor Resolution</p>
                                <p className="text-sm font-mono text-emerald-400">
                                    {vendorCoverage.count} / {items.length} ({vendorCoverage.percent}%)
                                </p>
                            </div>
                            <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Drive Files Present</p>
                                <p className="text-sm font-mono text-blue-400">
                                    {driveLinkStats.count} / {items.length} ({driveLinkStats.percent}%)
                                </p>
                            </div>
                            <div className="bg-slate-900 border border-slate-800 p-3 rounded-lg">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Last Customization Save</p>
                                <p className="text-[11px] font-mono text-purple-400 truncate">
                                    {lastCustomizationData ? `${lastCustomizationData.sku} @ ${lastCustomizationData.timestamp}` : 'NO SAVES'}
                                </p>
                            </div>
                        </div>

                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mt-4">
                            <ArrowPathIcon className="w-4 h-4" /> Transaction Trace {lastTimestamp && `(${lastTimestamp})`}
                        </h3>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <Card className="bg-slate-900 border-slate-800 p-0 flex flex-col h-[400px]">
                                <div className="px-4 py-2 border-b border-slate-800 flex justify-between items-center bg-slate-900/50 sticky top-0">
                                    <span className="text-[10px] font-bold text-blue-400 uppercase">Last Request Payload</span>
                                    <button onClick={() => lastRequest && navigator.clipboard.writeText(JSON.stringify(lastRequest, null, 2))} className="p-1 hover:bg-slate-800 rounded transition-colors text-slate-500 hover:text-white">
                                        <ClipboardDocumentCheckIcon className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="p-4 overflow-auto font-mono text-[11px] text-slate-300">
                                    {lastRequest ? (
                                        <pre>{JSON.stringify(lastRequest, null, 2)}</pre>
                                    ) : (
                                        <div className="h-full flex items-center justify-center italic text-slate-600">No operations performed yet.</div>
                                    )}
                                </div>
                            </Card>
                            <Card className="bg-slate-900 border-slate-800 p-0 flex flex-col h-[400px]">
                                <div className="px-4 py-2 border-b border-slate-800 flex justify-between items-center bg-slate-900/50 sticky top-0">
                                    <span className="text-[10px] font-bold text-emerald-400 uppercase">Server Response / Error</span>
                                    <button onClick={() => lastResponse && navigator.clipboard.writeText(JSON.stringify(lastResponse, null, 2))} className="p-1 hover:bg-slate-800 rounded transition-colors text-slate-500 hover:text-white">
                                        <ClipboardDocumentCheckIcon className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="p-4 overflow-auto font-mono text-[11px] text-slate-300">
                                    {lastError ? (
                                        <div className="text-red-400 bg-red-900/20 p-3 rounded border border-red-500/30">
                                            <p className="font-bold mb-1">ERROR:</p>
                                            {lastError}
                                        </div>
                                    ) : lastResponse ? (
                                        <pre>{JSON.stringify(lastResponse, null, 2)}</pre>
                                    ) : (
                                        <div className="h-full flex items-center justify-center italic text-slate-600">Waiting for backend interaction...</div>
                                    )}
                                </div>
                            </Card>
                        </div>
                    </div>
                )
            }

            {
                isAddNewSkuModalOpen && (
                    <AddNewSKUModal
                        isOpen={true}
                        onClose={() => setIsAddNewSkuModalOpen(false)}
                        vendors={vendorMasters.map(vm => vm.vendor_name)}
                        onSave={(data) => {
                            const newSku = addSkuToCatalog({
                                name: data.itemName,
                                finalItemName: data.itemName,
                                category: data.category,
                                supplier: data.vendor,
                                cost: Number(data.unitPrice || 0),
                                mrp: Number(data.unitPrice || 0) * 2,
                                shopifyPrice: Number(data.unitPrice || 0) * 1.8,
                                stockOnHand: 0,
                                stockInTransit: 0,
                                stockOnOrder: 0,
                                salesVelocity: 0
                            });
                            setItems(prev => [...prev, {
                                id: `ITEM-${Date.now()}-${Math.random()}`,
                                sku: newSku.id,
                                item_name: data.itemName,
                                vendor: vendorMasters.find(vm => vm.vendor_code === data.vendor)?.vendor_code || data.vendor,
                                vendor_code: vendorMasters.find(vm => vm.vendor_code === data.vendor)?.vendor_code || data.vendor,
                                vendor_name: data.vendor,
                                qty: Number(data.quantity),
                                unit_price: Number(data.unitPrice || 0),
                                logo: data.logo,
                                packaging: data.packaging,
                                manual: data.manual,
                                wrap: data.wrap,
                                remarks: data.remarks,
                                customization_files: '',
                                source: 'MANUAL'
                            }]);
                            setIsAddNewSkuModalOpen(false);
                        }}
                    />
                )
            }
        </div >
    );
};