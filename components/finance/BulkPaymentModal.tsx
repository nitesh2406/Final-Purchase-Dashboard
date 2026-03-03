import React, { useState, useMemo, FC, useEffect } from 'react';
// FIX: Corrected import path for types.
import { Invoice, Payment } from '../../types';
import { Button } from '../ui/Button';
import { XMarkIcon } from '../icons/Icons';

interface BulkPaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (updatedInvoices: Invoice[]) => void;
    invoices: Invoice[];
}

type Allocation = {
    [invoiceId: string]: number;
};

const today = new Date().toISOString().split('T')[0];
const inputFieldClasses = "block w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm";
const formatCurrency = (amount: number, currency: string = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount);

export const BulkPaymentModal: FC<BulkPaymentModalProps> = ({ isOpen, onClose, onSave, invoices }) => {
    const [paymentAmount, setPaymentAmount] = useState(0);
    const [paymentDate, setPaymentDate] = useState(today);
    const [paymentMethod, setPaymentMethod] = useState<Payment['method']>('Wire Transfer');
    const [reference, setReference] = useState('');
    const [notes, setNotes] = useState('');
    const [allocations, setAllocations] = useState<Allocation>({});

    const vendorName = useMemo(() => {
        if (invoices.length === 0) return '';
        const firstVendor = invoices[0].vendor;
        return invoices.every(inv => inv.vendor === firstVendor) ? firstVendor : 'Multiple Vendors';
    }, [invoices]);

    useEffect(() => {
        if(isOpen) {
            // Reset state when modal opens
            setPaymentAmount(invoices.reduce((sum, inv) => sum + inv.balance, 0));
            setAllocations(invoices.reduce((acc, inv) => ({...acc, [inv.id]: 0}), {}));
        }
    }, [isOpen, invoices]);
    
    const totalAllocated = useMemo(() => {
        // FIX: Explicitly type 'sum' and 'amount' to resolve 'Operator '+' cannot be applied to types 'unknown' and 'unknown'' error.
        return Object.values(allocations).reduce((sum: number, amount: number) => sum + amount, 0);
    }, [allocations]);
    
    const remainingToAllocate = paymentAmount - totalAllocated;

    const handleAllocationChange = (invoiceId: string, value: string) => {
        const amount = parseFloat(value) || 0;
        const invoice = invoices.find(inv => inv.id === invoiceId);
        if(!invoice) return;

        setAllocations(prev => ({
            ...prev,
            [invoiceId]: Math.max(0, Math.min(amount, invoice.balance))
        }));
    };
    
    const allocateOldestFirst = () => {
        let remaining = paymentAmount;
        const newAllocations: Allocation = {};
        const sortedInvoices = [...invoices].sort((a,b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

        for (const inv of sortedInvoices) {
            if (remaining <= 0) {
                newAllocations[inv.id] = 0;
                continue;
            }
            const toAllocate = Math.min(inv.balance, remaining);
            newAllocations[inv.id] = toAllocate;
            remaining -= toAllocate;
        }
        setAllocations(newAllocations);
    };

    const allocateProportionally = () => {
        const totalBalance = invoices.reduce((sum, inv) => sum + inv.balance, 0);
        if (totalBalance === 0) return;
        
        const newAllocations: Allocation = {};
        let totalApplied = 0;

        invoices.forEach((inv, index) => {
            if (index === invoices.length - 1) {
                // Assign remainder to last item to avoid floating point issues
                newAllocations[inv.id] = paymentAmount - totalApplied;
            } else {
                const proportion = inv.balance / totalBalance;
                const allocated = Math.min(inv.balance, paymentAmount * proportion);
                newAllocations[inv.id] = allocated;
                totalApplied += allocated;
            }
        });
        setAllocations(newAllocations);
    };

    const handleSave = () => {
        if (Math.abs(remainingToAllocate) > 0.01) {
            alert('Total allocated amount must match the payment amount.');
            return;
        }

        const updatedInvoices: Invoice[] = invoices.map(inv => {
            const allocatedAmount = allocations[inv.id];
            if (!allocatedAmount || allocatedAmount <= 0) return inv;

            const newPayment: Payment = {
                id: `PAY-${inv.id}-${Date.now()}`,
                date: paymentDate,
                amount: allocatedAmount,
                method: paymentMethod,
                reference: reference,
                recordedBy: 'Alex Doe', // Should be dynamic in a real app
            };
            const newPaidAmount = inv.paidAmount + allocatedAmount;
            const newBalance = inv.amount - newPaidAmount;
            const newStatus: Invoice['status'] = newBalance <= 0.01 ? 'Paid' : 'Partially Paid';

            return {
                ...inv,
                payments: [...inv.payments, newPayment],
                status: newStatus,
                paidAmount: newPaidAmount,
                balance: newBalance
            };
        });

        onSave(updatedInvoices);
    };
    
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <header className="flex items-center justify-between p-4 border-b dark:border-gray-700 flex-shrink-0">
                    <h2 className="text-xl font-bold">Record Bulk Payment</h2>
                    <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"><XMarkIcon className="w-6 h-6"/></button>
                </header>
                <main className="flex-grow p-6 overflow-y-auto space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 rounded-lg bg-gray-100 dark:bg-gray-700/50">
                            <label className="text-sm font-medium">Vendor</label>
                            <p className="font-bold text-lg">{vendorName}</p>
                            {vendorName === 'Multiple Vendors' && <p className="text-xs text-red-500">Bulk payment is only supported for a single vendor at a time.</p>}
                        </div>
                         <div className="p-4 rounded-lg bg-gray-100 dark:bg-gray-700/50">
                            <label className="text-sm font-medium">Total Payment Amount</label>
                             <input type="number" value={paymentAmount} onChange={e => setPaymentAmount(parseFloat(e.target.value) || 0)} className={`${inputFieldClasses} text-lg font-bold`} />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div><label className="block text-sm font-medium">Payment Date</label><input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} className={inputFieldClasses} /></div>
                        <div><label className="block text-sm font-medium">Payment Method</label><select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as Payment['method'])} className={inputFieldClasses}><option>Wire Transfer</option><option>Credit Card</option><option>Cash</option><option>UPI</option><option>Check</option></select></div>
                        <div><label className="block text-sm font-medium">Reference</label><input type="text" value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g., TXN-123" className={inputFieldClasses} /></div>
                    </div>
                    
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="font-semibold">Allocate Payment</h3>
                            <div className="flex gap-2">
                                <Button variant="secondary" onClick={allocateOldestFirst} className="py-1 px-2 text-xs">Oldest First</Button>
                                <Button variant="secondary" onClick={allocateProportionally} className="py-1 px-2 text-xs">Proportional</Button>
                            </div>
                        </div>
                        <div className="max-h-60 overflow-y-auto border dark:border-gray-700 rounded-lg">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
                                    <tr>
                                        {['Invoice', 'Total', 'Balance', 'Allocate', 'Remaining'].map(h => <th key={h} className="px-3 py-2 text-left text-xs font-medium uppercase">{h}</th>)}
                                    </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                    {invoices.map(inv => {
                                        const allocated = allocations[inv.id] || 0;
                                        const remaining = inv.balance - allocated;
                                        return (
                                        <tr key={inv.id}>
                                            <td className="px-3 py-2 text-sm font-medium">{inv.id}</td>
                                            <td className="px-3 py-2 text-sm">{formatCurrency(inv.amount, inv.currency)}</td>
                                            <td className="px-3 py-2 text-sm">{formatCurrency(inv.balance, inv.currency)}</td>
                                            <td className="px-3 py-2 text-sm w-32">
                                                <input type="number" value={allocated} onChange={e => handleAllocationChange(inv.id, e.target.value)} className={`${inputFieldClasses} py-1`} max={inv.balance} />
                                            </td>
                                            <td className="px-3 py-2 text-sm font-semibold">{formatCurrency(remaining, inv.currency)}</td>
                                        </tr>
                                    )})}
                                </tbody>
                            </table>
                        </div>
                         <div className="mt-2 text-sm text-right">
                             <p>Total Allocated: <span className="font-semibold">{formatCurrency(totalAllocated)}</span></p>
                             <p className={`font-bold ${Math.abs(remainingToAllocate) > 0.01 ? 'text-red-500' : 'text-green-500'}`}>
                                 Remaining to Allocate: {formatCurrency(remainingToAllocate)}
                             </p>
                         </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium">Notes</label>
                        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={inputFieldClasses}></textarea>
                    </div>
                </main>
                <footer className="p-4 border-t dark:border-gray-700 flex justify-end gap-2 flex-shrink-0">
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSave} disabled={Math.abs(remainingToAllocate) > 0.01 || vendorName === 'Multiple Vendors'}>Record Payment</Button>
                </footer>
            </div>
        </div>
    );
};