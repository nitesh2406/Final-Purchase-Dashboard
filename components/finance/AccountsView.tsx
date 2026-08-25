import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { viewToPath } from '../../routes';
import { useQueryParam, useQueryParamFast } from '../../hooks/useQueryParam';
import {
  getPurchaseInvoices,
  submitPurchaseInvoice, 
  executeEODExchangeRateEngine,
  PurchaseInvoice,
  fetchPurchaseInvoices,
  logAdjustmentTransfer,
  generateAdjustmentId,
  fetchPaymentLogs,
  getPaymentLogs,
  PaymentLog,
  SettlementRecord,
  VendorLedgerEntry,
  IS_DEVELOPMENT_MODE
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
  Landmark,
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
import { SettlementLedger } from './SettlementLedger';

// Active tab types
type ActiveTabType = 'purchase_entries' | 'payment_entries' | 'vendor_ledger' | 'settlement_ledger';

interface AccountsViewProps {
  onNavigateToDetail?: (batchId: string) => void;
  onNavigate?: (view: any) => void;
  invoices: (PurchaseInvoice & { temp?: boolean })[];
  paymentLogs: (PaymentLog & { temp?: boolean })[];
  settlementRecords: (SettlementRecord & { temp?: boolean; createdAtTimestamp?: number })[];
  setSettlementRecords: React.Dispatch<React.SetStateAction<(SettlementRecord & { temp?: boolean; createdAtTimestamp?: number })[]>>;
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
  settlementRecords,
  setSettlementRecords,
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
  const navigate = useNavigate();

  // URL-synced filter state
  const [searchQuery, setSearchQuery] = useQueryParamFast('search', '');
  const [selectedVendorFilter, setSelectedVendorFilter] = useQueryParam<string>('vendor', '');
  const [statusFilter, setStatusFilter] = useQueryParam<string>('status', 'all');
  const [configError, setConfigError] = useState<string | null>(null);

  // Purchase Entries pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Payment Entries pagination
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsPageSize, setPaymentsPageSize] = useState(10);
  
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

  // Automatically trigger sync refresh when switching to the Vendor Ledger tab.
  // (Settlement Ledger is excluded: it already refreshes itself on mount via its
  // own useEffect in SettlementLedger.tsx, so including it here would double-fetch.)
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

  // Cross-vendor settlements (paying vendor -> one or more receiving vendors) are logged
  // on the dedicated Cross Vendor Settlement page; this just routes there, optionally
  // pre-selecting the paying vendor when triggered from a specific vendor's ledger row.
  const handleOpenAdjustmentModal = (payingVendor: string = '') => {
    setIsAddMenuOpen(false);
    const path = viewToPath('Cross Vendor Settlement');
    navigate(payingVendor ? `${path}?payingVendor=${encodeURIComponent(payingVendor)}` : path);
  };

  // Derives an invoice's outstanding balance from actual 'Invoice Settlement' records
  // (the invoice's own stored balance/settledAmount fields aren't kept in sync by the
  // settlement-logging backend action, so the ledger is the source of truth here).
  const getInvoiceSettlementInfo = (inv: PurchaseInvoice) => {
    const relevantSettlements = settlementRecords.filter(s => s.invoiceId === inv.invoiceId && s.txnType === 'Invoice Settlement');
    // Auto FIFO-settlement rows store amountRmb as a negative debit (drawn from the
    // vendor's own wallet); cross-vendor Adjustment Transfer In rows store it positive.
    // Both represent the same thing from the invoice's perspective — money applied
    // against it — so take the magnitude rather than the signed value.
    const totalSettledRmb = relevantSettlements.reduce((sum, s) => sum + Math.abs(s.amountRmb), 0);
    const balance = Math.max(0, (inv.rmb || 0) - totalSettledRmb);
    const status: 'Unpaid' | 'Partial' | 'Settled' = totalSettledRmb <= 0 ? 'Unpaid' : balance <= 0.01 ? 'Settled' : 'Partial';
    return { totalSettledRmb, balance, status };
  };

  // Settle Invoice modal state. In practice every invoice settlement here is actually paid
  // by a different vendor's credit (a cross-vendor transfer), not the invoice's own vendor
  // paying directly — so this logs via the same Transfer mechanism Cross-Vendor Settlement
  // uses (add_adjustment_entry, mirrored into VendorLedger for both sides) instead of the
  // old direct logSettlementRecord call, which only ever wrote to SettlementLedger and never
  // actually moved the paying/receiving vendors' live Vendor Ledger balances.
  const [settleModalInvoice, setSettleModalInvoice] = useState<PurchaseInvoice | null>(null);
  const [settleForm, setSettleForm] = useState({
    date: new Date().toISOString().split('T')[0],
    amountRmb: '',
    payingVendor: '',
    notes: ''
  });
  const { isSubmitting: isSubmittingSettlement, withSubmissionGuard: withSettlementGuard } = useSubmissionLock();

  const handleOpenSettleModal = (inv: PurchaseInvoice, balance: number) => {
    setSettleModalInvoice(inv);
    setSettleForm({
      date: new Date().toISOString().split('T')[0],
      amountRmb: balance.toFixed(2),
      payingVendor: '',
      notes: ''
    });
    setErrorBanner(null);
    setIsAddMenuOpen(false);
  };

  const handleConfirmSettlement = (e: React.FormEvent) => {
    e.preventDefault();
    const inv = settleModalInvoice;
    if (!inv) return;

    withSettlementGuard(async () => {
      setErrorBanner(null);

      const amountRmb = parseFloat(settleForm.amountRmb) || 0;
      const { balance } = getInvoiceSettlementInfo(inv);

      if (!settleForm.payingVendor) {
        setErrorBanner('Please select the vendor that is paying for this invoice.');
        return;
      }
      if (amountRmb <= 0) {
        setErrorBanner('Settlement amount must be a positive number.');
        return;
      }
      if (amountRmb > balance + 0.01) {
        setErrorBanner(`Settlement amount cannot exceed the outstanding balance of ¥${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`);
        return;
      }

      const payingVendor = settleForm.payingVendor;
      const payingVendorName = VENDOR_OPTIONS.find(v => v.code === payingVendor)?.name || payingVendor;
      const adjId = generateAdjustmentId(settlementRecords);

      try {
        // No fxRate is sent here — the backend derives the real settled rate itself by
        // draining the paying vendor's own unspent payment wallets FIFO (falling back to
        // a GOOGLEFINANCE lookup for any shortfall), and computes real forex gain/loss
        // against this invoice's own ER1.
        await logAdjustmentTransfer({
          paymentId: adjId,
          sourceVendor: payingVendor,
          targetVendor: inv.vendorCode,
          amountRmb,
          date: settleForm.date,
          notes: settleForm.notes || undefined,
          invoiceId: inv.invoiceId
        });

        // Optimistic local insert for instant feedback; onRefresh() below fetches the
        // backend-assigned record shortly after, and reconcileTempRecords() (App.tsx)
        // ages this placeholder out once that's happened (or after its own timeout).
        // Settled rate/forex are left at 0 as a "pending" placeholder since the real
        // values are computed server-side.
        const recordPayload = {
          date: settleForm.date,
          invoiceId: inv.invoiceId,
          vendorNo: payingVendor,
          vendorName: payingVendorName,
          txnType: 'Invoice Settlement' as const,
          amountRmb,
          amountInr: 0,
          exchangeRatePrimary: 0,
          exchangeRateSettlement: 0,
          forexGainLoss: 0,
          notes: settleForm.notes || undefined,
          paymentId: adjId
        };
        setSettlementRecords(prev => [{ id: `SET-TEMP-${Date.now()}`, ...recordPayload, temp: true, createdAtTimestamp: Date.now() }, ...prev]);
        setSuccessBanner(`Settlement of ¥${amountRmb.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} submitted against invoice "${inv.invoiceId}", paid by ${payingVendor} — syncing to the ledger now.`);
        setSettleModalInvoice(null);

        onRefresh();
      } catch (err: any) {
        setErrorBanner(`Sync Failure: Could not log the settlement (${err.message || err}). Please try again.`);
      }
    });
  };

  // Filter criteria computation
  const searchVendorFilteredInvoices = useMemo(() => {
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

  // Counts for the status filter badges reflect search/vendor filters, but not the
  // status filter itself, so switching badges doesn't move the other badges' counts.
  const statusFilterCounts = useMemo(() => {
    let settled = 0;
    let unpaid = 0;
    searchVendorFilteredInvoices.forEach(inv => {
      if (getInvoiceSettlementInfo(inv).status === 'Settled') settled++;
      else unpaid++;
    });
    return { all: searchVendorFilteredInvoices.length, settled, unpaid };
  }, [searchVendorFilteredInvoices, settlementRecords]);

  const filteredInvoices = useMemo(() => {
    if (statusFilter === 'all') return searchVendorFilteredInvoices;
    // "Unpaid" bucket covers both 'Unpaid' and 'Partial' — anything with money still owed.
    return searchVendorFilteredInvoices.filter(inv =>
      statusFilter === 'settled'
        ? getInvoiceSettlementInfo(inv).status === 'Settled'
        : getInvoiceSettlementInfo(inv).status !== 'Settled'
    );
  }, [searchVendorFilteredInvoices, statusFilter, settlementRecords]);

  // Reset to page 1 whenever the visible result set would change under the current page
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedVendorFilter, statusFilter, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / pageSize));
  const effectivePage = Math.min(currentPage, totalPages);
  const paginatedInvoices = useMemo(() => {
    const start = (effectivePage - 1) * pageSize;
    return filteredInvoices.slice(start, start + pageSize);
  }, [filteredInvoices, effectivePage, pageSize]);

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

  useEffect(() => {
    setPaymentsPage(1);
  }, [searchQuery, selectedVendorFilter, paymentsPageSize]);

  const paymentsTotalPages = Math.max(1, Math.ceil(filteredPaymentLogs.length / paymentsPageSize));
  const paymentsEffectivePage = Math.min(paymentsPage, paymentsTotalPages);
  const paginatedPaymentLogs = useMemo(() => {
    const start = (paymentsEffectivePage - 1) * paymentsPageSize;
    return filteredPaymentLogs.slice(start, start + paymentsPageSize);
  }, [filteredPaymentLogs, paymentsEffectivePage, paymentsPageSize]);

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
          setSuccessBanner(`Invoice "${tempInvoice.invoiceId}" submitted — queued and syncing to the centralized ledger pipeline.`);
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

          // Auto-run the EOD exchange-rate engine so this invoice gets its ER1/INR
          // immediately instead of sitting "Pending" until someone clicks Run EOD Loop.
          // Best-effort: fetch a server-fresh invoice list (the `invoices` prop here is
          // stale until next render) and hand it straight to the engine.
          try {
            const freshInvoices = await fetchPurchaseInvoices();
            await handleRunEodEngine(freshInvoices);
          } catch (eodErr) {
            console.warn("Auto EOD run after invoice creation failed (invoice was still saved):", eodErr);
          }
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

  // Run calculation engine. Pass invoicesOverride when calling right after a write
  // (e.g. auto-run after logging a new invoice) since the `invoices` prop won't
  // reflect that write until the next render.
  const handleRunEodEngine = async (invoicesOverride?: (PurchaseInvoice & { temp?: boolean })[]) => {
    const invoicesToProcess = invoicesOverride ?? invoices;
    setIsEodRunning(true);
    setEngineLogs([]);
    setShowLogs(true);
    setSuccessBanner(null);
    setErrorBanner(null);
    const previousInvoices = [...invoicesToProcess];

    try {
      // Small timeout to simulate secure database pipeline run animation
      await new Promise(resolve => setTimeout(resolve, 500));
      const result = await executeEODExchangeRateEngine(invoicesToProcess, (updated) => {
        // Instantly apply updated records containing calculated exchange rates to state before write-back completes
        const uniqueMap = new Map();
        updated.forEach(item => {
          if (item && item.invoiceId) {
            uniqueMap.set(String(item.invoiceId).trim().toLowerCase(), item);
          }
        });
        setPurchaseInvoices(Array.from(uniqueMap.values()));
      }, vendors);

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
                      <span>Cross-Vendor Settlement</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <Button
            onClick={handleRefresh}
            variant="primary"
            className="px-3 py-2 border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-slate-800/60 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
            title="Refresh data"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* SUB-TAB LAYOUT ARCHITECTURE */}
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

        <button
          onClick={() => setActiveTab('settlement_ledger')}
          className={`flex-1 md:flex-initial min-w-[180px] px-5 py-3 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2.5 ${
            activeTab === 'settlement_ledger'
              ? 'bg-primary-600 text-white shadow-md font-black'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800/40'
          }`}
        >
          <Landmark className="w-4 h-4" />
          <span>Settlement Ledger</span>
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

                {/* Status filter badges */}
                <div className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg p-1">
                  {([
                    { key: 'all', label: 'All', count: statusFilterCounts.all },
                    { key: 'settled', label: 'Settled', count: statusFilterCounts.settled },
                    { key: 'unpaid', label: 'Unpaid', count: statusFilterCounts.unpaid }
                  ] as const).map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setStatusFilter(opt.key)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wide transition cursor-pointer ${
                        statusFilter === opt.key
                          ? opt.key === 'settled'
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : opt.key === 'unpaid'
                            ? 'bg-rose-600 text-white shadow-sm'
                            : 'bg-primary-600 text-white shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      <span>{opt.label}</span>
                      <span className={`px-1.5 rounded-full text-[10px] ${statusFilter === opt.key ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-700'}`}>
                        {opt.count}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Reset Filter Button */}
                {(searchQuery || selectedVendorFilter || statusFilter !== 'all') && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedVendorFilter('');
                      setStatusFilter('all');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white bg-slate-50 hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 rounded-lg shadow-sm transition active:scale-95 cursor-pointer"
                    title="Reset Search, Vendor, and Status Filters"
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
                  onClick={() => handleRunEodEngine()}
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
                      paginatedInvoices.map((inv) => {
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

                            {/* Balance & Settlement Status */}
                            <td className="px-5 py-4 text-xs text-right">
                              {(() => {
                                const { balance, status } = getInvoiceSettlementInfo(inv);
                                const badgeClass =
                                  status === 'Settled'
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/40'
                                    : status === 'Partial'
                                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-900/40'
                                    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border-rose-200 dark:border-rose-900/40';
                                return (
                                  <div className="flex flex-col items-end gap-1.5">
                                    <span className="font-bold font-mono text-indigo-600 dark:text-indigo-400">
                                      ¥{balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider border ${badgeClass}`}>
                                      {status}
                                    </span>
                                    {balance > 0.01 && (
                                      <button
                                        type="button"
                                        onClick={() => handleOpenSettleModal(inv, balance)}
                                        className="text-[10px] font-bold uppercase tracking-wider text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 hover:underline cursor-pointer"
                                      >
                                        Settle
                                      </button>
                                    )}
                                  </div>
                                );
                              })()}
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

              {/* PAGINATION CONTROLS */}
              {filteredInvoices.length > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <span>
                      Showing {(effectivePage - 1) * pageSize + 1}
                      –{Math.min(effectivePage * pageSize, filteredInvoices.length)} of {filteredInvoices.length}
                    </span>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <label className="flex items-center gap-1.5">
                      <span>Rows per page</span>
                      <select
                        value={pageSize}
                        onChange={e => setPageSize(Number(e.target.value))}
                        className="bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-xs text-gray-900 dark:text-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition cursor-pointer"
                      >
                        {[10, 20, 50].map(n => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={effectivePage <= 1}
                      className="px-2.5 py-1.5 text-xs font-semibold rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                    >
                      Prev
                    </button>
                    <span className="px-2 text-xs font-mono text-gray-600 dark:text-gray-300">
                      Page {effectivePage} / {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={effectivePage >= totalPages}
                      className="px-2.5 py-1.5 text-xs font-semibold rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
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

              {/* Vendor filter + Refresh trigger */}
              <div className="flex items-center gap-3 shrink-0 w-full md:w-auto justify-end">
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

                {selectedVendorFilter && (
                  <button
                    onClick={() => setSelectedVendorFilter('')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white bg-slate-50 hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 rounded-lg shadow-sm transition active:scale-95 cursor-pointer"
                    title="Reset Vendor Filter"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                  </button>
                )}

                <Button
                  onClick={onRefresh}
                  className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-805 text-gray-700 dark:text-gray-300 font-bold px-3.5 py-1.5 rounded-lg border border-gray-250 dark:border-gray-800 text-xs active:scale-98 transition shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Re-Load Payments</span>
                </Button>
              </div>
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
                      paginatedPaymentLogs.map((log) => (
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
                              // Same magnitude-not-sign fix as getInvoiceSettlementInfo above —
                              // FIFO-settlement rows are stored as negative debits.
                              const totalSettledRmb = invoiceSettlementRecords.reduce((sum, s) => sum + Math.abs(s.amountRmb), 0);
                              
                              // Checking if there is an explicit advance record in the Settlement Ledger
                              const hasAdvanceRecord = relevantRecords.some(s => s.invoiceId === 'ADVANCE' || s.txnType === 'Advance Payment');
                              
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

              {/* PAGINATION CONTROLS */}
              {filteredPaymentLogs.length > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 py-3 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <span>
                      Showing {(paymentsEffectivePage - 1) * paymentsPageSize + 1}
                      –{Math.min(paymentsEffectivePage * paymentsPageSize, filteredPaymentLogs.length)} of {filteredPaymentLogs.length}
                    </span>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <label className="flex items-center gap-1.5">
                      <span>Rows per page</span>
                      <select
                        value={paymentsPageSize}
                        onChange={e => setPaymentsPageSize(Number(e.target.value))}
                        className="bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-xs text-gray-900 dark:text-white focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition cursor-pointer"
                      >
                        {[10, 20, 50].map(n => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setPaymentsPage(p => Math.max(1, p - 1))}
                      disabled={paymentsEffectivePage <= 1}
                      className="px-2.5 py-1.5 text-xs font-semibold rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                    >
                      Prev
                    </button>
                    <span className="px-2 text-xs font-mono text-gray-600 dark:text-gray-300">
                      Page {paymentsEffectivePage} / {paymentsTotalPages}
                    </span>
                    <button
                      onClick={() => setPaymentsPage(p => Math.min(paymentsTotalPages, p + 1))}
                      disabled={paymentsEffectivePage >= paymentsTotalPages}
                      className="px-2.5 py-1.5 text-xs font-semibold rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
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

        {/* --- TAB 4: SETTLEMENT LEDGER --- */}
        {activeTab === 'settlement_ledger' && (
          <SettlementLedger
            invoices={invoices}
            paymentLogs={paymentLogs}
            settlementRecords={settlementRecords}
            vendors={vendors}
            onNavigate={onNavigate}
            onRefresh={handleRefresh}
            setSettlementRecords={setSettlementRecords}
            setPurchaseInvoices={setPurchaseInvoices}
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

      {/* SETTLE INVOICE MODAL */}
      {settleModalInvoice && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity duration-300"
            onClick={() => setSettleModalInvoice(null)}
          />

          <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 max-w-lg w-full overflow-hidden transform transition-all animate-zoom-in">
            <div className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-slate-900 dark:to-slate-950 text-slate-800 dark:text-white border-b border-gray-200 dark:border-slate-800 px-6 py-4.5 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black flex items-center gap-2 text-slate-800 dark:text-white">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Settle Invoice</span>
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Logs a cross-vendor transfer settling <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{settleModalInvoice.invoiceId}</span>, paid on {settleModalInvoice.vendorCode}'s behalf by another vendor's credit.
                </p>
              </div>
              <button
                onClick={() => setSettleModalInvoice(null)}
                className="p-1.5 rounded-lg text-slate-400 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorBanner && (
              <div className="mx-6 mt-4 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-lg text-rose-500 dark:text-rose-400 text-xs font-bold font-mono">
                Error: {errorBanner}
              </div>
            )}

            <form onSubmit={handleConfirmSettlement} className="p-6 space-y-4">
              {/* Invoice summary */}
              <div className="grid grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-700/60 rounded-xl p-3.5 text-xs">
                <div>
                  <span className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Vendor</span>
                  <span className="font-mono font-bold text-gray-800 dark:text-gray-200">{settleModalInvoice.vendorCode}</span>
                </div>
                <div className="text-right">
                  <span className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Outstanding Balance</span>
                  <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                    ¥{getInvoiceSettlementInfo(settleModalInvoice).balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                    Settlement Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={settleForm.date}
                    onChange={(e) => setSettleForm(prev => ({ ...prev, date: e.target.value }))}
                    className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-950 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                    Paying Vendor *
                  </label>
                  <select
                    required
                    value={settleForm.payingVendor}
                    onChange={(e) => setSettleForm(prev => ({ ...prev, payingVendor: e.target.value }))}
                    className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-950 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">Select vendor...</option>
                    {VENDOR_OPTIONS.filter(v => v.code !== settleModalInvoice.vendorCode).map(v => (
                      <option key={v.code} value={v.code}>{v.displayText}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                  Settlement Amount (RMB ¥) *
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 font-bold">¥</span>
                  <input
                    type="number"
                    required
                    step="0.01"
                    min={0.01}
                    value={settleForm.amountRmb}
                    onChange={(e) => setSettleForm(prev => ({ ...prev, amountRmb: e.target.value }))}
                    className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-950 dark:text-white pl-8 pr-3 py-2.5 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500 font-bold font-mono"
                  />
                </div>
                <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Defaults to the full outstanding balance — reduce this for a partial settlement.</p>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                  Reference & Notes
                </label>
                <textarea
                  placeholder="e.g. Wire transfer reference, batch note..."
                  rows={2}
                  maxLength={150}
                  value={settleForm.notes}
                  onChange={(e) => setSettleForm(prev => ({ ...prev, notes: e.target.value }))}
                  className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-955 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setSettleModalInvoice(null)}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400 bg-gray-50 hover:bg-gray-100 dark:bg-slate-700/60 dark:hover:bg-slate-700 rounded-lg shadow-sm transition"
                >
                  Cancel
                </button>
                <Button
                  type="submit"
                  disabled={isSubmittingSettlement}
                  className="px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-md transition flex items-center gap-2"
                >
                  {isSubmittingSettlement ? (
                    <>
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Logging Settlement...
                    </>
                  ) : (
                    'Log Settlement'
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
