import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { AmazonChannelSku } from '../types/amazon';
import { AmazonSkuModal } from '../components/amazon/AmazonSkuModal';
import { APPS_SCRIPT_URL } from '../App';

// ─── Module-level cache (persists across tab switches) ───────────────────────
// Declared outside component so it survives unmount/remount
let _amazonCache: AmazonChannelSku[] | null = null;
let _amazonCacheTime: Date | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const velocityColor = (band: string) => {
  if (band === 'fast')   return 'bg-green-500/20 text-green-400 border-green-500/30';
  if (band === 'medium') return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
  return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
};

const docColor = (days: number) => {
  if (days < 20) return 'text-red-500';
  if (days < 50) return 'text-amber-400';
  return 'text-green-400';
};

const formatDoc = (days: number) =>
  days === 999 ? '∞' : String(Math.round(days));

// ─── Filter Chips ─────────────────────────────────────────────────────────────

const FILTER_CHIPS = ['All', 'Needs Ship', 'Slow', 'Medium', 'Fast', '⚠ Listing', '🚢 Inbound', '🚫 Excluded'] as const;
type FilterChip = typeof FILTER_CHIPS[number];

// ─── Sortable Header ──────────────────────────────────────────────────────────

const SortableHeader: React.FC<{
  label: string;
  sortKey: string;
  sortConfig: { key: string; direction: 'asc' | 'desc' };
  onSort: (key: string) => void;
  className?: string;
  right?: boolean;
  center?: boolean;
  title?: string;
}> = ({ label, sortKey, sortConfig, onSort, className = '', right, center, title }) => (
  <th
    className={`px-3 py-2 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 ${right ? 'text-right' : center ? 'text-center' : 'text-left'} ${className}`}
    onClick={() => onSort(sortKey)}
    title={title}
  >
    <div className={`flex items-center gap-1 ${right ? 'justify-end' : center ? 'justify-center' : ''}`}>
      {label}
      {sortConfig.key === sortKey && (
        <span className="text-orange-500">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
      )}
    </div>
  </th>
);

// ─── Main Component ───────────────────────────────────────────────────────────

interface AmazonForecastingProps {
  amazonConfig?: any;
  onConfigUpdate?: () => void;
}

export const AmazonForecasting: React.FC<AmazonForecastingProps> = ({ amazonConfig: _amazonConfig, onConfigUpdate: _onConfigUpdate }) => {

  // ── Core state ──────────────────────────────────────────────────────────────
  const [skus, setSkus] = useState<AmazonChannelSku[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [selectedSku, setSelectedSku] = useState<AmazonChannelSku | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterChip>('All');
  
  // ── Sort state ──────────────────────────────────────────────────────────────
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'channelSKU', direction: 'asc' });

  // ── Selection state ─────────────────────────────────────────────────────────
  const [selectedChannelSkus, setSelectedChannelSkus] = useState<Set<string>>(new Set());

  // ── Ship Qty Override state ─────────────────────────────────────────────────
  const [shipQtyOverrides, setShipQtyOverrides] = useState<Record<string, number>>({});

  // ── Confirm plan state ──────────────────────────────────────────────────────
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState<{ success: boolean; message: string; poNumber?: string } | null>(null);
  const [showVolumeWarning, setShowVolumeWarning] = useState(false);

  // ── API fetch ────────────────────────────────────────────────────────────────
  const fetchForecast = useCallback(async (forceRefresh = false) => {
    // Use cache if available and not forcing refresh
    if (!forceRefresh && _amazonCache) {
      setSkus(_amazonCache);
      setLastRefreshed(_amazonCacheTime);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'get_amazon_forecast' }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.status === 'error') throw new Error(data.message);
      if (!Array.isArray(data.data)) throw new Error('Invalid response format');

      // Update module-level cache
      _amazonCache     = data.data;
      _amazonCacheTime = new Date();

      setSkus(data.data);
      setLastRefreshed(_amazonCacheTime);
      // Reset selections and overrides on new fetch
      setSelectedChannelSkus(new Set());
      setShipQtyOverrides({});
    } catch (e: any) {
      setError(e.message || 'Unknown error');
      setSkus([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchForecast(false);  // uses cache if available
  }, [fetchForecast]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const getShipQty = (item: AmazonChannelSku) => shipQtyOverrides[item.channelSKU] ?? item.allocation.shippingPlanQty;
  const updateShipQty = (channelSku: string, qty: number, availableQty?: number) => {
    const capped = availableQty !== undefined ? Math.min(qty, availableQty) : qty;
    setShipQtyOverrides(prev => ({ ...prev, [channelSku]: Math.max(0, capped) }));
  };
  
  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const toggleSelect = (channelSku: string) => {
    setSelectedChannelSkus(prev => {
      const next = new Set(prev);
      next.has(channelSku) ? next.delete(channelSku) : next.add(channelSku);
      return next;
    });
  };

  // ── Filtering & Sorting ───────────────────────────────────────────────────────
  const flatItems = useMemo(() => {
    // 1. Filter
    const filtered = skus.filter(item => {
      const matchSearch = !search ||
        item.channelSKU.toLowerCase().includes(search.toLowerCase()) ||
        item.productName.toLowerCase().includes(search.toLowerCase()) ||
        item.masterSKU.toLowerCase().includes(search.toLowerCase());

      const matchFilter =
        activeFilter === 'All'        ? !item.isExcluded :
        activeFilter === 'Needs Ship' ? item.needsReplenishment && !item.isExcluded :
        activeFilter === 'Slow'       ? item.replenishment.velocityBand === 'slow' && !item.isExcluded :
        activeFilter === 'Medium'     ? item.replenishment.velocityBand === 'medium' && !item.isExcluded :
        activeFilter === 'Fast'       ? item.replenishment.velocityBand === 'fast' && !item.isExcluded :
        activeFilter === '⚠ Listing'  ? item.hasListingIssue && !item.isExcluded :
        activeFilter === '🚢 Inbound' ? item.inTransitWarning?.hasWarning === true && !item.isExcluded :
        activeFilter === '🚫 Excluded' ? item.isExcluded : true;

      return matchSearch && matchFilter;
    });

    // 2. Sort flat list
    return [...filtered].sort((a, b) => {
      const dir = sortConfig.direction === 'asc' ? 1 : -1;
      switch (sortConfig.key) {
        case 'channelSKU':   return dir * a.channelSKU.localeCompare(b.channelSKU);
        case 'masterSKU':    return dir * a.masterSKU.localeCompare(b.masterSKU);
        case 'mma':          return dir * (a.mma.final - b.mma.final);
        case 'docDays':      return dir * (a.amazonInventory.docDays - b.amazonInventory.docDays);
        case 'fbaQty':       return dir * (a.amazonInventory.fbaQty - b.amazonInventory.fbaQty);
        case 'inbound':      return dir * (a.amazonInventory.inbound - b.amazonInventory.inbound);
        case 'whAvail':      return dir * (a.warehouseCheck.availableQty - b.warehouseCheck.availableQty);
        case 'recommended':  return dir * (a.replenishment.recommendedQty - b.replenishment.recommendedQty);
        case 'shipQty':      return dir * (getShipQty(a) - getShipQty(b));
        case 'velocityBand': {
          const order: Record<string, number> = { fast: 0, medium: 1, slow: 2 };
          return dir * ((order[a.replenishment.velocityBand] || 0) - (order[b.replenishment.velocityBand] || 0));
        }
        default: return 0;
      }
    });
  }, [skus, search, activeFilter, sortConfig, shipQtyOverrides]);

  // ── Selection helper ──────────────────────────────────────────────────────────
  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedChannelSkus(new Set(flatItems.map(i => i.channelSKU)));
    } else {
      setSelectedChannelSkus(new Set());
    }
  };

  const selectedCount = selectedChannelSkus.size;
  const totalVisible  = flatItems.length;

  // ── Summary stats ──────────────────────────────────────────────────────────
  const totalSkus     = skus.length; // (total from API, unfiltered)
  const needShipCount = flatItems.filter(i => i.needsReplenishment).length;
  const totalUnits    = flatItems.reduce((s, i) => s + getShipQty(i), 0);

  // ── Confirm Plan ───────────────────────────────────────────────────────────
  const confirmTotalUnits = useMemo(() => {
    return flatItems
      .filter(item =>
        (selectedChannelSkus.size === 0 || selectedChannelSkus.has(item.channelSKU)) &&
        getShipQty(item) > 0
      )
      .reduce((s, item) => s + getShipQty(item), 0);
  }, [flatItems, selectedChannelSkus, shipQtyOverrides]);

  const handleConfirmPlan = async () => {
    // Volume warning — warn if > 1000 units but allow bypass
    if (confirmTotalUnits > 1000 && !showVolumeWarning) {
      setShowVolumeWarning(true);
      return; // Stop here — user must confirm warning first
    }
    setShowVolumeWarning(false);

    const itemsToConfirm = flatItems
      .filter(item =>
        (selectedChannelSkus.size === 0 || selectedChannelSkus.has(item.channelSKU)) &&
        getShipQty(item) > 0
      )
      // .map(item => {
      //   const overriddenQty = shipQtyOverrides[item.channelSKU];
      //   return {
      //     ...item,
      //     allocation: {
      //       ...item.allocation,
      //       finalAllocatedQty: overriddenQty ?? item.allocation.finalAllocatedQty,
      //       shippingPlanQty:   overriddenQty ?? item.allocation.shippingPlanQty,
      //       isManualOverride:  overriddenQty !== undefined,
      //       overrideReason:    overriddenQty !== undefined ? 'Manual split adjustment' : '',
      //     },
      //   };
      // });
      .map(item => {
  // Always use getShipQty — this is what the user sees in the Ship Qty column
  // Uses manual override if set, otherwise falls back to shippingPlanQty (GAS auto qty)
  const confirmedQty = getShipQty(item);
  return {
    ...item,
    allocation: {
      ...item.allocation,
      finalAllocatedQty: confirmedQty,
      shippingPlanQty:   confirmedQty,
      isManualOverride:  shipQtyOverrides[item.channelSKU] !== undefined,
      overrideReason:    shipQtyOverrides[item.channelSKU] !== undefined ? 'Manual adjustment' : '',
    },
  };
});

    if (itemsToConfirm.length === 0) {
      alert('No items to confirm. All selected SKUs either have 0 ship qty or do not need replenishment.');
      return;
    }

    // Validate available stock per master SKU for confirmed items
    const masterTotals: Record<string, { assigned: number; available: number }> = {};
    for (const item of itemsToConfirm) {
        if (!masterTotals[item.masterSKU]) {
            masterTotals[item.masterSKU] = { assigned: 0, available: item.warehouseCheck.availableQty };
        }
        //masterTotals[item.masterSKU].assigned += item.allocation.shippingPlanQty;
        masterTotals[item.masterSKU].assigned += item.allocation.finalAllocatedQty;
    }

    for (const [masterSKU, totals] of Object.entries(masterTotals)) {
        if (totals.assigned > totals.available) {
            alert(`Cannot confirm: ${masterSKU} total allocation (${totals.assigned}) exceeds available stock (${totals.available}).`);
            return;
        }
    }

    setIsConfirming(true);
    setConfirmResult(null);

    try {
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'confirm_amazon_shipment_plan', items: itemsToConfirm }),
      });
      const result = await response.json();
      if (result.status === 'success') {
        setConfirmResult({ success: true, message: result.message, poNumber: result.poNumber });
        setTimeout(() => setConfirmResult(null), 5000);
        // Refresh?
      } else {
        throw new Error(result.message || 'Confirm failed');
      }
    } catch (e: any) {
      setConfirmResult({ success: false, message: e.message });
    } finally {
      setIsConfirming(false);
    }
  };

  // ── Export CSV ─────────────────────────────────────────────────────────────
  const handleExportCsv = () => {
    const allItems = flatItems;
    if (allItems.length === 0) { alert('No data to export.'); return; }

    const headers = [
      'Channel SKU', 'Master SKU', 'Product Name',
      'MMA', 'DOC (days)', 'FBA Stock', 'Inbound', 'WH Available',
      'Velocity Band', 'Recommended Qty', 'Ship Qty',
      'Needs Replenishment', 'Listing Issue',
    ];

    const rows = allItems.map(item => [
      item.channelSKU,
      item.masterSKU,
      item.productName,
      item.mma.final,
      item.amazonInventory.docDays === 999 ? 'N/A' : item.amazonInventory.docDays,
      item.amazonInventory.fbaQty,
      item.amazonInventory.inbound,
      item.warehouseCheck.availableQty,
      item.replenishment.velocityBand,
      item.replenishment.recommendedQty,
      getShipQty(item),
      item.needsReplenishment ? 'Yes' : 'No',
      item.hasListingIssue ? 'Yes' : 'No',
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `amazon_forecast_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-950 text-gray-900 dark:text-white">

      {/* ── TOP BAR ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <span className="bg-orange-500/20 text-orange-400 border border-orange-500/30 px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0">
          🟠 Amazon FBA Mode
        </span>

        <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded text-xs flex-shrink-0">
          SKUs: {flatItems.length}
        </span>

        <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded text-xs flex-shrink-0">
          Need Ship: {needShipCount}
        </span>

        <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded text-xs flex-shrink-0">
          Units: {totalUnits.toLocaleString()}
        </span>

        {Object.keys(shipQtyOverrides).length > 0 && (
          <span className="text-xs text-orange-400 flex-shrink-0">
            ✎ {Object.keys(shipQtyOverrides).length} edited
          </span>
        )}
        {Object.keys(shipQtyOverrides).length > 0 && (
          <button
            onClick={() => setShipQtyOverrides({})}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 underline flex-shrink-0"
          >
            Reset
          </button>
        )}

        {lastRefreshed && (
          <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
            Updated {lastRefreshed.toLocaleTimeString()}
          </span>
        )}

        {/* Right */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setDebugMode(!debugMode)}
            className={`text-xs px-2 py-1 rounded border transition-colors ${
              debugMode
                ? 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                : 'text-gray-400 border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-400'
            }`}
          >
            🐛 Debug
          </button>

          <button
            onClick={() => fetchForecast(true)}
            disabled={isLoading}
            className="text-xs px-3 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-400 flex items-center gap-1 transition-colors disabled:opacity-50"
          >
            {isLoading ? '⏳' : '↻'} Refresh
          </button>

          <button
            onClick={handleExportCsv}
            className="text-xs px-3 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-400 transition-colors"
          >
            Export CSV
          </button>

          <button
            onClick={handleConfirmPlan}
            disabled={isConfirming || isLoading}
            className="text-xs px-3 py-1 rounded bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold flex items-center gap-1 transition-colors"
          >
            {isConfirming ? '⏳ Confirming...' : `Confirm Plan ▶${confirmTotalUnits > 0 ? ` (${confirmTotalUnits.toLocaleString()} units)` : ''}`}
          </button>
        </div>
      </div>

      {/* ── CONFIRM RESULT TOAST ─────────────────────────────────────────────── */}
      {confirmResult && (
        <div className={`flex items-center justify-between px-4 py-2 text-xs border-b flex-shrink-0 ${
          confirmResult.success
            ? 'bg-green-500/10 border-green-500/20 text-green-400'
            : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          <span>
            {confirmResult.success
              ? `✓ Plan confirmed — ${confirmResult.message}${confirmResult.poNumber ? ` (PO: ${confirmResult.poNumber})` : ''}`
              : `✗ Confirm failed: ${confirmResult.message}`}
          </span>
          <button onClick={() => setConfirmResult(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* ── VOLUME WARNING ──────────────────────────────────────────────────── */}
      {showVolumeWarning && (
        <div className="flex items-center justify-between px-4 py-2 text-xs border-b flex-shrink-0
                        bg-amber-500/10 border-amber-500/20 text-amber-400">
          <div className="flex items-center gap-2">
            <span>⚠</span>
            <span>
              <strong>Large shipment: {confirmTotalUnits.toLocaleString()} units.</strong>
              {' '}Recommended max is 1,000 units per shipment for same-day packing.
              Click Confirm again to proceed anyway.
            </span>
          </div>
          <button
            onClick={() => setShowVolumeWarning(false)}
            className="ml-4 opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── FILTER BAR ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 h-9 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 overflow-x-auto">
        <input
          type="text"
          placeholder="Search Channel SKU or product..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-6 text-xs px-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white w-52 focus:outline-none focus:border-orange-500 flex-shrink-0"
        />

        {FILTER_CHIPS.map(chip => (
          <button
            key={chip}
            onClick={() => setActiveFilter(chip)}
            className={`text-xs px-2.5 py-0.5 rounded-full border transition-colors flex-shrink-0 ${
              activeFilter === chip
                ? chip === '🚫 Excluded'
                  ? 'bg-red-500/20 text-red-400 border-red-500/40 font-medium'
                  : 'bg-orange-500/20 text-orange-400 border-orange-500/40 font-medium'
                : 'text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
            }`}
          >
            {chip}
          </button>
        ))}
      </div>

      {/* ── TABLE ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">

        {/* Loading */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading Amazon forecast...</p>
            </div>
          </div>

        /* Error */
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 text-red-500 text-center p-6">
            <span className="text-3xl mb-3">⚠</span>
            <p className="font-semibold mb-2">Failed to load forecast</p>
            <p className="text-xs font-mono bg-red-50 dark:bg-red-900/20 p-3 rounded border border-red-200 dark:border-red-800 mb-4 max-w-md">
              {error}
            </p>
            <button
              onClick={() => fetchForecast(true)}
              className="text-sm px-4 py-2 rounded border border-red-400 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              ↻ Retry
            </button>
          </div>

        /* Table */
        ) : (
          <table className="w-full text-sm table-fixed">
            <thead className="bg-gray-50 dark:bg-gray-800/90 sticky top-0 z-10">
              <tr className="shadow-sm">
                {/* Checkbox */}
                <th className="px-2 py-2 w-8 text-center border-b border-gray-200 dark:border-gray-700">
                  <input
                    type="checkbox"
                    className="accent-orange-500 cursor-pointer"
                    checked={totalVisible > 0 && selectedCount === totalVisible}
                    onChange={e => toggleSelectAll(e.target.checked)}
                  />
                </th>

                {/* Urgency dot */}
                <th className="px-1 py-2 w-5 border-b border-gray-200 dark:border-gray-700" />

                {/* Sortable columns */}
                <SortableHeader label="CHANNEL SKU" sortKey="channelSKU" sortConfig={sortConfig} onSort={handleSort} className="w-28" />
                <SortableHeader label="MASTER SKU"  sortKey="masterSKU"  sortConfig={sortConfig} onSort={handleSort} className="w-20" />
                <th className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold uppercase tracking-wider text-left text-gray-500 dark:text-gray-400 w-48">
                  PRODUCT NAME
                </th>
                <th className="px-2 py-2 w-14 text-center border-b border-gray-200 dark:border-gray-700 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  FLAGS
                </th>
                <SortableHeader label="MMA"         sortKey="mma"         sortConfig={sortConfig} onSort={handleSort} right className="w-12" />
                <SortableHeader label="DOC"         sortKey="docDays"     sortConfig={sortConfig} onSort={handleSort} right className="w-14" />
                <SortableHeader label="FBA"         sortKey="fbaQty"      sortConfig={sortConfig} onSort={handleSort} right className="w-14"
                                title="FBA Fulfillable + Reserved" />
                <SortableHeader label="INBOUND"     sortKey="inbound"     sortConfig={sortConfig} onSort={handleSort} right className="w-14" />
                <th className="px-2 py-2 w-14 text-right border-b border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500">
                  <span className="text-[9px] font-semibold uppercase tracking-wider">PENDING</span>
                </th>
                <SortableHeader label="EE AVAIL"    sortKey="whAvail"     sortConfig={sortConfig} onSort={handleSort} right className="w-16"
                                title="EasyEcom warehouse stock after Shopify + YEIO reserve" />
                <SortableHeader label="VELOCITY"    sortKey="velocityBand" sortConfig={sortConfig} onSort={handleSort} center className="w-20" />
                <SortableHeader label="RECOMMENDED" sortKey="recommended" sortConfig={sortConfig} onSort={handleSort} right className="w-24" />
                <SortableHeader label="SHIP QTY"    sortKey="shipQty"     sortConfig={sortConfig} onSort={handleSort} right className="w-24" />
              </tr>
            </thead>

            <tbody>
              {flatItems.length === 0 && !isLoading && !error && (
                <tr>
                  <td colSpan={15} className="text-center py-20">
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-3xl opacity-20">📦</span>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {skus.length === 0 ? 'No forecast data loaded yet.' : 'No SKUs match the current filter.'}
                      </p>
                      {skus.length === 0 && (
                        <button
                          onClick={() => fetchForecast(true)}
                          className="mt-2 text-xs px-3 py-1.5 rounded border border-orange-500/40 text-orange-400 hover:bg-orange-500/10 transition-colors"
                        >
                          Load Forecast
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
              {flatItems.length > 0 && 
                flatItems.map((item, index) => (
                  <React.Fragment key={item.channelSKU}>
                    <tr
                      onClick={() => setSelectedSku(item)}
                      className={`border-b cursor-pointer transition-colors ${
                        getShipQty(item) > 0
                          ? 'border-orange-200 dark:border-orange-500/20 bg-orange-50 dark:bg-orange-500/5 border-l-2 border-l-orange-400 hover:bg-orange-100/80 dark:hover:bg-orange-500/10'
                          : `border-gray-100 dark:border-gray-700/40 hover:bg-gray-50 dark:hover:bg-gray-800/40 ${
                              index % 2 === 0
                                ? 'bg-white dark:bg-gray-900'
                                : 'bg-gray-50/30 dark:bg-gray-800/20'
                            }`
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="px-2 py-1.5 text-center" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="accent-orange-500 cursor-pointer"
                          checked={selectedChannelSkus.has(item.channelSKU)}
                          onChange={() => toggleSelect(item.channelSKU)}
                        />
                      </td>

                      {/* Urgency dot */}
                      <td className="px-1 py-1.5 text-center">
                        <span className={`inline-block w-2 h-2 rounded-full ${
                          !item.needsReplenishment         ? 'bg-green-400' :
                          item.amazonInventory.docDays < 20 ? 'bg-red-400'   : 'bg-amber-400'
                        }`} />
                      </td>

                      {/* Channel SKU */}
                      <td className="px-3 py-1.5 w-28 max-w-0 overflow-hidden text-left">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="font-mono text-xs text-gray-700 dark:text-gray-300 font-medium truncate">
                            {item.channelSKU}
                          </span>
                          {item.mma.floorApplied && (
                            <span className="text-[10px] text-gray-400 flex-shrink-0">(floor)</span>
                          )}
                        </div>
                      </td>

                      {/* Master SKU */}
                      <td className="px-3 py-1.5 w-20 max-w-0 overflow-hidden text-left">
                        <span className="font-mono text-xs bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-400 truncate block">
                          {item.masterSKU}
                        </span>
                      </td>

                      {/* Product Name */}
                      <td className="px-3 py-1.5 w-48 max-w-0 overflow-hidden text-left">
                        <span className="text-xs text-gray-700 dark:text-gray-300 leading-snug line-clamp-2 block break-words">
                          {item.productName}
                        </span>
                      </td>

                      {/* Flags */}
                      <td className="px-2 py-1.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {/* Listing issue flag */}
                          {item.hasListingIssue && (
                            <span
                              title={item.listingIssueMsg || 'Possible listing issue — 0 sales in last 7 days'}
                              className="text-red-400 cursor-help text-xs"
                            >⚠</span>
                          )}
                          {/* In-transit warning flag — inbound from China arriving soon */}
                          {item.inTransitWarning?.hasWarning && (
                            <span
                              title={`Inbound shipment arriving in ${item.inTransitWarning.etaDays} days — ${item.inTransitWarning.qty} units (${item.inTransitWarning.poId}). Consider sending top sellers directly to Amazon FBA.`}
                              className="text-blue-400 cursor-help text-xs"
                            >🚢</span>
                          )}
                        </div>
                      </td>

                      {/* MMA */}
                      <td className="px-3 py-1.5 text-right text-xs text-gray-700 dark:text-gray-300">
                        {item.mma.final}
                      </td>

                      {/* DOC */}
                      <td className="px-3 py-1.5 text-right">
                        <span className={`text-xs font-semibold ${docColor(item.amazonInventory.docDays)}`}>
                          {formatDoc(item.amazonInventory.docDays)}
                        </span>
                      </td>

                      {/* FBA Stock = Fulfillable + Reserved */}
                      <td className="px-3 py-1.5 text-right text-xs text-gray-700 dark:text-gray-300">
                        {(item.amazonInventory.fbaQty + item.amazonInventory.reserved).toLocaleString()}
                      </td>

                      {/* Inbound */}
                      <td className="px-3 py-1.5 text-right text-xs">
                        {item.amazonInventory.inbound > 0
                          ? <span className="text-blue-400 font-medium">{item.amazonInventory.inbound}</span>
                          : <span className="text-gray-400">-</span>}
                      </td>

                      {/* Pending Pipeline */}
                      <td className="px-3 py-1.5 text-right text-xs">
                        {item.amazonInventory.pending > 0
                          ? <span className="text-blue-400 font-medium">{item.amazonInventory.pending}</span>
                          : <span className="text-gray-400">-</span>}
                      </td>

                      {/* EE Avail */}
                      <td className="px-3 py-1.5 text-right text-xs text-gray-700 dark:text-gray-300">
                        {item.warehouseCheck.availableQty.toLocaleString()}
                      </td>

                      {/* Velocity */}
                      <td className="px-3 py-1.5 text-center">
                        <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${velocityColor(item.replenishment.velocityBand)}`}>
                          {item.replenishment.velocityBand.charAt(0).toUpperCase() + item.replenishment.velocityBand.slice(1)}
                        </span>
                      </td>

                      {/* Recommended + shortfall */}
                      <td className="px-3 py-1.5 text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-xs text-gray-700 dark:text-gray-300">
                            {item.replenishment.recommendedQty > 0
                              ? Math.round(item.replenishment.recommendedQty).toLocaleString()
                              : <span className="text-gray-400">—</span>}
                          </span>
                          {item.needsReplenishment &&
                           item.replenishment.recommendedQty > 0 &&
                           item.warehouseCheck.availableQty < item.replenishment.recommendedQty && (
                            <span className="text-[10px] text-red-400 leading-none mt-0.5">
                              -{Math.round(item.replenishment.recommendedQty - item.warehouseCheck.availableQty).toLocaleString()} short
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Ship Qty — editable */}
                      <td className="px-2 py-1 text-right" onClick={e => e.stopPropagation()}>
                        <input
                          type="number"
                          min={0}
                          max={item.warehouseCheck.availableQty}
                          value={getShipQty(item)}
                          onChange={e => updateShipQty(
                            item.channelSKU,
                            parseInt(e.target.value) || 0,
                            item.warehouseCheck.availableQty
                          )}
                          onFocus={e => e.target.select()}
                          onKeyDown={e => {
                            if (e.key === 'Enter') e.preventDefault();
                          }}
                          tabIndex={index + 1}
                          className={`w-20 text-center text-xs font-semibold rounded border px-1 py-0.5
                            focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500
                            ${shipQtyOverrides[item.channelSKU] !== undefined
                              ? 'bg-orange-500/20 border-orange-500/50 text-orange-500 dark:text-orange-300'
                              : getShipQty(item) > 0
                              ? 'bg-orange-100 dark:bg-orange-500/20 border-orange-300 dark:border-orange-500/40 text-orange-700 dark:text-orange-300 font-bold'
                              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400'
                            }`}
                        />
                      </td>
                    </tr>

                    {/* Debug row */}
                    {debugMode && (
                      <tr className="border-b border-gray-100 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-950">
                        <td colSpan={15} className="px-4 py-0">
                          <pre className="text-xs font-mono text-green-500 dark:text-green-400 p-3 rounded my-1 overflow-x-auto max-h-40">
                            {JSON.stringify(item, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              }
            </tbody>
          </table>
        )}
      </div>

      {/* ── MODAL ───────────────────────────────────────────────────────────── */}
      {selectedSku && (
        <AmazonSkuModal
          sku={selectedSku}
          onClose={() => setSelectedSku(null)}
        />
      )}
    </div>
  );
};
