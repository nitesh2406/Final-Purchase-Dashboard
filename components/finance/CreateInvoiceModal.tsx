import React, { useState, useEffect, useMemo, FC } from 'react';
// FIX: Corrected import path for types.
import { Invoice, Vendor, PurchaseOrder, Shipment, InvoiceLineItem } from '../../types';
import { Button } from '../ui/Button';
import { XMarkIcon, PlusIcon, TrashIcon } from '../icons/Icons';
import { Card } from '../ui/Card';

interface CreateInvoiceModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (invoice: Omit<Invoice, 'id'>) => void;
    vendors: Vendor[];
    purchaseOrders: PurchaseOrder[];
    shipments: Shipment[];
    invoiceCount: number;
}

const today = new Date().toISOString().split('T')[0];
const dueDateDefault = new Date();
dueDateDefault.setDate(dueDateDefault.getDate() + 30);

const emptyLineItem: InvoiceLineItem = { description: '', amount: 0, taxRate: 18, taxAmount: 0 };

const defaultInvoiceData: Omit<Invoice, 'id'> = {
    vendor: '',
    invoiceDate: today,
    dueDate: dueDateDefault.toISOString().split('T')[0],
    status: 'Draft',
    type: 'Regular',
    currency: 'INR',
    amount: 0,
    paidAmount: 0,
    balance: 0,
    lineItems: [{ ...emptyLineItem, description: 'Base Amount' }],
    costBreakdown: { baseAmount: 0 },
    payments: [],
    documents: [],
    activityLog: [],
    notes: '',
};

const inputFieldClasses = "block w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm";

export const CreateInvoiceModal: FC<CreateInvoiceModalProps> = ({ isOpen, onClose, onSave, vendors, purchaseOrders, shipments, invoiceCount }) => {
    const [invoiceData, setInvoiceData] = useState<Omit<Invoice, 'id'>>(defaultInvoiceData);
    
    const newInvoiceId = useMemo(() => `INV-${new Date().getFullYear()}-${(invoiceCount + 1).toString().padStart(3, '0')}`, [invoiceCount]);

    useEffect(() => {
        const subtotal = invoiceData.lineItems.reduce((sum, item) => sum + item.amount, 0);
        const taxTotal = invoiceData.lineItems.reduce((sum, item) => sum + item.taxAmount, 0);
        const total = subtotal + taxTotal;
        setInvoiceData(prev => ({
            ...prev,
            amount: total,
            balance: total,
            costBreakdown: { baseAmount: subtotal, cgst: taxTotal / 2, sgst: taxTotal / 2 }
        }));
    }, [invoiceData.lineItems]);
    
    if (!isOpen) return null;

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        
        let updatedData = { ...invoiceData, [name]: value };

        if (name === "vendor") {
            const selectedVendor = vendors.find(v => v.name === value);
            if(selectedVendor) {
                updatedData.paymentTerms = selectedVendor.paymentTerms;
            }
        }
        
        setInvoiceData(updatedData);
    };
    
    const handleLineItemChange = (index: number, field: keyof InvoiceLineItem, value: string | number) => {
        const newItems = [...invoiceData.lineItems];
        const item = { ...newItems[index] };
        
        if(field === 'amount') {
            item.amount = Number(value);
            item.taxAmount = item.amount * (item.taxRate / 100);
        } else if (field === 'taxRate') {
            item.taxRate = Number(value);
            item.taxAmount = item.amount * (item.taxRate / 100);
        } else {
            item[field as 'description'] = value as string;
        }

        newItems[index] = item;
        setInvoiceData(prev => ({ ...prev, lineItems: newItems }));
    };
    
    const addLineItem = () => {
        setInvoiceData(prev => ({ ...prev, lineItems: [...prev.lineItems, { ...emptyLineItem }] }));
    };

    const removeLineItem = (index: number) => {
        if(invoiceData.lineItems.length <= 1) return;
        setInvoiceData(prev => ({ ...prev, lineItems: prev.lineItems.filter((_, i) => i !== index) }));
    };

    const handleSave = (status: 'Draft' | 'Pending') => {
        onSave({ ...invoiceData, status });
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-5xl h-[95vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <header className="flex items-center justify-between p-4 border-b dark:border-gray-700 flex-shrink-0">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Create New Invoice</h2>
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" onClick={() => handleSave('Draft')}>Save Draft</Button>
                        <Button onClick={() => handleSave('Pending')}>Create Invoice</Button>
                        <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"><XMarkIcon className="w-6 h-6 text-gray-500" /></button>
                    </div>
                </header>

                <main className="flex-grow p-6 overflow-y-auto space-y-6">
                    <Card>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div><label className="block text-sm font-medium">Invoice ID</label><p className="font-semibold pt-2">{newInvoiceId}</p></div>
                            <div><label className="block text-sm font-medium">Invoice Date</label><input type="date" name="invoiceDate" value={invoiceData.invoiceDate} onChange={handleInputChange} className={inputFieldClasses} /></div>
                            <div><label className="block text-sm font-medium">Due Date</label><input type="date" name="dueDate" value={invoiceData.dueDate} onChange={handleInputChange} className={inputFieldClasses} /></div>
                            <div><label className="block text-sm font-medium">Type</label><select name="type" value={invoiceData.type} onChange={handleInputChange} className={inputFieldClasses}>{['Regular', 'Consolidated', 'Freight'].map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                            <div className="md:col-span-2">
                                <label className="block text-sm font-medium">Vendor</label>
                                <select name="vendor" value={invoiceData.vendor} onChange={handleInputChange} className={inputFieldClasses} required>
                                    <option value="" disabled>Select a vendor</option>
                                    {vendors.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                                </select>
                            </div>
                            <div><label className="block text-sm font-medium">Currency</label><select name="currency" value={invoiceData.currency} onChange={handleInputChange} className={inputFieldClasses}>{['INR', 'USD', 'CNY'].map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                            <div><label className="block text-sm font-medium">Reference</label><input type="text" name="reference" placeholder="Optional" className={inputFieldClasses} /></div>
                        </div>
                    </Card>

                    {invoiceData.type === 'Regular' && <Card><label className="block text-sm font-medium mb-1">PO Number</label><select className={inputFieldClasses}><option>Select PO</option>{purchaseOrders.map(po => <option key={po.id} value={po.id}>{po.id} - {po.vendor}</option>)}</select></Card>}
                    {invoiceData.type === 'Consolidated' && <Card><label className="block text-sm font-medium mb-1">Shipments</label><select multiple className={`${inputFieldClasses} h-24`}><option>Select Shipments</option>{shipments.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}</select></Card>}

                    <Card>
                        <h3 className="font-semibold mb-2">Amount Details</h3>
                        <div className="grid grid-cols-12 gap-2 text-sm font-medium border-b pb-2 dark:border-gray-600">
                            <div className="col-span-6">Description</div>
                            <div className="col-span-2 text-right">Amount</div>
                            <div className="col-span-2 text-right">Tax Rate (%)</div>
                            <div className="col-span-2 text-right">Tax Amount</div>
                        </div>
                        {invoiceData.lineItems.map((item, index) => (
                            <div key={index} className="grid grid-cols-12 gap-2 items-center mt-2">
                                <input type="text" value={item.description} onChange={e => handleLineItemChange(index, 'description', e.target.value)} className={`${inputFieldClasses} col-span-6`} />
                                <input type="number" value={item.amount} onChange={e => handleLineItemChange(index, 'amount', e.target.value)} className={`${inputFieldClasses} col-span-2 text-right`} />
                                <input type="number" value={item.taxRate} onChange={e => handleLineItemChange(index, 'taxRate', e.target.value)} className={`${inputFieldClasses} col-span-2 text-right`} />
                                <input type="number" value={item.taxAmount.toFixed(2)} readOnly className={`${inputFieldClasses} col-span-1 text-right bg-gray-100 dark:bg-gray-900/50`} />
                                <button onClick={() => removeLineItem(index)} className="text-red-500 hover:text-red-700 disabled:opacity-50 col-span-1" disabled={invoiceData.lineItems.length <= 1}><TrashIcon className="w-5 h-5 mx-auto" /></button>
                            </div>
                        ))}
                         <Button onClick={addLineItem} variant="secondary" className="mt-2 py-1 px-3 text-xs" icon={<PlusIcon className="w-4 h-4"/>}>Add Line</Button>
                         <div className="w-full md:w-1/3 ml-auto mt-4 text-right space-y-1 text-sm">
                            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Subtotal:</span> <span>{new Intl.NumberFormat('en-IN').format(invoiceData.costBreakdown.baseAmount)}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">Tax:</span> <span>{new Intl.NumberFormat('en-IN').format((invoiceData.costBreakdown.cgst || 0) + (invoiceData.costBreakdown.sgst || 0))}</span></div>
                            <div className="flex justify-between font-bold text-base border-t pt-1 dark:border-gray-600"><span >Total:</span> <span>{new Intl.NumberFormat('en-IN', { style: 'currency', currency: invoiceData.currency }).format(invoiceData.amount)}</span></div>
                         </div>
                    </Card>
                    
                    <Card>
                        <label className="block text-sm font-medium">Notes</label>
                        <textarea name="notes" value={invoiceData.notes} onChange={handleInputChange} rows={3} className={inputFieldClasses}></textarea>
                    </Card>
                    
                    <Card>
                        <label className="block text-sm font-medium mb-2">Upload Documents</label>
                        <div className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary-500 bg-gray-50 dark:bg-gray-900/50 dark:border-gray-600">
                            <p className="text-gray-500 dark:text-gray-400">Drag & drop files here or click to browse.</p>
                        </div>
                    </Card>

                </main>

                 <footer className="flex items-center justify-end p-4 border-t dark:border-gray-700 flex-shrink-0 gap-2">
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button variant="secondary" onClick={() => handleSave('Draft')}>Save Draft</Button>
                    <Button onClick={() => handleSave('Pending')}>Create Invoice</Button>
                </footer>
            </div>
        </div>
    );
};