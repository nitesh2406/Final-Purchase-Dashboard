import React, { useState, FC } from 'react';
// FIX: Corrected import path for types.
import { Invoice, Payment, InvoiceDocument, ActivityLogEntry } from '../../types';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { 
    XMarkIcon, PencilIcon, BanknotesIcon, DocumentArrowDownIcon, TrashIcon,
    InformationCircleIcon, ListBulletIcon, ClockIcon, PaperClipIcon, EyeIcon
} from '../icons/Icons';

interface InvoiceDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    invoice: Invoice | null;
    onRecordPayment: (invoice: Invoice) => void;
}

type ModalTab = 'overview' | 'payments' | 'documents' | 'activity';

const formatCurrency = (amount: number, currency: string = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount);
const formatDate = (dateString: string) => new Date(dateString).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');

const getStatusConfig = (status: Invoice['status']) => {
    const config = {
        'Paid': { color: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200' },
        'Pending': { color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200' },
        'Overdue': { color: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200' },
        'Partially Paid': { color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200' },
        'Draft': { color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300' },
        'Cancelled': { color: 'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-400' },
    };
    return config[status] || config['Draft'];
};

const OverviewTab: FC<{ invoice: Invoice }> = ({ invoice }) => (
    <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
                <h4 className="font-semibold text-gray-500 dark:text-gray-400 mb-2">Vendor Information</h4>
                <p className="font-bold text-lg">{invoice.vendor}</p>
                <p className="text-sm">Payment Terms: {invoice.paymentTerms}</p>
            </Card>
             <Card>
                <h4 className="font-semibold text-gray-500 dark:text-gray-400 mb-2">Invoice Details</h4>
                <p className="text-sm"><strong>Date:</strong> {formatDate(invoice.invoiceDate)}</p>
                <p className="text-sm"><strong>Due Date:</strong> {formatDate(invoice.dueDate)}</p>
            </Card>
             <Card>
                <h4 className="font-semibold text-gray-500 dark:text-gray-400 mb-2">Financial Summary</h4>
                <p className="text-lg font-bold">{formatCurrency(invoice.amount, invoice.currency)}</p>
                <p className="text-sm text-green-500">Paid: {formatCurrency(invoice.paidAmount, invoice.currency)}</p>
                <p className="text-sm text-red-500">Balance: {formatCurrency(invoice.balance, invoice.currency)}</p>
            </Card>
        </div>
        {invoice.poNumber && <Card>
            <h4 className="font-semibold mb-2">Linked Purchase Order</h4>
            <p>PO Number: <a href="#" className="text-primary-500 hover:underline">{invoice.poNumber}</a></p>
        </Card>}
        {invoice.costBreakdown && <Card>
            <h4 className="font-semibold mb-2">Cost Breakdown</h4>
            <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Base Amount:</span><span>{formatCurrency(invoice.costBreakdown.baseAmount, invoice.currency)}</span></div>
                {invoice.costBreakdown.cgst && <div className="flex justify-between"><span className="text-gray-500">CGST:</span><span>{formatCurrency(invoice.costBreakdown.cgst, invoice.currency)}</span></div>}
                {invoice.costBreakdown.sgst && <div className="flex justify-between"><span className="text-gray-500">SGST:</span><span>{formatCurrency(invoice.costBreakdown.sgst, invoice.currency)}</span></div>}
                 <div className="flex justify-between font-bold border-t pt-1 mt-1"><span >Total:</span><span>{formatCurrency(invoice.amount, invoice.currency)}</span></div>
            </div>
        </Card>}
        {invoice.notes && <Card>
            <h4 className="font-semibold mb-2">Notes</h4>
            <p className="text-sm p-3 bg-gray-100 dark:bg-gray-700/50 rounded-md">{invoice.notes}</p>
        </Card>}
    </div>
);

const PaymentHistoryTab: FC<{ invoice: Invoice, onRecordPayment: (invoice: Invoice) => void }> = ({ invoice, onRecordPayment }) => (
    <div>
        {invoice.payments.length === 0 ? (
            <div className="text-center py-12">
                <p className="text-gray-500 mb-4">No payments recorded yet.</p>
                <Button onClick={() => onRecordPayment(invoice)}>Record First Payment</Button>
            </div>
        ) : (
            <div className="space-y-4">
                 {invoice.balance > 0 && <div className="flex justify-end"><Button onClick={() => onRecordPayment(invoice)}>Record Another Payment</Button></div>}
                {invoice.payments.map(p => (
                    <Card key={p.id}>
                        <div className="flex justify-between items-start">
                            <div>
                                <p className="font-bold text-lg">{formatCurrency(p.amount, invoice.currency)}</p>
                                <p className="text-sm text-gray-500">{p.method} on {formatDate(p.date)}</p>
                                <p className="text-xs font-mono mt-1">Ref: {p.reference}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-xs text-gray-400">Recorded by {p.recordedBy}</p>
                                <span className="text-sm font-semibold text-green-600">Completed</span>
                            </div>
                        </div>
                    </Card>
                ))}
            </div>
        )}
    </div>
);

const DocumentsTab: FC<{ documents: InvoiceDocument[] }> = ({ documents }) => (
    <div className="space-y-4">
        <div className="p-4 border-2 border-dashed rounded-lg text-center cursor-pointer hover:border-primary-500 bg-gray-50 dark:bg-gray-900/50">
            <p>Drag & drop files here or</p>
            <Button variant="secondary" className="mt-2">Browse Files</Button>
        </div>
        {documents.length > 0 ? (
            <ul className="divide-y dark:divide-gray-700">
                {documents.map(doc => (
                    <li key={doc.fileName} className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-3">
                            <PaperClipIcon className="w-5 h-5" />
                            <div>
                                <p className="font-medium">{doc.type}</p>
                                <p className="text-sm text-gray-500">{doc.fileName} - {doc.size}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {/* FIX: Removed invalid 'size' prop and added className for styling. */}
                             <Button variant="secondary" className="py-1 px-2 text-xs" icon={<EyeIcon className="w-4 h-4" />}>View</Button>
                             {/* FIX: Removed invalid 'size' prop and added className for styling. */}
                             <Button variant="secondary" className="py-1 px-2 text-xs" icon={<DocumentArrowDownIcon className="w-4 h-4" />}>Download</Button>
                             {/* FIX: Removed invalid 'size' prop and added className for styling. */}
                             <Button variant="secondary" className="py-1 px-2 text-xs" icon={<TrashIcon className="w-4 h-4" />} />
                        </div>
                    </li>
                ))}
            </ul>
        ) : <p className="text-center text-gray-500 py-4">No documents uploaded.</p>}
    </div>
);

const ActivityLogTab: FC<{ log: ActivityLogEntry[] }> = ({ log }) => (
     <div>
        {log.map((entry, index) => (
            <div key={index} className="flex gap-x-3">
                <div className="relative last:after:hidden after:absolute after:top-7 after:bottom-0 after:start-3.5 after:w-px after:-translate-x-1/2 after:bg-gray-200 dark:after:bg-gray-700">
                    <div className="relative z-10 w-7 h-7 flex justify-center items-center"><div className="w-2 h-2 rounded-full bg-gray-400"></div></div>
                </div>
                <div className="grow pt-0.5 pb-8">
                    <p className="text-sm text-gray-500">{formatDate(entry.timestamp)} by <span className="font-semibold text-gray-800 dark:text-gray-200">{entry.user}</span></p>
                    <p className="mt-1 text-sm font-semibold">{entry.activity}: <span className="font-normal">{entry.details}</span></p>
                </div>
            </div>
        ))}
    </div>
);

export const InvoiceDetailModal: FC<InvoiceDetailModalProps> = ({ isOpen, onClose, invoice, onRecordPayment }) => {
    const [activeTab, setActiveTab] = useState<ModalTab>('overview');

    if (!isOpen || !invoice) return null;

    const tabs: { id: ModalTab, label: string, icon: React.ReactNode }[] = [
        { id: 'overview', label: 'Overview', icon: <InformationCircleIcon className="w-5 h-5"/> },
        { id: 'payments', label: 'Payment History', icon: <BanknotesIcon className="w-5 h-5"/> },
        { id: 'documents', label: 'Documents', icon: <PaperClipIcon className="w-5 h-5"/> },
        { id: 'activity', label: 'Activity Log', icon: <ClockIcon className="w-5 h-5"/> },
    ];

    const renderTabContent = () => {
        switch (activeTab) {
            case 'overview': return <OverviewTab invoice={invoice} />;
            case 'payments': return <PaymentHistoryTab invoice={invoice} onRecordPayment={onRecordPayment} />;
            case 'documents': return <DocumentsTab documents={invoice.documents} />;
            case 'activity': return <ActivityLogTab log={invoice.activityLog} />;
            default: return null;
        }
    };
    
    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <header className="flex items-center justify-between p-4 border-b dark:border-gray-700">
                    <div className="flex items-center gap-4">
                        <h2 className="text-2xl font-bold">{invoice.id}</h2>
                        <span className={`px-3 py-1 text-sm font-semibold rounded-full ${getStatusConfig(invoice.status).color}`}>{invoice.status}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" icon={<PencilIcon className="w-4 h-4"/>}>Edit</Button>
                        <Button onClick={() => onRecordPayment(invoice)} disabled={invoice.status === 'Paid'} icon={<BanknotesIcon className="w-4 h-4"/>}>Record Payment</Button>
                        <Button variant="secondary" icon={<DocumentArrowDownIcon className="w-4 h-4"/>}>Download PDF</Button>
                        <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"><XMarkIcon className="w-6 h-6"/></button>
                    </div>
                </header>
                <div className="flex flex-grow overflow-hidden">
                    <nav className="w-52 border-r dark:border-gray-700 p-2">
                        <ul className="space-y-1">
                             {tabs.map(tab => (
                                <li key={tab.id}>
                                    <button onClick={() => setActiveTab(tab.id)} className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md ${activeTab === tab.id ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/50' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                                        {tab.icon} {tab.label}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </nav>
                    <main className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-gray-900/50">
                        {renderTabContent()}
                    </main>
                </div>
                 <footer className="flex items-center justify-end p-4 border-t dark:border-gray-700">
                    <Button variant="secondary" onClick={onClose}>Close</Button>
                </footer>
            </div>
        </div>
    );
};