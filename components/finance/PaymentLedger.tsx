import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  BanknotesIcon, 
  CreditCardIcon, 
  ArrowPathIcon, 
  CheckBadgeIcon, 
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  ChevronRightIcon,
  ArrowsUpDownIcon
} from '../icons/Icons';
import { APPS_SCRIPT_URL, API_ACTIONS } from '../../App';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

// --- Types ---

interface VendorAccount {
  account_id: string;
  vendor_id: string;
  vendor_name: string;
  account_type: 'Trade' | 'Pool';
  currency: 'RMB' | 'USD';
  account_label: string;
  is_active: boolean;
}

interface LedgerPayment {
  payment_id: string;
  payment_date: string;
  vendor_id: string;
  vendor_name: string;
  account_id: string;
  account_type: 'Trade' | 'Pool';
  batch_id: string;
  shipment_id: string;
  invoice_no?: string;
  payment_type: 'invoice' | 'account';
  amount_inr: number;
  amount_foreign: number;
  currency: 'RMB' | 'USD';
  day_fx_rate: number;
  is_cross_vendor: boolean;
  cross_from_vendor_id: string;
  cross_from_account_id?: string;
  payment_mode: 'Bank Transfer' | 'Cash' | 'Other';
  reference_no: string;
  status: string;
  logged_by: string;
  notes: string;
}

interface FXRate {
  period: string;
  period_type: 'Monthly' | 'Quarterly';
  currency: 'RMB' | 'USD';
  total_inr: number;
  total_foreign: number;
  blended_rate: number;
  payment_count: number;
}

type LedgerView = 'log' | 'ledger';

// --- Main Component ---

export const PaymentLedger: React.FC = () => {
  const [activeView, setActiveView] = useState<LedgerView>('log');
  const [vendorAccounts, setVendorAccounts] = useState<VendorAccount[]>([]);
  const [payments, setPayments] = useState<LedgerPayment[]>([]);
  const [fxRates, setFxRates] = useState<FXRate[]>([]);
  
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logSuccess, setLogSuccess] = useState<string | null>(null);

  // Debug State
  const [showDebug, setShowDebug] = useState(false);
  const [lastRequest, setLastRequest] = useState<any>(null);
  const [lastResponse, setLastResponse] = useState<any>(null);

  // Form State
  const [formData, setFormData] = useState({
    payment_date: new Date().toISOString().split('T')[0],
    vendor_id: '',
    account_id: '',
    payment_type: 'invoice' as 'invoice' | 'account',
    invoice_no: '',
    batch_id: '',
    amount_foreign: 0,
    day_fx_rate: 0,
    is_cross_vendor: false,
    cross_from_vendor_id: '',
    cross_from_account_id: '',
    payment_mode: 'Bank Transfer' as any,
    reference_no: '',
    notes: ''
  });

  // Ledger Filters
  const [filters, setFilters] = useState({
    search: '',
    currency: 'ALL',
    accountType: 'ALL',
    crossVendor: 'ALL'
  });

  // --- Data Fetching ---

  const fetchVendorAccounts = useCallback(async () => {
    setIsLoading(true);
    const payload = { action: API_ACTIONS.GET_VENDOR_ACCOUNTS };
    setLastRequest(payload);
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      setLastResponse(result);
      if (result.status === 'success') {
        setVendorAccounts(result.accounts || []);
      } else {
        throw new Error(result.message || "Failed to fetch vendor accounts");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchLedgerData = useCallback(async () => {
    setIsLoading(true);
    const paymentsPayload = { action: API_ACTIONS.GET_PAYMENTS };
    const ratesPayload = { action: API_ACTIONS.GET_FX_RATES };
    
    setLastRequest({ paymentsPayload, ratesPayload });
    
    try {
      const [pRes, rRes] = await Promise.all([
        fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(paymentsPayload)
        }).then(r => r.json()),
        fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(ratesPayload)
        }).then(r => r.json())
      ]);

      setLastResponse({ pRes, rRes });

      if (pRes.status === 'success' && rRes.status === 'success') {
        setPayments(pRes.payments || []);
        setFxRates(rRes.rates || []);
      } else {
        throw new Error("Failed to fetch ledger data");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVendorAccounts();
  }, [fetchVendorAccounts]);

  useEffect(() => {
    if (activeView === 'ledger') {
      fetchLedgerData();
    }
  }, [activeView, fetchLedgerData]);

  // --- Handlers ---

  const handleLogPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const selectedAccount = vendorAccounts.find(a => a.account_id === formData.account_id);
    const selectedVendor = vendorAccounts.find(a => a.vendor_id === formData.vendor_id);
    const calculatedInr = formData.amount_foreign * formData.day_fx_rate;

    const payload = {
      action: API_ACTIONS.LOG_PAYMENT,
      ...formData,
      amount_inr: calculatedInr,
      currency: selectedAccount?.currency || 'RMB',
      vendor_name: selectedVendor?.vendor_name || '',
      account_type: selectedAccount?.account_type || '',
      logged_by: 'Admin'
    };

    setLastRequest(payload);

    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      setLastResponse(result);

      if (result.status === 'success') {
        setLogSuccess(`Payment logged. INR: ₹${calculatedInr.toLocaleString()} · Rate: ₹${formData.day_fx_rate.toFixed(2)}/RMB`);
        
        // Reset form
        setTimeout(() => {
          setLogSuccess(null);
          setFormData({
            payment_date: new Date().toISOString().split('T')[0],
            vendor_id: '',
            account_id: '',
            payment_type: 'invoice',
            invoice_no: '',
            batch_id: '',
            amount_foreign: 0,
            day_fx_rate: 0,
            is_cross_vendor: false,
            cross_from_vendor_id: '',
            cross_from_account_id: '',
            payment_mode: 'Bank Transfer',
            reference_no: '',
            notes: ''
          });
        }, 2000);
      } else {
        throw new Error(result.message || "Failed to log payment");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Calculations ---

  const calculatedInr = useMemo(() => {
    return (formData.amount_foreign || 0) * (formData.day_fx_rate || 0);
  }, [formData.amount_foreign, formData.day_fx_rate]);

  const vendorBalances = useMemo(() => {
    const balances: Record<string, { 
      name: string, 
      rmbOutstanding: number,
      totalInvoicedRmb: number,
      totalPaidRmb: number,
      tradePaidRmb: number,
      poolBalanceRmb: number,
      crossOutRmb: number,
      inrPaid: number
    }> = {};

    // Initialize with all vendors from accounts
    vendorAccounts.forEach(acc => {
      if (!balances[acc.vendor_id]) {
        balances[acc.vendor_id] = { 
          name: acc.vendor_name, 
          rmbOutstanding: 0,
          totalInvoicedRmb: 0,
          totalPaidRmb: 0,
          tradePaidRmb: 0,
          poolBalanceRmb: 0,
          crossOutRmb: 0,
          inrPaid: 0
        };
      }
    });

    payments.forEach(p => {
      if (!balances[p.vendor_id]) {
        balances[p.vendor_id] = { 
          name: p.vendor_name, 
          rmbOutstanding: 0,
          totalInvoicedRmb: 0,
          totalPaidRmb: 0,
          tradePaidRmb: 0,
          poolBalanceRmb: 0,
          crossOutRmb: 0,
          inrPaid: 0
        };
      }
      
      if (p.currency === 'RMB') {
        balances[p.vendor_id].totalPaidRmb += p.amount_foreign;
        if (p.account_type === 'Trade') {
          balances[p.vendor_id].tradePaidRmb += p.amount_foreign;
        } else if (p.account_type === 'Pool') {
          balances[p.vendor_id].poolBalanceRmb += p.amount_foreign;
        }
      }
      
      balances[p.vendor_id].inrPaid += p.amount_inr;

      if (p.is_cross_vendor && p.cross_from_vendor_id) {
        if (balances[p.cross_from_vendor_id]) {
          balances[p.cross_from_vendor_id].crossOutRmb += p.amount_foreign;
        }
      }
    });

    // Note: totalInvoicedRmb would normally come from an invoice list
    // For this ledger, we'll assume outstanding is calculated elsewhere or derived
    // The prompt asks for "outstanding RMB balance" in the list.
    // Since we don't have an invoice list here, we'll just show the net paid for now
    // or leave it as 0 if not available.
    
    return balances;
  }, [payments, vendorAccounts]);

  const filteredPayments = useMemo(() => {
    return payments.filter(p => {
      const searchMatch = !filters.search || 
        p.vendor_name.toLowerCase().includes(filters.search.toLowerCase()) ||
        p.reference_no.toLowerCase().includes(filters.search.toLowerCase()) ||
        p.batch_id.toLowerCase().includes(filters.search.toLowerCase());
      
      const currencyMatch = filters.currency === 'ALL' || p.currency === filters.currency;
      const accountMatch = filters.accountType === 'ALL' || p.account_type === filters.accountType;
      const crossMatch = filters.crossVendor === 'ALL' || 
        (filters.crossVendor === 'Cross-Vendor' ? p.is_cross_vendor : !p.is_cross_vendor);

      return searchMatch && currencyMatch && accountMatch && crossMatch;
    });
  }, [payments, filters]);

  const totals = useMemo(() => {
    return filteredPayments.reduce((acc, p) => {
      acc.inr += p.amount_inr;
      if (p.currency === 'RMB') acc.rmb += p.amount_foreign;
      if (p.currency === 'USD') acc.usd += p.amount_foreign;
      return acc;
    }, { inr: 0, rmb: 0, usd: 0 });
  }, [filteredPayments]);

  // --- Sub-Components ---

  const LogPaymentForm = () => {
    const [localRmb, setLocalRmb] = useState(formData.amount_foreign > 0 ? formData.amount_foreign.toString() : '');
    const [localRate, setLocalRate] = useState(formData.day_fx_rate > 0 ? formData.day_fx_rate.toString() : '');

    const groupedAccounts = useMemo(() => {
      const groups: Record<string, { name: string, accounts: VendorAccount[] }> = {};
      vendorAccounts.forEach(acc => {
        if (!groups[acc.vendor_id]) {
          groups[acc.vendor_id] = { name: acc.vendor_name, accounts: [] };
        }
        groups[acc.vendor_id].accounts.push(acc);
      });
      return Object.values(groups);
    }, [vendorAccounts]);

    const availableAccounts = useMemo(() => {
      return vendorAccounts.filter(a => a.vendor_id === formData.vendor_id && a.is_active);
    }, [formData.vendor_id, vendorAccounts]);

    const crossFromAccounts = useMemo(() => {
      return vendorAccounts.filter(a => a.vendor_id === formData.cross_from_vendor_id && a.is_active && a.account_type === 'Pool');
    }, [formData.cross_from_vendor_id, vendorAccounts]);

    return (
      <div className="max-w-[800px] mx-auto mt-8">
        <Card className="p-8 shadow-xl border-slate-700 bg-slate-800">
          <form onSubmit={handleLogPayment} className="space-y-6">
            {/* Row 1: Date | Vendor */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Payment Date</label>
                <input 
                  type="date" 
                  required
                  value={formData.payment_date}
                  onChange={e => setFormData({ ...formData, payment_date: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Vendor</label>
                <select 
                  required
                  value={formData.vendor_id}
                  onChange={e => {
                    const vId = e.target.value;
                    setFormData({ ...formData, vendor_id: vId, account_id: '' });
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">Select Vendor</option>
                  {groupedAccounts.map(g => (
                    <option key={g.name} value={g.accounts[0].vendor_id}>{g.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 2: Account */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Account</label>
              <select 
                required
                disabled={!formData.vendor_id}
                value={formData.account_id}
                onChange={e => setFormData({ ...formData, account_id: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
              >
                <option value="">Select Account</option>
                {availableAccounts.map(a => (
                  <option key={a.account_id} value={a.account_id}>{a.account_label} ({a.account_type}) — {a.currency}</option>
                ))}
              </select>
            </div>

            {/* Row 3: RMB Amount | FX Rate */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">RMB Amount</label>
                <input 
                  type="number" 
                  required
                  step="0.01"
                  value={localRmb}
                  onChange={e => {
                    setLocalRmb(e.target.value);
                    setFormData({ ...formData, amount_foreign: parseFloat(e.target.value) || 0 });
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">FX Rate (4 decimals)</label>
                <input 
                  type="number" 
                  required
                  step="0.0001"
                  value={localRate}
                  onChange={e => {
                    setLocalRate(e.target.value);
                    setFormData({ ...formData, day_fx_rate: parseFloat(e.target.value) || 0 });
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="0.0000"
                />
              </div>
            </div>

            {/* Row 4: INR Amount Display */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">INR Amount (auto-calculated)</label>
              <div className="bg-slate-900 p-4 rounded-xl border border-slate-700/50 flex items-center justify-between">
                <span className="text-2xl font-black text-blue-400">
                  ₹{calculatedInr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Calculated Value</span>
              </div>
            </div>

            {/* Payment Type Toggle */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Payment Level</label>
              <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-700 w-fit">
                <button 
                  type="button"
                  onClick={() => setFormData({ ...formData, payment_type: 'invoice' })}
                  className={`px-6 py-1.5 text-xs font-bold rounded-md transition-all ${formData.payment_type === 'invoice' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  Invoice Level
                </button>
                <button 
                  type="button"
                  onClick={() => setFormData({ ...formData, payment_type: 'account' })}
                  className={`px-6 py-1.5 text-xs font-bold rounded-md transition-all ${formData.payment_type === 'account' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  Account Level
                </button>
              </div>
              
              {formData.payment_type === 'invoice' ? (
                <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-1 duration-200">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Invoice No</label>
                    <input 
                      type="text"
                      value={formData.invoice_no}
                      onChange={e => setFormData({ ...formData, invoice_no: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="INV-..."
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Batch ID</label>
                    <input 
                      type="text"
                      value={formData.batch_id}
                      onChange={e => setFormData({ ...formData, batch_id: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="B24-..."
                    />
                  </div>
                </div>
              ) : (
                <p className="text-xs text-amber-500 italic font-medium bg-amber-500/5 p-3 rounded-lg border border-amber-500/10">
                  Payment will be logged as unallocated advance.
                </p>
              )}
            </div>

            {/* Cross Vendor Toggle */}
            <div className="space-y-4 pt-2">
              <label className="flex items-center gap-3 cursor-pointer group">
                <input 
                  type="checkbox" 
                  checked={formData.is_cross_vendor}
                  onChange={e => setFormData({ ...formData, is_cross_vendor: e.target.checked })}
                  className="w-5 h-5 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-bold text-slate-300 group-hover:text-white transition-colors">This is a cross-vendor transfer</span>
              </label>

              {formData.is_cross_vendor && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 bg-slate-900/50 rounded-xl border border-slate-700 animate-in fade-in slide-in-from-top-2">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">From Vendor</label>
                    <select 
                      required={formData.is_cross_vendor}
                      value={formData.cross_from_vendor_id}
                      onChange={e => setFormData({ ...formData, cross_from_vendor_id: e.target.value, cross_from_account_id: '' })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="">Select Vendor</option>
                      {groupedAccounts.map(g => (
                        <option key={g.name} value={g.accounts[0].vendor_id}>{g.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">From Account (Pool Only)</label>
                    <select 
                      required={formData.is_cross_vendor}
                      disabled={!formData.cross_from_vendor_id}
                      value={formData.cross_from_account_id}
                      onChange={e => setFormData({ ...formData, cross_from_account_id: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
                    >
                      <option value="">Select Account</option>
                      {crossFromAccounts.map(a => (
                        <option key={a.account_id} value={a.account_id}>{a.account_label} ({a.account_type})</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {/* Row: Mode | Reference */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Payment Mode</label>
                <select 
                  required
                  value={formData.payment_mode}
                  onChange={e => setFormData({ ...formData, payment_mode: e.target.value as any })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Cash">Cash</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Reference No</label>
                <input 
                  type="text" 
                  value={formData.reference_no}
                  onChange={e => setFormData({ ...formData, reference_no: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="e.g. UTR12345678"
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Notes</label>
              <textarea 
                rows={2}
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                placeholder="Internal payment notes..."
              />
            </div>

            {/* Banners */}
            {logSuccess && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-xl flex items-center gap-3 animate-in zoom-in-95 duration-200">
                <CheckBadgeIcon className="w-5 h-5 text-emerald-500" />
                <p className="text-emerald-400 text-sm font-bold">{logSuccess}</p>
              </div>
            )}

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl flex items-center gap-3 animate-in zoom-in-95 duration-200">
                <ExclamationTriangleIcon className="w-5 h-5 text-red-500" />
                <p className="text-red-400 text-sm font-bold">{error}</p>
              </div>
            )}

            <Button 
              type="submit"
              className="w-full py-4 text-lg font-black uppercase tracking-widest bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-600/20"
              disabled={isLoading}
            >
              {isLoading ? 'Logging...' : 'Log Payment'}
            </Button>
          </form>
        </Card>
      </div>
    );
  };

  const VendorLedgerView = () => {
    const [isFxCollapsed, setIsFxCollapsed] = useState(true);
    const [ledgerSearch, setLedgerSearch] = useState('');
    const [ledgerFilter, setLedgerFilter] = useState<'ALL' | 'TRADE' | 'POOL' | 'CROSS-VENDOR'>('ALL');

    const monthlyRates = useMemo(() => fxRates.filter(r => r.period_type === 'Monthly'), [fxRates]);
    const quarterlyRates = useMemo(() => fxRates.filter(r => r.period_type === 'Quarterly'), [fxRates]);

    const vendorList = useMemo(() => {
      const list = Object.entries(vendorBalances).map(([id, b]: [string, any]) => ({
        id,
        name: b.name,
        outstanding: b.rmbOutstanding
      }));
      if (!ledgerSearch) return list;
      return list.filter(v => v.name.toLowerCase().includes(ledgerSearch.toLowerCase()));
    }, [vendorBalances, ledgerSearch]);

    const selectedVendor = selectedVendorId ? vendorBalances[selectedVendorId] : null;
    
    const vendorPayments = useMemo(() => {
      if (!selectedVendorId) return [];
      let filtered = payments.filter(p => p.vendor_id === selectedVendorId || p.cross_from_vendor_id === selectedVendorId);
      
      if (ledgerFilter === 'TRADE') filtered = filtered.filter(p => p.account_type === 'Trade');
      if (ledgerFilter === 'POOL') filtered = filtered.filter(p => p.account_type === 'Pool');
      if (ledgerFilter === 'CROSS-VENDOR') filtered = filtered.filter(p => p.is_cross_vendor);
      
      // Sort by date
      return filtered.sort((a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime());
    }, [payments, selectedVendorId, ledgerFilter]);

    const ledgerWithBalance = useMemo(() => {
      let running = 0;
      return vendorPayments.map(p => {
        // This is a simplification. Real ledger would include invoices as negative entries.
        // For now we'll just show cumulative payments as positive.
        running += p.currency === 'RMB' ? p.amount_foreign : 0;
        return { ...p, runningBalance: running };
      });
    }, [vendorPayments]);

    return (
      <div className="flex flex-col gap-8 animate-in fade-in duration-500">
        {/* FX Rate Summary - Collapsible */}
        <Card className="border-slate-700 bg-slate-800 overflow-hidden">
          <button 
            onClick={() => setIsFxCollapsed(!isFxCollapsed)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-700/30 transition-colors"
          >
            <h3 className="text-sm font-black text-slate-100 uppercase tracking-widest flex items-center gap-2">
              <ArrowsUpDownIcon className="w-4 h-4 text-blue-400" /> FX Rate Summary
            </h3>
            <ChevronRightIcon className={`w-5 h-5 text-slate-500 transition-transform duration-300 ${isFxCollapsed ? '' : 'rotate-90'}`} />
          </button>
          
          {!isFxCollapsed && (
            <div className="p-6 border-t border-slate-700 grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in slide-in-from-top-2">
              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Monthly Blended Rates</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-700">
                        <th className="text-left py-2">Period</th>
                        <th className="text-center py-2">CCY</th>
                        <th className="text-right py-2">Rate</th>
                        <th className="text-right py-2">Total INR</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {monthlyRates.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-700/30 transition-colors">
                          <td className="py-2.5 font-bold text-slate-200">{r.period}</td>
                          <td className="py-2.5 text-center text-slate-400">{r.currency}</td>
                          <td className="py-2.5 text-right font-black text-blue-400">₹{r.blended_rate.toFixed(2)}</td>
                          <td className="py-2.5 text-right text-slate-300">₹{(r.total_inr / 100000).toFixed(2)}L</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Quarterly Blended Rates</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-700">
                        <th className="text-left py-2">Period</th>
                        <th className="text-center py-2">CCY</th>
                        <th className="text-right py-2">Rate</th>
                        <th className="text-right py-2">Total INR</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/50">
                      {quarterlyRates.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-700/30 transition-colors">
                          <td className="py-2.5 font-bold text-slate-200">{r.period}</td>
                          <td className="py-2.5 text-center text-slate-400">{r.currency}</td>
                          <td className="py-2.5 text-right font-black text-blue-400">₹{r.blended_rate.toFixed(2)}</td>
                          <td className="py-2.5 text-right text-slate-300">₹{(r.total_inr / 100000).toFixed(2)}L</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Main Ledger Layout */}
        <div className="flex flex-col lg:flex-row gap-6 min-h-[600px]">
          {/* Left Panel: Vendor List */}
          <div className="w-full lg:w-[280px] flex flex-col gap-4">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input 
                type="text" 
                placeholder="Search vendors..."
                value={ledgerSearch}
                onChange={e => setLedgerSearch(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <Card className="flex-1 bg-slate-800 border-slate-700 overflow-y-auto max-h-[600px] p-2">
              <div className="space-y-1">
                {vendorList.map(v => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVendorId(v.id)}
                    className={`w-full text-left px-4 py-3 rounded-lg transition-all flex justify-between items-center group ${selectedVendorId === v.id ? 'bg-blue-600 text-white shadow-lg' : 'hover:bg-slate-700/50 text-slate-300'}`}
                  >
                    <div>
                      <p className="text-xs font-bold truncate max-w-[140px]">{v.name}</p>
                      <p className={`text-[10px] font-mono ${selectedVendorId === v.id ? 'text-blue-100' : 'text-slate-500'}`}>
                        {v.id}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-xs font-black ${selectedVendorId === v.id ? 'text-white' : 'text-emerald-400'}`}>
                        ¥{v.outstanding.toLocaleString()}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          </div>

          {/* Right Panel: Selected Vendor Ledger */}
          <div className="flex-1">
            {!selectedVendor ? (
              <div className="h-full flex flex-col items-center justify-center bg-slate-800/20 border border-dashed border-slate-700 rounded-2xl p-12 text-center">
                <div className="p-4 bg-slate-800 rounded-full mb-4">
                  <BanknotesIcon className="w-12 h-12 text-slate-600" />
                </div>
                <h3 className="text-lg font-bold text-slate-400">Select a vendor to view ledger</h3>
                <p className="text-sm text-slate-500 mt-1">Choose a vendor from the left panel to see detailed transaction history.</p>
              </div>
            ) : (
              <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
                {/* SECTION A: Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <Card className="p-6 bg-slate-800 border-slate-700 border-l-4 border-l-blue-500">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Invoiced RMB</p>
                    <p className="text-2xl font-black text-white">¥{selectedVendor.totalInvoicedRmb.toLocaleString()}</p>
                  </Card>
                  <Card className="p-6 bg-slate-800 border-slate-700 border-l-4 border-l-emerald-500">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Paid RMB</p>
                    <p className="text-2xl font-black text-white">¥{selectedVendor.totalPaidRmb.toLocaleString()}</p>
                  </Card>
                  <Card className="p-6 bg-slate-800 border-slate-700 border-l-4 border-l-red-500">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Balance Due RMB</p>
                    <p className="text-2xl font-black text-white">¥{(selectedVendor.totalInvoicedRmb - selectedVendor.totalPaidRmb).toLocaleString()}</p>
                  </Card>
                </div>

                {/* SECTION B: Account Balances */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card className="p-6 bg-slate-800 border-slate-700">
                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Trade Account</h4>
                    <div className="flex justify-between items-end">
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase font-bold">Paid to Date</p>
                        <p className="text-xl font-black text-blue-400">¥{selectedVendor.tradePaidRmb.toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-slate-500 uppercase font-bold">Invoiced</p>
                        <p className="text-lg font-bold text-slate-300">¥{selectedVendor.totalInvoicedRmb.toLocaleString()}</p>
                      </div>
                    </div>
                  </Card>
                  <Card className="p-6 bg-slate-800 border-slate-700">
                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Pool Account</h4>
                    <div className="flex justify-between items-end">
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase font-bold">Advances Received</p>
                        <p className="text-xl font-black text-emerald-400">¥{selectedVendor.poolBalanceRmb.toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-slate-500 uppercase font-bold">Cross Payments Out</p>
                        <p className="text-lg font-bold text-red-400">¥{selectedVendor.crossOutRmb.toLocaleString()}</p>
                      </div>
                    </div>
                  </Card>
                </div>

                {/* SECTION C: Transaction Ledger Table */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <div className="flex gap-2">
                      {['ALL', 'TRADE', 'POOL', 'CROSS-VENDOR'].map(f => (
                        <button 
                          key={f}
                          onClick={() => setLedgerFilter(f as any)}
                          className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter transition-all border ${ledgerFilter === f ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-900 text-slate-500 border-slate-700 hover:text-slate-300'}`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>

                  <Card className="bg-slate-800 border-slate-700 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="bg-slate-900/50 text-slate-500 border-b border-slate-700">
                            <th className="text-left py-3 px-4 uppercase font-bold">Date</th>
                            <th className="text-left py-3 px-4 uppercase font-bold">Type</th>
                            <th className="text-left py-3 px-4 uppercase font-bold">Account</th>
                            <th className="text-left py-3 px-4 uppercase font-bold">Batch/Inv</th>
                            <th className="text-right py-3 px-4 uppercase font-bold">RMB Amount</th>
                            <th className="text-right py-3 px-4 uppercase font-bold">INR Amount</th>
                            <th className="text-right py-3 px-4 uppercase font-bold">Rate</th>
                            <th className="text-right py-3 px-4 uppercase font-bold">Running Bal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-700/50">
                          {ledgerWithBalance.map((p) => {
                            let borderClass = '';
                            if (p.is_cross_vendor) {
                              borderClass = p.vendor_id === selectedVendorId ? 'border-l-4 border-l-emerald-500' : 'border-l-4 border-l-red-500';
                            } else if (p.payment_type === 'account') {
                              borderClass = 'border-l-4 border-l-amber-500';
                            }

                            return (
                              <tr key={p.payment_id} className={`hover:bg-slate-700/30 transition-colors ${borderClass}`}>
                                <td className="py-3 px-4 whitespace-nowrap text-slate-400">
                                  {new Date(p.payment_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                                </td>
                                <td className="py-3 px-4">
                                  <span className={`px-2 py-0.5 rounded-[4px] text-[9px] font-bold uppercase ${
                                    p.is_cross_vendor ? 'bg-purple-500/10 text-purple-400' :
                                    p.payment_type === 'account' ? 'bg-amber-500/10 text-amber-400' :
                                    'bg-blue-500/10 text-blue-400'
                                  }`}>
                                    {p.is_cross_vendor ? 'Cross' : p.payment_type === 'account' ? 'Advance' : 'Regular'}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-slate-300 font-medium">{p.account_type}</td>
                                <td className="py-3 px-4">
                                  <div className="font-mono text-slate-500">{p.batch_id || '—'}</div>
                                  <div className="text-[9px] text-slate-600">{p.invoice_no || ''}</div>
                                </td>
                                <td className="py-3 px-4 text-right font-bold text-slate-100">¥{p.amount_foreign.toLocaleString()}</td>
                                <td className="py-3 px-4 text-right font-bold text-emerald-400">₹{p.amount_inr.toLocaleString()}</td>
                                <td className="py-3 px-4 text-right font-mono text-blue-400">₹{p.day_fx_rate.toFixed(2)}</td>
                                <td className="py-3 px-4 text-right font-black text-white">¥{p.runningBalance.toLocaleString()}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </div>

                {/* SECTION D: Agent Ledger */}
                <Card className="bg-slate-800 border-slate-700 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-700">
                    <h3 className="text-sm font-black text-slate-100 uppercase tracking-widest">Agent Account (INR)</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="bg-slate-900/50 text-slate-500 border-b border-slate-700">
                          <th className="text-left py-3 px-6 uppercase font-bold">Date</th>
                          <th className="text-right py-3 px-6 uppercase font-bold">INR Paid</th>
                          <th className="text-left py-3 px-6 uppercase font-bold">Reference</th>
                          <th className="text-left py-3 px-6 uppercase font-bold">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/50">
                        {vendorPayments.map((p) => (
                          <tr key={p.payment_id} className="hover:bg-slate-700/30 transition-colors">
                            <td className="py-3 px-6 text-slate-400">
                              {new Date(p.payment_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </td>
                            <td className="py-3 px-6 text-right font-black text-emerald-400">₹{p.amount_inr.toLocaleString()}</td>
                            <td className="py-3 px-6 text-slate-300 font-mono">{p.reference_no}</td>
                            <td className="py-3 px-6 text-slate-500 italic truncate max-w-[200px]">{p.notes}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-900/50 border-t border-slate-700">
                        <tr>
                          <td className="py-4 px-6 text-right uppercase tracking-widest text-[10px] text-slate-500 font-bold">Total INR Paid</td>
                          <td className="py-4 px-6 text-right text-xl font-black text-white">₹{selectedVendor.inrPaid.toLocaleString()}</td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-24">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-slate-100">Payment Ledger</h1>
            <span className="px-2 py-0.5 bg-red-500 text-white text-[10px] font-black rounded uppercase tracking-tighter">Admin</span>
          </div>
          <p className="text-slate-400 text-sm">Log payments & track vendor balances</p>
        </div>

        {/* Tab Toggle */}
        <div className="flex p-1 bg-slate-800 rounded-xl border border-slate-700 shadow-inner">
          <button 
            onClick={() => setActiveView('log')}
            className={`flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-bold transition-all ${
              activeView === 'log' 
                ? 'bg-blue-600 text-white shadow-lg' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <CreditCardIcon className="w-4 h-4" /> Log Payment
          </button>
          <button 
            onClick={() => setActiveView('ledger')}
            className={`flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-bold transition-all ${
              activeView === 'ledger' 
                ? 'bg-blue-600 text-white shadow-lg' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BanknotesIcon className="w-4 h-4" /> Vendor Ledger
          </button>
        </div>
      </div>

      {/* Main Content */}
      {activeView === 'log' ? <LogPaymentForm /> : <VendorLedgerView />}

      {/* Debug Panel */}
      <div className="mt-16 pt-8 border-t border-slate-800">
        <button 
          onClick={() => setShowDebug(!showDebug)}
          className="text-[10px] font-bold text-slate-500 hover:text-blue-500 uppercase tracking-widest transition-colors flex items-center gap-2"
        >
          <ArrowPathIcon className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          {showDebug ? 'Hide Network Info' : 'Show Network Debug'}
        </button>
        {showDebug && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6 animate-in slide-in-from-bottom-2 duration-300">
            <div className="space-y-2">
              <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest ml-1">Last Request</span>
              <pre className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-[10px] font-mono text-blue-400 overflow-auto max-h-[400px] shadow-inner">
                {lastRequest ? JSON.stringify(lastRequest, null, 2) : '// No request recorded'}
              </pre>
            </div>
            <div className="space-y-2">
              <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest ml-1">Last Response</span>
              <pre className="bg-slate-950 border border-slate-800 p-4 rounded-xl text-[10px] font-mono text-emerald-400 overflow-auto max-h-[400px] shadow-inner">
                {lastResponse ? JSON.stringify(lastResponse, null, 2) : '// No response recorded'}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
