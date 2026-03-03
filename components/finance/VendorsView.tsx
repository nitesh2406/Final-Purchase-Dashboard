
import React, { useState, useMemo, FC } from 'react';
import { Vendor, Invoice } from '../../types';
import { Button } from '../ui/Button';
import { VendorModal } from './VendorModal';
import { PlusCircleIcon, PencilSquareIcon, PhoneIcon, EnvelopeIcon } from '../icons/Icons';

interface VendorsViewProps {
    vendors: Vendor[];
    invoices: Invoice[];
    addVendor: (vendorData: Omit<Vendor, 'id'>) => void;
    updateVendor: (updatedVendor: Vendor) => void;
}

const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

export const VendorsView: FC<VendorsViewProps> = ({ vendors, invoices, addVendor, updateVendor }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [typeFilter, setTypeFilter] = useState<'All' | Vendor['type']>('All');

    const vendorFinancials = useMemo(() => {
        const financials: { [vendorName: string]: { pending: number; overdue: number; lastPayment: string } } = {};
        invoices.forEach(inv => {
            if (!financials[inv.vendor]) {
                financials[inv.vendor] = { pending: 0, overdue: 0, lastPayment: '' };
            }
            financials[inv.vendor].pending += inv.balance;
            if (inv.status === 'Overdue') {
                financials[inv.vendor].overdue += inv.balance;
            }
            if (inv.payments.length > 0) {
                const lastPayDate = inv.payments.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0].date;
                if (!financials[inv.vendor].lastPayment || new Date(lastPayDate) > new Date(financials[inv.vendor].lastPayment)) {
                    financials[inv.vendor].lastPayment = lastPayDate;
                }
            }
        });
        return financials;
    }, [invoices]);

    const filteredVendors = useMemo(() => {
        return vendors
            .filter(v => typeFilter === 'All' || v.type === typeFilter)
            .filter(v => 
                v.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                v.contactPerson.toLowerCase().includes(searchTerm.toLowerCase()) ||
                v.email.toLowerCase().includes(searchTerm.toLowerCase())
            );
    }, [vendors, searchTerm, typeFilter]);

    const handleSaveVendor = (vendorData: Omit<Vendor, 'id'> | Vendor) => {
        if ('id' in vendorData) {
            updateVendor(vendorData as Vendor);
        } else {
            addVendor(vendorData);
        }
        setIsModalOpen(false);
        setEditingVendor(null);
    };
    
    const handleAddNew = () => {
        setEditingVendor(null);
        setIsModalOpen(true);
    };

    const handleEdit = (vendor: Vendor) => {
        setEditingVendor(vendor);
        setIsModalOpen(true);
    };

    return (
        <div className="space-y-4">
            {isModalOpen && <VendorModal isOpen={true} onClose={() => setIsModalOpen(false)} onSave={handleSaveVendor} vendor={editingVendor} allVendors={vendors} />}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4 flex-wrap">
                    <input 
                        type="text"
                        placeholder="Search vendors..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full sm:w-64 rounded-md border-gray-300 dark:border-gray-700 dark:bg-gray-900 shadow-sm"
                    />
                     <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as any)} className="rounded-md border-gray-300 dark:border-gray-700 dark:bg-gray-900 shadow-sm">
                        <option value="All">All Types</option>
                        <option value="Regular">Regular</option>
                        <option value="Aggregator">Aggregator</option>
                        <option value="Freight">Freight</option>
                     </select>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="secondary">Export</Button>
                    <Button onClick={handleAddNew} icon={<PlusCircleIcon/>}>Add Vendor</Button>
                </div>
            </div>
             <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                        <tr>
                            {['Vendor Name', 'Type', 'Contact', 'Pending', 'Overdue', 'Last Payment', 'Terms', 'Actions'].map(h => (
                                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                        {filteredVendors.map(vendor => (
                            <React.Fragment key={vendor.id}>
                            <tr className={vendor.type === 'Child' ? 'bg-gray-50 dark:bg-gray-800/50' : ''}>
                                <td className={`px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white ${vendor.type === 'Child' ? 'pl-8' : ''}`}>
                                    {vendor.type === 'Child' && <span className="mr-2">↳</span>}
                                    {vendor.name}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm"><span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/50">{vendor.type}</span></td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm">
                                    <div>{vendor.contactPerson}</div>
                                    <div className="text-xs text-gray-500">{vendor.email}</div>
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-right">{formatCurrency(vendorFinancials[vendor.name]?.pending || 0)}</td>
                                <td className={`px-4 py-4 whitespace-nowrap text-sm text-right font-semibold ${(vendorFinancials[vendor.name]?.overdue || 0) > 0 ? 'text-red-500' : ''}`}>{formatCurrency(vendorFinancials[vendor.name]?.overdue || 0)}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm">{vendorFinancials[vendor.name]?.lastPayment ? new Date(vendorFinancials[vendor.name]?.lastPayment).toLocaleDateString('en-GB', {day: '2-digit', month: 'short'}) : 'N/A'}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm">{vendor.paymentTerms}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm">
                                    <Button variant="secondary" onClick={() => handleEdit(vendor)} icon={<PencilSquareIcon className="w-4 h-4"/>} className="py-1 px-2 text-xs">Edit</Button>
                                </td>
                            </tr>
                            {vendor.type === 'Aggregator' && vendor.children?.map(childId => {
                                const childVendor = vendors.find(v => v.id === childId);
                                if(!childVendor) return null;
                                return <tr key={childId} className="bg-gray-50 dark:bg-gray-800/50"><td colSpan={8} className="py-2 pl-8"><VendorsView vendors={[childVendor]} invoices={invoices} addVendor={addVendor} updateVendor={updateVendor} /></td></tr>
                            })}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
