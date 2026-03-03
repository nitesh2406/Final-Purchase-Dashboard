import React, { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeftIcon,
  MagnifyingGlassIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ShipIcon,
  AirplaneIcon,
  CheckIcon,
  XMarkIcon,
  BoxIcon,
  DocumentTextIcon,
  ArchiveBoxIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  ClipboardDocumentCheckIcon
} from '../icons/Icons';
import { Batch, BatchVendorShipment } from '../../types';
import { APPS_SCRIPT_URL } from '../../App';
import { Button } from '../ui/Button';

// Status Badge Component
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const getColor = (status: string) => {
    const colors: Record<string, string> = {
      'Shipped': 'bg-purple-400/10 text-purple-400',
      'In-Transit China': 'bg-blue-400/10 text-blue-400',
      'At Port China': 'bg-cyan-400/10 text-cyan-400',
      'In-Transit Ocean': 'bg-blue-500/10 text-blue-500',
      'In-Transit Air': 'bg-indigo-400/10 text-indigo-400',
      'Customs Clearance': 'bg-yellow-400/10 text-yellow-400',
      'In-Transit India': 'bg-green-400/10 text-green-400',
      'Out for Delivery': 'bg-emerald-400/10 text-emerald-400',
      'Delivered': 'bg-emerald-500/10 text-emerald-500'
    };
    return colors[status] || 'bg-gray-400/10 text-gray-400';
  };

  return (
    <span className={`px-3 py-1.5 rounded-md text-sm font-medium border border-transparent ${getColor(status)}`}>
      {status}
    </span>
  );
};

// Check Icon Helper
const CheckCell: React.FC<{ value: boolean | null }> = ({ value }) => {
  if (value === null) return <span className="text-slate-600 text-sm">-</span>;
  return value ? <CheckIcon className="w-4 h-4 text-green-500 mx-auto" /> : <XMarkIcon className="w-4 h-4 text-red-500 mx-auto" />;
};

// DOC Badge
const DOCBadge: React.FC<{ doc: number | null }> = ({ doc }) => {
  if (doc === null) return <span className="text-slate-600 text-sm">-</span>;
  const color = doc > 30 ? 'bg-green-500/10 text-green-500' : doc >= 15 ? 'bg-yellow-500/10 text-yellow-500' : 'bg-red-500/10 text-red-500';
  return <span className={`inline-block px-2 py-1 rounded text-sm font-medium ${color}`}>{doc}d</span>;
};

// Batch Info Header
const BatchInfoHeader: React.FC<{ batch: Batch }> = ({ batch }) => {
  const formatDate = (dateString: string) => {
    if (!dateString) return 'TBA';
    const d = new Date(dateString);
    return isNaN(d.getTime()) ? dateString : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-5 bg-slate-800 rounded-lg border border-slate-700 shadow-sm">
      <div>
        <p className="text-xs text-slate-500 mb-1 uppercase tracking-wide font-bold">Carrier & Tracking</p>
        <p className="text-base font-semibold text-slate-100">{batch.carrier}</p>
        <p className="text-sm text-slate-400 font-mono">{batch.tracking_number || 'No Tracking #'}</p>
      </div>
      <div>
        <p className="text-xs text-slate-500 mb-1 uppercase tracking-wide font-bold">Expected Delivery</p>
        <p className="text-base font-semibold text-slate-100">{formatDate(batch.expected_delivery)}</p>
        {batch.actual_delivery && <p className="text-sm text-green-500">Delivered: {formatDate(batch.actual_delivery)}</p>}
      </div>
      <div>
        <p className="text-xs text-slate-500 mb-1 uppercase tracking-wide font-bold">Total Quantity</p>
        <p className="text-base font-semibold text-slate-100">{batch.total_units} units</p>
        <p className="text-sm text-slate-400">{batch.total_vendors} vendors</p>
      </div>
      <div>
        <p className="text-xs text-slate-500 mb-1 uppercase tracking-wide font-bold">Total Cartons</p>
        <p className="text-base font-semibold text-slate-100">{batch.total_cartons} cartons</p>
        <p className="text-sm text-slate-400">{batch.batch_type === 'sea' ? '🚢 Sea Freight' : '✈️ Air Freight'}</p>
      </div>
    </div>
  );
};

// Vendor Shipment Row (Expandable)
const VendorShipmentRow: React.FC<{
  vendor: BatchVendorShipment;
  isExpanded: boolean;
  onToggle: () => void;
  isSearching: boolean;
}> = ({ vendor, isExpanded, onToggle, isSearching }) => {
  const ChevronIcon = isExpanded ? ChevronDownIcon : ChevronRightIcon;
  const totalUnits = vendor.line_items.reduce((sum, item) => sum + (item.incoming_qty || 0), 0);

  return (
    <div className="border-b border-slate-700 last:border-0">
      <button onClick={onToggle} className="w-full px-6 py-4 hover:bg-slate-700/50 transition-colors flex items-center justify-between text-left">
        <div className="flex items-center gap-4">
          <ChevronIcon className="w-5 h-5 text-slate-500 flex-shrink-0" />
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-bold text-base text-slate-100 uppercase tracking-tight">{vendor.vendor_code}</span>
              <span className="text-slate-600">|</span>
              <span className="text-base text-slate-300">{vendor.vendor_name}</span>
              <span className="text-slate-600">|</span>
              <span className="text-sm text-slate-500">Invoice: {vendor.invoice_no}</span>
            </div>
            <div className="text-sm text-slate-500 mt-1">
              {vendor.carton_count} cartons • {totalUnits} units
              {isSearching && <span className="text-blue-400 ml-2 font-medium">• {vendor.line_items.length} matching items</span>}
            </div>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="bg-slate-900/50 px-6 py-4 animate-in slide-in-from-top-2 duration-200">
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  {['SKU', 'Item Name', 'Incoming', 'Current Stock', 'Future Stock', 'MMA', 'DOC', 'Logo', 'Pkg', 'Manual', 'OPP'].map((label, i) => (
                    <th key={label} className={`py-3 px-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-${i < 2 ? 'left' : (i > 6 ? 'center' : 'right')}`}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {vendor.line_items.map(item => (
                  <tr key={item.line_id} className="hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-3 font-mono text-xs font-medium text-blue-400 whitespace-nowrap">{item.sku}</td>
                    <td className="py-3 px-3 text-slate-300 whitespace-nowrap">{item.item_name}</td>
                    <td className="py-3 px-3 text-right font-bold text-white">{item.incoming_qty}</td>
                    <td className="py-3 px-3 text-right text-slate-400">{item.current_stock ?? '-'}</td>
                    <td className="py-3 px-3 text-right font-medium text-slate-100">{item.future_stock ?? '-'}</td>
                    <td className="py-3 px-3 text-right text-slate-400">{item.mma ?? '-'}</td>
                    <td className="py-3 px-3 text-right"><DOCBadge doc={item.doc_after_arrival} /></td>
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
}

export const BatchDetail: React.FC<BatchDetailProps> = ({ batchId, onBack }) => {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [filteredVendors, setFilteredVendors] = useState<BatchVendorShipment[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      setLastResponse(result);

      if (result.status === 'success') {
        setBatch(result.batch);
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
    const filtered = batch.vendor_shipments.map(vendor => ({
        ...vendor,
        line_items: vendor.line_items.filter(item => 
          String(item.sku || '').toLowerCase().includes(searchLower) || 
          String(item.item_name || '').toLowerCase().includes(searchLower)
        )
      })).filter(vendor => vendor.line_items.length > 0);

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

  const handleCopyDebug = (data: any) => {
    if (data) navigator.clipboard.writeText(JSON.stringify(data, null, 2));
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
            <pre className="bg-slate-900 border border-slate-800 p-4 rounded-lg text-[10px] font-mono text-slate-400 overflow-auto max-h-[300px]">
              {lastRequest ? JSON.stringify(lastRequest, null, 2) : '// No request recorded'}
            </pre>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-[9px] font-bold text-slate-500 uppercase">Last Response</span>
              <button onClick={() => handleCopyDebug(lastResponse)} className="text-[9px] text-blue-500 hover:underline">Copy</button>
            </div>
            <pre className="bg-slate-900 border border-slate-800 p-4 rounded-lg text-[10px] font-mono text-slate-400 overflow-auto max-h-[300px]">
              {lastResponse ? JSON.stringify(lastResponse, null, 2) : '// No response recorded'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-[1600px] mx-auto animate-in fade-in duration-500 pb-24 p-6">
      <button onClick={onBack} className="group flex items-center gap-2 text-slate-400 hover:text-white mb-8 transition-colors">
        <ArrowLeftIcon className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
        <span className="font-bold text-sm uppercase tracking-widest">Back to Batch List</span>
      </button>

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
          <div className="mb-8">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-2 rounded-lg bg-slate-800 border border-slate-700">
                {batch.batch_type === 'sea' ? <ShipIcon className="w-6 h-6 text-slate-400" /> : <AirplaneIcon className="w-6 h-6 text-slate-400" />}
              </div>
              <h1 className="text-3xl font-bold text-white tracking-tight">{batch.batch_id}</h1>
              <StatusBadge status={batch.status} />
              {batch.is_delayed && <span className="px-2.5 py-1 bg-red-500/10 text-red-400 text-[10px] font-black rounded uppercase tracking-tighter border border-red-500/20">Delayed {batch.delay_days}d</span>}
            </div>
            <BatchInfoHeader batch={batch} />
          </div>

          <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 mb-8 shadow-sm">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-500" />
              <input
                type="text"
                placeholder="Search container by SKU or Item Name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-12 pr-12 py-3.5 bg-slate-900 border border-slate-700 rounded-lg text-white text-base placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
              {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-4 top-1/2 transform -translate-y-1/2 text-slate-500 hover:text-white transition-colors"><XMarkIcon className="w-5 h-5" /></button>}
            </div>
          </div>

          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-lg">
            <div className="px-6 py-4 border-b border-slate-700 bg-slate-900/40">
              <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <ArchiveBoxIcon className="w-4 h-4" /> Shipment Contents
                <span className="ml-2 text-xs text-slate-600 lowercase font-normal">({filteredVendors.length} shipments total)</span>
              </h2>
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
                  <VendorShipmentRow key={vendor.shipment_id} vendor={vendor} isExpanded={expandedVendors.has(vendor.shipment_id)} onToggle={() => toggleVendor(vendor.shipment_id)} isSearching={searchTerm.trim().length > 0} />
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

          {renderDebugPanel()}
        </>
      )}
    </div>
  );
};