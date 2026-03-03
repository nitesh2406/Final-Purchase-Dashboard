import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  BoxIcon, 
  BanknotesIcon, 
  TruckIcon, 
  ExclamationTriangleIcon,
  MagnifyingGlassIcon, 
  ShipIcon, 
  AirplaneIcon, 
  ChevronRightIcon, 
  ArrowPathIcon
} from '../icons/Icons';
import { BatchFinance, BatchMetrics } from '../../types';
import { APPS_SCRIPT_URL } from '../../App';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

// Persistent cache for Finance module
let financeCache: { 
  batches: BatchFinance[]; 
  metrics: any;
  timestamp: number; 
} | null = null;

interface ShipmentFinanceProps {
  onNavigateToDetail?: (batchId: string) => void;
}

// Sub-component: Dashboard Summary Cards
const DashboardCards: React.FC<{ metrics: any; isLoading: boolean }> = ({ metrics, isLoading }) => {
  if (isLoading && !financeCache) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-slate-800 p-6 rounded-xl border border-slate-700 animate-pulse">
            <div className="h-4 bg-slate-700 rounded w-24 mb-2" />
            <div className="h-8 bg-slate-700 rounded w-16" />
          </div>
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: 'Active Batches',
      value: metrics?.activeBatches || 0,
      icon: BoxIcon,
      color: 'text-blue-400',
      bg: 'bg-blue-400/10'
    },
    {
      label: 'Total Outstanding',
      value: `₹${((metrics?.totalOutstandingINR || 0) / 100000).toFixed(2)}L`,
      icon: BanknotesIcon,
      color: 'text-red-400',
      bg: 'bg-red-400/10'
    },
    {
      label: 'Arriving This Week',
      value: metrics?.arrivingThisWeek || 0,
      icon: TruckIcon,
      color: 'text-yellow-400',
      bg: 'bg-yellow-400/10'
    },
    {
      label: 'Pending Payments',
      value: metrics?.pendingPaymentsCount || 0,
      icon: ExclamationTriangleIcon,
      color: 'text-orange-400',
      bg: 'bg-orange-400/10'
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <div key={index} className="bg-slate-800 p-6 rounded-xl border border-slate-700 hover:border-slate-600 transition-all shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className={`p-1.5 rounded-lg ${card.bg}`}>
                <Icon className={`w-4 h-4 ${card.color}`} />
              </div>
              <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                {card.label}
              </span>
            </div>
            <div className="text-2xl font-bold text-slate-100">
              {card.value}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// Sub-component: Filter Bar
const FilterBar: React.FC<{ 
  filters: any; 
  setFilters: (f: any) => void 
}> = ({ filters, setFilters }) => {
  return (
    <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 mb-6 shadow-sm">
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Search Batch, Carrier, Tracking, Vendor..."
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          <option value="All">All Statuses</option>
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

        <div className="flex gap-1 p-1 bg-slate-900 rounded-lg border border-slate-700">
          {(['All', 'sea', 'air'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setFilters({ ...filters, mode })}
              className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${
                filters.mode === mode ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {mode === 'All' ? 'ALL' : mode === 'sea' ? '🚢 SEA' : '✈️ AIR'}
            </button>
          ))}
        </div>

        <div className="flex gap-1 p-1 bg-slate-900 rounded-lg border border-slate-700">
          {(['All', 'Unpaid', 'Partial', 'Paid'] as const).map(pStatus => (
            <button
              key={pStatus}
              onClick={() => setFilters({ ...filters, paymentStatus: pStatus })}
              className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase transition-all ${
                filters.paymentStatus === pStatus ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {pStatus}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// Sub-component: Batch Finance Card
type BatchStatusOption = 'Shipped' | 'In-Transit China' | 'At Port China' | 'In-Transit Ocean' | 'In-Transit Air' | 'Customs Clearance' | 'In-Transit India' | 'Out for Delivery' | 'Delivered';

const BatchFinanceCard: React.FC<{ 
  batch: BatchFinance; 
  onViewDetails: (id: string) => void;
  onUpdate: () => void;
  setLastRequest: (r: any) => void;
  setLastResponse: (r: any) => void;
}> = ({ batch, onViewDetails, onUpdate, setLastRequest, setLastResponse }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editData, setEditData] = useState({
    carrier: batch.carrier,
    tracking_number: batch.tracking_number,
    expected_delivery: batch.expected_delivery,
    status: batch.status,
    notes: batch.notes,
    total_amount: batch.total_amount, // Assuming this maps to total_amount in edit
    total_currency: batch.total_currency
  });

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsSaving(true);
    const payload = { 
      action: 'update_batch_tracking', 
      batch_id: batch.batch_id,
      ...editData
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
        setIsEditing(false);
        onUpdate();
      } else {
        alert(result.message || "Update failed");
      }
    } catch (err) {
      console.error("Update error:", err);
      alert("Network error updating batch");
    } finally {
      setIsSaving(false);
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

  const ModeIcon = batch.batch_type === 'sea' ? ShipIcon : AirplaneIcon;

  return (
    <div 
      className="bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-slate-600 transition-all shadow-sm group relative"
      onClick={() => !isEditing && onViewDetails(batch.batch_id)}
    >
      {/* Edit Trigger */}
      <button 
        onClick={(e) => { e.stopPropagation(); setIsEditing(!isEditing); }}
        className="absolute top-4 right-4 p-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-400 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
        </svg>
      </button>

      <div className="flex items-start justify-between mb-3 pr-8">
        <div className="flex items-center gap-2">
          <ModeIcon className="w-5 h-5 text-slate-500" />
          <h3 className="text-lg font-bold text-slate-100">{batch.batch_id}</h3>
        </div>
        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
          ETA: {batch.expected_delivery ? new Date(batch.expected_delivery).toLocaleDateString() : 'TBA'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${getStatusColor(batch.status)}`}>
          {batch.status}
        </span>
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${getPaymentStatusColor(batch.payment_status)}`}>
          {batch.payment_status}
        </span>
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <span className="font-bold">{batch.carrier}</span>
          <span className="text-slate-600">•</span>
          <span className="text-xs font-mono text-slate-500">{batch.tracking_number}</span>
        </div>
        <div className="text-[11px] text-slate-500">
          {batch.total_vendors} Vendors • {batch.total_cartons} Cartons • {batch.total_shipments} Shipments
        </div>
      </div>

      {/* Finance Row */}
      <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50 mb-4">
        <div className="flex justify-between items-center">
          <div>
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Total Amount</div>
            <div className="text-sm font-bold text-slate-100">
              {batch.total_currency} {batch.total_amount?.toLocaleString()}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">INR Equivalent</div>
            <div className="text-sm font-bold text-blue-400">
              {batch.amount_inr ? `₹${batch.amount_inr.toLocaleString()}` : (
                <span className="text-amber-500 flex items-center gap-1">
                  <ExclamationTriangleIcon className="w-3 h-3" /> Rate N/A
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Inline Edit Panel */}
      {isEditing && (
        <div className="mt-4 pt-4 border-t border-slate-700 space-y-3 animate-in slide-in-from-top-2 duration-200" onClick={e => e.stopPropagation()}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">Carrier</label>
              <input 
                type="text" 
                value={editData.carrier}
                onChange={e => setEditData({...editData, carrier: e.target.value})}
                className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">Tracking</label>
              <input 
                type="text" 
                value={editData.tracking_number}
                onChange={e => setEditData({...editData, tracking_number: e.target.value})}
                className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-100"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">ETA</label>
              <input 
                type="date" 
                value={editData.expected_delivery?.split('T')[0]}
                onChange={e => setEditData({...editData, expected_delivery: e.target.value})}
                className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">Status</label>
              <select 
                value={editData.status}
                onChange={e => setEditData({...editData, status: e.target.value as BatchStatusOption})}
                className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-100"
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
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">Amount</label>
              <input 
                type="number" 
                value={editData.total_amount}
                onChange={e => setEditData({...editData, total_amount: Number(e.target.value)})}
                className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="text-[9px] font-bold text-slate-500 uppercase mb-1 block">Currency</label>
              <select 
                value={editData.total_currency}
                onChange={e => setEditData({...editData, total_currency: e.target.value as 'RMB' | 'USD'})}
                className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-100"
              >
                <option value="RMB">RMB</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button 
              className="flex-1 py-1.5 text-xs" 
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
            <Button 
              variant="secondary" 
              className="flex-1 py-1.5 text-xs"
              onClick={(e) => { e.stopPropagation(); setIsEditing(false); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!isEditing && (
        <button className="w-full mt-2 py-2 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded-lg transition-all font-bold text-xs flex items-center justify-center gap-2">
          View Details <ChevronRightIcon className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

export const ShipmentFinance: React.FC<ShipmentFinanceProps> = ({ onNavigateToDetail }) => {
  const [batches, setBatches] = useState<BatchFinance[]>(financeCache?.batches || []);
  const [metrics, setMetrics] = useState<any>(financeCache?.metrics || null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    search: '',
    status: 'All',
    mode: 'All',
    paymentStatus: 'All'
  });

  // Debug State
  const [showDebug, setShowDebug] = useState(false);
  const [lastRequest, setLastRequest] = useState<any>(null);
  const [lastResponse, setLastResponse] = useState<any>(null);

  const fetchData = useCallback(async (force = false) => {
    if (!force && financeCache) {
      setBatches(financeCache.batches);
      setMetrics(financeCache.metrics);
      return;
    }

    setIsLoading(true);
    setError(null);
    const payload = { action: 'get_batches_finance' };
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
        setBatches(result.batches || []);
        setMetrics(result.metrics || null);
        financeCache = {
          batches: result.batches || [],
          metrics: result.metrics || null,
          timestamp: Date.now()
        };
      } else {
        throw new Error(result.message || "Failed to fetch finance data");
      }
    } catch (err: any) {
      console.error("Fetch error:", err);
      setError(err.message || "Network error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredBatches = useMemo(() => {
    return batches.filter(b => {
      const matchesSearch = !filters.search || 
        b.batch_id.toLowerCase().includes(filters.search.toLowerCase()) ||
        b.carrier.toLowerCase().includes(filters.search.toLowerCase()) ||
        b.tracking_number.toLowerCase().includes(filters.search.toLowerCase());
      
      const matchesStatus = filters.status === 'All' || b.status === filters.status;
      const matchesMode = filters.mode === 'All' || b.batch_type === filters.mode;
      const matchesPayment = filters.paymentStatus === 'All' || b.payment_status === filters.paymentStatus;

      return matchesSearch && matchesStatus && matchesMode && matchesPayment;
    });
  }, [batches, filters]);

  return (
    <div className="p-6 max-w-[1600px] mx-auto bg-slate-900 min-h-screen text-slate-100 pb-24">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold">Shipment Finance</h1>
            <span className="px-2 py-0.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded text-[10px] font-bold uppercase tracking-widest">
              Admin
            </span>
          </div>
          <p className="text-slate-400 text-sm">Admin · Full tracking & financial management</p>
        </div>
        <Button 
          variant="secondary" 
          onClick={() => fetchData(true)}
          disabled={isLoading}
          icon={<ArrowPathIcon className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />}
        >
          Refresh Data
        </Button>
      </div>

      <DashboardCards metrics={metrics} isLoading={isLoading} />
      <FilterBar filters={filters} setFilters={setFilters} />

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-500" />
            <p className="text-red-400 text-sm font-medium">{error}</p>
          </div>
          <Button variant="secondary" className="text-xs py-1" onClick={() => fetchData(true)}>Retry</Button>
        </div>
      )}

      {!isLoading && (
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
            Showing {filteredBatches.length} of {batches.length} batches
          </p>
          {financeCache && (
            <span className="text-[9px] text-slate-500 italic">
              Last synced: {new Date(financeCache.timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {isLoading && !financeCache ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl p-5 animate-pulse h-64 shadow-sm" />
          ))}
        </div>
      ) : filteredBatches.length === 0 ? (
        <div className="text-center py-24 bg-slate-800 rounded-xl border-2 border-dashed border-slate-700 shadow-sm">
          <BoxIcon className="w-16 h-16 mx-auto text-slate-700 mb-4" />
          <p className="text-lg text-slate-300 font-medium">No batches matching your filters</p>
          <p className="text-sm text-slate-500 mt-1">Try adjusting your search or clearing filters</p>
          <button 
            className="mt-6 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
            onClick={() => setFilters({ search: '', status: 'All', mode: 'All', paymentStatus: 'All' })}
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
          {filteredBatches.map(batch => (
            <BatchFinanceCard
              key={batch.batch_id}
              batch={batch}
              onViewDetails={onNavigateToDetail || (() => {})}
              onUpdate={() => fetchData(true)}
              setLastRequest={setLastRequest}
              setLastResponse={setLastResponse}
            />
          ))}
        </div>
      )}

      {/* Debug Panel */}
      <div className="mt-12 pt-8 border-t border-slate-800">
        <button 
          onClick={() => setShowDebug(!showDebug)}
          className="text-[10px] font-bold text-slate-500 hover:text-blue-500 uppercase tracking-widest transition-colors flex items-center gap-2"
        >
          <ArrowPathIcon className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          {showDebug ? 'Hide Network Info' : 'Show Network Debug'}
        </button>
        {showDebug && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4 animate-in slide-in-from-bottom-2 duration-200">
            <div className="space-y-1">
              <span className="text-[9px] font-bold text-slate-500 uppercase">Last Request</span>
              <pre className="bg-slate-950 border border-slate-800 p-4 rounded-lg text-[10px] font-mono text-slate-400 overflow-auto max-h-[300px]">
                {lastRequest ? JSON.stringify(lastRequest, null, 2) : '// No request recorded'}
              </pre>
            </div>
            <div className="space-y-1">
              <span className="text-[9px] font-bold text-slate-500 uppercase">Last Response</span>
              <pre className="bg-slate-950 border border-slate-800 p-4 rounded-lg text-[10px] font-mono text-slate-400 overflow-auto max-h-[300px]">
                {lastResponse ? JSON.stringify(lastResponse, null, 2) : '// No response recorded'}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
