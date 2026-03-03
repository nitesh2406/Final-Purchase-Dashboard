import React, { useState, FC, useEffect, useMemo } from 'react';
// FIX: Corrected import path for types.
import { Invoice, Payment, Vendor } from '../../types';
import { Button } from '../ui/Button';
import { XMarkIcon, PaperClipIcon, CheckIcon } from '../icons/Icons';

interface RecordPaymentModalProps {
    isOpen: boolean;
    onClose: () => void;
    // FIX: Update onSave to pass the entire updated Invoice object to align with the parent component's handler.
    onSave: (invoice: Invoice) => void;
    invoice: Invoice | null;
    vendors: Vendor[];
    allInvoices: Invoice[];
}

const today = new Date().toISOString().split('T')[0];
const inputFieldClasses = "block w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm";
const formatCurrency = (amount: number, currency: string = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount);

// --- Nested Modal for Aggregator Payment Details ---
const ActualPaymentDetailsModal: FC<{
    invoice: Invoice;
    onClose: () => void;
    onSave: (details: any) => void;
}> = ({ invoice, onClose, onSave }) => {
    const [details, setDetails] = useState({
        exchangeRate: 11.8,
        conversionCharge: 800,
        bankCharge: 200,
        otherCharge: 100,
        reference: `TXN-${invoice.id}-B`,
        linkToShipment: true,
    });

    const baseAmountInHome = details.exchangeRate * invoice.amount;
    const actualPaid = baseAmountInHome + details.conversionCharge + details.bankCharge + details.otherCharge;

    const handleSave = () => {
        onSave({ ...details, actualPaid, baseAmountInHome });
    };

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60]" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
                <h3 className="font-bold text-lg">Actual Payment Details</h3>
                <p className="text-sm text-gray-500 mb-4">{invoice.id} | {invoice.vendor}</p>
                <div className="space-y-3 text-sm">
                    <div>Amount: <span className="font-semibold">{formatCurrency(invoice.amount, invoice.currency)} ({invoice.currency})</span></div>
                    <div><label>Exchange Rate:</label><input type="number" value={details.exchangeRate} onChange={e => setDetails({...details, exchangeRate: parseFloat(e.target.value)})} className={inputFieldClasses}/></div>
                    <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded">
                        <div>Base in INR: <span className="font-semibold">{formatCurrency(baseAmountInHome)}</span></div>
                        <div>+ Conversion Charge: <input type="number" value={details.conversionCharge} onChange={e => setDetails({...details, conversionCharge: parseFloat(e.target.value)})} className={inputFieldClasses}/></div>
                        <div>+ Bank Charge: <input type="number" value={details.bankCharge} onChange={e => setDetails({...details, bankCharge: parseFloat(e.target.value)})} className={inputFieldClasses}/></div>
                        <div>+ Other Charge: <input type="number" value={details.otherCharge} onChange={e => setDetails({...details, otherCharge: parseFloat(e.target.value)})} className={inputFieldClasses}/></div>
                        <div className="font-bold border-t mt-2 pt-2">Actual Paid: {formatCurrency(actualPaid)}</div>
                    </div>
                    <div><label>Reference:</label><input type="text" value={details.reference} onChange={e => setDetails({...details, reference: e.target.value})} className={inputFieldClasses}/></div>
                    <div className="flex items-center gap-2"><input type="checkbox" checked={details.linkToShipment} onChange={e => setDetails({...details, linkToShipment: e.target.checked})} /> Link to Shipment {invoice.shipments?.[0]}</div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSave}>Save</Button>
                </div>
            </div>
        </div>
    );
};


export const RecordPaymentModal: FC<RecordPaymentModalProps> = ({ isOpen, onClose, onSave, invoice, vendors, allInvoices }) => {
    const [amount, setAmount] = useState(0);
    const [paymentDate, setPaymentDate] = useState(today);
    const [method, setMethod] = useState<Payment['method']>('Wire Transfer');
    const [reference, setReference] = useState('');
    const [notes, setNotes] = useState('');
    
    // Aggregator state
    const [isAggregatorPayment, setIsAggregatorPayment] = useState(false);
    const [selectedAggregatorId, setSelectedAggregatorId] = useState<string>('');
    const [aggregatorPaymentAmount, setAggregatorPaymentAmount] = useState(0);
    const [selectedChildInvoices, setSelectedChildInvoices] = useState<string[]>([]);
    const [aggregatorDetails, setAggregatorDetails] = useState<{[invoiceId: string]: any}>({});
    const [editingDetailsFor, setEditingDetailsFor] = useState<Invoice | null>(null);

    const aggregatorVendors = useMemo(() => vendors.filter(v => v.type === 'Aggregator'), [vendors]);
    const childInvoices = useMemo(() => {
        if (!selectedAggregatorId) return [];
        const aggregator = vendors.find(v => v.id === selectedAggregatorId);
        if (!aggregator || !aggregator.children) return [];
        const childVendorNames = aggregator.children.map(childId => vendors.find(v => v.id === childId)?.name);
        return allInvoices.filter(inv => childVendorNames.includes(inv.vendor) && (inv.status === 'Pending' || inv.status === 'Partially Paid' || inv.status === 'Overdue'));
    }, [selectedAggregatorId, vendors, allInvoices]);

    useEffect(() => {
        if (invoice) {
            setAmount(invoice.balance);
            setPaymentDate(today);
            setMethod('Wire Transfer');
            setReference('');
            setNotes('');
            setIsAggregatorPayment(false);
            setSelectedAggregatorId('');
        }
    }, [invoice]);

    if (!isOpen || !invoice) return null;

    const handleSave = () => {
        if (amount <= 0 || amount > invoice.balance + 0.01) {
            alert('Invalid payment amount.');
            return;
        }
        const newPayment: Payment = {
            id: `PAY-${Date.now()}`,
            date: paymentDate,
            amount: amount,
            method: method,
            reference: reference,
            recordedBy: 'Alex Doe',
        };
        const newPaidAmount = invoice.paidAmount + amount;
        const newBalance = invoice.amount - newPaidAmount;
        const newStatus = newBalance <= 0.01 ? 'Paid' : 'Partially Paid';
        
        // FIX: Construct the full updated invoice object and pass it to the onSave callback.
        const updatedInvoice: Invoice = {
            ...invoice,
            payments: [...invoice.payments, newPayment],
            status: newStatus,
            paidAmount: newPaidAmount,
            balance: newBalance,
        };
        onSave(updatedInvoice);
    };
    
    const handleAggregatorSave = () => {
        // Here you would process all the payments from aggregatorDetails and call onSave for each
        console.log("Saving aggregator payment with details:", aggregatorDetails);
        onClose(); // Close the modal after saving
    };

    const handleDetailSave = (details: any) => {
        if(editingDetailsFor) {
            setAggregatorDetails(prev => ({ ...prev, [editingDetailsFor.id]: details }));
        }
        setEditingDetailsFor(null);
    }
    
    const totalAllocated = useMemo(() => {
        // FIX: Explicitly type 'detail' as 'any' to resolve 'Property 'actualPaid' does not exist on type 'unknown'' error.
        return Object.values(aggregatorDetails).reduce((sum, detail: any) => sum + (detail.actualPaid || 0), 0);
    }, [aggregatorDetails]);


    return (
        <>
            {editingDetailsFor && <ActualPaymentDetailsModal invoice={editingDetailsFor} onClose={() => setEditingDetailsFor(null)} onSave={handleDetailSave} />}
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                    <header className="flex items-center justify-between p-4 border-b dark:border-gray-700 flex-shrink-0">
                        <h2 className="text-xl font-bold">Record Payment for {invoice.id}</h2>
                        <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"><XMarkIcon className="w-6 h-6" /></button>
                    </header>
                    <main className="p-6 space-y-4 overflow-y-auto">
                        <div className="p-4 rounded-lg bg-gray-100 dark:bg-gray-700/50">
                            <div className="flex justify-between text-sm"><span>Invoice Amount:</span> <span className="font-semibold">{formatCurrency(invoice.amount, invoice.currency)}</span></div>
                            <div className="flex justify-between text-sm"><span>Amount Paid:</span> <span className="font-semibold">{formatCurrency(invoice.paidAmount, invoice.currency)}</span></div>
                            <div className="flex justify-between text-base mt-1 pt-1 border-t border-gray-300 dark:border-gray-600"><span>Balance Due:</span> <span className="font-bold text-red-500">{formatCurrency(invoice.balance, invoice.currency)}</span></div>
                        </div>

                        <div className="flex items-center gap-2">
                            <input id="aggregator-check" type="checkbox" checked={isAggregatorPayment} onChange={e => setIsAggregatorPayment(e.target.checked)} />
                            <label htmlFor="aggregator-check">Payment via Aggregator</label>
                        </div>
                        
                        {!isAggregatorPayment ? (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium">Payment Amount</label>
                                    <input type="number" name="amount" value={amount} onChange={e => setAmount(parseFloat(e.target.value) || 0)} className={inputFieldClasses} />
                                    <div className="flex gap-2 mt-2">
                                        <Button variant="secondary" className="text-xs py-1 px-2" onClick={() => setAmount(invoice.balance)}>Pay Full</Button>
                                        <Button variant="secondary" className="text-xs py-1 px-2" onClick={() => setAmount(invoice.balance * 0.5)}>50%</Button>
                                        <Button variant="secondary" className="text-xs py-1 px-2" onClick={() => setAmount(invoice.balance * 0.25)}>25%</Button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div><label className="block text-sm font-medium">Payment Date</label><input type="date" name="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} className={inputFieldClasses} /></div>
                                    <div><label className="block text-sm font-medium">Method</label><select name="method" value={method} onChange={e => setMethod(e.target.value as Payment['method'])} className={inputFieldClasses}><option>Wire Transfer</option><option>Credit Card</option><option>Cash</option><option>UPI</option><option>Check</option></select></div>
                                </div>
                                <div><label className="block text-sm font-medium">Reference</label><input type="text" name="reference" value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g., Transaction ID" className={inputFieldClasses} /></div>
                                <div><label className="block text-sm font-medium">Notes</label><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={inputFieldClasses}></textarea></div>
                                <div><label className="block text-sm font-medium mb-1">Upload Receipt</label><div className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary-500 bg-gray-50 dark:bg-gray-900/50"><p className="text-sm text-gray-500">Drag & drop or click to upload</p></div></div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div><label>Paid To (Aggregator):</label><select value={selectedAggregatorId} onChange={e => setSelectedAggregatorId(e.target.value)} className={inputFieldClasses}><option value="">Select Aggregator</option>{aggregatorVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
                                <div><label>Payment Amount:</label><input type="number" value={aggregatorPaymentAmount} onChange={e => setAggregatorPaymentAmount(parseFloat(e.target.value))} className={inputFieldClasses}/></div>
                                
                                {childInvoices.length > 0 && <div className="border-t pt-4 mt-4">
                                    <h4 className="font-semibold mb-2">Pending Invoices from Child Vendors</h4>
                                    <div className="text-xs overflow-x-auto">
                                        <table className="min-w-full">
                                            <thead><tr>{['','Invoice', 'Vendor', 'Amount', 'Allocate'].map(h => <th key={h} className="text-left py-1 pr-2">{h}</th>)}</tr></thead>
                                            <tbody>
                                                {childInvoices.map(childInv => (
                                                    <tr key={childInv.id}>
                                                        <td><input type="checkbox" checked={selectedChildInvoices.includes(childInv.id)} onChange={() => setSelectedChildInvoices(prev => prev.includes(childInv.id) ? prev.filter(id => id !== childInv.id) : [...prev, childInv.id])} /></td>
                                                        <td className="py-1 pr-2">{childInv.id}</td>
                                                        <td className="py-1 pr-2">{childInv.vendor}</td>
                                                        <td className="py-1 pr-2">{formatCurrency(childInv.amount, childInv.currency)}</td>
                                                        <td>
                                                            {aggregatorDetails[childInv.id] ? 
                                                                <button onClick={() => setEditingDetailsFor(childInv)} className="text-green-500 flex items-center gap-1 text-xs">
                                                                    <CheckIcon className="w-4 h-4"/> {formatCurrency(aggregatorDetails[childInv.id].actualPaid)}
                                                                </button> :
                                                                <Button variant="secondary" className="text-xs py-0.5 px-2" onClick={() => setEditingDetailsFor(childInv)}>Enter Details</Button>
                                                            }
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="mt-2 text-sm text-right">
                                        <p>Total to Aggregator: <span className="font-semibold">{formatCurrency(aggregatorPaymentAmount)}</span></p>
                                        <p>Total Allocated: <span className="font-semibold">{formatCurrency(totalAllocated)}</span></p>
                                        <p className={`font-bold ${aggregatorPaymentAmount - totalAllocated !== 0 ? 'text-red-500' : 'text-green-500'}`}>
                                            Remaining: {formatCurrency(aggregatorPaymentAmount - totalAllocated)}
                                        </p>
                                    </div>
                                </div>}
                            </div>
                        )}
                    </main>
                    <footer className="p-4 border-t dark:border-gray-700 flex justify-end gap-2 flex-shrink-0">
                        <Button variant="secondary" onClick={onClose}>Cancel</Button>
                        <Button onClick={isAggregatorPayment ? handleAggregatorSave : handleSave}>Record Payment</Button>
                    </footer>
                </div>
            </div>
        </>
    );
};