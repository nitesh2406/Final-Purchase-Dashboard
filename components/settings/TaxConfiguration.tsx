
import React, { useState, useMemo } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { MOCK_SKUS, MOCK_TAX_SLABS, MOCK_HSN_CODES } from '../../constants';
import { Sku, TaxSlab, HsnCode } from '../../types';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

type TaxTab = 'Default Rates' | 'Item Mapping' | 'HSN Codes' | 'Reports';

const COLORS = ['#3b82f6', '#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#a4de6c'];

export const TaxConfiguration: React.FC = () => {
    const [activeTab, setActiveTab] = useState<TaxTab>('Default Rates');
    const [skus, setSkus] = useState<Sku[]>(MOCK_SKUS);
    const [taxSlabs, setTaxSlabs] = useState<TaxSlab[]>(MOCK_TAX_SLABS);
    const [hsnCodes, setHsnCodes] = useState<HsnCode[]>(MOCK_HSN_CODES);

    const handleTaxRateChange = (skuId: string, newRate: number | null) => {
        setSkus(prevSkus => prevSkus.map(sku => sku.id === skuId ? { ...sku, taxRate: newRate } : sku));
    };
    
    const unmappedItems = useMemo(() => skus.filter(s => s.taxRate === null || s.taxRate === undefined), [skus]);
    
    const taxDistribution = useMemo(() => {
        const distribution: { [rate: string]: number } = {};
        skus.forEach(sku => {
            const rateKey = sku.taxRate !== null && sku.taxRate !== undefined ? `${sku.taxRate}%` : 'Unmapped';
            distribution[rateKey] = (distribution[rateKey] || 0) + 1;
        });
        return Object.entries(distribution).map(([name, value]) => ({ name, value }));
    }, [skus]);

    const renderContent = () => {
        switch(activeTab) {
            case 'Default Rates': return (
                <div className="space-y-6">
                    <h3 className="text-lg font-semibold">Default GST Rates</h3>
                    <div className="overflow-x-auto">
                        <table className="min-w-full">
                            <thead className="bg-gray-50 dark:bg-gray-800"><tr>{['Tax Slab', 'Rate (%)', 'Description', 'Items Count', 'Actions'].map(h => <th key={h} className="px-4 py-2 text-left text-xs font-medium uppercase">{h}</th>)}</tr></thead>
                            <tbody className="divide-y dark:divide-gray-700">
                                {taxSlabs.map(slab => <tr key={slab.id}>
                                    <td className="px-4 py-3 font-medium">{slab.name}</td>
                                    <td className="px-4 py-3">{slab.rate}</td>
                                    <td className="px-4 py-3">{slab.description}</td>
                                    <td className="px-4 py-3">{slab.itemCount}</td>
                                    <td className="px-4 py-3"><Button variant="secondary" className="text-xs py-1 px-2">Edit</Button></td>
                                </tr>)}
                            </tbody>
                        </table>
                    </div>
                    <Button>Add New Tax Rate</Button>
                </div>
            );
            case 'Item Mapping': return (
                 <div className="space-y-4">
                     <h3 className="text-lg font-semibold">Item-wise Tax Mapping</h3>
                     <div className="flex items-center gap-4"><input placeholder="Search SKU..." className="w-1/2 p-2 rounded-md border dark:bg-gray-900 dark:border-gray-700"/></div>
                     {unmappedItems.length > 0 && <div className="p-3 bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200 rounded-md text-sm">⚠️ {unmappedItems.length} items have no tax rate assigned.</div>}
                     <div className="overflow-x-auto">
                        <table className="min-w-full">
                            <thead className="bg-gray-50 dark:bg-gray-800"><tr>{['SKU', 'Item Name', 'Category', 'Current Tax Rate', 'HSN Code'].map(h => <th key={h} className="px-4 py-2 text-left text-xs font-medium uppercase">{h}</th>)}</tr></thead>
                            <tbody className="divide-y dark:divide-gray-700">
                                {skus.map(sku => <tr key={sku.id}>
                                    <td className="px-4 py-3 font-medium">{sku.id}</td>
                                    <td className="px-4 py-3">{sku.name}</td>
                                    <td className="px-4 py-3">{sku.category}</td>
                                    <td className="px-4 py-3">
                                         <select value={sku.taxRate ?? ''} onChange={e => handleTaxRateChange(sku.id, e.target.value === '' ? null : Number(e.target.value))} className="p-1 rounded-md border dark:bg-gray-900 dark:border-gray-700">
                                            <option value="">Unmapped</option>
                                            {taxSlabs.map(slab => <option key={slab.id} value={slab.rate}>{slab.name}</option>)}
                                         </select>
                                    </td>
                                    <td className="px-4 py-3">{sku.hsnCode}</td>
                                </tr>)}
                            </tbody>
                        </table>
                     </div>
                 </div>
            );
            case 'HSN Codes': return (
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold">HSN Code Management</h3>
                    <div className="overflow-x-auto">
                        <table className="min-w-full">
                            <thead className="bg-gray-50 dark:bg-gray-800"><tr>{['HSN Code', 'Description', 'Default Tax', 'Items Count', 'Actions'].map(h=><th key={h} className="px-4 py-2 text-left text-xs font-medium uppercase">{h}</th>)}</tr></thead>
                            <tbody className="divide-y dark:divide-gray-700">
                                {hsnCodes.map(hsn => <tr key={hsn.id}>
                                    <td className="px-4 py-3 font-mono">{hsn.code}</td>
                                    <td className="px-4 py-3">{hsn.description}</td>
                                    <td className="px-4 py-3">{hsn.defaultTaxRate}%</td>
                                    <td className="px-4 py-3">{hsn.itemCount}</td>
                                    <td className="px-4 py-3"><Button variant="secondary" className="text-xs py-1 px-2">View Items</Button></td>
                                </tr>)}
                            </tbody>
                        </table>
                    </div>
                </div>
            );
            case 'Reports': return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <Card><p>Total Items Mapped: <strong>{skus.length - unmappedItems.length} / {skus.length}</strong></p></Card>
                        <Card><p>Unmapped Items: <strong className={unmappedItems.length > 0 ? 'text-red-500' : ''}>{unmappedItems.length}</strong></p></Card>
                        <Button>Export Tax Master</Button>
                    </div>
                     <Card>
                         <h4 className="font-semibold mb-2">Item Distribution by Tax Rate</h4>
                        <ResponsiveContainer width="100%" height={250}>
                            <PieChart>
                                <Pie data={taxDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                                    {taxDistribution.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                                </Pie>
                                <Tooltip />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </Card>
                </div>
            );
        }
    };

    return (
        <Card>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-xl font-bold">Tax Configuration</h3>
                    <p className="text-sm text-gray-500">Manage GST rates and item-wise tax mappings.</p>
                </div>
                <Button>Save Changes</Button>
            </div>
             <div className="flex border-b dark:border-gray-700 mb-6">
                {(['Default Rates', 'Item Mapping', 'HSN Codes', 'Reports'] as TaxTab[]).map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm font-medium ${activeTab === tab ? 'border-b-2 border-primary-500 text-primary-600' : 'text-gray-500 hover:text-gray-700'}`}>{tab}</button>
                ))}
             </div>
             {renderContent()}
        </Card>
    );
};
