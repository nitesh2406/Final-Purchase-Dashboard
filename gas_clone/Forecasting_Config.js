

// ═══════════════════════════════════════════════════════════════════════════════
// ForecastingConfig.gs
// Manages the Forecasting_Config sheet for reading/saving all forecast settings.
// Called by doGet (for forecast runs) and doPost (for Settings UI save/load).
//
// Sheet structure (Forecasting_Config):
//   Column A: setting_key  (e.g. "SEA_TRANSIT_DAYS")
//   Column B: value        (e.g. "60")
//   Column C: description  (e.g. "Days added on top of Lead_Time for SEA mode")
//   Column D: default_value (e.g. "60")
// ═══════════════════════════════════════════════════════════════════════════════

const FORECASTING_CONFIG_SHEET = 'Forecasting_Config';

// ─── Default values (mirrors current hardcoded CONFIG) ───────────────────────
// These are used:
//   1. To seed the sheet if it doesn't exist yet
//   2. As fallback if a key is missing from the sheet
const FORECASTING_DEFAULTS = {
  // Transit & Lead Times
  SEA_TRANSIT_DAYS:        { value: 60,   description: 'Days added on top of Lead_Time from EE Product Master for SEA mode orders' },
  AIR_TRANSIT_DAYS:        { value: 20,   description: 'Total lead time for AIR mode (production + air freight). Used as full lead time.' },
  PROTECTION_DAYS_B2B_SEA: { value: 20,   description: 'Multiplied with B2B safety stock for SEA. Adds cover for intermittent bulk orders.' },
  PROTECTION_DAYS_B2B_AIR: { value: 10,   description: 'Multiplied with B2B safety stock for AIR. Reserved for future AIR B2B logic.' },
  // Buffer & Cover
  BUFFER_SEA:              { value: 45,   description: 'Minimum days of cover required when a SEA shipment arrives. Drives target stock.' },
  BUFFER_AIR:              { value: 30,   description: 'Minimum days of cover required when an AIR shipment arrives.' },
  FREQUENCY_SEA:           { value: 15,   description: 'How often SEA orders are placed (days). Extra inventory = ADS × this value.' },
  FREQUENCY_AIR:           { value: 7,    description: 'How often AIR orders are placed (days). Extra inventory = ADS × this value.' },
  // Demand Calculation
  SALES_HISTORY_DAYS:      { value: 90,   description: 'How many days back to look in Sales Data when computing ADS.' },
  ADS_WEIGHT_15D:          { value: 0.40, description: 'ADS weight for last 15 days. All 4 weights must sum to 1.00.' },
  ADS_WEIGHT_30D:          { value: 0.30, description: 'ADS weight for last 30 days.' },
  ADS_WEIGHT_60D:          { value: 0.20, description: 'ADS weight for 30–60 day window.' },
  ADS_WEIGHT_90D:          { value: 0.10, description: 'ADS weight for 60–90 day window.' },
  LOW_VELOCITY_FLOOR:      { value: 0.3,  description: 'Minimum ADS for slow movers. Prevents near-zero reorder quantities. ~9 units/month.' },
  B2B_MULTIPLIER:          { value: 1.2,  description: 'B2B ADS multiplier. Applied before adding B2B to total ADS. Compounded with safety stock.' },
  SERVICE_LEVEL_Z:         { value: 1.65, description: 'Z-score for B2C safety stock. 1.65=95%, 1.96=97.5%, 2.33=99%.' },
  // SKU Routing
  MIN_COST_AIR:            { value: 500,  description: 'SKUs with Cost > this value are routed to AIR mode.' },
  
  LOW_MMA_AIR:             { value: 10,   description: 'SKUs with Monthly Moving Average < this value are routed to AIR regardless of cost.' },
  // Bulk Orders
  BULK_PERCENTILE: { value: 75, description: 'Percentile of BULK channel order sizes used for safety stock buffer. 75 = covers 75% of typical BULK orders. Outliers (>mean+2σ) auto-excluded.' },
  PENDING_PIPELINE_SOURCE: { value: 'po_lines', description: "Source for pending pipeline data. 'ee_po' | 'po_lines' | 'both'" },
  LOW_VELOCITY_COST_THRESHOLD: { value: 150, description: 'RMB price threshold above which LOW_VELOCITY_FLOOR is not applied. Expensive slow-movers get true ADS instead of floored value.' },

};

// ─── getConfig() ──────────────────────────────────────────────────────────────
// Returns a config object with all values. Called at the top of runFullForecast().
// Falls back to FORECASTING_DEFAULTS for any missing key.
// Seeds the sheet automatically on first run if it doesn't exist.
function getConfig() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(FORECASTING_CONFIG_SHEET);

    // Auto-create and seed sheet if it doesn't exist
    if (!sheet) {
      sheet = seedConfigSheet_(ss);
    }

    const data = sheet.getDataRange().getValues();
    const config = {};

    // Start from row 2 (skip header)
    /*for (let i = 1; i < data.length; i++) {
      const key   = String(data[i][0]).trim();
      const value = data[i][1];
      if (!key) continue;
      // Parse numeric values — all forecast config values are numbers
      const parsed = parseFloat(value);
      config[key] = isNaN(parsed) ? value : parsed;
    } */
    // REPLACE WITH:
for (let i = 1; i < data.length; i++) {
  const key   = String(data[i][0]).trim();
  const value = data[i][1];
  if (!key) continue;
  // Try numeric parse — if NaN keep as string (handles text values like 'ee_po')
  const strVal = String(value).trim();
  const parsed = parseFloat(strVal);
  config[key] = isNaN(parsed) ? strVal : parsed;
}

    // Fill in any missing keys with defaults (for forward compatibility)
    Object.keys(FORECASTING_DEFAULTS).forEach(key => {
      if (config[key] === undefined) {
        config[key] = FORECASTING_DEFAULTS[key].value;
      }
    });

    return config;

  } catch (e) {
    Logger.log('getConfig() error: ' + e.message + '. Using defaults.');
    // Return pure defaults if anything goes wrong — forecast must not fail
    const defaults = {};
    Object.keys(FORECASTING_DEFAULTS).forEach(key => {
      defaults[key] = FORECASTING_DEFAULTS[key].value;
    });
    return defaults;
  }
}

// ─── apiGetForecastingConfig() ────────────────────────────────────────────────
// Called from doPost when action = 'get_forecasting_config'
// Returns the full config to the Settings UI
function apiGetForecastingConfig() {
  try {
    const config = getConfig();
    return ContentService.createTextOutput(
      JSON.stringify({ success: true, config: config })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(
      JSON.stringify({ error: e.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── apiSaveForecastingConfig() ───────────────────────────────────────────────
// Called from doPost when action = 'save_forecasting_config'
// Receives a partial config object (only the section being saved) and updates
// those specific rows in the sheet. Other rows are left untouched.
function apiSaveForecastingConfig(payload) {
  try {
    if (!payload || !payload.config) {
      throw new Error('Missing config payload');
    }

    const updates = payload.config; // Partial — only one section's keys
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(FORECASTING_CONFIG_SHEET);

    if (!sheet) {
      sheet = seedConfigSheet_(ss);
    }

    const data = sheet.getDataRange().getValues();

    // Build a map of key → row index (1-based)
    const keyToRow = {};
    for (let i = 1; i < data.length; i++) {
      const key = String(data[i][0]).trim();
      if (key) keyToRow[key] = i + 1; // +1 for 1-based sheet row
    }

    // Update each key in the payload
    const updated = [];
    const skipped = [];

    Object.keys(updates).forEach(key => {
      if (keyToRow[key] !== undefined) {
        sheet.getRange(keyToRow[key], 2).setValue(updates[key]); // Column B = value
        updated.push(key);
      } else {
        // Key doesn't exist yet — append a new row
        const defaultEntry = FORECASTING_DEFAULTS[key];
        sheet.appendRow([
          key,
          updates[key],
          defaultEntry ? defaultEntry.description : '',
          defaultEntry ? defaultEntry.value : updates[key],
        ]);
        updated.push(key + ' (new)');
      }
    });

    // Flush all writes
    SpreadsheetApp.flush();

    Logger.log('Forecasting config saved. Updated: ' + updated.join(', '));

    return ContentService.createTextOutput(
      JSON.stringify({
        success: true,
        updated: updated,
        skipped: skipped,
        message: `Saved ${updated.length} setting(s) to ${FORECASTING_CONFIG_SHEET}`
      })
    ).setMimeType(ContentService.MimeType.JSON);

  } catch (e) {
    Logger.log('apiSaveForecastingConfig error: ' + e.message);
    return ContentService.createTextOutput(
      JSON.stringify({ error: e.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── seedConfigSheet_() ───────────────────────────────────────────────────────
// Creates the Forecasting_Config sheet and populates it with all defaults.
// Called automatically if the sheet doesn't exist.
function seedConfigSheet_(ss) {
  Logger.log('Creating Forecasting_Config sheet with defaults...');
  const sheet = ss.insertSheet(FORECASTING_CONFIG_SHEET);

  // Header row
  const header = ['setting_key', 'value', 'description', 'default_value'];
  sheet.getRange(1, 1, 1, 4).setValues([header]);

  // Style header
  const headerRange = sheet.getRange(1, 1, 1, 4);
  headerRange.setBackground('#1e293b');
  headerRange.setFontColor('#94a3b8');
  headerRange.setFontWeight('bold');
  headerRange.setFontSize(10);

  // Data rows
  const rows = Object.keys(FORECASTING_DEFAULTS).map(key => [
    key,
    FORECASTING_DEFAULTS[key].value,
    FORECASTING_DEFAULTS[key].description,
    FORECASTING_DEFAULTS[key].value,
  ]);
  sheet.getRange(2, 1, rows.length, 4).setValues(rows);

  // Column widths
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 100);
  sheet.setColumnWidth(3, 450);
  sheet.setColumnWidth(4, 100);

  // Style value column — make it easy to spot
  sheet.getRange(2, 2, rows.length, 1).setFontWeight('bold').setFontColor('#3b82f6');

  // Freeze header
  sheet.setFrozenRows(1);

  Logger.log('Forecasting_Config sheet created with ' + rows.length + ' settings.');
  return sheet;
}

// ─── Usage in InventoryForecasting.gs ─────────────────────────────────────────
// Replace the hardcoded CONFIG = { ... } block with:
//
//   const CONFIG = getConfig();
//
// That single line loads everything from the sheet.
// All CONFIG.SEA_TRANSIT_DAYS, CONFIG.BUFFER_SEA etc. references stay the same.

function testForecastingConfig() {
  const result = apiGetForecastingConfig();
  Logger.log(result.getContent());
}

function testConfigAfterFix() {
  clearCache();
  const CONFIG = getConfig();
  Logger.log('PENDING_PIPELINE_SOURCE: [' + CONFIG.PENDING_PIPELINE_SOURCE + ']');
  Logger.log('Type: ' + typeof CONFIG.PENDING_PIPELINE_SOURCE);
}

const CUSTOMIZATION_ROOT_FOLDER_ID = '1PAXYpSjFktLfL9ob9Vb6s2x3ehdbq-LM';

function syncCustomizationDriveLinks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('SKU_Customization_Master');
  if (!sheet) {
    Logger.log('SKU_Customization_Master sheet not found');
    return;
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  // Find or create columns
  let skuCol = headers.indexOf('sku');
  let filesCol = headers.indexOf('customization_files');
  let updatedCol = headers.indexOf('last_updated');

  if (filesCol === -1) {
    filesCol = headers.length;
    sheet.getRange(1, filesCol + 1).setValue('customization_files');
    headers.push('customization_files');
  }
  if (updatedCol === -1) {
    updatedCol = headers.length;
    sheet.getRange(1, updatedCol + 1).setValue('last_updated');
    headers.push('last_updated');
  }

  if (skuCol === -1) {
    Logger.log('No sku column found in SKU_Customization_Master');
    return;
  }

  // Build set of SKUs already in sheet
  const existingSkus = new Map(); // sku → row index (1-based)
  for (let i = 1; i < data.length; i++) {
    const sku = String(data[i][skuCol] || '').trim();
    if (sku) existingSkus.set(sku, i + 1);
  }

  // Get root folder
  const rootFolder = DriveApp.getFolderById(CUSTOMIZATION_ROOT_FOLDER_ID);
  const subfolders = rootFolder.getFolders();

  let updated = 0;
  let added = 0;
  let errors = 0;

  while (subfolders.hasNext()) {
    const folder = subfolders.next();
    const sku = folder.getName().trim();
    if (!sku) continue;

    try {
      const folderUrl = folder.getUrl();
      const lastUpdated = getLastUpdatedFromFiles(folder);

      if (existingSkus.has(sku)) {
        // Update existing row
        const rowIndex = existingSkus.get(sku);
        sheet.getRange(rowIndex, filesCol + 1).setValue(folderUrl);
        sheet.getRange(rowIndex, updatedCol + 1).setValue(lastUpdated || '');
        updated++;

      } else {
        // Build new row — fill known columns, leave others blank
        const newRow = new Array(headers.length).fill('');
        newRow[skuCol] = sku;
        newRow[filesCol] = folderUrl;
        newRow[updatedCol] = lastUpdated || '';
        sheet.appendRow(newRow);
        added++;
      }

    } catch (err) {
      Logger.log('Error for SKU folder [' + sku + ']: ' + err.message);
      errors++;
    }
  }

  SpreadsheetApp.flush();
  Logger.log(
    'syncCustomizationDriveLinks complete.' +
    ' Updated: ' + updated +
    ' | Added: ' + added +
    ' | Errors: ' + errors
  );
}

// Your existing function — keep as is
function getLastUpdatedFromFiles(folder) {
  let lastUpdated = null;
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const updated = file.getLastUpdated();
    if (!lastUpdated || updated > lastUpdated) {
      lastUpdated = updated;
    }
  }
  return lastUpdated;
}

// Test function
function testSyncCustomizationDriveLinks() {
  syncCustomizationDriveLinks();
}

function apiVerifyUser(payload) {
  const email = (payload.email || '').toLowerCase().trim();

  if (!email) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: 'Email is required'
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    const usersData = getSheetData(SHEETS.users);

    for (const row of usersData) {
      if (!ArrayOfRow(row)) continue;

      const rowEmail = (getValue(row, SHEETS.users, 'email') || '')
        .toLowerCase().trim();

      if (rowEmail !== email) continue;

      const isActive = getValue(row, SHEETS.users, 'is_active');
      const isActiveVal = String(isActive).toUpperCase();

      // Check if active
      if (isActiveVal !== 'TRUE') {
        return ContentService
          .createTextOutput(JSON.stringify({
            success: false,
            error: 'Account is inactive. Contact admin.'
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      const name = getValue(row, SHEETS.users, 'name') || email;
      const role = getValue(row, SHEETS.users, 'role') || 'viewer';
      const allowedTabsRaw = getValue(row, SHEETS.users, 'allowed_tabs') || '';

      // Build allowed tabs array
      let allowedTabs = [];
      if (allowedTabsRaw.trim().toLowerCase() === 'all') {
        allowedTabs = [
          'forecasting',
          'drafts',
          'purchase_orders',
          'shipments',
          'finance',
          'settings'
        ];
      } else {
        allowedTabs = allowedTabsRaw
          .split(',')
          .map(t => t.trim().toLowerCase())
          .filter(t => t.length > 0);
      }

      Logger.log('User verified: ' + email + ' | role: ' + role);

      return ContentService
        .createTextOutput(JSON.stringify({
          success: true,
          user: {
            email: email,
            name: name,
            role: role,
            allowedTabs: allowedTabs
          }
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Email not found in sheet
    Logger.log('Access denied for: ' + email);
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: 'Access denied. Your email is not authorised.'
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('apiVerifyUser error: ' + err.message);
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: 'Server error: ' + err.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function testVerifyUserNitesh() {
  clearCache();
  const result = apiVerifyUser({ email: 'nitesh@cubelelo.com' });
  Logger.log(result.getContent());
}

function bulkImportPendingPipeline() {
  clearCache();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const today = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd');

  // ── Read source data ──────────────────────────────────────
  const sourceSheet = ss.getSheetByName('PendingPipeline');
  if (!sourceSheet) {
    Logger.log('ERROR: PendingPipeline sheet not found');
    return;
  }

  const sourceData = sourceSheet.getDataRange().getValues();
  const headers = sourceData[0];

  // Map headers
  const col = {};
  headers.forEach((h, i) => { col[String(h).trim()] = i; });

  // ── Group by vendor + mode ────────────────────────────────
  const groups = new Map(); // 'PW_AIR' → [rows]

  for (let i = 1; i < sourceData.length; i++) {
    const row = sourceData[i];
    const sku = String(row[col['SKU']] || '').trim();
    if (!sku || sku === '') continue;

    const skuName = String(row[col['SKU Name']] || '').trim();
    const vendorCode = String(row[col['Vendor Code']] || '').trim();
    const orderedQty = Number(row[col['Ordered Qty']] || 0);
    const mode = String(row[col['Mode (AIR/SEA)']] || '').trim().toUpperCase();

    if (!vendorCode || orderedQty <= 0 || !mode) continue;

    const groupKey = vendorCode + '_' + mode;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push({ sku, skuName, vendorCode, orderedQty, mode });
  }

  Logger.log('Groups found: ' + groups.size);

  // ── Get PO and PO Lines sheets ────────────────────────────
  const poSheet = ss.getSheetByName('Purchase_Orders');
  const poLineSheet = ss.getSheetByName('Purchase_Order_Lines');

  if (!poSheet || !poLineSheet) {
    Logger.log('ERROR: Purchase_Orders or Purchase_Order_Lines sheet not found');
    return;
  }

  const poHeader = getHeaderMap_(poSheet);
  const poLineHeader = getHeaderMap_(poLineSheet);

  // ── Track existing PO IDs to avoid duplicates ─────────────
  const existingPoData = poSheet.getDataRange().getValues();
  const existingPoIds = new Set(
    existingPoData.slice(1).map(r => String(r[0]).trim())
  );

  // ── Create POs and Lines ──────────────────────────────────
  const createdPOs = [];
  let groupIndex = 1;

  for (const [groupKey, lines] of groups.entries()) {
    const [vendorCode, mode] = groupKey.split('_');

    // Generate PO ID: PO-QY260320-1
    const vendorShort = vendorCode.substring(0, 2).toUpperCase();
    let poId = `PO-${vendorShort}${today}-${groupIndex}`;

    // Ensure unique
    while (existingPoIds.has(poId)) {
      groupIndex++;
      poId = `PO-${vendorShort}${today}-${groupIndex}`;
    }
    existingPoIds.add(poId);

    const totalQty = lines.reduce((sum, l) => sum + l.orderedQty, 0);
    const totalSkus = lines.length;

    // ── Insert Purchase_Orders row ────────────────────────
    appendRowFromObject_(poSheet, poHeader, {
      po_id: poId,
      draft_id: '',
      po_date: now,
      planned_mode: mode,
      vendor_code: vendorCode,
      total_skus: totalSkus,
      total_qty: totalQty,
      po_status: 'OPEN',
      created_by: 'bulk_import',
      created_at: now,
      updated_at: now,
      email_status: 'NOT_SENT'
    });

    Logger.log('Created PO: ' + poId +
      ' | Vendor: ' + vendorCode +
      ' | Mode: ' + mode +
      ' | SKUs: ' + totalSkus +
      ' | Qty: ' + totalQty);

    // ── Insert Purchase_Order_Lines rows ──────────────────
    lines.forEach((line, idx) => {
      const lineId = Utilities.getUuid();

      appendRowFromObject_(poLineSheet, poLineHeader, {
        po_line_id: lineId,
        po_id: poId,
        sku: line.sku,
        sku_name: line.skuName,
        vendor_code: vendorCode,
        ordered_qty: line.orderedQty,
        fulfilled_qty: 0,
        unit_price_rmb: 0,
        line_total_rmb: 0,
        custom_logo: false,
        custom_packaging: false,
        solving_manual: false,
        opp_wrap: false,
        custom_remarks: '',
        customization_files: '',
        line_status: 'OPEN',
        created_at: now,
        updated_at: now
      });

      Logger.log('  Line ' + (idx + 1) + ': ' + line.sku +
        ' | ' + line.skuName +
        ' | Qty: ' + line.orderedQty);
    });

    createdPOs.push(poId);
    groupIndex++;
  }

  SpreadsheetApp.flush();

  Logger.log('=== BULK IMPORT COMPLETE ===');
  Logger.log('POs created: ' + createdPOs.join(', '));
  Logger.log('Total lines created: ' + 
    Array.from(groups.values()).reduce((sum, g) => sum + g.length, 0));
}