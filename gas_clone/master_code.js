// =================================================================================
// MASTER ORCHESTRATION & MENU
// =================================================================================

// onOpen is defined in 0_entry_points.gs

/**
 * **MASTER FUNCTION:** Orchestrates the entire daily update process for all channels.
 */
function runAllUpdates() 
{

  Logger.log('--- Starting EasyEcom Product Master Fetch ---');

  // Step 1: Get the authentication token.
  const token = getEasyEcomToken(); // Assumes this function already exists
  if (!token) {
    Logger.log('Failed to get EasyEcom token. Aborting.');
    return;
  }
  
  // Step 2: Fetch all product data using the corrected pagination logic.
  const allProducts = fetchAllEcomProducts(token);
  fetchAndUpdateEasyEcomComponents(token);
  updateEasyEcomPurchaseOrders(token);

  // Step 3: Process the raw data with the corrected parsing logic.
  writeEcomProductsToSheet(allProducts);
  // Rows are only BUILT here; 'Inventory Data' is written once, at the end, with
  // the EasyEcom and Amazon halves together (see finalizeInventorySync_). It used
  // to be cleared and rewritten with just the EasyEcom rows at this point, then
  // left that way for the whole Amazon fetch below.
  const eeInventory = buildEasyEcomInventoryRows_(allProducts);
  const adjustmentMap = eeInventory.adjustmentMap;
  let amazonInventoryRows = null;

  try {
  // --- Step 1: Amazon Process ---
  Logger.log('--- Starting Amazon Update Process ---');
  const amzAccessToken = getAmazonAccessToken();
  if (amzAccessToken) {
    // First, update the mapping sheet with any new SKUs.
    updateAmazonSkuMapping(amzAccessToken); 
    
    // NOW, load the newly updated map.
    const skuToMasterSkuMap = loadSkuMapping();

     // --- CHANGE: Call the sales function with a date object for "yesterday" ---
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    fetchAndAppendAmazonSales(amzAccessToken, skuToMasterSkuMap, yesterday);
    fetchAndAppendEasyEcomSales(token,1);
    
    const allInventoryItems = fetchFbaInventory(amzAccessToken);
    amazonInventoryRows = buildAmazonInventoryRows_(allInventoryItems, skuToMasterSkuMap, adjustmentMap);

    Logger.log('--- Amazon Update Process Finished ---');
  } else {
    Logger.log('Could not get Amazon access token. Skipping Amazon updates.');
  }
  } finally {
    // Runs whether or not the Amazon steps succeeded (or threw): commits the
    // sheet, carrying the previous Amazon rows over if there are none. A throw
    // above still propagates afterwards, so trigger failure emails are unchanged.
    finalizeInventorySync_(eeInventory.rows, amazonInventoryRows);
  }

  /*
  // --- Step 2: Shopify Process ---
  Logger.log('--- Starting Shopify Update Process ---');
  fetchAndAppendShopifySales();
  Logger.log('--- Shopify Update Process Finished ---');
  */


    // --- Final Cleanup ---
  _cleanupSheetByDate('Sales Data', 91, 'Date');

  Logger.log('--- EasyEcom Product Master Fetch Finished ---');
}

function fetch_all_inventory()
{
  Logger.log('--- Fetching Easyecom inventory and creating Adjustment Map for SmartConnect Site XQJX ---');

  const token = getEasyEcomToken(); 
  Utilities.sleep(5000);
  const allProducts = fetchAllEcomProducts(token);
  Utilities.sleep(5000);
  

  writeEcomProductsToSheet(allProducts);

  // Built here, committed once at the end together with the Amazon rows — see
  // finalizeInventorySync_ (Inventory_Valuation.js).
  const eeInventory = buildEasyEcomInventoryRows_(allProducts);
  const adjustmentMap = eeInventory.adjustmentMap;
  let amazonInventoryRows = null;

  try {
    Logger.log('--- Fetching Amazon FBA Inventory ---');
    const amzAccessToken = getAmazonAccessToken();

    updateAmazonSkuMapping(amzAccessToken);
    const skuToMasterSkuMap = loadSkuMapping();
    const allInventoryItems = fetchFbaInventory(amzAccessToken);

    Logger.log('--- Building Adjusted Amazon FBA Inventory---')
    amazonInventoryRows = buildAmazonInventoryRows_(allInventoryItems, skuToMasterSkuMap, adjustmentMap);
  } finally {
    // Runs even if the Amazon steps threw: EasyEcom stock still refreshes and the
    // previous Amazon rows are carried over (flagged in the Inventory tab). The
    // error still propagates afterwards.
    finalizeInventorySync_(eeInventory.rows, amazonInventoryRows);
  }

  Logger.log('---  Update Process Finished ---');
}

function back_data_amazon() 
{


  const amzAccessToken = getAmazonAccessToken();
  if (amzAccessToken) {
    
    // NOW, load the newly updated map.
    const skuToMasterSkuMap = loadSkuMapping();

     // --- CHANGE: Call the sales function with a date object for "yesterday" ---
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    fetchAndAppendAmazonSales(amzAccessToken, skuToMasterSkuMap, yesterday);

  } else {
    Logger.log('Could not get Amazon access token. Skipping Amazon updates.');
  }

}





