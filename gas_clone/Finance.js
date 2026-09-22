/**
 * FINANCE MODULE — Backend Functions
 * ─────────────────────────────────────────────────────────────
 * ADD THESE FUNCTIONS TO YOUR EXISTING Code.gs
 * Also add the new action cases to your doPost() switch statement.
 *
 * NEW ACTIONS:
 *   get_batches_finance       → ShipmentFinance list page
 *   get_batch_finance_detail  → ShipmentFinanceDetail page
 *   update_batch_tracking     → Inline edit on ShipmentFinance card
 *   get_fx_rates              → Payment Ledger FX rate table
 *   log_payment               → Payment Ledger — log a payment
 *   get_payments              → Payment Ledger — fetch payments
 *   get_vendor_accounts       → Payment Ledger — fetch vendor accounts
 *   get_agent_invoices        → Accounts View
 *   log_agent_invoice         → Accounts View — add invoice
 *   map_invoice_shipments     → Accounts View — link shipments to invoice
 */


// ─────────────────────────────────────────────────────────────
// ADD TO YOUR doPost() SWITCH STATEMENT:
// ─────────────────────────────────────────────────────────────
/*
  case 'get_batches_finance':       return getBatchesFinance();
  case 'get_batch_finance_detail':  return getBatchFinanceDetail(data.batch_id);
  case 'update_batch_tracking':     return updateBatchTracking(data);
  case 'get_fx_rates':              return getFXRates();
  case 'log_payment':               return logPayment(data);
  case 'get_payments':              return getPayments(data);
  case 'get_vendor_accounts':       return getVendorAccounts();
  case 'get_agent_invoices':        return getAgentInvoices();
  case 'log_agent_invoice':         return logAgentInvoice(data);
  case 'map_invoice_shipments':     return mapInvoiceToShipments(data);
*/


// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

// getSheetData_ moved to entry_points.js (was defined here, in
// accounting_logger.js, and in entry_points.js with a 3rd, cached version —
// see the comment there; this file's uncached sheets are listed in
// UNCACHED_SHEETS_ so behavior here is unchanged).

function generateId_(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5).toUpperCase();
}

// successResponse_/errorResponse_ moved to entry_points.js (was defined here,
// in accounting_logger.js, and in entry_points.js with a 3rd incompatible
// shape — see the comment there).


// ─────────────────────────────────────────────────────────────
// GET_BATCHES_FINANCE / GET_BATCH_FINANCE_DETAIL — retired.
// Merged into getBatches()/getBatchDetails() in "PO+Shipment Codes.js":
// finance fields now attach conditionally per-request based on the
// caller's role (see getUserRole_ in entry_points.js), instead of living
// behind a second, Finance-only pair of endpoints.
// ─────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────
// UPDATE BATCH TRACKING
// Edits carrier, tracking, ETA, status, amount, currency, notes
// Used by: the merged Batch Detail's Admin edit panel
// ─────────────────────────────────────────────────────────────
function updateBatchTracking(data) {
  try {
    if (getUserRole_(data.user_email) !== 'ADMIN') {
      return errorResponse_('Admin access required to edit batch tracking.');
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Batches');
    if (!sheet) return errorResponse_('Batches sheet not found');

    const allData = sheet.getDataRange().getValues();
    const headers = allData[0];
    const batchIdIdx = headers.indexOf('batch_id');
    const statusIdx = headers.indexOf('status');
    const shippedAtIdx = headers.indexOf('shipped_at');
    const actualDeliveryIdx = headers.indexOf('actual_delivery');

    const updatableFields = [
      'carrier', 'tracking_number', 'expected_delivery', 'actual_delivery',
      'status', 'notes', 'total_amount', 'total_currency'
    ];

    for (let i = 1; i < allData.length; i++) {
      if (allData[i][batchIdIdx] === data.batch_id) {
        const previousStatus = String(allData[i][statusIdx] || '').trim();
        const newStatus = data.status !== undefined ? String(data.status || '').trim() : previousStatus;
        const now = new Date();

        updatableFields.forEach(field => {
          const colIdx = headers.indexOf(field);
          if (colIdx >= 0 && data[field] !== undefined) {
            sheet.getRange(i + 1, colIdx + 1).setValue(data[field]);
          }
        });

        // shipped_at: stamp the first time a batch leaves OPEN — this is the
        // only place batch status actually changes (adding a shipment to an
        // OPEN batch does NOT touch status, see updateBatchTotals_), so it's
        // the one meaningful "shipped" moment. Never overwrites a value
        // that's already there.
        if (shippedAtIdx >= 0 && previousStatus === 'OPEN' && newStatus !== 'OPEN' && !allData[i][shippedAtIdx]) {
          sheet.getRange(i + 1, shippedAtIdx + 1).setValue(now);
        }

        // actual_delivery: stamp when status is set to Delivered, unless the
        // caller explicitly supplied its own actual_delivery (e.g. backfilling
        // a real date) or one is already on file.
        if (actualDeliveryIdx >= 0 && newStatus === 'Delivered' && data.actual_delivery === undefined && !allData[i][actualDeliveryIdx]) {
          sheet.getRange(i + 1, actualDeliveryIdx + 1).setValue(now);
        }

        const updatedIdx = headers.indexOf('updated_at');
        if (updatedIdx >= 0) {
          sheet.getRange(i + 1, updatedIdx + 1).setValue(new Date().toISOString());
        }
        invalidateSheetCache_('Batches');
        return successResponse_({ message: 'Batch updated', batch_id: data.batch_id });
      }
    }
    return errorResponse_('Batch not found: ' + data.batch_id);

  } catch (e) {
    Logger.log('updateBatchTracking error: ' + e.toString());
    return errorResponse_('Update failed: ' + e.message);
  }
}


// ─────────────────────────────────────────────────────────────
// 4. GET FX RATES
// Returns all blended rates (monthly + quarterly)
// Used by: Payment Ledger FX summary section
// ─────────────────────────────────────────────────────────────
function getFXRates() {
  try {
    const rates = getSheetData_('FXRates');
    return successResponse_({ rates });
  } catch (e) {
    return errorResponse_('Failed to load FX rates: ' + e.message);
  }
}


// ─────────────────────────────────────────────────────────────
// 5. LOG PAYMENT
// Adds a payment record and recalculates FX blended rates
// Used by: Payment Ledger — Log Payment form
// ─────────────────────────────────────────────────────────────
function logPayment(data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Payments');
    if (!sheet) return errorResponse_('Payments sheet not found');

    const amtINR     = parseFloat(data.amount_inr) || 0;
    const amtForeign = parseFloat(data.amount_foreign) || 0;
    const dayFXRate  = amtForeign > 0 ? (amtINR / amtForeign).toFixed(4) : 0;

    const newRow = [
      generateId_('PAY'),           // payment_id
      data.payment_date || new Date().toISOString(),
      data.vendor_id || '',
      data.vendor_name || '',
      data.account_id || '',
      data.account_type || 'Trade',
      data.batch_id || '',
      data.shipment_id || '',
      amtINR,
      amtForeign,
      data.currency || 'RMB',
      dayFXRate,                    // auto-calculated
      data.is_cross_vendor || false,
      data.cross_from_vendor_id || '',
      data.cross_from_account_id || '',
      data.payment_mode || 'Bank Transfer',
      data.reference_no || '',
      'Logged',
      data.logged_by || 'Admin',
      new Date().toISOString(),
      data.notes || ''
    ];

    sheet.appendRow(newRow);
    invalidateSheetCache_('Payments');

    // Recalculate FX rates after each payment
    recalculateFXRates();

    // If cross-vendor: log the offset payment too
    if (data.is_cross_vendor && data.cross_from_vendor_id) {
      // The debit from the source vendor's pool is implicit —
      // frontend should show the running balance accordingly
      Logger.log('Cross-vendor payment logged from ' + data.cross_from_vendor_id);
    }

    // Mirror into PaymentLogs — every Payments entry must also exist there
    // (same payment_id) so it goes through the same VendorLedger logging +
    // FIFO invoice liquidation that addPaymentLog already does, rather than
    // duplicating that logic here. Balance is intentionally left unset —
    // addPaymentLog defaults it to the RMB amount, same as its other callers.
    // A mirror failure does NOT roll back or fail the Payments write (Sheets
    // has no transactions); it's surfaced in the response instead.
    let paymentLogStatus = 'success';
    let paymentLogError  = null;
    try {
      const paymentLogResponse = addPaymentLog({
        record: {
          'Date':          data.payment_date || new Date().toISOString(),
          'Payment ID':    newRow[0],
          'Vendor Code':   data.vendor_id || '',
          'RMB Amount':    amtForeign,
          'ER2':           dayFXRate,
          'INR Amount':    amtINR,
          'Payment Mode':  data.payment_mode || 'Bank Transfer',
          'Reference No':  data.reference_no || '',
        }
      });
      const parsed = JSON.parse(paymentLogResponse.getContent());
      invalidateSheetCache_('PaymentLogs');
      if (parsed.status === 'error') {
        paymentLogStatus = 'error';
        paymentLogError  = parsed.message;
        Logger.log('logPayment: PaymentLogs mirror failed for ' + newRow[0] + ' — ' + parsed.message);
      }
    } catch (mirrorErr) {
      paymentLogStatus = 'error';
      paymentLogError  = mirrorErr.message;
      Logger.log('logPayment: PaymentLogs mirror threw for ' + newRow[0] + ' — ' + mirrorErr.message);
    }

    return successResponse_({
      message: 'Payment logged successfully',
      payment_id: newRow[0],
      day_fx_rate: dayFXRate,
      payment_log_status: paymentLogStatus,
      payment_log_error: paymentLogError
    });

  } catch (e) {
    Logger.log('logPayment error: ' + e.toString());
    return errorResponse_('Failed to log payment: ' + e.message);
  }
}


// ─────────────────────────────────────────────────────────────
// 6. GET PAYMENTS
// Fetch payments with optional filters
// Used by: Payment Ledger — Ledger view, per-vendor view
// ─────────────────────────────────────────────────────────────
function getPayments(data) {
  try {
    let payments = getSheetData_('Payments');

    // Optional filters
    if (data.vendor_id) payments = payments.filter(p => p.vendor_id === data.vendor_id);
    if (data.batch_id)  payments = payments.filter(p => p.batch_id === data.batch_id);
    if (data.currency)  payments = payments.filter(p => p.currency === data.currency);
    if (data.from_date) {
      const from = new Date(data.from_date);
      payments = payments.filter(p => new Date(p.payment_date) >= from);
    }
    if (data.to_date) {
      const to = new Date(data.to_date);
      payments = payments.filter(p => new Date(p.payment_date) <= to);
    }

    // Compute vendor balances if vendor_id provided
    let vendorBalance = null;
    if (data.vendor_id && data.include_balance) {
      const allPayments = getSheetData_('Payments');
      const vendorPayments = allPayments.filter(p => p.vendor_id === data.vendor_id);
      
      // Simplified: total paid to this vendor
      const tradePayments = vendorPayments.filter(p => p.account_type === 'Trade');
      const poolPayments  = vendorPayments.filter(p => p.account_type === 'Pool');
      const crossOut = allPayments.filter(p => p.cross_from_vendor_id === data.vendor_id);

      vendorBalance = {
        trade_paid_inr: tradePayments.reduce((s, p) => s + (parseFloat(p.amount_inr) || 0), 0),
        pool_balance_inr: poolPayments.reduce((s, p) => s + (parseFloat(p.amount_inr) || 0), 0)
                        - crossOut.reduce((s, p) => s + (parseFloat(p.amount_inr) || 0), 0),
        cross_out_inr: crossOut.reduce((s, p) => s + (parseFloat(p.amount_inr) || 0), 0)
      };
    }

    return successResponse_({ payments, vendor_balance: vendorBalance });

  } catch (e) {
    Logger.log('getPayments error: ' + e.toString());
    return errorResponse_('Failed to fetch payments: ' + e.message);
  }
}


// ─────────────────────────────────────────────────────────────
// 7. GET VENDOR ACCOUNTS
// Returns all vendor trade + pool accounts
// Used by: Payment Ledger — account selector dropdown
// ─────────────────────────────────────────────────────────────
function getVendorAccounts() {
  try {
    const accounts = getSheetData_('VendorAccounts').filter(a => a.is_active === true || a.is_active === 'TRUE');
    return successResponse_({ accounts });
  } catch (e) {
    return errorResponse_('Failed to fetch vendor accounts: ' + e.message);
  }
}


// ─────────────────────────────────────────────────────────────
// 8. GET AGENT INVOICES
// Returns all agent invoices with allocation status
// Used by: Accounts View
// ─────────────────────────────────────────────────────────────
function getAgentInvoices() {
  try {
    const invoices = getSheetData_('AgentInvoices');
    const maps     = getSheetData_('InvoiceShipmentMap');

    // Enrich each invoice with allocated amount
    const enriched = invoices.map(inv => {
      const invMaps = maps.filter(m => m.invoice_id === inv.invoice_id);
      const allocatedINR = invMaps.reduce((s, m) => s + (parseFloat(m.allocated_amt_inr) || 0), 0);
      const totalINR = parseFloat(inv.total_amount_inr) || 0;
      
      return {
        ...inv,
        allocated_inr: allocatedINR,
        unallocated_inr: totalINR - allocatedINR,
        allocation_count: invMaps.length,
        allocation_pct: totalINR > 0 ? Math.round((allocatedINR / totalINR) * 100) : 0
      };
    });

    return successResponse_({ invoices: enriched });
  } catch (e) {
    return errorResponse_('Failed to fetch agent invoices: ' + e.message);
  }
}


// ─────────────────────────────────────────────────────────────
// 9. LOG AGENT INVOICE
// Creates a new agent invoice record
// Used by: Accounts View — Log Invoice form
// ─────────────────────────────────────────────────────────────
function logAgentInvoice(data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('AgentInvoices');
    if (!sheet) return errorResponse_('AgentInvoices sheet not found');

    const total = (parseFloat(data.principal_amt) || 0) +
                  (parseFloat(data.commission_amt) || 0) +
                  (parseFloat(data.freight_amt) || 0) +
                  (parseFloat(data.gst_amt) || 0);

    const newRow = [
      generateId_('INV'),
      data.invoice_no || '',
      data.invoice_date || '',
      data.received_date || new Date().toISOString(),
      data.total_amount_inr || total,
      data.principal_amt || 0,
      data.commission_amt || 0,
      data.freight_amt || 0,
      data.gst_amt || 0,
      'Received',
      new Date().toISOString(),
      data.created_by || 'Accounts',
      data.notes || ''
    ];

    sheet.appendRow(newRow);
    return successResponse_({ message: 'Invoice logged', invoice_id: newRow[0] });

  } catch (e) {
    Logger.log('logAgentInvoice error: ' + e.toString());
    return errorResponse_('Failed to log invoice: ' + e.message);
  }
}


// ─────────────────────────────────────────────────────────────
// 10. MAP INVOICE TO SHIPMENTS
// Links shipments to an agent invoice + updates invoice status
// Used by: Accounts View — Shipment allocation
// ─────────────────────────────────────────────────────────────
function mapInvoiceToShipments(data) {
  try {
    // data.invoice_id: string
    // data.mappings: [{ shipment_id, batch_id, allocated_amt_inr }]
    if (!data.invoice_id || !data.mappings || !data.mappings.length) {
      return errorResponse_('invoice_id and mappings[] are required');
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const mapSheet = ss.getSheetByName('InvoiceShipmentMap');
    const invSheet = ss.getSheetByName('AgentInvoices');
    if (!mapSheet || !invSheet) return errorResponse_('Required sheets not found');

    // Remove existing mappings for this invoice (full re-allocation)
    const existing = mapSheet.getDataRange().getValues();
    const headers = existing[0];
    const invIdIdx = headers.indexOf('invoice_id');
    const rowsToDelete = [];
    for (let i = existing.length - 1; i >= 1; i--) {
      if (existing[i][invIdIdx] === data.invoice_id) rowsToDelete.push(i + 1);
    }
    rowsToDelete.forEach(r => mapSheet.deleteRow(r));

    // Insert new mappings
    data.mappings.forEach(m => {
      mapSheet.appendRow([
        generateId_('MAP'),
        data.invoice_id,
        m.shipment_id,
        m.batch_id || '',
        parseFloat(m.allocated_amt_inr) || 0,
        data.allocated_by || 'Accounts',
        new Date().toISOString(),
        m.notes || ''
      ]);
    });

    // Update invoice status
    const allInvData = invSheet.getDataRange().getValues();
    const invHeaders = allInvData[0];
    const invIdColIdx = invHeaders.indexOf('invoice_id');
    const statusColIdx = invHeaders.indexOf('status');
    const totalColIdx = invHeaders.indexOf('total_amount_inr');

    for (let i = 1; i < allInvData.length; i++) {
      if (allInvData[i][invIdColIdx] === data.invoice_id) {
        const totalINR = parseFloat(allInvData[i][totalColIdx]) || 0;
        const allocatedINR = data.mappings.reduce((s, m) => s + (parseFloat(m.allocated_amt_inr) || 0), 0);
        const newStatus = allocatedINR >= totalINR * 0.99 ? 'Fully Allocated' : 'Partially Allocated';
        invSheet.getRange(i + 1, statusColIdx + 1).setValue(newStatus);
        break;
      }
    }

    return successResponse_({ 
      message: `Mapped ${data.mappings.length} shipments to invoice`,
      invoice_id: data.invoice_id
    });

  } catch (e) {
    Logger.log('mapInvoiceToShipments error: ' + e.toString());
    return errorResponse_('Failed to map invoice: ' + e.message);
  }
}

function recalculateFXRates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const paymentsSheet = ss.getSheetByName('Payments');
  const fxSheet = ss.getSheetByName('FXRates');
  if (!paymentsSheet || !fxSheet) return;

  const data = paymentsSheet.getDataRange().getValues();
  if (data.length <= 1) return;

  const headers = data[0];
  const dateIdx     = headers.indexOf('payment_date');
  const inrIdx      = headers.indexOf('amount_inr');
  const foreignIdx  = headers.indexOf('amount_foreign');
  const currencyIdx = headers.indexOf('currency');

  const groups = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const dateVal = row[dateIdx];
    if (!dateVal) continue;
    const date = new Date(dateVal);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const quarter = 'Q' + Math.ceil((date.getMonth() + 1) / 3);
    const currency = row[currencyIdx] || 'RMB';
    const amtINR = parseFloat(row[inrIdx]) || 0;
    const amtForeign = parseFloat(row[foreignIdx]) || 0;
    if (amtINR <= 0 || amtForeign <= 0) continue;

    const mKey = `${year}-${month}_${currency}`;
    if (!groups[mKey]) groups[mKey] = { period: `${year}-${month}`, period_type: 'Monthly', currency, total_inr: 0, total_foreign: 0, count: 0 };
    groups[mKey].total_inr += amtINR;
    groups[mKey].total_foreign += amtForeign;
    groups[mKey].count++;

    const qKey = `${year}-${quarter}_${currency}`;
    if (!groups[qKey]) groups[qKey] = { period: `${year}-${quarter}`, period_type: 'Quarterly', currency, total_inr: 0, total_foreign: 0, count: 0 };
    groups[qKey].total_inr += amtINR;
    groups[qKey].total_foreign += amtForeign;
    groups[qKey].count++;
  }

  fxSheet.clearContents();
  const fxHeaders = ['period','period_type','currency','total_inr','total_foreign','blended_rate','payment_count','last_updated'];
  fxSheet.getRange(1, 1, 1, fxHeaders.length).setValues([fxHeaders]);

  const rows = Object.values(groups).map(g => [
    g.period, g.period_type, g.currency,
    g.total_inr, g.total_foreign,
    g.total_foreign > 0 ? parseFloat((g.total_inr / g.total_foreign).toFixed(4)) : 0,
    g.count, new Date().toISOString()
  ]);

  if (rows.length > 0) {
    fxSheet.getRange(2, 1, rows.length, fxHeaders.length).setValues(rows);
  }
}


function syncShipmentCosting() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const costingSheet = ss.getSheetByName('ShipmentCosting');
  const shipmentsSheet = ss.getSheetByName('Vendor_Shipments');
  const batchesSheet = ss.getSheetByName('Batches');

  if (!costingSheet || !shipmentsSheet || !batchesSheet) {
    Logger.log('Required sheets not found');
    return;
  }

  // Read existing costing rows to avoid duplicates
  const existingData = costingSheet.getDataRange().getValues();
  const existingHeaders = existingData[0];
  const shipmentIdIdx = existingHeaders.indexOf('shipment_id');
  const existingIds = new Set(
    existingData.slice(1).map(r => r[shipmentIdIdx]).filter(Boolean)
  );

  // Read shipments
  const shipData = shipmentsSheet.getDataRange().getValues();
  const shipHeaders = shipData[0];
  const getShip = (row, col) => row[shipHeaders.indexOf(col)] || '';

  // Read batches into lookup
  const batchData = batchesSheet.getDataRange().getValues();
  const batchHeaders = batchData[0];
  const batchLookup = {};
  batchData.slice(1).forEach(row => {
    const id = row[batchHeaders.indexOf('batch_id')];
    if (id) batchLookup[id] = row;
  });
  const getBatch = (batchRow, col) => {
    if (!batchRow) return '';
    return batchRow[batchHeaders.indexOf(col)] || '';
  };

  // Build new rows for shipments not yet in costing sheet
  const newRows = [];
  shipData.slice(1).forEach(row => {
    const shipmentId = getShip(row, 'shipment_id');
    if (!shipmentId || existingIds.has(shipmentId)) return;

    const batchId = getShip(row, 'batch_id');
    const batchRow = batchLookup[batchId];

    const invoiceAmt = parseFloat(getShip(row, 'total_amount')) || 0;
    const fxRate = 0; // to be filled by accounts
    const chargesPct = 0;
    const goodsValue = fxRate > 0 ? invoiceAmt * fxRate : 0;
    const charges = goodsValue * chargesPct / 100;

    newRows.push([
      // Auto-populated
      shipmentId,
      batchId,
      getShip(row, 'vendor_code'),
      getShip(row, 'invoice_qty') || '',
      getShip(row, 'carton_count') || '',
      invoiceAmt,
      getShip(row, 'currency') || 'RMB',
      getBatch(batchRow, 'batch_type'),
      getBatch(batchRow, 'status'),
      getBatch(batchRow, 'expected_delivery'),
      getBatch(batchRow, 'carrier'),
      getBatch(batchRow, 'tracking_number'),
      // Manual — blank for accounts team
      '', '', '', '', '', '', '', '', '', '',
      'Unpaid', '', '',
      // Calculated
      goodsValue, charges, 0, 0, 0,
      new Date().toISOString()
    ]);
  });

  if (newRows.length > 0) {
    costingSheet.getRange(
      costingSheet.getLastRow() + 1, 1,
      newRows.length, newRows[0].length
    ).setValues(newRows);
    Logger.log(`Added ${newRows.length} new shipments to ShipmentCosting`);
  } else {
    Logger.log('No new shipments to add');
  }
}



function getShipmentCosting(data) {
  try {
    const rows = getSheetData_('ShipmentCosting');
    
    // Recalculate derived fields on read
    const enriched = rows.map(r => {
      const invoiceAmt = parseFloat(r.invoice_amt) || 0;
      const fxRate     = parseFloat(r.fx_rate) || 0;
      const chargesPct = parseFloat(r.charges_pct) || 0;
      const shipping   = parseFloat(r.shipping_charges) || 0;
      const igst       = parseFloat(r.igst) || 0;
      const localFrt   = parseFloat(r.local_freight) || 0;
      const clearance  = parseFloat(r.clearance) || 0;
      const freight    = parseFloat(r.freight_charges) || 0;
      const other      = parseFloat(r.other_charges) || 0;

      const goodsValue    = fxRate > 0 ? invoiceAmt * fxRate : 0;
      const charges       = goodsValue * chargesPct / 100;
      const taxableAmt    = goodsValue + charges + shipping;
      const totalAfterTax = taxableAmt + igst;
      const finalTotal    = totalAfterTax + localFrt + clearance + freight + other;

      return {
        ...r,
        goods_value: Math.round(goodsValue),
        charges: Math.round(charges),
        taxable_amount: Math.round(taxableAmt),
        total_after_tax: Math.round(totalAfterTax),
        final_total: Math.round(finalTotal)
      };
    });

    // Filter by batch if requested
    const filtered = data.batch_id
      ? enriched.filter(r => r.batch_id === data.batch_id)
      : enriched;

    return { status: 'success', shipments: filtered };
  } catch(e) {
    return { status: 'error', message: e.message };
  }
}

function updateShipmentCosting(data) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('ShipmentCosting');
    if (!sheet) return { status: 'error', message: 'ShipmentCosting sheet not found' };

    const allData = sheet.getDataRange().getValues();
    const headers = allData[0];
    const idIdx = headers.indexOf('shipment_id');

    const editableFields = [
      'fx_rate', 'charges_pct', 'other_charges', 'local_freight',
      'clearance', 'freight_charges', 'shipping_charges',
      'igst', 'billed_amount', 'bill_no',
      'payment_status', 'payment_date', 'remarks'
    ];

    for (let i = 1; i < allData.length; i++) {
      if (allData[i][idIdx] === data.shipment_id) {
        editableFields.forEach(field => {
          const colIdx = headers.indexOf(field);
          if (colIdx >= 0 && data[field] !== undefined) {
            sheet.getRange(i + 1, colIdx + 1).setValue(data[field]);
          }
        });
        return { status: 'success', message: 'Shipment costing updated' };
      }
    }
    return { status: 'error', message: 'Shipment not found: ' + data.shipment_id };
  } catch(e) {
    return { status: 'error', message: e.message };
  }
}

function syncShipmentCostingApi() {
  try {
    syncShipmentCosting();
    return { status: 'success', message: 'Sync complete' };
  } catch(e) {
    return { status: 'error', message: e.message };
  }
}

// Fix for missing update_shipment_finance action
function updateShipmentFinance(data) {
  try {
    if (getUserRole_(data.user_email) !== 'ADMIN') {
      return { status: 'error', message: 'Admin access required to edit shipment finance.' };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Vendor_Shipments');
    if (!sheet) return { status: 'error', message: 'Vendor_Shipments sheet not found' };

    const allData = sheet.getDataRange().getValues();
    const headers = allData[0];
    const idIdx = headers.indexOf('shipment_id');

    const editableFields = ['invoice_no', 'total_amount', 'currency', 'remarks'];

    for (let i = 1; i < allData.length; i++) {
      if (allData[i][idIdx] === data.shipment_id) {
        editableFields.forEach(field => {
          const colIdx = headers.indexOf(field);
          if (colIdx >= 0 && data[field] !== undefined) {
            sheet.getRange(i + 1, colIdx + 1).setValue(data[field]);
          }
        });
        invalidateSheetCache_('Vendor_Shipments');
        return { status: 'success', message: 'Shipment finance updated' };
      }
    }
    return { status: 'error', message: 'Shipment not found: ' + data.shipment_id };
  } catch(e) {
    return { status: 'error', message: e.message };
  }
}
