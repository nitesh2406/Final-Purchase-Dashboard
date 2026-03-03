import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  DocumentTextIcon, 
  ExclamationTriangleIcon, 
  BanknotesIcon, 
  ArrowPathIcon, 
  PlusCircleIcon, 
  XMarkIcon,
  MagnifyingGlassIcon,
  ShipIcon,
  AirplaneIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CheckBadgeIcon,
  EyeIcon,
  PencilSquareIcon,
  CheckIcon
} from '../icons/Icons';
import { APPS_SCRIPT_URL, API_ACTIONS } from '../../App';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

// --- Types ---

type AccountsTab = 'costing' | 'invoices';

interface ShipmentCosting {
  shipment_id: string;
  batch_id: string;
  vendor_code: string;
  qty: number;
  cartons: number;
  invoice_amt: number;
  currency: string;
  mode: string;
  status: string;
  edd: string;
  carrier: string;
  waybill: string;
  fx_rate: number;
  charges_pct: number;
  other_charges: number;
  local_freight: number;
  clearance: number;
  freight_charges: number;
  shipping_charges: number;
  igst: number;
  billed_amount: number;
  bill_no: string;
  payment_status: string;
  payment_date: string;
  remarks: string;
  goods_value: number;
  charges: number;
  taxable_amount: number;
  total_after_tax: number;
  final_total: number;
}

interface AgentInvoice {
  invoice_id: string;
  invoice_no: string;
  invoice_date: string;
  received_date: string;
  total_amount_inr: number;
  principal_amt: number;
  commission_amt: number;
  freight_amt: number;
  gst_amt: number;
  status: 'Received' | 'Partially Allocated' | 'Fully Allocated';
  notes: string;
  allocated_inr: number;
  unallocated_inr: number;
  allocation_count: number;
  allocation_pct: number;
}

interface BatchFinance {
  batch_id: string;
  mode: 'Ocean' | 'Air';
  status: string;
  carrier: string;
  total_amount: number;
  total_currency: 'RMB' | 'USD';
  amount_inr: number | null;
  blended_rate: number | null;
  payment_status: 'Unpaid' | 'Partial' | 'Paid';
  allocation_count: number;
}

interface AccountsViewProps {
  onNavigateToDetail?: (batchId: string) => void;
}

// --- Main Component ---

export const AccountsView: React.FC<AccountsViewProps> = ({ onNavigateToDetail }) => {
  const [activeTab, setActiveTab] = useState<AccountsTab>('costing');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data State
  const [costingData, setCostingData] = useState<ShipmentCosting[]>([]);
  const [invoices, setInvoices] = useState<AgentInvoice[]>([]);
  const [batches, setBatches] = useState<BatchFinance[]>([]);

  // Debug State
  const [showDebug, setShowDebug] = useState(false);
  const [lastRequest, setLastRequest] = useState<any>(null);
  const [lastResponse, setLastResponse] = useState<any>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [costingRes, invoicesRes, batchesRes] = await Promise.all([
        fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'get_shipment_costing' })
        }).then(res => res.json()),
        fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'get_agent_invoices' })
        }).then(res => res.json()),
        fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'get_batches_finance' })
        }).then(res => res.json())
      ]);

      if (costingRes.status === 'success') setCostingData(costingRes.shipments || []);
      if (invoicesRes.status === 'success') setInvoices(invoicesRes.invoices || []);
      if (batchesRes.status === 'success') setBatches(batchesRes.batches || []);
      
      setLastResponse({ costing: costingRes, invoices: invoicesRes, batches: batchesRes });
    } catch (err: any) {
      setError(err.message || "Failed to fetch data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'sync_shipment_costing' })
      }).then(res => res.json());
      if (res.status === 'success') fetchData();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="p-6 max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-24 text-slate-200">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 mb-1">Accounts View</h1>
          <p className="text-slate-400 text-sm">Shipment costing & agent invoice management</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
            <button 
              onClick={() => setActiveTab('costing')}
              className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'costing' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Shipment Costing
            </button>
            <button 
              onClick={() => setActiveTab('invoices')}
              className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'invoices' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Agent Invoices
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={fetchData}
              className="p-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-400 hover:text-white transition-colors"
              title="Refresh Data"
            >
              <ArrowPathIcon className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <Button 
              onClick={handleSync} 
              disabled={isSyncing}
              className="flex items-center gap-2"
            >
              {isSyncing ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <ArrowPathIcon className="w-4 h-4" />}
              Sync Shipments
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 p-4 rounded-xl text-red-400 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ExclamationTriangleIcon className="w-5 h-5" />
            <p>{error}</p>
          </div>
          <Button size="sm" onClick={fetchData}>Retry</Button>
        </div>
      )}

      {activeTab === 'costing' ? (
        <ShipmentCostingView 
          data={costingData} 
          isLoading={isLoading} 
          onUpdate={fetchData}
          setLastRequest={setLastRequest}
          setLastResponse={setLastResponse}
        />
      ) : (
        <AgentInvoicesView 
          invoices={invoices} 
          batches={batches}
          isLoading={isLoading}
          onRefresh={fetchData}
          setLastRequest={setLastRequest}
          setLastResponse={setLastResponse}
        />
      )}

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

// --- Sub-View 1: Shipment Costing ---

const ShipmentCostingView: React.FC<{ 
  data: ShipmentCosting[], 
  isLoading: boolean, 
  onUpdate: () => void,
  setLastRequest: (req: any) => void,
  setLastResponse: (res: any) => void
}> = ({ data, isLoading, onUpdate, setLastRequest, setLastResponse }) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'PENDING COSTING' | 'COSTED' | 'PAID' | 'UNPAID'>('ALL');
  const [batchFilter, setBatchFilter] = useState('ALL');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ShipmentCosting>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [collapsedBatches, setCollapsedBatches] = useState<Set<string>>(new Set());

  const uniqueBatches = useMemo(() => Array.from(new Set(data.map(d => d.batch_id))), [data]);

  const filteredData = useMemo(() => {
    return data.filter(d => {
      const matchesSearch = d.shipment_id.toLowerCase().includes(search.toLowerCase()) ||
                            d.vendor_code.toLowerCase().includes(search.toLowerCase()) ||
                            (d.bill_no || '').toLowerCase().includes(search.toLowerCase());
      const matchesBatch = batchFilter === 'ALL' || d.batch_id === batchFilter;
      const matchesFilter = filter === 'ALL' ||
                            (filter === 'PENDING COSTING' && (!d.fx_rate || d.fx_rate === 0)) ||
                            (filter === 'COSTED' && d.fx_rate > 0) ||
                            (filter === 'PAID' && d.payment_status === 'Paid') ||
                            (filter === 'UNPAID' && d.payment_status === 'Unpaid');
      return matchesSearch && matchesBatch && matchesFilter;
    });
  }, [data, search, filter, batchFilter]);

  const groupedData = useMemo(() => {
    const groups: Record<string, ShipmentCosting[]> = {};
    filteredData.forEach(d => {
      if (!groups[d.batch_id]) groups[d.batch_id] = [];
      groups[d.batch_id].push(d);
    });
    return groups;
  }, [filteredData]);

  // Summary Metrics
  const metrics = useMemo(() => {
    const total = data.length;
    const pending = data.filter(d => !d.fx_rate || d.fx_rate === 0).length;
    const totalFinal = data.reduce((s, d) => s + (d.final_total || 0), 0);
    const totalBilled = data.reduce((s, d) => s + (d.billed_amount || 0), 0);
    return { total, pending, totalFinal, totalBilled };
  }, [data]);

  const handleEdit = (shipment: ShipmentCosting) => {
    setEditingId(shipment.shipment_id);
    setEditForm({ ...shipment });
  };

  const handleSave = async (shipmentId: string) => {
    setIsSaving(true);
    const payload = { action: 'update_shipment_costing', shipment_id: shipmentId, ...editForm };
    setLastRequest(payload);
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      }).then(res => res.json());
      setLastResponse(res);
      if (res.status === 'success') {
        setEditingId(null);
        onUpdate();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleBatch = (batchId: string) => {
    const next = new Set(collapsedBatches);
    if (next.has(batchId)) next.delete(batchId);
    else next.add(batchId);
    setCollapsedBatches(next);
  };

  // Live Calculation
  const calculatedValues = useMemo(() => {
    if (!editingId || !editForm) return null;
    const f = editForm as ShipmentCosting;
    const goods_value = (f.invoice_amt || 0) * (f.fx_rate || 0);
    const charges = goods_value * ((f.charges_pct || 0) / 100);
    const taxable_amount = goods_value + charges + (f.freight_charges || 0) + (f.clearance || 0) + (f.local_freight || 0) + (f.shipping_charges || 0) + (f.other_charges || 0);
    const total_after_tax = taxable_amount + (f.igst || 0);
    const final_total = total_after_tax;
    return { goods_value, final_total };
  }, [editForm, editingId]);

  if (isLoading && data.length === 0) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="grid grid-cols-4 gap-6">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-slate-800 rounded-xl" />)}
        </div>
        <div className="h-96 bg-slate-800 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="p-6 bg-slate-800 border-slate-700">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Shipments</p>
          <p className="text-2xl font-black text-white">{metrics.total}</p>
        </Card>
        <Card className="p-6 bg-slate-800 border-slate-700">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Costing Pending</p>
          <p className="text-2xl font-black text-amber-500">{metrics.pending}</p>
        </Card>
        <Card className="p-6 bg-slate-800 border-slate-700">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Final Cost INR</p>
          <p className="text-2xl font-black text-white">₹{metrics.totalFinal.toLocaleString()}</p>
        </Card>
        <Card className="p-6 bg-slate-800 border-slate-700">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Billed vs Final</p>
          <div className="flex items-baseline gap-2">
            <p className={`text-xl font-black ${metrics.totalBilled <= metrics.totalFinal ? 'text-emerald-500' : 'text-red-500'}`}>
              ₹{metrics.totalBilled.toLocaleString()}
            </p>
            <span className="text-slate-500 text-xs">· ₹{metrics.totalFinal.toLocaleString()}</span>
          </div>
        </Card>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {['ALL', 'PENDING COSTING', 'COSTED', 'PAID', 'UNPAID'].map(f => (
            <button 
              key={f}
              onClick={() => setFilter(f as any)}
              className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter transition-all border ${filter === f ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-900 text-slate-500 border-slate-700 hover:text-slate-300'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex gap-4 w-full md:w-auto">
          <select 
            value={batchFilter}
            onChange={e => setBatchFilter(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Batches</option>
            {uniqueBatches.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <div className="relative flex-1 md:w-64">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input 
              type="text" 
              placeholder="Search shipments..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Main Table */}
      <Card className="bg-slate-800 border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1800px]">
            <thead>
              <tr className="bg-slate-900/50 text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-700">
                <th className="px-4 py-4 sticky left-0 bg-slate-900/50 z-10">Shipment</th>
                <th className="px-4 py-4">Vendor</th>
                <th className="px-4 py-4">Qty</th>
                <th className="px-4 py-4">Ctns</th>
                <th className="px-4 py-4">Invoice</th>
                <th className="px-4 py-4">Mode</th>
                <th className="px-4 py-4">FX Rate</th>
                <th className="px-4 py-4">Charges%</th>
                <th className="px-4 py-4">Goods Value</th>
                <th className="px-4 py-4">Freight</th>
                <th className="px-4 py-4">Clearance</th>
                <th className="px-4 py-4">Local Frt</th>
                <th className="px-4 py-4">Shipping</th>
                <th className="px-4 py-4">IGST</th>
                <th className="px-4 py-4">Other</th>
                <th className="px-4 py-4">Final Total</th>
                <th className="px-4 py-4">Billed</th>
                <th className="px-4 py-4">Bill No</th>
                <th className="px-4 py-4">Pmt Status</th>
                <th className="px-4 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {Object.keys(groupedData).length === 0 ? (
                <tr>
                  <td colSpan={20} className="px-6 py-12 text-center text-slate-500 italic">No shipments found. Click Sync to populate.</td>
                </tr>
              ) : (
                Object.entries(groupedData).map(([batchId, shipments]: [string, ShipmentCosting[]]) => (
                  <React.Fragment key={batchId}>
                    {/* Batch Header Row */}
                    <tr 
                      onClick={() => toggleBatch(batchId)}
                      className="bg-slate-900/30 cursor-pointer hover:bg-slate-900/50 transition-colors"
                    >
                      <td colSpan={20} className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {collapsedBatches.has(batchId) ? <ChevronDownIcon className="w-4 h-4 text-slate-500" /> : <ChevronUpIcon className="w-4 h-4 text-slate-500" />}
                          <span className="text-xs font-black text-blue-400 uppercase tracking-widest">
                            Batch: {batchId} · {shipments[0].mode} · {shipments.length} shipments · Total: ₹{shipments.reduce((s: number, d: ShipmentCosting) => s + (d.final_total || 0), 0).toLocaleString()}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {!collapsedBatches.has(batchId) && shipments.map((d: ShipmentCosting) => {
                      const isEditing = editingId === d.shipment_id;
                      const displayData = isEditing ? { ...d, ...editForm, ...calculatedValues } : d;

                      return (
                        <tr key={d.shipment_id} className={`hover:bg-slate-700/30 transition-colors ${isEditing ? 'bg-blue-500/5' : ''}`}>
                          <td className="px-4 py-4 font-black text-white text-xs sticky left-0 bg-slate-800/80 backdrop-blur-sm z-10">{d.shipment_id}</td>
                          <td className="px-4 py-4 text-xs text-slate-400">{d.vendor_code}</td>
                          <td className="px-4 py-4 text-xs text-slate-400">{d.qty}</td>
                          <td className="px-4 py-4 text-xs text-slate-400">{d.cartons}</td>
                          <td className="px-4 py-4 text-xs text-slate-400">{d.currency} {d.invoice_amt.toLocaleString()}</td>
                          <td className="px-4 py-4">
                            {d.mode === 'Air' ? <AirplaneIcon className="w-4 h-4 text-purple-400" /> : <ShipIcon className="w-4 h-4 text-blue-400" />}
                          </td>
                          
                          {/* Manual Fields */}
                          <td className="px-4 py-4">
                            {isEditing ? (
                              <input 
                                type="number" 
                                value={editForm.fx_rate || ''} 
                                onChange={e => setEditForm({...editForm, fx_rate: Number(e.target.value)})}
                                className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none"
                              />
                            ) : <span className="text-xs text-slate-300">{d.fx_rate || '—'}</span>}
                          </td>
                          <td className="px-4 py-4">
                            {isEditing ? (
                              <input 
                                type="number" 
                                value={editForm.charges_pct || ''} 
                                onChange={e => setEditForm({...editForm, charges_pct: Number(e.target.value)})}
                                className="w-16 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none"
                              />
                            ) : <span className="text-xs text-slate-300">{d.charges_pct || '0'}%</span>}
                          </td>

                          {/* Calculated Field */}
                          <td className="px-4 py-4 font-bold text-blue-400 text-xs">₹{displayData.goods_value?.toLocaleString() || '0'}</td>

                          <td className="px-4 py-4">
                            {isEditing ? (
                              <input 
                                type="number" 
                                value={editForm.freight_charges || ''} 
                                onChange={e => setEditForm({...editForm, freight_charges: Number(e.target.value)})}
                                className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none"
                              />
                            ) : <span className="text-xs text-slate-300">₹{d.freight_charges?.toLocaleString() || '0'}</span>}
                          </td>
                          <td className="px-4 py-4">
                            {isEditing ? (
                              <input 
                                type="number" 
                                value={editForm.clearance || ''} 
                                onChange={e => setEditForm({...editForm, clearance: Number(e.target.value)})}
                                className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none"
                              />
                            ) : <span className="text-xs text-slate-300">₹{d.clearance?.toLocaleString() || '0'}</span>}
                          </td>
                          <td className="px-4 py-4">
                            {isEditing ? (
                              <input 
                                type="number" 
                                value={editForm.local_freight || ''} 
                                onChange={e => setEditForm({...editForm, local_freight: Number(e.target.value)})}
                                className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none"
                              />
                            ) : <span className="text-xs text-slate-300">₹{d.local_freight?.toLocaleString() || '0'}</span>}
                          </td>
                          <td className="px-4 py-4">
                            {isEditing ? (
                              <input 
                                type="number" 
                                value={editForm.shipping_charges || ''} 
                                onChange={e => setEditForm({...editForm, shipping_charges: Number(e.target.value)})}
                                className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none"
                              />
                            ) : <span className="text-xs text-slate-300">₹{d.shipping_charges?.toLocaleString() || '0'}</span>}
                          </td>
                          <td className="px-4 py-4">
                            {isEditing ? (
                              <input 
                                type="number" 
                                value={editForm.igst || ''} 
                                onChange={e => setEditForm({...editForm, igst: Number(e.target.value)})}
                                className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none"
                              />
                            ) : <span className="text-xs text-slate-300">₹{d.igst?.toLocaleString() || '0'}</span>}
                          </td>
                          <td className="px-4 py-4">
                            {isEditing ? (
                              <input 
                                type="number" 
                                value={editForm.other_charges || ''} 
                                onChange={e => setEditForm({...editForm, other_charges: Number(e.target.value)})}
                                className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none"
                              />
                            ) : <span className="text-xs text-slate-300">₹{d.other_charges?.toLocaleString() || '0'}</span>}
                          </td>

                          {/* Calculated Field */}
                          <td className="px-4 py-4 font-bold text-blue-400 text-xs">₹{displayData.final_total?.toLocaleString() || '0'}</td>

                          <td className="px-4 py-4">
                            {isEditing ? (
                              <input 
                                type="number" 
                                value={editForm.billed_amount || ''} 
                                onChange={e => setEditForm({...editForm, billed_amount: Number(e.target.value)})}
                                className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none"
                              />
                            ) : <span className="text-xs text-slate-300">₹{d.billed_amount?.toLocaleString() || '0'}</span>}
                          </td>
                          <td className="px-4 py-4">
                            {isEditing ? (
                              <input 
                                type="text" 
                                value={editForm.bill_no || ''} 
                                onChange={e => setEditForm({...editForm, bill_no: e.target.value})}
                                className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white outline-none"
                              />
                            ) : <span className="text-xs text-slate-300">{d.bill_no || '—'}</span>}
                          </td>

                          <td className="px-4 py-4">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter border ${
                              d.payment_status === 'Paid' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                              d.payment_status === 'Partial' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                              'bg-red-500/10 text-red-500 border-red-500/20'
                            }`}>
                              {d.payment_status}
                            </span>
                          </td>

                          <td className="px-4 py-4 text-right">
                            {isEditing ? (
                              <div className="flex items-center justify-end gap-2">
                                <button 
                                  onClick={() => handleSave(d.shipment_id)}
                                  disabled={isSaving}
                                  className="p-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-500 transition-colors"
                                >
                                  {isSaving ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <CheckIcon className="w-4 h-4" />}
                                </button>
                                <button 
                                  onClick={() => setEditingId(null)}
                                  className="p-1.5 bg-slate-700 text-slate-300 rounded hover:bg-slate-600 transition-colors"
                                >
                                  <XMarkIcon className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <button 
                                onClick={() => handleEdit(d)}
                                className="px-3 py-1 bg-blue-600/10 text-blue-400 hover:bg-blue-600 hover:text-white rounded text-[10px] font-black uppercase tracking-widest transition-all"
                              >
                                Edit
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

// --- Sub-View 2: Agent Invoices ---

const AgentInvoicesView: React.FC<{ 
  invoices: AgentInvoice[], 
  batches: BatchFinance[],
  isLoading: boolean,
  onRefresh: () => void,
  setLastRequest: (req: any) => void,
  setLastResponse: (res: any) => void
}> = ({ invoices, batches, isLoading, onRefresh, setLastRequest, setLastResponse }) => {
  const [isLogFormOpen, setIsLogFormOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'RECEIVED' | 'PARTIALLY ALLOCATED' | 'FULLY ALLOCATED'>('ALL');
  const [expandingInvoiceId, setExpandingInvoiceId] = useState<string | null>(null);

  const [logForm, setLogForm] = useState({
    invoice_no: '',
    invoice_date: '',
    received_date: '',
    total_amount_inr: 0,
    principal_amt: 0,
    commission_amt: 0,
    freight_amt: 0,
    gst_amt: 0,
    notes: ''
  });
  const [isLogging, setIsLogging] = useState(false);
  const [logSuccess, setLogSuccess] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  useEffect(() => {
    const sum = Number(logForm.principal_amt || 0) + 
                Number(logForm.commission_amt || 0) + 
                Number(logForm.freight_amt || 0) + 
                Number(logForm.gst_amt || 0);
    setLogForm(prev => ({ ...prev, total_amount_inr: sum }));
  }, [logForm.principal_amt, logForm.commission_amt, logForm.freight_amt, logForm.gst_amt]);

  const handleLogInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLogging(true);
    setLogSuccess(null);
    setLogError(null);
    const payload = { action: 'log_agent_invoice', ...logForm, created_by: 'Accounts Team' };
    setLastRequest(payload);
    try {
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      }).then(res => res.json());
      setLastResponse(res);
      if (res.status === 'success') {
        setLogSuccess(`Invoice ${logForm.invoice_no} logged!`);
        setLogForm({ invoice_no: '', invoice_date: '', received_date: '', total_amount_inr: 0, principal_amt: 0, commission_amt: 0, freight_amt: 0, gst_amt: 0, notes: '' });
        setTimeout(() => { setIsLogFormOpen(false); setLogSuccess(null); }, 2000);
        onRefresh();
      } else setLogError(res.message || "Failed to log");
    } catch (err: any) { setLogError(err.message || "Network error"); }
    finally { setIsLogging(false); }
  };

  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      const matchesSearch = inv.invoice_no.toLowerCase().includes(search.toLowerCase()) ||
                            inv.notes.toLowerCase().includes(search.toLowerCase());
      const matchesFilter = filter === 'ALL' || inv.status.toUpperCase() === filter;
      return matchesSearch && matchesFilter;
    });
  }, [invoices, search, filter]);

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'Received': return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      case 'Partially Allocated': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'Fully Allocated': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      default: return 'bg-slate-500/10 text-slate-500 border-slate-500/20';
    }
  };

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6 bg-slate-800 border-slate-700 flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 rounded-xl"><DocumentTextIcon className="w-6 h-6 text-blue-400" /></div>
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total Invoices</p>
            <p className="text-2xl font-black text-white">{invoices.length}</p>
          </div>
        </Card>
        <Card className="p-6 bg-slate-800 border-slate-700 flex items-center gap-4">
          <div className="p-3 bg-amber-500/10 rounded-xl"><ExclamationTriangleIcon className="w-6 h-6 text-amber-400" /></div>
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Pending Allocation</p>
            <p className="text-2xl font-black text-white">{invoices.filter(i => i.status === 'Received').length}</p>
          </div>
        </Card>
        <Card className="p-6 bg-slate-800 border-slate-700 flex items-center gap-4">
          <div className="p-3 bg-emerald-500/10 rounded-xl"><BanknotesIcon className="w-6 h-6 text-emerald-400" /></div>
          <div>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total Invoiced INR</p>
            <p className="text-2xl font-black text-white">₹{invoices.reduce((s, i) => s + i.total_amount_inr, 0).toLocaleString()}</p>
          </div>
        </Card>
      </div>

      {/* Log Form */}
      <div className="space-y-4">
        <button 
          onClick={() => setIsLogFormOpen(!isLogFormOpen)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-sm transition-all ${isLogFormOpen ? 'bg-slate-700 text-slate-200' : 'bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-900/20'}`}
        >
          {isLogFormOpen ? <XMarkIcon className="w-4 h-4" /> : <PlusCircleIcon className="w-4 h-4" />}
          {isLogFormOpen ? 'Close' : 'Log New Invoice'}
        </button>

        {isLogFormOpen && (
          <Card className="p-6 bg-slate-800 border-blue-500/30 animate-in slide-in-from-top-4 duration-300">
            <form onSubmit={handleLogInvoice} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Invoice No</label>
                  <input required type="text" value={logForm.invoice_no} onChange={e => setLogForm({...logForm, invoice_no: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Invoice Date</label>
                  <input required type="date" value={logForm.invoice_date} onChange={e => setLogForm({...logForm, invoice_date: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Received Date</label>
                  <input required type="date" value={logForm.received_date} onChange={e => setLogForm({...logForm, received_date: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total Amount INR</label>
                  <input readOnly type="number" value={logForm.total_amount_inr} className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white font-bold outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                {['principal_amt', 'commission_amt', 'freight_amt', 'gst_amt'].map(field => (
                  <div key={field} className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{field.replace('_amt', '').toUpperCase()} INR</label>
                    <input type="number" value={(logForm as any)[field]} onChange={e => setLogForm({...logForm, [field]: Number(e.target.value)})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Notes</label>
                <textarea rows={2} value={logForm.notes} onChange={e => setLogForm({...logForm, notes: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all" />
              </div>
              {logError && <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs font-bold">{logError}</div>}
              {logSuccess && <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-xs font-bold">{logSuccess}</div>}
              <Button type="submit" className="w-full py-3 font-black uppercase tracking-widest" disabled={isLogging}>{isLogging ? 'Logging...' : 'Log Invoice'}</Button>
            </form>
          </Card>
        )}
      </div>

      {/* Invoice Table */}
      <Card className="bg-slate-800 border-slate-700 overflow-hidden">
        <div className="p-4 border-b border-slate-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex flex-wrap gap-2">
            {['ALL', 'RECEIVED', 'PARTIALLY ALLOCATED', 'FULLY ALLOCATED'].map(f => (
              <button key={f} onClick={() => setFilter(f as any)} className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter transition-all border ${filter === f ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-900 text-slate-500 border-slate-700 hover:text-slate-300'}`}>{f}</button>
            ))}
          </div>
          <div className="relative w-full md:w-64">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-xs text-white outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900/50 text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-700">
                <th className="px-6 py-4">Invoice No</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Total INR</th>
                <th className="px-6 py-4">Breakdown</th>
                <th className="px-6 py-4">Allocation</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {filteredInvoices.map(inv => (
                <React.Fragment key={inv.invoice_id}>
                  <tr className={`hover:bg-slate-700/30 transition-colors ${expandingInvoiceId === inv.invoice_id ? 'bg-blue-500/5' : ''}`}>
                    <td className="px-6 py-4 font-black text-white">{inv.invoice_no}</td>
                    <td className="px-6 py-4 text-xs text-slate-400">{new Date(inv.invoice_date).toLocaleDateString()}</td>
                    <td className="px-6 py-4 font-black text-emerald-400">₹{inv.total_amount_inr.toLocaleString()}</td>
                    <td className="px-6 py-4 text-[10px] text-slate-500 font-bold leading-relaxed">P: ₹{inv.principal_amt.toLocaleString()} · C: ₹{inv.commission_amt.toLocaleString()}<br/>F: ₹{inv.freight_amt.toLocaleString()} · G: ₹{inv.gst_amt.toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <div className="space-y-1.5 w-32">
                        <div className="flex justify-between text-[9px] font-black text-slate-500 uppercase tracking-tighter"><span>₹{inv.allocated_inr.toLocaleString()}</span><span>{inv.allocation_pct}%</span></div>
                        <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden"><div className={`h-full transition-all duration-500 ${inv.allocation_pct === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${inv.allocation_pct}%` }} /></div>
                      </div>
                    </td>
                    <td className="px-6 py-4"><span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter border ${getStatusBadgeClass(inv.status)}`}>{inv.status}</span></td>
                    <td className="px-6 py-4 text-right"><button onClick={() => setExpandingInvoiceId(expandingInvoiceId === inv.invoice_id ? null : inv.invoice_id)} className="px-3 py-1 bg-blue-600/10 text-blue-400 hover:bg-blue-600 hover:text-white rounded text-[10px] font-black uppercase tracking-widest transition-all">{expandingInvoiceId === inv.invoice_id ? 'Close' : 'Allocate'}</button></td>
                  </tr>
                  {expandingInvoiceId === inv.invoice_id && (
                    <tr>
                      <td colSpan={7} className="px-6 py-0 border-b border-slate-700">
                        <AllocationPanel invoice={inv} batches={batches} onComplete={() => { setExpandingInvoiceId(null); onRefresh(); }} setLastRequest={setLastRequest} setLastResponse={setLastResponse} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

// --- Allocation Panel ---

const AllocationPanel: React.FC<{
  invoice: AgentInvoice;
  batches: BatchFinance[];
  onComplete: () => void;
  setLastRequest: (req: any) => void;
  setLastResponse: (res: any) => void;
}> = ({ invoice, batches, onComplete, setLastRequest, setLastResponse }) => {
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [shipments, setShipments] = useState<any[]>([]);
  const [isLoadingShipments, setIsLoadingShipments] = useState(false);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [isSaving, setIsSaving] = useState(false);

  const fetchShipments = async (batchId: string) => {
    setIsLoadingShipments(true);
    const payload = { action: 'get_batch_finance_detail', batch_id: batchId };
    setLastRequest(payload);
    try {
      const res = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) }).then(res => res.json());
      setLastResponse(res);
      if (res.status === 'success') {
        setShipments(res.shipments || []);
        const initial: Record<string, number> = {};
        (res.shipments || []).forEach((s: any) => initial[s.shipment_id] = 0);
        setAllocations(initial);
      }
    } catch (err) { console.error(err); }
    finally { setIsLoadingShipments(false); }
  };

  const handleBatchChange = (batchId: string) => {
    setSelectedBatchId(batchId);
    if (batchId) fetchShipments(batchId);
    else setShipments([]);
  };

  const totalAllocated = Object.values(allocations).reduce((s: number, v: number) => s + v, 0);
  const remaining = Number(invoice.unallocated_inr) - Number(totalAllocated);
  const isOverAllocated = remaining < 0;

  const handleSave = async () => {
    setIsSaving(true);
    const mappings = Object.entries(allocations).filter(([_, amt]) => (amt as number) > 0).map(([sid, amt]) => ({ shipment_id: sid, batch_id: selectedBatchId, allocated_amt_inr: amt }));
    const payload = { action: 'map_invoice_shipments', invoice_id: invoice.invoice_id, mappings, allocated_by: 'Accounts Team' };
    setLastRequest(payload);
    try {
      const res = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) }).then(res => res.json());
      setLastResponse(res);
      if (res.status === 'success') onComplete();
      else alert(res.message || "Failed to save");
    } catch (err) { console.error(err); alert("Network error"); }
    finally { setIsSaving(false); }
  };

  return (
    <div className="py-6 px-4 bg-slate-900/40 border-x border-slate-700 animate-in slide-in-from-top-2 duration-300">
      <div className="max-w-[1000px] mx-auto space-y-6">
        <div className="flex flex-col md:flex-row items-end gap-6">
          <div className="flex-1 space-y-1.5">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Step 1: Select Batch</label>
            <select value={selectedBatchId} onChange={e => handleBatchChange(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">-- Choose a Batch --</option>
              {batches.map(b => <option key={b.batch_id} value={b.batch_id}>{b.batch_id} ({b.carrier})</option>)}
            </select>
          </div>
          <div className="flex-1 text-right">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Allocation Status</p>
            <p className={`text-sm font-bold ${isOverAllocated ? 'text-red-400' : 'text-slate-300'}`}>Allocated: ₹{totalAllocated.toLocaleString()} of ₹{invoice.unallocated_inr.toLocaleString()} remaining</p>
          </div>
        </div>
        {selectedBatchId && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <div className="flex justify-between items-center"><label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Step 2: Allocate Amounts</label>{isLoadingShipments && <ArrowPathIcon className="w-4 h-4 text-blue-400 animate-spin" />}</div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900/60 text-[9px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-700">
                    <th className="px-4 py-3">Shipment ID</th>
                    <th className="px-4 py-3">Vendor</th>
                    <th className="px-4 py-3">Invoice No</th>
                    <th className="px-4 py-3">Amount Foreign</th>
                    <th className="px-4 py-3 text-right">Allocate INR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {shipments.map(s => (
                    <tr key={s.shipment_id} className="hover:bg-slate-700/20 transition-colors">
                      <td className="px-4 py-3 text-xs font-mono text-slate-300">{s.shipment_id}</td>
                      <td className="px-4 py-3 text-xs text-slate-400 font-bold">{s.vendor_code}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{s.invoice_no}</td>
                      <td className="px-4 py-3 text-xs text-slate-300 font-bold">{s.currency} {s.total_amount.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right"><input type="number" value={allocations[s.shipment_id] || ''} onChange={e => setAllocations({...allocations, [s.shipment_id]: Number(e.target.value)})} className="w-32 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-emerald-400 font-bold text-right outline-none focus:ring-1 focus:ring-blue-500" placeholder="0" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end pt-4"><Button onClick={handleSave} disabled={isSaving || totalAllocated === 0 || isOverAllocated} className="px-8 font-black uppercase tracking-widest">{isSaving ? 'Saving...' : 'Save Allocation'}</Button></div>
          </div>
        )}
      </div>
    </div>
  );
};
