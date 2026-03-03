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
                    <h3 className="text-lg font-medium leading-6 text-gray-900 dark:text-white mb-4">Total Spend by Vendor</h3>
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
                    <h3 className="text-lg font-medium leading-6 text-gray-900 dark:text-white mb-4">Inventory Value (On Hand vs In Transit)</h3>
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
                <h3 className="text-lg font-medium leading-6 text-gray-900 dark:text-white mb-4">Master Item Visibility</h3>
                <input 
                    type="text"
                    placeholder="Search by SKU, EAN, or Name..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="mb-4 w-full sm:w-1/2 rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm"
                />
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">SKU</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Name</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">On Hand</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">In Transit</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">On Order</th>
                                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">Days of Cover</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                            {filteredSkus.map((sku) => {
                                const doc = calculateDOC(sku);
                                return (
                                <tr key={sku.id}>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{sku.id}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{sku.name}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-right">{sku.stockOnHand}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-right">{sku.stockInTransit}</td>
                                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 text-right">{sku.stockOnOrder}</td>
                                    <td className={`px-4 py-4 whitespace-nowrap text-sm text-right font-semibold ${doc < 15 ? 'text-red-500' : 'text-green-500'}`}>{isFinite(doc) ? doc.toFixed(1) : 'N/A'}</td>
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