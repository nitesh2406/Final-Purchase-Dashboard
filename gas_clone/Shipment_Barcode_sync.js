// =================================================================================
// SHIPMENT BARCODE SYNC
// Serves Batches, Vendor_Shipments, Vendor_Shipment_Lines to the barcode BFF.
// Also receives scanned_quantity write-backs from the barcode app.
//
// Called via doPost in 0_entry_points.gs:
//   action: 'sync_shipment_data'        → apiGetShipmentSyncData()
//   action: 'update_scanned_quantities' → apiUpdateScannedQuantities(payload)
// =================================================================================

var SHIPMENT_SYNC_SHEETS = {
  batches:   'Batches',
  shipments: 'Vendor_Shipments',
  lines:     'Vendor_Shipment_Lines',
};

/**
 * Returns shipment tables for syncing to Supabase.
 * Response: { success: true, batches: [...], shipments: [...], lines: [...] }
 *
 * payload.sheet ('batches' | 'shipments' | 'lines') optionally limits the read
 * to just one sheet — the other two arrays come back empty. This lets the
 * barcode app sync one sheet per request (each request runs under a Vercel
 * function timeout, and Vendor_Shipment_Lines alone can be 600+ rows).
 * Omit payload.sheet for the legacy all-three-at-once behavior.
 *
 * scanned_qty is deliberately excluded from lines — it is owned by the app
 * and must never be overwritten by a sheet fetch.
 */
function apiGetShipmentSyncData(payload) {
  var sheet = payload && payload.sheet;

  var batches   = (!sheet || sheet === 'batches')   ? readShipmentSheet_(SHIPMENT_SYNC_SHEETS.batches)   : [];
  var shipments = (!sheet || sheet === 'shipments') ? readShipmentSheet_(SHIPMENT_SYNC_SHEETS.shipments) : [];
  var rawLines  = (!sheet || sheet === 'lines')     ? readShipmentSheet_(SHIPMENT_SYNC_SHEETS.lines)     : [];

  // Strip scanned_qty and line_id — line_id is generated server-side as {shipment_id}::{sku}
  // to guarantee it always matches existing Supabase rows (prevents duplicate inserts).
  var lines = rawLines.map(function(row) {
    var clean = {};
    for (var key in row) {
      if (key !== 'scanned_qty' && key !== 'scanned_quantity' && key !== 'line_id') {
        clean[key] = row[key];
      }
    }
    return clean;
  });

  return { success: true, batches: batches, shipments: shipments, lines: lines };
}

/**
 * Writes scanned_quantity back to Vendor_Shipment_Lines by matching line_id.
 * Payload: { updates: [{ shipment_id: string, sku: string, scanned_quantity: number }] }
 * Response: { success: true, updated: number }
 */
function apiUpdateScannedQuantities(payload) {
  var updates = payload.updates || [];
  if (!updates.length) return { success: true, updated: 0 };

  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHIPMENT_SYNC_SHEETS.lines);
  if (!sheet) throw new Error('Sheet not found: ' + SHIPMENT_SYNC_SHEETS.lines);

  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).trim(); });

  var lineIdCol     = headers.indexOf('line_id');
  var shipmentIdCol = headers.indexOf('shipment_id');
  var skuCol        = headers.indexOf('sku');
  var scannedQtyCol = headers.indexOf('scanned_qty');

  if (scannedQtyCol === -1) throw new Error('scanned_qty column not found in ' + SHIPMENT_SYNC_SHEETS.lines);

  // Build lookup: line_id → scanned_quantity (primary), fallback: shipment_id||sku → scanned_quantity
  var byLineId = {};
  var byShipmentSku = {};
  for (var i = 0; i < updates.length; i++) {
    var u = updates[i];
    // The line_id stored in Supabase is what was in the sheet's line_id column (or shipment_id::sku fallback)
    // We match on shipment_id + sku since that's what we stored in the update payload
    var fallbackKey = String(u.shipment_id).trim() + '||' + String(u.sku).trim();
    byShipmentSku[fallbackKey] = u.scanned_quantity;
  }

  var updated = 0;
  for (var row = 1; row < data.length; row++) {
    var matched = false;
    if (shipmentIdCol !== -1 && skuCol !== -1) {
      var rowShipmentId = String(data[row][shipmentIdCol]).trim();
      var rowSku        = String(data[row][skuCol]).trim();
      var fallbackKey   = rowShipmentId + '||' + rowSku;
      if (byShipmentSku.hasOwnProperty(fallbackKey)) {
        sheet.getRange(row + 1, scannedQtyCol + 1).setValue(byShipmentSku[fallbackKey]);
        updated++;
        matched = true;
      }
    }
  }

  SpreadsheetApp.flush();
  return { success: true, updated: updated };
}

/**
 * Reads a named sheet as an array of plain objects keyed by header row.
 * Skips rows where every cell is empty.
 */
function readShipmentSheet_(sheetName) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    Logger.log('readShipmentSheet_: sheet not found: ' + sheetName);
    return [];
  }
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  // Normalize headers to lowercase snake_case so server-side keys match regardless of sheet formatting
  var headers = values[0].map(function(h) {
    return String(h).trim().toLowerCase().replace(/\s+/g, '_');
  });
  var rows    = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var hasData = row.some(function(cell) { return cell !== '' && cell !== null && cell !== undefined; });
    if (!hasData) continue;
    var obj = {};
    headers.forEach(function(h, idx) { obj[h] = row[idx]; });
    rows.push(obj);
  }

  return rows;
}
