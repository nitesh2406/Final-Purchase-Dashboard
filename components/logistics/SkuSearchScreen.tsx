import React, { useState, useCallback } from 'react';
import { MagnifyingGlassIcon, BoxIcon, ArrowPathIcon, ShipIcon, AirplaneIcon } from '../icons/Icons';
import { SkuShipmentSearchResult } from '../../types';
import { callGasAuthed } from '../../services/gasApi';

const STATUS_BADGE: Record<string, string> = {
  'Delivered': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300',
};
const DEFAULT_BADGE = 'bg-blue-100 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400';

interface SkuSearchScreenProps {
  onNavigateToBatch?: (id: string) => void;
}

// NEW dedicated cross-batch SKU/item search screen (Section D of the
// Shipment Tracker spec) — "which shipments is this SKU coming in on"
// used to mean opening batches one at a time; this is a single search.
export const SkuSearchScreen: React.FC<SkuSearchScreenProps> = ({ onNavigateToBatch }) => {
  const [query, setQuery] = useState('');
  const [includeDelivered, setIncludeDelivered] = useState(false);
  const [results, setResults] = useState<SkuShipmentSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async (q: string, delivered: boolean) => {
    const trimmed = q.trim();
    if (!trimmed) { setResults([]); setHasSearched(false); return; }

    setIsLoading(true);
    setError(null);
    try {
      const result = await callGasAuthed('search_sku_shipments', { query: trimmed, includeDelivered: delivered });
      if (result.status === 'success') {
        setResults(result.results || []);
      } else {
        throw new Error(result.message || 'Search failed');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
      setResults([]);
    } finally {
      setIsLoading(false);
      setHasSearched(true);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(query, includeDelivered);
  };

  const handleToggleDelivered = (checked: boolean) => {
    setIncludeDelivered(checked);
    if (hasSearched) runSearch(query, checked);
  };

  return (
    <div className="p-6 max-w-[1200px] mx-auto animate-in fade-in duration-500 pb-24">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">SKU / Item Search</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">Find every shipment an item is coming in on, across all batches</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 mb-6 shadow-sm">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              autoFocus
              placeholder="Search by SKU or item name..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !query.trim()}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2"
          >
            {isLoading ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <MagnifyingGlassIcon className="w-4 h-4" />}
            Search
          </button>
        </div>
        <label className="flex items-center gap-2 mt-3 text-xs text-slate-500 dark:text-slate-400 font-medium cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeDelivered}
            onChange={(e) => handleToggleDelivered(e.target.checked)}
            className="rounded border-slate-300 dark:border-slate-600"
          />
          Also include Delivered batches (defaults to active/in-transit only)
        </label>
      </form>

      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl p-4 mb-6">
          <p className="text-red-600 dark:text-red-400 text-sm font-medium">{error}</p>
        </div>
      )}

      {!hasSearched && !isLoading ? (
        <div className="text-center py-24 bg-white dark:bg-slate-800 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 shadow-sm">
          <MagnifyingGlassIcon className="w-16 h-16 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <p className="text-lg text-slate-600 dark:text-slate-300 font-medium">Search for a SKU or item name</p>
          <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Results show every shipment that item appears in, across all batches</p>
        </div>
      ) : hasSearched && !isLoading && results.length === 0 ? (
        <div className="text-center py-24 bg-white dark:bg-slate-800 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 shadow-sm">
          <BoxIcon className="w-16 h-16 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <p className="text-lg text-slate-600 dark:text-slate-300 font-medium">No shipments found for "{query}"</p>
          <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Try a different SKU code or item name{!includeDelivered && ', or include Delivered batches'}</p>
        </div>
      ) : (
        <div className={`bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
            {results.length} matching shipment{results.length !== 1 ? 's' : ''}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/50 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200 dark:border-slate-700">
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Item Name</th>
                  <th className="px-4 py-3">Batch ID</th>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3 text-right">Quantity</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {results.map((r, idx) => (
                  <tr
                    key={`${r.batch_id}-${r.sku}-${idx}`}
                    onClick={() => onNavigateToBatch && onNavigateToBatch(r.batch_id)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium text-blue-600 dark:text-blue-400 whitespace-nowrap">{r.sku}</td>
                    <td className="px-4 py-3 text-sm text-slate-800 dark:text-slate-300">{r.item_name}</td>
                    <td className="px-4 py-3 font-mono font-bold text-sm text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        {r.batch_type === 'air' ? <AirplaneIcon className="w-3.5 h-3.5 text-slate-400" /> : <ShipIcon className="w-3.5 h-3.5 text-slate-400" />}
                        {r.batch_id}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300 whitespace-nowrap">{r.vendor_code}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-slate-900 dark:text-slate-100">{r.quantity}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${STATUS_BADGE[r.status] || DEFAULT_BADGE}`}>
                        {r.status}
                      </span>
                    </td>
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
