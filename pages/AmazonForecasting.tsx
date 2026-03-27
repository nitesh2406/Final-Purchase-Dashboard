import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { AmazonChannelSku } from '../types/amazon';
import { AmazonSkuModal } from '../components/amazon/AmazonSkuModal';
import { APPS_SCRIPT_URL } from '../App';

// ─── Module Cache ─────────────────────────────────────────────────────────────
let amazonForecastCache: AmazonChannelSku[] | null = null;
let amazonForecastCacheTime: Date | null = null;

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
  days === 999 ? '∞' : `${Number(days).toFixed(1)}d`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface GroupedMaster {
  masterSKU: string;
  productName: string;
  items: AmazonChannelSku[];
  availableQty: number;
  totalRecommended: number;
  totalShipQty: number;
  worstDoc: number;
}

// ─── Filter Chips ─────────────────────────────────────────────────────────────

const FILTER_CHIPS = ['All', 'Needs Ship', 'Slow', 'Medium', 'Fast', '⚠ Listing'] as const;
type FilterChip = typeof FILTER_CHIPS[number];

// ─── SortableHeader Component ──────────────────────────────────────────────────

const SortableHeader: React.FC<{
  label: string;
  sortKey: string;
  sortConfig: { key: string; direction: 'asc' | 'desc' };
  onSort: (key: string) => void;
  right?: boolean;
  center?: boolean;
  className?: string;
  title?: string;
}> = ({ label, sortKey, sortConfig, onSort, right, center, className, title }) => {
  const isActive = sortConfig.key === sortKey;
  return (
    <th
      title={title}
      onClick={() => onSort(sortKey)}
      className={`px-3 py-2 border-b border-gray-200 dark:border-gray-700
        text-xs font-semibold uppercase tracking-wider cursor-pointer select-none
        transition-colors hover:bg-gray-100 dark:hover:bg-gray-700/50
        ${isActive ? 'text-orange-400 bg-orange-500/5' : 'text-gray-500 dark:text-gray-400'}
        ${right ? 'text-right' : center ? 'text-center' : 'text-left'}
        ${className || ''}`}
    >
      <span className={`inline-flex items-center gap-1 ${right ? 'justify-end' : center ? 'justify-center' : 'justify-start'}`}>
        {label}
        <span className="text-[10px] opacity-60">
          {isActive ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </span>
    </th>
  );
};

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
  
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    direction: 'asc' | 'desc';
  }>({ key: 'docDays', direction: 'asc' });

  // ── Selection state ─────────────────────────────────────────────────────────
  const [selectedChannelSkus, setSelectedChannelSkus] = useState<Set<string>>(new Set());

  // ── Ship qty override state ─────────────────────────────────────────────────
  const [shipQtyOverrides, setShipQtyOverrides] = useState<Record<string, number>>({});

  // ── Confirm plan state ──────────────────────────────────────────────────────
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState<{ success: boolean; message: string; poNumber?: string } | null>(null);

  // ── API fetch ────────────────────────────────────────────────────────────────
  const fetchForecast = useCallback(async (forceRefresh = false) => {
    // Use cache if available and not forcing refresh
    if (!forceRefresh && amazonForecastCache) {
      setSkus(amazonForecastCache);
      setLastRefreshed(amazonForecastCacheTime);
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
      
      // Update cache
      amazonForecastCache = data.data;
      amazonForecastCacheTime = new Date();
      
      setSkus(data.data);
      setLastRefreshed(amazonForecastCacheTime);
    } catch (e: any) {
      setError(e.message || 'Unknown error');
      setSkus([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchForecast(false);
  }, [fetchForecast]);

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const getShipQty = (item: AmazonChannelSku): number =>
    shipQtyOverrides[item.channelSKU] ?? item.allocation.shippingPlanQty;

  const updateShipQty = (channelSku: string, value: number) => {
    setShipQtyOverrides(prev => ({ ...prev, [channelSku]: Math.max(0, value) }));
  };

  // ── Grouping & Filtering & Sorting ───────────────────────────────────────────
  const filteredGroups = useMemo(() => {
    const groups = new Map<string, AmazonChannelSku[]>();
    skus.forEach(item => {
      // Apply filters
      const matchSearch = !search ||
        item.channelSKU.toLowerCase().includes(search.toLowerCase()) ||
        item.productName.toLowerCase().includes(search.toLowerCase()) ||
        item.masterSKU.toLowerCase().includes(search.toLowerCase());

      const matchFilter =
        activeFilter === 'All'        ? true :
        activeFilter === 'Needs Ship' ? item.needsReplenishment :
        activeFilter === 'Slow'       ? item.replenishment.velocityBand === 'slow' :
        activeFilter === 'Medium'     ? item.replenishment.velocityBand === 'medium' :
        activeFilter === 'Fast'       ? item.replenishment.velocityBand === 'fast' :
        activeFilter === '⚠ Listing'  ? item.hasListingIssue : true;

      if (matchSearch && matchFilter) {
        if (!groups.has(item.masterSKU)) groups.set(item.masterSKU, []);
        groups.get(item.masterSKU)!.push(item);
      }
    });

    return Array.from(groups.entries()).map(([masterSKU, items]) => {
      // Sort items within group
      const sortedItems = [...items].sort((a, b) => {
        const dir = sortConfig.direction === 'asc' ? 1 : -1;
        switch (sortConfig.key) {
          case 'channelSKU':     return dir * a.channelSKU.localeCompare(b.channelSKU);
          case 'mma':            return dir * (a.mma.final - b.mma.final);
          case 'docDays':        return dir * (a.amazonInventory.docDays - b.amazonInventory.docDays);
          case 'fbaQty':         return dir * (a.amazonInventory.fbaQty - b.amazonInventory.fbaQty);
          case 'inbound':        return dir * (a.amazonInventory.inbound - b.amazonInventory.inbound);
          case 'whAvail':        return dir * (a.warehouseCheck.availableQty - b.warehouseCheck.availableQty);
          case 'recommended':    return dir * (a.replenishment.recommendedQty - b.replenishment.recommendedQty);
          case 'shipQty':        return dir * (getShipQty(a) - getShipQty(b));
          case 'velocityBand': {
            const order = { fast: 0, medium: 1, slow: 2 };
            return dir * ((order[a.replenishment.velocityBand] || 0) - (order[b.replenishment.velocityBand] || 0));
          }
          default: return 0;
        }
      });

      return {
        masterSKU,
        productName: sortedItems[0].productName,
        items: sortedItems,
        availableQty: sortedItems[0].warehouseCheck.availableQty,
        totalRecommended: sortedItems.reduce((s, i) => s + i.replenishment.recommendedQty, 0),
        totalShipQty: sortedItems.reduce((s, i) => s + getShipQty(i), 0),
        worstDoc: Math.min(...sortedItems.map(i => i.amazonInventory.docDays)),
      };
    }).filter(group => group.items.length > 0);
  }, [skus, search, activeFilter, sortConfig, shipQtyOverrides]); // re-group when overrides change so group totals update

  // ── Expand state ──────────────────────────────────────────────────────────────
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Expand all when data loads initially
  useEffect(() => {
    if (filteredGroups.length > 0 && expandedGroups.size === 0) {
      setExpandedGroups(new Set(filteredGroups.map(g => g.masterSKU)));
    }
  }, [skus]); // only run when raw skus load, not every sort

  const toggleExpand = (masterSku: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(masterSku) ? next.delete(masterSku) : next.add(masterSku);
      return next;
    });
  };

  // ── Selection helpers ───────────────────────────────────────────────────────
  const toggleSelect = (channelSku: string) => {
    setSelectedChannelSkus(prev => {
      const next = new Set(prev);
      next.has(channelSku) ? next.delete(channelSku) : next.add(channelSku);
      return next;
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      const all = filteredGroups.flatMap(g => g.items).map(i => i.channelSKU);
      setSelectedChannelSkus(new Set(all));
    } else {
      setSelectedChannelSkus(new Set());
    }
  };

  const selectedCount = selectedChannelSkus.size;
  const totalVisible = filteredGroups.flatMap(g => g.items).length;

  // ── Summary stats ──────────────────────────────────────────────────────────
  const allFilteredItems = filteredGroups.flatMap(g => g.items);
  const totalSkus     = skus.length; // usually total overall, but UI might mean filtered length
  const needShipCount = allFilteredItems.filter(i => i.needsReplenishment).length;
  // totalUnits considers overrides
  const totalUnits    = allFilteredItems.reduce((s, i) => s + getShipQty(i), 0);

  // ── Confirm Plan ───────────────────────────────────────────────────────────
  const handleConfirmPlan = async () => {
    // Confirm only selected items if any selected, otherwise all that match criteria
    const itemsToConfirm = skus
      .filter(item =>
        (selectedChannelSkus.size === 0 || selectedChannelSkus.has(item.channelSKU)) &&
        getShipQty(item) > 0
      )
      .map(item => ({
        ...item,
        allocation: {
          ...item.allocation,
          finalAllocatedQty: getShipQty(item),
          shippingPlanQty: getShipQty(item),
          isManualOverride: shipQtyOverrides[item.channelSKU] !== undefined,
          overrideReason: shipQtyOverrides[item.channelSKU] !== undefined ? 'Manual override' : '',
        }
      }));

    if (itemsToConfirm.length === 0) {
      alert('No items to confirm. Either select items with >0 ship qty, or ensure there are requested shipments.');
      return;
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
        // After success, might be good to clear overrides and selection, or force refresh
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
    const allItems = filteredGroups.flatMap(g => g.items);
    if (allItems.length === 0) { alert('No data to export.'); return; }

    const headers = [
      'Channel SKU', 'Master SKU', 'Product Name',
      'MMA', 'DOC (days)', 'FBA Stock', 'Inbound', 'WH Available',
      'Velocity Band', 'Recommended Qty', 'Ship Qty',
      'Needs Replenishment', 'Split Required', 'Listing Issue',
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
      Math.round(item.replenishment.recommendedQty),
      getShipQty(item),
      item.needsReplenishment ? 'Yes' : 'No',
      item.warehouseCheck.splitRequired ? 'Yes' : 'No',
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
          SKUs: {totalSkus}
        </span>

        <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded text-xs flex-shrink-0">
          Need Ship: {needShipCount}
        </span>

        <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded text-xs flex-shrink-0">
          Units: {totalUnits.toLocaleString()}
        </span>

        {selectedCount > 0 && (
          <span className="bg-orange-500/20 text-orange-400 border border-orange-500/30 px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0">
            {selectedCount} selected
          </span>
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
            {isConfirming ? '⏳ Confirming...' : 'Confirm Plan ▶'}
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
                ? 'bg-orange-500/20 text-orange-400 border-orange-500/40 font-medium'
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
            <thead className="bg-gray-50 dark:bg-gray-800/80 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-2 py-2 w-8 text-center border-b border-gray-200 dark:border-gray-700">
                  <input
                    type="checkbox"
                    className="accent-orange-500 cursor-pointer"
                    checked={totalVisible > 0 && selectedCount === totalVisible}
                    onChange={e => toggleSelectAll(e.target.checked)}
                  />
                </th>
                <th className="px-2 py-2 w-6 text-center border-b border-gray-200 dark:border-gray-700"></th>
                
                <SortableHeader label="CHANNEL SKU" sortKey="channelSKU" sortConfig={sortConfig} onSort={handleSort} className="w-36 border-r border-gray-100 dark:border-gray-700/50" />
                <th className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold uppercase tracking-wider text-left text-gray-500 dark:text-gray-400 w-48">
                  PRODUCT NAME
                </th>
                <th className="px-2 py-2 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold uppercase tracking-wider text-center text-gray-500 dark:text-gray-400 w-12">
                  FLAGS
                </th>
                <SortableHeader label="MMA" sortKey="mma" sortConfig={sortConfig} onSort={handleSort} right className="w-14" />
                <SortableHeader label="DOC" sortKey="docDays" sortConfig={sortConfig} onSort={handleSort} right className="w-16" />
                <SortableHeader label="FBA STOCK" sortKey="fbaQty" sortConfig={sortConfig} onSort={handleSort} right className="w-18" />
                <SortableHeader label="INBOUND" sortKey="inbound" sortConfig={sortConfig} onSort={handleSort} right className="w-16" />
                
                <th className="px-2 py-2 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold uppercase tracking-wider text-right text-gray-400 dark:text-gray-500 w-16" title="Units in created shipments not yet shipped (placeholder — coming soon)">
                  <div className="flex flex-col items-end leading-[1.1]">
                    <span>PENDING</span>
                    <span className="text-[9px] text-gray-400 dark:text-gray-600">TBD</span>
                  </div>
                </th>

                <SortableHeader label="EE AVAIL" title="EasyEcom warehouse available stock (after Shopify + YEIO reserve)" sortKey="whAvail" sortConfig={sortConfig} onSort={handleSort} right className="w-18" />
                <SortableHeader label="VELOCITY" sortKey="velocityBand" sortConfig={sortConfig} onSort={handleSort} center className="w-20" />
                <SortableHeader label="RECOMMENDED" sortKey="recommended" sortConfig={sortConfig} onSort={handleSort} right className="w-24" />
                <SortableHeader label="SHIP QTY" sortKey="shipQty" sortConfig={sortConfig} onSort={handleSort} right className="w-20" />
              </tr>
            </thead>

            <tbody>
              {filteredGroups.length === 0 ? (
                <tr>
                  <td colSpan={14} className="text-center py-16 text-gray-400 text-sm">
                    {skus.length === 0 ? 'No data returned from API' : 'No SKUs match the current filter'}
                  </td>
                </tr>
              ) : (
                filteredGroups.map(group => {
                  const isExpanded = expandedGroups.has(group.masterSKU);
                  const worstDoc   = group.worstDoc;

                  return (
                    <React.Fragment key={group.masterSKU}>
                      {/* ── MASTER SKU ROW ───────────────────────────────────── */}
                      <tr
                        onClick={() => toggleExpand(group.masterSKU)}
                        className="bg-gray-100/80 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-700/40 hover:bg-gray-100 dark:hover:bg-gray-800/80 cursor-pointer"
                      >
                        <td className="px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            className="accent-orange-500 cursor-pointer"
                            checked={group.items.length > 0 && group.items.every(i => selectedChannelSkus.has(i.channelSKU))}
                            onChange={e => {
                              e.stopPropagation();
                              const isChecked = e.target.checked;
                              group.items.forEach(item => {
                                setSelectedChannelSkus(prev => {
                                  const next = new Set(prev);
                                  isChecked ? next.add(item.channelSKU) : next.delete(item.channelSKU);
                                  return next;
                                });
                              });
                            }}
                            onClick={e => e.stopPropagation()}
                          />
                        </td>
                        <td className="px-1 py-2 text-center">
                          <span className={`inline-block w-2 h-2 rounded-full ${
                            worstDoc < 20 ? 'bg-red-400' : worstDoc < 50 ? 'bg-amber-400' : 'bg-green-400'
                          }`} />
                        </td>
                        <td colSpan={5} className="px-3 py-2 border-r border-transparent">
                          <div className="flex items-center gap-2 pl-1">
                            <span className="text-gray-400 text-xs">{isExpanded ? '▼' : '▶'}</span>
                            <span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-700 dark:text-gray-300">
                              {group.masterSKU}
                            </span>
                            <span className="font-semibold text-gray-800 dark:text-gray-100 truncate text-xs">
                              {group.productName}
                            </span>
                            <span className="text-gray-400 dark:text-gray-500 text-xs ml-1 flex-shrink-0">
                              {group.items.length} variant{group.items.length > 1 ? 's' : ''}
                            </span>
                          </div>
                        </td>
                        <td /><td /><td />
                        <td />
                        <td className="px-3 py-2 text-right text-xs text-gray-600 dark:text-gray-300 font-medium">
                          {group.availableQty.toLocaleString()}
                        </td>
                        <td />
                        <td className="px-3 py-2 text-right text-xs text-gray-600 dark:text-gray-300">
                          {Math.round(group.totalRecommended).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className={`text-xs font-bold ${group.totalShipQty > 0 ? 'text-orange-400' : 'text-gray-400'}`}>
                            {group.totalShipQty.toLocaleString()}
                          </span>
                        </td>
                      </tr>

                      {/* ── CHANNEL SKU CHILD ROWS ───────────────────────────── */}
                      {isExpanded && group.items.map((item, index) => {
                         const isLastChild = index === group.items.length - 1;
                         return (
                          <React.Fragment key={item.channelSKU}>
                            <tr
                              onClick={() => setSelectedSku(item)}
                              className={`border-b ${isLastChild ? 'border-b-2 border-gray-200 dark:border-gray-700' : 'border-gray-100 dark:border-gray-700/40'} 
                                odd:bg-white dark:odd:bg-gray-900 even:bg-gray-50/50 dark:even:bg-gray-800/20 
                                hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer`}
                            >
                              <td className="px-2 py-1.5 text-center" onClick={e => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  className="accent-orange-500 cursor-pointer"
                                  checked={selectedChannelSkus.has(item.channelSKU)}
                                  onChange={() => toggleSelect(item.channelSKU)}
                                />
                              </td>

                              <td className="px-1 py-1.5 text-center">
                                <span className={`inline-block w-2 h-2 rounded-full ${
                                  !item.needsReplenishment ? 'bg-green-400' :
                                  item.amazonInventory.docDays < 20 ? 'bg-red-400' : 'bg-amber-400'
                                }`} />
                              </td>

                              <td className="px-3 py-1.5 pl-7 pr-6 border-r border-gray-100 dark:border-gray-700/50">
                                <span className="font-mono text-xs text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">
                                  {item.channelSKU}
                                </span>
                                {item.mma.floorApplied && (
                                  <span className="ml-1 text-[10px] text-gray-400">(floor)</span>
                                )}
                              </td>

                              <td className="px-3 py-1.5 w-48 max-w-[12rem]">
                                <span className="text-xs text-gray-700 dark:text-gray-300 leading-tight line-clamp-2 block">
                                  {item.productName}
                                </span>
                              </td>

                              <td className="px-2 py-1.5 text-center">
                                {item.hasListingIssue && (
                                  <span title={item.listingIssueMsg || 'Possible listing issue'} className="text-red-400 cursor-help text-sm">⚠</span>
                                )}
                              </td>

                              <td className="px-3 py-1.5 text-right text-xs text-gray-700 dark:text-gray-300">
                                {item.mma.final}
                              </td>

                              <td className="px-3 py-1.5 text-right">
                                <span className={`text-xs font-semibold ${docColor(item.amazonInventory.docDays)}`}>
                                  {formatDoc(item.amazonInventory.docDays)}
                                </span>
                              </td>

                              <td className="px-3 py-1.5 text-right text-xs text-gray-700 dark:text-gray-300">
                                {item.amazonInventory.fbaQty.toLocaleString()}
                              </td>

                              <td className="px-3 py-1.5 text-right text-xs">
                                {item.amazonInventory.inbound > 0
                                  ? <span className="text-blue-400">{item.amazonInventory.inbound}</span>
                                  : <span className="text-gray-400">-</span>}
                              </td>
                              
                              <td className="px-3 py-1.5 text-right">
                                <span className="text-xs text-gray-400 dark:text-gray-500 italic">—</span>
                              </td>

                              <td className="px-3 py-1.5 text-right text-xs text-gray-700 dark:text-gray-300">
                                {item.warehouseCheck.availableQty.toLocaleString()}
                              </td>

                              <td className="px-3 py-1.5 text-center">
                                <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${velocityColor(item.replenishment.velocityBand)}`}>
                                  {item.replenishment.velocityBand.charAt(0).toUpperCase() + item.replenishment.velocityBand.slice(1)}
                                </span>
                              </td>

                              <td className="px-3 py-1.5 text-right">
                                <div className="flex flex-col items-end">
                                  <span className="text-xs text-gray-700 dark:text-gray-300">
                                    {item.replenishment.recommendedQty > 0
                                      ? Math.round(item.replenishment.recommendedQty).toLocaleString()
                                      : <span className="text-gray-400">—</span>}
                                  </span>
                                  {item.needsReplenishment &&
                                   item.replenishment.recommendedQty > 0 &&
                                   item.warehouseCheck.availableQty < item.replenishment.recommendedQty && (
                                    <span className="text-[10px] text-red-400 leading-tight">
                                      -{Math.round(item.replenishment.recommendedQty - item.warehouseCheck.availableQty).toLocaleString()} short
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td className="px-2 py-1 text-right" onClick={e => e.stopPropagation()}>
                                <input
                                  type="number"
                                  min={0}
                                  value={getShipQty(item)}
                                  onChange={e => updateShipQty(item.channelSKU, parseInt(e.target.value) || 0)}
                                  onFocus={e => e.target.select()}
                                  onKeyDown={e => {
                                    if (e.key === 'Tab') {
                                      // Tab behavior is handled naturally by the browser via tabIndex
                                    }
                                  }}
                                  tabIndex={0}
                                  className={`w-16 text-center text-xs font-semibold rounded border px-1 py-0.5
                                    focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500
                                    ${shipQtyOverrides[item.channelSKU] !== undefined
                                      ? 'bg-orange-500/10 border-orange-500/40 text-orange-400'
                                      : getShipQty(item) > 0
                                      ? 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200 font-bold'
                                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 text-right'
                                    }`}
                                />
                              </td>
                            </tr>

                            {/* Debug row */}
                            {debugMode && (
                              <tr className="border-b border-gray-100 dark:border-gray-700/50 odd:bg-white dark:odd:bg-gray-900 even:bg-gray-50/50 dark:even:bg-gray-800/20">
                                <td colSpan={14} className="pl-7 pr-3 py-0">
                                  <pre className="text-xs font-mono text-green-500 dark:text-green-400 bg-gray-950 p-3 rounded my-1 overflow-x-auto max-h-40">
                                    {JSON.stringify(item, null, 2)}
                                  </pre>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  );
                })
              )}
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
