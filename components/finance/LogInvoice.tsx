import React from 'react';
import { Card } from '../ui/Card';
import { InvoiceEntryForm } from './InvoiceEntryForm';
import type { PurchaseInvoice, VendorMaster } from '../../services/settlementService';

// Log Invoice tab: record a vendor invoice (liability). The ledgers are read
// in Accounts View.
export const LogInvoice: React.FC<{
  invoices: (PurchaseInvoice & { temp?: boolean })[];
  vendors: VendorMaster[];
  setPurchaseInvoices: React.Dispatch<React.SetStateAction<(PurchaseInvoice & { temp?: boolean })[]>>;
  onRefresh: () => Promise<void> | void;
}> = (props) => (
  <div className="p-6 max-w-3xl mx-auto space-y-6">
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Log Invoice</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Record an invoice a vendor has raised on us. It shows in Accounts View once saved.</p>
    </div>
    <Card className="p-6">
      <InvoiceEntryForm {...props} />
    </Card>
  </div>
);
