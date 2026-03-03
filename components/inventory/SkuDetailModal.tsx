
import React, { FC, useMemo, useState } from 'react';
import { ForecastingSku } from '../../types';
import { Button } from '../ui/Button';
import { XMarkIcon, ChartBarIcon, TruckIcon, GiftIcon, CheckBadgeIcon, ExclamationTriangleIcon, BeakerIcon } from '../icons/Icons';
import { Card } from '../ui/Card';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

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

const Metric: FC<{ label: string; value: string | number; subValue?: string, className?: string }> = ({ label, value, subValue, className }) => (
    <div className={`p-3 rounded-md bg-gray-50 dark:bg-gray-900/50 ${className}`}>
        <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
        <p className="text-2xl font-bold text-gray-800 dark:text-white">{value}</p>
        {subValue && <p className="text-xs text-gray-400 dark:text-gray-500">{subValue}</p>}
    </div>
);

const EmptyState: FC<{ message: string }> = ({ message }) => (
    <div className="flex items-center justify-center p-6 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900/30">
        <p className="text-sm text-gray-500 dark:text-gray-400 italic">{message}</p>
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
        const availableToSell = totalStock - (sku.reservedQty || 0);

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

        // 5. Fill gaps with 0
        const denseData = [];
        for (let i = 0; i <= daysToSubtract; i++) {
            const current = new Date(startDate);
            current.setDate(startDate.getDate() + i);
            const key = current.toISOString().split('T')[0];
            
            denseData.push({
                timestamp: current.getTime(),
                originalDate: key,
                units: dataMap.get(key) || 0 // Use 0 if date is missing
            });
        }

        return denseData;
    }, [sku, chartPeriod]);
    
    if (!sku) return null;
    
    const inTransitPOs = sku.inTransitPOs || [];
    const poHistory = sku.poHistory || [];
    const comboUsage = sku.comboUsage || [];

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-[85vw] max-w-6xl h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <header className="flex items-center justify-between p-4 border-b dark:border-gray-700 flex-shrink-0">
                    <div className="overflow-hidden">
                        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white truncate flex items-center gap-2">
                            <span className="font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-base">{sku.masterSKU}</span>
                            <span className="font-normal truncate">{sku.productName}</span>
                        </h2>
                    </div>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 flex-shrink-0 ml-4">
                        <XMarkIcon className="w-6 h-6 text-gray-500" />
                    </button>
                </header>

                {/* Body */}
                <main className="flex-grow p-6 overflow-y-auto space-y-8 scroll-smooth">
                    {/* Section 1: Sales Metrics */}
                    <section>
                        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><ChartBarIcon className="w-5 h-5 text-primary-500" /> Sales Metrics</h3>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <h4 className="font-semibold text-sm">Sales Trend</h4>
                                        <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
                                            <button 
                                                onClick={() => setChartPeriod('30')}
                                                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${chartPeriod === '30' ? 'bg-white dark:bg-gray-600 shadow text-primary-600 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
                                            >
                                                30 Days
                                            </button>
                                            <button 
                                                onClick={() => setChartPeriod('90')}
                                                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${chartPeriod === '90' ? 'bg-white dark:bg-gray-600 shadow text-primary-600 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}
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
                                                    contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(4px)', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                                                    labelStyle={{ color: '#374151', fontWeight: 'bold', marginBottom: '0.25rem' }}
                                                    itemStyle={{ color: '#2563eb' }}
                                                    formatter={(value: number) => [value, 'Units Sold']}
                                                    labelFormatter={(unixTime) => new Date(unixTime).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                                                />
                                                <Line 
                                                    type="monotone" 
                                                    dataKey="units" 
                                                    stroke="#3b82f6" 
                                                    strokeWidth={3}
                                                    dot={false}
                                                    activeDot={{ r: 6 }}
                                                />
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

                    <hr className="dark:border-gray-700" />
                    
                    {/* Section 2 & 3 Combined: Inventory & Channel */}
                     <section>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div>
                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">📦 Stock by Location</h3>
                                {Object.keys(sku.stockByLocation || {}).length > 0 ? (
                                    <div className="overflow-hidden border dark:border-gray-700 rounded-lg">
                                        <table className="min-w-full text-sm">
                                            <thead className="bg-gray-50 dark:bg-gray-800"><tr><th className="px-4 py-2 text-left font-medium">Location</th><th className="px-4 py-2 text-right font-medium">Units</th></tr></thead>
                                            <tbody className="divide-y dark:divide-gray-700">
                                                {Object.entries((sku.stockByLocation || {}) as Record<string, number>).map(([loc, qty]) => <tr key={loc} className="even:bg-gray-50 dark:even:bg-gray-900/50">
                                                    <td className="px-4 py-2">{loc}</td><td className="px-4 py-2 text-right">{formatNumber(qty)}</td>
                                                </tr>)}
                                                <tr><td className="px-4 py-2">Reserved</td><td className="px-4 py-2 text-right">{formatNumber(sku.reservedQty || 0)}</td></tr>
                                            </tbody>
                                            <tfoot className="bg-gray-100 dark:bg-gray-700 font-semibold">
                                                <tr><td className="px-4 py-2 text-green-600">Available</td><td className="px-4 py-2 text-right text-green-600">{formatNumber(availableToSell)}</td></tr>
                                                <tr><td className="px-4 py-2">TOTAL</td><td className="px-4 py-2 text-right">{formatNumber(totalStock)}</td></tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                ) : <EmptyState message="No location stock data available" />}
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">🛒 Channel Split (90 Days)</h3>
                                {channelData.length > 0 ? (
                                    <div className="overflow-hidden border dark:border-gray-700 rounded-lg">
                                        <table className="min-w-full text-sm">
                                            <thead className="bg-gray-50 dark:bg-gray-800"><tr><th className="px-4 py-2 text-left font-medium">Channel</th><th className="px-4 py-2 text-right font-medium">Sales</th><th className="px-4 py-2 text-right font-medium">%</th></tr></thead>
                                            <tbody className="divide-y dark:divide-gray-700">
                                                {channelData.map((ch, idx) => <tr key={idx} className="even:bg-gray-50 dark:even:bg-gray-900/50">
                                                    <td className="px-4 py-2">{ch.name}</td>
                                                    <td className="px-4 py-2 text-right">{formatNumber(ch.units)}</td>
                                                    <td className="px-4 py-2 text-right">{ch.percentage}%</td>
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
                        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><TruckIcon className="w-5 h-5 text-blue-500" /> Supply Chain</h3>
                        
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                            <Metric label="Avg Lead Time (All)" value={`${avgLeadTime} days`} />
                            <Metric label="Avg Sea Lead Time" value={`${avgSeaLeadTime} days`} />
                            <Metric label="Avg Air Lead Time" value={`${avgAirLeadTime} days`} />
                        </div>

                        <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">In-Transit POs</h4>
                        {inTransitPOs.length > 0 ? (
                            <div className="overflow-x-auto border dark:border-gray-700 rounded-lg mb-6">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-gray-50 dark:bg-gray-800">
                                        <tr>
                                            {['PO #', 'Qty', 'Mode', 'Status', 'ETA', 'Days Left'].map(h => <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y dark:divide-gray-700">
                                        {inTransitPOs.map(po => (
                                            <tr key={po.poId} className="even:bg-gray-50 dark:even:bg-gray-900/50">
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

                        <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">PO History (Last 5)</h4>
                        {poHistory.length > 0 ? (
                            <div className="overflow-x-auto border dark:border-gray-700 rounded-lg">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-gray-50 dark:bg-gray-800">
                                        <tr>{['PO #', 'Qty', 'Ordered', 'Received', 'Mode', 'Lead Time'].map(h => <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>)}</tr>
                                    </thead>
                                    <tbody className="divide-y dark:divide-gray-700">
                                        {poHistory.slice(0, 5).map(po => (
                                            <tr key={po.poId} className="even:bg-gray-50 dark:even:bg-gray-900/50">
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
                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><CheckBadgeIcon className="w-5 h-5 text-green-500" /> Business Rules</h3>
                                <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 space-y-3">
                                    <div className="flex justify-between">
                                        <span className="text-sm text-gray-500">Supplier</span>
                                        <span className="font-medium">{sku.businessRules?.supplier || 'N/A'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-sm text-gray-500">MOQ</span>
                                        <span className="font-medium">{formatNumber(sku.businessRules?.moq || 0)} units</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-sm text-gray-500">Safety Stock</span>
                                        <span className="font-medium">{formatNumber(sku.businessRules?.safetyStock || 0)} units</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-sm text-gray-500">Unit Cost</span>
                                        <span className="font-medium">{formatCurrency(sku.businessRules?.unitCost || sku.unitCost || 0)}</span>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><GiftIcon className="w-5 h-5 text-purple-500" /> Combo Usage</h3>
                                {comboUsage.length > 0 ? (
                                    <div className="space-y-3">
                                        <p className="text-sm text-gray-500">This item is part of <span className="font-bold text-purple-600">{comboUsage.length}</span> combo(s), driving <span className="font-bold">{sku.comboImpactPercent}%</span> of sales.</p>
                                        <div className="border dark:border-gray-700 rounded-lg overflow-hidden">
                                            <table className="min-w-full text-sm">
                                                <thead className="bg-gray-50 dark:bg-gray-800"><tr><th className="px-4 py-2 text-left">Combo Name</th><th className="px-4 py-2 text-right">Qty/Combo</th></tr></thead>
                                                <tbody className="divide-y dark:divide-gray-700">
                                                    {comboUsage.map(c => (
                                                        <tr key={c.comboSKU} className="even:bg-gray-50 dark:even:bg-gray-900/50">
                                                            <td className="px-4 py-2">{c.comboName}</td>
                                                            <td className="px-4 py-2 text-right">{c.qtyPerCombo}</td>
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
                    <section className="pt-4 border-t dark:border-gray-700">
                        <button 
                            onClick={() => setShowDebug(!showDebug)} 
                            className="flex items-center text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        >
                            <BeakerIcon className="w-4 h-4 mr-1" />
                            {showDebug ? "Hide Debug Data" : "Debug Raw Data"}
                        </button>
                        {showDebug && (
                            <pre className="mt-4 p-4 bg-gray-100 dark:bg-gray-900 rounded-lg text-xs overflow-x-auto border border-gray-200 dark:border-gray-700">
                                {JSON.stringify(sku, null, 2)}
                            </pre>
                        )}
                    </section>
                </main>

                {/* Footer */}
                <footer className="p-4 border-t dark:border-gray-700 flex justify-end flex-shrink-0">
                    <Button variant="secondary" onClick={onClose}>Close</Button>
                </footer>
            </div>
        </div>
    );
};
