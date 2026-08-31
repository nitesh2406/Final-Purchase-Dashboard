import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeftIcon,
  MagnifyingGlassIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ShipIcon,
  AirplaneIcon,
  CheckIcon,
  XMarkIcon,
  BoxIcon,
  DocumentTextIcon,
  ArchiveBoxIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  BanknotesIcon
} from '../icons/Icons';
import { Batch, BatchVendorShipment } from '../../types';
import { callGasAuthed } from '../../services/gasApi';
import { Button } from '../ui/Button';

// Status Badge Component
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const getColor = (status: string) => {
    const colors: Record<string, string> = {
      'Shipped': 'dark:bg-purple-400/10 text-purple-600 dark:text-purple-400',
      'In-Transit China': 'dark:bg-blue-400/10 text-blue-600 dark:text-blue-400',
      'At Port China': 'dark:bg-cyan-400/10 text-cyan-600 dark:text-cyan-400',
      'In-Transit Ocean': 'dark:bg-blue-500/10 text-blue-600 dark:text-blue-500',
      'In-Transit Air': 'dark:bg-indigo-400/10 text-indigo-600 dark:text-indigo-400',
      'Customs Clearance': 'dark:bg-yellow-400/10 text-yellow-600 dark:text-yellow-400',
      'In-Transit India': 'dark:bg-green-400/10 text-green-600 dark:text-green-400',
      'Out for Delivery': 'dark:bg-emerald-400/10 text-emerald-600 dark:text-emerald-400',
      'Delivered': 'dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500',
      'OPEN': 'dark:bg-slate-400/10 text-slate-600 dark:text-slate-400',
    };
    return colors[status] || 'dark:bg-slate-400/10 text-slate-600 dark:text-slate-400';
  };
  return (
    <span className={`px-3 py-1.5 rounded-md text-sm font-medium border border-transparent bg-slate-200 dark:bg-transparent ${getColor(status)}`}>
      {status}
    </span>
  );
};

const PAYMENT_STATUS_BADGE: Record<string, string> = {
  'Paid': 'text-emerald-600 bg-emerald-100 dark:text-emerald-400 dark:bg-emerald-400/10',
  'Partial': 'text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-400/10',
  'Unpaid': 'text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-400/10',
};

const BATCH_STATUS_OPTIONS = [
  'Shipped', 'In-Transit China', 'At Port China', 'In-Transit Ocean', 'In-Transit Air',
  'Customs Clearance', 'In-Transit India', 'Out for Delivery', 'Delivered'
];

// Check Cell
const CheckCell: React.FC<{ value: boolean | null }> = ({ value }) => {
  if (value === null) return <span className="text-slate-600 text-sm">-</span>;
  return value
    ? <CheckIcon className="w-4 h-4 text-green-500 mx-auto" />
    : <XMarkIcon className="w-4 h-4 text-red-500 mx-auto" />;
};

// Vendor Shipment Row (Expandable)
const VendorShipmentRow: React.FC<{
  vendor: BatchVendorShipment;
  isExpanded: boolean;
  onToggle: () => void;
  isSearching: boolean;
  isAdmin: boolean;
  onSaveShipmentFinance: (shipmentId: string, data: { invoice_no: string; total_amount: number; currency: string; remarks: string }) => Promise<void>;
}> = ({ vendor, isExpanded, onToggle, isSearching, isAdmin, onSaveShipmentFinance }) => {
  const ChevronIcon = isExpanded ? ChevronDownIcon : ChevronRightIcon;
  const totalUnits = vendor.line_items.reduce((sum, item) => sum + (item.incoming_qty || 0), 0);
  const [isEditingFinance, setIsEditingFinance] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState({
    invoice_no: vendor.invoiceId || '',
    total_amount: vendor.total_amount || 0,
    currency: vendor.currency || 'RMB',
    remarks: vendor.remarks || ''
  });

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsSaving(true);
    try {
      await onSaveShipmentFinance(vendor.shipment_id, form);
      setIsEditingFinance(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="border-b border-slate-700 last:border-0">
      <button
        onClick={onToggle}
        className="w-full px-6 py-4 bg-slate-200 dark:bg-transparent border border-slate-200 dark:border-transparent hover:bg-slate-300 dark:hover:bg-slate-700/50 transition-all flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-4">
          <ChevronIcon className="w-5 h-5 text-slate-500 flex-shrink-0" />
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-bold text-base text-slate-900 dark:text-slate-100 uppercase tracking-tight">{vendor.vendor_code}</span>
              <span className="text-slate-400 dark:text-slate-600">|</span>
              <span className="text-base text-slate-900 dark:text-slate-300">{vendor.vendor_name}</span>
              <span className="text-slate-600">|</span>
              <span className="text-sm text-slate-500">Invoice: {vendor.invoiceId}</span>
              {isAdmin && vendor.payment_status && (
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${PAYMENT_STATUS_BADGE[vendor.payment_status]}`}>
                  {vendor.payment_status}
                </span>
              )}
            </div>
            <div className="text-sm text-slate-500 mt-1">
              {vendor.carton_count} cartons • {totalUnits} units
              {isSearching && <span className="text-blue-400 ml-2 font-medium">• {vendor.line_items.length} matching items</span>}
              {isAdmin && vendor.total_amount !== undefined && (
                <span className="ml-2">• {vendor.currency} {vendor.total_amount?.toLocaleString()}
                  {vendor.amount_inr != null ? ` (₹${vendor.amount_inr.toLocaleString()})` : ' (Rate N/A)'}
                </span>
              )}
            </div>
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={(e) => { e.stopPropagation(); setIsEditingFinance(!isEditingFinance); }}
            className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline shrink-0"
          >
            {isEditingFinance ? 'Cancel' : 'Edit Finance'}
          </button>
        )}
      </button>

      {isAdmin && isEditingFinance && (
        <div className="bg-slate-100 dark:bg-slate-900/70 px-6 py-4 border-t border-slate-300 dark:border-slate-700" onClick={e => e.stopPropagation()}>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">Invoice No</label>
              <input type="text" value={form.invoice_no} onChange={e => setForm({ ...form, invoice_no: e.target.value })}
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">Amount</label>
              <input type="number" value={form.total_amount} onChange={e => setForm({ ...form, total_amount: Number(e.target.value) })}
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">Currency</label>
              <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value as 'RMB' | 'USD' })}
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5 text-sm">
                <option value="RMB">RMB</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">Remarks</label>
              <input type="text" value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })}
                className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-2 py-1.5 text-sm" />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={handleSave} disabled={isSaving} className="text-xs py-1.5 px-4">
              {isSaving ? 'Saving...' : 'Save Shipment Finance'}
            </Button>
          </div>
        </div>
      )}

      {isExpanded && (
        <div className="bg-slate-100 dark:bg-slate-900/50 px-6 py-4 animate-in slide-in-from-top-2 duration-200">
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-slate-350 dark:border-slate-700">
                  {['SKU', 'Item Name', 'Incoming', 'Current Stock', 'Future Stock', 'Logo', 'Pkg', 'Manual', 'OPP'].map((label, i) => (
                    <th
                      key={label}
                      className={`py-3 px-3 text-xs font-bold text-slate-600 dark:text-slate-500 uppercase tracking-wider ${i < 2 ? 'text-left' : i > 4 ? 'text-center' : 'text-right'}`}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300 dark:divide-slate-800">
                {vendor.line_items.map(item => (
                  <tr key={item.line_id} className="hover:bg-slate-300/50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-3 font-mono text-xs font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">{item.sku}</td>
                    <td className="py-3 px-3 text-slate-800 dark:text-slate-300 whitespace-nowrap">{item.item_name}</td>
                    <td className="py-3 px-3 text-right font-bold text-slate-900 dark:text-white">{item.incoming_qty}</td>
                    <td className="py-3 px-3 text-right text-slate-700 dark:text-slate-400">{item.current_stock ?? '-'}</td>
                    <td className="py-3 px-3 text-right font-medium text-slate-900 dark:text-slate-100">{item.future_stock ?? '-'}</td>
                    <td className="py-3 px-3 text-center"><CheckCell value={item.has_logo} /></td>
                    <td className="py-3 px-3 text-center"><CheckCell value={item.has_packaging} /></td>
                    <td className="py-3 px-3 text-center"><CheckCell value={item.has_manual} /></td>
                    <td className="py-3 px-3 text-center"><CheckCell value={item.has_opp_wrap} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

interface BatchDetailProps {
  batchId: string;
  onBack: () => void;
  isAdmin?: boolean;
}

export const BatchDetail: React.FC<BatchDetailProps> = ({ batchId, onBack, isAdmin = false }) => {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [filteredVendors, setFilteredVendors] = useState<BatchVendorShipment[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Admin edit / payment history state
  const [isEditingBatch, setIsEditingBatch] = useState(false);
  const [isSavingBatch, setIsSavingBatch] = useState(false);
  const [batchForm, setBatchForm] = useState<any>(null);
  const [isPaymentHistoryExpanded, setIsPaymentHistoryExpanded] = useState(false);

  // Debug states
  const [showDebug, setShowDebug] = useState(false);
  const [lastRequest, setLastRequest] = useState<any>(null);
  const [lastResponse, setLastResponse] = useState<any>(null);
  const [lastTimestamp, setLastTimestamp] = useState<string | null>(null);

  const loadBatch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const payload = { action: 'get_batch_details', batch_id: batchId };
    setLastRequest(payload);
    setLastTimestamp(new Date().toLocaleTimeString());

    try {
      const result = await callGasAuthed('get_batch_details', { batch_id: batchId });
      setLastResponse(result);

      if (result.status === 'success') {
        setBatch(result.batch);
        setBatchForm({
          carrier: result.batch.carrier,
          tracking_number: result.batch.tracking_number,
          expected_delivery: result.batch.expected_delivery ? result.batch.expected_delivery.split('T')[0] : '',
          status: result.batch.status,
          notes: result.batch.notes,
          total_amount: result.batch.total_amount,
          total_currency: result.batch.total_currency || 'RMB'
        });
      } else {
        throw new Error(result.message || "Failed to load batch details");
      }
    } catch (err: any) {
      console.error("Batch Detail Load Error:", err);
      setError(err.message || "Network Failure");
    } finally {
      setIsLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    loadBatch();
  }, [loadBatch]);

  useEffect(() => {
    if (!batch?.vendor_shipments) {
      setFilteredVendors([]);
      return;
    }

    if (!searchTerm.trim()) {
      setFilteredVendors(batch.vendor_shipments);
      return;
    }

    const searchLower = searchTerm.toLowerCase();
    const filtered = batch.vendor_shipments
      .map(vendor => ({
        ...vendor,
        line_items: vendor.line_items.filter(item =>
          String(item.sku || '').toLowerCase().includes(searchLower) ||
          String(item.item_name || '').toLowerCase().includes(searchLower)
        )
      }))
      .filter(vendor => vendor.line_items.length > 0);

    setFilteredVendors(filtered);
    setExpandedVendors(new Set(filtered.map(v => v.shipment_id)));
  }, [batch, searchTerm]);

  const toggleVendor = (shipmentId: string) => {
    setExpandedVendors(prev => {
      const next = new Set(prev);
      if (next.has(shipmentId)) next.delete(shipmentId);
      else next.add(shipmentId);
      return next;
    });
  };

  const handleSaveBatch = async () => {
    setIsSavingBatch(true);
    const payload = { action: 'update_batch_tracking', batch_id: batchId, ...batchForm };
    setLastRequest(payload);
    try {
      const result = await callGasAuthed('update_batch_tracking', { batch_id: batchId, ...batchForm });
      setLastResponse(result);
      if (result.status === 'success') {
        setIsEditingBatch(false);
        loadBatch();
      } else {
        alert(result.message || 'Update failed');
      }
    } catch (err: any) {
      console.error('Update error:', err);
      alert('Network error updating batch');
    } finally {
      setIsSavingBatch(false);
    }
  };

  const handleSaveShipmentFinance = async (shipmentId: string, data: { invoice_no: string; total_amount: number; currency: string; remarks: string }) => {
    const payload = { action: 'update_shipment_finance', shipment_id: shipmentId, ...data };
    setLastRequest(payload);
    try {
      const result = await callGasAuthed('update_shipment_finance', { shipment_id: shipmentId, ...data });
      setLastResponse(result);
      if (result.status === 'success') {
        loadBatch();
      } else {
        alert(result.message || 'Update failed');
      }
    } catch (err: any) {
      console.error('Update error:', err);
      alert('Network error updating shipment finance');
    }
  };

  const handleCopyDebug = (data: any) => {
    if (data) navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'TBA';
    const d = new Date(dateString);
    return isNaN(d.getTime()) ? dateString : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const renderDebugPanel = () => (
    <div className="mt-12 pt-8 border-t border-slate-800/50">
      <button
        onClick={() => setShowDebug(!showDebug)}
        className="text-[10px] font-bold text-slate-400 hover:text-blue-500 uppercase tracking-widest transition-colors flex items-center gap-2 mb-4"
      >
        <ArrowPathIcon className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
        {showDebug ? 'Hide Network Info' : 'Show Network Debug'}
        {lastTimestamp && <span className="opacity-50 text-[9px] lowercase font-normal">at {lastTimestamp}</span>}
      </button>

      {showDebug && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-in slide-in-from-bottom-2 duration-200">
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-[9px] font-bold text-slate-500 uppercase">Last Request</span>
              <button onClick={() => handleCopyDebug(lastRequest)} className="text-[9px] text-blue-500 hover:underline">Copy</button>
            </div>
            <pre className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-lg text-[10px] font-mono text-slate-900 dark:text-slate-400 overflow-auto max-h-[300px]">
              {lastRequest ? JSON.stringify(lastRequest, null, 2) : '// No request recorded'}
            </pre>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-[9px] font-bold text-slate-500 uppercase">Last Response</span>
              <button onClick={() => handleCopyDebug(lastResponse)} className="text-[9px] text-blue-500 hover:underline">Copy</button>
            </div>
            <pre className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-lg text-[10px] font-mono text-slate-900 dark:text-slate-400 overflow-auto max-h-[300px]">
              {lastResponse ? JSON.stringify(lastResponse, null, 2) : '// No response recorded'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-24 p-6">

      {isLoading ? (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
          <ArrowPathIcon className="w-12 h-12 text-blue-500 animate-spin mb-4" />
          <p className="text-lg text-slate-300 font-medium">Loading batch details...</p>
          {renderDebugPanel()}
        </div>
      ) : error || !batch ? (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
          <div className="text-center bg-slate-800 p-12 rounded-2xl border border-slate-700 shadow-xl max-w-md">
            <ExclamationTriangleIcon className="w-16 h-16 mx-auto text-red-500 mb-4 opacity-70" />
            <h2 className="text-2xl font-bold text-white mb-2">{error ? 'Network Error' : 'Batch Not Found'}</h2>
            <p className="text-slate-400 mb-8">{error || 'The requested batch could not be found.'}</p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={onBack} className="flex-1">Back to List</Button>
              <Button onClick={loadBatch} className="flex-1 bg-blue-600">Retry</Button>
            </div>
          </div>
          {renderDebugPanel()}
        </div>
      ) : (
        <>
          {/* Top bar — back + batch ID + badges + search in one line */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <button
              onClick={onBack}
              className="group flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <ArrowLeftIcon className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" /> Back
            </button>
            <div className="flex items-center gap-3">
              <div className="p-1.5 rounded-lg bg-blue-500 dark:bg-slate-800 border border-transparent dark:border-slate-700">
                {batch.batch_type === 'sea'
                  ? <ShipIcon className="w-4 h-4 text-white dark:text-slate-400" />
                  : <AirplaneIcon className="w-4 h-4 text-white dark:text-slate-400" />
                }
              </div>
              <h1 className="text-xl font-bold text-slate-800 dark:text-white tracking-tight">{batch.batch_id}</h1>
            </div>
            <StatusBadge status={batch.status} />
            {batch.is_delayed && (
              <span className="px-2.5 py-1 bg-red-500/10 text-red-500 dark:text-red-400 text-[10px] font-black rounded uppercase tracking-tighter border border-red-500/20">
                Delayed {batch.delay_days}d
              </span>
            )}
            {isAdmin && (
              <>
                <span className="px-2 py-0.5 bg-red-500/20 text-red-500 border border-red-500/30 rounded text-[10px] font-bold uppercase tracking-widest">Admin</span>
                <Button variant="secondary" className="text-xs py-1.5 px-3" onClick={() => setIsEditingBatch(!isEditingBatch)}>
                  {isEditingBatch ? 'Cancel Edit' : 'Edit Batch'}
                </Button>
              </>
            )}
            <div className="ml-auto relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search SKU or item name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-8 py-1.5 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 w-60"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-white">
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Compact info strip */}
          <div className={`grid grid-cols-2 ${isAdmin ? 'md:grid-cols-4' : 'md:grid-cols-4'} border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden mb-6`}>
            <div className="px-5 py-4 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">Carrier & Tracking</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{batch.carrier || '—'}</p>
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-500 mt-0.5">{batch.tracking_number || 'No tracking #'}</p>
            </div>
            <div className="px-5 py-4 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">Expected Delivery</p>
              <p className={`text-sm font-semibold ${batch.is_delayed ? 'text-red-500 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
                {formatDate(batch.expected_delivery)}
              </p>
              {batch.actual_delivery
                ? <p className="text-[11px] text-green-500 mt-0.5">Delivered: {formatDate(batch.actual_delivery)}</p>
                : batch.is_delayed
                ? <p className="text-[11px] text-red-500 mt-0.5">{batch.delay_days}d overdue</p>
                : null
              }
            </div>
            <div className="px-5 py-4 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">Quantities</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{batch.total_units} units · {batch.total_cartons} cartons</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{batch.total_vendors} vendor{batch.total_vendors !== 1 ? 's' : ''}</p>
            </div>
            {isAdmin ? (
              <div className="px-5 py-4 bg-slate-50 dark:bg-slate-800/50">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">Total Amount</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{batch.total_currency} {batch.total_amount?.toLocaleString()}</p>
                <p className="text-[11px] mt-0.5">
                  {batch.amount_inr != null
                    ? <span className="text-blue-600 dark:text-blue-400 font-semibold">₹{batch.amount_inr.toLocaleString()}</span>
                    : <span className="text-amber-600 dark:text-amber-500">FX Rate N/A</span>}
                  {' · '}
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${PAYMENT_STATUS_BADGE[batch.payment_status || 'Unpaid']}`}>
                    {batch.payment_status || 'Unpaid'}
                  </span>
                </p>
              </div>
            ) : (
              <div className="px-5 py-4 bg-slate-50 dark:bg-slate-800/50">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-1">Mode</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {batch.batch_type === 'sea' ? '🚢 Sea Freight' : '✈️ Air Freight'}
                </p>
              </div>
            )}
          </div>

          {/* Admin batch edit panel */}
          {isAdmin && isEditingBatch && batchForm && (
            <div className="bg-white dark:bg-slate-800 border border-blue-500/50 rounded-xl p-6 mb-6 animate-in slide-in-from-top-4 duration-300">
              <h3 className="text-sm font-bold mb-4 text-slate-800 dark:text-white uppercase tracking-wide">Edit Batch Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Carrier</label>
                  <input type="text" value={batchForm.carrier} onChange={e => setBatchForm({ ...batchForm, carrier: e.target.value })}
                    className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tracking Number</label>
                  <input type="text" value={batchForm.tracking_number} onChange={e => setBatchForm({ ...batchForm, tracking_number: e.target.value })}
                    className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ETA</label>
                  <input type="date" value={batchForm.expected_delivery} onChange={e => setBatchForm({ ...batchForm, expected_delivery: e.target.value })}
                    className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</label>
                  <select value={batchForm.status} onChange={e => setBatchForm({ ...batchForm, status: e.target.value })}
                    className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm">
                    {BATCH_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Amount</label>
                  <input type="number" value={batchForm.total_amount} onChange={e => setBatchForm({ ...batchForm, total_amount: Number(e.target.value) })}
                    className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Currency</label>
                  <select value={batchForm.total_currency} onChange={e => setBatchForm({ ...batchForm, total_currency: e.target.value })}
                    className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm">
                    <option value="RMB">RMB</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Notes</label>
                  <input type="text" value={batchForm.notes} onChange={e => setBatchForm({ ...batchForm, notes: e.target.value })}
                    className="w-full mt-1 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm" placeholder="Internal notes..." />
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-3">
                <Button variant="secondary" onClick={() => setIsEditingBatch(false)}>Cancel</Button>
                <Button onClick={handleSaveBatch} disabled={isSavingBatch}>{isSavingBatch ? 'Saving...' : 'Save Batch Changes'}</Button>
              </div>
            </div>
          )}

          {/* Shipment contents */}
          <div className="bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-lg">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 flex items-center gap-2">
              <ArchiveBoxIcon className="w-4 h-4 text-blue-500 dark:text-slate-400" />
              <h2 className="text-sm font-bold text-blue-500 dark:text-slate-400 uppercase tracking-widest">
                Shipment Contents
              </h2>
              <span className="ml-2 text-xs text-slate-600 lowercase font-normal">
                ({filteredVendors.length} shipment{filteredVendors.length !== 1 ? 's' : ''} total)
              </span>
            </div>

            {filteredVendors.length === 0 ? (
              <div className="text-center py-20 px-6">
                <MagnifyingGlassIcon className="w-12 h-12 mx-auto text-slate-600 mb-4 opacity-30" />
                <p className="text-lg text-slate-300 font-bold mb-1 uppercase tracking-tight">No items found</p>
                <p className="text-sm text-slate-500">Try a different SKU code or item name</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-700">
                {filteredVendors.map(vendor => (
                  <VendorShipmentRow
                    key={vendor.shipment_id}
                    vendor={vendor}
                    isExpanded={expandedVendors.has(vendor.shipment_id)}
                    onToggle={() => toggleVendor(vendor.shipment_id)}
                    isSearching={searchTerm.trim().length > 0}
                    isAdmin={isAdmin}
                    onSaveShipmentFinance={handleSaveShipmentFinance}
                  />
                ))}
              </div>
            )}
          </div>

          {batch.notes && (
            <div className="mt-8 bg-slate-800/40 p-6 rounded-xl border border-slate-700/50">
              <div className="flex items-center gap-2 mb-3">
                <DocumentTextIcon className="w-5 h-5 text-slate-500" />
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Internal Batch Notes</h3>
              </div>
              <p className="text-slate-300 text-sm italic leading-relaxed border-l-2 border-slate-700 pl-4">"{batch.notes}"</p>
            </div>
          )}

          {isAdmin && (
            <div className="mt-8 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <button
                onClick={() => setIsPaymentHistoryExpanded(!isPaymentHistoryExpanded)}
                className="w-full p-4 flex justify-between items-center hover:bg-slate-100 dark:hover:bg-slate-700/30 transition-colors"
              >
                <h3 className="font-bold flex items-center gap-2 text-slate-800 dark:text-white text-sm">
                  <BanknotesIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  Payment History ({(batch.payments || []).length})
                </h3>
                {isPaymentHistoryExpanded ? <ChevronUpIcon className="w-4 h-4 text-slate-500" /> : <ChevronDownIcon className="w-4 h-4 text-slate-500" />}
              </button>
              {isPaymentHistoryExpanded && (
                <div className="border-t border-slate-300 dark:border-slate-700 overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-900/50 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-300 dark:border-slate-700">
                        <th className="px-6 py-3">Date</th>
                        <th className="px-6 py-3">Vendor</th>
                        <th className="px-6 py-3">Amount INR</th>
                        <th className="px-6 py-3">Amount Foreign</th>
                        <th className="px-6 py-3">Rate</th>
                        <th className="px-6 py-3">Reference</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                      {(batch.payments || []).length === 0 ? (
                        <tr><td colSpan={6} className="px-6 py-8 text-center text-slate-500">No payments logged for this batch yet.</td></tr>
                      ) : (batch.payments || []).map(p => (
                        <tr key={p.payment_id}>
                          <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{new Date(p.payment_date).toLocaleDateString()}</td>
                          <td className="px-6 py-3 font-bold text-slate-800 dark:text-slate-300">{p.vendor_id}</td>
                          <td className="px-6 py-3 font-bold text-emerald-600 dark:text-emerald-400">₹{p.amount_inr?.toLocaleString()}</td>
                          <td className="px-6 py-3 text-slate-800 dark:text-slate-300">{p.currency} {p.amount_foreign?.toLocaleString()}</td>
                          <td className="px-6 py-3 font-mono text-xs text-slate-500">{p.day_fx_rate}</td>
                          <td className="px-6 py-3 font-mono text-xs text-slate-500">{p.reference_no}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {renderDebugPanel()}
        </>
      )}
    </div>
  );
};
