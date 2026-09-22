// =================================================================================
// INVENTORY TAB — valuation snapshot + the 'Inventory Data' sheet sync helpers
// =================================================================================
//
// Two halves that belong together:
//
//  1. READ SIDE (apiGetInventoryValuation_): the Inventory tab used to re-read
//     'Inventory Data' and 'EE Product Master' in full and join them on every
//     page load (~5s, occasionally 25s+; getSheetData_ can't cache sheets this
//     size). The joined result is now a Drive-backed snapshot, rebuilt at the
//     end of each inventory sync, and served as-is — with the timestamps of
//     the data it holds, so the screen can say how fresh it really is.
//
//  2. WRITE SIDE (commitInventoryDataSheet_ / finalizeInventorySync_): the
//     sync used to clear 'Inventory Data', write the EasyEcom rows, THEN fetch
//     Amazon (paged, with sleeps — minutes) and append its rows. For that whole
//     stretch every reader (this tab, and the Amazon forecast, whose 30-minute
//     cache could snapshot it) saw no Amazon stock; and if the Amazon fetch
//     failed the sheet stayed EasyEcom-only with no error. The sync now
//     assembles both halves first, then overwrites the sheet in place.

const INVENTORY_VALUATION_CACHE_PROP_KEY = 'INVENTORY_VALUATION_CACHE_FILE_ID';
const INVENTORY_VALUATION_CACHE_FILENAME = 'inventory_valuation_cache.json';

// Script Properties written by the sync, echoed back in the snapshot.
const INVENTORY_SYNCED_AT_PROP        = 'INVENTORY_SYNCED_AT';
const INVENTORY_AMAZON_SYNCED_AT_PROP = 'INVENTORY_AMAZON_SYNCED_AT';
const INVENTORY_SYNC_WARNING_PROP     = 'INVENTORY_SYNC_WARNING';

const INVENTORY_DATA_SHEET = 'Inventory Data';
const INVENTORY_DATA_HEADERS_ = [
  'Channel Name',
  'Channel Item Code',
  'Channel SKU',
  'Master SKU',
  'InStock (Fulfillable)',
  'Reserved (Total)',
  'Inbound (Shipped)',
  'Inbound (Pending)',
  'XQJX',
  'Strict (Pending)'
];

// ─────────────────────────────────────────────────────────────
// READ SIDE
// ─────────────────────────────────────────────────────────────

/**
 * Per-SKU-per-channel inventory rows joined with EE Product Master fields,
 * for the Inventory tab's client-side aggregation/filtering/sorting.
 * SKUs with no Product Master match are still returned — name/brand/
 * category/cost_inr/cost_rmb come back null — so a mapping gap stays visible
 * instead of silently vanishing from totals.
 *
 * Throws if either sheet is empty: that only happens while a sync is mid-write
 * (or a sheet was wiped), and serving "zero inventory" as a success would be
 * cached by the browser and read as a real number.
 */
function buildInventoryValuationRecords_() {
  var inventoryRows = getSheetData_(INVENTORY_DATA_SHEET);
  var productRows = getSheetData_('EE Product Master');

  if (!inventoryRows.length || !productRows.length) {
    throw new Error('Inventory data is being refreshed — please try again in a minute.');
  }

  var productBySku = {};
  productRows.forEach(function (p) {
    var sku = String(p['SKU'] || '').trim();
    if (sku) productBySku[sku] = p;
  });

  var toNumberOrNull = function (raw) {
    return (raw === null || raw === undefined || raw === '' || isNaN(Number(raw))) ? null : Number(raw);
  };

  return inventoryRows
    .map(function (row) {
      var sku = String(row['Master SKU'] || '').trim();
      var product = productBySku[sku] || null;

      return {
        sku: sku,
        name: product ? (String(product['Product Name'] || '').trim() || null) : null,
        brand: product ? (String(product['Brand'] || '').trim() || null) : null,
        category: product ? (String(product['Category Name'] || '').trim() || null) : null,
        channel: String(row['Channel Name'] || '').trim(),
        in_stock: Number(row['InStock (Fulfillable)']) || 0,
        inbound: Number(row['Inbound (Shipped)']) || 0,
        cost_inr: toNumberOrNull(product ? product['Cost'] : null),
        cost_rmb: toNumberOrNull(product ? product['RMB_Price'] : null)
      };
    })
    .filter(function (r) { return r.sku; });
}

// The snapshot: the joined records plus when the data behind them was synced.
//   generatedAt    — when this snapshot was built
//   syncedAt       — when the sync last committed the sheet
//   amazonSyncedAt — when Amazon rows were last actually fetched (older than
//                    syncedAt if the latest Amazon fetch failed and the
//                    previous rows were carried over)
//   warning        — non-empty when the latest sync was degraded
function buildInventorySnapshot_(records) {
  var props = PropertiesService.getScriptProperties();
  return {
    generatedAt: new Date().toISOString(),
    syncedAt: props.getProperty(INVENTORY_SYNCED_AT_PROP) || null,
    amazonSyncedAt: props.getProperty(INVENTORY_AMAZON_SYNCED_AT_PROP) || null,
    warning: props.getProperty(INVENTORY_SYNC_WARNING_PROP) || '',
    records: records
  };
}

// Rebuilds and stores the snapshot. Called at the end of every inventory sync;
// never throws (a failure here must not fail the sync that called it).
function refreshInventoryValuationSnapshot_() {
  try {
    // Both sheets were just rewritten — drop any CacheService copy of them.
    invalidateSheetCache_(INVENTORY_DATA_SHEET);
    invalidateSheetCache_('EE Product Master');
    var snapshot = buildInventorySnapshot_(buildInventoryValuationRecords_());
    writeDriveJsonCache_(INVENTORY_VALUATION_CACHE_PROP_KEY, INVENTORY_VALUATION_CACHE_FILENAME, snapshot);
    Logger.log('refreshInventoryValuationSnapshot_: cached ' + snapshot.records.length + ' rows');
    return snapshot;
  } catch (err) {
    Logger.log('refreshInventoryValuationSnapshot_ error: ' + err.message);
    return null;
  }
}

/**
 * action: 'get_inventory_valuation'
 * Payload: { force?: boolean } — true skips the snapshot and joins the sheets
 * live (the tab's Refresh button); the fresh result also replaces the snapshot.
 * With no snapshot yet (first ever call) it computes live the same way.
 */
function apiGetInventoryValuation_(payload) {
  var force = !!(payload && payload.force);

  if (!force) {
    var cached = readDriveJsonCache_(INVENTORY_VALUATION_CACHE_PROP_KEY, function (s) { return Array.isArray(s.records); });
    if (cached) {
      return successResponse_({
        records: cached.records,
        generatedAt: cached.generatedAt || null,
        syncedAt: cached.syncedAt || null,
        amazonSyncedAt: cached.amazonSyncedAt || null,
        warning: cached.warning || '',
        source: 'snapshot'
      });
    }
  }

  try {
    invalidateSheetCache_(INVENTORY_DATA_SHEET);
    invalidateSheetCache_('EE Product Master');
    var snapshot = buildInventorySnapshot_(buildInventoryValuationRecords_());
    try {
      writeDriveJsonCache_(INVENTORY_VALUATION_CACHE_PROP_KEY, INVENTORY_VALUATION_CACHE_FILENAME, snapshot);
    } catch (cacheErr) {
      Logger.log('apiGetInventoryValuation_: could not store snapshot: ' + cacheErr.message);
    }
    return successResponse_({
      records: snapshot.records,
      generatedAt: snapshot.generatedAt,
      syncedAt: snapshot.syncedAt,
      amazonSyncedAt: snapshot.amazonSyncedAt,
      warning: snapshot.warning,
      source: 'live'
    });
  } catch (err) {
    Logger.log('apiGetInventoryValuation_ error: ' + err.message);
    return errorResponse_(err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// WRITE SIDE — used by fetch_all_inventory / runAllUpdates (master_code.js)
// ─────────────────────────────────────────────────────────────

// The Amazon rows currently in the sheet — used to carry them over when the
// latest Amazon fetch failed, so EasyEcom stock can still refresh without the
// Amazon side dropping to zero.
function readExistingAmazonInventoryRows_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(INVENTORY_DATA_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var width = INVENTORY_DATA_HEADERS_.length;
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues()
    .filter(function (r) { return String(r[0]).trim() === 'AMAZON'; });
}

// Overwrites 'Inventory Data' with headers + eeRows + amazonRows IN PLACE (one
// setValues over the top of the old content, then the leftover old rows/columns
// are cleared). The sheet is never blank in between, unlike clearContents()
// followed by a later write.
function commitInventoryDataSheet_(eeRows, amazonRows) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('commitInventoryDataSheet_: could not get the script lock');
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(INVENTORY_DATA_SHEET);
    if (!sheet) throw new Error('Sheet "' + INVENTORY_DATA_SHEET + '" not found');

    var filter = sheet.getFilter();
    if (filter !== null) filter.remove();

    var all = [INVENTORY_DATA_HEADERS_].concat(eeRows, amazonRows);
    var width = INVENTORY_DATA_HEADERS_.length;
    var prevLastRow = sheet.getLastRow();
    var prevLastCol = sheet.getLastColumn();

    if (sheet.getMaxRows() < all.length) {
      sheet.insertRowsAfter(sheet.getMaxRows(), all.length - sheet.getMaxRows());
    }
    sheet.getRange(1, 1, all.length, width).setValues(all);

    // Old content below the new data, and anything to the right of the 10 columns.
    if (prevLastRow > all.length) {
      sheet.getRange(all.length + 1, 1, prevLastRow - all.length, Math.max(prevLastCol, width)).clearContent();
    }
    if (prevLastCol > width) {
      sheet.getRange(1, width + 1, Math.min(prevLastRow, all.length), prevLastCol - width).clearContent();
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

function setInventorySyncMeta_(amazonFresh, warning) {
  var props = PropertiesService.getScriptProperties();
  var now = new Date().toISOString();
  var values = {};
  values[INVENTORY_SYNCED_AT_PROP] = now;
  values[INVENTORY_SYNC_WARNING_PROP] = warning || '';
  if (amazonFresh) values[INVENTORY_AMAZON_SYNCED_AT_PROP] = now;
  props.setProperties(values);
}

/**
 * Final step of both inventory orchestrators. Commits the sheet, records when,
 * then rebuilds the Inventory tab's snapshot. Never throws — it runs in a
 * `finally`, and must neither mask the error that got it there nor fail an
 * otherwise-good sync.
 *
 *  - eeRows empty (EasyEcom returned nothing): the sheet is left exactly as it
 *    was — overwriting good data with an empty EasyEcom side would be worse.
 *  - amazonRows empty/null (Amazon fetch failed or returned nothing): the
 *    previous Amazon rows are carried over and the snapshot is flagged with a
 *    warning, instead of silently dropping Amazon stock to zero.
 */
function finalizeInventorySync_(eeRows, amazonRows) {
  try {
    if (!eeRows || !eeRows.length) {
      Logger.log('finalizeInventorySync_: EasyEcom produced no inventory rows — sheet left unchanged.');
      // Only the warning is recorded: nothing was synced, so syncedAt must NOT
      // advance (that would make old data look current).
      PropertiesService.getScriptProperties().setProperty(INVENTORY_SYNC_WARNING_PROP,
        'The latest sync got no EasyEcom inventory; figures are from the previous sync.');
      refreshInventoryValuationSnapshot_();
      return;
    }

    var amazonFresh = !!(amazonRows && amazonRows.length);
    var warning = '';
    if (!amazonFresh) {
      amazonRows = readExistingAmazonInventoryRows_();
      warning = 'Amazon inventory could not be refreshed in the latest sync; Amazon figures are from the previous sync.';
      Logger.log('finalizeInventorySync_: ' + warning + ' (carrying over ' + amazonRows.length + ' rows)');
    }

    commitInventoryDataSheet_(eeRows, amazonRows);
    setInventorySyncMeta_(amazonFresh, warning);
    refreshInventoryValuationSnapshot_();
  } catch (err) {
    Logger.log('finalizeInventorySync_ error: ' + err.message + '\n' + err.stack);
  }
}
