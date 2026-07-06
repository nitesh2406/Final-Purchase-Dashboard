import React, { useState, useEffect, useMemo } from 'react';
import { useQueryParam, useQueryParamFast } from '../../hooks/useQueryParam';
import {
  getPurchaseInvoices,
  submitPurchaseInvoice, 
  executeEODExchangeRateEngine, 
  resetPurchaseInvoicesDb,
  PurchaseInvoice,
  fetchPurchaseInvoices,
  logSettlementRecord,
  fetchPaymentLogs,
  getPaymentLogs,
  PaymentLog,
  fetchSettlementRecords,
  getSettlementRecordsLocal,
  SettlementRecord,
  VendorLedgerEntry,
  IS_DEVELOPMENT_MODE,
  submitAdjustmentEntry
} from '../../services/settlementService';
import { VendorMaster, submitVendorAccount } from '../../services/settlementService';
import { useSubmissionLock } from '../../hooks/useSubmissionLock';
import { 
  Plus, 
  Sparkles, 
  ArrowRight,
  Database, 
  CreditCard, 
  UserCheck, 
  Globe, 
  Terminal, 
  Calendar, 
  DollarSign, 
  FileText, 
  RefreshCw, 
  Clock, 
  ChevronRight, 
  ChevronDown,
  AlertCircle, 
  FileCheck2, 
  ShieldAlert,
  Search,
  CheckCircle2,
  TrendingUp,
  RotateCcw,
  X
} from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { VendorLedgerTab } from './VendorLedgerTab';

// Active tab types
type ActiveTabType = 'purchase_entries' | 'payment_entries' | 'vendor_ledger';

interface AccountsViewProps {
  onNavigateToDetail?: (batchId: string) => void;
  onNavigate?: (view: any) => void;
  invoices: (PurchaseInvoice & { temp?: boolean })[];
  paymentLogs: (PaymentLog & { temp?: boolean })[];
  vendorLedger: VendorLedgerEntry[];
  vendors: VendorMaster[];
  onRefresh: () => Promise<void> | void;
  setPurchaseInvoices: React.Dispatch<React.SetStateAction<(PurchaseInvoice & { temp?: boolean })[]>>;
  setPaymentLogs: React.Dispatch<React.SetStateAction<(PaymentLog & { temp?: boolean })[]>>;
  isSyncingShipments?: boolean;
  isSyncing?: boolean;
  syncSuccess?: boolean;
  syncError?: string | null;
}

export const AccountsView: React.FC<AccountsViewProps> = ({ 
  onNavigateToDetail, 
  onNavigate,
  invoices,
  paymentLogs,
  vendorLedger,
  vendors,
  onRefresh,
  setPurchaseInvoices,
  setPaymentLogs,
  isSyncingShipments = false,
  isSyncing = false,
  syncSuccess = false,
  syncError = null
}) => {
  // Navigation & UI tabs
  const [activeTab, setActiveTab ] = useQueryParam<ActiveTabType>('accountsTab', 'purchase_entries');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEodRunning, setIsEodRunning] = useState(false);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  
  // Adjustment entry states
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
  const [adjustmentPayingVendor, setAdjustmentPayingVendor] = useState('');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentDate, setAdjustmentDate] = useState(new Date().toISOString().split('T')[0]);
  const [adjustmentNotes, setAdjustmentNotes] = useState('');
  const [adjustmentAllocations, setAdjustmentAllocations] = useState<{ vendorCode: string; amount: string }[]>([
    { vendorCode: '', amount: '' }
  ]);

  // Dynamic list states
  const [settlementRecords, setSettlementRecords] = useState<SettlementRecord[]>([]);
  const [searchQuery, setSearchQuery] = useQueryParamFast('search', '');
  const [selectedVendorFilter, setSelectedVendorFilter] = useQueryParam<string>('vendor', '');
  const [configError, setConfigError] = useState<string | null>(null);
  
  // EOD calculations report log console
  const [engineLogs, setEngineLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // New Invoice form inputs (isolated entirely from ER1 & INR)
  const [newInvoice, setNewInvoice] = useState({
    date: new Date().toISOString().split('T')[0],
    invoiceId: '',
    vendorCode: vendors[0]?.vendor_id || '',
    customVendorCode: '',
    customVendorName: '',
    rmb: '',
    notes: ''
  });

  // Unique vendor codes for filter/form select lists 
  const VENDOR_OPTIONS = useMemo(() => {
    return vendors.map(v => ({
      code: v.vendor_id,
      name: v.vendor_name || v.vendor_id,
      displayText: v.vendor_name ? `${v.vendor_id} -- ${v.vendor_name}` : v.vendor_id
    }));
  }, [vendors]);

  // Refresh local state list - Fetching live spreadsheet tab
  const handleRefresh = async () => {
    onRefresh();
  };

  const loadSettlementRecords = async () => {
    try {
      const list = await fetchSettlementRecords();
      setSettlementRecords(list);
    } catch (e) {
      console.warn('Could not load live settlement records, using localStorage fallback');
      setSettlementRecords(getSettlementRecordsLocal());
    }
  };

  useEffect(() => {
    loadSettlementRecords();
  }, []);

  // Automatically trigger sync refresh when switching to the Vendor Ledger tab
  useEffect(() => {
    if (activeTab === 'vendor_ledger') {
      onRefresh();
    }
  }, [activeTab]);

  // Automatically trigger background sync refresh if vendor selection filter changes
  useEffect(() => {
    if (selectedVendorFilter) {
      onRefresh();
    }
  }, [selectedVendorFilter]);

  const getVendorNameLocal = (vendorCode: string): string => {
    const match = vendors.find(v => v.vendor_id === vendorCode);
    return match ? (match.vendor_name || match.vendor_id) : vendorCode;
  };

  const generateAdjustmentId = (allRecords: SettlementRecord[]) => {
    const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
    const prefix = `ADJ-${todayStr}`;
    const matches = allRecords.filter(r => (r.paymentId || r.id || '').startsWith(prefix));
    const seqs = matches.map(r => {
      const parts = (r.paymentId || r.id || '').split('-');
      const lastPart = parseInt(parts[parts.length - 1], 10);
      return isNaN(lastPart) ? 0 : lastPart;
    });
    const nextSeq = seqs.length > 0 ? Math.max(...seqs) + 1 : 1;
    return `${prefix}-${String(nextSeq).padStart(3, '0')}`;
  };

  const getVendorBalance = (vendorCode: string): number => {
    if (!vendorCode) return 0;
    try {
      if (vendorLedger && vendorLedger.length > 0) {
        const filteredLive = vendorLedger.filter(row => row.VendorCode === vendorCode);
        if (filteredLive.length > 0) {
          const compiled = filteredLive.map(row => {
            const isPurchase = row.Particulars === 'Purchase';
            const isPayment = row.Particulars === 'Payment';
            const isTransferOut = row.Particulars?.includes('Transfer Out');
            const isTransferIn = row.Particulars?.includes('Transfer In');
            const isRefund = row.Particulars?.includes('Refund');
            const isForex = row.Particulars?.includes('Forex');

            let amount = parseFloat(String(row.RMB)) || 0;
            if (isPurchase) {
              amount = -Math.abs(amount);
            } else if (isPayment) {
              amount = Math.abs(amount);
            } else if (isTransferOut) {
              amount = -Math.abs(amount);
            } else if (isTransferIn) {
              amount = Math.abs(amount);
            } else if (isRefund) {
              amount = Math.abs(amount);
            } else if (isForex) {
              amount = -amount;
            } else {
              amount = -amount;
            }

            return {
              date: row.Date || '',
              amount: amount
            };
          });

          compiled.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
          let running = 0;
          compiled.forEach(row => {
            running += row.amount;
          });
          return running;
        }
      }

      const rows: { date: string; amount: number }[] = [];

      // 1. Invoices
      const safeInvoices = invoices || [];
      const matchedInvoices = safeInvoices.filter(inv => inv.vendorCode === vendorCode);
      matchedInvoices.forEach(inv => {
        rows.push({
          date: inv.date || '',
          amount: -(parseFloat(String(inv.rmb)) || 0)
        });
      });

      // 2. Payment logs
      const safePaymentLogs = paymentLogs || [];
      safePaymentLogs.forEach(log => {
        const isPrimary = log.vendorCode === vendorCode;
        const hasAllocations = log.allocations && log.allocations.length > 0;

        if (isPrimary) {
          if (hasAllocations) {
            rows.push({
              date: log.date || '',
              amount: parseFloat(String(log.rmbAmount)) || 0
            });
            log.allocations?.forEach(alloc => {
              if (alloc.vendorCode !== vendorCode) {
                rows.push({
                  date: log.date || '',
                  amount: -(parseFloat(String(alloc.amount)) || 0)
                });
              }
            });
          } else {
            rows.push({
              date: log.date || '',
              amount: parseFloat(String(log.rmbAmount)) || 0
            });
          }
        } else if (hasAllocations) {
          const alloc = log.allocations?.find(a => a.vendorCode === vendorCode);
          if (alloc) {
            rows.push({
              date: log.date || '',
              amount: parseFloat(String(alloc.amount)) || 0
            });
          }
        }
      });

      // 3. Settlement records
      const safeSettlementRecords = settlementRecords || [];
      safeSettlementRecords.forEach(rec => {
        const isSource = rec.vendorNo === vendorCode && rec.invoiceId ? (rec.invoiceId.startsWith('V-') || vendors?.some(v => v.vendor_id === rec.invoiceId)) : false;
        const isTarget = rec.invoiceId === vendorCode && rec.vendorNo ? (rec.vendorNo.startsWith('V-') || vendors?.some(v => v.vendor_id === rec.vendorNo)) : false;

        if (isSource) {
          rows.push({
            date: rec.date || '',
            amount: -(parseFloat(String(rec.amountRmb)) || 0)
          });
        } else if (isTarget) {
          rows.push({
            date: rec.date || '',
            amount: parseFloat(String(rec.amountRmb)) || 0
          });
        } else if (rec.vendorNo === vendorCode) {
          if (rec.txnType === 'Forex Adjustment') {
            rows.push({
              date: rec.date || '',
              amount: -(parseFloat(String(rec.amountRmb)) || 0)
            });
          } else if (rec.txnType === 'Refund' || rec.txnType === 'Refund Adjustment') {
            rows.push({
              date: rec.date || '',
              amount: parseFloat(String(rec.amountRmb)) || 0
            });
          }
        }
      });

      rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      let running = 0;
      rows.forEach(r => {
        running += r.amount;
      });
      return running;
    } catch (e) {
      console.error('Error calculating balance for paying vendor selection:', e);
      return 0;
    }
  };

  const handleOpenAdjustmentModal = (payingVendor: string = '') => {
    setAdjustmentPayingVendor(payingVendor);
    setAdjustmentAmount('');
    setAdjustmentDate(new Date().toISOString().split('T')[0]);
    setAdjustmentNotes('');
    setAdjustmentAllocations([{ vendorCode: '', amount: '' }]);
    setIsAdjustmentModalOpen(true);
    setIsAddMenuOpen(false);
    setErrorBanner(null);
  };

  const handleCreateAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    withAdjustmentGuard(async () => {
      const totalAmountFloat = parseFloat(adjustmentAmount) || 0;
      const totalAllocatedFloat = adjustmentAllocations.reduce((acc, alloc) => acc + (parseFloat(alloc.amount) || 0), 0);

      if (Math.abs(totalAmountFloat - totalAllocatedFloat) > 0.01) {
        setErrorBanner("Allocated amount must equal adjustment amount.");
        return;
      }

      if (!adjustmentPayingVendor) {
        setErrorBanner("Please select a paying vendor.");
        return;
      }

      const invalidRow = adjustmentAllocations.some(a => !a.vendorCode || (parseFloat(a.amount) || 0) <= 0);
      if (invalidRow) {
        setErrorBanner("Please ensure all receiving vendor fields and positive amounts are filled correctly.");
        return;
      }

      try {
        const adjId = generateAdjustmentId(settlementRecords);

        const promises = adjustmentAllocations.map(async (alloc) => {
          const payload = {
            txnType: 'Transfer',
            paymentId: adjId,
            sourceVendor: adjustmentPayingVendor,
            targetVendor: alloc.vendorCode,
            amountRmb: parseFloat(alloc.amount) || 0,
            fxRate: 11.50,
            date: adjustmentDate,
            notes: adjustmentNotes || 'Adjustment Transfer'
          };
          return submitAdjustmentEntry(payload);
        });

        await Promise.all(promises);

        const newLocalSettlementRecords: SettlementRecord[] = adjustmentAllocations.map((alloc, idx) => {
          const amount = parseFloat(alloc.amount) || 0;
          return {
            id: `SET-${Date.now()}-${idx}`,
            date: adjustmentDate,
            invoiceId: alloc.vendorCode,
            vendorNo: adjustmentPayingVendor,
            vendorName: getVendorNameLocal(adjustmentPayingVendor),
            txnType: 'Transfer',
            amountRmb: amount,
            amountInr: amount * 11.50,
            exchangeRatePrimary: 11.50,
            exchangeRateSettlement: 11.50,
            forexGainLoss: 0,
            notes: adjustmentNotes || 'Adjustment Transfer',
            paymentId: adjId
          };
        });

        if (!IS_DEVELOPMENT_MODE) {
          const currentLocal = getSettlementRecordsLocal();
          const updatedLocal = [...newLocalSettlementRecords, ...currentLocal];
          localStorage.setItem('settlement_records_table', JSON.stringify(updatedLocal));
          setSettlementRecords(updatedLocal);
        }

        await onRefresh();

        setSuccessBanner(`Adjustment Entry logged successfully with Reference ID: ${adjId}`);
        setIsAdjustmentModalOpen(false);
      } catch (err: any) {
        console.error('Error submitting adjustment:', err);
        setErrorBanner(err.message || 'Failed to submit adjustment entries.');
      }
    });
  };

  // Filter criteria computation
  const filteredInvoices = useMemo(() => {
    const list = invoices.filter(inv => {
      const matchSearch = 
        inv.invoiceId.toLowerCase().includes(searchQuery.toLowerCase()) || 
        (inv.notes || '').toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchVendor = selectedVendorFilter === '' || inv.vendorCode === selectedVendorFilter;
      
      return matchSearch && matchVendor;
    });

    // Guard against duplicate keys
    const seen = new Set<string>();
    return list.filter(inv => {
      const id = String(inv.invoiceId).trim().toLowerCase();
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [invoices, searchQuery, selectedVendorFilter]);

  const filteredPaymentLogs = useMemo(() => {
    const list = paymentLogs.filter(log => {
      const matchSearch = 
        log.paymentId.toLowerCase().includes(searchQuery.toLowerCase()) || 
        log.vendorCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (log.referenceNo || '').toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchVendor = selectedVendorFilter === '' || log.vendorCode === selectedVendorFilter;
      
      return matchSearch && matchVendor;
    });

    // Guard against duplicate keys
    const seen = new Set<string>();
    return list.filter(log => {
      const id = String(log.paymentId).trim().toLowerCase();
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [paymentLogs, searchQuery, selectedVendorFilter]);

  // Aggregate metrics
  const statsSummary = useMemo(() => {
    const totalCount = invoices.length;
    const pendingCount = invoices.filter(i => i.status === 'Pending EOD').length;
    const processedCount = invoices.filter(i => i.status === 'Processed').length;
    const totalRmbPending = invoices
      .filter(i => i.status === 'Pending EOD')
      .reduce((sum, i) => sum + i.rmb, 0);
    const totalInrProcessed = invoices
      .filter(i => i.status === 'Processed' && i.inr)
      .reduce((sum, i) => sum + (i.inr || 0), 0);
    
    return {
      totalCount,
      pendingCount,
      processedCount,
      totalRmbPending,
      totalInrProcessed
    };
  }, [invoices]);

  const { isSubmitting: isSubmittingInvoice, withSubmissionGuard: withInvoiceGuard } = useSubmissionLock();
  const { isSubmitting: isSubmittingAdjustment, withSubmissionGuard: withAdjustmentGuard } = useSubmissionLock();

  // Handle invoice form submit
  const handleCreateInvoice = (e: React.FormEvent) => {
    e.preventDefault();
    withInvoiceGuard(async () => {
      setErrorBanner(null);
      setSuccessBanner(null);

      const actualVendorCode = newInvoice.vendorCode === 'CUSTOM' 
        ? newInvoice.customVendorCode.trim().toUpperCase() 
        : newInvoice.vendorCode;

      const actualInvoiceId = newInvoice.invoiceId.trim().toUpperCase();

      if (!actualInvoiceId) {
        setErrorBanner('Please provide a unique, descriptive Invoice ID.');
        return;
      }
      if (!actualVendorCode) {
        setErrorBanner('Vendor code cannot be empty.');
        return;
      }
      const rmbValue = parseFloat(newInvoice.rmb);
      if (isNaN(rmbValue) || rmbValue <= 0) {
        setErrorBanner('Amount in RMB must be a positive number.');
        return;
      }

      // Check if duplicate InvoiceID exists
      const isDuplicate = invoices.some(i => i.invoiceId.trim().toUpperCase() === actualInvoiceId);
      if (isDuplicate) {
        setErrorBanner(`Invoice ID "${actualInvoiceId}" already exists database record.`);
        return;
      }

      // Auto-create custom vendor if selected
      if (newInvoice.vendorCode === 'CUSTOM') {
        const customCode = newInvoice.customVendorCode.trim().toUpperCase();
        const customName = newInvoice.customVendorName.trim();
        if (!customCode || !customName) {
          setErrorBanner('Vendor ID and Vendor Name are required for custom manual input.');
          return;
        }

        // See if already exists (case-insensitive)
        const existingVendor = vendors.find(v => v.vendor_id.trim().toLowerCase() === customCode.toLowerCase());
        if (!existingVendor) {
          try {
            const res = await submitVendorAccount({
              vendor_id: customCode,
              vendor_name: customName
            });
            if (!res.success) {
              setErrorBanner(`Failed to auto-register custom vendor: ${res.message}`);
              return;
            }
            // Sync frontend vendors list
            await onRefresh();
          } catch (verr: any) {
            setErrorBanner(`Vendor registration error: ${verr.message || verr}`);
            return;
          }
        }
      }

      // 1. CONSTRUCT LOCAL REPRESENTATION
      const tempInvoice = {
        date: newInvoice.date,
        invoiceId: actualInvoiceId,
        vendorCode: actualVendorCode,
        rmb: rmbValue,
        notes: newInvoice.notes.trim() || undefined,
        status: 'Pending EOD' as const,
        settledAmount: 0,
        balance: rmbValue,
        // Fallback details for other view templates
        id: actualInvoiceId,
        vendor: actualVendorCode,
        currency: 'CNY' as const
      };

      const previousInvoices = [...invoices];

      if (!IS_DEVELOPMENT_MODE) {
        // Instantly commit to local state to feed reactive panels optimistically
        setPurchaseInvoices(prev => {
          const newList = [{ ...tempInvoice, temp: true, createdAtTimestamp: Date.now() }, ...prev];
          const uniqueMap = new Map();
          newList.forEach(item => {
            if (item && item.invoiceId) {
              uniqueMap.set(String(item.invoiceId).trim().toLowerCase(), item);
            }
          });
          return Array.from(uniqueMap.values());
        });
        setIsModalOpen(false);
        // Reset local state fields
        setNewInvoice({
          date: new Date().toISOString().split('T')[0],
          invoiceId: '',
          vendorCode: vendors[0]?.vendor_id || '',
          customVendorCode: '',
          customVendorName: '',
          rmb: '',
          notes: ''
        });
      }

      try {
        // 2. BACKEND CHANNELS SYNC
        const response = await submitPurchaseInvoice({
          date: tempInvoice.date,
          invoiceId: tempInvoice.invoiceId,
          vendorCode: tempInvoice.vendorCode,
          rmb: tempInvoice.rmb,
          notes: tempInvoice.notes
        });

        if (response.success) {
          setSuccessBanner(`Invoice "${tempInvoice.invoiceId}" logged successfully! Saved to centralized ledger pipeline.`);
          if (IS_DEVELOPMENT_MODE) {
            setIsModalOpen(false);
            // Reset local state fields
            setNewInvoice({
              date: new Date().toISOString().split('T')[0],
              invoiceId: '',
              vendorCode: vendors[0]?.vendor_id || '',
              customVendorCode: '',
              customVendorName: '',
              rmb: '',
              notes: ''
            });
          }
          await onRefresh(); // Force reload direct true server state
        } else {
          throw new Error(response.message || 'Invoice save propagation aborted.');
        }
      } catch (err) {
        console.error("Invoice registration write error: ", err);
        if (!IS_DEVELOPMENT_MODE) {
          setPurchaseInvoices(previousInvoices);
        }
        setErrorBanner("Sync Failure: Transaction could not be written to Google Sheets. Please check your connection and try again.");
      }
    });
  };

  // Run calculation engine
  const handleRunEodEngine = async () => {
    setIsEodRunning(true);
    setEngineLogs([]);
    setShowLogs(true);
    setSuccessBanner(null);
    setErrorBanner(null);
    const previousInvoices = [...invoices];

    try {
      // Small timeout to simulate secure database pipeline run animation
      await new Promise(resolve => setTimeout(resolve, 500));
      const result = await executeEODExchangeRateEngine(invoices, (updated) => {
        // Instantly apply updated records containing calculated exchange rates to state before write-back completes
        const uniqueMap = new Map();
        updated.forEach(item => {
          if (item && item.invoiceId) {
            uniqueMap.set(String(item.invoiceId).trim().toLowerCase(), item);
          }
        });
        setPurchaseInvoices(Array.from(uniqueMap.values()));
      });

      setEngineLogs(result.logs);

      console.log("[EOD] Engine completed successfully");

      console.log("[EOD] Fetching fresh PurchaseInvoices");
      const freshInvoices = await fetchPurchaseInvoices();
      console.log(`[EOD] Received ${freshInvoices.length} invoices from server`);

      console.log("Current UI State", invoices);
      console.log("Incoming Server State", freshInvoices);

      if (freshInvoices && freshInvoices.length > 0) {
        const firstAffected = freshInvoices.find(inv => inv.status === 'Processed' || inv.er1);
        if (firstAffected) {
          console.log("First affected invoice:", {
            invoiceId: firstAffected.invoiceId,
            er1: firstAffected.er1,
            inr: firstAffected.inr
          });
        }
      }

      console.log("[EOD] Replacing frontend state");
      setPurchaseInvoices(freshInvoices);
      console.log("State Replaced");

      console.log("[EOD] Dashboard metrics recalculated");
      console.log("[EOD] UI refresh complete");

      // Update remaining states silently
      await onRefresh();

      if (result.processedCount > 0) {
        setSuccessBanner(`EOD Engine finished! Parsed & updated closing rates for ${result.processedCount} transactions.`);
      } else {
        setSuccessBanner('Scan complete. No outstanding pending EOD rows require rate conversions.');
      }
    } catch (err: any) {
      console.error("EOD engine run failed, reverting states:", err);
      setPurchaseInvoices(previousInvoices);
      setErrorBanner(err.message || 'Exchange rate serverless calculation error.');
    } finally {
      setIsEodRunning(false);
    }
  };

  // Reset helper
  const handleResetDb = () => {
    if (window.confirm('Wipe and restore default purchase entries payload?')) {
      resetPurchaseInvoicesDb();
      onRefresh();
      setEngineLogs([]);
      setShowLogs(false);
      setSuccessBanner('Accounting workspace restored to baseline seeded transactions successfully.');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* SUCCESS/ERROR NOTIFICATION TOASTS - FIXED OVERLAY TO PREVENT LAYOUT REFLOW */}
      <div className="fixed top-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
        {successBanner && (
          <div className="bg-emerald-50 dark:bg-emerald-950/95 border border-emerald-500/55 rounded-xl p-4 text-emerald-800 dark:text-emerald-200 flex items-start justify-between shadow-xl animate-fade-in pointer-events-auto">
            <div className="flex gap-2 w-full">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <div className="text-sm font-semibold">{successBanner}</div>
            </div>
            <button onClick={() => setSuccessBanner(null)} className="text-emerald-500 hover:text-emerald-700 cursor-pointer shrink-0 ml-2">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        
        {errorBanner && (
          <div className="bg-rose-50 dark:bg-rose-950/95 border border-rose-500/55 rounded-xl p-4 text-rose-800 dark:text-rose-200 flex items-start justify-between shadow-xl animate-fade-in pointer-events-auto overflow-hidden">
            <div className="flex gap-2 w-full">
              <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <div className="text-sm font-semibold overflow-hidden text-ellipsis">{errorBanner}</div>
            </div>
            <button onClick={() => setErrorBanner(null)} className="text-rose-500 hover:text-rose-700 cursor-pointer shrink-0 ml-2">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {isSyncing && (
          <div id="sync-status-banner-loading" className="bg-amber-50 dark:bg-amber-950/95 border border-amber-500/55 rounded-xl p-4 text-amber-850 dark:text-amber-200 flex items-start gap-2 shadow-xl animate-fade-in animate-pulse pointer-events-auto">
            <RefreshCw className="w-5 h-5 text-amber-500 shrink-0 mt-0.5 animate-spin" />
            <div className="text-sm font-semibold">Fetching latest data from Google Sheets...</div>
          </div>
        )}

        {syncSuccess && (
          <div id="sync-status-banner-success" className="bg-emerald-100 dark:bg-emerald-950/95 border border-emerald-500/55 rounded-xl p-4 text-emerald-900 dark:text-emerald-200 flex items-start gap-2 shadow-xl animate-fade-in pointer-events-auto">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-500 shrink-0 mt-0.5" />
            <div className="text-sm font-semibold">Sync Complete. All ledger rows fully updated.</div>
          </div>
        )}

        {syncError && (
          <div id="sync-status-banner-error" className="bg-rose-50 dark:bg-rose-950/95 border border-rose-500/55 rounded-xl p-4 text-rose-850 dark:text-rose-200 flex items-start gap-2 shadow-xl animate-fade-in pointer-events-auto">
            <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            <div className="text-sm font-semibold">Sync Error: Failed to communicate with Google Sheets. ({syncError})</div>
          </div>
        )}

        {isSyncingShipments && (
          <div className="bg-blue-100 dark:bg-blue-950/95 border border-blue-400 dark:border-blue-500/55 rounded-xl p-4 text-blue-900 dark:text-blue-200 flex items-start gap-2 shadow-xl animate-fade-in animate-pulse pointer-events-auto">
            <RefreshCw className="w-5 h-5 text-blue-600 dark:text-blue-500 shrink-0 mt-0.5 animate-spin" />
            <div className="text-sm font-semibold">Syncing Vendor Shipments... Fetching Purchase Invoices...</div>
          </div>
        )}

        {configError && (
          <div id="admin-config-error-banner" className="bg-amber-50 dark:bg-amber-950/90 border-2 border-amber-500/60 rounded-xl p-4 text-amber-900 dark:text-amber-200 shadow-xl animate-fade-in flex items-start gap-3 pointer-events-auto">
            <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5 animate-pulse" />
            <div className="flex-1">
              <h4 className="text-sm font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">Configuration Error</h4>
              <p className="text-xs font-semibold leading-relaxed mt-1">{configError}</p>
            </div>
          </div>
        )}
      </div>

      {/* HEADER SECTION LAYOUT */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-white flex items-center gap-2">
            <Database className="w-7 h-7 text-primary-500" />
            <span>Centralized Accounts View</span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5">
            Primary workspace to logs PurchaseInvoices, handle batch validation, and supervise automatic EOD conversions.
          </p>
        </div>

        {/* Global Action Area button */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <Button 
              onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition active:scale-95"
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
                        setIsModalOpen(true);
                        setIsAddMenuOpen(false);
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-700/60 transition-colors flex items-center gap-2 text-gray-900 dark:text-white font-bold cursor-pointer"
                    >
                      <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                      <span>Purchase Entry</span>
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
                    <button
                      type="button"
                      onClick={() => {
                        handleOpenAdjustmentModal();
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-700/60 transition-colors flex items-center gap-2 text-gray-900 dark:text-white font-bold cursor-pointer"
                    >
                      <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                      <span>Adjustment Entry</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <Button 
            onClick={handleResetDb}
            variant="primary"
            className="px-3 py-2 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-800/60 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
            title="Wipe and reset baseline"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* TRIPLE SUB-TAB LAYOUT ARCHITECTURE */}
      <div className="flex border-b border-gray-200 dark:border-gray-750 bg-slate-100/50 dark:bg-slate-900/50 p-1.5 rounded-xl gap-1 max-w-full overflow-x-auto shadow-sm">
        <button
          onClick={() => setActiveTab('purchase_entries')}
          className={`flex-1 md:flex-initial min-w-[180px] px-5 py-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2.5 ${
            activeTab === 'purchase_entries'
              ? 'bg-primary-600 text-white shadow-md font-black'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800/40'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>Purchase Entries</span>
          <span className={`px-2 py-0.5 text-[10px] font-black font-mono rounded-full ${
            activeTab === 'purchase_entries' ? 'bg-primary-700 text-white' : 'bg-gray-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
          }`}>
            {invoices.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('payment_entries')}
          className={`flex-1 md:flex-initial min-w-[180px] px-5 py-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2.5 ${
            activeTab === 'payment_entries'
              ? 'bg-primary-600 text-white shadow-md font-black'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800/40'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>Payment Entries</span>
        </button>

        <button
          onClick={() => setActiveTab('vendor_ledger')}
          className={`flex-1 md:flex-initial min-w-[180px] px-5 py-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2.5 ${
            activeTab === 'vendor_ledger'
              ? 'bg-primary-600 text-white shadow-md font-black'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800/40'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          <span>Vendor Ledger</span>
        </button>
      </div>

      {/* VIEWPORT AREA PANELS */}
      <div className="min-h-[400px]">
        
        {/* --- TAB 1: PURCHASE ENTRIES (ACTIVE VIEWER CONTAINER) --- */}
        {activeTab === 'purchase_entries' && (
          <div className="space-y-6 animate-fade-in">
            {/* Quick Metrics ribbon indicator bar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-white shadow-md rounded-xl p-5 flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-lg transition duration-200">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wider uppercase">Total Invoice Records</span>
                  <span className="p-2 bg-blue-50 dark:bg-blue-500/10 border border-blue-250 dark:border-blue-500/20 rounded-lg text-blue-600 dark:text-blue-400">
                    <Database className="w-4 h-4" />
                  </span>
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-800 dark:text-white shrink-0">{statsSummary.totalCount}</div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Logged in storage pipeline</p>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-white shadow-md rounded-xl p-5 flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-lg transition duration-200">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wider uppercase">Pending EOD Runs</span>
                  <span className="p-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-250 dark:border-amber-500/20 rounded-lg text-amber-600 dark:text-amber-400">
                    <Clock className="w-4 h-4 animate-pulse" />
                  </span>
                </div>
                <div>
                  <div className="text-2xl font-bold text-amber-600 dark:text-amber-500 shrink-0">{statsSummary.pendingCount}</div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Awaiting conversion closure</p>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-white shadow-md rounded-xl p-5 flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-lg transition duration-200">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wider uppercase">Pending RMB Valuation</span>
                  <span className="p-2 bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-250 dark:border-slate-700 rounded-lg text-yellow-600 dark:text-amber-300">
                    <DollarSign className="w-4 h-4" />
                  </span>
                </div>
                <div>
                  <div className="text-2xl font-bold text-yellow-600 dark:text-amber-300 shrink-0">¥{statsSummary.totalRmbPending.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Pending exchange computation</p>
                </div>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-white shadow-md rounded-xl p-5 flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-lg transition duration-200">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tracking-wider uppercase">Processed INR Valuation</span>
                  <span className="p-2 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-250 dark:border-emerald-500/20 rounded-lg text-emerald-600 dark:text-emerald-400">
                    <TrendingUp className="w-4 h-4 animate-pulse" />
                  </span>
                </div>
                <div>
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 shrink-0">₹{statsSummary.totalInrProcessed.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Converted ledger capitalization</p>
                </div>
              </div>
            </div>

            {/* FILTER CONSOLE PANEL */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-md p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                {/* Search Text input */}
                <div className="relative flex-1 sm:w-64">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                    <Search className="w-4 h-4" />
                  </span>
                  <input 
                    type="text" 
                    placeholder="Search invoice id or notes..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg pl-9 pr-4 py-2 text-sm text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 transition"
                  />
                </div>

                {/* Vendor selector dropdown filter */}
                <select
                  value={selectedVendorFilter}
                  onChange={e => setSelectedVendorFilter(e.target.value)}
                  className="bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition cursor-pointer"
                >
                  <option value="" className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">All active vendors</option>
                  {VENDOR_OPTIONS.map(v => (
                    <option key={v.code} value={v.code} className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">{v.displayText}</option>
                  ))}
                </select>

                {/* Reset Filter Button */}
                {(searchQuery || selectedVendorFilter) && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedVendorFilter('');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white bg-slate-50 hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 rounded-lg shadow-sm transition active:scale-95 cursor-pointer"
                    title="Reset Search and Vendor Filters"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                    <span>Reset Filter</span>
                  </button>
                )}
              </div>

              {/* Automatic EOD calculations script handler widget */}
              <div className="flex items-center gap-3 shrink-0 w-full md:w-auto justify-end border-t md:border-t-0 pt-3 md:pt-0 border-gray-150">
                <div className="text-right hidden lg:block">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1 justify-end">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    <span>EOD Closing Rate Engine</span>
                  </div>
                  <p className="text-[10px] text-gray-500">Auto sequential fallback lookup script</p>
                </div>

                <Button 
                  onClick={handleRunEodEngine} 
                  disabled={isEodRunning}
                  className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold px-4 py-2 rounded-lg shadow-sm font-mono text-sm active:scale-98 transition disabled:opacity-50 shrink-0"
                >
                  <RefreshCw className={`w-4 h-4 ${isEodRunning ? 'anim-spin' : ''}`} />
                  <span>{isEodRunning ? 'Processing...' : 'Run EOD Loop'}</span>
                </Button>
              </div>
            </div>

            {/* PIPELINE ENGINE CONSOLE DISPLAY LOG */}
            {showLogs && (
              <div className="bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 p-4 rounded-xl shadow-inner animate-slide-in">
                <div className="flex items-center justify-between border-b border-slate-300 dark:border-slate-800 pb-2 mb-3">
                  <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-mono text-xs uppercase font-bold">
                    <Terminal className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-emerald-600 dark:text-emerald-400 font-black">Calculation Suite Live Console Log</span>
                  </div>
                  <button 
                    onClick={() => setShowLogs(false)} 
                    className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-350 text-xs font-semibold font-mono"
                  >
                    [Close]
                  </button>
                </div>
                <div className="space-y-1 bg-slate-100 dark:bg-slate-900 text-[11px] font-mono text-emerald-600 dark:text-emerald-400 max-h-56 overflow-y-auto leading-relaxed scrollbar-thin">
                  {isEodRunning ? (
                    <p className="animate-pulse flex items-center gap-2 text-slate-550 dark:text-slate-400">
                      <Clock className="w-3.5 h-3.5 animate-spin text-amber-500" />
                      <span>Scanning database tables... Connecting to global currency feeds via GOOGLEFINANCE API...</span>
                    </p>
                  ) : engineLogs.length > 0 ? (
                    engineLogs.map((log, index) => <div key={index}>{log}</div>)
                  ) : (
                    <span className="text-slate-500 dark:text-slate-500 italic">Console ready. Click "Run EOD Loop" to calculate valuations.</span>
                  )}
                </div>
              </div>
            )}

            {/* DATA GRID TABLE CONTAINER */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-md overflow-hidden rounded-xl animate-fade-in">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[1000px]">
                  <thead>
                    <tr className="bg-gray-50/70 dark:bg-slate-900/40 text-[10px] font-black text-gray-500 dark:text-gray-440 uppercase tracking-widest border-b border-gray-200 dark:border-gray-700 select-none">
                      <th className="px-5 py-4 w-[14%]">Date (DATE)</th>
                      <th className="px-5 py-4 w-[16%]">Invoice ID (VARCHAR)</th>
                      <th className="px-5 py-4 w-[14%]">Vendor Code (VARCHAR)</th>
                      <th className="px-5 py-4 w-[14%] text-right">RMB (DECIMAL)</th>
                      <th className="px-5 py-4 w-[12%] text-center">ER (DECIMAL)</th>
                      <th className="px-5 py-4 w-[14%] text-right">INR (DECIMAL)</th>
                      <th className="px-5 py-4 w-[12%] text-right">Balance (RMB)</th>
                      <th className="px-5 py-4 w-[16%]">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-150 dark:divide-slate-700/50">
                    {filteredInvoices.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-5 py-16 text-center text-gray-400 dark:text-gray-500 italic">
                          No accounting entries captured matching current filters. Click "Add Entry" to create.
                        </td>
                      </tr>
                    ) : (
                      filteredInvoices.map((inv) => {
                        const isProcessed = inv.status === 'Processed';
                        return (
                          <tr key={inv.invoiceId} className="hover:bg-slate-50/40 dark:hover:bg-slate-700/25 transition">
                            {/* Date */}
                            <td className="px-5 py-4 text-xs font-mono text-gray-700 dark:text-gray-300">
                              <div className="flex items-center gap-2">
                                <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                <span>{inv.date}</span>
                              </div>
                            </td>

                            {/* Invoice ID */}
                            <td className="px-5 py-4 text-xs font-bold font-mono text-gray-900 dark:text-white tracking-tight">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span>{inv.invoiceId}</span>
                                {(inv as any).syncStatus && (inv as any).syncStatus !== 'synced' && (
                                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8.5px] font-extrabold pb-[0.5px] ${
                                    (inv as any).syncStatus === 'pending' ? 'bg-amber-100 text-amber-800' :
                                    (inv as any).syncStatus === 'syncing' ? 'bg-blue-100 text-blue-800 animate-pulse' :
                                    'bg-rose-100 text-rose-800 border border-rose-200'
                                  }`}>
                                    {(inv as any).syncStatus === 'pending' ? '⏳ Queue' :
                                     (inv as any).syncStatus === 'syncing' ? '⚙️ Saving' : '❌ Fail'}
                                    {(inv as any).syncStatus === 'failed' && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          (window as any).SyncQueueManager?.retry((inv as any).queueId || inv.invoiceId);
                                        }}
                                        className="ml-1 bg-rose-600 hover:bg-rose-700 text-white font-black px-1 rounded text-[8px] uppercase transition-colors shrink-0"
                                      >
                                        Retry
                                      </button>
                                    )}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Vendor Code */}
                            <td className="px-5 py-4 text-xs">
                              <span className="px-2 py-1 font-bold font-mono bg-slate-100 dark:bg-slate-700/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-md">
                                {inv.vendorCode}
                              </span>
                            </td>

                            {/* RMB */}
                            <td className="px-5 py-4 text-xs font-semibold font-mono text-gray-900 dark:text-white text-right">
                              ¥{inv.rmb.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                            </td>

                            {/* ER */}
                            <td className="px-5 py-4 text-xs text-center font-mono">
                              {inv.er1 && inv.inr && Number(inv.er1) !== 0 && Number(inv.inr) !== 0 ? (
                                <span className="text-gray-800 dark:text-gray-200 font-bold">
                                  {Number(inv.er1).toFixed(4)}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200/60 dark:border-amber-900/40 animate-pulse">
                                  Pending
                                </span>
                              )}
                            </td>

                            {/* INR */}
                            <td className="px-5 py-4 text-xs font-bold font-mono text-right">
                              {inv.er1 && inv.inr && Number(inv.er1) !== 0 && Number(inv.inr) !== 0 ? (
                                <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                  ₹{Number(inv.inr).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                </span>
                              ) : (
                                <span className="text-amber-600 dark:text-amber-400 italic animate-pulse">Pending</span>
                              )}
                            </td>

                            {/* Balance */}
                            <td className="px-5 py-4 text-xs font-bold font-mono text-right">
                              <span className="text-indigo-600 dark:text-indigo-400">
                                {(() => {
                                  const relevantSettlements = settlementRecords.filter(s => s.invoice_no === inv.invoiceId && s.txnType === 'Invoice Settlement');
                                  const totalSettledRmb = relevantSettlements.reduce((sum, s) => sum + s.amountRmb, 0);
                                  const calculatedBalance = Math.max(0, (inv.rmb || 0) - totalSettledRmb);
                                  return `¥${calculatedBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                                })()}
                              </span>
                            </td>

                            {/* Note */}
                            <td className="px-5 py-4 text-xs text-gray-500 dark:text-gray-400 max-w-[200px] truncate" title={inv.notes || ''}>
                              {inv.notes || <span className="text-gray-300 dark:text-slate-600 italic">—</span>}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* --- TAB 2: PAYMENT ENTRIES (LIVE REMITTANCE LOG DATA GRID) --- */}
        {activeTab === 'payment_entries' && (
          <div className="space-y-6">
            
            {/* Header info card */}
            <div className="bg-slate-50 dark:bg-gray-850 border border-slate-200 dark:border-gray-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm animate-fade-in">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5 leading-none">
                  <CreditCard className="w-4 h-4 text-indigo-505" />
                  <span>Outward Remittance Payments Ledger</span>
                </h3>
                <p className="text-[11px] text-gray-500 mt-1 max-w-xl">
                  Records of historical remittances and vendor balances. This list retrieves live, finalized payment rows mapped directly from spreadsheet transactions.
                </p>
              </div>

              {/* Refresh trigger button */}
              <Button 
                onClick={onRefresh} 
                className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-805 text-gray-700 dark:text-gray-300 font-bold px-3.5 py-1.5 rounded-lg border border-gray-250 dark:border-gray-800 text-xs active:scale-98 transition shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Re-Load Payments</span>
              </Button>
            </div>

            {/* Live table container */}
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-md overflow-hidden rounded-xl animate-fade-in">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[1000px]">
                  <thead>
                    <tr className="bg-gray-50/70 dark:bg-slate-900/40 text-[10px] font-black text-gray-500 dark:text-gray-440 uppercase tracking-widest border-b border-gray-200 dark:border-gray-700 select-none">
                      <th className="px-5 py-4 w-[12%]">Payment ID</th>
                      <th className="px-5 py-4 w-[14%]">Date (DATE)</th>
                      <th className="px-5 py-4 w-[14%]">Selected Vendor</th>
                      <th className="px-5 py-4 w-[14%] text-right font-mono">RMB Amount (¥)</th>
                      <th className="px-5 py-4 w-[12%] text-center">ER2 (DECIMAL)</th>
                      <th className="px-5 py-4 w-[14%] text-right font-mono">INR Value (₹)</th>
                      <th className="px-5 py-4 w-[12%] text-right font-mono">Balance (¥)</th>
                      <th className="px-5 py-4 w-[20%]">Details / Reference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-150 dark:divide-slate-700/50">
                    {filteredPaymentLogs.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-5 py-16 text-center text-gray-400 dark:text-gray-500 italic">
                          No remittance payments captured matching current filters. Click "Add Entry" to create.
                        </td>
                      </tr>
                    ) : (
                      filteredPaymentLogs.map((log) => (
                        <tr key={log.paymentId} className="hover:bg-slate-50/40 dark:hover:bg-slate-700/25 transition text-xs font-medium">
                          
                          {/* ID */}
                          <td className="px-5 py-4 font-black font-mono text-indigo-600 dark:text-indigo-400 text-xs tracking-tight">
                            {log.paymentId}
                          </td>

                          {/* Date */}
                          <td className="px-5 py-4 text-gray-700 dark:text-gray-300 font-mono">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                              <span>{log.date}</span>
                            </div>
                          </td>

                          {/* Vendor */}
                          <td className="px-5 py-4">
                            <span className="px-2 py-1 font-bold font-mono bg-slate-100 dark:bg-slate-700/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-md">
                              {log.vendorCode}
                            </span>
                          </td>

                          {/* RMB */}
                          <td className="px-5 py-4 font-bold font-mono text-gray-900 dark:text-white text-right">
                            ¥{log.rmbAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                          </td>

                          {/* ER2 */}
                          <td className="px-5 py-4 text-center font-mono font-bold text-gray-800 dark:text-gray-200">
                            {log.fxRate.toFixed(4)}
                          </td>

                          {/* INR */}
                          <td className="px-5 py-4 font-black font-mono text-emerald-600 dark:text-emerald-400 text-right">
                            ₹{log.inrAmount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                          </td>

                          {/* Balance */}
                          <td className="px-5 py-4 font-black font-mono text-indigo-600 dark:text-indigo-400 text-right">
                            {(() => {
                              // Find all records in the Settlement Ledger for this payment ID
                              const relevantRecords = settlementRecords.filter(s => s.paymentId === log.paymentId);
                              
                              // Total RMB spent on actual invoice settlements
                              const invoiceSettlementRecords = relevantRecords.filter(s => s.txnType === 'Invoice Settlement');
                              const totalSettledRmb = invoiceSettlementRecords.reduce((sum, s) => sum + s.amountRmb, 0);
                              
                              // Checking if there is an explicit advance record in the Settlement Ledger
                              const hasAdvanceRecord = relevantRecords.some(s => s.invoice_no === 'ADVANCE' || s.txnType === 'Advance Payment');
                              
                              // Checking if there is any partial settlement (some settled, but not all)
                              const isPartiallySettled = totalSettledRmb > 0 && totalSettledRmb < log.rmbAmount;
                              
                              // Remaining amount left for settlement
                              const remainingRmb = Math.max(0, log.rmbAmount - totalSettledRmb);
                              
                              // We only showcase the balance if it's an advance or partially settled
                              // (and there's still some remaining amount left)
                              if ((hasAdvanceRecord || isPartiallySettled) && remainingRmb > 0) {
                                return `¥${remainingRmb.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                              }
                              return <span className="text-gray-300 dark:text-slate-650 font-normal select-none">—</span>;
                            })()}
                          </td>

                          {/* Details */}
                          <td className="px-5 py-4">
                            <div className="space-y-1 max-w-[240px]">
                              <p className="text-gray-900 dark:text-gray-200 font-bold leading-none truncate">
                                Mode: {log.paymentMode || 'Bank Transfer'}
                              </p>
                              {log.referenceNo && (
                                <p className="text-[10px] text-gray-400 font-mono truncate">
                                  Ref: {log.referenceNo}
                                </p>
                              )}
                              {log.allocations && log.allocations.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-1">
                                  {log.allocations.map((a: any, i: number) => (
                                    <span key={i} className="text-[9px] bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-950/60 px-1.5 py-0.2 rounded font-mono">
                                      {a.vendorCode}: ¥{a.amount}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>

                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* --- TAB 3: VENDOR LEDGER (RECONCILIATION PANEL) --- */}
        {activeTab === 'vendor_ledger' && (
          <VendorLedgerTab 
            invoices={invoices}
            paymentLogs={paymentLogs}
            settlementRecords={settlementRecords}
            liveLedger={vendorLedger}
            vendors={vendors}
            onOpenAdjustmentModal={handleOpenAdjustmentModal}
          />
        )}
      </div>

      {/* --- INVOICE ENTRY MODAL FORM HANDLER CONTEXT (POPUP MODAL) --- */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4">
          {/* Backdrop screen filter */}
          <div 
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity duration-300" 
            onClick={() => setIsModalOpen(false)} 
          />

          <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 max-w-lg w-full overflow-hidden transform transition-all animate-zoom-in">
            {/* Header section banner */}
            <div className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-slate-900 dark:to-slate-950 text-slate-800 dark:text-white border-b border-gray-200 dark:border-slate-800 px-6 py-4.5 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black flex items-center gap-2 text-slate-800 dark:text-white">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary-500 animate-pulse" />
                  <span>Invoice Entry Form</span>
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Input direct purchase ledger rows. Submits as "Pending EOD" for background rates computation.
                </p>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)} 
                className="p-1.5 rounded-lg text-slate-400 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error banner dedicated to modal state */}
            {errorBanner && (
              <div className="mx-6 mt-4 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-lg text-rose-500 dark:text-rose-400 text-xs font-bold font-mono">
                Error: {errorBanner}
              </div>
            )}

            {/* Input Form Fields */}
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
                    maxLength={30}
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
                      className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-950 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                    >
                      {VENDOR_OPTIONS.map(v => (
                        <option key={v.code} value={v.code}>{v.displayText}</option>
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
              <div className="bg-amber-50 dark:bg-slate-900 p-3.5 rounded-xl border border-amber-200/60 dark:border-slate-800 flex items-start gap-2 text-slate-500 dark:text-slate-400">
                <ShieldAlert className="w-4.5 h-4.5 text-amber-500 shrink-0 mt-0.5" />
                <span className="text-[10.5px] leading-relaxed">
                  <strong>EOD Variables Isolated:</strong> Background variables (<code>ER1</code> and <code>INR</code> valuation values) are completely isolated from this form layout. Rate conversions are resolved automatically on matching value dates.
                </span>
              </div>

              {/* Dialog controls */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    setErrorBanner(null);
                  }}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 bg-gray-50 hover:bg-gray-100 dark:bg-slate-700/60 dark:hover:bg-slate-700 rounded-lg shadow-sm transition"
                >
                  Cancel
                </button>
                <Button
                  type="submit"
                  disabled={isSubmittingInvoice}
                  className="px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white bg-primary-600 hover:bg-primary-700 rounded-lg shadow-md transition flex items-center gap-2"
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
          </div>
        </div>
      )}

      {/* --- ADJUSTMENT ENTRY MODAL FORM --- */}
      {isAdjustmentModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4" id="adjustment-entry-modal">
          <div 
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity duration-300" 
            onClick={() => setIsAdjustmentModalOpen(false)} 
          />

          <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 max-w-xl w-full overflow-hidden transform transition-all animate-zoom-in">
            {/* Header */}
            <div className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-slate-900 dark:to-slate-950 text-slate-800 dark:text-white border-b border-gray-200 dark:border-slate-800 px-6 py-4.5 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black flex items-center gap-2 text-slate-800 dark:text-white">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
                  <span>Adjustment Entry Form</span>
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Adjust cross-vendor allocations or transfer outstanding pre-paid credits.
                </p>
              </div>
              <button 
                onClick={() => setIsAdjustmentModalOpen(false)} 
                className="p-1.5 rounded-lg text-slate-400 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error banner */}
            {errorBanner && (
              <div className="mx-6 mt-4 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-lg text-rose-500 dark:text-rose-400 text-xs font-bold font-mono">
                Error: {errorBanner}
              </div>
            )}

            <form onSubmit={handleCreateAdjustment} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* First Row: Posting Date & Adjustment Amount */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                    Adjustment Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={adjustmentDate}
                    onChange={(e) => setAdjustmentDate(e.target.value)}
                    className="block w-full rounded-lg border border-gray-300 dark:border-gray-650 bg-gray-50 dark:bg-gray-900 text-gray-955 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                    Adjustment Amount (RMB ¥) *
                  </label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 font-bold">
                      ¥
                    </span>
                    <input
                      type="number"
                      required
                      min={0.01}
                      step="any"
                      placeholder="e.g. 10000"
                      value={adjustmentAmount}
                      onChange={(e) => setAdjustmentAmount(e.target.value)}
                      className="block w-full rounded-lg border border-gray-300 dark:border-gray-650 bg-gray-50 dark:bg-gray-900 text-gray-905 dark:text-white pl-8 pr-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500 font-bold font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Paying Vendor selection */}
              <div>
                <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                  Paying Vendor *
                </label>
                <select
                  required
                  value={adjustmentPayingVendor}
                  onChange={(e) => setAdjustmentPayingVendor(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 dark:border-gray-650 bg-gray-50 dark:bg-gray-900 text-gray-955 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="">-- Select Paying Vendor --</option>
                  {VENDOR_OPTIONS.map(v => (
                    <option key={v.code} value={v.code}>{v.displayText}</option>
                  ))}
                </select>
              </div>

              {/* Current Balance Preview */}
              {adjustmentPayingVendor && (
                <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-200/60 dark:border-slate-700/60 flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase text-gray-600 dark:text-gray-400 tracking-wider">
                    {getVendorBalance(adjustmentPayingVendor) > 0 
                      ? 'Advance Credit' 
                      : getVendorBalance(adjustmentPayingVendor) < 0 
                      ? 'Outstanding Liability' 
                      : 'Current Balance'
                    }
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${
                      getVendorBalance(adjustmentPayingVendor) > 0 
                        ? 'bg-emerald-500' 
                        : getVendorBalance(adjustmentPayingVendor) < 0 
                        ? 'bg-rose-500' 
                        : 'bg-gray-400'
                    }`} />
                    <span className={`font-mono text-sm font-black ${
                      getVendorBalance(adjustmentPayingVendor) > 0 
                        ? 'text-emerald-600 dark:text-emerald-400' 
                        : getVendorBalance(adjustmentPayingVendor) < 0 
                        ? 'text-rose-600 dark:text-rose-450' 
                        : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {getVendorBalance(adjustmentPayingVendor) === 0 
                        ? '¥0.00' 
                        : `${getVendorBalance(adjustmentPayingVendor) > 0 ? '+¥' : '-¥'}${Math.abs(getVendorBalance(adjustmentPayingVendor)).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
                      }
                    </span>
                  </div>
                </div>
              )}

              {/* Receiving Vendors Allocations Title */}
              <div className="pt-2 border-t border-gray-150 dark:border-gray-700">
                <span className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-3 flex items-center justify-between">
                  <span>Receiving Vendor Allocations</span>
                  <span className="font-mono text-[10px] font-bold text-gray-400 normal-case bg-slate-100 dark:bg-slate-900 px-2 py-0.5 rounded">
                    Allocated: ¥{adjustmentAllocations.reduce((sum, val) => sum + (parseFloat(val.amount) || 0), 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} / ¥{(parseFloat(adjustmentAmount) || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                  </span>
                </span>

                {/* Allocation row maps */}
                <div className="space-y-3">
                  {adjustmentAllocations.map((alloc, index) => (
                    <div key={index} className="flex gap-3 items-end bg-slate-50/50 dark:bg-slate-900/10 p-3 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">
                      <div className="flex-1">
                        <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">
                          Receiving Vendor {index + 1} *
                        </label>
                        <select
                          required
                          value={alloc.vendorCode}
                          onChange={(e) => {
                            const updated = [...adjustmentAllocations];
                            updated[index].vendorCode = e.target.value;
                            setAdjustmentAllocations(updated);
                          }}
                          className="block w-full rounded-lg border border-gray-300 dark:border-gray-650 bg-white dark:bg-gray-900 text-gray-955 dark:text-white px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                        >
                          <option value="">-- Select Sourcing Vendor --</option>
                          {/* Exclude currently selected paying vendor */}
                          {VENDOR_OPTIONS.filter(v => v.code !== adjustmentPayingVendor).map(v => (
                            <option key={v.code} value={v.code}>{v.displayText}</option>
                          ))}
                        </select>
                      </div>

                      <div className="w-[150px]">
                        <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">
                          Allocated (RMB ¥) *
                        </label>
                        <div className="relative">
                          <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-400 text-xs font-bold">
                            ¥
                          </span>
                          <input
                            type="number"
                            required
                            min={0.01}
                            step="any"
                            placeholder="Amount"
                            value={alloc.amount}
                            onChange={(e) => {
                              const updated = [...adjustmentAllocations];
                              updated[index].amount = e.target.value;
                              setAdjustmentAllocations(updated);
                            }}
                            className="block w-full rounded-lg border border-gray-300 dark:border-gray-650 bg-white dark:bg-gray-900 text-gray-950 dark:text-white pl-6 pr-2 py-1.5 text-xs focus:ring-1 focus:ring-primary-500 focus:border-primary-500 font-bold font-mono"
                          />
                        </div>
                      </div>

                      {adjustmentAllocations.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            setAdjustmentAllocations(adjustmentAllocations.filter((_, idx) => idx !== index));
                          }}
                          className="p-1 px-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20 border border-transparent transition"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setAdjustmentAllocations([...adjustmentAllocations, { vendorCode: '', amount: '' }]);
                  }}
                  className="mt-3 flex items-center gap-1.5 text-[11px] font-black uppercase text-indigo-650 dark:text-indigo-400 hover:text-indigo-700 hover:underline cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Add Additional Vendor Line</span>
                </button>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                  Adjustment Explanation & Notes
                </label>
                <textarea
                  placeholder="Explain why this adjustment is being recorded..."
                  rows={2}
                  maxLength={150}
                  value={adjustmentNotes}
                  onChange={(e) => setAdjustmentNotes(e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 dark:border-gray-650 bg-gray-50 dark:bg-gray-900 text-gray-955 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>

              {/* Validation Warning State */}
              {(() => {
                const totalAmountFloat = parseFloat(adjustmentAmount) || 0;
                const totalAllocatedFloat = adjustmentAllocations.reduce((acc, alloc) => acc + (parseFloat(alloc.amount) || 0), 0);
                const hasMismatch = Math.abs(totalAmountFloat - totalAllocatedFloat) > 0.01;
                
                if (hasMismatch && totalAmountFloat > 0) {
                  return (
                    <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-xl flex items-center gap-2 text-rose-600 dark:text-rose-400 text-[11px] font-bold">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>Allocated amount must equal adjustment amount.</span>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Dialog controls */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => {
                    setIsAdjustmentModalOpen(false);
                    setErrorBanner(null);
                  }}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 bg-gray-50 hover:bg-gray-100 dark:bg-slate-700/60 dark:hover:bg-slate-700 rounded-lg shadow-sm transition"
                >
                  Cancel
                </button>
                <Button
                  type="submit"
                  disabled={isSubmittingAdjustment || (() => {
                    const totalAmountFloat = parseFloat(adjustmentAmount) || 0;
                    const totalAllocatedFloat = adjustmentAllocations.reduce((acc, alloc) => acc + (parseFloat(alloc.amount) || 0), 0);
                    return totalAmountFloat <= 0 || Math.abs(totalAmountFloat - totalAllocatedFloat) > 0.01;
                  })()}
                  className="px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
                >
                  {isSubmittingAdjustment ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Processing Adjustment...
                    </>
                  ) : (
                    'Submit Adjustment'
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
