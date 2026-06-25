import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  ArrowLeftIcon, 
  ArrowPathIcon, 
  ExclamationTriangleIcon, 
  ChevronDownIcon, 
  ChevronUpIcon,
  BanknotesIcon,
  TruckIcon,
  BoxIcon,
  ShipIcon,
  AirplaneIcon,
  CheckBadgeIcon,
  ClockIcon
} from '../icons/Icons';
import { BatchFinance, ShipmentFinanceData } from '../../types';
import { APPS_SCRIPT_URL } from '../../constants';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface ShipmentFinanceDetailProps {
  batchId: string;
  onBack: () => void;
}

type BatchStatusOption = 'Shipped' | 'In-Transit China' | 'At Port China' | 'In-Transit Ocean' | 'In-Transit Air' | 'Customs Clearance' | 'In-Transit India' | 'Out for Delivery' | 'Delivered';

export const ShipmentFinanceDetail: React.FC<ShipmentFinanceDetailProps> = ({ batchId, onBack }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [financeData, setFinanceData] = useState<{
    batch: BatchFinance | null;
    shipments: any[];
    payments: any[];
  }>({ batch: null, shipments: [], payments: [] });

  // UI State
  const [isEditingBatch, setIsEditingBatch] = useState(false);
  const [editingShipmentId, setEditingShipmentId] = useState<string | null>(null);
  const [isPaymentHistoryExpanded, setIsPaymentHistoryExpanded] = useState(false);
  const [isSavingBatch, setIsSavingBatch] = useState(false);
  const [savingShipmentId, setSavingShipmentId] = useState<string | null>(null);

  // Form States
  const [batchForm, setBatchForm] = useState<any>(null);
  const [shipmentForms, setShipmentForms] = useState<Record<string, any>>({});

  // Debug State
  const [showDebug, setShowDebug] = useState(false);
  const [lastRequest, setLastRequest] = useState<any>(null);
  const [lastResponse, setLastResponse] = useState<any>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const payload = { action: 'get_batch_finance_detail', batch_id: batchId };
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
        setFinanceData({
          batch: result.batch,
          shipments: result.shipments || [],
          payments: result.payments || []
        });
        
        // Initialize batch form
        if (result.batch) {
          setBatchForm({
            carrier: result.batch.carrier,
            tracking_number: result.batch.tracking_number,
            expected_delivery: result.batch.expected_delivery?.split('T')[0],
            status: result.batch.status,
            total_amount: result.batch.total_amount,
            total_currency: result.batch.total_currency,
            notes: result.batch.notes
          });
        }

        // Initialize shipment forms
        const sForms: Record<string, any> = {};
        (result.shipments || []).forEach((s: any) => {
          sForms[s.shipment_id] = {
            invoice_no: s.invoice_no,
            total_amount: s.total_amount,
            currency: s.currency,
            remarks: s.remarks
          };
        });
        setShipmentForms(sForms);

      } else {
        throw new Error(result.message || "Failed to load batch details");
      }
    } catch (err: any) {
      console.error("Fetch error:", err);
      setError(err.message || "Network error");
    } finally {
      setIsLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSaveBatch = async () => {
    setIsSavingBatch(true);
    const payload = { 
      action: 'update_batch_tracking', 
      batch_id: batchId,
      ...batchForm
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
        setIsEditingBatch(false);
        fetchData();
      } else {
        alert(result.message || "Update failed");
      }
    } catch (err) {
      console.error("Update error:", err);
      alert("Network error updating batch");
    } finally {
      setIsSavingBatch(false);
    }
  };

  const handleSaveShipment = async (shipmentId: string) => {
    setSavingShipmentId(shipmentId);
    const payload = { 
      action: 'update_shipment_finance', 
      shipment_id: shipmentId,
      ...shipmentForms[shipmentId]
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
        setEditingShipmentId(null);
        fetchData();
      } else {
        alert(result.message || "Update failed");
      }
    } catch (err) {
      console.error("Update error:", err);
      alert("Network error updating shipment");
    } finally {
      setSavingShipmentId(null);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'Shipped': 'text-purple-400 bg-purple-400/10',
      'In-Transit China': 'text-blue-400 bg-blue-400/10',
      'Customs Clearance': 'text-yellow-400 bg-yellow-400/10',
      'In-Transit India': 'text-green-400 bg-green-400/10',
      'Delivered': 'text-emerald-400 bg-emerald-400/10'
    };
    return colors[status] || 'text-slate-400 bg-slate-400/10';
  };

  const getPaymentStatusColor = (status: string) => {
    switch (status) {
      case 'Paid': return 'text-emerald-400 bg-emerald-400/10';
      case 'Partial': return 'text-amber-400 bg-amber-400/10';
      case 'Unpaid': return 'text-red-400 bg-red-400/10';
      default: return 'text-slate-400 bg-slate-400/10';
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Copied to clipboard!");
  };

  if (isLoading && !financeData.batch) {
    return (
      <div className="p-6 max-w-[1600px] mx-auto bg-slate-50 dark:bg-slate-900 min-h-screen text-slate-800 dark:text-slate-100 space-y-8 animate-pulse">
        <div className="h-8 bg-slate-800 rounded w-1/4" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-slate-800 rounded-xl" />)}
        </div>
        <div className="h-64 bg-slate-800 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-[1600px] mx-auto bg-slate-50 dark:bg-slate-900 min-h-screen text-slate-800 dark:text-slate-100">
        <div className="bg-red-500/10 border border-red-500/30 p-6 rounded-xl text-center">
          <ExclamationTriangleIcon className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Error Loading Details</h2>
          <p className="text-red-400 mb-6">{error}</p>
          <Button onClick={fetchData}>Retry Loading</Button>
        </div>
      </div>
    );
  }

  const { batch, shipments, payments } = financeData;
  if (!batch) return null;

  return (
    <div className="p-6 max-w-[1600px] mx-auto bg-slate-50 dark:bg-slate-900 min-h-screen text-slate-800 dark:text-slate-100 pb-24 space-y-8">
      {/* SECTION 1 — Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-2">
          <button 
            onClick={onBack}
            className="flex items-center gap-2 text-slate-400 hover:text-blue-400 transition-colors text-sm font-medium"
          >
            <ArrowLeftIcon className="w-4 h-4" /> Back to Shipment Finance
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{batch.batch_id}</h1>
            <span className={`px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider ${getStatusColor(batch.status)}`}>
              {batch.status}
            </span>
            <span className="px-2 py-0.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded text-[10px] font-bold uppercase tracking-widest">
              Admin
            </span>
          </div>
        </div>
        <div className="flex gap-3">
          <Button 
            variant="secondary" 
            onClick={() => setIsEditingBatch(!isEditingBatch)}
          >
            {isEditingBatch ? 'Cancel Edit' : 'Edit Batch'}
          </Button>
          <Button 
            variant="secondary" 
            onClick={fetchData}
            icon={<ArrowPathIcon className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* SECTION 2 — Batch Info Bar */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <TruckIcon className="w-5 h-5 text-blue-500 dark:text-blue-400" />
            </div>
            <span className="text-xs text-slate-550 dark:text-slate-400 font-bold uppercase tracking-wider">Carrier & Tracking</span>
          </div>
          <div className="text-lg font-bold text-slate-800 dark:text-white">{batch.carrier}</div>
          <div className="text-sm font-mono text-slate-500 dark:text-slate-400">{batch.tracking_number}</div>
        </Card>

        <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-yellow-500/10 rounded-lg">
              <ClockIcon className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
            </div>
            <span className="text-xs text-slate-550 dark:text-slate-400 font-bold uppercase tracking-wider">Expected Delivery</span>
          </div>
          <div className="text-lg font-bold text-slate-800 dark:text-white">
            {batch.expected_delivery ? new Date(batch.expected_delivery).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'TBA'}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">Shipped: {batch.shipped_at ? new Date(batch.shipped_at).toLocaleDateString() : 'N/A'}</div>
        </Card>

        <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <BanknotesIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <span className="text-xs text-slate-550 dark:text-slate-400 font-bold uppercase tracking-wider">Total Amount</span>
          </div>
          <div className="text-lg font-bold text-slate-800 dark:text-white">{batch.total_currency} {batch.total_amount?.toLocaleString()}</div>
          <div className="text-sm font-bold text-blue-600 dark:text-blue-400">
            {batch.amount_inr ? `₹${batch.amount_inr.toLocaleString()}` : (
              <span className="text-amber-600 dark:text-amber-500 flex items-center gap-1">
                <ExclamationTriangleIcon className="w-3 h-3" /> FX Rate N/A
              </span>
            )}
          </div>
        </Card>

        <Card className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <CheckBadgeIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <span className="text-xs text-slate-550 dark:text-slate-400 font-bold uppercase tracking-wider">Payment Status</span>
          </div>
          <div className="mt-1">
            <span className={`px-3 py-1 rounded-full text-sm font-bold uppercase tracking-wider ${getPaymentStatusColor(batch.payment_status)}`}>
              {batch.payment_status}
            </span>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            {batch.total_vendors} Vendors • {batch.total_shipments} Shipments
          </div>
        </Card>
      </div>

      {/* SECTION 3 — Batch Edit Panel */}
      {isEditingBatch && (
        <Card className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-blue-500/50 p-6 animate-in slide-in-from-top-4 duration-300">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2 text-slate-800 dark:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-blue-500 dark:text-blue-400" viewBox="0 0 20 20" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
            Edit Batch Details
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Carrier</label>
              <input 
                type="text" 
                value={batchForm.carrier}
                onChange={e => setBatchForm({...batchForm, carrier: e.target.value})}
                className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-600 outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tracking Number</label>
              <input 
                type="text" 
                value={batchForm.tracking_number}
                onChange={e => setBatchForm({...batchForm, tracking_number: e.target.value})}
                className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-600 outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ETA</label>
              <input 
                type="date" 
                value={batchForm.expected_delivery}
                onChange={e => setBatchForm({...batchForm, expected_delivery: e.target.value})}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Status</label>
              <select 
                value={batchForm.status}
                onChange={e => setBatchForm({...batchForm, status: e.target.value as BatchStatusOption})}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none"
              >
                <option value="Shipped">Shipped</option>
                <option value="In-Transit China">In-Transit China</option>
                <option value="At Port China">At Port China</option>
                <option value="In-Transit Ocean">In-Transit Ocean</option>
                <option value="In-Transit Air">In-Transit Air</option>
                <option value="Customs Clearance">Customs Clearance</option>
                <option value="In-Transit India">In-Transit India</option>
                <option value="Out for Delivery">Out for Delivery</option>
                <option value="Delivered">Delivered</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Amount</label>
              <input 
                type="number" 
                value={batchForm.total_amount}
                onChange={e => setBatchForm({...batchForm, total_amount: Number(e.target.value)})}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Currency</label>
              <select 
                value={batchForm.total_currency}
                onChange={e => setBatchForm({...batchForm, total_currency: e.target.value as 'RMB' | 'USD'})}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none"
              >
                <option value="RMB">RMB</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div className="md:col-span-2 space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Notes</label>
              <input 
                type="text" 
                value={batchForm.notes}
                onChange={e => setBatchForm({...batchForm, notes: e.target.value})}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-600 outline-none"
                placeholder="Internal notes..."
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setIsEditingBatch(false)}>Cancel</Button>
            <Button onClick={handleSaveBatch} disabled={isSavingBatch}>
              {isSavingBatch ? 'Saving...' : 'Save Batch Changes'}
            </Button>
          </div>
        </Card>
      )}

      {/* SECTION 4 — Shipments Table */}
      <Card className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-250 dark:border-slate-700 flex justify-between items-center">
          <h3 className="font-bold flex items-center gap-2 text-slate-850 dark:text-white">
            <BoxIcon className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            Vendor Shipments ({shipments.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-900/50 text-[10px] font-bold text-slate-600 dark:text-slate-500 uppercase tracking-widest border-b border-slate-250 dark:border-slate-700">
                <th className="px-6 py-4">Vendor</th>
                <th className="px-6 py-4">Invoice No</th>
                <th className="px-6 py-4">Invoice Date</th>
                <th className="px-6 py-4">Amount (Foreign)</th>
                <th className="px-6 py-4">INR Equiv</th>
                <th className="px-6 py-4">Payment Status</th>
                <th className="px-6 py-4">Paid (INR)</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300 dark:divide-slate-700/50">
              {shipments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                    No shipments found in this batch.
                  </td>
                </tr>
              ) : (
                shipments.map((s: any) => (
                  <React.Fragment key={s.shipment_id}>
                    <tr className={`hover:bg-slate-200/50 dark:hover:bg-slate-700/30 transition-colors ${editingShipmentId === s.shipment_id ? 'bg-blue-500/5' : ''}`}>
                      <td className="px-6 py-4 font-bold text-slate-800 dark:text-slate-300">{s.vendor_code}</td>
                      <td className="px-6 py-4 text-sm text-slate-750 dark:text-slate-400">{s.invoice_no}</td>
                      <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-500">
                        {s.invoice_date ? new Date(s.invoice_date).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="px-6 py-4 font-bold text-slate-900 dark:text-slate-200">
                        {s.currency} {s.total_amount?.toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        {s.amount_inr ? (
                          <span className="text-blue-600 dark:text-blue-400 font-bold">₹{s.amount_inr.toLocaleString()}</span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-500 text-xs font-bold flex items-center gap-1">
                            <ExclamationTriangleIcon className="w-3 h-3" /> Rate N/A
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${getPaymentStatusColor(s.payment_status)}`}>
                          {s.payment_status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-emerald-600 dark:text-emerald-400 font-bold">
                        ₹{s.paid_inr?.toLocaleString() || '0'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => setEditingShipmentId(editingShipmentId === s.shipment_id ? null : s.shipment_id)}
                          className="text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 text-xs font-bold"
                        >
                          {editingShipmentId === s.shipment_id ? 'Cancel' : 'Edit'}
                        </button>
                      </td>
                    </tr>
                    {editingShipmentId === s.shipment_id && (
                      <tr className="bg-slate-100 dark:bg-slate-900/50">
                        <td colSpan={8} className="px-6 py-6 border-b border-slate-300 dark:border-slate-700">
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Invoice No</label>
                              <input 
                                type="text" 
                                value={shipmentForms[s.shipment_id]?.invoice_no}
                                onChange={e => setShipmentForms({
                                  ...shipmentForms, 
                                  [s.shipment_id]: { ...shipmentForms[s.shipment_id], invoice_no: e.target.value }
                                })}
                                className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-850 dark:text-white outline-none focus:ring-2 focus:ring-blue-600_not_found"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Amount</label>
                              <input 
                                type="number" 
                                value={shipmentForms[s.shipment_id]?.total_amount}
                                onChange={e => setShipmentForms({
                                  ...shipmentForms, 
                                  [s.shipment_id]: { ...shipmentForms[s.shipment_id], total_amount: Number(e.target.value) }
                                })}
                                className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-850 dark:text-white outline-none focus:ring-2 focus:ring-blue-600"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Currency</label>
                              <select 
                                value={shipmentForms[s.shipment_id]?.currency}
                                onChange={e => setShipmentForms({
                                  ...shipmentForms, 
                                  [s.shipment_id]: { ...shipmentForms[s.shipment_id], currency: e.target.value }
                                })}
                                className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-850 dark:text-white outline-none focus:ring-2 focus:ring-blue-600"
                              >
                                <option value="RMB">RMB</option>
                                <option value="USD">USD</option>
                              </select>
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Remarks</label>
                              <input 
                                type="text" 
                                value={shipmentForms[s.shipment_id]?.remarks}
                                onChange={e => setShipmentForms({
                                  ...shipmentForms, 
                                  [s.shipment_id]: { ...shipmentForms[s.shipment_id], remarks: e.target.value }
                                })}
                                className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-850 dark:text-white outline-none focus:ring-2 focus:ring-blue-600"
                                placeholder="Financial remarks..."
                              />
                            </div>
                          </div>
                          <div className="mt-6 flex justify-end">
                            <Button 
                              onClick={() => handleSaveShipment(s.shipment_id)}
                              disabled={savingShipmentId === s.shipment_id}
                            >
                              {savingShipmentId === s.shipment_id ? 'Saving...' : 'Save Shipment Finance'}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* SECTION 5 — Payment History */}
      <Card className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 overflow-hidden">
        <button 
          onClick={() => setIsPaymentHistoryExpanded(!isPaymentHistoryExpanded)}
          className="w-full p-4 flex justify-between items-center hover:bg-slate-200/50 dark:hover:bg-slate-700/30 transition-colors"
        >
          <h3 className="font-bold flex items-center gap-2 text-slate-850 dark:text-white">
            <BanknotesIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            Payment History ({payments.length} payments)
          </h3>
          {isPaymentHistoryExpanded ? <ChevronUpIcon className="w-5 h-5 text-slate-500" /> : <ChevronDownIcon className="w-5 h-5 text-slate-500" />}
        </button>
        {isPaymentHistoryExpanded && (
          <div className="border-t border-slate-300 dark:border-slate-700 overflow-x-auto animate-in slide-in-from-top-2 duration-200">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-900/50 text-[10px] font-bold text-slate-600 dark:text-slate-500 uppercase tracking-widest border-b border-slate-300 dark:border-slate-700">
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Vendor</th>
                  <th className="px-6 py-4">Account Type</th>
                  <th className="px-6 py-4">Amount INR</th>
                  <th className="px-6 py-4">Amount Foreign</th>
                  <th className="px-6 py-4">Rate</th>
                  <th className="px-6 py-4">Reference</th>
                  <th className="px-6 py-4">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300 dark:divide-slate-700/50">
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-8 text-center text-slate-500">No payments logged for this batch yet.</td>
                  </tr>
                ) : (
                  <>
                    {payments.map((p: any) => (
                      <tr key={p.payment_id} className="hover:bg-slate-200/50 dark:hover:bg-slate-700/30 transition-colors">
                        <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">{new Date(p.payment_date).toLocaleDateString()}</td>
                        <td className="px-6 py-4 font-bold text-slate-800 dark:text-slate-300">{p.vendor_id}</td>
                        <td className="px-6 py-4 text-xs text-slate-600 dark:text-slate-500 uppercase font-bold">{p.account_type}</td>
                        <td className="px-6 py-4 font-bold text-emerald-600 dark:text-emerald-400">₹{p.amount_inr?.toLocaleString()}</td>
                        <td className="px-6 py-4 text-sm text-slate-800 dark:text-slate-300">{p.currency} {p.amount_foreign?.toLocaleString()}</td>
                        <td className="px-6 py-4 text-xs font-mono text-slate-600 dark:text-slate-500">{p.day_fx_rate}</td>
                        <td className="px-6 py-4 text-xs text-slate-600 dark:text-slate-500 font-mono">{p.reference_no}</td>
                        <td className="px-6 py-4 text-xs text-slate-600 dark:text-slate-500 italic">{p.notes}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-100 dark:bg-slate-900/80 font-bold border-t-2 border-slate-300 dark:border-slate-700">
                      <td colSpan={3} className="px-6 py-4 text-right text-slate-600 dark:text-slate-400 uppercase tracking-wider text-xs">Total Payments (INR)</td>
                      <td className="px-6 py-4 text-lg text-emerald-600 dark:text-emerald-400">
                        ₹{payments.reduce((sum: number, p: any) => sum + (p.amount_inr || 0), 0).toLocaleString()}
                      </td>
                      <td colSpan={4}></td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* SECTION 6 — FX Rate Info Box */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card className={`p-4 border ${batch.blended_rate ? 'bg-blue-500/5 border-blue-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
          <div className="flex items-start gap-4">
            <div className={`p-2 rounded-lg ${batch.blended_rate ? 'bg-blue-500/10' : 'bg-amber-500/10'}`}>
              <ExclamationTriangleIcon className={`w-5 h-5 ${batch.blended_rate ? 'text-blue-400' : 'text-amber-400'}`} />
            </div>
            <div>
              <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-1">FX Rate Information</h4>
              {batch.blended_rate ? (
                <div className="space-y-1">
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Rate Period: <span className="text-slate-800 dark:text-slate-200 font-bold">{batch.rate_period}</span>
                  </p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Blended Rate: <span className="text-blue-600 dark:text-blue-400 font-bold">₹{batch.blended_rate.toFixed(2)} / {batch.total_currency}</span>
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-500 uppercase font-bold tracking-wider mt-2">
                    Source: Calculated from payments in this period
                  </p>
                </div>
              ) : (
                <p className="text-sm text-amber-600 dark:text-amber-400/80">
                  No FX rate for this period yet. Log payments to auto-calculate the blended rate for this shipment month.
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Debug Panel */}
      <div className="mt-12 pt-8 border-t border-slate-250 dark:border-slate-800">
        <button 
          onClick={() => setShowDebug(!showDebug)}
          className="text-[10px] font-bold text-slate-500 hover:text-blue-500 uppercase tracking-widest transition-colors flex items-center gap-2"
        >
          <ArrowPathIcon className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          {showDebug ? 'Hide Network Info' : 'Show Network Debug'}
        </button>
        {showDebug && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4 animate-in slide-in-from-bottom-2 duration-200">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Last Request</span>
                <button 
                  onClick={() => copyToClipboard(JSON.stringify(lastRequest, null, 2))}
                  className="text-[9px] text-blue-500 hover:underline font-bold uppercase"
                >
                  Copy JSON
                </button>
              </div>
              <pre className="bg-slate-100 dark:bg-slate-900 border border-slate-350 dark:border-slate-800 p-4 rounded-lg text-[10px] font-mono text-slate-800 dark:text-slate-400 overflow-auto max-h-[400px]">
                {lastRequest ? JSON.stringify(lastRequest, null, 2) : '// No request recorded'}
              </pre>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Last Response</span>
                <button 
                  onClick={() => copyToClipboard(JSON.stringify(lastResponse, null, 2))}
                  className="text-[9px] text-blue-500 hover:underline font-bold uppercase"
                >
                  Copy JSON
                </button>
              </div>
              <pre className="bg-slate-100 dark:bg-slate-900 border border-slate-350 dark:border-slate-800 p-4 rounded-lg text-[10px] font-mono text-slate-800 dark:text-slate-400 overflow-auto max-h-[400px]">
                {lastResponse ? JSON.stringify(lastResponse, null, 2) : '// No response recorded'}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
