import React, { useState, FC, FormEvent, useEffect } from 'react';
import { Vendor } from '../../types';
import { Button } from '../ui/Button';
import { XMarkIcon } from '../icons/Icons';

interface VendorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (vendor: Omit<Vendor, 'id'> | Vendor) => void;
    vendor: Vendor | null;
    allVendors: Vendor[];
}

const defaultVendor: Omit<Vendor, 'id'> = {
    name: '',
    contactPerson: '',
    email: '',
    phone: '',
    address: '',
    type: 'Regular',
    status: 'Active',
    paymentTerms: 'Net 30',
    children: [],
    creditLimit: 0,
    bankingInfo: { bankName: '', accountNumber: '', ifscCode: '' },
};

const inputFieldClasses = "block w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm";

export const VendorModal: FC<VendorModalProps> = ({ isOpen, onClose, onSave, vendor, allVendors }) => {
    const [formData, setFormData] = useState<Omit<Vendor, 'id'>>(defaultVendor);

    useEffect(() => {
        if (vendor) {
            setFormData({ ...defaultVendor, ...vendor });
        } else {
            setFormData(defaultVendor);
        }
    }, [vendor]);

    if (!isOpen) return null;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };
    
    const handleBankingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({...prev, bankingInfo: { ...prev.bankingInfo!, [name]: value }}));
    };

    const handleChildVendorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        // FIX: Explicitly type 'option' as 'HTMLOptionElement' to resolve 'Property 'value' does not exist on type 'unknown'' error.
        const selectedIds = Array.from(e.target.selectedOptions, (option: HTMLOptionElement) => option.value);
        setFormData(prev => ({...prev, children: selectedIds}));
    }

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        if(!formData.name || !formData.contactPerson || !formData.email) {
            alert('Please fill all required fields.');
            return;
        }
        onSave(vendor ? { ...vendor, ...formData } : formData);
    };
    
    const potentialChildren = allVendors.filter(v => v.type === 'Regular' || v.type === 'Child');

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl" onClick={e => e.stopPropagation()}>
                <header className="flex items-center justify-between p-4 border-b dark:border-gray-700">
                    <h2 className="text-xl font-bold">{vendor ? 'Edit Vendor' : 'Add New Vendor'}</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"><XMarkIcon className="w-6 h-6"/></button>
                </header>
                <form onSubmit={handleSubmit}>
                    <main className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                        <h3 className="text-lg font-semibold">Basic Information</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div><label className="block text-sm font-medium">Vendor Name</label><input type="text" name="name" value={formData.name} onChange={handleChange} required className={inputFieldClasses} /></div>
                            <div><label className="block text-sm font-medium">Contact Person</label><input type="text" name="contactPerson" value={formData.contactPerson} onChange={handleChange} required className={inputFieldClasses} /></div>
                            <div><label className="block text-sm font-medium">Email</label><input type="email" name="email" value={formData.email} onChange={handleChange} required className={inputFieldClasses} /></div>
                            <div><label className="block text-sm font-medium">Phone</label><input type="tel" name="phone" value={formData.phone} onChange={handleChange} className={inputFieldClasses} /></div>
                            <div className="md:col-span-2"><label className="block text-sm font-medium">Address</label><textarea name="address" value={formData.address} onChange={handleChange} rows={3} className={inputFieldClasses}></textarea></div>
                        </div>

                        <h3 className="text-lg font-semibold border-t pt-6 dark:border-gray-700">Financial Details</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div><label className="block text-sm font-medium">Vendor Type</label><select name="type" value={formData.type} onChange={handleChange} className={inputFieldClasses}><option value="Regular">Regular</option><option value="Aggregator">Aggregator</option><option value="Freight">Freight</option><option value="Child">Child</option></select></div>
                            {formData.type === 'Aggregator' && 
                                <div className="md:col-span-2"><label className="block text-sm font-medium">Child Vendors</label><select multiple value={formData.children} onChange={handleChildVendorChange} className={`${inputFieldClasses} h-24`}><option disabled>Select Children</option>{potentialChildren.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
                            }
                            <div><label className="block text-sm font-medium">Payment Terms</label><input type="text" name="paymentTerms" value={formData.paymentTerms} onChange={handleChange} className={inputFieldClasses} /></div>
                            <div><label className="block text-sm font-medium">Credit Limit</label><input type="number" name="creditLimit" value={formData.creditLimit || ''} onChange={handleChange} className={inputFieldClasses} /></div>
                            <div><label className="block text-sm font-medium">Status</label><select name="status" value={formData.status} onChange={handleChange} className={inputFieldClasses}><option>Active</option><option>Inactive</option></select></div>
                        </div>
                        
                        <h3 className="text-lg font-semibold border-t pt-6 dark:border-gray-700">Banking Information</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                             <div><label className="block text-sm font-medium">Bank Name</label><input type="text" name="bankName" value={formData.bankingInfo?.bankName || ''} onChange={handleBankingChange} className={inputFieldClasses} /></div>
                             <div><label className="block text-sm font-medium">Account Number</label><input type="text" name="accountNumber" value={formData.bankingInfo?.accountNumber || ''} onChange={handleBankingChange} className={inputFieldClasses} /></div>
                             <div><label className="block text-sm font-medium">IFSC Code</label><input type="text" name="ifscCode" value={formData.bankingInfo?.ifscCode || ''} onChange={handleBankingChange} className={inputFieldClasses} /></div>
                        </div>

                    </main>
                    <footer className="flex justify-end p-4 border-t dark:border-gray-700 gap-2">
                        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                        <Button type="submit">Save Vendor</Button>
                    </footer>
                </form>
            </div>
        </div>
    );
};