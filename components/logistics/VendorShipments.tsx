
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
  MagnifyingGlassIcon
} from '../icons/Icons';
import { ViewType, APPS_SCRIPT_URL, API_ACTIONS } from '../../App';
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

/**
 * Calculate actual cost after landing
 * Formula: ROUNDUP((1 - min(2.5% + price/2000, 0.1)) × conv_rate × price, 0)
 * conv_rate is hardcoded to 17.55 for now
 */
const calculateActualCost = (invoicePrice: number): number => {
  const convRate = 17.55; // Hardcoded for now, will come from settings later
  const minValue = Math.min(0.025 + (invoicePrice / 2000), 0.1);
  const actualCost = (1 - minValue) * convRate * invoicePrice;
  return Math.ceil(actualCost); // ROUNDUP equivalent
};

/**
 * Calculate price difference and percentage
 * Returns: { diff: number, percentage: number }
 */
const calculatePriceDiff = (invoicePrice: number, masterCost: number): { diff: number; percentage: number } => {
  const calculatedCost = calculateActualCost(invoicePrice);
  const diff = calculatedCost - masterCost;
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
  if (days > 90) return 'text-red-400';
  if (days > 30) return 'text-yellow-400';
  return 'text-green-400';
};

// --- Local UI Helper Components ---

const Badge: React.FC<{
  children: React.ReactNode;
  variant?: 'default' | 'outline' | 'success' | 'destructive' | 'warning' | 'info';
  className?: string;
  title?: string;
}> = ({ children, variant = 'default', className = '', title }) => {
  const variants = {
    default: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:border-transparent',
    outline: 'bg-transparent text-slate-600 border-slate-400 dark:text-slate-400 dark:border-slate-700',
    success: 'bg-green-100 text-green-800 border-green-300 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20',
    destructive: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20',
    warning: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/20',
    info: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20',
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
        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-[10px] text-slate-300 focus:ring-1 focus:ring-blue-500 outline-none"
      />

      {isOpen && filteredOptions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl max-h-60 overflow-auto">
          {filteredOptions.map((option, idx) => (
            <div
              key={option.id}
              onClick={() => {
                onChange(option.id);
                setIsOpen(false);
                setSearchQuery('');
              }}
              onMouseEnter={() => setHighlightedIndex(idx)}
              className={`px-3 py-2 cursor-pointer text-[10px] ${idx === highlightedIndex
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-800'
                }`}
            >
              <div className="font-medium truncate">{option.name}</div>
              <div className="text-[9px] text-slate-500 font-mono">{option.id}</div>
            </div>
          ))}
        </div>
      )}

      {isOpen && filteredOptions.length === 0 && searchQuery && (
        <div className="absolute z-50 w-full mt-1 bg-slate-900 border border-slate-700 rounded p-3 text-center text-[10px] text-slate-500">
          No matches found
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
  resolution_notes?: string;
  partial_match_reason?: string;
  name_similarity?: number;
  price_diff_percentage?: number;
  show_override?: boolean; // For "Change SKU" UI state
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

type ShipmentTab = 'Setup' | 'Validation' | 'Allocation' | 'Review' | 'Creation';

export const VendorShipments: React.FC<VendorShipmentsProps> = ({ onNavigate, vendorMasters, productMasterList: initialProductMasterList = [] }) => {
  // Component State
  const [activeTab, setActiveTab] = useState<ShipmentTab>('Setup');
  const [vendorCode, setVendorCode] = useState('');
  const [shippingMode, setShippingMode] = useState<'SEA' | 'AIR' | ''>('');
  const [uploadedFiles, setUploadedFiles] = useState<any[]>([]);
  const [shipmentDate, setShipmentDate] = useState(new Date().toISOString().split('T')[0]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
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
  const [statusFilter, setStatusFilter] = useState<'ALL' | MatchStatus>('ALL');

  // Product master state
  const [productMasterList, setProductMasterList] = useState<Array<{ id: string; name: string; cost: number }>>([]);

  // Allocation & Creation
  const [allocationData, setAllocationData] = useState<AllocationItem[]>([]);
  const [allocationSummary, setAllocationSummary] = useState<any>(null);
  const [allocationLoading, setAllocationLoading] = useState(false);
  const [expandedRows, setExpandedRows] = useState<{ [key: string]: boolean }>({});

  // Review & Final Validation State
  const [reviewData, setReviewData] = useState<any>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [isRefreshingAllocation, setIsRefreshingAllocation] = useState(false);
  const [canProceedToCreation, setCanProceedToCreation] = useState(false);
  const [expandedWarnings, setExpandedWarnings] = useState<{ [key: string]: boolean }>({});
  const [showCreatePOModal, setShowCreatePOModal] = useState(false);
  const [createdDraftId, setCreatedDraftId] = useState<string | null>(null);
  const [showDraftSuccessModal, setShowDraftSuccessModal] = useState(false);
  const [detectionInfo, setDetectionInfo] = useState<any>(null);
  const [invoiceMetaNotice, setInvoiceMetaNotice] = useState<{ no: string, date: string } | null>(null);

  // Creation States
  const [batchOption, setBatchOption] = useState<'new' | 'existing'>('new');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [openBatches, setOpenBatches] = useState<any[]>([]);
  const [newBatchId, setNewBatchId] = useState('');
  const [cartonCount, setCartonCount] = useState(0);
  const [finalShipmentAmount, setFinalShipmentAmount] = useState(0);
  const [notes, setNotes] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [carrier, setCarrier] = useState('');
  const [expectedDelivery, setExpectedDelivery] = useState('');
  const [validationErrors, setValidationErrors] = useState<{ [key: string]: string }>({});
  const [isCreatingShipment, setIsCreatingShipment] = useState(false);
  const [shipmentSuccess, setShipmentSuccess] = useState(false);
  const [createdShipmentId, setCreatedShipmentId] = useState('');

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
    if (severity === 'BLOCKING') return 'border-red-500 bg-red-500/5';
    if (severity === 'WARNING') return 'border-yellow-500 bg-yellow-500/5';
    return 'border-blue-500 bg-blue-500/5';
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
    setShipmentDate('');
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

    // Clear saved draft from localStorage
    localStorage.removeItem('vendor_shipment_draft');
  }, []);

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
          setShipmentDate(parsed.shipmentDate || '');
          setShippingMode(parsed.shippingMode || '');
          setValidationRows(parsed.validationRows || []);
          setAllocationData(parsed.allocationData || []);
          setAllocationSummary(parsed.allocationSummary || null);
          setReviewData(parsed.reviewData || null);
          setCanProceedToCreation(parsed.canProceedToCreation || false);
          setActiveTab(parsed.activeTab || 'Setup');
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

  // Generate New Batch ID Preview
  useEffect(() => {
    if (batchOption === 'new') {
      if (shippingMode) {
        const year = String(new Date().getFullYear()).slice(-2);
        const prefix = shippingMode === 'AIR' ? 'A' : 'S';
        setNewBatchId(`${prefix}-${year}XXX (Auto-generated)`);
      } else {
        setNewBatchId('Select a shipping mode in Setup first');
      }
    }
  }, [batchOption, shippingMode]);

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
            cost: toNum(p.cost)
          })));
        } else if (initialProductMasterList.length > 0) {
          setProductMasterList(initialProductMasterList.map(p => ({
            id: p.id,
            name: p.name,
            cost: p.cost
          })));
        }
      } catch (error) {
        console.error('Failed to load product master:', error);
        if (initialProductMasterList.length > 0) {
          setProductMasterList(initialProductMasterList.map(p => ({
            id: p.id,
            name: p.name,
            cost: p.cost
          })));
        }
      }
    };

    loadProductMaster();
  }, [initialProductMasterList]);

  // Filter Logic
  const filteredRows = useMemo(() => {
    if (statusFilter === 'ALL') return validationRows;
    return validationRows.filter(r => r.match_status === statusFilter);
  }, [validationRows, statusFilter]);

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
        // These are explicitly resolved — never block
        if (r.resolution_action === 'REQUEST_NEW_SKU') return false;
        if (r.resolution_action === 'REJECT_LINE') return false;
        if (r.resolution_action === 'Skip Item') return false;
        if (r.resolution_action === 'ACCEPT') return false;
        if (r.resolution_action === 'OVERRIDE') return false;

        // MATCH rows are fine without a resolution action
        if (r.match_status === 'MATCH') return false;

        // UNMATCHED with no SKU and no resolution = blocked
        if (r.match_status === 'UNMATCHED' && !r.matched_sku && !r.sku) return true;

        // MULTIPLE_MATCH / MULTIPLE_VARIANT with no SKU selected = blocked
        if (['MULTIPLE_MATCH', 'MULTIPLE_VARIANT'].includes(r.match_status) && !r.matched_sku) return true;

        // PARTIAL_MATCH and SKU_MISMATCH — need a resolution action
        if (['PARTIAL_MATCH', 'SKU_MISMATCH'].includes(r.match_status) && !r.resolution_action) return true;

        return false;
    });
    return unresolved.length === 0;
}, [validationRows, backendError]);

  // Handlers
  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const newFiles = Array.from(files).map(f => ({
      file: f,
      docType: 'INVOICE' as DocumentType,
      id: `FILE-${Math.random().toString(36).substr(2, 9)}`
    }));
    setUploadedFiles(prev => [...prev, ...newFiles]);
  };

  const handleUploadAndValidate = async () => {
    if (!vendorCode || !shippingMode || uploadedFiles.length === 0) return;
    setIsProcessing(true);
    setBackendError(null);
    setValidationRows([]);
    setDetectionInfo(null);
    setInvoiceMetaNotice(null);

    try {
      const parsedFiles = await Promise.all(uploadedFiles.map(async f => {
        if (!f.file.lastModified) return null; // Skip restored stub files
        const result = await parseVendorFile(f.file);
        return { fileName: f.file.name, documentType: f.docType, ...result };
      }));

      const validFiles = parsedFiles.filter(Boolean);
      if (validFiles.length === 0 && uploadedFiles.length > 0) {
        throw new Error("No actual files were selected. Please re-upload your documents to re-run validation.");
      }

      // Auto-fill invoice meta from the first file that has it
      const firstMeta = validFiles.find(f => f.invoiceMeta.invoiceNo || f.invoiceMeta.invoiceDate);
      if (firstMeta) {
        if (firstMeta.invoiceMeta.invoiceNo) setInvoiceNumber(firstMeta.invoiceMeta.invoiceNo);
        if (firstMeta.invoiceMeta.invoiceDate) setInvoiceDate(firstMeta.invoiceMeta.invoiceDate);
        setInvoiceMetaNotice({
          no: firstMeta.invoiceMeta.invoiceNo,
          date: firstMeta.invoiceMeta.invoiceDate
        });
      }

      // Set detection info from first file for display
      if (validFiles[0]) {
        setDetectionInfo(validFiles[0].detectionInfo);
      }

      const payload = {
        action: API_ACTIONS.UPLOAD_SHIPMENT_DOCS,
        vendorCode,
        shipmentDate,
        shippingMode,
        files: validFiles.map(f => ({
          fileName: f.fileName,
          documentType: f.documentType,
          rows: f.rows
        }))
      };
      setLastRequest(payload);

      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      setLastResponse(result);

      if (result.status === 'success') {
        setValidationRows(result.rows || []);
        setBackendIssues(result.issues || []);
        if (result.shipmentId) setInvoiceNumber(result.shipmentId);
        setActiveTab('Validation');
      } else {
        setBackendError(result.message || 'Validation Failed');
      }
    } catch (err: any) {
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
      const isResolved = row.resolution_action === 'REQUEST_NEW_SKU' ||
        row.resolution_action === 'REJECT_LINE' ||
        row.resolution_action === 'Skip Item';
      return needsSelection && hasNoSKU && !isResolved;
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

    try {
      // Filter out rejected items
      const rowsToAllocate = validationRows.filter(r => 
    r.resolution_action !== 'REJECT_LINE' && 
    r.resolution_action !== 'Skip Item' &&
    r.resolution_action !== 'REQUEST_NEW_SKU'
);

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
        setActiveTab('Allocation');
      } else {
        setBackendError(data.message || 'Allocation failed');
      }
    } catch (error: any) {
      setBackendError(error.message || 'Failed to allocate');
    } finally {
      setAllocationLoading(false);
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

  const handleRefreshAllocation = async () => {
    setIsRefreshingAllocation(true);
    setBackendError(null);

    try {
      // Re-run allocation with same validated rows
      const rowsToAllocate = validationRows.filter(r => 
    r.resolution_action !== 'REJECT_LINE' && 
    r.resolution_action !== 'Skip Item' &&
    r.resolution_action !== 'REQUEST_NEW_SKU'
);

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
          alert('Allocation refreshed successfully!');
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
    }
  };

  const handleCreateDraftFromReview = async () => {
    console.log('=== CREATE DRAFT FROM REVIEW STARTED ===');
    console.log('Shipping Mode:', shippingMode);
    console.log('Vendor Code:', vendorCode);
    console.log('Allocation Data:', allocationData);

    setIsProcessing(true);
    setBackendError(null); // Clear previous errors

    try {
      // Prepare unallocated items
      const unallocatedItems = allocationData
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

      console.log('Unallocated Items:', unallocatedItems);

      if (unallocatedItems.length === 0) {
        alert('No unallocated items to create draft');
        setIsProcessing(false);
        return;
      }

      const payload = {
        action: 'create_manual_draft',
        mode: shippingMode,
        lines: unallocatedItems
      };

      console.log('Payload:', JSON.stringify(payload, null, 2));
      console.log('APPS_SCRIPT_URL:', APPS_SCRIPT_URL);

      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });

      console.log('Response status:', response.status);
      console.log('Response ok:', response.ok);

      const data = await response.json();
      console.log('Response data:', data);

      if (data.status === 'success') {
        console.log('Draft created successfully:', data.draft_id);
        setCreatedDraftId(data.draft_id);
        setShowCreatePOModal(false);
        setShowDraftSuccessModal(true);
      } else {
        console.error('Backend error:', data.message);
        alert('Error: ' + (data.message || 'Failed to create draft'));
        setBackendError(data.message || 'Failed to create draft');
      }
    } catch (error: any) {
      console.error('Caught error:', error);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      alert('Error: ' + (error.message || 'Failed to create draft'));
      setBackendError(error.message || 'Failed to create draft');
    } finally {
      console.log('=== CREATE DRAFT FINISHED ===');
      setIsProcessing(false);
    }
  };

  const validateCreation = () => {
    const errors: { [key: string]: string } = {};

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

  const handleFinalizeShipment = async () => {
    if (!validateCreation()) {
      return;
    }

    setIsCreatingShipment(true);

    try {
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
        setShipmentSuccess(true);
        // Clear draft from localStorage
        localStorage.removeItem('vendor_shipment_draft');
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
    <div className="flex flex-col h-full space-y-6 text-gray-900 dark:text-white p-6 bg-gray-50 dark:bg-[#0f172a] min-h-screen relative">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div className="relative">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Vendor Shipment Entry</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Ingest vendor documents and reconcile matches</p>

          <div className="flex items-center gap-3 mt-2 h-6">
            {validationRows.length > 0 && activeTab !== 'Setup' && (
              <div className="flex items-center gap-2">
                <Badge variant="info" className="text-[8px]">📋 DRAFT RESTORED</Badge>
                <button
                  onClick={clearSelection}
                  className="text-[9px] text-slate-500 hover:text-red-400 underline"
                >
                  Start New
                </button>
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

      {/* Tab Navigation */}
      <div className="flex gap-8 border-b border-gray-200 dark:border-slate-800 px-1">
        {(['Setup', 'Validation', 'Allocation', 'Review', 'Creation'] as ShipmentTab[]).map(tab => {
          const isDisabled = (tab === 'Validation' && validationRows.length === 0 && !backendError) || (tab === 'Allocation' && allocationData.length === 0) || (tab === 'Review' && !reviewData && activeTab !== 'Review');
          return (
            <button
              key={tab}
              disabled={isDisabled}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-semibold transition-all relative ${activeTab === tab ? 'text-blue-500' : 'text-slate-500 hover:text-slate-300 disabled:opacity-30'}`}
            >
              {tab}
              {activeTab === tab && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />}
            </button>
          );
        })}
      </div>

      {(isProcessing || allocationLoading || reviewLoading || isRefreshingAllocation || isCreatingShipment) && (
        <div className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-2xl flex flex-col items-center gap-4">
            <ArrowPathIcon className="w-10 h-10 animate-spin text-blue-500" />
            <p className="text-white font-bold">
              {isCreatingShipment ? 'Creating Shipment...' : isRefreshingAllocation ? 'Refreshing Allocation...' : reviewLoading ? 'Loading Review Data...' : allocationLoading ? 'Running Allocation Engine...' : 'Running Matching Engine...'}
            </p>
          </div>
        </div>
      )}

      {activeTab === 'Setup' && (
        <Card className="bg-slate-800/40 border-slate-700 p-8 space-y-8 animate-in fade-in duration-300">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Vendor *</label>
              <select value={vendorCode} onChange={(e) => setVendorCode(e.target.value)} className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg px-4 py-3 text-gray-900 dark:text-white">
                <option value="" disabled>Choose Vendor</option>
                {vendorMasters.map(v => <option key={v.vendor_code} value={v.vendor_code}>{v.vendor_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Shipment Date *</label>
              <input type="date" value={shipmentDate} onChange={(e) => setShipmentDate(e.target.value)} className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg px-4 py-3 text-gray-900 dark:text-slate-200" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Shipping Mode *</label>
              <select
                value={shippingMode}
                onChange={(e) => setShippingMode(e.target.value as 'SEA' | 'AIR')}
                className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg px-4 py-3 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="">Select mode...</option>
                <option value="SEA">Sea Freight</option>
                <option value="AIR">Air Freight</option>
              </select>
            </div>
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileSelect(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 hover:border-slate-500'}`}
          >
            <input type="file" min-0 ref={fileInputRef} className="hidden" accept=".csv,.xlsx" multiple onChange={(e) => handleFileSelect(e.target.files)} />
            <CloudArrowUpIcon className="w-10 h-10 text-slate-500 mx-auto mb-4" />
            <p className="text-sm font-semibold text-slate-300">Drag & drop Vendor Invoice / Packing List</p>
          </div>

          {uploadedFiles.length > 0 && (
            <div className="space-y-2">
              {uploadedFiles.map(f => (
                <div key={f.id} className="flex items-center justify-between bg-gray-50 dark:bg-slate-900/50 p-3 rounded-lg border border-gray-200 dark:border-slate-700">
                  <div className="flex items-center gap-3 flex-1">
                    <DocumentTextIcon className="w-4 h-4 text-slate-500" />
                    <span className="text-xs font-medium truncate">{f.file?.name || 'Unknown File'}</span>
                    {!f.file?.lastModified && <Badge variant="warning" className="text-[8px]">Action Required: Re-upload for Rerun</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={f.docType}
                      onChange={(e) => {
                        setUploadedFiles(prev => prev.map(file =>
                          file.id === f.id ? { ...file, docType: e.target.value as DocumentType } : file
                        ));
                      }}
                      className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-[10px] text-white focus:ring-1 focus:ring-blue-500 outline-none"
                    >
                      <option value="INVOICE">INVOICE</option>
                      <option value="PACKING_LIST">PACKING LIST</option>
                    </select>
                    <button onClick={() => setUploadedFiles(prev => prev.filter(x => x.id !== f.id))}>
                      <TrashIcon className="w-4 h-4 text-slate-500 hover:text-red-500" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end border-t border-slate-700 pt-6">
            <Button onClick={handleUploadAndValidate} disabled={!vendorCode || !shippingMode || uploadedFiles.length === 0}>Match SKUs & Validate</Button>
          </div>
        </Card>
      )}

      {activeTab === 'Validation' && (
        <div className="flex flex-col space-y-4 animate-in fade-in duration-300 pb-24">
          {/* Error Banner */}
          {backendError && (
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-3">
              <ExclamationTriangleIcon className="w-5 h-5 mt-0.5 text-red-500" />
              <div>
                <h4 className="font-bold text-red-500">Mapping Incomplete</h4>
                <p className="text-sm text-slate-300">{backendError}</p>
              </div>
            </div>
          )}

          {!backendError && validationRows.length > 0 && (
            <>
              {/* Detection Info & Meta Notice */}
              <div className="flex flex-col gap-2">
                {detectionInfo && (
                  <div className="bg-slate-700 rounded p-2 text-xs text-slate-300 flex items-center gap-2">
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
              <div className="flex items-center gap-6 bg-gray-100 dark:bg-slate-800/40 px-6 py-3 rounded-xl border border-gray-200 dark:border-slate-700">
                <span className="text-[10px] font-bold text-gray-500 dark:text-slate-500 uppercase tracking-widest">Summary:</span>
                <span className="text-sm font-bold text-green-700 dark:text-emerald-400">{summaryStats.matched} MATCHED</span>
                <span className="text-gray-300 dark:text-slate-600">|</span>
                <span className="text-sm font-bold text-red-600 dark:text-red-400">{summaryStats.unmatched} UNMATCHED</span>
                <span className="text-gray-300 dark:text-slate-600">|</span>
                <span className="text-sm font-bold text-amber-600 dark:text-yellow-400">{summaryStats.flagged} FLAGGED</span>
              </div>

              {/* Filter Bar & Summary */}
              <div className="flex flex-wrap justify-between items-end gap-4 bg-gray-50 dark:bg-slate-800/40 p-4 rounded-xl border border-gray-200 dark:border-slate-700">
                <div className="space-y-3">
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { label: 'All', value: 'ALL', count: summaryStats.total },
                      { label: 'Match', value: 'MATCH', count: summaryStats.matched },
                      { label: 'Unmatched', value: 'UNMATCHED', count: summaryStats.unmatched },
                      { label: 'SKU Mismatch', value: 'SKU_MISMATCH', count: validationRows.filter(r => r.match_status === 'SKU_MISMATCH').length },
                      { label: 'Multiple Match', value: 'MULTIPLE_MATCH', count: validationRows.filter(r => r.match_status === 'MULTIPLE_MATCH').length },
                      { label: 'Partial Match', value: 'PARTIAL_MATCH', count: validationRows.filter(r => r.match_status === 'PARTIAL_MATCH').length },
                      { label: 'Multiple Variant', value: 'MULTIPLE_VARIANT', count: validationRows.filter(r => r.match_status === 'MULTIPLE_VARIANT').length }
                    ].map(f => (
                      <button
                        key={f.value}
                        onClick={() => setStatusFilter(f.value as any)}
                        className={`px-3 py-1.5 rounded-full text-[10px] font-bold border transition-all ${statusFilter === f.value
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-gray-100 border-gray-300 text-gray-600 hover:border-gray-400 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-500'
                          }`}
                      >
                        {f.label} ({f.count})
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button variant="secondary" className="h-9 text-xs" onClick={() => { }}>Export Results</Button>
                  <Button variant="secondary" className="h-9 text-xs border-blue-500/30 text-blue-400 hover:bg-blue-500/10" onClick={handleAddManualLine}>
                    <PlusIcon className="w-4 h-4 mr-1" /> Add Line
                  </Button>
                  <Button className="h-9 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={handleApproveAll}>Approve All Matches</Button>
                </div>
              </div>
            </>
          )}

          {/* Table */}
          <Card className="p-0 border-slate-700 bg-slate-800/20 shadow-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse table-fixed min-w-[1100px]">
                <thead className="bg-gray-50 dark:bg-slate-900 sticky top-0 z-10 border-b border-gray-200 dark:border-slate-700">
                  <tr className="text-gray-500 dark:text-slate-400 text-[10px] uppercase tracking-wider font-bold">
                    <th className="px-2 py-3 w-[8%]">STATUS</th>
                    <th className="px-2 py-3 w-[8%]">CODES</th>
                    <th className="px-2 py-3 w-[16%]">INVOICE ITEM</th>
                    <th className="px-2 py-3 w-[8%]">SKU</th>
                    <th className="px-2 py-3 w-[16%]">MATCHED NAME</th>
                    <th className="px-2 py-3 w-[4%] text-right">QTY</th>
                    <th className="px-2 py-3 w-[6%] text-right">PRICE</th>
                    <th className="px-2 py-3 w-[6%] text-right">DIFFS</th>
                    <th className="px-2 py-3 w-[12%]">RESOLUTION</th>
                    <th className="px-2 py-3 w-[16%]">NOTES</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {filteredRows.map((row) => {
                    const status = getStatusConfig(row.match_status);
                    const factoryCodes = (row.factory_code || "").split('|').filter(c => c.trim());
                    const masterCost = toNum(row.master_cost || 0);
                    const { diff, percentage } = calculatePriceDiff(toNum(row.unit_price), masterCost);
                    const diffColor = diff > 0.01 ? 'text-red-500' : diff < -0.01 ? 'text-emerald-500' : 'text-slate-600';

                    return (
                      <tr key={row.line_id} className={`hover:bg-gray-50 dark:hover:bg-slate-700/20 transition-colors ${row.match_status === 'UNMATCHED' ? 'bg-red-50 dark:bg-red-500/5' :
                        row.match_status === 'MANUAL_ENTRY' ? 'bg-blue-50 dark:bg-blue-500/5' : ''
                        }`}>
                        {/* STATUS */}
                        <td className="px-2 py-3">
                          <div className="flex flex-col gap-1.5">
                            {row.match_status === 'MANUAL_ENTRY' ? (
                              <Badge variant="info">MANUAL ENTRY</Badge>
                            ) : (
                              <Badge variant={status.variant}>
                                {status.icon} {status.label}
                              </Badge>
                            )}
                            {row.match_type && (
                              <span className={`text-[9px] font-mono ${row.match_type === 'Manual Match'
                                ? 'text-blue-400 font-bold'
                                : 'text-slate-500'
                                }`}>
                                {row.match_type === 'Manual Match' ? '👤 Manual' : `Via: ${row.match_type}`}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* FACTORY CODES */}
                        <td className="px-2 py-3">
                          {row.match_status === 'MANUAL_ENTRY' ? (
                            <input
                              type="text"
                              value={row.factory_code}
                              onChange={(e) => handleRowChange(row.line_id, 'factory_code', e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-300 focus:ring-1 focus:ring-blue-500"
                              placeholder="Code"
                            />
                          ) : (
                            <div className="space-y-1">
                              {factoryCodes.length > 0 ? factoryCodes.map((c, i) => (
                                <div key={i} className="flex items-center gap-1.5">
                                  <span className="text-[9px] font-bold text-gray-400 dark:text-slate-500 uppercase w-5 shrink-0">
                                    {i === 0 ? 'ID' : 'FC'}
                                  </span>
                                  <span className="text-[11px] font-mono font-semibold text-gray-800 dark:text-slate-200">{c}</span>
                                </div>
                              )) : <span className="text-gray-300 dark:text-slate-600 text-xs">—</span>}
                            </div>
                          )}
                        </td>

                        {/* INVOICE ITEM NAME */}
                        <td className="px-2 py-3">
                          {row.match_status === 'MANUAL_ENTRY' ? (
                            <input
                              type="text"
                              value={row.item_name}
                              onChange={(e) => handleRowChange(row.line_id, 'item_name', e.target.value)}
                              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-300 focus:ring-1 focus:ring-blue-500"
                              placeholder="Item Name"
                            />
                          ) : (
                            <div>
                              <p className="text-[12px] font-semibold text-gray-900 dark:text-slate-100 leading-snug">
                                {row.item_name || <span className="text-gray-300 dark:text-slate-600 italic">—</span>}
                              </p>
                              {row.color && (
                                <p className="text-[11px] text-gray-500 dark:text-slate-500 mt-0.5">{row.color}</p>
                              )}
                            </div>
                          )}
                        </td>

                        {/* MATCHED SKU */}
                        <td className="px-2 py-3">
                          {row.match_status === 'MATCH' ? (
                            <div className="space-y-1">
                              <p className="font-mono text-blue-600 dark:text-blue-400 text-[12px] font-bold">
                                {row.matched_sku || row.sku}
                              </p>
                              {row.my_id && (
                                row.my_id_check === true ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-800 border border-green-300 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20">
                                    MY ID ✓
                                  </span>
                                ) : row.my_id_check === false ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/20">
                                    MY ID ≠ {row.my_id_mismatch_value}
                                  </span>
                                ) : null
                              )}
                              <p className="text-[9px] text-gray-400 dark:text-slate-500 italic">via {row.matched_by}</p>
                              <button
                                onClick={() => handleRowChange(row.line_id, 'show_override', true)}
                                className="text-[9px] text-blue-500 hover:text-blue-400 font-medium mt-1"
                              >
                                Change SKU
                              </button>
                              {row.show_override && (
                                <div className="mt-2 space-y-2">
                                  <SearchableSelect
                                    value=""
                                    onChange={(sku) => handleManualMatch(row.line_id, sku)}
                                    options={productMasterList}
                                    placeholder="Select different SKU..."
                                  />
                                  <button
                                    onClick={() => handleRowChange(row.line_id, 'show_override', false)}
                                    className="text-[9px] text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : row.match_status === 'SKU_MISMATCH' ? (
                            <div className="space-y-1.5">
                              <p className="font-mono text-blue-600 dark:text-blue-400 text-[12px] font-bold">{row.matched_sku}</p>
                              <p className="text-[9px] text-gray-400 dark:text-slate-500 italic">via {row.matched_by}</p>
                              <SearchableSelect
                                value={row.matched_sku || ''}
                                onChange={(sku) => handleManualMatch(row.line_id, sku)}
                                options={productMasterList}
                                placeholder="Override SKU..."
                              />
                            </div>
                          ) : row.match_status === 'PARTIAL_MATCH' ? (
                            <div className="space-y-1.5">
                              <p className="font-mono text-blue-600 dark:text-blue-400 text-[12px] font-bold">{row.matched_sku}</p>
                              {row.my_id && (
                                row.my_id_check === true ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-800 border border-green-300 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20">
                                    MY ID ✓
                                  </span>
                                ) : row.my_id_check === false ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/20">
                                    MY ID ≠ {row.my_id_mismatch_value}
                                  </span>
                                ) : null
                              )}
                              <p className="text-[9px] text-gray-400 dark:text-slate-500 italic">via {row.matched_by}</p>
                              <SearchableSelect
                                value={row.matched_sku || ''}
                                onChange={(sku) => handleManualMatch(row.line_id, sku)}
                                options={productMasterList}
                                placeholder="Override SKU..."
                              />
                            </div>
                          ) : row.match_status === 'MULTIPLE_VARIANT' || row.match_status === 'MULTIPLE_MATCH' ? (
                            <SearchableSelect
                              value={row.matched_sku || ''}
                              onChange={(sku) => handleManualMatch(row.line_id, sku)}
                              options={productMasterList}
                              placeholder="Select correct SKU..."
                            />
                          ) : (
                            <div className="space-y-1.5">
                              {row.my_id && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[9px] font-bold text-gray-400 dark:text-slate-500 uppercase">MY ID</span>
                                  <span className="text-[11px] font-mono font-semibold text-amber-600 dark:text-amber-400">{row.my_id}</span>
                                </div>
                              )}
                              <SearchableSelect
                                value={row.matched_sku || ''}
                                onChange={(sku) => handleManualMatch(row.line_id, sku)}
                                options={productMasterList}
                                placeholder="Search SKU master..."
                              />
                            </div>
                          )}
                        </td>

                        {/* MATCHED NAME */}
                        <td className="px-2 py-3">
                          {row.match_status === 'MATCH' ? (
                            <p className="text-[12px] text-gray-700 dark:text-slate-300 leading-snug">
                              {row.matched_name || row.item_name}
                            </p>
                          ) : row.match_status === 'SKU_MISMATCH' ? (
                            <div className="space-y-1">
                              <p className="text-[12px] text-gray-700 dark:text-slate-300 leading-snug">{row.matched_name}</p>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/20 font-bold">
                                ⚠ SKU MISMATCH
                              </span>
                            </div>
                          ) : row.match_status === 'PARTIAL_MATCH' ? (
                            <div className="space-y-1">
                              <p className="text-[12px] text-gray-700 dark:text-slate-300 leading-snug">{row.matched_name}</p>
                              {row.partial_match_reason && (
                                <p className="text-[10px] text-red-500 dark:text-red-400">{row.partial_match_reason}</p>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-300 dark:text-slate-600 text-xs italic">—</span>
                          )}
                        </td>

                        {/* INVOICE QTY */}
                        <td className="px-2 py-3 text-right font-bold text-gray-900 dark:text-slate-100 font-mono text-sm">
                          {row.match_status === 'MANUAL_ENTRY' ? (
                            <input
                              type="number"
                              value={row.invoice_qty}
                              onChange={(e) => handleRowChange(row.line_id, 'invoice_qty', toNum(e.target.value))}
                              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] text-right text-slate-300 focus:ring-1 focus:ring-blue-500"
                            />
                          ) : row.invoice_qty}
                        </td>

                        {/* PRICE (¥) */}
                        <td className="px-2 py-3 text-right font-bold text-gray-800 dark:text-slate-300 font-mono text-sm">
                          {row.match_status === 'MANUAL_ENTRY' ? (
                            <input
                              type="number"
                              value={row.unit_price_base || row.unit_price}
                              onChange={(e) => {
                                const val = toNum(e.target.value);
                                handleRowChange(row.line_id, 'unit_price_base', val);
                                handleRowChange(row.line_id, 'unit_price', val);
                              }}
                              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] text-right text-slate-300 focus:ring-1 focus:ring-blue-500"
                            />
                          ) : `¥${row.unit_price.toFixed(2)}`}
                        </td>

                        {/* DIFFS */}
                        <td className="px-2 py-3 text-right">
                          {row.match_status === 'MATCH' && masterCost > 0 ? (
                            <div className="space-y-0.5">
                              <p className={`text-sm font-black ${diffColor}`}>
                                {diff !== 0 ? `${diff > 0 ? '+' : ''}${fmtNumber(Math.abs(diff), 0)}` : '0'}
                              </p>
                              <p className={`text-xs font-bold ${diffColor}`}>
                                {percentage !== 0 ? `${percentage > 0 ? '+' : ''}${fmtNumber(percentage, 1)}%` : '0%'}
                              </p>
                            </div>
                          ) : (
                            <span className="text-slate-600 text-sm">—</span>
                          )}
                        </td>

                        {/* RESOLUTION ACTION */}
                        <td className="px-2 py-3">
                          {row.match_status === 'MANUAL_ENTRY' ? (
                            <div className="flex flex-col gap-2">
                              <Badge variant="success">READY</Badge>
                              <button
                                onClick={() => handleRemoveManualLine(row.line_id)}
                                className="text-[9px] text-red-400 hover:text-red-300 flex items-center gap-1"
                              >
                                <TrashIcon className="w-3 h-3" /> Remove
                              </button>
                            </div>
                          ) : ['MATCH', 'SKU_MISMATCH', 'PARTIAL_MATCH', 'UNMATCHED', 'MULTIPLE_VARIANT', 'MULTIPLE_MATCH'].includes(row.match_status) ? (
                            <div className="space-y-1">
                              <select
                                value={row.resolution_action || ''}
                                onChange={(e) => handleRowChange(row.line_id, 'resolution_action', e.target.value)}
                                className="w-full max-w-[120px] bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-[10px] text-white outline-none focus:ring-1 focus:ring-blue-500"
                              >
                                <option value="">Select Action</option>
                                <option value="ACCEPT">Accept</option>
                                <option value="OVERRIDE">Override (Update Master)</option>
                                <option value="FLAG_REVIEW">Flag for Review</option>
                                <option value="REJECT_LINE">Skip Item</option>
                                <option value="REQUEST_NEW_SKU">Request New SKU</option>
                              </select>
                              {row.resolution_action === 'FLAG_REVIEW' && (
                                <Badge variant="warning" className="text-[8px]">🚩 FLAGGED</Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-600 text-xs italic">Selection required</span>
                          )}
                        </td>

                        {/* RESOLUTION NOTES */}
                        <td className="px-2 py-3">
                          {row.match_status === 'MANUAL_ENTRY' ? (
                            <div className="space-y-1">
                              <label className="text-[8px] text-slate-500 uppercase">Cartons</label>
                              <input
                                type="number"
                                value={row.carton_count}
                                onChange={(e) => handleRowChange(row.line_id, 'carton_count', toNum(e.target.value))}
                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-300 focus:ring-1 focus:ring-blue-500"
                              />
                            </div>
                          ) : (
                            <input
                              type="text"
                              placeholder="Add notes..."
                              value={row.resolution_notes || ''}
                              onChange={(e) => handleRowChange(row.line_id, 'resolution_notes', e.target.value)}
                              className="w-full max-w-[140px] bg-slate-900 border border-slate-700 rounded p-1 text-[10px] text-slate-300 focus:ring-1 focus:ring-blue-500 placeholder:text-slate-600"
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-800/20 border-t border-slate-700">
                  <tr>
                    <td colSpan={10} className="px-4 py-3">
                      <button
                        onClick={handleAddManualLine}
                        className="w-full py-2 border-2 border-dashed border-slate-700 rounded-lg text-slate-500 hover:text-blue-400 hover:border-blue-500/50 hover:bg-blue-500/5 transition-all flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest"
                      >
                        <PlusIcon className="w-4 h-4" /> Add Manual Line
                      </button>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          {/* Footer Actions */}
          <div className="flex justify-end gap-3 sticky bottom-4">
            <Button variant="secondary" onClick={() => setActiveTab('Setup')}>Back to Setup</Button>
            <Button disabled={!canProceedToAllocation} onClick={handleConfirmValidation} className="bg-blue-600 hover:bg-blue-700 h-11 px-8 font-bold shadow-xl">
              Confirm & Proceed to Allocation
            </Button>
          </div>
        </div>
      )}

      {/* Allocation Tab - FIFO Matrix Implementation */}
      {activeTab === 'Allocation' && (
        <div className="flex flex-col space-y-6 animate-in fade-in duration-300 pb-24">
          {/* Header */}
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <ClipboardDocumentCheckIcon className="w-5 h-5 text-blue-500" />
              FIFO Allocation Matrix
            </h3>
          </div>

          {/* Summary Cards */}
          {allocationSummary && (
            <div className="grid grid-cols-3 gap-4">
              <Card className="bg-slate-800/40 border-slate-700 p-4">
                <p className="text-xs text-slate-500 uppercase font-bold mb-2">Total SKUs</p>
                <p className="text-3xl font-bold text-white">{allocationSummary.total_skus}</p>
              </Card>

              <Card className="bg-slate-800/40 border-slate-700 p-4">
                <p className="text-xs text-slate-500 uppercase font-bold mb-2">Allocated</p>
                <p className="text-3xl font-bold text-emerald-400">
                  {fmtNumber(allocationSummary.total_allocated, 0)}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  of {fmtNumber(allocationSummary.total_invoice_qty, 0)} total
                </p>
              </Card>

              <Card className="bg-slate-800/40 border-slate-700 p-4">
                <p className="text-xs text-slate-500 uppercase font-bold mb-2">Unallocated</p>
                <p className={`text-3xl font-bold ${allocationSummary.total_unallocated > 0 ? 'text-orange-400' : 'text-slate-600'
                  }`}>
                  {fmtNumber(allocationSummary.total_unallocated, 0)}
                </p>
              </Card>
            </div>
          )}

          {/* Allocation Table */}
          <Card className="p-0 border-slate-700 bg-slate-800/20 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-50 dark:bg-slate-900 sticky top-0 z-10 border-b border-gray-200 dark:border-slate-700">
                  <tr className="text-slate-400 text-[10px] uppercase tracking-wider font-bold">
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
                <tbody className="divide-y divide-slate-700/40">
                  {allocationData.map((item) => (
                    <React.Fragment key={item.sku}>
                      {/* Main Row */}
                      <tr
                        className="hover:bg-slate-700/20 cursor-pointer transition-colors"
                        onClick={() => toggleRowExpansion(item.sku)}
                      >
                        <td className="px-4 py-4 text-center">
                          {item.po_allocations.length > 0 && (
                            expandedRows[item.sku] ? (
                              <ChevronDownIcon className="w-4 h-4 text-slate-400" />
                            ) : (
                              <ChevronUpIcon className="w-4 h-4 text-slate-400" />
                            )
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <p className="font-mono font-bold text-blue-400 text-xs">{item.sku}</p>
                        </td>
                        <td className="px-4 py-4">
                          <p className="text-xs text-slate-300 truncate">{item.sku_name}</p>
                        </td>
                        <td className="px-4 py-4 text-center font-bold text-white">
                          {fmtNumber(item.invoice_qty, 0)}
                        </td>
                        <td className="px-4 py-4 text-center font-bold text-emerald-400">
                          {fmtNumber(item.total_allocated, 0)}
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span className={`font-bold ${item.unallocated_qty > 0 ? 'text-orange-400' : 'text-slate-600'
                            }`}>
                            {item.unallocated_qty > 0 ? `+${item.unallocated_qty}` : '0'}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center text-slate-400 text-sm">
                          {item.po_allocations.length}
                        </td>
                        <td className="px-4 py-4 text-center">
                          {item.unallocated_qty > 0 ? (
                            <Badge variant="warning" className="text-[8px]">PARTIAL</Badge>
                          ) : item.total_allocated > 0 ? (
                            <Badge variant="success" className="text-[8px]">GVUx</Badge>
                          ) : (
                            <Badge variant="destructive" className="text-[8px]">NO PO</Badge>
                          )}
                        </td>
                      </tr>

                      {/* Expanded PO Details */}
                      {expandedRows[item.sku] && item.po_allocations.map((po: any) => (
                        <tr key={`${item.sku}-${po.po_id}`} className="bg-slate-800/50">
                          <td className="px-4 py-3"></td>
                          <td colSpan={2} className="px-4 py-3">
                            <div className="flex items-center gap-2 pl-4">
                              <span className="text-slate-600">→</span>
                              <span className="font-mono text-blue-400 text-xs font-bold">
                                {po.po_id}
                              </span>
                              <span className="text-[10px] text-slate-500">
                                ({formatDate(po.po_date)} -
                                <span className={getAgeColor(po.age_days)}>
                                  {' '}{po.age_days}d old
                                </span>)
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center text-[10px] text-slate-400">
                            Ord: {fmtNumber(po.ordered_qty, 0)}
                          </td>
                          <td className="px-4 py-3 text-center text-[10px] text-slate-400">
                            Ful: {fmtNumber(po.fulfilled_qty, 0)}
                          </td>
                          <td className="px-4 py-3 text-center text-[10px] text-slate-400">
                            Pen: {fmtNumber(po.pending_qty, 0)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-emerald-400 font-bold text-sm">
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
            <div className="py-24 text-center border-2 border-dashed border-slate-800 rounded-2xl">
              <BoxIcon className="w-12 h-12 text-slate-700 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-slate-400">No Allocation Data</h3>
              <p className="text-sm text-slate-500 mt-1">
                Return to Validation and click "Proceed to Allocation"
              </p>
            </div>
          )}

          {/* Footer Buttons */}
          <div className="flex justify-between pt-6 border-t border-slate-800">
            <Button
              variant="secondary"
              onClick={() => setActiveTab('Validation')}
              icon={<ArrowLeftIcon className="w-4 h-4" />}
            >
              Back to Validation
            </Button>
            <Button
              onClick={handleProceedToReview}
              disabled={allocationData.length === 0}
              className="bg-blue-600 hover:bg-blue-700 h-11 px-8 font-bold"
            >
              Proceed to Review
            </Button>
          </div>
        </div>
      )}

      {/* Review Tab - Final Validation & Summary */}
      {activeTab === 'Review' && (
        <div className="flex flex-col space-y-6 animate-in fade-in duration-300 pb-24">
          {/* Header */}
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <ClipboardDocumentCheckIcon className="w-5 h-5 text-blue-500" />
              Final Review & Validation
            </h3>
          </div>

          {reviewData && (
            <>
              {/* Shipment Summary Cards */}
              <div className="grid grid-cols-4 gap-4">
                <Card className="bg-slate-800/40 border-slate-700 p-4">
                  <p className="text-xs text-slate-500 uppercase font-bold mb-2">Vendor</p>
                  <p className="text-lg font-bold text-white">{vendorCode}</p>
                  <p className="text-xs text-slate-500 mt-1">{reviewData.summary.total_skus} SKUs</p>
                </Card>

                <Card className="bg-slate-800/40 border-slate-700 p-4">
                  <p className="text-xs text-slate-500 uppercase font-bold mb-2">Total Qty</p>
                  <p className="text-2xl font-bold text-white">
                    {fmtNumber(reviewData.summary.total_invoice_qty, 0)}
                  </p>
                  <p className="text-xs text-emerald-400 mt-1">
                    {fmtNumber(reviewData.summary.total_allocated, 0)} allocated
                  </p>
                </Card>

                <Card className="bg-slate-800/40 border-slate-700 p-4">
                  <p className="text-xs text-slate-500 uppercase font-bold mb-2">POs Fulfilled</p>
                  <p className="text-2xl font-bold text-emerald-400">
                    {reviewData.summary.pos_fully_fulfilled}
                  </p>
                  <p className="text-xs text-yellow-400 mt-1">
                    {reviewData.summary.pos_partially_fulfilled} partial
                  </p>
                </Card>

                <Card className="bg-slate-800/40 border-slate-700 p-4">
                  <p className="text-xs text-slate-500 uppercase font-bold mb-2">Unallocated</p>
                  <p className={`text-2xl font-bold ${reviewData.summary.total_unallocated > 0 ? 'text-orange-400' : 'text-slate-600'
                    }`}>
                    {fmtNumber(reviewData.summary.total_unallocated, 0)}
                  </p>
                </Card>
              </div>

              {/* Financial Reconciliation */}
              <Card className="bg-slate-800/40 border-slate-700 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                    <span>💰</span> Financial Reconciliation
                  </h4>
                  {reviewData.reconciliation.has_variance && (
                    <Badge variant="warning" className="text-[8px]">VARIANCE DETECTED</Badge>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Invoice Total</p>
                    <p className="text-xl font-bold text-white">
                      ¥{fmtNumber(reviewData.reconciliation.invoice_total)}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-slate-500 mb-1">Calculated Total</p>
                    <p className="text-xl font-bold text-blue-400">
                      ¥{fmtNumber(reviewData.reconciliation.calculated_total)}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-slate-500 mb-1">Variance</p>
                    <p className={`text-xl font-bold ${Math.abs(reviewData.reconciliation.difference) < 1
                      ? 'text-slate-600'
                      : Math.abs(reviewData.reconciliation.percentage_diff) > 5
                        ? 'text-red-400'
                        : 'text-yellow-400'
                      }`}>
                      {reviewData.reconciliation.difference > 0 ? '+' : ''}
                      ¥{fmtNumber(reviewData.reconciliation.difference)}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      ({reviewData.reconciliation.percentage_diff > 0 ? '+' : ''}
                      {fmtNumber(reviewData.reconciliation.percentage_diff, 2)}%)
                    </p>
                  </div>
                </div>
              </Card>

              {/* Allocation Update Feedback */}
              {allocationSummary && (
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex items-center gap-2 text-emerald-400 text-xs">
                    <CheckIcon className="w-4 h-4" />
                    <span className="font-bold">
                      Allocation Updated: {allocationSummary.total_allocated} units allocated to {allocationSummary.pos_involved?.length || 0} POs
                    </span>
                  </div>
                </div>
              )}

              {/* Warnings Section */}
              {reviewData.warnings && reviewData.warnings.length > 0 && (
                <Card className="bg-slate-800/40 border-slate-700 p-6">
                  <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
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
                              <p className="text-sm font-bold text-white">
                                {warning.type.replace(/_/g, ' ')}
                              </p>
                              <p className="text-xs text-slate-400 mt-0.5">
                                {warning.message}
                              </p>
                            </div>
                          </div>

                          <button
                            onClick={() => toggleWarningExpansion(warning.type)}
                            className="text-slate-400 hover:text-white transition-colors"
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
                          <div className="mt-4 pt-4 border-t border-slate-700/50 space-y-2">
                            {warning.items.slice(0, 5).map((item: any, idx: number) => (
                              <div key={idx} className="flex justify-between items-center text-xs bg-slate-900/50 rounded px-3 py-2">
                                <div>
                                  <span className="font-mono text-blue-400 font-bold">{item.sku}</span>
                                  <span className="text-slate-500 ml-2">{item.item_name}</span>
                                </div>
                                {item.variance_percentage && (
                                  <span className="text-orange-400 font-bold">
                                    {item.variance_percentage > 0 ? '+' : ''}
                                    {fmtNumber(item.variance_percentage, 1)}%
                                  </span>
                                )}
                                {item.unallocated_qty && (
                                  <span className="text-orange-400 font-bold">
                                    +{item.unallocated_qty} unallocated
                                  </span>
                                )}
                                {item.qty && !item.unallocated_qty && (
                                  <span className="text-slate-400">
                                    {item.qty} units
                                  </span>
                                )}
                              </div>
                            ))}
                            {warning.items.length > 5 && (
                              <p className="text-xs text-slate-500 text-center pt-2">
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
                <Card className="bg-emerald-500/5 border-emerald-500/20 p-6">
                  <div className="flex items-center gap-3">
                    <CheckIcon className="w-6 h-6 text-emerald-400" />
                    <div>
                      <p className="text-sm font-bold text-emerald-400">All Clear!</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        No warnings detected. Ready to proceed to creation.
                      </p>
                    </div>
                  </div>
                </Card>
              )}

              {/* Action Buttons for Unallocated Items */}
              {reviewData.warnings?.some((w: any) => w.type === 'UNALLOCATED' || w.type === 'NO_PO') && (
                <Card className="bg-slate-800/40 border-slate-700 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-white">Items without Purchase Orders</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Create purchase orders for unallocated items or refresh allocation
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        onClick={handleRefreshAllocation}
                        disabled={isRefreshingAllocation}
                        className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                      >
                        <ArrowPathIcon className={`w-4 h-4 mr-2 ${isRefreshingAllocation ? 'animate-spin' : ''}`} />
                        {isRefreshingAllocation ? 'Refreshing...' : 'Refresh Allocation'}
                      </Button>

                      <Button
                        variant="secondary"
                        onClick={() => setShowCreatePOModal(true)}
                        className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                      >
                        <PlusIcon className="w-4 h-4 mr-2" />
                        Create PO
                      </Button>
                    </div>
                  </div>
                </Card>
              )}
            </>
          )}

          {/* Empty State */}
          {!reviewData && !reviewLoading && (
            <div className="py-24 text-center border-2 border-dashed border-slate-800 rounded-2xl">
              <ClipboardDocumentCheckIcon className="w-12 h-12 text-slate-700 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-slate-400">No Review Data</h3>
              <p className="text-sm text-slate-500 mt-1">
                Return to Allocation and click "Proceed to Review"
              </p>
            </div>
          )}

          {/* Footer Buttons */}
          <div className="flex justify-between items-center pt-6 border-t border-slate-800">
            <Button
              variant="secondary"
              onClick={() => setActiveTab('Allocation')}
              icon={<ArrowLeftIcon className="w-4 h-4" />}
            >
              Back to Allocation
            </Button>

            <div className="flex items-center gap-3">
              {!canProceedToCreation && reviewData && (
                <div className="flex items-center gap-2 text-red-400 text-sm mr-4">
                  <ExclamationTriangleIcon className="w-4 h-4" />
                  <span>Resolve blocking issues before proceeding</span>
                </div>
              )}

              {reviewData?.summary?.total_unallocated > 0 && (
                <div className="flex items-center gap-2 text-orange-400 text-sm mr-4">
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
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <CheckBadgeIcon className="w-6 h-6 text-emerald-500" />
            Final Shipment Details
          </h3>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left: Batch Assignment */}
            <div className="space-y-6">
              <Card className="bg-slate-800/30 border-slate-700 p-6 space-y-6 shadow-xl">
                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <ArchiveBoxIcon className="w-4 h-4" /> Batch Assignment
                </h4>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setBatchOption('new')}
                    className={`p-4 rounded-xl border text-left transition-all ${batchOption === 'new'
                      ? 'bg-blue-600/10 border-blue-500 ring-1 ring-blue-500'
                      : 'bg-slate-900/50 border-slate-700 hover:border-slate-500'
                      }`}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1">Option 1</p>
                    <p className="text-sm font-bold text-white">Create New Batch</p>
                  </button>

                  <button
                    onClick={() => setBatchOption('existing')}
                    className={`p-4 rounded-xl border text-left transition-all ${batchOption === 'existing'
                      ? 'bg-blue-600/10 border-blue-500 ring-1 ring-blue-500'
                      : 'bg-slate-900/50 border-slate-700 hover:border-slate-500'
                      }`}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-1">Option 2</p>
                    <p className="text-sm font-bold text-white">Select Existing</p>
                  </button>
                </div>

                {batchOption === 'new' ? (
                  <div className="p-4 bg-slate-900/80 rounded-lg border border-slate-700/50">
                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block">
                      New Batch ID (Auto-generated)
                    </label>
                    <p className="text-2xl font-mono font-bold text-blue-400">{newBatchId}</p>
                    <p className="text-xs text-slate-500 mt-2">
                      Mode: {shippingMode}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">
                      Open Batches *
                    </label>
                    <select
                      value={selectedBatchId}
                      onChange={(e) => setSelectedBatchId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="">Select an open batch...</option>
                      {openBatches.map(b => (
                        <option key={b.batch_id} value={b.batch_id}>
                          {b.batch_id} ({b.batch_type}, {b.total_shipments} shipments)
                        </option>
                      ))}
                    </select>
                    {validationErrors.batch && (
                      <p className="text-red-400 text-xs mt-1">{validationErrors.batch}</p>
                    )}
                  </div>
                )}
              </Card>
            </div>

            {/* Right: Physical & Invoice Details */}
            <div className="space-y-6">
              <Card className="bg-slate-800/30 border-slate-700 p-6 space-y-6 shadow-xl">
                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <BoxIcon className="w-4 h-4" /> Shipment Details
                </h4>

                <div className="space-y-4">
                  {/* Carton Count */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                      Total Cartons *
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={cartonCount || ''}
                      onChange={(e) => setCartonCount(parseInt(e.target.value) || 0)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-xl font-bold text-white focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="0"
                    />
                    {validationErrors.cartons && (
                      <p className="text-red-400 text-xs mt-1">{validationErrors.cartons}</p>
                    )}
                  </div>

                  {/* Total Amount */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                      Total Amount (¥) *
                    </label>
                    <input
                      type="number"
                      value={finalShipmentAmount || ''}
                      onChange={(e) => setFinalShipmentAmount(parseFloat(e.target.value) || 0)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-xl font-bold text-emerald-400 focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                    {validationErrors.amount && (
                      <p className="text-red-400 text-xs mt-1">{validationErrors.amount}</p>
                    )}
                  </div>

                  {/* Invoice Number (Optional) */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                      Invoice Number
                    </label>
                    <input
                      type="text"
                      value={invoiceNumber}
                      onChange={(e) => setInvoiceNumber(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="Optional"
                    />
                  </div>

                  {/* Invoice Date (Optional) */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                      Invoice Date
                    </label>
                    <input
                      type="date"
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>

                  {/* Carrier */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                      Carrier
                    </label>
                    <input
                      type="text"
                      value={carrier}
                      onChange={(e) => setCarrier(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="e.g. DHL, Maersk, FedEx..."
                    />
                  </div>

                  {/* Expected Delivery */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                      Expected Delivery Date
                    </label>
                    <input
                      type="date"
                      value={expectedDelivery}
                      onChange={(e) => setExpectedDelivery(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                      Notes
                    </label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                      placeholder="Add any notes about this shipment..."
                    />
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <div className="flex justify-between pt-8 border-t border-slate-800">
            <Button
              variant="secondary"
              onClick={() => setActiveTab('Review')}
              icon={<ArrowLeftIcon className="w-4 h-4" />}
            >
              Back to Review
            </Button>
            <Button
              onClick={handleFinalizeShipment}
              disabled={isCreatingShipment}
              className="bg-blue-600 hover:bg-blue-700 font-bold h-12 px-12 shadow-xl disabled:opacity-50"
            >
              {isCreatingShipment ? 'Creating...' : 'Finalize & Record Shipment'}
            </Button>
          </div>
        </div>
      )}

      {/* Success Screen */}
      {shipmentSuccess && (
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

          {/* Debug panel on success screen */}
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

      {/* Create PO Modal */}
      {showCreatePOModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 p-6 max-w-2xl w-full">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-white">Create Draft PO for Unallocated Items</h3>
              <button onClick={() => { setShowCreatePOModal(false); setBackendError(null); }}>
                <XMarkIcon className="w-5 h-5 text-slate-400 hover:text-white" />
              </button>
            </div>

            {/* Summary Info */}
            <div className="bg-slate-800/50 rounded-lg p-4 mb-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-slate-500 text-xs">Vendor</p>
                  <p className="text-white font-bold">{vendorCode}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-xs">Shipping Mode</p>
                  <p className="text-white font-bold">{shippingMode}</p>
                </div>
              </div>
            </div>

            {/* Unallocated Items List */}
            <div className="mb-4">
              <p className="text-xs font-bold text-slate-500 uppercase mb-2">Items to Order</p>
              <div className="bg-slate-800/30 rounded-lg p-3 max-h-60 overflow-y-auto space-y-2">
                {allocationData
                  .filter(a => a.unallocated_qty > 0)
                  .map(item => (
                    <div key={item.sku} className="flex justify-between items-center text-xs bg-slate-800 rounded px-3 py-2">
                      <div>
                        <span className="font-mono text-blue-400 font-bold">{item.sku}</span>
                        <span className="text-slate-400 ml-2">{item.sku_name}</span>
                      </div>
                      <span className="text-white font-bold">{item.unallocated_qty} units</span>
                    </div>
                  ))}
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Total: {allocationData.filter(a => a.unallocated_qty > 0).length} SKUs,
                {' '}{allocationData.reduce((sum, a) => sum + (a.unallocated_qty || 0), 0)} units
              </p>
            </div>

            {/* Action Buttons with Error Display */}
            <div className="space-y-3">
              {backendError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded p-3">
                  <p className="text-red-400 text-sm">{backendError}</p>
                </div>
              )}

              <div className="flex justify-end gap-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowCreatePOModal(false);
                    setBackendError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateDraftFromReview}
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
                      Create Draft Order
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Draft Success Modal */}
      {showDraftSuccessModal && createdDraftId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 p-6 max-w-md w-full">
            <div className="text-center">
              <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckIcon className="w-8 h-8 text-emerald-400" />
              </div>

              <h3 className="text-xl font-bold text-white mb-2">Draft Order Created!</h3>
              <p className="text-slate-400 text-sm mb-1">Successfully created draft order</p>
              <p className="text-blue-400 font-mono font-bold text-lg mb-2">{createdDraftId}</p>

              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 mb-4">
                <div className="flex items-start gap-2 text-left">
                  <InformationCircleIcon className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-slate-300">
                    <p className="font-semibold text-yellow-400 mb-1 uppercase tracking-tighter">Note:</p>
                    <p>This draft must be submitted to create a Purchase Order. Once submitted, you can return to the Review tab and click <span className="font-bold text-emerald-400 italic">"Refresh Allocation"</span> to allocate these items.</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <Button
                  onClick={() => {
                    setShowDraftSuccessModal(false);
                    // Navigate to draft edit
                    onNavigate?.('Draft Orders');
                  }}
                  className="bg-blue-600 hover:bg-blue-700 w-full"
                >
                  Edit Draft Now
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowDraftSuccessModal(false);
                    setCreatedDraftId(null);
                  }}
                  className="w-full"
                >
                  Submit Later
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Debug Panel Section */}
      <div className="pt-8 mt-auto border-t border-slate-800/50">
        <button
          onClick={() => setShowDebug(!showDebug)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-blue-500 text-[11px] font-bold text-slate-400 hover:text-blue-400 uppercase tracking-widest transition-all mb-4"
        >
          <ArrowPathIcon className={`w-4 h-4 ${isProcessing || allocationLoading || reviewLoading || isRefreshingAllocation || isCreatingShipment ? 'animate-spin' : ''}`} />
          {showDebug ? 'Hide Debug Info' : 'Show Network Debug Info'}
        </button>

        {showDebug && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-in slide-in-from-bottom-2 duration-200">
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Last Request Payload</span>
              <pre className="bg-slate-900 border border-slate-800 p-4 rounded-lg text-[10px] font-mono text-slate-400 overflow-auto max-h-[400px]">
                {lastRequest ? JSON.stringify(lastRequest, null, 2) : '// No request sent yet'}
              </pre>
            </div>
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase">Last Server Response</span>
              <pre className="bg-slate-900 border border-slate-800 p-4 rounded-lg text-[10px] font-mono text-slate-400 overflow-auto max-h-[400px]">
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
  // ADD THESE 4 LINES:
  'id': 'factory_code',
  'factory code': 'factory_code',
  'my id': 'my_id',
  'color': 'color',



  // Quantity variations
  'total pcs': 'invoice_qty',
  'qty pcs': 'invoice_qty',
  'qty': 'invoice_qty',
  'total qty': 'invoice_qty',
  'pcs': 'invoice_qty',
  'quantity': 'invoice_qty',

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
                invoiceNo = String(row[j + 1]).trim();
              }
            }

            if (lowVal.includes('date')) {
              if (cellVal.includes(':')) {
                invoiceDate = cellVal.split(':')[1].trim();
              } else if (j + 1 < row.length) {
                invoiceDate = String(row[j + 1]).trim();
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
          //if (firstNonEmpty.startsWith('total')) continue;
          //if (firstNonEmpty.includes('discount')) continue;
          //if (/^[=\-]+$/.test(firstNonEmpty)) continue;
          const skipPatterns = ['total', 'sum', 'sum:', 'subtotal', 'grand total', 'discount', 'ps:', 'bank', 'note'];
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

          //const factory_code = String(rowObj.factory_code || "").trim();
          // REPLACE with:
          const factoryCodeCols = Object.entries(columnMap)
            .filter(([_, canonical]) => canonical === 'factory_code')
            .map(([idx]) => String(row[Number(idx)] || "").trim())
            .filter(v => v !== "");
          const factory_code = factoryCodeCols.join('|');


          const ean = String(rowObj.ean || "").trim();
          const carton_count = toNum(rowObj.carton_count);

          parsedRows.push({
            factory_code,
            item_name,
            invoice_qty,
            carton_count,
            ean,
            unit_price_base,
            unit_price_box,
            unit_price_blister,
            unit_price_manual,
            unit_price_total,
            unit_price: unit_price_total,
            total_amount,
            total_price: unit_price_total * invoice_qty,
            // ADD THESE 2 LINES:
            my_id: String(rowObj.my_id || "").trim(),
            color: String(rowObj.color || "").trim(),
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