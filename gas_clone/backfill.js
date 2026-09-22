// =================================================================================
// AMAZON - ROBUST HISTORICAL SALES BACKFILL (TRIGGER-BASED)
// =================================================================================

/**
 * **1. START FUNCTION:** Run this manually from the menu to begin the 90-day backfill.
 * It sets up the initial state and creates the trigger that does the work.
 */
function startAmazonBackfill() {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    'Start Automated Amazon 90-Day Backfill?',
    'This will create a trigger that runs every 10-15 minutes to fetch one day of sales data at a time. The whole process will take several hours to complete in the background. Are you sure you want to begin?',
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) {
    Logger.log('Amazon backfill cancelled by user.');
    return;
  }

  // Clean up any old triggers to prevent multiple instances running.
  _deleteTriggersByName('processAmazonBackfillChunk');

  // Set the starting date for the process: 90 days ago.
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 2);
  const startDateString = startDate.toISOString().substring(0, 10);
  
  // Store the very first date to be processed.
  PropertiesService.getScriptProperties().setProperty('amazonBackfillNextDate', startDateString);
  
  // Create a trigger to run the worker function every 10 minutes.
  ScriptApp.newTrigger('processAmazonBackfillChunk')
    .timeBased()
    .everyMinutes(10)
    .create();

  Logger.log(`SUCCESS: Amazon backfill process started. The first chunk for date ${startDateString} will run in about 10 minutes.`);
  ui.alert('Amazon backfill process has been started. It will run in the background. You can monitor progress in the script execution logs. Use the "STOP" menu item to cancel.');
}


/**
 * **2. WORKER FUNCTION:** This is run by the trigger. It processes one day at a time.
 * DO NOT RUN THIS MANUALLY.
 */
function processAmazonBackfillChunk() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const nextDateString = scriptProperties.getProperty('amazonBackfillNextDate');

  // If the 'nextDate' property doesn't exist, the job is done or was stopped.
  if (!nextDateString) {
    Logger.log('No backfill date found. Assuming process is complete and stopping trigger.');
    _deleteTriggersByName('processAmazonBackfillChunk');
    return;
  }

  const targetDate = new Date(nextDateString);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  // If the next date to process is after yesterday, the job is complete.
  if (targetDate > yesterday) {
    Logger.log('Backfill has reached yesterday. Process is complete.');
    stopAmazonBackfill(); // This will clean everything up.
    return;
  }

  Logger.log(`--- Processing backfill chunk for date: ${nextDateString} ---`);

  // Fetch credentials and mapping for this chunk.
  const accessToken = getAmazonAccessToken();
  if (!accessToken) {
    Logger.log('Could not get Amazon access token for this chunk. Trigger will try again later.');
    return;
  }
  const skuToMasterSkuMap = loadSkuMapping();

  // --- Call the existing daily sales function for this specific day ---
  fetchAndAppendAmazonSales(accessToken, skuToMasterSkuMap, targetDate);
  
  // --- Calculate and store the NEXT day to be processed ---
  const nextDay = new Date(targetDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayString = nextDay.toISOString().substring(0, 10);
  scriptProperties.setProperty('amazonBackfillNextDate', nextDayString);
  
  Logger.log(`Chunk for ${nextDateString} complete. Next chunk scheduled for ${nextDayString}.`);
}


/**
 * **3. STOP FUNCTION:** Run this manually from the menu to cancel the backfill process.
 */
function stopAmazonBackfill() {
  _deleteTriggersByName('processAmazonBackfillChunk');
  PropertiesService.getScriptProperties().deleteProperty('amazonBackfillNextDate');
  Logger.log('SUCCESS: Amazon backfill process has been stopped and all triggers have been removed.');
  SpreadsheetApp.getUi().alert('Amazon backfill process has been stopped.');
}


/**
 * **HELPER:** Deletes all triggers with a specific function name.
 */
function _deleteTriggersByName(functionName) {
  const allTriggers = ScriptApp.getProjectTriggers();
  let deletedCount = 0;
  allTriggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(trigger);
      deletedCount++;
    }
  });
  if (deletedCount > 0) {
    Logger.log(`Deleted ${deletedCount} existing trigger(s) for '${functionName}'.`);
  }
}