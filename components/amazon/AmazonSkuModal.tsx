import React, { FC, useState, useMemo, useEffect } from 'react';
import { AmazonChannelSku, AmazonSupplyChain } from '../../types/amazon';
import { APPS_SCRIPT_URL } from '../../App';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface AmazonSkuModalProps {
  sku: AmazonChannelSku;
  onClose: () => void;
  config?: Record<string, number>;
}

const velocityColor = (band: string) => {
  if (band === 'fast') return 'bg-green-500/20 text-green-400 border-green-500/30';
  if (band === 'medium') return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
  return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
};

export const AmazonSkuModal: FC<AmazonSkuModalProps> = ({ sku, onClose, config = {} as Record<string, number> }) => {
  const docColor = (days: number) => {
    const target    = config.AMAZON_TARGET_DOC    ?? 57;
    const threshold = config.AMAZON_DOC_THRESHOLD ?? 50;
    if (days === 999)           return 'text-blue-400';
    if (days > target + 7)     return 'text-blue-400';
    if (days >= threshold)     return 'text-green-400';
    if (days >= threshold - 7) return 'text-amber-500';
    return 'text-red-500';
  };
  const [chartPeriod, setChartPeriod] = useState<'30' | '90'>('30');
  const [showDebug, setShowDebug] = useState(false);
  const [supplyChain, setSupplyChain] = useState<AmazonSupplyChain | null>(null);
  const [supplyChainLoading, setSupplyChainLoading] = useState(true);
  const [supplyChainError, setSupplyChainError] = useState<string | null>(null);

  useEffect(() => {
    if (!sku?.masterSKU) return;

    setSupplyChainLoading(true);
    setSupplyChainError(null);
    setSupplyChain(null);

    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'get_amazon_sku_supply_chain',
        masterSKU: sku.masterSKU,
      }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          setSupplyChain({
            inProduction:    data.inProduction    || 0,
            inTransit:       data.inTransit       || 0,
            inProductionPOs: data.inProductionPOs || [],
            inTransitPOs:    data.inTransitPOs    || [],
          });
        } else {
          setSupplyChainError(data.message || 'Failed to load supply chain data');
        }
      })
      .catch(err => setSupplyChainError(err.message))
      .finally(() => setSupplyChainLoading(false));
  }, [sku?.masterSKU]);

  const chartData = useMemo(() => {
    const raw = chartPeriod === '30' ? sku.salesHistory30 : sku.salesHistory90;
    if (!raw || raw.length === 0) return [];
    return raw.map(item => ({
      timestamp: new Date(item.date).getTime(),
      units: item.units,
    }));
  }, [sku, chartPeriod]);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[88vw] max-w-5xl h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* HEADER */}
        <header className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3 overflow-hidden">
            <span className="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-sm text-gray-800 dark:text-gray-200 flex-shrink-0">
              {sku.channelSKU}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
              → {sku.masterSKU}
            </span>
            <span className="font-semibold text-gray-900 dark:text-white truncate">
              {sku.productName}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded border font-medium flex-shrink-0 ${velocityColor(sku.replenishment.velocityBand)}`}>
              {sku.replenishment.velocityBand.charAt(0).toUpperCase() + sku.replenishment.velocityBand.slice(1)}
            </span>
            {sku.hasListingIssue && (
              <span className="bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded text-xs font-medium flex-shrink-0">
                ⚠ Listing Issue
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex-shrink-0 ml-4 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white transition-colors"
          >
            ✕
          </button>
        </header>

        {/* BODY */}
        <main className="flex-grow p-6 overflow-y-auto space-y-8">

          {/* SECTION 1 — Sales Trend + MMA Breakdown */}
          <section>
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
              📈 Amazon Sales Trend
            </h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Chart */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Amazon channel only</span>
                  <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
                    {(['30', '90'] as const).map(period => (
                      <button
                        key={period}
                        onClick={() => setChartPeriod(period)}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                          chartPeriod === period
                            ? 'bg-white dark:bg-gray-600 shadow text-orange-500 dark:text-orange-400'
                            : 'text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        {period} Days
                      </button>
                    ))}
                  </div>
                </div>
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} vertical={false} />
                      <XAxis
                        dataKey="timestamp"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        tick={{ fontSize: 10, fill: '#9ca3af' }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={30}
                      />
                      <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={30} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                        labelStyle={{ color: '#94a3b8', fontWeight: 'bold' }}
                        itemStyle={{ color: '#f97316' }}
                        formatter={(value: number) => [value, 'Units']}
                        labelFormatter={(ts) => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                      />
                      <Line type="monotone" dataKey="units" stroke="#f97316" strokeWidth={2.5} dot={false} activeDot={{ r: 5, fill: '#f97316' }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[180px] border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
                    <p className="text-sm text-gray-400 italic">No {chartPeriod}-day sales history</p>
                  </div>
                )}
              </div>

              {/* MMA Breakdown */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">MMA Calculation</h4>
                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 space-y-2 text-sm">
                  <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 pb-2 border-b border-gray-200 dark:border-gray-700">
                    <span>Period</span><span>Units</span><span>Daily Rate</span><span>Weight</span>
                  </div>
                  {[
                    { label: 'Last 15 days', units: sku.mma._buckets?.total15, ads: sku.mma._ads?.ads15, weight: `${Math.round((config.ADS_WEIGHT_15D ?? 0.40) * 100)}%` },
                    { label: 'Last 30 days', units: sku.mma._buckets?.total30, ads: sku.mma._ads?.ads30, weight: `${Math.round((config.ADS_WEIGHT_30D ?? 0.30) * 100)}%` },
                    { label: '30–60 days',   units: sku.mma._buckets?.total60, ads: sku.mma._ads?.ads60, weight: `${Math.round((config.ADS_WEIGHT_60D ?? 0.20) * 100)}%` },
                    { label: '60–90 days',   units: sku.mma._buckets?.total90, ads: sku.mma._ads?.ads90, weight: `${Math.round((config.ADS_WEIGHT_90D ?? 0.10) * 100)}%` },
                  ].map(row => (
                    <div key={row.label} className="flex justify-between text-xs">
                      <span className="text-gray-500 dark:text-gray-400">{row.label}</span>
                      <span className="text-gray-800 dark:text-gray-200">{row.units ?? 0}</span>
                      <span className="text-gray-800 dark:text-gray-200">{row.ads ?? 0}/day</span>
                      <span className="text-gray-400">{row.weight}</span>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-gray-200 dark:border-gray-700 flex justify-between text-xs font-semibold text-gray-700 dark:text-gray-200">
                    <span>Weighted ADS</span>
                    <span>{sku.mma._weightedADS ?? 0}/day</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-gray-800 dark:text-white">
                    <span>Calculated MMA</span>
                    <span>{sku.mma.calculated} units/mo</span>
                  </div>
                  {sku.mma.floorApplied && (
                    <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 rounded px-2 py-1">
                      <span>⚠</span>
                      <span>Floor applied: MMA was below 5 → set to {sku.mma.final}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold text-orange-400 pt-1 border-t border-gray-200 dark:border-gray-700">
                    <span>Final MMA</span>
                    <span>{sku.mma.final} units/mo</span>
                  </div>
                </div>
                {sku.hasListingIssue && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                    <span className="text-red-400 flex-shrink-0">⚠</span>
                    <p className="text-xs text-red-400">{sku.listingIssueMsg}</p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* SECTION 2 — Amazon FBA Inventory */}
          <section>
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
              📦 Amazon FBA Inventory
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                {
                  label: 'FBA Fulfillable',
                  value: sku.amazonInventory.fbaQty,
                  color: sku.amazonInventory.fbaQty < 0 ? 'text-red-400' : 'text-green-400'
                },
                { label: 'Reserved',        value: sku.amazonInventory.reserved, color: '' },
                { label: 'Inbound',         value: sku.amazonInventory.inbound,  color: 'text-blue-400' },
                { label: 'Pending',         value: sku.amazonInventory.pending,  color: 'text-blue-400' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                  <p className={`text-xl font-bold text-gray-800 dark:text-white ${color}`}>
                    {value.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Total Coverage</p>
                <p className="text-lg font-bold text-gray-800 dark:text-white">
                  {(
                    sku.amazonInventory.fbaQty +
                    sku.amazonInventory.reserved +
                    sku.amazonInventory.inbound +
                    sku.amazonInventory.pending
                  ).toLocaleString()} units
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500 dark:text-gray-400">Days of Cover</p>
                <p className={`text-3xl font-bold ${docColor(sku.amazonInventory.docDays)}`}>
                  {sku.amazonInventory.docDays === 999 ? '∞' : `${sku.amazonInventory.docDays}d`}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Target: {config.AMAZON_TARGET_DOC ?? 57} days
                </p>
              </div>
            </div>

            {/* In-transit warning */}
            {sku.inTransitWarning?.hasWarning && (
              <div className="mt-3 flex items-start gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <span className="text-blue-400 text-lg flex-shrink-0">🚢</span>
                <div>
                  <p className="text-blue-400 font-semibold text-sm">Inbound Shipment Arriving Soon</p>
                  <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
                    <strong className="text-gray-700 dark:text-gray-300">{sku.inTransitWarning.qty} units</strong>
                    {' '}arriving in{' '}
                    <strong className="text-blue-400">{sku.inTransitWarning.etaDays} days</strong>
                    {sku.inTransitWarning.poId ? ` (${sku.inTransitWarning.poId})` : ''}.
                    {' '}Consider sending top sellers directly to Amazon FBA from this inbound.
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* ── SUPPLY CHAIN SECTION ─────────────────────────────────────── */}
          <section>
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
              🚚 Supply Chain
              <span className="text-xs font-normal text-gray-400 dark:text-gray-500 ml-1">
                Master SKU: {sku.masterSKU}
              </span>
            </h3>

            {/* Loading state */}
            {supplyChainLoading && (
              <div className="flex items-center justify-center py-8">
                <div className="flex items-center gap-3 text-gray-400 dark:text-gray-500">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-orange-500" />
                  <span className="text-sm">Loading supply chain data...</span>
                </div>
              </div>
            )}

            {/* Error state */}
            {!supplyChainLoading && supplyChainError && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                <span>⚠</span>
                <span>{supplyChainError}</span>
              </div>
            )}

            {/* Data loaded */}
            {!supplyChainLoading && !supplyChainError && supplyChain && (
              <div className="space-y-5">

                {/* ── In Production ──────────────────────────────────────── */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                    🏭 In Production
                    {supplyChain.inProduction > 0 && (
                      <span className="text-xs font-normal text-amber-400">
                        {supplyChain.inProduction.toLocaleString()} units
                      </span>
                    )}
                  </h4>

                  {supplyChain.inProductionPOs.length > 0 ? (
                    <div className="overflow-hidden border border-gray-200 dark:border-gray-700 rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-800">
                          <tr>
                            {['PO #', 'Qty', 'Status'].map(h => (
                              <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                          {supplyChain.inProductionPOs.map((po, idx) => (
                            <tr key={idx} className="even:bg-gray-50/50 dark:even:bg-gray-800/20">
                              <td className="px-4 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300 font-medium">
                                {po.poId}
                              </td>
                              <td className="px-4 py-2.5 text-xs text-gray-700 dark:text-gray-300">
                                {po.qty.toLocaleString()}
                              </td>
                              <td className="px-4 py-2.5">
                                <span className="px-2 py-0.5 rounded text-xs bg-amber-500/20 text-amber-400 border border-amber-500/30 font-medium">
                                  {po.status || 'In Production'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center p-4 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
                      <p className="text-xs text-gray-400 dark:text-gray-500 italic">No items currently in production</p>
                    </div>
                  )}
                </div>

                {/* ── In Transit ─────────────────────────────────────────── */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                    🚢 In Transit
                    {supplyChain.inTransit > 0 && (
                      <span className="text-xs font-normal text-blue-400">
                        {supplyChain.inTransit.toLocaleString()} units
                      </span>
                    )}
                  </h4>

                  {supplyChain.inTransitPOs.length > 0 ? (
                    <div className="overflow-hidden border border-gray-200 dark:border-gray-700 rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-800">
                          <tr>
                            {['PO #', 'Qty', 'Mode', 'Status', 'ETA', 'Days Left'].map(h => (
                              <th key={h} className="px-4 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                          {supplyChain.inTransitPOs.map((po, idx) => {
                            const eta = po.etaDate
                              ? new Date(po.etaDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                              : 'N/A';
                            return (
                              <tr key={idx} className="even:bg-gray-50/50 dark:even:bg-gray-800/20">
                                <td className="px-4 py-2.5 font-mono text-xs text-gray-700 dark:text-gray-300 font-medium">
                                  {po.poId}
                                </td>
                                <td className="px-4 py-2.5 text-xs text-gray-700 dark:text-gray-300">
                                  {po.qty.toLocaleString()}
                                </td>
                                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                                  {po.transportMode || 'Unknown'}
                                </td>
                                <td className="px-4 py-2.5">
                                  <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                                    po.isDelayed
                                      ? 'bg-red-500/20 text-red-400 border-red-500/30'
                                      : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                                  }`}>
                                    {po.isDelayed ? 'Delayed' : (po.status || 'In Transit')}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                                  {eta}
                                </td>
                                <td className={`px-4 py-2.5 text-xs font-semibold ${
                                  po.isDelayed ? 'text-red-400' :
                                  (po.daysRemaining !== null && po.daysRemaining !== undefined && po.daysRemaining <= 15)
                                    ? 'text-amber-400'
                                    : 'text-gray-700 dark:text-gray-300'
                                }`}>
                                  {po.daysRemaining !== null && po.daysRemaining !== undefined
                                    ? `${po.daysRemaining}d`
                                    : '—'}
                                  {po.isDelayed && (
                                    <span className="ml-1 text-[10px] font-normal text-red-400">(delayed)</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center p-4 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
                      <p className="text-xs text-gray-400 dark:text-gray-500 italic">No items currently in transit</p>
                    </div>
                  )}
                </div>

              </div>
            )}
          </section>

          <hr className="border-gray-100 dark:border-gray-700" />

          {/* SECTION 3 — Replenishment Calculation */}
          <section>
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
              🔢 Replenishment Calculation
            </h3>
            {!sku.needsReplenishment ? (
              <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                <span className="text-green-400 text-xl">✓</span>
                <div>
                  <p className="text-green-400 font-semibold text-sm">No replenishment needed</p>
                  <p className="text-gray-500 dark:text-gray-400 text-xs">
                    Current DOC ({sku.amazonInventory.docDays}d) exceeds threshold (50d)
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {[
                  { label: 'Target DOC',       value: `${config.AMAZON_TARGET_DOC ?? 57} days`,       color: '' },
                  { label: 'Current DOC',      value: `${sku.amazonInventory.docDays} days`,           color: docColor(sku.amazonInventory.docDays) },
                  { label: 'DOC Gap',          value: `${sku.replenishment.docGap} days`,              color: 'text-orange-400' },
                  { label: 'Calculated Qty',   value: `${sku.replenishment.calculatedQty} units (gap × MMA ÷ 30)`, color: '' },
                  { label: 'Velocity Band',    value: sku.replenishment.velocityBand,                  color: '' },
                  { label: 'Recommended Qty',  value: `${sku.replenishment.recommendedQty} units`,     color: 'text-orange-400 font-bold' },
                ].map(({ label, value, color }) => (
                  <div
                    key={label}
                    className="flex justify-between items-center px-4 py-2 rounded bg-gray-50 dark:bg-gray-900/50 text-sm"
                  >
                    <span className="text-gray-500 dark:text-gray-400">{label}</span>
                    <span className={`font-medium text-gray-800 dark:text-white ${color}`}>{value}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* SECTION 4 — Warehouse Check */}
          <section>
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
              🏭 Warehouse Availability
            </h3>
            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 space-y-3 text-sm">
              {[
                { label: 'EE Warehouse Stock',               value: sku.warehouseCheck.eeWarehouseStock,  color: 'text-green-400', sign: '' },
                { label: 'Shopify Reserve (30d)',             value: sku.warehouseCheck.shopifyReserve,    color: 'text-red-400',   sign: '-' },
                { label: 'Quick Commerce Reserve',            value: sku.warehouseCheck.qcommReserve ?? 0, color: (sku.warehouseCheck.qcommReserve ?? 0) > 0 ? 'text-red-400' : 'text-gray-400',   sign: (sku.warehouseCheck.qcommReserve ?? 0) > 0 ? '-' : '' },
                { label: 'YEIO Reserve',                      value: sku.warehouseCheck.yeioReserve,       color: sku.warehouseCheck.yeioReserve > 0 ? 'text-red-400' : 'text-gray-400',   sign: sku.warehouseCheck.yeioReserve > 0 ? '-' : '' },
              ].map(({ label, value, color, sign }) => (
                <div key={label} className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">{label}</span>
                  <span className={`font-medium ${color}`}>{sign}{value.toLocaleString()}</span>
                </div>
              ))}
              <div className="pt-2 border-t border-gray-200 dark:border-gray-700 flex justify-between font-bold">
                <span className="text-gray-700 dark:text-gray-300">Available for Amazon</span>
                <span className={sku.warehouseCheck.availableQty > 0 ? 'text-green-400' : 'text-red-400'}>
                  {sku.warehouseCheck.availableQty.toLocaleString()} units
                </span>
              </div>
            </div>
            <div className="mt-2 space-y-0.5">
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Shopify MMA: {sku.warehouseCheck.shopifyMMA} units/mo — 30-day reserve protected
              </p>
              {(sku.warehouseCheck.qcommMMA ?? 0) > 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Quick Commerce MMA: {sku.warehouseCheck.qcommMMA} units/mo (BB, Zepto, Blinkit, Instamart, Flipkart Min, Hamleys) — {sku.warehouseCheck.qcommReserve} units reserved
                </p>
              )}
            </div>
          </section>

          {/* SECTION 5 — Allocation & Shipping Plan */}
          <section>
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white flex items-center gap-2">
              📬 Allocation &amp; Shipping Plan
            </h3>
            <div className="space-y-2 text-sm">
              {[
                { label: 'Auto Allocated Qty', value: `${sku.allocation.autoAllocatedQty} units` },
                { label: 'Manual Override',    value: sku.allocation.isManualOverride ? `Yes — ${sku.allocation.finalAllocatedQty} units` : 'None' },
                { label: 'Pack Size',          value: sku.packSize > 0 ? `${sku.packSize} units/case` : 'N/A' },
                { label: 'Is Combo SKU',       value: sku.isCombo ? 'Yes — case pack skipped' : 'No' },
                {
                  label: 'Rounding Applied',
                  value: sku.packSize > 0 && !sku.isCombo
                    ? `Rounded up to nearest case (${sku.packSize})`
                    : sku.allocation.shippingPlanQty < 30
                    ? 'Rounded to nearest 5'
                    : 'Rounded to nearest 10',
                },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="flex justify-between items-center px-4 py-2 rounded bg-gray-50 dark:bg-gray-900/50"
                >
                  <span className="text-gray-500 dark:text-gray-400">{label}</span>
                  <span className="font-medium text-gray-800 dark:text-white">{value}</span>
                </div>
              ))}

              {/* Final Ship Qty */}
              <div className="flex justify-between items-center px-4 py-3 rounded-lg bg-orange-500/10 border border-orange-500/30 mt-2">
                <span className="text-orange-300 font-semibold">🚚 Shipping Plan Qty</span>
                <span className="text-2xl font-bold text-orange-400">
                  {sku.allocation.shippingPlanQty.toLocaleString()}
                </span>
              </div>

              {/* Split Warning */}
              {sku.warehouseCheck.splitRequired && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-orange-500/10 border border-orange-500/30">
                  <span className="text-orange-400 flex-shrink-0">⇄</span>
                  <div>
                    <p className="text-orange-400 font-semibold text-xs">Inventory Split Applied</p>
                    <p className="text-gray-400 text-xs mt-0.5">
                      Total demand ({sku.warehouseCheck.totalDemandAcrossChannelSkus} units) exceeds
                      available stock ({sku.warehouseCheck.availableQty} units).
                      Proportional split applied by MMA share.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* SECTION 6 — Debug Panel */}
          <section className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setShowDebug(!showDebug)}
              className="flex items-center text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors gap-1"
            >
              🧪 {showDebug ? 'Hide Debug Data' : 'Show Debug Raw Data'}
            </button>
            {showDebug && (
              <pre className="mt-3 p-4 bg-gray-100 dark:bg-gray-950 rounded-lg text-xs overflow-x-auto border border-gray-200 dark:border-gray-700 text-green-600 dark:text-green-400 font-mono max-h-64">
                {JSON.stringify(sku, null, 2)}
              </pre>
            )}
          </section>
        </main>

        {/* FOOTER */}
        <footer className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
};
