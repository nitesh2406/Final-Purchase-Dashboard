function fetchFbaFcWiseInventory() {

  var accessToken = getAmazonAccessToken();

  const scriptProperties = PropertiesService.getScriptProperties();
  const marketplaceId = scriptProperties.getProperty('MARKETPLACE_ID');
  const endpoint = 'https://sellingpartnerapi-eu.amazon.com/reports/2021-06-30';

  const reportType = 'GET_LEDGER_SUMMARY_VIEW_DATA';

  const reportOptions = {
    aggregateByLocation: "FC",
    aggregatedByTimePeriod: "DAILY"
  };

  // ---------- PRIMARY: YESTERDAY ----------
  let yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 2);

  let options = {
    dataStartTime: formatDateISO(yesterday, true),
    dataEndTime: formatDateISO(yesterday, false),
    reportOptions: reportOptions
  };
  /*
  let reportId = createReport(accessToken, endpoint, marketplaceId, reportType, options);
  if (!reportId) return new Map();
  */

  let docId = pollForReport(accessToken, endpoint, "862755020533");
  if (!docId) return new Map();
  

  let reportData = downloadAndParseTSV(accessToken, endpoint, docId);

  // ---------- FALLBACK: 2 DAYS AGO ----------
  if (!reportData || reportData.length === 0) {

    let prevDay = new Date();
    prevDay.setDate(prevDay.getDate() - 3);

    options = {
      dataStartTime: formatDateISO(prevDay, true),
      dataEndTime: formatDateISO(prevDay, false),
      reportOptions: reportOptions
    };

    reportId = createReport(accessToken, endpoint, marketplaceId, reportType, options);
    if (!reportId) return new Map();

    docId = pollForReport(accessToken, endpoint, reportId);
    if (!docId) return new Map();

    reportData = downloadAndParseTSV(accessToken, endpoint, docId);
  }

  // ---------- FINAL EXTRACTION ----------
  return extractXQJXInventoryLedger(reportData);
}
function extractXQJXInventoryLedger(reportData) {

  const fcMap = new Map();
  const uniqueFCs = new Set();

  reportData.forEach(row => {

    const sku = row['MSKU']; // 🔥 FIXED
    const fc = row['Location'];
    const qty = parseInt(row['Ending Warehouse Balance'], 10) || 0;

    if (fc) uniqueFCs.add(fc);

    if (fc === 'XQJX') {
      Logger.log(sku + " : " +qty)
      fcMap.set(sku, (fcMap.get(sku) || 0) + qty);
    }

  });

  Logger.log("FC VALUES: " + Array.from(uniqueFCs).join(", "));
  Logger.log("XQJX SKU count: " + fcMap.size);

  return fcMap;
}

function formatDateISO(date, isStart) {
  const d = new Date(date);
  if (isStart) {
    d.setHours(0, 0, 0, 0);
  } else {
    d.setHours(23, 59, 59, 999);
  }
  return d.toISOString();
}