import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  Search, 
  RotateCcw, 
  TrendingUp, 
  TrendingDown, 
  ArrowUpRight, 
  ArrowDownRight, 
  Calendar, 
  Building2, 
  DollarSign, 
  CheckCircle2, 
  Wallet, 
  Package, 
  CreditCard,
  ChevronDown,
  X,
  FileText,
  Database,
  Edit
} from 'lucide-react';
import { PurchaseInvoice, PaymentLog, SettlementRecord, VendorLedgerEntry, VendorMaster } from '../../services/settlementService';


interface VendorLedgerTabProps {
  invoices: PurchaseInvoice[];
  paymentLogs: PaymentLog[];
  settlementRecords: SettlementRecord[];
  liveLedger?: VendorLedgerEntry[];
  vendors?: VendorMaster[];
  onOpenAdjustmentModal?: (vendorCode: string) => void;
}

interface CompiledLedgerRow {
  date: string;
  particulars: 'Purchase' | 'Payment' | string;
  referenceId: string;
  amount: number;
  balance?: number;
  sourceRecord: any;
  TransactionId?: string;
}

export const VendorLedgerTab: React.FC<VendorLedgerTabProps> = ({
  invoices = [],
  paymentLogs = [],
  settlementRecords = [],
  liveLedger = [],
  vendors = [],
  onOpenAdjustmentModal
}) => {
  // Master vendors compiled list
  const masterVendors = useMemo(() => {
    return (vendors || []).map(v => ({
      code: v.vendor_id,
      name: v.vendor_name || v.vendor_id
    }));
  }, [vendors]);

  // Active selected vendor state
  const [selectedVendorCode, setSelectedVendorCode] = useState<string>('');
  
  // Search state inside the searchable dropdown
  const [dropdownSearchQuery, setDropdownSearchQuery] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Filter vendors based on dropdown search input
  const searchedVendors = useMemo(() => {
    const query = dropdownSearchQuery.toLowerCase().trim();
    if (!query) return masterVendors;
    return masterVendors.filter(
      v => v.code.toLowerCase().includes(query) || v.name.toLowerCase().includes(query)
    );
  }, [dropdownSearchQuery, masterVendors]);

  // Compute active vendor object if any
  const selectedVendor = useMemo(() => {
    return masterVendors.find(v => v.code === selectedVendorCode) || null;
  }, [selectedVendorCode, masterVendors]);

  // --- LEDGER COMPILATION FOR A GIVEN VENDOR WITH SAFETY PIPELINE ENFORCEMENT ---
  const compileLedger = (vendorCode: string): CompiledLedgerRow[] => {
    try {
      // 0. Use Live Ledger if available and has data for this vendor
      if (liveLedger && liveLedger.length > 0) {
        const filteredLive = liveLedger.filter(row => row.VendorCode === vendorCode);
        if (filteredLive.length > 0) {
          const compiled: CompiledLedgerRow[] = filteredLive.map(row => {
            const isPurchase = row.Particulars === 'Purchase';
            const isPayment = row.Particulars === 'Payment';
            const isTransferOut = row.Particulars?.includes('Transfer Out');
            const isTransferIn = row.Particulars?.includes('Transfer In');
            const isRefund = row.Particulars?.includes('Refund');
            const isForex = row.Particulars?.includes('Forex');

            // From company perspective:
            // Purchase/Liability: Negative
            // Payment/Remittance: Positive
            // Transfer Out: Negative
            // Transfer In: Positive
            // Refund Adjustment: Positive
            // Forex Adjustment: Negative (if it matches old sign direction)
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
              particulars: row.Particulars || '',
              referenceId: row.ReferenceId || '',
              amount: amount,
              TransactionId: row.TransactionId || '',
              sourceRecord: null
            };
          });

          // Sort combined dataset globally by Date in absolute ascending order
          compiled.sort((a, b) => {
            const dateA = a.date || '';
            const dateB = b.date || '';
            return dateA.localeCompare(dateB);
          });

          // Compute running balance dynamically
          let runningBalance = 0;
          compiled.forEach(row => {
            runningBalance += row.amount;
            row.balance = runningBalance;
          });

          return compiled;
        }
      }

      const rows: CompiledLedgerRow[] = [];

      // 1. Data Mapping Stream A (From 'PurchaseInvoices' Table)
      // Amount -> Represents liability to pay -> Negative (-RMB)
      const safeInvoices = invoices || [];
      const matchedInvoices = safeInvoices.filter(inv => inv.vendorCode === vendorCode);
      matchedInvoices.forEach(inv => {
        rows.push({
          date: inv.date || '',
          particulars: 'Purchase',
          referenceId: inv.invoiceId || '',
          amount: -(parseFloat(String(inv.rmb)) || 0),
          sourceRecord: inv
        });
      });

      // 2. Data Mapping Stream B (From 'PaymentLogs' Table)
      // Amount -> Represents payment made to reduce liability -> Positive (+RMB)
      const safePaymentLogs = paymentLogs || [];
      safePaymentLogs.forEach(log => {
        const isPrimary = log.vendorCode === vendorCode;
        const hasAllocations = log.allocations && log.allocations.length > 0;

        if (isPrimary) {
          if (hasAllocations) {
            // Log the overall payment positive rmb for this primary vendor
            rows.push({
              date: log.date || '',
              particulars: 'Payment',
              referenceId: log.paymentId || '',
              amount: parseFloat(String(log.rmbAmount)) || 0,
              sourceRecord: log
            });

            // Adjust positive rmb as per cross-vendor list: Transfer Out (Negative)
            log.allocations?.forEach(alloc => {
              if (alloc.vendorCode !== vendorCode) {
                rows.push({
                  date: log.date || '',
                  particulars: 'Adjustment (Transfer Out)',
                  referenceId: alloc.vendorCode || '',
                  amount: -(parseFloat(String(alloc.amount)) || 0),
                  sourceRecord: log
                });
              }
            });
          } else {
            // Normal payment without allocations
            rows.push({
              date: log.date || '',
              particulars: 'Payment',
              referenceId: log.paymentId || '',
              amount: parseFloat(String(log.rmbAmount)) || 0,
              sourceRecord: log
            });
          }
        } else if (hasAllocations) {
          // If the active vendor is NOT primary, but receives allocated credit: Transfer In (Positive)
          const alloc = log.allocations?.find(a => a.vendorCode === vendorCode);
          if (alloc) {
            const refId = log.paymentId || '';
            const isMatch = (refId === log.vendorCode);
            const particulars = isMatch ? 'Payment' : 'Adjustment (Transfer In)';

            rows.push({
              date: log.date || '',
              particulars: particulars,
              referenceId: refId,
              amount: parseFloat(String(alloc.amount)) || 0,
              sourceRecord: log
            });
          }
        }
      });

      // 3. Data Mapping Stream C (From 'SettlementLedger' Table - Dual-Sided Adjustment / Direct adjustment)
      // Source View (A transfers to B): Transfer Out -> Negative (-RMB)
      // Target View (Mirror Entry): Transfer In -> Positive (+RMB)
      const safeSettlementRecords = settlementRecords || [];
      safeSettlementRecords.forEach(rec => {
        const isSource = rec.vendorNo === vendorCode && rec.invoiceId ? rec.invoiceId.startsWith('V-') : false;
        const isTarget = rec.invoiceId === vendorCode && rec.vendorNo ? rec.vendorNo.startsWith('V-') : false;

        if (isSource) {
          rows.push({
            date: rec.date || '',
            particulars: 'Adjustment (Transfer Out)',
            referenceId: rec.invoiceId, // Target vendor code
            amount: -(parseFloat(String(rec.amountRmb)) || 0),
            sourceRecord: rec
          });
        } else if (isTarget) {
          rows.push({
            date: rec.date || '',
            particulars: 'Adjustment (Transfer In)',
            referenceId: rec.vendorNo, // Source vendor code
            amount: parseFloat(String(rec.amountRmb)) || 0,
            sourceRecord: rec
          });
        } else if (rec.vendorNo === vendorCode) {
          // Direct vendor adjustments
          if (rec.txnType === 'Forex Adjustment') {
            rows.push({
              date: rec.date || '',
              particulars: 'Forex Adjustment',
              referenceId: rec.invoiceId || 'N/A',
              amount: -(parseFloat(String(rec.amountRmb)) || 0),
              sourceRecord: rec
            });
          } else if (rec.txnType === 'Refund') {
            rows.push({
              date: rec.date || '',
              particulars: 'Refund Adjustment',
              referenceId: rec.invoiceId || 'N/A',
              amount: parseFloat(String(rec.amountRmb)) || 0,
              sourceRecord: rec
            });
          }
        }
      });

      // --- GLOBAL CHRONOLOGICAL SORTING & RUNNING BALANCE CALCULATION ---
      // Step 2: Sort combined dataset globally by Date in absolute ascending order
      rows.sort((a, b) => {
        const dateA = a.date || '';
        const dateB = b.date || '';
        return dateA.localeCompare(dateB);
      });

      // Step 3: Compute running balance dynamically
      let runningBalance = 0;
      rows.forEach(row => {
        runningBalance += row.amount;
        row.balance = runningBalance;
      });

      return rows;
    } catch (err) {
      console.error(`Error compiling ledger for vendor ${vendorCode}:`, err);
      return []; // Safety fallback
    }
  };

  // --- PRE-COMPILING AGGREGATE METRICS FOR EACH VENDOR ---
  const vendorsStats = useMemo(() => {
    const stats: Record<string, { currentBalance: number; numPurchases: number; numPayments: number }> = {};
    
    masterVendors.forEach(v => {
      // 1. Current balance from compiled ledger compilation
      const compilation = compileLedger(v.code);
      const currentBalance = compilation.length > 0 ? (compilation[compilation.length - 1].balance || 0) : 0;

      // 2. Purchases count
      const safeInvoices = invoices || [];
      const numPurchases = safeInvoices.filter(i => i.vendorCode === v.code).length;

      // 3. Payment logs count
      const safePayments = paymentLogs || [];
      const numPayments = safePayments.filter(log => {
        const hasAllocations = log.allocations && log.allocations.length > 0;
        if (hasAllocations) {
          return log.allocations?.some(a => a.vendorCode === v.code);
        }
        return log.vendorCode === v.code;
      }).length;

      stats[v.code] = {
        currentBalance,
        numPurchases,
        numPayments
      };
    });

    return stats;
  }, [invoices, paymentLogs, settlementRecords, masterVendors]);

  // Compute active filtered vendor's ledger rows
  const activeLedgerRows = useMemo(() => {
    if (!selectedVendorCode) return [];
    return compileLedger(selectedVendorCode);
  }, [selectedVendorCode, invoices, paymentLogs, settlementRecords]);

  // Handle manual input selection from Dropdown Search
  const selectVendor = (code: string) => {
    setSelectedVendorCode(code);
    setIsDropdownOpen(false);
    setDropdownSearchQuery('');
  };

  // Reset search filter action
  const resetFilter = () => {
    setSelectedVendorCode('');
    setDropdownSearchQuery('');
    setIsDropdownOpen(false);
  };

  return (
    <div className="space-y-6 animate-fade-in" id="vendor-ledger-main-container">
      
      {/* 1. TOPBAR SEARCH & FILTER UI */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-1.5 leading-none">
            <Building2 className="w-4.5 h-4.5 text-blue-400" />
            <span>Interactive Partner Accounts Reconciliation</span>
            {liveLedger && liveLedger.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold rounded flex items-center gap-1">
                <Database className="w-3 h-3" />
                Live Sync
              </span>
            )}
          </h3>
          <p className="text-[11px] text-gray-500 mt-1 max-w-xl">
            Select an active trade supplier to compound multiple data streams into a double-entry unified reconciliation ledger with running balances.
          </p>
        </div>

        {/* Dropdown Search container */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2" ref={dropdownRef}>
          <div className="relative w-full sm:w-80">
            <div 
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className={`w-full bg-gray-50 dark:bg-gray-900 border ${
                isDropdownOpen ? 'border-[#60A5FA] ring-1 ring-[#60A5FA]' : 'border-gray-300 dark:border-gray-600'
              } rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white flex items-center justify-between cursor-pointer transition`}
            >
              <span className="truncate">
                {selectedVendor ? `${selectedVendor.code} -- ${selectedVendor.name}` : "Search or select vendor account..."}
              </span>
              <ChevronDown className={`w-4 h-4 ml-2 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180 text-[#60A5FA]' : 'text-gray-400'}`} />
            </div>

            {/* Dropdown Options List */}
            {isDropdownOpen && (
              <div className="absolute right-0 left-0 mt-1.5 max-h-60 overflow-y-auto rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-xl z-50 animate-fade-in divide-y divide-gray-150 dark:divide-gray-700 text-xs">
                {/* Search query input inside dropdown */}
                <div className="p-2 bg-slate-50 dark:bg-slate-900 flex items-center gap-2">
                  <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <input
                    type="text"
                    value={dropdownSearchQuery}
                    onChange={(e) => setDropdownSearchQuery(e.target.value)}
                    placeholder="Filter by code or description..."
                    className="w-full bg-transparent border-0 outline-none p-0 text-xs text-gray-900 dark:text-white placeholder:text-gray-400 focus:ring-0 focus:border-0"
                    autoFocus
                  />
                  {dropdownSearchQuery && (
                    <button onClick={() => setDropdownSearchQuery('')} className="text-gray-400 hover:text-gray-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="py-1">
                  {searchedVendors.length > 0 ? (
                    searchedVendors.map((vendor) => (
                      <button
                        key={vendor.code}
                        type="button"
                        onClick={() => selectVendor(vendor.code)}
                        className={`w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-705/80 transition-colors flex items-center justify-between ${
                          selectedVendorCode === vendor.code 
                            ? 'bg-blue-400/10 text-blue-400 font-bold'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <span className="font-mono text-xs font-semibold mr-1.5">{vendor.code}</span>
                        <span className="flex-1 truncate">{vendor.name}</span>
                        {selectedVendorCode === vendor.code && (
                          <span className="w-2 h-2 rounded-full bg-blue-400" />
                        )}
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-3 text-gray-500 dark:text-gray-400 italic text-center">
                      No matching vendors found
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Reset Action Button */}
          {selectedVendorCode && (
            <button
              onClick={resetFilter}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-650 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white bg-slate-50 hover:bg-slate-100 dark:bg-slate-700 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 rounded-lg shadow-sm transition active:scale-95 cursor-pointer whitespace-nowrap"
              title="Clear Active Filters"
            >
              <RotateCcw className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
              <span>Reset Filter</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. DEFAULT STATE (No Vendor Selected) - GRID VISIBILITY SHELL */}
      {!selectedVendorCode ? (
        <div className="space-y-4" id="vendor-default-grid-shell">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Supplier Liability Cards ({masterVendors.length})
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 italic">
              Click any card to load detailed reconciliation reports
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {masterVendors.map(v => {
              const stats = vendorsStats[v.code] || { currentBalance: 0, numPurchases: 0, numPayments: 0 };
              const isPositiveBalance = stats.currentBalance > 0;
              const isNegativeBalance = stats.currentBalance < 0;

              return (
                <div
                  key={v.code}
                  onClick={() => selectVendor(v.code)}
                  className="bg-white dark:bg-gray-800 border border-gray-250 dark:border-gray-700 hover:border-[#60A5FA]/60 dark:hover:border-[#60A5FA]/60 rounded-xl p-5 shadow-sm hover:shadow-md cursor-pointer transition transform hover:-translate-y-0.5 duration-205 flex flex-col justify-between group"
                >
                  <div>
                    {/* Supplier ID Header Badge */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="px-2 py-0.5 font-mono text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-750 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-md">
                        {v.code}
                      </span>
                      <ChevronDown className="w-3.5 h-3.5 text-slate-350 dark:text-slate-500 opacity-0 group-hover:opacity-100 transition -rotate-90" />
                    </div>

                    <h4 className="font-extrabold text-sm text-gray-900 dark:text-white line-clamp-2 min-h-[40px]" title={v.name}>
                      {v.name}
                    </h4>
                  </div>

                  <div className="mt-4 space-y-3 pt-3 border-t border-slate-100 dark:border-slate-700/60">
                    {/* Current Balance running compiled calculation count */}
                    <div>
                      <span className="block text-[9px] font-bold uppercase text-gray-400 dark:text-gray-500 tracking-wider">
                        {isPositiveBalance 
                          ? 'Advance Credit' 
                          : isNegativeBalance 
                          ? 'Outstanding Liability' 
                          : 'Current Balance'
                        }
                      </span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`w-2 h-2 rounded-full ${
                          isPositiveBalance 
                            ? 'bg-emerald-500' 
                            : isNegativeBalance 
                            ? 'bg-red-500' 
                            : 'bg-gray-400'
                        }`} />
                        <span className={`font-mono text-sm font-black ${
                          isPositiveBalance 
                            ? 'text-emerald-600 dark:text-emerald-400' 
                            : isNegativeBalance 
                            ? 'text-red-600 dark:text-red-400' 
                            : 'text-gray-500 dark:text-gray-400'
                        }`}>
                          {stats.currentBalance === 0 
                            ? '¥0.00' 
                            : `${stats.currentBalance > 0 ? '+¥' : '-¥'}${Math.abs(stats.currentBalance).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
                          }
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="block text-[8px] font-bold uppercase text-gray-400 dark:text-gray-500 tracking-wider">
                          Purchases
                        </span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Package className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          <span className="font-mono text-gray-700 dark:text-gray-300 font-bold">
                            {stats.numPurchases}
                          </span>
                        </div>
                      </div>

                      <div>
                        <span className="block text-[8px] font-bold uppercase text-gray-400 dark:text-gray-500 tracking-wider">
                          Payments
                        </span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <CreditCard className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="font-mono text-gray-700 dark:text-gray-300 font-bold">
                            {stats.numPayments}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* 3. FILTERED STATE (Vendor Selected via Dropdown Search or Card) */
        <div className="space-y-6" id="vendor-filtered-active-shell">
          
          {/* Active supplier card overlay header representing isolated vendor */}
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white rounded-xl p-6 shadow-md animate-fade-in">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-blue-100 dark:bg-gradient-to-br dark:from-blue-500/25 dark:to-blue-600/10 border border-blue-200 dark:border-blue-500/40 rounded-xl text-blue-600 dark:text-blue-400">
                  <Building2 className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 font-mono text-[10px] font-black bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded-md">
                      {selectedVendor.code}
                    </span>
                    <span className="text-[10px] font-black uppercase text-indigo-500 dark:text-indigo-400 tracking-wider">
                      Active Focal Account Reconciled
                    </span>
                  </div>
                  <h2 className="text-xl font-extrabold text-slate-900 dark:text-white mt-1">
                    {selectedVendor.name}
                  </h2>
                </div>
              </div>

              {/* Reset button inside active vendor card */}
              <button
                onClick={resetFilter}
                className="flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-350 border border-slate-200 dark:border-slate-700 rounded-lg shadow-sm transition cursor-pointer self-start md:self-auto"
              >
                <X className="w-4 h-4" />
                <span>Close Reporting</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-6 mt-6 border-t border-slate-200 dark:border-slate-800">
              {/* Stat Card 1: Balance running */}
              <div className="bg-white dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-4 flex flex-col justify-between shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-widest">
                    {(() => {
                      const bal = vendorsStats[selectedVendor.code]?.currentBalance || 0;
                      return bal > 0 ? 'Advance Credit' : bal < 0 ? 'Outstanding Liability' : 'Net Ledger Balance';
                    })()}
                  </span>
                  <Wallet className={`w-4 h-4 opacity-80 ${
                    (vendorsStats[selectedVendor.code]?.currentBalance || 0) > 0 
                      ? 'text-emerald-600 dark:text-emerald-400' 
                      : (vendorsStats[selectedVendor.code]?.currentBalance || 0) < 0
                      ? 'text-red-600 dark:text-red-400' 
                      : 'text-slate-500 dark:text-slate-450'
                  }`} />
                </div>
                <div>
                  <div className={`text-xl font-bold font-mono ${
                    (vendorsStats[selectedVendor.code]?.currentBalance || 0) > 0 
                      ? 'text-emerald-600 dark:text-emerald-400' 
                      : (vendorsStats[selectedVendor.code]?.currentBalance || 0) < 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}>
                    {(() => {
                      const bal = vendorsStats[selectedVendor.code]?.currentBalance || 0;
                      return bal === 0 
                        ? '¥0.00' 
                        : `${bal > 0 ? '+¥' : '-¥'}${Math.abs(bal).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
                    })()}
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                    {(() => {
                      const bal = vendorsStats[selectedVendor.code]?.currentBalance || 0;
                      return bal > 0 
                        ? 'Advance payment credit (Vendor owes future supply)' 
                        : bal < 0
                        ? 'Outstanding payables balance (We owe vendor money)'
                        : 'Account fully settled (Balanced Liability)';
                    })()}
                  </p>
                </div>
              </div>

              {/* Stat Card 2: Total Purchase Count */}
              <div className="bg-white dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-4 flex flex-col justify-between shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-widest">
                    Total Purchases
                  </span>
                  <Package className="w-4 h-4 text-indigo-500 dark:text-indigo-400 opacity-80" />
                </div>
                <div>
                  <div className="text-xl font-bold font-mono text-slate-900 dark:text-white">
                    {vendorsStats[selectedVendor.code]?.numPurchases || 0} <span className="text-xs font-normal text-slate-500 dark:text-slate-400">Ledger Invoices</span>
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                    Cumulative purchase invoices logged in Google Sheets pipeline.
                  </p>
                </div>
              </div>

              {/* Stat Card 3: Outward Payment logs */}
              <div className="bg-white dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800/80 rounded-xl p-4 flex flex-col justify-between shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-widest">
                    Outward Remittances
                  </span>
                  <CreditCard className="w-4 h-4 text-emerald-500 dark:text-emerald-400 opacity-80" />
                </div>
                <div>
                  <div className="text-xl font-bold font-mono text-slate-900 dark:text-white">
                    {vendorsStats[selectedVendor.code]?.numPayments || 0} <span className="text-xs font-normal text-slate-500 dark:text-slate-400">Payment Rows</span>
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                    Outbound payment transactions successfully reconciled.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Granular chronological financial history list/table layout */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm rounded-xl overflow-hidden animate-fade-in" id="vendor-granular-history-table">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 bg-slate-50/70 dark:bg-slate-900/40 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-indigo-400" />
                <span>Reconciled Transaction Log History</span>
              </span>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 text-[10px] font-bold font-mono bg-sky-50 dark:bg-sky-950/30 text-sky-600 dark:text-sky-400 border border-sky-100 dark:border-sky-950/50 rounded-md">
                  Sorted Chronologically
                </span>
                {onOpenAdjustmentModal && selectedVendor && (
                  <button
                    type="button"
                    onClick={() => onOpenAdjustmentModal(selectedVendor.code)}
                    className="p-1 px-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-805 dark:hover:text-white text-slate-505 dark:text-slate-400 border border-slate-250 dark:border-gray-600 font-mono text-[10px] font-black uppercase tracking-wider flex items-center gap-1 cursor-pointer select-none"
                    title="Adjustment Entry"
                    id="adjustment-edit-btn"
                  >
                    <Edit className="w-3 h-3 text-indigo-500" />
                    <span>Edit</span>
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="bg-slate-100/40 dark:bg-slate-950/20 text-[10px] font-bold text-gray-500 dark:text-gray-440 uppercase tracking-widest border-b border-gray-200 dark:border-gray-700 select-none">
                    <th className="px-2 py-1.5 w-[12%] text-center border-r border-slate-150 dark:border-slate-700/60">ID</th>
                    <th className="px-2 py-1.5 w-[15%] text-center">Date (Posting)</th>
                    <th className="px-2 py-1.5 w-[18%] text-center">Particulars</th>
                    <th className="px-2 py-1.5 w-[15%] text-center">Reference ID</th>
                    <th className="px-2 py-1.5 w-[20%] text-right font-mono">Amount (RMB ¥)</th>
                    <th className="px-2 py-1.5 w-[20%] text-right font-mono border-l border-slate-150 dark:border-slate-700/60 pl-3">Running Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-150 dark:divide-slate-700/50">
                  {activeLedgerRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500 italic">
                        No transactions reconciled for this partner yet. Check your purchase entries or payment logs.
                      </td>
                    </tr>
                  ) : (
                    activeLedgerRows.map((row, index) => {
                      const isPurchase = row.particulars === 'Purchase';
                      const isPayment = row.particulars === 'Payment';
                      const isAdjustment = !isPurchase && !isPayment;
                      
                      const isPositiveAmount = row.amount > 0;
                      const isNegativeAmount = row.amount < 0;

                      return (
                        <tr key={row.TransactionId ? `${row.TransactionId}-${index}` : index} className="hover:bg-slate-50/40 dark:hover:bg-slate-705/20 transition text-xs select-text">
                          
                          {/* 0. Transaction ID */}
                          <td className="px-2 py-1.5 text-center font-mono text-[9px] text-gray-400 dark:text-gray-500 border-r border-slate-150 dark:border-slate-700/60 truncate max-w-[80px]" title={row.TransactionId || ''}>
                            {row.TransactionId ? (row.TransactionId.includes('-') ? row.TransactionId.split('-').pop() : row.TransactionId) : '-'}
                          </td>

                          {/* 1. Date (Posting) */}
                          <td className="px-2 py-1.5 text-center font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                              <span>{row.date}</span>
                            </div>
                          </td>

                          {/* 2. Particulars */}
                          <td className="px-2 py-1.5 text-center whitespace-nowrap">
                            <div className="inline-flex justify-center">
                              {isPurchase && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-150 dark:border-indigo-900/40 px-2 py-0.5 rounded-md">
                                  <Package className="w-3 h-3 text-indigo-505" />
                                  <span>Purchase</span>
                                </span>
                              )}
                              {isPayment && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-150 dark:border-emerald-900/40 px-2 py-0.5 rounded-md">
                                  <CreditCard className="w-3 h-3 text-emerald-505" />
                                  <span>Payment</span>
                                </span>
                              )}
                              {isAdjustment && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-150 dark:border-amber-900/40 px-2 py-0.5 rounded-md">
                                  <ArrowUpRight className="w-3 h-3 text-amber-505 animate-pulse" />
                                  <span>{row.particulars}</span>
                                </span>
                              )}
                            </div>
                          </td>

                          {/* 3. Reference ID */}
                          <td className="px-2 py-1.5 text-center font-semibold font-mono tracking-tight text-gray-800 dark:text-gray-200 whitespace-nowrap">
                            {row.referenceId}
                          </td>

                          {/* 4. Amount (+/- RMB) */}
                          <td className={`px-2 py-1.5 text-right font-mono font-bold whitespace-nowrap ${
                            isPositiveAmount 
                              ? 'text-emerald-600 dark:text-emerald-400' 
                              : isNegativeAmount 
                              ? 'text-red-600 dark:text-red-400 font-bold' 
                              : 'text-gray-400'
                          }`}>
                            {row.amount === 0 
                              ? '¥0.00' 
                              : `${isPositiveAmount ? '+¥' : '-¥'}${Math.abs(row.amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
                            }
                          </td>

                          {/* 5. Running Balance */}
                          <td className={`px-2 py-1.5 text-right font-mono font-black border-l border-slate-150 dark:border-slate-700/60 pl-3 whitespace-nowrap ${
                            (row.balance || 0) > 0 
                              ? 'text-emerald-600 dark:text-emerald-400' 
                              : (row.balance || 0) < 0 
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-gray-400'
                          }`}>
                            {row.balance === 0 
                              ? '¥0.00' 
                              : `${(row.balance || 0) > 0 ? '+¥' : '-¥'}${Math.abs(row.balance || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
                            }
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
    </div>
  );
};
