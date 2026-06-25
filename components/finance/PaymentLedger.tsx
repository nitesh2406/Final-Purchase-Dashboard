import React, { useState, useEffect, useMemo } from 'react';
import { 
  ArrowLeft, 
  Calendar, 
  Building2, 
  DollarSign, 
  AlertTriangle, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Info, 
  Layers, 
  Coins, 
  Key, 
  Check, 
  X,
  CreditCard,
  ShieldAlert
} from 'lucide-react';
import { ViewType } from '../../types';
import { 
  fetchPaymentLogs, 
  submitPaymentLog, 
  getPaymentLogs,
  VendorMaster,
  IS_DEVELOPMENT_MODE
} from '../../services/settlementService';
import { useSubmissionLock } from '../../hooks/useSubmissionLock';

interface PaymentLedgerProps {
  onNavigate?: (view: ViewType) => void;
  vendors: VendorMaster[];
  onRefresh?: () => Promise<void> | void;
}

interface AllocationRow {
  vendorCode: string;
  amount: number;
}

export const PaymentLedger: React.FC<PaymentLedgerProps> = ({ onNavigate, vendors, onRefresh }) => {
  // Unique vendor codes for filter/form select lists 
  const VENDOR_OPTIONS = useMemo(() => {
    return vendors.map(v => ({
      code: v.vendor_id,
      name: v.vendor_name || v.vendor_id,
      displayText: v.vendor_name ? `${v.vendor_id} -- ${v.vendor_name}` : v.vendor_id
    }));
  }, [vendors]);

  // Main form states
  const [paymentDate, setPaymentDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [selectedVendor, setSelectedVendor] = useState<string>(''); // Vendor Code
  const [rmbAmount, setRmbAmount] = useState<string>('');
  const [fxRate, setFxRate] = useState<string>('');
  const [inrAmount, setInrAmount] = useState<string>('');
  const [paymentMode, setPaymentMode] = useState<string>('Bank Transfer');
  const [referenceNo, setReferenceNo] = useState<string>('');

  // Payment serial ID logic
  const [paymentId, setPaymentId] = useState<string>('PAY-00001');

  // Cross-vendor allocation array lists
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const [isAllocationManual, setIsAllocationManual] = useState<boolean>(false);
  const [isCrossVendor, setIsCrossVendor] = useState<boolean>(false);

  // Interface action screens & confirmations
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [showSuccessScreen, setShowSuccessScreen] = useState<boolean>(false);
  const { isSubmitting, withSubmissionGuard } = useSubmissionLock();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  // Load existing payments to compute next sequential ID
  useEffect(() => {
    const checkPaymentId = async () => {
      try {
        const list = await fetchPaymentLogs();
        let maxSeq = 0;
        list.forEach((log) => {
          if (log.paymentId && log.paymentId.startsWith('PAY-')) {
            const seqStr = log.paymentId.replace('PAY-', '');
            const seqVal = parseInt(seqStr, 10);
            if (!isNaN(seqVal) && seqVal > maxSeq) {
              maxSeq = seqVal;
            }
          }
        });
        const nextSeq = maxSeq + 1;
        const formattedId = `PAY-${nextSeq.toString().padStart(5, '0')}`;
        setPaymentId(formattedId);
      } catch (err) {
        // Fallback to local
        const list = getPaymentLogs();
        let maxSeq = 0;
        list.forEach((log) => {
          if (log.paymentId && log.paymentId.startsWith('PAY-')) {
            const seqStr = log.paymentId.replace('PAY-', '');
            const seqVal = parseInt(seqStr, 10);
            if (!isNaN(seqVal) && seqVal > maxSeq) {
              maxSeq = seqVal;
            }
          }
        });
        const formattedId = `PAY-${(maxSeq + 1).toString().padStart(5, '0')}`;
        setPaymentId(formattedId);
      }
    };
    checkPaymentId();
  }, []);

  // FINANCIAL TRIAD AUTOMATED CALCULATION & INVERSION logic
  const activeTriadCount = useMemo(() => {
    let count = 0;
    if (rmbAmount && !isNaN(parseFloat(rmbAmount))) count++;
    if (fxRate && !isNaN(parseFloat(fxRate))) count++;
    if (inrAmount && !isNaN(parseFloat(inrAmount))) count++;
    return count;
  }, [rmbAmount, fxRate, inrAmount]);

  // Derived calculations based on exactly two fields
  const triadCalculations = useMemo(() => {
    const rmb = parseFloat(rmbAmount);
    const fx = parseFloat(fxRate);
    const inr = parseFloat(inrAmount);

    if (activeTriadCount === 2) {
      if (!isNaN(rmb) && !isNaN(fx) && isNaN(inr)) {
        // RMB + FX Rate provided -> compute INR
        const calculatedInr = rmb * fx;
        return { type: 'INR', value: calculatedInr, rmb, fx, inr: calculatedInr, valid: true };
      }
      if (!isNaN(rmb) && isNaN(fx) && !isNaN(inr)) {
        // RMB + INR provided -> compute FX Rate
        if (rmb === 0) return { type: 'FX Rate', value: 0, rmb, fx: 0, inr, valid: true };
        const calculatedFx = inr / rmb;
        return { type: 'FX Rate', value: calculatedFx, rmb, fx: calculatedFx, inr, valid: true };
      }
      if (isNaN(rmb) && !isNaN(fx) && !isNaN(inr)) {
        // FX Rate + INR provided -> compute RMB
        if (fx === 0) return { type: 'RMB', value: 0, rmb: 0, fx, inr, valid: true };
        const calculatedRmb = inr / fx;
        return { type: 'RMB', value: calculatedRmb, rmb: calculatedRmb, fx, inr, valid: true };
      }
    }
    
    return { type: null, value: null, rmb: isNaN(rmb) ? 0 : rmb, fx: isNaN(fx) ? 0 : fx, inr: isNaN(inr) ? 0 : inr, valid: false };
  }, [rmbAmount, fxRate, inrAmount, activeTriadCount]);

  // Set default initial allocation row matching primary vendor + total RMB
  const targetRmbAmount = useMemo(() => {
    if (triadCalculations.valid) {
      return triadCalculations.rmb;
    }
    const r = parseFloat(rmbAmount);
    return isNaN(r) ? 0 : r;
  }, [rmbAmount, triadCalculations]);

  // Automatically seed allocations when selected vendor or total RMB changes
  useEffect(() => {
    if (!isAllocationManual && selectedVendor) {
      setAllocations([
        { vendorCode: selectedVendor, amount: targetRmbAmount }
      ]);
    }
  }, [selectedVendor, targetRmbAmount, isAllocationManual]);

  // Cross-vendor allocations dynamic balancing metrics
  const totalAllocatedAmount = useMemo(() => {
    return allocations.reduce((sum, item) => sum + (item.amount || 0), 0);
  }, [allocations]);

  const allocationMetrics = useMemo(() => {
    const diff = targetRmbAmount - totalAllocatedAmount;
    const absDiff = Math.abs(diff);
    const isBalanced = absDiff < 0.01 && targetRmbAmount > 0;
    
    return {
      total: totalAllocatedAmount,
      diff,
      absDiff,
      status: isBalanced ? 'balanced' : diff > 0 ? 'remaining' : 'excess'
    };
  }, [targetRmbAmount, totalAllocatedAmount]);

  // Custom Selector joined with name
  const sourceVendorName = useMemo(() => {
    const matched = VENDOR_OPTIONS.find(v => v.code === selectedVendor);
    return matched ? matched.name : '';
  }, [selectedVendor, VENDOR_OPTIONS]);

  // Allocation Handlers
  const handleAddAllocationRow = () => {
    setIsAllocationManual(true);
    setAllocations(prev => [
      ...prev,
      { vendorCode: '', amount: 0 }
    ]);
  };

  const handleUpdateAllocationRow = (index: number, fields: Partial<AllocationRow>) => {
    setIsAllocationManual(true);
    setAllocations(prev => prev.map((item, id) => {
      if (id === index) {
        return { ...item, ...fields };
      }
      return item;
    }));
  };

  const handleRemoveAllocationRow = (index: number) => {
    setIsAllocationManual(true);
    setAllocations(prev => prev.filter((_, id) => id !== index));
  };

  // Form Submission Validation check
  const handleSubmitClick = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // 1. Check Date
    if (!paymentDate) {
      setErrorMessage('Please select a valid payment date.');
      return;
    }

    // 2. Check Vendor
    if (!selectedVendor) {
      setErrorMessage('Please select a primary vendor account.');
      return;
    }

    // 3. Strict financial triad rule validation
    if (activeTriadCount !== 2) {
      if (activeTriadCount < 2) {
        setErrorMessage('Strict Validation: You must provide exactly TWO of the financial triad fields (RMB Amount, FX Rate, INR Amount) to auto-calculate the third.');
      } else {
        setErrorMessage('Strict Validation: You cannot define all 3 triad fields. Exactly TWO must be provided to let the system auto-calculate the third securely and prevent rounding mismatches.');
      }
      return;
    }

    if (!triadCalculations.valid || targetRmbAmount <= 0) {
      setErrorMessage('Financial validation error: Please enter positive financial values.');
      return;
    }

    // 4. Strict cross-vendor allocation totals guardrail verification
    if (isCrossVendor && allocationMetrics.status !== 'balanced') {
      if (allocationMetrics.status === 'remaining') {
        setErrorMessage(`Cross-Vendor Allocation Error: There is a remaining unallotted margin of ¥${allocationMetrics.absDiff.toFixed(2)} RMB. All amounts must perfectly equal the grand total of ¥${targetRmbAmount.toFixed(2)}.`);
      } else {
        setErrorMessage(`Cross-Vendor Allocation Error: An excess amount of ¥${allocationMetrics.absDiff.toFixed(2)} RMB has been distributed. The distributed total must perfectly match the grand total of ¥${targetRmbAmount.toFixed(2)}.`);
      }
      return;
    }

    // Pass validations -> Trigger Modal Confirmation dialog
    setShowConfirmModal(true);
  };

  // Final confirmed write operation with Syncing state and onRefresh sync integrations
  const handleConfirmSubmission = () => {
    withSubmissionGuard(async () => {
      setShowConfirmModal(false);
      setErrorMessage(null);
      setRollbackError(null);

      // Finalize the triad data inversion calculations
      const finalRmb = triadCalculations.rmb;
      const finalFx = triadCalculations.fx;
      const finalInr = triadCalculations.inr;

      const payload = {
        paymentId: paymentId,
        date: paymentDate,
        vendorCode: selectedVendor,
        rmbAmount: finalRmb,
        fxRate: finalFx,
        inrAmount: finalInr,
        paymentMode: paymentMode || 'Other',
        referenceNo: referenceNo || undefined,
        allocations: isCrossVendor ? allocations.map(a => ({
          vendorCode: a.vendorCode,
          amount: a.amount
        })) : [{ vendorCode: selectedVendor, amount: finalRmb }],
        isCrossVendor: isCrossVendor
      };

      try {
        // 1. OPTIMISTIC CLIENT PERSISTENCE WRITE (only when not in development mode)
        if (!IS_DEVELOPMENT_MODE && typeof window !== 'undefined') {
          try {
            const listStr = localStorage.getItem('payment_logs_table');
            const list = listStr ? JSON.parse(listStr) : [];
            const tableRecord = {
              ...payload,
              balance: finalRmb
            };
            const exists = list.some((item: any) => item.paymentId === paymentId);
            if (!exists) {
              list.unshift(tableRecord);
              localStorage.setItem('payment_logs_table', JSON.stringify(list));
            }
          } catch (localErr) {
            console.warn("Optimistic local storage write failed", localErr);
          }
        }

        // 2. BACKGROUND SYNC WORKFLOW (Await in dev mode, trigger sync synchronously)
        const response = await submitPaymentLog(payload);
        if (!response || !response.success) {
          throw new Error(response?.message || 'Remittance log upload failed.');
        }

        console.log("Synchronization of payment log succeeded:", paymentId);

        // Trigger fresh sync of all parent accounts data so everything is updated
        if (onRefresh) {
          await onRefresh();
        }

        setShowSuccessScreen(true);
      } catch (err: any) {
        console.error("Submission failed: ", err);

        // 3. ROBUST STATE ROLLBACK (only when not in development mode)
        if (!IS_DEVELOPMENT_MODE && typeof window !== 'undefined') {
          try {
            const listStr = localStorage.getItem('payment_logs_table');
            if (listStr) {
              const list = JSON.parse(listStr);
              const filtered = list.filter((item: any) => item.paymentId !== paymentId);
              localStorage.setItem('payment_logs_table', JSON.stringify(filtered));
            }
          } catch (localRollErr) {
            console.error("Local rollback write failed", localRollErr);
          }
        }

        setRollbackError("Sync Failure: Transaction could not be written to Google Sheets. Changes have been rolled back safely. Please check your connection and try again.");
      }
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 font-sans p-4 md:p-8">
      {/* SUCCESS RECEIPT WORKSPACE PAGE */}
      {showSuccessScreen ? (
        <div id="payment-receipt-view" className="max-w-xl mx-auto py-12 animate-fade-in space-y-4">
          {rollbackError && (
            <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-500 text-rose-800 dark:text-rose-200 px-4 py-3 rounded-lg relative flex items-center justify-between shadow-lg" role="alert">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0" />
                <span className="text-xs font-semibold">{rollbackError}</span>
              </div>
              <button onClick={() => setRollbackError(null)} className="text-rose-700 hover:text-rose-900 dark:text-rose-400 dark:hover:text-rose-200">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <div className="bg-white dark:bg-gray-950 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden transform scale-100 transition duration-300">
            {/* Top Certificate Header */}
            <div className="p-8 bg-emerald-100 dark:bg-emerald-600 text-emerald-900 dark:text-white flex flex-col items-center text-center">
              <div className="p-3 bg-emerald-200 dark:bg-emerald-700/80 rounded-full mb-4">
                <CheckCircle2 className="w-12 h-12 text-emerald-600 dark:text-white" />
              </div>
              <h2 className="text-2xl font-black tracking-tight">Disbursement Receipt Issued</h2>
              <p className="text-emerald-100 text-xs mt-1 font-mono tracking-widest uppercase bg-emerald-800/50 px-3 py-1 rounded-full">
                TRANSACTION ID: {paymentId}
              </p>
            </div>

            {/* Receipt Body content */}
            <div className="p-6 md:p-8 space-y-6">
              <div className="border-b border-dashed border-gray-200 dark:border-gray-800 pb-4 text-center">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">Remitted From Indian Account</p>
                <p className="text-3xl font-black text-gray-900 dark:text-white mt-1 font-mono">
                  ₹{triadCalculations.inr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </p>
                <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500 mt-1 font-medium">
                  <span>At standard closing conversions</span>
                  <Coins className="w-3.5 h-3.5" />
                  <span className="font-bold text-gray-900 dark:text-white">ER2: {triadCalculations.fx} INR/RMB</span>
                </div>
              </div>

              {/* Data Items grids */}
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-800 p-2.5 rounded-lg">
                  <p className="text-gray-400 font-semibold uppercase text-[9px]">Supplier Base Value</p>
                  <p className="font-bold text-gray-800 dark:text-gray-200 font-mono mt-0.5">¥{triadCalculations.rmb.toLocaleString('en-US', { minimumFractionDigits: 2 })} CNY</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-800 p-2.5 rounded-lg">
                  <p className="text-gray-400 font-semibold uppercase text-[9px]">Primary Sourced Vendor</p>
                  <p className="font-bold text-gray-800 dark:text-gray-200 truncate mt-0.5">[{selectedVendor}] {sourceVendorName}</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-800 p-2.5 rounded-lg">
                  <p className="text-gray-400 font-semibold uppercase text-[9px]">Payment Date</p>
                  <p className="font-bold text-gray-800 dark:text-gray-200 mt-0.5">{paymentDate}</p>
                </div>
                <div className="bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-800 p-2.5 rounded-lg">
                  <p className="text-gray-400 font-semibold uppercase text-[9px]">Reference No</p>
                  <p className="font-bold text-gray-800 dark:text-gray-200 truncate mt-0.5">{referenceNo || 'None Stated'}</p>
                </div>
              </div>

              {/* Allocations stack in voucher */}
              <div>
                <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">ALLOCATION REMITTANCE COOPERATIVE</p>
                <div className="bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-800 rounded-xl overflow-hidden divide-y divide-gray-200 dark:divide-gray-800">
                  {allocations.map((alloc, id) => {
                    const matchedName = VENDOR_OPTIONS.find(v => v.code === alloc.vendorCode)?.displayText || alloc.vendorCode;
                    return (
                      <div key={id} className="p-3 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Layers className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          <span className="font-bold text-gray-800 dark:text-gray-200 truncate">
                            {matchedName}
                          </span>
                        </div>
                        <span className="font-mono font-black text-gray-900 dark:text-white shrink-0 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded border border-emerald-100 dark:border-emerald-950">
                          ¥{alloc.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Safe Guardrail notification */}
              {/* Done actions */}
              <div className="flex gap-4 pt-2">
                <button
                  type="button"
                  id="receipt-return-btn"
                  onClick={() => {
                    if (onNavigate) {
                      onNavigate('Accounts View');
                    }
                  }}
                  className="flex-1 py-3 px-4 bg-gray-900 dark:bg-gray-805 hover:bg-gray-800 text-white font-bold rounded-xl text-xs transition active:scale-95 text-center flex items-center justify-center gap-2 cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Return to Accounts View</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* STANDARD INPUT WORKING PANEL FORM */
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Back Trigger Bar */}
          <div className="flex items-center justify-between">
            <button
              id="back-to-accounts-bar"
              onClick={() => {
                if (onNavigate) {
                  onNavigate('Accounts View');
                }
              }}
              className="flex items-center gap-2 text-xs font-bold text-gray-650 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition group py-1"
            >
              <ArrowLeft className="w-4 h-4 transform group-hover:-translate-x-1 transition-transform" />
              <span>Back to Central Accounting Ledger</span>
            </button>

            <span className="text-[11px] font-semibold text-gray-400 font-mono">
              STATUS: SYSTEM STABLE
            </span>
          </div>

          {/* Page Heading and Tracker ID bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-5">
            <div>
              <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight flex items-center gap-2">
                <CreditCard className="w-8 h-8 text-blue-400" />
                <span>Supplier Outward Remittance Entry</span>
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-2xl">
                Maintain financial compliance. Record outward payments made to raw material and garment logistics suppliers. Fields feature strict dual-entry automated triad computation logic.
              </p>
            </div>

            {/* Read-only tracking serial */}
            <div className="bg-gray-100 dark:bg-slate-900 border border-gray-200 dark:border-gray-800 p-3 rounded-xl flex items-center gap-3">
              <div className="p-2 bg-blue-500 text-white rounded-lg">
                <Key className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[9px] font-bold text-gray-405 dark:text-gray-500 uppercase tracking-widest">Serial Payment ID</p>
                <input
                  type="text"
                  readOnly
                  disabled
                  value={paymentId}
                  id="non-editable-payment-id"
                  className="font-mono font-black text-base text-gray-900 dark:text-white bg-transparent leading-none border-none p-0 outline-none w-28 cursor-not-allowed selection:bg-transparent"
                />
              </div>
            </div>
          </div>

          {/* Validation Banner if populated */}
          {errorMessage && (
            <div id="form-validation-lead-banner" className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-xl flex items-start gap-3 text-amber-800 dark:text-amber-400 animate-slide-up">
              <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500 mt-0.5" />
              <div className="text-xs space-y-1">
                <p className="font-bold">Remittance Audit Refusal</p>
                <p className="leading-relaxed">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Main Form content wrapper: single focused modern form layout */}
          <form onSubmit={handleSubmitClick} className="max-w-4xl mx-auto bg-white dark:bg-gray-900 border border-gray-250 dark:border-gray-800 shadow-sm rounded-2xl overflow-hidden p-6 md:p-8 space-y-6">
            
            <div className="border-b border-gray-300 dark:border-gray-800 pb-3">
              <h3 className="text-md font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <span className="w-2 h-4 rounded bg-blue-400" />
                <span>Primary Remittance Specifications</span>
              </h3>
            </div>

            {/* Group A: Date & Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* 1. Date selector picker */}
              <div className="space-y-1.5 flex flex-col">
                <label htmlFor="form-payment-date" className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-blue-400" />
                  <span>Payment Date</span>
                  <span className="text-red-500 font-bold">*</span>
                </label>
                <input
                  type="date"
                  id="form-payment-date"
                  required
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-800 rounded-lg text-xs focus:ring-2 focus:ring-blue-400 focus:bg-white dark:focus:bg-gray-950 focus:outline-none transition font-medium"
                />
              </div>

              {/* 2. Vendor selector dropdown combining 'Vendor Code + Vendor Name' */}
              <div className="space-y-1.5 flex flex-col">
                <label htmlFor="form-vendor-select" className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-blue-400" />
                  <span>Primary Vendor Account</span>
                  <span className="text-red-500 font-bold">*</span>
                </label>
                <select
                  id="form-vendor-select"
                  required
                  value={selectedVendor}
                  onChange={(e) => setSelectedVendor(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-800 rounded-lg text-xs focus:ring-2 focus:ring-blue-400 focus:bg-white dark:focus:bg-gray-950 focus:outline-none transition font-medium cursor-pointer"
                >
                  <option value="" disabled>-- Select Vendor Code + Name --</option>
                  {VENDOR_OPTIONS.map((v) => (
                    <option key={v.code} value={v.code}>
                      {v.displayText}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Group B: The STRICT FINANCIAL TRIAD WORKSPACE (RMB, FX Rate, INR) */}
            <div className="rounded-xl bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-gray-800 p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 pb-2">
                <span className="text-xs font-black text-gray-900 dark:text-white flex items-center gap-1.5 uppercase tracking-wider">
                  <Coins className="w-4 h-4 text-amber-550" />
                  <span>Financial Triad Inputs</span>
                </span>
                
                {/* Realtime Dual Entry Indicator Badge */}
                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                  activeTriadCount === 2 
                    ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 border border-emerald-250 dark:border-emerald-900' 
                    : activeTriadCount > 2 
                      ? 'bg-red-50 dark:bg-red-950/55 text-red-600 dark:text-red-400 border border-red-200' 
                      : 'bg-amber-50 dark:bg-amber-950 text-amber-600 dark:text-amber-400 border border-amber-200'
                }`}>
                  {activeTriadCount === 2 
                    ? '✓ Dual Fields Registered' 
                    : activeTriadCount > 2 
                      ? '✖ Violation: 3 Fields Entered' 
                      : `ℹ Entered ${activeTriadCount}/2 Fields`
                  }
                </span>
              </div>

              <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                <strong className="font-bold">Strict Security Rule:</strong> Input values into <span className="font-bold text-gray-805 dark:text-gray-200 text-xs">exactly two</span> of these fields. The system will automatically invert mathematics to compute the remaining entry to safeguard precision without rounding disputes.
              </p>

              {/* Input triad fields stack split */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                
                {/* 1. RMB Amount */}
                <div className="space-y-1">
                  <label htmlFor="form-triad-rmb" className="text-[10.5px] font-bold text-gray-655 dark:text-gray-400 flex items-center justify-between">
                    <span>RMB Value (¥)</span>
                    {triadCalculations.valid && triadCalculations.type === 'RMB' && (
                      <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/10 px-1 py-0.1 rounded uppercase animate-pulse">Calc</span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      id="form-triad-rmb"
                      step="0.01"
                      placeholder="0.00"
                      value={triadCalculations.valid && triadCalculations.type === 'RMB' ? triadCalculations.value || '' : rmbAmount}
                      onChange={(e) => {
                        if (triadCalculations.type === 'RMB') {
                          setInrAmount('');
                        }
                        setRmbAmount(e.target.value);
                      }}
                      disabled={triadCalculations.valid && triadCalculations.type === 'RMB'}
                      className={`w-full pl-7 pr-3 py-2 bg-white dark:bg-gray-950 border rounded-lg text-xs focus:ring-1 focus:ring-blue-400 focus:outline-none transition font-sans ${
                        triadCalculations.valid && triadCalculations.type === 'RMB'
                          ? 'bg-emerald-500/5 dark:bg-emerald-500/10 border-emerald-400 text-emerald-600 dark:text-emerald-450 font-black cursor-not-allowed font-medium'
                          : 'border-gray-300 dark:border-gray-800 text-gray-900 dark:text-white'
                      }`}
                    />
                    <span className="absolute left-2.5 top-2.5 text-[10.5px] text-gray-400 select-none">¥</span>
                  </div>
                </div>

                {/* 2. FX Rate */}
                <div className="space-y-1">
                  <label htmlFor="form-triad-fx" className="text-[10.5px] font-bold text-gray-655 dark:text-gray-400 flex items-center justify-between">
                    <span>FX Rate (ER2)</span>
                    {triadCalculations.valid && triadCalculations.type === 'FX Rate' && (
                      <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/10 px-1 py-0.1 rounded uppercase animate-pulse">Calc</span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      id="form-triad-fx"
                      step="0.0001"
                      placeholder="0.0000"
                      value={triadCalculations.valid && triadCalculations.type === 'FX Rate' ? triadCalculations.value || '' : fxRate}
                      onChange={(e) => {
                        if (triadCalculations.type === 'FX Rate') {
                          setInrAmount('');
                        }
                        setFxRate(e.target.value);
                      }}
                      disabled={triadCalculations.valid && triadCalculations.type === 'FX Rate'}
                      className={`w-full pl-7 pr-3 py-2 bg-white dark:bg-gray-950 border rounded-lg text-xs focus:ring-1 focus:ring-blue-400 focus:outline-none transition font-sans ${
                        triadCalculations.valid && triadCalculations.type === 'FX Rate'
                          ? 'bg-emerald-500/5 dark:bg-emerald-500/10 border-emerald-400 text-emerald-600 dark:text-emerald-450 font-black cursor-not-allowed font-medium'
                          : 'border-gray-300 dark:border-gray-800 text-gray-900 dark:text-white'
                      }`}
                    />
                    <span className="absolute left-2.5 top-2.5 text-[10px] text-gray-400 select-none">ER</span>
                  </div>
                </div>

                {/* 3. INR Amount */}
                <div className="space-y-1">
                  <label htmlFor="form-triad-inr" className="text-[10.5px] font-bold text-gray-655 dark:text-gray-400 flex items-center justify-between">
                    <span>INR Value (₹)</span>
                    {triadCalculations.valid && triadCalculations.type === 'INR' && (
                      <span className="text-[9px] font-bold text-emerald-500 bg-emerald-500/10 px-1 py-0.1 rounded uppercase animate-pulse">Calc</span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      id="form-triad-inr"
                      step="0.01"
                      placeholder="0.00"
                      value={triadCalculations.valid && triadCalculations.type === 'INR' ? triadCalculations.value || '' : inrAmount}
                      onChange={(e) => {
                        if (triadCalculations.type === 'INR') {
                          setFxRate('');
                        }
                        setInrAmount(e.target.value);
                      }}
                      disabled={triadCalculations.valid && triadCalculations.type === 'INR'}
                      className={`w-full pl-7 pr-3 py-2 bg-white dark:bg-gray-950 border rounded-lg text-xs focus:ring-1 focus:ring-blue-400 focus:outline-none transition font-sans ${
                        triadCalculations.valid && triadCalculations.type === 'INR'
                          ? 'bg-emerald-500/5 dark:bg-emerald-500/10 border-emerald-400 text-emerald-600 dark:text-emerald-450 font-black cursor-not-allowed font-medium'
                          : 'border-gray-300 dark:border-gray-800 text-gray-900 dark:text-white'
                      }`}
                    />
                    <span className="absolute left-2.5 top-2.5 text-[10.5px] text-gray-400 select-none">₹</span>
                  </div>
                </div>

              </div>

              {/* Status Indicator text below inputs */}
              {activeTriadCount > 2 && (
                <div className="p-2.5 bg-red-500/10 rounded-lg text-[11px] text-red-500 font-bold flex items-center gap-1.5 mt-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                  <span>Calculation blocked: Please remove one input. The system must operate with exactly two values.</span>
                </div>
              )}
              
              {triadCalculations.valid && (
                <div className="p-2.5 bg-emerald-500/10 rounded-lg text-[11px] text-emerald-600 dark:text-emerald-400 font-black flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 shrink-0" />
                    <span>Inversion complete: Locked auto calculated <strong className="font-extrabold pr-1 text-gray-905 dark:text-white">{triadCalculations.type}</strong> value.</span>
                  </div>
                  <span className="font-mono bg-emerald-500/15 px-2 py-0.5 rounded text-[11px]">
                    {triadCalculations.type === 'INR' ? `₹${triadCalculations.value.toLocaleString()}` : triadCalculations.type === 'RMB' ? `¥${triadCalculations.value.toLocaleString()}` : `${triadCalculations.value}`}
                  </span>
                </div>
              )}
            </div>

            {/* Checkbox for Cross-Vendor toggle option (positioned directly below primary triad fields) */}
            <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-gray-50 dark:bg-slate-900 border border-gray-300 dark:border-gray-800">
              <input
                type="checkbox"
                id="form-cross-vendor-toggle"
                checked={isCrossVendor}
                onChange={(e) => {
                  setIsCrossVendor(e.target.checked);
                  if (!e.target.checked) {
                    setIsAllocationManual(false);
                    setAllocations([
                      { vendorCode: selectedVendor, amount: targetRmbAmount }
                    ]);
                  }
                }}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-700 text-blue-500 focus:ring-blue-400 accent-blue-500 cursor-pointer"
              />
              <label htmlFor="form-cross-vendor-toggle" className="text-xs font-bold text-gray-800 dark:text-gray-200 cursor-pointer select-none">
                Is cross-vendor payment
              </label>
            </div>

            {/* Group C: Payment Mode & Reference Optional Parameters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* 1. Payment Mode Dropdown helper options */}
              <div className="space-y-1.5 flex flex-col">
                <label htmlFor="form-payment-mode" className="text-xs font-bold text-gray-755 dark:text-gray-350">
                  Payment Mode
                </label>
                <select
                  id="form-payment-mode"
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-800 rounded-lg text-xs focus:ring-2 focus:ring-blue-400 focus:outline-none transition font-medium cursor-pointer"
                >
                  <option value="Bank Transfer">Bank Transfer (Remittance Direct)</option>
                  <option value="Cash">Cash Settlement Handover</option>
                  <option value="Pool Settlement">Pool Settlement Account</option>
                  <option value="Other">Other Alternative Channel</option>
                </select>
              </div>

              {/* 2. Reference No */}
              <div className="space-y-1.5 flex flex-col">
                <label htmlFor="form-reference-no" className="text-xs font-bold text-gray-755 dark:text-gray-350">
                  Reference No (Optional)
                </label>
                <input
                  type="text"
                  id="form-reference-no"
                  placeholder="e.g. Bank UTR / Txn Code"
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-950 border border-gray-300 dark:border-gray-800 rounded-lg text-xs focus:ring-2 focus:ring-blue-400 focus:bg-white dark:focus:bg-gray-950 focus:outline-none transition font-medium font-sans text-gray-900 dark:text-white"
                />
              </div>
            </div>

            {/* CONDITIONAL CROSS-VENDOR ALLOCATION ENGINE PANEL (expanded smoothly within template directly before final submit row) */}
            {isCrossVendor && (
              <div className="animate-fade-in border-2 border-dashed border-gray-300 dark:border-gray-800 bg-gray-50/40 dark:bg-slate-900/10 p-5 rounded-2xl space-y-5">
                <div className="border-b border-gray-300 dark:border-gray-800 pb-3">
                  <h3 className="text-md font-bold text-gray-905 dark:text-white flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-500" />
                    <span>Cross-Vendor Allocation Engine</span>
                  </h3>
                </div>

                <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                  Distribute raw capital payments across distinct receiving manufacturing entities. Settle outstanding debit statements cooperatively. 
                </p>

                {/* Distribute Metric Box Workspace */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
                  
                  {/* Metric overview container */}
                  <div className="md:col-span-12 lg:col-span-5 p-4 bg-gray-100/40 dark:bg-slate-950/40 border border-gray-300 dark:border-gray-800 rounded-xl space-y-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-500 dark:text-gray-400">Grand Sourced Total:</span>
                      <span className="font-mono font-black text-gray-900 dark:text-white bg-blue-50 dark:bg-blue-950/40 text-blue-500 dark:text-blue-400 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-950">
                        ¥{targetRmbAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} RMB
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-550 dark:text-gray-400">Total Distributed:</span>
                      <span className="font-mono font-bold text-gray-800 dark:text-gray-200">
                        ¥{totalAllocatedAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} RMB
                      </span>
                    </div>

                    {/* Real-time Dynamic Balancing Line Metric Alerts */}
                    <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
                      {allocationMetrics.status === 'balanced' && (
                        <div className="text-[11px] font-black text-emerald-600 dark:text-emerald-450 flex items-center gap-1 bg-emerald-500/10 p-2 rounded-lg">
                          <Check className="w-3.5 h-3.5" />
                          <span>Status Balanced: Sum perfectly matches grand total (¥{targetRmbAmount.toFixed(2)}).</span>
                        </div>
                      )}

                      {allocationMetrics.status === 'remaining' && (
                        <div className="text-[11px] font-bold text-amber-550 dark:text-amber-450 flex items-center justify-between bg-amber-500/10 p-2 rounded-lg leading-none">
                          <div className="flex items-center gap-1">
                            <Info className="w-3.5 h-3.5 animate-pulse" />
                            <span>Remaining to Allot:</span>
                          </div>
                          <span className="font-mono font-black text-xs">¥{allocationMetrics.absDiff.toFixed(2)}</span>
                        </div>
                      )}

                      {allocationMetrics.status === 'excess' && (
                        <div className="text-[11px] font-bold text-red-500 flex items-center justify-between bg-red-500/10 p-2 rounded-lg leading-none">
                          <div className="flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>Excessive Allotted:</span>
                          </div>
                          <span className="font-mono font-black text-xs">¥{allocationMetrics.absDiff.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Allocation Rows content stack */}
                  <div className="md:col-span-12 lg:col-span-7 space-y-3">
                    <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1">
                      {allocations.length === 0 ? (
                        <div className="text-center py-6 border border-dashed border-gray-300 dark:border-gray-800 rounded-xl text-gray-400 text-xs">
                          Please select a primary vendor account above to initialize distributions automatically.
                        </div>
                      ) : (
                        allocations.map((alloc, index) => {
                          return (
                            <div key={index} className="flex gap-2 items-center bg-white dark:bg-gray-950 border border-gray-300 dark:border-gray-800 p-2.5 rounded-lg relative group">
                              
                              {/* Selector dropdown */}
                              <div className="flex-1 space-y-1">
                                <p className="text-[9px] font-black text-gray-400 uppercase">Receiving Vendor</p>
                                <select
                                  required
                                  value={alloc.vendorCode}
                                  onChange={(e) => handleUpdateAllocationRow(index, { vendorCode: e.target.value })}
                                  className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-800 rounded-md p-1.5 text-xs focus:ring-1 focus:ring-blue-400 focus:outline-none transition cursor-pointer text-gray-800 dark:text-gray-200"
                                >
                                  <option value="" disabled>-- Select Vendor --</option>
                                  {VENDOR_OPTIONS.map((v) => (
                                    <option key={v.code} value={v.code}>
                                      {v.displayText}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {/* Amount Input */}
                              <div className="w-28 space-y-1">
                                <p className="text-[9px] font-black text-gray-400 uppercase">Amount (¥)</p>
                                <div className="relative">
                                  <input
                                    type="number"
                                    required
                                    step="0.01"
                                    placeholder="0.00"
                                    value={alloc.amount || ''}
                                    onChange={(e) => handleUpdateAllocationRow(index, { amount: parseFloat(e.target.value) || 0 })}
                                    className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-800 rounded-md p-1.5 pl-4 text-xs text-right font-mono text-gray-800 dark:text-gray-200 focus:ring-1 focus:ring-blue-400 focus:outline-none"
                                  />
                                  <span className="absolute left-1.5 top-1.5 text-[9px] text-gray-400">¥</span>
                                </div>
                              </div>

                              {/* Inline Delete row */}
                              {allocations.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveAllocationRow(index)}
                                  className="p-1.5 border border-red-200 bg-red-55/10 hover:bg-red-100 text-red-650 rounded-md mt-4 transition cursor-pointer shrink-0 hover:scale-105"
                                  title="Delete allocation row"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}

                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Add row controller */}
                    <button
                      type="button"
                      onClick={handleAddAllocationRow}
                      className="w-full py-2 border border-dashed border-gray-300 dark:border-gray-800 text-gray-550 dark:text-gray-300 hover:text-blue-500 hover:border-blue-400 hover:bg-slate-50 dark:hover:bg-slate-805 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Additional Vendor Line</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ACTION RESET/SUBMIT BUTTON ROW */}
            <div className="flex gap-4 pt-4 border-t border-gray-300 dark:border-gray-800">
              <button
                type="button"
                id="reset-form-btn"
                onClick={() => {
                  setRmbAmount('');
                  setFxRate('');
                  setInrAmount('');
                  setReferenceNo('');
                  setIsAllocationManual(false);
                  setAllocations([]);
                  setErrorMessage(null);
                  setIsCrossVendor(false);
                }}
                className="px-4 py-3 border border-gray-300 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-850 text-xs font-bold rounded-lg transition active:scale-95 cursor-pointer text-center"
              >
                Clear Fields
              </button>
              <button
                type="submit"
                id="commit-payment-btn"
                className="flex-1 py-3 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold rounded-lg text-xs transition active:scale-95 text-center flex items-center justify-center gap-2 cursor-pointer shadow-md"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Verify & Commit Payment Log</span>
              </button>
            </div>
          </form>

        </div>
      )}

      {/* DETAILED MODAL CONFIRMATION DIALOG POPUP */}
      {showConfirmModal && (
        <div id="payment-confirm-modal" className="fixed inset-0 z-50 overflow-y-auto">
          {/* Backdrop container background */}
          <div 
            className="fixed inset-0 bg-gray-900/80 backdrop-blur-sm transition-opacity" 
            onClick={() => setShowConfirmModal(false)}
          />

          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <div className="relative transform overflow-hidden rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-left shadow-2xl transition-all sm:my-8 sm:w-full sm:max-w-lg scale-100 animate-slide-up">
              <div className="p-6 space-y-4">
                
                {/* Warning header */}
                <div className="flex items-center gap-3 border-b border-gray-300 dark:border-gray-800 pb-3">
                  <div className="p-2.5 bg-amber-50 dark:bg-amber-950/60 text-amber-500 rounded-full">
                    <AlertTriangle className="w-6 h-6 animate-bounce" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-gray-905 dark:text-white leading-tight">Permanent Ledger Authorization</h3>
                    <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">REMITTANCE CLEARING CONTROLS0</p>
                  </div>
                </div>

                {/* Explicit statement forced to read */}
                <div className="p-4 bg-red-50 dark:bg-slate-950 rounded-xl border border-red-200 dark:border-slate-800">
                  <p className="text-xs text-red-800 dark:text-red-400 font-bold leading-relaxed">
                    Warning: Once logged, this transactional payment information cannot be altered or modified in the ledger system. Do you want to proceed?
                  </p>
                </div>

                <div className="text-xs text-gray-500 leading-relaxed border-t border-gray-300 dark:border-gray-800 pt-3 space-y-1 text-[11px]">
                  <p>• Unique ID: <span className="font-mono font-bold text-gray-900 dark:text-white">{paymentId}</span></p>
                  <p>• Mapped File: <span className="font-mono text-gray-800 dark:text-gray-200 font-semibold uppercase">PaymentLogs Tab</span></p>
                </div>

                {/* Buttons block */}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(false)}
                    className="flex-1 py-2.5 border border-gray-300 dark:border-gray-800 text-gray-655 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 text-xs font-bold rounded-lg cursor-pointer transition text-center"
                  >
                    Cancel Reject
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmSubmission}
                    disabled={isSubmitting}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg cursor-pointer transition text-center flex items-center justify-center gap-1.5"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-gray-300/30 border-t-white rounded-full animate-spin" />
                        <span>Uploading...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Accept & Proceed</span>
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
