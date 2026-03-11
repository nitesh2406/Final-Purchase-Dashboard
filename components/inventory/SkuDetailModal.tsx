
import React, { FC, useMemo, useState } from 'react';
import { ForecastingSku } from '../../types';
import { Button } from '../ui/Button';
import { XMarkIcon, ChartBarIcon, TruckIcon, GiftIcon, CheckBadgeIcon, ExclamationTriangleIcon, BeakerIcon } from '../icons/Icons';
import { Card } from '../ui/Card';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

interface SkuDetailModalProps {
    sku: ForecastingSku | null;
    onClose: () => void;
}

const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
const formatNumber = (num: number) => new Intl.NumberFormat('en-IN').format(num);
const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

// U2 FIX: Use slate theme to match rest of app dark mode
const Metric: FC<{ label: string; value: string | number; subValue?: string, className?: string }> = ({ label, value, subValue, className }) => (
    <div className={`p-3 rounded-md bg-slate-700/50 border border-slate-600/50 ${className}`}>
        <p className="text-sm text-slate-400">{label}</p>
        <p className="text-2xl font-bold text-white">{value}</p>
        {subValue && <p className="text-xs text-slate-500">{subValue}</p>}
    </div>
);

const EmptyState: FC<{ message: string }> = ({ message }) => (
    <div className="flex items-center justify-center p-6 border-2 border-dashed border-slate-600 rounded-lg bg-slate-800/50">
        <p className="text-sm text-slate-400 italic">{message}</p>
    </div>
);

export const SkuDetailModal: FC<SkuDetailModalProps> = ({ sku, onClose }) => {
    const [showDebug, setShowDebug] = useState(false);
    const [chartPeriod, setChartPeriod] = useState<'30' | '90'>('30');

    const { totalStock, availableToSell, channelData, avgLeadTime, avgAirLeadTime, avgSeaLeadTime } = useMemo(() => {
        if (!sku) {
            return { totalStock: 0, availableToSell: 0, channelData: [], avgLeadTime: 0, avgAirLeadTime: 0, avgSeaLeadTime: 0 };
        }

        // Safeguard: stockByLocation might be undefined from backend
        const stockLoc = (sku.stockByLocation || {}) as Record<string, number>;
        const totalStock = Object.values(stockLoc).reduce((a: number, b: number) => a + b, 0);
        const availableToSell = totalStock;

        // Safeguard: channelSplit might be undefined
        const split = sku.channelSplit || {};
        const channelData = Object.entries(split).map(([name, data]: [string, any]) => ({
            name: name.charAt(0).toUpperCase() + name.slice(1),
            percentage: data?.percentage || 0,
            units: data?.units || 0
        }));

        let avgLeadTime = 0, avgAirLeadTime = 0, avgSeaLeadTime = 0;
        const poHistory = sku.poHistory || [];

        if (poHistory.length > 0) {
            const totalLeadTime = poHistory.reduce((sum, po) => sum + (po.actualLeadTime || 0), 0);
            avgLeadTime = Math.round(totalLeadTime / poHistory.length);

            const airPos = poHistory.filter(po => po.transportMode === 'Air');
            const seaPos = poHistory.filter(po => po.transportMode === 'Sea');

            const totalAirLeadTime = airPos.reduce((sum, po) => sum + (po.actualLeadTime || 0), 0);
            avgAirLeadTime = airPos.length > 0 ? Math.round(totalAirLeadTime / airPos.length) : 0;

            const totalSeaLeadTime = seaPos.reduce((sum, po) => sum + (po.actualLeadTime || 0), 0);
            avgSeaLeadTime = seaPos.length > 0 ? Math.round(totalSeaLeadTime / seaPos.length) : 0;
        }

        return { totalStock, availableToSell, channelData, avgLeadTime, avgAirLeadTime, avgSeaLeadTime };
    }, [sku]);

    // Robust Data Processing for Chart
    const chartData = useMemo(() => {
        if (!sku) return [];

        // 1. Prioritize 90 day history if available, otherwise fallback to 30 day
        let rawData = (sku.salesHistory90 && sku.salesHistory90.length > 0)
            ? sku.salesHistory90
            : (sku.salesHistory30 || []);

        if (!rawData || rawData.length === 0) return [];

        // 2. Parse Helpers
        const parseUnits = (val: any): number => {
            if (typeof val === 'number') return val;
            if (typeof val === 'string') {
                const cleaned = val.replace(/,/g, '').trim();
                return cleaned === '' ? 0 : parseFloat(cleaned);
            }
            return 0;
        };

        // 3. Process existing data into a Map for quick lookup
        const dataMap = new Map<string, number>();
        let maxDate = 0;

        rawData.forEach(item => {
            const d = new Date(item.date);
            if (!isNaN(d.getTime())) {
                // Normalize to YYYY-MM-DD for key
                const key = d.toISOString().split('T')[0];
                dataMap.set(key, parseUnits(item.units));
                if (d.getTime() > maxDate) maxDate = d.getTime();
            }
        });

        // 4. Determine Date Range (End Date is either today or the last available data point)
        const endDate = maxDate > 0 ? new Date(maxDate) : new Date();
        const daysToSubtract = chartPeriod === '30' ? 29 : 89; // 30 or 90 days inclusive
        const startDate = new Date(endDate);
        startDate.setDate(endDate.getDate() - daysToSubtract);

        // 5. Fill gaps with 0, and also merge B2C data
        const b2cMap = new Map<string, number>();
        (sku.salesHistory90B2C || []).forEach(item => {
            const d = new Date(item.date);
            if (!isNaN(d.getTime())) {
                const key = d.toISOString().split('T')[0];
                b2cMap.set(key, parseUnits(item.units));
            }
        });

        const denseData = [];
        for (let i = 0; i <= daysToSubtract; i++) {
            const current = new Date(startDate);
            current.setDate(startDate.getDate() + i);
            const key = current.toISOString().split('T')[0];

            denseData.push({
                timestamp: current.getTime(),
                originalDate: key,
                units: dataMap.get(key) || 0,
                unitsB2C: b2cMap.size > 0 ? (b2cMap.get(key) || 0) : undefined,
            });
        }

        return denseData;
    }, [sku, chartPeriod]);

    if (!sku) return null;

    const inTransitPOs = sku.inTransitPOs || [];
    const poHistory = sku.poHistory || [];
    const comboUsage = sku.comboUsage || [];

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            {/* U2 FIX: Use slate-800 dark theme matching app */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-[85vw] max-w-6xl h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <header className="flex items-center justify-between p-4 border-b border-slate-700 flex-shrink-0">
                    <div className="overflow-hidden">
                        <h2 className="text-xl sm:text-2xl font-bold text-white truncate flex items-center gap-2">
                            <span className="font-mono bg-slate-700 px-2 py-1 rounded text-base text-slate-200">{sku.masterSKU}</span>
                            <span className="font-normal text-slate-300 truncate">{sku.productName}</span>
                        </h2>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-700 flex-shrink-0 ml-4">
                        <XMarkIcon className="w-6 h-6 text-slate-400" />
                    </button>
                </header>

                {/* Body */}
                <main className="flex-grow p-6 overflow-y-auto space-y-8 scroll-smooth bg-slate-800">
                    {/* Section 1: Sales Metrics */}
                    <section>
                        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-white"><ChartBarIcon className="w-5 h-5 text-primary-400" /> Sales Metrics</h3>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <h4 className="font-semibold text-sm text-slate-200">Sales Trend</h4>
                                        <div className="flex bg-slate-700 rounded-lg p-0.5">
                                            <button
                                                onClick={() => setChartPeriod('30')}
                                                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${chartPeriod === '30' ? 'bg-slate-500 shadow text-white' : 'text-slate-400 hover:text-slate-200'}`}
                                            >
                                                30 Days
                                            </button>
                                            <button
                                                onClick={() => setChartPeriod('90')}
                                                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${chartPeriod === '90' ? 'bg-slate-500 shadow text-white' : 'text-slate-400 hover:text-slate-200'}`}
                                            >
                                                90 Days
                                            </button>
                                        </div>
                                    </div>
                                    {chartData.length > 0 ? (
                                        <ResponsiveContainer width="100%" height={220}>
                                            <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                                                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.3} vertical={false} />
                                                <XAxis
                                                    dataKey="timestamp"
                                                    type="number"
                                                    domain={['dataMin', 'dataMax']}
                                                    tickFormatter={(unixTime) => new Date(unixTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                                                    axisLine={false}
                                                    tickLine={false}
                                                    minTickGap={30}
                                                />
                                                <YAxis
                                                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                                                    axisLine={false}
                                                    tickLine={false}
                                                    width={45}
                                                    domain={[0, 'auto']}
                                                />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}
                                                    labelStyle={{ color: '#94a3b8', fontWeight: 'bold', marginBottom: '0.25rem' }}
                                                    itemStyle={{ color: '#60a5fa' }}
                                                    formatter={(value: number) => [value, 'Units Sold']}
                                                    labelFormatter={(unixTime) => new Date(unixTime).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                                                />
                                                {/* Task 5: Two lines — Total (blue) + B2C Only (green dashed) */}
                                                <Legend
                                                    verticalAlign="top"
                                                    height={24}
                                                    formatter={(value: string) => <span style={{ color: '#94a3b8', fontSize: 11 }}>{value}</span>}
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="units"
                                                    name="Total"
                                                    stroke="#3b82f6"
                                                    strokeWidth={3}
                                                    dot={false}
                                                    activeDot={{ r: 6 }}
                                                />
                                                {(sku.salesHistory90B2C || []).length > 0 && (
                                                    <Line
                                                        type="monotone"
                                                        dataKey="unitsB2C"
                                                        name="B2C Only"
                                                        stroke="#10b981"
                                                        strokeWidth={2}
                                                        dot={false}
                                                        activeDot={{ r: 5 }}
                                                        strokeDasharray="4 2"
                                                    />
                                                )}
                                            </LineChart>
                                        </ResponsiveContainer>
                                    ) : <EmptyState message={`No ${chartPeriod}-day sales history data available`} />}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 auto-rows-min">
                                <Metric label="Average Daily Sales" value={`${(sku.avgDailySales || 0).toFixed(1)}`} subValue="units/day" className="col-span-2" />
                                <Metric label="Sales Velocity" value={`${sku.salesVelocity > 0 ? '↗️' : '↘️'} ${sku.salesVelocity || 0}%`} className={sku.salesVelocity > 0 ? 'text-green-600' : 'text-red-500'} />
                                <Metric label="Peak Sales Day" value={sku.peakSalesDay?.units || 0} subValue={sku.peakSalesDay?.date ? formatDate(sku.peakSalesDay.date) : '-'} />
                                <Metric label="Total 90D Sales" value={formatNumber(sku.total90dSales || 0)} subValue="units" />
                                <Metric label="Total 30D Sales" value={formatNumber(sku.total30dSales || 0)} subValue="units" />
                                <Metric label="Days of Cover" value={isFinite(sku.daysOfCover) ? sku.daysOfCover.toFixed(0) : '∞'} subValue="days" />

                                <div className="col-span-2">
                                    <h4 className="font-semibold text-sm mb-1">📉 Stock Availability (90D)</h4>
                                    {sku.outOfStock90Days === 0 ? (
                                        <div className="p-3 rounded-md bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-200 flex items-center gap-2 text-sm">
                                            <CheckBadgeIcon className="w-5 h-5" /> No stockouts in the last 90 days.
                                        </div>
                                    ) : (
                                        <div className={`p-3 rounded-md grid grid-cols-2 gap-x-4 gap-y-1 text-sm
                                            ${sku.outOfStock90Days > 7 ? 'bg-red-50 dark:bg-red-900/30' : 'bg-yellow-50 dark:bg-yellow-900/30'}`}>
                                            <div className={`font-semibold ${sku.outOfStock90Days > 7 ? 'text-red-700 dark:text-red-200' : 'text-yellow-700 dark:text-yellow-200'}`}>
                                                Out of Stock (90D): {sku.outOfStock90Days} days ⚠️
                                            </div>
                                            <div className={`${sku.outOfStock30Days > 0 ? 'font-semibold' : ''}`}>
                                                Out of Stock (30D): {sku.outOfStock30Days} days
                                            </div>
                                            <div className="col-span-2 text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                Last Stockout: {
                                                    sku.lastStockoutStart && sku.lastStockoutEnd ?
                                                        (sku.lastStockoutStart === sku.lastStockoutEnd ? formatDate(sku.lastStockoutStart) : `${formatDate(sku.lastStockoutStart)} to ${formatDate(sku.lastStockoutEnd)}`)
                                                        : 'N/A'
                                                }
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {sku.stockoutGapDays > 0 && (
                                    <div className="col-span-2 flex items-start gap-3 p-3 rounded-lg bg-orange-500/10 border border-orange-500/30 mt-3">
                                        <span className="text-orange-400 text-lg">⚠️</span>
                                        <div>
                                            <p className="text-orange-400 font-semibold text-sm">Stockout Gap Detected</p>
                                            <p className="text-slate-300 text-xs mt-1">
                                                Current stock runs out in{' '}
                                                <strong className="text-white">{Math.floor(sku.daysOfCover)} days</strong>,
                                                but earliest inbound arrives in{' '}
                                                <strong className="text-white">
                                                    {Math.floor(sku.daysOfCover) + sku.stockoutGapDays} days
                                                </strong>.
                                                <span className="text-orange-400 font-semibold ml-1">
                                                    {sku.stockoutGapDays}-day stockout gap.
                                                </span>
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>

                    <hr className="border-slate-700" />

                    {/* Section 2 & 3 Combined: Inventory & Channel */}
                    <section>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div>
                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-white">📦 Stock by Location</h3>
                                {Object.keys(sku.stockByLocation || {}).length > 0 ? (
                                    <div className="overflow-hidden border border-slate-600 rounded-lg">
                                        <table className="min-w-full text-sm">
                                            <thead className="bg-slate-700"><tr><th className="px-4 py-2 text-left font-medium text-slate-300">Location</th><th className="px-4 py-2 text-right font-medium text-slate-300">Units</th></tr></thead>
                                            <tbody className="divide-y divide-slate-700">
                                                {Object.entries((sku.stockByLocation || {}) as Record<string, number>).map(([loc, qty]) => (
                                                    <tr key={loc} className="even:bg-slate-700/30 text-slate-200">
                                                        <td className="px-4 py-2">{loc}</td>
                                                        <td className="px-4 py-2 text-right">{formatNumber(qty)}</td>
                                                    </tr>
                                                ))}
                                                {/* Kit Stock Row - Only if > 0 */}
                                                {(sku.kitStockContribution || 0) > 0 && (
                                                    <tr className="text-blue-400">
                                                        <td className="px-4 py-2">
                                                            🧩 Kit Stock <span className="text-xs text-gray-500 font-normal ml-1">(included above)</span>
                                                        </td>
                                                        <td className="px-4 py-2 text-right">{formatNumber(sku.kitStockContribution || 0)}</td>
                                                    </tr>
                                                )}
                                                {/* Reserved Row - styling updated to muted */}
                                                <tr className="text-gray-500 dark:text-gray-400">
                                                    <td className="px-4 py-2">
                                                        Reserved <span className="text-xs font-normal ml-1">(included above)</span>
                                                    </td>
                                                    <td className="px-4 py-2 text-right">{formatNumber(sku.reservedQty || 0)}</td>
                                                </tr>
                                            </tbody>
                                            <tfoot className="bg-slate-700 font-semibold">
                                                {/* Renamed Available to TOTAL and kept green styling */}
                                                <tr>
                                                    <td className="px-4 py-2 text-green-400">TOTAL</td>
                                                    <td className="px-4 py-2 text-right text-green-400">{formatNumber(availableToSell)}</td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                ) : <EmptyState message="No location stock data available" />}
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-white">🛒 Channel Split (90 Days)</h3>
                                {channelData.length > 0 ? (
                                    <div className="overflow-hidden border border-slate-600 rounded-lg">
                                        <table className="min-w-full text-sm">
                                            <thead className="bg-slate-700"><tr><th className="px-4 py-2 text-left font-medium text-slate-300">Channel</th><th className="px-4 py-2 text-right font-medium text-slate-300">Sales</th><th className="px-4 py-2 text-right font-medium text-slate-300">%</th></tr></thead>
                                            <tbody className="divide-y divide-slate-700">
                                                {channelData.map((ch, idx) => <tr key={idx} className="even:bg-slate-700/30 text-slate-200">
                                                    <td className="px-4 py-2">{ch.name}</td>
                                                    {/* Task 9: Round percentage to 1 decimal */}
                                                    <td className="px-4 py-2 text-right">{formatNumber(ch.units)}</td>
                                                    <td className="px-4 py-2 text-right">{(ch.percentage).toFixed(1)}%</td>
                                                </tr>)}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : <EmptyState message="No channel split data available" />}
                            </div>
                        </div>
                    </section>

                    <hr className="dark:border-gray-700" />

                    {/* Section 4: Supply Chain */}
                    <section>
                        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-white"><TruckIcon className="w-5 h-5 text-blue-400" /> Supply Chain</h3>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                            <Metric label="Avg Lead Time (All)" value={`${avgLeadTime} days`} />
                            <Metric label="Avg Sea Lead Time" value={`${avgSeaLeadTime} days`} />
                            <Metric label="Avg Air Lead Time" value={`${avgAirLeadTime} days`} />
                        </div>

                        {/* Task 2: Split into In Production + In Transit sections */}
                        {/* Section A: In Production */}
                        {(sku.inProductionPOs || []).length > 0 && (
                            <>
                                <h4 className="font-semibold text-amber-400 mb-2">🏭 In Production</h4>
                                <div className="overflow-x-auto border border-amber-500/30 rounded-lg mb-4">
                                    <table className="min-w-full text-sm">
                                        <thead className="bg-amber-500/10">
                                            <tr>
                                                {['PO #', 'Qty', 'Status'].map(h => <th key={h} className="px-4 py-2 text-left font-medium text-amber-400">{h}</th>)}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-700">
                                            {(sku.inProductionPOs || []).map(po => (
                                                <tr key={po.poId} className="even:bg-slate-700/30 text-slate-200">
                                                    <td className="px-4 py-2 font-medium">{po.poId}</td>
                                                    <td className="px-4 py-2">{formatNumber(po.qty)}</td>
                                                    <td className="px-4 py-2"><span className="px-2 py-0.5 rounded text-xs bg-amber-500/10 text-amber-300">{po.status}</span></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}

                        {/* Section B: In Transit */}
                        <h4 className="font-semibold text-slate-300 mb-2">🚢 In Transit</h4>
                        {inTransitPOs.length > 0 ? (
                            <div className="overflow-x-auto border border-slate-600 rounded-lg mb-6">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-slate-700">
                                        <tr>
                                            {['PO #', 'Qty', 'Mode', 'Status', 'ETA', 'Days Left'].map(h => <th key={h} className="px-4 py-2 text-left font-medium text-slate-300">{h}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700">
                                        {inTransitPOs.map(po => (
                                            <tr key={po.poId} className="even:bg-slate-700/30 text-slate-200">
                                                <td className="px-4 py-2 font-medium">{po.poId}</td>
                                                <td className="px-4 py-2">{formatNumber(po.qty)}</td>
                                                <td className="px-4 py-2">{po.transportMode}</td>
                                                <td className="px-4 py-2">
                                                    <span className={`px-2 py-0.5 rounded text-xs ${po.status === 'Shipped' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}`}>{po.status}</span>
                                                </td>
                                                <td className="px-4 py-2">{formatDate(po.etaDate)}</td>
                                                <td className={`px-4 py-2 font-semibold ${po.isDelayed ? 'text-red-500' : 'text-gray-700 dark:text-gray-300'}`}>
                                                    {/* FIX: Changed delayDays to delay_days to match interface in types.ts */}
                                                    {po.daysRemaining} {po.isDelayed && <span className="text-xs font-normal">(Delayed {po.delay_days}d)</span>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : <div className="mb-6"><EmptyState message="No POs currently in transit" /></div>}

                        <h4 className="font-semibold text-slate-300 mb-2">PO History (Last 5)</h4>
                        {poHistory.length > 0 ? (
                            <div className="overflow-x-auto border border-slate-600 rounded-lg">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-slate-700">
                                        <tr>{['PO #', 'Qty', 'Ordered', 'Received', 'Mode', 'Lead Time'].map(h => <th key={h} className="px-4 py-2 text-left font-medium text-slate-300">{h}</th>)}</tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-700">
                                        {poHistory.slice(0, 5).map(po => (
                                            <tr key={po.poId} className="even:bg-slate-700/30 text-slate-200">
                                                <td className="px-4 py-2 font-medium">{po.poId}</td>
                                                <td className="px-4 py-2">{formatNumber(po.qty)}</td>
                                                <td className="px-4 py-2">{formatDate(po.orderDate)}</td>
                                                <td className="px-4 py-2">{formatDate(po.receivedDate)}</td>
                                                <td className="px-4 py-2">{po.transportMode}</td>
                                                <td className="px-4 py-2">{po.actualLeadTime} days</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : <EmptyState message="No PO history available" />}
                    </section>

                    <hr className="dark:border-gray-700" />

                    {/* Section 5: Business Rules & Combos */}
                    <section>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-white"><CheckBadgeIcon className="w-5 h-5 text-green-400" /> Business Rules</h3>
                                <div className="bg-slate-700/50 border border-slate-600/50 rounded-lg p-4 space-y-3">
                                    <div className="flex justify-between">
                                        <span className="text-sm text-slate-400">Supplier</span>
                                        <span className="font-medium text-slate-200">{sku.businessRules?.supplier || 'N/A'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-sm text-slate-400">MOQ</span>
                                        <span className="font-medium text-slate-200">{formatNumber(sku.businessRules?.moq || 0)} units</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-sm text-slate-400">Safety Stock</span>
                                        <span className="font-medium text-slate-200">{formatNumber(sku.businessRules?.safetyStock || 0)} units</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-sm text-slate-400">Unit Cost</span>
                                        <span className="font-medium text-slate-200">{formatCurrency(sku.businessRules?.unitCost || sku.unitCost || 0)}</span>
                                    </div>
                                </div>
                                {/* Task 3: BULK pattern ticker */}
                                {sku.suggestBulkSs && (
                                    <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 mt-2">
                                        <span className="text-amber-400">⚡</span>
                                        <p className="text-amber-400 text-xs font-medium">
                                            BULK pattern detected ({sku.bulkOrders || 0} orders in 90 days) — consider adding this SKU to the BULK_SKUs sheet for SS_BULK calculation.
                                        </p>
                                    </div>
                                )}
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-white"><GiftIcon className="w-5 h-5 text-purple-400" /> Combo Usage</h3>
                                {comboUsage.length > 0 ? (
                                    <div className="space-y-3">
                                        <p className="text-sm text-gray-500">This item is part of <span className="font-bold text-purple-600">{comboUsage.length}</span> combo(s), driving <span className="font-bold">{sku.comboImpactPercent}%</span> of sales.</p>
                                        <div className="border border-slate-600 rounded-lg overflow-hidden">
                                            <table className="min-w-full text-sm">
                                                {/* Task 6: Added 90D Sales column */}
                                                <thead className="bg-slate-700"><tr><th className="px-4 py-2 text-left text-slate-300">Combo Name</th><th className="px-4 py-2 text-right text-slate-300">Qty/Combo</th><th className="px-4 py-2 text-right text-slate-300">90D Sales</th></tr></thead>
                                                <tbody className="divide-y divide-slate-700">
                                                    {comboUsage.map(c => (
                                                        <tr key={c.comboSKU} className="even:bg-slate-700/30 text-slate-200">
                                                            <td className="px-4 py-2">{c.comboName}</td>
                                                            <td className="px-4 py-2 text-right">{c.qtyPerCombo}</td>
                                                            <td className="px-4 py-2 text-right">{c.unitsSold90Days !== undefined ? formatNumber(Math.round(c.unitsSold90Days)) : '—'}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                ) : <EmptyState message="This item is not part of any combos" />}
                            </div>
                        </div>
                    </section>

                    {/* Section 6: Debug Info */}
                    <section className="pt-4 border-t border-slate-700">
                        <button
                            onClick={() => setShowDebug(!showDebug)}
                            className="flex items-center text-xs text-slate-500 hover:text-slate-300 transition-colors"
                        >
                            <BeakerIcon className="w-4 h-4 mr-1" />
                            {showDebug ? "Hide Debug Data" : "Debug Raw Data"}
                        </button>
                        {showDebug && (
                            <pre className="mt-4 p-4 bg-slate-900 rounded-lg text-xs overflow-x-auto border border-slate-700 text-slate-300">
                                {/* Debug: focused on new fields */}
                                {JSON.stringify({
                                    b2bRegularUnits: sku.b2bRegularUnits,
                                    bulkUnits: sku.bulkUnits,
                                    bulkOrders: sku.bulkOrders,
                                    suggestBulkSs: sku.suggestBulkSs,
                                    daysOfCover: sku.daysOfCover,
                                    effectiveDaysOfCover: sku.effectiveDaysOfCover,
                                    inProduction: sku.inProduction,
                                    inProductionPOs_count: (sku.inProductionPOs || []).length,
                                    salesHistory90B2C_points: (sku.salesHistory90B2C || []).length,
                                    _fullData: sku,
                                }, null, 2)}
                            </pre>
                        )}
                    </section>
                </main>

                {/* Footer */}
                <footer className="p-4 border-t border-slate-700 bg-slate-800 flex justify-end flex-shrink-0 rounded-b-xl">
                    <Button variant="secondary" onClick={onClose}>Close</Button>
                </footer>
            </div>
        </div>
    );
};
