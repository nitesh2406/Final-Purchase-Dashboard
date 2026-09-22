
// =================================================================================
// SHOPIFY FUNCTIONS
// =================================================================================

function fetchAndAppendShopifySales() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const shopName = scriptProperties.getProperty('SHOPIFY_SHOP_NAME');
  const accessToken = scriptProperties.getProperty('SHOPIFY_ACCESS_TOKEN');
  if (!shopName || !accessToken) return;

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - 1);
  const targetDateString = targetDate.toISOString().substring(0, 10);
  
  // --- DUPLICATE PREVENTION ADDED ---
  _clearExistingData('Sales Data', targetDateString, 'SHOPIFY');

  const rawOrders = _fetchShopifyOrders(shopName, accessToken, 1);
  if (!rawOrders || rawOrders.length === 0) return;
  const summarizedData = _transformAndSummarizeShopifyOrders(rawOrders);
  
  if (summarizedData.length > 0) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sales Data');
    const headers = ['Date', 'Channel Name', 'Sales Type', 'Channel Item Code', 'Channel SKU', 'Master SKU', 'Quantity'];
    if (sheet.getLastRow() < 1) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(sheet.getLastRow() + 1, 1, summarizedData.length, summarizedData[0].length).setValues(summarizedData);
    Logger.log(`Appended ${summarizedData.length} summarized Shopify sales rows.`);
  }
}


/**
 * **HELPER 1:** Fetches all paginated orders for a given day from the Shopify API.
 * This is optimized to only fetch the fields it needs.
 */
function _fetchShopifyOrders(shopName, accessToken, daysAgo) {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - daysAgo);
  const dateString = targetDate.toISOString().substring(0, 10);
  Logger.log(`Fetching Shopify orders for date: ${dateString}`);

  const created_at_min = `${dateString}T00:00:00Z`;
  const created_at_max = `${dateString}T23:59:59Z`;

  let allOrders = [];
  let nextPageUrl = `https://${shopName}.myshopify.com/admin/api/2023-10/orders.json?status=any&created_at_min=${created_at_min}&created_at_max=${created_at_max}&limit=250&fields=created_at,line_items`;
  
  const options = { 'method': 'get', 'headers': { 'X-Shopify-Access-Token': accessToken }, 'muteHttpExceptions': true };

  do {
    try {
      const response = UrlFetchApp.fetch(nextPageUrl, options);
      if (response.getResponseCode() === 200) {
        const data = JSON.parse(response.getContentText());
        if (data.orders) allOrders = allOrders.concat(data.orders);
        
        const linkHeader = response.getHeaders()['Link'];
        const match = linkHeader ? /<([^>]+)>; rel="next"/.exec(linkHeader) : null;
        nextPageUrl = match ? match[1] : null;
      } else {
        Logger.log(`Shopify API Error: ${response.getContentText()}`);
        nextPageUrl = null;
      }
    } catch (e) {
      Logger.log('Exception during Shopify API call: ' + e.message);
      nextPageUrl = null;
    }
    if (nextPageUrl) Utilities.sleep(600);
  } while (nextPageUrl);

  Logger.log(`Fetched a total of ${allOrders.length} Shopify orders for ${dateString}.`);
  return allOrders;
}


/**
 * **HELPER 2 (CORRECTED):** Transforms and SUMMARIZES the raw Shopify order data by SKU.
 * @return {Array} A 2D array ready to be written to the sheet.
 */
function _transformAndSummarizeShopifyOrders(rawOrders) {
  // Use .reduce() to efficiently summarize quantities for each SKU.
  const summary = rawOrders.reduce((acc, order) => {
    order.line_items.forEach(item => {
      // Skip items with no SKU
      if (!item.sku) return; 
      const sku = item.sku;
      
      // If we haven't seen this SKU yet for this day, initialize its entry.
      if (!acc[sku]) {
        acc[sku] = {
          date: new Date(order.created_at).toISOString().substring(0, 10),
          variantId: item.variant_id,
          quantity: 0
        };
      }
      
      // Add the current item's quantity to the total for that SKU.
      acc[sku].quantity += item.quantity;
    });
    return acc;
  }, {}); // Start with an empty object as our accumulator.
  
  // Convert the summary object into the final 2D array format.
  return Object.keys(summary).map(sku => {
    const details = summary[sku];
    return [
      details.date,
      'SHOPIFY',
      'B2C',
      details.variantId,
      sku, // Original SKU
      sku, // Master SKU (since no mapping is needed)
      details.quantity // The final SUMMED quantity
    ];
  });
}