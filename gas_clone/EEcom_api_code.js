
// =================================================================================
// EASY ECOM - PRODUCT MASTER FUNCTIONS (CORRECTED VERSION)
// =================================================================================

/**
 * API: Refreshes ONLY the 'EE Product Master' sheet from EasyEcom — fetch +
 * writeEcomProductsToSheet, nothing else (no Amazon/Shopify/inventory work,
 * unlike runAllUpdates/fetch_all_inventory). Used to pull a fresh
 * 'EE Scan Identifier' column for the shipment SKU-matching engine on demand,
 * without waiting for or triggering the full daily update.
 */
function apiSyncEeProductMaster_() {
  const token = getEasyEcomToken();
  if (!token) throw new Error('Failed to get EasyEcom token');

  const allProducts = fetchAllEcomProducts(token);
  writeEcomProductsToSheet(allProducts);
  invalidateSheetCache_('EE Product Master');

  return { success: true, count: allProducts.length };
}

/**
 * Builds — but does NOT write — the EasyEcom rows for the 'Inventory Data'
 * sheet, plus the per-SKU quantity map the Amazon rows are adjusted by.
 *
 * This used to clear the sheet and write the EasyEcom rows itself, well before
 * the (slow) Amazon fetch finished appending its own — leaving the sheet
 * EasyEcom-only for the whole gap. It now only assembles rows; the orchestrators
 * commit EasyEcom + Amazon together via finalizeInventorySync_
 * (Inventory_Valuation.js). Combo products are excluded, as before.
 *
 * @return {{rows: Array[], adjustmentMap: Map<string, number>}}
 */
function buildEasyEcomInventoryRows_(allProducts) {
  const filteredProducts = (allProducts || []).filter(item => item.product_type !== 'combo_product');

  const adjustmentMap = new Map();
  filteredProducts.forEach(item => {
    const qty = Number(item.inventory) || 0;
    adjustmentMap.set(item.sku, (adjustmentMap.get(item.sku) || 0) + qty);
  });

  // 10-column layout — see INVENTORY_DATA_HEADERS_ (Inventory_Valuation.js).
  const rows = filteredProducts.map(item => [
    'EASY ECOM',        // Channel Name
    item.product_id,      // Channel Item Code
    item.sku,             // Channel SKU
    item.sku,             // Master SKU (using original SKU as requested)
    item.inventory || 0,  // InStock (Fulfillable)
    0,                    // Reserved (Total) - Static value
    0,                    // Inbound (Shipped) - Static value
    0,                    // Inbound (Pending)
    0,                    // XQJX
    ''                    // Strict (Pending) — the old writer only wrote 9 columns, leaving this blank; kept blank
  ]);

  Logger.log(`Built ${rows.length} non-combo EasyEcom inventory rows.`);
  return { rows, adjustmentMap };
}

/**
 * **HELPER 1 (CORRECTED):** Handles the API calls and cursor-based pagination.
 * @param {string} token - The EasyEcom authentication token.
 * @return {Array} An array of all product objects from the API.
 */
function fetchAllEcomProducts(token) {
  const initialUrl = "https://api.easyecom.io/Products/GetProductMaster?custom_fields=1&active=1&limit=200";
      const apiKey = PropertiesService.getScriptProperties().getProperty('EASY_ECOM_API_KEY');

  let allProducts = [];
  let nextUrl = initialUrl; // Start with the initial URL

  do {
    //Logger.log(`Fetching EasyEcom products from URL: ${nextUrl}`);
    
    const options = {
      'method': 'get',
      'headers': { 'Authorization': 'Bearer ' + token, 'x-api-key': apiKey },
      'muteHttpExceptions': true
    };

    try {
      const response = UrlFetchApp.fetch(nextUrl, options);
      const responseData = JSON.parse(response.getContentText());

      // Use the correct key 'data' instead of 'products'
      if (response.getResponseCode() === 200 && responseData.data && responseData.data.length > 0) {
        allProducts = allProducts.concat(responseData.data);
        
        // Check for 'nextUrl' and construct the full URL for the next page
        if (responseData.nextUrl) {
          nextUrl = "https://api.easyecom.io" + responseData.nextUrl;
        } else {
          nextUrl = null; // No more pages, stop the loop
        }
      } else {
        nextUrl = null; // Stop if there's an error or no more data
        if (response.getResponseCode() !== 200) {
          Logger.log('Received an error from EasyEcom API: ' + response.getContentText());
        }
      }
    } catch (e) {
      Logger.log('An exception occurred during EasyEcom API call: ' + e.message);
      nextUrl = null;
    }
    
    if (nextUrl) {
      Utilities.sleep(1100); // Pause between requests
    }

  } while (nextUrl);

  Logger.log(`Fetched a total of ${allProducts.length} products from EasyEcom.`);
  return allProducts;
}


/**
 * **UPDATED:** Processes the raw product data and writes it to the sheet.
 * This version now filters out products belonging to specific, excluded categories
 * before writing the data to the sheet.
 * @param {Array} allProducts - The array of product objects from the API.
 */
function writeEcomProductsToSheet(allProducts) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('EE Product Master');
  if(allProducts.length>0)
  {
  sheet.clearContents(); // Always start with a fresh sheet for master data.
  

  // =========================================================================
  // THE CHANGE IS HERE: Define your exclusion list and filter the data.
  // =========================================================================
  
  // 1. Define the categories you want to exclude. This makes it easy to update later.
  const excludedCategories = ["CUBEINK","DesignCategory", "Discontinued"];
  
  // 2. Filter the `allProducts` array to create a new array that only contains the products we want to keep.
  const filteredProducts = allProducts.filter(product => {
    // The condition to KEEP a product is that its category is NOT in the exclusion list.
    return !excludedCategories.includes(product.category_name);
  });
  
  Logger.log(`Filtered out ${allProducts.length - filteredProducts.length} products from excluded categories.`);

  // --- The rest of your function remains the same, but now operates on `filteredProducts` ---

/*
Accounting SKU is used to store Other Factory Item Code
Accounting Unit is used to store MRP
MRP is used to store POS Selling Price
Size is used to store Pack Size
EAN/UPC as EE Scan Identifier
Model Number as FNSKU or SKU
*/

  const headers = [
    "Product ID", "SKU", "Product Name", "Inventory", "Product Type",
    "Brand", "Category Name", "Cost", "POS Selling Price", "Pack Size", "Height", "Length", "Width",
    "Weight", "MRP", "EE Scan Identifier", "FNSKU", "EAN", "Article Number","Other Factory Item Code", "Lead_Time","MOQ","Threshold_Qty","Supplier_Code","Explode_Exclusion"	,"Exclude_List"	,"RMB_Price"
  ];

  // Make sure to use the `filteredProducts` array from this point forward.
  const processedData = filteredProducts.map(product => {
    let flatProduct = {
      "Product ID": product.product_id,
      "SKU": product.sku,
      "Product Name": product.product_name,
      "Inventory": product.inventory,
      "Product Type": product.product_type,
      "Brand": product.brand,
      "Category Name": product.category_name,
      "Cost": product.cost,
      "POS Selling Price": product.mrp,
      "Pack Size": product.size,
      "Height": product.height,
      "Length": product.length,
      "Width": product.width,
      "Weight": product.weight,
      "MRP": product.accounting_unit,
      "Other Factory Item Code": product.accounting_sku,
      "EE Scan Identifier": product.EANUPC,
      "FNSKU": product.model_no
    };

    if (product.custom_fields && Array.isArray(product.custom_fields)) {
      product.custom_fields.forEach(field => {
        flatProduct[field.field_name] = field.value;
      });
    }
    
    return flatProduct;
  });

  const dataToWrite = processedData.map(flatProduct => {
    return headers.map(header => flatProduct[header] || '');
  });

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (dataToWrite.length > 0) {
    sheet.getRange(2, 1, dataToWrite.length, headers.length).setValues(dataToWrite);
  }

  Logger.log(`Successfully wrote ${dataToWrite.length} product master records with ${headers.length} columns.`);
  }
}

// =================================================================================
// EASY ECOM - KITS & COMBOS/BUNDLES PROCESSING (REFACTORED & COMBINED)
// =================================================================================

/**
 * **MAIN FUNCTION:** Orchestrates the fetching and processing of BOTH Kits and Combos,
 * writing the combined and processed data to the 'EE Component Master' sheet.
 */
function fetchAndUpdateEasyEcomComponents(token) {
 // var token = getEasyEcomToken();
  Logger.log('--- Starting EasyEcom Kits & Combos Update ---');

  // Step 1: Fetch both kits and combos in parallel.
  const kitsData = _fetchAllEasyEcomProductsByType(token, 2); 
  const combosData = _fetchAllEasyEcomProductsByType(token, 1);
  
  // Step 2: Add the 'product_type_name' to each object and combine the data.
  const allComponents = [];
  if (kitsData) {
    kitsData.forEach(kit => {
      kit.product_type_name = 'kit_product';
      allComponents.push(kit);
    });
  }
  if (combosData) {
    combosData.forEach(combo => {
      combo.product_type_name = 'combo_product';
      allComponents.push(combo);
    });
  }

  // Step 3: Process the single, combined list of components.
  _processAndWriteCombinedComponents(allComponents);
  Logger.log('--- EasyEcom Kits & Combos Update Finished ---');
}


/**
 * **GENERIC HELPER 1:** Fetches all paginated products for a given product type.
 * This function remains highly reusable.
 * @param {string} token - The EasyEcom authentication token.
 * @param {number} productType - 1 for Combos, 2 for Kits.
 * @return {Array|null} An array of raw product objects from the API, or null on failure.
 */
function _fetchAllEasyEcomProductsByType(token, productType) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('EASY_ECOM_API_KEY');
  const initialUrl = `https://api.easyecom.io/Products/GetProductMaster?product_type=${productType}&limit=200&active=1`;
  let allProducts = [];
  let nextUrl = initialUrl;

  do {
    Logger.log(`Fetching product type ${productType} from: ${nextUrl}`);
    const options = {
      'method': 'get',
      'headers': { 'Authorization': 'Bearer ' + token, 'x-api-key': apiKey },
      'muteHttpExceptions': true
    };

    try {
      const response = UrlFetchApp.fetch(nextUrl, options);
      const data = JSON.parse(response.getContentText());

      if (response.getResponseCode() === 200 && data.data && data.data.length > 0) {
        allProducts = allProducts.concat(data.data);
        nextUrl = data.nextUrl ? "https://api.easyecom.io" + data.nextUrl : null;
      } else {
        nextUrl = null;
        if (response.getResponseCode() !== 200) Logger.log(`EasyEcom API Error (Type ${productType}): ${response.getContentText()}`);
      }
    } catch (e) {
      nextUrl = null;
      Logger.log(`Exception during API call (Type ${productType}): ${e.message}`);
      return null; // Return null on a critical failure
    }
    if (nextUrl) Utilities.sleep(1100);
  } while (nextUrl);

  Logger.log(`Fetched a total of ${allProducts.length} products of type ${productType}.`);
  return allProducts;
}


/**
 * **GENERIC HELPER 2 (MODIFIED):** Processes the combined raw data and writes it to a single sheet.
 * @param {Array} rawData - The combined array of kit and combo objects.
 */
function _processAndWriteCombinedComponents(rawData) {
  if (!rawData || rawData.length === 0) {
    Logger.log('No component data provided to process. Aborting write.');
    return;
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('EE Component Master');
  sheet.clearContents();

  let maxChildCount = 0;

  // Use .reduce() to group all child components by their parent SKU in a single pass.
  const groupedByParent = rawData.reduce((acc, parentProduct) => {
    // NOTE: Keeping your business logic of truncating SKUs to 7 characters.- removed this logic
    const parentSku = parentProduct.sku.toString();
    
    // The accumulator now stores an object with both the type and the children.
    acc[parentSku] = {
      productType: parentProduct.product_type_name,
      children: []
    };
    
    if (parentProduct.sub_products && parentProduct.sub_products.length > 0) {
      parentProduct.sub_products.forEach(child => {
        const childSku = child.sku.toString().substring(0, 7);
        const quantity = parseInt(child.quantity, 10) || 0;
        
        for (let i = 0; i < quantity; i++) {
          acc[parentSku].children.push(childSku);
        }
      });
    }
    
    if (acc[parentSku].children.length > maxChildCount) {
      maxChildCount = acc[parentSku].children.length;
    }
    
    return acc;
  }, {});

  // Create dynamic headers: ['Parent SKU', 'Product Type', 'Child 1', 'Child 2', ...]
  const headers = ['Parent SKU', 'Product Type'];
  for (let i = 1; i <= maxChildCount; i++) {
    headers.push(`Child ${i}`);
  }

  // Convert the grouped data into a 2D array for writing, and pad rows.
  const dataToWrite = Object.keys(groupedByParent).map(parentSku => {
    const details = groupedByParent[parentSku];
    const row = [parentSku, details.productType, ...details.children];
    while (row.length < headers.length) {
      row.push('');
    }
    return row;
  });

  // Batch write to the sheet.
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (dataToWrite.length > 0) {
    sheet.getRange(2, 1, dataToWrite.length, headers.length).setValues(dataToWrite);
  }
  
  Logger.log(`Successfully processed and wrote ${dataToWrite.length} combined kit/combo rows.`);
}

// =================================================================================
// EASY ECOM - PURCHASE ORDER (PO) FETCHING (ADVANCED STATEFUL METHOD)
// =================================================================================
// =================================================================================
// EASY ECOM PURCHASE ORDER SYNC (PENDING + STATEFUL)
// =================================================================================

function updateEasyEcomPurchaseOrders(token) {

  Logger.log("---- EasyEcom PO Sync Start ----");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("EE Purchase Orders");
  const props = PropertiesService.getScriptProperties();

  const poDataMap = new Map();
  const pendingPoIds = new Set();

  const poIdIndex = 0;
  const statusIndex = 3;

  // ------------------------------------------------
  // LOAD EXISTING SHEET DATA
  // ------------------------------------------------

  if (sheet.getLastRow() > 1) {

    const existing = sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).getValues();

    existing.forEach(row => {

  const poId = String(row[poIdIndex]).trim();
  const status = Number(row[statusIndex]);

  if (!poId) return;

  if (!poDataMap.has(poId)) {
    poDataMap.set(poId, []);
  }

  poDataMap.get(poId).push(row);

  // ✅ Track only currently pending POs from sheet
  if (status === 3) {
    pendingPoIds.add(poId);
  }

});

    Logger.log(`Loaded ${poDataMap.size} POs | Pending: ${pendingPoIds.size}`);
  }

// ------------------------------------------------
// STEP 1 : UPDATE EXISTING PENDING POS
// ------------------------------------------------

if (pendingPoIds.size > 0) {

  const pendingIdsArray = Array.from(pendingPoIds).map(String);

  const result = _fetchPODataByIds(token, pendingIdsArray);

  const updatedRows = result.rows || [];
  const fetchedIds = result.fetchedIds || new Set();

  Logger.log(`Pending PO IDs sent: ${pendingIdsArray.length}`);
  Logger.log(`Fetched PO IDs received: ${fetchedIds.size}`);
  Logger.log(`Fresh item rows received: ${updatedRows.length}`);

  // ✅ Delete all old rows for every successfully fetched PO
  // This is important because new SKU/item rows may have been added
  fetchedIds.forEach(id => {
    poDataMap.delete(String(id));
  });

  // ✅ Add all fresh rows from EasyEcom
  // This will include newly added rows/items also
  updatedRows.forEach(row => {

    const poId = String(row[0]).trim();

    if (!poDataMap.has(poId)) {
      poDataMap.set(poId, []);
    }

    poDataMap.get(poId).push(row);

  });

  Logger.log(`Refreshed ${fetchedIds.size} existing POs where old PO Status ID was 3`);
}
  // ------------------------------------------------
  // STEP 2 : FETCH NEW PENDING POS
  // ------------------------------------------------

  let lastFetchDate = props.getProperty("lastPoFetchDate");

  if(!lastFetchDate){

    const d = new Date();
    d.setDate(d.getDate() - 180);
    lastFetchDate = d.toISOString().substring(0,10);

  }

  const today = new Date().toISOString().substring(0,10);

  const newPendingRows = _fetchPaginatedPOData(token,3,lastFetchDate,today);

  if(newPendingRows && newPendingRows.length){

    newPendingRows.forEach(row => {

      const poId = row[0];

      if(!poDataMap.has(poId)){
        poDataMap.set(poId,[]);
      }

      poDataMap.get(poId).push(row);

    });

    Logger.log(`Fetched ${newPendingRows.length} new pending rows`);
  }

  props.setProperty("lastPoFetchDate",today);

  // ------------------------------------------------
  // WRITE DATA BACK
  // ------------------------------------------------

  const finalRows = [].concat(...poDataMap.values());

  if(!finalRows.length){
    Logger.log("No rows to write");
    return;
  }

  finalRows.sort((a,b)=> new Date(a[4]) - new Date(b[4]));

  const headers = [
    'PO ID',
    'Total PO Value',
    'PO Ref Num',
    'PO Status ID',
    'PO Created Date',
    'PO Updated Date',
    'Vendor Name',
    'Vendor Code',
    'SKU',
    'Original Quantity',
    'Pending Quantity',
    'Item Price'
  ];

  sheet.clearContents();

  sheet.getRange(1,1,1,headers.length).setValues([headers]);

  sheet.getRange(2,1,finalRows.length,headers.length).setValues(finalRows);

  Logger.log(`Written ${finalRows.length} rows`);

}
function _fetchPODataByIds(token, poIdArray) {

  const apiKey = PropertiesService.getScriptProperties().getProperty('EASY_ECOM_API_KEY');
  const baseUrl = "https://api.easyecom.io";

  let allRows = [];
  let fetchedIds = new Set();

  const batchSize = 1;

  for (let i = 0; i < poIdArray.length; i += batchSize) {

    const batch = poIdArray.slice(i, i + batchSize).map(String);

    const url = `${baseUrl}/wms/V2/getPurchaseOrderDetails?po_ids=${batch.join(',')}`;

    Logger.log(`Fetching existing PO IDs: ${batch.join(',')}`);

    const options = {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + token,
        'x-api-key': apiKey
      },
      muteHttpExceptions: true
    };

    try {

      const response = UrlFetchApp.fetch(url, options);
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();

      Logger.log(`Response Code: ${responseCode}`);
      Logger.log(responseText.substring(0, 1000));

      const data = JSON.parse(responseText);

      if (responseCode === 200 && data.data) {

        const poArray = Array.isArray(data.data) ? data.data : [data.data];

        poArray.forEach(po => {
          if (po.po_id) {
            fetchedIds.add(String(po.po_id).trim());
          }
        });

        const flattened = _flattenPoApiResponse(poArray);

        allRows = allRows.concat(flattened);

      } else {
        Logger.log(`API failed for PO batch: ${batch.join(',')}`);
      }

    } catch (e) {
      Logger.log(`Error while fetching PO IDs ${batch.join(',')}: ${e.message}`);
    }

    Utilities.sleep(1100);
  }

  return {
    rows: allRows,
    fetchedIds: fetchedIds
  };
}
function _fetchPaginatedPOData(token,statusId,startDate,endDate){

  const apiKey = PropertiesService.getScriptProperties().getProperty('EASY_ECOM_API_KEY');
  const baseUrl = "https://api.easyecom.io";

  let nextUrl = `${baseUrl}/wms/V2/getPurchaseOrderDetails?po_status_id=${statusId}&created_after=${startDate}&created_before=${endDate}&limit=10`;
  Logger.log(nextUrl);

  let rows = [];

  do{

    const options = {
      method:'get',
      headers:{
        Authorization:'Bearer '+token,
        'x-api-key':apiKey
      }
    };

    const response = UrlFetchApp.fetch(nextUrl,options);

    const data = JSON.parse(response.getContentText());

    if(response.getResponseCode() === 200 && data.data){

      const flattened = _flattenPoApiResponse(data.data);

      rows = rows.concat(flattened);

      nextUrl = data.nextUrl ? baseUrl + data.nextUrl : null;

    }else{
      nextUrl = null;
    }

    if(nextUrl) Utilities.sleep(1100);

  }while(nextUrl);

  return rows;
}
function _flattenPoApiResponse(poDataArray){

  let rows = [];

  poDataArray.forEach(po=>{

     let orderIdSupplier = po.po_ref_num || '';

    if(po.po_items){

      po.po_items.forEach(item=>{

        rows.push([

          po.po_id,
          po.total_po_value,
          orderIdSupplier,
          po.po_status_id,
          po.po_created_date,
          po.po_updated_date,
          po.vendor_name,
          po.vendor_code || '',
          item.sku,
          item.original_quantity,
          item.pending_quantity,
          item.item_price
        ]);

      });

    }

  });

  return rows;

}

// =================================================================================
// EASY ECOM - B2C SALES DATA FUNCTIONS (CORRECTED & ROBUST)
// =================================================================================

/**
 * **MAIN DAILY FUNCTION for EASY ECOM SALES:**
 * ALL B2B Sales, Shopify, Snapdeal, Firstcry, Meesho included, Walk-in Sales
 */
function fetchAndAppendEasyEcomSales(token,daysAgo) {
  Logger.log('--- Starting Daily EasyEcom B2C Sales Fetch Process ---');
  
  const targetDate = new Date();

  const endDateString = targetDate.toISOString().substring(0, 10);
  targetDate.setDate(targetDate.getDate() - daysAgo);

  const startDateString = targetDate.toISOString().substring(0, 10);

  // The fetcher now handles the new API endpoint and data structure.
  const rawOrders = _fetchEasyEcomOrders(token, startDateString, endDateString);
  if (!rawOrders || rawOrders.length === 0) {
    Logger.log('No EasyEcom B2C orders found for yesterday.');
    return;
  }
  
  // The transformer now handles the new data structure.
  const summarizedData = _transformAndSummarizeEasyEcomOrders(rawOrders);
  
  if (summarizedData.length > 0) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sales Data');
    sheet.getRange(sheet.getLastRow() + 1, 1, summarizedData.length, summarizedData[0].length).setValues(summarizedData);
    Logger.log(`Successfully appended ${summarizedData.length} summarized EasyEcom B2C sales rows.`);
  }
}


/**
 * **HELPER 1 (CORRECTED):** Fetches B2B orders using the correct endpoint and parameters.
 * @return {Array} The raw 'orders' array from the API response.
 */

function _fetchEasyEcomOrders(token, fromDate, toDate) 
{
  const apiKey = PropertiesService.getScriptProperties().getProperty('EASY_ECOM_API_KEY');
  const requiredStatuses = [1,2,3,4,5,6,7,31,11];
  const marketplaceId = [26,599,4,10,77,64];

  // Correctly uses the /orders/V2/getAllOrders endpoint
  const initialUrl = `https://api.easyecom.io/orders/V2/getAllOrders?start_date=${fromDate}&end_date=${toDate}&order_type=1&marketplaceId=${marketplaceId.join(',')}&limit=250&status_id=${requiredStatuses.join(',')}`;
  //Logger.log(initialUrl);
  
  let allOrders = [];
  let nextUrl = initialUrl;

  do {
    const options = { 'method': 'get', 'headers': { 'Authorization': 'Bearer ' + token, 'x-api-key': apiKey }, 'muteHttpExceptions': true };
    try {
      const response = UrlFetchApp.fetch(nextUrl, options);
      //Logger.log(response);
      const data = JSON.parse(response.getContentText());

      // --- CORRECTED DATA STRUCTURE ---
      // The array is in data.data.orders
      if (response.getResponseCode() === 200 && data.data && data.data.orders && data.data.orders.length > 0) {
        allOrders = allOrders.concat(data.data.orders);
        nextUrl = data.data.nextUrl ? "https://api.easyecom.io" + data.data.nextUrl : null;
      } else {
        nextUrl = null;
        if (response.getResponseCode() !== 200) Logger.log(`EasyEcom API Error: ${response.getContentText()}`);
      }
    } catch (e) {
      nextUrl = null;
      Logger.log('Exception during EasyEcom API call: ' + e.message);
      return null;
    }
    if (nextUrl) Utilities.sleep(1100);
  } while (nextUrl);

  Logger.log(`Fetched a total of ${allOrders.length} EasyEcom orders.`);
  return allOrders;
}

/**
 * **CORRECTED & UPDATED:** Transforms and SUMMARIZES EasyEcom orders. It now:
 * 1. Uses 'Identifier' for the Channel Item Code.
 * 2. Swaps 'marketplace_sku' and 'sku' for the Channel SKU and Master SKU columns.
 * 3. Differentiates B2B/B2C and processes channel names correctly.
 */

function _transformAndSummarizeEasyEcomOrders(rawOrders) 
{
  const excludedCustomerPrefixes = ["Amazon_", "Flipkart_", "Event_"];
  const summary = rawOrders.reduce((acc, order) => {
    const originalCustomerName = order.customer_name || '';
    
    // --- Exclusion Logic ---
    const isExcluded = excludedCustomerPrefixes.some(prefix => originalCustomerName.startsWith(prefix));
    if (isExcluded) {
      return acc; // Skip this entire order
    }

    // --- Determine sales type and channel name ---
    const isB2B = (order.marketplace_id === 64);
    const salesType = isB2B ? 'B2B' : 'B2C';
    const processedChannelName = isB2B 
      ? (originalCustomerName.split('_')[0].trim() || 'UNKNOWN B2B CUSTOMER') 
      : order.marketplace;

    if (!order.suborders || order.suborders.length === 0) return acc;
    
    order.suborders.forEach(item => {
      // Use the internal 'sku' for grouping, as it's the consistent identifier.
      const internalSku = item.sku;
      if (!internalSku) return;

      const formattedDate = Utilities.formatDate(new Date(order.order_date), SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
      
      // The composite key now groups by the PROCESSED channel name and the INTERNAL SKU.
      const key = `${processedChannelName}|${internalSku}|${formattedDate}`;
      
      if (!acc[key]) {
        // --- DATA MAPPING HAPPENS HERE ---
        // Store all the data we need for the final output in the accumulator.
        acc[key] = {
          date: formattedDate,
          identifier: order.Identifier,         // <-- Use Identifier
          marketplaceSku: item.marketplace_sku, // <-- Store marketplace_sku
          salesType: salesType,
          quantity: 0
        };
      }
      acc[key].quantity += parseInt(item.suborder_quantity, 10) || 0;
    });
    return acc;
  }, {});
  
  // The output mapping now has all the data it needs from the 'details' object.
  return Object.keys(summary).map(key => {
    // The key gives us the channel and the INTERNAL SKU.
    const [channelName, internalSku, date] = key.split('|');
    const details = summary[key];
        
    return [
      date,
      channelName.toUpperCase(),
      details.salesType,
      details.identifier,      // <-- Correct: Channel Item Code is Identifier
      details.marketplaceSku,  // <-- Correct: Channel SKU is marketplace_sku
      internalSku,               // <-- Correct: Master SKU is mapped from internal SKU
      details.quantity
    ];
  });
}

function test()
{
    var date = new Date("2025-11-20 01:22:22");
    Logger.log(date);
    Logger.log(Utilities.formatDate(date,SpreadsheetApp.getActive().getSpreadsheetTimeZone() , 'yyyy-MM-dd'));
}
/**
 * **NEW & ROBUST HELPER:** Finds and removes all rows from a sheet that match a specific
 * date and a specific 'Sales Type' (e.g., 'B2B').
 * @param {string} sheetName - The name of the sheet to clean.
 * @param {string} dateString - The date to filter for (e.g., "2025-11-15").
 * @param {string} salesType - The sales type to filter for (e.g., "B2B").
 */

function _clearDataBySalesType(sheetName, dateString, salesType) 
{
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (sheet.getLastRow() < 2) return;

  const allData = sheet.getDataRange().getValues();
  const headers = allData.shift();
  const dateIndex = headers.indexOf('Date');
  const salesTypeIndex = headers.indexOf('Sales Type');
  
  if (dateIndex === -1 || salesTypeIndex === -1) {
    Logger.log(`Error: 'Date' or 'Sales Type' column not found in '${sheetName}'. Aborting clear operation.`);
    return;
  }

  const timezone = SpreadsheetApp.getActive().getSpreadsheetTimeZone();

  const dataToKeep = allData.filter(row => {
    const rowDate = new Date(row[dateIndex]);
    if (isNaN(rowDate.getTime())) return true; // Keep rows with invalid dates

    const formattedDateString = Utilities.formatDate(rowDate, timezone, 'yyyy-MM-dd');
    
    // The condition to DELETE a row is that it matches both the date AND the sales type.
    const shouldDelete = (formattedDateString === dateString && row[salesTypeIndex] === salesType);
    
    return !shouldDelete; // Return the opposite to keep the row.
  });

  if (dataToKeep.length === allData.length) {
    Logger.log(`No rows found for sales type '${salesType}' on date '${dateString}'. No changes made.`);
    return;
  }
  
  dataToKeep.unshift(headers);
  sheet.clearContents();
  sheet.getRange(1, 1, dataToKeep.length, dataToKeep[0].length).setValues(dataToKeep);
  
  const rowsCleared = allData.length - (dataToKeep.length - 1);
  Logger.log(`Efficiently cleared ${rowsCleared} rows for sales type '${salesType}' on '${dateString}'.`);
}

function backfillEasyEcomSales() 
{
  Logger.log('--- Starting Efficient EasyEcom B2B 90-Day Sales Backfill ---');
  const token = getEasyEcomToken();
  if (!token) return;
  
  const today = new Date();
  let allSummarizedData = [];

  // Loop in 7-day chunks, starting from 90 days ago.
  for (let i = 3; i > 0; i -= 7) 
  {
    const endDate = new Date();
    endDate.setDate(today.getDate() - (i - 7 > 0 ? i - 7 : 1)); // End of the 7-day chunk
    const startDate = new Date();
    startDate.setDate(today.getDate() - i); // Start of the 7-day chunk
    
    const fromDateString = startDate.toISOString().substring(0, 10);
    const toDateString = endDate.toISOString().substring(0, 10);

    Logger.log(`Fetching B2B data from ${fromDateString} to ${toDateString}...`);
    const rawOrders = _fetchEasyEcomOrders(token, fromDateString, toDateString);
    if (rawOrders && rawOrders.length > 0) {
      const summarizedData = _transformAndSummarizeEasyEcomOrders(rawOrders);
      allSummarizedData = allSummarizedData.concat(summarizedData);
    }
    Utilities.sleep(1100); // Pause between each 7-day fetch.
  }
  
  // --- Efficiently Clear and Write Data ---
  if (allSummarizedData.length > 0) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sales Data');
    const fromDate = new Date(); fromDate.setDate(today.getDate() - 90);
    const toDate = new Date(); toDate.setDate(today.getDate() - 1);

    //_clearDataRangeBySalesType('Sales Data', fromDate, toDate, 'B2B'); // Clear the whole 90-day range
    
    sheet.getRange(sheet.getLastRow() + 1, 1, allSummarizedData.length, allSummarizedData[0].length).setValues(allSummarizedData);
    Logger.log(`Appended ${allSummarizedData.length} total B2B rows for the last 90 days.`);
  }

  Logger.log('--- EasyEcom B2B 90-Day Backfill Finished ---');
}

function getEasyEcomInventory() {
  // Step 1: Get JWT Token (reuse however you're doing it in your existing code)
  var jwtToken = getEasyEcomToken(); // paste your existing token logic here

  // Step 2: Fetch Inventory
  var inventoryUrl = "https://api.easyecom.io/getInventoryDetailsV3?includeLocations=1&limit=50&location_id=ne30192190081";

  var inventoryResponse = UrlFetchApp.fetch(inventoryUrl, {
    method: "GET",
    headers: {
      "Authorization": "Bearer " + jwtToken
    },
    muteHttpExceptions: true
  });

  Logger.log("Inventory Response: " + inventoryResponse.getContentText());
}