import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  Building2,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Check,
  X,
  Layers,
  ShieldAlert,
  ArrowLeftRight
} from 'lucide-react';
import { ViewType } from '../../types';
import {
  submitAdjustmentEntry,
  VendorMaster,
  PurchaseInvoice,
  PaymentLog,
  SettlementRecord,
  VendorLedgerEntry
} from '../../services/settlementService';
import { useSubmissionLock } from '../../hooks/useSubmissionLock';

interface CrossVendorSettlementProps {
  onNavigate?: (view: ViewType) => void;
  vendors: VendorMaster[];
  invoices: (PurchaseInvoice & { temp?: boolean })[];
  paymentLogs: (PaymentLog & { temp?: boolean })[];
  settlementRecords: SettlementRecord[];
  vendorLedger: VendorLedgerEntry[];
  onRefresh: () => Promise<void> | void;
}

interface AllocationRow {
  vendorCode: string;
  amount: string;
}

export const CrossVendorSettlement: React.FC<CrossVendorSettlementProps> = ({
  onNavigate,
  vendors,
  invoices,
  paymentLogs,
  settlementRecords,
  vendorLedger,
  onRefresh
}) => {
  const [searchParams] = useSearchParams();
  const prefillPayingVendor = searchParams.get('payingVendor') || '';

  const VENDOR_OPTIONS = useMemo(() => {
    return vendors.map(v => ({
      code: v.vendor_id,
      name: v.vendor_name || v.vendor_id,
      displayText: v.vendor_name ? `${v.vendor_id} -- ${v.vendor_name}` : v.vendor_id
    }));
  }, [vendors]);

  const getVendorName = (vendorCode: string): string => {
    const match = vendors.find(v => v.vendor_id === vendorCode);
    return match ? (match.vendor_name || match.vendor_id) : vendorCode;
  };

  // Reproduces the running vendor balance used across Accounts View, so the paying
  // vendor's current position is visible before committing a transfer out of it.
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

            return { date: row.Date || '', amount };
          });

          compiled.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
          return compiled.reduce((running, row) => running + row.amount, 0);
        }
      }

      const rows: { date: string; amount: number }[] = [];

      const safeInvoices = invoices || [];
      safeInvoices.filter(inv => inv.vendorCode === vendorCode).forEach(inv => {
        rows.push({ date: inv.date || '', amount: -(parseFloat(String(inv.rmb)) || 0) });
      });

      const safePaymentLogs = paymentLogs || [];
      safePaymentLogs.forEach(log => {
        const isPrimary = log.vendorCode === vendorCode;
        const hasAllocations = log.allocations && log.allocations.length > 0;

        if (isPrimary) {
          if (hasAllocations) {
            rows.push({ date: log.date || '', amount: parseFloat(String(log.rmbAmount)) || 0 });
            log.allocations?.forEach(alloc => {
              if (alloc.vendorCode !== vendorCode) {
                rows.push({ date: log.date || '', amount: -(parseFloat(String(alloc.amount)) || 0) });
              }
            });
          } else {
            rows.push({ date: log.date || '', amount: parseFloat(String(log.rmbAmount)) || 0 });
          }
        } else if (hasAllocations) {
          const allocs = log.allocations?.filter(a => a.vendorCode === vendorCode) || [];
          allocs.forEach(alloc => {
            rows.push({ date: log.date || '', amount: parseFloat(String(alloc.amount)) || 0 });
          });
        }
      });

      const safeSettlementRecords = settlementRecords || [];
      safeSettlementRecords.forEach(rec => {
        const isSource = rec.vendorNo === vendorCode && rec.invoiceId ? (rec.invoiceId.startsWith('V-') || vendors?.some(v => v.vendor_id === rec.invoiceId)) : false;
        const isTarget = rec.invoiceId === vendorCode && rec.vendorNo ? (rec.vendorNo.startsWith('V-') || vendors?.some(v => v.vendor_id === rec.vendorNo)) : false;

        if (isSource) {
          rows.push({ date: rec.date || '', amount: -(parseFloat(String(rec.amountRmb)) || 0) });
        } else if (isTarget) {
          rows.push({ date: rec.date || '', amount: parseFloat(String(rec.amountRmb)) || 0 });
        } else if (rec.vendorNo === vendorCode) {
          if (rec.txnType === 'Forex Adjustment') {
            rows.push({ date: rec.date || '', amount: -(parseFloat(String(rec.amountRmb)) || 0) });
          } else if (rec.txnType === 'Refund' || rec.txnType === 'Refund Adjustment') {
            rows.push({ date: rec.date || '', amount: parseFloat(String(rec.amountRmb)) || 0 });
          }
        }
      });

      rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      return rows.reduce((running, r) => running + r.amount, 0);
    } catch (e) {
      console.error('Error calculating paying vendor balance:', e);
      return 0;
    }
  };

  const generateAdjustmentId = (allRecords: SettlementRecord[]) => {
    const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
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

  // Form state
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [payingVendor, setPayingVendor] = useState(prefillPayingVendor);
  const [notes, setNotes] = useState('');
  const [allocations, setAllocations] = useState<AllocationRow[]>([{ vendorCode: '', amount: '' }]);

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showSuccessScreen, setShowSuccessScreen] = useState(false);
  const [lastAdjId, setLastAdjId] = useState('');
  const { isSubmitting, withSubmissionGuard } = useSubmissionLock();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Auto-populated running total of every receiving-vendor row — the maker-checker
  // review figure, computed live instead of requiring a second manually typed amount.
  const totalAllocated = useMemo(() => {
    return allocations.reduce((sum, row) => sum + (parseFloat(row.amount) || 0), 0);
  }, [allocations]);

  const payingVendorBalance = getVendorBalance(payingVendor);

  const handleAddRow = () => {
    setAllocations(prev => [...prev, { vendorCode: '', amount: '' }]);
  };

  const handleUpdateRow = (index: number, fields: Partial<AllocationRow>) => {
    setAllocations(prev => prev.map((row, i) => (i === index ? { ...row, ...fields } : row)));
  };

  const handleRemoveRow = (index: number) => {
    setAllocations(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmitClick = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!date) {
      setErrorMessage('Please select a settlement date.');
      return;
    }
    if (!payingVendor) {
      setErrorMessage('Please select the paying (source) vendor.');
      return;
    }
    const invalidRow = allocations.some(a => !a.vendorCode || (parseFloat(a.amount) || 0) <= 0);
    if (invalidRow || allocations.length === 0) {
      setErrorMessage('Please ensure every receiving vendor row has a vendor selected and a positive amount.');
      return;
    }
    if (totalAllocated <= 0) {
      setErrorMessage('Total settlement amount must be greater than zero.');
      return;
    }

    setShowConfirmModal(true);
  };

  const handleConfirmSubmission = () => {
    withSubmissionGuard(async () => {
      setShowConfirmModal(false);
      setErrorMessage(null);

      try {
        const adjId = generateAdjustmentId(settlementRecords);

        const promises = allocations.map(alloc => submitAdjustmentEntry({
          txnType: 'Transfer',
          paymentId: adjId,
          sourceVendor: payingVendor,
          targetVendor: alloc.vendorCode,
          amountRmb: parseFloat(alloc.amount) || 0,
          fxRate: 11.50,
          date,
          notes: notes || 'Cross-Vendor Settlement Transfer'
        }));

        await Promise.all(promises);

        if (onRefresh) {
          await onRefresh();
        }

        setLastAdjId(adjId);
        setShowSuccessScreen(true);
      } catch (err: any) {
        console.error('Cross-vendor settlement submission failed:', err);
        setErrorMessage(err.message || 'Failed to submit the cross-vendor settlement entry. Please try again.');
      }
    });
  };

  const resetForm = () => {
    setDate(new Date().toISOString().split('T')[0]);
    setPayingVendor('');
    setNotes('');
    setAllocations([{ vendorCode: '', amount: '' }]);
    setErrorMessage(null);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 font-sans p-4 md:p-8">
      {showSuccessScreen ? (
        <div className="max-w-xl mx-auto py-12 animate-fade-in space-y-4">
          <div className="bg-white dark:bg-gray-950 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="p-8 bg-emerald-100 dark:bg-emerald-600 text-emerald-900 dark:text-white flex flex-col items-center text-center">
              <div className="p-3 bg-emerald-200 dark:bg-emerald-700/80 rounded-full mb-4">
                <CheckCircle2 className="w-12 h-12 text-emerald-600 dark:text-white" />
              </div>
              <h2 className="text-2xl font-black tracking-tight">Cross-Vendor Settlement Logged</h2>
              <p className="text-emerald-100 text-xs mt-1 font-mono tracking-widest uppercase bg-emerald-800/50 px-3 py-1 rounded-full">
                REFERENCE ID: {lastAdjId}
              </p>
            </div>

            <div className="p-6 md:p-8 space-y-6">
              <div className="border-b border-dashed border-gray-200 dark:border-gray-800 pb-4 text-center">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Total Transferred Out Of</p>
                <p className="text-lg font-black text-gray-900 dark:text-white mt-1">
                  [{payingVendor}] {getVendorName(payingVendor)}
                </p>
                <p className="text-3xl font-black text-gray-900 dark:text-white mt-1 font-mono">
                  ¥{totalAllocated.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>

              <div>
                <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Distributed To</p>
                <div className="bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-800 rounded-xl overflow-hidden divide-y divide-gray-200 dark:divide-gray-800">
                  {allocations.map((alloc, id) => (
                    <div key={id} className="p-3 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Layers className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span className="font-bold text-gray-800 dark:text-gray-200 truncate">
                          [{alloc.vendorCode}] {getVendorName(alloc.vendorCode)}
                        </span>
                      </div>
                      <span className="font-mono font-black text-gray-900 dark:text-white shrink-0 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded border border-emerald-100 dark:border-emerald-950">
                        ¥{(parseFloat(alloc.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    resetForm();
                    setShowSuccessScreen(false);
                  }}
                  className="flex-1 py-3 px-4 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 font-bold rounded-xl text-xs transition active:scale-95 text-center cursor-pointer"
                >
                  Log Another
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate && onNavigate('Settlement Ledger')}
                  className="flex-1 py-3 px-4 bg-gray-900 dark:bg-gray-805 hover:bg-gray-800 text-white font-bold rounded-xl text-xs transition active:scale-95 text-center flex items-center justify-center gap-2 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Return to Settlement Ledger</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <button
              onClick={() => onNavigate && onNavigate('Settlement Ledger')}
              className="flex items-center gap-2 text-xs font-bold text-gray-650 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition group py-1 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4 transform group-hover:-translate-x-1 transition-transform" />
              <span>Back to Settlement Ledger</span>
            </button>
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-5">
            <div>
              <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight flex items-center gap-2">
                <ArrowLeftRight className="w-8 h-8 text-indigo-400" />
                <span>Cross-Vendor Settlement Entry</span>
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-2xl">
                Log a capital transfer where one vendor's payment is used to settle another vendor's outstanding balance. Distribute a single paying vendor's funds across one or more receiving vendors.
              </p>
            </div>
          </div>

          {errorMessage && (
            <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-xl flex items-start gap-3 text-amber-800 dark:text-amber-400 animate-slide-up">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500 mt-0.5" />
              <div className="text-xs space-y-1">
                <p className="font-bold">Entry Refused</p>
                <p className="leading-relaxed">{errorMessage}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmitClick} className="max-w-3xl mx-auto bg-white dark:bg-gray-900 border border-gray-250 dark:border-gray-800 shadow-sm rounded-2xl overflow-hidden p-6 md:p-8 space-y-6">
            <div className="border-b border-gray-300 dark:border-gray-800 pb-3">
              <h3 className="text-md font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <span className="w-2 h-4 rounded bg-indigo-400" />
                <span>Transfer Specifications</span>
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-1.5 flex flex-col">
                <label htmlFor="cvs-date" className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Settlement Date</span>
                  <span className="text-red-500 font-bold">*</span>
                </label>
                <input
                  type="date"
                  id="cvs-date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-800 rounded-lg text-xs focus:ring-2 focus:ring-indigo-400 focus:outline-none transition font-medium"
                />
              </div>

              <div className="space-y-1.5 flex flex-col">
                <label htmlFor="cvs-paying-vendor" className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Paying (Source) Vendor</span>
                  <span className="text-red-500 font-bold">*</span>
                </label>
                <select
                  id="cvs-paying-vendor"
                  required
                  value={payingVendor}
                  onChange={(e) => setPayingVendor(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-800 rounded-lg text-xs focus:ring-2 focus:ring-indigo-400 focus:outline-none transition font-medium cursor-pointer"
                >
                  <option value="" disabled>-- Select Paying Vendor --</option>
                  {VENDOR_OPTIONS.map(v => (
                    <option key={v.code} value={v.code}>{v.displayText}</option>
                  ))}
                </select>
              </div>
            </div>

            {payingVendor && (
              <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-xl border border-slate-200/60 dark:border-slate-700/60 flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase text-gray-600 dark:text-gray-400 tracking-wider">
                  {payingVendorBalance > 0 ? 'Advance Credit' : payingVendorBalance < 0 ? 'Outstanding Liability' : 'Current Balance'}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${payingVendorBalance > 0 ? 'bg-emerald-500' : payingVendorBalance < 0 ? 'bg-rose-500' : 'bg-gray-400'}`} />
                  <span className={`font-mono text-sm font-black ${payingVendorBalance > 0 ? 'text-emerald-600 dark:text-emerald-400' : payingVendorBalance < 0 ? 'text-rose-600 dark:text-rose-450' : 'text-gray-500 dark:text-gray-400'}`}>
                    {payingVendorBalance === 0
                      ? '¥0.00'
                      : `${payingVendorBalance > 0 ? '+¥' : '-¥'}${Math.abs(payingVendorBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  </span>
                </div>
              </div>
            )}

            {/* Receiving Vendor Allocation Engine */}
            <div className="border-2 border-dashed border-gray-300 dark:border-gray-800 bg-gray-50/40 dark:bg-slate-900/10 p-5 rounded-2xl space-y-5">
              <div className="border-b border-gray-300 dark:border-gray-800 pb-3 flex items-center justify-between">
                <h3 className="text-md font-bold text-gray-905 dark:text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-500" />
                  <span>Receiving Vendor Allocations</span>
                </h3>
                {/* Auto-populated running total — the maker-checker review figure */}
                <span id="cvs-total-allocated" className="font-mono text-xs font-black text-gray-900 dark:text-white bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 px-2.5 py-1 rounded-lg border border-indigo-200 dark:border-indigo-950">
                  Total: ¥{totalAllocated.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="space-y-3">
                {allocations.map((alloc, index) => (
                  <div key={index} className="flex gap-3 items-end bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-800 p-3 rounded-xl">
                    <div className="flex-1">
                      <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">
                        Receiving Vendor {index + 1} *
                      </label>
                      <select
                        required
                        value={alloc.vendorCode}
                        onChange={(e) => handleUpdateRow(index, { vendorCode: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-650 bg-gray-50 dark:bg-gray-900 text-gray-955 dark:text-white px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                      >
                        <option value="">-- Select Receiving Vendor --</option>
                        {VENDOR_OPTIONS.filter(v => v.code !== payingVendor).map(v => (
                          <option key={v.code} value={v.code}>{v.displayText}</option>
                        ))}
                      </select>
                    </div>

                    <div className="w-[150px]">
                      <label className="block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">
                        Amount (RMB ¥) *
                      </label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-400 text-xs font-bold">¥</span>
                        <input
                          type="number"
                          required
                          min={0.01}
                          step="any"
                          placeholder="Amount"
                          value={alloc.amount}
                          onChange={(e) => handleUpdateRow(index, { amount: e.target.value })}
                          className="w-full rounded-lg border border-gray-300 dark:border-gray-650 bg-gray-50 dark:bg-gray-900 text-gray-950 dark:text-white pl-6 pr-2 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-bold font-mono"
                        />
                      </div>
                    </div>

                    {allocations.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveRow(index)}
                        className="p-1.5 border border-red-200 bg-red-55/10 hover:bg-red-100 text-red-650 rounded-md transition cursor-pointer shrink-0"
                        title="Remove row"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={handleAddRow}
                className="w-full py-2 border border-dashed border-gray-300 dark:border-gray-800 text-gray-550 dark:text-gray-300 hover:text-indigo-500 hover:border-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-805 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Additional Vendor Line</span>
              </button>
            </div>

            <div>
              <label htmlFor="cvs-notes" className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1.5">
                Reference & Notes
              </label>
              <textarea
                id="cvs-notes"
                placeholder="Explain why this cross-vendor settlement is being recorded..."
                rows={2}
                maxLength={150}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 text-gray-955 dark:text-white px-3 py-2 text-sm focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>

            <div className="flex gap-4 pt-4 border-t border-gray-300 dark:border-gray-800">
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-3 border border-gray-300 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-850 text-xs font-bold rounded-lg transition active:scale-95 cursor-pointer text-center"
              >
                Clear Fields
              </button>
              <button
                type="submit"
                className="flex-1 py-3 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white font-bold rounded-lg text-xs transition active:scale-95 text-center flex items-center justify-center gap-2 cursor-pointer shadow-md"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Review & Confirm Settlement</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CONFIRMATION MODAL — maker-checker review step showing the auto-computed total */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            className="fixed inset-0 bg-gray-900/80 backdrop-blur-sm transition-opacity"
            onClick={() => setShowConfirmModal(false)}
          />

          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <div className="relative transform overflow-hidden rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-left shadow-2xl transition-all sm:my-8 sm:w-full sm:max-w-lg scale-100 animate-slide-up">
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-3 border-b border-gray-300 dark:border-gray-800 pb-3">
                  <div className="p-2.5 bg-amber-50 dark:bg-amber-950/60 text-amber-500 rounded-full">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-gray-905 dark:text-white leading-tight">Confirm Cross-Vendor Settlement</h3>
                    <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">Review before permanent logging</p>
                  </div>
                </div>

                <div className="text-xs text-gray-600 dark:text-gray-300 space-y-2 border-t border-gray-200 dark:border-gray-800 pt-3">
                  <p>
                    <span className="text-gray-400">Paying Vendor:</span>{' '}
                    <span className="font-bold text-gray-900 dark:text-white">[{payingVendor}] {getVendorName(payingVendor)}</span>
                  </p>
                  <div className="bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-200 dark:divide-gray-800 overflow-hidden">
                    {allocations.map((alloc, id) => (
                      <div key={id} className="flex items-center justify-between px-3 py-2">
                        <span className="font-semibold text-gray-800 dark:text-gray-200">[{alloc.vendorCode}] {getVendorName(alloc.vendorCode)}</span>
                        <span className="font-mono font-bold text-gray-900 dark:text-white">¥{(parseFloat(alloc.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900 rounded-lg px-3 py-2">
                    <span className="font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300 text-[11px]">Total Settlement Amount</span>
                    <span className="font-mono font-black text-indigo-700 dark:text-indigo-300">¥{totalAllocated.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>

                <div className="p-3 bg-red-50 dark:bg-slate-950 rounded-xl border border-red-200 dark:border-slate-800">
                  <p className="text-xs text-red-800 dark:text-red-400 font-bold leading-relaxed flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>Once logged, this settlement cannot be altered or modified in the ledger system. Please confirm the total above is correct before proceeding.</span>
                  </p>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(false)}
                    className="flex-1 py-2.5 border border-gray-300 dark:border-gray-800 text-gray-655 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 text-xs font-bold rounded-lg cursor-pointer transition text-center"
                  >
                    Go Back & Edit
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmSubmission}
                    disabled={isSubmitting}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg cursor-pointer transition text-center flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-gray-300/30 border-t-white rounded-full animate-spin" />
                        <span>Logging...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Confirm & Log Entry</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
