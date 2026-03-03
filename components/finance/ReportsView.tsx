import React, { useState, useMemo } from 'react';
import { Card } from '../ui/Card';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from 'recharts';
import { MOCK_VENDORS } from '../../constants';
import { Shipment } from '../../types';
import { Button } from '../ui/Button';
import { ShipIcon, AirplaneIcon } from '../icons/Icons';

const agingData = [
  { name: '0-30 Days', value: 120000 },
  { name: '31-60 Days', value: 75000 },
  { name: '61-90 Days', value: 30000 },
  { name: '90+ Days', value: 15000 },
];

const COLORS = ['#3b82f6', '#8884d8', '#ffc658', '#ff8042'];

const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

const MetricCard: React.FC<{ title: string; value: string | number; icon?: React.ReactNode }> = ({ title, value, icon }) => (
    <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg">
        <h4 className="text-sm text-gray-500 dark:text-gray-400 flex items-center">{icon && <span className="mr-2">{icon}</span>}{title}</h4>
        <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
);

interface ReportsViewProps {
    shipments: Shipment[];
}

export const ReportsView: React.FC<ReportsViewProps> = ({ shipments }) => {
    const [period, setPeriod] = useState('All Time');
    const [mode, setMode] = useState<'All' | 'Sea' | 'Air'>('All');

    const spendByVendor = MOCK_VENDORS.map(vendor => ({
        name: vendor.name,
        spend: (vendor.creditLimit || 0) * (Math.random() * 0.8 + 0.2) // Mock spend data
    })).filter(v => v.spend > 0);
    
    const filteredShipments = useMemo(() => {
        let filtered = [...shipments];
        if (mode !== 'All') {
            filtered = filtered.filter(s => s.mode === mode);
        }
        // TODO: Implement period filtering
        return filtered;
    }, [shipments, period, mode]);

    const freightAnalysis = useMemo(() => {
        const totalFreightCost = filteredShipments.reduce((sum, s) => sum + s.financials.shippingCost, 0);
        const avgCostPerShipment = filteredShipments.length > 0 ? totalFreightCost / filteredShipments.length : 0;
        const costBySea = filteredShipments.filter(s => s.mode === 'Sea').reduce((sum, s) => sum + s.financials.shippingCost, 0);
        const costByAir = filteredShipments.filter(s => s.mode === 'Air').reduce((sum, s) => sum + s.financials.shippingCost, 0);
        
        const costByMode = [{ name: 'Sea', cost: costBySea, shipments: filteredShipments.filter(s => s.mode === 'Sea').length}, { name: 'Air', cost: costByAir, shipments: filteredShipments.filter(s => s.mode === 'Air').length }];

        const costByRoute = filteredShipments.reduce((acc, s) => {
            const route = `${s.origin} -> ${s.destination}`;
            if (!acc[route]) acc[route] = { route, cost: 0, shipments: 0 };
            acc[route].cost += s.financials.shippingCost;
            acc[route].shipments += 1;
            return acc;
        }, {} as { [key: string]: { route: string; cost: number; shipments: number } });

        const costByAgent = filteredShipments.reduce((acc, s) => {
            const agent = s.carrier;
            if (!acc[agent]) acc[agent] = { agent, cost: 0, shipments: 0 };
            acc[agent].cost += s.financials.shippingCost;
            acc[agent].shipments += 1;
            return acc;
        }, {} as { [key: string]: { agent: string; cost: number; shipments: number } });

        const costTrend = filteredShipments.reduce((acc, s) => {
            const month = new Date(s.createdAt).toLocaleString('default', { month: 'short', year: '2-digit' });
            if (!acc[month]) acc[month] = 0;
            acc[month] += s.financials.shippingCost;
            return acc;
        }, {} as { [key: string]: number });

        return {
            totalFreightCost,
            avgCostPerShipment,
            costBySea,
            costByAir,
            costByMode,
            costByRoute: Object.values(costByRoute),
            costByAgent: Object.values(costByAgent),
            costTrend: Object.entries(costTrend).map(([name, cost]) => ({ name, cost })),
        };
    }, [filteredShipments]);

    const AnalysisTable: React.FC<{title: string, data: any[], columns: {key: string, name: string}[]}> = ({title, data, columns}) => (
        <div>
            <h4 className="text-md font-semibold mb-2">{title}</h4>
            <div className="overflow-x-auto border rounded-lg dark:border-gray-700">
                <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                        <tr>{columns.map(c => <th key={c.key} className="px-4 py-2 text-left font-medium">{c.name}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y dark:divide-gray-700">
                        {data.map((row, idx) => (
                            <tr key={idx}>
                                {columns.map(c => <td key={c.key} className="px-4 py-2">{typeof row[c.key] === 'number' ? formatCurrency(row[c.key]) : row[c.key]}</td>)}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold">Financial Reports</h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                    <h3 className="text-lg font-semibold mb-4">Accounts Payable Aging</h3>
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={agingData} layout="vertical">
                            <XAxis type="number" tickFormatter={(value) => formatCurrency(value)} />
                            <YAxis type="category" dataKey="name" width={80} />
                            <Tooltip formatter={(value: number) => formatCurrency(value)} />
                            <Legend />
                            <Bar dataKey="value" name="Amount Due" fill="#3b82f6" />
                        </BarChart>
                    </ResponsiveContainer>
                </Card>
                <Card>
                    <h3 className="text-lg font-semibold mb-4">Spend by Vendor</h3>
                    <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                            <Pie data={spendByVendor} dataKey="spend" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                                {spendByVendor.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip formatter={(value: number) => formatCurrency(value)} />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                </Card>
            </div>

            <Card>
                <h3 className="text-lg font-semibold">Freight Cost Analysis</h3>
                <div className="flex items-center gap-4 my-4 flex-wrap">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Period:</span>
                        {['All Time', 'Last 90 Days', 'Last 30 Days'].map(p => (
                            <Button key={p} variant={period === p ? 'primary' : 'secondary'} onClick={() => setPeriod(p)} className="text-xs py-1 px-3">{p}</Button>
                        ))}
                    </div>
                     <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Mode:</span>
                        {(['All', 'Sea', 'Air'] as const).map(m => (
                            <Button key={m} variant={mode === m ? 'primary' : 'secondary'} onClick={() => setMode(m)} className="text-xs py-1 px-3">{m}</Button>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <MetricCard title="Total Freight Cost" value={formatCurrency(freightAnalysis.totalFreightCost)} />
                    <MetricCard title="Avg Cost / Shipment" value={formatCurrency(freightAnalysis.avgCostPerShipment)} />
                    <MetricCard title="Sea Freight Cost" value={formatCurrency(freightAnalysis.costBySea)} icon={<ShipIcon className="w-4 h-4 text-blue-500" />} />
                    <MetricCard title="Air Freight Cost" value={formatCurrency(freightAnalysis.costByAir)} icon={<AirplaneIcon className="w-4 h-4 text-purple-500" />} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div>
                        <h4 className="text-md font-semibold mb-2">Cost Trend</h4>
                         <ResponsiveContainer width="100%" height={250}>
                            <LineChart data={freightAnalysis.costTrend}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis tickFormatter={(value) => formatCurrency(value)} />
                                <Tooltip formatter={(value: number) => formatCurrency(value)} />
                                <Line type="monotone" dataKey="cost" name="Freight Cost" stroke="#8884d8" />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                     <div className="space-y-4">
                        <AnalysisTable title="By Mode" data={freightAnalysis.costByMode} columns={[{key: 'name', name: 'Mode'}, {key: 'shipments', name: 'Shipments'}, {key: 'cost', name: 'Total Cost'}]} />
                        <AnalysisTable title="By Route" data={freightAnalysis.costByRoute} columns={[{key: 'route', name: 'Route'}, {key: 'shipments', name: 'Shipments'}, {key: 'cost', name: 'Total Cost'}]} />
                        <AnalysisTable title="By Agent" data={freightAnalysis.costByAgent} columns={[{key: 'agent', name: 'Agent'}, {key: 'shipments', name: 'Shipments'}, {key: 'cost', name: 'Total Cost'}]} />
                     </div>
                </div>

            </Card>

            <Card>
                <h3 className="text-lg font-semibold">More Reports</h3>
                <p className="mt-2 text-gray-500">
                    Additional reports such as cash flow analysis, profitability reports, and tax summaries will be available here soon.
                </p>
            </Card>
        </div>
    );
};
