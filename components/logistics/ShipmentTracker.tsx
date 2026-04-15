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
  ChevronDownIcon,
  ArrowPathIcon
} from '../icons/Icons';
import { Batch, BatchFilters, BatchMetrics } from '../../types';
import { APPS_SCRIPT_URL } from '../../App';
import { Button } from '../ui/Button';

let trackerCache: {
  batches: Batch[];
  metrics: BatchMetrics | null;
  timestamp: number;
} | null = null;

interface ShipmentTrackerProps {
  onNavigateToBatch?: (id: string) => void;
}

const STATUS_CONFIG: Record<string, { label: string; border: string; badge: string }> = {
  'Shipped':            { label: 'Shipped',            border: 'border-l-purple-500',  badge: 'bg-purple-100 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400' },
  'In-Transit China':   { label: 'In-Transit China',   border: 'border-l-blue-500',    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400' },
  'At Port China':      { label: 'At Port China',      border: 'border-l-cyan-500',    badge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-400' },
  'In-Transit Ocean':   { label: 'In-Transit Ocean',   border: 'border-l-sky-500',     badge: 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400' },
  'In-Transit Air':     { label: 'In-Transit Air',     border: 'border-l-indigo-500',  badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400' },
  'Customs Clearance':  { label: 'Customs Clearance',  border: 'border-l-yellow-500',  badge: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400' },
  'In-Transit India':   { label: 'In-Transit India',   border: 'border-l-green-500',   badge: 'bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400' },
  'Out for Delivery':   { label: 'Out for Delivery',   border: 'border-l-emerald-500', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
  'Delivered':          { label: 'Delivered',          border: 'border-l-emerald-600', badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300' },
  'OPEN':               { label: 'Open',               border: 'border-l-slate-400',   badge: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300' },
};

const getStatusConfig = (status: string) =>
  STATUS_CONFIG[status] || { label: status, border: 'border-l-slate-400', badge: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300' };

const formatDate = (dateString: string | null) => {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const ShipmentTracker: React.FC<ShipmentTrackerProps> = ({ onNavigateToBatch }) => {
  const [batches, setBatches] = useState<Batch[]>(trackerCache?.batches || []);
  const [metrics, setMetrics] = useState<BatchMetrics | null>(trackerCache?.metrics || null);
  const [filters, setFilters] = useState<BatchFilters>({ search: '', status: 'All', mode: 'All' });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [lastRequest, setLastRequest] = useState<any>(null);
  const [lastResponse, setLastResponse] = useState<any>(null);

  const fetchData = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh && trackerCache) {
      setBatches(trackerCache.batches);
      setMetrics(trackerCache.metrics);
      return;
    }
    setIsLoading(true);
    setError(null);
    const payload = { action: 'get_batches' };
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
        const newBatches = result.batches || [];
        const newMetrics = result.metrics || null;
        setBatches(newBatches);
        setMetrics(newMetrics);
        trackerCache = { batches: newBatches, metrics: newMetrics, timestamp: Date.now() };
      } else {
        throw new Error(result.message || 'Failed to load batches');
      }
    } catch (err: any) {
      setError(err.message || 'Network Failure');
    } finally {
      setIsLoading(false);
    }
  }, []);


  useEffect(() => { fetchData(false); }, [fetchData]);

  const filteredBatches = useMemo(() => {
    let filtered = [...batches];
    if (filters.search) {
      const s = filters.search.toLowerCase();
      filtered = filtered.filter(b =>
        String(b.batch_id || '').toLowerCase().includes(s) ||
        String(b.tracking_number || '').toLowerCase().includes(s) ||
        String(b.carrier || '').toLowerCase().includes(s)
      );
    }
    if (filters.status !== 'All') filtered = filtered.filter(b => b.status === filters.status);
    if (filters.mode !== 'All') filtered = filtered.filter(b => b.batch_type === filters.mode);
    // Sort by ETA ascending, nulls last
    filtered.sort((a, b) => {
      if (!a.expected_delivery && !b.expected_delivery) return 0;
      if (!a.expected_delivery) return 1;
      if (!b.expected_delivery) return -1;
      return new Date(a.expected_delivery).getTime() - new Date(b.expected_delivery).getTime();
    });
    return filtered;
  }, [batches, filters]);

  return (
    <div className="p-6 max-w-[1600px] mx-auto pb-24">

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Active Batches', value: metrics?.activeBatches || 0, icon: BoxIcon, color: 'text-blue-500' },
          { label: 'In-Transit Value', value: `₹${((metrics?.inTransitValue || 0) / 100000).toFixed(2)}L`, icon: BanknotesIcon, color: 'text-emerald-500' },
          { label: 'Arriving This Week', value: metrics?.arrivingThisWeek || 0, icon: TruckIcon, color: 'text-yellow-500' },
          { label: 'Delayed Shipments', value: metrics?.delayedShipments || 0, icon: ExclamationTriangleIcon, color: 'text-red-500' },
        ].map((card, i) => {
          const Icon = card.icon;
          return (
            <div key={i} className="bg-white dark:bg-slate-800 px-4 py-3 rounded-lg border border-gray-200 dark:border-slate-700 shadow-sm flex items-center gap-3">
              <Icon className={`w-5 h-5 ${card.color} shrink-0`} />
              <div>
                <p className="text-[10px] text-gray-500 dark:text-slate-400 font-bold uppercase tracking-wide leading-none mb-0.5">{card.label}</p>
                <p className="text-xl font-bold text-gray-900 dark:text-slate-100 leading-none">{card.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-slate-800 px-4 py-3 rounded-lg border border-gray-200 dark:border-slate-700 mb-4 shadow-sm">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="flex-1 relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder="Search by Batch ID, Carrier, Tracking..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-gray-900 dark:text-slate-100 text-sm placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value as any })}
            className="px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-gray-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          <div className="flex gap-1 p-1 bg-gray-100 dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700">
            {(['All', 'sea', 'air'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setFilters({ ...filters, mode })}
                className={`px-4 py-1.5 rounded-md font-bold text-xs transition-all uppercase ${
                  filters.mode === mode
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
                }`}
              >
                {mode === 'All' ? 'ALL' : mode === 'sea' ? '🚢 SEA' : '✈️ AIR'}
              </button>
            ))}
          </div>
          <button
            onClick={() => fetchData(true)}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg text-xs font-bold text-gray-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-400 transition-all disabled:opacity-50"
          >
            <ArrowPathIcon className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4 mb-6 flex items-center gap-3">
          <ExclamationTriangleIcon className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-red-600 dark:text-red-400 text-sm font-medium">{error}</p>
          <button onClick={() => fetchData(true)} className="ml-auto text-xs text-red-500 hover:text-red-700 font-bold underline">Retry</button>
        </div>
      )}

      {/* Count + sync */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] text-gray-500 dark:text-slate-500 font-bold uppercase tracking-widest">
          Showing {filteredBatches.length} of {batches.length} batches
        </p>
        {trackerCache && (
          <span className="text-[9px] text-gray-400 dark:text-slate-500 italic">
            Last synced: {new Date(trackerCache.timestamp).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b-2 border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900">
                <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider border-r border-gray-200 dark:border-slate-700 w-[20%]">
                  Batch Info
                </th>
                <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider border-r border-gray-200 dark:border-slate-700 w-[25%]">
                  Logistics
                </th>
                <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider border-r border-gray-200 dark:border-slate-700 w-[25%]">
                  Quantities
                </th>
                <th className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider w-[30%]">
                  Status & ETA
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {isLoading && !trackerCache ? (
                [...Array(4)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[1,2,3,4].map(j => (
                      <td key={j} className="px-4 py-4">
                        <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredBatches.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-16 text-center">
                    <BoxIcon className="w-10 h-10 mx-auto text-gray-300 dark:text-slate-600 mb-3" />
                    <p className="text-gray-500 dark:text-slate-400 font-medium">No batches found</p>
                    <button
                      onClick={() => setFilters({ search: '', status: 'All', mode: 'All' })}
                      className="mt-3 text-xs text-blue-500 hover:underline"
                    >
                      Clear filters
                    </button>
                  </td>
                </tr>
              ) : (
                filteredBatches.map(batch => {
                  const sc = getStatusConfig(batch.status);
                  const ModeIcon = batch.batch_type === 'sea' ? ShipIcon : AirplaneIcon;
                  const isExpanded = expandedBatchId === batch.batch_id;

                  return (
                    <React.Fragment key={batch.batch_id}>
                      {/* Main row */}
                      <tr
                        onClick={() => setExpandedBatchId(prev => prev === batch.batch_id ? null : batch.batch_id)}
                        className={`border-l-[5px] ${sc.border} cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/50 ${isExpanded ? 'bg-blue-50/50 dark:bg-blue-500/5' : 'bg-white dark:bg-slate-800'}`}
                      >
                        {/* BATCH INFO */}
                        <td className="px-4 py-3 border-r border-gray-100 dark:border-slate-700">
                          <div className="flex items-center gap-3">
                            <ChevronDownIcon className={`w-4 h-4 text-gray-400 dark:text-slate-500 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                            <div>
                              <p className="font-bold text-gray-900 dark:text-slate-100 text-sm font-mono">{batch.batch_id}</p>
                              <div className="flex items-center gap-1 mt-0.5">
                                <ModeIcon className="w-3 h-3 text-gray-400 dark:text-slate-500" />
                                <span className="text-[10px] text-gray-500 dark:text-slate-400 uppercase font-semibold">{batch.batch_type}</span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* LOGISTICS */}
                        <td className="px-4 py-3 border-r border-gray-100 dark:border-slate-700">
                          <p className="text-sm font-semibold text-gray-800 dark:text-slate-200">
                            {batch.carrier || <span className="text-gray-300 dark:text-slate-600 font-normal italic">No carrier</span>}
                          </p>
                          <p className="text-[11px] font-mono text-gray-500 dark:text-slate-400 mt-0.5">
                            {batch.tracking_number || <span className="text-gray-300 dark:text-slate-600 italic">No tracking</span>}
                          </p>
                          {(batch as any).vendor_summary?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {(batch as any).vendor_summary.map((v: any) => (
                                <span key={v.shipment_id} className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-500/20">
                                  {v.vendor_code}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>

                        {/* QUANTITIES */}
                        <td className="px-4 py-3 border-r border-gray-100 dark:border-slate-700">
                          <div className="flex items-center gap-3 text-sm">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-gray-400 dark:text-slate-500 font-bold uppercase">V</span>
                              <span className="font-bold text-gray-900 dark:text-slate-100">{batch.total_vendors}</span>
                            </div>
                            <span className="text-gray-300 dark:text-slate-600">·</span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-gray-400 dark:text-slate-500 font-bold uppercase">C</span>
                              <span className="font-bold text-gray-900 dark:text-slate-100">{batch.total_cartons}</span>
                            </div>
                            <span className="text-gray-300 dark:text-slate-600">·</span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-gray-400 dark:text-slate-500 font-bold uppercase">U</span>
                              <span className="font-bold text-gray-900 dark:text-slate-100">{batch.total_units}</span>
                            </div>
                          </div>
                          <p className="text-[9px] text-gray-400 dark:text-slate-600 mt-0.5">Vendors · Cartons · Units</p>
                        </td>

                        {/* STATUS & ETA */}
                        <td className="px-4 py-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1.5">
                              <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${sc.badge}`}>
                                {sc.label}
                              </span>
                              {batch.is_delayed && (
                                <div className="flex items-center gap-1 text-red-500">
                                  <ExclamationTriangleIcon className="w-3 h-3" />
                                  <span className="text-[10px] font-bold">Delayed {batch.delay_days}d</span>
                                </div>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] text-gray-400 dark:text-slate-500 uppercase font-bold">ETA</p>
                              <p className={`text-sm font-bold ${batch.is_delayed ? 'text-red-500' : 'text-gray-900 dark:text-slate-100'}`}>
                                {formatDate(batch.expected_delivery)}
                              </p>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); if (onNavigateToBatch) onNavigateToBatch(batch.batch_id); }}
                              className="shrink-0 p-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors"
                              title="View full details"
                            >
                              <ChevronRightIcon className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded vendor sub-rows — uses vendor_summary from batch data, no API call */}
                      {isExpanded && (
                        <tr className="bg-gray-50 dark:bg-slate-900/50">
                          <td colSpan={4} className="px-8 py-3 border-l-4 border-l-transparent">
                            {(batch as any).vendor_summary?.length > 0 ? (
                              <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-slate-700">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="bg-gray-100 dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
                                      <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase">Vendor</th>
                                      <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase">Shipment ID</th>
                                      <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase">Invoice No</th>
                                      <th className="px-4 py-2 text-left text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase">Invoice Date</th>
                                      <th className="px-4 py-2 text-right text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase">Cartons</th>
                                      <th className="px-4 py-2 text-right text-[10px] font-bold text-gray-500 dark:text-slate-400 uppercase">Units</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                                    {(batch as any).vendor_summary.map((vs: any) => (
                                      <tr key={vs.shipment_id} className="bg-white dark:bg-slate-800/50 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors">
                                        <td className="px-4 py-2.5">
                                          <span className="font-bold text-gray-900 dark:text-slate-100 text-xs">{vs.vendor_code}</span>
                                        </td>
                                        <td className="px-4 py-2.5 font-mono text-[11px] text-blue-600 dark:text-blue-400">{vs.shipment_id}</td>
                                        <td className="px-4 py-2.5 text-xs text-gray-600 dark:text-slate-300">{vs.invoice_no || '—'}</td>
                                        <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">{vs.invoice_date || '—'}</td>
                                        <td className="px-4 py-2.5 text-right text-xs font-semibold text-gray-900 dark:text-slate-100">{vs.carton_count}</td>
                                        <td className="px-4 py-2.5 text-right text-xs font-semibold text-gray-900 dark:text-slate-100">{vs.total_units}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="text-sm text-gray-400 dark:text-slate-500 py-2 italic">No vendor data available.</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Debug Panel */}
      <div className="mt-12 pt-8 border-t border-gray-200 dark:border-slate-800">
        <button
          onClick={() => setShowDebug(!showDebug)}
          className="text-[10px] font-bold text-gray-400 dark:text-slate-400 hover:text-blue-500 uppercase tracking-widest transition-colors flex items-center gap-2"
        >
          <ArrowPathIcon className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          {showDebug ? 'Hide Network Debug Info' : 'Show Network Debug Info'}
        </button>
        {showDebug && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            <div className="space-y-1">
              <span className="text-[9px] font-bold text-gray-500 dark:text-slate-500 uppercase">Last Request</span>
              <pre className="bg-gray-900 border border-gray-800 p-4 rounded-lg text-[10px] font-mono text-slate-400 overflow-auto max-h-[300px]">
                {lastRequest ? JSON.stringify(lastRequest, null, 2) : '// No request recorded'}
              </pre>
            </div>
            <div className="space-y-1">
              <span className="text-[9px] font-bold text-gray-500 dark:text-slate-500 uppercase">Last Response</span>
              <pre className="bg-gray-900 border border-gray-800 p-4 rounded-lg text-[10px] font-mono text-slate-400 overflow-auto max-h-[300px]">
                {lastResponse ? JSON.stringify(lastResponse, null, 2) : '// No response recorded'}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};