import React, { useState, FC } from 'react';
import { Invoice, Vendor, PurchaseOrder, Shipment } from '../../types';
import { InvoicesView } from './InvoicesView';
import { VendorsView } from './VendorsView';
import { ReportsView } from './ReportsView';
import { BanknotesIcon, UserGroupIcon, DocumentChartBarIcon } from '../icons/Icons';

interface FinanceProps {
    invoices: Invoice[];
    vendors: Vendor[];
    purchaseOrders: PurchaseOrder[];
    shipments: Shipment[];
    addInvoice: (invoiceData: Omit<Invoice, 'id'>) => void;
    updateInvoice: (updatedInvoice: Invoice) => void;
    updateMultipleInvoices: (updatedInvoices: Invoice[]) => void;
    addVendor: (vendorData: Omit<Vendor, 'id'>) => void;
    updateVendor: (updatedVendor: Vendor) => void;
}

type FinanceView = 'Invoices' | 'Vendors' | 'Reports';

const financeNav: { name: FinanceView, icon: React.ReactNode }[] = [
    { name: 'Invoices', icon: <BanknotesIcon className="w-5 h-5" /> },
    { name: 'Vendors', icon: <UserGroupIcon className="w-5 h-5" /> },
    { name: 'Reports', icon: <DocumentChartBarIcon className="w-5 h-5" /> },
];

export const Finance: FC<FinanceProps> = (props) => {
    const [activeView, setActiveView] = useState<FinanceView>('Reports');

    const renderView = () => {
        switch (activeView) {
            case 'Invoices':
                return <InvoicesView {...props} />;
            case 'Vendors':
                return <VendorsView {...props} />;
            case 'Reports':
                // FIX: Pass shipments prop to ReportsView for freight analysis.
                return <ReportsView shipments={props.shipments} />;
            default:
                return <InvoicesView {...props} />;
        }
    };

    return (
        <div className="flex flex-col h-full">
            <div className="flex-shrink-0 border-b border-slate-200 dark:border-slate-700">
                <nav className="-mb-px flex space-x-6">
                    {financeNav.map(item => (
                         <button
                            key={item.name}
                            onClick={() => setActiveView(item.name)}
                            className={`py-3 px-1 inline-flex items-center gap-2 text-sm whitespace-nowrap font-medium transition-colors focus:outline-none ${
                                activeView === item.name
                                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                                : 'border-b-2 border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                            }`}
                        >
                            {item.icon}
                            {item.name}
                        </button>
                    ))}
                </nav>
            </div>
            <main className="flex-grow pt-6 overflow-y-auto">
                {renderView()}
            </main>
        </div>
    );
};

// FIX: Removed duplicate icon declarations. They are correctly imported from ../icons/Icons.
