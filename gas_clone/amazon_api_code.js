// =================================================================================
// CORE HELPERS (Authentication, Mapping, and Utilities)
// =================================================================================

function getAmazonAccessToken() {
  var scriptProperties = PropertiesService.getScriptProperties();
  // ... (rest of the function is identical, no changes needed)
  var clientId = scriptProperties.getProperty('AMAZON_CLIENT_ID');
  var clientSecret = scriptProperties.getProperty('AMAZON_CLIENT_SECRET');
  var refreshToken = scriptProperties.getProperty('AMAZON_REFRESH_TOKEN');
  var url = 'https://api.amazon.com/auth/o2/token';
  var options = {
    'method': 'post',
    'contentType': 'application/x-www-form-urlencoded',
    'muteHttpExceptions': true,
    'payload': { 'grant_type': 'refresh_token', 'refresh_token': refreshToken, 'client_id': clientId, 'client_secret': clientSecret }
  };
  try {
    var response = UrlFetchApp.fetch(url, options);
    var responseData = JSON.parse(response.getContentText());
    if (responseData.access_token) { return responseData.access_token; } 
    else { Logger.log('Error getting access token: ' + response.getContentText()); return null; }
  } catch (e) {
    Logger.log('Exception fetching access token: ' + e.message); return null; }
}

function getEasyEcomToken()
{
  var scriptProperties = PropertiesService.getScriptProperties();
  const email = scriptProperties.getProperty('EASY_ECOM_EMAIL');
  const password = scriptProperties.getProperty('EASY_ECOM_PASSWORD');
  const location_key = scriptProperties.getProperty('EASY_ECOM_LOCATION_KEY');
  const X_API_KEY =  scriptProperties.getProperty('EASY_ECOM_API_KEY');

  const url = "https://api.easyecom.io/access/token"; // ✅ this is correct for token
  const cred = {
    email: email,
    password: password,
    location_key: location_key
  };


  const options = {
    method: "post",
    headers: {
      "x-api-key": X_API_KEY,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify(cred),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const text = response.getContentText();

    if (text.startsWith("<")) throw new Error("Received HTML — check credentials or key.");

    const result = JSON.parse(text);
    const token = result?.data?.token?.jwt_token;

    if (!token) throw new Error("Token not found in response");

    Logger.log("✅ Token generated successfully");
    Logger.log(token);
    return token;
  } catch (err) {
    Logger.log("❌ Token Error: " + err.message);
    return null;
  }
}

function loadSkuMapping() 
{
  const mappingSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SKU Mapping');
  if (mappingSheet.getLastRow() < 2) return new Map();
  const mappingData = mappingSheet.getRange(2, 3, mappingSheet.getLastRow() - 1, 2).getDisplayValues();
  const skuToMasterSkuMap = new Map();
  mappingData.forEach(row => { if (row[0] && row[1]) skuToMasterSkuMap.set(row[0], row[1]); });
  Logger.log('Loaded ' + skuToMasterSkuMap.size + ' master SKU mappings.');
  return skuToMasterSkuMap;
}

/**
 * **HIGHLY EFFICIENT & ROBUST:** Finds and removes all rows from a sheet that match
 * a specific date and channel. It avoids slow row-by-row deletion by filtering
 * the data in memory and rewriting the sheet in a single operation.
 * 
 * @param {string} sheetName - The name of the sheet to clean.
 * @param {string} dateString - The date to filter for (e.g., "2025-11-15").
 * @param {string} channelName - The channel to filter for (e.g., "AMAZON").
 */
function _clearExistingData(sheetName, dateString, channelName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  var filter = sheet.getFilter();

  if (filter !== null) {
    filter.remove();
  }

  if (sheet.getLastRow() < 2) return; // Nothing to process

  // Step 1: Read all data into memory at once.
  const allData = sheet.getDataRange().getValues();
  const headers = allData.shift(); // Separate headers from the data

  const dateIndex = headers.indexOf('Date');
  const channelIndex = headers.indexOf('Channel Name');
  
  if (dateIndex === -1 || channelIndex === -1) {
    Logger.log(`Error: 'Date' or 'Channel Name' column not found in '${sheetName}'. Aborting clear operation.`);
    return;
  }

  const timezone = SpreadsheetApp.getActive().getSpreadsheetTimeZone();

  // Step 2: Create a new array containing only the rows we want to KEEP.
  // The .filter() method is extremely fast for this.
  const dataToKeep = allData.filter(row => {
    // The condition to KEEP a row is that it DOES NOT match our criteria for deletion.
    const rowDate = new Date(row[dateIndex]);
    if (isNaN(rowDate.getTime())) return true; // Keep rows with invalid dates

    const formattedDateString = Utilities.formatDate(rowDate, timezone, 'yyyy-MM-dd');
    
    // This is the condition to DELETE a row.
    const shouldDelete = (formattedDateString === dateString && row[channelIndex] === channelName);
    
    // We return the opposite to keep the row.
    return !shouldDelete;
  });

  // Optimization: If no rows were filtered out, there's no need to rewrite the sheet.
  if (dataToKeep.length === allData.length) {
    Logger.log(`No rows found for channel '${channelName}' on date '${dateString}'. No changes made.`);
    return;
  }
  
  // Step 3: Add the headers back to the top of our "good" data.
  dataToKeep.unshift(headers);
  
  // Step 4: Clear the entire sheet and write back the filtered data in a single batch.
  sheet.clearContents();
  sheet.getRange(1, 1, dataToKeep.length, dataToKeep[0].length).setValues(dataToKeep);
  
  const rowsCleared = allData.length - (dataToKeep.length - 1);
  Logger.log(`Efficiently cleared ${rowsCleared} rows for '${channelName}' on '${dateString}' and rewrote the sheet.`);
}

function _cleanupSheetByDate(sheetName, daysToKeep, dateColumnName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (sheet.getLastRow() < 2) return;
  const allData = sheet.getDataRange().getValues();
  const headers = allData.shift();
  const dateIndex = headers.indexOf(dateColumnName);
  if (dateIndex === -1) return;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  const filteredData = allData.filter(row => row[dateIndex] && new Date(row[dateIndex]) >= cutoffDate);
  
  filteredData.unshift(headers);
  sheet.clearContents();
  sheet.getRange(1, 1, filteredData.length, filteredData[0].length).setValues(filteredData);
  Logger.log(`'${sheetName}' cleanup complete.`);
}


// =================================================================================
// AMAZON FUNCTIONS
// =================================================================================

function updateAmazonSkuMapping() {
  var accessToken = getAmazonAccessToken();

  const scriptProperties = PropertiesService.getScriptProperties();
  const marketplaceId = scriptProperties.getProperty('MARKETPLACE_ID');

  const reportsApiEndpoint = 'https://sellingpartnerapi-eu.amazon.com/reports/2021-06-30';
  const reportType = 'GET_MERCHANT_LISTINGS_DATA';

  let reportId = null;

  // ==================================================
  // OPTIMIZATION: Reuse report
  // ==================================================
  const todayString = new Date().toISOString().substring(0, 10);
  const storedReportId = scriptProperties.getProperty('lastListingsReportId');
  const storedReportDate = scriptProperties.getProperty('lastListingsReportDate');

  if (storedReportId && storedReportDate === todayString) {
    Logger.log('Reusing today\'s listings report ID: ' + storedReportId);
    reportId = storedReportId;
  } else {
    reportId = createReport(accessToken, reportsApiEndpoint, marketplaceId, reportType);
    if (reportId) {
      scriptProperties.setProperty('lastListingsReportId', reportId);
      scriptProperties.setProperty('lastListingsReportDate', todayString);
    }
  }

  if (!reportId) return;

  const reportDocumentId = pollForReport(accessToken, reportsApiEndpoint, reportId);
  if (!reportDocumentId) return;

  const listingsData = downloadAndParseTSV(
    accessToken,
    reportsApiEndpoint,
    reportDocumentId,
    ['seller-sku', 'asin1']
  );

  if (!listingsData || listingsData.length === 0) return;

  // ==================================================
  // STEP 1 — Load SKU Mapping Sheet
  // ==================================================
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('SKU Mapping');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const channelIdx = headers.indexOf('Channel Name');
  const itemCodeIdx = headers.indexOf('Channel Item Code');
  const skuIdx = headers.indexOf('SKU');
  const masterSkuIdx = headers.indexOf('Master SKU');

  if ([channelIdx, itemCodeIdx, skuIdx, masterSkuIdx].includes(-1)) {
    throw new Error('SKU Mapping sheet headers are incorrect');
  }

  // ==================================================
  // STEP 2 — Create existing SKUs set (to avoid duplicates)
  // ==================================================
  const existingSKUSs = new Set();

  for (let i = 1; i < data.length; i++) {
    const sku = String(data[i][skuIdx]).trim();
    if (sku) existingSKUSs.add(sku);
  }

  // ==================================================
  // STEP 3 — Prepare new rows
  // ==================================================
  const newRows = [];

  listingsData.forEach(row => {
    const sellerSku = String(row['seller-sku'] || '').trim();
    const asin = String(row['asin1'] || '').trim();

    if (!sellerSku || !asin) return;

    // Skip if already exists
    if (existingSKUSs.has(sellerSku)) return;

    newRows.push([
      'AMAZON',     // Channel Name
      asin,         // Channel Item Code
      sellerSku,    // SKU
      ""     // Master SKU (same as SKU for now)
    ]);

    existingSKUSs.add(sellerSku); // prevent duplicates in same run
  });

  // ==================================================
  // STEP 4 — Append new rows
  // ==================================================
  if (newRows.length > 0) {
    sheet
      .getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length)
      .setValues(newRows);

    Logger.log(`Added ${newRows.length} new SKU mappings`);
  } else {
    Logger.log('No new SKU mappings to add');
  }
}

function fetchFbaInventory(accessToken) {
  const scriptProperties = PropertiesService.getScriptProperties();
  const marketplaceId = scriptProperties.getProperty('MARKETPLACE_ID');
  const inventoryEndpoint = 'https://sellingpartnerapi-eu.amazon.com/fba/inventory/v1/summaries';
  let allInventoryItems = [], nextToken = null, pageCount = 1;
  const oldDate = new Date(); oldDate.setDate(oldDate.getDate() - 90);
  const queryTime = oldDate.toISOString();

  do {
    const queryParams = ['granularityType=Marketplace', 'granularityId=' + marketplaceId, 'marketplaceIds=' + marketplaceId, 'details=true', 'startDateTime=' + queryTime];
    if (nextToken) queryParams.push('nextToken=' + encodeURIComponent(nextToken));
    const url = inventoryEndpoint + '?' + queryParams.join('&');
    const options = { 'method': 'get', 'headers': { 'x-amz-access-token': accessToken }, 'muteHttpExceptions': true };
    const response = UrlFetchApp.fetch(url, options);
    const inventoryData = JSON.parse(response.getContentText());
    if (inventoryData.payload && inventoryData.payload.inventorySummaries) {
      allInventoryItems = allInventoryItems.concat(inventoryData.payload.inventorySummaries);
      nextToken = (inventoryData.pagination && inventoryData.pagination.nextToken) ? inventoryData.pagination.nextToken : null;
      pageCount++;
    } else { nextToken = null; }
    if (nextToken) Utilities.sleep(1100);
  } while (nextToken && pageCount <= 100);

  return allInventoryItems;

}

function getFbaPendingMap(checkEERefBlank = false) {

  const ss = SpreadsheetApp.openById("1YM0dKPWySifYFDyNqCenJ4L85xIBSTrBGNPDcoo6Kfg");
  const sheet = ss.getSheetByName("PO_Database");

  const data = sheet.getDataRange().getValues();
  const headers = data.shift();

  const statusIdx = headers.indexOf('Status');
  const channelIdx = headers.indexOf('Channel Name');
  const storeIdx = headers.indexOf('Store Code');
  const itemIdx = headers.indexOf('Item Code');
  const qtyIdx = headers.indexOf('Qty');
  const shipmentIdx = headers.indexOf('FBA Shipment IDs');
  const eeRefIdx = headers.indexOf('EE_reference_code'); // ✅ NEW

  const map = new Map();

  data.forEach(row => {

    const status = String(row[statusIdx]).toLowerCase();
    const channel = String(row[channelIdx]);
    const store = String(row[storeIdx]);
    const itemCode = String(row[itemIdx]);
    const qty = Number(row[qtyIdx]) || 0;
    const shipmentId = String(row[shipmentIdx]).trim();
    const eeRef = String(row[eeRefIdx] || "").trim();

    // ✅ BASE CONDITIONS
    let isValid =
      channel === "Amazon_FBA" &&
      store !== "YEIO" &&
      status !== "cancelled" &&
      !shipmentId;

    // ✅ EXTRA CONDITION (ONLY WHEN REQUIRED)
    if (checkEERefBlank) {
      isValid = isValid && !eeRef;
    }

    if (isValid) {
      map.set(itemCode, (map.get(itemCode) || 0) + qty);
    }

  });

  Logger.log(`FBA Pending Map Size (${checkEERefBlank ? "Strict" : "Normal"}): ` + map.size);

  return map;
}

// Builds — but does NOT write — the AMAZON rows for the 'Inventory Data' sheet
// (10 columns, INVENTORY_DATA_HEADERS_ order). Formerly writeInventoryToSheet,
// which appended to the sheet itself after the EasyEcom rows were already
// there; the orchestrators now commit both halves together via
// finalizeInventorySync_ (Inventory_Valuation.js). Returns [] if Amazon gave
// back nothing, which the caller treats as "carry the previous Amazon rows over".
function buildAmazonInventoryRows_(inventoryItems, skuToMasterSkuMap, adjustmentMap) {

  if (!inventoryItems || inventoryItems.length === 0) return [];

  const pendingMap = getFbaPendingMap(false);      // normal
  const strictPendingMap = getFbaPendingMap(true); // new

  const dataToWrite = inventoryItems
    .map(item => {

      const originalSku = item.sellerSku;
      const masterSku = skuToMasterSkuMap.get(originalSku) || originalSku;

      const d = item.inventoryDetails || {};
      const r = d.reservedQuantity || {};

      const globalFulfillable = Number(d.fulfillableQuantity) || 0;

      const easyEcomQty = Number(adjustmentMap.get(masterSku)) || 0;
      const adjustedFulfillable = globalFulfillable - easyEcomQty;

      const pendingQty = Number(pendingMap.get(originalSku)) || 0;
      const strictPendingQty = Number(strictPendingMap.get(originalSku)) || 0; // ✅ NEW

      return [
        'AMAZON',
        item.asin,
        originalSku,
        masterSku,
        adjustedFulfillable,
        Number(r.totalReservedQuantity) || 0,
        Number(d.inboundShippedQuantity + d.inboundWorkingQuantity + d.inboundReceivingQuantity) || 0,
        pendingQty,
        easyEcomQty,
        strictPendingQty // ✅ NEW COLUMN

      ];
    });
    //.filter(row => row[4] > 0 || row[5] > 0 || row[6] > 0);

  Logger.log('Built ' + dataToWrite.length + ' Amazon inventory rows.');
  return dataToWrite;
}

function fetchAndAppendAmazonSales(accessToken, skuToMasterSkuMap, targetDate) {
  const scriptProperties = PropertiesService.getScriptProperties();
  const marketplaceId = scriptProperties.getProperty('MARKETPLACE_ID');
  const reportsApiEndpoint = 'https://sellingpartnerapi-eu.amazon.com/reports/2021-06-30';
  const reportType = 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL';

  let reportId = null;

  const targetDateString = targetDate.toISOString().substring(0, 10);

  // Reuse previously created report when available
  const storedReportId = scriptProperties.getProperty('lastSalesReportId');
  const storedReportDate = scriptProperties.getProperty('lastSalesReportDate');

  if (storedReportId && storedReportDate === targetDateString) {
    Logger.log(
      'Reusing sales report ID for ' +
      targetDateString +
      ': ' +
      storedReportId
    );

    reportId = storedReportId;

  } else {
    const reportOptions = {
      dataStartTime: targetDateString + 'T00:00:00Z',
      dataEndTime: targetDateString + 'T23:59:59Z'
    };

    reportId = createReport(
      accessToken,
      reportsApiEndpoint,
      marketplaceId,
      reportType,
      reportOptions
    );

    if (reportId) {
      scriptProperties.setProperty('lastSalesReportId', reportId);
      scriptProperties.setProperty('lastSalesReportDate', targetDateString);
    }
  }

  if (!reportId) return;

  _clearExistingData('Sales Data', targetDateString, 'AMAZON');

  const reportDocumentId = pollForReport(
    accessToken,
    reportsApiEndpoint,
    reportId
  );

  if (!reportDocumentId) return;

  const parsedData = downloadAndParseTSV(
    accessToken,
    reportsApiEndpoint,
    reportDocumentId
  );

  if (!parsedData || parsedData.length === 0) {
    Logger.log('No Amazon sales rows found in the downloaded report.');
    return;
  }

  // Exclude rows where sales-channel is Non-Amazon
  const amazonOnlyData = parsedData.filter(row => {
    const salesChannel = String(row['sales-channel'] || '')
      .trim()
      .toLowerCase();

    return salesChannel !== 'non-amazon';
  });

  Logger.log(
    'Total report rows: ' +
    parsedData.length +
    ' | Non-Amazon rows excluded: ' +
    (parsedData.length - amazonOnlyData.length) +
    ' | Rows remaining: ' +
    amazonOnlyData.length
  );

  const summary = amazonOnlyData.reduce((acc, row) => {
    const sku = String(row['sku'] || '').trim();

    if (!sku) return acc;

    if (!acc[sku]) {
      acc[sku] = {
        asin: row['asin'],
        masterSku: skuToMasterSkuMap.get(sku) || sku,
        quantity: 0
      };
    }

    acc[sku].quantity += parseInt(row['quantity'], 10) || 0;

    return acc;
  }, {});

  const dataToWrite = Object.keys(summary)
    .map(sku => {
      const details = summary[sku];

      return [
        targetDateString,
        'AMAZON',
        'B2C',
        details.asin,
        sku,
        details.masterSku,
        details.quantity
      ];
    })
    .filter(row => row[6] > 0);

  if (dataToWrite.length === 0) {
    Logger.log(
      'No valid Amazon sales quantities found after excluding Non-Amazon rows.'
    );
    return;
  }

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName('Sales Data');

  const headers = [
    'Date',
    'Channel Name',
    'Sales Type',
    'Channel Item Code',
    'Channel SKU',
    'Master SKU',
    'Quantity'
  ];

  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  sheet
    .getRange(
      sheet.getLastRow() + 1,
      1,
      dataToWrite.length,
      headers.length
    )
    .setValues(dataToWrite);

  Logger.log(
    'Appended ' +
    dataToWrite.length +
    ' summarized Amazon sales rows.'
  );
}
// =================================================================================
// GENERIC REPORTING HELPERS
// =================================================================================

function createReport(accessToken, endpoint, marketplaceId, reportType, options) {
  const url = endpoint + '/reports';
  let payload = { reportType: reportType, marketplaceIds: [marketplaceId] };
  if (options) {
    if (options.dataStartTime) payload.dataStartTime = options.dataStartTime;
    if (options.dataEndTime) payload.dataEndTime = options.dataEndTime;
      // 🔥 ADD THIS (CRITICAL)
    if (options.reportOptions) {
      payload.reportOptions = options.reportOptions;
    }
  }
  
  const reqOptions = { 'method': 'post', 'headers': { 'x-amz-access-token': accessToken, 'Content-Type': 'application/json' },
    'payload': JSON.stringify(payload), 'muteHttpExceptions': true };
  
  const response = UrlFetchApp.fetch(url, reqOptions);
  const responseData = JSON.parse(response.getContentText());
  
  if (responseData.reportId) {
    return responseData.reportId;
  }
  Logger.log('Error creating ' + reportType + ': ' + response.getContentText());
  return null;
}

function pollForReport(accessToken, endpoint, reportId) {
  const url = endpoint + '/reports/' + reportId;
  const options = { 'method': 'get', 'headers': { 'x-amz-access-token': accessToken }, 'muteHttpExceptions': true };
  let status = '', attempts = 0;

  while (attempts < 20) {
    attempts++;
    const response = UrlFetchApp.fetch(url, options);
    const responseData = JSON.parse(response.getContentText());
    status = responseData.processingStatus;
    Logger.log('Polling attempt ' + attempts + ': Report ' + reportId + ' status is ' + status);

    if (status === 'DONE') return responseData.reportDocumentId;
    if (['CANCELLED', 'FATAL'].includes(status)) return null;
    
    Utilities.sleep(30000);
  }
  return null;
}

function downloadAndParseTSV(accessToken, endpoint, reportDocumentId, specificHeaders) {

  const docUrl = endpoint + '/documents/' + reportDocumentId;

  const docResponse = UrlFetchApp.fetch(docUrl, {
    method: 'get',
    headers: { 'x-amz-access-token': accessToken }
  });

  const docData = JSON.parse(docResponse.getContentText());
  Logger.log(docData.url);

  if (!docData.url) {
    Logger.log("❌ No document URL");
    return [];
  }

  // ---------- DOWNLOAD ----------
  const fileResponse = UrlFetchApp.fetch(docData.url, {
    method: 'get',
    followRedirects: true
  });

  let tsvData;

  // ---------- FINAL GZIP FIX ----------
  try {
    // Force correct content type
    let blob = fileResponse.getBlob().setContentType('application/x-gzip');

    const decompressed = Utilities.ungzip(blob);
    tsvData = decompressed.getDataAsString('UTF-8');

    Logger.log("✅ GZIP decoded");

  } catch (e) {

    Logger.log("⚠️ Fallback to plain text");

    tsvData = fileResponse.getContentText('UTF-8');
  }

  if (!tsvData || !tsvData.includes('\t')) {
    Logger.log("❌ Invalid TSV");
    return [];
  }

  // ---------- PARSE ----------
  const lines = tsvData.split('\n');

  const headers = lines[0]
    .split('\t')
    .map(h => h.trim().replace(/"/g, ''));

  Logger.log(headers);

  const result = [];

  const columnsToExtract = specificHeaders || headers;
  const indices = columnsToExtract.map(h => headers.indexOf(h));

  for (let i = 1; i < lines.length; i++) {

    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split('\t').map(v => v.replace(/"/g, ''));

    let row = {};

    indices.forEach((index, j) => {
      if (index !== -1) {
        row[columnsToExtract[j]] = values[index] || '';
      }
    });

    result.push(row);
  }

  Logger.log("✅ Parsed rows: " + result.length);

  return result;
}

// =================================================================================
// MONTHLY SALES SUMMARY FUNCTIONS
// =================================================================================

function updateMonthlySaleData(monthsAgo) {
  // --- 1. DETERMINE THE TARGET MONTH ---
  monthsAgo = (typeof monthsAgo !== 'number' || monthsAgo < 1) ? 1 : monthsAgo;
  const today = new Date();
  const targetDate = new Date(today.getFullYear(), today.getMonth() - monthsAgo, 1);
  const targetYear = targetDate.getFullYear();
  const targetMonth = targetDate.getMonth();
  const targetMonthString = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}`;
  
  Logger.log(`Starting monthly sales summary for: ${targetMonthString}`);

  // --- 2. READ THE SOURCE DATA ---
  const sourceSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sales Data');
  if (sourceSheet.getLastRow() < 2) {
    Logger.log('No data in "Sales Data" sheet to process.');
    return;
  }
  
  const allData = sourceSheet.getDataRange().getValues();
  const headers = allData.shift();

  // Find all necessary column indexes dynamically.
  const dateIndex = headers.indexOf('Date');
  const channelNameIndex = headers.indexOf('Channel Name');
  const salesTypeIndex = headers.indexOf('Sales Type');
  const asinIndex = headers.indexOf('Channel Item Code'); // Assuming header is 'ASIN'
  const channelSkuIndex = headers.indexOf('Channel SKU'); // Assuming header is 'Original SKU'
  const masterSkuIndex = headers.indexOf('Master SKU');
  const quantityIndex = headers.indexOf('Quantity');

  if ([dateIndex, channelNameIndex, salesTypeIndex, asinIndex, channelSkuIndex, masterSkuIndex, quantityIndex].includes(-1)) {
    Logger.log("Error: One or more required columns were not found in 'Sales Data'. Please check headers.");
    return;
  }
  
  // --- 3. EFFICIENTLY SUMMARIZE THE DATA BY 'CHANNEL SKU' ---
  const summary = allData.reduce((accumulator, row) => {
    const rowDate = new Date(row[dateIndex]);
    
    if (rowDate.getFullYear() === targetYear && rowDate.getMonth() === targetMonth) {
      const channelSku = row[channelSkuIndex];
      const quantity = parseInt(row[quantityIndex], 10) || 0;
      
      // If we haven't seen this Channel SKU before, initialize its entry.
      if (!accumulator[channelSku]) {
        accumulator[channelSku] = {
          channelName: row[channelNameIndex],
          salesType: row[salesTypeIndex],
          asin: row[asinIndex],
          masterSku: row[masterSkuIndex],
          quantity: 0 // Initialize quantity sum
        };
      }
      
      // Add the current row's quantity to the running total for that Channel SKU.
      accumulator[channelSku].quantity += quantity;
    }
    
    return accumulator;
  }, {});

  // --- 4. PREPARE AND WRITE THE OUTPUT ---
  if (Object.keys(summary).length === 0) {
      Logger.log(`No sales data found for ${targetMonthString}.`);
      return;
  }
  
  // Convert the summarized object into a 2D array for writing.
  const dataToWrite = Object.keys(summary).map(channelSku => {
    const details = summary[channelSku];
    return [
      targetMonthString,
      details.channelName,
      details.salesType,
      details.asin,
      channelSku, // This is the key we grouped by
      details.masterSku,
      details.quantity // This is the final summed quantity
    ];
  }).sort((a, b) => b[6] - a[6]); // <-- ADD THIS LINE;

  const destSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Monthly Sales Data');
  const headersToWrite = ['Month', 'Channel Name', 'Sales Type', 'Channel Item Code', 'Channel SKU', 'Master SKU', 'Total Quantity'];
  
  if (destSheet.getLastRow() < 1) {
    destSheet.getRange(1, 1, 1, headersToWrite.length).setValues([headersToWrite]);
  }
  
  // Safety Check to prevent duplicate monthly summaries.
  const lastRow = destSheet.getLastRow();
  if (lastRow > 1) {
    const monthColumnValues = destSheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat();
    if (monthColumnValues.includes(targetMonthString)) {
      Logger.log(`A summary for ${targetMonthString} already exists. Aborting write to prevent duplicates.`);
      return;
    }
  }

  // Append the new summarized data.
  destSheet.getRange(destSheet.getLastRow() + 1, 1, dataToWrite.length, headersToWrite.length).setValues(dataToWrite);
  Logger.log(`Successfully wrote ${dataToWrite.length} summarized rows for the month of ${targetMonthString}.`);
}

