# Finance entry tabs: Log Invoice / Log Payment / Log Settlement

Date: 2026-09-29. Status: design approved in conversation, awaiting spec review.

## Context

This is piece 1 of 4 in the finance work the user requested on 2026-09-29, built in this order:

1. **This spec:** entry-tab renames and the new Log Invoice tab.
2. Vendor discounts on past invoices, paid or unpaid.
3. Air shipping partner (KREIZ or another vendor) and the partner's bill-wise ledger.
4. Ancillary service invoices paid through CNF. These extend the Log Invoice form from this spec.

Today the Finance sidebar has "Payment Ledger" and "Settlement Ledger". The first is already a standalone form. The second is a ledger table whose "Add Entry" menu opens three flows. The ledger table also appears as the Settlement Ledger sub-tab of Accounts View. The user wants each finance write to have its own standalone entry tab. The ledgers are read in Accounts View.

## Design

Frontend only. No backend, sheet or data changes. It deploys with `vercel --prod` alone.

### Sidebar (Finance group)

The order is: CNF Agent, **Log Invoice**, **Log Payment**, **Log Settlement**, Accounts View (following the order things happen: invoice, then payment, then settlement).

| Tab | URL | Shows |
|---|---|---|
| Log Invoice (new) | `/finance/log-invoice` | The invoice entry form (below) |
| Log Payment (was Payment Ledger) | `/finance/log-payment` | The current PaymentLedger form, unchanged |
| Log Settlement (was Settlement Ledger) | `/finance/log-settlement` | The current Cross-Vendor Settlement form, unchanged |

The view names change to match: 'Log Invoice', 'Log Payment', 'Log Settlement'. The 'Payment Ledger', 'Settlement Ledger' and 'Cross Vendor Settlement' views are removed. Every reference moves over, including the FINANCE_VIEWS finance-data loading list in App.tsx.

### Old URLs

`/finance/payment-ledger` redirects to `/finance/log-payment`. `/finance/settlement-ledger` and `/finance/cross-vendor-settlement` redirect to `/finance/log-settlement`. Query parameters are kept, so the pre-fill Accounts View's "Settle Invoice" passes still works.

### Log Invoice form

The invoice entry form exists twice today, in AccountsView.tsx and SettlementLedger.tsx. Both copies make the same calls (`submitVendorAccount` for a new vendor, then `submitPurchaseInvoice`), use the same checks (unique invoice ID, vendor required, RMB > 0), and add the same optimistic temporary row with rollback. They become one component, `components/finance/InvoiceEntryForm.tsx`:

- Fields: date, invoice ID, vendor (or a custom new vendor code + name, registered first), RMB, notes. As today, ER1 and INR are filled in by the end-of-day job.
- Behavior matches the Accounts View copy exactly: validation, optimistic row, rollback on failure, refresh after success.
- The Log Invoice page renders it standalone. Accounts View no longer has its own modal copy: its "Invoice Entry" action goes to Log Invoice, like its "Payment Entry" action already goes to the payment page. The Settlement Ledger table's "Add Entry" menu does the same.

### Links that change target

- Accounts View "Payment Entry" goes to Log Payment. Accounts View "Settle Invoice" goes to Log Settlement with the same query parameters.
- In the Settlement Ledger table's "Add Entry" menu, the Invoice Entry, Payment Entry and Cross-Vendor Settlement items go to Log Invoice, Log Payment and Log Settlement.
- The Cross-Vendor Settlement form's two "back to Settlement Ledger" links (CrossVendorSettlement.tsx:271 and :285) go to Accounts View with its Settlement Ledger sub-tab selected.

### Unchanged

SettlementLedger.tsx stays, because it is Accounts View's Settlement Ledger sub-tab. Its unused 'adjustment' form mode is out of scope. The PaymentLedger and CrossVendorSettlement forms, and every backend action, are unchanged. Page headings follow the new tab names wherever the app header shows the view name.

## Testing

- Type check and lint stay at exactly the 2 known errors (ean, strictPending).
- Browser test against a mock backend:
  - Each of the three sidebar items opens its form.
  - The three old URLs redirect, keeping query parameters.
  - Log Invoice creates an invoice: the mock sheet gets the row, and the optimistic row resolves. A new custom vendor registers first.
  - Accounts View "Invoice Entry" and "Settle Invoice" land on the right tab, with the pre-fill on Log Settlement.
  - The Accounts View Settlement Ledger sub-tab still shows the table.
  - The cross-vendor "back" links land on that sub-tab.
- The existing CNF and payment-reset harness suites still pass.
