
import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { 
    CloudArrowUpIcon, 
    DocumentTextIcon, 
    InformationCircleIcon,
    ArrowPathIcon,
    CheckBadgeIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    FunnelIcon,
    ArrowsUpDownIcon,
    PencilSquareIcon,
    ListBulletIcon,
    ArrowLeftIcon,
    ClipboardDocumentIcon,
    BoxIcon,
    TruckIcon,
    ClipboardDocumentCheckIcon,
    ExclamationTriangleIcon,
    ArchiveBoxIcon,
    PlusIcon,
    CalendarDaysIcon,
    XMarkIcon,
    TrashIcon,
    CheckIcon,
    MagnifyingGlassIcon,
    LockClosedIcon,
    EyeIcon
} from '../icons/Icons';
import { APPS_SCRIPT_URL, API_ACTIONS, DEV_MODE_SKIP_SHIPMENT_WRITE } from '../../constants';
import { ViewType } from '../../types';
import { VendorMaster, Sku } from '../../types';

// Declare XLSX from global window (loaded via CDN)
declare const XLSX: any;

/**
 * Robust Formatting Helper
 */
const fmtNumber = (v: any, decimals = 2) => {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return decimals === 0 ? "0" : "0.00";
  }
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

/**
 * Numeric Conversion Helper
 */
const toNum = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Direct RMB-to-RMB comparison: invoice ¥ vs EE Product Master column AA (RMB_PRICE)
const calculatePriceDiff = (invoicePrice: number, masterCost: number): { diff: number; percentage: number } => {
  const diff = invoicePrice - masterCost;
  const percentage = masterCost !== 0 ? (diff / masterCost) * 100 : 0;
  return { diff, percentage };
};

// --- Helper Functions ---

const formatDate = (dateStr: any) => {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
};

const getAgeColor = (days: number) => {
  if (days > 90) return 'text-red-600 dark:text-red-400';
  if (days > 30) return 'text-amber-600 dark:text-yellow-400';
  return 'text-emerald-600 dark:text-green-400';
};

// --- Local UI Helper Components ---

const Badge: React.FC<{ 
    children: React.ReactNode; 
    variant?: 'default' | 'outline' | 'success' | 'destructive' | 'warning' | 'info'; 
    className?: string;
    title?: string;
}> = ({ children, variant = 'default', className = '', title }) => {
    const variants = {
        default:     'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-100 border-transparent',
        outline:     'bg-transparent text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700',
        success:     'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/20',
        destructive: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-300 dark:border-red-500/20',
        warning:     'bg-amber-50 dark:bg-yellow-500/10 text-amber-700 dark:text-yellow-400 border-amber-300 dark:border-yellow-500/20',
        info:        'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-500/20',
    };
    return (
        <span 
            title={title}
            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider transition-colors duration-200 ${variants[variant]} ${className}`}
        >
            {children}
        </span>
    );
};

const SearchableSelect: React.FC<{
    value: string;
    onChange: (value: string) => void;
    options: Array<{ id: string; name: string }>;
    placeholder?: string;
}> = ({ value, onChange, options, placeholder = 'Search...' }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const dropdownRef = useRef<HTMLDivElement>(null);
    
    const filteredOptions = useMemo(() => {
        if (!searchQuery) return options.slice(0, 50);
        const query = searchQuery.toLowerCase();
        return options.filter(opt => 
            opt.name.toLowerCase().includes(query) || 
            opt.id.toLowerCase().includes(query)
        ).slice(0, 50);
    }, [searchQuery, options]);
    
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);
    
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isOpen) {
            if (e.key === 'Enter' || e.key === 'ArrowDown') {
                setIsOpen(true);
                e.preventDefault();
            }
            return;
        }
        
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setHighlightedIndex(prev => prev < filteredOptions.length - 1 ? prev + 1 : prev);
                break;
            case 'ArrowUp':
                e.preventDefault();
                setHighlightedIndex(prev => prev > 0 ? prev - 1 : 0);
                break;
            case 'Enter':
                e.preventDefault();
                if (filteredOptions[highlightedIndex]) {
                    onChange(filteredOptions[highlightedIndex].id);
                    setIsOpen(false);
                    setSearchQuery('');
                }
                break;
            case 'Escape':
                setIsOpen(false);
                break;
        }
    };
    
    return (
        <div ref={dropdownRef} className="relative">
            <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setIsOpen(true);
                    setHighlightedIndex(0);
                }}
                onFocus={() => setIsOpen(true)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5 text-[10px] text-slate-800 dark:text-slate-300 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />

            {isOpen && filteredOptions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-2xl max-h-60 overflow-auto">
                    {filteredOptions.map((option, idx) => (
                        <div
                            key={option.id}
                            onClick={() => {
                                onChange(option.id);
                                setIsOpen(false);
                                setSearchQuery('');
                            }}
                            onMouseEnter={() => setHighlightedIndex(idx)}
                            className={`px-3 py-2 cursor-pointer text-[10px] ${
                                idx === highlightedIndex
                                    ? 'bg-blue-600 text-white'
                                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                        >
                            <div className="font-medium truncate">{option.name}</div>
                            <div className={`text-[9px] font-mono ${idx === highlightedIndex ? 'text-blue-200' : 'text-slate-400 dark:text-slate-500'}`}>{option.id}</div>
                        </div>
                    ))}
                </div>
            )}

            {isOpen && filteredOptions.length === 0 && searchQuery && (
                <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded p-3 text-center text-[10px] text-slate-500 dark:text-slate-400">
                    No matches found
                </div>
            )}
        </div>
    );
};

const VendorSearchSelect: React.FC<{
    value: string;
    onChange: (value: string) => void;
    vendors: VendorMaster[];
    placeholder?: string;
}> = ({ value, onChange, vendors, placeholder = 'Choose Vendor' }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    const selectedVendor = vendors.find(v => v.vendor_code === value);

    const filtered = useMemo(() => {
        if (!query.trim()) return vendors;
        const q = query.toLowerCase();
        return vendors.filter(v =>
            v.vendor_name.toLowerCase().includes(q) ||
            (v.vendor_code ?? '').toLowerCase().includes(q)
        );
    }, [vendors, query]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
                setQuery('');
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (isOpen) {
            const t = setTimeout(() => searchRef.current?.focus(), 40);
            return () => clearTimeout(t);
        }
    }, [isOpen]);

    const handleSelect = (code: string) => {
        onChange(code);
        setIsOpen(false);
        setQuery('');
    };

    return (
        <div ref={containerRef} className="relative">
            {/* Trigger */}
            <button
                type="button"
                onClick={() => setIsOpen(prev => !prev)}
                className={`w-full flex items-center justify-between bg-slate-100 dark:bg-slate-900 rounded-lg px-4 py-3 text-left transition-all outline-none border
                    ${isOpen
                        ? 'border-blue-500 ring-2 ring-blue-500/20'
                        : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                    }`}
            >
                <span className={`text-sm truncate ${selectedVendor ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'}`}>
                    {selectedVendor ? selectedVendor.vendor_name : placeholder}
                </span>
                <ChevronDownIcon className={`w-4 h-4 ml-2 shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown panel */}
            {isOpen && (
                <div className="absolute z-50 w-full mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden">
                    {/* Search bar */}
                    <div className="p-2 border-b border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2">
                            <MagnifyingGlassIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <input
                                ref={searchRef}
                                type="text"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Escape') { setIsOpen(false); setQuery(''); } }}
                                placeholder="Search by name or code…"
                                className="w-full bg-transparent text-sm text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none"
                            />
                            {query && (
                                <button onClick={() => setQuery('')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                                    <XMarkIcon className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Options */}
                    <div className="max-h-60 overflow-y-auto py-1">
                        {filtered.length > 0 ? filtered.map(v => (
                            <button
                                key={v.vendor_code}
                                type="button"
                                onClick={() => v.vendor_code && handleSelect(v.vendor_code)}
                                className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors
                                    ${v.vendor_code === value
                                        ? 'bg-blue-50 dark:bg-blue-600/15 text-blue-700 dark:text-blue-300'
                                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                                    }`}
                            >
                                <span className="text-sm font-medium">{v.vendor_name}</span>
                                <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 ml-3 shrink-0">{v.vendor_code}</span>
                            </button>
                        )) : (
                            <p className="px-4 py-6 text-center text-sm text-slate-400 dark:text-slate-500">
                                No vendors match <span className="font-semibold">"{query}"</span>
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// --- Enriched Data Types ---

type DocumentType = 'INVOICE' | 'PACKING_LIST';
type MatchStatus = 'MATCH' | 'UNMATCHED' | 'SKU_MISMATCH' | 'MULTIPLE_MATCH' | 'PARTIAL_MATCH' | 'MULTIPLE_VARIANT' | 'MANUAL_ENTRY';
type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | '';

interface EnrichedRow {
    line_id: string;
    source_file_name: string;
    document_type: string;
    
    // Original fields
    factory_code: string; 
    ean: string;
    unit_price: number;
    invoice_qty: number;
    total_price: number;
    item_name: string;
    sku: string;
    color?: string;
    my_id?: string;
    my_id_check?: boolean | null;
    my_id_mismatch_value?: string | null;

    // Canonical fields from auto-detect
    unit_price_base?: number;
    unit_price_box?: number;
    unit_price_blister?: number;
    unit_price_manual?: number;
    unit_price_total?: number;
    carton_count?: number;
    total_amount?: number;
    
    // Matching results
    match_status: MatchStatus;
    matched_sku: string;
    matched_name: string;
    matched_by: 'EAN' | 'ARTICLE_NUMBER' | 'OTHER_FACTORY_CODE' | '';
    matched_code: string;
    match_confidence: MatchConfidence;
    vendor_provided_sku: string;
    sku_mismatch_flag: boolean;
    multiple_matches?: Array<{
        sku: string;
        name: string;
        matchedBy: string;
        matchedCode: string;
        cost: number;
    }>;
    master_cost?: number;
    match_type?: string;
    resolution_action?: string;
    resolution_update_id?: boolean;
    resolution_update_price?: boolean;
    resolution_update_ean?: boolean;
    resolution_notes?: string;
    partial_match_reason?: string;
    name_similarity?: number;
    price_diff_percentage?: number;
    show_override?: boolean; // For "Change SKU" UI state
    phase1_status?: string;  // SKU identification result
    phase2_status?: string | null; // Product verification result (null when skipped)
}

interface SkuAllocation {
    sku: string;
    item_name: string;
    total_invoice_qty: number;
    allocated_to: Array<{ po_id: string; qty: number }>;
    unallocated_qty: number;
    vendor_price?: number;
}

interface AllocationItem {
  sku: string;
  sku_name: string;
  invoice_qty: number;
  unit_price: number;
  po_allocations: POAllocation[];
  total_allocated: number;
  unallocated_qty: number;
}

interface POAllocation {
  po_id: string;
  po_date: string;
  age_days: number;
  ordered_qty: number;
  fulfilled_qty: number;
  pending_qty: number;
  allocated_qty: number;
  will_be_fulfilled: boolean;
}

interface VendorShipmentsProps {
    onNavigate?: (view: ViewType | string) => void;
    vendorMasters: VendorMaster[];
    productMasterList: Sku[];
}

type ShipmentTab = 'Setup' | 'Validate Items' | 'ID / Price / EAN Review' | 'Allocation' | 'Review' | 'Creation';

const SHIPMENT_STEP_FLOW: ShipmentTab[] = ['Setup', 'Validate Items', 'ID / Price / EAN Review', 'Allocation', 'Review'];

const VENDOR_DOC_CONFIG: Record<string, { docType: DocumentType; label: string }> = {
    'QY': { docType: 'INVOICE',      label: 'Invoice' },
    'MY': { docType: 'PACKING_LIST', label: 'Packing List' },
    'PW': { docType: 'INVOICE',      label: 'Invoice with EAN' },
    'YJ': { docType: 'INVOICE',      label: 'Invoice' },
};

const getVendorDocConfig = (code: string): { prefix: string; docType: DocumentType; label: string } | null => {
    if (!code) return null;
    const upper = code.toUpperCase();
    for (const prefix of Object.keys(VENDOR_DOC_CONFIG)) {
        if (upper.startsWith(prefix)) return { prefix, ...VENDOR_DOC_CONFIG[prefix] };
    }
    return null;
};

// Fallback name-similarity threshold used only when no row.name_similarity was computed
// (mirrors the backend default in checkPartialMatch_ — see 11_PO+Shipment Codes.gs)
const DEFAULT_NAME_MATCH_THRESHOLD = 50;

const MATCH_CONDITION_STATUSES = new Set(['MATCH', 'PARTIAL_MATCH', 'MULTIPLE_MATCH', 'MULTIPLE_VARIANT', 'UNMATCHED']);

/**
 * Builds the "Match Condition" tooltip steps (Validate Items tab only) from the row's
 * actual match data, following: Code lookup (AN/FC/EAN) -> Multiple check -> MY ID check
 * (if present) -> Name check. Price variance is deliberately not shown here — that's
 * covered by the ID / Price / EAN tab instead.
 * Mirrors performPhase1SKUIdentification_ / performPhase2ProductVerification_ in 11_PO+Shipment Codes.gs.
 */
const getMatchConditionSteps = (row: EnrichedRow): Array<{ label: string; ok: boolean; detail: string }> => {
    const steps: Array<{ label: string; ok: boolean; detail: string }> = [];

    const codeFound = row.match_status !== 'UNMATCHED';
    steps.push({
        label: 'Code lookup',
        ok: codeFound,
        detail: codeFound
            ? `Resolved via ${row.matched_by ? row.matched_by.replace(/_/g, ' ') : 'AN / FC / EAN'}${row.matched_code ? ` (${row.matched_code})` : ''}`
            : 'Not found via AN, FC, or EAN'
    });
    if (!codeFound) return steps;

    if (row.match_status === 'MULTIPLE_MATCH') {
        steps.push({ label: 'Multiple check', ok: false, detail: `${row.multiple_matches?.length || 'Multiple'} different SKUs matched via AN/FC` });
        return steps;
    }
    if (row.match_status === 'MULTIPLE_VARIANT') {
        steps.push({ label: 'Multiple check', ok: false, detail: 'Same EAN appears on more than one invoice line' });
        return steps;
    }
    steps.push({ label: 'Multiple check', ok: true, detail: 'Single unique match' });

    if (row.my_id_check !== null && row.my_id_check !== undefined) {
        steps.push({
            label: 'MY ID check',
            ok: row.my_id_check === true,
            detail: row.my_id_check === true
                ? `MY ID ${row.my_id} matches matched SKU`
                : `MY ID says ${row.my_id_mismatch_value || row.my_id}, matched SKU is ${row.matched_sku}`
        });
    }

    if (row.name_similarity != null) {
        const nameOk = row.name_similarity >= DEFAULT_NAME_MATCH_THRESHOLD;
        steps.push({
            label: 'Name check',
            ok: nameOk,
            detail: `${Math.round(row.name_similarity)}% similarity — "${row.item_name}" vs "${row.matched_name}"`
        });
    } else {
        steps.push({ label: 'Name check', ok: true, detail: 'Names match' });
    }

    // Price check is intentionally excluded here — it belongs to the ID / Price / EAN tab
    // (MASTER ¥ / DIFF columns), not the Validate Items match-condition breakdown.

    return steps;
};

// FIFO allocation loader — status lines shown one at a time while the engine runs
const ALLOCATION_LOADER_MESSAGES = [
    'Reading shipment line items...',
    'Sorting open purchase orders by date...',
    'Finding the oldest open PO for each SKU...',
    'Reserving quantities against pending orders...',
    'Calculating unallocated remainders...',
    'Wrapping up allocation...',
];

export const VendorShipments: React.FC<VendorShipmentsProps> = ({ onNavigate, vendorMasters, productMasterList: initialProductMasterList = [] }) => {
    // Component State
    const [activeTab, setActiveTab] = useState<ShipmentTab>('Setup');
    const [vendorCode, setVendorCode] = useState('');
    const [shippingMode, setShippingMode] = useState<'SEA' | 'AIR' | ''>('');
    const [uploadedFiles, setUploadedFiles] = useState<any[]>([]);
    const [shipmentDate, setShipmentDate] = useState(new Date().toISOString().split('T')[0]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [parsedPreview, setParsedPreview] = useState<{ fileName: string; rows: any[] } | null>(null);
    const [showAllPreview, setShowAllPreview] = useState(false);
    const [isParsing, setIsParsing] = useState(false);
    const [matchingTick, setMatchingTick] = useState(0);
    const [matchingPhase, setMatchingPhase] = useState<'idle' | 'running' | 'complete' | 'error'>('idle');
    const [matchingResultSummary, setMatchingResultSummary] = useState<{
        total: number; matched: number; partial: number;
        multipleMatch: number; multipleVariant: number; unmatched: number; skuMismatch: number;
    } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [showDebug, setShowDebug] = useState(false);
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [isSuccess, setIsSuccess] = useState(false);
    const [showSaved, setShowSaved] = useState(false);

    // Network Trace State
    const [lastRequest, setLastRequest] = useState<any>(null);
    const [lastResponse, setLastResponse] = useState<any>(null);

    // Validation Results
    const [validationRows, setValidationRows] = useState<EnrichedRow[]>([]);
    const [backendError, setBackendError] = useState<string | null>(null);
    const [backendIssues, setBackendIssues] = useState<any[]>([]);
    const [statusFilter, setStatusFilter] = useState<'ALL' | 'LOOKS_GOOD' | 'NEEDS_INPUT'>('ALL');
    const [p2Filter, setP2Filter] = useState<'ALL' | 'LOOKS_GOOD' | 'NEEDS_INPUT'>('ALL');
    const [priceEanPhase, setPriceEanPhase] = useState<'idle' | 'running' | 'complete'>('idle');
    const [priceEanTick, setPriceEanTick] = useState(0);
    const [openP2NotesIds, setOpenP2NotesIds] = useState<Set<string>>(new Set());
    const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
    const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
    const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
    const [openNotesIds, setOpenNotesIds] = useState<Set<string>>(new Set());
    const [statusTooltip, setStatusTooltip] = useState<{ id: string; pos: { top: number; left: number } } | null>(null);

    // Product master state
    const [productMasterList, setProductMasterList] = useState<Array<{ id: string; name: string; cost: number; ean?: string }>>([]);

    // Bypasses upload — user goes straight to Validate Items to add lines manually
    const [manualOnlyMode, setManualOnlyMode] = useState(false);

    // Manual Entry Draft (Setup tab rows before submission)
    const [manualEntryDraft, setManualEntryDraft] = useState<Array<{
        id: string;
        factory_code: string;
        ean: string;
        item_name: string;
        invoice_qty: number | '';
        unit_price: number | '';
        carton_count: number | '';
    }>>([]);

    // Allocation & Creation
    const [allocationData, setAllocationData] = useState<AllocationItem[]>([]);
    const [allocationSummary, setAllocationSummary] = useState<any>(null);
    const [allocationLoading, setAllocationLoading] = useState(false);
    const [allocationPhase, setAllocationPhase] = useState<'idle' | 'running' | 'complete'>('idle');
    const [allocationTick, setAllocationTick] = useState(0);
    const [expandedRows, setExpandedRows] = useState<{[key: string]: boolean}>({});

    // Review & Final Validation State
    const [reviewData, setReviewData] = useState<any>(null);
    const [reviewLoading, setReviewLoading] = useState(false);
    const [isRefreshingAllocation, setIsRefreshingAllocation] = useState(false);
    const [canProceedToCreation, setCanProceedToCreation] = useState(false);
    const [expandedWarnings, setExpandedWarnings] = useState<{[key: string]: boolean}>({});
    const [showPreviewPOModal, setShowPreviewPOModal] = useState(false);
    const [poCreationResults, setPoCreationResults] = useState<Array<{vendor_code: string; po_id?: string; sku_count?: number; total_qty?: number; success: boolean; error?: string}>>([]);
    const [showPOResultModal, setShowPOResultModal] = useState(false);
    const [isRetryingVendor, setIsRetryingVendor] = useState<string | null>(null);
    const [detectionInfo, setDetectionInfo] = useState<any>(null);
    const [invoiceMetaNotice, setInvoiceMetaNotice] = useState<{no: string, date: string} | null>(null);

    // Creation States
    const [batchOption, setBatchOption] = useState<'new' | 'existing'>('new');
    const [selectedBatchId, setSelectedBatchId] = useState('');
    const [openBatches, setOpenBatches] = useState<any[]>([]);
    const [cartonCount, setCartonCount] = useState(0);
    const [finalShipmentAmount, setFinalShipmentAmount] = useState(0);
    const [notes, setNotes] = useState('');
    const [invoiceDate, setInvoiceDate] = useState('');
    const [carrier, setCarrier] = useState('');
    const [expectedDelivery, setExpectedDelivery] = useState('');
    const [validationErrors, setValidationErrors] = useState<{[key: string]: string}>({});
    const [isCreatingShipment, setIsCreatingShipment] = useState(false);
    const [shipmentSuccess, setShipmentSuccess] = useState(false);
    const [createdShipmentId, setCreatedShipmentId] = useState('');

    // Drive document upload (after Finalize, once batch_id + shipment_id are known)
    const [isUploadingDocs, setIsUploadingDocs] = useState(false);
    const [showDriveUploadModal, setShowDriveUploadModal] = useState(false);
    const [driveUploadResults, setDriveUploadResults] = useState<Array<{
        fileName: string;
        status: 'uploaded' | 'conflict' | 'used_existing' | 'failed';
        fileId?: string;
        viewUrl?: string;
        error?: string;
        existing?: { fileId: string; fileName: string; viewUrl: string };
    }>>([]);
    const [driveFolderInfo, setDriveFolderInfo] = useState<{ folderId: string; folderUrl: string } | null>(null);
    const [pendingDriveIds, setPendingDriveIds] = useState<{ batchId: string; shipmentId: string } | null>(null);
    const [resolvingConflict, setResolvingConflict] = useState<string | null>(null);

    const toggleRowExpansion = (sku: string) => {
        setExpandedRows(prev => ({
            ...prev,
            [sku]: !prev[sku]
        }));
    };

    const toggleWarningExpansion = (warningType: string) => {
        setExpandedWarnings(prev => ({
            ...prev,
            [warningType]: !prev[warningType]
        }));
    };

    const getWarningIcon = (severity: string) => {
        if (severity === 'BLOCKING') return '🚫';
        if (severity === 'WARNING') return '⚠️';
        return 'ℹ️';
    };

    const getWarningColor = (severity: string) => {
        if (severity === 'BLOCKING') return 'border-red-300 bg-red-100 dark:border-red-500/40 dark:bg-red-500/15';
        if (severity === 'WARNING') return 'border-amber-300 bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/15';
        return 'border-blue-300 bg-blue-100 dark:border-blue-500/40 dark:bg-blue-500/15';
    };

    const clearSelection = useCallback(() => {
        setUploadedFiles([]);
        setInvoiceNumber('');
        setValidationRows([]);
        setAllocationData([]);
        setAllocationSummary(null);
        setReviewData(null);
        setBackendError(null);
        setBackendIssues([]);
        setIsSuccess(false);
        setActiveTab('Setup');
        setVendorCode('');
        setShipmentDate(new Date().toISOString().split('T')[0]);
        setShippingMode('');
        setBatchOption('new');
        setSelectedBatchId('');
        setCartonCount(0);
        setFinalShipmentAmount(0);
        setNotes('');
        setInvoiceDate('');
        setCarrier('');
        setExpectedDelivery('');
        setShipmentSuccess(false);
        setCreatedShipmentId('');
        setManualEntryDraft([]);
        setManualOnlyMode(false);
        setSelectedRowIds(new Set());
        setOpenDropdownId(null);
        setDropdownPos(null);
        setOpenNotesIds(new Set());
        setParsedPreview(null);
        setShowAllPreview(false);
        setMatchingPhase('idle');
        setMatchingResultSummary(null);
        setMatchingTick(0);
        setStatusFilter('ALL');
        setP2Filter('ALL');

        // Clear saved draft from localStorage
        localStorage.removeItem('vendor_shipment_draft');
    }, []);

    const handleStartNew = useCallback(() => {
        if (window.confirm('Start a new shipment? This will clear your current progress and cannot be undone.')) {
            clearSelection();
        }
    }, [clearSelection]);

    // Close dropdown on outside click or scroll
    useEffect(() => {
        if (!openDropdownId) return;
        const handler = () => { setOpenDropdownId(null); setDropdownPos(null); };
        document.addEventListener('click', handler);
        document.addEventListener('scroll', handler, true);
        return () => {
            document.removeEventListener('click', handler);
            document.removeEventListener('scroll', handler, true);
        };
    }, [openDropdownId]);

    // Matching engine tick animation — only runs during 'running' phase
    useEffect(() => {
        if (matchingPhase !== 'running') { setMatchingTick(0); return; }
        const id = setInterval(() => setMatchingTick(t => t + 1), 80);
        return () => clearInterval(id);
    }, [matchingPhase]);

    // Price & EAN engine tick animation
    useEffect(() => {
        if (priceEanPhase !== 'running') { setPriceEanTick(0); return; }
        const id = setInterval(() => setPriceEanTick(t => t + 1), 80);
        return () => clearInterval(id);
    }, [priceEanPhase]);

    // FIFO allocation engine tick animation
    useEffect(() => {
        if (allocationPhase !== 'running') { setAllocationTick(0); return; }
        const id = setInterval(() => setAllocationTick(t => t + 1), 90);
        return () => clearInterval(id);
    }, [allocationPhase]);

    // Review tab: warnings start expanded whenever review data (re)loads, but stay
    // individually collapsible afterward — toggling doesn't touch reviewData, so this
    // won't re-fire and force them back open.
    useEffect(() => {
        if (!reviewData?.warnings?.length) return;
        setExpandedWarnings(
            reviewData.warnings.reduce((acc: {[key: string]: boolean}, w: any) => {
                acc[w.type] = true;
                return acc;
            }, {})
        );
    }, [reviewData]);

    // Restore from localStorage on mount
    useEffect(() => {
        const savedState = localStorage.getItem('vendor_shipment_draft');
        if (savedState) {
            try {
                const parsed = JSON.parse(savedState);
                
                // Only restore if data is less than 24 hours old
                const age = Date.now() - (parsed.timestamp || 0);
                if (age < 24 * 60 * 60 * 1000) {
                    setVendorCode(parsed.vendorCode || '');
                    setShipmentDate(parsed.shipmentDate || new Date().toISOString().split('T')[0]);
                    setShippingMode(parsed.shippingMode || '');
                    setValidationRows(parsed.validationRows || []);
                    setAllocationData(parsed.allocationData || []);
                    setAllocationSummary(parsed.allocationSummary || null);
                    setReviewData(parsed.reviewData || null);
                    setCanProceedToCreation(parsed.canProceedToCreation || false);
                    const savedTab = parsed.activeTab === 'Validation' ? 'Validate Items' : parsed.activeTab;
                    setActiveTab((savedTab || 'Setup') as ShipmentTab);
                    setBackendError(parsed.backendError || null);
                    setBackendIssues(parsed.backendIssues || []);
                    
                    // We can't restore actual File objects, but we can display the previously processed state
                    if (parsed.uploadedFilesMetadata) {
                        setUploadedFiles(parsed.uploadedFilesMetadata.map((f: any) => ({
                            id: f.id,
                            docType: f.docType,
                            file: { name: f.name } // Stub file object
                        })));
                    }
                }
            } catch (error) {
                console.error('Failed to restore shipment state:', error);
                localStorage.removeItem('vendor_shipment_draft');
            }
        }
    }, []);

    // Save to localStorage whenever data changes
    useEffect(() => {
        if (validationRows.length > 0 || uploadedFiles.length > 0 || vendorCode) {
            const shipmentState = {
                vendorCode,
                shipmentDate,
                shippingMode,
                uploadedFilesMetadata: uploadedFiles.map(f => ({ 
                    id: f.id, 
                    name: f.file?.name || 'Unknown File', 
                    docType: f.docType 
                })),
                validationRows,
                allocationData,
                allocationSummary,
                reviewData,
                canProceedToCreation,
                activeTab,
                backendError,
                backendIssues,
                timestamp: Date.now()
            };
            localStorage.setItem('vendor_shipment_draft', JSON.stringify(shipmentState));
            
            // Show "Saved" indicator briefly
            setShowSaved(true);
            const timer = setTimeout(() => setShowSaved(false), 2000);
            return () => clearTimeout(timer);
        }
    }, [validationRows, uploadedFiles, vendorCode, shipmentDate, shippingMode, allocationData, allocationSummary, reviewData, canProceedToCreation, activeTab, backendError, backendIssues]);

    // Fetch Open Batches When Entering Creation Tab
    useEffect(() => {
      if (activeTab === 'Creation') {
        fetchOpenBatches();
        // Auto-fill total amount from invoice total if not already set
        if (!finalShipmentAmount || finalShipmentAmount === 0) {
          const invoiceTotal = validationRows.reduce((sum, row) => {
            return sum + (toNum(row.unit_price) * toNum(row.invoice_qty));
          }, 0);
          if (invoiceTotal > 0) setFinalShipmentAmount(Math.round(invoiceTotal * 100) / 100);
        }
      }
    }, [activeTab, shippingMode]);

    const fetchOpenBatches = async () => {
      try {
        const payload = {
          action: 'get_open_batches',
          batch_type: shippingMode // Optional filter
        };

        setLastRequest(payload);

        const response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        setLastResponse(data);

        if (data.status === 'success') {
          setOpenBatches(data.batches || []);
        }
      } catch (error) {
        console.error('Failed to fetch open batches:', error);
      }
    };


    // Load product master list for manual SKU selection
    useEffect(() => {
        const loadProductMaster = async () => {
            try {
                const response = await fetch(APPS_SCRIPT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({ action: 'get_product_master' })
                });
                const data = await response.json();
                
                if (data.status === 'success' && data.products) {
                    setProductMasterList(data.products.map((p: any) => ({
                        id: p.sku || p.id,
                        name: p.productName || p.name,
                        cost: toNum(p.cost),
                        ean: p.ean || ''
                    })));
                } else if (initialProductMasterList.length > 0) {
                    setProductMasterList(initialProductMasterList.map(p => ({
                        id: p.id,
                        name: p.name,
                        cost: p.cost,
                        ean: p.ean || ''
                    })));
                }
            } catch (error) {
                console.error('Failed to load product master:', error);
                if (initialProductMasterList.length > 0) {
                    setProductMasterList(initialProductMasterList.map(p => ({
                        id: p.id,
                        name: p.name,
                        cost: p.cost,
                        ean: p.ean || ''
                    })));
                }
            }
        };
        
        loadProductMaster();
    }, [initialProductMasterList]);

    // Filter Logic
    const isLooksGood = (row: EnrichedRow) =>
        row.match_status === 'MATCH' || row.match_status === 'MANUAL_ENTRY';
    // Treat dash placeholders, empty strings, and null/undefined as "no EAN"
    const hasRealEan = (ean: string | null | undefined) =>
        !!(ean && ean.trim() && ean !== '-' && ean !== '–' && ean !== 'N/A');
    // Not being matched via EAN is fine — only an actual invoice-vs-master EAN
    // mismatch (both present, values differ) counts as an issue.
    const isEanMismatch = (row: EnrichedRow) => {
        const masterEan = productMasterList.find(p => p.id === (row.matched_sku || row.sku))?.ean || '';
        return hasRealEan(row.ean) && hasRealEan(masterEan) && row.ean.trim() !== masterEan.trim();
    };
    // Invoice EAN doesn't appear anywhere in the master EAN column at all — a brand new barcode.
    const isNewEan = (row: EnrichedRow) => {
        if (!hasRealEan(row.ean)) return false;
        const invoiceEan = row.ean.trim();
        return !productMasterList.some(p => hasRealEan(p.ean) && p.ean!.trim() === invoiceEan);
    };
    const filteredRows = useMemo(() => {
        if (statusFilter === 'ALL') return validationRows;
        if (statusFilter === 'LOOKS_GOOD') return validationRows.filter(r => isLooksGood(r));
        return validationRows.filter(r => !isLooksGood(r));
    }, [validationRows, statusFilter]);

    // Gate for everything past Validate Items: only rows the user (explicitly or
    // implicitly, via an untouched clean MATCH) accepted move forward. Rows resolved
    // as Skip (REJECT_LINE) or REQUEST_NEW_SKU — or left unresolved on an ambiguous
    // match — stay behind and never reach ID/Price/EAN Review or Allocation.
    const isRowAccepted = (row: EnrichedRow) => {
        if (row.match_status === 'MANUAL_ENTRY') return true;
        if (row.resolution_action === 'ACCEPT' || row.resolution_action === 'OVERRIDE') return true;
        if (!row.resolution_action && row.match_status === 'MATCH') return true;
        return false;
    };

    const p2FilteredRows = useMemo(() => {
        const base = validationRows.filter(isRowAccepted);
        if (p2Filter === 'ALL') return base;
        const isNeedsInput = (r: EnrichedRow) => {
            const { diff } = calculatePriceDiff(toNum(r.unit_price), toNum(r.master_cost || 0));
            return r.match_status === 'PARTIAL_MATCH' || diff > 0.01 || isEanMismatch(r);
        };
        if (p2Filter === 'LOOKS_GOOD') return base.filter(r => !isNeedsInput(r));
        return base.filter(isNeedsInput);
    }, [validationRows, p2Filter, productMasterList]);

    const summaryStats = useMemo(() => {
        const matched = validationRows.filter(r => r.match_status === 'MATCH').length;
        const unmatched = validationRows.filter(r => r.match_status === 'UNMATCHED').length;
        const flagged = validationRows.filter(r => 
            ['SKU_MISMATCH', 'MULTIPLE_MATCH', 'PARTIAL_MATCH', 'MULTIPLE_VARIANT'].includes(r.match_status)
        ).length;
        
        return {
            total: validationRows.length,
            matched,
            unmatched,
            flagged
        };
    }, [validationRows]);

    const canProceedToAllocation = useMemo(() => {
        if (validationRows.length === 0 || backendError) return false;
        const unresolved = validationRows.filter(r => {
            if (r.resolution_action === 'REQUEST_NEW_SKU') return false;
            if (r.resolution_action === 'REJECT_LINE') return false;
            if (r.resolution_action === 'Skip Item') return false;
            if (r.resolution_action === 'ACCEPT') return false;
            if (r.resolution_action === 'OVERRIDE') return false;
            if (r.match_status === 'MATCH') return false;
            if (r.match_status === 'UNMATCHED' && !r.matched_sku && !r.sku) return true;
            // matched_sku is pre-filled with a best-guess candidate even when ambiguous —
            // only an explicit resolution_action (set by handleManualMatch/skip/etc.) counts as resolved.
            if (['MULTIPLE_MATCH', 'MULTIPLE_VARIANT'].includes(r.match_status)) return true;
            if (['PARTIAL_MATCH', 'SKU_MISMATCH'].includes(r.match_status) && !r.resolution_action) return true;
            return false;
        });
        return unresolved.length === 0;
    }, [validationRows, backendError]);

    const vendorDocConfig = useMemo(() => getVendorDocConfig(vendorCode), [vendorCode]);

    // --- Step Navigation Helpers ---
    const isStepDisabled = (tab: ShipmentTab): boolean => {
        if (tab === 'Setup') return false;
        if (tab === 'Validate Items') return !manualOnlyMode && validationRows.length === 0 && !backendError;
        if (tab === 'ID / Price / EAN Review') return !canProceedToAllocation && allocationData.length === 0;
        if (tab === 'Allocation') return allocationData.length === 0;
        if (tab === 'Review') return !reviewData;
        return false;
    };

    const isStepDone = (tab: ShipmentTab): boolean => {
        const tabIdx = SHIPMENT_STEP_FLOW.indexOf(tab);
        if (tabIdx === -1) return false;
        const curIdx = activeTab === 'Creation' ? SHIPMENT_STEP_FLOW.length : SHIPMENT_STEP_FLOW.indexOf(activeTab);
        if (curIdx !== -1 && curIdx > tabIdx) return true;
        if (tab === 'Setup') return manualOnlyMode || validationRows.length > 0 || !!backendError;
        if (tab === 'Validate Items') return allocationData.length > 0;
        if (tab === 'ID / Price / EAN Review') return allocationData.length > 0;
        if (tab === 'Allocation') return reviewData !== null;
        if (tab === 'Review') return shipmentSuccess;
        return false;
    };

    const getStepStatus = (tab: ShipmentTab): 'done' | 'active' | 'upcoming' | 'locked' => {
        if (activeTab === tab) return 'active';
        if (isStepDone(tab)) return 'done';
        if (isStepDisabled(tab)) return 'locked';
        return 'upcoming';
    };

    // Handlers
    const handleFileSelect = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const defaultDocType: DocumentType = vendorDocConfig ? vendorDocConfig.docType : 'INVOICE';
        const newFiles = Array.from(files).map(f => ({
            file: f,
            docType: defaultDocType,
            id: `FILE-${Math.random().toString(36).substr(2, 9)}`
        }));
        setUploadedFiles(prev => [...prev, ...newFiles]);

        // Auto-parse first new file for in-tab preview
        const firstFile = newFiles[0]?.file;
        if (firstFile) {
            setIsParsing(true);
            setParsedPreview(null);
            setShowAllPreview(false);
            try {
                const result = await parseVendorFile(firstFile);
                setParsedPreview({ fileName: firstFile.name, rows: result.rows || [] });
            } catch {
                // silent — user can still proceed without preview
            } finally {
                setIsParsing(false);
            }
        }
    };

    const handleSkipToManualEntry = () => {
        if (!vendorCode || !shippingMode) return;
        setManualOnlyMode(true);
        setValidationRows([]);
        setActiveTab('Validate Items');
    };

    const handleUploadAndValidate = async () => {
        if (!vendorCode || !shippingMode || (uploadedFiles.length === 0 && manualEntryDraft.length === 0)) return;
        setIsProcessing(true);
        setMatchingPhase('running');
        setMatchingTick(0);
        setMatchingResultSummary(null);
        setBackendError(null);
        setValidationRows([]);
        setDetectionInfo(null);
        setInvoiceMetaNotice(null);

        try {
            const parsedFiles = await Promise.all(uploadedFiles.map(async f => {
                if (!f.file.lastModified) return null;
                const result = await parseVendorFile(f.file);
                return { fileName: f.file.name, documentType: f.docType, ...result };
            }));

            const validFiles = parsedFiles.filter(Boolean);
            if (validFiles.length === 0 && uploadedFiles.length > 0) {
                throw new Error("No actual files were selected. Please re-upload your documents to re-run validation.");
            }

            const firstMeta = validFiles.find(f => f.invoiceMeta.invoiceNo || f.invoiceMeta.invoiceDate);
            if (firstMeta) {
                if (firstMeta.invoiceMeta.invoiceNo) setInvoiceNumber(firstMeta.invoiceMeta.invoiceNo);
                if (firstMeta.invoiceMeta.invoiceDate) setInvoiceDate(firstMeta.invoiceMeta.invoiceDate);
                setInvoiceMetaNotice({ no: firstMeta.invoiceMeta.invoiceNo, date: firstMeta.invoiceMeta.invoiceDate });
            }

            if (validFiles[0]) setDetectionInfo(validFiles[0].detectionInfo);

            const allFiles = [
                ...validFiles.map(f => ({ fileName: f.fileName, documentType: f.documentType, rows: f.rows })),
                ...(manualEntryDraft.length > 0 ? [{
                    fileName: 'Manual Entry',
                    documentType: vendorDocConfig?.docType || 'INVOICE',
                    rows: manualEntryDraft.map(r => ({
                        factory_code: r.factory_code, ean: r.ean, item_name: r.item_name,
                        invoice_qty: Number(r.invoice_qty) || 0, unit_price: Number(r.unit_price) || 0,
                        carton_count: Number(r.carton_count) || 0,
                    }))
                }] : [])
            ];

            const payload = { action: API_ACTIONS.UPLOAD_SHIPMENT_DOCS, vendorCode, shipmentDate, shippingMode, files: allFiles };
            setLastRequest(payload);

            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();
            setLastResponse(result);

            if (result.status === 'success') {
                const rows = result.rows || [];
                setValidationRows(rows);
                setBackendIssues(result.issues || []);
                if (result.shipmentId) setInvoiceNumber(result.shipmentId);

                setMatchingResultSummary({
                    total: rows.length,
                    matched: rows.filter((r: any) => r.match_status === 'MATCH').length,
                    partial: rows.filter((r: any) => r.match_status === 'PARTIAL_MATCH').length,
                    multipleMatch: rows.filter((r: any) => r.match_status === 'MULTIPLE_MATCH').length,
                    multipleVariant: rows.filter((r: any) => r.match_status === 'MULTIPLE_VARIANT').length,
                    unmatched: rows.filter((r: any) => r.match_status === 'UNMATCHED').length,
                    skuMismatch: rows.filter((r: any) => r.match_status === 'SKU_MISMATCH').length,
                });
                setMatchingPhase('complete');
                await new Promise(res => setTimeout(res, 2400));
                setMatchingPhase('idle');
                setActiveTab('Validate Items');
            } else {
                setMatchingPhase('error');
                setBackendError(result.message || 'Validation Failed');
            }
        } catch (err: any) {
            setMatchingPhase('error');
            setBackendError(err.message || 'Network Failure');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleAddManualLine = () => {
        const newLine: EnrichedRow = {
            line_id: `MANUAL-${Math.random().toString(36).substr(2, 9)}`,
            source_file_name: 'MANUAL_ENTRY',
            document_type: 'INVOICE',
            factory_code: '',
            item_name: '',
            invoice_qty: 0,
            unit_price: 0,
            unit_price_base: 0,
            carton_count: 0,
            total_price: 0,
            ean: '',
            sku: '',
            match_status: 'MANUAL_ENTRY',
            matched_sku: '',
            matched_name: '',
            matched_by: '',
            matched_code: '',
            match_confidence: '',
            vendor_provided_sku: '',
            sku_mismatch_flag: false,
            resolution_action: 'ACCEPT'
        };
        setValidationRows(prev => [...prev, newLine]);
    };

    const handleRemoveManualLine = (lineId: string) => {
        setValidationRows(prev => prev.filter(r => r.line_id !== lineId));
    };

    const handleRowChange = (lineId: string, field: keyof EnrichedRow, value: any) => {
        setValidationRows(prev => prev.map(row => 
            row.line_id === lineId ? { ...row, [field]: value } : row
        ));
    };

    const handleManualMatch = (lineId: string, selectedSku: string) => {
        const product = productMasterList.find(p => p.id === selectedSku);
        setValidationRows(prev => prev.map(row => 
            row.line_id === lineId 
                ? { 
                    ...row, 
                    sku: selectedSku,
                    matched_sku: selectedSku, 
                    matched_name: product?.name || 'Selected Item',
                    item_name: product?.name || row.item_name,
                    match_status: 'MATCH',
                    match_type: 'Manual Match',
                    master_cost: product?.cost || 0,
                    resolution_action: 'ACCEPT',
                    show_override: false
                }
                : row
        ));
    };

    const handleApproveAll = () => {
        const unresolvedRows = validationRows.filter(row => {
            const needsSelection = ['UNMATCHED', 'MULTIPLE_MATCH', 'MULTIPLE_VARIANT'].includes(row.match_status);
            const hasNoSKU = !row.matched_sku && !row.sku;
            return needsSelection && hasNoSKU;
        });
        
        if (unresolvedRows.length > 0) {
            alert(`Please resolve ${unresolvedRows.length} unmatched items before proceeding.`);
            return;
        }
        
        setValidationRows(prev => prev.map(row => {
            if (!row.resolution_action) {
                return { ...row, resolution_action: 'ACCEPT' };
            }
            return row;
        }));
        
        alert('All items validated! Use "Confirm and Proceed to Allocation" button.');
    };

    const handleConfirmValidation = async () => {
        setAllocationLoading(true);
        setBackendError(null);

        // Only accepted rows move forward — Skip / REQUEST_NEW_SKU / unresolved
        // ambiguous matches never reach allocation.
        const rowsToAllocate = validationRows.filter(isRowAccepted);
        setAllocationPhase('running');

        try {
            const payload = {
                action: 'allocate_to_open_pos',
                vendor_code: vendorCode,
                validated_rows: rowsToAllocate
            };
            setLastRequest(payload);

            const response = await fetch(APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            setLastResponse(data);

            if (data.status === 'success') {
                setAllocationData(data.allocations || []);
                setAllocationSummary(data.summary || null);
                setAllocationPhase('complete');
                await new Promise(res => setTimeout(res, 1500));
                setActiveTab('Allocation');
            } else {
                setBackendError(data.message || 'Allocation failed');
            }
        } catch (error: any) {
            setBackendError(error.message || 'Failed to allocate');
        } finally {
            setAllocationLoading(false);
            setAllocationPhase('idle');
        }
    };

    const handleProceedToReview = async () => {
        setReviewLoading(true);
        setBackendError(null);
        
        try {
          const payload = {
            action: 'get_review_data',
            vendor_code: vendorCode,
            validated_rows: validationRows,
            allocations: allocationData
          };
          setLastRequest(payload);
          
          const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
          });
          
          const data = await response.json();
          setLastResponse(data);
          
          if (data.status === 'success') {
            setReviewData(data);
            setCanProceedToCreation(data.can_proceed);
            setActiveTab('Review');
          } else {
            setBackendError(data.message || 'Failed to load review data');
          }
        } catch (error: any) {
          setBackendError(error.message || 'Failed to load review data');
        } finally {
          setReviewLoading(false);
        }
    };

    const handleConfirmAndContinue = async () => {
        setPriceEanPhase('running');
        // ~2.4s of animation: 30 ticks × 80ms
        await new Promise(res => setTimeout(res, 2400));
        setPriceEanPhase('complete');
        await new Promise(res => setTimeout(res, 1200));
        setPriceEanPhase('idle');
        setActiveTab('ID / Price / EAN Review');
    };

    const handleRefreshAllocation = async () => {
        setIsRefreshingAllocation(true);
        setBackendError(null);

        // Re-run allocation with only accepted rows
        const rowsToAllocate = validationRows.filter(isRowAccepted);
        setAllocationPhase('running');

        try {
          const payload = {
            action: 'allocate_to_open_pos',
            vendor_code: vendorCode,
            validated_rows: rowsToAllocate
          };
          
          const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
          });
          
          const data = await response.json();
          
          if (data.status === 'success') {
            // Update allocation data
            setAllocationData(data.allocations);
            setAllocationSummary(data.summary);
            
            // Re-fetch review data with new allocations
            const reviewPayload = {
              action: 'get_review_data',
              vendor_code: vendorCode,
              validated_rows: validationRows,
              allocations: data.allocations
            };
            
            const reviewResponse = await fetch(APPS_SCRIPT_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: JSON.stringify(reviewPayload)
            });
            
            const refreshedReviewData = await reviewResponse.json();
            
            if (refreshedReviewData.status === 'success') {
              setReviewData(refreshedReviewData);
              setCanProceedToCreation(refreshedReviewData.can_proceed);
              setAllocationPhase('complete');
              await new Promise(res => setTimeout(res, 1500));
            } else {
              throw new Error(refreshedReviewData.message || 'Failed to refresh review data');
            }
          } else {
            setBackendError(data.message || 'Failed to refresh allocation');
          }
        } catch (error: any) {
          setBackendError(error.message || 'Failed to refresh allocation');
        } finally {
          setIsRefreshingAllocation(false);
          setAllocationPhase('idle');
        }
    };

    const getUnallocatedItems = () => allocationData
      .filter(a => a.unallocated_qty > 0)
      .map(a => ({
        sku: a.sku,
        sku_name: a.sku_name,
        qty: a.unallocated_qty,
        vendor_code: vendorCode,
        unit_price: a.unit_price,
        custom_logo: false,
        custom_packaging: false,
        solving_manual: false,
        opp_wrap: false,
        custom_remarks: '',
        customization_files: ''
      }));

    const handleCreatePOsDirect = async (linesOverride?: ReturnType<typeof getUnallocatedItems>, vendorBeingRetried?: string) => {
      const lines = linesOverride || getUnallocatedItems();

      if (lines.length === 0) {
        alert('No unallocated items to create a purchase order for');
        return;
      }

      if (vendorBeingRetried) {
        setIsRetryingVendor(vendorBeingRetried);
      } else {
        setIsProcessing(true);
      }
      setBackendError(null);

      try {
        const payload = {
          action: API_ACTIONS.CREATE_PO_DIRECT,
          mode: shippingMode,
          lines
        };

        const response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.status === 'success') {
          setPoCreationResults(prev => {
            if (!vendorBeingRetried) return data.results || [];
            // Merge retry result back into the existing results list
            const merged = prev.filter(r => r.vendor_code !== vendorBeingRetried);
            return [...merged, ...(data.results || [])];
          });
          setShowPreviewPOModal(false);
          setShowPOResultModal(true);
          // Refresh allocation/review data so newly-created POs are reflected
          await handleRefreshAllocation();
        } else {
          setBackendError(data.message || 'Failed to create purchase orders');
        }
      } catch (error: any) {
        setBackendError(error.message || 'Failed to create purchase orders');
      } finally {
        setIsProcessing(false);
        setIsRetryingVendor(null);
      }
    };

    const validateCreation = () => {
      const errors: {[key: string]: string} = {};
      
      if (cartonCount <= 0) {
        errors.cartons = "Carton count must be greater than 0";
      }
      
      if (batchOption === 'existing' && !selectedBatchId) {
        errors.batch = "Please select a batch";
      }
      
      if (!finalShipmentAmount || finalShipmentAmount <= 0) {
        errors.amount = "Amount must be greater than 0";
      }
      
      setValidationErrors(errors);
      return Object.keys(errors).length === 0;
    };

    const uploadShipmentDocumentsToDrive = async (
      batchId: string,
      shipmentId: string,
      filesToSend?: typeof uploadedFiles,
      conflictResolutions?: Record<string, string>
    ) => {
      const targets = filesToSend || uploadedFiles;
      if (targets.length === 0) return;

      setIsUploadingDocs(true);
      try {
        const formData = new FormData();
        formData.append('batchId', batchId);
        formData.append('shipmentId', shipmentId);
        formData.append('vendorCode', vendorCode);
        if (conflictResolutions) formData.append('conflictResolutions', JSON.stringify(conflictResolutions));
        targets.forEach(f => formData.append('files', f.file, f.file.name));

        const response = await fetch('/api/drive/upload-shipment-docs', {
          method: 'POST',
          body: formData
        });
        const data = await response.json();

        if (data.success) {
          setDriveFolderInfo({ folderId: data.folder.folderId, folderUrl: data.folder.folderUrl });
          setDriveUploadResults(prev => {
            const names = new Set(data.files.map((f: any) => f.fileName));
            const merged = prev.filter(r => !names.has(r.fileName));
            return [...merged, ...data.files];
          });

          // Best-effort: record the folder on the shipment's Sheets row. Non-fatal —
          // the files are already safely in Drive even if this metadata write fails.
          // Skipped entirely in dev mode, which must not write anything to Sheets.
          if (DEV_MODE_SKIP_SHIPMENT_WRITE) {
            console.log('[DEV MODE] Skipping update_shipment_drive_docs Sheets write.');
          } else fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
              action: API_ACTIONS.UPDATE_SHIPMENT_DRIVE_DOCS,
              shipmentId,
              driveFolderId: data.folder.folderId,
              driveFolderUrl: data.folder.folderUrl
            })
          }).catch(err => console.error('Failed to record Drive folder metadata:', err));
        } else {
          setBackendError(data.error || 'Failed to upload shipment documents to Drive');
        }
      } catch (error: any) {
        setBackendError(error.message || 'Failed to upload shipment documents to Drive');
      } finally {
        setIsUploadingDocs(false);
        setShowDriveUploadModal(true);
      }
    };

    const handleResolveDriveConflict = (fileName: string, strategy: 'replace' | 'keep_both' | 'use_existing') => {
      if (!pendingDriveIds) return;
      const file = uploadedFiles.find(f => f.file.name === fileName);
      if (!file) return;
      setResolvingConflict(fileName);
      uploadShipmentDocumentsToDrive(pendingDriveIds.batchId, pendingDriveIds.shipmentId, [file], { [fileName]: strategy })
        .finally(() => setResolvingConflict(null));
    };

    const handleRetryDriveUpload = (fileName: string) => {
      if (!pendingDriveIds) return;
      const file = uploadedFiles.find(f => f.file.name === fileName);
      if (!file) return;
      setResolvingConflict(fileName);
      uploadShipmentDocumentsToDrive(pendingDriveIds.batchId, pendingDriveIds.shipmentId, [file])
        .finally(() => setResolvingConflict(null));
    };

    const handleFinalizeShipment = async () => {
      if (!validateCreation()) {
        return;
      }

      setIsCreatingShipment(true);

      try {
        if (DEV_MODE_SKIP_SHIPMENT_WRITE) {
          // Dev/testing mode: skip the Apps Script write entirely (no Batches/
          // Vendor_Shipments/Purchase_Orders changes) and only exercise the
          // Drive upload, using throwaway IDs so the folder structure still works.
          console.log('[DEV MODE] Skipping create_vendor_shipment — Drive upload only.');
          const testBatchId = batchOption === 'existing' && selectedBatchId
            ? selectedBatchId
            : `DEV-${shippingMode || 'BATCH'}-${Date.now()}`;
          const testShipmentId = `DEV-VS-${vendorCode || 'TEST'}-${Date.now()}`;

          setCreatedShipmentId(testShipmentId);

          if (uploadedFiles.length > 0) {
            setPendingDriveIds({ batchId: testBatchId, shipmentId: testShipmentId });
            await uploadShipmentDocumentsToDrive(testBatchId, testShipmentId);
          } else {
            setShipmentSuccess(true);
          }
          return;
        }

        const payload = {
          action: 'create_vendor_shipment',
          vendor_code: vendorCode,
          shipment_date: shipmentDate,
          batch_option: batchOption,
          batch_id: batchOption === 'existing' ? selectedBatchId : undefined,
          batch_type: shippingMode,
          carton_count: cartonCount,
          total_amount: finalShipmentAmount,
          notes: notes,
          invoice_no: invoiceNumber,
          invoice_date: invoiceDate,
          carrier: carrier,
          expected_delivery: expectedDelivery,
          validated_rows: validationRows,
          allocations: allocationData
        };

        setLastRequest(payload);

        const response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });

        const data = await response.json();
        setLastResponse(data);

        if (data.status === 'success') {
          setCreatedShipmentId(data.shipment_id);
          // Clear draft from localStorage
          localStorage.removeItem('vendor_shipment_draft');

          if (uploadedFiles.length > 0) {
            setPendingDriveIds({ batchId: data.batch_id, shipmentId: data.shipment_id });
            await uploadShipmentDocumentsToDrive(data.batch_id, data.shipment_id);
          } else {
            setShipmentSuccess(true);
          }
        } else {
          setBackendError(data.message || 'Failed to create shipment');
        }
      } catch (error: any) {
        setBackendError(error.message || 'Failed to create shipment');
      } finally {
        setIsCreatingShipment(false);
      }
    };

    // Helper for table rendering
    const getStatusConfig = (status: string) => {
        const configs = {
            'MATCH': { label: 'MATCH', icon: '✓', variant: 'success' as const },
            'UNMATCHED': { label: 'UNMATCHED', icon: '✗', variant: 'destructive' as const },
            'SKU_MISMATCH': { label: 'SKU MISMATCH', icon: '⚠', variant: 'warning' as const },
            'MULTIPLE_MATCH': { label: 'MULTIPLE MATCH', icon: '⚠', variant: 'warning' as const },
            'PARTIAL_MATCH': { label: 'PARTIAL MATCH', icon: '⚠', variant: 'info' as const },
            'MULTIPLE_VARIANT': { label: 'MULTIPLE VARIANT', icon: '⚠', variant: 'info' as const }
        };
        return (configs as any)[status] || configs['UNMATCHED'];
    };

    if (isSuccess) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[80vh] text-white">
                <CheckBadgeIcon className="w-20 h-20 text-emerald-500 mb-6" />
                <h2 className="text-3xl font-bold">Shipment Created Successfully</h2>
                <Button className="mt-8" onClick={() => { clearSelection(); onNavigate?.('Dashboard'); }}>View Dashboard</Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col space-y-6 text-slate-800 dark:text-white p-6 bg-slate-50 dark:bg-slate-900 min-h-screen relative">
            {/* Header */}
            <div className="flex justify-between items-start">
                <div className="relative">
                    <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Vendor Shipment Entry</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Ingest vendor documents and reconcile matches</p>
                    
                    <div className="flex items-center gap-3 mt-2 h-6">
                        {validationRows.length > 0 && activeTab !== 'Setup' && (
                            <div className="flex items-center gap-2">
                                <Badge variant="info" className="text-[8px]">📋 DRAFT RESTORED</Badge>
                            </div>
                        )}
                        {showSaved && (
                            <span className="text-[9px] text-emerald-400 flex items-center gap-1 animate-in fade-in duration-200">
                                <CheckIcon className="w-3 h-3" />
                                Progress saved
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Gamified Step Progress */}
            <div className="bg-white dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-5 shadow-sm">
                <div className="flex items-start gap-0">
                    {/* Steps 1–5 */}
                    <div className="flex-1 flex items-start gap-0 min-w-0">
                        {SHIPMENT_STEP_FLOW.map((step, index) => {
                            const status = getStepStatus(step);
                            const isDone = status === 'done';
                            const isActive = status === 'active';
                            const isLocked = status === 'locked';
                            const isUpcoming = status === 'upcoming';
                            const connectorDone = index < SHIPMENT_STEP_FLOW.length - 1 && isStepDone(SHIPMENT_STEP_FLOW[index]);
                            const shortLabel = step === 'ID / Price / EAN Review' ? 'ID / Price / EAN' : step;

                            return (
                                <React.Fragment key={step}>
                                    <button
                                        onClick={() => !isLocked && setActiveTab(step)}
                                        disabled={isLocked}
                                        title={step}
                                        className={`flex flex-col items-center gap-2 flex-shrink-0 transition-all duration-200 px-1.5 ${isLocked ? 'cursor-not-allowed opacity-35' : 'cursor-pointer group'}`}
                                        style={{ minWidth: '88px' }}
                                    >
                                        {/* Bubble */}
                                        <div className={`
                                            relative w-11 h-11 rounded-full flex items-center justify-center font-black text-base border-2 transition-all duration-300 shrink-0
                                            ${isDone ? 'bg-emerald-500 border-emerald-400 text-white shadow-md shadow-emerald-500/30' : ''}
                                            ${isActive ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/40 scale-110 ring-4 ring-blue-500/20 dark:ring-blue-500/30' : ''}
                                            ${isUpcoming ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-300 dark:border-blue-500/50 text-blue-700 dark:text-blue-400 group-hover:bg-blue-100 dark:group-hover:bg-blue-500/20 group-hover:border-blue-400 dark:group-hover:border-blue-400 group-hover:shadow-md group-hover:shadow-blue-500/10' : ''}
                                            ${isLocked ? 'bg-slate-100 dark:bg-slate-900/60 border-slate-300 dark:border-slate-700 text-slate-400 dark:text-slate-600' : ''}
                                        `}>
                                            {isDone ? <CheckIcon className="w-5 h-5" /> : <span>{index + 1}</span>}
                                            {isActive && <span className="absolute inset-0 rounded-full animate-ping bg-blue-400/25 pointer-events-none" />}
                                        </div>

                                        {/* Label */}
                                        <span className={`text-[11px] font-bold text-center leading-tight transition-colors
                                            ${isActive ? 'text-blue-600 dark:text-blue-400' : ''}
                                            ${isDone ? 'text-emerald-600 dark:text-emerald-400' : ''}
                                            ${isUpcoming ? 'text-blue-600 dark:text-blue-400 group-hover:text-blue-700 dark:group-hover:text-blue-300' : ''}
                                            ${isLocked ? 'text-slate-400 dark:text-slate-600' : ''}
                                        `} style={{ maxWidth: '88px' }}>
                                            {shortLabel}
                                        </span>
                                    </button>

                                    {/* Connector line */}
                                    {index < SHIPMENT_STEP_FLOW.length - 1 && (
                                        <div
                                            className={`flex-1 transition-all duration-500 mt-[21px] mx-1 rounded-full ${connectorDone ? 'bg-emerald-400 dark:bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}
                                            style={{ height: '3px', minWidth: '8px' }}
                                        />
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </div>

                    {/* Divider */}
                    <div className="self-stretch w-px bg-slate-200 dark:bg-slate-700/70 mx-4 flex-shrink-0" />

                    {/* Step 6: Creation – Direct Access */}
                    <button
                        onClick={() => setActiveTab('Creation')}
                        className="flex flex-col items-center gap-2 flex-shrink-0 cursor-pointer group px-1.5"
                        style={{ minWidth: '80px' }}
                    >
                        <div className={`
                            relative w-11 h-11 rounded-full flex items-center justify-center font-black text-base border-2 transition-all duration-300
                            ${activeTab === 'Creation'
                                ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/40 scale-110 ring-4 ring-blue-500/20 dark:ring-blue-500/30'
                                : 'bg-blue-50 dark:bg-blue-500/10 border-blue-300 dark:border-blue-500/50 text-blue-700 dark:text-blue-400 group-hover:bg-blue-100 dark:group-hover:bg-blue-500/20 group-hover:border-blue-400 dark:group-hover:border-blue-400 group-hover:shadow-md group-hover:shadow-blue-500/10'}
                        `}>
                            <span>6</span>
                            {activeTab === 'Creation' && <span className="absolute inset-0 rounded-full animate-ping bg-blue-400/25 pointer-events-none" />}
                        </div>
                        <div className="flex flex-col items-center gap-0.5">
                            <span className={`text-[11px] font-bold text-center leading-tight transition-colors
                                ${activeTab === 'Creation' ? 'text-blue-600 dark:text-blue-400' : 'text-blue-600 dark:text-blue-400 group-hover:text-blue-700 dark:group-hover:text-blue-300'}
                            `}>
                                Creation
                            </span>
                            <span className="text-[9px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Direct</span>
                        </div>
                    </button>
                </div>

                {/* Footer bar: progress dots + current step label */}
                <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700/40 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-500 uppercase tracking-wider">Current:</span>
                        <span className="text-xs font-bold text-slate-800 dark:text-white">{activeTab}</span>
                        {SHIPMENT_STEP_FLOW.indexOf(activeTab) !== -1 && (
                            <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded px-1.5 py-0.5">
                                {SHIPMENT_STEP_FLOW.indexOf(activeTab) + 1} / {SHIPMENT_STEP_FLOW.length}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5">
                        {SHIPMENT_STEP_FLOW.map((step) => (
                            <div key={step} className={`rounded-full transition-all duration-300 ${
                                activeTab === step ? 'w-4 h-2 bg-blue-500' :
                                isStepDone(step) ? 'w-2 h-2 bg-emerald-500' : 'w-2 h-2 bg-slate-300 dark:bg-slate-700'
                            }`} />
                        ))}
                        <div className={`rounded-full transition-all duration-300 ml-0.5 ${
                            activeTab === 'Creation' ? 'w-4 h-2 bg-blue-500' : 'w-2 h-2 bg-slate-300 dark:bg-slate-700'
                        }`} />
                    </div>
                    {validationRows.length > 0 && activeTab !== 'Setup' && (
                        <button
                            onClick={handleStartNew}
                            className="text-sm font-bold text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 border border-slate-300 dark:border-slate-600 hover:border-red-400 dark:hover:border-red-500 rounded-lg px-3 py-1.5 transition-colors"
                        >
                            Start New
                        </button>
                    )}
                </div>
            </div>

            {/* Generic loading overlay for non-matching, non-allocation operations */}
            {(reviewLoading || isCreatingShipment || isUploadingDocs) && (
                <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center">
                    <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-2xl flex flex-col items-center gap-4">
                        <ArrowPathIcon className="w-10 h-10 animate-spin text-blue-500" />
                        <p className="text-white font-bold">
                            {isUploadingDocs ? 'Uploading Documents to Drive...' : isCreatingShipment ? 'Creating Shipment...' : 'Loading Review Data...'}
                        </p>
                    </div>
                </div>
            )}

            {/* ── FIFO Allocation Engine Overlay ── */}
            {allocationPhase !== 'idle' && (() => {
                // Each message holds for ~16 ticks (90ms/tick ≈ 1440ms), crossfading
                // in/out over the first/last 2 ticks (~180ms) of that window.
                const TICKS_PER_MSG = 16;
                const FADE_TICKS = 2;
                const msgCycle = allocationTick % TICKS_PER_MSG;
                const msgIndex = Math.floor(allocationTick / TICKS_PER_MSG) % ALLOCATION_LOADER_MESSAGES.length;
                const textVisible = msgCycle >= FADE_TICKS && msgCycle < TICKS_PER_MSG - FADE_TICKS;

                return (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/90 backdrop-blur-sm">
                        <div className="w-full max-w-2xl mx-4">
                            {allocationPhase === 'running' ? (
                                <div className="bg-slate-900 border border-slate-700 rounded-2xl p-10 shadow-2xl flex flex-col items-center gap-6 text-center">
                                    <div className="relative w-16 h-16 flex items-center justify-center">
                                        <div className="absolute inset-0 rounded-full bg-blue-500/20 animate-ping" />
                                        <div className="relative w-14 h-14 rounded-full bg-blue-500/10 border border-blue-500/40 flex items-center justify-center">
                                            <BoxIcon className="w-7 h-7 text-blue-400 animate-bounce" />
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-3">FIFO Allocation Engine</p>
                                        <p className={`text-base font-semibold text-white transition-opacity duration-200 ease-in-out ${textVisible ? 'opacity-100' : 'opacity-0'}`}>
                                            {ALLOCATION_LOADER_MESSAGES[msgIndex]}
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-8 shadow-2xl space-y-6 text-center animate-in fade-in duration-300">
                                    <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center mx-auto">
                                        <span className="text-2xl">✓</span>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-1">Allocation Complete</p>
                                        <h2 className="text-xl font-black text-white">Quantities allocated to open POs</h2>
                                    </div>
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="bg-slate-800 rounded-xl p-3">
                                            <p className="text-2xl font-black text-blue-400">{allocationSummary?.total_skus ?? '—'}</p>
                                            <p className="text-[9px] text-slate-400 uppercase font-bold mt-1">SKUs</p>
                                        </div>
                                        <div className="bg-slate-800 rounded-xl p-3">
                                            <p className="text-2xl font-black text-emerald-400">{fmtNumber(toNum(allocationSummary?.total_allocated), 0)}</p>
                                            <p className="text-[9px] text-slate-400 uppercase font-bold mt-1">Units Allocated</p>
                                        </div>
                                        <div className="bg-slate-800 rounded-xl p-3">
                                            <p className="text-2xl font-black text-amber-400">{allocationSummary?.pos_involved?.length ?? 0}</p>
                                            <p className="text-[9px] text-slate-400 uppercase font-bold mt-1">POs Touched</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })()}

            {/* ── Matching Engine Deterministic Progress Tracker ── */}
            {matchingPhase !== 'idle' && (() => {
                const matchRows: any[] = parsedPreview?.rows || [];
                const totalItems = matchRows.length;

                // ── Stage constants ──
                const INIT_STAGES = [
                    'Preparing matching engine...',
                    'Loading master product database...',
                    'Reading uploaded shipment...',
                    'Building lookup indexes...',
                ];
                const FINAL_STAGES = [
                    'Saving validation results...',
                    'Preparing review screen...',
                    'Finalizing matching...',
                    'Done.',
                ];
                const TICKS_PER_INIT  = 6;
                const TICKS_PER_SUBSTAGE = 2;
                const SUBSTAGES_PER_ITEM = 5;
                const TICKS_PER_ITEM = TICKS_PER_SUBSTAGE * SUBSTAGES_PER_ITEM; // 10
                const TICKS_PER_FINAL = 4;
                const initTotal  = INIT_STAGES.length * TICKS_PER_INIT;          // 24
                const itemTotal  = totalItems * TICKS_PER_ITEM;
                const finalTotal = FINAL_STAGES.length * TICKS_PER_FINAL;        // 16

                // ── Compute current state from tick ──
                let statusLine = '';
                let contextLine = '';
                let currentItemIdx = -1;
                let progressPct = 0;
                let enginePhase: 'init' | 'items' | 'final' = 'init';

                if (matchingPhase === 'running') {
                    if (matchingTick < initTotal) {
                        enginePhase = 'init';
                        const s = Math.min(Math.floor(matchingTick / TICKS_PER_INIT), INIT_STAGES.length - 1);
                        statusLine = INIT_STAGES[s];
                        progressPct = 0;
                    } else if (totalItems > 0 && matchingTick < initTotal + itemTotal) {
                        enginePhase = 'items';
                        const t = matchingTick - initTotal;
                        const itemIdx = Math.min(Math.floor(t / TICKS_PER_ITEM), totalItems - 1);
                        const subStage = Math.floor((t % TICKS_PER_ITEM) / TICKS_PER_SUBSTAGE);
                        currentItemIdx = itemIdx;
                        progressPct = Math.round((itemIdx / totalItems) * 90);
                        const row = matchRows[itemIdx];
                        const idType = row?.factory_code ? 'Article Number'
                            : row?.ean ? 'EAN'
                            : 'Factory Code';
                        const subMsgs = [
                            `Working on Item ${itemIdx + 1}...`,
                            `Matching ${idType}...`,
                            'Checking MY ID...',
                            'Verifying product name...',
                            'Checking product price...',
                        ];
                        statusLine = subMsgs[Math.min(subStage, subMsgs.length - 1)];
                        contextLine = row?.item_name || '';
                    } else {
                        enginePhase = 'final';
                        const t = Math.max(0, matchingTick - initTotal - itemTotal);
                        const s = Math.min(Math.floor(t / TICKS_PER_FINAL), FINAL_STAGES.length - 1);
                        statusLine = FINAL_STAGES[s];
                        progressPct = 90 + Math.round((s / FINAL_STAGES.length) * 10);
                        currentItemIdx = totalItems - 1;
                    }
                }

                const doneCount = currentItemIdx + 1;

                return (
                    <div className="fixed inset-0 z-[200] bg-slate-950/98 backdrop-blur-md flex items-center justify-center">
                        <div className="w-full max-w-md mx-6">

                            {/* ── RUNNING phase ── */}
                            {matchingPhase === 'running' && (
                                <div className="space-y-1">
                                    {/* Phase breadcrumb */}
                                    <div className="flex items-center justify-center gap-3 mb-6">
                                        {(['Initializing', 'Processing Items', 'Finalizing'] as const).map((label, i) => {
                                            const active = (i === 0 && enginePhase === 'init') || (i === 1 && enginePhase === 'items') || (i === 2 && enginePhase === 'final');
                                            const done   = (i === 0 && enginePhase !== 'init') || (i === 1 && enginePhase === 'final');
                                            return (
                                                <React.Fragment key={label}>
                                                    <span className={`text-[10px] font-bold transition-colors duration-300 ${done ? 'text-emerald-500' : active ? 'text-blue-400' : 'text-slate-700'}`}>
                                                        {done ? '✓ ' : ''}{label}
                                                    </span>
                                                    {i < 2 && <span className="text-slate-700 text-[10px]">›</span>}
                                                </React.Fragment>
                                            );
                                        })}
                                    </div>

                                    {/* Main status card */}
                                    <div className="bg-slate-900 border border-slate-800 rounded-2xl px-8 py-8 text-center space-y-6">
                                        {/* Spinner + title */}
                                        <div className="flex flex-col items-center gap-3">
                                            <div className="relative w-10 h-10">
                                                <div className="absolute inset-0 rounded-full border-2 border-slate-800" />
                                                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 animate-spin" />
                                                <div className="absolute inset-[5px] rounded-full border border-blue-500/20 border-t-blue-400/60 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '0.8s' }} />
                                            </div>
                                            <p className="text-white font-bold text-base tracking-tight">Matching Engine Running</p>
                                        </div>

                                        {/* Progress bar */}
                                        <div className="space-y-2">
                                            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-gradient-to-r from-blue-700 via-blue-500 to-blue-400 rounded-full transition-all duration-500"
                                                    style={{ width: `${Math.max(2, progressPct)}%` }}
                                                />
                                            </div>
                                            <div className="flex justify-between text-[10px] text-slate-600 tabular-nums">
                                                <span>{progressPct}%</span>
                                                {totalItems > 0 && enginePhase === 'items' && (
                                                    <span>Processing {Math.max(1, doneCount)} of {totalItems} Items</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Divider */}
                                        <div className="border-t border-slate-800" />

                                        {/* Current status message */}
                                        <div className="space-y-1.5 min-h-[48px]">
                                            <p className="text-slate-200 text-sm font-semibold transition-all duration-200">{statusLine}</p>
                                            {contextLine && (
                                                <p className="text-blue-400 text-xs font-mono truncate opacity-80">"{contextLine}"</p>
                                            )}
                                        </div>

                                        {/* Current item detail — shown during item processing */}
                                        {enginePhase === 'items' && currentItemIdx >= 0 && (() => {
                                            const row = matchRows[currentItemIdx];
                                            if (!row) return null;
                                            const code = [row.factory_code, row.ean].filter(Boolean).join(' / ') || '—';
                                            return (
                                                <div className="bg-slate-950/60 rounded-xl px-4 py-3 text-left space-y-2 border border-slate-800">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Item {currentItemIdx + 1}</span>
                                                        <span className="text-[9px] font-mono text-blue-500">{code}</span>
                                                    </div>
                                                    <p className="text-slate-300 text-[11px] font-medium leading-snug truncate">{row.item_name || '—'}</p>
                                                    <div className="flex gap-4 text-[9px] text-slate-600 tabular-nums">
                                                        <span>QTY {row.invoice_qty || '?'}</span>
                                                        <span>¥{Number(row.unit_price || 0).toFixed(2)}</span>
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {/* Pulse dots */}
                                        <div className="flex items-center justify-center gap-1.5">
                                            {[0, 1, 2, 3, 4].map(i => (
                                                <div
                                                    key={i}
                                                    className={`w-1 h-1 rounded-full transition-all duration-200 ${
                                                        (matchingTick % 5) === i ? 'bg-blue-400 scale-150' : 'bg-slate-700'
                                                    }`}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ── COMPLETE phase ── */}
                            {matchingPhase === 'complete' && matchingResultSummary && (
                                <div className="bg-slate-900 border border-emerald-500/20 rounded-2xl px-8 py-10 text-center space-y-6 animate-in fade-in duration-300">
                                    <div className="flex flex-col items-center gap-2">
                                        <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-2xl">✅</div>
                                        <p className="text-white font-bold text-lg">Matching Complete</p>
                                        <p className="text-slate-400 text-sm">{matchingResultSummary.total} Items Processed</p>
                                    </div>

                                    <div className="border-t border-slate-800" />

                                    <div className="grid grid-cols-2 gap-3 text-left">
                                        {[
                                            { label: 'Matched',        value: matchingResultSummary.matched,       color: 'text-emerald-400' },
                                            { label: 'Partial Match',  value: matchingResultSummary.partial,       color: 'text-yellow-400' },
                                            { label: 'Multiple Match', value: matchingResultSummary.multipleMatch + matchingResultSummary.multipleVariant, color: 'text-blue-400' },
                                            { label: 'Unmatched',      value: matchingResultSummary.unmatched,     color: 'text-red-400' },
                                        ].filter(s => s.value > 0).map(s => (
                                            <div key={s.label} className="bg-slate-950/60 rounded-xl px-4 py-3 border border-slate-800">
                                                <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
                                                <p className="text-[10px] text-slate-500 mt-0.5">{s.label}</p>
                                            </div>
                                        ))}
                                    </div>

                                    <p className="text-slate-500 text-xs animate-pulse">Loading results...</p>
                                </div>
                            )}

                            {/* ── ERROR phase ── */}
                            {matchingPhase === 'error' && (
                                <div className="bg-slate-900 border border-red-500/20 rounded-2xl px-8 py-10 text-center space-y-5 animate-in fade-in duration-300">
                                    <div className="flex flex-col items-center gap-2">
                                        <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center text-2xl">❌</div>
                                        <p className="text-white font-bold text-lg">Matching Failed</p>
                                    </div>
                                    {backendError && (
                                        <p className="text-slate-400 text-sm leading-relaxed">{backendError}</p>
                                    )}
                                    <button
                                        onClick={() => { setMatchingPhase('idle'); setBackendError(null); }}
                                        className="px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-sm font-semibold transition-colors"
                                    >
                                        Try Again
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })()}

            {activeTab === 'Setup' && (
                <Card className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 animate-in fade-in duration-300 divide-y divide-slate-200 dark:divide-slate-700 overflow-hidden">
                    {/* ── Row 1: VENDOR / DATE / MODE ── */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-6">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Vendor *</label>
                            <VendorSearchSelect
                                value={vendorCode}
                                onChange={setVendorCode}
                                vendors={vendorMasters}
                                placeholder="Choose Vendor"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Shipment Date *</label>
                            <input type="date" value={shipmentDate} onChange={(e) => setShipmentDate(e.target.value)} className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">Shipping Mode *</label>
                            {(validationRows.length > 0 || allocationData.length > 0) ? (
                                <div className="w-full flex items-center justify-between bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3">
                                    <div className="flex items-center gap-2">
                                        <LockClosedIcon className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                                            {shippingMode === 'SEA' ? 'Sea Freight' : shippingMode === 'AIR' ? 'Air Freight' : '—'}
                                        </span>
                                    </div>
                                    <button onClick={clearSelection} className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline">Change</button>
                                </div>
                            ) : (
                                <select
                                    value={shippingMode}
                                    onChange={(e) => setShippingMode(e.target.value as 'SEA' | 'AIR')}
                                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                                >
                                    <option value="">Select mode...</option>
                                    <option value="SEA">Sea Freight</option>
                                    <option value="AIR">Air Freight</option>
                                </select>
                            )}
                        </div>
                    </div>

                    {/* ── Row 2: Upload Packing List ── */}
                    <div className="p-6 space-y-4">
                        <div>
                            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Upload Packing List *</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Upload packing list to auto-extract items</p>
                        </div>

                        {/* Drop zone */}
                        <div
                            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileSelect(e.dataTransfer.files); }}
                            onClick={() => fileInputRef.current?.click()}
                            className={`border-2 border-dashed rounded-xl py-8 text-center cursor-pointer transition-all ${isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-slate-300 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-500/5'}`}
                        >
                            <input type="file" ref={fileInputRef} className="hidden" accept=".csv,.xlsx" multiple onChange={(e) => handleFileSelect(e.target.files)} />
                            <CloudArrowUpIcon className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto mb-2" />
                            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Drag & drop your file here</p>
                            <p className="text-sm text-slate-400 dark:text-slate-500 mt-0.5">or <span className="text-blue-600 dark:text-blue-400 font-semibold">Browse Files</span></p>
                        </div>

                        {/* Uploaded file rows */}
                        {uploadedFiles.length > 0 && (
                            <div className="space-y-2">
                                {uploadedFiles.map(f => (
                                    <div key={f.id} className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg px-4 py-3">
                                        <DocumentTextIcon className="w-5 h-5 text-emerald-500 shrink-0" />
                                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate flex-1 min-w-0">{f.file?.name || 'Unknown File'}</span>
                                        {!f.file?.lastModified && (
                                            <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 border border-amber-400/40 bg-amber-50 dark:bg-amber-500/10 rounded px-1.5 py-0.5 shrink-0">RE-UPLOAD NEEDED</span>
                                        )}
                                        <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded px-2 py-0.5 shrink-0">UPLOADED</span>
                                        <div className="flex items-center gap-3 shrink-0 ml-2">
                                            {isParsing ? (
                                                <span className="text-[10px] text-slate-400 dark:text-slate-500 animate-pulse">Parsing…</span>
                                            ) : parsedPreview ? (
                                                <button
                                                    onClick={() => setShowAllPreview(v => !v)}
                                                    className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                                                >
                                                    <EyeIcon className="w-4 h-4" /> Preview
                                                </button>
                                            ) : null}
                                            <button onClick={() => { setUploadedFiles(prev => prev.filter(x => x.id !== f.id)); setParsedPreview(null); setShowAllPreview(false); }}>
                                                <TrashIcon className="w-4 h-4 text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 transition-colors" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Vendor doc type info box */}
                        <div className="rounded-xl border border-blue-100 dark:border-blue-500/20 bg-blue-50 dark:bg-blue-500/5 px-4 py-3">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-start gap-2 flex-1 min-w-0">
                                    <InformationCircleIcon className="w-4 h-4 text-blue-500 dark:text-blue-400 mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-[11px] font-semibold text-blue-700 dark:text-blue-300 mb-2">We support these document types (auto-applied)</p>
                                        <div className="flex flex-wrap gap-x-8 gap-y-1">
                                            {Object.entries(VENDOR_DOC_CONFIG).map(([prefix, cfg]) => (
                                                <div key={prefix} className="flex items-center gap-1.5">
                                                    <span className="text-[10px] font-black text-blue-700 dark:text-blue-300">{prefix}</span>
                                                    <span className="text-[10px] text-slate-400 dark:text-slate-500">→</span>
                                                    <span className="text-[10px] font-semibold text-slate-700 dark:text-slate-300">{cfg.label}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <button className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0 flex items-center gap-1">
                                    Learn more <InformationCircleIcon className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* ── Row 3: Extracted Items Preview ── */}
                    {(isParsing || parsedPreview) && (
                        <div className="p-6 space-y-4">
                            <div className="flex items-center gap-3">
                                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Extracted Items (Preview)</h3>
                                {parsedPreview && (
                                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30">
                                        {parsedPreview.rows.length} items found
                                    </span>
                                )}
                                {isParsing && <span className="text-xs text-slate-400 dark:text-slate-500 animate-pulse">Extracting items…</span>}
                            </div>

                            {parsedPreview && parsedPreview.rows.length > 0 && (() => {
                                const displayRows = showAllPreview ? parsedPreview.rows : parsedPreview.rows.slice(0, 3);
                                return (
                                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-xs">
                                                <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
                                                    <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                                        <th className="px-4 py-2.5 text-left w-10">#</th>
                                                        <th className="px-4 py-2.5 text-left">CODE / EAN</th>
                                                        <th className="px-4 py-2.5 text-left">Item Name</th>
                                                        <th className="px-4 py-2.5 text-right">QTY</th>
                                                        <th className="px-4 py-2.5 text-right">Unit Price</th>
                                                        <th className="px-4 py-2.5 text-right">Total</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 bg-white dark:bg-slate-800/30">
                                                    {displayRows.map((row: any, i: number) => {
                                                        const qty = Number(row.invoice_qty) || 0;
                                                        const price = Number(row.unit_price) || 0;
                                                        const code = row.factory_code || row.ean || '—';
                                                        return (
                                                            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/20">
                                                                <td className="px-4 py-2.5 text-slate-400 dark:text-slate-500 font-mono">{i + 1}</td>
                                                                <td className="px-4 py-2.5 font-mono text-blue-600 dark:text-blue-400 font-semibold">{code}</td>
                                                                <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200 font-medium">{row.item_name || '—'}</td>
                                                                <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-200">{qty || '—'}</td>
                                                                <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-200">{price ? `¥${price.toFixed(2)}` : '—'}</td>
                                                                <td className="px-4 py-2.5 text-right font-semibold text-slate-800 dark:text-slate-100">{qty && price ? `¥${(qty * price).toFixed(2)}` : '—'}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
                                            <span className="text-[11px] text-slate-400 dark:text-slate-500">
                                                Showing 1 to {displayRows.length} of {parsedPreview.rows.length} items
                                            </span>
                                            {!showAllPreview && parsedPreview.rows.length > 3 && (
                                                <button
                                                    onClick={() => setShowAllPreview(true)}
                                                    className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                                                >
                                                    <EyeIcon className="w-3.5 h-3.5" /> Preview All Items
                                                </button>
                                            )}
                                            {showAllPreview && (
                                                <button
                                                    onClick={() => setShowAllPreview(false)}
                                                    className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                                                >
                                                    Show less
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    )}

                    {/* ── Row 4: Manual Entry ── */}
                    <div className="p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Manual Entry <span className="font-normal text-slate-500 dark:text-slate-400">(Optional)</span></p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Add items manually when no document is available</p>
                            </div>
                            <button
                                onClick={() => setManualEntryDraft(prev => [...prev, {
                                    id: `ME-${Math.random().toString(36).substr(2, 9)}`,
                                    factory_code: '',
                                    ean: '',
                                    item_name: '',
                                    invoice_qty: '',
                                    unit_price: '',
                                    carton_count: '',
                                }])}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                            >
                                <PlusIcon className="w-3.5 h-3.5" /> Add Row
                            </button>
                        </div>

                        {manualEntryDraft.length > 0 && (
                            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-[11px]">
                                        <thead>
                                            <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                                                {['Factory Code', 'EAN', 'Item Name', 'Qty', 'Unit Price (¥)', 'Cartons', ''].map(h => (
                                                    <th key={h} className="px-3 py-2 text-left font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                                            {manualEntryDraft.map((row) => (
                                                <tr key={row.id} className="bg-white dark:bg-slate-800/30 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                                                    {(['factory_code', 'ean', 'item_name'] as const).map(field => (
                                                        <td key={field} className="px-2 py-1.5">
                                                            <input
                                                                type="text"
                                                                value={row[field]}
                                                                onChange={e => setManualEntryDraft(prev => prev.map(r => r.id === row.id ? { ...r, [field]: e.target.value } : r))}
                                                                placeholder={field === 'factory_code' ? 'e.g. FC-001' : field === 'ean' ? '13 digits' : 'Item name'}
                                                                className="w-full bg-transparent border-b border-slate-200 dark:border-slate-600 focus:border-blue-500 dark:focus:border-blue-400 outline-none py-0.5 text-slate-800 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 min-w-[80px]"
                                                            />
                                                        </td>
                                                    ))}
                                                    {(['invoice_qty', 'unit_price', 'carton_count'] as const).map(field => (
                                                        <td key={field} className="px-2 py-1.5">
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                value={row[field]}
                                                                onChange={e => setManualEntryDraft(prev => prev.map(r => r.id === row.id ? { ...r, [field]: e.target.value === '' ? '' : Number(e.target.value) } : r))}
                                                                placeholder="0"
                                                                className="w-full bg-transparent border-b border-slate-200 dark:border-slate-600 focus:border-blue-500 dark:focus:border-blue-400 outline-none py-0.5 text-slate-800 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 min-w-[56px]"
                                                            />
                                                        </td>
                                                    ))}
                                                    <td className="px-2 py-1.5">
                                                        <button onClick={() => setManualEntryDraft(prev => prev.filter(r => r.id !== row.id))}>
                                                            <TrashIcon className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Row 5: Actions ── */}
                    <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between gap-4">
                        <button
                            onClick={handleSkipToManualEntry}
                            disabled={!vendorCode || !shippingMode}
                            className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            Skip upload — add items manually
                        </button>
                        <Button
                            onClick={handleUploadAndValidate}
                            disabled={!vendorCode || !shippingMode || (uploadedFiles.length === 0 && manualEntryDraft.length === 0) || matchingPhase !== 'idle'}
                        >
                            Save & Continue to Validate Items →
                        </Button>
                    </div>
                </Card>
            )}

            {/* ── Price & EAN Analysis Engine Overlay ── */}
            {priceEanPhase !== 'idle' && (() => {
                const STAGES = [
                    { label: 'Scanning price variances', detail: 'Comparing invoice ¥ vs master cost', ticks: 10 },
                    { label: 'Checking EAN codes', detail: 'Detecting EAN mismatches & gaps', ticks: 10 },
                    { label: 'Flagging ID updates', detail: 'Identifying SKU master updates needed', ticks: 10 },
                ];
                const TOTAL_TICKS = STAGES.reduce((s, st) => s + st.ticks, 0);

                let stageIdx = 0;
                let ticksConsumed = 0;
                for (let i = 0; i < STAGES.length; i++) {
                    if (priceEanTick < ticksConsumed + STAGES[i].ticks) { stageIdx = i; break; }
                    ticksConsumed += STAGES[i].ticks;
                    stageIdx = i;
                }
                const stageProgress = Math.min(1, (priceEanTick - ticksConsumed) / (STAGES[stageIdx]?.ticks || 1));
                const overallPct = priceEanPhase === 'complete' ? 100
                    : Math.min(99, Math.round((priceEanTick / TOTAL_TICKS) * 100));

                const acceptedRows = validationRows.filter(isRowAccepted);
                const priceVarianceCount = acceptedRows.filter(r => {
                    const { diff } = calculatePriceDiff(toNum(r.unit_price), toNum(r.master_cost || 0));
                    return diff > 0.01;
                }).length;
                const eanIssueCount = acceptedRows.filter(isEanMismatch).length;
                const idUpdateCount = acceptedRows.filter(r => r.resolution_update_id).length;

                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-sm">
                        <div className="w-full max-w-lg mx-4">
                            {priceEanPhase === 'running' ? (
                                <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 shadow-2xl space-y-6">
                                    <div className="text-center space-y-1">
                                        <p className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">Price & EAN Analysis</p>
                                        <h2 className="text-xl font-black text-white">Analysing invoice data...</h2>
                                        <p className="text-sm text-slate-400">{STAGES[stageIdx]?.detail}</p>
                                    </div>

                                    {/* Overall bar */}
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase">
                                            <span>Progress</span><span>{overallPct}%</span>
                                        </div>
                                        <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-purple-500 transition-all duration-75"
                                                style={{ width: `${overallPct}%` }}
                                            />
                                        </div>
                                    </div>

                                    {/* Stage list */}
                                    <div className="space-y-3">
                                        {STAGES.map((stage, i) => {
                                            const isDone = i < stageIdx || (i === stageIdx && stageProgress >= 1);
                                            const isActive = i === stageIdx && stageProgress < 1;
                                            return (
                                                <div key={stage.label} className="flex items-center gap-3">
                                                    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-black border transition-all ${
                                                        isDone ? 'bg-emerald-500 border-emerald-400 text-white'
                                                        : isActive ? 'bg-purple-500 border-purple-400 text-white animate-pulse'
                                                        : 'bg-slate-800 border-slate-600 text-slate-500'
                                                    }`}>
                                                        {isDone ? '✓' : i + 1}
                                                    </div>
                                                    <div className="flex-1">
                                                        <p className={`text-xs font-bold ${isDone ? 'text-emerald-400' : isActive ? 'text-white' : 'text-slate-500'}`}>
                                                            {stage.label}
                                                        </p>
                                                        {isActive && (
                                                            <div className="mt-1 h-1 rounded-full bg-slate-800 overflow-hidden">
                                                                <div
                                                                    className="h-full rounded-full bg-purple-400 transition-all duration-75"
                                                                    style={{ width: `${Math.round(stageProgress * 100)}%` }}
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : (
                                /* Complete card */
                                <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-8 shadow-2xl space-y-6 text-center animate-in fade-in duration-300">
                                    <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center mx-auto">
                                        <span className="text-2xl">✓</span>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-1">Analysis Complete</p>
                                        <h2 className="text-xl font-black text-white">Ready for ID / Price / EAN Review</h2>
                                    </div>
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="bg-slate-800 rounded-xl p-3">
                                            <p className="text-2xl font-black text-red-400">{priceVarianceCount}</p>
                                            <p className="text-[9px] text-slate-400 uppercase font-bold mt-1">Price Variances</p>
                                        </div>
                                        <div className="bg-slate-800 rounded-xl p-3">
                                            <p className="text-2xl font-black text-amber-400">{eanIssueCount}</p>
                                            <p className="text-[9px] text-slate-400 uppercase font-bold mt-1">EAN Issues</p>
                                        </div>
                                        <div className="bg-slate-800 rounded-xl p-3">
                                            <p className="text-2xl font-black text-blue-400">{idUpdateCount}</p>
                                            <p className="text-[9px] text-slate-400 uppercase font-bold mt-1">ID Updates</p>
                                        </div>
                                    </div>
                                    <p className="text-xs text-slate-500">Navigating to review tab...</p>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })()}

            {activeTab === 'Validate Items' && (
                <div className="flex flex-col space-y-4 animate-in fade-in duration-300 pb-24">
                    {/* Error Banner */}
                    {backendError && (
                        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-3">
                            <ExclamationTriangleIcon className="w-5 h-5 mt-0.5 text-red-500" />
                            <div>
                                <h4 className="font-bold text-red-500">Mapping Incomplete</h4>
                                <p className="text-sm text-slate-600 dark:text-slate-300">{backendError}</p>
                            </div>
                        </div>
                    )}

                    {!backendError && validationRows.length > 0 && (
                        <>
                            {/* Detection Info & Meta Notice */}
                            <div className="flex flex-col gap-2">
                                {detectionInfo && (
                                    <div className="bg-slate-100 dark:bg-slate-700 rounded p-2 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
                                        <InformationCircleIcon className="w-4 h-4 text-blue-400" />
                                        <span>
                                            Detected: Header row {detectionInfo.headerRow + 1} · 
                                            Data from row {detectionInfo.dataStartRow + 1} · 
                                            {validationRows.length} rows · 
                                            {detectionInfo.isBifurcated ? `Bifurcated pricing (${detectionInfo.columnsFound.filter((c: string) => c.startsWith('unit_price_')).map((c: string) => c.replace('unit_price_', '')).join('+')})` : 'Standard pricing'}
                                        </span>
                                    </div>
                                )}
                                {invoiceMetaNotice && (
                                    <div className="bg-blue-500/10 border border-blue-500/20 rounded p-2 text-xs text-blue-300 flex items-center gap-2">
                                        <CheckIcon className="w-4 h-4 text-emerald-400" />
                                        <span>
                                            Invoice No auto-filled: {invoiceMetaNotice.no || 'N/A'} · 
                                            Date: {invoiceMetaNotice.date || 'N/A'} (you can override)
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Summary Stats Bar */}
                            <div className="flex items-center gap-6 bg-slate-100/80 dark:bg-slate-800/40 px-6 py-3 rounded-xl border border-slate-200 dark:border-slate-700">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Summary:</span>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-emerald-500 dark:text-emerald-400">
                                        {summaryStats.matched} MATCHED
                                    </span>
                                </div>
                                <div className="text-slate-300 dark:text-slate-600">|</div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-red-500 dark:text-red-400">
                                        {summaryStats.unmatched} UNMATCHED
                                    </span>
                                </div>
                                <div className="text-slate-300 dark:text-slate-600">|</div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-yellow-500 dark:text-yellow-400">
                                        {summaryStats.flagged} FLAGGED
                                    </span>
                                </div>
                            </div>

                            {/* Filter Bar & Summary */}
                            <div className="flex flex-wrap justify-between items-end gap-4 bg-slate-100/80 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                                <div className="space-y-3">
                                    <div className="flex gap-2 flex-wrap">
                                        {(() => {
                                            const looksGoodCount = validationRows.filter(r => isLooksGood(r)).length;
                                            const needsInputCount = validationRows.filter(r => !isLooksGood(r)).length;
                                            return [
                                                { label: 'All', value: 'ALL', count: summaryStats.total, activeClass: 'bg-slate-700 border-slate-500 text-white' },
                                                { label: 'Looks Good', value: 'LOOKS_GOOD', count: looksGoodCount, activeClass: 'bg-emerald-600 border-emerald-500 text-white' },
                                                { label: 'Needs Your Input', value: 'NEEDS_INPUT', count: needsInputCount, activeClass: 'bg-amber-500 border-amber-400 text-white' },
                                            ].map(f => (
                                                <button
                                                    key={f.value}
                                                    onClick={() => setStatusFilter(f.value as any)}
                                                    className={`px-3 py-1.5 rounded-full text-[10px] font-bold border transition-all ${statusFilter === f.value ? f.activeClass : 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500'}`}
                                                >
                                                    {f.label} ({f.count})
                                                </button>
                                            ));
                                        })()}
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <Button variant="secondary" className="h-9 text-xs" onClick={() => {}}>Export Results</Button>
                                    <Button variant="secondary" className="h-9 text-xs border-blue-500/30 text-blue-400 hover:bg-blue-500/10" onClick={handleAddManualLine}>
                                        <PlusIcon className="w-4 h-4 mr-1" /> Add Line
                                    </Button>
                                    <Button className="h-9 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={handleApproveAll}>Approve All Matches</Button>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Table */}
                    <Card className="p-0 border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/20 shadow-xl overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse table-fixed min-w-[1100px]">
                                <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700">
                                    <tr className="text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider font-bold">
                                        <th className="px-2 py-3 w-8">
                                            <input
                                                type="checkbox"
                                                aria-label="Select all rows"
                                                checked={filteredRows.length > 0 && filteredRows.every(r => selectedRowIds.has(r.line_id))}
                                                ref={el => { if (el) el.indeterminate = filteredRows.some(r => selectedRowIds.has(r.line_id)) && !filteredRows.every(r => selectedRowIds.has(r.line_id)); }}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setSelectedRowIds(new Set(filteredRows.map(r => r.line_id)));
                                                    } else {
                                                        setSelectedRowIds(new Set());
                                                    }
                                                }}
                                                className="w-3.5 h-3.5 rounded border-slate-400 dark:border-slate-600 accent-blue-500 cursor-pointer"
                                            />
                                        </th>
                                        <th className="px-2 py-3 w-[11%]">CODES</th>
                                        <th className="px-2 py-3 w-[12%]">SKU</th>
                                        <th className="px-2 py-3 w-[19%]">INVOICE ITEM</th>
                                        <th className="px-2 py-3 w-[20%]">MATCHED NAME</th>
                                        <th className="px-2 py-3 w-[14%]">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400">Resolution</span>
                                                <button
                                                    onClick={() => {
                                                        const allAccepted = filteredRows.every(r => r.resolution_action === 'ACCEPT');
                                                        setValidationRows(prev => prev.map(r =>
                                                            filteredRows.find(fr => fr.line_id === r.line_id)
                                                                ? { ...r, resolution_action: allAccepted ? '' : 'ACCEPT' }
                                                                : r
                                                        ));
                                                    }}
                                                    className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 hover:bg-emerald-600/40 transition-all"
                                                >
                                                    ✓ All
                                                </button>
                                            </div>
                                        </th>
                                        <th className="px-2 py-3 w-[15%]">STATUS / NOTES</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                                    {filteredRows.map((row) => {
                                        const status = getStatusConfig(row.match_status);
                                        const factoryCodes = (row.factory_code || "").split('|').filter(c => c.trim());

                                        return (
                                            <tr key={row.line_id} className={`hover:bg-slate-100 dark:hover:bg-slate-700/20 transition-colors ${selectedRowIds.has(row.line_id) ? 'bg-blue-50 dark:bg-blue-500/10' : row.match_status === 'UNMATCHED' ? 'bg-red-500/5' : row.match_status === 'MANUAL_ENTRY' ? 'bg-blue-500/5' : ''}`}>
                                                <td className="px-2 py-3 w-8">
                                                    <input
                                                        type="checkbox"
                                                        aria-label={`Select row ${row.line_id}`}
                                                        checked={selectedRowIds.has(row.line_id)}
                                                        onChange={(e) => {
                                                            const next = new Set(selectedRowIds);
                                                            if (e.target.checked) next.add(row.line_id);
                                                            else next.delete(row.line_id);
                                                            setSelectedRowIds(next);
                                                        }}
                                                        className="w-3.5 h-3.5 rounded border-slate-400 dark:border-slate-600 accent-blue-500 cursor-pointer"
                                                    />
                                                </td>
                                                {/* CODES — FC / EAN / AN, green=matched, red=unmatched */}
                                                <td className="px-2 py-3">
                                                    {row.match_status === 'MANUAL_ENTRY' ? (
                                                        <input
                                                            type="text"
                                                            value={row.factory_code}
                                                            onChange={(e) => handleRowChange(row.line_id, 'factory_code', e.target.value)}
                                                            className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-[10px] text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-blue-500"
                                                            placeholder="Code"
                                                        />
                                                    ) : (() => {
                                                        const isUnmatched = row.match_status === 'UNMATCHED';
                                                        const fcMatched = (c: string) => !isUnmatched && c === row.matched_code && (row.matched_by === 'ARTICLE_NUMBER' || row.matched_by === 'OTHER_FACTORY_CODE');
                                                        const eanMatched = row.matched_by === 'EAN';
                                                        const anMatched = row.matched_by === 'ARTICLE_NUMBER';
                                                        return (
                                                            <div className="space-y-1">
                                                                {/* Factory Codes */}
                                                                {factoryCodes.length > 0 ? factoryCodes.map((c, i) => (
                                                                    <div key={i} className="flex items-center gap-1.5">
                                                                        <span className={`text-[10px] font-bold uppercase w-5 shrink-0 ${fcMatched(c) ? 'text-emerald-500 dark:text-emerald-400' : isUnmatched ? 'text-red-400' : 'text-slate-500'}`}>
                                                                            {i === 0 ? 'ID' : 'FC'}
                                                                        </span>
                                                                        <span className={`text-[13px] font-mono font-semibold ${fcMatched(c) ? 'text-emerald-600 dark:text-emerald-400' : isUnmatched ? 'text-red-500 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`}>{c}</span>
                                                                    </div>
                                                                )) : (
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span className="text-[10px] font-bold text-slate-400 uppercase w-5 shrink-0">ID</span>
                                                                        <span className="text-[13px] font-mono text-slate-400 dark:text-slate-600">—</span>
                                                                    </div>
                                                                )}
                                                                {/* EAN */}
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className={`text-[10px] font-bold uppercase w-5 shrink-0 ${eanMatched ? 'text-emerald-500 dark:text-emerald-400' : isUnmatched && row.ean ? 'text-red-400' : 'text-slate-400'}`}>EAN</span>
                                                                    <span className={`text-[13px] font-mono ${eanMatched ? 'text-emerald-600 dark:text-emerald-400' : isUnmatched && row.ean ? 'text-red-500 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
                                                                        {row.ean || '—'}
                                                                    </span>
                                                                </div>
                                                                {/* AN (Article Number) */}
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className={`text-[10px] font-bold uppercase w-5 shrink-0 ${anMatched ? 'text-emerald-500 dark:text-emerald-400' : 'text-slate-400'}`}>AN</span>
                                                                    <span className={`text-[13px] font-mono ${anMatched ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                                                                        {anMatched && row.matched_code ? row.matched_code : '—'}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}
                                                </td>

                                                {/* MATCHED SKU */}
                                                <td className="px-2 py-3">
                                                    {row.match_status === 'MATCH' ? (
                                                        <div className="space-y-1">
                                                            <div className="flex items-center gap-1.5">
                                                                <p className="font-mono text-blue-500 dark:text-blue-400 text-[13px] font-bold leading-none">
                                                                    {row.matched_sku || row.sku}
                                                                </p>
                                                                <button
                                                                    onClick={() => handleRowChange(row.line_id, 'show_override', !row.show_override)}
                                                                    title="Change SKU"
                                                                    className="text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors shrink-0"
                                                                >
                                                                    <ArrowsUpDownIcon className="w-3 h-3" />
                                                                </button>
                                                            </div>
                                                            {row.my_id && (
                                                                row.my_id_check === true ? (
                                                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                                                        MY ID ✓
                                                                    </span>
                                                                ) : row.my_id_check === false ? (
                                                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20">
                                                                        MY ID ≠ {row.my_id_mismatch_value}
                                                                    </span>
                                                                ) : null
                                                            )}
                                                            <p className="text-[9px] text-slate-500 dark:text-slate-500 italic">via {row.matched_by}</p>
                                                            {row.show_override && (
                                                                <div className="mt-1 space-y-1.5">
                                                                    <SearchableSelect
                                                                        value=""
                                                                        onChange={(sku) => handleManualMatch(row.line_id, sku)}
                                                                        options={productMasterList}
                                                                        placeholder="Select different SKU..."
                                                                    />
                                                                    <button
                                                                        onClick={() => handleRowChange(row.line_id, 'show_override', false)}
                                                                        className="text-[9px] text-slate-500 hover:text-slate-400 dark:hover:text-slate-300"
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : row.match_status === 'SKU_MISMATCH' ? (
                                                        <div className="space-y-1.5">
                                                            <div className="flex items-center gap-1.5">
                                                                <p className="font-mono text-blue-500 dark:text-blue-400 text-[13px] font-bold leading-none">{row.matched_sku}</p>
                                                                <button
                                                                    onClick={() => handleRowChange(row.line_id, 'show_override', !row.show_override)}
                                                                    title="Override SKU"
                                                                    className="text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors shrink-0"
                                                                >
                                                                    <ArrowsUpDownIcon className="w-3 h-3" />
                                                                </button>
                                                            </div>
                                                            <p className="text-[9px] text-slate-500 italic">via {row.matched_by}</p>
                                                            {row.show_override && (
                                                                <div className="mt-1 space-y-1.5">
                                                                    <SearchableSelect
                                                                        value={row.matched_sku || ''}
                                                                        onChange={(sku) => handleManualMatch(row.line_id, sku)}
                                                                        options={productMasterList}
                                                                        placeholder="Override SKU..."
                                                                    />
                                                                    <button
                                                                        onClick={() => handleRowChange(row.line_id, 'show_override', false)}
                                                                        className="text-[9px] text-slate-500 hover:text-slate-400 dark:hover:text-slate-300"
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : row.match_status === 'PARTIAL_MATCH' ? (
                                                        <div className="space-y-1.5">
                                                            <div className="flex items-center gap-1.5">
                                                                <p className="font-mono text-blue-500 dark:text-blue-400 text-[13px] font-bold leading-none">{row.matched_sku}</p>
                                                                <button
                                                                    onClick={() => handleRowChange(row.line_id, 'show_override', !row.show_override)}
                                                                    title="Override SKU"
                                                                    className="text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors shrink-0"
                                                                >
                                                                    <ArrowsUpDownIcon className="w-3 h-3" />
                                                                </button>
                                                            </div>
                                                            {row.my_id && (
                                                                row.my_id_check === true ? (
                                                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                                                        MY ID ✓
                                                                    </span>
                                                                ) : row.my_id_check === false ? (
                                                                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20">
                                                                        MY ID ≠ {row.my_id_mismatch_value}
                                                                    </span>
                                                                ) : null
                                                            )}
                                                            <p className="text-[9px] text-slate-500 italic">via {row.matched_by}</p>
                                                            {row.show_override && (
                                                                <div className="mt-1 space-y-1.5">
                                                                    <SearchableSelect
                                                                        value={row.matched_sku || ''}
                                                                        onChange={(sku) => handleManualMatch(row.line_id, sku)}
                                                                        options={productMasterList}
                                                                        placeholder="Override SKU..."
                                                                    />
                                                                    <button
                                                                        onClick={() => handleRowChange(row.line_id, 'show_override', false)}
                                                                        className="text-[9px] text-slate-500 hover:text-slate-400 dark:hover:text-slate-300"
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ) : row.match_status === 'MULTIPLE_VARIANT' || row.match_status === 'MULTIPLE_MATCH' ? (
                                                        (() => {
                                                            const suggestion = row.my_id ? productMasterList.find(p => p.id === row.my_id) : null;
                                                            return suggestion ? (
                                                                <div className="space-y-1">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <button
                                                                            onClick={() => handleManualMatch(row.line_id, suggestion.id)}
                                                                            title="Use this SKU"
                                                                            className="font-mono text-blue-500 dark:text-blue-400 text-[13px] font-bold leading-none text-left hover:underline"
                                                                        >
                                                                            {suggestion.id}
                                                                        </button>
                                                                        <button
                                                                            onClick={() => handleRowChange(row.line_id, 'show_override', !row.show_override)}
                                                                            title="Change SKU"
                                                                            className="text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors shrink-0"
                                                                        >
                                                                            <ArrowsUpDownIcon className="w-3 h-3" />
                                                                        </button>
                                                                    </div>
                                                                    <p className="text-[9px] text-slate-500 dark:text-slate-400 truncate">{suggestion.name}</p>
                                                                    <p className="text-[9px] text-slate-500 dark:text-slate-500 italic">via MY ID</p>
                                                                    {row.show_override && (
                                                                        <div className="mt-1 space-y-1.5">
                                                                            <SearchableSelect
                                                                                value={row.matched_sku || ''}
                                                                                onChange={(sku) => handleManualMatch(row.line_id, sku)}
                                                                                options={productMasterList}
                                                                                placeholder="Select correct SKU..."
                                                                            />
                                                                            <button
                                                                                onClick={() => handleRowChange(row.line_id, 'show_override', false)}
                                                                                className="text-[9px] text-slate-500 hover:text-slate-400 dark:hover:text-slate-300"
                                                                            >
                                                                                Cancel
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <SearchableSelect
                                                                    value={row.matched_sku || ''}
                                                                    onChange={(sku) => handleManualMatch(row.line_id, sku)}
                                                                    options={productMasterList}
                                                                    placeholder="Select correct SKU..."
                                                                />
                                                            );
                                                        })()
                                                    ) : (
                                                        (() => {
                                                            const suggestion = row.my_id ? productMasterList.find(p => p.id === row.my_id) : null;
                                                            return suggestion ? (
                                                                <div className="space-y-1">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <button
                                                                            onClick={() => handleManualMatch(row.line_id, suggestion.id)}
                                                                            title="Use this SKU"
                                                                            className="font-mono text-blue-500 dark:text-blue-400 text-[13px] font-bold leading-none text-left hover:underline"
                                                                        >
                                                                            {suggestion.id}
                                                                        </button>
                                                                        <button
                                                                            onClick={() => handleRowChange(row.line_id, 'show_override', !row.show_override)}
                                                                            title="Change SKU"
                                                                            className="text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors shrink-0"
                                                                        >
                                                                            <ArrowsUpDownIcon className="w-3 h-3" />
                                                                        </button>
                                                                    </div>
                                                                    <p className="text-[9px] text-slate-500 dark:text-slate-400 truncate">{suggestion.name}</p>
                                                                    <p className="text-[9px] text-slate-500 dark:text-slate-500 italic">via MY ID</p>
                                                                    {row.show_override && (
                                                                        <div className="mt-1 space-y-1.5">
                                                                            <SearchableSelect
                                                                                value={row.matched_sku || ''}
                                                                                onChange={(sku) => handleManualMatch(row.line_id, sku)}
                                                                                options={productMasterList}
                                                                                placeholder="Search SKU master..."
                                                                            />
                                                                            <button
                                                                                onClick={() => handleRowChange(row.line_id, 'show_override', false)}
                                                                                className="text-[9px] text-slate-500 hover:text-slate-400 dark:hover:text-slate-300"
                                                                            >
                                                                                Cancel
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <SearchableSelect
                                                                    value={row.matched_sku || ''}
                                                                    onChange={(sku) => handleManualMatch(row.line_id, sku)}
                                                                    options={productMasterList}
                                                                    placeholder="Search SKU master..."
                                                                />
                                                            );
                                                        })()
                                                    )}
                                                </td>

                                                {/* INVOICE ITEM */}
                                                <td className="px-2 py-3">
                                                    {row.match_status === 'MANUAL_ENTRY' ? (
                                                        <input
                                                            type="text"
                                                            value={row.item_name}
                                                            onChange={(e) => handleRowChange(row.line_id, 'item_name', e.target.value)}
                                                            className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-[10px] text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-blue-500"
                                                            placeholder="Item Name"
                                                        />
                                                    ) : (
                                                        <div>
                                                            <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 leading-snug">
                                                                {row.item_name || <span className="text-slate-600 italic">—</span>}
                                                            </p>
                                                            {row.color && (
                                                                <p className="text-[11px] text-slate-500 mt-0.5">{row.color}</p>
                                                            )}
                                                        </div>
                                                    )}
                                                </td>

                                                {/* MATCHED NAME */}
                                                <td className="px-2 py-3">
                                                    {row.match_status === 'MATCH' ? (
                                                        <p className="text-[13px] text-slate-700 dark:text-slate-300 leading-snug">
                                                            {row.matched_name || row.item_name}
                                                        </p>
                                                    ) : row.match_status === 'SKU_MISMATCH' ? (
                                                        <div className="space-y-1">
                                                            <p className="text-[13px] text-slate-700 dark:text-slate-300 leading-snug">{row.matched_name}</p>
                                                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20 font-bold">
                                                                ⚠ SKU MISMATCH
                                                            </span>
                                                        </div>
                                                    ) : row.match_status === 'PARTIAL_MATCH' ? (
                                                        <div className="space-y-1">
                                                            <p className="text-[13px] text-slate-700 dark:text-slate-300 leading-snug">{row.matched_name}</p>
                                                            {row.name_similarity != null && (
                                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                                                    row.name_similarity >= 90
                                                                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                                                                        : row.name_similarity >= 70
                                                                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                                                                        : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
                                                                }`}>
                                                                    {Math.round(row.name_similarity)}% name match
                                                                </span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <span className="text-slate-500 dark:text-slate-600 text-xs italic">—</span>
                                                    )}
                                                </td>

                                                {/* RESOLUTION ACTION */}
                                                <td className="px-2 py-3">
                                                    {row.match_status === 'MANUAL_ENTRY' ? (
                                                        <div className="flex flex-col gap-2">
                                                            <Badge variant="success">READY</Badge>
                                                            <button
                                                                onClick={() => handleRemoveManualLine(row.line_id)}
                                                                className="text-[9px] text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 flex items-center gap-1"
                                                            >
                                                                <TrashIcon className="w-3 h-3" /> Remove
                                                            </button>
                                                        </div>
                                                    ) : ['MATCH', 'SKU_MISMATCH', 'PARTIAL_MATCH', 'UNMATCHED', 'MULTIPLE_VARIANT', 'MULTIPLE_MATCH'].includes(row.match_status) ? (
                                                        <div className="inline-flex items-stretch rounded-lg overflow-hidden">
                                                            {/* Primary label */}
                                                            <button
                                                                onClick={() => handleRowChange(row.line_id, 'resolution_action',
                                                                    row.resolution_action === 'ACCEPT' ? '' : 'ACCEPT'
                                                                )}
                                                                className={`px-3 py-1.5 text-xs font-semibold transition-all whitespace-nowrap rounded-l-lg ${
                                                                    row.resolution_action === 'ACCEPT'
                                                                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                                                        : row.resolution_action === 'REJECT_LINE'
                                                                            ? 'bg-orange-500 hover:bg-orange-600 text-white'
                                                                            : row.resolution_action === 'REQUEST_NEW_SKU'
                                                                                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                                                                : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                                                                }`}
                                                            >
                                                                {row.resolution_action === 'REJECT_LINE' ? 'Skip'
                                                                    : row.resolution_action === 'REQUEST_NEW_SKU' ? 'New SKU'
                                                                    : 'Accept'}
                                                            </button>
                                                            {/* Divider */}
                                                            <div className={`w-px shrink-0 ${
                                                                row.resolution_action === 'ACCEPT' ? 'bg-emerald-500'
                                                                : row.resolution_action === 'REJECT_LINE' ? 'bg-orange-400'
                                                                : row.resolution_action === 'REQUEST_NEW_SKU' ? 'bg-blue-500'
                                                                : 'bg-slate-300 dark:bg-slate-600'
                                                            }`} />
                                                            {/* Dropdown trigger */}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (openDropdownId === row.line_id) {
                                                                        setOpenDropdownId(null);
                                                                        setDropdownPos(null);
                                                                    } else {
                                                                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                                                        setDropdownPos({ top: rect.bottom + 4, left: rect.left - 120 });
                                                                        setOpenDropdownId(row.line_id);
                                                                    }
                                                                }}
                                                                aria-label="More actions"
                                                                className={`px-2 py-1.5 text-xs font-semibold transition-all rounded-r-lg ${
                                                                    row.resolution_action === 'ACCEPT'
                                                                        ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                                                                        : row.resolution_action === 'REJECT_LINE'
                                                                            ? 'bg-orange-600 hover:bg-orange-700 text-white'
                                                                            : row.resolution_action === 'REQUEST_NEW_SKU'
                                                                                ? 'bg-blue-700 hover:bg-blue-800 text-white'
                                                                                : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
                                                                }`}
                                                            >
                                                                <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${openDropdownId === row.line_id ? 'rotate-180' : ''}`} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <span className="text-slate-500 dark:text-slate-600 text-xs italic">—</span>
                                                    )}
                                                </td>

                                                {/* STATUS + NOTES */}
                                                <td className="px-2 py-3">
                                                    {row.match_status === 'MANUAL_ENTRY' ? (
                                                        <div className="space-y-2">
                                                            <Badge variant="info">MANUAL ENTRY</Badge>
                                                            <div className="space-y-1">
                                                                <label className="text-[8px] text-slate-500 dark:text-slate-500 uppercase tracking-wider">Cartons</label>
                                                                <input
                                                                    type="number"
                                                                    value={row.carton_count}
                                                                    onChange={(e) => handleRowChange(row.line_id, 'carton_count', toNum(e.target.value))}
                                                                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-[10px] text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-blue-500"
                                                                />
                                                            </div>
                                                        </div>
                                                    ) : (() => {
                                                        const noteOpen = openNotesIds.has(row.line_id);
                                                        const hasNote = !!row.resolution_notes;
                                                        // Always badge on the final match_status — phase1_status can lag behind
                                                        // when Phase 2 (name/price check) escalates a clean SKU match to PARTIAL_MATCH.
                                                        const tooltipKey = row.match_status;
                                                        const badge = <Badge variant={status.variant} className="text-[9px] py-0 px-1.5 leading-4">{status.icon} {status.label}</Badge>;
                                                        return (
                                                            <div className="space-y-1.5">
                                                                {/* Badge + note icon (rightmost) on the same line */}
                                                                <div className="flex items-center justify-between gap-1.5">
                                                                    <span
                                                                        onMouseEnter={e => {
                                                                            if (!MATCH_CONDITION_STATUSES.has(tooltipKey)) return;
                                                                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                                                            setStatusTooltip({ id: row.line_id, pos: { top: rect.bottom + 6, left: rect.left } });
                                                                        }}
                                                                        onMouseLeave={() => setStatusTooltip(null)}
                                                                        className="cursor-default"
                                                                    >
                                                                        {badge}
                                                                    </span>
                                                                    <button
                                                                        onClick={() => setOpenNotesIds(prev => new Set(prev).add(row.line_id))}
                                                                        title={hasNote ? row.resolution_notes : 'Add note'}
                                                                        className={`shrink-0 transition-colors ${hasNote ? 'text-blue-500 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'}`}
                                                                    >
                                                                        <PencilSquareIcon className="w-4 h-4" />
                                                                    </button>
                                                                </div>
                                                                {row.match_type && (
                                                                    <span className={`text-[9px] font-mono ${row.match_type === 'Manual Match' ? 'text-blue-500 dark:text-blue-400 font-bold' : 'text-slate-400 dark:text-slate-500'}`}>
                                                                        {row.match_type === 'Manual Match' ? '👤 Manual' : `via ${row.match_type}`}
                                                                    </span>
                                                                )}
                                                                {/* Note preview (when closed) */}
                                                                {!noteOpen && hasNote && (
                                                                    <p className="text-[9px] text-slate-500 dark:text-slate-400 italic truncate">{row.resolution_notes}</p>
                                                                )}
                                                                {/* Inline note input (when open) */}
                                                                {noteOpen && (
                                                                    <div className="flex items-center gap-1">
                                                                        <input
                                                                            autoFocus
                                                                            type="text"
                                                                            placeholder="Add a note…"
                                                                            value={row.resolution_notes || ''}
                                                                            onChange={(e) => handleRowChange(row.line_id, 'resolution_notes', e.target.value)}
                                                                            onBlur={() => {
                                                                                if (!row.resolution_notes) setOpenNotesIds(prev => { const n = new Set(prev); n.delete(row.line_id); return n; });
                                                                            }}
                                                                            onKeyDown={(e) => {
                                                                                if (e.key === 'Escape') setOpenNotesIds(prev => { const n = new Set(prev); n.delete(row.line_id); return n; });
                                                                            }}
                                                                            className="flex-1 min-w-0 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-[10px] text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none"
                                                                        />
                                                                        <button
                                                                            onClick={() => setOpenNotesIds(prev => { const n = new Set(prev); n.delete(row.line_id); return n; })}
                                                                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0"
                                                                        >
                                                                            <XMarkIcon className="w-3 h-3" />
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })()}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot className="bg-slate-50 dark:bg-slate-800/20 border-t border-slate-200 dark:border-slate-700">
                                    <tr>
                                        <td colSpan={7} className="px-4 py-3">
                                            <button
                                                onClick={handleAddManualLine}
                                                className="w-full py-2 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg text-slate-400 dark:text-slate-500 hover:text-blue-400 hover:border-blue-500/50 hover:bg-blue-500/5 transition-all flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest"
                                            >
                                                <PlusIcon className="w-4 h-4" /> Add Manual Line
                                            </button>
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </Card>

                    {/* Resolution dropdown — fixed-position to escape table overflow clipping */}
                    {openDropdownId && dropdownPos && (() => {
                        const targetRow = filteredRows.find(r => r.line_id === openDropdownId);
                        if (!targetRow) return null;
                        return (
                            <div
                                onClick={e => e.stopPropagation()}
                                style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999, minWidth: '150px' }}
                                className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden"
                            >
                                <button
                                    onClick={() => { handleRowChange(openDropdownId, 'resolution_action', targetRow.resolution_action === 'ACCEPT' ? '' : 'ACCEPT'); setOpenDropdownId(null); setDropdownPos(null); }}
                                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-left transition-colors ${targetRow.resolution_action === 'ACCEPT' ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300'}`}
                                >
                                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" /> Accept
                                </button>
                                <button
                                    onClick={() => { handleRowChange(openDropdownId, 'resolution_action', targetRow.resolution_action === 'REJECT_LINE' ? '' : 'REJECT_LINE'); setOpenDropdownId(null); setDropdownPos(null); }}
                                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-left transition-colors ${targetRow.resolution_action === 'REJECT_LINE' ? 'bg-orange-50 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300' : 'text-slate-700 dark:text-slate-200 hover:bg-orange-50 dark:hover:bg-orange-500/10 hover:text-orange-700 dark:hover:text-orange-300'}`}
                                >
                                    <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" /> Skip
                                </button>
                                <button
                                    onClick={() => { handleRowChange(openDropdownId, 'resolution_action', targetRow.resolution_action === 'REQUEST_NEW_SKU' ? '' : 'REQUEST_NEW_SKU'); setOpenDropdownId(null); setDropdownPos(null); }}
                                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-left transition-colors ${targetRow.resolution_action === 'REQUEST_NEW_SKU' ? 'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-500/10 hover:text-blue-700 dark:hover:text-blue-300'}`}
                                >
                                    <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" /> New SKU
                                </button>
                                <div className="border-t border-slate-100 dark:border-slate-700/70">
                                    <button
                                        onClick={() => { setValidationRows(prev => prev.filter(r => r.line_id !== openDropdownId)); setOpenDropdownId(null); setDropdownPos(null); }}
                                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-left text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                                    >
                                        <TrashIcon className="w-3.5 h-3.5 shrink-0" /> Remove
                                    </button>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Status condition tooltip — fixed-position to escape table overflow clipping */}
                    {statusTooltip && MATCH_CONDITION_STATUSES.has(filteredRows.find(r => r.line_id === statusTooltip.id)?.match_status || '') && (() => {
                        const tooltipRow = filteredRows.find(r => r.line_id === statusTooltip.id);
                        if (!tooltipRow) return null;
                        const steps = getMatchConditionSteps(tooltipRow);
                        if (!steps.length) return null;
                        return (
                            <div
                                style={{ position: 'fixed', top: statusTooltip.pos.top, left: statusTooltip.pos.left, zIndex: 9999 }}
                                className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-3 min-w-[210px] pointer-events-none"
                            >
                                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">Match Condition</p>
                                <div className="space-y-1.5">
                                    {steps.map((step, i) => (
                                        <div key={i} className="flex items-start gap-2">
                                            <span className={`mt-0.5 shrink-0 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-black ${step.ok ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/15 text-red-600 dark:text-red-400'}`}>
                                                {step.ok ? '✓' : '✗'}
                                            </span>
                                            <div>
                                                <p className={`text-[10px] font-semibold leading-none ${step.ok ? 'text-slate-700 dark:text-slate-200' : 'text-red-600 dark:text-red-400'}`}>{step.label}</p>
                                                <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 leading-snug">{step.detail}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}

                    {/* Floating Bulk Action Bar */}
                    {selectedRowIds.size > 0 && (
                        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none">
                            <div className="pointer-events-auto mb-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl shadow-slate-300/60 dark:shadow-black/40 px-6 py-4 flex items-center gap-4">
                                <span className="text-sm font-bold text-slate-800 dark:text-white">
                                    {selectedRowIds.size} item{selectedRowIds.size !== 1 ? 's' : ''} selected
                                </span>
                                <div className="w-px h-6 bg-slate-200 dark:bg-slate-700" />
                                <button
                                    onClick={() => {
                                        setValidationRows(prev => prev.map(row =>
                                            selectedRowIds.has(row.line_id) && row.match_status !== 'MANUAL_ENTRY'
                                                ? { ...row, resolution_action: 'ACCEPT' }
                                                : row
                                        ));
                                        setSelectedRowIds(new Set());
                                    }}
                                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors shadow-sm"
                                >
                                    Bulk Accept
                                </button>
                                <button
                                    onClick={() => {
                                        setValidationRows(prev => prev.map(row =>
                                            selectedRowIds.has(row.line_id) && row.match_status !== 'MANUAL_ENTRY'
                                                ? { ...row, resolution_action: 'REJECT_LINE' }
                                                : row
                                        ));
                                        setSelectedRowIds(new Set());
                                    }}
                                    className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-white text-xs font-bold transition-colors shadow-sm"
                                >
                                    Bulk Skip
                                </button>
                                <button
                                    onClick={() => setSelectedRowIds(new Set())}
                                    className="px-4 py-2 rounded-lg bg-transparent hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white text-xs font-bold transition-colors border border-slate-300 dark:border-slate-600"
                                >
                                    Clear Selection
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Footer Actions */}
                    <div className="flex justify-end gap-3 sticky bottom-4">
                        <Button variant="secondary" onClick={() => setActiveTab('Setup')}>Back to Setup</Button>
                        <Button disabled={!canProceedToAllocation} onClick={handleConfirmAndContinue} className="bg-blue-600 hover:bg-blue-700 h-11 px-8 font-bold shadow-xl">
                            Confirm & Continue →
                        </Button>
                    </div>
                </div>
            )}

            {/* ID / Price / EAN Review Tab – Step 3 Placeholder */}
            {activeTab === 'ID / Price / EAN Review' && (
                <div className="flex flex-col space-y-6 animate-in fade-in duration-300 pb-24">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <MagnifyingGlassIcon className="w-5 h-5 text-blue-400" />
                                ID / Price / EAN Review
                            </h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Review flagged ID updates, price changes, and EAN corrections before allocation</p>
                        </div>
                        <Badge variant="info" className="text-[10px]">Step 3 of 5</Badge>
                    </div>

                    {/* Summary counters from validation */}
                    {validationRows.length > 0 && (
                        <div className="grid grid-cols-4 gap-4">
                            <Card className="bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 border-l-4 border-l-blue-500 p-5 flex flex-col gap-2">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">ID Updates Flagged</p>
                                <p className="text-3xl font-black text-blue-600 dark:text-blue-400">
                                    {validationRows.filter(r => r.resolution_update_id).length}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-500">Items where Article ID will be updated in master</p>
                            </Card>
                            <Card className="bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 border-l-4 border-l-purple-500 p-5 flex flex-col gap-2">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Price Updates Flagged</p>
                                <p className="text-3xl font-black text-purple-600 dark:text-purple-400">
                                    {validationRows.filter(r => r.resolution_update_price).length}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-500">Items where RMB price will be updated in master</p>
                            </Card>
                            <Card className="bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 border-l-4 border-l-teal-500 p-5 flex flex-col gap-2">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">EAN Updates Flagged</p>
                                <p className="text-3xl font-black text-teal-600 dark:text-teal-400">
                                    {validationRows.filter(r => r.resolution_update_ean).length}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-500">Items where EAN will be updated in master</p>
                            </Card>
                            <Card className="bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 border-l-4 border-l-amber-500 p-5 flex flex-col gap-2">
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">EAN Issues</p>
                                <p className="text-3xl font-black text-amber-600 dark:text-amber-400">
                                    {validationRows.filter(isEanMismatch).length}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-500">Items where invoice EAN doesn't match master EAN</p>
                            </Card>
                        </div>
                    )}

                    {/* Filter Bar */}
                    {validationRows.length > 0 && (() => {
                        const base = validationRows.filter(r =>
                            r.match_status !== 'UNMATCHED' &&
                            r.match_status !== 'MULTIPLE_MATCH' &&
                            r.match_status !== 'MULTIPLE_VARIANT'
                        );
                        const isNeedsInput = (r: EnrichedRow) => {
                            const { diff } = calculatePriceDiff(toNum(r.unit_price), toNum(r.master_cost || 0));
                            return r.match_status === 'PARTIAL_MATCH' || diff > 0.01 || isEanMismatch(r);
                        };
                        const looksGoodCount = base.filter(r => !isNeedsInput(r)).length;
                        const needsInputCount = base.filter(isNeedsInput).length;
                        return (
                            <div className="flex flex-wrap items-center gap-2 bg-slate-100/80 dark:bg-slate-800/40 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                                {[
                                    { label: 'All', value: 'ALL', count: base.length, activeClass: 'bg-slate-700 border-slate-500 text-white' },
                                    { label: 'Looks Good', value: 'LOOKS_GOOD', count: looksGoodCount, activeClass: 'bg-emerald-600 border-emerald-500 text-white' },
                                    { label: 'Needs Your Input', value: 'NEEDS_INPUT', count: needsInputCount, activeClass: 'bg-amber-500 border-amber-400 text-white' },
                                ].map(f => (
                                    <button
                                        key={f.value}
                                        onClick={() => setP2Filter(f.value as any)}
                                        className={`px-3 py-1.5 rounded-full text-[10px] font-bold border transition-all ${p2Filter === f.value ? f.activeClass : 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500'}`}
                                    >
                                        {f.label} ({f.count})
                                    </button>
                                ))}
                            </div>
                        );
                    })()}

                    {/* Review Table */}
                    {validationRows.length > 0 ? (
                        <Card className="p-0 border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/20 shadow-xl overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse min-w-[1000px]">
                                    <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700">
                                        <tr className="text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider font-bold">
                                            <th className="px-3 py-3 w-[10%]">SKU</th>
                                            <th className="px-3 py-3 w-[20%]">NAME</th>
                                            <th className="px-3 py-3 w-[14%]">CODES (AN / FC / EAN)</th>
                                            <th className="px-3 py-3 w-[6%] text-right">QTY</th>
                                            <th className="px-3 py-3 w-[7%] text-right">INVOICE ¥</th>
                                            <th className="px-3 py-3 w-[7%] text-right">MASTER ¥</th>
                                            <th className="px-3 py-3 w-[7%] text-right">DIFF</th>
                                            <th className="px-3 py-3 w-[17%]">
                                                <div className="space-y-1.5">
                                                    <span>ID / PRICE / EAN UPDATE</span>
                                                    <div className="flex gap-1">
                                                        <button
                                                            onClick={() => {
                                                                const allSet = validationRows.every(r => r.resolution_update_id);
                                                                setValidationRows(prev => prev.map(r => ({ ...r, resolution_update_id: !allSet })));
                                                            }}
                                                            className="px-2 py-0.5 rounded text-[9px] font-bold bg-blue-600/20 text-blue-400 border border-blue-600/30 hover:bg-blue-600/40 transition-all"
                                                        >ID All</button>
                                                        <button
                                                            onClick={() => {
                                                                const allSet = validationRows.every(r => r.resolution_update_price);
                                                                setValidationRows(prev => prev.map(r => ({ ...r, resolution_update_price: !allSet })));
                                                            }}
                                                            className="px-2 py-0.5 rounded text-[9px] font-bold bg-purple-600/20 text-purple-400 border border-purple-600/30 hover:bg-purple-600/40 transition-all"
                                                        >¥ All</button>
                                                        <button
                                                            onClick={() => {
                                                                const allSet = validationRows.every(r => r.resolution_update_ean);
                                                                setValidationRows(prev => prev.map(r => ({ ...r, resolution_update_ean: !allSet })));
                                                            }}
                                                            className="px-2 py-0.5 rounded text-[9px] font-bold bg-teal-600/20 text-teal-400 border border-teal-600/30 hover:bg-teal-600/40 transition-all"
                                                        >EAN All</button>
                                                    </div>
                                                </div>
                                            </th>
                                            <th className="px-3 py-3 w-[4%]"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                                        {p2FilteredRows.map((row) => {
                                            const masterCost = toNum(row.master_cost || 0);
                                            const { diff, percentage } = calculatePriceDiff(toNum(row.unit_price), masterCost);
                                            const diffColor = diff > 0.01 ? 'text-red-500' : diff < -0.01 ? 'text-emerald-500' : 'text-slate-400';
                                            const rowCodes = (row.factory_code || '').split('|').filter(Boolean);
                                            const masterEan = productMasterList.find(p => p.id === (row.matched_sku || row.sku))?.ean || '';
                                            const eanIsNew = isNewEan(row);
                                            const eanMismatch = !eanIsNew && hasRealEan(row.ean) && hasRealEan(masterEan) && row.ean.trim() !== masterEan.trim();
                                            const eanTooltip = eanIsNew
                                                ? `New EAN — ${row.ean} not found anywhere in master, will be treated as a new EAN`
                                                : eanMismatch
                                                ? `EAN mismatch — invoice: ${row.ean}, master: ${masterEan}`
                                                : 'EAN matches master record';
                                            return (
                                                <tr key={row.line_id} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                                                    {/* SKU */}
                                                    <td className="px-3 py-3">
                                                        <p className="font-mono text-blue-500 dark:text-blue-400 text-[12px] font-bold">{row.matched_sku || row.sku || '—'}</p>
                                                        <p className="text-[9px] text-slate-400 italic mt-0.5">via {row.matched_by || '—'}</p>
                                                    </td>
                                                    {/* NAME */}
                                                    <td className="px-3 py-3">
                                                        <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-snug">{row.matched_name || row.item_name || '—'}</p>
                                                        {row.name_similarity != null && row.name_similarity < 100 && (
                                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border mt-0.5 inline-block ${
                                                                row.name_similarity >= 90
                                                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                                                                    : row.name_similarity >= 70
                                                                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                                                                    : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
                                                            }`}>
                                                                {Math.round(row.name_similarity)}% name match
                                                            </span>
                                                        )}
                                                    </td>
                                                    {/* CODES (AN / FC / EAN) */}
                                                    <td className="px-3 py-3">
                                                        <div className="space-y-1">
                                                            {rowCodes.map((c, i) => (
                                                                <div key={i} className="flex items-center gap-1.5">
                                                                    <span className="text-[9px] font-bold text-slate-400 uppercase w-5 shrink-0">{i === 0 ? 'AN' : 'FC'}</span>
                                                                    <span className="text-[10px] font-mono text-slate-700 dark:text-slate-200">{c}</span>
                                                                </div>
                                                            ))}
                                                            {rowCodes.length === 0 && (
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="text-[9px] font-bold text-slate-400 uppercase w-5 shrink-0">AN</span>
                                                                    <span className="text-slate-400 text-[10px] font-mono">—</span>
                                                                </div>
                                                            )}
                                                            <div className="flex items-center gap-1.5" title={eanTooltip}>
                                                                <span className={`text-[9px] font-bold uppercase w-5 shrink-0 ${eanIsNew ? 'text-blue-500 dark:text-blue-400' : eanMismatch ? 'text-red-500 dark:text-red-400' : 'text-slate-400'}`}>EAN</span>
                                                                <span className={`text-[10px] font-mono ${eanIsNew ? 'text-blue-600 dark:text-blue-400' : eanMismatch ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
                                                                    {row.ean || '—'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    {/* QTY */}
                                                    <td className="px-3 py-3 text-right">
                                                        {row.match_status === 'MANUAL_ENTRY' ? (
                                                            <input
                                                                type="number"
                                                                value={row.invoice_qty}
                                                                onChange={(e) => handleRowChange(row.line_id, 'invoice_qty', toNum(e.target.value))}
                                                                className="w-16 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-[10px] text-right text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-blue-500"
                                                            />
                                                        ) : (
                                                            <span className="font-mono font-bold text-slate-800 dark:text-slate-100 text-sm">{row.invoice_qty}</span>
                                                        )}
                                                    </td>
                                                    {/* INVOICE PRICE */}
                                                    <td className="px-3 py-3 text-right">
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            value={row.unit_price_base !== undefined && row.unit_price_base !== 0
                                                                ? String(row.unit_price_base)
                                                                : row.unit_price !== 0
                                                                ? String(row.unit_price)
                                                                : ''}
                                                            onChange={(e) => {
                                                                const raw = e.target.value;
                                                                handleRowChange(row.line_id, 'unit_price_base', raw);
                                                                const val = parseFloat(raw);
                                                                if (!isNaN(val)) {
                                                                    handleRowChange(row.line_id, 'unit_price', val);
                                                                    handleRowChange(row.line_id, 'unit_price_total', val);
                                                                }
                                                            }}
                                                            className="w-20 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-[11px] text-right text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-blue-500"
                                                            placeholder="0.00"
                                                        />
                                                    </td>
                                                    {/* MASTER PRICE */}
                                                    <td className="px-3 py-3 text-right">
                                                        <span className="font-mono text-sm text-slate-500 dark:text-slate-400">
                                                            {masterCost > 0 ? `¥${masterCost.toFixed(2)}` : '—'}
                                                        </span>
                                                    </td>
                                                    {/* DIFF */}
                                                    <td className="px-3 py-3 text-right">
                                                        {masterCost > 0 && row.unit_price > 0 ? (
                                                            <div className="space-y-0.5">
                                                                <p className={`text-sm font-black ${diffColor}`}>
                                                                    {diff !== 0 ? `${diff > 0 ? '+' : ''}${fmtNumber(Math.abs(diff), 0)}` : '0'}
                                                                </p>
                                                                <p className={`text-xs font-bold ${diffColor}`}>
                                                                    {percentage !== 0 ? `${percentage > 0 ? '+' : ''}${fmtNumber(percentage, 1)}%` : '0%'}
                                                                </p>
                                                            </div>
                                                        ) : (
                                                            <span className="text-slate-500 text-sm">—</span>
                                                        )}
                                                    </td>
                                                    {/* ID / PRICE / EAN UPDATE TOGGLES */}
                                                    <td className="px-3 py-3">
                                                        <div className="flex flex-col gap-1.5">
                                                            <button
                                                                onClick={() => handleRowChange(row.line_id, 'resolution_update_id', !row.resolution_update_id)}
                                                                className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-all ${row.resolution_update_id ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-300 dark:border-slate-700 hover:border-blue-500/50'}`}
                                                            >
                                                                {row.resolution_update_id ? '✓ ' : ''}Update ID in Master
                                                            </button>
                                                            <button
                                                                onClick={() => handleRowChange(row.line_id, 'resolution_update_price', !row.resolution_update_price)}
                                                                className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-all ${row.resolution_update_price ? 'bg-purple-600 text-white border-purple-500' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-300 dark:border-slate-700 hover:border-purple-500/50'}`}
                                                            >
                                                                {row.resolution_update_price ? '✓ ' : ''}Update ¥ in Master
                                                            </button>
                                                            <button
                                                                onClick={() => handleRowChange(row.line_id, 'resolution_update_ean', !row.resolution_update_ean)}
                                                                className={`px-2 py-0.5 rounded text-[9px] font-bold border transition-all ${row.resolution_update_ean ? 'bg-teal-600 text-white border-teal-500' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-300 dark:border-slate-700 hover:border-teal-500/50'}`}
                                                            >
                                                                {row.resolution_update_ean ? '✓ ' : ''}Update EAN in Master
                                                            </button>
                                                        </div>
                                                    </td>
                                                    {/* NOTE ICON */}
                                                    <td className="px-2 py-3 text-center align-top">
                                                        <div className="flex flex-col items-center gap-1">
                                                            <button
                                                                onClick={() => setOpenP2NotesIds(prev => {
                                                                    const next = new Set(prev);
                                                                    next.has(row.line_id) ? next.delete(row.line_id) : next.add(row.line_id);
                                                                    return next;
                                                                })}
                                                                title={row.resolution_notes || 'Add note'}
                                                                className={`p-1 rounded transition-colors ${row.resolution_notes ? 'text-blue-500 dark:text-blue-400' : 'text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400'}`}
                                                            >
                                                                <PencilSquareIcon className="w-4 h-4" />
                                                            </button>
                                                            {openP2NotesIds.has(row.line_id) && (
                                                                <textarea
                                                                    autoFocus
                                                                    rows={2}
                                                                    placeholder="Add note..."
                                                                    value={row.resolution_notes || ''}
                                                                    onChange={(e) => handleRowChange(row.line_id, 'resolution_notes', e.target.value)}
                                                                    className="w-28 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded p-1 text-[9px] text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-blue-500 placeholder:text-slate-400 dark:placeholder:text-slate-600 resize-none"
                                                                />
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-slate-200 dark:border-slate-700/60 rounded-2xl bg-slate-50 dark:bg-slate-800/10 text-center gap-3">
                            <MagnifyingGlassIcon className="w-8 h-8 text-slate-400" />
                            <p className="text-sm text-slate-500">Complete Validate Items first to see rows here.</p>
                        </div>
                    )}

                    {/* Footer */}
                    <div className="flex justify-between sticky bottom-4">
                        <Button variant="secondary" onClick={() => setActiveTab('Validate Items')} icon={<ArrowLeftIcon className="w-4 h-4" />}>
                            Back to Validate Items
                        </Button>
                        <Button
                            onClick={handleConfirmValidation}
                            disabled={allocationLoading || !canProceedToAllocation}
                            className="bg-blue-600 hover:bg-blue-700 h-11 px-8 font-bold shadow-xl"
                        >
                            {allocationLoading ? 'Running Allocation...' : 'Proceed to Allocation →'}
                        </Button>
                    </div>
                </div>
            )}

            {/* Allocation Tab - FIFO Matrix Implementation */}
            {activeTab === 'Allocation' && (
                <div className="flex flex-col space-y-6 animate-in fade-in duration-300 pb-24">
                    {/* Header */}
                    <div className="flex justify-between items-center">
                        <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            <ClipboardDocumentCheckIcon className="w-5 h-5 text-blue-500" />
                            FIFO Allocation Matrix
                        </h3>
                    </div>

                    {/* Explainer */}
                    <p className="text-xs text-slate-500 dark:text-slate-400 -mt-4">
                        Incoming stock is assigned to the oldest open purchase order first.
                    </p>

                    {/* Summary Cards */}
                    {allocationSummary && (
                        <div className="grid grid-cols-3 gap-4">
                            <Card className="bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 p-4">
                                <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold mb-2">Total SKUs</p>
                                <p className="text-3xl font-bold text-slate-800 dark:text-white">{allocationSummary.total_skus}</p>
                            </Card>

                            <Card className="bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 p-4">
                                <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold mb-2">Allocated</p>
                                <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                                    {fmtNumber(allocationSummary.total_allocated, 0)}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                    of {fmtNumber(allocationSummary.total_invoice_qty, 0)} total
                                </p>
                            </Card>

                            <Card className="bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 p-4">
                                <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold mb-2">Unallocated</p>
                                <p className={`text-3xl font-bold ${
                                    allocationSummary.total_unallocated > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-slate-400 dark:text-slate-600'
                                }`}>
                                    {fmtNumber(allocationSummary.total_unallocated, 0)}
                                </p>
                            </Card>
                        </div>
                    )}

                    {/* Allocation Table */}
                    <Card className="p-0 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/20 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-slate-50 dark:bg-slate-900 sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700">
                                    <tr className="text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-wider font-bold">
                                        <th className="px-4 py-3 w-[5%]"></th>
                                        <th className="px-4 py-3 w-[12%]">SKU</th>
                                        <th className="px-4 py-3 w-[25%]">Item Name</th>
                                        <th className="px-4 py-3 w-[10%] text-center">Invoice Qty</th>
                                        <th className="px-4 py-3 w-[10%] text-center">Allocated</th>
                                        <th className="px-4 py-3 w-[10%] text-center">Unallocated</th>
                                        <th className="px-4 py-3 w-[8%] text-center">PO Count</th>
                                        <th className="px-4 py-3 w-[10%] text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-slate-700/40">
                                    {allocationData.map((item) => (
                                        <React.Fragment key={item.sku}>
                                            {/* Main Row */}
                                            <tr
                                                className="hover:bg-slate-100 dark:hover:bg-slate-700/20 cursor-pointer transition-colors"
                                                onClick={() => toggleRowExpansion(item.sku)}
                                            >
                                                <td className="px-4 py-4 text-center">
                                                    {item.po_allocations.length > 0 && (
                                                        expandedRows[item.sku] ? (
                                                            <ChevronDownIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                                                        ) : (
                                                            <ChevronUpIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                                                        )
                                                    )}
                                                </td>
                                                <td className="px-4 py-4">
                                                    <p className="font-mono font-bold text-blue-600 dark:text-blue-400 text-xs">{item.sku}</p>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <p className="text-xs text-slate-700 dark:text-slate-300 truncate">{item.sku_name}</p>
                                                </td>
                                                <td className="px-4 py-4 text-center font-bold text-slate-800 dark:text-white">
                                                    {fmtNumber(item.invoice_qty, 0)}
                                                </td>
                                                <td className="px-4 py-4 text-center font-bold text-emerald-600 dark:text-emerald-400">
                                                    {fmtNumber(item.total_allocated, 0)}
                                                </td>
                                                <td className="px-4 py-4 text-center">
                                                    <span className={`font-bold ${
                                                        item.unallocated_qty > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-slate-400 dark:text-slate-600'
                                                    }`}>
                                                        {item.unallocated_qty > 0 ? `+${item.unallocated_qty}` : '0'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4 text-center font-bold text-slate-500 dark:text-slate-400 text-sm">
                                                    {item.po_allocations.length}
                                                </td>
                                                <td className="px-4 py-4 text-center">
                                                    {item.total_allocated <= 0 ? (
                                                        <Badge variant="destructive" className="text-[8px]">UNALLOCATED</Badge>
                                                    ) : item.unallocated_qty > 0 ? (
                                                        <Badge variant="warning" className="text-[8px]">PARTIAL</Badge>
                                                    ) : (
                                                        <Badge variant="success" className="text-[8px]">ALLOCATED</Badge>
                                                    )}
                                                </td>
                                            </tr>

                                            {/* Expanded PO Details */}
                                            {expandedRows[item.sku] && item.po_allocations.map((po: any) => (
                                                <tr key={`${item.sku}-${po.po_id}`} className="bg-slate-50 dark:bg-slate-800/50">
                                                    <td className="px-4 py-3"></td>
                                                    <td colSpan={2} className="px-4 py-3">
                                                        <div className="flex items-center gap-2 pl-4">
                                                            <span className="text-slate-400 dark:text-slate-600">→</span>
                                                            <span className="font-mono text-blue-600 dark:text-blue-400 text-xs font-bold">
                                                                {po.po_id}
                                                            </span>
                                                            <span className="text-[10px] text-slate-500 dark:text-slate-500">
                                                                ({formatDate(po.po_date)} -
                                                                <span className={getAgeColor(po.age_days)}>
                                                                    {' '}{po.age_days}d old
                                                                </span>)
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-[10px] text-slate-500 dark:text-slate-400">
                                                        Ord: {fmtNumber(po.ordered_qty, 0)}
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-[10px] text-slate-500 dark:text-slate-400">
                                                        Ful: {fmtNumber(po.fulfilled_qty, 0)}
                                                    </td>
                                                    <td className="px-4 py-3 text-center text-[10px] text-slate-500 dark:text-slate-400">
                                                        Pen: {fmtNumber(po.pending_qty, 0)}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className="text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                                                            → {fmtNumber(po.allocated_qty, 0)}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        {po.will_be_fulfilled ? (
                                                            <Badge variant="success" className="text-[8px]">✓ FULFILLED</Badge>
                                                        ) : (
                                                            <Badge variant="warning" className="text-[8px]">⚠ PARTIAL</Badge>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>

                    {/* Empty State */}
                    {allocationData.length === 0 && !allocationLoading && (
                        <div className="py-24 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                            <BoxIcon className="w-12 h-12 text-slate-300 dark:text-slate-700 mx-auto mb-4" />
                            <h3 className="text-lg font-bold text-slate-600 dark:text-slate-400">No Allocation Data</h3>
                            <p className="text-sm text-slate-500 mt-1">
                                Return to Validation and click "Proceed to Allocation"
                            </p>
                        </div>
                    )}

                    {/* Footer Buttons */}
                    <div className="flex justify-between pt-6 border-t border-slate-200 dark:border-slate-800">
                        <Button
                            variant="secondary"
                            onClick={() => setActiveTab('ID / Price / EAN Review')}
                            icon={<ArrowLeftIcon className="w-4 h-4"/>}
                        >
                            Back to ID/Price/EAN
                        </Button>
                        <div className="flex gap-3">
                            {allocationSummary?.total_unallocated > 0 && (
                                <Button
                                    variant="secondary"
                                    onClick={() => setShowPreviewPOModal(true)}
                                    disabled={!vendorCode || allocationData.every(a => a.unallocated_qty <= 0)}
                                    className="border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 h-11 px-6 font-bold"
                                >
                                    <PlusIcon className="w-4 h-4 mr-2" />
                                    Create PO
                                </Button>
                            )}
                            <Button
                                onClick={handleProceedToReview}
                                disabled={allocationData.length === 0}
                                className="bg-blue-600 hover:bg-blue-700 h-11 px-8 font-bold"
                            >
                                Proceed to Review
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Review Tab - Final Validation & Summary */}
            {activeTab === 'Review' && (
              <div className="flex flex-col space-y-6 animate-in fade-in duration-300 pb-24">
                {/* Header */}
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                    <ClipboardDocumentCheckIcon className="w-5 h-5 text-blue-500" />
                    Final Review & Validation
                  </h3>
                </div>

                {reviewData && (
                  <>
                    {/* Shipment Summary Cards */}
                    <div className="grid grid-cols-4 gap-4">
                      <Card className="bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 p-4">
                        <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold mb-2">Vendor</p>
                        <p className="text-lg font-bold text-slate-800 dark:text-white">{vendorCode}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{reviewData.summary.total_skus} SKUs</p>
                      </Card>

                      <Card className="bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 p-4">
                        <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold mb-2">Total Qty</p>
                        <p className="text-2xl font-bold text-slate-800 dark:text-white">
                          {fmtNumber(reviewData.summary.total_invoice_qty, 0)}
                        </p>
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                          {fmtNumber(reviewData.summary.total_allocated, 0)} allocated
                        </p>
                      </Card>

                      <Card className="bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 p-4">
                        <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold mb-2">POs Fulfilled</p>
                        <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                          {reviewData.summary.pos_fully_fulfilled}
                        </p>
                        <p className="text-xs text-amber-600 dark:text-yellow-400 mt-1">
                          {reviewData.summary.pos_partially_fulfilled} partial
                        </p>
                      </Card>

                      <Card className="bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 p-4">
                        <p className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold mb-2">Unallocated</p>
                        <p className={`text-2xl font-bold ${
                          reviewData.summary.total_unallocated > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-slate-400 dark:text-slate-600'
                        }`}>
                          {fmtNumber(reviewData.summary.total_unallocated, 0)}
                        </p>
                        {reviewData.summary.total_unallocated > 0 && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Expected — resolve via Allocation, not an error</p>
                        )}
                      </Card>
                    </div>

                    {/* Financial Reconciliation */}
                    <Card className="bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 p-6">
                      <div className="flex items-center justify-between mb-4">
                        <h4
                          className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2 cursor-help"
                          title="Invoice Value = vendor's invoice price × quantity for the full shipment. Our Recorded Value = the price we committed to on the purchase order(s) each SKU is allocated against (falling back to the current master cost for any unallocated portion) × quantity. This checks for real pricing discrepancies against what we actually agreed to pay."
                        >
                          <span>💰</span> Financial Reconciliation
                          <InformationCircleIcon className="w-3.5 h-3.5 text-slate-400" />
                        </h4>
                        {reviewData.reconciliation.has_variance && (
                          <Badge variant="warning" className="text-[8px]">VARIANCE DETECTED</Badge>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-6">
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Invoice Value</p>
                          <p className="text-xl font-bold text-slate-800 dark:text-white">
                            ¥{fmtNumber(reviewData.reconciliation.invoice_total)}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Our Recorded Value</p>
                          <p className="text-xl font-bold text-blue-600 dark:text-blue-400">
                            ¥{fmtNumber(reviewData.reconciliation.recorded_total)}
                          </p>
                        </div>

                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Variance</p>
                          <p className={`text-xl font-bold ${
                            Math.abs(reviewData.reconciliation.difference) < 1
                              ? 'text-slate-400 dark:text-slate-600'
                              : Math.abs(reviewData.reconciliation.percentage_diff) > 5
                                ? 'text-red-600 dark:text-red-400'
                                : 'text-amber-600 dark:text-yellow-400'
                          }`}>
                            {reviewData.reconciliation.difference > 0 ? '+' : ''}
                            ¥{fmtNumber(reviewData.reconciliation.difference)}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            ({reviewData.reconciliation.percentage_diff > 0 ? '+' : ''}
                            {fmtNumber(reviewData.reconciliation.percentage_diff, 2)}%)
                          </p>
                        </div>
                      </div>

                      {/* Items driving the variance (>1% each) */}
                      {reviewData.reconciliation.item_variances?.length > 0 && (
                        <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-700/50">
                          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-2">
                            Items driving the variance ({reviewData.reconciliation.item_variances.length})
                          </p>
                          <div className="space-y-1.5">
                            {reviewData.reconciliation.item_variances.map((item: any, idx: number) => (
                              <div key={idx} className="flex items-center justify-between text-xs bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/20 rounded px-3 py-2">
                                <div className="min-w-0">
                                  <span className="font-mono text-blue-600 dark:text-blue-400 font-bold">{item.sku}</span>
                                  <span className="text-slate-500 dark:text-slate-400 ml-2 truncate">{item.item_name}</span>
                                  <span className="text-slate-400 dark:text-slate-500 ml-2">× {item.qty}</span>
                                </div>
                                <div className="text-right shrink-0 ml-3">
                                  <span className="text-slate-500 dark:text-slate-400">
                                    ¥{fmtNumber(item.invoice_price)} vs ¥{fmtNumber(item.recorded_price)}
                                  </span>
                                  <span className={`font-bold ml-2 ${item.percentage_diff > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                    {item.percentage_diff > 0 ? '+' : ''}{fmtNumber(item.percentage_diff, 1)}%
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </Card>

                    {/* Allocation Update Feedback */}
                    {allocationSummary && (
                      <div className="bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-300 dark:border-emerald-500/20 rounded-lg p-3 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-xs">
                          <CheckIcon className="w-4 h-4" />
                          <span className="font-bold">
                            Allocation Updated: {allocationSummary.total_allocated} units allocated to {allocationSummary.pos_involved?.length || 0} POs
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Warnings Section */}
                    {reviewData.warnings && reviewData.warnings.length > 0 && (
                      <Card className="bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 p-6">
                        <h4 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                          <ExclamationTriangleIcon className="w-4 h-4" />
                          Warnings & Alerts ({reviewData.warnings.length})
                        </h4>

                        <div className="space-y-3">
                          {reviewData.warnings.map((warning: any) => (
                            <div
                              key={warning.type}
                              className={`border rounded-lg p-4 transition-all ${getWarningColor(warning.severity)}`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <span className="text-2xl">{getWarningIcon(warning.severity)}</span>
                                  <div>
                                    <p className="text-sm font-bold text-slate-800 dark:text-white">
                                      {warning.type.replace(/_/g, ' ')}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                      {warning.message}
                                    </p>
                                  </div>
                                </div>

                                <button
                                  onClick={() => toggleWarningExpansion(warning.type)}
                                  className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors"
                                >
                                  {expandedWarnings[warning.type] ? (
                                    <ChevronUpIcon className="w-5 h-5" />
                                  ) : (
                                    <ChevronDownIcon className="w-5 h-5" />
                                  )}
                                </button>
                              </div>

                              {/* Expanded Warning Details */}
                              {expandedWarnings[warning.type] && warning.items && (
                                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700/50 space-y-2">
                                  {warning.items.slice(0, 5).map((item: any, idx: number) => (
                                    <div key={idx} className="flex justify-between items-center text-xs bg-white/70 dark:bg-slate-900/40 rounded px-3 py-2">
                                      <div>
                                        <span className="font-mono text-blue-600 dark:text-blue-400 font-bold">{item.sku}</span>
                                        <span className="text-slate-500 dark:text-slate-500 ml-2">{item.item_name}</span>
                                      </div>
                                      {item.variance_percentage && (
                                        <span className="text-orange-600 dark:text-orange-400 font-bold">
                                          {item.variance_percentage > 0 ? '+' : ''}
                                          {fmtNumber(item.variance_percentage, 1)}%
                                        </span>
                                      )}
                                      {item.unallocated_qty && (
                                        <span className="text-orange-600 dark:text-orange-400 font-bold">
                                          +{item.unallocated_qty} unallocated
                                        </span>
                                      )}
                                      {item.qty && !item.unallocated_qty && (
                                        <span className="text-slate-500 dark:text-slate-400">
                                          {item.qty} units
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                  {warning.items.length > 5 && (
                                    <p className="text-xs text-slate-500 dark:text-slate-500 text-center pt-2">
                                      ... and {warning.items.length - 5} more
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}

                    {/* No Warnings State */}
                    {(!reviewData.warnings || reviewData.warnings.length === 0) && (
                      <Card className="bg-emerald-50 dark:bg-emerald-500/5 border-emerald-300 dark:border-emerald-500/20 p-6">
                        <div className="flex items-center gap-3">
                          <CheckIcon className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                          <div>
                            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">All Clear!</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              No warnings detected. Ready to proceed to creation.
                            </p>
                          </div>
                        </div>
                      </Card>
                    )}

                    {/* Action Buttons for Unallocated Items */}
                    {reviewData.warnings?.some((w: any) => w.type === 'UNALLOCATED' || w.type === 'NO_PO') && (
                      <Card className="bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-bold text-slate-800 dark:text-white">Items without Purchase Orders</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              Refresh allocation, or go back to the Allocation tab to create a PO for these items
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="secondary"
                              onClick={handleRefreshAllocation}
                              disabled={isRefreshingAllocation}
                              className="border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
                            >
                              <ArrowPathIcon className={`w-4 h-4 mr-2 ${isRefreshingAllocation ? 'animate-spin' : ''}`} />
                              {isRefreshingAllocation ? 'Refreshing...' : 'Refresh Allocation'}
                            </Button>
                          </div>
                        </div>
                      </Card>
                    )}
                  </>
                )}

                {/* Empty State */}
                {!reviewData && !reviewLoading && (
                  <div className="py-24 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                    <ClipboardDocumentCheckIcon className="w-12 h-12 text-slate-300 dark:text-slate-700 mx-auto mb-4" />
                    <h3 className="text-lg font-bold text-slate-600 dark:text-slate-400">No Review Data</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Return to Allocation and click "Proceed to Review"
                    </p>
                  </div>
                )}

                {/* Footer Buttons */}
                <div className="flex justify-between items-center pt-6 border-t border-slate-200 dark:border-slate-800">
                  <Button
                    variant="secondary"
                    onClick={() => setActiveTab('Allocation')}
                    icon={<ArrowLeftIcon className="w-4 h-4"/>}
                  >
                    Back to Allocation
                  </Button>

                  <div className="flex items-center gap-3">
                    {!canProceedToCreation && reviewData && (
                      <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm mr-4">
                        <ExclamationTriangleIcon className="w-4 h-4" />
                        <span>Resolve blocking issues before proceeding</span>
                      </div>
                    )}

                    {reviewData?.summary?.total_unallocated > 0 && (
                      <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 text-sm mr-4">
                        <ExclamationTriangleIcon className="w-4 h-4" />
                        <span>Please create PO for {reviewData.summary.total_unallocated} unallocated items first</span>
                      </div>
                    )}

                    <Button
                      onClick={() => setActiveTab('Creation')}
                      disabled={!canProceedToCreation || !reviewData || (reviewData?.summary?.total_unallocated > 0)}
                      className="bg-blue-600 hover:bg-blue-700 h-11 px-8 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Proceed to Creation
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Creation Tab */}
            {activeTab === 'Creation' && !shipmentSuccess && (
                <div className="flex flex-col space-y-6 animate-in fade-in duration-300 pb-24">
                  <h3 className="text-xl font-bold text-[#1F2937] dark:text-white flex items-center gap-2">
                    <CheckBadgeIcon className="w-6 h-6 text-emerald-500" />
                    Final Shipment Details
                  </h3>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Left: Batch Assignment */}
                    <div className="space-y-6">
                      <Card className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-6 space-y-6 shadow-sm">
                        <h4 className="text-sm font-bold text-blue-600 dark:text-slate-400 uppercase tracking-widest flex items-center gap-2">
                          <ArchiveBoxIcon className="w-4 h-4" /> Batch Assignment
                        </h4>

                        <div className="grid grid-cols-2 gap-4">
                          <button
                            onClick={() => setBatchOption('new')}
                            className={`p-4 rounded-xl border text-left transition-all ${
                              batchOption === 'new'
                                ? 'bg-blue-50 dark:bg-blue-600/10 border-blue-500 ring-1 ring-blue-500'
                                : 'bg-slate-100 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:border-slate-500'
                            }`}
                          >
                            <p className="text-[10px] font-bold uppercase tracking-wider mb-1 text-slate-500 dark:text-slate-400">Option 1</p>
                            <p className="text-sm font-bold text-slate-800 dark:text-white">Create New Batch</p>
                          </button>

                          <button
                            onClick={() => setBatchOption('existing')}
                            className={`p-4 rounded-xl border text-left transition-all ${
                              batchOption === 'existing'
                                ? 'bg-blue-50 dark:bg-blue-600/10 border-blue-500 ring-1 ring-blue-500'
                                : 'bg-slate-100 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:border-slate-500'
                            }`}
                          >
                            <p className="text-[10px] font-bold uppercase tracking-wider mb-1 text-slate-500 dark:text-slate-400">Option 2</p>
                            <p className="text-sm font-bold text-slate-800 dark:text-white">Select Existing</p>
                          </button>
                        </div>

                        {batchOption === 'new' ? (
                          <div className="p-4 bg-slate-100 dark:bg-slate-900/80 rounded-lg border border-slate-200 dark:border-slate-700/50">
                            <label className="text-[10px] font-bold text-slate-600 dark:text-slate-500 uppercase mb-2 block">
                              New Batch ID (Auto-generated)
                            </label>
                            <p className={`text-2xl font-mono font-bold ${shippingMode ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 dark:text-slate-600'}`}>
                              {shippingMode
                                ? `${shippingMode === 'AIR' ? 'A' : 'S'}-${String(new Date().getFullYear()).slice(-2)}XXX (Auto-generated)`
                                : 'Select a shipping mode in Setup first'}
                            </p>
                            {shippingMode && (
                              <p className="text-xs text-blue-600 dark:text-slate-500 mt-2">
                                Mode: {shippingMode}
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold text-slate-600 dark:text-slate-500 uppercase mb-1 block">
                              Open Batches *
                            </label>
                            <select
                              value={selectedBatchId}
                              onChange={(e) => setSelectedBatchId(e.target.value)}
                              className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            >
                              <option value="" className="text-slate-500">Select an open batch...</option>
                              {openBatches.map(b => (
                                <option key={b.batch_id} value={b.batch_id} className="text-slate-900 dark:text-white">
                                  {b.batch_id} ({b.batch_type}, {b.total_shipments} shipments)
                                </option>
                              ))}
                            </select>
                            {validationErrors.batch && (
                              <p className="text-red-500 dark:text-red-400 text-xs mt-1">{validationErrors.batch}</p>
                            )}
                          </div>
                        )}
                      </Card>
                    </div>

                    {/* Right: Physical & Invoice Details */}
                    <div className="space-y-6">
                      <Card className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-6 space-y-6 shadow-sm">
                        <h4 className="text-sm font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest flex items-center gap-2">
                          <BoxIcon className="w-4 h-4" /> Shipment Details
                        </h4>

                        <div className="space-y-4">
                          {/* Carton Count */}
                          <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-500 uppercase tracking-widest mb-2">
                              Total Cartons *
                            </label>
                            <input
                              type="number"
                              min="1"
                              value={cartonCount || ''}
                              onChange={(e) => setCartonCount(parseInt(e.target.value) || 0)}
                              className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-3 text-xl font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                              placeholder="0"
                            />
                            {validationErrors.cartons && (
                              <p className="text-red-500 dark:text-red-400 text-xs mt-1">{validationErrors.cartons}</p>
                            )}
                          </div>

                          {/* Total Amount */}
                          <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-500 uppercase tracking-widest mb-2">
                              Total Amount (¥) *
                            </label>
                            <input
                              type="number"
                              value={finalShipmentAmount || ''}
                              onChange={(e) => setFinalShipmentAmount(parseFloat(e.target.value) || 0)}
                              className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-3 text-xl font-bold text-emerald-600 dark:text-emerald-400 focus:ring-2 focus:ring-emerald-500 outline-none"
                            />
                            {!validationErrors.amount && finalShipmentAmount > 0 && (
                              <p className="text-slate-400 dark:text-slate-500 text-[11px] mt-1 italic">Auto-filled from invoice — edit if needed.</p>
                            )}
                            {validationErrors.amount && (
                              <p className="text-red-500 dark:text-red-400 text-xs mt-1">{validationErrors.amount}</p>
                            )}
                          </div>

                          {/* Invoice Number */}
                          <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-500 uppercase tracking-widest mb-2">
                              Invoice Number
                            </label>
                            <input
                              type="text"
                              value={invoiceNumber}
                              onChange={(e) => setInvoiceNumber(e.target.value)}
                              className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                              placeholder="Optional"
                            />
                          </div>

                          {/* Invoice Date */}
                          <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-500 uppercase tracking-widest mb-2">
                              Invoice Date
                            </label>
                            <input
                              type="date"
                              value={invoiceDate}
                              onChange={(e) => setInvoiceDate(e.target.value)}
                              className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                          </div>

                          {/* Carrier */}
                          <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-500 uppercase tracking-widest mb-2">
                              Carrier
                            </label>
                            <input
                              type="text"
                              value={carrier}
                              onChange={(e) => setCarrier(e.target.value)}
                              className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                              placeholder="e.g. FedEx, DHL, UPS"
                            />
                          </div>

                          {/* Expected Delivery */}
                          <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-500 uppercase tracking-widest mb-2">
                              Expected Delivery
                            </label>
                            <input
                              type="date"
                              value={expectedDelivery}
                              onChange={(e) => setExpectedDelivery(e.target.value)}
                              className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                          </div>

                          {/* Notes */}
                          <div>
                            <label className="block text-xs font-bold text-slate-600 dark:text-slate-500 uppercase tracking-widest mb-2">
                              Notes
                            </label>
                            <textarea
                              value={notes}
                              onChange={(e) => setNotes(e.target.value)}
                              rows={3}
                              className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-4 py-2 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none resize-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                              placeholder="Add any notes about this shipment..."
                            />
                          </div>
                        </div>
                      </Card>
                    </div>
                  </div>
                  
                  {DEV_MODE_SKIP_SHIPMENT_WRITE && (
                    <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/30 rounded-lg px-4 py-2.5">
                      <ExclamationTriangleIcon className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        <span className="font-bold uppercase tracking-wider">Dev Mode</span> — Finalize will not write to Batches/Vendor_Shipments/Purchase Orders. Only the Google Drive document upload will run.
                      </p>
                    </div>
                  )}

                  {/* Recap before final submission */}
                  <Card className="bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 p-5">
                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-4">
                      Review before you finalize
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <div>
                        <p className="text-slate-500 dark:text-slate-400 text-[10px] uppercase font-bold mb-1">Vendor</p>
                        <p className="text-slate-800 dark:text-white font-bold font-mono">{vendorCode || '—'}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400 text-[10px] uppercase font-bold mb-1">Batch</p>
                        <p className="text-slate-800 dark:text-white font-bold">
                          {batchOption === 'new'
                            ? `New (${shippingMode || '—'})`
                            : (selectedBatchId || 'Not selected')}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400 text-[10px] uppercase font-bold mb-1">Total Cartons</p>
                        <p className="text-slate-800 dark:text-white font-bold">{cartonCount || 0}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400 text-[10px] uppercase font-bold mb-1">Total Amount</p>
                        <p className="text-emerald-600 dark:text-emerald-400 font-bold">¥{fmtNumber(finalShipmentAmount || 0, 2)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 dark:text-slate-400 text-[10px] uppercase font-bold mb-1">Items</p>
                        <p className="text-slate-800 dark:text-white font-bold">{allocationData.length} SKUs</p>
                      </div>
                    </div>
                  </Card>

                  <div className="flex justify-between pt-8 border-t border-slate-800">
                    <Button
                      variant="secondary"
                      onClick={() => setActiveTab('Review')}
                      icon={<ArrowLeftIcon className="w-4 h-4"/>}
                    >
                      Back to Review
                    </Button>
                    <Button
                      onClick={handleFinalizeShipment}
                      disabled={isCreatingShipment}
                      className="bg-blue-600 hover:bg-blue-700 font-bold h-12 px-12 shadow-xl disabled:opacity-50"
                    >
                      {isCreatingShipment
                        ? 'Processing...'
                        : DEV_MODE_SKIP_SHIPMENT_WRITE ? 'Finalize (Dev Mode — Drive Upload Only)' : 'Finalize & Record Shipment'}
                    </Button>
                  </div>
                </div>
            )}

            {/* Success Screen */}
            {activeTab === 'Creation' && shipmentSuccess && (
              <div className="flex flex-col items-center justify-center py-24 animate-in fade-in duration-500">
                <div className="w-24 h-24 bg-emerald-500/10 rounded-full flex items-center justify-center mb-6">
                  <CheckIcon className="w-12 h-12 text-emerald-400" />
                </div>
                
                <h2 className="text-3xl font-bold text-white mb-2">Shipment Created Successfully!</h2>
                <p className="text-slate-400 mb-1">Your vendor shipment has been recorded</p>
                <p className="text-2xl font-mono font-bold text-blue-400 mb-8">{createdShipmentId}</p>
                
                <div className="flex gap-4">
                  <Button
                    onClick={() => {
                      setShipmentSuccess(false);
                      clearSelection();
                    }}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Create Another Shipment
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (onNavigate) {
                        onNavigate('Dashboard');
                      }
                    }}
                  >
                    Go to Dashboard
                  </Button>
                </div>

                {showDebug && (
                  <div className="w-full max-w-4xl mt-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Last Request Payload</span>
                      <pre className="bg-slate-900 border border-slate-800 p-4 rounded-lg text-[10px] font-mono text-slate-400 overflow-auto max-h-[300px]">
                        {lastRequest ? JSON.stringify(lastRequest, null, 2) : '// No request sent yet'}
                      </pre>
                    </div>
                    <div className="space-y-2">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Last Server Response</span>
                      <pre className="bg-slate-900 border border-slate-800 p-4 rounded-lg text-[10px] font-mono text-slate-400 overflow-auto max-h-[300px]">
                        {lastResponse ? JSON.stringify(lastResponse, null, 2) : '// No response received yet'}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Preview PO Modal - grouped by vendor, confirm before any PO is created */}
            {showPreviewPOModal && (() => {
              const items = getUnallocatedItems();
              const groups: {[vendorCode: string]: typeof items} = {};
              items.forEach(it => {
                if (!groups[it.vendor_code]) groups[it.vendor_code] = [];
                groups[it.vendor_code].push(it);
              });
              const vendorCodes = Object.keys(groups);

              return (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                  <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-bold text-slate-800 dark:text-white">Preview Purchase Orders</h3>
                      <button onClick={() => { setShowPreviewPOModal(false); setBackendError(null); }}>
                        <XMarkIcon className="w-5 h-5 text-slate-400 hover:text-slate-700 dark:hover:text-white" />
                      </button>
                    </div>

                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                      Nothing is created until you confirm. One Purchase Order will be created per vendor below, and vendor emails will be sent immediately after creation.
                    </p>

                    <div className="space-y-4 mb-4">
                      {vendorCodes.map(code => {
                        const lines = groups[code];
                        const vendorName = vendorMasters.find(v => v.vendor_code === code)?.vendor_name || code;
                        const totalQty = lines.reduce((sum, l) => sum + Number(l.qty || 0), 0);
                        const estimatedTotal = lines.reduce((sum, l) => sum + (Number(l.qty || 0) * Number(l.unit_price || 0)), 0);

                        return (
                          <div key={code} className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-transparent rounded-lg p-4">
                            <div className="grid grid-cols-2 gap-4 text-sm mb-3">
                              <div>
                                <p className="text-slate-500 dark:text-slate-400 text-xs">Vendor</p>
                                <p className="text-slate-800 dark:text-white font-bold">{vendorName}</p>
                              </div>
                              <div>
                                <p className="text-slate-500 dark:text-slate-400 text-xs">Vendor Code</p>
                                <p className="text-slate-800 dark:text-white font-bold font-mono">{code}</p>
                              </div>
                              <div>
                                <p className="text-slate-500 dark:text-slate-400 text-xs">SKUs</p>
                                <p className="text-slate-800 dark:text-white font-bold">{lines.length}</p>
                              </div>
                              <div>
                                <p className="text-slate-500 dark:text-slate-400 text-xs">Total Qty</p>
                                <p className="text-slate-800 dark:text-white font-bold">{totalQty}</p>
                              </div>
                              {estimatedTotal > 0 && (
                                <div className="col-span-2">
                                  <p className="text-slate-500 dark:text-slate-400 text-xs">Estimated Order Total</p>
                                  <p className="text-emerald-600 dark:text-emerald-400 font-bold">{fmtNumber(estimatedTotal, 2)}</p>
                                </div>
                              )}
                            </div>

                            <div className="bg-white dark:bg-slate-800/30 border border-slate-200 dark:border-transparent rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                              {lines.map(item => (
                                <div key={item.sku} className="flex justify-between items-center text-xs bg-slate-100 dark:bg-slate-800 rounded px-3 py-2">
                                  <div>
                                    <span className="font-mono text-blue-600 dark:text-blue-400 font-bold">{item.sku}</span>
                                    <span className="text-slate-500 dark:text-slate-400 ml-2">{item.sku_name}</span>
                                  </div>
                                  <span className="text-slate-800 dark:text-white font-bold">{item.qty} units</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="space-y-3">
                      {backendError && (
                        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded p-3">
                          <p className="text-red-600 dark:text-red-400 text-sm">{backendError}</p>
                        </div>
                      )}

                      <div className="flex justify-end gap-3">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setShowPreviewPOModal(false);
                            setBackendError(null);
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={() => handleCreatePOsDirect()}
                          disabled={isProcessing}
                          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                        >
                          {isProcessing ? (
                            <>
                              <ArrowPathIcon className="w-4 h-4 mr-2 animate-spin" />
                              Creating...
                            </>
                          ) : (
                            <>
                              <PlusIcon className="w-4 h-4 mr-2" />
                              Create Purchase Orders
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </Card>
                </div>
              );
            })()}

            {/* PO Creation Result Modal */}
            {showPOResultModal && poCreationResults.length > 0 && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 p-6 max-w-md w-full">
                  <div className="text-center mb-4">
                    <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckIcon className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-1">Purchase Order Creation</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                      {poCreationResults.filter(r => r.success).length} of {poCreationResults.length} vendor(s) processed successfully
                    </p>
                  </div>

                  <div className="space-y-3 mb-4">
                    {poCreationResults.map(result => (
                      <div key={result.vendor_code} className={`rounded-lg p-3 text-left border ${result.success ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20' : 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20'}`}>
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-mono font-bold text-slate-600 dark:text-slate-300">{result.vendor_code}</span>
                          {result.success ? (
                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Created & Emailed</span>
                          ) : (
                            <span className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase">Failed</span>
                          )}
                        </div>
                        {result.success ? (
                          <p className="text-blue-600 dark:text-blue-400 font-mono font-bold text-sm mt-1">{result.po_id}</p>
                        ) : (
                          <>
                            <p className="text-red-600 dark:text-red-300 text-xs mt-1">{result.error}</p>
                            <Button
                              variant="secondary"
                              onClick={() => {
                                const retryLines = getUnallocatedItems().filter(l => l.vendor_code === result.vendor_code);
                                handleCreatePOsDirect(retryLines, result.vendor_code);
                              }}
                              disabled={isRetryingVendor === result.vendor_code}
                              className="mt-2 text-xs h-8 border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-500/10"
                            >
                              <ArrowPathIcon className={`w-3 h-3 mr-1 ${isRetryingVendor === result.vendor_code ? 'animate-spin' : ''}`} />
                              {isRetryingVendor === result.vendor_code ? 'Retrying...' : 'Retry'}
                            </Button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>

                  <Button
                    variant="secondary"
                    onClick={() => {
                      setShowPOResultModal(false);
                      setPoCreationResults([]);
                    }}
                    className="w-full"
                  >
                    Close
                  </Button>
                </Card>
              </div>
            )}

            {/* Drive Document Upload Result Modal */}
            {showDriveUploadModal && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 p-6 max-w-md w-full max-h-[85vh] overflow-y-auto">
                  <div className="text-center mb-4">
                    <div className="w-16 h-16 bg-blue-100 dark:bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <ArchiveBoxIcon className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-1">Shipment Documents</h3>
                    <p className="text-slate-500 dark:text-slate-400 text-sm">
                      {driveUploadResults.filter(r => r.status === 'uploaded' || r.status === 'used_existing').length} of {driveUploadResults.length} file(s) stored in Drive
                    </p>
                    {driveFolderInfo && (
                      <a
                        href={driveFolderInfo.folderUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 dark:text-blue-400 text-xs underline mt-1 inline-block"
                      >
                        Open shipment folder in Drive
                      </a>
                    )}
                  </div>

                  <div className="space-y-3 mb-4">
                    {driveUploadResults.map(result => (
                      <div
                        key={result.fileName}
                        className={`rounded-lg p-3 text-left border ${
                          result.status === 'uploaded' || result.status === 'used_existing'
                            ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
                            : result.status === 'conflict'
                            ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20'
                            : 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20'
                        }`}
                      >
                        <div className="flex justify-between items-center gap-2">
                          <span className="text-xs font-mono font-bold text-slate-600 dark:text-slate-300 truncate">{result.fileName}</span>
                          {(result.status === 'uploaded' || result.status === 'used_existing') && (
                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase whitespace-nowrap">
                              {result.status === 'used_existing' ? 'Existing File Used' : 'Uploaded'}
                            </span>
                          )}
                          {result.status === 'conflict' && (
                            <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase whitespace-nowrap">Already Exists</span>
                          )}
                          {result.status === 'failed' && (
                            <span className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase whitespace-nowrap">Failed</span>
                          )}
                        </div>

                        {result.status === 'conflict' && (
                          <div className="mt-2 space-y-2">
                            <p className="text-amber-700 dark:text-amber-300 text-xs">
                              A file named "{result.fileName}" already exists in this shipment's folder.
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="secondary"
                                onClick={() => handleResolveDriveConflict(result.fileName, 'replace')}
                                disabled={resolvingConflict === result.fileName}
                                className="text-xs h-8"
                              >
                                Replace
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => handleResolveDriveConflict(result.fileName, 'keep_both')}
                                disabled={resolvingConflict === result.fileName}
                                className="text-xs h-8"
                              >
                                Keep Both
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() => handleResolveDriveConflict(result.fileName, 'use_existing')}
                                disabled={resolvingConflict === result.fileName}
                                className="text-xs h-8"
                              >
                                Use Existing
                              </Button>
                            </div>
                          </div>
                        )}

                        {result.status === 'failed' && (
                          <>
                            <p className="text-red-600 dark:text-red-300 text-xs mt-1">{result.error}</p>
                            <Button
                              variant="secondary"
                              onClick={() => handleRetryDriveUpload(result.fileName)}
                              disabled={resolvingConflict === result.fileName}
                              className="mt-2 text-xs h-8 border-red-300 dark:border-red-500/30 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-500/10"
                            >
                              <ArrowPathIcon className={`w-3 h-3 mr-1 ${resolvingConflict === result.fileName ? 'animate-spin' : ''}`} />
                              {resolvingConflict === result.fileName ? 'Retrying...' : 'Retry'}
                            </Button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>

                  <Button
                    onClick={() => {
                      setShowDriveUploadModal(false);
                      setShipmentSuccess(true);
                    }}
                    className="bg-blue-600 hover:bg-blue-700 w-full"
                  >
                    Continue
                  </Button>
                </Card>
              </div>
            )}

            {/* Debug Panel Section */}
            <div className="pt-8 mt-auto border-t border-slate-200 dark:border-slate-800/50">
                <button 
                    onClick={() => setShowDebug(!showDebug)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 hover:bg-slate-250 dark:hover:border-blue-500 text-[11px] font-bold text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 uppercase tracking-widest transition-all mb-4"
                >
                    <ArrowPathIcon className={`w-4 h-4 ${isProcessing || allocationLoading || reviewLoading || isRefreshingAllocation || isCreatingShipment ? 'animate-spin' : ''}`} />
                    {showDebug ? 'Hide Debug Info' : 'Show Network Debug Info'}
                </button>

                {showDebug && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-in slide-in-from-bottom-2 duration-200">
                        <div className="space-y-2">
                            <span className="text-[10px] font-bold text-slate-500 uppercase">Last Request Payload</span>
                            <pre className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-lg text-[10px] font-mono text-slate-800 dark:text-slate-400 overflow-auto max-h-[400px]">
                                {lastRequest ? JSON.stringify(lastRequest, null, 2) : '// No request sent yet'}
                            </pre>
                        </div>
                        <div className="space-y-2">
                            <span className="text-[10px] font-bold text-slate-500 uppercase">Last Server Response</span>
                            <pre className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-lg text-[10px] font-mono text-slate-800 dark:text-slate-400 overflow-auto max-h-[400px]">
                                {lastResponse ? JSON.stringify(lastResponse, null, 2) : '// No response received yet'}
                            </pre>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const HEADER_KEYWORDS = ['item', 'no', 'qty', 'pcs', 'price', 'amount', 'description', 'name', 'total', 'ctns', 'carton', 'ean', 'code'];

const normalizeHeader = (h: string): string =>
  String(h)
    .toLowerCase()
    .trim()
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[()（）]/g, '')
    .trim();

const COLUMN_MAP: Record<string, string> = {
    // Item name variations
    'name': 'item_name',
    'item name': 'item_name',
    'description': 'item_name',
    'descriptions': 'item_name',
    'descriptions ': 'item_name',
    'product name': 'item_name',
    'desc': 'item_name',

    // Factory code variations
    'item no': 'factory_code',
    'item no.': 'factory_code',
    'item': 'factory_code',
    'article no': 'factory_code',
    'article number': 'factory_code',
    'model': 'factory_code',
    'model no': 'factory_code',
    'sku': 'factory_code',
    'article': 'factory_code',
    'id': 'factory_code',
    'factory code': 'factory_code',

    // My ID
    'my id': 'my_id',

    // Color
    'color': 'color',

    // Quantity variations
    'total pcs': 'invoice_qty',
    'qty pcs': 'invoice_qty',
    'qty': 'invoice_qty',
    'total qty': 'invoice_qty',
    'pcs': 'invoice_qty',
    'quantity': 'invoice_qty',
    'qtypcs': 'invoice_qty',

    // Carton variations
    'total ctn': 'carton_count',
    'total ctns': 'carton_count',
    'ctns': 'carton_count',
    'ctn': 'carton_count',
    'cartons': 'carton_count',
    'order ctn': 'carton_count',
    'total cartons': 'carton_count',

    // Price variations
    'price': 'unit_price_base',
    'exw price rmb': 'unit_price_base',
    'exw price': 'unit_price_base',
    'unit price': 'unit_price_base',
    'unit price rmb': 'unit_price_base',

    // EAN variations
    'ean': 'ean',
    'barcode': 'ean',

    // Bifurcated pricing
    'box': 'unit_price_box',
    'blister': 'unit_price_blister',
    'manual': 'unit_price_manual',

    // Amount variations
    'total amount': 'total_amount',
    'amount': 'total_amount',
    'total price': 'total_amount',
};

// Logic: Smart Vendor File Parser
const parseVendorFile = async (file: File): Promise<any> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                // STEP 1 - Read raw sheet into 2D array
                const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
                
                if (rawData.length === 0) {
                    resolve({ rows: [], invoiceMeta: { invoiceNo: '', invoiceDate: '' }, detectionInfo: null });
                    return;
                }

                // STEP 2 - Auto-detect header row
                let headerRowIndex = -1;
                for (let i = 0; i < Math.min(rawData.length, 15); i++) {
                    const row = rawData[i];
                    let score = 0;
                    row.forEach(cell => {
                        const val = String(cell).toLowerCase().trim();
                        if (HEADER_KEYWORDS.some(kw => val.includes(kw))) {
                            score++;
                        }
                    });
                    if (score >= 3) {
                        headerRowIndex = i;
                        break;
                    }
                }

                if (headerRowIndex === -1) {
                    resolve({ rows: [], invoiceMeta: { invoiceNo: '', invoiceDate: '' }, detectionInfo: null });
                    return;
                }

                const headerRow = rawData[headerRowIndex];

                // STEP 3 - Auto-detect data start row
                let dataStartRowIndex = -1;
                const unitLabels = ['kg', 'cm', '---', '====', 'cbm', 'pcs'];
                for (let i = headerRowIndex + 1; i < rawData.length; i++) {
                    const row = rawData[i];
                    const nonEmptyCells = row.filter(cell => String(cell).trim() !== "");
                    
                    if (nonEmptyCells.length === 0) continue;
                    if (nonEmptyCells.length / headerRow.length < 0.3) continue;

                    const isOnlyLabels = row.every(cell => {
                        const val = String(cell).toLowerCase().trim();
                        return val === "" || unitLabels.includes(val) || /^[=\-]+$/.test(val);
                    });
                    if (isOnlyLabels) continue;

                    dataStartRowIndex = i;
                    break;
                }

                if (dataStartRowIndex === -1) dataStartRowIndex = headerRowIndex + 1;

                // STEP 4 - Parse invoice metadata
                let invoiceNo = '';
                let invoiceDate = '';
                for (let i = 0; i < headerRowIndex; i++) {
                    const row = rawData[i];
                    for (let j = 0; j < row.length; j++) {
                        const cellVal = String(row[j]).trim();
                        const lowVal = cellVal.toLowerCase();
                        
                        if (lowVal.includes('pi') || lowVal.includes('invoice no') || lowVal.includes('pi no')) {
                            if (cellVal.includes(':')) {
                                invoiceNo = cellVal.split(':')[1].trim();
                            } else if (j + 1 < row.length) {
                                invoiceNo = String(row[j+1]).trim();
                            }
                        }
                        
                        if (lowVal.includes('date')) {
                            if (cellVal.includes(':')) {
                                invoiceDate = cellVal.split(':')[1].trim();
                            } else if (j + 1 < row.length) {
                                invoiceDate = String(row[j+1]).trim();
                            }
                        }
                    }
                }

                // STEP 5 - Build column map
                const columnMap: Record<number, string> = {};
                const columnsFound: string[] = [];
                const columnsSkipped: string[] = [];
                
                let hasPrice = false;
                let hasBifurcatedPart = false;

                headerRow.forEach((cell, idx) => {
                    const val = normalizeHeader(String(cell));
                    const canonical = COLUMN_MAP[val];
                    if (canonical) {
                        columnMap[idx] = canonical;
                        columnsFound.push(canonical);
                        if (canonical === 'unit_price_base') hasPrice = true;
                        if (['unit_price_box', 'unit_price_blister', 'unit_price_manual'].includes(canonical)) hasBifurcatedPart = true;
                    } else {
                        if (String(cell).trim()) columnsSkipped.push(String(cell).trim());
                    }
                });

                const isBifurcated = hasPrice && hasBifurcatedPart;

                // FIX 3 - Bifurcated 'total' column mapping
                if (isBifurcated) {
                    headerRow.forEach((cell, idx) => {
                        const val = normalizeHeader(String(cell));
                        if (val === 'total' && !columnMap[idx]) {
                            columnMap[idx] = 'unit_price_total';
                            columnsFound.push('unit_price_total');
                        }
                    });
                }

                // STEP 6 - Parse data rows
                const parsedRows: any[] = [];
                for (let i = dataStartRowIndex; i < rawData.length; i++) {
                    const row = rawData[i];
                    const nonEmptyCells = row.filter(cell => String(cell).trim() !== "");
                    if (nonEmptyCells.length === 0) continue;

                    const firstNonEmpty = String(nonEmptyCells[0]).toLowerCase().trim();
                    const skipPatterns = ['total', 'sum', 'sum:', 'subtotal', 'grand total', 'discount', 'ps:', 'bank', 'note', 'container', '============'];
                    if (skipPatterns.some(p => firstNonEmpty.startsWith(p) || firstNonEmpty === p)) continue;
                    if (/^[=\-]+$/.test(firstNonEmpty)) continue;

                    const rowObj: any = {};
                    Object.entries(columnMap).forEach(([idx, canonical]) => {
                        const val = row[Number(idx)];
                        rowObj[canonical] = val;
                    });

                    const invoice_qty = toNum(rowObj.invoice_qty);
                    const unit_price_base = toNum(rowObj.unit_price_base);
                    const unit_price_box = toNum(rowObj.unit_price_box);
                    const unit_price_blister = toNum(rowObj.unit_price_blister);
                    const unit_price_manual = toNum(rowObj.unit_price_manual);
                    let unit_price_total = toNum(rowObj.unit_price_total);
                    
                    // FIX 5 - unit_price_total fallback
                    if (!unit_price_total || unit_price_total === 0) {
                        unit_price_total = unit_price_base;
                    }

                    const total_amount = toNum(rowObj.total_amount);
                    
                    // FIX 4 - item_name value cleaning
                    const item_name = String(rowObj.item_name || "")
                        .replace(/\n/g, ' ')
                        .replace(/\r/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();

                    const factoryCodeCols = Object.entries(columnMap)
                        .filter(([_, canonical]) => canonical === 'factory_code')
                        .map(([idx]) => String(row[Number(idx)] || "").trim())
                        .filter(v => v !== "");
                    const factory_code = factoryCodeCols.join('|');

                    const ean = String(rowObj.ean || "").trim();
                    const carton_count = toNum(rowObj.carton_count);
                    const my_id = String(rowObj.my_id || "").trim();
                    const color = String(rowObj.color || "").trim();

                    if (!item_name && !factory_code && !ean && invoice_qty === 0) continue;

                    parsedRows.push({
                        factory_code,
                        item_name,
                        invoice_qty,
                        carton_count,
                        ean,
                        my_id,
                        color,
                        unit_price_base,
                        unit_price_box,
                        unit_price_blister,
                        unit_price_manual,
                        unit_price_total,
                        unit_price: unit_price_total,
                        total_amount,
                        total_price: unit_price_total * invoice_qty
                    });
                }

                resolve({
                    rows: parsedRows,
                    invoiceMeta: { invoiceNo, invoiceDate },
                    detectionInfo: {
                        headerRow: headerRowIndex,
                        dataStartRow: dataStartRowIndex,
                        isBifurcated,
                        columnsFound: Array.from(new Set(columnsFound)),
                        columnsSkipped: Array.from(new Set(columnsSkipped))
                    }
                });

            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
    });
};

// Logic: Basic SheetJS Parser
const parseFileToRows = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
                resolve(json);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsArrayBuffer(file);
    });
};