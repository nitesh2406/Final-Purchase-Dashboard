import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { AmazonChannelSku } from '../types/amazon';
import { AmazonSkuModal } from '../components/amazon/AmazonSkuModal';
import { APPS_SCRIPT_URL } from '../App';

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

// ─── Types ────────────────────────────────────────────────────────────────────

interface GroupedMaster {
  masterSKU: string;
  productName: string;
  items: AmazonChannelSku[];
  hasSplit: boolean;
  availableQty: number;
  totalRecommended: number;
  totalShipQty: number;
  worstDoc: number;
}

// ─── Filter Chips ─────────────────────────────────────────────────────────────

const FILTER_CHIPS = ['All', 'Needs Ship', 'Split ⚠', 'Slow', 'Medium', 'Fast', '⚠ Listing'] as const;
type FilterChip = typeof FILTER_CHIPS[number];

// ─── Split Editor ─────────────────────────────────────────────────────────────

interface SplitEditorProps {
  group: GroupedMaster;
  overrides: Record<string, number>;
  onUpdate: (channelSku: string, qty: number) => void;
  onReset: () => void;
}

const SplitEditor: React.FC<SplitEditorProps> = ({ group, overrides, onUpdate, onReset }) => {
  const allocations = group.items.map(item => ({
    channelSku: item.channelSKU,
    productName: item.productName,
    mma: item.mma.final,
    autoQty: item.allocation.autoAllocatedQty,
    currentQty: overrides[item.channelSKU] ?? item.allocation.autoAllocatedQty,
    isOverridden: overrides[item.channelSKU] !== undefined,
  }));

  const totalAllocated = allocations.reduce((s, a) => s + a.currentQty, 0);
  const isOverLimit = totalAllocated > group.availableQty;

  return (
    <div className="mx-4 my-2 p-4 rounded-lg bg-orange-500/5 border border-orange-500/20">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-orange-400">⇄ Inventory Split Editor</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Available: <span className="font-semibold text-gray-700 dark:text-gray-300">{group.availableQty.toLocaleString()} units</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${isOverLimit
            ? 'bg-red-500/20 text-red-400 border-red-500/30'
            : 'bg-green-500/20 text-green-400 border-green-500/30'
          }`}>
            Total: {totalAllocated} / {group.availableQty}
            {isOverLimit && ' ⚠ Exceeds available'}
          </span>
          <button
            onClick={onReset}
            className="text-xs px-2 py-0.5 rounded border border-gray-400 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-500 transition-colors"
          >
            ↺ Reset to Auto
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {allocations.map(alloc => (
          <div key={alloc.channelSku} className="flex items-center gap-3 text-xs">
            <span className="font-mono text-gray-700 dark:text-gray-300 w-28 flex-shrink-0">{alloc.channelSku}</span>
            <span className="text-gray-500 dark:text-gray-400 flex-1 truncate">{alloc.productName}</span>
            <span className="text-gray-400 flex-shrink-0">MMA: {alloc.mma}</span>
            <span className="text-gray-400 flex-shrink-0">Auto: {alloc.autoQty}</span>
            <div className="flex items-center gap-1 flex-shrink-0">
              <input
                type="number"
                min={0}
                max={group.availableQty}
                value={alloc.currentQty}
                onChange={e => onUpdate(alloc.channelSku, Math.max(0, parseInt(e.target.value) || 0))}
                className={`w-16 text-center text-xs rounded border px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-orange-500 ${
                  alloc.isOverridden
                    ? 'bg-orange-500/10 border-orange-500/40 text-orange-400 dark:text-orange-300'
                    : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200'
                }`}
              />
              {alloc.isOverridden && (
                <span className="text-orange-400 text-xs" title="Manually overridden">✎</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {isOverLimit && (
        <p className="mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-1.5">
          ⚠ Total allocation ({totalAllocated}) exceeds available warehouse stock ({group.availableQty}). Reduce quantities before confirming.
        </p>
      )}
    </div>
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

  // ── Split editor state ──────────────────────────────────────────────────────
  const [manualOverrides, setManualOverrides] = useState<Record<string, Record<string, number>>>({});
  const [activeSplitEditor, setActiveSplitEditor] = useState<string | null>(null);

  // ── Confirm plan state ──────────────────────────────────────────────────────
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState<{ success: boolean; message: string; poNumber?: string } | null>(null);

  // ── API fetch ────────────────────────────────────────────────────────────────
  const fetchForecast = useCallback(async () => {
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
      setSkus(data.data);
      setLastRefreshed(new Date());
    } catch (e: any) {
      setError(e.message || 'Unknown error');
      setSkus([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchForecast();
  }, [fetchForecast]);

  // ── Grouping ─────────────────────────────────────────────────────────────────
  const groupedData = useMemo<GroupedMaster[]>(() => {
    const groups = new Map<string, AmazonChannelSku[]>();
    skus.forEach(item => {
      if (!groups.has(item.masterSKU)) groups.set(item.masterSKU, []);
      groups.get(item.masterSKU)!.push(item);
    });
    return Array.from(groups.entries()).map(([masterSKU, items]) => ({
      masterSKU,
      productName: items[0].productName,
      items,
      hasSplit: items.some(i => i.warehouseCheck.splitRequired),
      availableQty: items[0].warehouseCheck.availableQty,
      totalRecommended: items.reduce((s, i) => s + i.replenishment.recommendedQty, 0),
      totalShipQty: items.reduce((s, i) => s + i.allocation.shippingPlanQty, 0),
      worstDoc: Math.min(...items.map(i => i.amazonInventory.docDays)),
    }));
  }, [skus]);

  // ── Expand state ──────────────────────────────────────────────────────────────
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Expand all when data loads
  useEffect(() => {
    if (groupedData.length > 0) {
      setExpandedGroups(new Set(groupedData.map(g => g.masterSKU)));
    }
  }, [groupedData]);

  const toggleExpand = (masterSku: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(masterSku) ? next.delete(masterSku) : next.add(masterSku);
      return next;
    });
  };

  // ── Filtering ─────────────────────────────────────────────────────────────────
  const filteredGroups = useMemo(() => {
    return groupedData
      .map(group => ({
        ...group,
        items: group.items.filter(item => {
          const matchSearch = !search ||
            item.channelSKU.toLowerCase().includes(search.toLowerCase()) ||
            item.productName.toLowerCase().includes(search.toLowerCase()) ||
            item.masterSKU.toLowerCase().includes(search.toLowerCase());

          const matchFilter =
            activeFilter === 'All'        ? true :
            activeFilter === 'Needs Ship' ? item.needsReplenishment :
            activeFilter === 'Split ⚠'   ? item.warehouseCheck.splitRequired :
            activeFilter === 'Slow'       ? item.replenishment.velocityBand === 'slow' :
            activeFilter === 'Medium'     ? item.replenishment.velocityBand === 'medium' :
            activeFilter === 'Fast'       ? item.replenishment.velocityBand === 'fast' :
            activeFilter === '⚠ Listing'  ? item.hasListingIssue : true;

          return matchSearch && matchFilter;
        }),
      }))
      .filter(group => group.items.length > 0);
  }, [groupedData, search, activeFilter]);

  // ── Summary stats ──────────────────────────────────────────────────────────
  const allFilteredItems = filteredGroups.flatMap(g => g.items);
  const totalSkus     = allFilteredItems.length;
  const needShipCount = allFilteredItems.filter(i => i.needsReplenishment).length;
  const totalUnits    = allFilteredItems.reduce((s, i) => s + i.allocation.shippingPlanQty, 0);

  // ── Confirm Plan ───────────────────────────────────────────────────────────
  const handleConfirmPlan = async () => {
    const itemsToConfirm = skus
      .filter(item => item.needsReplenishment && item.allocation.shippingPlanQty > 0)
      .map(item => {
        const masterOverrides = manualOverrides[item.masterSKU] || {};
        const overriddenQty = masterOverrides[item.channelSKU];
        return {
          ...item,
          allocation: {
            ...item.allocation,
            finalAllocatedQty: overriddenQty ?? item.allocation.finalAllocatedQty,
            shippingPlanQty:   overriddenQty ?? item.allocation.shippingPlanQty,
            isManualOverride:  overriddenQty !== undefined,
            overrideReason:    overriddenQty !== undefined ? 'Manual split adjustment' : '',
          },
        };
      });

    if (itemsToConfirm.length === 0) {
      alert('No items to confirm. All SKUs either have 0 ship qty or do not need replenishment.');
      return;
    }

    // Validate split groups
    const splitGroups = groupedData.filter(g => g.hasSplit);
    for (const group of splitGroups) {
      const overrides = manualOverrides[group.masterSKU] || {};
      const total = group.items.reduce((s, item) => s + (overrides[item.channelSKU] ?? item.allocation.shippingPlanQty), 0);
      if (total > group.availableQty) {
        alert(`Cannot confirm: ${group.masterSKU} total allocation (${total}) exceeds available stock (${group.availableQty}). Please fix the split before confirming.`);
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
      item.replenishment.recommendedQty,
      item.allocation.shippingPlanQty,
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
            onClick={() => fetchForecast()}
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
      <div className="flex-1 overflow-y-auto">

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
              onClick={() => fetchForecast()}
              className="text-sm px-4 py-2 rounded border border-red-400 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              ↻ Retry
            </button>
          </div>

        /* Table */
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800/80 sticky top-0 z-10">
              <tr>
                {[
                  { label: '', w: 'w-8' },
                  { label: '', w: 'w-6' },
                  { label: 'CHANNEL SKU', w: 'w-36' },
                  { label: 'PRODUCT NAME', w: '' },
                  { label: 'MMA', w: 'w-16', right: true },
                  { label: 'DOC', w: 'w-16', right: true },
                  { label: 'FBA STOCK', w: 'w-20', right: true },
                  { label: 'INBOUND', w: 'w-16', right: true },
                  { label: 'WH AVAIL', w: 'w-20', right: true },
                  { label: 'VELOCITY', w: 'w-20', center: true },
                  { label: 'RECOMMENDED', w: 'w-24', right: true },
                  { label: 'SHIP QTY', w: 'w-20', right: true },
                  { label: 'FLAGS', w: 'w-14', center: true },
                ].map((col, i) => (
                  <th
                    key={i}
                    className={`px-3 py-2 border-b border-gray-200 dark:border-gray-700
                      text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400
                      ${col.right ? 'text-right' : (col as any).center ? 'text-center' : 'text-left'}
                      ${col.w}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {filteredGroups.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center py-16 text-gray-400 text-sm">
                    {skus.length === 0 ? 'No data returned from API' : 'No SKUs match the current filter'}
                  </td>
                </tr>
              ) : (
                filteredGroups.map(group => {
                  const isExpanded = expandedGroups.has(group.masterSKU);
                  const worstDoc   = group.worstDoc;
                  const isSplitOpen = activeSplitEditor === group.masterSKU;

                  return (
                    <React.Fragment key={group.masterSKU}>
                      {/* ── MASTER SKU ROW ───────────────────────────────────── */}
                      <tr
                        onClick={() => toggleExpand(group.masterSKU)}
                        className="bg-gray-100/80 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800/80 cursor-pointer"
                      >
                        <td />
                        <td className="px-1 py-2 text-center">
                          <span className={`inline-block w-2 h-2 rounded-full ${
                            worstDoc < 20 ? 'bg-red-400' : worstDoc < 50 ? 'bg-amber-400' : 'bg-green-400'
                          }`} />
                        </td>
                        <td colSpan={2} className="px-3 py-2">
                          <div className="flex items-center gap-2 pl-1">
                            <span className="text-gray-400 text-xs">{isExpanded ? '▼' : '▶'}</span>
                            <span className="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-gray-700 dark:text-gray-300">
                              {group.masterSKU}
                            </span>
                            <span className="font-semibold text-gray-800 dark:text-gray-100 truncate text-xs">
                              {group.productName}
                            </span>
                            {group.hasSplit && (
                              <span className="bg-orange-500/20 text-orange-400 border border-orange-500/30 px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0">
                                ⚠ Split
                              </span>
                            )}
                            {/* Edit Split button */}
                            {group.hasSplit && (
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  setActiveSplitEditor(isSplitOpen ? null : group.masterSKU);
                                }}
                                className="text-xs px-2 py-0.5 rounded border border-orange-500/40 text-orange-400 hover:bg-orange-500/10 transition-colors ml-1 flex-shrink-0"
                              >
                                {isSplitOpen ? 'Close Split' : 'Edit Split'}
                              </button>
                            )}
                            <span className="text-gray-400 dark:text-gray-500 text-xs ml-1 flex-shrink-0">
                              {group.items.length} variant{group.items.length > 1 ? 's' : ''}
                            </span>
                          </div>
                        </td>
                        <td /><td /><td /><td />
                        <td className="px-3 py-2 text-right text-xs text-gray-600 dark:text-gray-300 font-medium">
                          {group.availableQty.toLocaleString()}
                        </td>
                        <td />
                        <td className="px-3 py-2 text-right text-xs text-gray-600 dark:text-gray-300">
                          {group.totalRecommended.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className={`text-xs font-bold ${group.totalShipQty > 0 ? 'text-orange-400' : 'text-gray-400'}`}>
                            {group.totalShipQty.toLocaleString()}
                          </span>
                        </td>
                        <td />
                      </tr>

                      {/* ── SPLIT EDITOR ROW ─────────────────────────────────── */}
                      {isExpanded && isSplitOpen && (
                        <tr>
                          <td colSpan={13} className="p-0">
                            <SplitEditor
                              group={group}
                              overrides={manualOverrides[group.masterSKU] || {}}
                              onUpdate={(channelSku, qty) => {
                                setManualOverrides(prev => ({
                                  ...prev,
                                  [group.masterSKU]: { ...(prev[group.masterSKU] || {}), [channelSku]: qty },
                                }));
                              }}
                              onReset={() => {
                                setManualOverrides(prev => {
                                  const next = { ...prev };
                                  delete next[group.masterSKU];
                                  return next;
                                });
                              }}
                            />
                          </td>
                        </tr>
                      )}

                      {/* ── CHANNEL SKU CHILD ROWS ───────────────────────────── */}
                      {isExpanded && group.items.map(item => (
                        <React.Fragment key={item.channelSKU}>
                          <tr
                            onClick={() => setSelectedSku(item)}
                            className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer"
                          >
                            <td className="px-2 py-1.5 text-center" onClick={e => e.stopPropagation()}>
                              <input type="checkbox" className="rounded accent-orange-500" />
                            </td>

                            <td className="px-1 py-1.5 text-center">
                              <span className={`inline-block w-2 h-2 rounded-full ${
                                !item.needsReplenishment ? 'bg-green-400' :
                                item.amazonInventory.docDays < 20 ? 'bg-red-400' : 'bg-amber-400'
                              }`} />
                            </td>

                            <td className="px-3 py-1.5 pl-7">
                              <span className="font-mono text-xs text-gray-700 dark:text-gray-300 font-medium">
                                {item.channelSKU}
                              </span>
                              {item.mma.floorApplied && (
                                <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">(floor)</span>
                              )}
                            </td>

                            <td className="px-3 py-1.5">
                              <span className="text-xs text-gray-700 dark:text-gray-300 truncate block max-w-xs">
                                {item.productName}
                              </span>
                            </td>

                            <td className="px-3 py-1.5 text-right text-xs text-gray-700 dark:text-gray-300">
                              {item.mma.final}
                            </td>

                            <td className="px-3 py-1.5 text-right">
                              <span className={`text-xs font-semibold ${docColor(item.amazonInventory.docDays)}`}>
                                {item.amazonInventory.docDays === 999 ? '∞' : `${item.amazonInventory.docDays}d`}
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

                            <td className="px-3 py-1.5 text-right text-xs text-gray-700 dark:text-gray-300">
                              {item.warehouseCheck.availableQty.toLocaleString()}
                            </td>

                            <td className="px-3 py-1.5 text-center">
                              <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${velocityColor(item.replenishment.velocityBand)}`}>
                                {item.replenishment.velocityBand.charAt(0).toUpperCase() + item.replenishment.velocityBand.slice(1)}
                              </span>
                            </td>

                            <td className="px-3 py-1.5 text-right text-xs text-gray-700 dark:text-gray-300">
                              {item.replenishment.recommendedQty > 0
                                ? item.replenishment.recommendedQty.toLocaleString()
                                : <span className="text-gray-400">-</span>}
                            </td>

                            <td className="px-3 py-1.5 text-right" onClick={e => e.stopPropagation()}>
                              {/* Show manual override qty if set */}
                              {(() => {
                                const ov = (manualOverrides[item.masterSKU] || {})[item.channelSKU];
                                const qty = ov ?? item.allocation.shippingPlanQty;
                                return (
                                  <span className={`text-xs font-bold ${qty > 0 ? 'text-orange-400' : 'text-gray-400'} ${ov !== undefined ? 'underline decoration-dotted' : ''}`}
                                    title={ov !== undefined ? 'Manual override active' : undefined}>
                                    {qty > 0 ? qty.toLocaleString() : '-'}
                                    {ov !== undefined && <span className="ml-0.5 text-[9px]">✎</span>}
                                  </span>
                                );
                              })()}
                            </td>

                            <td className="px-2 py-1.5 text-center">
                              {item.hasListingIssue && (
                                <span title={item.listingIssueMsg || 'Possible listing issue'} className="text-red-400 cursor-help text-sm">⚠</span>
                              )}
                              {item.warehouseCheck.splitRequired && (
                                <span title="Inventory split required" className="text-orange-400 cursor-help text-sm ml-0.5">⇄</span>
                              )}
                            </td>
                          </tr>

                          {/* Debug row */}
                          {debugMode && (
                            <tr className="border-b border-gray-100 dark:border-gray-700/50 bg-white dark:bg-gray-900">
                              <td colSpan={13} className="pl-7 pr-3 py-0">
                                <pre className="text-xs font-mono text-green-500 dark:text-green-400 bg-gray-950 p-3 rounded my-1 overflow-x-auto max-h-40">
                                  {JSON.stringify(item, null, 2)}
                                </pre>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
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
