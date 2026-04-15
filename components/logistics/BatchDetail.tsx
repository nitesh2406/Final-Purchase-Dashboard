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
      'Shipped': 'bg-purple-100 text-purple-700 dark:bg-purple-400/10 dark:text-purple-400',
      'In-Transit China': 'bg-blue-100 text-blue-700 dark:bg-blue-400/10 dark:text-blue-400',
      'At Port China': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-400',
      'In-Transit Ocean': 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400',
      'In-Transit Air': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-400',
      'Customs Clearance': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-400/10 dark:text-yellow-400',
      'In-Transit India': 'bg-green-100 text-green-700 dark:bg-green-400/10 dark:text-green-400',
      'Out for Delivery': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-400',
      'Delivered': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-400',
      'OPEN': 'bg-gray-100 text-gray-600 dark:bg-gray-400/10 dark:text-gray-400',
    };
    return colors[status] || 'bg-gray-100 text-gray-600 dark:bg-gray-400/10 dark:text-gray-400';
  };
  return (
    <span className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wide ${getColor(status)}`}>
      {status}
    </span>
  );
};

// DOC Badge
const DOCBadge: React.FC<{ doc: number | null }> = ({ doc }) => {
  if (doc === null) return <span className="text-gray-400 dark:text-slate-600 text-sm">—</span>;
  const color = doc > 30
    ? 'bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400'
    : doc >= 15
    ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400'
    : 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400';
  return <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${color}`}>{doc}d</span>;
};

// Check Cell
const CheckCell: React.FC<{ value: boolean | null }> = ({ value }) => {
  if (value === null) return <span className="text-gray-300 dark:text-slate-600 text-sm">—</span>;
  return value
    ? <span className="text-green-600 dark:text-green-500 font-bold text-sm">✓</span>
    : <span className="text-red-500 dark:text-red-500 font-bold text-sm">✗</span>;
};

// Vendor Shipment Row (Expandable)
const VendorShipmentRow: React.FC<{
  vendor: BatchVendorShipment;
  isExpanded: boolean;
  onToggle: () => void;
  isSearching: boolean;
}> = ({ vendor, isExpanded, onToggle, isSearching }) => {
  const totalUnits = vendor.line_items.reduce((sum, item) => sum + (item.incoming_qty || 0), 0);

  return (
    <div className="border-b border-gray-100 dark:border-slate-700 last:border-0">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors flex items-center gap-3 text-left"
      >
        <ChevronRightIcon className={`w-4 h-4 text-gray-400 dark:text-slate-500 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        <span className="font-bold text-sm text-gray-900 dark:text-slate-100 uppercase">{vendor.vendor_code}</span>
        <span className="text-gray-300 dark:text-slate-600">|</span>
        <span className="text-sm text-gray-500 dark:text-slate-400">{vendor.vendor_name}</span>
        <span className="text-gray-300 dark:text-slate-600">|</span>
        <span className="text-xs text-gray-400 dark:text-slate-500">Invoice: {vendor.invoice_no}</span>
        <span className="text-gray-300 dark:text-slate-600">·</span>
        <span className="text-xs text-gray-400 dark:text-slate-500">{vendor.carton_count} cartons · {totalUnits} units</span>
        {isSearching && (
          <span className="text-blue-500 dark:text-blue-400 text-xs font-medium ml-1">· {vendor.line_items.length} matching</span>
        )}
      </button>

      {isExpanded && (
        <div className="bg-gray-50 dark:bg-slate-900/50 px-4 py-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-700">
                  {['SKU', 'Item Name', 'Incoming', 'Current', 'Future', 'MMA', 'DOC', 'Logo', 'Pkg', 'Manual', 'OPP'].map((label, i) => (
                    <th
                      key={label}
                      className={`py-2 px-3 text-[10px] font-bold text-gray-500 dark:text-slate-500 uppercase tracking-wider ${i < 2 ? 'text-left' : i > 6 ? 'text-center' : 'text-right'}`}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {vendor.line_items.map(item => (
                  <tr key={item.line_id} className="hover:bg-white dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-2.5 px-3 font-mono text-[11px] font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">{item.sku}</td>
                    <td className="py-2.5 px-3 text-gray-700 dark:text-slate-300 whitespace-nowrap">{item.item_name}</td>
                    <td className="py-2.5 px-3 text-right font-bold text-gray-900 dark:text-white">{item.incoming_qty}</td>
                    <td className="py-2.5 px-3 text-right text-gray-500 dark:text-slate-400">{item.current_stock ?? '—'}</td>
                    <td className="py-2.5 px-3 text-right font-medium text-gray-800 dark:text-slate-100">{item.future_stock ?? '—'}</td>
                    <td className="py-2.5 px-3 text-right text-gray-500 dark:text-slate-400">{item.mma ?? '—'}</td>
                    <td className="py-2.5 px-3 text-right"><DOCBadge doc={item.doc_after_arrival} /></td>
                    <td className="py-2.5 px-3 text-center"><CheckCell value={item.has_logo} /></td>
                    <td className="py-2.5 px-3 text-center"><CheckCell value={item.has_packaging} /></td>
                    <td className="py-2.5 px-3 text-center"><CheckCell value={item.has_manual} /></td>
                    <td className="py-2.5 px-3 text-center"><CheckCell value={item.has_opp_wrap} /></td>
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

  const formatDate = (dateString: string) => {
    if (!dateString) return 'TBA';
    const d = new Date(dateString);
    return isNaN(d.getTime()) ? dateString : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div className="max-w-[1600px] mx-auto pb-24 p-4">

      {isLoading ? (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
          <ArrowPathIcon className="w-10 h-10 text-blue-500 animate-spin mb-4" />
          <p className="text-base text-gray-500 dark:text-slate-300 font-medium">Loading batch details...</p>
          {renderDebugPanel()}
        </div>
      ) : error || !batch ? (
        <div className="flex flex-col items-center justify-center min-h-[400px]">
          <div className="text-center bg-white dark:bg-slate-800 p-10 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm max-w-md">
            <ExclamationTriangleIcon className="w-12 h-12 mx-auto text-red-500 mb-4 opacity-70" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{error ? 'Network Error' : 'Batch Not Found'}</h2>
            <p className="text-gray-500 dark:text-slate-400 mb-6 text-sm">{error || 'The requested batch could not be found.'}</p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={onBack} className="flex-1">Back to List</Button>
              <Button onClick={loadBatch} className="flex-1 bg-blue-600">Retry</Button>
            </div>
          </div>
          {renderDebugPanel()}
        </div>
      ) : (
        <>
          {/* Top bar — back + batch ID + badges + search all in one line */}
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-xs font-bold text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700"
            >
              <ArrowLeftIcon className="w-3.5 h-3.5" /> Back
            </button>
            <div className="flex items-center gap-2">
              {batch.batch_type === 'sea'
                ? <ShipIcon className="w-5 h-5 text-gray-400 dark:text-slate-500" />
                : <AirplaneIcon className="w-5 h-5 text-gray-400 dark:text-slate-500" />
              }
              <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">{batch.batch_id}</h1>
            </div>
            <StatusBadge status={batch.status} />
            {batch.is_delayed && (
              <span className="px-2.5 py-1 bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400 text-[10px] font-bold rounded uppercase tracking-wide border border-red-200 dark:border-red-500/20">
                Delayed {batch.delay_days}d
              </span>
            )}
            <div className="ml-auto relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
              <input
                type="text"
                placeholder="Search SKU or item name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-8 py-1.5 text-sm bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 w-60"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-white">
                  <XMarkIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Compact info strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden mb-4">
            <div className="px-4 py-3 border-r border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
              <p className="text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wider font-bold mb-1">Carrier & Tracking</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">{batch.carrier || '—'}</p>
              <p className="text-[11px] font-mono text-gray-400 dark:text-slate-500 mt-0.5">{batch.tracking_number || 'No tracking #'}</p>
            </div>
            <div className="px-4 py-3 border-r border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
              <p className="text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wider font-bold mb-1">Expected Delivery</p>
              <p className={`text-sm font-semibold ${batch.is_delayed ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-slate-100'}`}>
                {formatDate(batch.expected_delivery)}
              </p>
              {batch.actual_delivery
                ? <p className="text-[11px] text-green-600 dark:text-green-500 mt-0.5">Delivered: {formatDate(batch.actual_delivery)}</p>
                : batch.is_delayed
                ? <p className="text-[11px] text-red-500 mt-0.5">{batch.delay_days}d overdue</p>
                : null
              }
            </div>
            <div className="px-4 py-3 border-r border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
              <p className="text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wider font-bold mb-1">Quantities</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">{batch.total_units} units · {batch.total_cartons} cartons</p>
              <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">{batch.total_vendors} vendor{batch.total_vendors !== 1 ? 's' : ''}</p>
            </div>
            <div className="px-4 py-3 bg-gray-50 dark:bg-slate-800/50">
              <p className="text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wider font-bold mb-1">Mode</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                {batch.batch_type === 'sea' ? '🚢 Sea Freight' : '✈️ Air Freight'}
              </p>
              <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">{batch.batch_id}</p>
            </div>
          </div>

          {/* Shipment contents */}
          <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900/40 flex items-center gap-2">
              <ArchiveBoxIcon className="w-4 h-4 text-gray-400 dark:text-slate-500" />
              <h2 className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-widest">
                Shipment Contents
              </h2>
              <span className="text-xs text-gray-400 dark:text-slate-600 font-normal lowercase">
                ({filteredVendors.length} shipment{filteredVendors.length !== 1 ? 's' : ''})
              </span>
            </div>

            {filteredVendors.length === 0 ? (
              <div className="text-center py-16 px-6">
                <MagnifyingGlassIcon className="w-10 h-10 mx-auto text-gray-300 dark:text-slate-600 mb-3 opacity-50" />
                <p className="text-base font-bold text-gray-500 dark:text-slate-300 mb-1">No items found</p>
                <p className="text-sm text-gray-400 dark:text-slate-500">Try a different SKU or item name</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-slate-700">
                {filteredVendors.map(vendor => (
                  <VendorShipmentRow
                    key={vendor.shipment_id}
                    vendor={vendor}
                    isExpanded={expandedVendors.has(vendor.shipment_id)}
                    onToggle={() => toggleVendor(vendor.shipment_id)}
                    isSearching={searchTerm.trim().length > 0}
                  />
                ))}
              </div>
            )}
          </div>

          {batch.notes && (
            <div className="mt-4 bg-gray-50 dark:bg-slate-800/40 p-4 rounded-lg border border-gray-200 dark:border-slate-700/50">
              <div className="flex items-center gap-2 mb-2">
                <DocumentTextIcon className="w-4 h-4 text-gray-400 dark:text-slate-500" />
                <h3 className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">Notes</h3>
              </div>
              <p className="text-gray-600 dark:text-slate-300 text-sm italic leading-relaxed border-l-2 border-gray-200 dark:border-slate-700 pl-3">"{batch.notes}"</p>
            </div>
          )}

          {renderDebugPanel()}
        </>
      )}
    </div>
  );
};