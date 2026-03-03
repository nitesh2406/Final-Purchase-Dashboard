
import React, { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { MOCK_PAYMENT_TERMS, MOCK_VENDORS } from '../../constants';

type PaymentTab = 'Default Terms' | 'Vendor Terms' | 'Credit Management';

export const PaymentTerms: React.FC = () => {
    const [activeTab, setActiveTab] = useState<PaymentTab>('Default Terms');

     const renderContent = () => {
        switch(activeTab) {
            case 'Default Terms': return (
                <div>
                     <div className="overflow-x-auto">
                        <table className="min-w-full">
                            <thead className="bg-gray-50 dark:bg-gray-800"><tr>{['Term Name', 'Days', 'Description', 'Vendors Using', 'Actions'].map(h => <th key={h} className="px-4 py-2 text-left text-xs font-medium uppercase">{h}</th>)}</tr></thead>
                            <tbody className="divide-y dark:divide-gray-700">
                                {MOCK_PAYMENT_TERMS.map(term => <tr key={term.id}>
                                    <td className="px-4 py-3 font-medium">{term.name}</td>
                                    <td className="px-4 py-3">{term.days}</td>
                                    <td className="px-4 py-3">{term.description}</td>
                                    <td className="px-4 py-3">{term.vendorCount}</td>
                                    <td className="px-4 py-3"><Button variant="secondary" className="text-xs py-1 px-2">Edit</Button></td>
                                </tr>)}
                            </tbody>
                        </table>
                    </div>
                </div>
            );
            case 'Vendor Terms': return (
                 <div>
                     <div className="overflow-x-auto">
                        <table className="min-w-full">
                            <thead className="bg-gray-50 dark:bg-gray-800"><tr>{['Vendor Name', 'Payment Term', 'Credit Limit'].map(h => <th key={h} className="px-4 py-2 text-left text-xs font-medium uppercase">{h}</th>)}</tr></thead>
                            <tbody className="divide-y dark:divide-gray-700">
                                {MOCK_VENDORS.filter(v => v.type === 'Regular' || v.type === 'Freight').map(vendor => <tr key={vendor.id}>
                                    <td className="px-4 py-3 font-medium">{vendor.name}</td>
                                    <td className="px-4 py-3">{vendor.paymentTerms}</td>
                                    <td className="px-4 py-3">{new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(vendor.creditLimit || 0)}</td>
                                </tr>)}
                            </tbody>
                        </table>
                    </div>
                </div>
            );
            default: return <p>This section is under construction.</p>
        }
    }

    return (
        <Card>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-xl font-bold">Payment Terms Configuration</h3>
                    <p className="text-sm text-gray-500">Manage vendor payment terms and credit periods.</p>
                </div>
            </div>
             <div className="flex border-b dark:border-gray-700 mb-6">
                 {(['Default Terms', 'Vendor Terms', 'Credit Management'] as PaymentTab[]).map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 text-sm font-medium ${activeTab === tab ? 'border-b-2 border-primary-500 text-primary-600' : 'text-gray-500 hover:text-gray-700'}`}>{tab}</button>
                ))}
            </div>
            {renderContent()}
        </Card>
    );
};
