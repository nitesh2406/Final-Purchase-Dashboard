import React, { useState, useEffect, useMemo } from 'react';
import {
  SettlementRecord,
  PurchaseInvoice,
  PaymentLog
} from '../../services/settlementService';
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
  ArrowDownRight
} from 'lucide-react';
import { Invoice, Vendor, VendorMaster } from '../../types';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ViewType } from '../../types';

interface SettlementLedgerProps {
  invoices: (PurchaseInvoice & { temp?: boolean })[];
  paymentLogs: (PaymentLog & { temp?: boolean })[];
  settlementRecords: (SettlementRecord & { temp?: boolean; createdAtTimestamp?: number })[];
  vendors?: (Vendor | VendorMaster)[];
  onNavigate?: (view: ViewType) => void;
  onRefresh: () => void;
  setSettlementRecords: React.Dispatch<React.SetStateAction<(SettlementRecord & { temp?: boolean; createdAtTimestamp?: number })[]>>;
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

  const records = settlementRecords;
  
  // A PurchaseInvoice counts toward settlement metrics once ER1 and INR are populated.
  // Pending EOD status does NOT exclude it: invoices can be (and routinely are) settled
  // while still pending EOD, so excluding them here undercounts real outstanding liability.
  const localInvoices = useMemo(() => {
    return invoices.filter(purchase =>
      purchase.er1 !== undefined &&
      purchase.er1 !== null &&
      String(purchase.er1).trim() !== "" &&
      purchase.inr !== undefined &&
      purchase.inr !== null &&
      String(purchase.inr).trim() !== ""
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

  // Pagination State
  const [settlementPage, setSettlementPage] = useState(1);
  const [settlementPageSize, setSettlementPageSize] = useState(10);

  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  

  // Extract unique active vendors available inside the system
  const activeVendors = useMemo(() => {
    if (vendors && vendors.length > 0) {
      return vendors.map(v => ({
        code: (('id' in v ? v.id : v.vendor_id) || '').trim(),
        name: (('name' in v ? v.name : v.vendor_name) || '').trim()
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

    // 1. From invoices prop matching selected vendor
    if (localInvoices && localInvoices.length > 0) {
      localInvoices.forEach(inv => {
        if (inv.vendorCode === selectedVendor) {
          if (inv.invoiceId) ids.add(inv.invoiceId);
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
        if (inv && inv.invoiceId) ids.add(inv.invoiceId);
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
        const matchesInvoice = (rec.invoiceId || '').toLowerCase().includes(cleanQuery);
        const matchesVendorCode = (rec.vendorNo || '').toLowerCase().includes(cleanQuery);
        const matchesVendorName = (rec.vendorName || '').toLowerCase().includes(cleanQuery);
        const matchesType = (rec.txnType || '').toLowerCase().includes(cleanQuery);
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

  useEffect(() => {
    setSettlementPage(1);
  }, [selectedVendor, selectedInvoiceId, selectedTxnType, searchQuery, settlementPageSize]);

  const settlementTotalPages = Math.max(1, Math.ceil(sortedAndFilteredRecords.length / settlementPageSize));
  const settlementEffectivePage = Math.min(settlementPage, settlementTotalPages);
  const paginatedSettlementRecords = useMemo(() => {
    const start = (settlementEffectivePage - 1) * settlementPageSize;
    return sortedAndFilteredRecords.slice(start, start + settlementPageSize);
  }, [sortedAndFilteredRecords, settlementEffectivePage, settlementPageSize]);

  // --- Real-time Dynamic Metrics Aggregation ---
  const dynamicMetrics = useMemo(() => {
    // An invoice's real paid/unpaid state comes from actual 'Invoice Settlement' ledger
    // records logged against it, not its own stored `status` field — that field only
    // tracks EOD conversion and is never updated by the settlement-logging backend
    // action (it only writes settledAmount/balance), so it can't tell us if an invoice
    // has actually been paid off.
    const getOutstandingBalance = (inv: PurchaseInvoice) => {
      // FIFO-settlement rows are stored as negative debits against the vendor's wallet;
      // cross-vendor Adjustment Transfer In rows are stored positive. Use magnitude, not
      // signed value, so both count as money applied against the invoice.
      const settledRmb = records
        .filter(r => r.invoiceId === inv.invoiceId && r.txnType === 'Invoice Settlement')
        .reduce((sum, r) => sum + Math.abs(r.amountRmb), 0);
      return Math.max(0, (inv.rmb || 0) - settledRmb);
    };

    // 1. Total Unpaid Invoices & Total Liability
    let candidateInvoices = localInvoices;

    if (selectedVendor) {
      candidateInvoices = candidateInvoices.filter(inv => inv.vendorCode === selectedVendor);
    }

    if (selectedInvoiceId) {
      candidateInvoices = candidateInvoices.filter(inv => inv.invoiceId === selectedInvoiceId);
    }

    const unpaidList = candidateInvoices
      .map(inv => ({ inv, balance: getOutstandingBalance(inv) }))
      .filter(({ balance }) => balance > 0.01);

    const unpaidCount = unpaidList.length;
    const unpaidSumRmb = unpaidList.reduce((sum, { balance }) => sum + balance, 0);

    // INR liability scales the *outstanding* RMB balance by the invoice's own EOD rate,
    // rather than reusing the invoice's stored INR figure (which values the full original
    // amount, not what's still owed).
    const liabilitySumInr = unpaidList.reduce((sum, { inv, balance }) => sum + balance * (inv.er1 || 0), 0);

    // 2. Advance Payments Total
    // SettlementLedger no longer ever writes an "Advance Payment" row (fifoLiquidate_
    // stopped doing that — leftover payment is just unspent wallet balance now, not a
    // settlement event). "Advance" is genuinely the sum of unused PaymentLogs.Balance
    // across wallets instead, scoped to the same vendor filter as everything else here.
    const advanceWallets = selectedVendor
      ? paymentLogs.filter(p => p.vendorCode === selectedVendor)
      : paymentLogs;
    const totalAdvanceInr = advanceWallets
      .filter(p => (p.balance || 0) > 0.01)
      .reduce((sum, p) => sum + (p.balance || 0) * (p.fxRate || 0), 0);

    // 3. Forex Gain / Loss Balance
    // Sum of net forex performance over the current active filtered records
    const netForexGainLoss = filteredRecords.reduce((sum, rec) => sum + rec.forexGainLoss, 0);

    return {
      unpaidCount,
      unpaidSumRmb,
      liabilitySumInr,
      totalAdvanceInr,
      netForexGainLoss
    };
  }, [filteredRecords, localInvoices, records, selectedVendor, selectedInvoiceId, paymentLogs]);

  // Trigger sorting column change
  const handleSort = (field: keyof SettlementRecord) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
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
                        setIsAddMenuOpen(false);
                        if (onNavigate) onNavigate('Log Invoice');
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
                          onNavigate('Log Payment');
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
                        setIsAddMenuOpen(false);
                        if (onNavigate) {
                          onNavigate('Log Settlement');
                        }
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
          paginatedSettlementRecords.map((rec) => {
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
                    <span className="text-gray-700 dark:text-gray-300 font-medium">{(rec.exchangeRatePrimary ?? 0).toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="block text-[9px] text-gray-400 dark:text-gray-500 uppercase font-semibold">Settlement ex</span>
                    <span className="text-gray-900 dark:text-white font-medium">{(rec.exchangeRateSettlement ?? 0).toFixed(2)}</span>
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
                 paginatedSettlementRecords.map((rec) => {
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
                         {(rec.exchangeRatePrimary ?? 0).toFixed(2)}
                       </td>

                       {/* Exchange rate Settlement */}
                       <td className="px-3 xl:px-5 lg:px-2.5 py-3.5 text-center font-mono text-sm font-medium text-gray-700 dark:text-gray-300">
                         {(rec.exchangeRateSettlement ?? 0).toFixed(2)}
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

      {/* PAGINATION CONTROLS (shared by the mobile card list and desktop table above) */}
      {sortedAndFilteredRecords.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-md px-5 py-3">
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>
              Showing {(settlementEffectivePage - 1) * settlementPageSize + 1}
              –{Math.min(settlementEffectivePage * settlementPageSize, sortedAndFilteredRecords.length)} of {sortedAndFilteredRecords.length}
            </span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <label className="flex items-center gap-1.5">
              <span>Rows per page</span>
              <select
                value={settlementPageSize}
                onChange={e => setSettlementPageSize(Number(e.target.value))}
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
              onClick={() => setSettlementPage(p => Math.max(1, p - 1))}
              disabled={settlementEffectivePage <= 1}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            >
              Prev
            </button>
            <span className="px-2 text-xs font-mono text-gray-600 dark:text-gray-300">
              Page {settlementEffectivePage} / {settlementTotalPages}
            </span>
            <button
              onClick={() => setSettlementPage(p => Math.min(settlementTotalPages, p + 1))}
              disabled={settlementEffectivePage >= settlementTotalPages}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
