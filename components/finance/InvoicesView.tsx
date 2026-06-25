
import React, { useState, useMemo, FC } from 'react';
import { Invoice, Vendor, PurchaseOrder, Shipment, InvoiceStatus } from '../../types';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { CreateInvoiceModal } from './CreateInvoiceModal';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import { RecordPaymentModal } from './RecordPaymentModal';
import { BulkPaymentModal } from './BulkPaymentModal';
import { PlusCircleIcon, EyeIcon, BanknotesIcon, PencilIcon, DocumentArrowDownIcon, TrashIcon, XCircleIcon, CheckBadgeIcon, ClockIcon, CalendarDaysIcon, ExclamationTriangleIcon, CreditCardIcon } from '../icons/Icons';

interface InvoicesViewProps {
    invoices: Invoice[];
    vendors: Vendor[];
    purchaseOrders: PurchaseOrder[];
    shipments: Shipment[];
    addInvoice: (invoiceData: Omit<Invoice, 'id'>) => void;
    updateInvoice: (updatedInvoice: Invoice) => void;
    updateMultipleInvoices: (updatedInvoices: Invoice[]) => void;
}

const formatCurrency = (amount: number, currency: string = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount);
const formatDate = (dateString: string) => new Date(dateString).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');

const getStatusConfig = (status: Invoice['status']) => {
    const config = {
        'Paid': { color: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200' },
        'Pending': { color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200' },
        'Overdue': { color: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200' },
        'Partially Paid': { color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200' },
        'Draft': { color: 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300' },
        'Cancelled': { color: 'bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-400' },
    };
    return config[status] || config['Draft'];
};

const MetricCard: FC<{ title: string, value: string, subtitle: string, icon: React.ReactNode }> = ({ title, value, subtitle, icon }) => (
    <Card className="flex items-center p-4">
        <div className="p-3 mr-4 text-blue-500 bg-blue-100 rounded-full dark:bg-blue-900/50">{icon}</div>
        <div>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400">{title}</p>
            <p className="text-lg font-semibold text-slate-800 dark:text-white">{value}</p>
            <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
    </Card>
);

export const InvoicesView: FC<InvoicesViewProps> = (props) => {
    const { invoices, vendors, purchaseOrders, shipments, addInvoice, updateInvoice, updateMultipleInvoices } = props;
    const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
    const [isCreateModalOpen, setCreateModalOpen] = useState(false);
    const [isDetailModalOpen, setDetailModalOpen] = useState(false);
    const [isRecordPaymentModalOpen, setRecordPaymentModalOpen] = useState(false);
    const [isBulkPaymentModalOpen, setBulkPaymentModalOpen] = useState(false);
    const [selectedRows, setSelectedRows] = useState<string[]>([]);
    
    // Filtering State
    const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'All'>('All');
    const [dateFilter, setDateFilter] = useState('Last 30 days');
    const [vendorFilter, setVendorFilter] = useState<string[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    
    // Sorting State
    const [sortConfig, setSortConfig] = useState<{ key: keyof Invoice; direction: 'asc' | 'desc' }>({ key: 'invoiceDate', direction: 'desc' });
    
    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(25);
    
    const metrics = useMemo(() => {
        const payables = invoices.reduce((sum, inv) => sum + inv.balance, 0);
        const overdue = invoices.filter(i => i.status === 'Overdue');
        // FIX: Replaced .at(-1) with array[array.length - 1] for broader JS runtime compatibility.
        const paidThisMonth = invoices.filter(i => i.status === 'Paid' && i.payments.length > 0 && new Date(i.payments[i.payments.length - 1].date).getMonth() === new Date().getMonth());
        const dueSoon = invoices.filter(i => {
            const due = new Date(i.dueDate).getTime();
            const now = new Date().getTime();
            const diffDays = (due - now) / (1000 * 3600 * 24);
            return diffDays >= 0 && diffDays <= 7 && i.balance > 0;
        });
        return {
            totalPayables: formatCurrency(payables),
            overdueAmount: formatCurrency(overdue.reduce((s,i) => s + i.balance, 0)),
            overdueCount: overdue.length,
            paidThisMonthAmount: formatCurrency(paidThisMonth.reduce((s,i) => s + i.paidAmount, 0)),
            paidThisMonthCount: paidThisMonth.length,
            dueSoonAmount: formatCurrency(dueSoon.reduce((s,i) => s + i.balance, 0)),
            dueSoonCount: dueSoon.length,
        }
    }, [invoices]);

    const statusCounts = useMemo(() => {
        const counts: { [key in InvoiceStatus | 'All']: number } = { All: invoices.length, Pending: 0, 'Partially Paid': 0, Paid: 0, Overdue: 0, Cancelled: 0, Draft: 0 };
        invoices.forEach(i => { if(counts.hasOwnProperty(i.status)) counts[i.status]++ });
        return counts;
    }, [invoices]);

    const filteredAndSortedInvoices = useMemo(() => {
        const filtered = invoices
            .filter(i => statusFilter === 'All' || i.status === statusFilter)
            .filter(i => vendorFilter.length === 0 || vendorFilter.includes(i.vendor))
            .filter(i => i.id.toLowerCase().includes(searchTerm.toLowerCase()) || i.vendor.toLowerCase().includes(searchTerm.toLowerCase()));

        return [...filtered].sort((a, b) => {
            const aVal = a[sortConfig.key];
            const bVal = b[sortConfig.key];
            if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [invoices, statusFilter, vendorFilter, searchTerm, sortConfig]);

    const paginatedInvoices = useMemo(() => {
        const startIndex = (currentPage - 1) * rowsPerPage;
        return filteredAndSortedInvoices.slice(startIndex, startIndex + rowsPerPage);
    }, [filteredAndSortedInvoices, currentPage, rowsPerPage]);
    
    const handleSaveInvoice = (invoiceData: Omit<Invoice, 'id'>) => {
        addInvoice(invoiceData);
        setCreateModalOpen(false);
    };

    const handleUpdateInvoice = (updatedInvoice: Invoice) => {
        updateInvoice(updatedInvoice);
        setRecordPaymentModalOpen(false);
        if (isDetailModalOpen) setSelectedInvoice(updatedInvoice);
    };
    
    const handleBulkUpdate = (updatedInvoices: Invoice[]) => {
        updateMultipleInvoices(updatedInvoices);
        setBulkPaymentModalOpen(false);
        setSelectedRows([]);
    }

    const handleRecordPayment = (invoice: Invoice) => {
        setSelectedInvoice(invoice);
        setDetailModalOpen(false);
        setRecordPaymentModalOpen(true);
    };
    
    const handleViewDetails = (invoice: Invoice) => {
        setSelectedInvoice(invoice);
        setDetailModalOpen(true);
    };
    
    const selectedInvoicesForBulkPayment = useMemo(() => {
        return invoices.filter(inv => selectedRows.includes(inv.id));
    }, [invoices, selectedRows]);

    return (
        <div className="space-y-4">
            {isCreateModalOpen && <CreateInvoiceModal isOpen={true} onClose={() => setCreateModalOpen(false)} onSave={handleSaveInvoice} vendors={vendors} purchaseOrders={purchaseOrders} shipments={shipments} invoiceCount={invoices.length} />}
            {isDetailModalOpen && <InvoiceDetailModal isOpen={true} onClose={() => setDetailModalOpen(false)} invoice={selectedInvoice} onRecordPayment={handleRecordPayment} />}
            {isRecordPaymentModalOpen && <RecordPaymentModal isOpen={true} onClose={() => setRecordPaymentModalOpen(false)} onSave={handleUpdateInvoice} invoice={selectedInvoice} vendors={vendors} allInvoices={invoices} />}
            {isBulkPaymentModalOpen && <BulkPaymentModal isOpen={true} onClose={() => setBulkPaymentModalOpen(false)} onSave={handleBulkUpdate} invoices={selectedInvoicesForBulkPayment} />}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard title="Total Payables" value={metrics.totalPayables} subtitle="Outstanding amount" icon={<BanknotesIcon className="w-6 h-6"/>} />
                <MetricCard title="Overdue Payments" value={metrics.overdueAmount} subtitle={`${metrics.overdueCount} invoices overdue`} icon={<ExclamationTriangleIcon className="w-6 h-6"/>} />
                <MetricCard title="Paid This Month" value={metrics.paidThisMonthAmount} subtitle={`${metrics.paidThisMonthCount} invoices paid`} icon={<CheckBadgeIcon className="w-6 h-6"/>} />
                <MetricCard title="Upcoming Due (7 Days)" value={metrics.dueSoonAmount} subtitle={`${metrics.dueSoonCount} invoices due soon`} icon={<CalendarDaysIcon className="w-6 h-6"/>} />
            </div>

            <div className="flex flex-wrap gap-2">
                {(['All', 'Pending', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled'] as const).map(s =>(
                    <button key={s} onClick={() => setStatusFilter(s === 'All' ? 'All' : s)} className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${statusFilter === s ? 'bg-blue-600 text-white shadow' : 'bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600'}`}>
                        {s} <span className="ml-1.5 bg-black/10 dark:bg-white/10 text-xs rounded-full px-1.5 py-0.5">{s === 'All' ? statusCounts.All : statusCounts[s]}</span>
                    </button>
                ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex-1 min-w-[300px]"><input type="text" placeholder="Search Invoice ID, Vendor..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-4 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"/></div>
                <div className="flex items-center gap-2"><select className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"><option>Last 30 days</option></select><select className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"><option>All Vendors</option></select></div>
                 <div className="flex items-center gap-2">
                    <Button onClick={() => setBulkPaymentModalOpen(true)} variant="secondary" disabled={selectedRows.length === 0}>Bulk Pay ({selectedRows.length})</Button>
                    <Button onClick={() => setCreateModalOpen(true)} icon={<PlusCircleIcon/>}>Create Invoice</Button>
                </div>
            </div>
            
             <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                    <thead className="bg-slate-50 dark:bg-slate-800">
                        <tr>
                            <th className="px-4 py-3"><input type="checkbox" onChange={e => setSelectedRows(e.target.checked ? paginatedInvoices.map(i => i.id) : [])} /></th>
                            {['Status', 'Invoice ID', 'Vendor', 'Date', 'Due Date', 'Amount', 'Balance', 'Actions'].map(h => (
                                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-slate-900 divide-y divide-slate-200 dark:divide-slate-700">
                        {paginatedInvoices.map(invoice => (
                            <tr key={invoice.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                <td className="px-4 py-4"><input type="checkbox" checked={selectedRows.includes(invoice.id)} onChange={() => setSelectedRows(prev => prev.includes(invoice.id) ? prev.filter(id => id !== invoice.id) : [...prev, invoice.id])} /></td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm"><span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusConfig(invoice.status).color}`}>{invoice.status}</span></td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-white">{invoice.id}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm">{invoice.vendor}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm">{formatDate(invoice.invoiceDate)}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm">{formatDate(invoice.dueDate)}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-right">{formatCurrency(invoice.amount, invoice.currency)}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-right font-semibold">{formatCurrency(invoice.balance, invoice.currency)}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm">
                                    <div className="flex items-center gap-2">
                                        <Button variant="secondary" onClick={() => handleViewDetails(invoice)} icon={<EyeIcon className="w-4 h-4" />} className="py-1 px-2 text-xs">View</Button>
                                        <Button variant="secondary" onClick={() => handleRecordPayment(invoice)} disabled={invoice.status === 'Paid'} icon={<BanknotesIcon className="w-4 h-4"/>} className="py-1 px-2 text-xs">Pay</Button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};