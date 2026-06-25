import React, { useState, useMemo } from 'react';
import { Card } from '../ui/Card';
// FIX: Corrected import path for constants.
import { MOCK_SKUS } from '../../constants';
// FIX: Corrected import path for types.
import { Sku } from '../../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid } from 'recharts';

const spendByVendorData = [
    { name: 'CubeFactory A', value: 45000 },
    { name: 'CubeFactory B', value: 32000 },
    { name: 'GAN Cubes', value: 18000 },
    { name: 'Other', value: 11000 },
];
const COLORS = ['#3b82f6', '#8884d8', '#82ca9d', '#ffc658'];

export const InventoryAnalytics: React.FC = () => {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredSkus = useMemo(() => 
        MOCK_SKUS.filter(sku => 
            sku.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            sku.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (sku.ean && sku.ean.toLowerCase().includes(searchTerm.toLowerCase()))
        ), [searchTerm]);
    
    const calculateDOC = (sku: Sku) => {
        if (sku.salesVelocity <= 0) return Infinity;
        return (sku.stockOnHand + sku.stockInTransit) / sku.salesVelocity;
    };

    return (
        <div className="space-y-6">
            <h2 className="text-xl font-semibold">Inventory & Analytics</h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                    <h3 className="text-lg font-medium leading-6 text-slate-900 dark:text-white mb-4">Total Spend by Vendor</h3>
                     <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                            <Pie data={spendByVendorData} cx="50%" cy="50%" labelLine={false} outerRadius={80} fill="#8884d8" dataKey="value" nameKey="name" label={(entry) => entry.name}>
                                {spendByVendorData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                            </Pie>
                            <Tooltip />
                            <Legend />
                        </PieChart>
                     </ResponsiveContainer>
                </Card>
                <Card>
                    <h3 className="text-lg font-medium leading-6 text-slate-900 dark:text-white mb-4">Inventory Value (On Hand vs In Transit)</h3>
                     <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={MOCK_SKUS} layout="vertical" margin={{ top: 5, right: 30, left: 70, bottom: 5 }}>
                           <CartesianGrid strokeDasharray="3 3" />
                           <XAxis type="number" />
                           <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }}/>
                           <Tooltip />
                           <Legend />
                           <Bar dataKey="stockOnHand" name="On Hand" stackId="a" fill="#3b82f6" />
                           <Bar dataKey="stockInTransit" name="In Transit" stackId="a" fill="#8884d8" />
                        </BarChart>
                     </ResponsiveContainer>
                </Card>
            </div>

            <Card>
                <h3 className="text-lg font-medium leading-6 text-slate-900 dark:text-white mb-4">Master Item Visibility</h3>
                <input
                    type="text"
                    placeholder="Search by SKU, EAN, or Name..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="mb-4 w-full sm:w-1/2 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                        <thead className="bg-slate-100 dark:bg-slate-900">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">SKU</th>
                                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Name</th>
                                <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">On Hand</th>
                                <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">In Transit</th>
                                <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">On Order</th>
                                <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Days of Cover</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-transparent divide-y divide-slate-200 dark:divide-slate-700">
                            {filteredSkus.map((sku) => {
                                const doc = calculateDOC(sku);
                                return (
                                <tr key={sku.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                                    <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-white">{sku.id}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-400">{sku.name}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-400 text-right">{sku.stockOnHand}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-400 text-right">{sku.stockInTransit}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-600 dark:text-slate-400 text-right">{sku.stockOnOrder}</td>
                                    <td className={`px-4 py-4 whitespace-nowrap text-sm text-right font-semibold ${doc < 15 ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{isFinite(doc) ? doc.toFixed(1) : 'N/A'}</td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
};