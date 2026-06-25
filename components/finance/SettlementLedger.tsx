import React, { useState, useEffect, useMemo } from 'react';
import { 
  fetchSettlementRecords, 
  logSettlementRecord, 
  submitAdjustmentEntry,
  submitPurchaseInvoice,
  fetchPurchaseInvoices,
  SettlementRecord,
  PurchaseInvoice,
  PaymentLog,
  submitVendorAccount,
  IS_DEVELOPMENT_MODE
} from '../../services/settlementService';
import { useSubmissionLock } from '../../hooks/useSubmissionLock';
import { 
  Plus, 
  RotateCcw, 
  Search, 
  TrendingUp, 
  TrendingDown, 
  Check, 
  X, 
  ChevronDown, 
  Info, 
  ArrowUpDown, 
  DollarSign, 
  Building2, 
  ArrowUpRight, 
  ArrowDownRight,
  ShieldCheck,
  ShieldAlert
} from 'lucide-react';
import { Invoice, Vendor, VendorMaster } from '../../types';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ViewType } from '../../types';

interface SettlementLedgerProps {
  invoices: (PurchaseInvoice & { temp?: boolean })[];
  paymentLogs: (PaymentLog & { temp?: boolean })[];
  settlementRecords: (SettlementRecord & { temp?: boolean })[];
  vendors?: (Vendor | VendorMaster)[];
  onNavigate?: (view: ViewType) => void;
  onRefresh: () => void;
  setSettlementRecords: React.Dispatch<React.SetStateAction<(SettlementRecord & { temp?: boolean })[]>>;
  setPurchaseInvoices: React.Dispatch<React.SetStateAction<(PurchaseInvoice & { temp?: boolean })[]>>;
}


export const SettlementLedger: React.FC<SettlementLedgerProps> = ({ 
  invoices = [], 
  paymentLogs = [],
  settlementRecords = [],
  vendors = [], 
  onNavigate,
  onRefresh,
  setSettlementRecords,
  setPurchaseInvoices
}) => {
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const records = settlementRecords;
  
  // A PurchaseInvoice is eligible for settlement only if:
  // ER1 is populated AND INR is populated AND Status != Pending EOD
  const localInvoices = useMemo(() => {
    return invoices.filter(purchase => 
      purchase.er1 !== undefined &&
      purchase.er1 !== null &&
      String(purchase.er1).trim() !== "" &&
      purchase.inr !== undefined &&
      purchase.inr !== null &&
      String(purchase.inr).trim() !== "" &&
      purchase.status !== 'Pending EOD'
    );
  }, [invoices]);

  // Load settlement records on mount from Google Apps Script
  useEffect(() => {
    onRefresh();
  }, []);

  // Filters State
  const [selectedVendor, setSelectedVendor] = useState<string>('');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>('');
  const [selectedTxnType, setSelectedTxnType] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [invoiceTypeSearchQuery, setInvoiceTypeSearchQuery] = useState<string>('');
  const [isInvoiceDropdownOpen, setIsInvoiceDropdownOpen] = useState<boolean>(false);

  // Sorting State
  const [sortField, setSortField] = useState<keyof SettlementRecord>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Form State for creating new record locally
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'invoice' | 'adjustment'>('invoice');
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [formSuccessMessage, setFormSuccessMessage] = useState<string | null>(null);
  
  // State for Invoice Entry (writes to PurchaseInvoices Google Sheet)
  const [newInvoice, setNewInvoice] = useState({
    date: new Date().toISOString().split('T')[0],
    invoiceId: '',
    vendorCode: 'V-001',
    customVendorCode: '',
    customVendorName: '',
    rmb: '',
    notes: ''
  });

  const [newRecordForm, setNewRecordForm] = useState({
    date: new Date().toISOString().split('T')[0],
    invoiceId: '',
    vendorCode: '',
    txnType: 'Invoice Settlement' as SettlementRecord['txnType'],
    amountRmb: '',
    exchangeRatePrimary: '11.50',
    exchangeRateSettlement: '11.40',
    notes: ''
  });

  const { isSubmitting: isSubmittingInvoice, withSubmissionGuard: withInvoiceGuard } = useSubmissionLock();
  const { isSubmitting: isSubmittingAdjustment, withSubmissionGuard: withAdjustmentGuard } = useSubmissionLock();

  // Extract unique active vendors available inside the system
  const activeVendors = useMemo(() => {
    if (vendors && vendors.length > 0) {
      return vendors.map(v => ({
        code: (v.id || (v as any).vendor_id || '').trim(),
        name: (v.name || (v as any).vendor_name || v.id || (v as any).vendor_id || '').trim()
      }));
    }
    // Fallback to initial structured vendors
    return [
      { code: 'V-001', name: 'Jiaxing Sourcing Group' },
      { code: 'V-002', name: 'Pinghu Clothing Co.' },
      { code: 'V-003', name: 'Guangzhou Sourcing Ltd' },
      { code: 'V-004', name: 'Yiwu Accessories Co.' },
      { code: 'V-005', name: 'Shenzhen Hardware Group' }
    ];
  }, [vendors]);

  // Contextual dropdown list: get invoices matching the active vendor
  const associatedInvoicesList = useMemo(() => {
    if (!selectedVendor) {
      return [];
    }

    const ids = new Set<string>();
    const matchedVendorObj = activeVendors.find(v => v.code === selectedVendor);

    // 1. From invoices prop matching selected vendor ID or name
    if (localInvoices && localInvoices.length > 0) {
      localInvoices.forEach(inv => {
        if (
          inv.vendor === selectedVendor || 
          (matchedVendorObj && (inv.vendor === matchedVendorObj.name || inv.vendor === matchedVendorObj.code))
        ) {
          if (inv.id) ids.add(inv.id);
        }
      });
    }

    // 2. From currently active ledger records matching the selected vendor
    records.forEach(rec => {
      if (rec.vendorNo === selectedVendor) {
        if (rec.invoiceId) ids.add(rec.invoiceId);
      }
    });

    return Array.from(ids).sort();
  }, [selectedVendor, localInvoices, records, activeVendors]);

  // Unique list of all invoices across the system
  const allUniqueInvoices = useMemo(() => {
    const ids = new Set<string>();

    if (localInvoices && localInvoices.length > 0) {
      localInvoices.forEach(inv => {
        if (inv && inv.id) ids.add(inv.id);
      });
    }

    records.forEach(rec => {
      if (rec && rec.invoiceId) ids.add(rec.invoiceId);
    });

    return Array.from(ids).sort();
  }, [localInvoices, records]);

  // Filter the allUniqueInvoices options by the search input value
  const filteredInvoiceOptions = useMemo(() => {
    if (!invoiceTypeSearchQuery) {
      return allUniqueInvoices;
    }
    const cleanQuery = invoiceTypeSearchQuery.toLowerCase().trim();
    return allUniqueInvoices.filter(inv => inv.toLowerCase().includes(cleanQuery));
  }, [allUniqueInvoices, invoiceTypeSearchQuery]);

  // Handle local form field resets
  const handleResetFilters = () => {
    setSelectedVendor('');
    setSelectedInvoiceId('');
    setSelectedTxnType('');
    setSearchQuery('');
    setInvoiceTypeSearchQuery('');
  };

  // Pre-calculate global or filtered active records
  const filteredRecords = useMemo(() => {
    return records.filter(rec => {
      // Vendor exact match
      if (selectedVendor && rec.vendorNo !== selectedVendor) {
        return false;
      }
      // Invoice exact match
      if (selectedInvoiceId && rec.invoiceId !== selectedInvoiceId) {
        return false;
      }
      // Transaction type exact match
      if (selectedTxnType && rec.txnType !== selectedTxnType) {
        return false;
      }
      // Text generic query search matching invoice or vendor name/code
      if (searchQuery) {
        const cleanQuery = searchQuery.toLowerCase().trim();
        const matchesInvoice = rec.invoiceId.toLowerCase().includes(cleanQuery);
        const matchesVendorCode = rec.vendorNo.toLowerCase().includes(cleanQuery);
        const matchesVendorName = rec.vendorName.toLowerCase().includes(cleanQuery);
        const matchesType = rec.txnType.toLowerCase().includes(cleanQuery);
        if (!matchesInvoice && !matchesVendorCode && !matchesVendorName && !matchesType) {
          return false;
        }
      }
      return true;
    });
  }, [records, selectedVendor, selectedInvoiceId, selectedTxnType, searchQuery]);

  // Sort active displayed records
  const sortedAndFilteredRecords = useMemo(() => {
    const data = [...filteredRecords];
    data.sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      // Handle raw string comparison cleanly
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' 
          ? aVal.localeCompare(bVal) 
          : bVal.localeCompare(aVal);
      }

      // Handle numerical values
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });
    return data;
  }, [filteredRecords, sortField, sortDirection]);

  // --- Real-time Dynamic Metrics Aggregation ---
  const dynamicMetrics = useMemo(() => {
    // 1. Total Unpaid Invoices & Total Liability
    // Filter unpaid liability entries matching selected vendor or specific invoice
    let unpaidList: any[] = localInvoices
      ? localInvoices.filter(i => i.status !== 'Paid' && i.status !== 'Cancelled')
      : [];

    if (selectedVendor) {
      const vendName = activeVendors.find(v => v.code === selectedVendor)?.name || '';
      unpaidList = unpaidList.filter(u => {
        if ('vendorCode' in u) {
          return (u as any).vendorCode === selectedVendor;
        }
        return u.vendor === vendName || u.vendor === selectedVendor;
      });
    }

    if (selectedInvoiceId) {
      unpaidList = unpaidList.filter(u => u.id === selectedInvoiceId);
    }

    const unpaidCount = unpaidList.length;
    
    // Sum the liability values (INR basis)
    const liabilitySumInr = unpaidList.reduce((sum, item) => {
      if ('balance' in item) {
        return sum + item.balance; // Real-time Invoice balance
      }
      return sum + (item as any).balanceInr; // Fallback invoice balance
    }, 0);

    // 2. Advance Payments Total
    // Sum up advance payment transactions in current filtered ledger subset
    const totalAdvanceInr = filteredRecords
      .filter(rec => rec.txnType === 'Advance Payment')
      .reduce((sum, rec) => sum + Math.abs(rec.amountInr), 0);

    // 3. Forex Gain / Loss Balance
    // Sum of net forex performance over the current active filtered records
    const netForexGainLoss = filteredRecords.reduce((sum, rec) => sum + rec.forexGainLoss, 0);

    return {
      unpaidCount,
      unpaidSumRmb: unpaidList.reduce((sum, item) => {
        if ('amount' in item && item.currency === 'CNY') {
          return sum + item.balance;
        }
        return sum + ((item as any).balanceRmb || 0);
      }, 0),
      liabilitySumInr,
      totalAdvanceInr,
      netForexGainLoss
    };
  }, [filteredRecords, localInvoices, selectedVendor, selectedInvoiceId, activeVendors]);

  // Trigger sorting column change
  const handleSort = (field: keyof SettlementRecord) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Handle invoice form submit (writes directly to PurchaseInvoices Google Sheet)
  const handleCreateInvoice = (e: React.FormEvent) => {
    e.preventDefault();
    withInvoiceGuard(async () => {
      setFormSuccessMessage(null);
      setErrorBanner(null);

      const actualVendorCode = newInvoice.vendorCode === 'CUSTOM' 
        ? newInvoice.customVendorCode.trim().toUpperCase() 
        : newInvoice.vendorCode;

      const actualInvoiceId = newInvoice.invoiceId.trim().toUpperCase();

      if (!actualInvoiceId) {
        alert('Please provide a unique, descriptive Invoice ID.');
        return;
      }
      if (!actualVendorCode) {
        alert('Vendor code cannot be empty.');
        return;
      }
      const rmbValue = parseFloat(newInvoice.rmb);
      if (isNaN(rmbValue) || rmbValue <= 0) {
        alert('Amount in RMB must be a positive number.');
        return;
      }

      // Auto-create custom vendor if selected and not yet registered
      if (newInvoice.vendorCode === 'CUSTOM') {
        const customCode = newInvoice.customVendorCode.trim().toUpperCase();
        const customName = newInvoice.customVendorName.trim();
        if (!customCode || !customName) {
          alert('Vendor ID and Vendor Name are required for custom manual input.');
          return;
        }

        // Check case-insensitive duplication
        const existingVendor = activeVendors.find(v => v.code.toLowerCase() === customCode.toLowerCase());
        if (!existingVendor) {
          try {
            const res = await submitVendorAccount({
              vendor_id: customCode,
              vendor_name: customName
            });
            if (!res.success) {
              alert(`Failed to register custom vendor: ${res.message}`);
              return;
            }
            await onRefresh();
          } catch (verr: any) {
            alert(`Vendor registration error: ${verr.message || verr}`);
            return;
          }
        }
      }

      // 1. STATE SNAPSHOT & BATCH INJECTION
      const tempInvoice = {
        date: newInvoice.date,
        invoiceId: actualInvoiceId,
        vendorCode: actualVendorCode,
        rmb: rmbValue,
        notes: newInvoice.notes.trim() || undefined,
        status: 'Pending EOD' as const,
        settledAmount: 0,
        balance: rmbValue,
        id: actualInvoiceId,
        vendor: actualVendorCode,
        currency: 'CNY' as const
      };

      const previousInvoices = [...localInvoices];

      if (!IS_DEVELOPMENT_MODE) {
        // Instantly update states to let visual widgets and metrics cards re-evaluate
        setPurchaseInvoices(prev => [{ ...tempInvoice, temp: true }, ...prev]);
        setIsFormOpen(false);

        // Reset local inputs
        setNewInvoice({
          date: new Date().toISOString().split('T')[0],
          invoiceId: '',
          vendorCode: 'V-001',
          customVendorCode: '',
          customVendorName: '',
          rmb: '',
          notes: ''
        });
      }

      try {
        // 2. BACK-ALLEY CHANNELS INTEGRATION
        const response = await submitPurchaseInvoice({
          date: tempInvoice.date,
          invoiceId: tempInvoice.invoiceId,
          vendorCode: tempInvoice.vendorCode,
          rmb: tempInvoice.rmb,
          notes: tempInvoice.notes
        });

        if (response.success) {
          setFormSuccessMessage(`Invoice "${tempInvoice.invoiceId}" logged successfully! Saved to centralized ledger pipeline.`);
          if (IS_DEVELOPMENT_MODE) {
            setIsFormOpen(false);
            setNewInvoice({
              date: new Date().toISOString().split('T')[0],
              invoiceId: '',
              vendorCode: 'V-001',
              customVendorCode: '',
              customVendorName: '',
              rmb: '',
              notes: ''
            });
          }
          await onRefresh();
        } else {
          throw new Error(response.message || 'Invoice propagation failed.');
        }
      } catch (err) {
        console.error("Optimistic invoice registration back-sync error, rolling back: ", err);
        // 3. SECURE BACKWARD CORRECTION SWEEP
        if (!IS_DEVELOPMENT_MODE) {
          setPurchaseInvoices(previousInvoices);
        }
        setErrorBanner("Sync Failure: Transaction could not be written to Google Sheets. Changes have been rolled back safely. Please check your connection and try again.");
      }
    });
  };

  // Submit transaction form through our central data service
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    withAdjustmentGuard(async () => {
      setFormSuccessMessage(null);
      setErrorBanner(null);

      const { date, invoiceId, vendorCode, txnType, amountRmb, exchangeRatePrimary, exchangeRateSettlement, notes } = newRecordForm;

      if (!invoiceId || !vendorCode) {
        alert('Please fill out all mandatory fields.');
        return;
      }

      const matchedVendor = activeVendors.find(v => v.code === vendorCode);
      const vendorName = matchedVendor ? matchedVendor.name : 'Unknown Sourcing Vendor';

      const rmb = parseFloat(amountRmb) || 0;
      const ratePrimary = parseFloat(exchangeRatePrimary) || 11.50;
      const rateSettlement = parseFloat(exchangeRateSettlement) || 11.40;

      // Calculate dynamic values
      const amountInr = rmb * rateSettlement;
      let fxGainLoss = 0; // Handled dynamically in ledger computations if needed

      const recordPayload = {
        date,
        invoiceId,
        vendorNo: vendorCode,
        vendorName,
        txnType,
        amountRmb: rmb,
        amountInr,
        exchangeRatePrimary: ratePrimary,
        exchangeRateSettlement: rateSettlement,
        forexGainLoss: fxGainLoss,
        notes: notes || undefined
      };

      const tempRecordId = `SET-TEMP-${Date.now()}`;
      const tempRecord: SettlementRecord = {
        id: tempRecordId,
        ...recordPayload
      };

      const previousRecords = [...records];

      if (!IS_DEVELOPMENT_MODE) {
        // 1. OPTIMISTIC LOCAL REGISTER FLIP
        setSettlementRecords(prev => [{ ...tempRecord, temp: true }, ...prev]);
        setIsFormOpen(false);

        // Reset local data form inputs instantly
        setNewRecordForm({
          date: new Date().toISOString().split('T')[0],
          invoiceId: '',
          vendorCode: '',
          txnType: 'Invoice Settlement',
          amountRmb: '',
          exchangeRatePrimary: '11.50',
          exchangeRateSettlement: '11.40',
          notes: ''
        });
      }

      try {
        // 2. BACKGROUND TRANSMISSION CHANNEL
        const response = await (formMode === 'adjustment' 
          ? submitAdjustmentEntry(recordPayload)
          : logSettlementRecord(recordPayload));

        // Swap out the temp ID with the official assigned database ID quietly!
        const officialId = (response && response.data && response.data.id) || `SET-${(1001 + previousRecords.length).toString()}`;
        if (!IS_DEVELOPMENT_MODE) {
          setSettlementRecords(prev => prev.map(rec => rec.id === tempRecordId ? { ...rec, id: officialId } : rec));
        } else {
          setIsFormOpen(false);
          setNewRecordForm({
            date: new Date().toISOString().split('T')[0],
            invoiceId: '',
            vendorCode: '',
            txnType: 'Invoice Settlement',
            amountRmb: '',
            exchangeRatePrimary: '11.50',
            exchangeRateSettlement: '11.40',
            notes: ''
          });
        }
        
        onRefresh();

        const successMsg = response && response.message 
          ? `Settlement Record "${officialId}" processed! (${response.message})`
          : `Settlement Record "${officialId}" successfully logged to the ledger system!`;
          
        setFormSuccessMessage(successMsg);
      } catch (err: any) {
        console.error("Transmission error inside settlement log: ", err);
        // 3. SECURE SWEEP ROLLBACK
        if (!IS_DEVELOPMENT_MODE) {
          setSettlementRecords(previousRecords);
        }
        setErrorBanner(`Sync Failure: Transaction payload could not be verified on Google Sheets (${err.message}). Safe rollback complete.`);
      }
    });
  };

  // Helper formatting currencies
  const formatINR = (amt: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amt);
  };

  const formatRMB = (amt: number) => {
    return new Intl.NumberFormat('zh-CN', {
      style: 'currency',
      currency: 'CNY',
      maximumFractionDigits: 0
    }).format(amt);
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      {/* SUCCESS/ERROR NOTIFICATION TOASTS - FIXED OVERLAY TO PREVENT LAYOUT REFLOW */}
      <div className="fixed top-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
        {errorBanner && (
          <div className="bg-rose-50 dark:bg-rose-950/95 border border-rose-500 text-rose-850 dark:text-rose-200 px-4 py-3 rounded-xl relative flex items-center justify-between shadow-xl animate-fade-in pointer-events-auto" role="alert">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0" />
              <span className="text-sm font-semibold">{errorBanner}</span>
            </div>
            <button onClick={() => setErrorBanner(null)} className="text-rose-700 hover:text-rose-900 dark:text-rose-400 dark:hover:text-rose-200 shrink-0 ml-2">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {formSuccessMessage && (
          <div className="bg-emerald-50 dark:bg-emerald-950/95 border border-emerald-500 text-emerald-800 dark:text-emerald-200 px-4 py-3 rounded-xl relative flex items-center justify-between shadow-xl animate-fade-in pointer-events-auto" role="alert">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0" />
              <span className="text-sm font-medium">{formSuccessMessage}</span>
            </div>
            <button onClick={() => setFormSuccessMessage(null)} className="text-emerald-700 hover:text-emerald-900 dark:text-emerald-400 dark:hover:text-emerald-200 shrink-0 ml-2">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* --- TOPBAR ACTIONS --- */}
      <div className="flex flex-col items-center text-center md:flex-row md:items-center md:justify-between md:text-left gap-4">
        <div className="flex flex-col items-center md:items-start text-center md:text-left">
          <div className="flex flex-col sm:flex-row items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Vendor Settlement Ledger</h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage international clearing transactions, dynamic currency conversion, and evaluate forex variances.
          </p>
        </div>

        {/* Top Right Layout Area */}
        <div id="topbar-actions" className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto justify-center md:justify-end">
          <div className="relative w-full sm:w-auto">
            <Button
              onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-lg shadow-md transition active:scale-95 w-full sm:w-auto"
            >
              <Plus className="w-4 h-4" />
              <span>Add Entry</span>
              <ChevronDown className="w-4 h-4 ml-0.5 opacity-80" />
            </Button>

            {isAddMenuOpen && (
              <>
                {/* Overlay Backdrop to close drop down */}
                <div 
                  className="fixed inset-0 z-10" 
                  onClick={() => setIsAddMenuOpen(false)} 
                />
                <div 
                  className="absolute right-0 mt-2 w-56 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-xl z-20 py-1.5 animate-fade-in divide-y divide-gray-100 dark:divide-gray-700 text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  <div className="px-3.5 py-1.5 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    Shared Entry Flows
                  </div>
                  <div className="py-1">
                    <button
                      type="button"
                      onClick={() => {
                        setFormMode('invoice');
                        setNewRecordForm(prev => ({
                          ...prev,
                          txnType: 'Invoice Settlement',
                          amountRmb: '',
                          notes: ''
                        }));
                        setIsFormOpen(true);
                        setIsAddMenuOpen(false);
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-700/60 transition-colors flex items-center gap-2 text-gray-900 dark:text-white font-bold cursor-pointer"
                    >
                      <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                      <span>Invoice Entry</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddMenuOpen(false);
                        if (onNavigate) {
                          onNavigate('Payment Ledger');
                        }
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-700/60 transition-colors flex items-center gap-2 text-gray-900 dark:text-white font-bold cursor-pointer"
                    >
                      <span className="w-2 h-2 rounded-full bg-cyan-500 shrink-0" />
                      <span>Payment Entry</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* --- METRICS RIBBON GRID (Uniform 4 Light/Dark overview cards) --- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric Card 1: Total Unpaid Invoices */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-white shadow-md rounded-xl p-5 flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-lg transition duration-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wider uppercase">Total Unpaid Invoices</span>
            <span className="p-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-250 dark:border-amber-500/20 rounded-lg text-amber-600 dark:text-amber-400">
              <Info className="w-4 h-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-800 dark:text-white shrink-0">
              {dynamicMetrics.unpaidCount} <span className="text-xs font-normal text-slate-500 dark:text-slate-400">Invoices</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Outstanding volume: <span className="font-semibold text-amber-600 dark:text-amber-300">{formatRMB(dynamicMetrics.unpaidSumRmb)}</span>
            </p>
          </div>
        </div>

        {/* Metric Card 2: Total Liability */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-white shadow-md rounded-xl p-5 flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-lg transition duration-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wider uppercase">Total Liability</span>
            <span className="p-2 bg-red-50 dark:bg-red-500/10 border border-red-250 dark:border-red-500/20 rounded-lg text-red-600 dark:text-red-400">
              <Building2 className="w-4 h-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-800 dark:text-white shrink-0">
              {formatINR(dynamicMetrics.liabilitySumInr)}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              INR payable sum matching filters.
            </p>
          </div>
        </div>

        {/* Metric Card 3: Total Advance */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-white shadow-md rounded-xl p-5 flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-lg transition duration-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wider uppercase">Total Advance</span>
            <span className="p-2 bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-250 dark:border-cyan-500/20 rounded-lg text-cyan-600 dark:text-cyan-400">
              <DollarSign className="w-4 h-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl font-bold text-slate-800 dark:text-white shrink-0">
              {formatINR(dynamicMetrics.totalAdvanceInr)}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Funds prepaid towards future orders.
            </p>
          </div>
        </div>

        {/* Metric Card 4: Total Forex Gain / Loss */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-white shadow-md rounded-xl p-5 flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-lg transition duration-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wider uppercase">Total Forex Gain / Loss</span>
            <span className={`p-2 rounded-lg ${dynamicMetrics.netForexGainLoss >= 0 ? 'bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-250 dark:border-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-rose-50 dark:bg-rose-500/10 border border-rose-250 dark:border-rose-500/20 text-rose-600 dark:text-rose-400'}`}>
              {dynamicMetrics.netForexGainLoss >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            </span>
          </div>
          <div>
            <div className={`text-2xl font-bold shrink-0 flex items-center gap-1.5 ${dynamicMetrics.netForexGainLoss >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {dynamicMetrics.netForexGainLoss >= 0 ? '+' : ''}{formatINR(dynamicMetrics.netForexGainLoss)}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Net balance due to exchange variances.
            </p>
          </div>
        </div>
      </div>

      {/* --- FILTER VIEW GRID BAR (White Box Panel) --- */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-md p-5 px-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Filter Settlement Ledger
          </label>
          <button
            onClick={handleResetFilters}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white bg-blue-600 dark:bg-blue-600 text-white rounded-lg shadow-sm transition w-full sm:w-auto"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Filter
          </button>
        </div>
        
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          {/* 1. Vendor Select Filter */}
          <div className="w-full md:flex-1 min-w-0">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
              Vendor Code & Name
            </label>
            <div className="relative">
              <select
                value={selectedVendor}
                onChange={(e) => {
                  setSelectedVendor(e.target.value);
                  setSelectedInvoiceId(''); // Reset InvoiceId reset because it must be vendor contextual!
                }}
                className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors"
              >
                <option value="">All active vendors</option>
                {activeVendors.map((vendor) => (
                  <option key={vendor.code} value={vendor.code}>
                    {vendor.code} -- {vendor.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 2. Contextual Associated Invoices Filter */}
          <div className="w-full md:flex-1 min-w-0">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5 flex items-center justify-between">
              <span>Associated Invoices</span>
              {selectedVendor ? (
                <span className="text-primary-600 dark:text-primary-400 text-[10px] font-bold bg-primary-50 dark:bg-primary-950/40 px-1.5 py-0.5 rounded">
                  Vendor Ledger
                </span>
              ) : (
                <span className="text-slate-500 dark:text-slate-400 text-[10px] font-bold bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                  Type Search All
                </span>
              )}
            </label>

            {selectedVendor ? (
              /* SPECIFIC VENDOR: Standard select dropdown containing the associated invoices list */
              <select
                value={selectedInvoiceId}
                onChange={(e) => {
                  setSelectedInvoiceId(e.target.value);
                  setInvoiceTypeSearchQuery(e.target.value);
                }}
                className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors"
              >
                <option value="">All matched invoices</option>
                {associatedInvoicesList.map((invNo) => (
                  <option key={invNo} value={invNo}>
                    {invNo}
                  </option>
                ))}
              </select>
            ) : (
              /* ALL VENDORS / NO VENDOR SELECTED: Custom searchable dropdown with a type search input */
              <div className="relative">
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-400">
                    <Search className="w-3.5 h-3.5" />
                  </span>
                  <input
                    type="text"
                    value={invoiceTypeSearchQuery}
                    onChange={(e) => {
                      setInvoiceTypeSearchQuery(e.target.value);
                      setIsInvoiceDropdownOpen(true);
                      // Set selectedInvoiceId immediately if it is a perfect match, or clear it if empty
                      const val = e.target.value.trim();
                      if (!val) {
                        setSelectedInvoiceId('');
                      } else if (allUniqueInvoices.includes(val)) {
                        setSelectedInvoiceId(val);
                      }
                    }}
                    onFocus={() => setIsInvoiceDropdownOpen(true)}
                    placeholder="Type invoice no..."
                    className="block w-full pl-8 pr-16 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors placeholder:text-gray-400"
                  />
                  {selectedInvoiceId && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedInvoiceId('');
                        setInvoiceTypeSearchQuery('');
                      }}
                      className="absolute inset-y-0 right-7 flex items-center pr-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                      title="Clear Selection"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsInvoiceDropdownOpen(!isInvoiceDropdownOpen)}
                    className="absolute inset-y-0 right-0 flex items-center pr-2.5 pl-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 border-l border-gray-200 dark:border-gray-700 h-5/6 my-auto"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>

                {isInvoiceDropdownOpen && (
                  <>
                    <div 
                      className="fixed inset-0 z-20" 
                      onClick={() => setIsInvoiceDropdownOpen(false)} 
                    />
                    <div className="absolute left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-xl z-30 divide-y divide-gray-100 dark:divide-gray-700 animate-fade-in text-xs">
                      {filteredInvoiceOptions.length > 0 ? (
                        filteredInvoiceOptions.map((invNo) => (
                          <button
                            key={invNo}
                            type="button"
                            onClick={() => {
                              setSelectedInvoiceId(invNo);
                              setInvoiceTypeSearchQuery(invNo);
                              setIsInvoiceDropdownOpen(false);
                            }}
                            className={`w-full text-left px-3.5 py-2 font-mono transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/60 flex items-center justify-between ${
                              selectedInvoiceId === invNo 
                                ? 'bg-primary-50 dark:bg-primary-950/40 text-primary-600 dark:text-primary-300 font-semibold' 
                                : 'text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            <span>{invNo}</span>
                            {selectedInvoiceId === invNo && <Check className="w-3 h-3 text-primary-500 shrink-0" />}
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2.5 text-gray-500 dark:text-gray-400 italic text-center">
                          No matching invoices
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 3. Txn Type Filter */}
          <div className="w-full md:flex-1">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
              Txn Type
            </label>
            <select
              value={selectedTxnType}
              onChange={(e) => setSelectedTxnType(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors"
            >
              <option value="">All Transactions</option>
              <option value="Invoice Settlement">Invoice Settlement</option>
              <option value="Advance Payment">Advance Payment</option>
            </select>
          </div>

          {/* 4. Filter text search input */}
          <div className="w-full md:flex-1">
            <label className="block text-xs font-medium text-transparent mb-1.5 select-none hidden md:block">
              Search
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search ref note, invoice..."
                className="block w-full pl-9 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-2 text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors"
              />
            </div>
          </div>
        </div>
      </div>

      {/* --- FINANCIAL PERSISTENCE MOBILE CARD LIST --- */}
      <div className="md:hidden space-y-4">
        {sortedAndFilteredRecords.length > 0 ? (
          sortedAndFilteredRecords.map((rec) => {
            const isGain = rec.forexGainLoss > 0;
            const isLoss = rec.forexGainLoss < 0;
            
            return (
              <div 
                key={rec.id}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4.5 space-y-3.5 hover:border-gray-300 dark:hover:border-gray-600 transition"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                    {rec.date}
                  </span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                    rec.txnType === 'Invoice Settlement' 
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/35 dark:text-blue-300 border border-blue-200 dark:border-blue-800/40'
                      : 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/35 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800/40'
                  }`}>
                    {rec.txnType}
                  </span>
                </div>

                <div>
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">
                    {rec.vendorName}
                  </h4>
                  <div className="flex flex-wrap gap-2 items-center mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-mono text-primary-600 dark:text-primary-400 font-semibold bg-primary-50/80 dark:bg-primary-950/30 px-2 py-0.5 rounded flex items-center gap-1">
                      <span>{rec.invoiceId}</span>
                      {(rec as any).syncStatus && (rec as any).syncStatus !== 'synced' && (
                        <span className={`px-1 py-0.5 rounded text-[8px] font-extrabold tracking-wider ${
                          (rec as any).syncStatus === 'pending' ? 'bg-amber-100 text-amber-800' :
                          (rec as any).syncStatus === 'syncing' ? 'bg-blue-100 text-blue-800 animate-pulse' :
                          'bg-rose-100 text-rose-800'
                        }`}>
                          {(rec as any).syncStatus === 'pending' ? 'QUEUE' :
                           (rec as any).syncStatus === 'syncing' ? 'SYNC' : 'FAIL'}
                        </span>
                      )}
                    </span>
                    <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[11px]">
                      {rec.vendorNo}
                    </span>
                  </div>
                  {rec.notes && (
                    <p className="text-xs font-normal text-gray-500 dark:text-gray-400 bg-slate-50 dark:bg-slate-900/40 p-2.5 rounded border border-slate-100 dark:border-slate-800/40 mt-3.5">
                      <span className="font-medium text-slate-700 dark:text-slate-300">Ref Note:</span> {rec.notes}
                    </p>
                  )}
                </div>

                <div className="flex justify-end pt-3.5 text-xs border-t border-gray-100 dark:border-gray-700/50">
                  <div>
                    <span className="block text-[10px] uppercase font-semibold text-gray-400 dark:text-gray-500 tracking-wider">
                      Amount (RMB)
                    </span>
                    <span className="font-mono font-medium text-gray-700 dark:text-gray-300 text-xs">
                      {rec.amountRmb !== 0 ? formatRMB(rec.amountRmb) : '—'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-slate-50 dark:bg-slate-900/30 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800/40 text-center text-xs font-mono">
                  <div>
                    <span className="block text-[9px] text-gray-400 dark:text-gray-500 uppercase font-semibold">Primary ex</span>
                    <span className="text-gray-700 dark:text-gray-300 font-medium">{rec.exchangeRatePrimary.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="block text-[9px] text-gray-400 dark:text-gray-500 uppercase font-semibold">Settlement ex</span>
                    <span className="text-gray-900 dark:text-white font-medium">{rec.exchangeRateSettlement.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="block text-[9px] text-gray-400 dark:text-gray-500 uppercase font-semibold">Forex G/L</span>
                    {rec.forexGainLoss === 0 ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <span className={`font-semibold shrink-0 inline-flex items-center justify-center gap-0.5 ${
                        isGain ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {isGain ? '+' : ''}{formatINR(rec.forexGainLoss)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400 text-sm">
            No ledger records matched the selected query parameters.
          </div>
        )}
      </div>

      {/* --- FINANCIAL PERSISTENCE DATA TABLE --- */}
      <div className="hidden md:block bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900/50 text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold uppercase tracking-wider">
                <th 
                  onClick={() => handleSort('date')}
                  className="px-3 xl:px-5 lg:px-2.5 py-3.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <div className="flex items-center gap-1">
                    Date
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="px-3 xl:px-5 lg:px-2.5 py-3.5 whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    Payment ID
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('invoiceId')}
                  className="px-3 xl:px-5 lg:px-2.5 py-3.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <div className="flex items-center gap-1">
                    Invoice ID
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('vendorNo')}
                  className="px-3 xl:px-5 lg:px-2.5 py-3.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <div className="flex items-center gap-1">
                    Vendor Code
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('txnType')}
                  className="px-3 xl:px-5 lg:px-2.5 py-3.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <div className="flex items-center gap-1">
                    Txn Type
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th 
                  onClick={() => handleSort('amountRmb')}
                  className="px-3 xl:px-5 lg:px-2.5 py-3.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-right"
                >
                  <div className="flex items-center gap-1 justify-end">
                    Amount (RMB)
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="px-3 xl:px-5 lg:px-2.5 py-3.5 text-center whitespace-nowrap">Primary Rate</th>
                <th className="px-3 xl:px-5 lg:px-2.5 py-3.5 text-center whitespace-nowrap">Settled Rate</th>
                <th 
                  onClick={() => handleSort('forexGainLoss')}
                  className="px-3 xl:px-5 lg:px-2.5 py-3.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-right"
                >
                  <div className="flex items-center gap-1 justify-end">
                    Forex Gain/Loss
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
               {sortedAndFilteredRecords.length > 0 ? (
                 sortedAndFilteredRecords.map((rec) => {
                   const isGain = rec.forexGainLoss > 0;
                   const isLoss = rec.forexGainLoss < 0;
                   
                   return (
                     <tr 
                       key={rec.id}
                       className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors"
                     >
                       {/* Date */}
                       <td className="px-3 xl:px-5 lg:px-2.5 py-3.5 font-medium whitespace-nowrap text-gray-900 dark:text-gray-100">
                         {rec.date}
                       </td>

                       {/* Payment ID */}
                       <td className="px-3 xl:px-5 lg:px-2.5 py-3.5 whitespace-nowrap font-mono text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                         {rec.paymentId || '—'}
                       </td>
 
                       {/* Invoice ID */}
                       <td className="px-3 xl:px-5 lg:px-2.5 py-3.5 whitespace-nowrap font-mono text-xs font-semibold text-primary-600 dark:text-primary-400">
                         <div className="flex items-center gap-1.5 flex-wrap">
                            <span>{rec.invoiceId}</span>
                            {(rec as any).syncStatus && (rec as any).syncStatus !== 'synced' && (
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8.5px] font-extrabold pb-[0.5px] ${
                                (rec as any).syncStatus === 'pending' ? 'bg-amber-100 text-amber-800' :
                                (rec as any).syncStatus === 'syncing' ? 'bg-blue-100 text-blue-800 animate-pulse' :
                                'bg-rose-100 text-rose-800 border border-rose-200'
                              }`}>
                                {(rec as any).syncStatus === 'pending' ? '⏳ Queue' :
                                 (rec as any).syncStatus === 'syncing' ? '⚙️ Saving' : '❌ Fail'}
                                {(rec as any).syncStatus === 'failed' && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      (window as any).SyncQueueManager?.retry((rec as any).queueId || rec.id);
                                    }}
                                    className="ml-1 bg-rose-600 hover:bg-rose-750 text-white font-black px-1 rounded text-[8px] uppercase transition-colors shrink-0"
                                  >
                                    Retry
                                  </button>
                                )}
                              </span>
                            )}
                          </div>
                       </td>
 
                       {/* Vendor Code */}
                       <td className="px-3 xl:px-5 lg:px-2.5 py-3.5 whitespace-nowrap">
                         <div className="font-mono text-xs font-semibold text-gray-800 dark:text-gray-200">{rec.vendorNo}</div>
                         {rec.notes && (
                           <div className="text-[11px] text-gray-400 max-w-[160px] truncate mt-0.5" title={rec.notes}>
                             {rec.notes}
                           </div>
                         )}
                       </td>
 
                       {/* Txn Type Badges */}
                       <td className="px-3 xl:px-5 lg:px-2.5 py-3.5 whitespace-nowrap">
                         <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                           rec.txnType === 'Invoice Settlement' 
                             ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/35 dark:text-blue-300 border border-blue-200 dark:border-blue-800/40'
                             : 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/35 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800/40'
                         }`}>
                           {rec.txnType}
                         </span>
                       </td>
 
                       {/* Amount RMB */}
                       <td className="px-3 xl:px-5 lg:px-2.5 py-3.5 text-right font-mono text-sm">
                         {rec.amountRmb !== 0 ? formatRMB(rec.amountRmb) : '—'}
                       </td>
 
                       {/* Exchange rate Primary */}
                       <td className="px-3 xl:px-5 lg:px-2.5 py-3.5 text-center font-mono text-sm text-gray-500 dark:text-gray-400">
                         {rec.exchangeRatePrimary.toFixed(2)}
                       </td>
 
                       {/* Exchange rate Settlement */}
                       <td className="px-3 xl:px-5 lg:px-2.5 py-3.5 text-center font-mono text-sm font-medium text-gray-700 dark:text-gray-300">
                         {rec.exchangeRateSettlement.toFixed(2)}
                       </td>
 
                       {/* Forex Gain/Loss color badges */}
                       <td className="px-3 xl:px-5 lg:px-2.5 py-3.5 text-right whitespace-nowrap font-mono text-sm font-semibold">
                         {rec.forexGainLoss === 0 ? (
                           <span className="text-gray-400">—</span>
                         ) : (
                           <span className={`inline-flex items-center gap-1 ${
                             isGain 
                               ? 'text-emerald-600 dark:text-emerald-400' 
                               : 'text-rose-600 dark:text-rose-400'
                           }`}>
                             {isGain ? '+' : ''}
                             {formatINR(rec.forexGainLoss)}
                             {isGain ? (
                               <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
                             ) : (
                               <ArrowDownRight className="w-3.5 h-3.5 text-rose-500" />
                             )}
                           </span>
                         )}
                       </td>
                     </tr>
                   );
                 })
               ) : (
                 <tr>
                   <td colSpan={9} className="px-3 xl:px-5 lg:px-2.5 py-12 text-center text-gray-500 dark:text-gray-400">
                     No ledger records matched the selected query parameters.
                   </td>
                 </tr>
               )}
             </tbody>
          </table>
        </div>
      </div>
          {/* --- ADD TRANSACTION MODAL FORM --- */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4">
          {/* Backdrop screen filter */}
          <div 
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity duration-300" 
            onClick={() => setIsFormOpen(false)} 
          />

          <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 max-w-lg w-full overflow-hidden transform transition-all animate-zoom-in animate-fade-in">
            {/* Header section banner based on Mode */}
            {formMode === 'invoice' ? (
              <div className="bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-white border-b border-gray-200 dark:border-slate-800 px-6 py-4.5 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-black flex items-center gap-2 text-slate-800 dark:text-white">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
                    <span>Invoice Entry Form</span>
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Input direct purchase ledger rows. Submits as "Pending EOD" for background rates computation.
                  </p>
                </div>
                <button 
                  onClick={() => setIsFormOpen(false)} 
                  className="p-1.5 rounded-lg text-slate-400 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-slate-800 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <div className="bg-indigo-50 dark:bg-indigo-900 text-slate-800 dark:text-white border-b border-gray-200 dark:border-indigo-950 px-6 py-4.5 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-black flex items-center gap-2 text-slate-800 dark:text-white">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
                    <span>Adjustment Entry Form</span>
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-indigo-200 mt-1">
                    Log retroactive, forex-invariant vendor capital and rate corrections to Settlement Ledger.
                  </p>
                </div>
                <button 
                  onClick={() => setIsFormOpen(false)} 
                  className="p-1.5 rounded-lg text-slate-400 dark:text-indigo-400 hover:text-slate-800 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-indigo-900 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            )}

            {/* Form Segment depends on Mode */}
            {formMode === 'invoice' ? (
              <form onSubmit={handleCreateInvoice} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {/* Date Selection */}
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                      Posting Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={newInvoice.date}
                      onChange={(e) => setNewInvoice(prev => ({ ...prev, date: e.target.value }))}
                      className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-950 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>

                  {/* Invoice ID Unique key input */}
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                      Invoice ID (Unique) *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. INV-2026-621"
                      value={newInvoice.invoiceId}
                      onChange={(e) => setNewInvoice(prev => ({ ...prev, invoiceId: e.target.value }))}
                      className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-955 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500 font-mono uppercase"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {/* Sourcing Vendor dropdown */}
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                      Vendor Code *
                    </label>
                    <select
                      required
                      value={newInvoice.vendorCode}
                      onChange={(e) => setNewInvoice(prev => ({ ...prev, vendorCode: e.target.value }))}
                      className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-955 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                    >
                      {activeVendors.map(v => (
                        <option key={v.code} value={v.code}>{v.code} -- {v.name}</option>
                      ))}
                      <option value="CUSTOM">[ Custom Manual Input ]</option>
                    </select>
                  </div>
 
                  {/* Custom Vendor input helper */}
                  {newInvoice.vendorCode === 'CUSTOM' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-3 bg-gray-50/50 dark:bg-gray-800/10">
                      <div>
                        <label className="block text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5">
                          Vendor ID (Unique Key) *
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. ABC"
                          value={newInvoice.customVendorCode}
                          onChange={(e) => setNewInvoice(prev => ({ ...prev, customVendorCode: e.target.value }))}
                          className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-955 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500 font-mono uppercase"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5">
                          Vendor Name *
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. ABC Sourcing"
                          value={newInvoice.customVendorName}
                          onChange={(e) => setNewInvoice(prev => ({ ...prev, customVendorName: e.target.value }))}
                          className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-955 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Amount in Renminbi input */}
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                    Amount in Renminbi Sum (RMB ¥) *
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 font-bold">
                      ¥
                    </span>
                    <input
                      type="number"
                      required
                      min={1}
                      max={99999999}
                      placeholder="e.g. 145000"
                      value={newInvoice.rmb}
                      onChange={(e) => setNewInvoice(prev => ({ ...prev, rmb: e.target.value }))}
                      className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-950 dark:text-white pl-8 pr-3 py-2.5 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500 font-bold font-mono"
                    />
                  </div>
                </div>

                {/* Payment Notes input */}
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                    Reference & Notes
                  </label>
                  <textarea
                    placeholder="e.g. Batch #18 customs clearance accessories clearing notes."
                    rows={2}
                    maxLength={150}
                    value={newInvoice.notes}
                    onChange={(e) => setNewInvoice(prev => ({ ...prev, notes: e.target.value }))}
                    className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-955 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                {/* AUTOMATED CALCULATION ISOLATION WARNING */}
                <div className="bg-amber-100 dark:bg-slate-900 p-3.5 rounded-xl border border-amber-200 dark:border-slate-800 flex items-start gap-2 text-amber-900 dark:text-slate-400">
                  <ShieldAlert className="w-4.5 h-4.5 text-amber-600 shrink-0 mt-0.5" />
                  <span className="text-[10.5px] leading-relaxed">
                    <strong>EOD Variables Isolated:</strong> Background variables (<code>ER1</code> and <code>INR</code> valuation values) are completely isolated from this form layout. Rate conversions are resolved automatically on matching value dates.
                  </span>
                </div>

                {/* Dialog controls */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <button
                    type="button"
                    onClick={() => {
                      setIsFormOpen(false);
                      setFormSuccessMessage(null);
                    }}
                    className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 bg-gray-50 hover:bg-gray-100 dark:bg-slate-700/60 dark:hover:bg-slate-700 rounded-lg shadow-sm transition"
                  >
                    Cancel
                  </button>
                  <Button
                    type="submit"
                    disabled={isSubmittingInvoice}
                    className="px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-md transition flex items-center gap-2"
                  >
                    {isSubmittingInvoice ? (
                      <>
                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Saving Invoice...
                      </>
                    ) : (
                      'Publish Invoice'
                    )}
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleFormSubmit} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {/* Date */}
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                      Adjustment Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={newRecordForm.date}
                      onChange={(e) => setNewRecordForm(prev => ({ ...prev, date: e.target.value }))}
                      className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-955 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>

                  {/* Txn Type */}
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                      Adjustment Type *
                    </label>
                    <select
                      value={newRecordForm.txnType}
                      onChange={(e) => setNewRecordForm(prev => ({ ...prev, txnType: e.target.value as any }))}
                      className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-955 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500 font-semibold"
                    >
                      <option value="Forex Adjustment">Forex Adjustment (Direct Loss/Gain)</option>
                      <option value="Refund">Refund (Credit Back to Account)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Sourcing Vendor */}
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                      Sourcing Vendor *
                    </label>
                    <select
                      required
                      value={newRecordForm.vendorCode}
                      onChange={(e) => setNewRecordForm(prev => ({ ...prev, vendorCode: e.target.value }))}
                      className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-955 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value="">Select Vendor...</option>
                      {activeVendors.map(vendor => (
                        <option key={vendor.code} value={vendor.code}>
                          {vendor.code} -- {vendor.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Target Invoice selection / Input */}
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                      Associated Invoice ID *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. INV-2024-001"
                      value={newRecordForm.invoiceId}
                      onChange={(e) => setNewRecordForm(prev => ({ ...prev, invoiceId: e.target.value }))}
                      className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-955 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500 font-mono uppercase"
                    />
                  </div>
                </div>

                {/* Amount Grid */}
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                    Amount in Renminbi Sum (RMB ¥) *
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 font-bold">
                      ¥
                    </span>
                    <input
                      type="number"
                      required
                      placeholder="e.g. 150000"
                      value={newRecordForm.amountRmb}
                      onChange={(e) => setNewRecordForm(prev => ({ ...prev, amountRmb: e.target.value }))}
                      className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-950 dark:text-white pl-8 pr-3 py-2.5 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500 font-bold font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Exchange Rate (Primary) */}
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                      Primary Rate (ER)
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      placeholder="e.g. 11.50"
                      value={newRecordForm.exchangeRatePrimary}
                      onChange={(e) => setNewRecordForm(prev => ({ ...prev, exchangeRatePrimary: e.target.value }))}
                      className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-955 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500"
                    />
                  </div>

                  {/* Exchange Rate (Settlement) */}
                  <div>
                    <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                      Settled Rate (ER)
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      placeholder="e.g. 11.40"
                      value={newRecordForm.exchangeRateSettlement}
                      onChange={(e) => setNewRecordForm(prev => ({ ...prev, exchangeRateSettlement: e.target.value }))}
                      className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-955 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500"
                    />
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                    Adjustment Explanation & Notes
                  </label>
                  <textarea
                    placeholder="Reason for rate adjustment, retro refund credit or margin mapping..."
                    rows={2}
                    maxLength={150}
                    value={newRecordForm.notes}
                    onChange={(e) => setNewRecordForm(prev => ({ ...prev, notes: e.target.value }))}
                    className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-955 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500"
                  />
                </div>

                <div className="bg-amber-50 dark:bg-slate-900 p-3.5 rounded-xl border border-amber-200/60 dark:border-slate-800 flex items-start gap-2 text-slate-500 dark:text-slate-400">
                  <ShieldAlert className="w-4.5 h-4.5 text-amber-500 shrink-0 mt-0.5" />
                  <span className="text-[10.5px] leading-relaxed">
                    <strong>Forex gain or loss</strong> is mathematically computed in-memory based on currency rate spreads. Values are saved locally for read-only preview purposes.
                  </span>
                </div>

                {/* Dialog Submit Actions */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <button
                    type="button"
                    onClick={() => setIsFormOpen(false)}
                    className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 bg-gray-50 hover:bg-gray-100 dark:bg-slate-700/60 dark:hover:bg-slate-700 rounded-lg shadow-sm transition"
                  >
                    Cancel
                  </button>
                  <Button
                    type="submit"
                    disabled={isSubmittingAdjustment}
                    className="px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white bg-primary-600 hover:bg-primary-700 rounded-lg shadow-md transition flex items-center gap-2"
                  >
                    {isSubmittingAdjustment ? (
                      <>
                        <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Processing...
                      </>
                    ) : (
                      'Log Record'
                    )}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
